import {
  LADDER_100BP,
  LADDER_1KB,
  migrationDistance,
} from '../bio/gel-simulation';
import type { SequenceType, Topology } from '../bio/types';
import {
  normalizeArtifactWorkflowResults,
  type ArtifactJsonObject,
  type ArtifactProvenance,
  type ArtifactWorkflowResult,
} from './claude-science-workspace-collections';
import { normalizeSha256Hex } from './claude-science-sha256';

/**
 * A deliberately bounded, qualitative agarose-gel preview for the standalone
 * artifact. This model does not accept DNA concentration, stain chemistry,
 * voltage, run time, or molecular conformation, so it must never be presented
 * as a quantitative electrophoresis prediction.
 */

export const ARTIFACT_GEL_MIN_AGAROSE_PERCENT = 0.8;
export const ARTIFACT_GEL_MAX_AGAROSE_PERCENT = 2.0;
export const MAX_ARTIFACT_GEL_SAMPLE_LANES = 12;
export const MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE = 256;
export const MAX_ARTIFACT_GEL_TOTAL_FRAGMENTS = 1_024;
export const MAX_ARTIFACT_GEL_FRAGMENT_BP = 250_000;
export const ARTIFACT_GEL_CO_MIGRATION_TOLERANCE = 0.008;
export const ARTIFACT_GEL_QUALITATIVE_CAVEAT =
  'Qualitative preview only. Migration and brightness do not predict measured distance, DNA mass, staining, molecular conformation, voltage, run time, or instrument response.';

const CALIBRATED_AGAROSE_PERCENTAGES = [0.8, 1.0, 1.5, 2.0] as const;
const MAX_ID_LENGTH = 160;
const MAX_LANE_LABEL_LENGTH = 128;
const MAX_WORKFLOW_NAME_LENGTH = 256;

export type ArtifactGelLadderPreset = '1kb' | '100bp';
export type ArtifactGelLaneSourceKind = 'digest' | 'linear-record';
export type ArtifactGelIntensityLabel = 'reference' | 'single' | 'co-migrating';

type ArtifactGelLaneBase = {
  /** Stable lane id supplied by the caller; this model never invents ids. */
  id: string;
  label: string;
  recordId: string;
  /** SHA-256 of the exact current record sequence, when available. */
  recordSha256?: string;
  sequenceType: SequenceType;
};

export type ArtifactGelDigestLaneInput = ArtifactGelLaneBase & {
  sourceKind: 'digest';
  /** Stable id of the saved digest result that produced these fragments. */
  digestWorkflowResultId: string;
  sourceTopology: Topology;
  sourceLengthBp: number;
  fragmentLengthsBp: readonly number[];
};

export type ArtifactGelLinearRecordLaneInput = ArtifactGelLaneBase & {
  sourceKind: 'linear-record';
  topology: Topology;
  lengthBp: number;
};

export type ArtifactGelLaneInput = ArtifactGelDigestLaneInput | ArtifactGelLinearRecordLaneInput;

export type BuildArtifactGelPreviewInput = {
  /** Stable workflow id supplied by the caller; no crypto is used here. */
  workflowResultId: string;
  workflowName: string;
  /** ISO timestamp supplied by the caller; no wall clock is read here. */
  createdAt: string;
  ladderPreset: ArtifactGelLadderPreset;
  agarosePercent: number;
  lanes: readonly ArtifactGelLaneInput[];
  /** Caller identity/context. Engine identity is set by this model. */
  provenance: ArtifactProvenance;
};

export type ArtifactGelBand = {
  bandIndex: number;
  /** Larger fragments remain nearer 0 (wells); smaller fragments approach 1. */
  normalizedY: number;
  /** Geometric-mean display size when multiple fragments co-migrate. */
  representativeSizeBp: number;
  /** One entry per input fragment, including exact duplicate sizes. */
  fragmentSizesBp: number[];
  fragmentCount: number;
  coMigrating: boolean;
  /** Relative rendering weight only, never a DNA-mass estimate. */
  relativeIntensity: number;
  intensityLabel: ArtifactGelIntensityLabel;
  clippedAtBoundary: boolean;
};

