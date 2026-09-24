import { describe, expect, it } from 'vitest';
import {
  carryGoldenGatePartFeatures,
  carryLigationPartFeatures,
  carryOverlapPartFeatures,
  createArtifactAssemblyArtifacts,
  describeFeaturesLeftOut,
  featureOverlapsIntervals,
  getArtifactTypeIISEnzymeGeometry,
  planArtifactGoldenGateAssembly,
  planArtifactLigation,
  type ArtifactAssemblyArtifactOptions,
  type ArtifactGoldenGatePartInput,
  type ArtifactLigationPartInput,
} from '../claude-science-assembly-workflows';
import { sha256HexSync } from '../claude-science-sha256';
import { GOLDEN_GATE_FIDELITY_CONDITIONS } from '../../bio/golden-gate-fidelity';
import { reverseComplement } from '../../bio/reverse-complement';
import { materializeTranslationExceptions } from '../../bio/transl-except';

const SHA_A = sha256HexSync('AAAA');
const SHA_B = sha256HexSync('CCCC');

function ligationPart(
  recordId: string,
  sequence: string,
  ends: Pick<ArtifactLigationPartInput, 'leftEnd' | 'rightEnd'>,
): ArtifactLigationPartInput {
  return {
    recordId,
    name: recordId,
    sequence,
    molecule: 'dna',
    ...ends,
  };
}

function recordShapedLigationPart(
  recordId: string,
  sequence: string,
  ends: Pick<ArtifactLigationPartInput, 'overhang5' | 'overhang3' | 'overhang5Type' | 'overhang3Type'>,
): ArtifactLigationPartInput {
  return {
    recordId,
    name: recordId,
    sequence,
    molecule: 'dna',
    ...ends,
  };
}

function bsaIPart(
  recordId: string,
  leftOverhang: string,
  insert: string,
  rightOverhang: string,
): ArtifactGoldenGatePartInput {
  return {
    recordId,
    name: recordId,
    molecule: 'dna',
    sequence: `GGTCTCN${leftOverhang}${insert}${rightOverhang}NGAGACC`,
  };
}

function sapIPart(
  recordId: string,
  leftOverhang: string,
  insert: string,
  rightOverhang: string,
): ArtifactGoldenGatePartInput {
  return {
    recordId,
    name: recordId,
    molecule: 'dna',
    sequence: `GCTCTTCN${leftOverhang}${insert}${rightOverhang}NGAAGAGC`,
  };
}

