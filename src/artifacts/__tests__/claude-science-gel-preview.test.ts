import { describe, expect, it } from 'vitest';
import { normalizeArtifactWorkflowResults } from '../claude-science-workspace-collections';
import {
  ARTIFACT_GEL_MAX_AGAROSE_PERCENT,
  ARTIFACT_GEL_MIN_AGAROSE_PERCENT,
  ARTIFACT_GEL_QUALITATIVE_CAVEAT,
  MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE,
  MAX_ARTIFACT_GEL_SAMPLE_LANES,
  MAX_ARTIFACT_GEL_TOTAL_FRAGMENTS,
  artifactGelMigrationPosition,
  buildArtifactGelPreview,
  getArtifactGelLadderSizes,
  type BuildArtifactGelPreviewInput,
} from '../claude-science-gel-preview';

const SHA_PUC19 = 'a'.repeat(64);
const SHA_LINEAR_CONTROL = 'b'.repeat(64);

function previewInput(
  patch: Partial<BuildArtifactGelPreviewInput> = {},
): BuildArtifactGelPreviewInput {
  return {
    workflowResultId: 'gel-result-1',
    workflowName: 'EcoRI digest gel',
    createdAt: '2026-07-12T20:00:00.000Z',
    ladderPreset: '1kb',
    agarosePercent: 1,
    lanes: [{
      id: 'lane-digest-1',
      label: 'pUC19 · EcoRI',
      sourceKind: 'digest',
      recordId: 'puc19',
      recordSha256: SHA_PUC19,
      sequenceType: 'dna',
      sourceTopology: 'circular',
      sourceLengthBp: 5_010,
      fragmentLengthsBp: [3_000, 1_010, 500, 500],
      digestWorkflowResultId: 'digest-result-1',
    }, {
      id: 'lane-linear-1',
      label: 'Linear control',
      sourceKind: 'linear-record',
      recordId: 'linear-control',
      recordSha256: SHA_LINEAR_CONTROL,
      sequenceType: 'dna',
      topology: 'linear',
      lengthBp: 2_000,
    }],
    provenance: {
      source: 'user',
      actor: 'test-user',
      parentIds: ['selection-1'],
      metadata: { surface: 'artifact' },
    },
    ...patch,
  };
}

describe('artifact gel ladder presets', () => {
  it('provides descending 1 kb and 100 bp ladders as defensive copies', () => {
    const oneKb = getArtifactGelLadderSizes('1kb');
    const hundredBp = getArtifactGelLadderSizes('100bp');

    expect(oneKb).toEqual([10_000, 8_000, 6_000, 5_000, 4_000, 3_000, 2_000, 1_500, 1_000, 750, 500, 250]);
    expect(hundredBp).toEqual([1_500, 1_000, 900, 800, 700, 600, 500, 400, 300, 200, 100]);
    expect(oneKb.every((size, index) => index === 0 || oneKb[index - 1] > size)).toBe(true);
    expect(hundredBp.every((size, index) => index === 0 || hundredBp[index - 1] > size)).toBe(true);

    oneKb[0] = 1;
    expect(getArtifactGelLadderSizes('1kb')[0]).toBe(10_000);
  });

  it('rejects an unknown ladder at runtime', () => {
    expect(() => getArtifactGelLadderSizes('vendor-x' as '1kb')).toThrow(/ladderPreset/i);
  });
});

describe('artifact qualitative migration', () => {
  it('is monotonic: smaller fragments render farther from the wells', () => {
    for (const agarosePercent of [0.8, 1.25, 2]) {
      const positions = [10_000, 3_000, 1_000, 500, 100]
        .map((size) => artifactGelMigrationPosition(size, agarosePercent));
      expect(positions.every((position, index) => index === 0 || positions[index - 1] < position)).toBe(true);
      positions.forEach((position) => {
        expect(position).toBeGreaterThanOrEqual(0);
        expect(position).toBeLessThanOrEqual(1);
      });
    }
  });

  it('interpolates continuously between the shared engine calibrations', () => {
    const atOne = artifactGelMigrationPosition(750, 1);
    const atOneQuarter = artifactGelMigrationPosition(750, 1.25);
    const atOneHalf = artifactGelMigrationPosition(750, 1.5);
    expect(atOneQuarter).toBeCloseTo((atOne + atOneHalf) / 2, 3);
  });

  it('enforces agarose and fragment-size bounds', () => {
    expect(() => artifactGelMigrationPosition(500, ARTIFACT_GEL_MIN_AGAROSE_PERCENT - 0.01)).toThrow(/between/i);
    expect(() => artifactGelMigrationPosition(500, ARTIFACT_GEL_MAX_AGAROSE_PERCENT + 0.01)).toThrow(/between/i);
    expect(() => artifactGelMigrationPosition(500, Number.NaN)).toThrow(/between/i);
    expect(() => artifactGelMigrationPosition(0, 1)).toThrow(/positive whole number/i);
    expect(() => artifactGelMigrationPosition(10.5, 1)).toThrow(/positive whole number/i);
  });
});

