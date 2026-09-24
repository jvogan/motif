/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceSangerTraceViewer,
  TRACE_DIFFERENCE_MARK_MIN_WIDTH,
  traceDifferenceColumns,
  traceTemplateCoordinateLabel,
  type SangerTraceViewerRecord,
} from '../ClaudeScienceSangerTraceViewer';
import { ClaudeScienceMsaViewer, type ClaudeScienceMsaViewerProps } from '../ClaudeScienceMsaViewer';
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

const alignment = normalizeArtifactAlignment({
  id: 'trace-differences',
  name: 'Trace differences',
  molecule: 'dna',
  referenceRowId: 'template',
  rows: [
    { id: 'template', name: 'Template', aligned: TEMPLATE },
    { id: 'row-a', name: 'Read A', aligned: READ_A, sourceRecordId: 'read-a' },
    { id: 'row-b', name: 'Read B', aligned: READ_B, sourceRecordId: 'read-b' },
  ],
});

const records: SangerTraceViewerRecord[] = [
  { id: 'read-a', name: 'Read A', sangerTrace: trace(READ_A) },
  { id: 'read-b', name: 'Read B', sangerTrace: trace(READ_B) },
];

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

describe('trace coordinates', () => {
  it('labels a call by its template position, apart from the alignment column', () => {
    // One base inserted upstream in the read shifts template base 105 to column 106.
    const template = { aligned: `${'A'.repeat(50)}-${'C'.repeat(60)}` };
    const shifted = { rows: [], referenceNumbering: undefined };
    expect(traceTemplateCoordinateLabel(shifted, template, 105)).toBe('Template position 105');
    expect(traceTemplateCoordinateLabel(shifted, template, 50)).toBe('Insertion after template position 50');
    expect(traceTemplateCoordinateLabel(shifted, template, 0)).toBe('Template position 1');
    expect(traceTemplateCoordinateLabel(shifted, { aligned: '--AC' }, 1)).toBe('Before template position 1');
  });

  it('follows the alignment reference numbering when one is set', () => {
    const rows = [{ id: 'ref', name: 'ref', aligned: 'AC-GT' }];
    const numbered = { rows, referenceNumbering: { rowId: 'ref', firstResiduePosition: 101 } };
    expect(traceTemplateCoordinateLabel(numbered, rows[0], 3)).toBe('Reference position 103');
    expect(traceTemplateCoordinateLabel(numbered, rows[0], 2)).toBe('Insertion after reference position 102');
  });

  it('counts substitutions and internal gaps but not a read end that has no data', () => {
    expect(traceDifferenceColumns('--ACGTA-', 'TTACCTAA')).toEqual([4]);
    expect(traceDifferenceColumns('ACG-TA', 'ACGGTA')).toEqual([3]);
    expect(traceDifferenceColumns('ACGGTA', 'ACG-TA')).toEqual([3]);
    expect(traceDifferenceColumns('------', 'ACGGTA')).toEqual([]);
  });
});

