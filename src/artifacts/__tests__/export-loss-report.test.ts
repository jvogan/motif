import { describe, expect, it } from 'vitest';
import type { Feature } from '../../bio/types';
import {
  buildArtifactExportLossReport,
  buildArtifactExportLossReportForRecords,
  exportLossItemLines,
  normalizeRecord,
  parseImportedRecords,
  toGenBankLite,
} from '../motif-artifact';

describe('structured export-loss report', () => {
  it('reuses source-preservation diagnostics and reports every lossy dimension', () => {
    const record = normalizeRecord({
      id: 'loss-report',
      name: 'Loss report fixture',
      molecule: 'dna',
      topology: 'linear',
      seq: 'ACGTACGTACGTACGT',
      provenance: {
        gapsRemoved: 2,
        sequenceNormalization: 'alignment gaps removed before import',
      },
      annotations: [{
        id: 'feature-1',
        name: 'remote feature',
        type: 'misc_feature',
        start: 1,
        end: 12,
        strand: 1,
        subRanges: [
          { start: 1, end: 4, strand: 1 },
          { start: 8, end: 12, strand: 1 },
        ],
        metadata: {
          motifOriginalFeatureKey: 'misc_feature',
          motifOriginalLocation: 'join(2..4,9..12)',
          motifQualifiers: [
            { key: 'note', value: 'first' },
            { key: 'note', value: 'second' },
          ],
          motifQualifierTruncations: [{
            key: 'note',
            originalLength: 1_048_586,
            retainedLength: 1_048_576,
            limit: 1_048_576,
          }],
          motifLocationFuzzy: true,
          motifLocationQuarantined: true,
          motifImportDiagnostics: [{
            severity: 'warning',
            code: 'remote_location',
            featureKey: 'misc_feature',
            location: 'J00194.1:2..12',
            message: 'Remote accession locations are retained but not projected.',
          }],
          vendor_note: 'not emitted by basic interchange exporters',
        },
      }],
    }, 0);

    expect(record).not.toBeNull();
    if (!record) throw new Error('fixture did not normalize');

    const report = buildArtifactExportLossReport(record, 'genbank');
    expect(report.lossy).toBe(true);
    expect(report.faithful).toBe(false);
    expect(report.repeatedQualifiers).toEqual([
      { featureId: 'feature-1', key: 'note', count: 2 },
    ]);
    expect(report.truncatedQualifiers).toEqual([{
      featureId: 'feature-1',
      key: 'note',
      count: 1,
      originalLengths: [1_048_586],
      retainedLengths: [1_048_576],
      originalBytes: [1_048_586],
      retainedBytes: [1_048_576],
      limit: 1_048_576,
    }]);
    expect(report.unsupportedOrRawLocations[0]).toMatchObject({
      featureId: 'feature-1',
      key: 'misc_feature',
      location: 'join(2..4,9..12)',
      diagnostics: [expect.objectContaining({ code: 'remote_location' })],
    });
    expect(report.fuzzyLocations).toEqual([
      { featureId: 'feature-1', key: 'misc_feature', location: 'join(2..4,9..12)' },
    ]);
    expect(report.originalFeatureKeys).toEqual([
      { featureId: 'feature-1', key: 'misc_feature', exportedType: 'misc_feature' },
    ]);
    expect(report.multipartBiologicalOrder).toEqual([
      expect.objectContaining({ segmentCount: 2, order: 'biological', preserved: true }),
    ]);
    expect(report.unrepresentableMetadata).toEqual([
      { featureId: 'feature-1', keys: ['vendor_note'] },
    ]);
    expect(report.sequenceNormalization).toEqual([
      { code: 'gaps_removed', count: 2, detail: '2 alignment gap characters were removed during import.' },
      { code: 'sequence_normalization', detail: 'alignment gaps removed before import' },
    ]);
    expect(report.summary).toMatch(/lossy/i);
  });

  it('marks the structured Motif checkpoints faithful while keeping interchange claims narrow', () => {
    const record = normalizeRecord({ id: 'checkpoint', molecule: 'dna', seq: 'ACGT' }, 0);
    expect(record).not.toBeNull();
    if (!record) throw new Error('fixture did not normalize');

    expect(buildArtifactExportLossReport(record, 'record-json')).toMatchObject({ faithful: true, lossy: false, summary: expect.stringMatching(/active record only/i) });
    expect(buildArtifactExportLossReport(record, 'zip')).toMatchObject({ faithful: true, lossy: false });
    expect(buildArtifactExportLossReport(record, 'genbank').summary).toMatch(/does not claim full INSDC round-trip|lossy/i);
  });

  it('describes raw sequence exports separately from FASTA exports', () => {
    const record = normalizeRecord({
      id: 'raw-sequence',
      name: 'Raw sequence fixture',
      molecule: 'dna',
      seq: 'ACGT',
      annotations: [{
        id: 'raw-feature',
        name: 'annotation omitted by sequence text',
        type: 'misc_feature',
        start: 1,
        end: 4,
      }],
    }, 0);
    expect(record).not.toBeNull();
    if (!record) throw new Error('fixture did not normalize');

    const rawSequenceReport = buildArtifactExportLossReport(record, 'raw-sequence');
    expect(rawSequenceReport).toMatchObject({ format: 'raw-sequence', faithful: false, lossy: true });
    expect(rawSequenceReport.summary).toMatch(/raw sequence export contains sequence text only/i);
    expect(rawSequenceReport.summary).not.toMatch(/FASTA/i);
    expect(buildArtifactExportLossReport(record, 'fasta').summary).toMatch(/FASTA export/i);

    const sequenceOnlyRecord = normalizeRecord({ id: 'sequence-only', molecule: 'dna', seq: 'ACGT' }, 0);
    expect(sequenceOnlyRecord).not.toBeNull();
    if (!sequenceOnlyRecord) throw new Error('sequence-only fixture did not normalize');
    expect(buildArtifactExportLossReport(sequenceOnlyRecord, 'raw-sequence')).toMatchObject({
      faithful: true,
      lossy: false,
      summary: expect.stringMatching(/raw sequence export contains the record sequence only/i),
    });
  });

  it('aggregates whole-inventory loss receipts across inactive records', () => {
    const active = normalizeRecord({
      id: 'active-record',
      name: 'Active record',
      molecule: 'dna',
      seq: 'ACGTACGT',
    }, 0);
    const inactive = normalizeRecord({
      id: 'inactive-record',
      name: 'Inactive annotated record',
      molecule: 'dna',
      seq: 'ACGTACGT',
      active: false,
      annotations: [{ id: 'inactive-feature', name: 'annotation omitted by FASTA', type: 'misc_feature', start: 1, end: 5 }],
    }, 1);
    expect(active).not.toBeNull();
    expect(inactive).not.toBeNull();
    if (!active || !inactive) throw new Error('multi-record fixture did not normalize');

    const report = buildArtifactExportLossReportForRecords([active, inactive], 'fasta');
    expect(report.faithful).toBe(false);
    expect(report.recordReports).toEqual([
      expect.objectContaining({ recordId: 'active-record', recordName: 'Active record', faithful: true, lossCount: 0 }),
      expect.objectContaining({
        recordId: 'inactive-record',
        recordName: 'Inactive annotated record',
        faithful: false,
        lossCount: 1,
      }),
    ]);
    expect(report.summary).toContain('Inactive annotated record');
  });
});

