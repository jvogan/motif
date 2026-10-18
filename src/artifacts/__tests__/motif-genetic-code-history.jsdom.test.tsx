// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';

// Genetic-code changes are on the same edit history as base, feature and
// translation-layer edits: Undo reverses the most recent step, whichever kind
// it was, and an earlier step's Undo cannot roll back a code change it never
// recorded. The workbench is mounted the way the artifact mounts itself.

type RuntimeFeature = { id: string; metadata?: Record<string, unknown> };
type RuntimeRecord = { id: string; seq: string; translationTableId?: number; annotations?: RuntimeFeature[] };
type RuntimeWindow = {
  motifGetInventory: () => RuntimeRecord[];
  motifReplaceWorkspace: (workspace: unknown, options?: { discardUnsavedChanges?: boolean }) => number;
};

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

const runtime = () => window as unknown as RuntimeWindow;
const activeRecord = () => runtime().motifGetInventory()[0]!;
const sequenceField = () => document.querySelector<HTMLElement>('.motif-cs-sequence')!;
const press = (target: Element, key: string, init: KeyboardEventInit = {}) => act(() => {
  fireEvent.keyDown(target, { key, ...init });
});
const undo = () => press(sequenceField(), 'z', { ctrlKey: true });
const redo = () => press(sequenceField(), 'z', { ctrlKey: true, shiftKey: true });

const CODING = `ATG${'GCT'.repeat(29)}TAA${'C'.repeat(60)}`;

async function loadRecord(id: string, withCds = false) {
  await act(async () => {
    runtime().motifReplaceWorkspace({
      records: [{
        id,
        name: id,
        molecule: 'dna',
        topology: 'linear',
        seq: CODING,
        features: withCds ? [{ id: 'cds-1', name: 'Coding', type: 'cds', start: 0, end: 93, strand: 1 }] : [],
      }],
    }, { discardUnsavedChanges: true });
  });
  await waitFor(() => expect(runtime().motifGetInventory().map((record) => record.id)).toEqual([id]));
}

async function typeBaseNearEnd() {
  const field = sequenceField();
  act(() => field.focus());
  await press(field, 'End');
  await press(field, 'g');
}

function chooseCode(selectName: string, id: number) {
  const select = document.querySelector<HTMLSelectElement>(`select[name="${selectName}"]`);
  if (!select) throw new Error(`no ${selectName} select`);
  act(() => {
    fireEvent.change(select, { target: { value: String(id) } });
  });
}

function selectCdsFeature() {
  const panel = document.querySelector<HTMLDetailsElement>('details[data-rail-tool="annotations"]')!;
  act(() => {
    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
  });
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.motif-cs-feature-annotation-list button.motif-cs-row'))
    .find((candidate) => candidate.textContent?.includes('Coding'));
  if (!row) throw new Error('no CDS row');
  act(() => row.click());
}

describe('the record genetic code', () => {
  it('is undone and redone as its own step after a base edit', async () => {
    await loadRecord('code-record');
    await typeBaseNearEnd();
    const edited = activeRecord().seq;
    expect(edited).not.toBe(CODING);

    chooseCode('analysis-translation-table', 11);
    expect(activeRecord().translationTableId).toBe(11);

    await undo();
    expect(activeRecord().translationTableId).toBeUndefined();
    expect(activeRecord().seq).toBe(edited);

    await redo();
    expect(activeRecord().translationTableId).toBe(11);
    expect(activeRecord().seq).toBe(edited);

    await undo();
    await undo();
    expect(activeRecord().seq).toBe(CODING);
    expect(activeRecord().translationTableId).toBeUndefined();
  });
});

describe('a coding feature genetic code', () => {
  it('survives the Undo of the base edit made before it', async () => {
    await loadRecord('code-feature', true);
    await typeBaseNearEnd();
    const edited = activeRecord().seq;

    selectCdsFeature();
    chooseCode('translation-table', 11);
    const tableOf = () => activeRecord().annotations?.find((feature) => feature.id === 'cds-1')?.metadata?.transl_table;
    expect(tableOf()).toBe(11);

    await undo();
    // The code change is the most recent step, so it is the one undone.
    expect(tableOf()).toBeUndefined();
    expect(activeRecord().seq).toBe(edited);

    await redo();
    expect(tableOf()).toBe(11);
    expect(activeRecord().seq).toBe(edited);
  });
});