describe('planArtifactLigation', () => {
  it('assembles ordered complementary 5-prime sticky ends into a linear product', () => {
    const first = ligationPart('left', 'AAAACCCC', {
      leftEnd: { type: 'blunt', sequence: '' },
      rightEnd: { type: '5prime', sequence: 'CAGT' },
    });
    const second = ligationPart('right', 'GGGGTTTT', {
      leftEnd: { type: '5prime', sequence: 'ACTG' },
      rightEnd: { type: 'blunt', sequence: '' },
    });

    const plan = planArtifactLigation({ parts: [first, second], topology: 'linear' });

    expect(plan.status).toBe('ready');
    expect(plan.productSequence).toBe('AAAACCCCGGGGTTTT');
    expect(plan.junctions).toEqual([
      expect.objectContaining({
        leftRecordId: 'left',
        rightRecordId: 'right',
        closing: false,
        type: 'sticky',
        compatible: true,
      }),
    ]);
    expect(plan.terminalEnds).toEqual({
      left: { type: 'blunt', sequence: '' },
      right: { type: 'blunt', sequence: '' },
    });
    expect(plan.errors).toEqual([]);
  });

  it('recognizes digest-shaped blunt ends but will not overclaim a unique ordered product', () => {
    const first = recordShapedLigationPart('digest-a', 'AAAA', {
      overhang5: '',
      overhang3: '',
    });
    const second = recordShapedLigationPart('digest-b', 'CCCC', {
      overhang5: '',
      overhang3: '',
    });

    const plan = planArtifactLigation({ parts: [first, second], topology: 'linear' });

    expect(plan.status).toBe('blocked');
    expect(plan.junctions[0]).toMatchObject({ type: 'blunt', compatible: true });
    expect(plan.productSequence).toBeNull();
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'ambiguous_blunt_ligation' }));
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'ligation_conditions_not_modeled' }));
  });

  it('treats absent record overhang fields as unknown rather than silently blunt', () => {
    const unknown = recordShapedLigationPart('unknown', 'AAAA', {
      overhang5: '',
      overhang3: undefined,
    });
    const blunt = recordShapedLigationPart('blunt', 'CCCC', {
      overhang5: '',
      overhang3: '',
    });

    const plan = planArtifactLigation({ parts: [unknown, blunt], topology: 'linear' });

    expect(plan.status).toBe('blocked');
    expect(plan.productSequence).toBeNull();
    expect(plan.errors.some((entry) => entry.code === 'unknown_end_metadata' && entry.recordId === 'unknown')).toBe(true);
    expect(plan.junctions[0].type).toBe('not_evaluable');
  });

  it('requires polarity for nonempty record-shaped sticky ends', () => {
    const first = recordShapedLigationPart('first', 'AAAA', {
      overhang5: '',
      overhang3: 'CAGT',
    });
    const second = recordShapedLigationPart('second', 'CCCC', {
      overhang5: 'ACTG',
      overhang3: '',
    });

    const plan = planArtifactLigation({ parts: [first, second], topology: 'linear' });

    expect(plan.status).toBe('blocked');
    expect(plan.errors.filter((entry) => entry.code === 'unknown_overhang_polarity')).toHaveLength(2);
  });

  it('accepts record-shaped sticky ends when digest polarity metadata is present', () => {
    const first = recordShapedLigationPart('first', 'AAAA', {
      overhang5: '',
      overhang3: 'CAGT',
      overhang3Type: '3prime',
    });
    const second = recordShapedLigationPart('second', 'CCCC', {
      overhang5: 'ACTG',
      overhang5Type: '3prime',
      overhang3: '',
    });

    const plan = planArtifactLigation({ parts: [first, second], topology: 'linear' });

    expect(plan.status).toBe('ready');
    expect(plan.junctions[0]).toMatchObject({ type: 'sticky', compatible: true });
  });

  it('blocks sequence-compatible sticky ends whose physical polarities differ', () => {
    const first = ligationPart('first', 'AAAA', {
      leftEnd: { type: 'blunt', sequence: '' },
      rightEnd: { type: '5prime', sequence: 'CAGT' },
    });
    const second = ligationPart('second', 'CCCC', {
      leftEnd: { type: '3prime', sequence: 'ACTG' },
      rightEnd: { type: 'blunt', sequence: '' },
    });

    const plan = planArtifactLigation({ parts: [first, second], topology: 'linear' });

    expect(plan.status).toBe('blocked');
    expect(plan.productSequence).toBeNull();
    expect(plan.junctions[0].reason).toContain('first leaves a 5′ overhang and second a 3′ overhang');
  });

  it('tells a reader with incompatible sticky ends what to change, in 5′/3′ terms', () => {
    const first = ligationPart('first', 'AAAA', {
      leftEnd: { type: '5prime', sequence: 'TTTT' },
      rightEnd: { type: '5prime', sequence: 'GATC' },
    });
    const second = ligationPart('second', 'CCCC', {
      leftEnd: { type: '5prime', sequence: 'AGCT' },
      rightEnd: { type: '5prime', sequence: 'CCCC' },
    });

    const plan = planArtifactLigation({ parts: [first, second], topology: 'linear' });

    expect(plan.status).toBe('blocked');
    const reasons = plan.junctions.map((junction) => junction.reason).join(' ');
    const messages = plan.errors.map((entry) => entry.message).join(' ');
    // Nothing a reader sees spells the stored end chemistry.
    expect(`${reasons} ${messages}`).not.toContain('prime');
    expect(reasons).toContain('first leaves 5′ GATC and second starts with 5′ AGCT, which cannot pair.');
    expect(reasons).toContain('Recut second to start with 5′ GATC');
    expect(reasons).toContain('blunt both ends and ligate blunt');
    expect(messages).toContain('no selected part starts with the matching 5′ GATC');
    // The codes stay machine-readable.
    expect(plan.errors.map((entry) => entry.code)).toContain('ambiguous_sticky_ligation');
  });

  it('names the part to move when the ends pair in a different order', () => {
    const first = ligationPart('first', 'AAAA', {
      leftEnd: { type: '5prime', sequence: 'TTTT' },
      rightEnd: { type: '5prime', sequence: 'GATC' },
    });
    const second = ligationPart('second', 'CCCC', {
      leftEnd: { type: '5prime', sequence: 'AAAA' },
      rightEnd: { type: '5prime', sequence: 'AAAA' },
    });
    const third = ligationPart('third', 'GGGG', {
      leftEnd: { type: '5prime', sequence: 'GATC' },
      rightEnd: { type: '5prime', sequence: 'TTTT' },
    });

    const plan = planArtifactLigation({ parts: [first, second, third], topology: 'circular' });

    const messages = plan.errors.map((entry) => entry.message);
    expect(messages.some((message) => (
      message.startsWith('first leaves 5′ GATC, which pairs with third rather than second.')
      && message.includes('Move that part to position 2')
    ))).toBe(true);
  });

  it('checks the closing junction before claiming a circular product', () => {
    const first = ligationPart('first', 'AAAA', {
      leftEnd: { type: '5prime', sequence: 'AGTC' },
      rightEnd: { type: '5prime', sequence: 'CAGT' },
    });
    const second = ligationPart('second', 'CCCC', {
      leftEnd: { type: '5prime', sequence: 'ACTG' },
      rightEnd: { type: '5prime', sequence: 'GACT' },
    });

    const ready = planArtifactLigation({ parts: [first, second], topology: 'circular' });
    const blocked = planArtifactLigation({
      parts: [first, { ...second, rightEnd: { type: '5prime', sequence: 'AAAA' } }],
      topology: 'circular',
    });

    expect(ready.status).toBe('ready');
    expect(ready.terminalEnds).toBeNull();
    expect(ready.junctions).toHaveLength(2);
    expect(ready.junctions[1]).toMatchObject({ closing: true, compatible: true });
    expect(blocked.status).toBe('blocked');
    expect(blocked.productSequence).toBeNull();
    expect(blocked.junctions[1]).toMatchObject({ closing: true, compatible: false });
  });

  it('blocks reused cohesive ends that do not uniquely encode the intended order', () => {
    const first = ligationPart('first', 'AAAA', {
      leftEnd: { type: 'blunt', sequence: '' },
      rightEnd: { type: '5prime', sequence: 'CAGT' },
    });
    const second = ligationPart('second', 'CCCC', {
      leftEnd: { type: '5prime', sequence: 'ACTG' },
      rightEnd: { type: '5prime', sequence: 'CAGT' },
    });
    const competing = ligationPart('competing', 'GGGG', {
      leftEnd: { type: '5prime', sequence: 'ACTG' },
      rightEnd: { type: 'blunt', sequence: '' },
    });

    const plan = planArtifactLigation({ parts: [first, second, competing], topology: 'linear' });

    expect(plan.status).toBe('blocked');
    expect(plan.productSequence).toBeNull();
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'ambiguous_sticky_ligation' }));
  });

  it('rejects non-DNA, invalid overhang alphabets, and fewer than two parts explicitly', () => {
    const bad = {
      ...ligationPart('bad', 'AUGC', {
        leftEnd: { type: '5prime', sequence: 'NNNN' },
        rightEnd: { type: 'blunt', sequence: '' },
      }),
      molecule: 'rna',
    } as unknown as ArtifactLigationPartInput;

    const plan = planArtifactLigation({ parts: [bad], topology: 'linear' });

    expect(plan.status).toBe('blocked');
    expect(plan.productSequence).toBeNull();
    expect(plan.errors.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'too_few_parts',
      'not_dna',
      'invalid_dna_sequence',
    ]));
  });

  it('retains complete hashes and warns rather than inventing missing hash provenance', () => {
    const baseEnds = {
      leftEnd: { type: 'blunt', sequence: '' } as const,
      rightEnd: { type: 'blunt', sequence: '' } as const,
    };
    const complete = planArtifactLigation({
      parts: [
        { ...ligationPart('a', 'AAAA', baseEnds), sha256: SHA_A },
        { ...ligationPart('b', 'CCCC', baseEnds), sha256: SHA_B },
      ],
      topology: 'linear',
    });
    const partial = planArtifactLigation({
      parts: [
        { ...ligationPart('a', 'AAAA', baseEnds), sha256: SHA_A },
        ligationPart('b', 'CCCC', baseEnds),
      ],
      topology: 'linear',
    });

    expect(complete.inputSha256s).toEqual([SHA_A, SHA_B]);
    expect(partial.inputSha256s).toBeUndefined();
    expect(partial.warnings).toContainEqual(expect.objectContaining({ code: 'partial_input_hashes' }));
  });

  it('rejects a well-formed hash that does not match the ligation sequence', () => {
    const baseEnds = {
      leftEnd: { type: 'blunt', sequence: '' } as const,
      rightEnd: { type: 'blunt', sequence: '' } as const,
    };
    const plan = planArtifactLigation({
      parts: [
        { ...ligationPart('a', 'AAAA', baseEnds), sha256: sha256HexSync('TTTT') },
        { ...ligationPart('b', 'CCCC', baseEnds), sha256: SHA_B },
      ],
      topology: 'linear',
    });

    expect(plan.status).toBe('blocked');
    expect(plan.inputSha256s).toBeUndefined();
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'sha256_mismatch', recordId: 'a' }));
  });
});

