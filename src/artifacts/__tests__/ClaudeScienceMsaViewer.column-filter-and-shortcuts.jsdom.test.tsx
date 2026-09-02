/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer, type ClaudeScienceMsaViewerProps } from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment, type ArtifactAlignment } from '../claude-science-msa';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  type ClaudeScienceMsaViewPreferences,
} from '../claude-science-msa-view-preferences';

function changedSequence(length: number, columns: readonly number[]): string {
  const symbols = Array.from({ length }, () => 'A');
  for (const column of columns) symbols[column] = 'T';
  return symbols.join('');
}

function alignment(id: string, length = 30, columns: readonly number[] = [9, 24]): ArtifactAlignment {
  return normalizeArtifactAlignment({
    id,
    name: id,
    molecule: 'dna',
    referenceRowId: 'reference',
    rows: [
      { id: 'reference', name: 'KRAS reference', aligned: 'A'.repeat(length) },
      { id: 'g12d', name: 'KRAS G12D', aligned: changedSequence(length, columns) },
      { id: 'g13c', name: 'KRAS G13C', aligned: changedSequence(length, [columns[0]]) },
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

function gridColumns(rowId = 'g12d'): number[] {
  const row = document.querySelector<HTMLElement>(`[data-msa-row-id="${rowId}"]`);
  if (!row) throw new Error(`Missing row ${rowId}`);
  return Array.from(row.querySelectorAll<HTMLElement>('[data-msa-grid-cell="true"]'))
    .map((cell) => Number(cell.dataset.alignmentColumn));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer differing-column view', () => {
  it('renders context and elisions in visible space while keeping absolute grid coordinates', () => {
    render(<StatefulViewer
      sourceAlignment={alignment('column-filter-absolute')}
      initialPreferences={{
        ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
        columnFilter: 'differences',
        columnFilterContext: 3,
      }}
    />);

    expect(screen.getByTestId('msa-column-filter-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(gridColumns()).toEqual([7, 8, 9, 10, 11, 12, 13, 22, 23, 24, 25, 26, 27, 28]);
    const cells = document.querySelectorAll<HTMLElement>('[data-msa-row-id="g12d"] [data-msa-grid-cell="true"]');
    for (const cell of cells) {
      expect(cell.getAttribute('aria-colindex')).toBe(cell.dataset.alignmentColumn);
      expect(cell.getAttribute('aria-label')).toContain(`alignment column ${cell.dataset.alignmentColumn}`);
    }
    const absoluteCell = document.querySelector<HTMLElement>('[data-msa-row-id="g12d"] [data-alignment-column="10"]');
    if (!absoluteCell) throw new Error('Missing absolute column 10');
    fireEvent.focus(absoluteCell);
    fireEvent.keyDown(absoluteCell, { key: ' ' });
    expect(screen.getByTestId('msa-selection-readout').textContent).toContain('cols 10–10');
    fireEvent.click(within(screen.getByTestId('msa-selection-readout')).getByRole('button', { name: 'Clear' }));
    const middleElision = screen.getByRole('button', { name: '8 identical columns hidden. Show these columns.' });
    expect(middleElision.getAttribute('title')).toBe('8 identical columns hidden');
    expect(middleElision.textContent).toBe('⋯8⋯');

    fireEvent.click(middleElision);
    expect(gridColumns()).toEqual([
      7, 8, 9, 10, 11, 12, 13,
      14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26, 27, 28,
    ]);
    expect(screen.queryByRole('button', { name: '8 identical columns hidden. Show these columns.' })).toBeNull();
  });

  it('expands a hidden gap for an absolute go-to target', () => {
    render(<StatefulViewer
      sourceAlignment={alignment('column-filter-goto')}
      initialPreferences={{
        ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
        columnFilter: 'differences',
        columnFilterContext: 3,
      }}
    />);
    expect(gridColumns()).not.toContain(17);
    fireEvent.click(screen.getByTestId('msa-goto-menu-button'));
    fireEvent.change(screen.getByTestId('msa-coordinate-input'), { target: { value: '17' } });
    fireEvent.click(screen.getByRole('button', { name: /^Go$/ }));
    expect(gridColumns()).toContain(17);
    const target = document.querySelector<HTMLElement>('[data-msa-row-id="g12d"] [data-alignment-column="17"]');
    expect(target?.getAttribute('aria-colindex')).toBe('17');
  });
});

describe('ClaudeScienceMsaViewer proactive difference navigation', () => {
  it('lands on the first difference without moving focus', () => {
    render(<StatefulViewer sourceAlignment={alignment('first-difference', 30, [9, 24])} />);
    expect(screen.getByText('Difference 1 of 2')).toBeTruthy();
    expect(document.querySelector('[data-msa-row-id="g12d"] [data-alignment-column="10"]')?.getAttribute('data-jump')).toBe('true');
    expect(document.activeElement).toBe(document.body);
  });

  it('returns to the first difference when the comparison template changes', () => {
    render(<StatefulViewer sourceAlignment={alignment('template-first-difference', 30, [9, 24])} />);
    fireEvent.keyDown(window, { key: 'n' });
    expect(screen.getByText('Difference 2 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use KRAS G12D as template' }));
    expect(screen.getByText('Difference 1 of 2')).toBeTruthy();
    expect(document.querySelector('[data-msa-row-id="reference"] [data-alignment-column="10"]')?.getAttribute('data-jump')).toBe('true');
  });

  it('keeps the neutral stepper when reopening an alignment with a restored viewport', () => {
    const sourceAlignment = alignment('restored-difference', 30, [9, 24]);
    const first = render(<StatefulViewer sourceAlignment={sourceAlignment} />);
    const viewport = document.querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll');
    if (!viewport) throw new Error('Missing matrix viewport');
    viewport.scrollLeft = 42;
    fireEvent.scroll(viewport);
    first.unmount();

    render(<StatefulViewer sourceAlignment={sourceAlignment} />);
    expect(screen.getByText('Difference — of 2')).toBeTruthy();
  });
});

describe('ClaudeScienceMsaViewer row-name finding and shortcuts', () => {
  it('identifies row-name hits and activates the matching row', () => {
    render(<StatefulViewer sourceAlignment={alignment('row-name-search')} />);
    const input = screen.getByTestId('msa-search-input');
    expect(input.getAttribute('placeholder')).toBe('Find row or motif…');
    fireEvent.change(input, { target: { value: 'G13C' } });
    expect(screen.getByTestId('msa-search-count').textContent).toContain('1 row-name match');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('msa-search-count').textContent).toContain('1 of 1 · row name');
    expect(document.querySelector('[data-msa-row-id="g13c"]')?.getAttribute('data-search-name-active')).toBe('true');
  });

  it('handles difference and finder shortcuts while ignoring text and select targets', () => {
    render(<StatefulViewer sourceAlignment={alignment('keyboard-shortcuts')} />);
    fireEvent.keyDown(window, { key: 'n' });
    expect(screen.getByText('Difference 2 of 2')).toBeTruthy();

    const sort = screen.getByTestId('msa-row-sort-toolbar');
    sort.focus();
    fireEvent.keyDown(sort, { key: 'p' });
    expect(screen.getByText('Difference 2 of 2')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.getByText('Difference 1 of 2')).toBeTruthy();
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(screen.getByTestId('msa-search-input'));
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('msa-search-input'));
  });

  it('keeps promoted residue-colour and row-sort controls synchronized with View', () => {
    render(<StatefulViewer sourceAlignment={alignment('promoted-controls')} />);
    fireEvent.click(screen.getByTestId('msa-residue-colors-toolbar'));
    fireEvent.change(screen.getByTestId('msa-row-sort-toolbar'), { target: { value: 'mismatches' } });
    fireEvent.click(screen.getByTestId('msa-view-menu-button'));
    const viewMenu = screen.getByTestId('msa-view-menu');
    expect((within(viewMenu).getByRole('checkbox', { name: 'Residue colors' }) as HTMLInputElement).checked).toBe(true);
    expect((within(viewMenu).getByRole('combobox', { name: 'Sort' }) as HTMLSelectElement).value).toBe('mismatches');
  });
});
