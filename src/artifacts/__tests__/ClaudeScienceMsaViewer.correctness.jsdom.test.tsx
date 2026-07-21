/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceMsaViewer,
  ambiguousColumns,
  classifyMsaCell,
  differenceColumns,
  mismatchOverviewBins,
  parseReferenceCoordinateColumn,
  pairwiseRowStats,
  referenceCoordinateLabels,
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
  overrides: Partial<ClaudeScienceMsaViewerProps> = {},
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
    ...overrides,
  };
  return render(<ClaudeScienceMsaViewer {...props} />);
}

function ReferenceNumberingPersistenceHarness({ initialAlignment }: { initialAlignment: ArtifactAlignment }) {
  const [alignments, setAlignments] = useState<ArtifactAlignment[]>([initialAlignment]);
  const [activeAlignmentId, setActiveAlignmentId] = useState(initialAlignment.id);
  const saveAlignment = (next: ArtifactAlignment): ArtifactAlignment => {
    const saved = { ...next, id: `${initialAlignment.id}-saved-${alignments.length}` };
    setAlignments((current) => [...current, saved]);
    return saved;
  };
  return (
    <ClaudeScienceMsaViewer
      records={[]}
      alignments={alignments}
      activeAlignmentId={activeAlignmentId}
      viewPreferences={DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES}
      onActiveAlignmentChange={(alignmentId) => {
        if (alignmentId) setActiveAlignmentId(alignmentId);
      }}
      onViewPreferencesChange={() => {}}
      onSaveAlignment={saveAlignment}
      onUpdateAlignmentTemplate={() => null}
      onDeleteAlignment={() => {}}
      onImportRecords={async () => ({ records: [], message: '', tone: 'status' })}
      onCopy={async () => true}
      onDownload={() => {}}
    />
  );
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
  // Aim at the centre of the first residue column using the geometry the frame
  // actually rendered, so resizing the row-label gutter or the cells cannot
  // silently move this click into a different column.
  const { cellWidth, labelWidth } = matrixGeometry();
  const rulerX = labelWidth + (cellWidth / 2);
  fireEvent.pointerDown(ruler, { button: 0, clientX: rulerX, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(ruler, { button: 0, clientX: rulerX, clientY: 20, pointerId: 1 });
  expect(screen.getByTestId('msa-selection-readout')).toBeTruthy();
}

function alignmentCell(column: number, rowId = 'reference'): HTMLElement {
  const cell = screen.getByTestId('msa-alignment-view').querySelector<HTMLElement>(
    `[data-msa-row-id="${rowId}"] [data-alignment-column="${column + 1}"]`,
  );
  if (!cell) throw new Error(`Expected alignment cell ${rowId}:${column + 1}.`);
  return cell;
}

function selectColumnRangeWithKeyboard(startColumn: number, visibleSteps: number): void {
  const start = alignmentCell(startColumn);
  fireEvent.focus(start);
  if (visibleSteps === 0) fireEvent.keyDown(start, { key: ' ' });
  else {
    for (let step = 0; step < visibleSteps; step += 1) {
      fireEvent.keyDown(start, { key: 'ArrowRight', shiftKey: true });
    }
  }
}

function matrixGeometry(): { cellWidth: number; labelWidth: number } {
  const frame = screen.getByTestId('msa-alignment-view');
  return {
    cellWidth: Number.parseFloat(frame.style.getPropertyValue('--motif-cs-msa-cell-width')),
    labelWidth: Number.parseFloat(frame.style.getPropertyValue('--motif-cs-msa-label-width')),
  };
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
      ambiguities: 0,
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
    expect(screen.getByTestId('msa-stats-bar').textContent).toContain('0 columns differ from template');
    expect(screen.getByText('Difference — of 0')).toBeTruthy();
    expect((screen.getByLabelText('Next variable column') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('msa-overview')
      .querySelector('.motif-cs-msa-overview-mismatches')?.getAttribute('d')).toBe('');
  });

  it('names the population the stats bar counts, which is not the overlap', () => {
    // Regression: the count was labelled "differences in overlap" while counting
    // internal indels, which are by definition not overlap. This fixture has NO
    // substitution anywhere — every difference is a gap facing a residue — so the
    // count and the word are forced apart, which a fixture with mismatches in it
    // could not do.
    const alignment = alignmentWithRows('gap-only-differences', [
      { id: 'reference', name: 'Reference', aligned: 'ACGTACGTAC' },
      { id: 'identical', name: 'Identical', aligned: 'ACGTACGTAC' },
      { id: 'gapped', name: 'Gapped', aligned: 'ACG---GTAC' },
    ]);
    // Independently: columns 3, 4 and 5 have a residue in the template and a gap
    // in one row; no column has two residues that disagree.
    expect(differenceColumns(alignment, 'reference')).toEqual([3, 4, 5]);

    renderViewer(alignment);
    const bar = screen.getByTestId('msa-stats-bar');
    expect(bar.textContent).toContain('3 columns differ from template');
    // The number is right; the old label was not. Pin the claim, not the phrasing:
    // nothing in this bar may call an indel column part of an overlap.
    expect(bar.textContent).not.toMatch(/overlap/i);
    // The average beside it uses the same rule, so the two cannot drift apart:
    // each row scores over the template's span with the indel columns comparable
    // — 100% for the identical row and 7/10 for the gapped one.
    expect(bar.textContent).toContain('85.0% avg to template');
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
    expect(screen.getByTestId('msa-stats-bar').textContent).toContain('1 columns differ from template');
    expect(screen.getByText('Difference — of 1')).toBeTruthy();
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

describe('ClaudeScienceMsaViewer IUPAC-aware differences', () => {
  it.each([
    { reference: 'A', row: 'A', molecule: 'dna' as const, outcome: 'match' },
    { reference: 'A', row: 'C', molecule: 'dna' as const, outcome: 'substitution' },
    { reference: 'R', row: 'A', molecule: 'dna' as const, outcome: 'ambiguous' },
    { reference: 'Y', row: 'A', molecule: 'dna' as const, outcome: 'substitution' },
    { reference: 'N', row: 'N', molecule: 'dna' as const, outcome: 'ambiguous' },
    { reference: 'T', row: 'U', molecule: 'dna' as const, outcome: 'match' },
    { reference: 'B', row: 'D', molecule: 'protein' as const, outcome: 'ambiguous' },
    { reference: 'B', row: 'Q', molecule: 'protein' as const, outcome: 'substitution' },
    { reference: 'X', row: '*', molecule: 'protein' as const, outcome: 'substitution' },
    { reference: '?', row: 'A', molecule: 'dna' as const, outcome: 'ambiguous' },
  ])('classifies $reference versus $row as $outcome', ({ reference, row, molecule, outcome }) => {
    expect(classifyMsaCell(reference, row, true, molecule)).toBe(outcome);
  });

  it('keeps gaps structural and makes strict mode use literal equality', () => {
    expect(classifyMsaCell('N', '-', true, 'dna')).toBe('deletion');
    expect(classifyMsaCell('-', 'N', true, 'dna')).toBe('insertion');
    expect(classifyMsaCell('R', 'A', true, 'dna', true)).toBe('substitution');
    expect(classifyMsaCell('N', 'N', true, 'dna', true)).toBe('match');
  });

  it('separates hard differences from compatible-only columns', () => {
    const alignment = alignmentWithRows('iupac-columns', [
      { id: 'reference', name: 'Reference', aligned: 'ACGT' },
      { id: 'ambiguous', name: 'Ambiguous', aligned: 'RCGT' },
      { id: 'hard', name: 'Hard', aligned: 'ACGA' },
    ]);
    expect(differenceColumns(alignment, 'reference')).toEqual([3]);
    expect(ambiguousColumns(alignment, 'reference')).toEqual([0]);
    expect(differenceColumns(alignment, 'reference', true)).toEqual([0, 3]);
    expect(ambiguousColumns(alignment, 'reference', true)).toEqual([]);
  });

  it('keeps compatible calls in density and identity denominators without counting mismatches', () => {
    const alignment = alignmentWithRows('iupac-overview', [
      { id: 'reference', name: 'Reference', aligned: 'AA' },
      { id: 'hard', name: 'Hard', aligned: 'CA' },
      { id: 'compatible', name: 'Compatible', aligned: 'RA' },
    ]);
    expect(mismatchOverviewBins(alignment, 'reference', 2)).toEqual([0.5, 0]);
    expect(mismatchOverviewBins(alignment, 'reference', 2, true)).toEqual([1, 0]);
    expect(pairwiseRowStats('RCGT', 'ACGT', 'dna')).toEqual({
      ungappedLength: 4,
      comparableColumns: 4,
      mismatches: 0,
      ambiguities: 1,
      identity: 75,
    });
  });

  it('renders and counts compatible calls separately, then folds them under strict mode', () => {
    const alignment = alignmentWithRows('iupac-render', [
      { id: 'reference', name: 'Reference', aligned: 'ACGT' },
      { id: 'read', name: 'Read', aligned: 'RCGT' },
    ]);
    const defaultView = renderViewer(alignment);
    let cell = document.querySelector<HTMLElement>('[data-msa-row-id="read"] [data-alignment-column="1"]');
    expect(cell?.dataset.cellOutcome).toBe('ambiguous');
    expect(cell?.hasAttribute('data-difference')).toBe(false);
    expect(screen.getByTestId('msa-stats-bar').textContent).toContain('0 columns differ from template');
    expect(screen.getByTestId('msa-ambiguous-count').textContent).toContain('1 compatible');
    defaultView.unmount();

    renderViewer(alignment, { ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, strictDifferences: true });
    cell = document.querySelector<HTMLElement>('[data-msa-row-id="read"] [data-alignment-column="1"]');
    expect(cell?.dataset.cellOutcome).toBe('substitution');
    expect(cell?.hasAttribute('data-difference')).toBe(true);
    expect(screen.queryByTestId('msa-ambiguous-count')).toBeNull();
  });
});

describe('ClaudeScienceMsaViewer reference coordinates', () => {
  it('labels residues and insertion columns from a pinned starting position', () => {
    const coordinates = referenceCoordinateLabels('--AC--G-A', 100);
    expect(coordinates.map((coordinate) => coordinate.label)).toEqual([
      '99A', '99B', '100', '101', '101A', '101B', '102', '102A', '103',
    ]);
    const longInsertion = referenceCoordinateLabels(`A${'-'.repeat(28)}C`, 7);
    expect(longInsertion[26].label).toBe('7Z');
    expect(longInsertion[27].label).toBe('7AA');
    expect(longInsertion[28].label).toBe('7AB');
    expect(longInsertion[29].label).toBe('8');

    const carry = referenceCoordinateLabels(`A${'-'.repeat(703)}C`, 100);
    expect(carry[702]).toEqual({ referencePosition: 100, insertionCode: 'ZZ', label: '100ZZ' });
    expect(carry[703]).toEqual({ referencePosition: 100, insertionCode: 'AAA', label: '100AAA' });
  });

  it('maps case-insensitive display coordinates back to alignment columns', () => {
    const coordinates = referenceCoordinateLabels('AC--GT', 100);
    expect(parseReferenceCoordinateColumn('100', coordinates)).toBe(0);
    expect(parseReferenceCoordinateColumn('101a', coordinates)).toBe(2);
    expect(parseReferenceCoordinateColumn('101B', coordinates)).toBe(3);
    for (const invalid of ['101C', '101 A', 'A101', '101.5', '101A2', '-1', '', '999']) {
      expect(parseReferenceCoordinateColumn(invalid, coordinates)).toBeNull();
    }
    const leading = referenceCoordinateLabels('-A', 1);
    expect(parseReferenceCoordinateColumn('0A', leading)).toBe(0);
  });

  it('renders a reference axis and accepts insertion-code coordinate jumps', () => {
    const alignment = normalizeArtifactAlignment({
      id: 'reference-axis',
      name: 'reference-axis',
      molecule: 'dna',
      referenceRowId: 'reference',
      referenceNumbering: { rowId: 'reference', firstResiduePosition: 100 },
      rows: [
        { id: 'reference', name: 'Reference', aligned: 'AC--GT' },
        { id: 'read', name: 'Read', aligned: 'ACTTGT' },
      ],
    });
    renderViewer(alignment);

    expect(screen.getByRole('row', { name: 'Reference positions for Reference' })).toBeTruthy();
    expect(document.querySelector('[data-reference-coordinate="101A"]')).toBeTruthy();
    const coordinateSystem = screen.getByTestId('msa-coordinate-system') as HTMLSelectElement;
    fireEvent.change(coordinateSystem, { target: { value: 'template' } });
    const input = screen.getByTestId('msa-coordinate-input') as HTMLInputElement;
    const viewport = screen.getByTestId('msa-alignment-view').querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll');
    if (!viewport) throw new Error('Expected the alignment viewport.');
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: vi.fn() });
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('101 or 101A');
    fireEvent.change(input, { target: { value: '101a' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('saves reference numbering as a new result without changing the comparison row', () => {
    const alignment = alignmentWithRows('reference-editor', [
      { id: 'comparison', name: 'Comparison', aligned: 'ACGT' },
      { id: 'numbering', name: 'Numbering', aligned: 'A-GT' },
    ]);
    const onSaveAlignment = vi.fn((next: ArtifactAlignment) => ({ ...next, id: 'numbered-result' }));
    const onActiveAlignmentChange = vi.fn();
    renderViewer(alignment, DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, {
      onSaveAlignment,
      onActiveAlignmentChange,
    });

    fireEvent.click(screen.getByTestId('msa-view-menu-button'));
    fireEvent.change(screen.getByLabelText('Numbering reference row'), { target: { value: 'numbering' } });
    fireEvent.change(screen.getByTestId('msa-reference-numbering-position'), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('msa-apply-reference-numbering'));

    expect(onSaveAlignment).toHaveBeenCalledWith(expect.objectContaining({
      referenceRowId: 'comparison',
      referenceNumbering: { rowId: 'numbering', firstResiduePosition: 500 },
    }));
    expect(onActiveAlignmentChange).toHaveBeenCalledWith('numbered-result');
  });

  it('clears numbering by saving a result without the metadata', () => {
    const alignment = normalizeArtifactAlignment({
      id: 'clear-reference-numbering',
      name: 'Clear reference numbering',
      molecule: 'dna',
      referenceRowId: 'reference',
      referenceNumbering: { rowId: 'reference', firstResiduePosition: 100 },
      rows: [
        { id: 'reference', name: 'Reference', aligned: 'A-C' },
        { id: 'second', name: 'Second', aligned: 'ATC' },
      ],
    });
    const onSaveAlignment = vi.fn((next: ArtifactAlignment) => ({ ...next, id: 'plain-result' }));
    renderViewer(alignment, DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, { onSaveAlignment });

    fireEvent.click(screen.getByTestId('msa-view-menu-button'));
    const clear = screen.getByTestId('msa-clear-reference-numbering') as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);
    expect(onSaveAlignment).toHaveBeenCalledTimes(1);
    expect(onSaveAlignment.mock.calls[0][0]).not.toHaveProperty('referenceNumbering');
  });

  it('opens saved numbered and plain results while preserving status', async () => {
    const alignment = alignmentWithRows('reference-numbering-persistence', [
      { id: 'reference', name: 'Reference', aligned: 'A-C' },
      { id: 'second', name: 'Second', aligned: 'ATC' },
    ]);
    render(<ReferenceNumberingPersistenceHarness initialAlignment={alignment} />);

    fireEvent.click(screen.getByTestId('msa-view-menu-button'));
    fireEvent.change(screen.getByTestId('msa-reference-numbering-position'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('msa-apply-reference-numbering'));
    await waitFor(() => expect(screen.getByRole('row', { name: 'Reference positions for Reference' })).toBeTruthy());
    expect(screen.getByTestId('msa-reference-numbering-editor').textContent).toContain('saved as a new session result');

    fireEvent.click(screen.getByTestId('msa-clear-reference-numbering'));
    await waitFor(() => expect(screen.getByRole('row', { name: 'Template positions for Reference' })).toBeTruthy());
    expect(screen.getByTestId('msa-reference-numbering-editor').textContent).toContain('Plain 1-based');
  });

  it('keeps one result per numbering state instead of forking on every click', async () => {
    // Regression: both buttons saved unconditionally, so "Use plain 1-based" was
    // a third result rather than a way back to the first. Three round trips left
    // seven results. One round trip would not have caught it — the count has to
    // be watched across several.
    const alignment = alignmentWithRows('reference-numbering-cycle', [
      { id: 'reference', name: 'Reference', aligned: 'A-C' },
      { id: 'second', name: 'Second', aligned: 'ATC' },
    ]);
    render(<ReferenceNumberingPersistenceHarness initialAlignment={alignment} />);
    fireEvent.click(screen.getByTestId('msa-view-menu-button'));
    fireEvent.change(screen.getByTestId('msa-reference-numbering-position'), { target: { value: '100' } });

    const savedResultCount = () => {
      const picker = document.querySelector('.motif-cs-msa-alignment-picker select');
      if (!picker) throw new Error('the alignment picker is absent — the count below would measure nothing');
      return picker.querySelectorAll('option').length;
    };
    const numberingIsOn = () => screen.getByTestId('msa-reference-numbering-editor').getAttribute('data-active') === 'true';

    fireEvent.click(screen.getByTestId('msa-apply-reference-numbering'));
    await waitFor(() => expect(numberingIsOn()).toBe(true));
    expect(savedResultCount()).toBe(2);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      fireEvent.click(screen.getByTestId('msa-clear-reference-numbering'));
      await waitFor(() => expect(numberingIsOn()).toBe(false));
      expect(savedResultCount()).toBe(2);

      // Opening the plain result resets the editor to its defaults, so ask for
      // the same numbering again the way a user toggling between the two would.
      fireEvent.change(screen.getByTestId('msa-reference-numbering-position'), { target: { value: '100' } });
      fireEvent.click(screen.getByTestId('msa-apply-reference-numbering'));
      await waitFor(() => expect(numberingIsOn()).toBe(true));
      expect(savedResultCount()).toBe(2);
    }
  });

  it('does not reuse a numbering result from a provenance-distinct alignment', () => {
    const alignment = {
      ...alignmentWithRows('reference-numbering-provenance', [
        { id: 'reference', name: 'Reference', aligned: 'A-C' },
        { id: 'second', name: 'Second', aligned: 'ATC' },
      ]),
      outputSha256: 'a'.repeat(64),
    };
    const foreignNumbered = {
      ...alignment,
      id: 'foreign-numbered-result',
      name: 'Foreign numbered result',
      outputSha256: 'b'.repeat(64),
      referenceNumbering: { rowId: 'reference', firstResiduePosition: 100 },
    };
    const onSaveAlignment = vi.fn((next: ArtifactAlignment) => ({ ...next, id: 'new-numbered-result' }));
    const onActiveAlignmentChange = vi.fn();
    renderViewer(alignment, DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, {
      alignments: [alignment, foreignNumbered],
      onSaveAlignment,
      onActiveAlignmentChange,
    });

    fireEvent.click(screen.getByTestId('msa-view-menu-button'));
    fireEvent.change(screen.getByTestId('msa-reference-numbering-position'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('msa-apply-reference-numbering'));

    expect(onSaveAlignment).toHaveBeenCalledTimes(1);
    expect(onActiveAlignmentChange).toHaveBeenCalledWith('new-numbered-result');
    expect(onActiveAlignmentChange).not.toHaveBeenCalledWith('foreign-numbered-result');
  });
});

describe('ClaudeScienceMsaViewer selection interactions', () => {
  const alignment = alignmentWithRows('selection-interactions', [
    { id: 'reference', name: 'Reference', aligned: 'ACGT' },
    { id: 'second', name: 'Second', aligned: 'ACGA' },
    { id: 'third', name: 'Third', aligned: 'ACGG' },
  ]);

  it('defers pointer-drag statistics until settle while keeping coordinates live', () => {
    renderViewer(alignment);
    const view = screen.getByTestId('msa-alignment-view');
    const viewport = view.querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll');
    const referenceRow = view.querySelector<HTMLElement>('[data-msa-row-id="reference"]');
    const thirdRow = view.querySelector<HTMLElement>('[data-msa-row-id="third"]');
    if (!viewport || !referenceRow || !thirdRow) throw new Error('Expected matrix pointer targets.');
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
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn((_clientX: number, clientY: number) => (clientY < 120 ? referenceRow : thirdRow)),
    });
    Object.defineProperty(viewport, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(viewport, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
    const { cellWidth, labelWidth } = matrixGeometry();
    const columnX = (column: number) => labelWidth + ((column + 0.5) * cellWidth);

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: columnX(0), clientY: 90, pointerId: 8 });
    expect(screen.getByTestId('msa-selection-readout').textContent).toContain('cols 1–1 (1)');
    expect(screen.getByTestId('msa-selection-variable').textContent).toBe('· … variable');
    expect(screen.getByTestId('msa-selection-identity').textContent).toBe('· … mean id');

    fireEvent.pointerMove(viewport, { buttons: 1, clientX: columnX(1), clientY: 150, pointerId: 8 });
    expect(screen.getByTestId('msa-selection-readout').textContent).toContain('cols 1–2 (2)· template 1–2· 3 rows');
    expect(screen.getByTestId('msa-selection-variable').textContent).toBe('· … variable');

    fireEvent.pointerMove(viewport, { buttons: 1, clientX: columnX(3), clientY: 150, pointerId: 8 });
    expect(screen.getByTestId('msa-selection-readout').textContent).toContain('cols 1–4 (4)· template 1–4· 3 rows');
    expect(screen.getByTestId('msa-selection-identity').textContent).toBe('· … mean id');

    fireEvent.pointerUp(viewport, { button: 0, clientX: columnX(3), clientY: 150, pointerId: 8 });
    expect(screen.getByTestId('msa-selection-variable').textContent).toBe('· 1 variable');
    expect(screen.getByTestId('msa-selection-identity').textContent).toBe('· 83% mean id');
  });

  it('shows complete settled statistics immediately for keyboard selection', () => {
    renderViewer(alignment);
    selectColumnRangeWithKeyboard(1, 1);

    expect(screen.queryByText('· … variable')).toBeNull();
    expect(screen.getByTestId('msa-selection-readout').textContent).toBe(
      'Selectedcols 2–3 (2)· template 2–3· 1 row· 0 variable· 100% mean idClear',
    );
  });

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

  it('strips a shared prefix from every row even when the rows disagree about its case', () => {
    // The prefix is picked by a case-insensitive comparison. If it is then
    // stripped case-sensitively, the one row spelling it differently keeps its
    // full name while its siblings lose theirs — and it is the long one a narrow
    // control truncates. Mixed-case accession and chromosome prefixes are the
    // realistic source ("Chr1_" beside "chr1_", "sp|" beside "SP|").
    renderViewer(alignmentWithRows('mixed-case-prefix', [
      { id: 'a', name: 'PAL_Prunus_avium', aligned: 'ACGT' },
      { id: 'b', name: 'pal_Pisum_sativum', aligned: 'ACGA' },
      { id: 'c', name: 'PAL_Zea_mays', aligned: 'ACGC' },
    ]));

    const compare = screen.getByLabelText('Compare against') as HTMLSelectElement;
    const labels = [...compare.options].map((option) => option.textContent ?? '');
    expect(labels).toContain('Prunus_avium');
    expect(labels).toContain('Zea_mays');
    expect(labels).toContain('Pisum_sativum');
    // No option may still be carrying the shared prefix in any casing.
    expect(labels.filter((label) => /^pal[\s_./-]/i.test(label))).toEqual([]);
  });
});
