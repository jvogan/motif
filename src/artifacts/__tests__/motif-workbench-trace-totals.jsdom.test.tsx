// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';
import { ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES } from '../claude-science-sanger';

// The per-edit checkpoint check revalidates only the edited record, but the
// limits that span records still hold: an Undo that would bring the workspace
// over its trace-sample total is refused, so the workspace stays exportable.

type RuntimeRecord = { id: string; seq: string; sangerTrace?: unknown };
type RuntimeWindow = {
  motifGetInventory: () => RuntimeRecord[];
  motifAddRecords: (records: unknown) => number;
  motifGetWorkspace: () => Record<string, unknown>;
  motifReplaceWorkspace: (workspace: unknown, options?: { discardUnsavedChanges?: boolean }) => number;
};
const runtime = () => window as unknown as RuntimeWindow;
const sequenceField = () => document.querySelector<HTMLElement>('.motif-cs-sequence')!;
const notice = () => document.querySelector<HTMLElement>('.motif-cs-workbench-notice');
const press = (target: Element, key: string, init: KeyboardEventInit = {}) => act(() => {
  fireEvent.keyDown(target, { key, ...init });
});

const SEQUENCE = 'ACGTAGCTTGCAAGTC'.repeat(12);
// Half the workspace total in one trace: four channels at the per-channel cap.
const CHANNEL_LENGTH = ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES / 8;

function tracedRecord(id: string) {
  const channel = () => new Array<number>(CHANNEL_LENGTH).fill(0);
  return {
    id,
    name: id,
    molecule: 'dna',
    topology: 'linear',
    seq: SEQUENCE,
    sangerTrace: {
      schema: 'motif.sanger-trace.v1',
      version: 1,
      baseCalls: SEQUENCE,
      sequence: SEQUENCE,
      qualityScores: Array.from({ length: SEQUENCE.length }, () => 30),
      peakPositions: Array.from({ length: SEQUENCE.length }, (_, index) => index * 10),
      channels: { A: channel(), C: channel(), G: channel(), T: channel() },
      sampleCount: CHANNEL_LENGTH,
      dyeOrder: null,
      storedReverseComplement: false,
      warnings: [],
      metadata: {
        format: 'ABIF',
        abifVersion: 101,
        baseCallsTag: 'PBAS2',
        qualityScoresTag: 'PCON2',
        peakPositionsTag: 'PLOC2',
        channelTags: {},
        sampleName: id,
      },
    },
  };
}

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

describe('an Undo that would exceed the workspace trace total', () => {
  it('is refused on screen and the workspace stays exportable', async () => {
    await act(async () => {
      runtime().motifReplaceWorkspace({ records: [tracedRecord('trace-a'), tracedRecord('trace-b')] }, { discardUnsavedChanges: true });
    });
    expect(runtime().motifGetInventory().map((record) => record.id)).toEqual(['trace-a', 'trace-b']);

    // An edit to A drops its trace, which frees room for C.
    const field = sequenceField();
    act(() => field.focus());
    await press(field, 'ArrowRight');
    await press(field, 'g');
    const edited = runtime().motifGetInventory()[0];
    expect(edited.sangerTrace).toBeUndefined();
    await act(async () => {
      expect(runtime().motifAddRecords(tracedRecord('trace-c'))).toBe(1);
    });

    // Adding C opened it; go back to A. Undoing A's edit would bring its trace
    // back: three full traces.
    const tabA = document.querySelector<HTMLButtonElement>('.motif-cs-record-tab[aria-label="trace-a"]')!;
    act(() => tabA.click());
    act(() => sequenceField().focus());
    await press(sequenceField(), 'z', { ctrlKey: true });
    expect(notice()?.textContent).toContain('That step could not be restored, so the record is unchanged.');
    const [afterUndo] = runtime().motifGetInventory();
    expect(afterUndo.seq).toBe(edited.seq);
    expect(afterUndo.sangerTrace).toBeUndefined();
    expect(() => runtime().motifGetWorkspace()).not.toThrow();
    expect(document.querySelector('section.motif-cs-panel[role="alert"]')).toBeNull();
  }, 120_000);
});
