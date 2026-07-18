import { reverseComplement } from '../bio/reverse-complement';
import { sha256HexSync } from './claude-science-sha256';

/** Deterministic, store-free construct verification for bounded Sanger reads. */

export const ARTIFACT_CONSTRUCT_VERIFICATION_SCHEMA = 'motif.construct-verification.v1' as const;
export const ARTIFACT_CONSTRUCT_VERIFICATION_VERSION = 1 as const;

export const ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS = {
  maxReferenceLength: 50_000,
  maxReads: 96,
  maxReadLength: 5_000,
  maxRequiredRegions: 128,
  maxRequiredRegionBases: 500_000,
  maxExpectedVariants: 256,
  maxObservedVariants: 2_000,
  maxIndelLength: 24,
  maxWorkUnits: 25_000_000,
} as const;

export const ARTIFACT_CONSTRUCT_VERIFICATION_TEXT_LIMITS = {
  maxIdLength: 160,
  maxNameLength: 256,
} as const;

export type ArtifactConstructVerificationErrorCode =
  | 'invalid_input'
  | 'too_large'
  | 'work_budget';

export class ArtifactConstructVerificationError extends Error {
  readonly code: ArtifactConstructVerificationErrorCode;

  constructor(code: ArtifactConstructVerificationErrorCode, message: string) {
    super(message);
    this.name = 'ArtifactConstructVerificationError';
    this.code = code;
  }
}

export type ArtifactConstructReferenceInput = {
  id: string;
  name?: string;
  sequence: string;
  topology: 'linear' | 'circular';
  sha256: string;
};

export type ArtifactConstructReadInput = {
  id: string;
  name?: string;
  baseCalls: string;
  qualityScores?: readonly number[];
  sha256: string;
};

export type ArtifactConstructRequiredRegionInput = {
  id: string;
  name?: string;
  start: number;
  end: number;
  minDepth?: number;
  requireBothStrands?: boolean;
};

export type ArtifactConstructVariantType = 'substitution' | 'insertion' | 'deletion';

export type ArtifactConstructExpectedVariantInput = {
  id: string;
  type: ArtifactConstructVariantType;
  referenceStart: number;
  referenceEnd: number;
  reference: string;
  alternate: string;
};

export type ArtifactConstructVerificationThresholds = {
  trimQuality: number;
  trimWindow: number;
  minTrimmedReadLength: number;
  minMappingIdentity: number;
  minMappingMargin: number;
  maxIndelFraction: number;
  minCoverageFraction: number;
  minDepth: number;
  requireBothStrands: boolean;
  minConsensusFraction: number;
  minVariantQuality: number;
  minVariantFraction: number;
};

export type ArtifactConstructVerificationInput = {
  reference: ArtifactConstructReferenceInput;
  reads: readonly ArtifactConstructReadInput[];
  requiredRegions?: readonly ArtifactConstructRequiredRegionInput[];
  expectedVariants?: readonly ArtifactConstructExpectedVariantInput[];
  thresholds?: Partial<ArtifactConstructVerificationThresholds>;
};

export const DEFAULT_ARTIFACT_CONSTRUCT_VERIFICATION_THRESHOLDS: Readonly<ArtifactConstructVerificationThresholds> = {
  trimQuality: 20,
  trimWindow: 12,
  minTrimmedReadLength: 40,
  minMappingIdentity: 0.82,
  minMappingMargin: 0.03,
  maxIndelFraction: 0.12,
  minCoverageFraction: 1,
  minDepth: 1,
  requireBothStrands: false,
  minConsensusFraction: 0.7,
  minVariantQuality: 20,
  minVariantFraction: 0.6,
};

export type ArtifactConstructVerificationReasonCode =
  | 'missing_quality'
  | 'trimmed_read_too_short'
  | 'unmapped_read'
  | 'ambiguous_mapping'
  | 'low_mapping_identity'
  | 'excessive_indel'
  | 'no_usable_reads'
  | 'partial_reference_coverage'
  | 'required_region_uncovered'
  | 'required_region_low_depth'
  | 'required_region_missing_strand'
  | 'unexpected_variant'
  | 'low_confidence_variant'
  | 'expected_variant_not_observed'
  | 'expected_variant_not_covered'
  | 'conflicting_consensus';

export type ArtifactConstructVerificationReason = {
  code: ArtifactConstructVerificationReasonCode;
  severity: 'review' | 'inconsistent';
  message: string;
  readId?: string;
  regionId?: string;
  variantId?: string;
};

export type ArtifactConstructReadStatus =
  | 'mapped'
  | 'trimmed_read_too_short'
  | 'unmapped'
  | 'ambiguous_mapping'
  | 'low_mapping_identity'
  | 'excessive_indel';

export type ArtifactConstructReadTrim = {
  method: 'quality_window' | 'none_missing_quality';
  rawStart: number;
  rawEnd: number;
  trimmedLength: number;
  removedFromStart: number;
  removedFromEnd: number;
};

export type ArtifactConstructAlignmentOperation =
  | 'match'
  | 'substitution'
  | 'insertion'
  | 'deletion';

export type ArtifactConstructAlignmentColumn = {
  operation: ArtifactConstructAlignmentOperation;
  /** Normalized reference coordinate, or null for a read insertion. */
  referencePosition: number | null;
  /** Insertion coordinate for an insertion column, otherwise null. */
  referenceBoundary: number | null;
  /** Index in the original, untrimmed baseCalls string; retained on reverse mappings. */
  rawCallIndex: number | null;
  /** Index in the oriented trimmed read; null for a reference deletion. */
  orientedCallIndex: number | null;
  referenceBase: string | null;
  /** Base in reference orientation, not a replacement/re-basecall of the raw call. */
  readBase: string | null;
  /** Original baseCalls character before orientation, or null for a deletion. */
  rawBase: string | null;
  qualityScore: number | null;
};

export type ArtifactConstructCoordinateMap = {
  columns: ArtifactConstructAlignmentColumn[];
  /** Parallel to columns; convenient explicit maps retain null gap entries. */
  referencePositions: Array<number | null>;
  rawCallIndices: Array<number | null>;
};

export type ArtifactConstructReadMapping = {
  orientation: 'forward' | 'reverse';
  referenceStart: number;
  referenceEnd: number;
  wraps: boolean;
  referenceSpan: number;
  score: number;
  secondBestScore: number | null;
  mappingMargin: number | null;
  identity: number;
  alignedLength: number;
  matches: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  indelFraction: number;
  coordinateMap: ArtifactConstructCoordinateMap;
};

export type ArtifactConstructReadVerification = {
  id: string;
  name?: string;
  /** SHA-256 of normalized baseCalls, not a digest of derived evidence. */
  sha256: string;
  rawLength: number;
  qualityProvided: boolean;
  meanQuality: number | null;
  status: ArtifactConstructReadStatus;
  trim: ArtifactConstructReadTrim;
  mapping: ArtifactConstructReadMapping | null;
};

export type ArtifactConstructRegionCoverage = {
  id: string;
  name?: string;
  start: number;
  end: number;
  wraps: boolean;
  length: number;
  minDepth: number;
  requireBothStrands: boolean;
  coveredBases: number;
  basesMeetingMinDepth: number;
  coveredFraction: number;
  minimumDepth: number;
  maximumDepth: number;
  meanDepth: number;
  forwardCoveredBases: number;
  reverseCoveredBases: number;
  bothStrandsCoveredBases: number;
  status: 'covered' | 'uncovered' | 'low_depth' | 'missing_strand';
};

export type ArtifactConstructCoverage = {
  /** Per-base canonical callable depth; deletion alleles count as callable spanning evidence. */
  depth: number[];
  forward: number[];
  reverse: number[];
  coveredBases: number;
  basesMeetingMinDepth: number;
  coveredFraction: number;
  minimumDepth: number;
  maximumDepth: number;
  meanDepth: number;
  requiredRegions: ArtifactConstructRegionCoverage[];
};

export type ArtifactConstructConsensusAllele = {
  allele: 'A' | 'C' | 'G' | 'T' | '-';
  count: number;
  weight: number;
  fraction: number;
};

export type ArtifactConstructConsensusCall = {
  referencePosition: number;
  referenceBase: string;
  call: 'A' | 'C' | 'G' | 'T' | '-' | 'N';
  status: 'uncovered' | 'reference' | 'variant' | 'conflict';
  depth: number;
  forwardDepth: number;
  reverseDepth: number;
  fraction: number;
  alleles: ArtifactConstructConsensusAllele[];
};

export type ArtifactConstructObservedVariant = {
  id: string;
  type: ArtifactConstructVariantType;
  referenceStart: number;
  referenceEnd: number;
  reference: string;
  alternate: string;
  depth: number;
  support: number;
  supportWeight: number;
  fraction: number;
  meanQuality: number | null;
  confidence: 'high' | 'low';
  supportingReadIds: string[];
  expectedVariantId?: string;
};

export type ArtifactConstructExpectedVariantResult = ArtifactConstructExpectedVariantInput & {
  status: 'observed' | 'low_confidence' | 'not_observed' | 'not_covered';
  depth: number;
  observedVariantId?: string;
};

export type ArtifactConstructVariantSummary = {
  observed: ArtifactConstructObservedVariant[];
  expected: ArtifactConstructExpectedVariantResult[];
  unexpected: ArtifactConstructObservedVariant[];
  missingExpected: ArtifactConstructExpectedVariantResult[];
};

export type ArtifactConstructConsensus = {
  /** Reference-oriented sequence; N marks conflicts/uncovered calls and deletions are omitted. */
  sequence: string;
  calls: ArtifactConstructConsensusCall[];
  variants: ArtifactConstructObservedVariant[];
};

export type ArtifactConstructVerificationProvenance = {
  engine: 'motif-construct-verification';
  engineVersion: '1';
  referenceSha256: string;
  /** Input-order SHA-256 values of normalized baseCalls. */
  readSha256s: string[];
  requestSha256: string;
  workUnits: number;
  limits: typeof ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS;
};

export type ArtifactConstructVerificationResult = {
  schema: typeof ARTIFACT_CONSTRUCT_VERIFICATION_SCHEMA;
  version: typeof ARTIFACT_CONSTRUCT_VERIFICATION_VERSION;
  state: 'consistent' | 'needs_review' | 'inconsistent';
  reasons: ArtifactConstructVerificationReason[];
  reference: {
    id: string;
    name?: string;
    sequence: string;
    length: number;
    topology: 'linear' | 'circular';
    sha256: string;
  };
  thresholds: ArtifactConstructVerificationThresholds;
  reads: ArtifactConstructReadVerification[];
  coverage: ArtifactConstructCoverage;
  consensus: ArtifactConstructConsensus;
  variants: ArtifactConstructVariantSummary;
  provenance: ArtifactConstructVerificationProvenance;
};

const ID_MAX_LENGTH = ARTIFACT_CONSTRUCT_VERIFICATION_TEXT_LIMITS.maxIdLength;
const NAME_MAX_LENGTH = ARTIFACT_CONSTRUCT_VERIFICATION_TEXT_LIMITS.maxNameLength;
const IUPAC_DNA_PATTERN = /^[ACGTRYSWKMBDHVN]+$/;
const CANONICAL_DNA_PATTERN = /^[ACGT]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_MAPPING_CANDIDATES_PER_ORIENTATION = 16;
const EXHAUSTIVE_MAPPING_WORK_FRACTION = 0.92;
const NEGATIVE_INFINITY = -1_000_000_000;
const MATCH_SCORE = 3;
const AMBIGUOUS_MATCH_SCORE = 1;
const MISMATCH_SCORE = -3;
const GAP_SCORE = -4;

