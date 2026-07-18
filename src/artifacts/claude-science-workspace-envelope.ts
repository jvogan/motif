import {
  normalizeArtifactDurableState,
  type ArtifactDurableState,
} from './claude-science-session';
import {
  normalizeArtifactWorkspaceCollections,
  type ArtifactNote,
  type ArtifactWorkflowResult,
} from './claude-science-workspace-collections';

export type NormalizedArtifactWorkspaceEnvelope = {
  notes: ArtifactNote[];
  workflowResults: ArtifactWorkflowResult[];
  artifactState: ArtifactDurableState;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const RECORD_KEYED_ARTIFACT_STATE_FIELDS = [
  'translationLayersByRecord',
  'enzymeSourcesByRecord',
  'hiddenEnzymesByRecord',
  'hiddenFeatureTranslationsByRecord',
  'restrictionLabelsByRecord',
  'motifsByRecord',
] as const;

function assertArtifactStateRecordKeys(
  artifactState: unknown,
  recordLengths: ReadonlyMap<string, number>,
): void {
  if (!isPlainObject(artifactState)) return;
  for (const field of RECORD_KEYED_ARTIFACT_STATE_FIELDS) {
    const recordMap = artifactState[field];
    if (!isPlainObject(recordMap)) continue;
    const unknownRecordIds = Object.keys(recordMap).filter((recordId) => !recordLengths.has(recordId));
    if (unknownRecordIds.length > 0) {
      throw new Error(
        `artifactState.${field} references unknown record id${unknownRecordIds.length === 1 ? '' : 's'}: `
        + unknownRecordIds.join(', '),
      );
    }
  }
}

function assertAlignmentRecordKeys(
  workspace: Record<string, unknown>,
  recordLengths: ReadonlyMap<string, number>,
): void {
  if (workspace.alignments !== undefined && !Array.isArray(workspace.alignments)) {
    throw new Error('Workspace alignments must be an array when provided.');
  }
  if (workspace.alignment !== undefined && !isPlainObject(workspace.alignment)) {
    throw new Error('Workspace alignment must be a plain object when provided.');
  }
  if (workspace.alignment !== undefined && workspace.alignments !== undefined) {
    throw new Error('Workspace must provide either alignment or alignments, not both.');
  }
  const alignments = Array.isArray(workspace.alignments)
    ? workspace.alignments
    : isPlainObject(workspace.alignment)
      ? [workspace.alignment]
      : [];
  const missingRecordIds = new Set<string>();
  for (const alignment of alignments) {
    if (!isPlainObject(alignment) || typeof alignment.alignedFasta === 'string') continue;
    const rows = Array.isArray(alignment.rows)
      ? alignment.rows
      : Array.isArray(alignment.sequences)
        ? alignment.sequences
        : [];
    for (const row of rows) {
      if (!isPlainObject(row) || typeof row.sourceRecordId !== 'string') continue;
      const recordId = row.sourceRecordId.trim();
      if (recordId && !recordLengths.has(recordId)) missingRecordIds.add(recordId);
    }
  }
  if (missingRecordIds.size > 0) {
    const ids = Array.from(missingRecordIds);
    throw new Error(
      `Alignment rows reference unknown record id${ids.length === 1 ? '' : 's'}: ${ids.join(', ')}`,
    );
  }
}

/**
 * Canonical validation seam shared by portable producers and the workbench.
 * It deliberately returns normalized clones without mutating or widening the
 * caller's payload; producers can use it for validation-only acceptance parity.
 */
export function normalizeArtifactWorkspaceEnvelope(
  value: unknown,
  recordLengths: ReadonlyMap<string, number>,
): NormalizedArtifactWorkspaceEnvelope {
  if (!isPlainObject(value)) throw new Error('Workspace payload must be a plain object.');
  const collections = normalizeArtifactWorkspaceCollections(value, { recordLengths });
  assertAlignmentRecordKeys(value, recordLengths);
  assertArtifactStateRecordKeys(value.artifactState, recordLengths);
  return {
    ...collections,
    artifactState: normalizeArtifactDurableState(value.artifactState, recordLengths),
  };
}
