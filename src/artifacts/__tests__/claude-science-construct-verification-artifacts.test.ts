import { describe, expect, it } from 'vitest';
import {
  appendArtifactAnalysisAsset,
  appendArtifactAnalysisWorkspaceResult,
  MAX_ARTIFACT_ANALYSIS_ASSET_BYTES,
} from '../claude-science-analysis-results';
import {
  ARTIFACT_CONSTRUCT_READ_EVIDENCE_SCHEMA,
  ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS,
  artifactConstructReadEvidenceSha256,
  buildArtifactConstructVerificationArtifacts,
  canonicalizeArtifactConstructReadEvidence,
  findDuplicateArtifactConstructVerificationResult,
  type ArtifactConstructVerificationPersistenceSource,
} from '../claude-science-construct-verification-artifacts';
import { verifyArtifactConstruct } from '../claude-science-construct-verification';
import { sha256HexSync } from '../claude-science-sha256';

const CREATED_AT = '2026-07-17T20:00:00.000Z';
const REFERENCE_SEQUENCE = 'ACGT';
const READ_SEQUENCES = ['ACGT', 'TGCA'] as const;
const REFERENCE_SHA256 = sha256HexSync(REFERENCE_SEQUENCE);
const READ_SHA256S = READ_SEQUENCES.map((sequence) => sha256HexSync(sequence));
const REQUEST_SHA256 = sha256HexSync('construct-verification-request');
const ENGINE_REFERENCE_SEQUENCE = 'TCCGGGTCCACTCAATAGGGCCTATGGTGTTAAATATGTGTCTCTTGTTCGCTAGGGTGATAGCAAAAAATATAGTGCCTGCTTTTGTGGATGTAAATAATAACTCGCCCCCCTCCCTCACGAGAGCGCTACGCAAACGTATTTGCCGCCCGCCCTTGGTCAGACATTAGCAGTCGTTTGCTAGATATCCCCTGAAGACTAATGCCCACATTGCGCGCCGATACCCCAGCGTAGGACGAA';

function mutateBuiltReport(
  built: ReturnType<typeof buildArtifactConstructVerificationArtifacts>,
  mutate: (report: Record<string, unknown>) => void,
) {
  const report = JSON.parse(built.asset.content) as Record<string, unknown>;
  mutate(report);
  const content = `${JSON.stringify(report, null, 2)}\n`;
  return {
    ...built,
    asset: {
      ...built.asset,
      content,
      sha256: sha256HexSync(content),
    },
  };
}

function removeBuiltReason(
  built: ReturnType<typeof buildArtifactConstructVerificationArtifacts>,
  code: string,
) {
  const result = structuredClone(built.result);
  result.data.reasonCodes = result.data.reasonCodes.filter((candidate) => candidate !== code);
  const mutated = mutateBuiltReport(built, (report) => {
    const reasons = report.reasons as Array<{ code: string }>;
    report.reasons = reasons.filter((reason) => reason.code !== code);
  });
  return { asset: mutated.asset, result };
}

function observedVariant(index = 0) {
  const reference = REFERENCE_SEQUENCE[index % REFERENCE_SEQUENCE.length];
  return {
    id: `observed-${index}`,
    type: 'substitution' as const,
    referenceStart: index % REFERENCE_SEQUENCE.length,
    referenceEnd: (index % REFERENCE_SEQUENCE.length) + 1,
    reference,
    alternate: reference === 'A' ? 'C' : 'A',
    depth: 2,
    support: 2,
    supportWeight: 64,
    fraction: 1,
    meanQuality: 31,
    confidence: 'high' as const,
    supportingReadIds: ['read-1', 'read-2'],
  };
}

function expectedVariant(index = 0) {
  const reference = REFERENCE_SEQUENCE[index % REFERENCE_SEQUENCE.length];
  return {
    id: `expected-${index}`,
    type: 'substitution' as const,
    referenceStart: index % REFERENCE_SEQUENCE.length,
    referenceEnd: (index % REFERENCE_SEQUENCE.length) + 1,
    reference,
    alternate: reference === 'A' ? 'C' : 'A',
    status: 'observed' as const,
    depth: 2,
    observedVariantId: `observed-${index}`,
  };
}

