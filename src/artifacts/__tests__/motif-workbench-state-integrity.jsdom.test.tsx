// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';

// The whole workbench, mounted the way the artifact mounts itself (see
// motif-sequence-editing.jsdom.test.tsx). Every test loads its own record ids.

type RuntimeFeature = { id: string; name: string; metadata?: Record<string, unknown> };
type RuntimeRecord = { id: string; seq: string; annotations?: RuntimeFeature[]; provenance?: Record<string, unknown> };
type RuntimeWindow = Window & {
  motifGetInventory: () => RuntimeRecord[];
  motifRenderInventory: (records: unknown[]) => void;
  motifAddWorkflowResults: (results: unknown) => number;
  motifRemoveRecords: (ids: string | string[]) => number;
  motifClearWorkspace: () => void;
};

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const runtime = () => window as unknown as RuntimeWindow;
const activeRecord = () => {
  const [record] = runtime().motifGetInventory();
  if (!record) throw new Error('no record loaded');
  return record;
};
const activeSeq = (): string => activeRecord().seq ?? '';
const sequenceField = () => document.querySelector<HTMLElement>('.motif-cs-sequence')!;
const notice = () => document.querySelector<HTMLElement>('.motif-cs-workbench-notice');
const selectionLabel = () => document.querySelector('.motif-cs-selection-name')?.textContent ?? null;
const press = (target: Element, key: string, init: KeyboardEventInit = {}) => act(() => {
  fireEvent.keyDown(target, { key, ...init });
});
const button = (label: string) => {
  const match = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!match) throw new Error(`no button labelled ${label}`);
  return match;
};

const BASE_SEQUENCE = 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCA'.repeat(4);

async function loadRecords(records: Array<Record<string, unknown>>) {
  await act(async () => {
    runtime().motifRenderInventory(records);
  });
  await waitFor(() => expect(runtime().motifGetInventory().map((record) => record.id))
    .toEqual(records.map((record) => record.id)));
}

describe('Escape that closes a popover stops there', () => {
  it('closes an open rail tool popover and keeps the sequence selection', async () => {
    await loadRecords([{ id: 'escape-popover', name: 'escape-popover', molecule: 'dna', topology: 'linear', seq: BASE_SEQUENCE }]);
    const field = sequenceField();
    act(() => field.focus());
    await press(field, 'ArrowRight');
    await press(field, 'ArrowDown', { shiftKey: true });
    const selected = selectionLabel();
    expect(selected).toBe('1-60 (60)');

    const panel = document.querySelector<HTMLDetailsElement>('.motif-cs-inspector details[name="motif-cs-tools"][data-rail-tool="restriction-sites"]');
    expect(panel).not.toBeNull();
    expect(document.querySelector('.motif-cs-inspector')?.getAttribute('data-tools-pinned')).toBe('false');
    const summary = panel!.querySelector<HTMLElement>(':scope > summary')!;
    act(() => {
      panel!.open = true;
      summary.focus();
    });
    await press(summary, 'Escape');

    expect(panel!.open).toBe(false);
    expect(selectionLabel()).toBe(selected);

    // With no popover open, Escape clears the selection as before.
    act(() => field.focus());
    await press(field, 'Escape');
    expect(selectionLabel()).not.toBe(selected);
  });
});

function proposalRecord(id: string) {
  return {
    id,
    name: id,
    molecule: 'dna',
    topology: 'linear',
    seq: `${'ATG'.repeat(29)}TAA${'C'.repeat(30)}`,
    annotations: [{
      id: 'proposed-orf',
      name: 'Proposed ORF',
      type: 'cds',
      start: 0,
      end: 90,
      strand: 1,
      metadata: {
        motifProposal: {
          status: 'proposed',
          proposedBy: 'motif-auto-annotation',
          detector: 'motif-orf-detection',
          detectorVersion: 1,
          reason: 'A complete local ORF was found.',
        },
      },
    }],
    provenance: {
      motifAutoAnnotation: {
        status: 'review_required',
        proposedBy: 'motif-auto-annotation',
        proposedCount: 1,
        pendingCount: 1,
        acceptedCount: 0,
        dismissedCount: 0,
      },
    },
  };
}

function selectProposedFeature() {
  const panel = document.querySelector<HTMLDetailsElement>('details[data-rail-tool="annotations"]')!;
  act(() => {
    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
  });
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.motif-cs-feature-annotation-list button.motif-cs-row'))
    .find((candidate) => candidate.textContent?.includes('Proposed ORF'));
  if (!row) throw new Error('no proposed feature row');
  act(() => row.click());
}

function reviewButton(name: 'Accept' | 'Dismiss') {
  const review = document.querySelector('[data-testid="proposed-annotation-review"]');
  const match = Array.from(review?.querySelectorAll('button') ?? []).find((candidate) => candidate.textContent === name);
  if (!match) throw new Error(`no ${name} button`);
  return match;
}

const autoAnnotation = () => activeRecord().provenance?.motifAutoAnnotation as Record<string, unknown> | undefined;