describe('planArtifactGoldenGateAssembly', () => {
  it('rejects a well-formed hash that does not match the Type IIS source sequence', () => {
    const promoter = bsaIPart('promoter', 'AAAA', 'CCCC', 'GATG');
    const backbone = bsaIPart('backbone', 'GATG', 'GGGG', 'AAAA');
    const plan = planArtifactGoldenGateAssembly({
      parts: [
        { ...promoter, sha256: sha256HexSync('AAAA') },
        { ...backbone, sha256: sha256HexSync(backbone.sequence) },
      ],
      enzyme: 'BsaI',
      topology: 'circular',
    });

    expect(plan.status).toBe('blocked');
    expect(plan.inputSha256s).toBeUndefined();
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'sha256_mismatch', recordId: 'promoter' }));
  });

  it('reports exact BsaI recognition/cut geometry and creates an honest circular product', () => {
    const promoter = bsaIPart('promoter', 'AAAA', 'CCCC', 'GATG');
    const backbone = bsaIPart('backbone', 'GATG', 'GGGG', 'AAAA');

    const plan = planArtifactGoldenGateAssembly({
      parts: [promoter, backbone],
      enzyme: 'bsai',
      topology: 'circular',
    });

    expect(plan.status).toBe('ready');
    expect(plan.enzyme).toEqual({
      name: 'BsaI',
      recognitionSequence: 'GGTCTC',
      reverseRecognitionSequence: 'GAGACC',
      cutOffset: 7,
      complementCutOffset: 11,
      overhangType: '5prime',
      overhangLength: 4,
    });
    expect(plan.parts.map((part) => [part.leftOverhang, part.rightOverhang])).toEqual([
      ['AAAA', 'GATG'],
      ['GATG', 'AAAA'],
    ]);
    expect(plan.junctions).toHaveLength(2);
    expect(plan.junctions.every((junction) => junction.compatible)).toBe(true);
    expect(plan.productSequence).toBe('AAAACCCCGATGGGGG');
  });

  it('supports an honest ordered linear Golden Gate product without requiring closure', () => {
    const first = bsaIPart('first', 'AAAA', 'CCCC', 'GATG');
    const second = bsaIPart('second', 'GATG', 'GGGG', 'TGAG');

    const plan = planArtifactGoldenGateAssembly({
      parts: [first, second],
      enzyme: 'BsaI',
      topology: 'linear',
    });

    expect(plan.status).toBe('ready');
    expect(plan.junctions).toHaveLength(1);
    expect(plan.productSequence).toBe('AAAACCCCGATGGGGGTGAG');
    expect(plan.productSequence?.startsWith('AAAA')).toBe(true);
    expect(plan.productSequence?.endsWith('TGAG')).toBe(true);
  });

  it('requires circular Golden Gate donors to be linearized before bounded flank parsing', () => {
    const circular = { ...bsaIPart('circular', 'AAAA', 'CCCC', 'GATG'), sourceTopology: 'circular' as const };
    const linear = { ...bsaIPart('linear', 'GATG', 'GGGG', 'AAAA'), sourceTopology: 'linear' as const };

    const plan = planArtifactGoldenGateAssembly({
      parts: [circular, linear],
      enzyme: 'BsaI',
      topology: 'circular',
    });

    expect(plan.status).toBe('blocked');
    expect(plan.productSequence).toBeNull();
    expect(plan.errors).toContainEqual(expect.objectContaining({
      code: 'circular_source_requires_linearization',
      recordId: 'circular',
    }));
  });

  it('blocks an ordered fusion mismatch and never emits the tempting partial product', () => {
    const first = bsaIPart('first', 'AAAA', 'CCCC', 'GATG');
    const wrong = bsaIPart('wrong', 'TGAG', 'GGGG', 'AAAA');

    const plan = planArtifactGoldenGateAssembly({
      parts: [first, wrong],
      enzyme: 'BsaI',
      topology: 'circular',
    });

    expect(plan.status).toBe('blocked');
    expect(plan.productSequence).toBeNull();
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'incompatible_golden_gate_junction' }));
    expect(plan.junctions[0]).toMatchObject({ status: 'incompatible', compatible: false });
  });

  it('surfaces internal sites as a domestication warning and a blocking error', () => {
    const internal = bsaIPart('internal', 'AAAA', 'CCGGTCTCAA', 'GATG');
    const second = bsaIPart('second', 'GATG', 'GGGG', 'AAAA');

    const plan = planArtifactGoldenGateAssembly({
      parts: [internal, second],
      enzyme: 'BsaI',
      topology: 'circular',
    });

    expect(plan.status).toBe('blocked');
    expect(plan.productSequence).toBeNull();
    expect(plan.domesticationRequiredRecordIds).toEqual(['internal']);
    expect(plan.warnings).toContainEqual(expect.objectContaining({
      code: 'internal_type_iis_site',
      recordId: 'internal',
    }));
    expect(plan.errors).toContainEqual(expect.objectContaining({
      code: 'domestication_required',
      recordId: 'internal',
    }));
  });

  it('blocks missing inward-facing flanks and unsupported enzymes with actionable errors', () => {
    const bare: ArtifactGoldenGatePartInput = {
      recordId: 'bare',
      name: 'Bare insert',
      molecule: 'dna',
      sequence: 'ATGAAATTT',
    };
    const other = bsaIPart('other', 'AAAA', 'CCCC', 'AAAA');

    const missingFlanks = planArtifactGoldenGateAssembly({
      parts: [bare, other],
      enzyme: 'BsaI',
      topology: 'circular',
    });
    const unsupported = planArtifactGoldenGateAssembly({
      parts: [bare, other],
      enzyme: 'EcoRI',
      topology: 'circular',
    });

    expect(missingFlanks.status).toBe('blocked');
    expect(missingFlanks.productSequence).toBeNull();
    expect(missingFlanks.errors).toContainEqual(expect.objectContaining({
      code: 'invalid_type_iis_boundary',
      recordId: 'bare',
    }));
    expect(unsupported.enzyme).toBeNull();
    expect(unsupported.errors).toContainEqual(expect.objectContaining({ code: 'unsupported_type_iis_enzyme' }));
  });

  it('uses the 3-base SapI/BspQI geometry rather than assuming four-base fusion sites', () => {
    const first = sapIPart('first', 'AAA', 'CCCC', 'GGA');
    const second = sapIPart('second', 'GGA', 'GGGG', 'AAA');

    const plan = planArtifactGoldenGateAssembly({
      parts: [first, second],
      enzyme: 'SapI',
      topology: 'circular',
    });

    expect(getArtifactTypeIISEnzymeGeometry('BspQI')?.overhangLength).toBe(3);
    expect(plan.status).toBe('ready');
    expect(plan.enzyme?.overhangLength).toBe(3);
    expect(plan.productSequence).toBe('AAACCCCGGAGGGG');
  });

  it('warns about risky fusion sites and blocks a chemically ambiguous duplicate design', () => {
    const first = bsaIPart('first', 'AATT', 'CCCC', 'AATT');
    const second = bsaIPart('second', 'AATT', 'GGGG', 'AATT');

    const plan = planArtifactGoldenGateAssembly({
      parts: [first, second],
      enzyme: 'BsaI',
      topology: 'circular',
    });

    expect(plan.status).toBe('blocked');
    expect(plan.productSequence).toBeNull();
    expect(plan.warnings.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'duplicate_fusion_overhang',
      'palindromic_fusion_overhang',
    ]));
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'ambiguous_fusion_overhang' }));
  });

  it('records exact empirical condition provenance without borrowing across enzymes', () => {
    const first = bsaIPart('first', 'AAAA', 'CCCC', 'GATG');
    const second = bsaIPart('second', 'GATG', 'GGGG', 'AAAA');
    const condition = GOLDEN_GATE_FIDELITY_CONDITIONS['pryor-2020-bsai-hfv2'];
    const supported = planArtifactGoldenGateAssembly({
      parts: [first, second],
      enzyme: 'BsaI',
      topology: 'circular',
      fidelityCondition: condition,
    });

    expect(supported.fidelity).toMatchObject({
      status: 'supported',
      method: 'empirical',
      datasetId: 'pryor-2020-bsai-hfv2',
      provenance: { table: 'S1 Table', license: 'CC BY 4.0' },
    });
    expect(supported.fidelity.assembly.coverage).toBe(1);

    const borrowed = planArtifactGoldenGateAssembly({
      parts: [first, second],
      enzyme: 'BbsI',
      topology: 'circular',
      fidelityCondition: condition,
    });
    expect(borrowed.fidelity.status).toBe('unsupported');
    expect(borrowed.fidelity.assembly.estimatedFidelity).toBeNull();
  });
});

