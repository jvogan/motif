/**
 * Pure freshness evaluation for portable scientific results.
 *
 * A saved result is fresh only when every current input can be matched to its
 * saved attestation. Missing records and positive mismatches are stale; missing
 * or malformed attestations are unverified. The evaluators never mutate the
 * supplied records/results and never read wall-clock or browser state.
 */

import type { Topology } from '../bio/types';
import type { ArtifactAnalysisResult } from './claude-science-analysis-results';
import type { ArtifactAlignment } from './claude-science-msa';
import { SHA256_HEX_PATTERN, sha256HexSync } from './claude-science-sha256';
import type { ArtifactWorkflowResult } from './claude-science-workspace-collections';

export type ScientificFreshnessState = 'fresh' | 'stale' | 'unverified';
export type ScientificFreshnessReasonState = Exclude<ScientificFreshnessState, 'fresh'>;

export const CONSTRUCT_READ_EVIDENCE_SCHEMA = 'motif.construct-read-evidence.v1';

export type ScientificFreshnessReasonCode =
  | 'record_missing'
  | 'sequence_attestation_missing'
  | 'sequence_attestation_invalid'
  | 'sequence_hash_mismatch'
  | 'topology_attestation_missing'
  | 'topology_attestation_invalid'
  | 'topology_mismatch'
  | 'end_chemistry_attestation_missing'
  | 'end_chemistry_attestation_invalid'
  | 'end_chemistry_missing'
  | 'end_chemistry_mismatch'
  | 'sanger_evidence_attestation_missing'
  | 'sanger_evidence_attestation_invalid'
  | 'sanger_evidence_attestation_misaligned'
  | 'sanger_evidence_missing'
  | 'sanger_evidence_hash_mismatch'
  | 'alignment_row_source_unattested';

export type ScientificFreshnessField =
  | 'sequence'
  | 'topology'
  | 'left_end'
  | 'right_end'
  | 'sanger_evidence'
  | 'source_record';

export type ScientificFreshnessReason = {
  code: ScientificFreshnessReasonCode;
  state: ScientificFreshnessReasonState;
  message: string;
  recordId?: string;
  rowId?: string;
  field?: ScientificFreshnessField;
  expected?: string;
  actual?: string;
};

export type ScientificFreshnessEvaluation = {
  state: ScientificFreshnessState;
  reasons: ScientificFreshnessReason[];
  affectedRecordIds: string[];
};

export type ScientificFreshnessEndType = 'blunt' | '5prime' | '3prime';

/** Structural subset accepted directly from the workbench's private record type. */
export type ScientificFreshnessRecord = {
  id: string;
  sequence: string;
  topology: Topology;
  overhang5?: string;
  overhang3?: string;
  overhang5Type?: ScientificFreshnessEndType;
  overhang3Type?: ScientificFreshnessEndType;
  /** SHA-256 of the bounded Sanger evidence payload, separate from sequence identity. */
  sangerEvidenceSha256?: string;
};

/** Compact immutable-by-convention lookup entry shared across batch evaluations. */
export type ScientificFreshnessRecordSnapshot = {
  id: string;
  sequenceSha256: string;
  topology: Topology;
  overhang5?: string;
  overhang3?: string;
  overhang5Type?: ScientificFreshnessEndType;
  overhang3Type?: ScientificFreshnessEndType;
  sangerEvidenceSha256?: string;
};

export type ScientificFreshnessRecordIndex = ReadonlyMap<string, ScientificFreshnessRecordSnapshot>;

type SavedEnd = {
  sequence: string;
  type: ScientificFreshnessEndType;
};