const IUPAC_MASK: Readonly<Record<string, number>> = {
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  R: 5,
  Y: 10,
  S: 6,
  W: 9,
  K: 12,
  M: 3,
  B: 14,
  D: 13,
  H: 11,
  V: 7,
  N: 15,
};

type NormalizedReference = {
  id: string;
  name?: string;
  sequence: string;
  topology: 'linear' | 'circular';
  sha256: string;
};

type NormalizedRead = {
  id: string;
  name?: string;
  baseCalls: string;
  qualityScores: number[] | null;
  sha256: string;
};

type NormalizedRegion = ArtifactConstructRequiredRegionInput & {
  wraps: boolean;
  length: number;
  positions: number[];
  effectiveMinDepth: number;
  effectiveRequireBothStrands: boolean;
};

type NormalizedInput = {
  reference: NormalizedReference;
  reads: NormalizedRead[];
  requiredRegions: NormalizedRegion[];
  expectedVariants: ArtifactConstructExpectedVariantInput[];
  thresholds: ArtifactConstructVerificationThresholds;
};

type OrientedRead = {
  orientation: 'forward' | 'reverse';
  sequence: string;
  rawCallIndices: number[];
  qualityScores: Array<number | null>;
  rawBases: string[];
};

type CandidateStart = {
  start: number;
  votes: number;
};

type CandidateSearch = {
  candidates: CandidateStart[];
  /** True when a seed-supported locus was omitted solely to preserve the bounded search. */
  truncated: boolean;
};

type ScoredCandidate = {
  orientation: 'forward' | 'reverse';
  candidateStart: number;
  score: number;
};

type AlignmentResult = {
  mapping: ArtifactConstructReadMapping;
  maximumIndelRun: number;
};

type AlleleEvidence = {
  count: number;
  weight: number;
};

type VariantEvidence = {
  type: ArtifactConstructVariantType;
  referenceStart: number;
  referenceEnd: number;
  reference: string;
  alternate: string;
  readIds: Set<string>;
  weightByRead: Map<string, number>;
  qualityByRead: Map<string, number | null>;
};

class WorkCounter {
  private count = 0;

  spend(units = 1): void {
    this.count += units;
    if (this.count > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxWorkUnits) {
      throw new ArtifactConstructVerificationError(
        'work_budget',
        `Construct verification exceeded the deterministic ${ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxWorkUnits.toLocaleString()}-unit work budget.`,
      );
    }
  }

  value(): number {
    return this.count;
  }
}

function fail(code: ArtifactConstructVerificationErrorCode, message: string): never {
  throw new ArtifactConstructVerificationError(code, message);
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('invalid_input', `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function normalizeId(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('invalid_input', `${path} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > ID_MAX_LENGTH) {
    fail('invalid_input', `${path} must contain 1–${ID_MAX_LENGTH} nonblank characters.`);
  }
  return normalized;
}