describe('createArtifactAssemblyArtifacts', () => {
  it('creates a portable workflow result and optional derived record with caller ids and time', () => {
    const promoter = bsaIPart('promoter', 'AAAA', 'CCCC', 'GATG');
    const backbone = bsaIPart('backbone', 'GATG', 'GGGG', 'AAAA');
    const promoterSha256 = sha256HexSync(promoter.sequence);
    const backboneSha256 = sha256HexSync(backbone.sequence);
    const plan = planArtifactGoldenGateAssembly({
      parts: [
        { ...promoter, sha256: promoterSha256 },
        { ...backbone, sha256: backboneSha256 },
      ],
      enzyme: 'BsaI',
      topology: 'circular',
    });
    const artifacts = createArtifactAssemblyArtifacts(plan, {
      workflowResultId: 'workflow-gg-1',
      createdAt: '2026-07-12T12:34:56.000Z',
      name: 'Promoter assembly',
      provenance: {
        source: 'claude-science',
        actor: 'test-user',
        engine: 'motif-artifact-planner',
        engineVersion: '1',
        metadata: { campaign: 'cloning' },
      },
      outputRecord: {
        id: 'assembled-plasmid',
        name: 'Assembled plasmid',
        description: 'Golden Gate product',
        group: 'Assembly results',
        tags: ['golden-gate', 'verified'],
      },
    });

    expect(artifacts.workflowResult).toMatchObject({
      id: 'workflow-gg-1',
      kind: 'golden_gate',
      inputRecordIds: ['promoter', 'backbone'],
      inputSha256s: [promoterSha256, backboneSha256],
      outputRecordIds: ['assembled-plasmid'],
      createdAt: '2026-07-12T12:34:56.000Z',
      provenance: {
        source: 'claude-science',
        operation: 'golden_gate',
        parentIds: ['promoter', 'backbone'],
      },
    });
    expect(artifacts.workflowResult.result).toMatchObject({
      status: 'ready',
      productLength: plan.productSequence?.length,
    });
    expect(artifacts.derivedRecord).toEqual(expect.objectContaining({
      id: 'assembled-plasmid',
      name: 'Assembled plasmid',
      sequence: plan.productSequence,
      molecule: 'dna',
      type: 'dna',
      topology: 'circular',
      length: plan.productSequence?.length,
      source: 'claude-science',
      dateAdded: '2026-07-12T12:34:56.000Z',
      tags: ['golden-gate', 'verified'],
      provenance: expect.objectContaining({
        workflowResultId: 'workflow-gg-1',
        parentRecordIds: ['promoter', 'backbone'],
      }),
    }));
  });

  it('records a blocked attempt but never claims or materializes an output record', () => {
    const blocked = planArtifactGoldenGateAssembly({
      parts: [
        bsaIPart('first', 'AAAA', 'CCCC', 'GATG'),
        bsaIPart('wrong', 'TGAG', 'GGGG', 'AAAA'),
      ],
      enzyme: 'BsaI',
      topology: 'circular',
    });
    const artifacts = createArtifactAssemblyArtifacts(blocked, {
      workflowResultId: 'blocked-workflow',
      createdAt: '2026-07-12T12:34:56.000Z',
      name: 'Blocked assembly',
      provenance: { source: 'claude-science' },
      outputRecord: { id: 'must-not-exist', name: 'Must not exist' },
    });

    expect(artifacts.workflowResult.outputRecordIds).toEqual([]);
    expect(artifacts.workflowResult.result).toMatchObject({ status: 'blocked', productLength: null });
    expect(artifacts.derivedRecord).toBeUndefined();
  });

  it('surfaces per-junction fidelity and source provenance in the portable receipt', () => {
    const plan = planArtifactGoldenGateAssembly({
      parts: [
        bsaIPart('first', 'AAAA', 'CCCC', 'GATG'),
        bsaIPart('second', 'GATG', 'GGGG', 'AAAA'),
      ],
      enzyme: 'BsaI',
      topology: 'circular',
      fidelityCondition: GOLDEN_GATE_FIDELITY_CONDITIONS['pryor-2020-bsai-hfv2'],
    });
    const artifacts = createArtifactAssemblyArtifacts(plan, {
      workflowResultId: 'fidelity-workflow',
      createdAt: '2026-07-12T12:34:56.000Z',
      name: 'Fidelity receipt',
      provenance: { source: 'claude-science' },
    });

    expect(artifacts.workflowResult.parameters).toMatchObject({
      fidelity: {
        datasetId: 'pryor-2020-bsai-hfv2',
        provenance: { sourceSha256: expect.stringMatching(/^[0-9a-f]{64}$/i) },
      },
    });
    expect(artifacts.workflowResult.result).toMatchObject({
      fidelity: {
        status: 'supported',
        junctions: expect.arrayContaining([
          expect.objectContaining({ estimatedFidelity: expect.any(Number), counts: expect.any(Object) }),
        ]),
        provenance: { table: 'S1 Table', license: 'CC BY 4.0' },
      },
    });
  });

  it('carries honest terminal overhang metadata onto a derived linear Golden Gate record', () => {
    const plan = planArtifactGoldenGateAssembly({
      parts: [
        bsaIPart('first', 'AAAA', 'CCCC', 'GATG'),
        bsaIPart('second', 'GATG', 'GGGG', 'TGAG'),
      ],
      enzyme: 'BsaI',
      topology: 'linear',
    });
    const artifacts = createArtifactAssemblyArtifacts(plan, {
      workflowResultId: 'linear-gg-workflow',
      createdAt: '2026-07-12T12:34:56.000Z',
      name: 'Linear Golden Gate product',
      provenance: { source: 'claude-science' },
      outputRecord: { id: 'linear-product', name: 'Linear product' },
    });

    expect(artifacts.derivedRecord).toMatchObject({
      overhang5: 'AAAA',
      overhang3: 'CTCA',
      overhang5Type: '5prime',
      overhang3Type: '5prime',
    });
  });

  it('preserves caller provenance fields and is deterministic without mutating inputs', () => {
    const plan = planArtifactLigation({
      parts: [
        ligationPart('a', 'AAAA', {
          leftEnd: { type: 'blunt', sequence: '' },
          rightEnd: { type: '5prime', sequence: 'CAGT' },
        }),
        ligationPart('b', 'CCCC', {
          leftEnd: { type: '5prime', sequence: 'ACTG' },
          rightEnd: { type: 'blunt', sequence: '' },
        }),
      ],
      topology: 'linear',
    });
    const options: ArtifactAssemblyArtifactOptions = {
      workflowResultId: 'ligation-workflow',
      createdAt: '2026-07-12T13:00:00.000Z',
      name: 'Traditional ligation',
      provenance: {
        source: 'imported-notebook',
        operation: 'caller-operation',
        parentIds: ['caller-parent'],
        metadata: { notebook: 'N-42' },
      },
      outputRecord: { id: 'ligation-product', name: 'Ligation product' },
    };
    const beforePlan = JSON.stringify(plan);
    const beforeOptions = JSON.stringify(options);

    const first = createArtifactAssemblyArtifacts(plan, options);
    const second = createArtifactAssemblyArtifacts(plan, options);

    expect(second).toEqual(first);
    expect(first.workflowResult.provenance).toMatchObject({
      source: 'imported-notebook',
      operation: 'caller-operation',
      parentIds: ['caller-parent'],
      metadata: { notebook: 'N-42' },
    });
    expect(first.derivedRecord).toMatchObject({
      overhang5: '',
      overhang3: '',
      overhang5Type: 'blunt',
      overhang3Type: 'blunt',
    });
    expect(JSON.stringify(plan)).toBe(beforePlan);
    expect(JSON.stringify(options)).toBe(beforeOptions);
  });

  it('rejects missing caller ids or timestamps instead of allocating hidden values', () => {
    const plan = planArtifactLigation({
      parts: [
        recordShapedLigationPart('a', 'AAAA', { overhang5: '', overhang3: '' }),
        recordShapedLigationPart('b', 'CCCC', { overhang5: '', overhang3: '' }),
      ],
      topology: 'linear',
    });

    expect(() => createArtifactAssemblyArtifacts(plan, {
      workflowResultId: '',
      createdAt: '2026-07-12T13:00:00.000Z',
      name: 'No id',
      provenance: { source: 'test' },
    })).toThrow(/workflowResultId/);
    expect(() => createArtifactAssemblyArtifacts(plan, {
      workflowResultId: 'workflow',
      createdAt: 'now',
      name: 'No timestamp',
      provenance: { source: 'test' },
    })).toThrow(/createdAt/);
  });
});

