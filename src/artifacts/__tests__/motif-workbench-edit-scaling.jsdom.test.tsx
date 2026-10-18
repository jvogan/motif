// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';

// The whole workbench, mounted the way the artifact mounts itself. An edit to
// one record validates that record and the sidecars checked against record
// lengths, not every record in the workspace, so its cost does not grow with
// the size of the records it does not touch.

type RuntimeWindow = {
  motifGetActiveRecord: () => { id: string; seq: string } | null;
  motifGetWorkspace: () => { records?: unknown[] };
  motifReplaceWorkspace: (workspace: unknown, options?: { discardUnsavedChanges?: boolean }) => number;
};
const runtime = () => window as unknown as RuntimeWindow;
const sequenceField = () => document.querySelector<HTMLElement>('.motif-cs-sequence')!;

function seededDna(length: number, seed: number): string {
  let state = seed >>> 0;
  const out: string[] = [];
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out.push('ACGT'[state >>> 30]);
  }
  return out.join('');
}

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

describe('a keystroke edit in a workspace of large records', () => {
  it('stays fast and the full checkpoint still validates', async () => {
    // The edited record is small enough for the editable detail view; the other
    // 39 records are 200 kb each.
    const records = Array.from({ length: 40 }, (_, index) => ({
      id: `scale-${index}`,
      name: `scale-${index}`,
      molecule: 'dna',
      topology: 'linear',
      seq: seededDna(index === 0 ? 4_000 : 200_000, index + 1),
      features: Array.from({ length: 20 }, (_, featureIndex) => ({
        id: `feature-${featureIndex}`,
        name: `feature-${featureIndex}`,
        type: 'misc_feature',
        start: featureIndex * 100,
        end: featureIndex * 100 + 50,
        strand: 1,
      })),
    }));
    await act(async () => {
      runtime().motifReplaceWorkspace({ records }, { discardUnsavedChanges: true });
    });
    expect(runtime().motifGetActiveRecord()?.id).toBe('scale-0');
    const before = runtime().motifGetActiveRecord()!.seq;

    const field = sequenceField();
    act(() => field.focus());
    act(() => { fireEvent.keyDown(field, { key: 'ArrowRight' }); });
    act(() => { fireEvent.keyDown(field, { key: 'g' }); });
    const started = performance.now();
    act(() => { fireEvent.keyDown(field, { key: 'a' }); });
    const elapsed = performance.now() - started;

    expect(runtime().motifGetActiveRecord()!.seq.slice(0, 2)).toBe('GA');
    expect(runtime().motifGetActiveRecord()!.seq.slice(2)).toBe(before.slice(2));
    // Revalidating every record on each keystroke was many times slower.
    expect(elapsed).toBeLessThan(1_200);
    expect(runtime().motifGetWorkspace().records).toHaveLength(40);
  }, 120_000);
});
