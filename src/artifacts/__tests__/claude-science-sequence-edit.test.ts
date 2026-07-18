import { describe, expect, it } from 'vitest';
import type { ArtifactNote } from '../claude-science-workspace-collections';
import type { PortableTranslationTrack } from '../claude-science-session';
import {
  applySequenceEditToAnchors,
  confirmNoteRangeAnchor,
  getNoteRangeAnchorReview,
  restoreNoteAnchors,
  snapshotNoteAnchors,
  transformSequenceRange,
} from '../claude-science-sequence-edit';

const EDITED_AT = '2026-07-18T18:00:00.000Z';

function rangeNote(range = { start: 8, end: 12 }): ArtifactNote {
  return {
    id: 'note-1',
    title: 'Binding site',
    body: 'Keep this scientific observation attached.',
    format: 'plain',
    scope: 'range',
    recordId: 'record-1',
    range,
    createdAt: '2026-07-17T18:00:00.000Z',
    updatedAt: '2026-07-17T18:00:00.000Z',
    provenance: { source: 'user', metadata: { retained: true } },
  };
}

function translationLayer(range = { start: 6, end: 15 }): PortableTranslationTrack {
  return {
    id: 'translation-1',
    label: 'Candidate ORF',
    start: range.start,
    end: range.end,
    strand: 1,
    frame: 0,
    translationTableId: 1,
    source: 'layer',
  };
}

