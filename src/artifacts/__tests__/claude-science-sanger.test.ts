import { describe, expect, it } from 'vitest';
import { SANGER_TRACE_SCHEMA, type SangerTraceData } from '../../bio/abi-import';
import { reverseComplement } from '../../bio/reverse-complement';
import type { ArtifactAlignment } from '../claude-science-msa';
import {
  createDefensiveRuntimeSnapshot,
  normalizeRecord,
  prepareArtifactDatabaseRestore,
  validateRuntimeRecordInputs,
} from '../motif-artifact';
import {
  hasLinkedSangerTrace,
  traceCenteredScrollLeft,
  traceFitCellWidth,
} from '../ClaudeScienceSangerTraceViewer';
import {
  artifactSangerTraceSampleEntries,
  normalizeArtifactSangerTrace,
  preferredTraceOrientation,
  sangerQualitySummary,
  traceOrientationForAlignedRow,
} from '../claude-science-sanger';

function trace(overrides: Partial<SangerTraceData> = {}): SangerTraceData {
  const baseCalls = overrides.baseCalls ?? 'ACGT';
  return {
    schema: SANGER_TRACE_SCHEMA,
    version: 1,
    baseCalls,
    sequence: overrides.sequence ?? baseCalls,
    qualityScores: overrides.qualityScores ?? [12, 24, 36, 48],
    peakPositions: overrides.peakPositions ?? [1, 3, 5, 7],
    channels: overrides.channels ?? {
      A: [0, 12, 5, 1, 0, 0, 0, 0],
      C: [0, 0, 2, 14, 4, 0, 0, 0],
      G: [0, 0, 0, 0, 2, 16, 3, 0],
      T: [0, 0, 0, 0, 0, 1, 4, 18],
    },
    sampleCount: overrides.sampleCount ?? 8,
    dyeOrder: overrides.dyeOrder ?? 'GATC',
    storedReverseComplement: overrides.storedReverseComplement ?? false,
    warnings: overrides.warnings ?? [],
    metadata: overrides.metadata ?? {
      format: 'ABIF',
      abifVersion: 101,
      baseCallsTag: 'PBAS2',
      qualityScoresTag: 'PCON2',
      peakPositionsTag: 'PLOC2',
      channelTags: { A: 'DATA10', C: 'DATA12', G: 'DATA9', T: 'DATA11' },
      sampleName: 'read-01',
    },
  };
}