function verificationSource(): ArtifactConstructVerificationPersistenceSource {
  const mappingWithHeavyEvidence = {
    orientation: 'forward' as const,
    referenceStart: 0,
    referenceEnd: 4,
    wraps: false,
    referenceSpan: 4,
    score: 12,
    secondBestScore: 6,
    mappingMargin: 0.5,
    identity: 1,
    alignedLength: 4,
    matches: 4,
    substitutions: 0,
    insertions: 0,
    deletions: 0,
    indelFraction: 0,
    coordinateMap: {
      columns: [{ rawCallIndex: 0, qualityScore: 30 }],
      referencePositions: [0],
      rawCallIndices: [0],
    },
  };
  const coverageWithPerBaseArrays = {
    depth: [2, 2, 1, 1],
    forward: [1, 1, 1, 1],
    reverse: [1, 1, 0, 0],
    coveredBases: 4,
    basesMeetingMinDepth: 2,
    coveredFraction: 0.5,
    minimumDepth: 1,
    maximumDepth: 2,
    meanDepth: 1.5,
    requiredRegions: [{
      id: 'full-construct',
      name: 'Full construct',
      start: 0,
      end: 4,
      wraps: false,
      length: 4,
      minDepth: 2,
      requireBothStrands: false,
      coveredBases: 4,
      basesMeetingMinDepth: 2,
      coveredFraction: 0.5,
      minimumDepth: 1,
      maximumDepth: 2,
      meanDepth: 1.5,
      forwardCoveredBases: 4,
      reverseCoveredBases: 2,
      bothStrandsCoveredBases: 2,
      status: 'low_depth' as const,
    }],
  };
  const consensusWithHeavyEvidence = {
    sequence: 'ACGT',
    calls: [{
      referencePosition: 0,
      call: 'A',
      depth: 2,
      alleles: [{ allele: 'A', count: 2 }],
    }],
    variants: [observedVariant()],
  };
  return {
    schema: 'motif.construct-verification.v1',
    version: 1,
    state: 'needs_review',
    reasons: [{
      code: 'partial_reference_coverage',
      severity: 'review',
      message: 'Only half of the reference meets the requested two-read depth.',
      regionId: 'full-construct',
    }, {
      code: 'required_region_low_depth',
      severity: 'review',
      message: 'The full construct is below its required depth at one or more bases.',
      regionId: 'full-construct',
    }],
    reference: {
      id: 'reference',
      name: 'Expected construct',
      sequence: REFERENCE_SEQUENCE,
      length: REFERENCE_SEQUENCE.length,
      topology: 'linear',
      sha256: REFERENCE_SHA256,
    },
    thresholds: {
      trimQuality: 20,
      trimWindow: 2,
      minTrimmedReadLength: 2,
      minMappingIdentity: 0.82,
      minMappingMargin: 0.03,
      maxIndelFraction: 0.12,
      minCoverageFraction: 1,
      minDepth: 2,
      requireBothStrands: false,
      minConsensusFraction: 0.7,
      minVariantQuality: 20,
      minVariantFraction: 0.6,
    },
    reads: READ_SEQUENCES.map((sequence, index) => ({
      id: `read-${index + 1}`,
      name: `Read ${index + 1}`,
      sha256: READ_SHA256S[index],
      rawLength: sequence.length,
      qualityProvided: true,
      meanQuality: 30 + index,
      status: 'mapped' as const,
      trim: {
        method: 'quality_window' as const,
        rawStart: 0,
        rawEnd: sequence.length,
        trimmedLength: sequence.length,
        removedFromStart: 0,
        removedFromEnd: 0,
      },
      mapping: mappingWithHeavyEvidence,
    })),
    coverage: coverageWithPerBaseArrays,
    consensus: consensusWithHeavyEvidence,
    variants: {
      observed: [{ ...observedVariant(), expectedVariantId: 'expected-0' }],
      expected: [expectedVariant()],
      unexpected: [],
      missingExpected: [],
    },
    provenance: {
      engine: 'motif-construct-verification',
      engineVersion: '1',
      referenceSha256: REFERENCE_SHA256,
      readSha256s: READ_SHA256S,
      requestSha256: REQUEST_SHA256,
      workUnits: 128,
      limits: {
        maxReferenceLength: 50_000,
        maxReads: 96,
        maxReadLength: 5_000,
        maxRequiredRegions: 128,
        maxRequiredRegionBases: 500_000,
        maxExpectedVariants: 256,
        maxObservedVariants: 2_000,
        maxIndelLength: 24,
        maxWorkUnits: 25_000_000,
      },
    },
  };
}

function evidenceSha256s(): string[] {
  return READ_SEQUENCES.map((baseCalls) => artifactConstructReadEvidenceSha256({
    baseCalls,
    qualityScores: Array.from({ length: baseCalls.length }, () => 30),
  }));
}

