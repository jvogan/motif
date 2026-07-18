import { describe, expect, it } from 'vitest';
import type {
  ArtifactAnalysisAsset,
  ArtifactAnalysisResult,
  ArtifactBlastHit,
} from '../claude-science-analysis-results';
import {
  artifactAnalysisResultAssetIds,
  artifactTableToTsv,
  artifactTextPage,
  resolveArtifactReport,
  safeAnalysisFilename,
  sortArtifactBlastHits,
} from '../claude-science-analysis-result-viewers';

const createdAt = '2026-07-12T20:00:00.000Z';
const provenance = { source: 'test' };

function reportResult(overrides: Partial<Extract<ArtifactAnalysisResult, { kind: 'report' }>['data']> = {}): Extract<ArtifactAnalysisResult, { kind: 'report' }> {
  return {
    id: 'report-1',
    kind: 'report',
    name: 'Safety report',
    status: 'complete',
    inputRecordIds: [],
    dependsOnResultIds: [],
    assetIds: ['direct-asset'],
    parameters: {},
    data: { format: 'plain', body: 'inline report', ...overrides },
    createdAt,
    provenance,
  };
}

describe('analysis result viewer helpers', () => {
  it('sorts BLAST hits deterministically without mutating the saved order', () => {
    const hits: ArtifactBlastHit[] = [
      { accession: 'B.1', title: 'B', identityPercent: 90, queryCoveragePercent: 100, eValue: 0, bitScore: 200 },
      { accession: 'A.1', title: 'A', identityPercent: 99, queryCoveragePercent: 80, eValue: 1e-20, bitScore: 300 },
      { accession: 'C.1', title: 'C', identityPercent: 90, queryCoveragePercent: 90, eValue: 0, bitScore: 210 },
    ];

    expect(sortArtifactBlastHits(hits, 'evalue').map((hit) => hit.accession)).toEqual(['C.1', 'B.1', 'A.1']);
    expect(sortArtifactBlastHits(hits, 'identity').map((hit) => hit.accession)).toEqual(['A.1', 'C.1', 'B.1']);
    expect(sortArtifactBlastHits(hits, 'accession').map((hit) => hit.accession)).toEqual(['A.1', 'B.1', 'C.1']);
    expect(hits.map((hit) => hit.accession)).toEqual(['B.1', 'A.1', 'C.1']);
  });

  it('resolves typed asset references in addition to the generic list', () => {
    const blast: ArtifactAnalysisResult = {
      id: 'blast-1',
      kind: 'blast_search',
      name: 'BLAST',
      status: 'complete',
      inputRecordIds: ['query'],
      dependsOnResultIds: [],
      assetIds: ['direct-asset'],
      parameters: {},
      data: {
        program: 'blastn',
        database: 'nt',
        queryRecordId: 'query',
        hits: [{
          accession: 'A.1',
          title: 'A',
          identityPercent: 99,
          queryCoveragePercent: 100,
          eValue: 0,
          bitScore: 500,
          alignmentAssetId: 'alignment-asset',
        }],
      },
      createdAt,
      provenance,
    };

    expect(artifactAnalysisResultAssetIds(blast)).toEqual(['direct-asset', 'alignment-asset']);
    expect(artifactAnalysisResultAssetIds(reportResult({ body: undefined, bodyAssetId: 'report-body' }))).toEqual([
      'direct-asset',
      'report-body',
    ]);
  });

  it('prefers an inline report and otherwise resolves the exact body asset', () => {
    const asset: ArtifactAnalysisAsset = {
      id: 'report-body',
      name: 'report.txt',
      mediaType: 'text/plain',
      content: 'asset report',
      createdAt,
      provenance,
    };
    const assets = new Map([[asset.id, asset]]);

    expect(resolveArtifactReport(reportResult({ body: 'inline', bodyAssetId: 'report-body' }), assets)?.text).toBe('inline');
    expect(resolveArtifactReport(reportResult({ body: '', bodyAssetId: 'report-body' }), assets)?.text).toBe('');
    expect(resolveArtifactReport(reportResult({ body: undefined, bodyAssetId: 'report-body' }), assets)?.text).toBe('asset report');
    expect(resolveArtifactReport(reportResult({ body: undefined, bodyAssetId: 'missing' }), assets)).toBeNull();
  });

  it('serializes the complete table as escaped TSV', () => {
    expect(artifactTableToTsv({
      columns: [
        { id: 'name', label: 'Name', type: 'string' },
        { id: 'value', label: 'Value\tunit', type: 'mixed' },
      ],
      rows: [
        ['alpha', 0],
        ['line\nbreak', false],
        ['quote "value"', null],
      ],
    })).toBe([
      'Name\t"Value\tunit"',
      'alpha\t0',
      '"line\nbreak"\tfalse',
      '"quote ""value"""\t',
    ].join('\n'));
  });

  it('neutralizes spreadsheet formulas in string cells while preserving numeric values', () => {
    expect(artifactTableToTsv({
      columns: [
        { id: 'formula', label: '=Formula header', type: 'string' },
        { id: 'text', label: 'Text', type: 'string' },
        { id: 'number', label: 'Number', type: 'number' },
      ],
      rows: [
        ['+SUM(1,1)', '@HYPERLINK("x")', -12],
        ['   -cmd', 'safe', 42],
      ],
    })).toBe([
      "'=Formula header\tText\tNumber",
      "'+SUM(1,1)\t\"'@HYPERLINK(\"\"x\"\")\"\t-12",
      "'   -cmd\tsafe\t42",
    ].join('\n'));
  });

  it('pages every character without splitting a surrogate pair', () => {
    const text = `${'A'.repeat(19_999)}🧬${'B'.repeat(20_001)}`;
    const pages = Array.from({ length: artifactTextPage(text, 999, 20_000).pageCount }, (_, index) => (
      artifactTextPage(text, index, 20_000)
    ));

    expect(pages.map((page) => page.text).join('')).toBe(text);
    expect(pages[0].text.endsWith('\ud83e')).toBe(false);
    expect(pages[1].text.startsWith('\uddec')).toBe(false);
    expect(artifactTextPage('', 4, 20_000)).toMatchObject({ pageIndex: 0, pageCount: 1, text: '' });
  });

  it('produces bounded download names without path or control characters', () => {
    expect(safeAnalysisFilename('../Unsafe\u0000 report?.md', 'report', 'md')).toBe('-Unsafe- report-.md');
    expect(safeAnalysisFilename('Already.tsv', 'table', 'tsv')).toBe('Already.tsv');
    expect(safeAnalysisFilename('   ', 'table', 'tsv')).toBe('table.tsv');
    expect(safeAnalysisFilename('\u202eevil.txt', 'asset', 'txt')).toBe('evil.txt');
    expect(safeAnalysisFilename(`${'a'.repeat(119)}🧬`, 'asset', 'txt')).toBe(`${'a'.repeat(119)}🧬.txt`);
  });
});