describe('Claude Science Sanger trace contract', () => {
  it('fits the complete alignment and preserves the same viewport center across zoom widths', () => {
    expect(traceFitCellWidth(720, 1_440)).toBe(0.5);
    expect(traceFitCellWidth(720, 20)).toBe(12);
    expect(traceCenteredScrollLeft(40, 20, 200, 100)).toBe(700);
    expect(traceCenteredScrollLeft(99, 20, 200, 100)).toBe(1_800);
  });

  it('does not attach a chromatogram through an ambiguous record-name fallback', () => {
    const alignment: ArtifactAlignment = {
      id: 'external-alignment',
      name: 'External alignment',
      molecule: 'dna',
      referenceRowId: 'external-row',
      rows: [{ id: 'external-row', name: 'duplicate-read', aligned: 'ACGT', identity: 100 }],
      engine: { id: 'imported', label: 'Imported alignment', mode: 'imported' },
      consensus: 'ACGT',
      conserved: [true, true, true, true],
      gapOnly: [false, false, false, false],
      alignmentLength: 4,
      centerIdx: 2,
    };
    const duplicateRecords = [
      { id: 'read-one', name: 'duplicate-read', sangerTrace: trace() },
      { id: 'read-two', name: 'duplicate-read', sangerTrace: trace() },
    ];

    expect(hasLinkedSangerTrace(alignment, duplicateRecords)).toBe(false);
    expect(hasLinkedSangerTrace(alignment, [
      duplicateRecords[0],
      { id: 'read-other-calls', name: 'duplicate-read', sangerTrace: trace({ baseCalls: 'TTTT', sequence: 'TTTT' }) },
    ])).toBe(true);
    expect(hasLinkedSangerTrace(alignment, [
      { id: 'external-row', name: 'different-name', sangerTrace: trace() },
    ])).toBe(false);
    expect(hasLinkedSangerTrace({
      ...alignment,
      rows: [{ ...alignment.rows[0], sourceRecordId: 'read-two' }],
    }, duplicateRecords)).toBe(true);
  });

  it('normalizes a bounded trace and retains it on the owning artifact record', () => {
    const input = trace();
    const normalized = normalizeArtifactSangerTrace(input, 'ACGT');
    expect(normalized).not.toBe(input);
    expect(normalized.channels.A).toEqual(input.channels.A);
    expect(artifactSangerTraceSampleEntries(normalized)).toBe(32);
    expect(normalizeRecord({ id: 'read-01', molecule: 'dna', seq: 'ACGT', sangerTrace: input }, 0)?.sangerTrace)
      .toEqual(normalized);
  });

  it('round-trips channels and quality through the Database JSON record shape', () => {
    const record = normalizeRecord({ id: 'read-01', molecule: 'dna', seq: 'ACGT', sangerTrace: trace() }, 0);
    expect(record).not.toBeNull();
    const databaseRecords = createDefensiveRuntimeSnapshot([record!]);
    expect(databaseRecords[0].sangerTrace?.channels.G).toEqual(trace().channels.G);
    const databaseJson = JSON.parse(JSON.stringify({ records: databaseRecords })) as Record<string, unknown>;
    const restored = prepareArtifactDatabaseRestore(databaseJson);
    expect(restored.payload.records[0].sangerTrace?.qualityScores).toEqual([12, 24, 36, 48]);
  });

  it('keeps usable calls when optional AB1 arrays are incomplete and makes the damage explicit', () => {
    const normalized = normalizeArtifactSangerTrace(trace({ qualityScores: [30, 31], peakPositions: [1, 3, 5] }), 'ACGT');
    expect(normalized.qualityScores).toEqual([30, 31]);
    expect(normalized.warnings).toContain('Quality-score count (2) does not match base-call count (4).');
    expect(normalized.warnings).toContain('Peak-position count (3) does not match base-call count (4).');
  });

  it('rejects detached calls transactionally', () => {
    expect(() => validateRuntimeRecordInputs([{
      id: 'wrong-owner',
      molecule: 'dna',
      seq: 'AAAA',
      sangerTrace: trace(),
    }], 'motifAddRecords')).toThrow(/rejected 1 invalid record/i);
  });

  it('accepts chromatograms only on DNA records across validation and normalization', () => {
    for (const molecule of ['rna', 'protein'] as const) {
      const sequence = molecule === 'rna' ? 'ACGU' : 'ACGT';
      expect(() => validateRuntimeRecordInputs([{
        id: `wrong-${molecule}`,
        molecule,
        seq: sequence,
        sangerTrace: trace(),
      }], 'motifAddRecords')).toThrow(/No records were added/i);
      expect(() => normalizeRecord({
        id: `wrong-${molecule}`,
        molecule,
        seq: sequence,
        sangerTrace: trace(),
      }, 0)).toThrow(/sangerTrace is only valid on DNA records/i);
    }
  });

  it('uses the dedicated trace budget instead of misclassifying channel samples as arbitrary metadata nodes', () => {
    const channel = Array.from({ length: 63_000 }, (_value, index) => index % 200);
    const input = trace({
      baseCalls: 'A',
      sequence: 'A',
      qualityScores: [35],
      peakPositions: [10],
      channels: { A: channel, C: channel, G: channel, T: channel },
      sampleCount: channel.length,
    });
    expect(() => validateRuntimeRecordInputs([{
      id: 'large-valid-trace',
      molecule: 'dna',
      seq: 'A',
      sangerTrace: input,
    }], 'motifAddRecords')).not.toThrow();
  });

  it('detects forward and reverse alignment orientation without trusting RevC1', () => {
    const input = trace({ baseCalls: 'ACGA', sequence: 'ACGA', storedReverseComplement: true });
    expect(traceOrientationForAlignedRow(input, 'A-CGA')).toBe('forward');
    expect(traceOrientationForAlignedRow(input, `${reverseComplement(input.baseCalls)}--`)).toBe('reverse');
    expect(traceOrientationForAlignedRow(input, 'AAAA')).toBe('unlinked');
  });

  it('seeds reverse-primer AB1 orientation against the chosen template before local MSA', () => {
    const template = 'AACCGTTAACGATCGGATCCTAGGCTAATCG';
    const forwardRead = template.slice(4, 28);
    const reverseRead = reverseComplement(forwardRead);
    expect(preferredTraceOrientation(forwardRead, template).orientation).toBe('forward');
    expect(preferredTraceOrientation(reverseRead, template).orientation).toBe('reverse');
  });

  it('summarizes quality without inventing values when PCON is absent', () => {
    expect(sangerQualitySummary(trace())).toEqual({ mean: 30, q20Percent: 75 });
    expect(sangerQualitySummary(trace({ qualityScores: [] }))).toEqual({ mean: 0, q20Percent: 0 });
  });
});
