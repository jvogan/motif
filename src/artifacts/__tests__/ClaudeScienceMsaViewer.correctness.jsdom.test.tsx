/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceMsaViewer,
  classifyMsaCell,
  differenceColumns,
  mismatchOverviewBins,
  pairwiseRowStats,
  type ClaudeScienceMsaViewerProps,
} from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment, type ArtifactAlignment } from '../claude-science-msa';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

type AlignmentRowInput = { id: string; name: string; aligned: string };

function alignmentWithRows(id: string, rows: AlignmentRowInput[]): ArtifactAlignment {
  return normalizeArtifactAlignment({
    id,
    name: id,
    molecule: 'dna',
    referenceRowId: rows[0].id,
    rows,
  });
}

function singleRowAlignment(): ArtifactAlignment {
  const duplicated = alignmentWithRows('single-row', [
    { id: 'reference', name: 'Reference', aligned: 'ACGT' },
    { id: 'duplicate', name: 'Duplicate', aligned: 'ACGT' },
  ]);
  return {
    ...duplicated,
    rows: duplicated.rows.slice(0, 1),
    referenceRowId: 'reference',
    centerIdx: 0,
  };
}

function renderViewer(
  alignment: ArtifactAlignment,
  viewPreferences = DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
) {
  const props: ClaudeScienceMsaViewerProps = {
    records: [],
    alignments: [alignment],
    activeAlignmentId: alignment.id,
    viewPreferences,
    onActiveAlignmentChange: vi.fn(),
    onViewPreferencesChange: vi.fn(),
    onSaveAlignment: (next) => next,
    onUpdateAlignmentTemplate: () => null,
    onDeleteAlignment: vi.fn(),
    onImportRecords: async () => ({ records: [], message: '', tone: 'status' }),
    onCopy: async () => true,
    onDownload: vi.fn(),
  };
  return render(<ClaudeScienceMsaViewer {...props} />);
}