function normalizeName(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail('invalid_input', `${path} must be a string when provided.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > NAME_MAX_LENGTH) {
    fail('invalid_input', `${path} must contain 1–${NAME_MAX_LENGTH} nonblank characters when provided.`);
  }
  return normalized;
}

function normalizeDna(value: unknown, path: string, maximumLength: number): string {
  if (typeof value !== 'string') fail('invalid_input', `${path} must be a DNA string.`);
  const normalized = value.replace(/\s+/g, '').toUpperCase();
  if (!normalized) fail('invalid_input', `${path} must contain at least one DNA base.`);
  if (normalized.length > maximumLength) {
    fail('too_large', `${path} exceeds the ${maximumLength.toLocaleString()}-base limit.`);
  }
  if (!IUPAC_DNA_PATTERN.test(normalized)) {
    fail('invalid_input', `${path} must contain only IUPAC DNA bases (no gaps or U residues).`);
  }
  return normalized;
}

function normalizeSha256(value: unknown, sequence: string, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail('invalid_input', `${path} must be a 64-character SHA-256 digest.`);
  }
  const normalized = value.toLowerCase();
  if (normalized !== sha256HexSync(sequence)) {
    fail('invalid_input', `${path} does not match the normalized DNA sequence.`);
  }
  return normalized;
}

function finiteNumber(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail('invalid_input', `${path} must be a finite number from ${minimum} through ${maximum}.`);
  }
  return value;
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  const normalized = finiteNumber(value, path, minimum, maximum);
  if (!Number.isInteger(normalized)) fail('invalid_input', `${path} must be an integer.`);
  return normalized;
}

function normalizeThresholds(value: unknown): ArtifactConstructVerificationThresholds {
  const source = value === undefined ? {} : recordValue(value, 'thresholds');
  const defaults = DEFAULT_ARTIFACT_CONSTRUCT_VERIFICATION_THRESHOLDS;
  return {
    trimQuality: boundedInteger(source.trimQuality ?? defaults.trimQuality, 'thresholds.trimQuality', 0, 255),
    trimWindow: boundedInteger(source.trimWindow ?? defaults.trimWindow, 'thresholds.trimWindow', 1, 100),
    minTrimmedReadLength: boundedInteger(
      source.minTrimmedReadLength ?? defaults.minTrimmedReadLength,
      'thresholds.minTrimmedReadLength',
      1,
      ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReadLength,
    ),
    minMappingIdentity: finiteNumber(
      source.minMappingIdentity ?? defaults.minMappingIdentity,
      'thresholds.minMappingIdentity',
      0,
      1,
    ),
    minMappingMargin: finiteNumber(
      source.minMappingMargin ?? defaults.minMappingMargin,
      'thresholds.minMappingMargin',
      0,
      1,
    ),
    maxIndelFraction: finiteNumber(
      source.maxIndelFraction ?? defaults.maxIndelFraction,
      'thresholds.maxIndelFraction',
      0,
      1,
    ),
    minCoverageFraction: finiteNumber(
      source.minCoverageFraction ?? defaults.minCoverageFraction,
      'thresholds.minCoverageFraction',
      0,
      1,
    ),
    minDepth: boundedInteger(
      source.minDepth ?? defaults.minDepth,
      'thresholds.minDepth',
      1,
      ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads,
    ),
    requireBothStrands: (() => {
      const candidate = source.requireBothStrands ?? defaults.requireBothStrands;
      if (typeof candidate !== 'boolean') {
        fail('invalid_input', 'thresholds.requireBothStrands must be a boolean.');
      }
      return candidate;
    })(),
    minConsensusFraction: finiteNumber(
      source.minConsensusFraction ?? defaults.minConsensusFraction,
      'thresholds.minConsensusFraction',
      0,
      1,
    ),
    minVariantQuality: finiteNumber(
      source.minVariantQuality ?? defaults.minVariantQuality,
      'thresholds.minVariantQuality',
      0,
      255,
    ),
    minVariantFraction: finiteNumber(
      source.minVariantFraction ?? defaults.minVariantFraction,
      'thresholds.minVariantFraction',
      0,
      1,
    ),
  };
}

function normalizeReference(value: unknown): NormalizedReference {
  const source = recordValue(value, 'reference');
  const id = normalizeId(source.id, 'reference.id');
  const name = normalizeName(source.name, 'reference.name');
  const sequence = normalizeDna(
    source.sequence,
    'reference.sequence',
    ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReferenceLength,
  );
  if (source.topology !== 'linear' && source.topology !== 'circular') {
    fail('invalid_input', 'reference.topology must be "linear" or "circular".');
  }
  const sha256 = normalizeSha256(source.sha256, sequence, 'reference.sha256');
  return {
    id,
    ...(name === undefined ? {} : { name }),
    sequence,
    topology: source.topology,
    sha256,
  };
}

function normalizeReads(value: unknown): NormalizedRead[] {
  if (!Array.isArray(value)) fail('invalid_input', 'reads must be an array.');
  if (value.length > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads) {
    fail('too_large', `reads exceeds the ${ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads}-read limit.`);
  }
  const seenIds = new Set<string>();
  return value.map((item, index) => {
    const path = `reads[${index}]`;
    const source = recordValue(item, path);
    const id = normalizeId(source.id, `${path}.id`);
    if (seenIds.has(id)) fail('invalid_input', `${path}.id duplicates read id "${id}".`);
    seenIds.add(id);
    const name = normalizeName(source.name, `${path}.name`);
    const baseCalls = normalizeDna(
      source.baseCalls,
      `${path}.baseCalls`,
      ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReadLength,
    );
    const sha256 = normalizeSha256(source.sha256, baseCalls, `${path}.sha256`);
    let qualityScores: number[] | null = null;
    if (source.qualityScores !== undefined) {
      if (!Array.isArray(source.qualityScores) || source.qualityScores.length !== baseCalls.length) {
        fail('invalid_input', `${path}.qualityScores must contain exactly one score per normalized base call.`);
      }
      qualityScores = source.qualityScores.map((score, scoreIndex) => boundedInteger(
        score,
        `${path}.qualityScores[${scoreIndex}]`,
        0,
        255,
      ));
    }
    return {
      id,
      ...(name === undefined ? {} : { name }),
      baseCalls,
      qualityScores,
      sha256,
    };
  });
}

function regionPositions(start: number, end: number, length: number, wraps: boolean): number[] {
  const positions: number[] = [];
  if (!wraps) {
    for (let position = start; position < end; position += 1) positions.push(position);
    return positions;
  }
  for (let position = start; position < length; position += 1) positions.push(position);
  for (let position = 0; position < end; position += 1) positions.push(position);
  return positions;
}

function normalizeRegions(
  value: unknown,
  reference: NormalizedReference,
  thresholds: ArtifactConstructVerificationThresholds,
): NormalizedRegion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('invalid_input', 'requiredRegions must be an array when provided.');
  if (value.length > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxRequiredRegions) {
    fail('too_large', `requiredRegions exceeds the ${ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxRequiredRegions}-region limit.`);
  }
  const seenIds = new Set<string>();
  let totalRegionBases = 0;
  return value.map((item, index) => {
    const path = `requiredRegions[${index}]`;
    const source = recordValue(item, path);
    const id = normalizeId(source.id, `${path}.id`);
    if (seenIds.has(id)) fail('invalid_input', `${path}.id duplicates region id "${id}".`);
    seenIds.add(id);
    const name = normalizeName(source.name, `${path}.name`);
    const start = boundedInteger(source.start, `${path}.start`, 0, reference.sequence.length - 1);
    const end = boundedInteger(source.end, `${path}.end`, 0, reference.sequence.length);
    if (start === end) fail('invalid_input', `${path} must span at least one reference base.`);
    const wraps = start > end;
    if (wraps && reference.topology !== 'circular') {
      fail('invalid_input', `${path} may wrap only on a circular reference.`);
    }
    const minDepth = source.minDepth === undefined
      ? undefined
      : boundedInteger(
        source.minDepth,
        `${path}.minDepth`,
        1,
        ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads,
      );
    if (source.requireBothStrands !== undefined && typeof source.requireBothStrands !== 'boolean') {
      fail('invalid_input', `${path}.requireBothStrands must be a boolean when provided.`);
    }
    const positions = regionPositions(start, end, reference.sequence.length, wraps);
    totalRegionBases += positions.length;
    if (totalRegionBases > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxRequiredRegionBases) {
      fail(
        'too_large',
        `requiredRegions exceeds the cumulative ${ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxRequiredRegionBases.toLocaleString()}-base interval limit.`,
      );
    }
    return {
      id,
      ...(name === undefined ? {} : { name }),
      start,
      end,
      ...(minDepth === undefined ? {} : { minDepth }),
      ...(source.requireBothStrands === undefined
        ? {}
        : { requireBothStrands: source.requireBothStrands }),
      wraps,
      length: positions.length,
      positions,
      effectiveMinDepth: minDepth ?? thresholds.minDepth,
      effectiveRequireBothStrands: source.requireBothStrands ?? thresholds.requireBothStrands,
    };
  });
}

function referenceSlice(sequence: string, start: number, end: number): string {
  return sequence.slice(start, end);
}

function normalizeExpectedVariants(
  value: unknown,
  reference: NormalizedReference,
): ArtifactConstructExpectedVariantInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('invalid_input', 'expectedVariants must be an array when provided.');
  if (value.length > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxExpectedVariants) {
    fail('too_large', `expectedVariants exceeds the ${ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxExpectedVariants}-variant limit.`);
  }
  const seenIds = new Set<string>();
  const seenVariants = new Set<string>();
  return value.map((item, index) => {
    const path = `expectedVariants[${index}]`;
    const source = recordValue(item, path);
    const id = normalizeId(source.id, `${path}.id`);
    if (seenIds.has(id)) fail('invalid_input', `${path}.id duplicates expected variant id "${id}".`);
    seenIds.add(id);
    if (source.type !== 'substitution' && source.type !== 'insertion' && source.type !== 'deletion') {
      fail('invalid_input', `${path}.type must be substitution, insertion, or deletion.`);
    }
    const maximumCoordinate = source.type === 'insertion' && reference.topology === 'linear'
      ? reference.sequence.length
      : reference.sequence.length - 1;
    const referenceStart = boundedInteger(
      source.referenceStart,
      `${path}.referenceStart`,
      0,
      maximumCoordinate,
    );
    const referenceEnd = boundedInteger(
      source.referenceEnd,
      `${path}.referenceEnd`,
      0,
      reference.sequence.length,
    );
    if (typeof source.reference !== 'string' || typeof source.alternate !== 'string') {
      fail('invalid_input', `${path}.reference and ${path}.alternate must be DNA strings.`);
    }
    const referenceAllele = source.reference.toUpperCase();
    const alternate = source.alternate.toUpperCase();
    if (!CANONICAL_DNA_PATTERN.test(referenceAllele) || !CANONICAL_DNA_PATTERN.test(alternate)) {
      fail('invalid_input', `${path} alleles must contain canonical A, C, G, and T bases only.`);
    }
    if (source.type === 'substitution') {
      if (
        referenceEnd !== referenceStart + 1
        || referenceAllele.length !== 1
        || alternate.length !== 1
        || referenceAllele === alternate
      ) {
        fail('invalid_input', `${path} substitution must describe one changed reference base.`);
      }
    } else if (source.type === 'insertion') {
      if (
        referenceEnd !== referenceStart
        || referenceAllele !== ''
        || alternate.length < 1
        || alternate.length > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength
      ) {
        fail('invalid_input', `${path} insertion must use an empty reference allele and 1–${ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength} alternate bases at a zero-width coordinate.`);
      }
    } else if (
      referenceEnd <= referenceStart
      || referenceAllele.length !== referenceEnd - referenceStart
      || referenceAllele.length > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength
      || alternate !== ''
    ) {
      fail('invalid_input', `${path} deletion must use a bounded nonempty reference interval and an empty alternate allele.`);
    }
    if (source.type !== 'insertion') {
      const actualReference = referenceSlice(reference.sequence, referenceStart, referenceEnd);
      if (actualReference !== referenceAllele) {
        fail('invalid_input', `${path}.reference does not match the supplied reference sequence.`);
      }
    }
    const supplied: ArtifactConstructExpectedVariantInput = {
      id,
      type: source.type,
      referenceStart,
      referenceEnd,
      reference: referenceAllele,
      alternate,
    };
    const canonical = canonicalVariant(supplied, reference);
    const normalized: ArtifactConstructExpectedVariantInput = { id, ...canonical };
    const key = variantKey(normalized);
    if (seenVariants.has(key)) fail('invalid_input', `${path} duplicates another expected variant.`);
    seenVariants.add(key);
    return normalized;
  });
}

function normalizeInput(value: ArtifactConstructVerificationInput): NormalizedInput {
  const source = recordValue(value, 'input');
  const thresholds = normalizeThresholds(source.thresholds);
  const reference = normalizeReference(source.reference);
  return {
    reference,
    reads: normalizeReads(source.reads),
    requiredRegions: normalizeRegions(source.requiredRegions, reference, thresholds),
    expectedVariants: normalizeExpectedVariants(source.expectedVariants, reference),
    thresholds,
  };
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function canonicalBase(value: string): value is 'A' | 'C' | 'G' | 'T' {
  return value === 'A' || value === 'C' || value === 'G' || value === 'T';
}

function basesCompatible(left: string, right: string): boolean {
  return ((IUPAC_MASK[left] ?? 0) & (IUPAC_MASK[right] ?? 0)) !== 0;
}

function baseAlignmentScore(referenceBase: string, readBase: string): number {
  if (referenceBase === readBase) return MATCH_SCORE;
  if (basesCompatible(referenceBase, readBase)) return AMBIGUOUS_MATCH_SCORE;
  return MISMATCH_SCORE;
}

function normalizedReferencePosition(
  absolutePosition: number,
  reference: NormalizedReference,
): number | null {
  if (reference.topology === 'circular') return modulo(absolutePosition, reference.sequence.length);
  if (absolutePosition < 0 || absolutePosition >= reference.sequence.length) return null;
  return absolutePosition;
}

function normalizedReferenceBoundary(
  absoluteBoundary: number,
  reference: NormalizedReference,
): number | null {
  if (reference.topology === 'circular') return modulo(absoluteBoundary, reference.sequence.length);
  if (absoluteBoundary < 0 || absoluteBoundary > reference.sequence.length) return null;
  return absoluteBoundary;
}

function referenceBaseAt(absolutePosition: number, reference: NormalizedReference): string | null {
  const position = normalizedReferencePosition(absolutePosition, reference);
  return position === null ? null : reference.sequence[position];
}

function qualityWeight(score: number | null): number {
  return score === null ? 1 : score + 1;
}

function readTrim(
  read: NormalizedRead,
  thresholds: ArtifactConstructVerificationThresholds,
  work: WorkCounter,
): { trim: ArtifactConstructReadTrim; meanQuality: number | null } {
  const length = read.baseCalls.length;
  if (read.qualityScores === null) {
    return {
      trim: {
        method: 'none_missing_quality',
        rawStart: 0,
        rawEnd: length,
        trimmedLength: length,
        removedFromStart: 0,
        removedFromEnd: 0,
      },
      meanQuality: null,
    };
  }

  const prefix = new Float64Array(length + 1);
  for (let index = 0; index < length; index += 1) {
    prefix[index + 1] = prefix[index] + read.qualityScores[index];
    work.spend();
  }
  const window = Math.min(length, thresholds.trimWindow);
  let start = -1;
  for (let index = 0; index + window <= length; index += 1) {
    work.spend();
    const mean = (prefix[index + window] - prefix[index]) / window;
    if (mean >= thresholds.trimQuality) {
      start = index;
      break;
    }
  }
  let end = -1;
  if (start >= 0) {
    for (let candidateEnd = length; candidateEnd - window >= start; candidateEnd -= 1) {
      work.spend();
      const mean = (prefix[candidateEnd] - prefix[candidateEnd - window]) / window;
      if (mean >= thresholds.trimQuality) {
        end = candidateEnd;
        break;
      }
    }
  }
  if (start < 0 || end < start) {
    start = 0;
    end = 0;
  }
  const trimmedLength = end - start;
  return {
    trim: {
      method: 'quality_window',
      rawStart: start,
      rawEnd: end,
      trimmedLength,
      removedFromStart: start,
      removedFromEnd: length - end,
    },
    meanQuality: trimmedLength === 0 ? null : (prefix[end] - prefix[start]) / trimmedLength,
  };
}

function orientRead(
  read: NormalizedRead,
  trim: ArtifactConstructReadTrim,
  orientation: 'forward' | 'reverse',
): OrientedRead {
  const trimmed = read.baseCalls.slice(trim.rawStart, trim.rawEnd);
  const sequence = orientation === 'forward' ? trimmed : reverseComplement(trimmed).toUpperCase();
  const rawCallIndices = new Array<number>(trim.trimmedLength);
  const qualityScores = new Array<number | null>(trim.trimmedLength);
  const rawBases = new Array<string>(trim.trimmedLength);
  for (let orientedIndex = 0; orientedIndex < trim.trimmedLength; orientedIndex += 1) {
    const rawIndex = orientation === 'forward'
      ? trim.rawStart + orientedIndex
      : trim.rawEnd - 1 - orientedIndex;
    rawCallIndices[orientedIndex] = rawIndex;
    qualityScores[orientedIndex] = read.qualityScores?.[rawIndex] ?? null;
    rawBases[orientedIndex] = read.baseCalls[rawIndex];
  }
  return { orientation, sequence, rawCallIndices, qualityScores, rawBases };
}

type ReferenceSeedIndex = Map<string, number[]>;
type ReferenceSeedIndexCache = Map<number, ReferenceSeedIndex>;

function seedAt(reference: NormalizedReference, start: number, length: number): string | null {
  if (reference.topology === 'linear') {
    if (start + length > reference.sequence.length) return null;
    return reference.sequence.slice(start, start + length);
  }
  let seed = '';
  for (let offset = 0; offset < length; offset += 1) {
    seed += reference.sequence[modulo(start + offset, reference.sequence.length)];
  }
  return seed;
}

function referenceSeedIndex(
  reference: NormalizedReference,
  seedLength: number,
  cache: ReferenceSeedIndexCache,
  work: WorkCounter,
): ReferenceSeedIndex {
  const cached = cache.get(seedLength);
  if (cached !== undefined) return cached;
  const index: ReferenceSeedIndex = new Map();
  const finalStart = reference.topology === 'circular'
    ? reference.sequence.length - 1
    : reference.sequence.length - seedLength;
  for (let start = 0; start <= finalStart; start += 1) {
    work.spend();
    const seed = seedAt(reference, start, seedLength);
    if (seed === null || !CANONICAL_DNA_PATTERN.test(seed)) continue;
    const positions = index.get(seed);
    if (positions === undefined) index.set(seed, [start]);
    else positions.push(start);
  }
  cache.set(seedLength, index);
  return index;
}

function seedOffsets(readLength: number, seedLength: number): number[] {
  if (seedLength > readLength) return [];
  const finalOffset = readLength - seedLength;
  const stride = Math.max(1, Math.floor(Math.max(1, finalOffset) / 24));
  const offsets: number[] = [];
  for (let offset = 0; offset <= finalOffset; offset += stride) offsets.push(offset);
  if (offsets.at(-1) !== finalOffset) offsets.push(finalOffset);
  return offsets;
}

function startDistance(
  left: number,
  right: number,
  reference: NormalizedReference,
): number {
  const direct = Math.abs(left - right);
  return reference.topology === 'circular'
    ? Math.min(direct, reference.sequence.length - direct)
    : direct;
}

function selectCandidateStarts(
  votes: Map<number, number>,
  reference: NormalizedReference,
): CandidateSearch {
  const ranked = [...votes.entries()]
    .map(([start, count]) => ({ start, votes: count }))
    .sort((left, right) => right.votes - left.votes || left.start - right.start);
  const selected: CandidateStart[] = [];
  let truncated = false;
  const clusterRadius = ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength * 2;
  for (const candidate of ranked) {
    // Lower-vote offsets in the same indel-sized neighborhood are alternate
    // seed estimates of one locus. Equal-vote loci stay distinct so short or
    // tandem repeats cannot be promoted to a unique mapping.
    if (selected.some((existing) => (
      existing.votes > candidate.votes
      && startDistance(existing.start, candidate.start, reference) <= clusterRadius
    ))) {
      truncated = true;
      continue;
    }
    if (selected.length >= MAX_MAPPING_CANDIDATES_PER_ORIENTATION) {
      truncated = true;
      break;
    }
    selected.push(candidate);
  }
  return {
    candidates: selected.sort((left, right) => left.start - right.start),
    truncated,
  };
}

function mappingCandidates(
  oriented: OrientedRead,
  reference: NormalizedReference,
  cache: ReferenceSeedIndexCache,
  work: WorkCounter,
): CandidateSearch {
  const readLength = oriented.sequence.length;
  const primaryLength = Math.min(11, Math.max(1, Math.floor(readLength / 4)));
  const seedLengths = [...new Set([
    primaryLength,
    Math.min(primaryLength, 5),
    Math.min(primaryLength, 3),
    1,
  ])].filter((length) => length <= readLength);

  const aggregateVotes = new Map<number, number>();
  let truncated = false;

  for (const seedLength of seedLengths) {
    const index = referenceSeedIndex(reference, seedLength, cache, work);
    const votes = new Map<number, number>();
    for (const readOffset of seedOffsets(readLength, seedLength)) {
      const seed = oriented.sequence.slice(readOffset, readOffset + seedLength);
      work.spend();
      if (!CANONICAL_DNA_PATTERN.test(seed)) continue;
      const referencePositions = index.get(seed);
      if (referencePositions === undefined) continue;
      // Every occurrence participates. The work counter bounds repetitive
      // inputs; silently truncating the list could turn missing contenders
      // into a false claim of unique mapping.
      for (let occurrence = 0; occurrence < referencePositions.length; occurrence += 1) {
        work.spend();
        const referencePosition = referencePositions[occurrence];
        let start = referencePosition - readOffset;
        if (reference.topology === 'circular') {
          start = modulo(start, reference.sequence.length);
        } else if (
          start < -ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength
          || start >= reference.sequence.length
        ) {
          continue;
        }
        votes.set(start, (votes.get(start) ?? 0) + 1);
      }
    }
    // Retain bounded contenders from every seed scale. A single incidental
    // long seed must not prevent the true, slightly noisy locus from being
    // recovered by shorter seeds.
    const selection = selectCandidateStarts(votes, reference);
    truncated ||= selection.truncated;
    for (const candidate of selection.candidates) {
      const weightedVotes = candidate.votes * seedLength;
      aggregateVotes.set(
        candidate.start,
        Math.max(aggregateVotes.get(candidate.start) ?? 0, weightedVotes),
      );
    }
  }

  if (aggregateVotes.size > 0) {
    const selection = selectCandidateStarts(aggregateVotes, reference);
    return {
      candidates: selection.candidates,
      truncated: truncated || selection.truncated,
    };
  }

  if (readLength <= 16 || reference.sequence.length <= 512) {
    const votes = new Map<number, number>();
    const first = reference.topology === 'linear'
      ? -Math.min(ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength, readLength)
      : 0;
    const last = reference.sequence.length - 1;
    for (let start = first; start <= last; start += 1) {
      votes.set(start, 1);
      work.spend();
    }
    const selection = selectCandidateStarts(votes, reference);
    return {
      candidates: selection.candidates,
      truncated: truncated || selection.truncated,
    };
  }
  return { candidates: [], truncated };
}

function exhaustiveMappingWorkEstimate(
  readLength: number,
  reference: NormalizedReference,
  band: number,
): number {
  const candidateCount = reference.topology === 'circular'
    ? reference.sequence.length
    : reference.sequence.length + Math.min(band, readLength);
  const dynamicProgrammingWidth = (band * 2) + 3;
  const scoringPasses = candidateCount * 2;
  // A fixed alignment path can fall inside at most 2*band+1 integer-centered
  // bands for one orientation. After the best traceback, that many duplicate
  // paths may need to be skipped before the first scientifically distinct
  // runner-up is found. The opposite orientation is already a distinct path.
  // This is a complete bound, while avoiding an unnecessary traceback reserve
  // for every start that was already scored.
  const tracebackPasses = Math.min(scoringPasses, (band * 2) + 2);
  return (scoringPasses + tracebackPasses)
    * readLength
    * dynamicProgrammingWidth;
}

function exhaustiveAlignmentBand(
  readLength: number,
  reference: NormalizedReference,
  maxIndelFraction: number,
): number {
  const maximumCumulativeIndels = maxIndelFraction >= 1
    ? reference.sequence.length + readLength
    : Math.ceil((maxIndelFraction * readLength) / Math.max(Number.EPSILON, 1 - maxIndelFraction));
  // Every allowed path has a diagonal range no larger than its cumulative
  // indel count. Enumerating all integer centers with half that range covers it.
  return Math.max(
    ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength,
    Math.ceil(maximumCumulativeIndels / 2),
  );
}

function exhaustiveCandidateStarts(
  readLength: number,
  reference: NormalizedReference,
  band: number,
): CandidateStart[] {
  const first = reference.topology === 'linear'
    ? -Math.min(band, readLength)
    : 0;
  const last = reference.sequence.length - 1;
  const candidates: CandidateStart[] = [];
  for (let start = first; start <= last; start += 1) candidates.push({ start, votes: 0 });
  return candidates;
}

function exactOccurrenceStarts(
  oriented: OrientedRead,
  reference: NormalizedReference,
  work: WorkCounter,
): number[] {
  work.spend(Math.max(1, reference.sequence.length));
  if (!CANONICAL_DNA_PATTERN.test(oriented.sequence)) return [];
  if (reference.topology === 'linear') {
    if (oriented.sequence.length > reference.sequence.length) return [];
    const starts: number[] = [];
    let start = reference.sequence.indexOf(oriented.sequence);
    while (start >= 0) {
      starts.push(start);
      if (starts.length >= 2) break;
      start = reference.sequence.indexOf(oriented.sequence, start + 1);
    }
    return starts;
  }
  // Multi-lap circular reads are never promoted by this shortcut; the regular
  // mapper must keep their repeated coordinates review-only.
  if (oriented.sequence.length > reference.sequence.length) return [];
  const searchable = reference.sequence
    + reference.sequence.slice(0, Math.max(0, oriented.sequence.length - 1));
  const starts: number[] = [];
  let start = searchable.indexOf(oriented.sequence);
  while (start >= 0 && start < reference.sequence.length) {
    starts.push(start);
    if (starts.length >= 2) break;
    start = searchable.indexOf(oriented.sequence, start + 1);
  }
  return starts;
}

function exactMappingCandidates(
  orientedReads: readonly OrientedRead[],
  reference: NormalizedReference,
  work: WorkCounter,
): Array<{ orientation: OrientedRead['orientation']; start: number }> {
  const candidates: Array<{ orientation: OrientedRead['orientation']; start: number }> = [];
  for (const oriented of orientedReads) {
    for (const start of exactOccurrenceStarts(oriented, reference, work)) {
      candidates.push({ orientation: oriented.orientation, start });
      // Two exact canonical occurrences already prove non-uniqueness. More
      // occurrences cannot change the safe classification.
      if (candidates.length >= 2) return candidates;
    }
  }
  return candidates;
}

type BandedAlignmentRun = {
  score: number;
  alignment: AlignmentResult | null;
};

function runBandedAlignment(
  oriented: OrientedRead,
  reference: NormalizedReference,
  candidateStart: number,
  band: number,
  work: WorkCounter,
  includeTraceback: boolean,
): BandedAlignmentRun {
  const readLength = oriented.sequence.length;
  const rawWindowStart = candidateStart - band;
  const rawWindowEnd = candidateStart + readLength + band;
  const windowStart = reference.topology === 'linear' ? Math.max(0, rawWindowStart) : rawWindowStart;
  const windowEnd = reference.topology === 'linear'
    ? Math.min(reference.sequence.length, rawWindowEnd)
    : rawWindowEnd;
  const windowLength = windowEnd - windowStart;
  if (windowLength <= 0) return { score: NEGATIVE_INFINITY, alignment: null };
  const expectedOffset = candidateStart - windowStart;
  const width = (band * 2) + 3;
  const previous = new Int32Array(windowLength + 1);
  const current = new Int32Array(windowLength + 1);
  const rowStarts = includeTraceback ? new Int32Array(readLength + 1) : null;
  const traces = includeTraceback ? new Uint8Array((readLength + 1) * width) : null;

  let previousStart = Math.max(0, expectedOffset - band);
  let previousEnd = Math.min(windowLength, expectedOffset + band);
  for (let column = previousStart; column <= previousEnd; column += 1) previous[column] = 0;
  if (rowStarts !== null) rowStarts[0] = previousStart;

  for (let row = 1; row <= readLength; row += 1) {
    const expectedColumn = expectedOffset + row;
    const currentStart = Math.max(0, expectedColumn - band);
    const currentEnd = Math.min(windowLength, expectedColumn + band);
    if (rowStarts !== null) rowStarts[row] = currentStart;
    for (let column = currentStart; column <= currentEnd; column += 1) {
      work.spend();
      let bestScore = NEGATIVE_INFINITY;
      let direction = 0;
      if (
        column > 0
        && column - 1 >= previousStart
        && column - 1 <= previousEnd
      ) {
        const referenceBase = referenceBaseAt(windowStart + column - 1, reference);
        if (referenceBase !== null) {
          bestScore = previous[column - 1]
            + baseAlignmentScore(referenceBase, oriented.sequence[row - 1]);
          direction = 1;
        }
      }
      if (column >= previousStart && column <= previousEnd) {
        const insertionScore = previous[column] + GAP_SCORE;
        if (insertionScore > bestScore) {
          bestScore = insertionScore;
          direction = 2;
        }
      }
      if (column > currentStart) {
        const deletionScore = current[column - 1] + GAP_SCORE;
        if (deletionScore > bestScore) {
          bestScore = deletionScore;
          direction = 3;
        }
      }
      current[column] = bestScore;
      if (traces !== null) traces[(row * width) + (column - currentStart)] = direction;
    }
    for (let column = currentStart; column <= currentEnd; column += 1) {
      previous[column] = current[column];
    }
    previousStart = currentStart;
    previousEnd = currentEnd;
  }

  const expectedEnd = expectedOffset + readLength;
  let endColumn = -1;
  let bestScore = NEGATIVE_INFINITY;
  for (let column = previousStart; column <= previousEnd; column += 1) {
    const score = previous[column];
    if (
      score > bestScore
      || (
        score === bestScore
        && (
          endColumn < 0
          || Math.abs(column - expectedEnd) < Math.abs(endColumn - expectedEnd)
          || (
            Math.abs(column - expectedEnd) === Math.abs(endColumn - expectedEnd)
            && column < endColumn
          )
        )
      )
    ) {
      bestScore = score;
      endColumn = column;
    }
  }
  if (!includeTraceback || traces === null || rowStarts === null || endColumn < 0) {
    return { score: bestScore, alignment: null };
  }

  const reversedColumns: Array<{
    column: ArtifactConstructAlignmentColumn;
    absoluteReferencePosition: number | null;
  }> = [];
  let row = readLength;
  let column = endColumn;
  while (row > 0) {
    const rowStart = rowStarts[row];
    const traceOffset = column - rowStart;
    if (traceOffset < 0 || traceOffset >= width) return { score: bestScore, alignment: null };
    const direction = traces[(row * width) + traceOffset];
    if (direction === 1) {
      const absoluteReferencePosition = windowStart + column - 1;
      const referencePosition = normalizedReferencePosition(absoluteReferencePosition, reference);
      const referenceBase = referenceBaseAt(absoluteReferencePosition, reference);
      const orientedIndex = row - 1;
      const readBase = oriented.sequence[orientedIndex];
      if (referencePosition === null || referenceBase === null) {
        return { score: bestScore, alignment: null };
      }
      reversedColumns.push({
        absoluteReferencePosition,
        column: {
          operation: referenceBase === readBase && canonicalBase(referenceBase)
            ? 'match'
            : 'substitution',
          referencePosition,
          referenceBoundary: null,
          rawCallIndex: oriented.rawCallIndices[orientedIndex],
          orientedCallIndex: orientedIndex,
          referenceBase,
          readBase,
          rawBase: oriented.rawBases[orientedIndex],
          qualityScore: oriented.qualityScores[orientedIndex],
        },
      });
      row -= 1;
      column -= 1;
    } else if (direction === 2) {
      const orientedIndex = row - 1;
      const boundary = normalizedReferenceBoundary(windowStart + column, reference);
      if (boundary === null) return { score: bestScore, alignment: null };
      reversedColumns.push({
        absoluteReferencePosition: null,
        column: {
          operation: 'insertion',
          referencePosition: null,
          referenceBoundary: boundary,
          rawCallIndex: oriented.rawCallIndices[orientedIndex],
          orientedCallIndex: orientedIndex,
          referenceBase: null,
          readBase: oriented.sequence[orientedIndex],
          rawBase: oriented.rawBases[orientedIndex],
          qualityScore: oriented.qualityScores[orientedIndex],
        },
      });
      row -= 1;
    } else if (direction === 3) {
      const absoluteReferencePosition = windowStart + column - 1;
      const referencePosition = normalizedReferencePosition(absoluteReferencePosition, reference);
      const referenceBase = referenceBaseAt(absoluteReferencePosition, reference);
      if (referencePosition === null || referenceBase === null) {
        return { score: bestScore, alignment: null };
      }
      reversedColumns.push({
        absoluteReferencePosition,
        column: {
          operation: 'deletion',
          referencePosition,
          referenceBoundary: null,
          rawCallIndex: null,
          orientedCallIndex: null,
          referenceBase,
          readBase: null,
          rawBase: null,
          qualityScore: null,
        },
      });
      column -= 1;
    } else {
      return { score: bestScore, alignment: null };
    }
  }

  const traced = reversedColumns.reverse();
  const referenceColumns = traced.filter((entry) => entry.absoluteReferencePosition !== null);
  if (referenceColumns.length === 0) return { score: bestScore, alignment: null };
  const firstAbsolute = referenceColumns[0].absoluteReferencePosition as number;
  const lastAbsolute = referenceColumns.at(-1)?.absoluteReferencePosition as number;
  const referenceSpan = lastAbsolute - firstAbsolute + 1;
  const referenceStart = normalizedReferencePosition(firstAbsolute, reference) as number;
  let referenceEnd: number;
  let wraps = false;
  if (reference.topology === 'linear') {
    referenceEnd = lastAbsolute + 1;
  } else {
    wraps = Math.floor(firstAbsolute / reference.sequence.length)
      !== Math.floor(lastAbsolute / reference.sequence.length);
    referenceEnd = wraps
      ? modulo(lastAbsolute + 1, reference.sequence.length)
      : referenceStart + referenceSpan;
  }
  const columns = traced.map((entry) => entry.column);
  let matches = 0;
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;
  let maximumIndelRun = 0;
  let currentIndelRun = 0;
  let currentIndelOperation: 'insertion' | 'deletion' | null = null;
  for (const alignmentColumn of columns) {
    if (alignmentColumn.operation === 'match') matches += 1;
    else if (alignmentColumn.operation === 'substitution') substitutions += 1;
    else if (alignmentColumn.operation === 'insertion') insertions += 1;
    else deletions += 1;
    if (alignmentColumn.operation === 'insertion' || alignmentColumn.operation === 'deletion') {
      if (alignmentColumn.operation === currentIndelOperation) currentIndelRun += 1;
      else {
        currentIndelOperation = alignmentColumn.operation;
        currentIndelRun = 1;
      }
      maximumIndelRun = Math.max(maximumIndelRun, currentIndelRun);
    } else {
      currentIndelOperation = null;
      currentIndelRun = 0;
    }
  }
  const alignedLength = columns.length;
  const identity = alignedLength === 0 ? 0 : matches / alignedLength;
  const indelFraction = alignedLength === 0 ? 0 : (insertions + deletions) / alignedLength;
  return {
    score: bestScore,
    alignment: {
      maximumIndelRun,
      mapping: {
        orientation: oriented.orientation,
        referenceStart,
        referenceEnd,
        wraps,
        referenceSpan,
        score: bestScore,
        secondBestScore: null,
        mappingMargin: null,
        identity,
        alignedLength,
        matches,
        substitutions,
        insertions,
        deletions,
        indelFraction,
        coordinateMap: {
          columns,
          referencePositions: columns.map((entry) => entry.referencePosition),
          rawCallIndices: columns.map((entry) => entry.rawCallIndex),
        },
      },
    },
  };
}

function alignmentPathSignature(mapping: ArtifactConstructReadMapping): string {
  return `${mapping.orientation}|${mapping.coordinateMap.columns.map((column) => (
    `${column.operation[0]}:${column.referencePosition ?? `b${column.referenceBoundary}`}:${column.rawCallIndex ?? '-'}`
  )).join(',')}`;
}

function circularMappingRepeatsReferencePosition(mapping: ArtifactConstructReadMapping): boolean {
  const seen = new Set<number>();
  for (const position of mapping.coordinateMap.referencePositions) {
    if (position === null) continue;
    if (seen.has(position)) return true;
    seen.add(position);
  }
  return false;
}

function mapRead(
  read: NormalizedRead,
  trim: ArtifactConstructReadTrim,
  reference: NormalizedReference,
  thresholds: ArtifactConstructVerificationThresholds,
  seedCache: ReferenceSeedIndexCache,
  work: WorkCounter,
  exhaustiveSearchBudget: number,
): { status: ArtifactConstructReadStatus; alignment: AlignmentResult | null } {
  const orientedReads = [
    orientRead(read, trim, 'forward'),
    orientRead(read, trim, 'reverse'),
  ];
  const exactCandidates = exactMappingCandidates(orientedReads, reference, work);
  // Two exact occurrences prove ambiguity immediately. One exact occurrence
  // proves only that the global maximum is unique; it does not prove the
  // configured separation from a near-exact runner-up. Use the one-hit
  // shortcut only when no positive mapping margin was requested.
  const useExactShortcut = exactCandidates.length >= 2
    || (exactCandidates.length === 1 && thresholds.minMappingMargin === 0);
  const exhaustiveBand = exhaustiveAlignmentBand(
    trim.trimmedLength,
    reference,
    thresholds.maxIndelFraction,
  );
  const useExhaustiveSearch = !useExactShortcut
    && exhaustiveMappingWorkEstimate(
      trim.trimmedLength,
      reference,
      exhaustiveBand,
    ) <= exhaustiveSearchBudget;
  const exhaustiveCandidates = useExhaustiveSearch
    ? exhaustiveCandidateStarts(trim.trimmedLength, reference, exhaustiveBand)
    : null;
  const alignmentBand = exhaustiveCandidates === null
    ? ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength
    : exhaustiveBand;
  const scored: ScoredCandidate[] = [];
  // Sampled seeds schedule a useful tentative alignment, but they are not a
  // completeness proof. Only a unique exact global maximum or an exhaustive
  // bounded start scan may support a claim of unique mapping.
  let candidateSearchIncomplete = !useExactShortcut && exhaustiveCandidates === null;
  for (const oriented of orientedReads) {
    const search: CandidateSearch = useExactShortcut
      ? {
          candidates: exactCandidates
            .filter((candidate) => candidate.orientation === oriented.orientation)
            .map((candidate) => ({ start: candidate.start, votes: 0 })),
          truncated: false,
        }
      : exhaustiveCandidates !== null
        ? { candidates: exhaustiveCandidates, truncated: false }
        : mappingCandidates(oriented, reference, seedCache, work);
    candidateSearchIncomplete ||= search.truncated;
    for (const candidate of search.candidates) {
      const run = runBandedAlignment(
        oriented,
        reference,
        candidate.start,
        alignmentBand,
        work,
        false,
      );
      if (run.score > NEGATIVE_INFINITY / 2) {
        scored.push({
          orientation: oriented.orientation,
          candidateStart: candidate.start,
          score: run.score,
        });
      }
    }
  }
  scored.sort((left, right) => (
    right.score - left.score
    || (left.orientation === right.orientation ? 0 : left.orientation === 'forward' ? -1 : 1)
    || left.candidateStart - right.candidateStart
  ));
  const best = scored[0];
  if (best === undefined) return { status: 'unmapped', alignment: null };
  const oriented = orientedReads.find((entry) => entry.orientation === best.orientation) as OrientedRead;
  const rerun = runBandedAlignment(
    oriented,
    reference,
    best.candidateStart,
    alignmentBand,
    work,
    true,
  );
  if (rerun.alignment === null) return { status: 'unmapped', alignment: null };
  const bestSignature = alignmentPathSignature(rerun.alignment.mapping);

  if (rerun.alignment.mapping.identity < thresholds.minMappingIdentity) {
    return { status: 'low_mapping_identity', alignment: rerun.alignment };
  }
  if (
    rerun.alignment.maximumIndelRun > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength
    || rerun.alignment.mapping.indelFraction > thresholds.maxIndelFraction
  ) {
    return { status: 'excessive_indel', alignment: rerun.alignment };
  }
  if (
    reference.topology === 'circular'
    && circularMappingRepeatsReferencePosition(rerun.alignment.mapping)
  ) {
    return { status: 'ambiguous_mapping', alignment: rerun.alignment };
  }
  // A sampled or bounded candidate search is a scheduling aid, never evidence
  // of uniqueness. If either orientation was not exhaustively proven, an
  // unscored contender could tie the display alignment, so keep it review-only.
  if (candidateSearchIncomplete) {
    return { status: 'ambiguous_mapping', alignment: rerun.alignment };
  }
  let secondBestScore: number | null = null;
  for (let contenderIndex = 1; contenderIndex < scored.length; contenderIndex += 1) {
    const contender = scored[contenderIndex];
    const contenderRead = orientedReads.find((entry) => (
      entry.orientation === contender.orientation
    )) as OrientedRead;
    const contenderRun = runBandedAlignment(
      contenderRead,
      reference,
      contender.candidateStart,
      alignmentBand,
      work,
      true,
    );
    const contenderSignature = contenderRun.alignment === null
      ? undefined
      : alignmentPathSignature(contenderRun.alignment.mapping);
    if (contenderSignature !== undefined && contenderSignature !== bestSignature) {
      secondBestScore = contender.score;
      break;
    }
  }
  const mappingMargin = secondBestScore === null
    ? null
    : (best.score - secondBestScore) / Math.max(1, MATCH_SCORE * trim.trimmedLength);
  rerun.alignment.mapping.secondBestScore = secondBestScore;
  rerun.alignment.mapping.mappingMargin = mappingMargin;
  if (
    secondBestScore !== null
    && (secondBestScore === best.score || (mappingMargin ?? 0) < thresholds.minMappingMargin)
  ) {
    return { status: 'ambiguous_mapping', alignment: rerun.alignment };
  }
  return { status: 'mapped', alignment: rerun.alignment };
}

function reason(
  code: ArtifactConstructVerificationReasonCode,
  severity: ArtifactConstructVerificationReason['severity'],
  message: string,
  ids: Pick<ArtifactConstructVerificationReason, 'readId' | 'regionId' | 'variantId'> = {},
): ArtifactConstructVerificationReason {
  return {
    code,
    severity,
    message,
    ...(ids.readId === undefined ? {} : { readId: ids.readId }),
    ...(ids.regionId === undefined ? {} : { regionId: ids.regionId }),
    ...(ids.variantId === undefined ? {} : { variantId: ids.variantId }),
  };
}

function readReason(read: NormalizedRead, status: ArtifactConstructReadStatus): ArtifactConstructVerificationReason {
  const label = read.name ?? read.id;
  if (status === 'trimmed_read_too_short') {
    return reason('trimmed_read_too_short', 'review', `${label} is too short after quality-aware end trimming.`, { readId: read.id });
  }
  if (status === 'ambiguous_mapping') {
    return reason('ambiguous_mapping', 'review', `${label} does not have a unique best reference mapping.`, { readId: read.id });
  }
  if (status === 'low_mapping_identity') {
    return reason('low_mapping_identity', 'review', `${label}'s best mapping is below the minimum identity.`, { readId: read.id });
  }
  if (status === 'excessive_indel') {
    return reason('excessive_indel', 'review', `${label}'s best mapping exceeds the bounded indel allowance.`, { readId: read.id });
  }
  return reason('unmapped_read', 'review', `${label} could not be mapped to the reference.`, { readId: read.id });
}

