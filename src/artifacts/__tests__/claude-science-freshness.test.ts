import { describe, expect, it } from 'vitest';
import type { ArtifactAnalysisResult } from '../claude-science-analysis-results';
import {
  createScientificFreshnessRecordIndex,
  evaluateAlignmentFreshness,
  evaluateAlignmentsFreshness,
  evaluateAnalysisResultFreshness,
  evaluateAnalysisResultsFreshness,
  evaluateWorkflowResultFreshness,
  evaluateWorkflowResultsFreshness,
  type ScientificFreshnessRecord,
} from '../claude-science-freshness';
import type { ArtifactAlignment } from '../claude-science-msa';
import { sha256HexSync } from '../claude-science-sha256';
import type { ArtifactWorkflowResult } from '../claude-science-workspace-collections';

const CREATED_AT = '2026-07-17T12:00:00.000Z';

function record(
  id: string,
  sequence: string,
  patch: Partial<ScientificFreshnessRecord> = {},
): ScientificFreshnessRecord {
  return {
    id,
    sequence,
    topology: 'linear',
    ...patch,
  };
}

function workflow(
  patch: Partial<ArtifactWorkflowResult> = {},
): ArtifactWorkflowResult {
  return {
    id: 'workflow-1',
    kind: 'gel',
    name: 'Saved workflow',
    inputRecordIds: ['record-a'],
    inputSha256s: [sha256HexSync('ACGT')],
    parameters: {},
    outputRecordIds: [],
    createdAt: CREATED_AT,
    provenance: { source: 'test' },
    ...patch,
  };
}

function analysis(
  patch: Partial<Extract<ArtifactAnalysisResult, { kind: 'report' }>> = {},
): Extract<ArtifactAnalysisResult, { kind: 'report' }> {
  return {
    id: 'analysis-1',
    kind: 'report',
    name: 'Saved analysis',
    status: 'complete',
    inputRecordIds: ['record-a'],
    inputSha256s: [sha256HexSync('ACGT')],
    dependsOnResultIds: [],
    assetIds: [],
    parameters: {},
    data: { format: 'plain', body: 'Review' },
    createdAt: CREATED_AT,
    provenance: { source: 'test' },
    ...patch,
  };
}

type ConstructVerificationResult = Extract<ArtifactAnalysisResult, { kind: 'construct_verification' }>;

const CONSTRUCT_SEQUENCES: Readonly<Record<string, string>> = {
  reference: 'ACGT',
  'read-1': 'ACG',
  'read-2': 'CGT',
};

function constructVerification(
  readRecordIds: string[] = ['read-1'],
  parameters: ConstructVerificationResult['parameters'] = { topology: 'linear' },
  id = 'verification-1',
): ConstructVerificationResult {
  return {
    id,
    kind: 'construct_verification',
    name: 'Construct verification',
    status: 'complete',
    inputRecordIds: ['reference', ...readRecordIds],
    inputSha256s: ['reference', ...readRecordIds].map((recordId) => sha256HexSync(CONSTRUCT_SEQUENCES[recordId])),
    dependsOnResultIds: [],
    assetIds: [],
    parameters,
    data: {
      referenceRecordId: 'reference',
      readRecordIds,
      state: 'consistent',
      referenceLength: 4,
      coveredBases: 4,
      coverageFraction: 1,
      mappedReadCount: readRecordIds.length,
      requiredRegionCount: 1,
      passingRegionCount: 1,
      observedVariantCount: 0,
      expectedVariantCount: 0,
      unexpectedVariantCount: 0,
      missingExpectedVariantCount: 0,
      reasonCodes: [],
    },
    createdAt: CREATED_AT,
    provenance: { source: 'test' },
  };
}

function alignment(
  rows: ArtifactAlignment['rows'],
  id = 'alignment-1',
): ArtifactAlignment {
  return {
    id,
    name: 'Saved alignment',
    molecule: 'dna',
    referenceRowId: rows[0]?.id ?? '',
    rows,
    engine: { id: 'imported', label: 'Imported', mode: 'imported' },
    consensus: 'ACGT',
    conserved: [true, true, true, true],
    gapOnly: [false, false, false, false],
    alignmentLength: 4,
    centerIdx: 2,
  };
}

