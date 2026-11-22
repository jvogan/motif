// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';

// A translation pinned across the origin of a circular record ends past the
// record length. The workbench opens it from a workspace, moves it with a base
// edit, puts it back on Undo, and keeps the record circular while it is there.

type PortableLayer = { id: string; start: number; end: number; strand: 1 | -1; frame: 0 | 1 | 2; needsReview?: boolean };
type RuntimeWindow = Window & {
  motifGetInventory: () => Array<{ id: string; seq: string; topology?: string }>;
  motifGetWorkspace: () => Record<string, unknown>;
  motifReplaceWorkspace: (workspace: unknown, options?: { discardUnsavedChanges: boolean }) => number;
  motifClearWorkspace: () => void;
};

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

const runtime = () => window as unknown as RuntimeWindow;
const sequenceField = () => document.querySelector<HTMLElement>('.motif-cs-sequence')!;
const press = (target: Element, key: string, init: KeyboardEventInit = {}) => act(() => {
  fireEvent.keyDown(target, { key, ...init });
});

const SEQUENCE = 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCA'.repeat(2);
const LENGTH = SEQUENCE.length;
// The last 6 bases of the record and its first 9.
const ACROSS = { id: 'across', label: 'Across the origin', start: LENGTH - 6, end: LENGTH + 9, strand: 1, frame: 0 };

function layers(): PortableLayer[] {
  const state = runtime().motifGetWorkspace().artifactState as
    | { translationLayersByRecord?: Record<string, PortableLayer[]> }
    | undefined;
  return state?.translationLayersByRecord?.ring ?? [];
}

async function openRingWithLayer() {
  act(() => runtime().motifClearWorkspace());
  await act(async () => {
    runtime().motifReplaceWorkspace({
      records: [{ id: 'ring', name: 'ring', molecule: 'dna', topology: 'circular', seq: SEQUENCE }],
      artifactState: { translationLayersByRecord: { ring: [ACROSS] } },
    }, { discardUnsavedChanges: true });
  });
  await waitFor(() => expect(runtime().motifGetInventory().map((record) => record.id)).toEqual(['ring']));
  expect(layers()).toEqual([expect.objectContaining({ start: LENGTH - 6, end: LENGTH + 9 })]);
}

describe('a pinned translation across the origin', () => {
  it('opens from a workspace, moves with a base edit, and comes back on Undo', async () => {
    await openRingWithLayer();
    await waitFor(() => expect(document.querySelectorAll('.motif-cs-seq-aa[data-aa-track-id="layer:across"], .motif-cs-seq-aa[data-aa-track-id="across"]').length).toBeGreaterThan(0));

    // A base typed over the first base of the record changes the piece past the
    // origin: the layer keeps its bases and asks for review.
    const field = sequenceField();
    act(() => field.focus());
    await press(field, 'ArrowRight');
    await press(field, 'g');
    await waitFor(() => expect(runtime().motifGetInventory()[0].seq).not.toBe(SEQUENCE));
    expect(runtime().motifGetInventory()[0].seq).toHaveLength(LENGTH);
    expect(layers()).toEqual([
      expect.objectContaining({ start: LENGTH - 6, end: LENGTH + 9, needsReview: true }),
    ]);

    await press(sequenceField(), 'z', { ctrlKey: true });
    await waitFor(() => expect(runtime().motifGetInventory()[0].seq).toBe(SEQUENCE));
    expect(layers()).toEqual([expect.objectContaining({ start: LENGTH - 6, end: LENGTH + 9 })]);
    expect(layers()[0].needsReview).toBeUndefined();
  });

  it('keeps the record circular while the layer crosses the origin', async () => {
    await openRingWithLayer();
    const group = document.querySelector('[aria-label="Convert molecule topology"]');
    if (!group) throw new Error('no topology control');
    const linear = Array.from(group.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Linear'));
    act(() => linear!.click());
    await waitFor(() => expect(document.querySelector('.motif-cs-workbench-notice[role="alert"]')?.textContent)
      .toContain('A pinned translation crosses the origin. Remove it before making this record linear.'));
    expect(runtime().motifGetInventory()[0].topology).toBe('circular');
    expect(layers()).toEqual([expect.objectContaining({ start: LENGTH - 6, end: LENGTH + 9 })]);
  });
});
