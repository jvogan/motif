/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createScientificFreshnessRecordIndex } from '../claude-science-freshness';
import { sha256HexSync } from '../claude-science-sha256';
import { measureMapContentSize, motifRectsByLine, nearestSequenceBasesRow, useIdleAnalysis, useLatestCallback, useWorkspaceFingerprint } from '../motif-artifact';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('keeps the event handler identity while invoking the latest committed callback', () => {
  const { result, rerender } = renderHook(({ version }) => useLatestCallback((n: number) => n + version), {
    initialProps: { version: 1 },
  });
  const handler = result.current;
  expect(handler(10)).toBe(11);
  rerender({ version: 2 });
  expect(result.current).toBe(handler);
  expect(handler(10)).toBe(12);
});

it('measures the map content box and clamps undersized frames before the first drawing', () => {
  const frame = document.createElement('div');
  frame.style.padding = '12px 8px';
  document.body.append(frame);
  Object.defineProperties(frame, { clientWidth: { value: 402 }, clientHeight: { value: 248 } });
  expect(measureMapContentSize(frame)).toEqual({ width: 386, height: 260 });
  frame.remove();
});

it('hashes only requested records and reuses the exact sequence digest across indexes', () => {
  const sequence = String.fromCharCode(67, 71, 84, 65).repeat(253);
  const edited = sequence.slice(1);
  const expected = sha256HexSync(sequence);
  const expectedEdit = sha256HexSync(edited);
  const encode = vi.spyOn(TextEncoder.prototype, 'encode');
  const record = { id: 'reference', topology: 'linear' as const, sequence };
  const index = createScientificFreshnessRecordIndex([record]);
  expect(encode).not.toHaveBeenCalled();
  expect(index.get(record.id)?.sequenceSha256).toBe(expected);
  expect(createScientificFreshnessRecordIndex([{ ...record }]).get(record.id)?.sequenceSha256).toBe(expected);
  expect(encode).toHaveBeenCalledExactlyOnceWith(sequence);
  expect(createScientificFreshnessRecordIndex([{ ...record, sequence: edited }]).get(record.id)?.sequenceSha256).toBe(expectedEdit);
  expect(encode).toHaveBeenCalledTimes(2);
});

it('defers closed analysis, drops stale work, and computes current data when opened', () => {
  vi.useFakeTimers();
  const first = vi.fn(() => 'first');
  const second = vi.fn(() => 'second');
  const third = vi.fn(() => 'third');
  const { result, rerender } = renderHook(({ compute, open }) => useIdleAnalysis(compute, open), {
    initialProps: { compute: first, open: false },
  });
  expect(result.current).toBeNull();
  rerender({ compute: second, open: false });
  act(() => vi.runAllTimers());
  expect(first).not.toHaveBeenCalled();
  expect(result.current).toBe('second');
  rerender({ compute: third, open: true });
  expect(result.current).toBe('third');
  rerender({ compute: third, open: false });
  act(() => vi.runAllTimers());
  expect(third).toHaveBeenCalledTimes(1);
});

it('fingerprints the latest workspace once after a burst of edits without repainting for a value that shows nothing new', () => {
  vi.useFakeTimers();
  const baseline = { workspace: { version: 0 }, fingerprint: '0' };
  const fingerprint = vi.fn((workspace: { version: number }) => String(workspace.version));
  let renders = 0;
  const { result, rerender } = renderHook(({ workspace }) => {
    renders += 1;
    return useWorkspaceFingerprint(workspace, fingerprint, baseline);
  }, {
    initialProps: { workspace: baseline.workspace },
  });
  expect(result.current[0]).toBe('0');
  rerender({ workspace: { version: 1 } });
  act(() => vi.advanceTimersByTime(200));
  rerender({ workspace: { version: 2 } });
  act(() => vi.advanceTimersByTime(200));
  expect(fingerprint).not.toHaveBeenCalled();
  expect(result.current[0]).toBeNull();
  const rendersBeforeSettle = renders;
  act(() => vi.advanceTimersByTime(50));
  expect(fingerprint).toHaveBeenCalledExactlyOnceWith({ version: 2 });
  // The pending state already reads as changed: settling to an ordinary value commits nothing.
  expect(renders).toBe(rendersBeforeSettle);
  expect(result.current[0]).toBeNull();
  rerender({ workspace: { version: 0 } });
  act(() => vi.advanceTimersByTime(250));
  expect(result.current[0]).toBe(baseline.fingerprint);
});

