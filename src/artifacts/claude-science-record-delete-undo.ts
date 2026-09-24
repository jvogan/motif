import type { ArtifactDurableState } from './claude-science-session';

type WithId = { id: string };

/**
 * Puts back the items a delete removed (present in `before`, absent from
 * `after`) into the collection as it is now, each at its old index. Items that
 * were added or changed after the delete are kept; an item whose id is present
 * again is not duplicated.
 */
export function reinsertRemovedById<T extends WithId>(
  before: readonly T[],
  after: readonly T[],
  current: readonly T[],
): T[] {
  const afterIds = new Set(after.map((item) => item.id));
  const next = [...current];
  const present = new Set(current.map((item) => item.id));
  before.forEach((item, index) => {
    if (afterIds.has(item.id) || present.has(item.id)) return;
    next.splice(Math.min(index, next.length), 0, item);
    present.add(item.id);
  });
  return next;
}

type RecordDeleteWorkspace = {
  records: readonly WithId[];
  selectedRecordId: string;
  alignments: readonly WithId[];
  notes: readonly WithId[];
  workflowResults: readonly WithId[];
  analysisResults: readonly WithId[];
  analysisAssets: readonly WithId[];
};

const PER_RECORD_STATE_KEYS = [
  'translationLayersByRecord',
  'enzymeSourcesByRecord',
  'hiddenEnzymesByRecord',
  'hiddenFeatureTranslationsByRecord',
  'restrictionLabelsByRecord',
  'motifsByRecord',
] as const satisfies ReadonlyArray<keyof ArtifactDurableState>;

export type RecordDeleteUndoPlan<P, S> =
  | { ok: true; payload: P; artifactState: S }
  | { ok: false; message: string };

/**
 * Undo for deleting records from the workspace. The delete also removed the
 * record's alignments, notes, workflow results, analysis results and per-record
 * view state, so all of them come back, each at its old place. Work done
 * between the delete and the undo is kept. When a record with a deleted id
 * exists again, the undo refuses instead of making two records with one id.
 */
export function planRecordDeleteUndo<P extends RecordDeleteWorkspace, S extends ArtifactDurableState>(input: {
  before: P;
  after: P;
  current: P;
  beforeState: S;
  currentState: S;
  deletedRecordIds: readonly string[];
}): RecordDeleteUndoPlan<P, S> {
  const { before, after, current, beforeState, currentState, deletedRecordIds } = input;
  const currentRecordIds = new Set(current.records.map((record) => record.id));
  if (deletedRecordIds.some((id) => currentRecordIds.has(id))) {
    return { ok: false, message: 'A record with the same id is back in the workspace, so the delete cannot be undone.' };
  }
  const payload = {
    ...current,
    records: reinsertRemovedById(before.records, after.records, current.records),
    alignments: reinsertRemovedById(before.alignments, after.alignments, current.alignments),
    notes: reinsertRemovedById(before.notes, after.notes, current.notes),
    workflowResults: reinsertRemovedById(before.workflowResults, after.workflowResults, current.workflowResults),
    analysisResults: reinsertRemovedById(before.analysisResults, after.analysisResults, current.analysisResults),
    analysisAssets: reinsertRemovedById(before.analysisAssets, after.analysisAssets, current.analysisAssets),
    selectedRecordId: deletedRecordIds[0] ?? current.selectedRecordId,
  } as P;
  const artifactState = { ...currentState };
  for (const key of PER_RECORD_STATE_KEYS) {
    const restored: Record<string, unknown> = { ...currentState[key] };
    for (const id of deletedRecordIds) {
      const value = (beforeState[key] as Record<string, unknown>)[id];
      if (value !== undefined && restored[id] === undefined) restored[id] = value;
    }
    (artifactState as Record<string, unknown>)[key] = restored;
  }
  return { ok: true, payload, artifactState };
}
