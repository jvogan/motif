// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';

// Pinned translation layers are on the same edit history as base and feature
// edits: Undo reverses the most recent step, whichever kind it was, and never
// drops a layer the user did not undo. The workbench is mounted the way the
// artifact mounts itself (see motif-workbench-state-integrity.jsdom.test.tsx).

type RuntimeRecord = { id: string; seq: string };
type PortableLayer = { id: string; start: number; end: number; strand: 1 | -1; frame: 0 | 1 | 2 };
type RuntimeWindow = Window & {
  motifGetInventory: () => RuntimeRecord[];
  motifRenderInventory: (records: unknown[]) => void;
  motifGetWorkspace: () => Record<string, unknown>;
  motifClearWorkspace: () => void;
};

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

const runtime = () => window as unknown as RuntimeWindow;
const activeSeq = (): string => runtime().motifGetInventory()[0]?.seq ?? '';
const sequenceField = () => document.querySelector<HTMLElement>('.motif-cs-sequence')!;
const press = (target: Element, key: string, init: KeyboardEventInit = {}) => act(() => {
  fireEvent.keyDown(target, { key, ...init });
});
const undo = () => press(sequenceField(), 'z', { ctrlKey: true });
const redo = () => press(sequenceField(), 'z', { ctrlKey: true, shiftKey: true });

const BASE_SEQUENCE = 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCA'.repeat(4);

async function loadRecord(id: string) {
  // A pinned layer is workspace data that references its record, so the
  // records-only render refuses to replace it; start each test from empty.
  act(() => runtime().motifClearWorkspace());
  await act(async () => {
    runtime().motifRenderInventory([{ id, name: id, molecule: 'dna', topology: 'linear', seq: BASE_SEQUENCE }]);
  });
  await waitFor(() => expect(runtime().motifGetInventory().map((record) => record.id)).toEqual([id]));
}

function layers(recordId: string): PortableLayer[] {
  const state = runtime().motifGetWorkspace().artifactState as
    | { translationLayersByRecord?: Record<string, PortableLayer[]> }
    | undefined;
  return state?.translationLayersByRecord?.[recordId] ?? [];
}

// Everything durable except the export timestamp, for exact round-trip checks.
function durableState() {
  const { exportedAt: _exportedAt, ...rest } = runtime().motifGetWorkspace();
  return rest;
}

function chooseCreateItem(label: 'Add AA track' | 'Remove AA track') {
  const menuButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]'))
    .find((candidate) => candidate.textContent?.trim() === 'Create');
  if (!menuButton) throw new Error('no Create menu');
  act(() => menuButton.click());
  const item = document.querySelector<HTMLButtonElement>(`[role="menuitem"][aria-label="${label}"]`);
  if (!item) throw new Error(`no ${label} item`);
  expect(item.getAttribute('aria-disabled')).toBeNull();
  act(() => item.click());
}

async function typeBaseAtStart() {
  const field = sequenceField();
  act(() => field.focus());
  await press(field, 'ArrowRight');
  await press(field, 'g');
}

async function selectFirstLine() {
  const field = sequenceField();
  act(() => field.focus());
  await press(field, 'Home');
  await press(field, 'ArrowDown', { shiftKey: true });
}

describe('pinned translation layers and the edit history', () => {
  it('a base edit followed by Translate undoes one step at a time and never loses the layer silently', async () => {
    await loadRecord('layer-history-repro');
    await typeBaseAtStart();
    const editedSeq = activeSeq();
    expect(editedSeq).not.toBe(BASE_SEQUENCE);

    await selectFirstLine();
    chooseCreateItem('Add AA track');
    const [pinned] = layers('layer-history-repro');
    expect(pinned).toBeTruthy();

    // The first Undo reverses the most recent step, the pin, and only that:
    // the base edit is still there.
    await undo();
    expect(layers('layer-history-repro')).toEqual([]);
    expect(activeSeq()).toBe(editedSeq);

    // The second Undo reverses the base edit.
    await undo();
    expect(activeSeq()).toBe(BASE_SEQUENCE);
    expect(layers('layer-history-repro')).toEqual([]);

    // Redo replays both, in order, back to the pinned layer.
    await redo();
    expect(activeSeq()).toBe(editedSeq);
    expect(layers('layer-history-repro')).toEqual([]);
    await redo();
    expect(layers('layer-history-repro')).toEqual([pinned]);
    expect(activeSeq()).toBe(editedSeq);
  });

  it('a layer pinned before a base edit survives Undo of that edit', async () => {
    await loadRecord('layer-history-survives');
    await selectFirstLine();
    chooseCreateItem('Add AA track');
    const pinnedBefore = layers('layer-history-survives');
    expect(pinnedBefore).toHaveLength(1);

    await press(sequenceField(), 'Escape');
    await typeBaseAtStart();
    expect(activeSeq()).not.toBe(BASE_SEQUENCE);
    expect(layers('layer-history-survives').map((layer) => layer.id)).toEqual(pinnedBefore.map((layer) => layer.id));

    await undo();
    expect(activeSeq()).toBe(BASE_SEQUENCE);
    // Back in the coordinates it was pinned at.
    expect(layers('layer-history-survives')).toEqual(pinnedBefore);
  });

  it('Undo then Redo of a pin returns to the identical state', async () => {
    await loadRecord('layer-history-roundtrip');
    await typeBaseAtStart();
    await selectFirstLine();
    chooseCreateItem('Add AA track');
    const pinnedState = durableState();
    expect(layers('layer-history-roundtrip')).toHaveLength(1);

    await undo();
    expect(layers('layer-history-roundtrip')).toEqual([]);
    await redo();
    expect(durableState()).toEqual(pinnedState);
  });

  it('Undo of a layer removal brings the layer back, and Redo removes it again', async () => {
    await loadRecord('layer-history-remove');
    await selectFirstLine();
    chooseCreateItem('Add AA track');
    const pinned = layers('layer-history-remove');
    expect(pinned).toHaveLength(1);

    // The new layer is selected, so the same menu entry now removes it.
    chooseCreateItem('Remove AA track');
    expect(layers('layer-history-remove')).toEqual([]);

    await undo();
    expect(layers('layer-history-remove')).toEqual(pinned);
    await redo();
    expect(layers('layer-history-remove')).toEqual([]);
    await undo();
    await undo();
    // Past the pin itself: nothing pinned, and the sequence was never touched.
    expect(layers('layer-history-remove')).toEqual([]);
    expect(activeSeq()).toBe(BASE_SEQUENCE);
  });
});
