/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceSangerTraceViewer,
  type SangerTraceViewerRecord,
} from '../ClaudeScienceSangerTraceViewer';
import { normalizeArtifactAlignment } from '../claude-science-msa';

const sequence = 'ACGT'.repeat(30);
const alignment = normalizeArtifactAlignment({
  id: 'sanger-position-round-trip',
  name: 'Sanger position round trip',
  molecule: 'dna',
  referenceRowId: 'template',
  rows: [
    { id: 'template', name: 'Template', aligned: sequence },
    { id: 'read', name: 'Read', aligned: sequence, sourceRecordId: 'read-record' },
  ],
});
const zoomAlignment = normalizeArtifactAlignment({
  id: 'sanger-position-zoom',
  name: 'Sanger position zoom',
  molecule: 'dna',
  referenceRowId: 'template',
  rows: [
    { id: 'template', name: 'Template', aligned: sequence },
    { id: 'read', name: 'Read', aligned: sequence, sourceRecordId: 'read-record' },
  ],
});
const records: SangerTraceViewerRecord[] = [{
  id: 'read-record',
  name: 'Read',
  sangerTrace: {
    schema: 'motif.sanger-trace.v1' as const,
    version: 1 as const,
    baseCalls: sequence,
    sequence,
    qualityScores: Array.from({ length: sequence.length }, () => 30),
    peakPositions: Array.from({ length: sequence.length }, (_, index) => index * 10),
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
      sampleName: 'Read',
    },
  },
}];

function renderViewer({
  viewerAlignment = alignment,
  jumpColumn = null,
  jumpToken = 0,
}: {
  viewerAlignment?: typeof alignment;
  jumpColumn?: number | null;
  jumpToken?: number;
} = {}) {
  return render(
    <ClaudeScienceSangerTraceViewer
      alignment={viewerAlignment}
      records={records}
      templateRowId="template"
      jumpColumn={jumpColumn}
      jumpToken={jumpToken}
    />,
  );
}

function stubScroller(): HTMLElement {
  const scroller = screen.getByTestId('sanger-trace-scroll');
  Object.defineProperties(scroller, {
    clientWidth: { configurable: true, value: 240 },
    scrollWidth: { configurable: true, value: sequence.length * 24 },
  });
  Object.defineProperty(scroller, 'scrollTo', {
    configurable: true,
    value: vi.fn((options: ScrollToOptions) => {
      if (typeof options.left === 'number') scroller.scrollLeft = options.left;
      if (typeof options.top === 'number') scroller.scrollTop = options.top;
    }),
  });
  return scroller;
}

function positionSlider(): HTMLInputElement {
  return screen.getByRole('slider') as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceSangerTraceViewer alignment position', () => {
  it('persists slider navigation without changing the inspected call, then keeps arrow navigation synchronized', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const first = renderViewer();
    stubScroller();
    const canvas = screen.getByRole('img');
    fireEvent.pointerDown(canvas, { clientX: 20.5 * 12 });
    expect(screen.getByText(/Alignment position 21 · read/)).toBeTruthy();

    expect(positionSlider().closest('label')?.textContent).toContain('Alignment position');
    fireEvent.change(positionSlider(), {
      target: { value: '80' },
    });
    expect(positionSlider().value).toBe('80');
    expect(screen.getByText(/Alignment position 21 · read/)).toBeTruthy();

    first.unmount();
    renderViewer();
    stubScroller();
    expect(positionSlider().value).toBe('80');
    expect(screen.getByText(/Alignment position 21 · read/)).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowRight' });
    expect(positionSlider().value).toBe('21');
    expect(screen.getByText(/Alignment position 22 · read/)).toBeTruthy();
  });

  it('keeps the positioned biological column centered through zoom in and out', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const view = renderViewer({ viewerAlignment: zoomAlignment });
    const scroller = stubScroller();
    while (frames.length > 0) frames.shift()?.(0);

    fireEvent.pointerDown(screen.getByRole('img'), { clientX: 20.5 * 12 });
    expect(screen.getByText(/Alignment position 21 · read/)).toBeTruthy();

    view.rerender(
      <ClaudeScienceSangerTraceViewer
        alignment={zoomAlignment}
        records={records}
        templateRowId="template"
        jumpColumn={20}
        jumpToken={1}
      />,
    );
    fireEvent.change(positionSlider(), { target: { value: '80' } });
    const centeredBeforeZoom = (scroller.scrollLeft + (scroller.clientWidth / 2)) / 12;

    fireEvent.click(screen.getByRole('button', { name: 'Zoom chromatogram in' }));
    while (frames.length > 0) frames.shift()?.(0);

    expect(positionSlider().value).toBe('80');
    expect((scroller.scrollLeft + (scroller.clientWidth / 2)) / 14).toBeCloseTo(centeredBeforeZoom);
    expect(screen.getByText(/Alignment position 21 · read/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom chromatogram out' }));
    while (frames.length > 0) frames.shift()?.(0);

    expect(positionSlider().value).toBe('80');
    expect((scroller.scrollLeft + (scroller.clientWidth / 2)) / 12).toBeCloseTo(centeredBeforeZoom);
    expect(screen.getByText(/Alignment position 21 · read/)).toBeTruthy();
  });

  it('updates the position control when the reader scrolls manually', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    renderViewer();
    const scroller = stubScroller();
    while (frames.length > 0) frames.shift()?.(0);
    fireEvent.change(positionSlider(), { target: { value: '70' } });
    expect(positionSlider().value).toBe('70');
    fireEvent.scroll(scroller);
    act(() => {
      while (frames.length > 0) frames.shift()?.(0);
    });
    // Explicit navigation centers column 70 at coordinate 70.5. Synchronizing
    // that programmatic scroll must not advance the control to column 71.
    expect(positionSlider().value).toBe('70');

    scroller.scrollLeft = 600;
    fireEvent.scroll(scroller);
    act(() => {
      while (frames.length > 0) frames.shift()?.(0);
    });

    // (600px scroll + 120px viewport midpoint) / 12px per column = column 60.
    expect(positionSlider().value).toBe('60');
    expect(positionSlider().closest('label')?.textContent).toContain('61');
  });
});
