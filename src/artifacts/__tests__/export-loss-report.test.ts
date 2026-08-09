import { describe, expect, it } from 'vitest';
import { buildArtifactExportLossReport, buildArtifactExportLossReportForRecords, normalizeRecord } from '../motif-artifact';

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
