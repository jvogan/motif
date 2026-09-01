/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer, type ClaudeScienceMsaViewerProps } from '../ClaudeScienceMsaViewer';
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
    render(<StatefulViewer sourceAlignment={alignment('variant-table', 'AC-GT', 'ATAG-')} />);

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

  it('uses click, Enter, and Space to focus the grid at the stored absolute matrix cell', async () => {
    render(<StatefulViewer sourceAlignment={alignment('variant-keyboard', 'AC-GT', 'ATAG-')} />);

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    fireEvent.click(screen.getByRole('row', { name: /Jump to -3A .* alignment column 3/ }));
    expect((await expectGridCursor(2)).getAttribute('data-jump')).toBe('true');
    expect(screen.queryByTestId('msa-differences-pane')).toBeNull();

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    fireEvent.keyDown(screen.getByRole('row', { name: /Jump to C2T .* alignment column 2/ }), { key: 'Enter' });
    expect((await expectGridCursor(1)).getAttribute('data-jump')).toBe('true');

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
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

  it('caps rendered rows and states the retained number when more variants exist', () => {
    render(<StatefulViewer sourceAlignment={alignment(
      'variant-limit',
      'A'.repeat(501),
      'T'.repeat(501),
    )} />);

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    expect(screen.getAllByTestId('msa-difference-row')).toHaveLength(500);
    expect(screen.getByTestId('msa-differences-limit').textContent).toBe(
      'Showing 500 differences. More exist.',
    );
  });

  it('names the active template in the empty state', () => {
    render(<StatefulViewer sourceAlignment={alignment('variant-empty', 'ACGT', 'ACGT', 'ref')} />);
    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    expect(screen.getByText('No differences from ref')).toBeTruthy();
  });
});
