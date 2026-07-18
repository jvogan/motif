import type {
  ArtifactJsonObject,
  ArtifactJsonValue,
  ArtifactNote,
  ArtifactSequenceRange,
} from './claude-science-workspace-collections';
import type { PortableTranslationTrack } from './claude-science-session';

const RANGE_ANCHOR_METADATA_KEY = 'motifRangeAnchor';

export type SequenceCoordinateEdit = {
  start: number;
  deletedLength: number;
  insertedLength: number;
  oldLength: number;
};

export type NoteAnchorSnapshot = {
  id: string;
  createdAt: string;
  updatedAt: string;
  hadProvenance: boolean;
  hadProvenanceMetadata: boolean;
  provenanceSource?: string;
  provenanceOperation?: string;
  scope: 'record' | 'range';
  range?: ArtifactSequenceRange;
  anchorMetadata?: ArtifactJsonValue;
};

export type RangeAnchorReview = {
  status: 'review' | 'detached';
  previousRange: ArtifactSequenceRange;
  currentRange?: ArtifactSequenceRange;
  edit: SequenceCoordinateEdit;
  editedAt: string;
};

export type SequenceAnchorEditResult = {
  notes: ArtifactNote[];
  translationLayers: PortableTranslationTrack[];
  adjustedNoteCount: number;
  detachedNoteCount: number;
  adjustedLayerCount: number;
  removedLayerCount: number;
};

type RangeTransform = {
  range: ArtifactSequenceRange | null;
  changed: boolean;
  overlapsMeaning: boolean;
};

function isJsonObject(value: ArtifactJsonValue | undefined): value is ArtifactJsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function assertSequenceEdit(edit: SequenceCoordinateEdit): void {
  const nextLength = edit.oldLength - edit.deletedLength + edit.insertedLength;
  if (
    !isNonNegativeInteger(edit.start) ||
    !isNonNegativeInteger(edit.deletedLength) ||
    !isNonNegativeInteger(edit.insertedLength) ||
    !isNonNegativeInteger(edit.oldLength) ||
    edit.start > edit.oldLength ||
    edit.start + edit.deletedLength > edit.oldLength ||
    !Number.isSafeInteger(nextLength) ||
    nextLength < 0
  ) {
    throw new Error('Sequence edits must use valid non-negative safe-integer coordinates and lengths.');
  }
}

function parseSequenceEdit(value: ArtifactJsonValue | undefined): SequenceCoordinateEdit | null {
  if (!isJsonObject(value)) return null;
  const { start, deletedLength, insertedLength, oldLength } = value;
  if (
    !isNonNegativeInteger(start) ||
    !isNonNegativeInteger(deletedLength) ||
    !isNonNegativeInteger(insertedLength) ||
    !isNonNegativeInteger(oldLength) ||
    start > oldLength ||
    start + deletedLength > oldLength ||
    !Number.isSafeInteger(oldLength - deletedLength + insertedLength)
  ) {
    return null;
  }
  return { start, deletedLength, insertedLength, oldLength };
}

function parseRange(value: ArtifactJsonValue | undefined): ArtifactSequenceRange | null {
  if (!isJsonObject(value)) return null;
  const { start, end } = value;
  if (!isNonNegativeInteger(start) || !isNonNegativeInteger(end) || end <= start) return null;
  return { start, end };
}

function rangesEqual(left: ArtifactSequenceRange, right: ArtifactSequenceRange): boolean {
  return left.start === right.start && left.end === right.end;
}

export function transformSequenceRange(
  range: ArtifactSequenceRange,
  edit: SequenceCoordinateEdit,
): RangeTransform {
  assertSequenceEdit(edit);
  if (
    range.start < 0 ||
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.end <= range.start ||
    range.end > edit.oldLength
  ) {
    throw new Error('Sequence edit and anchor ranges must use valid 0-based half-open coordinates.');
  }
  const deleteEnd = edit.start + edit.deletedLength;
  const deletionOverlaps =
    edit.deletedLength > 0 && edit.start < range.end && deleteEnd > range.start;
  const insertionChangesMeaning =
    edit.insertedLength > 0 && edit.start > range.start && edit.start < range.end;

  let start: number;
  let end: number;
  if (edit.deletedLength === 0) {
    start = range.start;
    end = range.end;
    if (edit.start <= start) {
      start += edit.insertedLength;
      end += edit.insertedLength;
    } else if (edit.start < end) {
      end += edit.insertedLength;
    }
  } else if (deleteEnd <= range.start) {
    const delta = edit.insertedLength - edit.deletedLength;
    start = range.start + delta;
    end = range.end + delta;
  } else if (edit.start >= range.end) {
    start = range.start;
    end = range.end;
  } else {
    // The edit intersects the anchor. Deleted boundaries clamp to the replacement
    // interval, while surviving boundaries retain their half-open affinity.
    start = range.start < edit.start
      ? range.start
      : range.start >= deleteEnd
        ? range.start + edit.insertedLength - edit.deletedLength
        : edit.start;
    end = range.end <= edit.start
      ? range.end
      : range.end >= deleteEnd
        ? range.end + edit.insertedLength - edit.deletedLength
        : edit.start + edit.insertedLength;
  }

  const transformed = end > start ? { start, end } : null;
  return {
    range: transformed,
    changed: transformed === null || !rangesEqual(range, transformed),
    overlapsMeaning: deletionOverlaps || insertionChangesMeaning,
  };
}