describe('ClaudeScienceSangerTraceViewer difference navigation', () => {
  it('selects the call a jump lands on and names it by template position', () => {
    const view = render(
      <ClaudeScienceSangerTraceViewer alignment={alignment} records={records} templateRowId="template" jumpColumn={null} jumpToken={0} />,
    );
    const status = screen.getByTestId('sanger-call-status');
    expect(status.textContent).toBe('Click a base or use the arrow keys to inspect a call.');

    view.rerender(
      <ClaudeScienceSangerTraceViewer alignment={alignment} records={records} templateRowId="template" jumpColumn={30} jumpToken={1} />,
    );
    // Column 30 differs only in read B, so the viewer focuses read B and selects the call.
    expect(screen.getByTestId('sanger-call-status').textContent).toMatch(/^Template position 31 · alignment column 31 · read [ACGT] · template [ACGT]/);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('row-b');
  });

  it('focuses the row a chosen difference names', () => {
    const view = render(
      <ClaudeScienceSangerTraceViewer alignment={alignment} records={records} templateRowId="template" jumpColumn={null} jumpToken={0} />,
    );
    view.rerender(
      <ClaudeScienceSangerTraceViewer alignment={alignment} records={records} templateRowId="template" jumpColumn={17} jumpToken={1} jumpRowId="row-a" />,
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('row-a');
    expect(screen.getByTestId('sanger-call-status').textContent).toMatch(/^Template position 18 · alignment column 18 · read /);
  });

  it('pins the call readout above the traces and marks every difference on a strip', () => {
    render(
      <ClaudeScienceSangerTraceViewer alignment={alignment} records={records} templateRowId="template" jumpColumn={null} jumpToken={0} />,
    );
    const viewer = screen.getByTestId('sanger-trace-viewer');
    const status = screen.getByTestId('sanger-call-status');
    const scroller = viewer.querySelector('.motif-cs-sanger-scroll');
    expect(scroller).toBeTruthy();
    expect(status.compareDocumentPosition(scroller!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const strip = screen.getByTestId('sanger-difference-strip');
    // Stacked view shows both reads: three difference columns in all.
    expect(strip.getAttribute('data-difference-count')).toBe('3');
    // It counts columns, so it says columns: "3 differences" read beside a
    // counter that steps a whole deletion as one difference.
    expect(strip.getAttribute('title')).toMatch(/^3 of [\d,]+ alignment columns differ from the template\./);
    const ticks = strip.querySelectorAll('.motif-cs-sanger-strip-tick');
    expect(ticks).toHaveLength(3);
    for (const tick of ticks) expect(Number(tick.getAttribute('width'))).toBeGreaterThanOrEqual(2);
    expect(TRACE_DIFFERENCE_MARK_MIN_WIDTH).toBe(2);
  });
});

function StatefulMsa({ initial }: { initial: ClaudeScienceMsaViewPreferences }) {
  const [viewPreferences, setViewPreferences] = useState(initial);
  const props: ClaudeScienceMsaViewerProps = {
    records: records.map((record) => ({ ...record, type: 'dna' as const, sequence: record.sangerTrace!.baseCalls })),
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
  };
  return <ClaudeScienceMsaViewer {...props} />;
}

describe('ClaudeScienceMsaViewer in Traces', () => {
  it('stays in Traces when a difference is chosen from the list, and selects that call', () => {
    render(<StatefulMsa initial={{ ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, displayMode: 'trace' }} />);
    expect(screen.getByTestId('sanger-trace-viewer')).toBeTruthy();

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    const pane = screen.getByTestId('msa-differences-pane');
    const rows = within(pane).getAllByTestId('msa-difference-row');
    const target = rows.find((row) => row.getAttribute('aria-label')?.includes('alignment column 41'));
    expect(target).toBeTruthy();
    fireEvent.click(target!);

    expect(screen.getByTestId('sanger-trace-viewer')).toBeTruthy();
    expect(screen.queryByRole('grid', { name: /^Alignment matrix,/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Traces' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('sanger-call-status').textContent).toMatch(/^Template position 41 · alignment column 41 · read /);
  });

  it('steps differences with N and P in Traces', () => {
    render(<StatefulMsa initial={{ ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, displayMode: 'trace' }} />);
    const nav = () => document.querySelector('.motif-cs-msa-difference-nav span')?.textContent ?? '';
    const status = () => screen.getByTestId('sanger-call-status').textContent ?? '';
    const before = nav();
    fireEvent.keyDown(window, { key: 'n' });
    const first = { nav: nav(), status: status() };
    expect(first.nav).not.toBe(before);
    expect(first.nav).toMatch(/Difference [123] of 3/);
    expect(first.status).toMatch(/^Template position (18|31|41) · alignment column (18|31|41) · read /);
    fireEvent.keyDown(window, { key: 'n' });
    expect(nav()).not.toBe(first.nav);
    expect(status()).not.toBe(first.status);
    fireEvent.keyDown(window, { key: 'p' });
    expect(nav()).toBe(first.nav);
    expect(status()).toBe(first.status);
    expect(screen.getByTestId('sanger-trace-viewer')).toBeTruthy();
    // The position slider takes no letters, so N still steps from there.
    fireEvent.keyDown(screen.getByRole('slider', { name: /Alignment column/ }), { key: 'n' });
    expect(nav()).not.toBe(first.nav);
    // A text field keeps its letters.
    const field = document.createElement('input');
    document.body.appendChild(field);
    const beforeField = nav();
    fireEvent.keyDown(field, { key: 'n' });
    expect(nav()).toBe(beforeField);
    field.remove();
  });
});
