/** @vitest-environment jsdom */

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer, differenceStops, type ClaudeScienceMsaViewerProps } from '../ClaudeScienceMsaViewer';
import { computeMsaVariants, groupMsaVariantRuns } from '../claude-science-msa-variants';
import { normalizeArtifactAlignment, type ArtifactAlignment } from '../claude-science-msa';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  type ClaudeScienceMsaViewPreferences,
} from '../claude-science-msa-view-preferences';

function alignment(
  id: string,
  reference: string,
  observed: string,
  templateName = 'ref',
): ArtifactAlignment {
  return normalizeArtifactAlignment({
    id,
    name: id,
    molecule: 'dna',
    referenceRowId: 'reference',
    rows: [
      { id: 'reference', name: templateName, aligned: reference },
      { id: 'observed', name: 'variant alpha', aligned: observed },
    ],
  });
}

function StatefulViewer({
  sourceAlignment,
  initialPreferences = DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
}: {
  sourceAlignment: ArtifactAlignment;
  initialPreferences?: ClaudeScienceMsaViewPreferences;
}) {
  const [viewPreferences, setViewPreferences] = useState(initialPreferences);
  const props: ClaudeScienceMsaViewerProps = {
    records: [],
    alignments: [sourceAlignment],
    activeAlignmentId: sourceAlignment.id,
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

function absoluteCell(column: number): HTMLElement {
  const cell = document.querySelector<HTMLElement>(
    `[data-msa-row-id="observed"] [data-alignment-column="${column + 1}"]`,
  );
  if (!cell) throw new Error(`Missing observed cell at absolute column ${column}`);
  return cell;
}

async function expectGridCursor(column: number): Promise<HTMLElement> {
  const cell = absoluteCell(column);
  const grid = screen.getByRole('grid', { name: /^Alignment matrix,/ });
  await waitFor(() => expect(document.activeElement).toBe(grid));
  expect(grid.getAttribute('aria-activedescendant')).toBe(cell.id);
  return cell;
}

function changedSequence(length: number, columns: readonly number[]): string {
  const sequence = Array.from({ length }, () => 'A');
  for (const column of columns) sequence[column] = 'T';
  return sequence.join('');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer differences list', () => {
  it('opens over the matrix and presents the biological variant table', () => {
    render(<StatefulViewer sourceAlignment={alignment('variant-table', 'AC-GTA', 'ATAG-A')} />);

    const toggle = screen.getByTestId('msa-differences-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const pane = screen.getByTestId('msa-differences-pane');
    expect(pane.parentElement).toBe(screen.getByTestId('msa-differences-stage'));
    expect(within(pane).getByRole('heading', { name: 'Differences from ref' })).toBeTruthy();
    expect(within(pane).getAllByTestId('msa-difference-row')).toHaveLength(3);
    expect(within(pane).getByRole('columnheader', { name: 'Variant' })).toBeTruthy();
    expect(within(pane).getByRole('columnheader', { name: 'Row' })).toBeTruthy();
    expect(within(pane).getByRole('columnheader', { name: 'Type' })).toBeTruthy();
    expect(within(pane).getByRole('columnheader', { name: 'Template → observed' })).toBeTruthy();
    expect(within(pane).getByRole('columnheader', { name: 'Alignment column' })).toBeTruthy();
    expect(within(pane).getByText('C2T')).toBeTruthy();
    expect(within(pane).getAllByText('variant alpha')).toHaveLength(3);
    expect(within(pane).getByText('substitution')).toBeTruthy();
    expect(within(pane).getByText('C → T')).toBeTruthy();
  });

  it('tells the rows apart when their names share a head', () => {
    // The Row column is 245px. Rendering the raw name put the same 43 visible
    // characters in every row of the table and cut all five clone letters, so
    // the one column that answers "which row" answered nothing. The gutter and
    // the template picker already drop the shared head; the pane now does too.
    const shared = 'Synthetic reference sequence with a deliberately long shared row-name prefix clone';
    render(<StatefulViewer sourceAlignment={normalizeArtifactAlignment({
      id: 'shared-head',
      name: 'shared-head',
      molecule: 'dna',
      referenceRowId: 'reference',
      rows: [
        { id: 'reference', name: `${shared} A`, aligned: 'ACGTA' },
        { id: 'observed', name: `${shared} B`, aligned: 'ATGTA' },
      ],
    })} />);

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    const pane = screen.getByTestId('msa-differences-pane');
    const cell = within(pane).getAllByTestId('msa-difference-row')[0]
      .querySelector<HTMLElement>('td[title]');

    expect(cell?.textContent).toBe('B');
    // The whole name stays one hover away.
    expect(cell?.getAttribute('title')).toBe(`${shared} B`);
  });

  it('returns focus to the Differences toggle when Close shuts the pane', () => {
    render(<StatefulViewer sourceAlignment={alignment('variant-close-focus', 'ACGTA', 'ATGTA')} />);
    const toggle = screen.getByTestId('msa-differences-toggle');
    fireEvent.click(toggle);
    const close = screen.getByTestId('msa-differences-close');
    close.focus();
    fireEvent.click(close);
    expect(screen.queryByTestId('msa-differences-pane')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('msa-differences-toggle'));
  });

  it('uses click, Enter, and Space to focus the grid at the stored absolute matrix cell', async () => {
    render(<StatefulViewer sourceAlignment={alignment('variant-keyboard', 'AC-GTA', 'ATAG-A')} />);

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    fireEvent.click(screen.getByRole('row', { name: /Jump to 2\^3ins .* alignment column 3/ }));
    expect((await expectGridCursor(2)).getAttribute('data-jump')).toBe('true');
    // The list is docked under the rows, so it stays open for the next entry.
    expect(screen.getByTestId('msa-differences-pane')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('row', { name: /Jump to C2T .* alignment column 2/ }), { key: 'Enter' });
    expect((await expectGridCursor(1)).getAttribute('data-jump')).toBe('true');

    fireEvent.keyDown(screen.getByRole('row', { name: /Jump to T4- .* alignment column 5/ }), { key: ' ' });
    expect((await expectGridCursor(4)).getAttribute('data-jump')).toBe('true');
  });

  it('does not translate an absolute variant column through a filtered window', async () => {
    render(<StatefulViewer
      sourceAlignment={alignment('variant-filtered', 'A'.repeat(30), changedSequence(30, [9, 24]))}
      initialPreferences={{
        ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
        columnFilter: 'differences',
        columnFilterContext: 1,
      }}
    />);

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    fireEvent.click(screen.getByRole('row', { name: /Jump to A25T .* alignment column 25/ }));
    expect((await expectGridCursor(24)).getAttribute('data-jump')).toBe('true');
  });

  it('copies and downloads the differences as TSV with full names, positions and columns', async () => {
    const onCopy = vi.fn(async () => true);
    const onDownload = vi.fn();
    const shared = 'Clone plate A well';
    // Row names cannot hold tabs or line breaks (normalization rejects them), so
    // the full name travels intact; the table itself shows only the suffix "B".
    const sourceAlignment = normalizeArtifactAlignment({
      id: 'tsv-export',
      name: 'Clone 3 check',
      molecule: 'dna',
      referenceRowId: 'reference',
      rows: [
        { id: 'reference', name: `${shared} ref`, aligned: 'AC-GTA' },
        { id: 'observed', name: `${shared} B`, aligned: 'ATAG-A' },
      ],
    });
    function Harness() {
      const [viewPreferences, setViewPreferences] = useState(DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES);
      return (
        <ClaudeScienceMsaViewer
          records={[]}
          alignments={[sourceAlignment]}
          activeAlignmentId={sourceAlignment.id}
          viewPreferences={viewPreferences}
          onActiveAlignmentChange={vi.fn()}
          onViewPreferencesChange={setViewPreferences}
          onSaveAlignment={(next) => next}
          onUpdateAlignmentTemplate={vi.fn()}
          onDeleteAlignment={vi.fn()}
          onImportRecords={async () => ({ records: [], message: '', tone: 'status' })}
          onCopy={onCopy}
          onDownload={onDownload}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    const expected = [
      'Variant\tRow\tType\tLength\tTemplate residue\tObserved residue\tTemplate position\tAlignment column\tAlignment end',
      `C2T\t${shared} B\tsubstitution\t1\tC\tT\t2\t2\t2`,
      `2^3ins\t${shared} B\tinsertion\t1\t-\tA\t\t3\t3`,
      `T4-\t${shared} B\tdeletion\t1\tT\t-\t4\t5\t5`,
    ].join('\n') + '\n';

    fireEvent.click(screen.getByTestId('msa-differences-copy-tsv'));
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('Differences TSV', expected));
    await waitFor(() => expect(screen.getByText('Copied the differences (3 bp) as TSV.')).toBeTruthy());

    fireEvent.click(screen.getByTestId('msa-differences-download-tsv'));
    expect(onDownload).toHaveBeenCalledWith('clone-3-check-differences.tsv', expected, 'text/tab-separated-values');
  });

  it('caps rendered rows, states the full total, and exports every difference', async () => {
    const onCopy = vi.fn<(label: string, text: string) => Promise<boolean>>(async () => true);
    const onDownload = vi.fn();
    const sourceAlignment = alignment('variant-limit', 'A'.repeat(502), `${'T'.repeat(500)}-T`);
    render(
      <ClaudeScienceMsaViewer
        records={[]}
        alignments={[sourceAlignment]}
        activeAlignmentId={sourceAlignment.id}
        viewPreferences={DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES}
        onActiveAlignmentChange={vi.fn()}
        onViewPreferencesChange={vi.fn()}
        onSaveAlignment={(next) => next}
        onUpdateAlignmentTemplate={vi.fn()}
        onDeleteAlignment={vi.fn()}
        onImportRecords={async () => ({ records: [], message: '', tone: 'status' })}
        onCopy={onCopy}
        onDownload={onDownload}
      />,
    );

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    const pane = screen.getByTestId('msa-differences-pane');
    expect(screen.getAllByTestId('msa-difference-row')).toHaveLength(500);
    expect(screen.getByTestId('msa-differences-limit').textContent).toBe(
      'Showing the first 500 rows. Copy TSV and Download TSV include all 502 differing bp.',
    );
    // The header counts every difference, including the one past the list.
    expect(within(pane).getByText('501 substitutions · 1 bp deleted')).toBeTruthy();

    fireEvent.click(screen.getByTestId('msa-differences-copy-tsv'));
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1));
    const copied = onCopy.mock.calls[0][1];
    const lines = copied.trimEnd().split('\n');
    expect(lines).toHaveLength(503);
    expect(lines[501]).toBe('A501-\tvariant alpha\tdeletion\t1\tA\t-\t501\t501\t501');
    expect(lines[502]).toBe('A502T\tvariant alpha\tsubstitution\t1\tA\tT\t502\t502\t502');
    await waitFor(() => expect(screen.getByText('Copied the differences (502 bp) as TSV.')).toBeTruthy());

    fireEvent.click(screen.getByTestId('msa-differences-download-tsv'));
    expect(onDownload).toHaveBeenCalledWith('variant-limit-differences.tsv', copied, 'text/tab-separated-values');
  });

  it('lists a multi-base deletion and insertion as one row each, consistent with the badge and the TSV', async () => {
    // Template ACGTCTCAGG--TTACCA against a row that loses CTC (template 5-7)
    // and gains GA, plus one substitution at template 14 (C -> G).
    const onCopy = vi.fn<(label: string, text: string) => Promise<boolean>>(async () => true);
    const sourceAlignment = normalizeArtifactAlignment({
      id: 'runs',
      name: 'runs',
      molecule: 'dna',
      referenceRowId: 'reference',
      rows: [
        { id: 'reference', name: 'ref', aligned: 'ACGTCTCAGG--TTACCA' },
        { id: 'observed', name: 'variant alpha', aligned: 'ACGT---AGGGATTAGCA' },
      ],
    });
    render(
      <ClaudeScienceMsaViewer
        records={[]}
        alignments={[sourceAlignment]}
        activeAlignmentId={sourceAlignment.id}
        viewPreferences={DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES}
        onActiveAlignmentChange={vi.fn()}
        onViewPreferencesChange={vi.fn()}
        onSaveAlignment={(next) => next}
        onUpdateAlignmentTemplate={vi.fn()}
        onDeleteAlignment={vi.fn()}
        onImportRecords={async () => ({ records: [], message: '', tone: 'status' })}
        onCopy={onCopy}
        onDownload={vi.fn()}
      />,
    );
    // The row badge counts differing cells: 3 deleted + 2 inserted + 1 substituted.
    expect([...document.querySelectorAll('.motif-cs-msa-row-stat-mismatch')].map((badge) => badge.textContent)).toContain('6Δ');
    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    const pane = screen.getByTestId('msa-differences-pane');
    const rows = within(pane).getAllByTestId('msa-difference-row').map((row) => (
      [...row.children].map((cell) => cell.textContent)
    ));
    expect(rows).toEqual([
      ['5–7del', 'variant alpha', 'deletion (3 bp)', 'CTC → ---', '5–7'],
      ['10^11ins', 'variant alpha', 'insertion (2 bp)', '-- → GA', '11–12'],
      ['C14G', 'variant alpha', 'substitution', 'C → G', '16'],
    ]);
    expect(within(pane).getByText('1 substitution · 2 bp inserted · 3 bp deleted')).toBeTruthy();

    fireEvent.click(screen.getByTestId('msa-differences-copy-tsv'));
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1));
    expect(onCopy.mock.calls[0][1].trimEnd().split('\n').slice(1)).toEqual([
      '5–7del\tvariant alpha\tdeletion\t3\tCTC\t---\t5\t5\t7',
      '10^11ins\tvariant alpha\tinsertion\t2\t--\tGA\t\t11\t12',
      'C14G\tvariant alpha\tsubstitution\t1\tC\tG\t14\t16\t16',
    ]);

    // A jump from the deletion row lands on its first cell.
    fireEvent.click(screen.getByRole('row', { name: /Jump to 5–7del .* alignment column 5/ }));
    expect((await expectGridCursor(4)).getAttribute('data-jump')).toBe('true');
  });

  it('steps the table rows, so a 3 bp deletion is one step and not three', () => {
    // Six differing cells (5-7 deleted, 11-12 inserted, 16 substituted) are
    // three table rows. The stepper read "of 6" while the table listed 3.
    render(<StatefulViewer sourceAlignment={alignment('run-steps', 'ACGTCTCAGG--TTACCA', 'ACGT---AGGGATTAGCA')} />);
    const counter = () => document.querySelector('.motif-cs-msa-difference-nav span')?.textContent;
    const jumped = () => [...document.querySelectorAll('[data-msa-row-id="observed"] [data-jump="true"]')]
      .map((cell) => cell.getAttribute('data-alignment-column'));
    expect(counter()).toBe('Difference 1 of 3');
    expect(jumped()).toEqual(['5']);
    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    expect(screen.getAllByTestId('msa-difference-row')).toHaveLength(3);

    fireEvent.keyDown(window, { key: 'n' });
    expect(counter()).toBe('Difference 2 of 3');
    expect(jumped()).toEqual(['11']);
    fireEvent.click(screen.getByLabelText('Next variable column'));
    expect(counter()).toBe('Difference 3 of 3');
    expect(jumped()).toEqual(['16']);
    fireEvent.keyDown(window, { key: 'n' });
    expect(counter()).toBe('Difference 1 of 3');
    expect(jumped()).toEqual(['5']);

    // A click on a table row sets the counter to that row, and the keys go on from it.
    fireEvent.click(screen.getByRole('row', { name: /Jump to 10\^11ins .* alignment column 11/ }));
    expect(counter()).toBe('Difference 2 of 3');
    fireEvent.keyDown(window, { key: 'n' });
    expect(counter()).toBe('Difference 3 of 3');
    fireEvent.keyDown(window, { key: 'p' });
    expect(counter()).toBe('Difference 2 of 3');
  });

  it('puts a stop where each table row starts, across rows', () => {
    // Row a loses T and A around a column where only row b inserts; the gap in
    // both a and the template there does not split a's deletion. Row a's two
    // adjacent substitutions stay two stops, as they stay two table rows.
    const sourceAlignment = normalizeArtifactAlignment({
      id: 'stops-across-rows',
      name: 'stops-across-rows',
      molecule: 'dna',
      referenceRowId: 'reference',
      rows: [
        { id: 'reference', name: 'ref', aligned: 'ACGT-ACGTAC' },
        { id: 'a', name: 'a', aligned: 'ACG---CGTTT' },
        { id: 'b', name: 'b', aligned: 'ACGTTACGTAC' },
      ],
    });
    const stops = differenceStops(sourceAlignment, 'reference');
    expect(stops).toEqual([
      { rowId: 'a', column: 3 },
      { rowId: 'b', column: 4 },
      { rowId: 'a', column: 9 },
      { rowId: 'a', column: 10 },
    ]);
    const runs = groupMsaVariantRuns(computeMsaVariants(sourceAlignment).variants, sourceAlignment);
    expect(runs.map(({ first }) => ({ rowId: first.rowId, column: first.column }))).toEqual(stops);
  });

  it.each([
    { strictDifferences: false, labels: ['T8A'], summary: '1 substitution', counter: 'Difference 1 of 1' },
    { strictDifferences: true, labels: ['G3N', 'T8A'], summary: '2 substitutions', counter: 'Difference 1 of 2' },
  ])('lists an N call in the table and the stepper alike (strict $strictDifferences)', ({ strictDifferences, labels, summary, counter }) => {
    // The grid marks N against G as compatible unless strict comparison is on.
    // The table listed it either way, so it read 2 rows beside "of 1".
    render(<StatefulViewer
      sourceAlignment={alignment('n-call', 'ACGTACGTAC', 'ACNTACGAAC')}
      initialPreferences={{ ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, strictDifferences }}
    />);
    expect(document.querySelector('.motif-cs-msa-difference-nav span')?.textContent).toBe(counter);
    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    const pane = screen.getByTestId('msa-differences-pane');
    expect(within(pane).getAllByTestId('msa-difference-row').map((row) => row.querySelector('th')?.textContent)).toEqual(labels);
    expect(within(pane).getByText(summary)).toBeTruthy();
  });

  it('centres a jumped-to deletion with columns on both sides, even while the scroll is smooth', async () => {
    // A browser aborts a smooth scroll when any other scroll lands on the same
    // box. Model that: smooth targets wait for finish(); a direct assignment or an
    // instant scrollTo drops them. The jumped row sits below the matrix's view.
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    render(<StatefulViewer sourceAlignment={alignment('variant-centred-jump', 'A'.repeat(400), `T${'A'.repeat(299)}---${'A'.repeat(97)}`)} />);
    const viewport = document.querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll')!;
    let left = 0;
    let top = 0;
    let smooth: ScrollToOptions | null = null;
    const scrolled = () => viewport.dispatchEvent(new Event('scroll'));
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => { smooth = null; left = value; } });
    Object.defineProperty(viewport, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { smooth = null; top = value; } });
    Object.defineProperty(viewport, 'scrollTo', {
      configurable: true,
      value: (options: ScrollToOptions) => {
        if (options.behavior === 'smooth') { smooth = options; return; }
        smooth = null;
        if (typeof options.left === 'number') left = options.left;
        if (typeof options.top === 'number') top = options.top;
        scrolled();
      },
    });
    const rect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function boundingRect(this: Element) {
      if (this === viewport) return { top: 0, bottom: 300, left: 0, right: 720, width: 720, height: 300 } as DOMRect;
      if (this.getAttribute('data-msa-row-id') === 'observed') {
        return { top: 600 - top, bottom: 620 - top, left: 0, right: 720, width: 720, height: 20 } as DOMRect;
      }
      return rect.call(this);
    });

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    act(() => { while (frames.length > 0) frames.shift()!(0); });
    fireEvent.click(screen.getByRole('row', { name: /Jump to 301–303del .* alignment column 301/ }));
    act(() => {
      const pending = smooth as ScrollToOptions | null;
      if (pending?.left !== undefined) { left = pending.left; scrolled(); }
      while (frames.length > 0) frames.shift()!(0);
    });
    await expectGridCursor(300);

    // Columns are numbered from 1 in the note; the deletion is 301-303.
    const [first, last] = (document.querySelector('.motif-cs-msa-window-note')?.textContent ?? '')
      .match(/Alignment columns ([\d,]+)–([\d,]+)/)!.slice(1).map((value) => Number(value.replace(/,/g, '')));
    expect(301 - first).toBeGreaterThanOrEqual(10);
    expect(last - 303).toBeGreaterThanOrEqual(10);
  });

  it('names the active template in the empty state', () => {
    render(<StatefulViewer sourceAlignment={alignment('variant-empty', 'ACGT', 'ACGT', 'ref')} />);
    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    expect(screen.getByText('No differences from ref')).toBeTruthy();
  });

  it('updates the variant pane and navigator when strict differences changes ambiguity semantics', async () => {
    render(<StatefulViewer sourceAlignment={alignment('variant-strict', 'CATG', 'CRTG', 'ref')} />);
    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    expect(screen.getByText('No differences from ref')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Strict differences' }));

    const pane = screen.getByTestId('msa-differences-pane');
    expect(within(pane).getAllByTestId('msa-difference-row')).toHaveLength(1);
    expect(within(pane).getByText('A2R')).toBeTruthy();
    await waitFor(() => expect(absoluteCell(1).getAttribute('data-jump')).toBe('true'));
    expect(screen.getByText('Difference 1 of 1')).toBeTruthy();
  });
});