describe('proposal review decisions are on the edit history', () => {
  it('a later Undo reverts the dismissal, not the base edit made before it', async () => {
    await loadRecords([proposalRecord('dismiss-history')]);
    const field = sequenceField();
    act(() => field.focus());
    await press(field, 'ArrowRight');
    await press(field, 'g');
    expect(activeSeq().slice(0, 3)).toBe('GTG');

    selectProposedFeature();
    act(() => reviewButton('Dismiss').click());
    expect(activeRecord().annotations ?? []).toEqual([]);
    expect(autoAnnotation()).toMatchObject({ pendingCount: 0, dismissedCount: 1 });

    act(() => field.focus());
    await press(field, 'z', { ctrlKey: true });
    // Undo takes back the dismissal only; the base edit stays.
    expect(activeSeq().slice(0, 3)).toBe('GTG');
    expect(activeRecord().annotations?.map((feature) => feature.id)).toEqual(['proposed-orf']);
    expect(autoAnnotation()).toMatchObject({ pendingCount: 1, dismissedCount: 0 });

    await press(field, 'z', { ctrlKey: true });
    expect(activeSeq().slice(0, 3)).toBe('ATG');
  });

  it('a later Undo reverts the acceptance, not the base edit made before it', async () => {
    await loadRecords([proposalRecord('accept-history')]);
    const field = sequenceField();
    act(() => field.focus());
    await press(field, 'ArrowRight');
    await press(field, 'g');

    selectProposedFeature();
    act(() => reviewButton('Accept').click());
    const accepted = activeRecord().annotations?.[0];
    expect((accepted?.metadata?.motifProposal as Record<string, unknown>).status).toBe('accepted');
    expect(autoAnnotation()).toMatchObject({ pendingCount: 0, acceptedCount: 1 });

    act(() => field.focus());
    await press(field, 'z', { ctrlKey: true });
    expect(activeSeq().slice(0, 3)).toBe('GTG');
    const reverted = activeRecord().annotations?.[0];
    expect((reverted?.metadata?.motifProposal as Record<string, unknown>).status).toBe('proposed');
    expect(autoAnnotation()).toMatchObject({ pendingCount: 1, acceptedCount: 0 });
  });
});

function recordInput(id: string) {
  return { id, name: id, molecule: 'dna', topology: 'linear', seq: BASE_SEQUENCE };
}

function deleteActiveEntry(name: string) {
  act(() => button(`Delete entry ${name}`).click());
  act(() => button(`Confirm delete entry ${name}`).click());
  const undo = notice()?.querySelector<HTMLButtonElement>(`button[aria-label="Undo deleting ${name}"]`);
  expect(undo).toBeTruthy();
  return undo!;
}

describe('the Undo of a record delete', () => {
  it('is withdrawn when the workspace is cleared', async () => {
    await loadRecords([recordInput('undo-clear-a'), recordInput('undo-clear-b')]);
    deleteActiveEntry('undo-clear-a');
    act(() => runtime().motifClearWorkspace());
    expect(notice()).toBeNull();
    expect(runtime().motifGetInventory()).toEqual([]);
  });

  it('is withdrawn when the inventory is replaced', async () => {
    await loadRecords([recordInput('undo-render-a'), recordInput('undo-render-b')]);
    deleteActiveEntry('undo-render-a');
    await loadRecords([recordInput('undo-render-c')]);
    expect(notice()).toBeNull();
  });

  it('refuses on screen when a restored result links a record deleted since', async () => {
    await loadRecords([recordInput('undo-link-a'), recordInput('undo-link-b')]);
    act(() => {
      runtime().motifAddWorkflowResults({
        id: 'undo-link-digest',
        kind: 'digest',
        name: 'Digest',
        inputRecordIds: ['undo-link-a'],
        outputRecordIds: ['undo-link-b'],
        createdAt: '2026-01-01T00:00:00.000Z',
        provenance: { source: 'test' },
      });
    });
    const undo = deleteActiveEntry('undo-link-a');
    act(() => {
      runtime().motifRemoveRecords('undo-link-b');
    });
    act(() => undo.click());

    expect(notice()?.textContent).toContain('undo-link-a could not be restored, so the workspace is unchanged.');
    expect(runtime().motifGetInventory()).toEqual([]);
    // The workbench is still mounted: nothing reached the error boundary.
    expect(document.querySelector('section.motif-cs-panel[role="alert"]')).toBeNull();
  });
});

describe('adding a custom enzyme', () => {
  it('reports a duplicate even when the first add has not rendered yet', async () => {
    await loadRecords([recordInput('custom-enzyme-duplicate')]);
    const nameInput = document.querySelector<HTMLInputElement>('input[name="custom-enzyme-name"]')!;
    const recognitionInput = document.querySelector<HTMLInputElement>('input[name="custom-enzyme-recognition"]')!;
    act(() => {
      fireEvent.change(nameInput, { target: { value: 'TestCutter' } });
      fireEvent.change(recognitionInput, { target: { value: 'GGATCCAA' } });
    });
    act(() => {
      fireEvent.keyDown(recognitionInput, { key: 'Enter' });
      fireEvent.keyDown(recognitionInput, { key: 'Enter' });
    });
    const status = nameInput.closest('.motif-cs-add-enzyme')?.querySelector('[role="status"]');
    expect(status?.textContent).toBe('TestCutter is already added');
  });
});