describe('buildArtifactGelPreview', () => {
  it('builds labelled ladder, digest, and linear-record lanes with durable provenance', () => {
    const preview = buildArtifactGelPreview(previewInput());

    expect(preview.qualitativeOnly).toBe(true);
    expect(preview.caveat).toBe(ARTIFACT_GEL_QUALITATIVE_CAVEAT);
    expect(preview.lanes.map((lane) => [lane.laneIndex, lane.label, lane.sourceKind])).toEqual([
      [0, '1 kb ladder', 'ladder'],
      [1, 'pUC19 · EcoRI', 'digest'],
      [2, 'Linear control', 'linear-record'],
    ]);
    expect(preview.sampleLaneCount).toBe(2);
    expect(preview.sampleFragmentCount).toBe(5);
    expect(preview.workflowResult).toMatchObject({
      id: 'gel-result-1',
      kind: 'gel',
      name: 'EcoRI digest gel',
      inputRecordIds: ['puc19', 'linear-control'],
      inputSha256s: [SHA_PUC19, SHA_LINEAR_CONTROL],
      outputRecordIds: [],
      createdAt: '2026-07-12T20:00:00.000Z',
      provenance: {
        source: 'user',
        actor: 'test-user',
        operation: 'gel_preview',
        engine: 'artifact-qualitative-gel',
        engineVersion: '1',
        parentIds: ['selection-1', 'digest-result-1'],
      },
    });
    expect(preview.workflowResult.parameters).toMatchObject({
      agarosePercent: 1,
      ladderPreset: '1kb',
      qualitativeOnly: true,
    });
    expect(preview.workflowResult.result).toMatchObject({
      qualitativeOnly: true,
      sampleLaneCount: 2,
      sampleFragmentCount: 5,
    });
    expect(normalizeArtifactWorkflowResults([preview.workflowResult])).toEqual([preview.workflowResult]);
  });

  it('omits partial hashes for legacy callers and rejects conflicting hashes for one record', () => {
    const lanes = previewInput().lanes;
    const partial = buildArtifactGelPreview(previewInput({
      lanes: [lanes[0], { ...lanes[1], recordSha256: undefined }],
    }));
    expect(partial.workflowResult.inputSha256s).toBeUndefined();

    expect(() => buildArtifactGelPreview(previewInput({
      lanes: [
        lanes[0],
        {
          ...lanes[1],
          id: 'same-record-different-hash',
          recordId: 'puc19',
          recordSha256: 'c'.repeat(64),
        },
      ],
    }))).toThrow(/conflicting SHA-256.*puc19/i);
  });

  it('normalizes valid hash casing and rejects malformed lane hashes', () => {
    const lane = previewInput().lanes[1];
    const preview = buildArtifactGelPreview(previewInput({
      lanes: [{ ...lane, recordSha256: SHA_LINEAR_CONTROL.toUpperCase() }],
    }));
    expect(preview.workflowResult.inputSha256s).toEqual([SHA_LINEAR_CONTROL]);

    expect(() => buildArtifactGelPreview(previewInput({
      lanes: [{ ...lane, recordSha256: 'not-a-digest' }],
    }))).toThrow(/recordSha256.*64-character SHA-256/i);
  });

  it('coalesces duplicate and nearby fragments and increases only qualitative rendering intensity', () => {
    const preview = buildArtifactGelPreview(previewInput({
      lanes: [{
        id: 'lane-close',
        label: 'Close fragments',
        sourceKind: 'digest',
        recordId: 'record-close',
        sequenceType: 'dna',
        sourceTopology: 'linear',
        sourceLengthBp: 4_010,
        fragmentLengthsBp: [1_000, 1_000, 1_010, 1_000],
        digestWorkflowResultId: 'digest-close',
      }],
    }));
    const lane = preview.lanes[1];

    expect(lane.fragmentCount).toBe(4);
    expect(lane.bands).toHaveLength(1);
    expect(lane.bands[0]).toMatchObject({
      fragmentCount: 4,
      coMigrating: true,
      relativeIntensity: 1,
      intensityLabel: 'co-migrating',
    });
    expect(lane.bands[0].fragmentSizesBp).toEqual([1_010, 1_000, 1_000, 1_000]);
    expect(preview.caveat).toMatch(/do not predict.*DNA mass/i);
  });

  it('does not mutate caller-owned lane or provenance data', () => {
    const input = previewInput();
    const preview = buildArtifactGelPreview(input);
    const digest = input.lanes[0];
    if (digest.sourceKind !== 'digest') throw new Error('fixture');
    (digest.fragmentLengthsBp as number[])[0] = 1;
    if (input.provenance.parentIds) input.provenance.parentIds[0] = 'mutated';
    if (input.provenance.metadata) input.provenance.metadata.surface = 'mutated';

    expect(preview.lanes[1].bands.some((band) => band.fragmentSizesBp.includes(3_000))).toBe(true);
    expect(preview.workflowResult.provenance.parentIds).toEqual(['selection-1', 'digest-result-1']);
    expect(preview.workflowResult.provenance.metadata).toEqual({ surface: 'artifact' });
  });

  it('rejects non-DNA, circular-record, invalid-size, and inconsistent digest lanes', () => {
    const baseLane = previewInput().lanes[0];
    if (baseLane.sourceKind !== 'digest') throw new Error('fixture');
    expect(() => buildArtifactGelPreview(previewInput({
      lanes: [{ ...baseLane, sequenceType: 'rna' }],
    }))).toThrow(/must be "dna"/i);
    expect(() => buildArtifactGelPreview(previewInput({
      lanes: [{
        id: 'circular-record',
        label: 'Circular record',
        sourceKind: 'linear-record',
        recordId: 'circular',
        sequenceType: 'dna',
        topology: 'circular',
        lengthBp: 1_000,
      }],
    }))).toThrow(/conformation-dependent mobility/i);
    expect(() => buildArtifactGelPreview(previewInput({
      lanes: [{ ...baseLane, fragmentLengthsBp: [3_000, 0, 2_010] }],
    }))).toThrow(/positive whole number/i);
    expect(() => buildArtifactGelPreview(previewInput({
      lanes: [{ ...baseLane, fragmentLengthsBp: [3_000, 1_000] }],
    }))).toThrow(/total 4,000 bp.*5,010 bp/i);
  });

  it('requires caller ids and timestamps and rejects duplicate lane ids', () => {
    expect(() => buildArtifactGelPreview(previewInput({ workflowResultId: ' ' }))).toThrow(/workflowResultId/i);
    expect(() => buildArtifactGelPreview(previewInput({ createdAt: 'today' }))).toThrow(/ISO 8601/i);
    expect(() => buildArtifactGelPreview(previewInput({
      provenance: undefined as unknown as BuildArtifactGelPreviewInput['provenance'],
    }))).toThrow(/provenance/i);
    const lane = previewInput().lanes[1];
    expect(() => buildArtifactGelPreview(previewInput({
      lanes: [lane, { ...lane }],
    }))).toThrow(/duplicate id/i);
  });

  it('enforces bounded lane and fragment cardinality', () => {
    expect(() => buildArtifactGelPreview(previewInput({ lanes: [] }))).toThrow(/at least one/i);
    const recordLane = previewInput().lanes[1];
    expect(() => buildArtifactGelPreview(previewInput({
      lanes: Array.from({ length: MAX_ARTIFACT_GEL_SAMPLE_LANES + 1 }, (_, index) => ({
        ...recordLane,
        id: `lane-${index}`,
        recordId: `record-${index}`,
      })),
    }))).toThrow(/sample lanes/i);

    const fragmentLengthsBp = Array.from({ length: MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE + 1 }, () => 1);
    expect(() => buildArtifactGelPreview(previewInput({
      lanes: [{
        id: 'too-many-fragments',
        label: 'Too many fragments',
        sourceKind: 'digest',
        recordId: 'record-many',
        sequenceType: 'dna',
        sourceTopology: 'linear',
        sourceLengthBp: fragmentLengthsBp.length,
        fragmentLengthsBp,
        digestWorkflowResultId: 'digest-many',
      }],
    }))).toThrow(/more than 256 fragments/i);

    const laneCount = Math.ceil(MAX_ARTIFACT_GEL_TOTAL_FRAGMENTS / MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE) + 1;
    expect(() => buildArtifactGelPreview(previewInput({
      lanes: Array.from({ length: laneCount }, (_, laneIndex) => ({
        id: `dense-lane-${laneIndex}`,
        label: `Dense lane ${laneIndex + 1}`,
        sourceKind: 'digest' as const,
        recordId: `dense-record-${laneIndex}`,
        sequenceType: 'dna' as const,
        sourceTopology: 'linear' as const,
        sourceLengthBp: MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE,
        fragmentLengthsBp: Array.from({ length: MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE }, () => 1),
        digestWorkflowResultId: `dense-digest-${laneIndex}`,
      })),
    }))).toThrow(/fragments in total/i);
  });
});
