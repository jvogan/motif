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

const CREATED_AT = '2026-07-12T16:30:00.000Z';
const SHA256 = 'A'.repeat(64);

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
  return {
    id: 'asset-1',
    name: 'analysis.txt',
    mediaType: 'text/plain',
    content: 'Inert analysis text',
    sha256: SHA256,
    createdAt: CREATED_AT,
    provenance: provenance(),
    ...overrides,
  };
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
  it('normalizes all seven discriminated result kinds with record, hash, and asset references', () => {
    const workspace = normalizeArtifactAnalysisWorkspace({
      analysisResults: resultFixtures,
      analysisAssets: [
        asset(),
        asset({ id: 'structure-asset', name: 'model.pdb', mediaType: 'chemical/x-pdb', content: 'ATOM      1  N   MET A   1' }),
      ],
    }, { recordLengths });

    expect(workspace.analysisResults.map((result) => result.kind)).toEqual([
      'primer_design',
      'pcr',
      'assembly_plan',
      'blast_search',
      'structure_model',
      'report',
      'table',
    ]);
    expect(workspace.analysisResults[0].inputSha256s).toEqual(['a'.repeat(64)]);
    expect(workspace.analysisResults[0].kind === 'primer_design' && workspace.analysisResults[0].data.pairs[0].forward.sequence)
      .toBe('ACGTACGTACGTACGTACGT');
    expect(workspace.analysisAssets[0].sha256).toBe('a'.repeat(64));
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
      analysisResults: [resultFixtures[4]],
      analysisAssets: [asset({ id: 'structure-asset', mediaType: 'text/csv' })],
    })).toThrow(/mediaType does not match pdb/i);
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
    expect(() => normalizeArtifactAnalysisWorkspace({ analysisResults: [resultFixtures[4]], analysisAssets: [] }))
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
    const withResult = appendArtifactAnalysisWorkspaceResult(withAsset, resultFixtures[4]);
    expect(withResult.analysisAssets).toHaveLength(1);
    expect(withResult.analysisResults).toHaveLength(1);
    expect(() => appendArtifactAnalysisWorkspaceResult(withResult, resultFixtures[4])).toThrow(/duplicate id/i);
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
      analysisResults: [primer, pcr, resultFixtures[4]],
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