function variantKey(
  variant: Pick<
    ArtifactConstructExpectedVariantInput,
    'type' | 'referenceStart' | 'referenceEnd' | 'reference' | 'alternate'
  >,
): string {
  return [
    variant.type,
    variant.referenceStart,
    variant.referenceEnd,
    variant.reference,
    variant.alternate,
  ].join(':');
}

type VariantDescriptor = Pick<
  ArtifactConstructExpectedVariantInput,
  'type' | 'referenceStart' | 'referenceEnd' | 'reference' | 'alternate'
>;

/**
 * Left-normalize indels. Linear references use the conventional leftmost
 * representation. Circular references have no intrinsic left edge, so all
 * equivalent rotations (at most one lap) are considered and the lowest
 * numeric boundary, then lexical allele, is canonical.
 */
function canonicalVariant(
  variant: VariantDescriptor,
  reference: NormalizedReference,
): VariantDescriptor {
  if (variant.type === 'substitution') return { ...variant };
  const sequenceLength = reference.sequence.length;
  const allele = variant.type === 'insertion' ? variant.alternate : variant.reference;
  let start = variant.referenceStart;
  let rotatedAllele = allele;
  const representations: Array<{ start: number; allele: string }> = [{ start, allele: rotatedAllele }];
  const seen = new Set([`${start}:${rotatedAllele}`]);
  const stepLimit = reference.topology === 'circular' ? sequenceLength : start;
  for (let step = 0; step < stepLimit; step += 1) {
    if (rotatedAllele.length === 0 || (reference.topology === 'linear' && start === 0)) break;
    const previousPosition = reference.topology === 'circular'
      ? modulo(start - 1, sequenceLength)
      : start - 1;
    const finalAlleleBase = rotatedAllele.at(-1) as string;
    if (reference.sequence[previousPosition] !== finalAlleleBase) break;
    start = reference.topology === 'circular' ? previousPosition : start - 1;
    rotatedAllele = finalAlleleBase + rotatedAllele.slice(0, -1);
    const state = `${start}:${rotatedAllele}`;
    if (seen.has(state)) break;
    seen.add(state);
    representations.push({ start, allele: rotatedAllele });
  }
  const length = allele.length;
  const representable = representations.filter((entry) => (
    variant.type === 'insertion'
    || entry.start + length <= sequenceLength
  ));
  const selected = (reference.topology === 'circular'
    ? representable.sort((left, right) => left.start - right.start || left.allele.localeCompare(right.allele))[0]
    : representable.at(-1)) ?? representations[0];
  if (variant.type === 'insertion') {
    return {
      type: 'insertion',
      referenceStart: selected.start,
      referenceEnd: selected.start,
      reference: '',
      alternate: selected.allele,
    };
  }
  return {
    type: 'deletion',
    referenceStart: selected.start,
    referenceEnd: selected.start + length,
    reference: selected.allele,
    alternate: '',
  };
}

