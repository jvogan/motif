import {
  MAX_ARTIFACT_ANALYSIS_ASSET_BYTES,
  type ArtifactAnalysisAsset,
  type ArtifactAnalysisResult,
} from './claude-science-analysis-results';
import { sha256HexSync } from './claude-science-sha256';

export const ARTIFACT_CONSTRUCT_READ_EVIDENCE_SCHEMA = 'motif.construct-read-evidence.v1' as const;
export const ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_SCHEMA = 'motif.construct-verification-report.v1' as const;

export const ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS = {
  maxReasons: 256,
  maxReads: 96,
  maxRequiredRegions: 128,
  maxObservedVariants: 192,
  maxExpectedVariants: 256,
  maxUnexpectedVariants: 192,
  maxMissingExpectedVariants: 256,
  maxSupportingReadIds: 8,
  maxReasonMessageLength: 512,
  maxStructuredNodes: 32_000,
} as const;

const MAX_SANGER_BASE_CALLS = 5_000;
const MAX_REFERENCE_LENGTH = 50_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const IUPAC_DNA_PATTERN = /^[ACGTRYSWKMBDHVN]+$/i;
const STABLE_REASON_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

export type ArtifactConstructReadEvidenceInput = {
  baseCalls: string;
  qualityScores?: readonly number[] | null;
};

export type ArtifactConstructReadEvidence = {
  schema: typeof ARTIFACT_CONSTRUCT_READ_EVIDENCE_SCHEMA;
  baseCalls: string;
  qualityScores: number[] | null;
};

/**
 * Canonical evidence deliberately excludes trace rendering and record metadata.
 * Case normalization is explicit; whitespace and malformed/misaligned quality
 * arrays are rejected rather than silently repaired.
 */
export function canonicalizeArtifactConstructReadEvidence(
  input: ArtifactConstructReadEvidenceInput,
): ArtifactConstructReadEvidence {
  if (typeof input.baseCalls !== 'string'
    || input.baseCalls.length === 0
    || input.baseCalls.length > MAX_SANGER_BASE_CALLS
    || !IUPAC_DNA_PATTERN.test(input.baseCalls)) {
    throw new Error(`baseCalls must contain 1–${MAX_SANGER_BASE_CALLS.toLocaleString()} unspaced IUPAC DNA calls.`);
  }
  const baseCalls = input.baseCalls.toUpperCase();
  const suppliedScores = input.qualityScores;
  let qualityScores: number[] | null = null;
  if (suppliedScores !== undefined && suppliedScores !== null && suppliedScores.length > 0) {
    if (suppliedScores.length !== baseCalls.length) {
      throw new Error('Nonempty qualityScores must contain exactly one score per base call.');
    }
    qualityScores = Array.from(suppliedScores, (score, index) => {
      if (!Number.isInteger(score) || score < 0 || score > 255) {
        throw new Error(`qualityScores[${index}] must be an integer from 0 through 255.`);
      }
      return score;
    });
  }
  return {
    schema: ARTIFACT_CONSTRUCT_READ_EVIDENCE_SCHEMA,
    baseCalls,
    qualityScores,
  };
}

/** SHA-256 of the fixed-key canonical JSON object, and nothing else. */
export function artifactConstructReadEvidenceSha256(
  input: ArtifactConstructReadEvidenceInput,
): string {
  return sha256HexSync(JSON.stringify(canonicalizeArtifactConstructReadEvidence(input)));
}

type ConstructVerificationReasonSource = {
  code: string;
  severity: 'review' | 'inconsistent';
  message: string;
  readId?: string;
  regionId?: string;
  variantId?: string;
};