describe('scientific freshness sequence attestations', () => {
  it('moves from fresh to stale after an edit and back to fresh after undo-equivalent restoration', () => {
    const saved = analysis({ inputSha256s: [sha256HexSync('ACGT').toUpperCase()] });
    const original = createScientificFreshnessRecordIndex([record('record-a', 'ACGT')]);
    const edited = createScientificFreshnessRecordIndex([record('record-a', 'ACGA')]);
    const restored = createScientificFreshnessRecordIndex([record('record-a', 'ACGT')]);

    expect(evaluateAnalysisResultFreshness(saved, original)).toEqual({
      state: 'fresh',
      reasons: [],
      affectedRecordIds: [],
    });
    expect(evaluateAnalysisResultFreshness(saved, edited)).toMatchObject({
      state: 'stale',
      reasons: [{ code: 'sequence_hash_mismatch', state: 'stale', recordId: 'record-a', field: 'sequence' }],
      affectedRecordIds: ['record-a'],
    });
    expect(evaluateAnalysisResultFreshness(saved, restored).state).toBe('fresh');
  });

  it('treats a missing input record as stale even when its saved hash is well formed', () => {
    const evaluation = evaluateWorkflowResultFreshness(workflow(), createScientificFreshnessRecordIndex([]));

    expect(evaluation.state).toBe('stale');
    expect(evaluation.reasons).toEqual([
      expect.objectContaining({ code: 'record_missing', state: 'stale', recordId: 'record-a' }),
    ]);
    expect(evaluation.affectedRecordIds).toEqual(['record-a']);
  });

  it('treats absent hashes as unverified rather than inventing provenance', () => {
    const evaluation = evaluateAnalysisResultFreshness(
      analysis({ inputSha256s: undefined }),
      createScientificFreshnessRecordIndex([record('record-a', 'ACGT')]),
    );

    expect(evaluation).toMatchObject({
      state: 'unverified',
      reasons: [{ code: 'sequence_attestation_missing', state: 'unverified', recordId: 'record-a' }],
      affectedRecordIds: ['record-a'],
    });
  });

  it('uses stale dominance while retaining mixed stale and unverified reasons', () => {
    const saved = workflow({
      inputRecordIds: ['record-a', 'record-b'],
      inputSha256s: [sha256HexSync('TTTT')],
    });
    const records = createScientificFreshnessRecordIndex([
      record('record-a', 'ACGT'),
      record('record-b', 'CCCC'),
    ]);

    const evaluation = evaluateWorkflowResultFreshness(saved, records);

    expect(evaluation.state).toBe('stale');
    expect(evaluation.reasons.map((entry) => [entry.code, entry.recordId])).toEqual([
      ['sequence_hash_mismatch', 'record-a'],
      ['sequence_attestation_missing', 'record-b'],
    ]);
    expect(evaluation.affectedRecordIds).toEqual(['record-a', 'record-b']);
  });
});

