/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceMsaViewer,
  type ClaudeScienceMsaViewerProps,
} from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment, type ArtifactAlignment } from '../claude-science-msa';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  type ClaudeScienceMsaViewPreferences,
} from '../claude-science-msa-view-preferences';

const alignment = normalizeArtifactAlignment({
  id: 'row-statistics',
  name: 'Row statistics',
  molecule: 'dna',
  referenceRowId: 'template',
  rows: [
    { id: 'template', name: 'Template row', aligned: 'AC-GTA' },
    { id: 'zulu', name: 'Zulu long', aligned: 'ATCGTA' },
    { id: 'alpha', name: 'Alpha short', aligned: 'AC-GT-' },
    { id: 'middle', name: 'Middle row', aligned: 'AC-ATA' },
  ],
});

function StatefulViewer({
  sourceAlignment = alignment,
  initialPreferences = { ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, showRowStatsPanel: true },
}: {
  sourceAlignment?: ArtifactAlignment;
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
    onUpdateAlignmentTemplate: () => null,
    onDeleteAlignment: vi.fn(),
    onImportRecords: async () => ({ records: [], message: '', tone: 'status' }),
    onCopy: async () => true,
    onDownload: vi.fn(),
  };
  return <ClaudeScienceMsaViewer {...props} />;
}

function panelRow(rowId: string): HTMLTableRowElement {
  const row = screen.getByTestId('msa-row-stats-panel')
    .querySelector<HTMLTableRowElement>(`tbody tr[data-row-id="${rowId}"]`);
  if (!row) throw new Error(`Expected statistics row ${rowId}.`);
  return row;
}

function panelRowIds(): string[] {
  return screen.getAllByTestId('msa-row-stats-row').map((row) => row.dataset.rowId ?? '');
}

function matrixRowIds(): string[] {
  return Array.from(
    screen.getByTestId('msa-alignment-view').querySelectorAll<HTMLElement>('[data-msa-row-id]'),
    (row) => row.dataset.msaRowId ?? '',
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ClaudeScienceMsaViewer row statistics panel', () => {
  it('renders one correctly calculated statistics row per alignment row', () => {
    render(<StatefulViewer />);

    expect(screen.getByTestId('msa-row-stats-panel').tagName).toBe('DETAILS');
    expect(screen.getByTestId('msa-row-stats-table').tagName).toBe('TABLE');
    expect(screen.getAllByTestId('msa-row-stats-row')).toHaveLength(alignment.rows.length);

    const expected = {
      template: ['0', '5 bp', '100.0%'],
      zulu: ['2', '6 bp', '66.7%'],
      alpha: ['0', '4 bp', '100.0%'],
      middle: ['1', '5 bp', '80.0%'],
    };
    for (const [rowId, values] of Object.entries(expected)) {
      const cells = panelRow(rowId).querySelectorAll('td');
      expect(Array.from(cells).slice(1).map((cell) => cell.textContent)).toEqual(values);
    }
    expect(panelRow('template').textContent).toContain('Template');
  });

  it('uses the persisted sort mode for both the panel and matrix', () => {
    render(<StatefulViewer />);

    fireEvent.click(screen.getByTestId('msa-row-stats-sort-name'));
    expect(screen.getByTestId('msa-row-stats-sort-name').getAttribute('aria-sort')).toBe('ascending');
    expect(panelRowIds()).toEqual(['template', 'alpha', 'middle', 'zulu']);
    expect(matrixRowIds()).toEqual(['template', 'alpha', 'middle', 'zulu']);

    fireEvent.click(screen.getByTestId('msa-row-stats-sort-length'));
    expect(screen.getByTestId('msa-row-stats-sort-length').getAttribute('aria-sort')).toBe('descending');
    expect(panelRowIds()).toEqual(['template', 'zulu', 'middle', 'alpha']);
    expect(matrixRowIds()).toEqual(['template', 'zulu', 'middle', 'alpha']);
  });

  it('jumps the selected matrix row to its first covered difference column', () => {
    render(<StatefulViewer />);
    vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value });

    const viewport = screen.getByTestId('msa-alignment-view')
      .querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll');
    const matrixRow = screen.getByTestId('msa-alignment-view')
      .querySelector<HTMLElement>('[data-msa-row-id="zulu"]');
    if (!viewport || !matrixRow) throw new Error('Expected the alignment viewport and Zulu row.');
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: vi.fn() });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 100, width: 600, height: 100, toJSON: () => ({}),
    });
    vi.spyOn(matrixRow, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 150, left: 0, top: 150, right: 600, bottom: 170, width: 600, height: 20, toJSON: () => ({}),
    });

    const row = panelRow('zulu');
    expect(row.dataset.firstDifferenceColumn).toBe('2');
    fireEvent.click(row);

    expect(matrixRow.querySelector('[data-alignment-column="1"]')?.hasAttribute('data-jump')).toBe(false);
    expect(matrixRow.querySelector('[data-alignment-column="2"]')?.getAttribute('data-jump')).toBe('true');
    expect(viewport.scrollTop).toBe(110);
  });

  it('hides the panel when its visibility toggle is off', () => {
    render(<StatefulViewer />);
    expect(screen.getByTestId('msa-row-stats-panel')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Row statistics table'));

    expect(screen.queryByTestId('msa-row-stats-panel')).toBeNull();
  });
});