function build(source = verificationSource()) {
  return buildArtifactConstructVerificationArtifacts(source, evidenceSha256s(), {
    resultId: 'verification-result',
    assetId: 'verification-report',
    createdAt: CREATED_AT,
  });
}

function collectObjectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjectKeys(item, keys));
    return keys;
  }
  Object.entries(value).forEach(([key, item]) => {
    keys.add(key);
    collectObjectKeys(item, keys);
  });
  return keys;
}

describe('construct verification evidence and persistence artifacts', () => {
  it('hashes only canonical uppercase calls and a copied nonempty quality array', () => {
    const qualityScores = [12, 24, 36, 48];
    const noisyInput = {
      id: 'ignored-read-id',
      name: 'Ignored name',
      baseCalls: 'acgt',
      qualityScores,
      channels: { A: [1, 2, 3] },
      peakPositions: [4, 8, 12, 16],
      metadata: { instrument: 'ignored' },
    };
    const canonical = canonicalizeArtifactConstructReadEvidence(noisyInput);
    expect(canonical).toEqual({
      schema: ARTIFACT_CONSTRUCT_READ_EVIDENCE_SCHEMA,
      baseCalls: 'ACGT',
      qualityScores: [12, 24, 36, 48],
    });
    qualityScores[0] = 255;
    expect(canonical.qualityScores).toEqual([12, 24, 36, 48]);
    expect(artifactConstructReadEvidenceSha256(noisyInput)).toBe(sha256HexSync(JSON.stringify({
      schema: 'motif.construct-read-evidence.v1',
      baseCalls: 'ACGT',
      qualityScores: [255, 24, 36, 48],
    })));
    expect(canonicalizeArtifactConstructReadEvidence({ baseCalls: 'ACGT', qualityScores: [] }).qualityScores)
      .toBeNull();
    expect(canonicalizeArtifactConstructReadEvidence({ baseCalls: 'ACGT' }).qualityScores).toBeNull();

    expect(() => canonicalizeArtifactConstructReadEvidence({ baseCalls: 'AC GT' })).toThrow(/unspaced/i);
    expect(() => canonicalizeArtifactConstructReadEvidence({ baseCalls: 'ACGU' })).toThrow(/IUPAC/i);
    expect(() => canonicalizeArtifactConstructReadEvidence({ baseCalls: 'ACGT', qualityScores: [30] }))
      .toThrow(/one score per base/i);
    expect(() => canonicalizeArtifactConstructReadEvidence({ baseCalls: 'ACGT', qualityScores: [1, 2, 3, 256] }))
      .toThrow(/0 through 255/i);
  });

  it('builds deterministically without mutating verification or evidence inputs', () => {
    const source = verificationSource();
    const evidence = evidenceSha256s();
    const sourceBefore = JSON.stringify(source);
    const evidenceBefore = [...evidence];
    const first = buildArtifactConstructVerificationArtifacts(source, evidence, {
      resultId: 'verification-result',
      assetId: 'verification-report',
      createdAt: CREATED_AT,
    });
    const second = buildArtifactConstructVerificationArtifacts(source, evidence, {
      resultId: 'verification-result',
      assetId: 'verification-report',
      createdAt: CREATED_AT,
    });

    expect(second).toEqual(first);
    expect(JSON.stringify(source)).toBe(sourceBefore);
    expect(evidence).toEqual(evidenceBefore);
    expect(first.asset.sha256).toBe(sha256HexSync(first.asset.content));
    expect(first.result.provenance).toMatchObject({
      engine: 'motif-construct-verification',
      engineVersion: '1',
    });
  });

  it('keeps the inert report compact and recursively excludes raw/per-base evidence', () => {
    const built = build();
    const report = JSON.parse(built.asset.content) as Record<string, unknown>;
    const reference = report.reference as Record<string, unknown>;
    const coverage = report.coverage as Record<string, unknown>;
    const consensus = report.consensus as Record<string, unknown>;
    const reads = report.reads as Array<Record<string, unknown>>;

    expect(built.asset.mediaType).toBe('application/json');
    expect(reference).not.toHaveProperty('sequence');
    expect(coverage).not.toHaveProperty('depth');
    expect(coverage).not.toHaveProperty('forward');
    expect(coverage).not.toHaveProperty('reverse');
    expect(consensus).toEqual({ sequence: 'ACGT' });
    expect(reads[0].mapping).not.toHaveProperty('coordinateMap');
    const keys = collectObjectKeys(report);
    for (const excluded of [
      'baseCalls',
      'qualityScores',
      'channels',
      'peakPositions',
      'chromatograms',
      'coordinateMap',
      'calls',
    ]) {
      expect(keys.has(excluded), excluded).toBe(false);
    }
    expect(new TextEncoder().encode(built.asset.content).byteLength)
      .toBeLessThan(MAX_ARTIFACT_ANALYSIS_ASSET_BYTES);
  });

  it('caps large evidence collections and records every omitted count', () => {
    const source = verificationSource();
    source.reasons = Array.from({ length: 600 }, (_, index) => ({
      code: `reason_${index}`,
      severity: 'review' as const,
      message: `${index}:${'x'.repeat(1_000)}`,
    }));
    const readIds = Array.from({ length: 20 }, (_, index) => `supporting-read-${index}`);
    source.variants.observed = Array.from({ length: 250 }, (_, index) => ({
      ...observedVariant(index),
      supportingReadIds: readIds,
    }));
    source.variants.unexpected = Array.from({ length: 250 }, (_, index) => ({
      ...observedVariant(index + 250),
      supportingReadIds: readIds,
    }));
    source.variants.expected = Array.from({ length: 300 }, (_, index) => expectedVariant(index));
    source.variants.missingExpected = Array.from({ length: 300 }, (_, index) => ({
      ...expectedVariant(index),
      status: 'not_observed' as const,
    }));

    const built = build(source);
    const report = JSON.parse(built.asset.content) as {
      reasons: Array<{ message: string }>;
      variants: {
        observed: Array<{ supportingReadIds: string[]; omittedSupportingReadIds: number }>;
        expected: unknown[];
        unexpected: unknown[];
        missingExpected: unknown[];
      };
      omitted: Record<string, number>;
    };
    const limits = ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS;
    expect(report.reasons).toHaveLength(limits.maxReasons);
    expect(report.reasons[0].message.length).toBeLessThanOrEqual(limits.maxReasonMessageLength);
    expect(report.variants.observed).toHaveLength(limits.maxObservedVariants);
    expect(report.variants.expected).toHaveLength(limits.maxExpectedVariants);
    expect(report.variants.unexpected).toHaveLength(limits.maxUnexpectedVariants);
    expect(report.variants.missingExpected).toHaveLength(limits.maxMissingExpectedVariants);
    expect(report.variants.observed[0]).toMatchObject({
      supportingReadIds: readIds.slice(0, limits.maxSupportingReadIds),
      omittedSupportingReadIds: readIds.length - limits.maxSupportingReadIds,
    });
    expect(report.omitted).toMatchObject({
      reasons: 600 - limits.maxReasons,
      observedVariants: 250 - limits.maxObservedVariants,
      expectedVariants: 300 - limits.maxExpectedVariants,
      unexpectedVariants: 250 - limits.maxUnexpectedVariants,
      missingExpectedVariants: 300 - limits.maxMissingExpectedVariants,
      supportingReadIds: 500 * (readIds.length - limits.maxSupportingReadIds),
    });
    expect(built.result.data.reasonCodes).toHaveLength(500);
    expect(new Set(built.result.data.reasonCodes).size).toBe(500);
    expect(new TextEncoder().encode(built.asset.content).byteLength)
      .toBeLessThan(MAX_ARTIFACT_ANALYSIS_ASSET_BYTES);
  });

  it('passes strict asset/result appenders with reference-first records and JSON-only report linkage', () => {
    const built = build();
    const recordLengths = new Map([
      ['reference', REFERENCE_SEQUENCE.length],
      ['read-1', READ_SEQUENCES[0].length],
      ['read-2', READ_SEQUENCES[1].length],
    ]);
    const withAsset = appendArtifactAnalysisAsset(undefined, built.asset, { recordLengths });
    const workspace = appendArtifactAnalysisWorkspaceResult(withAsset, built.result, { recordLengths });

    expect(workspace.analysisAssets).toHaveLength(1);
    expect(workspace.analysisAssets[0].mediaType).toBe('application/json');
    expect(workspace.analysisResults).toHaveLength(1);
    expect(workspace.analysisResults[0]).toMatchObject({
      kind: 'construct_verification',
      status: 'complete',
      inputRecordIds: ['reference', 'read-1', 'read-2'],
      inputSha256s: [REFERENCE_SHA256, ...READ_SHA256S],
      assetIds: ['verification-report'],
      data: {
        verificationReportAssetId: 'verification-report',
      },
      provenance: {
        engine: 'motif-construct-verification',
        engineVersion: '1',
      },
    });
  });

  it('round-trips a real engine variant report through the strict durable boundary', () => {
    const reference = ENGINE_REFERENCE_SEQUENCE;
    const changed = `${reference.slice(0, 120)}${reference[120] === 'A' ? 'C' : 'A'}${reference.slice(121)}`;
    const qualityScores = Array.from({ length: changed.length }, () => 40);
    const verification = verifyArtifactConstruct({
      reference: {
        id: 'engine-reference',
        sequence: reference,
        topology: 'linear',
        sha256: sha256HexSync(reference),
      },
      reads: [{
        id: 'engine-read',
        baseCalls: changed,
        qualityScores,
        sha256: sha256HexSync(changed),
      }],
      thresholds: { minCoverageFraction: 0 },
    });
    expect(verification.state).toBe('inconsistent');
    expect(verification.variants.unexpected).toHaveLength(1);

    const built = buildArtifactConstructVerificationArtifacts(
      verification,
      [artifactConstructReadEvidenceSha256({ baseCalls: changed, qualityScores })],
      {
        resultId: 'engine-verification-result',
        assetId: 'engine-verification-report',
        createdAt: CREATED_AT,
      },
    );
    const withAsset = appendArtifactAnalysisAsset(undefined, built.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(withAsset, built.result)).not.toThrow();
  });

  it('rejects zero-depth not-observed expected variants in a rehashed real-engine report', () => {
    const qualityScores = Array.from({ length: ENGINE_REFERENCE_SEQUENCE.length }, () => 40);
    const position = 120;
    const referenceBase = ENGINE_REFERENCE_SEQUENCE[position];
    const verification = verifyArtifactConstruct({
      reference: {
        id: 'expected-reference',
        sequence: ENGINE_REFERENCE_SEQUENCE,
        topology: 'linear',
        sha256: sha256HexSync(ENGINE_REFERENCE_SEQUENCE),
      },
      reads: [{
        id: 'reference-read',
        baseCalls: ENGINE_REFERENCE_SEQUENCE,
        qualityScores,
        sha256: sha256HexSync(ENGINE_REFERENCE_SEQUENCE),
      }],
      expectedVariants: [{
        id: 'expected-change',
        type: 'substitution',
        referenceStart: position,
        referenceEnd: position + 1,
        reference: referenceBase,
        alternate: referenceBase === 'A' ? 'C' : 'A',
      }],
    });
    expect(verification.variants.expected[0]).toMatchObject({ status: 'not_observed', depth: 1 });

    const built = buildArtifactConstructVerificationArtifacts(
      verification,
      [artifactConstructReadEvidenceSha256({
        baseCalls: ENGINE_REFERENCE_SEQUENCE,
        qualityScores,
      })],
      {
        resultId: 'expected-status-result',
        assetId: 'expected-status-report',
        createdAt: CREATED_AT,
      },
    );
    const mutated = mutateBuiltReport(built, (report) => {
      const variants = report.variants as {
        expected: Array<{ depth: number }>;
        missingExpected: Array<{ depth: number }>;
      };
      variants.expected[0].depth = 0;
      variants.missingExpected[0].depth = 0;
    });
    const withAsset = appendArtifactAnalysisAsset(undefined, mutated.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(withAsset, mutated.result))
      .toThrow(/depth is inconsistent with status not_observed/i);
  });

  it('rejects high-confidence variants whose rehashed support has no possible quality-bearing read', () => {
    const changed = `${ENGINE_REFERENCE_SEQUENCE.slice(0, 120)}${ENGINE_REFERENCE_SEQUENCE[120] === 'A' ? 'C' : 'A'}${ENGINE_REFERENCE_SEQUENCE.slice(121)}`;
    const qualityScores = Array.from({ length: changed.length }, () => 40);
    const verification = verifyArtifactConstruct({
      reference: {
        id: 'quality-reference',
        sequence: ENGINE_REFERENCE_SEQUENCE,
        topology: 'linear',
        sha256: sha256HexSync(ENGINE_REFERENCE_SEQUENCE),
      },
      reads: [{
        id: 'quality-read',
        baseCalls: changed,
        qualityScores,
        sha256: sha256HexSync(changed),
      }],
      thresholds: { minCoverageFraction: 0 },
    });
    expect(verification.variants.unexpected[0]).toMatchObject({ confidence: 'high' });
    const built = buildArtifactConstructVerificationArtifacts(
      verification,
      [artifactConstructReadEvidenceSha256({ baseCalls: changed, qualityScores })],
      {
        resultId: 'quality-result',
        assetId: 'quality-report',
        createdAt: CREATED_AT,
      },
    );
    const mutated = mutateBuiltReport(built, (report) => {
      const reads = report.reads as Array<{
        qualityProvided: boolean;
        meanQuality: number | null;
        trim: { method: string };
      }>;
      reads[0].qualityProvided = false;
      reads[0].meanQuality = null;
      reads[0].trim.method = 'none_missing_quality';
      const reasons = report.reasons as Array<Record<string, unknown>>;
      reasons.unshift({
        code: 'missing_quality',
        severity: 'review',
        message: 'The forged read has no quality evidence.',
        readId: 'quality-read',
      });
    });
    const result = structuredClone(mutated.result);
    result.data.reasonCodes = ['missing_quality', ...result.data.reasonCodes];
    const withAsset = appendArtifactAnalysisAsset(undefined, mutated.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(withAsset, result))
      .toThrow(/confidence high requires possible quality-bearing mapped-read support/i);
  });

  it('accepts compact high-confidence support when its quality-bearing read is honestly omitted', () => {
    const source = verificationSource();
    const mappedTemplate = source.reads[0];
    const readIds = [
      ...Array.from({ length: 12 }, (_, index) => `a-qualityless-${String(index).padStart(2, '0')}`),
      'z-quality-bearing',
    ];
    source.reads = readIds.map((id, index) => ({
      ...mappedTemplate,
      id,
      name: id,
      sha256: sha256HexSync(id),
      qualityProvided: index === readIds.length - 1,
      meanQuality: index === readIds.length - 1 ? 40 : null,
      trim: {
        ...mappedTemplate.trim,
        method: index === readIds.length - 1 ? 'quality_window' : 'none_missing_quality',
      },
    }));
    source.reasons = [{
      code: 'missing_quality',
      severity: 'review',
      message: 'Some supporting reads lack quality evidence.',
    }, ...source.reasons];
    source.variants.observed = [{
      ...observedVariant(),
      depth: readIds.length,
      support: readIds.length,
      supportWeight: 52,
      fraction: 1,
      meanQuality: 40,
      supportingReadIds: readIds,
      expectedVariantId: 'expected-0',
    }];
    source.variants.expected = [{ ...expectedVariant(), depth: 1 }];
    source.provenance.readSha256s = source.reads.map((read) => read.sha256);
    const qualityScores = Array.from({ length: REFERENCE_SEQUENCE.length }, () => 40);
    const built = buildArtifactConstructVerificationArtifacts(
      source,
      readIds.map((_, index) => artifactConstructReadEvidenceSha256({
        baseCalls: REFERENCE_SEQUENCE,
        qualityScores: index === readIds.length - 1 ? qualityScores : null,
      })),
      {
        resultId: 'compact-quality-result',
        assetId: 'compact-quality-report',
        createdAt: CREATED_AT,
      },
    );
    const report = JSON.parse(built.asset.content) as {
      variants: { observed: Array<{ supportingReadIds: string[]; omittedSupportingReadIds: number }> };
    };
    expect(report.variants.observed[0]).toMatchObject({
      supportingReadIds: expect.not.arrayContaining(['z-quality-bearing']),
      omittedSupportingReadIds:
        readIds.length - ARTIFACT_CONSTRUCT_VERIFICATION_REPORT_LIMITS.maxSupportingReadIds,
    });
    const withAsset = appendArtifactAnalysisAsset(undefined, built.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(withAsset, built.result)).not.toThrow();

    const impossibleDepth = mutateBuiltReport(built, (forgedReport) => {
      const variants = forgedReport.variants as { expected: Array<{ depth: number }> };
      variants.expected[0].depth = 2;
    });
    const withForgedAsset = appendArtifactAnalysisAsset(undefined, impossibleDepth.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(withForgedAsset, impossibleDepth.result))
      .toThrow(/expected\[0\]\.depth must be an integer from 0 through 1/i);
  });

  it('rejects linked expected quality depth above the observed variant span', () => {
    const built = build();
    const mutated = mutateBuiltReport(built, (report) => {
      const variants = report.variants as {
        observed: Array<{
          depth: number;
          support: number;
          supportWeight: number;
          supportingReadIds: string[];
          omittedSupportingReadIds: number;
        }>;
      };
      Object.assign(variants.observed[0], {
        depth: 1,
        support: 1,
        supportWeight: 32,
        supportingReadIds: ['read-1'],
        omittedSupportingReadIds: 0,
      });
    });
    const withAsset = appendArtifactAnalysisAsset(undefined, mutated.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(withAsset, mutated.result))
      .toThrow(/cross-links are inconsistent/i);
  });

  it('rejects rehashed variant support reassigned to a known but nonmapped read', () => {
    const changed = `${ENGINE_REFERENCE_SEQUENCE.slice(0, 120)}${ENGINE_REFERENCE_SEQUENCE[120] === 'A' ? 'C' : 'A'}${ENGINE_REFERENCE_SEQUENCE.slice(121)}`;
    const mappedQuality = Array.from({ length: changed.length }, () => 40);
    const nonmapped = 'A'.repeat(ENGINE_REFERENCE_SEQUENCE.length);
    const nonmappedQuality = Array.from({ length: nonmapped.length }, () => 40);
    const verification = verifyArtifactConstruct({
      reference: {
        id: 'support-reference',
        sequence: ENGINE_REFERENCE_SEQUENCE,
        topology: 'linear',
        sha256: sha256HexSync(ENGINE_REFERENCE_SEQUENCE),
      },
      reads: [{
        id: 'mapped-read',
        baseCalls: changed,
        qualityScores: mappedQuality,
        sha256: sha256HexSync(changed),
      }, {
        id: 'known-nonmapped-read',
        baseCalls: nonmapped,
        qualityScores: nonmappedQuality,
        sha256: sha256HexSync(nonmapped),
      }],
      thresholds: { minCoverageFraction: 0 },
    });
    expect(verification.reads.find((read) => read.id === 'mapped-read')?.status).toBe('mapped');
    expect(verification.reads.find((read) => read.id === 'known-nonmapped-read')?.status).not.toBe('mapped');
    expect(verification.variants.unexpected).toHaveLength(1);

    const built = buildArtifactConstructVerificationArtifacts(
      verification,
      [
        artifactConstructReadEvidenceSha256({ baseCalls: changed, qualityScores: mappedQuality }),
        artifactConstructReadEvidenceSha256({ baseCalls: nonmapped, qualityScores: nonmappedQuality }),
      ],
      {
        resultId: 'support-verification-result',
        assetId: 'support-verification-report',
        createdAt: CREATED_AT,
      },
    );
    const mutated = mutateBuiltReport(built, (report) => {
      const variants = report.variants as {
        observed: Array<{ supportingReadIds: string[] }>;
        unexpected: Array<{ supportingReadIds: string[] }>;
      };
      variants.observed[0].supportingReadIds[0] = 'known-nonmapped-read';
      variants.unexpected[0].supportingReadIds[0] = 'known-nonmapped-read';
    });
    const withAsset = appendArtifactAnalysisAsset(undefined, mutated.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(withAsset, mutated.result))
      .toThrow(/supportingReadIds must be unique mapped reads/i);
  });

  it('requires the no-usable-reads finding even when a report and summary are rehashed together', () => {
    const nonmapped = 'A'.repeat(ENGINE_REFERENCE_SEQUENCE.length);
    const qualityScores = Array.from({ length: nonmapped.length }, () => 40);
    const verification = verifyArtifactConstruct({
      reference: {
        id: 'no-usable-reference',
        sequence: ENGINE_REFERENCE_SEQUENCE,
        topology: 'linear',
        sha256: sha256HexSync(ENGINE_REFERENCE_SEQUENCE),
      },
      reads: [{
        id: 'no-usable-read',
        baseCalls: nonmapped,
        qualityScores,
        sha256: sha256HexSync(nonmapped),
      }],
      thresholds: { minCoverageFraction: 0 },
    });
    expect(verification.reads[0].status).not.toBe('mapped');
    expect(verification.reasons.map((reason) => reason.code)).toContain('no_usable_reads');

    const built = buildArtifactConstructVerificationArtifacts(
      verification,
      [artifactConstructReadEvidenceSha256({ baseCalls: nonmapped, qualityScores })],
      {
        resultId: 'no-usable-result',
        assetId: 'no-usable-report',
        createdAt: CREATED_AT,
      },
    );
    const mutated = removeBuiltReason(built, 'no_usable_reads');
    const withAsset = appendArtifactAnalysisAsset(undefined, mutated.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(withAsset, mutated.result))
      .toThrow(/missing required reason code no_usable_reads/i);
  });

  it('retains both low-depth and missing-strand findings for the same required region', () => {
    const qualityScores = Array.from({ length: ENGINE_REFERENCE_SEQUENCE.length }, () => 40);
    const verification = verifyArtifactConstruct({
      reference: {
        id: 'strand-reference',
        sequence: ENGINE_REFERENCE_SEQUENCE,
        topology: 'linear',
        sha256: sha256HexSync(ENGINE_REFERENCE_SEQUENCE),
      },
      reads: [{
        id: 'forward-read',
        baseCalls: ENGINE_REFERENCE_SEQUENCE,
        qualityScores,
        sha256: sha256HexSync(ENGINE_REFERENCE_SEQUENCE),
      }],
      thresholds: { minCoverageFraction: 0, minTrimmedReadLength: 20 },
      requiredRegions: [{
        id: 'bidirectional-region',
        start: 0,
        end: ENGINE_REFERENCE_SEQUENCE.length,
        minDepth: 2,
        requireBothStrands: true,
      }],
    });
    expect(verification.coverage.requiredRegions[0]).toMatchObject({
      status: 'low_depth',
      coveredBases: ENGINE_REFERENCE_SEQUENCE.length,
      basesMeetingMinDepth: 0,
      forwardCoveredBases: ENGINE_REFERENCE_SEQUENCE.length,
      reverseCoveredBases: 0,
      bothStrandsCoveredBases: 0,
    });
    expect(verification.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      'required_region_low_depth',
      'required_region_missing_strand',
    ]));

    const built = buildArtifactConstructVerificationArtifacts(
      verification,
      [artifactConstructReadEvidenceSha256({ baseCalls: ENGINE_REFERENCE_SEQUENCE, qualityScores })],
      {
        resultId: 'strand-result',
        assetId: 'strand-report',
        createdAt: CREATED_AT,
      },
    );
    const pristineWorkspace = appendArtifactAnalysisAsset(undefined, built.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(pristineWorkspace, built.result)).not.toThrow();

    for (const code of ['required_region_low_depth', 'required_region_missing_strand']) {
      const mutated = removeBuiltReason(built, code);
      const withAsset = appendArtifactAnalysisAsset(undefined, mutated.asset);
      expect(() => appendArtifactAnalysisWorkspaceResult(withAsset, mutated.result), code)
        .toThrow(new RegExp(`missing required reason code ${code}`, 'i'));
    }
  });

  it('uses bases meeting min depth for the durable coverage invariant and only covered regions pass', () => {
    const built = build();
    expect(built.result.parameters.thresholds).toMatchObject({ minDepth: 2 });
    expect(built.result.data).toMatchObject({
      referenceLength: 4,
      coveredBases: 2,
      coverageFraction: 0.5,
      requiredRegionCount: 1,
      passingRegionCount: 0,
    });
    const withAsset = appendArtifactAnalysisAsset(undefined, built.asset);
    expect(() => appendArtifactAnalysisWorkspaceResult(withAsset, built.result)).not.toThrow();
  });

  it('finds duplicates only by the exact engine, engineVersion, requestSha256 tuple', () => {
    const built = build();
    const exact = {
      engine: 'motif-construct-verification',
      engineVersion: '1',
      requestSha256: REQUEST_SHA256,
    };
    expect(findDuplicateArtifactConstructVerificationResult([built.result], exact)).toBe(built.result);
    expect(findDuplicateArtifactConstructVerificationResult([built.result], { ...exact, engine: 'other' }))
      .toBeUndefined();
    expect(findDuplicateArtifactConstructVerificationResult([built.result], { ...exact, engineVersion: '2' }))
      .toBeUndefined();
    expect(findDuplicateArtifactConstructVerificationResult([built.result], {
      ...exact,
      requestSha256: sha256HexSync('different-request'),
    })).toBeUndefined();
  });

  it('rejects inconsistent structural hashes and misaligned evidence attestations', () => {
    const badReference = verificationSource();
    badReference.reference.sha256 = sha256HexSync('AAAA');
    expect(() => build(badReference)).toThrow(/reference\.sha256 must match/i);

    const badProvenance = verificationSource();
    badProvenance.provenance.readSha256s = [...READ_SHA256S].reverse();
    expect(() => build(badProvenance)).toThrow(/must match reads\[\]\.sha256 in input order/i);

    expect(() => buildArtifactConstructVerificationArtifacts(
      verificationSource(),
      evidenceSha256s().slice(0, 1),
      { resultId: 'result', assetId: 'asset', createdAt: CREATED_AT },
    )).toThrow(/one-to-one/i);
  });
});