function variantTypeRank(type: ArtifactConstructVariantType): number {
  if (type === 'substitution') return 0;
  if (type === 'insertion') return 1;
  return 2;
}

function compareVariants(
  left: Pick<ArtifactConstructObservedVariant, 'referenceStart' | 'referenceEnd' | 'type' | 'reference' | 'alternate'>,
  right: Pick<ArtifactConstructObservedVariant, 'referenceStart' | 'referenceEnd' | 'type' | 'reference' | 'alternate'>,
): number {
  return left.referenceStart - right.referenceStart
    || left.referenceEnd - right.referenceEnd
    || variantTypeRank(left.type) - variantTypeRank(right.type)
    || left.reference.localeCompare(right.reference)
    || left.alternate.localeCompare(right.alternate);
}

function nearestColumnQuality(
  columns: readonly ArtifactConstructAlignmentColumn[],
  index: number,
): number | null {
  for (let distance = 1; distance < columns.length; distance += 1) {
    const left = columns[index - distance]?.qualityScore;
    const right = columns[index + distance]?.qualityScore;
    if (left !== undefined && left !== null && right !== undefined && right !== null) {
      return (left + right) / 2;
    }
    if (left !== undefined && left !== null) return left;
    if (right !== undefined && right !== null) return right;
  }
  return null;
}