export type ArtifactGelLane = {
  id: string;
  laneIndex: number;
  label: string;
  sourceKind: ArtifactGelLaneSourceKind | 'ladder';
  recordId?: string;
  recordSha256?: string;
  digestWorkflowResultId?: string;
  fragmentCount: number;
  bands: ArtifactGelBand[];
};

export type ArtifactGelPreview = {
  ladderPreset: ArtifactGelLadderPreset;
  agarosePercent: number;
  qualitativeOnly: true;
  caveat: string;
  lanes: ArtifactGelLane[];
  sampleLaneCount: number;
  sampleFragmentCount: number;
  sampleBandCount: number;
  workflowResult: ArtifactWorkflowResult;
};

type PositionedFragment = {
  sizeBp: number;
  normalizedY: number;
};

function assertPlainText(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${path} must not be blank.`);
  if (normalized.length > maxLength) {
    throw new Error(`${path} cannot exceed ${maxLength.toLocaleString()} characters.`);
  }
  return normalized;
}

function normalizeCallerTimestamp(value: unknown): string {
  const raw = assertPlainText(value, 'createdAt', 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) throw new Error('createdAt must be an ISO 8601 date-time.');
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) throw new Error('createdAt must be a valid ISO 8601 date-time.');
  return new Date(milliseconds).toISOString();
}

function assertFragmentSize(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive whole number of base pairs.`);
  }
  if ((value as number) > MAX_ARTIFACT_GEL_FRAGMENT_BP) {
    throw new Error(`${path} cannot exceed ${MAX_ARTIFACT_GEL_FRAGMENT_BP.toLocaleString()} bp.`);
  }
  return value as number;
}

