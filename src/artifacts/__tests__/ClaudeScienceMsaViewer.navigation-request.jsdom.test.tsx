/** @vitest-environment jsdom */

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceMsaViewer,
  type ClaudeScienceMsaNavigationRequest,
  type ClaudeScienceMsaViewerProps,
} from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment } from '../claude-science-msa';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  type ClaudeScienceMsaViewPreferences,
} from '../claude-science-msa-view-preferences';
import type { SangerTraceData } from '../../bio/abi-import';

function trace(baseCalls: string): SangerTraceData {
  return {
    schema: 'motif.sanger-trace.v1',
    version: 1,
    baseCalls,
    sequence: baseCalls,
    qualityScores: Array.from({ length: baseCalls.length }, () => 30),
    peakPositions: Array.from({ length: baseCalls.length }, (_, index) => index * 10),
    channels: { A: [], C: [], G: [], T: [] },
    sampleCount: 0,
    dyeOrder: null,
    storedReverseComplement: false,
    warnings: [],
    metadata: {
      format: 'ABIF',
      abifVersion: 101,
      baseCallsTag: 'PBAS2',
      qualityScoresTag: 'PCON2',
      peakPositionsTag: 'PLOC2',
      channelTags: {},
      sampleName: 'read',
    },
  };
}

function withChanges(sequence: string, changes: Record<number, string>): string {
  return Array.from(sequence, (base, index) => changes[index] ?? base).join('');
}

// Template 60 bases; read A differs at 0-based columns 17 and 40, read B at 30.
const TEMPLATE = 'ACGTAGCTTGCAAGTC'.repeat(4).slice(0, 60);
const READ_A = withChanges(TEMPLATE, { 17: TEMPLATE[17] === 'A' ? 'G' : 'A', 40: TEMPLATE[40] === 'A' ? 'C' : 'A' });
const READ_B = withChanges(TEMPLATE, { 30: TEMPLATE[30] === 'A' ? 'T' : 'A' });

// The trace viewer keeps per-alignment state for the page's life, so each
// test gets an alignment of its own.
function alignmentNamed(id: string) {
  return normalizeArtifactAlignment({
    id,
    name: id,
    molecule: 'dna',
    referenceRowId: 'template',
    rows: [
      { id: 'template', name: 'Template', aligned: TEMPLATE },
      { id: 'row-a', name: 'Read A', aligned: READ_A, sourceRecordId: 'read-a' },
      { id: 'row-b', name: 'Read B', aligned: READ_B, sourceRecordId: 'read-b' },
    ],
  });
}

const records = [
  { id: 'read-a', name: 'Read A', type: 'dna' as const, sequence: READ_A, sangerTrace: trace(READ_A) },
  { id: 'read-b', name: 'Read B', type: 'dna' as const, sequence: READ_B, sangerTrace: trace(READ_B) },
];

function Host({
  alignmentId,
  navigationRequest,
  onNavigationRequestHandled,
}: {
  alignmentId: string;
  navigationRequest: ClaudeScienceMsaNavigationRequest | null;
  onNavigationRequestHandled?: (token: number) => void;
}) {
  const [viewPreferences, setViewPreferences] = useState<ClaudeScienceMsaViewPreferences>({ ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, displayMode: 'trace' });
  const [alignment] = useState(() => alignmentNamed(alignmentId));
  const props: ClaudeScienceMsaViewerProps = {
    records,
    alignments: [alignment],
    activeAlignmentId: alignment.id,
    viewPreferences,
    onActiveAlignmentChange: vi.fn(),
    onViewPreferencesChange: setViewPreferences,
    onSaveAlignment: (next) => next,
    onUpdateAlignmentTemplate: vi.fn(),
    onDeleteAlignment: vi.fn(),
    onImportRecords: async () => ({ records: [], message: '', tone: 'status' }),
    onCopy: async () => true,
    onDownload: vi.fn(),
    navigationRequest,
    onNavigationRequestHandled,
  };
  return <ClaudeScienceMsaViewer {...props} />;
}

const status = () => screen.getByTestId('sanger-call-status').textContent ?? '';
const selectedRead = () => (screen.getByRole('combobox', { name: /^(Focus|Read)$/ }) as HTMLSelectElement).value;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  try { window.localStorage.clear(); } catch { /* storage may be unavailable */ }
  if (!('scrollTo' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value: () => undefined });
  }
  vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function scrollTo(this: Element, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options && typeof options.left === 'number') this.scrollLeft = options.left;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer navigation requests', () => {
  it('opens Traces on the requested column and read, over the first-difference landing', () => {
    const handled = vi.fn();
    render(
      <Host
        alignmentId="navigation-request"
        navigationRequest={{ alignmentId: 'navigation-request', column: 5, rowId: 'row-b', token: 1_000_001 }}
        onNavigationRequestHandled={handled}
      />,
    );
    expect(screen.getByTestId('sanger-trace-viewer')).toBeTruthy();
    // Column 5 is no difference; a newly opened alignment lands on column 18 by itself.
    expect(status()).toMatch(/^Template position 6 · alignment column 6 · read /);
    expect(selectedRead()).toBe('row-b');
    expect(handled).toHaveBeenCalledTimes(1);
    expect(handled).toHaveBeenCalledWith(1_000_001);
  });

  it('ignores a request for another alignment', () => {
    const handled = vi.fn();
    render(
      <Host
        alignmentId="navigation-other"
        navigationRequest={{ alignmentId: 'some-other-alignment', column: 5, rowId: 'row-b', token: 1_000_001 }}
        onNavigationRequestHandled={handled}
      />,
    );
    expect(status()).toMatch(/^Template position 18 · /);
    expect(handled).not.toHaveBeenCalled();
  });

  it('keeps the requested column in view once the first frames have run', () => {
    // Run animation frames on demand. The trace viewer's first-mount frame
    // used to scroll back to the first covered column after the jump.
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
    render(
      <Host
        alignmentId="navigation-frame"
        navigationRequest={{ alignmentId: 'navigation-frame', column: 45, rowId: 'row-a', token: 1_000_003 }}
      />,
    );
    const slider = screen.getByRole('slider', { name: /Alignment column/ }) as HTMLInputElement;
    expect(slider.value).toBe('45');
    act(() => {
      for (let pass = 0; pass < 4 && frames.size; pass += 1) {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(0);
      }
    });
    expect(slider.value).toBe('45');
    expect(status()).toMatch(/^Template position 46 · /);
  });

  it('applies a new request when the same alignment opens again, after the reader moved on', () => {
    const first = render(
      <Host
        alignmentId="navigation-reopen"
        navigationRequest={{ alignmentId: 'navigation-reopen', column: 5, rowId: 'row-b', token: 1_000_001 }}
      />,
    );
    expect(status()).toMatch(/^Template position 6 · /);
    const lane = screen.getByRole('img', { name: /^Read B chromatogram/ });
    for (let step = 0; step < 3; step += 1) fireEvent.keyDown(lane, { key: 'ArrowRight' });
    expect(status()).toMatch(/^Template position 9 · /);
    first.unmount();

    // The window opens again for the same variant. The trace viewer remembers
    // the last jump it took on this alignment; a token the viewer had already
    // used on the first mount would be taken for that jump and skipped.
    render(
      <Host
        alignmentId="navigation-reopen"
        navigationRequest={{ alignmentId: 'navigation-reopen', column: 5, rowId: 'row-b', token: 1_000_002 }}
      />,
    );
    expect(status()).toMatch(/^Template position 6 · /);
  });
});