function addVariantEvidence(
  evidenceByKey: Map<string, VariantEvidence>,
  variant: VariantDescriptor,
  readId: string,
  qualityScores: readonly (number | null)[],
  reference: NormalizedReference,
): void {
  const normalizedVariant = canonicalVariant(variant, reference);
  const key = variantKey(normalizedVariant);
  let evidence = evidenceByKey.get(key);
  if (evidence === undefined) {
    if (evidenceByKey.size >= ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxObservedVariants) {
      fail(
        'work_budget',
        `Construct verification exceeded the ${ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxObservedVariants.toLocaleString()}-variant evidence limit.`,
      );
    }
    evidence = {
      ...normalizedVariant,
      readIds: new Set(),
      weightByRead: new Map(),
      qualityByRead: new Map(),
    };
    evidenceByKey.set(key, evidence);
  }
  if (evidence.readIds.has(readId)) return;
  evidence.readIds.add(readId);
  const knownScores = qualityScores.filter((score): score is number => score !== null);
  const eventQuality = knownScores.length === 0
    ? null
    : knownScores.reduce((total, score) => total + score, 0) / knownScores.length;
  evidence.weightByRead.set(readId, qualityWeight(eventQuality));
  evidence.qualityByRead.set(readId, eventQuality);
}

function collectReadVariantEvidence(
  readId: string,
  columns: readonly ArtifactConstructAlignmentColumn[],
  evidenceByKey: Map<string, VariantEvidence>,
  reference: NormalizedReference,
): void {
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    if (
      column.operation === 'substitution'
      && column.referencePosition !== null
      && column.referenceBase !== null
      && column.readBase !== null
      && canonicalBase(column.referenceBase)
      && canonicalBase(column.readBase)
    ) {
      addVariantEvidence(evidenceByKey, {
        type: 'substitution',
        referenceStart: column.referencePosition,
        referenceEnd: column.referencePosition + 1,
        reference: column.referenceBase,
        alternate: column.readBase,
      }, readId, [column.qualityScore], reference);
      continue;
    }

    if (column.operation === 'insertion' && column.referenceBoundary !== null) {
      const boundary = column.referenceBoundary;
      let alternate = '';
      const qualities: Array<number | null> = [];
      let finalIndex = index;
      while (
        finalIndex < columns.length
        && columns[finalIndex].operation === 'insertion'
        && columns[finalIndex].referenceBoundary === boundary
      ) {
        alternate += columns[finalIndex].readBase ?? '';
        qualities.push(columns[finalIndex].qualityScore);
        finalIndex += 1;
      }
      if (
        alternate.length > 0
        && alternate.length <= ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength
        && CANONICAL_DNA_PATTERN.test(alternate)
      ) {
        addVariantEvidence(evidenceByKey, {
          type: 'insertion',
          referenceStart: boundary,
          referenceEnd: boundary,
          reference: '',
          alternate,
        }, readId, qualities, reference);
      }
      index = finalIndex - 1;
      continue;
    }

    if (
      column.operation === 'deletion'
      && column.referencePosition !== null
      && column.referenceBase !== null
    ) {
      const start = column.referencePosition;
      let end = start;
      let deleted = '';
      let finalIndex = index;
      while (finalIndex < columns.length) {
        const candidate = columns[finalIndex];
        if (
          candidate.operation !== 'deletion'
          || candidate.referencePosition === null
          || candidate.referenceBase === null
          || candidate.referencePosition !== end
        ) break;
        deleted += candidate.referenceBase;
        end += 1;
        finalIndex += 1;
      }
      if (
        deleted.length > 0
        && deleted.length <= ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxIndelLength
        && CANONICAL_DNA_PATTERN.test(deleted)
      ) {
        addVariantEvidence(evidenceByKey, {
          type: 'deletion',
          referenceStart: start,
          referenceEnd: end,
          reference: deleted,
          alternate: '',
        }, readId, [nearestColumnQuality(columns, index)], reference);
      }
      index = finalIndex - 1;
    }
  }
}

type EvidenceCollection = {
  depth: number[];
  forward: number[];
  reverse: number[];
  positionWeights: Array<Map<string, number>>;
  positionQualities: Array<Map<string, number | null>>;
  alleles: Array<Map<ArtifactConstructConsensusAllele['allele'], AlleleEvidence>>;
  variants: Map<string, VariantEvidence>;
};