describe('the export popover list of preservation items', () => {
  const file = [
    'LOCUS       QATEST                    60 bp    DNA     linear   SYN 23-SEP-2026',
    'ACCESSION   QATEST',
    'FEATURES             Location/Qualifiers',
    '     source          1..60',
    '                     /organism="synthetic DNA construct"',
    '     promoter        2..30',
    '                     /label="Ptest"',
    '     -35_signal      5..10',
    '                     /label="m35"',
    '     CDS             31..60',
    '                     /label="orf"',
    '                     /db_xref="a:1"',
    '                     /db_xref="b:2"',
    '     misc_feature    <40..>50',
    '                     /label="partial"',
    'ORIGIN',
    `        1 ${'atgcatgcat'.repeat(6).match(/.{1,10}/g)!.join(' ')}`,
    '//',
  ].join('\n');
  const record = normalizeRecord(parseImportedRecords(file, '', 'auto', 'linear')[0], 0)!;
  const feature = (id: string, name: string, metadata: Record<string, unknown>, type: Feature['type'] = 'exon'): Feature => ({
    id, name, type, start: 0, end: 3, strand: 1, color: '#000000', metadata,
  });

  it('names every item the sentence counts, kind by kind', () => {
    // Five features: five imported keys and five raw locations, one repeated
    // /db_xref on the CDS and one partial location, 12 items in all.
    const report = buildArtifactExportLossReport(record, 'genbank');
    expect(report.summary).toContain('lossy; 12 preservation items require review.');
    const lines = exportLossItemLines(report, record.features);
    expect(lines).toEqual([
      '5 imported feature keys: promoter → regulatory, -35_signal → regulatory, source and 2 more',
      '5 locations kept as written: source 1..60, Ptest 2..30, m35 5..10 and 2 more',
      '1 repeated qualifier: /db_xref ×2 on orf',
      '1 partial location: partial <40..>50',
    ]);
    expect(lines.reduce((total, line) => total + Number(line.split(' ')[0]), 0)).toBe(12);
  });

  it('merges equal examples, so "and N more" still counts items', () => {
    const exons = Array.from({ length: 9 }, (_, index) => feature(`exon-${index}`, 'SELENOP', { motifOriginalFeatureKey: 'exon' }));
    const others = [
      feature('a', 'a', { motifOriginalFeatureKey: 'gene' }, 'gene'),
      feature('b', 'b', { motifOriginalFeatureKey: 'misc_feature' }, 'misc_feature'),
      feature('c', 'c', { motifOriginalFeatureKey: 'CDS' }, 'cds'),
      feature('d', 'd', { motifOriginalFeatureKey: 'CDS' }, 'cds'),
    ];
    const features = [...others.slice(0, 1), ...exons, ...others.slice(1)];
    expect(exportLossItemLines(buildArtifactExportLossReport({ ...record, features }, 'genbank'), features))
      .toEqual(['13 imported feature keys: gene, exon ×9, misc_feature and 2 more']);
  });

  it('counts one item as one, and names the fields an export leaves out', () => {
    const one = [feature('only', 'only', { motifOriginalFeatureKey: 'exon' })];
    const report = buildArtifactExportLossReport({ ...record, features: one }, 'genbank');
    expect(report.summary).toContain('lossy; 1 preservation item requires review.');
    expect(exportLossItemLines(report, one)).toEqual(['1 imported feature key: exon']);
    const noted = [feature('n', 'noted exon', { note: 'kept in JSON only' })];
    expect(exportLossItemLines(buildArtifactExportLossReport({ ...record, features: noted }, 'gff3'), noted))
      .toEqual(['1 feature with fields this GFF3 export leaves out: noted exon (note)']);
  });
});