function assertDna(sequenceType: SequenceType, path: string): void {
  if (sequenceType !== 'dna') {
    throw new Error(`${path}.sequenceType must be "dna"; agarose preview does not convert RNA or protein implicitly.`);
  }
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Return a defensive copy of a built-in marker preset, largest first. */
export function getArtifactGelLadderSizes(preset: ArtifactGelLadderPreset): number[] {
  if (preset === '1kb') return [...LADDER_1KB];
  if (preset === '100bp') return [...LADDER_100BP];
  throw new Error('ladderPreset must be "1kb" or "100bp".');
}

function surroundingCalibrations(agarosePercent: number): readonly [number, number] {
  for (let index = 1; index < CALIBRATED_AGAROSE_PERCENTAGES.length; index += 1) {
    const upper = CALIBRATED_AGAROSE_PERCENTAGES[index];
    if (agarosePercent <= upper) return [CALIBRATED_AGAROSE_PERCENTAGES[index - 1], upper];
  }
  return [ARTIFACT_GEL_MAX_AGAROSE_PERCENT, ARTIFACT_GEL_MAX_AGAROSE_PERCENT];
}

/**
 * Interpolate the shared gel engine's calibrated log-linear positions instead
 * of silently snapping arbitrary concentrations to the nearest preset.
 */
export function artifactGelMigrationPosition(sizeBp: number, agarosePercent: number): number {
  const size = assertFragmentSize(sizeBp, 'sizeBp');
  if (!Number.isFinite(agarosePercent)
    || agarosePercent < ARTIFACT_GEL_MIN_AGAROSE_PERCENT
    || agarosePercent > ARTIFACT_GEL_MAX_AGAROSE_PERCENT) {
    throw new Error(
      `agarosePercent must be between ${ARTIFACT_GEL_MIN_AGAROSE_PERCENT} and ${ARTIFACT_GEL_MAX_AGAROSE_PERCENT}.`,
    );
  }

  const [lower, upper] = surroundingCalibrations(agarosePercent);
  const lowerPosition = migrationDistance(size, lower);
  if (lower === upper) return round(lowerPosition);
  const upperPosition = migrationDistance(size, upper);
  const fraction = (agarosePercent - lower) / (upper - lower);
  return round(lowerPosition + ((upperPosition - lowerPosition) * fraction));
}

function relativeIntensity(fragmentCount: number, isLadder: boolean): number {
  if (isLadder) return 0.48;
  return round(Math.min(1, 0.55 + ((fragmentCount - 1) * 0.2)), 2);
}

function representativeSize(fragmentSizesBp: readonly number[]): number {
  const logMean = fragmentSizesBp.reduce((sum, size) => sum + Math.log(size), 0) / fragmentSizesBp.length;
  return Math.max(1, Math.round(Math.exp(logMean)));
}

function buildBands(
  sizesBp: readonly number[],
  agarosePercent: number,
  isLadder: boolean,
): ArtifactGelBand[] {
  const positioned: PositionedFragment[] = sizesBp.map((sizeBp) => ({
    sizeBp,
    normalizedY: artifactGelMigrationPosition(sizeBp, agarosePercent),
  })).sort((left, right) => left.normalizedY - right.normalizedY || right.sizeBp - left.sizeBp);

  const groups: PositionedFragment[][] = [];
  for (const fragment of positioned) {
    const current = groups.at(-1);
    if (!current) {
      groups.push([fragment]);
      continue;
    }
    const meanPosition = current.reduce((sum, item) => sum + item.normalizedY, 0) / current.length;
    if (Math.abs(fragment.normalizedY - meanPosition) <= ARTIFACT_GEL_CO_MIGRATION_TOLERANCE) {
      current.push(fragment);
    } else {
      groups.push([fragment]);
    }
  }

  return groups.map((group, bandIndex) => {
    const fragmentSizesBp = group.map((fragment) => fragment.sizeBp).sort((left, right) => right - left);
    const normalizedY = round(group.reduce((sum, fragment) => sum + fragment.normalizedY, 0) / group.length);
    const fragmentCount = fragmentSizesBp.length;
    return {
      bandIndex,
      normalizedY,
      representativeSizeBp: representativeSize(fragmentSizesBp),
      fragmentSizesBp,
      fragmentCount,
      coMigrating: fragmentCount > 1,
      relativeIntensity: relativeIntensity(fragmentCount, isLadder),
      intensityLabel: isLadder ? 'reference' : fragmentCount > 1 ? 'co-migrating' : 'single',
      clippedAtBoundary: normalizedY === 0 || normalizedY === 1,
    };
  });
}

function normalizeLaneInput(
  lane: ArtifactGelLaneInput,
  index: number,
  agarosePercent: number,
): ArtifactGelLane {
  const path = `lanes[${index}]`;
  const id = assertPlainText(lane.id, `${path}.id`, MAX_ID_LENGTH);
  const label = assertPlainText(lane.label, `${path}.label`, MAX_LANE_LABEL_LENGTH);
  const recordId = assertPlainText(lane.recordId, `${path}.recordId`, MAX_ID_LENGTH);
  const recordSha256 = lane.recordSha256 === undefined
    ? undefined
    : normalizeSha256Hex(lane.recordSha256, `${path}.recordSha256`);
  assertDna(lane.sequenceType, path);

  let fragmentLengthsBp: number[];
  let digestWorkflowResultId: string | undefined;
  if (lane.sourceKind === 'digest') {
    digestWorkflowResultId = assertPlainText(
      lane.digestWorkflowResultId,
      `${path}.digestWorkflowResultId`,
      MAX_ID_LENGTH,
    );
    if (lane.sourceTopology !== 'linear' && lane.sourceTopology !== 'circular') {
      throw new Error(`${path}.sourceTopology must be "linear" or "circular".`);
    }
    const sourceLengthBp = assertFragmentSize(lane.sourceLengthBp, `${path}.sourceLengthBp`);
    if (!Array.isArray(lane.fragmentLengthsBp) || lane.fragmentLengthsBp.length === 0) {
      throw new Error(`${path}.fragmentLengthsBp must contain at least one digest fragment.`);
    }
    if (lane.fragmentLengthsBp.length > MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE) {
      throw new Error(
        `${path}.fragmentLengthsBp cannot contain more than ${MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE} fragments.`,
      );
    }
    fragmentLengthsBp = lane.fragmentLengthsBp.map((size, fragmentIndex) => (
      assertFragmentSize(size, `${path}.fragmentLengthsBp[${fragmentIndex}]`)
    ));
    const digestLength = fragmentLengthsBp.reduce((sum, size) => sum + size, 0);
    if (digestLength !== sourceLengthBp) {
      throw new Error(
        `${path}.fragmentLengthsBp total ${digestLength.toLocaleString()} bp but sourceLengthBp is ${sourceLengthBp.toLocaleString()} bp.`,
      );
    }
  } else if (lane.sourceKind === 'linear-record') {
    if (lane.topology !== 'linear') {
      throw new Error(
        `${path}.topology must be "linear"; uncut circular DNA has conformation-dependent mobility and cannot be represented as one linear band.`,
      );
    }
    fragmentLengthsBp = [assertFragmentSize(lane.lengthBp, `${path}.lengthBp`)];
  } else {
    throw new Error(`${path}.sourceKind must be "digest" or "linear-record".`);
  }

  return {
    id,
    laneIndex: index + 1,
    label,
    sourceKind: lane.sourceKind,
    recordId,
    ...(recordSha256 === undefined ? {} : { recordSha256 }),
    ...(digestWorkflowResultId === undefined ? {} : { digestWorkflowResultId }),
    fragmentCount: fragmentLengthsBp.length,
    bands: buildBands(fragmentLengthsBp, agarosePercent, false),
  };
}

function workflowLaneSummary(lane: ArtifactGelLane): ArtifactJsonObject {
  return {
    laneId: lane.id,
    laneIndex: lane.laneIndex,
    label: lane.label,
    sourceKind: lane.sourceKind,
    ...(lane.recordId === undefined ? {} : { recordId: lane.recordId }),
    ...(lane.recordSha256 === undefined ? {} : { recordSha256: lane.recordSha256 }),
    ...(lane.digestWorkflowResultId === undefined ? {} : { digestWorkflowResultId: lane.digestWorkflowResultId }),
    fragmentCount: lane.fragmentCount,
    bandCount: lane.bands.length,
    bands: lane.bands.map((band) => ({
      normalizedY: band.normalizedY,
      representativeSizeBp: band.representativeSizeBp,
      fragmentSizesBp: [...band.fragmentSizesBp],
      fragmentCount: band.fragmentCount,
      coMigrating: band.coMigrating,
      relativeIntensity: band.relativeIntensity,
      intensityLabel: band.intensityLabel,
      clippedAtBoundary: band.clippedAtBoundary,
    })),
  };
}

/** Build the render model and a schema-valid, provenance-ready gel result. */
export function buildArtifactGelPreview(input: BuildArtifactGelPreviewInput): ArtifactGelPreview {
  const workflowResultId = assertPlainText(input.workflowResultId, 'workflowResultId', MAX_ID_LENGTH);
  const workflowName = assertPlainText(input.workflowName, 'workflowName', MAX_WORKFLOW_NAME_LENGTH);
  const createdAt = normalizeCallerTimestamp(input.createdAt);
  const agarosePercent = input.agarosePercent;
  artifactGelMigrationPosition(1_000, agarosePercent);
  const ladderSizes = getArtifactGelLadderSizes(input.ladderPreset);

  if (!Array.isArray(input.lanes) || input.lanes.length === 0) {
    throw new Error('lanes must contain at least one DNA sample lane.');
  }
  if (input.lanes.length > MAX_ARTIFACT_GEL_SAMPLE_LANES) {
    throw new Error(`lanes cannot contain more than ${MAX_ARTIFACT_GEL_SAMPLE_LANES} sample lanes.`);
  }

  const sampleLanes = input.lanes.map((lane, index) => normalizeLaneInput(lane, index, agarosePercent));
  const laneIds = new Set<string>();
  for (const lane of sampleLanes) {
    if (laneIds.has(lane.id)) throw new Error(`lanes contains duplicate id "${lane.id}".`);
    laneIds.add(lane.id);
  }
  const sampleFragmentCount = sampleLanes.reduce((sum, lane) => sum + lane.fragmentCount, 0);
  if (sampleFragmentCount > MAX_ARTIFACT_GEL_TOTAL_FRAGMENTS) {
    throw new Error(
      `lanes cannot contain more than ${MAX_ARTIFACT_GEL_TOTAL_FRAGMENTS.toLocaleString()} fragments in total.`,
    );
  }

  const ladderLabel = input.ladderPreset === '1kb' ? '1 kb ladder' : '100 bp ladder';
  const ladderLane: ArtifactGelLane = {
    id: `ladder:${input.ladderPreset}`,
    laneIndex: 0,
    label: ladderLabel,
    sourceKind: 'ladder',
    fragmentCount: ladderSizes.length,
    bands: buildBands(ladderSizes, agarosePercent, true),
  };
  const inputRecordIds: string[] = [];
  const inputSha256ByRecordId = new Map<string, string | undefined>();
  for (const lane of sampleLanes) {
    if (!lane.recordId) continue;
    if (!inputSha256ByRecordId.has(lane.recordId)) {
      inputRecordIds.push(lane.recordId);
      inputSha256ByRecordId.set(lane.recordId, lane.recordSha256);
      continue;
    }
    const existingSha256 = inputSha256ByRecordId.get(lane.recordId);
    if (existingSha256 && lane.recordSha256 && existingSha256 !== lane.recordSha256) {
      throw new Error(`lanes contain conflicting SHA-256 values for recordId "${lane.recordId}".`);
    }
    if (!existingSha256 && lane.recordSha256) {
      inputSha256ByRecordId.set(lane.recordId, lane.recordSha256);
    }
  }
  const hasCompleteInputHashes = inputRecordIds.every((recordId) => inputSha256ByRecordId.get(recordId) !== undefined);
  const inputSha256s = hasCompleteInputHashes
    ? inputRecordIds.map((recordId) => inputSha256ByRecordId.get(recordId) as string)
    : undefined;
  const digestParentIds = sampleLanes.flatMap((lane) => (
    lane.digestWorkflowResultId ? [lane.digestWorkflowResultId] : []
  ));
  if (!input.provenance || typeof input.provenance !== 'object' || Array.isArray(input.provenance)) {
    throw new Error('provenance must be an object with a non-blank source.');
  }
  if (input.provenance.parentIds !== undefined && !Array.isArray(input.provenance.parentIds)) {
    throw new Error('provenance.parentIds must be an array when provided.');
  }
  const callerParentIds = input.provenance.parentIds ?? [];
  const parentIds = Array.from(new Set([...callerParentIds, ...digestParentIds]));
  const sampleBandCount = sampleLanes.reduce((sum, lane) => sum + lane.bands.length, 0);

  const result: ArtifactJsonObject = {
    qualitativeOnly: true,
    caveat: ARTIFACT_GEL_QUALITATIVE_CAVEAT,
    sampleLaneCount: sampleLanes.length,
    sampleFragmentCount,
    sampleBandCount,
    ladder: workflowLaneSummary(ladderLane),
    lanes: sampleLanes.map(workflowLaneSummary),
  };
  const workflowResultCandidate: ArtifactWorkflowResult = {
    id: workflowResultId,
    kind: 'gel',
    name: workflowName,
    inputRecordIds,
    ...(inputSha256s === undefined ? {} : { inputSha256s }),
    parameters: {
      agarosePercent,
      ladderPreset: input.ladderPreset,
      migrationModel: 'interpolated-qualitative-log-linear-v1',
      coMigrationTolerance: ARTIFACT_GEL_CO_MIGRATION_TOLERANCE,
      qualitativeOnly: true,
    },
    outputRecordIds: [],
    result,
    createdAt,
    provenance: {
      ...input.provenance,
      operation: 'gel_preview',
      engine: 'artifact-qualitative-gel',
      engineVersion: '1',
      ...(parentIds.length === 0 ? {} : { parentIds }),
    },
  };
  const workflowResult = normalizeArtifactWorkflowResults([workflowResultCandidate])[0];

  return {
    ladderPreset: input.ladderPreset,
    agarosePercent,
    qualitativeOnly: true,
    caveat: ARTIFACT_GEL_QUALITATIVE_CAVEAT,
    lanes: [ladderLane, ...sampleLanes],
    sampleLaneCount: sampleLanes.length,
    sampleFragmentCount,
    sampleBandCount,
    workflowResult,
  };
}