function collectEvidence(
  reads: readonly ArtifactConstructReadVerification[],
  reference: NormalizedReference,
): EvidenceCollection {
  const referenceLength = reference.sequence.length;
  const depth = new Array<number>(referenceLength).fill(0);
  const forward = new Array<number>(referenceLength).fill(0);
  const reverse = new Array<number>(referenceLength).fill(0);
  const positionWeights = Array.from({ length: referenceLength }, () => new Map<string, number>());
  const positionQualities = Array.from(
    { length: referenceLength },
    () => new Map<string, number | null>(),
  );
  const alleles = Array.from(
    { length: referenceLength },
    () => new Map<ArtifactConstructConsensusAllele['allele'], AlleleEvidence>(),
  );
  const variants = new Map<string, VariantEvidence>();

  for (const read of reads) {
    if (read.status !== 'mapped' || read.mapping === null) continue;
    const seenPositions = new Set<number>();
    const columns = read.mapping.coordinateMap.columns;
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const position = column.referencePosition;
      if (position === null || seenPositions.has(position)) continue;
      let allele: ArtifactConstructConsensusAllele['allele'] | null = null;
      if (column.operation === 'deletion') allele = '-';
      else if (column.readBase !== null && canonicalBase(column.readBase)) allele = column.readBase;
      // IUPAC ambiguity is a no-call, not accepted depth. This keeps N-rich
      // reads from manufacturing coverage or a contradictory consensus.
      if (allele === null) continue;
      seenPositions.add(position);
      depth[position] += 1;
      if (read.mapping.orientation === 'forward') forward[position] += 1;
      else reverse[position] += 1;

      const score = column.operation === 'deletion'
        ? nearestColumnQuality(columns, index)
        : column.qualityScore;
      const weight = qualityWeight(score);
      positionWeights[position].set(read.id, weight);
      positionQualities[position].set(read.id, score);
      const existing = alleles[position].get(allele) ?? { count: 0, weight: 0 };
      existing.count += 1;
      existing.weight += weight;
      alleles[position].set(allele, existing);
    }
    collectReadVariantEvidence(read.id, columns, variants, reference);
  }
  return { depth, forward, reverse, positionWeights, positionQualities, alleles, variants };
}

function summarizeCoverage(
  evidence: EvidenceCollection,
  regions: readonly NormalizedRegion[],
  thresholds: ArtifactConstructVerificationThresholds,
  reasons: ArtifactConstructVerificationReason[],
): ArtifactConstructCoverage {
  const referenceLength = evidence.depth.length;
  const coveredBases = evidence.depth.filter((value) => value > 0).length;
  const basesMeetingMinDepth = evidence.depth.filter((value) => value >= thresholds.minDepth).length;
  const requiredRegions = regions.map((region): ArtifactConstructRegionCoverage => {
    const depths = region.positions.map((position) => evidence.depth[position]);
    const regionCoveredBases = depths.filter((value) => value > 0).length;
    const regionBasesMeetingDepth = depths.filter((value) => value >= region.effectiveMinDepth).length;
    const forwardCoveredBases = region.positions.filter((position) => evidence.forward[position] > 0).length;
    const reverseCoveredBases = region.positions.filter((position) => evidence.reverse[position] > 0).length;
    const bothStrandsCoveredBases = region.positions.filter((position) => (
      evidence.forward[position] > 0 && evidence.reverse[position] > 0
    )).length;
    let status: ArtifactConstructRegionCoverage['status'] = 'covered';
    if (regionCoveredBases < region.length) {
      status = 'uncovered';
      reasons.push(reason(
        'required_region_uncovered',
        'review',
        `${region.name ?? region.id} is not covered across its full required interval.`,
        { regionId: region.id },
      ));
    } else if (regionBasesMeetingDepth < region.length) {
      status = 'low_depth';
      reasons.push(reason(
        'required_region_low_depth',
        'review',
        `${region.name ?? region.id} is below its required depth at one or more bases.`,
        { regionId: region.id },
      ));
    }
    if (
      region.effectiveRequireBothStrands
      && regionCoveredBases === region.length
      && bothStrandsCoveredBases < region.length
    ) {
      if (status === 'covered') status = 'missing_strand';
      reasons.push(reason(
        'required_region_missing_strand',
        'review',
        `${region.name ?? region.id} lacks bidirectional support at one or more bases.`,
        { regionId: region.id },
      ));
    }
    return {
      id: region.id,
      ...(region.name === undefined ? {} : { name: region.name }),
      start: region.start,
      end: region.end,
      wraps: region.wraps,
      length: region.length,
      minDepth: region.effectiveMinDepth,
      requireBothStrands: region.effectiveRequireBothStrands,
      coveredBases: regionCoveredBases,
      basesMeetingMinDepth: regionBasesMeetingDepth,
      coveredFraction: region.length === 0 ? 0 : regionBasesMeetingDepth / region.length,
      minimumDepth: Math.min(...depths),
      maximumDepth: Math.max(...depths),
      meanDepth: depths.reduce((total, value) => total + value, 0) / region.length,
      forwardCoveredBases,
      reverseCoveredBases,
      bothStrandsCoveredBases,
      status,
    };
  });

  const coveredFraction = referenceLength === 0 ? 0 : basesMeetingMinDepth / referenceLength;
  if (coveredFraction < thresholds.minCoverageFraction) {
    reasons.push(reason(
      'partial_reference_coverage',
      'review',
      `Only ${(coveredFraction * 100).toFixed(1)}% of reference bases meet the minimum depth.`,
    ));
  }
  return {
    depth: evidence.depth,
    forward: evidence.forward,
    reverse: evidence.reverse,
    coveredBases,
    basesMeetingMinDepth,
    coveredFraction,
    minimumDepth: Math.min(...evidence.depth),
    maximumDepth: Math.max(...evidence.depth),
    meanDepth: evidence.depth.reduce((total, value) => total + value, 0) / referenceLength,
    requiredRegions,
  };
}

type VariantSpanSupport = {
  readIds: Set<string>;
  highQualityReadIds: Set<string>;
  depth: number;
  totalWeight: number;
  highQualityDepth: number;
};

function variantSpanPositions(
  variant: Pick<ArtifactConstructExpectedVariantInput, 'type' | 'referenceStart' | 'referenceEnd'>,
  reference: NormalizedReference,
): number[] {
  if (variant.type === 'substitution') return [variant.referenceStart];
  if (variant.type === 'deletion') {
    return Array.from(
      { length: variant.referenceEnd - variant.referenceStart },
      (_, offset) => variant.referenceStart + offset,
    );
  }
  const coordinate = variant.referenceStart;
  if (reference.topology === 'circular') {
    return [...new Set([
      modulo(coordinate - 1, reference.sequence.length),
      modulo(coordinate, reference.sequence.length),
    ])];
  }
  if (coordinate === 0) return [0];
  if (coordinate === reference.sequence.length) return [reference.sequence.length - 1];
  return [coordinate - 1, coordinate];
}

function variantSpanSupport(
  variant: Pick<ArtifactConstructExpectedVariantInput, 'type' | 'referenceStart' | 'referenceEnd'>,
  evidence: EvidenceCollection,
  reference: NormalizedReference,
  minimumQuality: number,
): VariantSpanSupport {
  const positions = variantSpanPositions(variant, reference);
  const firstQualities = evidence.positionQualities[positions[0]];
  const readIds = new Set<string>();
  const highQualityReadIds = new Set<string>();
  let totalWeight = 0;
  let highQualityDepth = 0;
  if (firstQualities === undefined) {
    return { readIds, highQualityReadIds, depth: 0, totalWeight, highQualityDepth };
  }
  for (const readId of firstQualities.keys()) {
    const qualities: Array<number | null> = [];
    let spans = true;
    for (const position of positions) {
      const atPosition = evidence.positionQualities[position];
      if (atPosition === undefined || !atPosition.has(readId)) {
        spans = false;
        break;
      }
      qualities.push(atPosition.get(readId) ?? null);
    }
    if (!spans) continue;
    readIds.add(readId);
    const known = qualities.filter((quality): quality is number => quality !== null);
    const conservativeQuality = known.length === qualities.length
      ? Math.min(...known)
      : null;
    totalWeight += qualityWeight(conservativeQuality);
    if (conservativeQuality !== null && conservativeQuality >= minimumQuality) {
      highQualityDepth += 1;
      highQualityReadIds.add(readId);
    }
  }
  return { readIds, highQualityReadIds, depth: readIds.size, totalWeight, highQualityDepth };
}

function observedVariants(
  evidence: EvidenceCollection,
  reference: NormalizedReference,
  thresholds: ArtifactConstructVerificationThresholds,
): ArtifactConstructObservedVariant[] {
  return [...evidence.variants.values()]
    .map((variant): ArtifactConstructObservedVariant => {
      const span = variantSpanSupport(variant, evidence, reference, thresholds.minVariantQuality);
      const supportingReadIds = [...variant.readIds]
        .filter((readId) => span.readIds.has(readId))
        .sort();
      const depth = span.depth;
      const support = supportingReadIds.length;
      const supportWeight = supportingReadIds.reduce(
        (total, readId) => total + (variant.weightByRead.get(readId) ?? 0),
        0,
      );
      const fraction = span.totalWeight > 0
        ? Math.min(1, supportWeight / span.totalWeight)
        : depth > 0 ? Math.min(1, support / depth) : 0;
      const knownQualities = supportingReadIds
        .map((readId) => variant.qualityByRead.get(readId) ?? null)
        .filter((quality): quality is number => quality !== null);
      const meanQuality = knownQualities.length === 0
        ? null
        : knownQualities.reduce((total, quality) => total + quality, 0) / knownQualities.length;
      const confidence = fraction >= thresholds.minVariantFraction
        && meanQuality !== null
        && meanQuality >= thresholds.minVariantQuality
        && supportingReadIds.some((readId) => span.highQualityReadIds.has(readId))
        ? 'high'
        : 'low';
      const key = variantKey(variant);
      return {
        id: `observed:${variant.type}:${variant.referenceStart}:${sha256HexSync(key).slice(0, 12)}`,
        type: variant.type,
        referenceStart: variant.referenceStart,
        referenceEnd: variant.referenceEnd,
        reference: variant.reference,
        alternate: variant.alternate,
        depth,
        support,
        supportWeight,
        fraction,
        meanQuality,
        confidence,
        supportingReadIds,
      };
    })
    .sort(compareVariants);
}