it('commits a settled fingerprint that matches the last saved copy, so a return to it shows as saved', () => {
  vi.useFakeTimers();
  const baseline = { workspace: { version: 0 }, fingerprint: '0' };
  const fingerprint = vi.fn((workspace: { version: number }) => String(workspace.version));
  const { result, rerender } = renderHook(({ workspace, shown }) => useWorkspaceFingerprint(workspace, fingerprint, baseline, Object.is, shown), {
    initialProps: { workspace: { version: 5 }, shown: '5' as string | null },
  });
  act(() => vi.advanceTimersByTime(250));
  expect(result.current[0]).toBe('5');
  rerender({ workspace: { version: 6 }, shown: '5' });
  act(() => vi.advanceTimersByTime(250));
  expect(result.current[0]).toBeNull();
  const again = { version: 5 };
  rerender({ workspace: again, shown: '5' });
  act(() => vi.advanceTimersByTime(250));
  expect(result.current[0]).toBe('5');
});

it('reuses exact fingerprints for a downloaded workspace and a new restore baseline', () => {
  vi.useFakeTimers();
  const initial = { workspace: { version: 0 }, fingerprint: '0' };
  const next = { workspace: { version: 1 }, fingerprint: '1' };
  const fingerprint = vi.fn();
  const { result, rerender } = renderHook(({ workspace, baseline }) => useWorkspaceFingerprint(workspace, fingerprint, baseline), {
    initialProps: { workspace: next.workspace, baseline: initial },
  });
  expect(result.current[0]).toBeNull();
  act(() => result.current[1](next));
  expect(result.current[0]).toBe('1');
  rerender({ workspace: initial.workspace, baseline: initial });
  expect(result.current[0]).toBe('0');
  rerender({ workspace: next.workspace, baseline: next });
  act(() => vi.advanceTimersByTime(250));
  expect(result.current[0]).toBe('1');
  expect(fingerprint).not.toHaveBeenCalled();
});

it('finds the nearest bases row across block gaps with logarithmic block reads', () => {
  const blockReads = vi.fn((index: number) => new DOMRect(0, index * 40, 200, 32));
  const rowReads = vi.fn((index: number) => new DOMRect(20, index * 40 + 4, 180, 12));
  const blocks = Array.from({ length: 1024 }, (_, index) => {
    const block = document.createElement('div');
    const row = document.createElement('div');
    row.dataset.lineStart = String(index);
    row.getBoundingClientRect = () => rowReads(index);
    block.getBoundingClientRect = () => blockReads(index);
    block.append(row);
    return block;
  });
  const y = 512 * 40;
  expect(nearestSequenceBasesRow(blocks, y - 9)?.row.dataset.lineStart).toBe('512');
  expect(blockReads.mock.calls.length).toBeLessThanOrEqual(11);
  expect(rowReads.mock.calls.length).toBeLessThanOrEqual(2);
  expect(nearestSequenceBasesRow(blocks, y - 10)?.row.dataset.lineStart).toBe('511');
  expect(nearestSequenceBasesRow(blocks, y - 14)?.row.dataset.lineStart).toBe('511');
  expect(nearestSequenceBasesRow(blocks, -5)?.row.dataset.lineStart).toBe('0');
  expect(nearestSequenceBasesRow(blocks, 1024 * 40)?.row.dataset.lineStart).toBe('1023');
  expect(nearestSequenceBasesRow([], y)).toBeNull();
});

it('merges overlapping and adjacent hits, splits at line breaks, and keeps origin-spanning coverage', () => {
  expect([...motifRectsByLine([0, 2, 5, 9, 13], 3, 14, 'circular', 6)]).toEqual([
    [0, [{ left: 0, width: 6 }]],
    [6, [{ left: 0, width: 2 }, { left: 3, width: 3 }]],
    [12, [{ left: 1, width: 1 }]],
  ]);
  expect([...motifRectsByLine([2, 9], 4, 10, 'circular', 5)]).toEqual([
    [0, [{ left: 0, width: 5 }]],
    [5, [{ left: 0, width: 1 }, { left: 4, width: 1 }]],
  ]);
  expect([...motifRectsByLine([2], 10, 10, 'circular', 5)]).toEqual([
    [0, [{ left: 0, width: 5 }]],
    [5, [{ left: 0, width: 5 }]],
  ]);
  expect(motifRectsByLine([], 1, 10, 'linear', 5).size).toBe(0);
  expect(motifRectsByLine([0], 1, 10, 'linear', 0).size).toBe(0);
});