describe('carryLigationPartFeatures', () => {
  // pUC19 EcoRI-BamHI backbone (2,665 bp) + pBR322 EcoRI-BamHI insert (377 bp).
  // The product starts with the backbone, so its AmpR stays put and the
  // insert's features move by 2,665.
  type CarriedTestFeature = {
    id: string;
    name: string;
    start: number;
    end: number;
    strand: number;
    subRanges?: Array<{ start: number; end: number }>;
  };
  const backbone: { sequence: string; features: CarriedTestFeature[] } = {
    sequence: 'A'.repeat(2665),
    features: [
      { id: 'ampr', name: 'AmpR', start: 792, end: 1653, strand: -1 },
      { id: 'split', name: 'Split CDS', start: 10, end: 60, strand: 1, subRanges: [{ start: 10, end: 20 }, { start: 40, end: 60 }] },
    ],
  };
  const insert: { sequence: string; features: CarriedTestFeature[] } = {
    sequence: 'C'.repeat(377),
    features: [
      { id: 'tag', name: 'Insert tag', start: 5, end: 100, strand: 1 },
      { id: 'wrapped', name: 'Wrapped', start: 370, end: 4, strand: 1 },
    ],
  };

  it('shifts each part by the length of the parts before it', () => {
    const carried = carryLigationPartFeatures([backbone, insert], 3042);
    expect(carried.map((feature) => [feature.name, feature.start, feature.end, feature.strand])).toEqual([
      ['AmpR', 792, 1653, -1],
      ['Split CDS', 10, 60, 1],
      ['Insert tag', 2670, 2765, 1],
    ]);
    expect(carried[1].subRanges).toEqual([{ start: 10, end: 20 }, { start: 40, end: 60 }]);
  });

  it('shifts sub-ranges with their feature when the part is not first', () => {
    const carried = carryLigationPartFeatures([insert, backbone], 3042);
    expect(carried.map((feature) => [feature.name, feature.start, feature.end])).toEqual([
      ['Insert tag', 5, 100],
      ['AmpR', 1169, 2030],
      ['Split CDS', 387, 437],
    ]);
    expect(carried[2].subRanges).toEqual([{ start: 387, end: 397 }, { start: 417, end: 437 }]);
  });

  it('carries nothing when the parts do not add up to the product', () => {
    expect(carryLigationPartFeatures([backbone, insert], 3041)).toEqual([]);
  });
});

describe('carryOverlapPartFeatures', () => {
  // The product is two parts sharing a 4 bp overlap: part 1 covers bases 0-15
  // and part 2 starts at base 12.
  const product = 'ACCTGAATTCGGATCCTTAAGGCCATGC';
  const partOne = { sequence: product.slice(0, 16), features: [{ id: 'one', name: 'Left marker', start: 2, end: 8, strand: 1 }] };
  const partTwo = { sequence: product.slice(12), features: [{ id: 'two', name: 'Right marker', start: 3, end: 9, strand: -1 }] };

  it('shifts each part by where its own bases sit in the product', () => {
    expect(carryOverlapPartFeatures([partOne, partTwo], product)
      .map((feature) => [feature.name, feature.start, feature.end])).toEqual([
      ['Left marker', 2, 8],
      ['Right marker', 15, 21],
    ]);
  });

  it('flips the features of a part used reverse-complemented onto its flipped bases', () => {
    // The record holds part 2 reversed, so the design flips it back: record
    // base i sits at product 12 + 15 - i. Sub-ranges stay in biological order.
    const flipped = carryOverlapPartFeatures([{
      sequence: reverseComplement(partTwo.sequence),
      orientation: 'reverse' as const,
      features: [
        { id: 'f', name: 'Forward on record', start: 1, end: 5, strand: 1 },
        { id: 's', name: 'Split', start: 2, end: 14, strand: -1, subRanges: [{ start: 10, end: 14, strand: -1 }, { start: 2, end: 6 }] },
        { id: 'd', name: 'Directionless', start: 0, end: 16, strand: 0 },
      ],
    }], product);
    expect(flipped).toEqual([
      { id: 'f', name: 'Forward on record', start: 23, end: 27, strand: -1 },
      { id: 's', name: 'Split', start: 14, end: 26, strand: 1, subRanges: [{ start: 14, end: 18, strand: 1 }, { start: 22, end: 26 }] },
      { id: 'd', name: 'Directionless', start: 12, end: 28, strand: 0 },
    ]);
    // The carried reverse feature reads the record's forward bases.
    expect(reverseComplement(product.slice(23, 27))).toBe(reverseComplement(partTwo.sequence).slice(1, 5));
    // Used forward, the reversed record's bases are not in the product.
    expect(carryOverlapPartFeatures([{ sequence: reverseComplement(partTwo.sequence), features: partTwo.features }], product)).toEqual([]);
  });

  it('carries nothing for a part that is absent or not unique', () => {
    expect(carryOverlapPartFeatures([{ sequence: 'GGGGGGGG', features: partOne.features }], product)).toEqual([]);
    expect(carryOverlapPartFeatures([{ sequence: 'AA', features: [{ id: 'x', name: 'Ambiguous', start: 0, end: 2, strand: 1 }] }], product)).toEqual([]);
  });

  it('leaves out keys whose value is undefined, so the product still validates as JSON', () => {
    const carried = carryOverlapPartFeatures([{
      sequence: partOne.sequence,
      features: [{ id: 'one', name: 'Left marker', start: 2, end: 8, strand: 1, subRanges: undefined }],
    }], product);
    expect(carried).toHaveLength(1);
    expect(Object.keys(carried[0])).not.toContain('subRanges');
  });
});