function callConsensus(
  evidence: EvidenceCollection,
  reference: NormalizedReference,
  observed: readonly ArtifactConstructObservedVariant[],
  thresholds: ArtifactConstructVerificationThresholds,
  reasons: ArtifactConstructVerificationReason[],
): ArtifactConstructConsensus {
  const alleleOrder: readonly ArtifactConstructConsensusAllele['allele'][] = ['A', 'C', 'G', 'T', '-'];
  let conflictCount = 0;
  const calls = evidence.alleles.map((positionEvidence, referencePosition): ArtifactConstructConsensusCall => {
    const totalWeight = [...positionEvidence.values()]
      .reduce((total, entry) => total + entry.weight, 0);
    const alleles = alleleOrder
      .flatMap((allele): ArtifactConstructConsensusAllele[] => {
        const entry = positionEvidence.get(allele);
        return entry === undefined ? [] : [{
          allele,
          count: entry.count,
          weight: entry.weight,
          fraction: totalWeight === 0 ? 0 : entry.weight / totalWeight,
        }];
      })
      .sort((left, right) => (
        right.weight - left.weight
        || alleleOrder.indexOf(left.allele) - alleleOrder.indexOf(right.allele)
      ));
    if (evidence.depth[referencePosition] === 0) {
      return {
        referencePosition,
        referenceBase: reference.sequence[referencePosition],
        call: 'N',
        status: 'uncovered',
        depth: 0,
        forwardDepth: 0,
        reverseDepth: 0,
        fraction: 0,
        alleles,
      };
    }
    const leading = alleles[0];
    const tied = leading !== undefined && alleles[1]?.weight === leading.weight;
    if (leading === undefined || tied || leading.fraction < thresholds.minConsensusFraction) {
      conflictCount += 1;
      return {
        referencePosition,
        referenceBase: reference.sequence[referencePosition],
        call: 'N',
        status: 'conflict',
        depth: evidence.depth[referencePosition],
        forwardDepth: evidence.forward[referencePosition],
        reverseDepth: evidence.reverse[referencePosition],
        fraction: leading?.fraction ?? 0,
        alleles,
      };
    }
    const call = leading.allele;
    const referenceBase = reference.sequence[referencePosition];
    const changesReference = call === '-' || !basesCompatible(referenceBase, call);
    if (changesReference) {
      const supportedEdit = observed.some((variant) => {
        if (variant.confidence !== 'high' || variant.fraction < thresholds.minConsensusFraction) return false;
        if (call === '-') {
          return variant.type === 'deletion'
            && referencePosition >= variant.referenceStart
            && referencePosition < variant.referenceEnd;
        }
        return variant.type === 'substitution'
          && variant.referenceStart === referencePosition
          && variant.alternate === call;
      });
      // A winning low/no-quality alternate is provisional evidence, not a
      // sequence edit. Its low_confidence_variant reason keeps the verdict at
      // review without manufacturing a contradictory consensus.
      if (!supportedEdit) {
        return {
          referencePosition,
          referenceBase,
          call: 'N',
          status: 'conflict',
          depth: evidence.depth[referencePosition],
          forwardDepth: evidence.forward[referencePosition],
          reverseDepth: evidence.reverse[referencePosition],
          fraction: leading.fraction,
          alleles,
        };
      }
    }
    return {
      referencePosition,
      referenceBase,
      call,
      status: changesReference ? 'variant' : 'reference',
      depth: evidence.depth[referencePosition],
      forwardDepth: evidence.forward[referencePosition],
      reverseDepth: evidence.reverse[referencePosition],
      fraction: leading.fraction,
      alleles,
    };
  });

  const consensusInsertions = new Map<number, ArtifactConstructObservedVariant[]>();
  const consensusVariants = observed.filter((variant) => {
    if (variant.confidence !== 'high' || variant.fraction < thresholds.minConsensusFraction) return false;
    if (variant.type === 'substitution') {
      return calls[variant.referenceStart]?.call === variant.alternate;
    }
    if (variant.type === 'deletion') {
      for (let position = variant.referenceStart; position < variant.referenceEnd; position += 1) {
        if (calls[position]?.call !== '-') return false;
      }
      return true;
    }
    const atBoundary = consensusInsertions.get(variant.referenceStart) ?? [];
    atBoundary.push(variant);
    consensusInsertions.set(variant.referenceStart, atBoundary);
    return true;
  });
  const conflictingInsertionIds = new Set<string>();
  for (const variants of consensusInsertions.values()) {
    if (variants.length <= 1) continue;
    conflictCount += 1;
    for (const variant of variants) conflictingInsertionIds.add(variant.id);
  }
  const acceptedConsensusVariants = consensusVariants.filter((variant) => !conflictingInsertionIds.has(variant.id));
  const insertionByBoundary = new Map<number, string>();
  for (const variant of acceptedConsensusVariants) {
    if (variant.type === 'insertion') insertionByBoundary.set(variant.referenceStart, variant.alternate);
  }
  let sequence = '';
  for (let position = 0; position < calls.length; position += 1) {
    sequence += insertionByBoundary.get(position) ?? '';
    const call = calls[position].call;
    if (call !== '-') sequence += call;
  }
  if (reference.topology === 'linear') sequence += insertionByBoundary.get(reference.sequence.length) ?? '';
  if (conflictCount > 0) {
    reasons.push(reason(
      'conflicting_consensus',
      'inconsistent',
      `${conflictCount.toLocaleString()} reference position${conflictCount === 1 ? '' : 's'} lack a unique quality-weighted consensus.`,
    ));
  }
  return { sequence, calls, variants: acceptedConsensusVariants };
}

function summarizeVariants(
  initialObserved: readonly ArtifactConstructObservedVariant[],
  expectedInputs: readonly ArtifactConstructExpectedVariantInput[],
  evidence: EvidenceCollection,
  reference: NormalizedReference,
  thresholds: ArtifactConstructVerificationThresholds,
  reasons: ArtifactConstructVerificationReason[],
): ArtifactConstructVariantSummary {
  const expectedByKey = new Map(expectedInputs.map((variant) => [variantKey(variant), variant]));
  const observed = initialObserved.map((variant): ArtifactConstructObservedVariant => {
    const expected = expectedByKey.get(variantKey(variant));
    return expected === undefined ? variant : { ...variant, expectedVariantId: expected.id };
  });
  const observedByKey = new Map(observed.map((variant) => [variantKey(variant), variant]));
  const expected = expectedInputs.map((variant): ArtifactConstructExpectedVariantResult => {
    const matching = observedByKey.get(variantKey(variant));
    const span = variantSpanSupport(variant, evidence, reference, 0);
    const highQualitySpan = variantSpanSupport(
      variant,
      evidence,
      reference,
      thresholds.minVariantQuality,
    );
    const depth = highQualitySpan.highQualityDepth;
    if (matching?.confidence === 'high') {
      return { ...variant, status: 'observed', depth, observedVariantId: matching.id };
    }
    if (matching !== undefined) {
      return { ...variant, status: 'low_confidence', depth, observedVariantId: matching.id };
    }
    if (depth === 0 || span.depth === 0) return { ...variant, status: 'not_covered', depth };
    return { ...variant, status: 'not_observed', depth };
  });
  const unexpected = observed.filter((variant) => variant.expectedVariantId === undefined);
  const missingExpected = expected.filter((variant) => variant.status !== 'observed');

  for (const variant of observed) {
    if (variant.confidence === 'low') {
      reasons.push(reason(
        'low_confidence_variant',
        'review',
        `${variant.id} has variant evidence below the configured quality or fraction threshold.`,
        { variantId: variant.id },
      ));
    } else if (variant.expectedVariantId === undefined) {
      reasons.push(reason(
        'unexpected_variant',
        'inconsistent',
        `${variant.id} is a high-confidence variant not present in expectedVariants.`,
        { variantId: variant.id },
      ));
    }
  }
  for (const variant of expected) {
    if (variant.status === 'not_covered') {
      reasons.push(reason(
        'expected_variant_not_covered',
        'review',
        `${variant.id} is not covered by a usable read.`,
        { variantId: variant.id },
      ));
    } else if (variant.status === 'not_observed') {
      reasons.push(reason(
        'expected_variant_not_observed',
        'inconsistent',
        `${variant.id} is covered but its expected allele was not observed.`,
        { variantId: variant.id },
      ));
    }
  }
  return { observed, expected, unexpected, missingExpected };
}

function requestSha256(input: NormalizedInput): string {
  return sha256HexSync(JSON.stringify({
    schema: ARTIFACT_CONSTRUCT_VERIFICATION_SCHEMA,
    version: ARTIFACT_CONSTRUCT_VERIFICATION_VERSION,
    reference: {
      id: input.reference.id,
      sequence: input.reference.sequence,
      topology: input.reference.topology,
      sha256: input.reference.sha256,
    },
    reads: input.reads.map((read) => ({
      id: read.id,
      baseCalls: read.baseCalls,
      qualityScores: read.qualityScores,
      sha256: read.sha256,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    requiredRegions: input.requiredRegions.map((region) => ({
      id: region.id,
      start: region.start,
      end: region.end,
      minDepth: region.effectiveMinDepth,
      requireBothStrands: region.effectiveRequireBothStrands,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    expectedVariants: [...input.expectedVariants].sort((left, right) => left.id.localeCompare(right.id)),
    thresholds: input.thresholds,
  }));
}

export function verifyArtifactConstruct(
  input: ArtifactConstructVerificationInput,
): ArtifactConstructVerificationResult {
  const normalized = normalizeInput(input);
  const work = new WorkCounter();
  const reasons: ArtifactConstructVerificationReason[] = [];
  const seedCache: ReferenceSeedIndexCache = new Map();
  const exhaustiveSearchBudget = Math.floor(
    (ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxWorkUnits * EXHAUSTIVE_MAPPING_WORK_FRACTION)
      / Math.max(1, normalized.reads.length),
  );
  const reads = normalized.reads.map((read): ArtifactConstructReadVerification => {
    const { trim, meanQuality } = readTrim(read, normalized.thresholds, work);
    if (read.qualityScores === null) {
      reasons.push(reason(
        'missing_quality',
        'review',
        `${read.name ?? read.id} has no quality scores; its calls were not re-based or quality-trimmed.`,
        { readId: read.id },
      ));
    }
    let status: ArtifactConstructReadStatus;
    let mapping: ArtifactConstructReadMapping | null = null;
    if (trim.trimmedLength < normalized.thresholds.minTrimmedReadLength) {
      status = 'trimmed_read_too_short';
    } else {
      const mapped = mapRead(
        read,
        trim,
        normalized.reference,
        normalized.thresholds,
        seedCache,
        work,
        exhaustiveSearchBudget,
      );
      status = mapped.status;
      mapping = mapped.alignment?.mapping ?? null;
    }
    if (status !== 'mapped') reasons.push(readReason(read, status));
    return {
      id: read.id,
      ...(read.name === undefined ? {} : { name: read.name }),
      sha256: read.sha256,
      rawLength: read.baseCalls.length,
      qualityProvided: read.qualityScores !== null,
      meanQuality,
      status,
      trim,
      mapping,
    };
  });

  const usableReadCount = reads.filter((read) => read.status === 'mapped').length;
  if (usableReadCount === 0) {
    reasons.push(reason(
      'no_usable_reads',
      'review',
      'No read passed trimming, unique mapping, identity, and bounded-indel checks.',
    ));
  }
  const evidence = collectEvidence(reads, normalized.reference);
  const coverage = summarizeCoverage(
    evidence,
    normalized.requiredRegions,
    normalized.thresholds,
    reasons,
  );
  const initialObserved = observedVariants(
    evidence,
    normalized.reference,
    normalized.thresholds,
  );
  const variants = summarizeVariants(
    initialObserved,
    normalized.expectedVariants,
    evidence,
    normalized.reference,
    normalized.thresholds,
    reasons,
  );
  const consensus = callConsensus(
    evidence,
    normalized.reference,
    variants.observed,
    normalized.thresholds,
    reasons,
  );
  const state: ArtifactConstructVerificationResult['state'] = reasons.some((entry) => (
    entry.severity === 'inconsistent'
  ))
    ? 'inconsistent'
    : reasons.length > 0 ? 'needs_review' : 'consistent';

  return {
    schema: ARTIFACT_CONSTRUCT_VERIFICATION_SCHEMA,
    version: ARTIFACT_CONSTRUCT_VERIFICATION_VERSION,
    state,
    reasons,
    reference: {
      id: normalized.reference.id,
      ...(normalized.reference.name === undefined ? {} : { name: normalized.reference.name }),
      sequence: normalized.reference.sequence,
      length: normalized.reference.sequence.length,
      topology: normalized.reference.topology,
      sha256: normalized.reference.sha256,
    },
    thresholds: { ...normalized.thresholds },
    reads,
    coverage,
    consensus,
    variants,
    provenance: {
      engine: 'motif-construct-verification',
      engineVersion: '1',
      referenceSha256: normalized.reference.sha256,
      readSha256s: normalized.reads.map((read) => read.sha256),
      requestSha256: requestSha256(normalized),
      workUnits: work.value(),
      limits: ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS,
    },
  };
}