type SavedEndAttestations = {
  left?: SavedEnd;
  right?: SavedEnd;
  invalidLeft?: boolean;
  invalidRight?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTopology(value: unknown): value is Topology {
  return value === 'linear' || value === 'circular';
}

function normalizedEndSequence(value: string): string {
  return value.toUpperCase();
}

function formatEnd(end: SavedEnd): string {
  return `${end.type}:${normalizedEndSequence(end.sequence) || 'blunt'}`;
}

function savedEnd(value: unknown): SavedEnd | null {
  if (!isPlainObject(value)) return null;
  const type = value.type;
  const sequence = value.sequence;
  if (type !== 'blunt' && type !== '5prime' && type !== '3prime') return null;
  if (typeof sequence !== 'string') return null;
  const normalizedSequence = normalizedEndSequence(sequence);
  if (type === 'blunt' ? normalizedSequence !== '' : !/^[ACGT]+$/.test(normalizedSequence)) return null;
  return { type, sequence: normalizedSequence };
}

function reason(
  code: ScientificFreshnessReasonCode,
  state: ScientificFreshnessReasonState,
  message: string,
  details: Omit<ScientificFreshnessReason, 'code' | 'state' | 'message'> = {},
): ScientificFreshnessReason {
  return { code, state, message, ...details };
}

function finishEvaluation(reasons: ScientificFreshnessReason[]): ScientificFreshnessEvaluation {
  const state: ScientificFreshnessState = reasons.some((entry) => entry.state === 'stale')
    ? 'stale'
    : reasons.length > 0
      ? 'unverified'
      : 'fresh';
  const affectedRecordIds = Array.from(new Set(
    reasons.flatMap((entry) => entry.recordId === undefined ? [] : [entry.recordId]),
  ));
  return { state, reasons, affectedRecordIds };
}

/** Hash current sequences once, then reuse this Map for any number of results. */
export function createScientificFreshnessRecordIndex(
  records: readonly ScientificFreshnessRecord[],
): Map<string, ScientificFreshnessRecordSnapshot> {
  const index = new Map<string, ScientificFreshnessRecordSnapshot>();
  for (const record of records) {
    index.set(record.id, {
      id: record.id,
      sequenceSha256: sha256HexSync(record.sequence),
      topology: record.topology,
      ...(record.overhang5 === undefined ? {} : { overhang5: normalizedEndSequence(record.overhang5) }),
      ...(record.overhang3 === undefined ? {} : { overhang3: normalizedEndSequence(record.overhang3) }),
      ...(record.overhang5Type === undefined ? {} : { overhang5Type: record.overhang5Type }),
      ...(record.overhang3Type === undefined ? {} : { overhang3Type: record.overhang3Type }),
      ...(record.sangerEvidenceSha256 !== undefined && SHA256_HEX_PATTERN.test(record.sangerEvidenceSha256)
        ? { sangerEvidenceSha256: record.sangerEvidenceSha256.toLowerCase() }
        : {}),
    });
  }
  return index;
}

function evaluateConstructVerificationReadEvidence(
  result: Extract<ArtifactAnalysisResult, { kind: 'construct_verification' }>,
  records: ScientificFreshnessRecordIndex,
): ScientificFreshnessReason[] {
  const readRecordIds = result.data.readRecordIds;
  const rawEvidence = result.parameters.readEvidence;
  const reasons: ScientificFreshnessReason[] = [];

  if (rawEvidence === undefined) {
    return readRecordIds.map((recordId) => reason(
      'sanger_evidence_attestation_missing',
      'unverified',
      `Sequencing read "${recordId}" has no saved Sanger-evidence SHA-256 attestation.`,
      { recordId, field: 'sanger_evidence' },
    ));
  }

  if (!isPlainObject(rawEvidence)
    || rawEvidence.schema !== CONSTRUCT_READ_EVIDENCE_SCHEMA
    || !Array.isArray(rawEvidence.sha256s)) {
    return readRecordIds.map((recordId) => reason(
      'sanger_evidence_attestation_invalid',
      'unverified',
      `Sequencing read "${recordId}" has a malformed saved Sanger-evidence SHA-256 attestation.`,
      { recordId, field: 'sanger_evidence' },
    ));
  }

  const rawAttestations = rawEvidence.sha256s;
  if (rawAttestations.length !== readRecordIds.length) {
    return readRecordIds.map((recordId) => reason(
      'sanger_evidence_attestation_misaligned',
      'unverified',
      `Saved Sanger-evidence SHA-256 attestations do not align with sequencing read "${recordId}".`,
      { recordId, field: 'sanger_evidence' },
    ));
  }

  for (let index = 0; index < readRecordIds.length; index += 1) {
    const recordId = readRecordIds[index];
    const attestedSha256 = rawAttestations[index];
    const shared = { recordId, field: 'sanger_evidence' as const };
    if (typeof attestedSha256 !== 'string' || !SHA256_HEX_PATTERN.test(attestedSha256)) {
      reasons.push(reason(
        'sanger_evidence_attestation_invalid',
        'unverified',
        `Sequencing read "${recordId}" has a malformed saved Sanger-evidence SHA-256 attestation.`,
        {
          ...shared,
          ...(typeof attestedSha256 === 'string' ? { expected: attestedSha256 } : {}),
        },
      ));
      continue;
    }

    const current = records.get(recordId);
    if (!current) continue;
    if (current.sangerEvidenceSha256 === undefined) {
      reasons.push(reason(
        'sanger_evidence_missing',
        'stale',
        `Sequencing read "${recordId}" no longer has a current Sanger-evidence SHA-256 digest.`,
        { ...shared, expected: attestedSha256.toLowerCase() },
      ));
      continue;
    }
    if (current.sangerEvidenceSha256 !== attestedSha256.toLowerCase()) {
      reasons.push(reason(
        'sanger_evidence_hash_mismatch',
        'stale',
        `Sequencing read "${recordId}" no longer matches its saved Sanger-evidence SHA-256.`,
        {
          ...shared,
          expected: attestedSha256.toLowerCase(),
          actual: current.sangerEvidenceSha256,
        },
      ));
    }
  }

  return reasons;
}

function evaluateInputSequences(
  inputRecordIds: readonly string[],
  inputSha256s: readonly string[] | undefined,
  records: ScientificFreshnessRecordIndex,
  rowIds?: readonly (string | undefined)[],
): ScientificFreshnessReason[] {
  const reasons: ScientificFreshnessReason[] = [];

  for (let index = 0; index < inputRecordIds.length; index += 1) {
    const recordId = inputRecordIds[index];
    const rowId = rowIds?.[index];
    const current = records.get(recordId);
    const shared = {
      recordId,
      ...(rowId === undefined ? {} : { rowId }),
      field: 'sequence' as const,
    };
    if (!current) {
      reasons.push(reason(
        'record_missing',
        'stale',
        `Input record "${recordId}" is no longer in the workspace.`,
        shared,
      ));
    }

    const attestedSha256 = inputSha256s?.[index];
    if (attestedSha256 === undefined) {
      reasons.push(reason(
        'sequence_attestation_missing',
        'unverified',
        `Input record "${recordId}" has no saved sequence SHA-256 attestation.`,
        shared,
      ));
      continue;
    }
    if (!SHA256_HEX_PATTERN.test(attestedSha256)) {
      reasons.push(reason(
        'sequence_attestation_invalid',
        'unverified',
        `Input record "${recordId}" has a malformed saved sequence SHA-256 attestation.`,
        { ...shared, expected: attestedSha256 },
      ));
      continue;
    }
    if (current && attestedSha256.toLowerCase() !== current.sequenceSha256) {
      reasons.push(reason(
        'sequence_hash_mismatch',
        'stale',
        `Input record "${recordId}" no longer matches its saved sequence SHA-256.`,
        { ...shared, expected: attestedSha256.toLowerCase(), actual: current.sequenceSha256 },
      ));
    }
  }

  return reasons;
}

function evaluateTopology(
  recordId: string | undefined,
  attestedTopology: unknown,
  records: ScientificFreshnessRecordIndex,
  options: { required: boolean },
): ScientificFreshnessReason[] {
  if (!recordId) return [];
  if (attestedTopology === undefined) {
    return options.required ? [reason(
      'topology_attestation_missing',
      'unverified',
      `Input record "${recordId}" has no saved topology attestation.`,
      { recordId, field: 'topology' },
    )] : [];
  }
  if (!isTopology(attestedTopology)) {
    return [reason(
      'topology_attestation_invalid',
      'unverified',
      `Input record "${recordId}" has a malformed saved topology attestation.`,
      { recordId, field: 'topology', expected: String(attestedTopology) },
    )];
  }
  const current = records.get(recordId);
  if (!current || current.topology === attestedTopology) return [];
  return [reason(
    'topology_mismatch',
    'stale',
    `Input record "${recordId}" is now ${current.topology}, but the saved result used ${attestedTopology} topology.`,
    { recordId, field: 'topology', expected: attestedTopology, actual: current.topology },
  )];
}

function setSavedEnd(
  attestations: Map<string, SavedEndAttestations>,
  recordId: string,
  side: 'left' | 'right',
  rawEnd: unknown,
): void {
  const current = attestations.get(recordId) ?? {};
  const parsed = savedEnd(rawEnd);
  const valueKey = side;
  const invalidKey = side === 'left' ? 'invalidLeft' : 'invalidRight';
  if (!parsed) {
    attestations.set(recordId, { ...current, [invalidKey]: true });
    return;
  }
  const existing = current[valueKey];
  const conflicts = existing !== undefined && formatEnd(existing) !== formatEnd(parsed);
  attestations.set(recordId, {
    ...current,
    [valueKey]: parsed,
    ...(conflicts ? { [invalidKey]: true } : {}),
  });
}

function ligationEndAttestations(parameters: ArtifactWorkflowResult['parameters']): Map<string, SavedEndAttestations> {
  const attestations = new Map<string, SavedEndAttestations>();
  const junctions = parameters.junctions;
  if (Array.isArray(junctions)) {
    for (const junction of junctions) {
      if (!isPlainObject(junction)) continue;
      if (typeof junction.leftRecordId === 'string') {
        setSavedEnd(attestations, junction.leftRecordId, 'right', junction.leftEnd);
      }
      if (typeof junction.rightRecordId === 'string') {
        setSavedEnd(attestations, junction.rightRecordId, 'left', junction.rightEnd);
      }
    }
  }

  const orderedIds = Array.isArray(parameters.orderedInputRecordIds)
    ? parameters.orderedInputRecordIds.filter((value): value is string => typeof value === 'string')
    : [];
  const terminalEnds = parameters.terminalEnds;
  if (orderedIds.length > 0 && isPlainObject(terminalEnds)) {
    setSavedEnd(attestations, orderedIds[0], 'left', terminalEnds.left);
    setSavedEnd(attestations, orderedIds[orderedIds.length - 1], 'right', terminalEnds.right);
  }
  return attestations;
}

function currentEnd(
  record: ScientificFreshnessRecordSnapshot,
  side: 'left' | 'right',
): SavedEnd | null {
  const sequence = side === 'left' ? record.overhang5 : record.overhang3;
  const type = side === 'left' ? record.overhang5Type : record.overhang3Type;
  if (sequence === undefined || type === undefined) return null;
  return savedEnd({ sequence, type });
}

function evaluateLigationEnds(
  result: ArtifactWorkflowResult,
  records: ScientificFreshnessRecordIndex,
): ScientificFreshnessReason[] {
  const reasons: ScientificFreshnessReason[] = [];
  const attestations = ligationEndAttestations(result.parameters);

  for (const recordId of result.inputRecordIds) {
    const current = records.get(recordId);
    const saved = attestations.get(recordId);
    for (const side of ['left', 'right'] as const) {
      const field = side === 'left' ? 'left_end' as const : 'right_end' as const;
      const invalid = side === 'left' ? saved?.invalidLeft : saved?.invalidRight;
      const attested = saved?.[side];
      if (invalid) {
        reasons.push(reason(
          'end_chemistry_attestation_invalid',
          'unverified',
          `Input record "${recordId}" has conflicting or malformed saved ${side}-end chemistry.`,
          { recordId, field },
        ));
        continue;
      }
      if (!attested) {
        reasons.push(reason(
          'end_chemistry_attestation_missing',
          'unverified',
          `Input record "${recordId}" has no saved ${side}-end chemistry attestation.`,
          { recordId, field },
        ));
        continue;
      }
      if (!current) continue;
      const actual = currentEnd(current, side);
      if (!actual) {
        reasons.push(reason(
          'end_chemistry_missing',
          'stale',
          `Input record "${recordId}" no longer has complete ${side}-end chemistry.`,
          { recordId, field, expected: formatEnd(attested) },
        ));
        continue;
      }
      if (formatEnd(attested) !== formatEnd(actual)) {
        reasons.push(reason(
          'end_chemistry_mismatch',
          'stale',
          `Input record "${recordId}" no longer matches its saved ${side}-end chemistry.`,
          { recordId, field, expected: formatEnd(attested), actual: formatEnd(actual) },
        ));
      }
    }
  }
  return reasons;
}

/** Evaluate one saved digest, gel, Golden Gate, or ligation result. */
export function evaluateWorkflowResultFreshness(
  result: ArtifactWorkflowResult,
  records: ScientificFreshnessRecordIndex,
): ScientificFreshnessEvaluation {
  const reasons = evaluateInputSequences(result.inputRecordIds, result.inputSha256s, records);
  if (result.kind === 'digest') {
    reasons.push(...evaluateTopology(result.inputRecordIds[0], result.parameters.topology, records, { required: true }));
  }
  if (result.kind === 'ligation') {
    reasons.push(...evaluateLigationEnds(result, records));
  }
  return finishEvaluation(reasons);
}

/** Evaluate one typed analysis result and any topology that changes its interpretation. */
export function evaluateAnalysisResultFreshness(
  result: ArtifactAnalysisResult,
  records: ScientificFreshnessRecordIndex,
): ScientificFreshnessEvaluation {
  const reasons = evaluateInputSequences(result.inputRecordIds, result.inputSha256s, records);
  if (result.kind === 'pcr' && Object.prototype.hasOwnProperty.call(result.parameters, 'topology')) {
    reasons.push(...evaluateTopology(result.data.templateRecordId, result.parameters.topology, records, { required: false }));
  }
  if (result.kind === 'construct_verification') {
    reasons.push(...evaluateTopology(result.data.referenceRecordId, result.parameters.topology, records, { required: true }));
    reasons.push(...evaluateConstructVerificationReadEvidence(result, records));
  }
  return finishEvaluation(reasons);
}

/** Evaluate linked alignment rows independently, then aggregate with stale dominance. */
export function evaluateAlignmentFreshness(
  alignment: ArtifactAlignment,
  records: ScientificFreshnessRecordIndex,
): ScientificFreshnessEvaluation {
  const reasons: ScientificFreshnessReason[] = [];
  for (const row of alignment.rows) {
    if (!row.sourceRecordId) {
      reasons.push(reason(
        'alignment_row_source_unattested',
        'unverified',
        `Alignment row "${row.name}" has no source-record attestation.`,
        { rowId: row.id, field: 'source_record' },
      ));
      continue;
    }
    reasons.push(...evaluateInputSequences(
      [row.sourceRecordId],
      row.inputSha256 === undefined ? undefined : [row.inputSha256],
      records,
      [row.id],
    ));
  }
  return finishEvaluation(reasons);
}

export function evaluateWorkflowResultsFreshness(
  results: readonly ArtifactWorkflowResult[],
  records: ScientificFreshnessRecordIndex,
): Map<string, ScientificFreshnessEvaluation> {
  return new Map(results.map((result) => [result.id, evaluateWorkflowResultFreshness(result, records)]));
}

export function evaluateAnalysisResultsFreshness(
  results: readonly ArtifactAnalysisResult[],
  records: ScientificFreshnessRecordIndex,
): Map<string, ScientificFreshnessEvaluation> {
  return new Map(results.map((result) => [result.id, evaluateAnalysisResultFreshness(result, records)]));
}

export function evaluateAlignmentsFreshness(
  alignments: readonly ArtifactAlignment[],
  records: ScientificFreshnessRecordIndex,
): Map<string, ScientificFreshnessEvaluation> {
  return new Map(alignments.map((alignment) => [alignment.id, evaluateAlignmentFreshness(alignment, records)]));
}
