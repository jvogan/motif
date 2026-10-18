// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';

type RuntimeRecord = { id: string; seq: string; active?: boolean };
type RuntimeWindow = {
  motifGetInventory: () => RuntimeRecord[];
  motifGetActiveRecord: () => RuntimeRecord | null;
  motifRenderInventory: (records: unknown[]) => void;
  motifAddRecords: (records: unknown) => number;
  motifGetWorkspace: () => Record<string, unknown>;
};
const runtime = () => window as unknown as RuntimeWindow;
const sequenceField = () => document.querySelector<HTMLElement>('.motif-cs-sequence')!;
const BASE_SEQUENCE = 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCA'.repeat(4);

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

describe('a record added with active: false', () => {
  it('is refused before anything is added, so edits and checkpoints keep working', async () => {
    await act(async () => {
      runtime().motifRenderInventory([{ id: 'inactive-host', name: 'inactive-host', molecule: 'dna', topology: 'linear', seq: BASE_SEQUENCE }]);
    });
    await waitFor(() => expect(runtime().motifGetInventory().map((record) => record.id)).toEqual(['inactive-host']));

    let error: unknown = null;
    await act(async () => {
      try {
        runtime().motifAddRecords([
          { id: 'inactive-ok', name: 'inactive-ok', molecule: 'dna', topology: 'linear', seq: BASE_SEQUENCE },
          { id: 'inactive-off', name: 'inactive-off', molecule: 'dna', topology: 'linear', seq: BASE_SEQUENCE, active: false },
        ]);
      } catch (caught) {
        error = caught;
      }
    });
    expect(error).toMatchObject({
      code: 'MOTIF_INVALID_RECORD_INPUT',
      details: { operation: 'motifAddRecords', mutated: false, issues: [{ index: 1, code: 'inactive_record' }] },
    });
    expect(runtime().motifGetInventory().map((record) => record.id)).toEqual(['inactive-host']);

    const field = sequenceField();
    act(() => field.focus());
    act(() => { fireEvent.keyDown(field, { key: 'ArrowRight' }); });
    act(() => { fireEvent.keyDown(field, { key: 'g' }); });
    expect(runtime().motifGetActiveRecord()?.seq.slice(0, 3)).toBe('GCG');
    expect(() => runtime().motifGetWorkspace()).not.toThrow();

    // The active records of a batch are added once the inactive one is omitted.
    let added = 0;
    await act(async () => {
      added = runtime().motifAddRecords([{ id: 'inactive-ok', name: 'inactive-ok', molecule: 'dna', topology: 'linear', seq: BASE_SEQUENCE }]);
    });
    expect(added).toBe(1);
  });
});
