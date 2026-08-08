import { describe, expect, it } from 'vitest';
import { buildArtifactExportLossReport, normalizeRecord } from '../motif-artifact';

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

    expect(buildArtifactExportLossReport(record, 'record-json')).toMatchObject({ faithful: true, lossy: false });
    expect(buildArtifactExportLossReport(record, 'zip')).toMatchObject({ faithful: true, lossy: false });
    expect(buildArtifactExportLossReport(record, 'genbank').summary).toMatch(/does not claim full INSDC round-trip|lossy/i);
  });
});