type ConstructVerificationThresholdsSource = {
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

type ConstructVerificationTrimSource = {
  method: 'quality_window' | 'none_missing_quality';
  rawStart: number;
  rawEnd: number;
  trimmedLength: number;
  removedFromStart: number;
  removedFromEnd: number;
};

type ConstructVerificationMappingSource = {
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
};

type ConstructVerificationReadSource = {
  id: string;
  name?: string;
  sha256: string;
  rawLength: number;
  qualityProvided: boolean;
  meanQuality: number | null;
  status: 'mapped'
    | 'trimmed_read_too_short'
    | 'unmapped'
    | 'ambiguous_mapping'
    | 'low_mapping_identity'
    | 'excessive_indel';
  trim: ConstructVerificationTrimSource;
  mapping: ConstructVerificationMappingSource | null;
};

type ConstructVerificationRegionSource = {
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

type ConstructVerificationObservedVariantSource = {
  id: string;
  type: 'substitution' | 'insertion' | 'deletion';
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
  supportingReadIds: readonly string[];
  expectedVariantId?: string;
};

type ConstructVerificationExpectedVariantSource = {
  id: string;
  type: 'substitution' | 'insertion' | 'deletion';
  referenceStart: number;
  referenceEnd: number;
  reference: string;
  alternate: string;
  status: 'observed' | 'low_confidence' | 'not_observed' | 'not_covered';
  depth: number;
  observedVariantId?: string;
};

type ConstructVerificationLimitsSource = {
  readonly maxReferenceLength: number;
  readonly maxReads: number;
  readonly maxReadLength: number;
  readonly maxRequiredRegions: number;
  readonly maxRequiredRegionBases: number;
  readonly maxExpectedVariants: number;
  readonly maxObservedVariants: number;
  readonly maxIndelLength: number;
  readonly maxWorkUnits: number;
};

/**
 * Persistence-facing structural subset of the pure verification result. The
 * engine's full result is directly assignable while heavy evidence stays out
 * of this module's compile-time dependency surface.
 */
export type ArtifactConstructVerificationPersistenceSource = {
  schema: 'motif.construct-verification.v1';
  version: 1;
  state: 'consistent' | 'needs_review' | 'inconsistent';
  reasons: readonly ConstructVerificationReasonSource[];
  reference: {
    id: string;
    name?: string;
    sequence: string;
    length: number;
    topology: 'linear' | 'circular';
    sha256: string;
  };
  thresholds: ConstructVerificationThresholdsSource;
  reads: readonly ConstructVerificationReadSource[];
  coverage: {
    coveredBases: number;
    basesMeetingMinDepth: number;
    coveredFraction: number;
    minimumDepth: number;
    maximumDepth: number;
    meanDepth: number;
    requiredRegions: readonly ConstructVerificationRegionSource[];
  };
  consensus: {
    sequence: string;
  };
  variants: {
    observed: readonly ConstructVerificationObservedVariantSource[];
    expected: readonly ConstructVerificationExpectedVariantSource[];
    unexpected: readonly ConstructVerificationObservedVariantSource[];
    missingExpected: readonly ConstructVerificationExpectedVariantSource[];
  };
  provenance: {
    engine: 'motif-construct-verification';
    engineVersion: '1';
    referenceSha256: string;
    readSha256s: readonly string[];
    requestSha256: string;
    workUnits: number;
    limits: ConstructVerificationLimitsSource;
  };
};

export type ArtifactConstructVerificationBuildIdentity = {
  resultId: string;
  assetId: string;
  createdAt: string;
};

export type ArtifactConstructVerificationAnalysisResult = Extract<
  ArtifactAnalysisResult,
  { kind: 'construct_verification' }
>;

export type ArtifactConstructVerificationArtifacts = {
  asset: ArtifactAnalysisAsset;
  result: ArtifactConstructVerificationAnalysisResult;
};

export type ArtifactConstructVerificationDuplicateIdentity = {
  engine: string;
  engineVersion: string;
  requestSha256: string;
};

function normalizeSha256(value: string, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${path} must be a 64-character SHA-256 value.`);
  }
  return value.toLowerCase();
}

function validateIdentityText(value: string, path: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > maximumLength) {
    throw new Error(`${path} must contain 1–${maximumLength} nonblank, unpadded characters.`);
  }
  return value;
}

function boundedReportText(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  return `${value.slice(0, Math.max(0, maximumLength - 1))}…`;
}

function uniqueReasonCodes(reasons: readonly ConstructVerificationReasonSource[]): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const reason of reasons) {
    if (!STABLE_REASON_CODE_PATTERN.test(reason.code) || reason.code.length > 128) {
      throw new Error(`Construct verification reason code "${reason.code}" is not a stable bounded code.`);
    }
    if (seen.has(reason.code)) continue;
    seen.add(reason.code);
    codes.push(reason.code);
    if (codes.length === 500) break;
  }
  return codes;
}

function reportReasons(reasons: readonly ConstructVerificationReasonSource[]) {
  return reasons.slice(0, ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS.maxReasons).map((reason) => ({
    code: reason.code,
    severity: reason.severity,
    message: boundedReportText(reason.message, ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS.maxReasonMessageLength),
    ...(reason.readId === undefined ? {} : { readId: reason.readId }),
    ...(reason.regionId === undefined ? {} : { regionId: reason.regionId }),
    ...(reason.variantId === undefined ? {} : { variantId: reason.variantId }),
  }));
}

function reportMapping(mapping: ConstructVerificationMappingSource | null) {
  if (mapping === null) return null;
  return {
    orientation: mapping.orientation,
    referenceStart: mapping.referenceStart,
    referenceEnd: mapping.referenceEnd,
    wraps: mapping.wraps,
    referenceSpan: mapping.referenceSpan,
    score: mapping.score,
    secondBestScore: mapping.secondBestScore,
    mappingMargin: mapping.mappingMargin,
    identity: mapping.identity,
    alignedLength: mapping.alignedLength,
    matches: mapping.matches,
    substitutions: mapping.substitutions,
    insertions: mapping.insertions,
    deletions: mapping.deletions,
    indelFraction: mapping.indelFraction,
  };
}

function reportReads(reads: readonly ConstructVerificationReadSource[]) {
  return reads.slice(0, ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS.maxReads).map((read) => ({
    id: read.id,
    ...(read.name === undefined ? {} : { name: read.name }),
    sha256: read.sha256,
    rawLength: read.rawLength,
    qualityProvided: read.qualityProvided,
    meanQuality: read.meanQuality,
    status: read.status,
    trim: { ...read.trim },
    mapping: reportMapping(read.mapping),
  }));
}

function reportRegions(regions: readonly ConstructVerificationRegionSource[]) {
  return regions.slice(0, ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS.maxRequiredRegions).map((region) => ({
    id: region.id,
    ...(region.name === undefined ? {} : { name: region.name }),
    start: region.start,
    end: region.end,
    wraps: region.wraps,
    length: region.length,
    minDepth: region.minDepth,
    requireBothStrands: region.requireBothStrands,
    coveredBases: region.coveredBases,
    basesMeetingMinDepth: region.basesMeetingMinDepth,
    coveredFraction: region.coveredFraction,
    minimumDepth: region.minimumDepth,
    maximumDepth: region.maximumDepth,
    meanDepth: region.meanDepth,
    forwardCoveredBases: region.forwardCoveredBases,
    reverseCoveredBases: region.reverseCoveredBases,
    bothStrandsCoveredBases: region.bothStrandsCoveredBases,
    status: region.status,
  }));
}

function reportObservedVariants(
  variants: readonly ConstructVerificationObservedVariantSource[],
  maximum: number,
) {
  return variants.slice(0, maximum).map((variant) => ({
    id: variant.id,
    type: variant.type,
    referenceStart: variant.referenceStart,
    referenceEnd: variant.referenceEnd,
    reference: variant.reference,
    alternate: variant.alternate,
    depth: variant.depth,
    support: variant.support,
    supportWeight: variant.supportWeight,
    fraction: variant.fraction,
    meanQuality: variant.meanQuality,
    confidence: variant.confidence,
    supportingReadIds: variant.supportingReadIds.slice(
      0,
      ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS.maxSupportingReadIds,
    ),
    ...(variant.expectedVariantId === undefined ? {} : { expectedVariantId: variant.expectedVariantId }),
    omittedSupportingReadIds: Math.max(
      0,
      variant.supportingReadIds.length - ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS.maxSupportingReadIds,
    ),
  }));
}

function reportExpectedVariants(
  variants: readonly ConstructVerificationExpectedVariantSource[],
  maximum: number,
) {
  return variants.slice(0, maximum).map((variant) => ({
    id: variant.id,
    type: variant.type,
    referenceStart: variant.referenceStart,
    referenceEnd: variant.referenceEnd,
    reference: variant.reference,
    alternate: variant.alternate,
    status: variant.status,
    depth: variant.depth,
    ...(variant.observedVariantId === undefined ? {} : { observedVariantId: variant.observedVariantId }),
  }));
}

function countStructuredNodes(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1;
  if (Array.isArray(value)) return 1 + value.reduce((total, item) => total + countStructuredNodes(item), 0);
  return 1 + Object.values(value).reduce((total, item) => total + countStructuredNodes(item), 0);
}

function createReport(result: ArtifactConstructVerificationPersistenceSource) {
  const limits = ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS;
  const report = {
    schema: ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_SCHEMA,
    version: 1,
    state: result.state,
    reasons: reportReasons(result.reasons),
    reference: {
      id: result.reference.id,
      ...(result.reference.name === undefined ? {} : { name: result.reference.name }),
      length: result.reference.length,
      topology: result.reference.topology,
      sha256: result.reference.sha256,
    },
    thresholds: { ...result.thresholds },
    reads: reportReads(result.reads),
    coverage: {
      coveredBasesAtAnyDepth: result.coverage.coveredBases,
      basesMeetingMinDepth: result.coverage.basesMeetingMinDepth,
      coverageFraction: result.reference.length === 0
        ? 0
        : result.coverage.basesMeetingMinDepth / result.reference.length,
      minimumDepth: result.coverage.minimumDepth,
      maximumDepth: result.coverage.maximumDepth,
      meanDepth: result.coverage.meanDepth,
      requiredRegions: reportRegions(result.coverage.requiredRegions),
    },
    consensus: {
      sequence: result.consensus.sequence,
    },
    variants: {
      observed: reportObservedVariants(result.variants.observed, limits.maxObservedVariants),
      expected: reportExpectedVariants(result.variants.expected, limits.maxExpectedVariants),
      unexpected: reportObservedVariants(result.variants.unexpected, limits.maxUnexpectedVariants),
      missingExpected: reportExpectedVariants(result.variants.missingExpected, limits.maxMissingExpectedVariants),
    },
    provenance: {
      engine: result.provenance.engine,
      engineVersion: result.provenance.engineVersion,
      referenceSha256: result.provenance.referenceSha256,
      readSha256s: [...result.provenance.readSha256s],
      requestSha256: result.provenance.requestSha256,
      workUnits: result.provenance.workUnits,
      limits: { ...result.provenance.limits },
    },
    omitted: {
      reasons: Math.max(0, result.reasons.length - limits.maxReasons),
      reads: Math.max(0, result.reads.length - limits.maxReads),
      requiredRegions: Math.max(0, result.coverage.requiredRegions.length - limits.maxRequiredRegions),
      observedVariants: Math.max(0, result.variants.observed.length - limits.maxObservedVariants),
      expectedVariants: Math.max(0, result.variants.expected.length - limits.maxExpectedVariants),
      unexpectedVariants: Math.max(0, result.variants.unexpected.length - limits.maxUnexpectedVariants),
      missingExpectedVariants: Math.max(0, result.variants.missingExpected.length - limits.maxMissingExpectedVariants),
      supportingReadIds:
        [...result.variants.observed, ...result.variants.unexpected]
          .reduce((total, variant) => total + Math.max(0, variant.supportingReadIds.length - limits.maxSupportingReadIds), 0),
    },
  };
  const nodes = countStructuredNodes(report);
  if (nodes > limits.maxStructuredNodes) {
    throw new Error(`Construct verification report exceeds the ${limits.maxStructuredNodes.toLocaleString()}-node compact-report limit.`);
  }
  return report;
}

function validateSourceForPersistence(
  result: ArtifactConstructVerificationPersistenceSource,
  readEvidenceSha256s: readonly string[],
): { inputRecordIds: string[]; inputSha256s: string[]; evidenceSha256s: string[] } {
  if (result.reference.length < 1
    || result.reference.length > MAX_REFERENCE_LENGTH
    || result.reference.sequence.length !== result.reference.length) {
    throw new Error('Construct verification reference length is invalid or inconsistent with its sequence.');
  }
  if (result.reads.length === 0) throw new Error('Construct verification persistence requires at least one sequencing read.');
  const inputRecordIds = [result.reference.id, ...result.reads.map((read) => read.id)];
  if (new Set(inputRecordIds).size !== inputRecordIds.length) {
    throw new Error('Construct verification reference and read ids must be distinct.');
  }
  if (readEvidenceSha256s.length !== result.reads.length) {
    throw new Error('Ordered read-evidence SHA-256 values must align one-to-one with sequencing reads.');
  }
  const referenceSha256 = normalizeSha256(result.reference.sha256, 'reference.sha256');
  if (referenceSha256 !== sha256HexSync(result.reference.sequence.toUpperCase())) {
    throw new Error('reference.sha256 must match the uppercase reference sequence.');
  }
  const readSha256s = result.reads.map((read, index) => normalizeSha256(read.sha256, `reads[${index}].sha256`));
  const inputSha256s = [
    referenceSha256,
    ...readSha256s,
  ];
  const evidenceSha256s = readEvidenceSha256s.map((sha256, index) => (
    normalizeSha256(sha256, `readEvidenceSha256s[${index}]`)
  ));
  const provenanceReferenceSha256 = normalizeSha256(
    result.provenance.referenceSha256,
    'provenance.referenceSha256',
  );
  if (provenanceReferenceSha256 !== referenceSha256) {
    throw new Error('provenance.referenceSha256 must match reference.sha256.');
  }
  normalizeSha256(result.provenance.requestSha256, 'provenance.requestSha256');
  const provenanceReadSha256s = result.provenance.readSha256s.map((sha256, index) => (
    normalizeSha256(sha256, `provenance.readSha256s[${index}]`)
  ));
  if (provenanceReadSha256s.length !== readSha256s.length
    || provenanceReadSha256s.some((sha256, index) => sha256 !== readSha256s[index])) {
    throw new Error('provenance.readSha256s must match reads[].sha256 in input order.');
  }
  if (result.coverage.basesMeetingMinDepth < 0
    || result.coverage.basesMeetingMinDepth > result.reference.length
    || !Number.isInteger(result.coverage.basesMeetingMinDepth)) {
    throw new Error('coverage.basesMeetingMinDepth must be an integer within the reference length.');
  }
  return { inputRecordIds, inputSha256s, evidenceSha256s };
}

export function buildArtifactConstructVerificationArtifacts(
  verification: ArtifactConstructVerificationPersistenceSource,
  readEvidenceSha256s: readonly string[],
  identity: ArtifactConstructVerificationBuildIdentity,
): ArtifactConstructVerificationArtifacts {
  const resultId = validateIdentityText(identity.resultId, 'identity.resultId', 160);
  const assetId = validateIdentityText(identity.assetId, 'identity.assetId', 160);
  if (resultId === assetId) throw new Error('Construct verification result and asset ids must be distinct.');
  if (typeof identity.createdAt !== 'string'
    || identity.createdAt.length > 64
    || !/^\d{4}-\d{2}-\d{2}T/.test(identity.createdAt)
    || !Number.isFinite(Date.parse(identity.createdAt))) {
    throw new Error('identity.createdAt must be a valid ISO 8601 date-time.');
  }
  const { inputRecordIds, inputSha256s, evidenceSha256s } = validateSourceForPersistence(
    verification,
    readEvidenceSha256s,
  );
  const report = createReport(verification);
  const content = `${JSON.stringify(report, null, 2)}\n`;
  const contentBytes = new TextEncoder().encode(content).byteLength;
  if (contentBytes > MAX_ARTIFACT_ANALYSIS_ASSET_BYTES) {
    throw new Error(`Construct verification report is ${contentBytes.toLocaleString()} bytes; the maximum is ${MAX_ARTIFACT_ANALYSIS_ASSET_BYTES.toLocaleString()} bytes.`);
  }
  const provenance: ArtifactAnalysisAsset['provenance'] = {
    source: 'motif-for-claude-science-artifact',
    operation: 'construct_verification',
    actor: 'user',
    engine: verification.provenance.engine,
    engineVersion: verification.provenance.engineVersion,
    parentIds: [...inputRecordIds],
    metadata: {
      requestSha256: normalizeSha256(verification.provenance.requestSha256, 'provenance.requestSha256'),
      workUnits: verification.provenance.workUnits,
    },
  };
  const asset: ArtifactAnalysisAsset = {
    id: assetId,
    name: 'construct-verification-report.json',
    mediaType: 'application/json',
    content,
    sha256: sha256HexSync(content),
    createdAt: identity.createdAt,
    provenance,
  };
  const coveredBases = verification.coverage.basesMeetingMinDepth;
  const coverageFraction = coveredBases / verification.reference.length;
  const mappedReadCount = verification.reads.filter((read) => read.status === 'mapped').length;
  const passingRegionCount = verification.coverage.requiredRegions.filter((region) => region.status === 'covered').length;
  const result: ArtifactConstructVerificationAnalysisResult = {
    id: resultId,
    kind: 'construct_verification',
    name: boundedReportText(
      `Construct verification — ${verification.reference.name ?? verification.reference.id}`,
      256,
    ),
    status: 'complete',
    summary: `${verification.state.replace('_', ' ')} · ${mappedReadCount}/${verification.reads.length} reads mapped · ${(coverageFraction * 100).toFixed(1)}% at ≥${verification.thresholds.minDepth}×`,
    inputRecordIds,
    inputSha256s,
    dependsOnResultIds: [],
    assetIds: [assetId],
    parameters: {
      topology: verification.reference.topology,
      requestSha256: normalizeSha256(verification.provenance.requestSha256, 'provenance.requestSha256'),
      thresholds: { ...verification.thresholds },
      readEvidence: {
        schema: ARTIFACT_CONSTRUCT_READ_EVIDENCE_SCHEMA,
        sha256s: evidenceSha256s,
      },
    },
    data: {
      referenceRecordId: verification.reference.id,
      readRecordIds: verification.reads.map((read) => read.id),
      state: verification.state,
      referenceLength: verification.reference.length,
      // The durable validator defines coverage as bases meeting the run's
      // minimum depth, not merely bases touched by any alignment.
      coveredBases,
      coverageFraction,
      mappedReadCount,
      requiredRegionCount: verification.coverage.requiredRegions.length,
      passingRegionCount,
      observedVariantCount: verification.variants.observed.length,
      expectedVariantCount: verification.variants.expected.length,
      unexpectedVariantCount: verification.variants.unexpected.length,
      missingExpectedVariantCount: verification.variants.missingExpected.length,
      reasonCodes: uniqueReasonCodes(verification.reasons),
      verificationReportAssetId: assetId,
    },
    createdAt: identity.createdAt,
    provenance,
  };
  return { asset, result };
}

/** Exact saved-run identity; no sequence/name/UI heuristics participate. */
export function findDuplicateArtifactConstructVerificationResult(
  results: readonly ArtifactAnalysisResult[],
  identity: ArtifactConstructVerificationDuplicateIdentity,
): ArtifactConstructVerificationAnalysisResult | undefined {
  return results.find((result): result is ArtifactConstructVerificationAnalysisResult => (
    result.kind === 'construct_verification'
    && result.provenance.engine === identity.engine
    && result.provenance.engineVersion === identity.engineVersion
    && result.parameters.requestSha256 === identity.requestSha256
  ));
}