describe('scientific freshness context attestations', () => {
  it('detects a topology-only digest change with an unchanged sequence hash', () => {
    const saved = workflow({
      id: 'digest-1',
      kind: 'digest',
      parameters: { topology: 'circular', enzymes: ['EcoRI'] },
    });
    const circular = createScientificFreshnessRecordIndex([
      record('record-a', 'ACGT', { topology: 'circular' }),
    ]);
    const linear = createScientificFreshnessRecordIndex([
      record('record-a', 'ACGT', { topology: 'linear' }),
    ]);

    expect(evaluateWorkflowResultFreshness(saved, circular).state).toBe('fresh');
    expect(evaluateWorkflowResultFreshness(saved, linear)).toMatchObject({
      state: 'stale',
      reasons: [expect.objectContaining({
        code: 'topology_mismatch',
        recordId: 'record-a',
        expected: 'circular',
        actual: 'linear',
      })],
    });
  });

  it('leaves a legacy digest without topology provenance unverified', () => {
    const evaluation = evaluateWorkflowResultFreshness(
      workflow({ kind: 'digest', parameters: { enzymes: ['EcoRI'] } }),
      createScientificFreshnessRecordIndex([record('record-a', 'ACGT')]),
    );

    expect(evaluation).toMatchObject({
      state: 'unverified',
      reasons: [{ code: 'topology_attestation_missing', recordId: 'record-a' }],
    });
  });

  it('detects a construct-verification reference topology change without treating read topology as evidence', () => {
    const saved = constructVerification(['read-1'], {
      topology: 'circular',
      readEvidence: {
        schema: 'motif.construct-read-evidence.v1',
        sha256s: [sha256HexSync('trace-evidence-1')],
      },
    });
    const exact = createScientificFreshnessRecordIndex([
      record('reference', 'ACGT', { topology: 'circular' }),
      record('read-1', 'ACG', {
        topology: 'linear',
        sangerEvidenceSha256: sha256HexSync('trace-evidence-1'),
      }),
    ]);
    const changed = createScientificFreshnessRecordIndex([
      record('reference', 'ACGT', { topology: 'linear' }),
      record('read-1', 'ACG', {
        topology: 'circular',
        sangerEvidenceSha256: sha256HexSync('trace-evidence-1'),
      }),
    ]);

    expect(evaluateAnalysisResultFreshness(saved, exact).state).toBe('fresh');
    expect(evaluateAnalysisResultFreshness(saved, changed)).toMatchObject({
      state: 'stale',
      reasons: [expect.objectContaining({
        code: 'topology_mismatch',
        recordId: 'reference',
        expected: 'circular',
        actual: 'linear',
      })],
    });
  });

  it('leaves legacy construct verification without Sanger-evidence attestations unverified', () => {
    const saved = constructVerification(['read-1', 'read-2'], { topology: 'linear' }, 'verification-legacy');
    const records = createScientificFreshnessRecordIndex([
      record('reference', 'ACGT'),
      record('read-1', 'ACG', { sangerEvidenceSha256: sha256HexSync('trace-1') }),
      record('read-2', 'CGT', { sangerEvidenceSha256: sha256HexSync('trace-2') }),
    ]);

    expect(evaluateAnalysisResultFreshness(saved, records)).toMatchObject({
      state: 'unverified',
      reasons: [
        { code: 'sanger_evidence_attestation_missing', state: 'unverified', recordId: 'read-1', field: 'sanger_evidence' },
        { code: 'sanger_evidence_attestation_missing', state: 'unverified', recordId: 'read-2', field: 'sanger_evidence' },
      ],
      affectedRecordIds: ['read-1', 'read-2'],
    });
  });

  it('distinguishes malformed and count-misaligned saved Sanger-evidence attestations', () => {
    const base = constructVerification(
      ['read-1', 'read-2'],
      { topology: 'linear' },
      'verification-invalid-evidence',
    );
    const records = createScientificFreshnessRecordIndex([
      record('reference', 'ACGT'),
      record('read-1', 'ACG', { sangerEvidenceSha256: sha256HexSync('trace-1') }),
      record('read-2', 'CGT', { sangerEvidenceSha256: sha256HexSync('trace-2') }),
    ]);

    const malformed = evaluateAnalysisResultFreshness({
      ...base,
      parameters: {
        topology: 'linear',
        readEvidence: {
          schema: 'motif.construct-read-evidence.v1',
          sha256s: [sha256HexSync('trace-1'), 'not-a-sha'],
        },
      },
    }, records);
    expect(malformed).toMatchObject({
      state: 'unverified',
      reasons: [{ code: 'sanger_evidence_attestation_invalid', recordId: 'read-2' }],
      affectedRecordIds: ['read-2'],
    });

    const wrongSchema = evaluateAnalysisResultFreshness({
      ...base,
      parameters: {
        topology: 'linear',
        readEvidence: {
          schema: 'motif.construct-read-evidence.v0',
          sha256s: [sha256HexSync('trace-1'), sha256HexSync('trace-2')],
        },
      },
    }, records);
    expect(wrongSchema).toMatchObject({
      state: 'unverified',
      reasons: [
        { code: 'sanger_evidence_attestation_invalid', recordId: 'read-1' },
        { code: 'sanger_evidence_attestation_invalid', recordId: 'read-2' },
      ],
      affectedRecordIds: ['read-1', 'read-2'],
    });

    const misaligned = evaluateAnalysisResultFreshness({
      ...base,
      parameters: {
        topology: 'linear',
        readEvidence: {
          schema: 'motif.construct-read-evidence.v1',
          sha256s: [sha256HexSync('trace-1')],
        },
      },
    }, records);
    expect(misaligned).toMatchObject({
      state: 'unverified',
      reasons: [
        { code: 'sanger_evidence_attestation_misaligned', recordId: 'read-1' },
        { code: 'sanger_evidence_attestation_misaligned', recordId: 'read-2' },
      ],
      affectedRecordIds: ['read-1', 'read-2'],
    });
  });

  it('marks lost or changed current Sanger evidence stale with read-level attribution', () => {
    const evidenceSha256 = sha256HexSync('trace-evidence');
    const saved = constructVerification(['read-1'], {
      topology: 'linear',
      readEvidence: {
        schema: 'motif.construct-read-evidence.v1',
        sha256s: [evidenceSha256.toUpperCase()],
      },
    }, 'verification-stale-evidence');

    const missing = createScientificFreshnessRecordIndex([
      record('reference', 'ACGT'),
      record('read-1', 'ACG'),
    ]);
    expect(evaluateAnalysisResultFreshness(saved, missing)).toMatchObject({
      state: 'stale',
      reasons: [{ code: 'sanger_evidence_missing', state: 'stale', recordId: 'read-1' }],
      affectedRecordIds: ['read-1'],
    });

    const changed = createScientificFreshnessRecordIndex([
      record('reference', 'ACGT'),
      record('read-1', 'ACG', { sangerEvidenceSha256: sha256HexSync('changed-trace') }),
    ]);
    expect(evaluateAnalysisResultFreshness(saved, changed)).toMatchObject({
      state: 'stale',
      reasons: [{
        code: 'sanger_evidence_hash_mismatch',
        state: 'stale',
        recordId: 'read-1',
        expected: evidenceSha256,
        actual: sha256HexSync('changed-trace'),
      }],
      affectedRecordIds: ['read-1'],
    });

    const exact = createScientificFreshnessRecordIndex([
      record('reference', 'ACGT'),
      record('read-1', 'ACG', { sangerEvidenceSha256: evidenceSha256.toUpperCase() }),
    ]);
    expect(evaluateAnalysisResultFreshness(saved, exact).state).toBe('fresh');
  });

  it('keeps stale evidence loss dominant over another read\'s unverified attestation', () => {
    const saved = constructVerification(['read-1', 'read-2'], {
      topology: 'linear',
      readEvidence: {
        schema: 'motif.construct-read-evidence.v1',
        sha256s: [sha256HexSync('trace-1'), 'malformed'],
      },
    }, 'verification-mixed-evidence');
    const records = createScientificFreshnessRecordIndex([
      record('reference', 'ACGT'),
      record('read-1', 'ACG'),
      record('read-2', 'CGT', { sangerEvidenceSha256: sha256HexSync('trace-2') }),
    ]);

    expect(evaluateAnalysisResultFreshness(saved, records)).toMatchObject({
      state: 'stale',
      reasons: [
        { code: 'sanger_evidence_missing', state: 'stale', recordId: 'read-1' },
        { code: 'sanger_evidence_attestation_invalid', state: 'unverified', recordId: 'read-2' },
      ],
      affectedRecordIds: ['read-1', 'read-2'],
    });
  });

  it('checks saved ligation end chemistry independently of the sequence hash', () => {
    const saved = workflow({
      id: 'ligation-1',
      kind: 'ligation',
      inputRecordIds: ['left', 'right'],
      inputSha256s: [sha256HexSync('AAAA'), sha256HexSync('CCCC')],
      parameters: {
        topology: 'linear',
        orderedInputRecordIds: ['left', 'right'],
        terminalEnds: {
          left: { type: 'blunt', sequence: '' },
          right: { type: 'blunt', sequence: '' },
        },
        junctions: [{
          leftRecordId: 'left',
          rightRecordId: 'right',
          closing: false,
          leftEnd: { type: '5prime', sequence: 'CAGT' },
          rightEnd: { type: '5prime', sequence: 'ACTG' },
        }],
      },
    });
    const exactRecords = [
      record('left', 'AAAA', {
        overhang5: '',
        overhang5Type: 'blunt',
        overhang3: 'CAGT',
        overhang3Type: '5prime',
      }),
      record('right', 'CCCC', {
        overhang5: 'ACTG',
        overhang5Type: '5prime',
        overhang3: '',
        overhang3Type: 'blunt',
      }),
    ];

    expect(evaluateWorkflowResultFreshness(
      saved,
      createScientificFreshnessRecordIndex(exactRecords),
    ).state).toBe('fresh');

    const changedRecords = exactRecords.map((entry) => entry.id === 'right'
      ? { ...entry, overhang5Type: '3prime' as const }
      : entry);
    expect(evaluateWorkflowResultFreshness(
      saved,
      createScientificFreshnessRecordIndex(changedRecords),
    )).toMatchObject({
      state: 'stale',
      reasons: [expect.objectContaining({
        code: 'end_chemistry_mismatch',
        recordId: 'right',
        field: 'left_end',
      })],
    });

    const removedRecords = exactRecords.map((entry) => entry.id === 'right'
      ? { ...entry, overhang5: undefined, overhang5Type: undefined }
      : entry);
    expect(evaluateWorkflowResultFreshness(
      saved,
      createScientificFreshnessRecordIndex(removedRecords),
    )).toMatchObject({
      state: 'stale',
      reasons: [expect.objectContaining({
        code: 'end_chemistry_missing',
        state: 'stale',
        recordId: 'right',
        field: 'left_end',
        expected: '5prime:ACTG',
      })],
    });
  });
});

