import { describe, expect, it } from 'vitest';
import {
  circularRecordIdsOf,
  normalizeArtifactDurableState,
  type ArtifactDurableState,
  type PortableTranslationTrack,
} from '../claude-science-session';
import { applySequenceEditToAnchors } from '../claude-science-sequence-edit';
import {
  createArtifactDatabaseSnapshot,
  normalizeRecord,
  prepareArtifactDatabaseRestore,
} from '../motif-artifact';

// A translation pinned across the origin of a circular record is stored with
// its end past the record length, as a range dragged across the origin is. The
// checkpoint keeps it, and sequence edits move it without leaving it invalid.

const SEQUENCE = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATG';
const LENGTH = SEQUENCE.length;

// The last 6 bases of the record and its first 9.
const ACROSS: PortableTranslationTrack = {
  id: 'across',
  label: 'Across the origin',
  start: LENGTH - 6,
  end: LENGTH + 9,
  strand: 1,
  frame: 0,
  translationTableId: 1,
  source: 'layer',
};

function stateWith(layers: PortableTranslationTrack[]): ArtifactDurableState {
  return {
    customEnzymes: [],
    translationLayersByRecord: { ring: layers },
    enzymeSourcesByRecord: {},
    hiddenEnzymesByRecord: {},
    hiddenFeatureTranslationsByRecord: {},
    restrictionLabelsByRecord: {},
    motifsByRecord: {},
  };
}

function payloadWith(topology: 'circular' | 'linear') {
  const record = normalizeRecord({ id: 'ring', name: 'Ring', molecule: 'dna', topology, seq: SEQUENCE }, 0)!;
  return {
    schema: 'motif.inventory.v1',
    inventory: {},
    records: [record],
    selectedRecordId: 'ring',
    alignments: [],
    notes: [],
    workflowResults: [],
    analysisResults: [],
    analysisAssets: [],
  } as unknown as Parameters<typeof createArtifactDatabaseSnapshot>[0];
}

describe('a translation layer across the origin', () => {
  it('survives a checkpoint save and restore on a circular record', () => {
    const checkpoint = createArtifactDatabaseSnapshot(payloadWith('circular'), stateWith([ACROSS]));
    const restored = prepareArtifactDatabaseRestore(JSON.parse(JSON.stringify(checkpoint)));
    expect(restored.payload.records[0].topology).toBe('circular');
    expect(restored.artifactState.translationLayersByRecord.ring).toEqual([
      expect.objectContaining({ id: 'across', start: LENGTH - 6, end: LENGTH + 9, strand: 1, frame: 0 }),
    ]);
  });

  it('cannot be saved on a linear record', () => {
    expect(() => createArtifactDatabaseSnapshot(payloadWith('linear'), stateWith([ACROSS])))
      .toThrow(/linear record/i);
  });

  it('stays valid, or goes cleanly, when an edit shortens the record', () => {
    const edited = (start: number, deletedLength: number) => {
      const edit = { start, deletedLength, insertedLength: 0, oldLength: LENGTH };
      const { translationLayers, removedLayerCount } = applySequenceEditToAnchors({
        recordId: 'ring',
        notes: [],
        translationLayers: [ACROSS],
        edit,
        editedAt: '2026-07-18T18:00:00.000Z',
      });
      // The result passes the same check as a checkpoint of the shorter record.
      const newLength = LENGTH - deletedLength;
      const state = normalizeArtifactDurableState(
        stateWith(translationLayers),
        new Map([['ring', newLength]]),
        circularRecordIdsOf([{ id: 'ring', topology: 'circular' }]),
      );
      return { layers: state.translationLayersByRecord.ring, removedLayerCount, newLength };
    };

    // Bases between the two pieces: the layer keeps its 15 bases across the new origin.
    const between = edited(20, 10);
    expect(between.layers).toEqual([
      expect.objectContaining({ start: between.newLength - 6, end: between.newLength + 9 }),
    ]);
    expect(between.layers[0].needsReview).toBeUndefined();
    // Bases inside the piece before the origin.
    const tail = edited(LENGTH - 4, 2);
    expect(tail.layers).toEqual([
      expect.objectContaining({ start: tail.newLength - 4, end: tail.newLength + 9, needsReview: true }),
    ]);
    // The whole piece past the origin: the rest is an ordinary layer at the end of the record.
    const head = edited(0, 9);
    expect(head.layers).toEqual([
      expect.objectContaining({ start: head.newLength - 6, end: head.newLength, needsReview: true }),
    ]);
    // Every base of the layer but two: it is removed, not left shorter than a codon.
    const gone = edited(0, LENGTH - 2);
    expect(gone.layers).toEqual([]);
    expect(gone.removedLayerCount).toBe(1);
  });
});