describe('the note and product of a feature built in Motif, in Basic GenBank', () => {
  // A bundled record's features carry their note and product as metadata, with
  // no imported qualifier list. One note has quotes and is longer than a line.
  const note = `Promoter called "P3" in older maps; ${'x'.repeat(90)} ends here`;
  const record = normalizeRecord({
    id: 'notes',
    name: 'notes',
    molecule: 'dna',
    topology: 'linear',
    seq: 'ACGT'.repeat(15),
    annotations: [
      { id: 'amp', name: 'AmpR', type: 'resistance', start: 3, end: 30, strand: 1, metadata: { note, product: 'beta-lactamase', resistance: 'ampicillin' } },
      { id: 'ori', name: 'ori', type: 'origin', start: 33, end: 50, strand: 1, metadata: { note: 'origin' } },
    ],
  }, 0)!;

  it('writes each one after /label on one quoted line, and reads it back equal', () => {
    const exported = toGenBankLite(record, 'linear');
    const lines = exported.split('\n');
    const label = lines.indexOf('                     /label="AmpR"');
    expect(lines.slice(label, label + 3)).toEqual([
      '                     /label="AmpR"',
      `                     /note="Promoter called ""P3"" in older maps; ${'x'.repeat(90)} ends here"`,
      '                     /product="beta-lactamase"',
    ]);
    expect(lines).toContain('                     /note="origin"');
    expect(exported).not.toContain('/resistance');
    const again = normalizeRecord(parseImportedRecords(exported, '', 'auto', 'linear')[0], 0)!;
    const amp = again.features.find((feature) => feature.name === 'AmpR')!;
    expect(amp.metadata.note).toBe(note);
    expect(amp.metadata.product).toBe('beta-lactamase');
    expect(toGenBankLite(again, 'linear')).toBe(exported);
  });

  it('stops listing the fields it writes, and only those', () => {
    expect(exportLossItemLines(buildArtifactExportLossReport(record, 'genbank'), record.features))
      .toEqual(['1 feature with fields this GenBank export leaves out: AmpR (resistance)']);
    expect(exportLossItemLines(buildArtifactExportLossReport(record, 'gff3'), record.features))
      .toEqual(['2 features with fields this GFF3 export leaves out: AmpR (note, product, resistance), ori (note)']);
    // An imported feature writes its own qualifier list, so a note beside it is still left out.
    const imported = { ...record.features[1], metadata: { note: 'origin', motifQualifiers: [{ key: 'label', value: 'ori' }] } };
    expect(buildArtifactExportLossReport({ ...record, features: [imported] }, 'genbank').unrepresentableMetadata)
      .toEqual([{ featureId: 'ori', keys: ['note'] }]);
  });
});
