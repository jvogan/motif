import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findMsaMatches,
  MSA_SEARCH_DEBOUNCE_MS,
  resolveMsaSearchDebounceMs,
  scheduleMsaSearch,
} from '../claude-science-msa';

const LARGE_ALIGNMENT_ROW_COUNT = 100;
const LARGE_ALIGNMENT_COLUMN_COUNT = 20_000;

function largeAlignmentRows() {
  const aligned = 'ACGT'.repeat(LARGE_ALIGNMENT_COLUMN_COUNT / 4);
  return Array.from({ length: LARGE_ALIGNMENT_ROW_COUNT }, (_, index) => ({
    id: `row-${index}`,
    name: `Sample ${index}`,
    aligned,
  }));
}

describe('MSA finder performance fixture', () => {
  it('measures the bounded scan path at 100 × 20,000 cells', () => {
    const rows = largeAlignmentRows();
    const startedAt = performance.now();
    const result = findMsaMatches(rows, 'Z', { molecule: 'dna' });
    const elapsedMs = performance.now() - startedAt;

    // Keep the fixture deterministic without imposing a machine-speed gate.
    expect(result).toEqual({ matches: [], truncated: false });
    console.info(`[msa-search-scan] 100x20000 absent motif: ${elapsedMs.toFixed(1)} ms`);
  });
});

describe('MSA finder debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs only the latest large-alignment query after the reader pauses', () => {
    vi.useFakeTimers();
    const rows = largeAlignmentRows();
    const delayMs = resolveMsaSearchDebounceMs(rows);
    const scannedQueries: string[] = [];
    let cancelPending: () => void = () => undefined;

    for (const query of ['A', 'AC', 'ACG']) {
      cancelPending();
      cancelPending = scheduleMsaSearch(() => scannedQueries.push(query), delayMs);
      vi.advanceTimersByTime(50);
    }

    expect(delayMs).toBe(MSA_SEARCH_DEBOUNCE_MS);
    expect(scannedQueries).toEqual([]);
    vi.advanceTimersByTime(MSA_SEARCH_DEBOUNCE_MS - 51);
    expect(scannedQueries).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(scannedQueries).toEqual(['ACG']);
  });

  it('settles small-alignment queries immediately', () => {
    const run = vi.fn();
    const delayMs = resolveMsaSearchDebounceMs([{ aligned: 'ACGT' }]);

    scheduleMsaSearch(run, delayMs);

    expect(delayMs).toBe(0);
    expect(run).toHaveBeenCalledOnce();
  });
});