function reviewMetadata(
  status: RangeAnchorReview['status'],
  previousRange: ArtifactSequenceRange,
  currentRange: ArtifactSequenceRange | null,
  edit: SequenceCoordinateEdit,
  editedAt: string,
): ArtifactJsonObject {
  return {
    status,
    previousRange: { ...previousRange },
    ...(currentRange ? { currentRange: { ...currentRange } } : {}),
    edit: { ...edit },
    editedAt,
  };
}

function updateNoteAnchor(
  note: ArtifactNote,
  transformed: RangeTransform,
  edit: SequenceCoordinateEdit,
  editedAt: string,
): ArtifactNote {
  const previousRange = note.range as ArtifactSequenceRange;
  const detached = transformed.range === null;
  const existingReview = getNoteRangeAnchorReview(note);
  const needsReview = detached || transformed.overlapsMeaning || existingReview !== null;
  const preservesExistingReviewCause = existingReview !== null
    && !detached
    && !transformed.overlapsMeaning;
  const reviewPreviousRange = existingReview?.previousRange ?? previousRange;
  const metadata: ArtifactJsonObject = {
    ...(note.provenance?.metadata ?? {}),
    [RANGE_ANCHOR_METADATA_KEY]: needsReview
      ? reviewMetadata(
          detached ? 'detached' : 'review',
          reviewPreviousRange,
          transformed.range,
          preservesExistingReviewCause ? existingReview.edit : edit,
          preservesExistingReviewCause ? existingReview.editedAt : editedAt,
        )
      : {
          status: 'shifted',
          previousRange: { ...previousRange },
          ...(transformed.range ? { currentRange: { ...transformed.range } } : {}),
          edit: { ...edit },
          editedAt,
        },
  };

  return {
    ...note,
    scope: detached ? 'record' : 'range',
    ...(detached ? { range: undefined } : { range: transformed.range as ArtifactSequenceRange }),
    updatedAt: preservesExistingReviewCause ? note.updatedAt : editedAt,
    provenance: {
      ...note.provenance,
      source: note.provenance?.source ?? 'motif-for-claude-science-artifact',
      operation: detached
        ? 'sequence_edit_anchor_detached'
        : needsReview
          ? 'sequence_edit_anchor_review'
          : 'sequence_edit_anchor_shift',
      metadata,
    },
  };
}

export function applySequenceEditToAnchors(input: {
  recordId: string;
  notes: ArtifactNote[];
  translationLayers: PortableTranslationTrack[];
  edit: SequenceCoordinateEdit;
  editedAt: string;
}): SequenceAnchorEditResult {
  const { recordId, edit, editedAt } = input;
  assertSequenceEdit(edit);
  let adjustedNoteCount = 0;
  let detachedNoteCount = 0;
  const notes = input.notes.map((note) => {
    if (note.scope !== 'range' || note.recordId !== recordId || !note.range) return note;
    const transformed = transformSequenceRange(note.range, edit);
    if (!transformed.changed && !transformed.overlapsMeaning) return note;
    adjustedNoteCount += 1;
    if (!transformed.range) detachedNoteCount += 1;
    return updateNoteAnchor(note, transformed, edit, editedAt);
  });

  let adjustedLayerCount = 0;
  let removedLayerCount = 0;
  const translationLayers = input.translationLayers.flatMap((layer) => {
    const originalLength = layer.end - layer.start;
    const transformed = transformSequenceRange({ start: layer.start, end: layer.end }, edit);
    const collapsedByEdit = transformed.range
      ? originalLength >= 3 && transformed.range.end - transformed.range.start < 3
      : true;
    if (!transformed.range || collapsedByEdit) {
      removedLayerCount += 1;
      return [];
    }
    if (!transformed.changed && !transformed.overlapsMeaning) return [layer];
    adjustedLayerCount += 1;
    return [
      {
        ...layer,
        start: transformed.range.start,
        end: transformed.range.end,
        ...(layer.needsReview || transformed.overlapsMeaning ? { needsReview: true } : {}),
      },
    ];
  });

  return {
    notes,
    translationLayers,
    adjustedNoteCount,
    detachedNoteCount,
    adjustedLayerCount,
    removedLayerCount,
  };
}

export function getNoteRangeAnchorReview(note: ArtifactNote): RangeAnchorReview | null {
  const raw = note.provenance?.metadata?.[RANGE_ANCHOR_METADATA_KEY];
  if (!isJsonObject(raw)) return null;
  if (raw.status !== 'review' && raw.status !== 'detached') return null;
  const previousRange = parseRange(raw.previousRange);
  const currentRange = parseRange(raw.currentRange);
  const edit = parseSequenceEdit(raw.edit);
  if (!previousRange || !edit || typeof raw.editedAt !== 'string') return null;
  return {
    status: raw.status,
    previousRange,
    ...(currentRange ? { currentRange } : {}),
    edit,
    editedAt: raw.editedAt,
  };
}

