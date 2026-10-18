// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';

// The whole workbench, mounted the way the artifact mounts itself. A workspace
// replaced through the page API is the session baseline: it reads as saved, and
// stays that way once the deferred annotation-proposal pass has run over it.

type RuntimeWindow = {
  motifGetInventory: () => Array<{ id: string; annotations?: unknown[]; provenance?: Record<string, unknown> }>;
  motifRenderInventory: (records: unknown[]) => void;
  motifAddRecords: (records: unknown) => number;
  motifGetWorkspace: () => Record<string, unknown>;
  motifReplaceWorkspace: (workspace: unknown, options?: { discardUnsavedChanges?: boolean }) => number;
  motifSetRestrictionSources: (sources: unknown) => string[];
};
const runtime = () => window as unknown as RuntimeWindow;
const durability = () => document.querySelector('[data-testid="session-durability-status"]')?.textContent;
const settle = (ms: number) => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, ms));
});

afterEach(() => {
  vi.useRealTimers();
});

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

const featureless = (id: string) => ({
  id,
  name: id,
  molecule: 'dna',
  topology: 'linear',
  seq: 'ATGGCTGCTGCTGCTTAAGGATCCAAGCTTGAATTC'.repeat(8),
});

// A checkpoint taken before the proposal pass ran still asks for it.
async function checkpointAwaitingProposals(id: string) {
  await act(async () => {
    runtime().motifRenderInventory([featureless(id)]);
  });
  const workspace = runtime().motifGetWorkspace();
  const [record] = workspace.records as Array<Record<string, unknown>>;
  const { provenance: _provenance, ...unproposed } = record;
  return { ...workspace, records: [{ ...unproposed, annotations: [], proposeAnnotations: true }] };
}

describe('replacing the workspace through the page API', () => {
  it('stays saved after the deferred proposal pass, so the next replace is accepted', async () => {
    const first = await checkpointAwaitingProposals('baseline-a');
    const second = await checkpointAwaitingProposals('baseline-b');

    await act(async () => {
      runtime().motifReplaceWorkspace(first, { discardUnsavedChanges: true });
    });
    await settle(1_000);
    expect(runtime().motifGetInventory()[0].provenance?.motifAutoAnnotation).toBeDefined();
    expect(durability()).not.toBe('unsaved changes');

    // No discard flag: refused only if the session really had unsaved changes.
    let replaced = 0;
    await act(async () => {
      replaced = runtime().motifReplaceWorkspace(second);
    });
    expect(replaced).toBe(1);
    expect(runtime().motifGetInventory().map((record) => record.id)).toEqual(['baseline-b']);
    await settle(1_000);
    expect(durability()).not.toBe('unsaved changes');
  });

  it('still reports unsaved changes when the proposal pass runs over an edited session', async () => {
    const workspace = await checkpointAwaitingProposals('baseline-c');
    await act(async () => {
      runtime().motifReplaceWorkspace(workspace, { discardUnsavedChanges: true });
    });
    await settle(1_000);
    expect(durability()).not.toBe('unsaved changes');

    await act(async () => {
      runtime().motifAddRecords(featureless('baseline-added'));
    });
    await settle(1_000);
    const added = runtime().motifGetInventory().find((record) => record.id === 'baseline-added');
    expect(added?.provenance?.motifAutoAnnotation).toBeDefined();
    expect(durability()).toBe('unsaved changes');
  });

  it('does not fold a page-API edit made before the deferred pass runs into the baseline', async () => {
    const first = await checkpointAwaitingProposals('baseline-d');
    const second = await checkpointAwaitingProposals('baseline-e');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      runtime().motifReplaceWorkspace(first, { discardUnsavedChanges: true });
    });
    // The edit is issued, and the deferred pass runs, before the edit renders.
    act(() => {
      runtime().motifSetRestrictionSources(['all']);
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(runtime().motifGetInventory()[0].provenance?.motifAutoAnnotation).toBeDefined();
    expect(durability()).toBe('unsaved changes');

    let error: unknown = null;
    act(() => {
      try {
        runtime().motifReplaceWorkspace(second);
      } catch (caught) {
        error = caught;
      }
    });
    expect(error).toMatchObject({ code: 'MOTIF_UNSAVED_WORKSPACE' });
    expect(runtime().motifGetInventory().map((record) => record.id)).toEqual(['baseline-d']);
  });
});
