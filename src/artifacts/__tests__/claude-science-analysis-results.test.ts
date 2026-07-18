import { describe, expect, it } from 'vitest';
import {
  appendArtifactAnalysisAsset,
  appendArtifactAnalysisResult,
  appendArtifactAnalysisWorkspaceResult,
  cloneArtifactAnalysisWorkspace,
  getArtifactAnalysisAssetDependents,
  getArtifactAnalysisRecordDependents,
  getArtifactAnalysisResultDependents,
  getArtifactAnalysisResultsSnapshot,
  MAX_ARTIFACT_ANALYSIS_ASSET_BYTES,
  MAX_ARTIFACT_ANALYSIS_RESULTS,
  normalizeArtifactAnalysisResults,
  normalizeArtifactAnalysisWorkspace,
  removeArtifactAnalysisAsset,
  removeArtifactAnalysisResult,
  removeArtifactAnalysisResultCascade,
  removeArtifactAnalysisResultsForRecord,
  serializeArtifactAnalysisWorkspace,
} from '../claude-science-analysis-results';
import { sha256HexSync } from '../claude-science-sha256';

const CREATED_AT = '2026-07-12T16:30:00.000Z';
const SHA256 = 'A'.repeat(64);
const NORMALIZED_SHA256 = SHA256.toLowerCase();
const REQUEST_SHA256 = sha256HexSync('construct-verification-request');
const READ_EVIDENCE_SHA256 = sha256HexSync('construct-read-evidence');
const VERIFICATION_THRESHOLDS = {
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

function provenance() {
  return {
    source: 'claude-science',
    operation: 'analysis',
    actor: 'agent',
    engine: 'motif',
    engineVersion: '2.5.0',
  };
}

function asset(overrides: Record<string, unknown> = {}) {
  const content = typeof overrides.content === 'string' ? overrides.content : 'Inert analysis text';
  return {
    id: 'asset-1',
    name: 'analysis.txt',
    mediaType: 'text/plain',
    content,
    sha256: sha256HexSync(content),
    createdAt: CREATED_AT,
    provenance: provenance(),
    ...overrides,
  };
}

function constructVerificationProvenance() {
  return {
    source: 'motif-for-claude-science-artifact',
    operation: 'construct_verification',
    actor: 'user',
    engine: 'motif-construct-verification',
    engineVersion: '1',
    parentIds: ['record-a', 'record-b'],
    metadata: { requestSha256: REQUEST_SHA256, workUnits: 128 },
  };
}

function constructVerificationReport() {
  return {
    schema: 'motif.construct-verification-report.v1',
    version: 1,
    state: 'needs_review',
    reasons: [{
      code: 'partial_reference_coverage',
      severity: 'review',
      message: 'Only part of the reference met the requested depth.',
    }, {
      code: 'required_region_uncovered',
      severity: 'review',
      message: 'A required region is not fully covered.',
      regionId: 'region-review',
    }, {
      code: 'low_confidence_variant',
      severity: 'review',
      message: 'A low-confidence unexpected variant requires review.',
    }],
    reference: {
      id: 'record-a',
      name: 'Predicted construct',
      length: 2_000,
      topology: 'linear',
      sha256: NORMALIZED_SHA256,
    },
    thresholds: { ...VERIFICATION_THRESHOLDS },
    reads: [{
      id: 'record-b',
      sha256: NORMALIZED_SHA256,
      rawLength: 1_000,
      qualityProvided: true,
      meanQuality: 30,
      status: 'mapped',
      trim: {
        method: 'quality_window',
        rawStart: 0,
        rawEnd: 1_000,
        trimmedLength: 1_000,
        removedFromStart: 0,
        removedFromEnd: 0,
      },
      mapping: {
        orientation: 'forward',
        referenceStart: 0,
        referenceEnd: 1_000,
        wraps: false,
        referenceSpan: 1_000,
        score: 3_000,
        secondBestScore: null,
        mappingMargin: null,
        identity: 1,
        alignedLength: 1_000,
        matches: 1_000,
        substitutions: 0,
        insertions: 0,
        deletions: 0,
        indelFraction: 0,
      },
    }],
    coverage: {
      coveredBasesAtAnyDepth: 1_500,
      basesMeetingMinDepth: 1_500,
      coverageFraction: 0.75,
      minimumDepth: 0,
      maximumDepth: 1,
      meanDepth: 0.75,
      requiredRegions: [{
        id: 'region-pass',
        start: 0,
        end: 100,
        wraps: false,
        length: 100,
        minDepth: 1,
        requireBothStrands: false,
        coveredBases: 100,
        basesMeetingMinDepth: 100,
        coveredFraction: 1,
        minimumDepth: 1,
        maximumDepth: 1,
        meanDepth: 1,
        forwardCoveredBases: 100,
        reverseCoveredBases: 0,
        bothStrandsCoveredBases: 0,
        status: 'covered',
      }, {
        id: 'region-review',
        start: 100,
        end: 200,
        wraps: false,
        length: 100,
        minDepth: 1,
        requireBothStrands: false,
        coveredBases: 0,
        basesMeetingMinDepth: 0,
        coveredFraction: 0,
        minimumDepth: 0,
        maximumDepth: 0,
        meanDepth: 0,
        forwardCoveredBases: 0,
        reverseCoveredBases: 0,
        bothStrandsCoveredBases: 0,
        status: 'uncovered',
      }],
    },
    consensus: { sequence: 'N' },
    variants: {
      observed: [{
        id: 'observed-1',
        type: 'substitution',
        referenceStart: 10,
        referenceEnd: 11,
        reference: 'A',
        alternate: 'C',
        depth: 1,
        support: 1,
        supportWeight: 31,
        fraction: 1,
        meanQuality: 30,
        confidence: 'high',
        supportingReadIds: ['record-b'],
        expectedVariantId: 'expected-1',
        omittedSupportingReadIds: 0,
      }, {
        id: 'observed-2',
        type: 'substitution',
        referenceStart: 20,
        referenceEnd: 21,
        reference: 'A',
        alternate: 'G',
        depth: 1,
        support: 1,
        supportWeight: 1,
        fraction: 1,
        meanQuality: null,
        confidence: 'low',
        supportingReadIds: ['record-b'],
        omittedSupportingReadIds: 0,
      }],
      expected: [{
        id: 'expected-1',
        type: 'substitution',
        referenceStart: 10,
        referenceEnd: 11,
        reference: 'A',
        alternate: 'C',
        status: 'observed',
        depth: 1,
        observedVariantId: 'observed-1',
      }],
      unexpected: [{
        id: 'observed-2',
        type: 'substitution',
        referenceStart: 20,
        referenceEnd: 21,
        reference: 'A',
        alternate: 'G',
        depth: 1,
        support: 1,
        supportWeight: 1,
        fraction: 1,
        meanQuality: null,
        confidence: 'low',
        supportingReadIds: ['record-b'],
        omittedSupportingReadIds: 0,
      }],
      missingExpected: [],
    },
    provenance: {
      engine: 'motif-construct-verification',
      engineVersion: '1',
      referenceSha256: NORMALIZED_SHA256,
      readSha256s: [NORMALIZED_SHA256],
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
    omitted: {
      reasons: 0,
      reads: 0,
      requiredRegions: 0,
      observedVariants: 0,
      expectedVariants: 0,
      unexpectedVariants: 0,
      missingExpectedVariants: 0,
      supportingReadIds: 0,
    },
  };
}

function constructVerificationReportAsset(
  mutate?: (report: ReturnType<typeof constructVerificationReport>) => void,
) {
  const report = constructVerificationReport();
  mutate?.(report);
  const content = `${JSON.stringify(report, null, 2)}\n`;
  return asset({
    id: 'verification-report',
    name: 'construct-verification-report.json',
    mediaType: 'application/json',
    content,
    sha256: sha256HexSync(content),
    provenance: constructVerificationProvenance(),
  });
}

function baseResult(kind: string, data: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    id: `${kind}-1`,
    kind,
    name: `${kind} result`,
    status: 'complete',
    summary: 'Checked result',
    inputRecordIds: ['record-a'],
    inputSha256s: [SHA256],
    dependsOnResultIds: [],
    assetIds: [],
    parameters: { requestedBy: 'user', threshold: 0.5 },
    data,
    createdAt: CREATED_AT,
    provenance: provenance(),
    ...overrides,
  };
}

const resultFixtures = [
  baseResult('primer_design', {
    targetRecordId: 'record-a',
    targetRange: { start: 10, end: 310 },
    selectedPairId: 'pair-1',
    pairs: [{
      id: 'pair-1',
      forward: { sequence: 'acgtacgtacgtacgtacgt', tmC: 61.2, gcPercent: 50, start: 10, end: 30 },
      reverse: { sequence: 'TGCATGCATGCATGCATGCA', tmC: 60.8, gcPercent: 50, start: 290, end: 310, tail5: 'GGTCTC' },
      productLengthBp: 300,
      score: 92,
      warnings: ['Review terminal clamp'],
    }],
  }),
  baseResult('pcr', {
    templateRecordId: 'record-a',
    products: [{ id: 'amplicon-1', lengthBp: 301, recordId: 'record-b', templateRange: { start: 10, end: 311 } }],
  }, { inputRecordIds: ['record-a', 'record-b'], inputSha256s: [SHA256, SHA256] }),
  baseResult('assembly_plan', {
    method: 'golden_braid',
    orderedPartRecordIds: ['record-a', 'record-b'],
    destinationRecordId: 'record-c',
    productRecordId: 'record-d',
    standard: 'GoldenBraid 3.0',
    enzyme: 'BsaI',
    junctions: [{ leftRecordId: 'record-a', rightRecordId: 'record-b', compatible: true, overhang: 'AATG' }],
  }, { inputRecordIds: ['record-a', 'record-b', 'record-c', 'record-d'], inputSha256s: [SHA256, SHA256, SHA256, SHA256] }),
  baseResult('construct_verification', {
    referenceRecordId: 'record-a',
    readRecordIds: ['record-b'],
    state: 'needs_review',
    referenceLength: 2_000,
    coveredBases: 1_500,
    coverageFraction: 0.75,
    mappedReadCount: 1,
    requiredRegionCount: 2,
    passingRegionCount: 1,
    observedVariantCount: 2,
    expectedVariantCount: 1,
    unexpectedVariantCount: 1,
    missingExpectedVariantCount: 0,
    reasonCodes: ['partial_reference_coverage', 'required_region_uncovered', 'low_confidence_variant'],
    verificationReportAssetId: 'verification-report',
  }, {
    inputRecordIds: ['record-a', 'record-b'],
    inputSha256s: [SHA256, SHA256],
    assetIds: ['verification-report'],
    parameters: {
      topology: 'linear',
      requestSha256: REQUEST_SHA256,
      thresholds: { ...VERIFICATION_THRESHOLDS },
      readEvidence: {
        schema: 'motif.construct-read-evidence.v1',
        sha256s: [READ_EVIDENCE_SHA256],
      },
    },
    provenance: constructVerificationProvenance(),
  }),
  baseResult('blast_search', {
    program: 'blastn',
    database: 'nt',
    databaseVersion: '2026-07',
    queryRecordId: 'record-a',
    hits: [{
      accession: 'NM_000000.1',
      title: 'Example sequence',
      identityPercent: 99.2,
      queryCoveragePercent: 98.5,
      eValue: 1e-50,
      bitScore: 412,
      queryStart: 1,
      queryEnd: 300,
      subjectStart: 44,
      subjectEnd: 343,
      alignmentAssetId: 'asset-1',
    }],
  }, { assetIds: ['asset-1'] }),
  baseResult('structure_model', {
    format: 'pdb',
    modelAssetId: 'structure-asset',
    method: 'AlphaFold-compatible import',
    chains: [{ id: 'A', recordId: 'record-a', residueCount: 100 }],
    metrics: { meanConfidence: 91.4 },
  }, { assetIds: ['structure-asset'] }),
  baseResult('report', {
    format: 'markdown',
    body: '# Review\n\nThis remains inert text.',
  }),
  baseResult('table', {
    columns: [
      { id: 'name', label: 'Name', type: 'string' },
      { id: 'score', label: 'Score', type: 'number' },
      { id: 'pass', label: 'Pass', type: 'boolean' },
    ],
    rows: [['candidate-a', 42.5, true], ['candidate-b', null, false]],
  }),
];

const recordLengths = new Map([
  ['record-a', 2_000],
  ['record-b', 1_000],
  ['record-c', 5_000],
  ['record-d', 6_000],
]);

describe('Claude Science typed analysis results', () => {
  it('normalizes all eight discriminated result kinds with record, hash, and asset references', () => {
    const workspace = normalizeArtifactAnalysisWorkspace({
      analysisResults: resultFixtures,
      analysisAssets: [
        asset(),
        constructVerificationReportAsset(),
        asset({ id: 'structure-asset', name: 'model.pdb', mediaType: 'chemical/x-pdb', content: 'ATOM      1  N   MET A   1' }),
      ],
    }, { recordLengths });

    expect(workspace.analysisResults.map((result) => result.kind)).toEqual([
      'primer_design',
      'pcr',
      'assembly_plan',
      'construct_verification',
      'blast_search',
      'structure_model',
      'report',
      'table',
    ]);
    expect(workspace.analysisResults[0].inputSha256s).toEqual(['a'.repeat(64)]);
    expect(workspace.analysisResults[0].kind === 'primer_design' && workspace.analysisResults[0].data.pairs[0].forward.sequence)
      .toBe('ACGTACGTACGTACGTACGT');
    expect(workspace.analysisAssets[0].sha256).toBe(sha256HexSync('Inert analysis text'));
  });

  it('keeps absent collections backward-compatible and omits empty serialized fields', () => {
    expect(normalizeArtifactAnalysisWorkspace(undefined)).toEqual({ analysisResults: [], analysisAssets: [] });
    expect(serializeArtifactAnalysisWorkspace({ analysisResults: [], analysisAssets: [] })).toEqual({});
  });

  it('preserves HTML-looking strings only as inert plain text and rejects HTML, SVG, and binary media', () => {
    const hostile = '<svg onload="globalThis.pwned=true"><script>alert(1)</script></svg>';
    const workspace = normalizeArtifactAnalysisWorkspace({
      analysisResults: [],
      analysisAssets: [asset({ content: hostile })],
    });
    expect(workspace.analysisAssets[0].content).toBe(hostile);
    expect(typeof workspace.analysisAssets[0].content).toBe('string');

    for (const mediaType of ['text/html', 'image/svg+xml', 'application/octet-stream']) {
      expect(() => normalizeArtifactAnalysisWorkspace({
        analysisResults: [],
        analysisAssets: [asset({ mediaType })],
      })).toThrow(/not an allowed inert text\/JSON media type/i);
    }
  });

  it('validates JSON assets, UTF-8 byte limits, filenames, and structure media compatibility', () => {
    expect(normalizeArtifactAnalysisWorkspace({
      analysisResults: [],
      analysisAssets: [asset({ mediaType: 'application/json', content: '{"safe":true}' })],
    }).analysisAssets[0].mediaType).toBe('application/json');
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [],
      analysisAssets: [asset({ mediaType: 'application/json', content: '{bad json}' })],
    })).toThrow(/valid JSON/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [],
      analysisAssets: [asset({ name: '../escape.txt' })],
    })).toThrow(/path separators/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [],
      analysisAssets: [asset({ content: 'é'.repeat(Math.floor(MAX_ARTIFACT_ANALYSIS_ASSET_BYTES / 2) + 1) })],
    })).toThrow(/UTF-8 bytes/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [resultFixtures[5]],
      analysisAssets: [asset({ id: 'structure-asset', mediaType: 'text/csv' })],
    })).toThrow(/mediaType does not match pdb/i);
  });

  it('recomputes supplied asset digests and rejects content tampering with a retained SHA-256', () => {
    const originalContent = 'Signed inert analysis text';
    const signed = asset({
      content: originalContent,
      sha256: sha256HexSync(originalContent),
    });
    expect(normalizeArtifactAnalysisWorkspace({ analysisResults: [], analysisAssets: [signed] }).analysisAssets[0].sha256)
      .toBe(sha256HexSync(originalContent));

    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [],
      analysisAssets: [{ ...signed, content: 'Tampered inert analysis text' }],
    })).toThrow(/sha256 must match the exact UTF-8 content/i);

    expect(normalizeArtifactAnalysisWorkspace({
      analysisResults: [],
      analysisAssets: [asset({ sha256: undefined })],
    }).analysisAssets[0].sha256).toBeUndefined();
  });

  it('rejects imported compact construct reports whose identity no longer matches the saved result', () => {
    const normalizeReport = (reportAsset: ReturnType<typeof constructVerificationReportAsset>) => (
      normalizeArtifactAnalysisWorkspace({
        analysisResults: [resultFixtures[3]],
        analysisAssets: [reportAsset],
      }, { recordLengths })
    );
    expect(() => normalizeReport(constructVerificationReportAsset())).not.toThrow();

    expect(() => normalizeReport(constructVerificationReportAsset((report) => {
      report.state = 'inconsistent';
    }))).toThrow(/verification report state must match the saved result/i);

    expect(() => normalizeReport(constructVerificationReportAsset((report) => {
      report.provenance.requestSha256 = sha256HexSync('different-request');
    }))).toThrow(/provenance\.requestSha256 must match the saved result/i);

    expect(() => normalizeReport(constructVerificationReportAsset((report) => {
      report.reference.sha256 = sha256HexSync('different-reference');
    }))).toThrow(/reference\.sha256 must match the saved result/i);

    expect(() => normalizeReport(constructVerificationReportAsset((report) => {
      report.reads[0].sha256 = sha256HexSync('different-read');
    }))).toThrow(/reads\[\]\.sha256 must match the saved result/i);
  });

  it('rejects rehashed compact reports with impossible or incomplete nested scientific evidence', () => {
    type ConstructReport = ReturnType<typeof constructVerificationReport>;
    const normalizeReport = (reportAsset: ReturnType<typeof constructVerificationReportAsset>) => (
      normalizeArtifactAnalysisWorkspace({
        analysisResults: [resultFixtures[3]],
        analysisAssets: [reportAsset],
      }, { recordLengths })
    );
    const cases: Array<[string, (report: ConstructReport) => void]> = [
      ['mapped read without a mapping', (report) => {
        (report.reads[0] as { mapping: unknown }).mapping = null;
      }],
      ['nonmapped read with a mapping', (report) => {
        report.reads[0].status = 'unmapped';
      }],
      ['inconsistent trim arithmetic', (report) => {
        report.reads[0].trim.trimmedLength -= 1;
      }],
      ['inconsistent alignment counts', (report) => {
        report.reads[0].mapping.matches -= 1;
      }],
      ['linear mapping marked as wrapping', (report) => {
        report.reads[0].mapping.wraps = true;
      }],
      ['mapped status below the saved identity threshold', (report) => {
        report.reads[0].mapping.matches = 800;
        report.reads[0].mapping.substitutions = 200;
        report.reads[0].mapping.identity = 0.8;
      }],
      ['invalid consensus alphabet', (report) => {
        report.consensus.sequence = '<script>';
      }],
      ['coverage meeting more bases than are covered', (report) => {
        report.coverage.coveredBasesAtAnyDepth = 1_000;
      }],
      ['global depth extrema below the saved threshold with passing bases', (report) => {
        report.coverage.maximumDepth = 0;
        report.coverage.meanDepth = 0;
      }],
      ['region status contradicting its depth evidence', (report) => {
        report.coverage.requiredRegions[1].status = 'covered';
      }],
      ['region passing a depth threshold above its maximum depth', (report) => {
        report.coverage.requiredRegions[0].minDepth = 2;
      }],
      ['substitution with identical alleles', (report) => {
        report.variants.observed[0].alternate = report.variants.observed[0].reference;
      }],
      ['unknown supporting read', (report) => {
        report.variants.observed[0].supportingReadIds[0] = 'forged-read';
      }],
      ['unexpected variant differing from observed evidence', (report) => {
        report.variants.unexpected[0].alternate = 'T';
      }],
      ['broken expected-observed cross-link', (report) => {
        report.variants.expected[0].observedVariantId = 'observed-2';
      }],
      ['cross-linked expected and observed variants with different alleles', (report) => {
        report.variants.expected[0].alternate = 'T';
      }],
      ['below-cap variants hidden through an omission count', (report) => {
        report.variants.observed.pop();
        report.omitted.observedVariants = 1;
      }],
      ['partial provenance limits', (report) => {
        delete (report.provenance.limits as Record<string, number>).maxWorkUnits;
      }],
      ['unknown nested mapping field', (report) => {
        Object.assign(report.reads[0].mapping, { executableHint: 'ignored?' });
      }],
    ];

    cases.forEach(([label, mutate]) => {
      expect(() => normalizeReport(constructVerificationReportAsset(mutate)), label).toThrow();
    });

    const unsigned = constructVerificationReportAsset();
    (unsigned as { sha256: string | undefined }).sha256 = undefined;
    expect(() => normalizeReport(unsigned)).toThrow(/requires a content SHA-256/i);
  });

  it('rejects dangling, self-referential, and cyclic dependencies as atomic batches', () => {
    const primer = resultFixtures[0];
    const pcr = baseResult('pcr', {
      templateRecordId: 'record-a',
      primerDesignResultId: 'primer_design-1',
      products: [],
    }, { id: 'pcr-dependent', dependsOnResultIds: ['primer_design-1'] });
    expect(normalizeArtifactAnalysisWorkspace({ analysisResults: [primer, pcr], analysisAssets: [] }).analysisResults).toHaveLength(2);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [{ ...primer, dependsOnResultIds: ['missing'] }],
      analysisAssets: [],
    })).toThrow(/depends on missing result/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [{ ...primer, dependsOnResultIds: ['primer_design-1'] }],
      analysisAssets: [],
    })).toThrow(/cannot depend on itself/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [
        { ...primer, dependsOnResultIds: ['pcr-dependent'] },
        pcr,
      ],
      analysisAssets: [],
    })).toThrow(/contain a cycle/i);
  });

  it('rejects missing records/assets, duplicate ids, malformed schemas, and over-limit batches', () => {
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [{ ...resultFixtures[0], inputRecordIds: ['missing'], inputSha256s: [SHA256] }],
      analysisAssets: [],
    }, { recordLengths })).toThrow(/does not match a workspace record/i);
    expect(() => normalizeArtifactAnalysisWorkspace({ analysisResults: [resultFixtures[5]], analysisAssets: [] }))
      .toThrow(/references missing asset/i);
    expect(() => normalizeArtifactAnalysisWorkspace({ analysisResults: [resultFixtures[0], resultFixtures[0]], analysisAssets: [] }))
      .toThrow(/duplicate id/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [{ ...resultFixtures[0], unexpected: true }],
      analysisAssets: [],
    })).toThrow(/not a recognized field/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: Array.from({ length: MAX_ARTIFACT_ANALYSIS_RESULTS + 1 }, () => null),
      analysisAssets: [],
    })).toThrow(/more than 1,000 entries/i);
  });

  it('strictly validates kind-specific numeric, range, selection, and table invariants', () => {
    const primer = resultFixtures[0] as Record<string, unknown>;
    const primerData = primer.data as Record<string, unknown>;
    const primerPairs = primerData.pairs as Array<Record<string, unknown>>;
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [{ ...primer, data: { ...primerData, selectedPairId: 'missing' } }],
      analysisAssets: [],
    })).toThrow(/does not match a primer pair/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [{ ...primer, data: { ...primerData, pairs: [{ ...primerPairs[0], productLengthBp: 0 }] } }],
      analysisAssets: [],
    })).toThrow(/at least 1/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [baseResult('table', {
        columns: [{ id: 'one', label: 'One', type: 'number' }, { id: 'two', label: 'Two', type: 'number' }],
        rows: [[1]],
      })],
      analysisAssets: [],
    })).toThrow(/align one-to-one with columns/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [baseResult('blast_search', {
        program: 'blastn', database: 'nt', queryRecordId: 'record-a',
        hits: [{ accession: 'x', title: 'x', identityPercent: 101, queryCoveragePercent: 50, eValue: 0, bitScore: 1 }],
      })],
      analysisAssets: [],
    })).toThrow(/no greater than 100/i);
    const verification = resultFixtures[3] as Record<string, unknown>;
    const verificationData = verification.data as Record<string, unknown>;
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [{ ...verification, data: { ...verificationData, coverageFraction: 0.5 } }],
      analysisAssets: [asset({ id: 'verification-report', name: 'verification.json', mediaType: 'application/json', content: '{}' })],
    })).toThrow(/must agree with coveredBases/i);
    expect(() => normalizeArtifactAnalysisWorkspace({
      analysisResults: [{ ...verification, inputRecordIds: ['record-b', 'record-a'] }],
      analysisAssets: [asset({ id: 'verification-report', name: 'verification.json', mediaType: 'application/json', content: '{}' })],
    })).toThrow(/reference first/i);
  });

  it('defensively clones nested data and provides familiar result collection helpers', () => {
    const source = { analysisResults: [resultFixtures[0]], analysisAssets: [] };
    const cloned = cloneArtifactAnalysisWorkspace(source);
    const collection = normalizeArtifactAnalysisResults(source.analysisResults);
    const snapshot = getArtifactAnalysisResultsSnapshot(collection);
    if (cloned.analysisResults[0].kind === 'primer_design') cloned.analysisResults[0].data.pairs[0].forward.sequence = 'AAAA';
    if (snapshot[0].kind === 'primer_design') snapshot[0].data.pairs[0].forward.sequence = 'CCCC';

    expect((((source.analysisResults[0].data as Record<string, unknown>).pairs as Array<Record<string, unknown>>)[0].forward as Record<string, unknown>).sequence)
      .toBe('acgtacgtacgtacgtacgt');

    const report = baseResult('report', { format: 'plain', body: 'Safe' }, { id: 'report-added' });
    const appended = appendArtifactAnalysisResult(collection, report);
    const removed = removeArtifactAnalysisResult(appended, 'report-added');
    expect(appended.map((result) => result.id)).toContain('report-added');
    expect(removed).toEqual(collection);
  });

  it('appends assets and asset-backed results transactionally', () => {
    const withAsset = appendArtifactAnalysisAsset(undefined, asset({
      id: 'structure-asset',
      name: 'model.pdb',
      mediaType: 'chemical/x-pdb',
      content: 'ATOM      1  N   MET A   1',
    }));
    const withResult = appendArtifactAnalysisWorkspaceResult(withAsset, resultFixtures[5]);
    expect(withResult.analysisAssets).toHaveLength(1);
    expect(withResult.analysisResults).toHaveLength(1);
    expect(() => appendArtifactAnalysisWorkspaceResult(withResult, resultFixtures[5])).toThrow(/duplicate id/i);
    expect(withAsset.analysisResults).toEqual([]);
  });

  it('reports direct result, asset, and record dependencies before deletion', () => {
    const primer = resultFixtures[0];
    const pcr = baseResult('pcr', {
      templateRecordId: 'record-a',
      primerDesignResultId: 'primer_design-1',
      products: [],
    }, { id: 'pcr-dependent', dependsOnResultIds: ['primer_design-1'] });
    const workspace = normalizeArtifactAnalysisWorkspace({
      analysisResults: [primer, pcr, resultFixtures[5]],
      analysisAssets: [asset({ id: 'structure-asset', name: 'model.pdb', mediaType: 'chemical/x-pdb' })],
    });

    expect(getArtifactAnalysisResultDependents(workspace, 'primer_design-1')).toEqual(['pcr-dependent']);
    expect(getArtifactAnalysisAssetDependents(workspace, 'structure-asset')).toEqual(['structure_model-1']);
    expect(getArtifactAnalysisRecordDependents(workspace, 'record-a')).toEqual([
      'primer_design-1',
      'pcr-dependent',
      'structure_model-1',
    ]);
  });

  it('refuses unsafe dependency deletion and supports explicit cascades with optional orphan cleanup', () => {
    const primer = resultFixtures[0];
    const pcr = baseResult('pcr', {
      templateRecordId: 'record-a',
      primerDesignResultId: 'primer_design-1',
      products: [],
    }, { id: 'pcr-dependent', dependsOnResultIds: ['primer_design-1'], assetIds: ['asset-1'] });
    const workspace = normalizeArtifactAnalysisWorkspace({
      analysisResults: [primer, pcr],
      analysisAssets: [asset()],
    });

    expect(() => removeArtifactAnalysisResult(workspace.analysisResults, 'primer_design-1', { analysisAssets: workspace.analysisAssets }))
      .toThrow(/required by.*pcr-dependent/i);
    expect(() => removeArtifactAnalysisAsset(workspace, 'asset-1')).toThrow(/required by.*pcr-dependent/i);

    const cascaded = removeArtifactAnalysisResultCascade(workspace, 'primer_design-1', { removeOrphanAssets: true });
    expect(cascaded).toEqual({ analysisResults: [], analysisAssets: [] });
    expect(workspace.analysisResults).toHaveLength(2);
    expect(workspace.analysisAssets).toHaveLength(1);
  });

  it('cascades record removal through downstream results and retains shared assets', () => {
    const report = baseResult('report', { format: 'plain', bodyAssetId: 'asset-1' }, {
      id: 'report-shared',
      inputRecordIds: ['record-z'],
      inputSha256s: [SHA256],
      assetIds: ['asset-1'],
    });
    const primer = { ...resultFixtures[0], assetIds: ['asset-1'] };
    const pcr = baseResult('pcr', {
      templateRecordId: 'record-a',
      primerDesignResultId: 'primer_design-1',
      products: [],
    }, { id: 'pcr-dependent', dependsOnResultIds: ['primer_design-1'] });
    const workspace = normalizeArtifactAnalysisWorkspace({
      analysisResults: [primer, pcr, report],
      analysisAssets: [asset()],
    });
    const removed = removeArtifactAnalysisResultsForRecord(workspace, 'record-a', { removeOrphanAssets: true });

    expect(removed.analysisResults.map((result) => result.id)).toEqual(['report-shared']);
    expect(removed.analysisAssets.map((candidate) => candidate.id)).toEqual(['asset-1']);
  });
});
