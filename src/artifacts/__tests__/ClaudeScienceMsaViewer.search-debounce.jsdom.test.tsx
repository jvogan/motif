/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer, type ClaudeScienceMsaViewerProps } from '../ClaudeScienceMsaViewer';
import { MSA_SEARCH_DEBOUNCE_MS, normalizeArtifactAlignment } from '../claude-science-msa';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

function renderLargeViewer() {
  const alignment = normalizeArtifactAlignment({
    id: 'debounced-search',
    name: 'Debounced search',
    molecule: 'dna',
    referenceRowId: 'row-000',
    rows: Array.from({ length: 100 }, (_, index) => ({
      id: `row-${String(index).padStart(3, '0')}`,
      name: `Sample ${String(index).padStart(3, '0')}`,
      aligned: 'A'.repeat(1_000),
    })),
  });
  const props: ClaudeScienceMsaViewerProps = {
    records: [],
    alignments: [alignment],
    activeAlignmentId: alignment.id,
    viewPreferences: DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
    onActiveAlignmentChange: vi.fn(),
    onViewPreferencesChange: vi.fn(),
    onSaveAlignment: (next) => next,
    onUpdateAlignmentTemplate: vi.fn(),
    onDeleteAlignment: vi.fn(),
    onImportRecords: async () => ({ records: [], message: '', tone: 'status' }),
    onCopy: async () => true,
    onDownload: vi.fn(),
  };
  render(<ClaudeScienceMsaViewer {...props} />);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer finder debounce', () => {
  it('hides results behind an honest pending status until the large scan settles', () => {
    renderLargeViewer();
    vi.useFakeTimers();
    const form = screen.getByTestId('msa-search');
    const count = screen.getByTestId('msa-search-count');

    fireEvent.change(screen.getByTestId('msa-search-input'), { target: { value: 'A' } });

    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(count.textContent).toBe('Searching…');
    expect((screen.getByTestId('msa-search-next') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-search-match="true"]')).toBeNull();

    act(() => vi.advanceTimersByTime(MSA_SEARCH_DEBOUNCE_MS - 1));
    expect(count.textContent).toBe('Searching…');

    act(() => vi.advanceTimersByTime(1));
    expect(form.getAttribute('aria-busy')).toBe('false');
    expect(count.textContent).toBe('5,000+ motif matches');
    expect((screen.getByTestId('msa-search-next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('flushes a pending query and steps when Enter is pressed', () => {
    renderLargeViewer();
    vi.useFakeTimers();
    const input = screen.getByTestId('msa-search-input');

    fireEvent.change(input, { target: { value: 'Sample 007' } });
    expect(screen.getByTestId('msa-search-count').textContent).toBe('Searching…');

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('msa-search-count').textContent).toBe('1 of 1 · row name');
    expect(document.querySelector('[data-msa-row-id="row-007"]')?.getAttribute('data-search-name-active')).toBe('true');
  });
});