describe('carryGoldenGatePartFeatures', () => {
  // Three BsaI parts, GGTCTCN <overhang> <body> <overhang> NGAGACC. Each part
  // keeps bases 7..45; the released pieces share a 4 bp overhang, so the parts
  // land at 0, 34 and 68, and a circular product drops the last 4 bases.
  const bodies = [
    'CCCCGATGCCCCAAATTTGGGCCCAAATTT',
    'ATATATATGCGCTTACCAGGATTACCGGTA',
    'GGGGAAAACCCCTTTTACGTACGTACGTAC',
  ];
  const overhangs = ['AAAA', 'GGTT', 'TCCA'];
  const partSequence = (index: number) => (
    `GGTCTCN${overhangs[index]}${bodies[index]}${overhangs[(index + 1) % 3]}NGAGACC`
  );
  const released = [0, 1, 2].map((index) => partSequence(index).slice(7, 45));
  const linearProduct = released[0] + released[1].slice(4) + released[2].slice(4);
  const circularProduct = linearProduct.slice(0, linearProduct.length - 4);
  type TestFeature = {
    id: string;
    name: string;
    start: number;
    end: number;
    strand: number;
    subRanges?: ReadonlyArray<{ start: number; end: number }>;
  };
  const parts = [0, 1, 2].map((index) => ({
    sequence: partSequence(index),
    insertStart: 7 as number | null,
    insertEnd: 45 as number | null,
    features: [{ id: `body-${index}`, name: `Body ${index + 1}`, start: 13, end: 33, strand: 1 }] as TestFeature[],
  }));

  it('places each part at the offset its released bases occupy in the product', () => {
    expect(carryGoldenGatePartFeatures(parts, 4, circularProduct, 'circular')
      .map((feature) => [feature.name, feature.start, feature.end])).toEqual([
      ['Body 1', 6, 26],
      ['Body 2', 40, 60],
      ['Body 3', 74, 94],
    ]);
    expect(carryGoldenGatePartFeatures(parts, 4, linearProduct, 'linear')
      .map((feature) => [feature.name, feature.start, feature.end])).toEqual([
      ['Body 1', 6, 26],
      ['Body 2', 40, 60],
      ['Body 3', 74, 94],
    ]);
  });

  it('flips the features of a part used reverse-complemented', () => {
    // The record holds part 2 reversed; its insert bounds are measured on the
    // flipped sequence, as the design workspace measures them.
    const reversedRecord = {
      ...parts[1],
      sequence: reverseComplement(partSequence(1)),
      features: [
        { id: 'rc-body', name: 'Body 2', start: 19, end: 39, strand: -1 },
        { id: 'rc-cut', name: 'Crosses the cut', start: 0, end: 12, strand: 1 },
      ],
    };
    const carried = carryGoldenGatePartFeatures(
      [parts[0], { ...reversedRecord, orientation: 'reverse' as const }, parts[2]],
      4,
      circularProduct,
      'circular',
    );
    expect(carried.map((feature) => [feature.name, feature.start, feature.end, feature.strand])).toEqual([
      ['Body 1', 6, 26, 1],
      ['Body 2', 40, 60, 1],
      ['Body 3', 74, 94, 1],
    ]);
    expect(carryGoldenGatePartFeatures([parts[0], reversedRecord, parts[2]], 4, circularProduct, 'circular')
      .map((feature) => feature.name)).toEqual(['Body 1', 'Body 3']);
  });

  it('drops a feature that crosses a trim boundary or the closed circle', () => {
    const withFlank = parts.map((part, index) => ({
      ...part,
      features: [
        ...part.features,
        ...(index === 0 ? [{ id: 'flank', name: 'Crosses the cut', start: 3, end: 15, strand: 1 }] : []),
        ...(index === 2 ? [{ id: 'tail', name: 'Trailing overhang', start: 40, end: 45, strand: 1 }] : []),
      ],
    }));
    expect(carryGoldenGatePartFeatures(withFlank, 4, circularProduct, 'circular')
      .map((feature) => feature.name)).toEqual(['Body 1', 'Body 2', 'Body 3']);
  });

  it('carries nothing when the product does not hold the parts where the geometry says', () => {
    expect(carryGoldenGatePartFeatures(parts, 4, circularProduct, 'linear')).toEqual([]);
    // Rewriting the product's first 4 bases unseats part 1, and part 3 too:
    // its released tail is the same 4 bases, read around the circle.
    expect(carryGoldenGatePartFeatures(parts, 4, `TTTT${circularProduct.slice(4)}`, 'circular')
      .map((feature) => feature.name)).toEqual(['Body 2']);
    expect(carryGoldenGatePartFeatures(
      parts.map((part) => ({ ...part, insertStart: null })),
      4,
      circularProduct,
      'circular',
    )).toEqual([]);
  });

  it('rebuilds a carried feature without undefined-valued keys', () => {
    const carried = carryGoldenGatePartFeatures(
      [{ ...parts[0], features: [{ ...parts[0].features[0], subRanges: undefined }] }, parts[1], parts[2]],
      4,
      circularProduct,
      'circular',
    );
    expect(carried).toHaveLength(3);
    expect(Object.keys(carried[0])).not.toContain('subRanges');
  });
});