export function confirmNoteRangeAnchor(note: ArtifactNote, confirmedAt: string): ArtifactNote {
  if (!getNoteRangeAnchorReview(note)) return note;
  const metadata = { ...(note.provenance?.metadata ?? {}) };
  delete metadata[RANGE_ANCHOR_METADATA_KEY];
  return {
    ...note,
    updatedAt: confirmedAt,
    provenance: {
      ...note.provenance,
      source: note.provenance?.source ?? 'motif-for-claude-science-artifact',
      operation: 'sequence_edit_anchor_confirmed',
      metadata,
    },
  };
}

export function snapshotNoteAnchors(notes: ArtifactNote[], recordId: string): NoteAnchorSnapshot[] {
  return notes.flatMap((note) => {
    if (note.recordId !== recordId || (note.scope !== 'record' && note.scope !== 'range')) return [];
    const anchorMetadata = note.provenance?.metadata?.[RANGE_ANCHOR_METADATA_KEY];
    return [
      {
        id: note.id,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        hadProvenance: note.provenance !== undefined,
        hadProvenanceMetadata: note.provenance?.metadata !== undefined,
        ...(note.provenance?.source ? { provenanceSource: note.provenance.source } : {}),
        ...(note.provenance?.operation ? { provenanceOperation: note.provenance.operation } : {}),
        scope: note.scope,
        ...(note.range ? { range: { ...note.range } } : {}),
        ...(anchorMetadata !== undefined ? { anchorMetadata } : {}),
      },
    ];
  });
}

export function restoreNoteAnchors(
  notes: ArtifactNote[],
  recordId: string,
  targetSnapshots: NoteAnchorSnapshot[],
  expectedCurrentSnapshots: NoteAnchorSnapshot[],
): ArtifactNote[] {
  const targetSnapshotsById = new Map(targetSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const expectedCurrentSnapshotsById = new Map(
    expectedCurrentSnapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  return notes.map((note) => {
    if (note.recordId !== recordId) return note;
    const snapshot = targetSnapshotsById.get(note.id);
    if (!snapshot || snapshot.createdAt !== note.createdAt) return note;
    const expectedCurrent = expectedCurrentSnapshotsById.get(note.id);
    const currentAnchorMetadata = note.provenance?.metadata?.[RANGE_ANCHOR_METADATA_KEY];
    const currentMatchesExpectedSnapshot = expectedCurrent !== undefined
      && expectedCurrent.createdAt === note.createdAt
      && expectedCurrent.updatedAt === note.updatedAt
      && expectedCurrent.scope === note.scope
      && (
        expectedCurrent.range === undefined
          ? note.range === undefined
          : note.range !== undefined && rangesEqual(expectedCurrent.range, note.range)
      )
      && expectedCurrent.hadProvenance === (note.provenance !== undefined)
      && expectedCurrent.hadProvenanceMetadata === (note.provenance?.metadata !== undefined)
      && expectedCurrent.provenanceSource === note.provenance?.source
      && expectedCurrent.provenanceOperation === note.provenance?.operation
      && JSON.stringify(expectedCurrent.anchorMetadata) === JSON.stringify(currentAnchorMetadata);
    const independentNoteEdit = !currentMatchesExpectedSnapshot;
    const metadata = { ...(note.provenance?.metadata ?? {}) };
    if (snapshot.anchorMetadata === undefined) {
      delete metadata[RANGE_ANCHOR_METADATA_KEY];
    } else {
      metadata[RANGE_ANCHOR_METADATA_KEY] = snapshot.anchorMetadata;
    }
    const restoredProvenance = independentNoteEdit
      ? note.provenance && {
          ...note.provenance,
          ...(Object.keys(metadata).length > 0 || note.provenance.metadata !== undefined
            ? { metadata }
            : { metadata: undefined }),
        }
      : !snapshot.hadProvenance
        ? undefined
        : {
            ...(note.provenance as NonNullable<ArtifactNote['provenance']>),
            source: snapshot.provenanceSource
              ?? note.provenance?.source
              ?? 'motif-for-claude-science-artifact',
            ...(snapshot.provenanceOperation
              ? { operation: snapshot.provenanceOperation }
              : { operation: undefined }),
            ...(
              snapshot.hadProvenanceMetadata || snapshot.anchorMetadata !== undefined
                ? { metadata }
                : { metadata: undefined }
            ),
          };
    return {
      ...note,
      scope: snapshot.scope,
      ...(snapshot.range ? { range: { ...snapshot.range } } : { range: undefined }),
      updatedAt: independentNoteEdit ? note.updatedAt : snapshot.updatedAt,
      provenance: restoredProvenance,
    };
  });
}