describe('sequence-edit anchor transactions', () => {
  it('shifts anchors after an insertion without asking for scientific review', () => {
    const result = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [rangeNote()],
      translationLayers: [translationLayer()],
      edit: { start: 3, deletedLength: 0, insertedLength: 2, oldLength: 20 },
      editedAt: EDITED_AT,
    });

    expect(result.notes[0].range).toEqual({ start: 10, end: 14 });
    expect(getNoteRangeAnchorReview(result.notes[0])).toBeNull();
    expect(result.translationLayers[0]).toMatchObject({ start: 8, end: 17 });
    expect(result.translationLayers[0].needsReview).toBeUndefined();
  });

  it('expands an intersected range and marks both scientific anchors for review', () => {
    const result = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [rangeNote()],
      translationLayers: [translationLayer()],
      edit: { start: 10, deletedLength: 0, insertedLength: 3, oldLength: 20 },
      editedAt: EDITED_AT,
    });

    expect(result.notes[0].range).toEqual({ start: 8, end: 15 });
    expect(getNoteRangeAnchorReview(result.notes[0])).toEqual({
      status: 'review',
      previousRange: { start: 8, end: 12 },
      currentRange: { start: 8, end: 15 },
      edit: { start: 10, deletedLength: 0, insertedLength: 3, oldLength: 20 },
      editedAt: EDITED_AT,
    });
    expect(result.translationLayers[0]).toMatchObject({ start: 6, end: 18, needsReview: true });
    expect(result.adjustedNoteCount).toBe(1);
    expect(result.adjustedLayerCount).toBe(1);
  });

  it('does not clear a pending scientific review when a later edit only shifts it', () => {
    const first = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [rangeNote()],
      translationLayers: [],
      edit: { start: 10, deletedLength: 0, insertedLength: 3, oldLength: 20 },
      editedAt: EDITED_AT,
    }).notes;
    const second = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: first,
      translationLayers: [],
      edit: { start: 3, deletedLength: 0, insertedLength: 2, oldLength: 23 },
      editedAt: '2026-07-18T18:01:00.000Z',
    }).notes[0];

    expect(getNoteRangeAnchorReview(second)).toMatchObject({
      status: 'review',
      previousRange: { start: 8, end: 12 },
      currentRange: { start: 10, end: 17 },
      edit: { start: 10, deletedLength: 0, insertedLength: 3, oldLength: 20 },
      editedAt: EDITED_AT,
    });
    expect(second.updatedAt).toBe(EDITED_AT);
  });

  it('treats half-open insertion boundaries explicitly', () => {
    expect(transformSequenceRange(
      { start: 8, end: 12 },
      { start: 8, deletedLength: 0, insertedLength: 2, oldLength: 20 },
    ).range).toEqual({ start: 10, end: 14 });
    expect(transformSequenceRange(
      { start: 8, end: 12 },
      { start: 12, deletedLength: 0, insertedLength: 2, oldLength: 20 },
    )).toEqual({
      range: { start: 8, end: 12 },
      changed: false,
      overlapsMeaning: false,
    });
  });

  it('keeps substitution coordinates stable while flagging changed contents', () => {
    expect(transformSequenceRange(
      { start: 8, end: 12 },
      { start: 8, deletedLength: 1, insertedLength: 1, oldLength: 20 },
    )).toEqual({
      range: { start: 8, end: 12 },
      changed: false,
      overlapsMeaning: true,
    });

    const result = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [rangeNote()],
      translationLayers: [translationLayer()],
      edit: { start: 9, deletedLength: 1, insertedLength: 1, oldLength: 20 },
      editedAt: EDITED_AT,
    });
    expect(result.notes[0].range).toEqual({ start: 8, end: 12 });
    expect(getNoteRangeAnchorReview(result.notes[0])?.status).toBe('review');
    expect(result.translationLayers[0]).toMatchObject({ start: 6, end: 15, needsReview: true });
  });

  it('clamps deletions and replacements across every interval relationship', () => {
    const range = { start: 10, end: 20 };
    const transform = (start: number, deletedLength: number, insertedLength = 0) => (
      transformSequenceRange(range, { start, deletedLength, insertedLength, oldLength: 30 })
    );

    expect(transform(2, 3)).toMatchObject({ range: { start: 7, end: 17 }, overlapsMeaning: false });
    expect(transform(8, 4)).toMatchObject({ range: { start: 8, end: 16 }, overlapsMeaning: true });
    expect(transform(13, 3)).toMatchObject({ range: { start: 10, end: 17 }, overlapsMeaning: true });
    expect(transform(18, 5)).toMatchObject({ range: { start: 10, end: 18 }, overlapsMeaning: true });
    expect(transform(8, 15)).toMatchObject({ range: null, overlapsMeaning: true });
    expect(transform(20, 2)).toMatchObject({ range, overlapsMeaning: false });
    expect(transform(8, 15, 4)).toMatchObject({ range: { start: 8, end: 12 }, overlapsMeaning: true });
    expect(transformSequenceRange(range, {
      start: 15,
      deletedLength: 0,
      insertedLength: 0,
      oldLength: 30,
    })).toEqual({ range, changed: false, overlapsMeaning: false });
  });

  it('rejects unsafe or out-of-bounds edit descriptors without mutating the input range', () => {
    const range = Object.freeze({ start: 2, end: 8 });
    expect(() => transformSequenceRange(range, {
      start: 9,
      deletedLength: 2,
      insertedLength: 0,
      oldLength: 10,
    })).toThrow(/safe-integer coordinates/i);
    expect(() => transformSequenceRange(range, {
      start: Number.MAX_SAFE_INTEGER + 1,
      deletedLength: 0,
      insertedLength: 1,
      oldLength: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow(/safe-integer coordinates/i);
    expect(range).toEqual({ start: 2, end: 8 });
  });

  it('detaches a fully deleted note and removes a collapsed translation layer', () => {
    const result = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [rangeNote({ start: 8, end: 10 })],
      translationLayers: [translationLayer({ start: 8, end: 11 })],
      edit: { start: 7, deletedLength: 5, insertedLength: 0, oldLength: 20 },
      editedAt: EDITED_AT,
    });

    expect(result.notes[0]).toMatchObject({ scope: 'record', recordId: 'record-1' });
    expect(result.notes[0].range).toBeUndefined();
    expect(getNoteRangeAnchorReview(result.notes[0])?.status).toBe('detached');
    expect(result.translationLayers).toEqual([]);
    expect(result.detachedNoteCount).toBe(1);
    expect(result.removedLayerCount).toBe(1);
  });

  it('preserves a valid imported short layer through an unrelated sequence edit', () => {
    const result = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [],
      translationLayers: [translationLayer({ start: 8, end: 10 })],
      edit: { start: 3, deletedLength: 0, insertedLength: 2, oldLength: 20 },
      editedAt: EDITED_AT,
    });

    expect(result.translationLayers).toEqual([
      expect.objectContaining({ start: 10, end: 12 }),
    ]);
    expect(result.adjustedLayerCount).toBe(1);
    expect(result.removedLayerCount).toBe(0);
  });

  it('restores anchors for undo without overwriting later note text', () => {
    const original = rangeNote();
    const snapshots = snapshotNoteAnchors([original], 'record-1');
    const edited = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [original],
      translationLayers: [],
      edit: { start: 10, deletedLength: 0, insertedLength: 3, oldLength: 20 },
      editedAt: EDITED_AT,
    }).notes[0];
    const expectedCurrentSnapshots = snapshotNoteAnchors([edited], 'record-1');
    const laterText = {
      ...edited,
      body: 'Edited after the base change.',
      updatedAt: '2026-07-18T18:05:00.000Z',
      provenance: {
        source: 'curation-agent',
        operation: 'curate_note',
        metadata: { ...edited.provenance?.metadata, curationPass: 2 },
      },
    };

    const [restored] = restoreNoteAnchors(
      [laterText],
      'record-1',
      snapshots,
      expectedCurrentSnapshots,
    );
    expect(restored.body).toBe('Edited after the base change.');
    expect(restored.range).toEqual({ start: 8, end: 12 });
    expect(getNoteRangeAnchorReview(restored)).toBeNull();
    expect(restored.updatedAt).toBe('2026-07-18T18:05:00.000Z');
    expect(restored.provenance).toEqual({
      source: 'curation-agent',
      operation: 'curate_note',
      metadata: { curationPass: 2, retained: true },
    });
  });

  it('restores an untouched note attachment byte-for-byte for clean undo', () => {
    const original = rangeNote();
    const snapshots = snapshotNoteAnchors([original], 'record-1');
    const edited = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [original],
      translationLayers: [],
      edit: { start: 10, deletedLength: 1, insertedLength: 1, oldLength: 20 },
      editedAt: EDITED_AT,
    }).notes;

    expect(restoreNoteAnchors(
      edited,
      'record-1',
      snapshots,
      snapshotNoteAnchors(edited, 'record-1'),
    )).toEqual([original]);
  });

  it('round-trips clean note provenance and timestamps through undo and redo', () => {
    const original = rangeNote();
    const before = snapshotNoteAnchors([original], 'record-1');
    const edited = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [original],
      translationLayers: [],
      edit: { start: 10, deletedLength: 0, insertedLength: 1, oldLength: 20 },
      editedAt: EDITED_AT,
    }).notes;
    const after = snapshotNoteAnchors(edited, 'record-1');

    const undone = restoreNoteAnchors(edited, 'record-1', before, after);
    const redone = restoreNoteAnchors(undone, 'record-1', after, before);

    expect(undone).toEqual([original]);
    expect(redone).toEqual(edited);
  });

  it('clears an acknowledged review marker while preserving unrelated provenance', () => {
    const edited = applySequenceEditToAnchors({
      recordId: 'record-1',
      notes: [rangeNote()],
      translationLayers: [],
      edit: { start: 10, deletedLength: 0, insertedLength: 1, oldLength: 20 },
      editedAt: EDITED_AT,
    }).notes[0];
    const confirmed = confirmNoteRangeAnchor(edited, '2026-07-18T18:10:00.000Z');

    expect(getNoteRangeAnchorReview(confirmed)).toBeNull();
    expect(confirmed.provenance?.metadata?.retained).toBe(true);
    expect(confirmed.provenance?.operation).toBe('sequence_edit_anchor_confirmed');
  });
});