describe('a carried CDS keeps its /transl_except on the same codon', () => {
  // ATG GCA TGA AAA TAA: a selenoprotein-style CDS whose TGA is read as Sec.
  const cds = 'ATGGCATGAAAATAA';
  type SecFeature = {
    id: string;
    name: string;
    type: string;
    start: number;
    end: number;
    strand: 1 | -1;
    metadata: Record<string, unknown>;
  };
  const secCds = (start: number, strand: 1 | -1, position: string): SecFeature => ({
    id: 'sec',
    name: 'selenoprotein',
    type: 'cds',
    start,
    end: start + cds.length,
    strand,
    metadata: {
      transl_except: `(pos:${position},aa:Sec)`,
      motifQualifiers: [{ key: 'transl_except', value: `(pos:${position},aa:Sec)` }],
    },
  });
  const protein = (sequence: string, feature: SecFeature | undefined) => {
    if (!feature) return null;
    const result = materializeTranslationExceptions({ sequence, feature, qualifier: feature.metadata.transl_except });
    return result.ok ? result.materializedProtein : result.diagnostics.map((diagnostic) => diagnostic.code).join(',');
  };
  const listed = (feature: SecFeature | undefined) => (feature?.metadata.motifQualifiers as Array<{ value: unknown }>)[0].value;

  it('reads the part itself as Sec, so every product below starts from a true override', () => {
    expect(protein(`GG${cds}GG`, secCds(2, 1, '9..11'))).toBe('MAUK*');
    expect(protein(reverseComplement(`GG${cds}GG`), secCds(2, -1, 'complement(9..11)'))).toBe('MAUK*');
  });

  it('ligation: moves the Sec codon by the parts ligated before it', () => {
    const insert = { sequence: `GG${cds}GG`, features: [secCds(2, 1, '9..11')] };
    const product = `${'C'.repeat(20)}${insert.sequence}`;
    const [carried] = carryLigationPartFeatures([{ sequence: 'C'.repeat(20), features: [] }, insert], product.length);
    expect(carried.metadata.transl_except).toBe('(pos:29..31,aa:Sec)');
    expect(listed(carried)).toBe('(pos:29..31,aa:Sec)');
    expect(product.slice(28, 31)).toBe('TGA');
    expect(protein(product, carried)).toBe('MAUK*');
  });

  describe('overlap assembly', () => {
    const left = 'ACGTTGCAAGCTTCGAGCTCGGTACCGATC';
    // 45 bp: the CDS sits at part bases 10..25, its Sec codon at 1-based 17..19.
    const partB = `GATCCTCTAG${cds}TCGACCTGCAGGCATGCAAG`;
    const partA = { sequence: left, features: [] as SecFeature[] };

    it('forward: moves the Sec codon to where the part landed', () => {
      // Part B shares part A's last 4 bases, so it lands at product base 26.
      const product = left + partB.slice(4);
      const [carried] = carryOverlapPartFeatures([partA, { sequence: partB, features: [secCds(10, 1, '17..19')] }], product);
      expect(carried.start).toBe(36);
      expect(carried.metadata.transl_except).toBe('(pos:43..45,aa:Sec)');
      expect(product.slice(42, 45)).toBe('TGA');
      expect(protein(product, carried)).toBe('MAUK*');
    });

    it('flipped: a minus-strand CDS lands forward and loses its complement()', () => {
      const product = left + partB.slice(4);
      // The record holds part B reversed: the CDS reads on its minus strand.
      const record = reverseComplement(partB);
      const onRecord = secCds(20, -1, 'complement(27..29)');
      expect(protein(record, onRecord)).toBe('MAUK*');
      const [carried] = carryOverlapPartFeatures([partA, { sequence: record, features: [onRecord], orientation: 'reverse' }], product);
      expect([carried.start, carried.strand]).toEqual([36, 1]);
      expect(carried.metadata.transl_except).toBe('(pos:43..45,aa:Sec)');
      expect(listed(carried)).toBe('(pos:43..45,aa:Sec)');
      expect(protein(product, carried)).toBe('MAUK*');
    });

    it('flipped: a forward CDS lands on the minus strand as complement()', () => {
      const oriented = reverseComplement(partB);
      const leftPart = { sequence: left.slice(0, -4) + oriented.slice(0, 4), features: [] as SecFeature[] };
      const product = left.slice(0, -4) + oriented;
      const [carried] = carryOverlapPartFeatures(
        [leftPart, { sequence: partB, features: [secCds(10, 1, '17..19')], orientation: 'reverse' }],
        product,
      );
      // Record base i lands at 26 + 44 - i: the CDS at 46..61, its Sec codon at 1-based 53..55.
      expect([carried.start, carried.end, carried.strand]).toEqual([46, 61, -1]);
      expect(carried.metadata.transl_except).toBe('(pos:complement(53..55),aa:Sec)');
      expect(reverseComplement(product.slice(52, 55))).toBe('TGA');
      expect(protein(product, carried)).toBe('MAUK*');
    });
  });

  describe('Golden Gate', () => {
    // BsaI parts GGTCTCN <overhang> <body> <overhang> NGAGACC; each keeps bases
    // 7..45, and they land at 0, 34 and 68 of a 102 bp circle.
    const bodies = ['CCCCGATGCCCCAAATTTGGGCCCAAATTT', `CC${cds}GGGCCCAAATTTG`, `TT${cds}CCCGGGTTTAAAC`];
    const overhangs = ['AAAA', 'GGTT', 'TCCA'];
    const partSequence = (index: number) => `GGTCTCN${overhangs[index]}${bodies[index]}${overhangs[(index + 1) % 3]}NGAGACC`;
    const released = [0, 1, 2].map((index) => partSequence(index).slice(7, 45));
    const circularProduct = (released[0] + released[1].slice(4) + released[2].slice(4)).slice(0, -4);
    const part = (index: number, features: SecFeature[]) => ({
      sequence: partSequence(index), insertStart: 7, insertEnd: 45, features,
    });

    it('forward, circular: the part whose trailing overhang closes the circle keeps its Sec', () => {
      // Part 3's CDS starts at part base 13 (Sec codon 1-based 20..22) and lands at 74.
      const carried = carryGoldenGatePartFeatures(
        [part(0, []), part(1, []), part(2, [secCds(13, 1, '20..22')])], 4, circularProduct, 'circular',
      );
      expect(carried.map((feature) => [feature.start, feature.metadata.transl_except])).toEqual([[74, '(pos:81..83,aa:Sec)']]);
      expect(circularProduct.slice(80, 83)).toBe('TGA');
      expect(protein(circularProduct, carried[0])).toBe('MAUK*');
    });

    it('flipped: a part stored reversed lands forward with a plain pos:', () => {
      const record = reverseComplement(partSequence(1));
      const onRecord = secCds(24, -1, 'complement(31..33)');
      expect(protein(record, onRecord)).toBe('MAUK*');
      const carried = carryGoldenGatePartFeatures(
        [part(0, []), { ...part(1, [onRecord]), sequence: record, orientation: 'reverse' as const }, part(2, [])],
        4,
        circularProduct,
        'circular',
      );
      expect(carried.map((feature) => [feature.start, feature.strand, feature.metadata.transl_except]))
        .toEqual([[40, 1, '(pos:47..49,aa:Sec)']]);
      expect(protein(circularProduct, carried[0])).toBe('MAUK*');
    });

    it('drops an override that points outside the released piece rather than keep a stale number', () => {
      const stale = secCds(13, 1, '2..4');
      const [carried] = carryGoldenGatePartFeatures([part(0, []), part(1, [stale]), part(2, [])], 4, circularProduct, 'circular');
      expect(carried.metadata).toEqual({ motifQualifiers: [] });
    });
  });
});