describe('alignment freshness', () => {
  it('evaluates every linked row and identifies the row carrying a stale source', () => {
    const saved = alignment([
      { id: 'row-a', name: 'Alpha', aligned: 'ACGT', identity: 1, sourceRecordId: 'record-a', inputSha256: sha256HexSync('ACGT') },
      { id: 'row-b', name: 'Beta', aligned: 'ACGA', identity: 0.75, sourceRecordId: 'record-b', inputSha256: sha256HexSync('ACGA') },
    ]);
    const exact = createScientificFreshnessRecordIndex([
      record('record-a', 'ACGT'),
      record('record-b', 'ACGA'),
    ]);
    const edited = createScientificFreshnessRecordIndex([
      record('record-a', 'ACGT'),
      record('record-b', 'ACGG'),
    ]);

    expect(evaluateAlignmentFreshness(saved, exact).state).toBe('fresh');
    expect(evaluateAlignmentFreshness(saved, edited)).toMatchObject({
      state: 'stale',
      reasons: [{ code: 'sequence_hash_mismatch', recordId: 'record-b', rowId: 'row-b' }],
      affectedRecordIds: ['record-b'],
    });
  });

  it('marks an imported row without a source id unverified and lets stale linked rows dominate', () => {
    const saved = alignment([
      { id: 'external', name: 'External', aligned: 'ACGT', identity: 1 },
      { id: 'linked', name: 'Linked', aligned: 'ACGT', identity: 1, sourceRecordId: 'missing', inputSha256: sha256HexSync('ACGT') },
    ]);

    const evaluation = evaluateAlignmentFreshness(saved, createScientificFreshnessRecordIndex([]));

    expect(evaluation.state).toBe('stale');
    expect(evaluation.reasons.map((entry) => [entry.code, entry.rowId])).toEqual([
      ['alignment_row_source_unattested', 'external'],
      ['record_missing', 'linked'],
    ]);
    expect(evaluation.affectedRecordIds).toEqual(['missing']);
  });
});

describe('freshness batches', () => {
  it('returns Maps keyed by result/alignment id while reusing one record index', () => {
    const records = createScientificFreshnessRecordIndex([record('record-a', 'ACGT')]);
    const savedWorkflow = workflow({ id: 'workflow-batch' });
    const savedAnalysis = analysis({ id: 'analysis-batch' });
    const savedAlignment = alignment([
      { id: 'row-a', name: 'Alpha', aligned: 'ACGT', identity: 1, sourceRecordId: 'record-a', inputSha256: sha256HexSync('ACGT') },
    ], 'alignment-batch');

    const workflows = evaluateWorkflowResultsFreshness([savedWorkflow], records);
    const analyses = evaluateAnalysisResultsFreshness([savedAnalysis], records);
    const alignments = evaluateAlignmentsFreshness([savedAlignment], records);

    expect(workflows).toBeInstanceOf(Map);
    expect(analyses).toBeInstanceOf(Map);
    expect(alignments).toBeInstanceOf(Map);
    expect(workflows.get('workflow-batch')?.state).toBe('fresh');
    expect(analyses.get('analysis-batch')?.state).toBe('fresh');
    expect(alignments.get('alignment-batch')?.state).toBe('fresh');
  });
});