function expectComparisonUnavailable(): void {
  expect(screen.getByTestId('msa-stats-bar').textContent).toContain('N/A avg to template');
  expect((screen.getByLabelText('Compare against') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText('Previous variable column') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Next variable column') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('No comparable rows')).toBeTruthy();
}

function selectFirstColumn(): void {
  const view = screen.getByTestId('msa-alignment-view');
  const viewport = view.querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll');
  const ruler = view.querySelector<HTMLElement>('.motif-cs-msa-ruler-window-clickable');
  if (!viewport || !ruler) throw new Error('Expected the alignment viewport and clickable ruler.');
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 400,
    width: 800,
    height: 400,
    toJSON: () => ({}),
  });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });
  Object.defineProperty(ruler, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(ruler, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
  fireEvent.pointerDown(ruler, { button: 0, clientX: 220, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(ruler, { button: 0, clientX: 220, clientY: 20, pointerId: 1 });
  expect(screen.getByTestId('msa-selection-readout')).toBeTruthy();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer comparison correctness', () => {
  it.each([
    { label: 'trailing uncovered gap', reference: 'T', row: '-', covered: false, outcome: 'uncovered' },
    { label: 'leading uncovered gap', reference: 'A', row: '-', covered: false, outcome: 'uncovered' },
    { label: 'internal deletion', reference: 'C', row: '-', covered: true, outcome: 'deletion' },
    { label: 'substitution', reference: 'C', row: 'T', covered: true, outcome: 'substitution' },
    { label: 'exact match', reference: 'C', row: 'C', covered: true, outcome: 'match' },
    { label: 'insertion', reference: '-', row: 'T', covered: true, outcome: 'insertion' },
    { label: 'both-gap padding', reference: '-', row: '-', covered: false, outcome: 'gap' },
  ])('classifies $label', ({ reference, row, covered, outcome }) => {
    expect(classifyMsaCell(reference, row, covered)).toBe(outcome);
  });

  it('keeps a trailing uncovered gap neutral across grid, stats, navigation, and overview', () => {
    const alignment = alignmentWithRows('trailing-gap', [
      { id: 'reference', name: 'Reference', aligned: 'ACGT' },
      { id: 'partial', name: 'Partial', aligned: 'ACG-' },
    ]);

    expect(pairwiseRowStats('ACG-', 'ACGT')).toEqual({
      ungappedLength: 3,
      comparableColumns: 3,
      mismatches: 0,
      identity: 100,
    });
    expect(differenceColumns(alignment, 'reference')).toEqual([]);
    expect(mismatchOverviewBins(alignment, 'reference', 4)).toEqual([0, 0, 0, 0]);

    renderViewer(alignment, {
      ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
      shadeMode: 'mismatch',
    });
    const partialRow = document.querySelector<HTMLElement>('[data-msa-row-id="partial"]');
    const terminalCell = partialRow?.querySelector<HTMLElement>('[data-alignment-column="4"]');
    expect(partialRow?.getAttribute('aria-label')).toContain('0 mismatches');
    expect(partialRow?.getAttribute('aria-label')).toContain('100.0 percent identity');
    expect(terminalCell?.dataset.cellOutcome).toBe('uncovered');
    expect(terminalCell?.hasAttribute('data-difference')).toBe(false);
    expect(screen.getByTestId('msa-stats-bar').textContent).toContain('0 differences in overlap');
    expect(screen.getByText('0 differences')).toBeTruthy();
    expect((screen.getByLabelText('Next variable column') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('msa-overview')
      .querySelector('.motif-cs-msa-overview-mismatches')?.getAttribute('d')).toBe('');
  });

  it('keeps an internal deletion counted across grid, stats, navigation, and overview', () => {
    const alignment = alignmentWithRows('internal-gap', [
      { id: 'reference', name: 'Reference', aligned: 'ACGT' },
      { id: 'deletion', name: 'Deletion', aligned: 'A-GT' },
    ]);

    expect(pairwiseRowStats('A-GT', 'ACGT')).toMatchObject({ comparableColumns: 4, mismatches: 1, identity: 75 });
    expect(differenceColumns(alignment, 'reference')).toEqual([1]);
    expect(mismatchOverviewBins(alignment, 'reference', 4)).toEqual([0, 1, 0, 0]);

    renderViewer(alignment, {
      ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
      shadeMode: 'mismatch',
    });
    const deletionRow = document.querySelector<HTMLElement>('[data-msa-row-id="deletion"]');
    const deletionCell = deletionRow?.querySelector<HTMLElement>('[data-alignment-column="2"]');
    expect(deletionRow?.getAttribute('aria-label')).toContain('1 mismatches');
    expect(deletionCell?.dataset.cellOutcome).toBe('deletion');
    expect(deletionCell?.hasAttribute('data-difference')).toBe(true);
    expect(screen.getByTestId('msa-stats-bar').textContent).toContain('1 differences in overlap');
    expect(screen.getByText('1 differences')).toBeTruthy();
    expect((screen.getByLabelText('Next variable column') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('msa-overview')
      .querySelector('.motif-cs-msa-overview-mismatches')?.getAttribute('d')).toContain('M1 22V2H2V22Z');
  });

  it('shows comparison statistics as unavailable for a single row', () => {
    renderViewer(singleRowAlignment());
    expectComparisonUnavailable();
  });

  it('shows comparison statistics as unavailable when other rows have no overlap', () => {
    renderViewer(alignmentWithRows('non-overlapping', [
      { id: 'reference', name: 'Reference', aligned: 'AAAA----' },
      { id: 'other', name: 'Other', aligned: '----TTTT' },
    ]));
    expectComparisonUnavailable();
  });

  it('excludes the reference row from overview mismatch density', () => {
    renderViewer(alignmentWithRows('overview-density', [
      { id: 'reference', name: 'Reference', aligned: 'AAAA' },
      { id: 'mismatch', name: 'Mismatch', aligned: 'TAAA' },
      { id: 'match', name: 'Match', aligned: 'AAAA' },
    ]));
    const mismatchPath = screen.getByTestId('msa-overview')
      .querySelector<SVGPathElement>('.motif-cs-msa-overview-mismatches');
    expect(mismatchPath?.getAttribute('d')).toContain('M0 22V12H1V22Z');
  });
});

describe('ClaudeScienceMsaViewer selection interactions', () => {
  const alignment = alignmentWithRows('selection-interactions', [
    { id: 'reference', name: 'Reference', aligned: 'ACGT' },
    { id: 'second', name: 'Second', aligned: 'ACGA' },
    { id: 'third', name: 'Third', aligned: 'ACGG' },
  ]);

  it('preserves selection when a row grip is pressed and released without reordering', () => {
    renderViewer(alignment);
    selectFirstColumn();
    const grip = screen.getAllByTestId('msa-row-grip')[0];
    fireEvent.pointerDown(grip, { button: 0, pointerId: 2 });
    fireEvent.pointerUp(grip, { button: 0, pointerId: 2 });
    expect(screen.getByTestId('msa-selection-readout')).toBeTruthy();
    expect(screen.queryByTestId('msa-order-note')).toBeNull();
  });

  it('dismisses search before clearing selection on successive Escape presses', () => {
    renderViewer(alignment);
    selectFirstColumn();
    const search = screen.getByTestId('msa-search-input') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'AC' } });
    expect(search.value).toBe('AC');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(search.value).toBe('');
    expect(screen.getByTestId('msa-selection-readout')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('msa-selection-readout')).toBeNull();
  });
});
