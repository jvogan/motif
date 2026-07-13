import { describe, expect, it } from 'vitest';
import {
  createArtifactAssemblyArtifacts,
  getArtifactTypeIISEnzymeGeometry,
  planArtifactGoldenGateAssembly,
  planArtifactLigation,
  type ArtifactAssemblyArtifactOptions,
  type ArtifactGoldenGatePartInput,
  type ArtifactLigationPartInput,
} from '../claude-science-assembly-workflows';
import { sha256HexSync } from '../claude-science-sha256';

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
    expect(plan.junctions[0].reason).toContain('mixes 5prime and 3prime');
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