describe('what a product leaves out', () => {
  const feature = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: 'cds' as const, metadata: extra });

  it('names up to three features, then counts the rest, in the words of each builder', () => {
    expect(describeFeaturesLeftOut([], 'cut', 2)).toBeNull();
    expect(describeFeaturesLeftOut([feature('TetR')], 'cut', 2)).toBe('1 feature crosses a cut and is in neither fragment: TetR.');
    expect(describeFeaturesLeftOut([feature('A'), feature('B')], 'cut', 3)).toBe('2 features cross a cut and are in no fragment: A and B.');
    expect(describeFeaturesLeftOut([feature('lacZ-alpha'), feature('MCS')], 'cut', 1))
      .toBe('2 features cross the cut and are not in the linearized record: lacZ-alpha and MCS.');
    expect(describeFeaturesLeftOut([feature('selT')], 'amplicon')).toBe('1 feature crosses an amplicon end and is not in the product: selT.');
    expect(describeFeaturesLeftOut(['A', 'B', 'C'].map((name) => feature(name)), 'part'))
      .toBe('3 features cross a part end and are not in the product: A, B and C.');
    expect(describeFeaturesLeftOut(['A', 'B', 'C', 'D', 'E'].map((name) => feature(name)), 'part'))
      .toBe('5 features cross a part end and are not in the product: A, B, C and 2 more.');
    // An unnamed feature is named by its type.
    expect(describeFeaturesLeftOut([feature('  ')], 'part')).toBe('1 feature crosses a part end and is not in the product: cds.');
  });

  it('does not name a GenBank source feature or a proposed ORF', () => {
    const source = feature('source', { motifOriginalFeatureKey: 'source' });
    const proposed = feature('Proposed ORF 1', {
      motifProposal: { status: 'proposed', proposedBy: 'motif-auto-annotation', detector: 'motif-orf-detection' },
    });
    expect(describeFeaturesLeftOut([source, proposed], 'cut', 2)).toBeNull();
    expect(describeFeaturesLeftOut([source, feature('selT'), proposed], 'cut', 2)).toBe('1 feature crosses a cut and is in neither fragment: selT.');
  });

  it('tests overlap on a feature\'s own bases, across a circular origin too', () => {
    expect(featureOverlapsIntervals({ start: 5, end: 30 }, [[17, 60]], 100)).toBe(true);
    expect(featureOverlapsIntervals({ start: 0, end: 10 }, [[17, 60]], 100)).toBe(false);
    expect(featureOverlapsIntervals({ start: 90, end: 5 }, [[0, 3]], 100)).toBe(true);
    expect(featureOverlapsIntervals({ start: 90, end: 5 }, [[10, 80]], 100)).toBe(false);
    // Sub-ranges, not the envelope: the gap between exons is not the feature's.
    expect(featureOverlapsIntervals({ start: 10, end: 60, subRanges: [{ start: 10, end: 20 }, { start: 40, end: 60 }] }, [[25, 35]], 100)).toBe(false);
  });

  it('hands back the features each carry leaves behind', () => {
    const ligationLeftOut: Array<{ name: string; start: number; end: number; strand: number }> = [];
    carryLigationPartFeatures([
      { sequence: 'A'.repeat(50), features: [{ name: 'Inside', start: 5, end: 20, strand: 1 }] },
      { sequence: 'C'.repeat(40), features: [{ name: 'Wrapped', start: 35, end: 4, strand: 1 }] },
    ], 90, ligationLeftOut);
    expect(ligationLeftOut.map((entry) => entry.name)).toEqual(['Wrapped']);

    // One BsaI part: GGTCTCN (0..6), then its released bases 7..45, then NGAGACC.
    const body = 'CCCCGATGCCCCAAATTTGGGCCCAAATTT';
    const part = `GGTCTCNAAAA${body}AAAANGAGACC`;
    const released = part.slice(7, 45);
    const ggLeftOut: Array<{ name: string; start: number; end: number; strand: number }> = [];
    const carried = carryGoldenGatePartFeatures([{
      sequence: part,
      insertStart: 7,
      insertEnd: 45,
      features: [
        { name: 'Body', start: 13, end: 33, strand: 1 },
        { name: 'Across the site', start: 3, end: 20, strand: 1 },
        { name: 'Site only', start: 0, end: 6, strand: 1 },
      ],
    }], 4, released.slice(0, released.length - 4), 'circular', ggLeftOut);
    expect(carried.map((entry) => entry.name)).toEqual(['Body']);
    expect(ggLeftOut.map((entry) => entry.name)).toEqual(['Across the site']);

    const overlapLeftOut: Array<{ name: string; start: number; end: number; strand: number }> = [];
    carryOverlapPartFeatures([{ sequence: 'ACGTTGCA', features: [{ name: 'Wrapped', start: 6, end: 2, strand: 1 }] }], 'GGACGTTGCAGG', overlapLeftOut);
    expect(overlapLeftOut.map((entry) => entry.name)).toEqual(['Wrapped']);
  });
});

describe('a proposed ORF in a part', () => {
  const proposal = (status: 'proposed' | 'accepted') => ({
    motifProposal: { status, proposedBy: 'motif-auto-annotation', detector: 'motif-orf-detection' },
  });
  const part = {
    sequence: 'A'.repeat(200),
    features: [
      { name: 'Kept', start: 5, end: 20, strand: 1 },
      { name: 'Proposed ORF 1', start: 30, end: 183, strand: 1, metadata: proposal('proposed') },
      { name: 'ORF 2', start: 40, end: 100, strand: -1, metadata: proposal('accepted') },
    ],
  };

  it('stays behind unless someone accepted it, in every assembly carry', () => {
    const names = (features: ReadonlyArray<{ name: string }>) => features.map((feature) => feature.name);
    const leftOut: Array<(typeof part.features)[number]> = [];
    expect(names(carryLigationPartFeatures([part, { sequence: 'C'.repeat(50) }], 250, leftOut))).toEqual(['Kept', 'ORF 2']);
    expect(names(carryOverlapPartFeatures([part], `GG${part.sequence}GG`, leftOut))).toEqual(['Kept', 'ORF 2']);
    const site = `GGTCTCN${part.sequence}NGAGACC`;
    const shifted = { ...part, sequence: site, features: part.features.map((feature) => ({ ...feature, start: feature.start + 7, end: feature.end + 7 })) };
    expect(names(carryGoldenGatePartFeatures([{ ...shifted, insertStart: 7, insertEnd: 207 }], 4, part.sequence, 'linear', leftOut)))
      .toEqual(['Kept', 'ORF 2']);
    // A guess left behind is not reported as a lost feature either.
    expect(leftOut).toEqual([]);
  });
});
