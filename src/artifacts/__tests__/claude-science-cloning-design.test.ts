import { describe, expect, it } from 'vitest';
import {
  planArtifactGibsonDesign,
  planArtifactGoldenGateDesign,
  type ArtifactCloningInput,
} from '../claude-science-cloning-design';
import { reverseComplement } from '../../bio/reverse-complement';
import { sha256HexSync } from '../claude-science-sha256';

function cloningInput(
  recordId: string,
  sequence: string,
  sha256?: string,
  orientation?: 'forward' | 'reverse',
): ArtifactCloningInput {
  return {
    recordId,
    name: recordId,
    molecule: 'dna',
    sequence,
    ...(sha256 === undefined ? {} : { sha256 }),
    ...(orientation === undefined ? {} : { orientation }),
  };
}

function bsaIPart(recordId: string, left: string, insert: string, right: string): ArtifactCloningInput {
  return cloningInput(recordId, `GGTCTCN${left}${insert}${right}NGAGACC`);
}

function bsmBIPart(recordId: string, left: string, insert: string, right: string): ArtifactCloningInput {
  return cloningInput(recordId, `CGTCTCN${left}${insert}${right}NGAGACG`);
}

describe('planArtifactGoldenGateDesign', () => {
  it('applies a MoClo Plant profile and emits exact input/product provenance', () => {
    const promoter = bsaIPart('promoter', 'AATG', 'CCCCCCCC', 'GCTT');
    const backbone = bsaIPart('backbone', 'GCTT', 'ACTGACTGACTG', 'AATG');
    promoter.sha256 = sha256HexSync(promoter.sequence);
    backbone.sha256 = sha256HexSync(backbone.sequence);

    const plan = planArtifactGoldenGateDesign({
      parts: [promoter, backbone],
      kitId: 'moclo-plant',
      organizationMode: 'freeform',
    });

    expect(plan.status).toBe('ready');
    expect(plan.profile).toMatchObject({
      id: 'moclo-plant',
      name: 'MoClo Plant',
      enzyme: 'BsaI',
      fusionSiteLength: 4,
    });
    expect(plan.parts.map((part) => part.kitFusionSiteStatus)).toEqual(['consistent', 'consistent']);
    expect(plan.product).toMatchObject({ topology: 'circular', orderedRecordIds: ['promoter', 'backbone'] });
    expect(plan.product?.sha256).toBe(sha256HexSync(plan.product?.sequence ?? ''));
    expect(plan.provenance).toMatchObject({
      adapter: 'motif-for-claude-science-cloning',
      adapterVersion: 3,
      engine: 'motif-bio/golden-gate',
      inputRecordIds: ['promoter', 'backbone'],
      inputOrientations: ['forward', 'forward'],
      inputSha256s: [sha256HexSync(promoter.sequence), sha256HexSync(backbone.sequence)],
      effectiveInputSha256s: [sha256HexSync(promoter.sequence), sha256HexSync(backbone.sequence)],
    });
    expect(plan.provenance?.requestSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses the YTK BsmBI profile without treating its fusion sites as BsaI defaults', () => {
    const plan = planArtifactGoldenGateDesign({
      kitId: 'moclo-ytk',
      parts: [
        bsmBIPart('ytk-a', 'AACG', 'CCCCCCCC', 'TATG'),
        bsmBIPart('ytk-b', 'TATG', 'GGGGGGGG', 'AACG'),
      ],
    });

    expect(plan.status).toBe('ready');
    expect(plan.enzyme).toBe('BsmBI');
    expect(plan.profile?.fusionSites).toEqual(expect.arrayContaining(['AACG', 'TATG']));
    expect(plan.parts.every((part) => part.kitFusionSiteStatus === 'consistent')).toBe(true);
  });

  it('plans GoldenBraid TU role order but requires an explicit alpha destination before emitting a plasmid', () => {
    const terminator = bsaIPart('terminator', 'TGAG', 'TTTTTTTT', 'CGCT');
    const promoter = bsaIPart('promoter', 'GGAG', 'CCCCCCCC', 'GATG');
    const cds = bsaIPart('cds', 'GATG', 'ATGAAATTT', 'TGAG');

    const plan = planArtifactGoldenGateDesign({
      organizationMode: 'golden_braid_tu',
      parts: [terminator, promoter, cds],
    });

    expect(plan.status).toBe('needs_preparation');
    expect(plan.product).toBeNull();
    expect(plan.goldenBraidIdentityValidated).toBe(false);
    expect(plan.profile?.id).toBe('goldenbraid-3');
    expect(plan.nextLevel).toBe('alpha');
    expect(plan.recommendedNextLevelEnzyme).toBe('BsmBI');
    expect(plan.suggestedOrderRecordIds).toEqual(['promoter', 'cds', 'terminator']);
    expect(plan.parts.map((part) => part.role)).toEqual(['terminator', 'promoter', 'coding_sequence']);
    expect(plan.preparation).toContainEqual(expect.objectContaining({
      id: 'reorder:organization',
      kind: 'reorder_parts',
      recordIds: ['promoter', 'cds', 'terminator'],
    }));
    expect(plan.preparation).toContainEqual(expect.objectContaining({
      kind: 'add_destination_vector',
      label: expect.stringMatching(/alpha destination/i),
    }));
  });

  it('emits a complete GoldenBraid TU plasmid only with entry-part identity and a typed alpha destination', () => {
    const plan = planArtifactGoldenGateDesign({
      organizationMode: 'golden_braid_tu',
      destinationRecordId: 'alpha-destination',
      parts: [
        { ...bsaIPart('promoter', 'GGAG', 'CCCCCCCC', 'GATG'), goldenBraidLevel: 'entry', goldenBraidRole: 'source_module' },
        { ...bsaIPart('cds', 'GATG', 'ATGAAATTT', 'TGAG'), goldenBraidLevel: 'entry', goldenBraidRole: 'source_module' },
        { ...bsaIPart('terminator', 'TGAG', 'TTTTTTTT', 'CGCT'), goldenBraidLevel: 'entry', goldenBraidRole: 'source_module' },
        { ...bsaIPart('alpha-destination', 'CGCT', 'ACTGACTGACTG', 'GGAG'), goldenBraidLevel: 'alpha', goldenBraidRole: 'destination_vector', goldenBraidSlot: '1R' },
      ],
    });

    expect(plan.status).toBe('ready');
    expect(plan.goldenBraidIdentityValidated).toBe(true);
    expect(plan).toMatchObject({
      sourceLevel: 'entry',
      destinationLevel: 'alpha',
      destinationRecordId: 'alpha-destination',
    });
    expect(plan.product?.orderedRecordIds).toEqual(['promoter', 'cds', 'terminator', 'alpha-destination']);
    expect(plan.parts.at(-1)).toMatchObject({
      goldenBraidLevel: 'alpha',
      goldenBraidRole: 'destination_vector',
      goldenBraidSlot: '1R',
      roleLabel: 'DEST',
    });
  });

  it('assembles an explicitly identified alpha-to-omega GoldenBraid round with BsmBI and 4-nt overhangs', () => {
    const parts = [
      { ...bsmBIPart('alpha-tu-1', 'AAAA', 'CCCCCCCC', 'CCCC'), goldenBraidLevel: 'alpha' as const, goldenBraidRole: 'source_module' as const, goldenBraidSlot: '1R' as const },
      { ...bsmBIPart('alpha-tu-2', 'CCCC', 'GGGGGGGG', 'GGGG'), goldenBraidLevel: 'alpha' as const, goldenBraidRole: 'source_module' as const, goldenBraidSlot: '2' as const },
      { ...bsmBIPart('omega-destination', 'GGGG', 'TTTTTTTT', 'AAAA'), goldenBraidLevel: 'omega' as const, goldenBraidRole: 'destination_vector' as const, goldenBraidSlot: '2R' as const },
    ];
    const plan = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      goldenBraidDirection: 'alpha_to_omega',
      destinationRecordId: 'omega-destination',
      parts,
    });
    const explicit = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      goldenBraidDirection: 'alpha_to_omega',
      destinationRecordId: 'omega-destination',
      enzyme: 'Esp3I',
      parts,
    });

    expect(plan.status).toBe('ready');
    expect(explicit.status).toBe('ready');
    expect(plan.enzyme).toBe('BsmBI');
    expect(explicit.enzyme).toBe('Esp3I');
    expect(explicit.product?.sequence).toBe(plan.product?.sequence);
    expect(plan.profile).toMatchObject({ enzyme: 'BsmBI', fusionSiteLength: 4, fusionSites: [] });
    expect(plan).toMatchObject({
      goldenBraidDirection: 'alpha_to_omega',
      sourceLevel: 'alpha',
      destinationLevel: 'omega',
      destinationRecordId: 'omega-destination',
      goldenBraidIdentityValidated: true,
      nextLevel: 'omega',
      recommendedNextLevelEnzyme: 'BsaI',
    });
    expect(plan.nextLevel).toBe('omega');
    expect(plan.suggestedOrderRecordIds).toEqual(['alpha-tu-1', 'alpha-tu-2', 'omega-destination']);
    expect(plan.parts.map((part) => part.roleLabel)).toEqual(['TU', 'TU', 'DEST']);
    expect(plan.parts.map((part) => part.goldenBraidLevel)).toEqual(['alpha', 'alpha', 'omega']);
    expect(plan.parts.map((part) => part.goldenBraidSlot)).toEqual(['1R', '2', '2R']);
    expect(plan.parts.map((part) => part.kitFusionSiteStatus)).toEqual(['not_checked', 'not_checked', 'not_checked']);
    expect(plan.preparation.some((action) => action.kind === 'review_fusion_site')).toBe(false);
    const slotVariant = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      goldenBraidDirection: 'alpha_to_omega',
      destinationRecordId: 'omega-destination',
      parts: [
        { ...parts[0], goldenBraidSlot: '2R' },
        { ...parts[1], goldenBraidSlot: '1' },
        parts[2],
      ],
    });
    expect(slotVariant.status).toBe('ready');
    expect(slotVariant.product?.sequence).toBe(plan.product?.sequence);
    expect(slotVariant.provenance?.requestSha256).not.toBe(plan.provenance?.requestSha256);
    expect(plan.provenance?.requestSha256).not.toBe(planArtifactGoldenGateDesign({
      ...({ kitId: 'goldenbraid-3', organizationMode: 'golden_braid_binary' } as const),
      goldenBraidDirection: 'alpha_to_omega',
      destinationRecordId: 'omega-destination',
      enzyme: 'Esp3I',
      parts,
    }).provenance?.requestSha256);
  });

  it('alternates back from omega to alpha with BsaI and recommends BsmBI next', () => {
    const plan = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      goldenBraidDirection: 'omega_to_alpha',
      destinationRecordId: 'alpha-destination',
      enzyme: 'BsaI',
      parts: [
        { ...bsaIPart('omega-tu-1', 'AAAA', 'CCCCCCCC', 'CCCC'), goldenBraidLevel: 'omega', goldenBraidRole: 'source_module', goldenBraidSlot: '1' },
        { ...bsaIPart('omega-tu-2', 'CCCC', 'GGGGGGGG', 'GGGG'), goldenBraidLevel: 'omega', goldenBraidRole: 'source_module', goldenBraidSlot: '2R' },
        { ...bsaIPart('alpha-destination', 'GGGG', 'TTTTTTTT', 'AAAA'), goldenBraidLevel: 'alpha', goldenBraidRole: 'destination_vector', goldenBraidSlot: '1R' },
      ],
    });

    expect(plan.status).toBe('ready');
    expect(plan).toMatchObject({
      enzyme: 'BsaI',
      sourceLevel: 'omega',
      destinationLevel: 'alpha',
      nextLevel: 'alpha',
      recommendedNextLevelEnzyme: 'BsmBI',
      goldenBraidIdentityValidated: true,
    });
    expect(plan.profile?.fusionSites).toEqual([]);
  });

  it('blocks recursive readiness unless source pDGB types are complementary 1/1R plus 2/2R', () => {
    const duplicateBaseType = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      goldenBraidDirection: 'alpha_to_omega',
      destinationRecordId: 'omega-destination',
      parts: [
        { ...bsmBIPart('alpha-tu-1', 'AAAA', 'CCCCCCCC', 'CCCC'), goldenBraidLevel: 'alpha', goldenBraidRole: 'source_module', goldenBraidSlot: '1' },
        { ...bsmBIPart('alpha-tu-2', 'CCCC', 'GGGGGGGG', 'GGGG'), goldenBraidLevel: 'alpha', goldenBraidRole: 'source_module', goldenBraidSlot: '1R' },
        { ...bsmBIPart('omega-destination', 'GGGG', 'TTTTTTTT', 'AAAA'), goldenBraidLevel: 'omega', goldenBraidRole: 'destination_vector', goldenBraidSlot: '2' },
      ],
    });

    expect(duplicateBaseType.status).toBe('blocked');
    expect(duplicateBaseType.product).toBeNull();
    expect(duplicateBaseType.goldenBraidIdentityValidated).toBe(false);
    expect(duplicateBaseType.errors).toContainEqual(expect.objectContaining({
      code: 'golden_braid_source_slot_pair_required',
    }));

    const missingDestinationSlot = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      goldenBraidDirection: 'alpha_to_omega',
      destinationRecordId: 'omega-destination',
      parts: [
        { ...bsmBIPart('alpha-tu-1', 'AAAA', 'CCCCCCCC', 'CCCC'), goldenBraidLevel: 'alpha', goldenBraidRole: 'source_module', goldenBraidSlot: '1' },
        { ...bsmBIPart('alpha-tu-2', 'CCCC', 'GGGGGGGG', 'GGGG'), goldenBraidLevel: 'alpha', goldenBraidRole: 'source_module', goldenBraidSlot: '2R' },
        { ...bsmBIPart('omega-destination', 'GGGG', 'TTTTTTTT', 'AAAA'), goldenBraidLevel: 'omega', goldenBraidRole: 'destination_vector' },
      ],
    });
    expect(missingDestinationSlot.status).toBe('needs_preparation');
    expect(missingDestinationSlot.product).toBeNull();
    expect(missingDestinationSlot.preparation).toContainEqual(expect.objectContaining({
      kind: 'validate_golden_braid_identity',
      recordIds: ['omega-destination'],
    }));
  });

  it('does not report arbitrary compatible fragments as a validated GoldenBraid stack', () => {
    const plan = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      goldenBraidDirection: 'alpha_to_omega',
      parts: [
        bsmBIPart('fragment-a', 'AAAA', 'CCCCCCCC', 'CCCC'),
        bsmBIPart('fragment-b', 'CCCC', 'GGGGGGGG', 'AAAA'),
      ],
    });

    expect(plan.status).toBe('needs_preparation');
    expect(plan.product).toBeNull();
    expect(plan.goldenBraidIdentityValidated).toBe(false);
    expect(plan.preparation).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_destination_vector', status: 'required' }),
      expect.objectContaining({ kind: 'validate_golden_braid_identity', status: 'required' }),
    ]));
  });

  it('requires direction and blocks wrong enzymes or inconsistent alpha/omega identity', () => {
    const unidentified = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      parts: [
        bsmBIPart('a', 'AAAA', 'CCCCCCCC', 'CCCC'),
        bsmBIPart('b', 'CCCC', 'GGGGGGGG', 'AAAA'),
      ],
    });
    const wrongEnzyme = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      goldenBraidDirection: 'alpha_to_omega',
      enzyme: 'SapI',
      parts: [
        bsmBIPart('a', 'AAAA', 'CCCCCCCC', 'CCCC'),
        bsmBIPart('b', 'CCCC', 'GGGGGGGG', 'AAAA'),
      ],
    });
    const wrongIdentity = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_binary',
      goldenBraidDirection: 'alpha_to_omega',
      destinationRecordId: 'destination',
      parts: [
        { ...bsmBIPart('a', 'AAAA', 'CCCCCCCC', 'CCCC'), goldenBraidLevel: 'omega', goldenBraidRole: 'source_module', goldenBraidSlot: '1' },
        { ...bsmBIPart('b', 'CCCC', 'GGGGGGGG', 'GGGG'), goldenBraidLevel: 'alpha', goldenBraidRole: 'source_module', goldenBraidSlot: '2' },
        { ...bsmBIPart('destination', 'GGGG', 'TTTTTTTT', 'AAAA'), goldenBraidLevel: 'alpha', goldenBraidRole: 'destination_vector', goldenBraidSlot: '1R' },
      ],
    });
    const transcriptionUnit = planArtifactGoldenGateDesign({
      kitId: 'goldenbraid-3',
      organizationMode: 'golden_braid_tu',
      enzyme: 'BsmBI',
      parts: [
        bsmBIPart('promoter', 'AAAA', 'CCCCCCCC', 'CCCC'),
        bsmBIPart('cds', 'CCCC', 'GGGGGGGG', 'AAAA'),
      ],
    });

    expect(unidentified.errors).toContainEqual(expect.objectContaining({ code: 'golden_braid_direction_required' }));
    expect(wrongIdentity.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'golden_braid_level_mismatch', recordId: 'a' }),
      expect.objectContaining({ code: 'golden_braid_level_mismatch', recordId: 'destination' }),
    ]));
    for (const plan of [unidentified, wrongEnzyme, wrongIdentity, transcriptionUnit]) {
      expect(plan.status).toBe('blocked');
      expect(plan.product).toBeNull();
    }
    expect(wrongEnzyme.errors).toContainEqual(expect.objectContaining({ code: 'golden_braid_level_enzyme_mismatch' }));
    expect(transcriptionUnit.errors).toContainEqual(expect.objectContaining({ code: 'golden_braid_level_enzyme_mismatch' }));
  });

  it('reverse-complements a Golden Gate source before boundary evaluation and records both hashes', () => {
    const effectivePromoter = bsaIPart('promoter', 'AATG', 'CCCCCCCC', 'GCTT');
    const backbone = bsaIPart('backbone', 'GCTT', 'ACTGACTGACTG', 'AATG');
    const reversedSource = reverseComplement(effectivePromoter.sequence);
    const orientedPromoter = cloningInput(
      'promoter',
      reversedSource,
      sha256HexSync(reversedSource),
      'reverse',
    );
    const oriented = planArtifactGoldenGateDesign({
      parts: [orientedPromoter, backbone],
      kitId: 'moclo-plant',
    });
    const baseline = planArtifactGoldenGateDesign({
      parts: [effectivePromoter, backbone],
      kitId: 'moclo-plant',
    });

    expect(oriented.status).toBe('ready');
    expect(oriented.product?.sequence).toBe(baseline.product?.sequence);
    expect(oriented.inputs[0]).toMatchObject({
      orientation: 'reverse',
      inputSha256: sha256HexSync(reversedSource),
      sourceSha256: sha256HexSync(reversedSource),
      effectiveSha256: sha256HexSync(effectivePromoter.sequence),
    });
    expect(oriented.provenance).toMatchObject({
      adapterVersion: 3,
      inputOrientations: ['reverse', 'forward'],
      inputSha256s: [sha256HexSync(reversedSource), sha256HexSync(backbone.sequence)],
      effectiveInputSha256s: [sha256HexSync(effectivePromoter.sequence), sha256HexSync(backbone.sequence)],
    });
  });

  it('turns an open MoClo chain into an explicit destination-vector preparation step', () => {
    const plan = planArtifactGoldenGateDesign({
      kitId: 'moclo-plant',
      parts: [
        bsaIPart('promoter', 'GGAG', 'CCCCCCCC', 'AATG'),
        bsaIPart('cds', 'AATG', 'ATGAAATTT', 'GCTT'),
      ],
    });

    expect(plan.status).toBe('needs_preparation');
    expect(plan.product).toBeNull();
    expect(plan.preparation).toContainEqual(expect.objectContaining({
      id: 'vector:destination',
      kind: 'add_destination_vector',
      status: 'required',
    }));
    expect(plan.errors.some((entry) => /destination vector/i.test(entry.message))).toBe(true);
  });

  it('keeps flank PCR and domestication as separate required work when a raw part needs both', () => {
    const plan = planArtifactGoldenGateDesign({
      parts: [
        cloningInput('raw-with-site', 'ATGCGTGGTCTCATGCGT'),
        cloningInput('raw-clean', 'ATGCGTACGTAGCTAGCTAG'),
      ],
      enzyme: 'BsaI',
    });

    expect(plan.status).toBe('needs_preparation');
    expect(plan.product).toBeNull();
    expect(plan.preparation).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'flanks:raw-with-site', kind: 'add_type_iis_flanks', status: 'required' }),
      expect.objectContaining({ id: 'domesticate:raw-with-site', kind: 'domesticate', status: 'required' }),
    ]));
  });

  it('carries requested fusion-boundary intent into primer preparation and provenance without fabricating flanks', () => {
    const raw = cloningInput('raw-insert', 'ATGCGTACGTAGCTAGCTAG');
    const backbone = bsaIPart('backbone', 'GCTT', 'ACTGACTGACTG', 'GGAG');
    const plan = planArtifactGoldenGateDesign({
      parts: [
        { ...raw, requestedLeftOverhang: 'ggag', requestedRightOverhang: 'GCTT' },
        backbone,
      ],
      enzyme: 'BsaI',
    });
    const changed = planArtifactGoldenGateDesign({
      parts: [
        { ...raw, requestedLeftOverhang: 'AATG', requestedRightOverhang: 'GCTT' },
        backbone,
      ],
      enzyme: 'BsaI',
    });

    expect(plan.status).toBe('needs_preparation');
    expect(plan.product).toBeNull();
    expect(plan.parts[0]).toMatchObject({
      leftOverhang: null,
      rightOverhang: null,
      requestedLeftOverhang: 'GGAG',
      requestedRightOverhang: 'GCTT',
      status: 'needs_flanks',
    });
    expect(plan.preparation).toContainEqual(expect.objectContaining({
      id: 'flanks:raw-insert',
      kind: 'add_type_iis_flanks',
      detail: expect.stringContaining('GGAG→GCTT'),
    }));
    expect(plan.provenance?.requestSha256).not.toBe(changed.provenance?.requestSha256);
  });

  it('requires requested fusion boundaries to be paired and match enzyme geometry', () => {
    const incomplete = planArtifactGoldenGateDesign({
      parts: [
        { ...cloningInput('raw', 'ATGCGTACGT'), requestedLeftOverhang: 'AATG' },
        bsaIPart('backbone', 'GCTT', 'ACTGACTG', 'AATG'),
      ],
      enzyme: 'BsaI',
    });
    const wrongLength = planArtifactGoldenGateDesign({
      parts: [
        { ...cloningInput('raw', 'ATGCGTACGT'), requestedLeftOverhang: 'AAA', requestedRightOverhang: 'CCC' },
        bsaIPart('backbone', 'GCTT', 'ACTGACTG', 'AATG'),
      ],
      enzyme: 'BsaI',
    });

    expect(incomplete.status).toBe('blocked');
    expect(incomplete.errors).toContainEqual(expect.objectContaining({ code: 'incomplete_requested_fusion_sites' }));
    expect(wrongLength.status).toBe('blocked');
    expect(wrongLength.errors).toContainEqual(expect.objectContaining({ code: 'invalid_requested_fusion_site' }));
  });

  it('reports nonstandard fusion sites as reviewable rather than silently widening a kit', () => {
    const plan = planArtifactGoldenGateDesign({
      kitId: 'greengate',
      parts: [
        bsaIPart('custom-a', 'AAAA', 'CCCCCCCC', 'GATG'),
        bsaIPart('custom-b', 'GATG', 'GGGGGGGG', 'AAAA'),
      ],
    });

    expect(plan.status).toBe('ready');
    expect(plan.parts.every((part) => part.kitFusionSiteStatus === 'nonstandard')).toBe(true);
    expect(plan.preparation.filter((action) => action.kind === 'review_fusion_site')).toHaveLength(2);
    expect(plan.warnings).toEqual([]);
    expect(plan.parts.flatMap((part) => part.issues)).toContainEqual(expect.objectContaining({
      code: 'nonstandard_fusion_site',
      severity: 'warning',
    }));
  });

  it('blocks mismatched input digests and incompatible profile selections', () => {
    const stale = bsaIPart('stale', 'AATG', 'CCCCCCCC', 'GCTT');
    stale.sha256 = '0'.repeat(64);
    const mismatch = planArtifactGoldenGateDesign({
      kitId: 'moclo-plant',
      parts: [stale, bsaIPart('backbone', 'GCTT', 'ACTGACTG', 'AATG')],
    });
    const wrongProfile = planArtifactGoldenGateDesign({
      kitId: 'moclo-plant',
      organizationMode: 'golden_braid_tu',
      parts: [
        bsaIPart('a', 'GGAG', 'CCCCCCCC', 'GATG'),
        bsaIPart('b', 'GATG', 'GGGGGGGG', 'GGAG'),
      ],
    });

    expect(mismatch.status).toBe('blocked');
    expect(mismatch.errors).toContainEqual(expect.objectContaining({ code: 'sha256_mismatch', recordId: 'stale' }));
    expect(mismatch.provenance).toBeNull();
    expect(wrongProfile.status).toBe('blocked');
    expect(wrongProfile.errors).toContainEqual(expect.objectContaining({ code: 'golden_braid_profile_required' }));
  });
});

describe('planArtifactGibsonDesign', () => {
  const O1 = 'GGAATTCCGGAATTCCGGAA';
  const O2 = 'CCTTAAGGCCTTAAGGCCTT';

  it('plans a linear product with visible overlap metrics and exact provenance', () => {
    const left = cloningInput('left', `AAAAAAAA${O1}`);
    const right = cloningInput('right', `${O1}TTTTTTTT`);
    const plan = planArtifactGibsonDesign({ fragments: [left, right], topology: 'linear' });

    expect(plan.status).toBe('ready');
    expect(plan.junctions).toEqual([expect.objectContaining({
      leftRecordId: 'left',
      rightRecordId: 'right',
      closing: false,
      status: 'ready',
      overlapSequence: O1,
      overlapLength: O1.length,
    })]);
    expect(plan.product?.sequence).toBe(`AAAAAAAA${O1}TTTTTTTT`);
    expect(plan.provenance?.inputSha256s).toEqual([
      sha256HexSync(left.sequence),
      sha256HexSync(right.sequence),
    ]);
  });

  it('assembles a reverse-oriented Gibson source and keeps source/effective provenance distinct', () => {
    const effectiveLeft = `AAAAAAAA${O1}`;
    const sourceLeft = reverseComplement(effectiveLeft);
    const right = cloningInput('right', `${O1}TTTTTTTT`);
    const plan = planArtifactGibsonDesign({
      fragments: [
        cloningInput('left', sourceLeft, sha256HexSync(sourceLeft), 'reverse'),
        right,
      ],
      topology: 'linear',
    });

    expect(plan.status).toBe('ready');
    expect(plan.product?.sequence).toBe(`AAAAAAAA${O1}TTTTTTTT`);
    expect(plan.inputs[0]).toMatchObject({
      orientation: 'reverse',
      sourceSha256: sha256HexSync(sourceLeft),
      effectiveSha256: sha256HexSync(effectiveLeft),
      inputSha256: sha256HexSync(sourceLeft),
    });
    expect(plan.provenance).toMatchObject({
      adapterVersion: 3,
      inputOrientations: ['reverse', 'forward'],
      inputSha256s: [sha256HexSync(sourceLeft), sha256HexSync(right.sequence)],
      effectiveInputSha256s: [sha256HexSync(effectiveLeft), sha256HexSync(right.sequence)],
    });
  });

  it('validates a reverse-oriented caller digest against the source before applying orientation', () => {
    const effectiveLeft = `AAAAAAAA${O1}`;
    const sourceLeft = reverseComplement(effectiveLeft);
    const plan = planArtifactGibsonDesign({
      fragments: [
        cloningInput('left', sourceLeft, sha256HexSync(effectiveLeft), 'reverse'),
        cloningInput('right', `${O1}TTTTTTTT`),
      ],
      topology: 'linear',
    });

    expect(plan.status).toBe('blocked');
    expect(plan.product).toBeNull();
    expect(plan.provenance).toBeNull();
    expect(plan.errors).toContainEqual(expect.objectContaining({
      code: 'sha256_mismatch',
      recordId: 'left',
    }));
  });

  it('plans both junctions of a circular product and hashes the closed sequence', () => {
    const first = cloningInput('first', `${O2}AAAAAAAA${O1}`);
    const second = cloningInput('second', `${O1}TTTTTTTT${O2}`);
    const plan = planArtifactGibsonDesign({
      fragments: [first, second],
      topology: 'circular',
      minOverlap: 15,
      maxOverlap: 60,
    });

    expect(plan.status).toBe('ready');
    expect(plan.junctions).toHaveLength(2);
    expect(plan.junctions[1]).toMatchObject({
      leftRecordId: 'second',
      rightRecordId: 'first',
      closing: true,
      overlapSequence: O2,
    });
    expect(plan.product).toMatchObject({
      topology: 'circular',
      sequence: `${O2}AAAAAAAA${O1}TTTTTTTT`,
    });
    expect(plan.product?.sha256).toBe(sha256HexSync(plan.product?.sequence ?? ''));
  });

  it('makes a missing closing overlap a required preparation action', () => {
    const plan = planArtifactGibsonDesign({
      fragments: [
        cloningInput('left', `AAAAAAAA${O1}`),
        cloningInput('right', `${O1}TTTTTTTT`),
      ],
      topology: 'circular',
    });

    expect(plan.status).toBe('needs_preparation');
    expect(plan.product).toBeNull();
    expect(plan.junctions[1]).toMatchObject({ closing: true, status: 'missing_overlap' });
    expect(plan.preparation).toContainEqual(expect.objectContaining({
      id: 'homology:1',
      kind: 'add_homology',
      status: 'required',
      junctionIndex: 1,
    }));
  });

  it('surfaces low-Tm overlaps as review steps without discarding a valid product', () => {
    const low = 'ATATATATATAATAA';
    const plan = planArtifactGibsonDesign({
      fragments: [
        cloningInput('left', `GCGCGCGCGC${low}`),
        cloningInput('right', `${low}GCGCGCGCGC`),
      ],
      topology: 'linear',
    });

    expect(plan.status).toBe('ready');
    expect(plan.junctions[0].status).toBe('low_tm');
    expect(plan.preparation).toContainEqual(expect.objectContaining({
      kind: 'review_overlap_tm',
      status: 'recommended',
    }));
    expect(plan.warnings.some((entry) => /low Tm/i.test(entry.message))).toBe(true);
  });

  it('blocks malformed ranges, duplicate ids, and stale hashes before engine evaluation', () => {
    const first = cloningInput('duplicate', `AAAAAAAA${O1}`, 'f'.repeat(64));
    const second = cloningInput('duplicate', `${O1}TTTTTTTT`);
    const plan = planArtifactGibsonDesign({
      fragments: [first, second],
      topology: 'linear',
      minOverlap: 80,
      maxOverlap: 20,
    });

    expect(plan.status).toBe('blocked');
    expect(plan.junctions).toEqual([]);
    expect(plan.product).toBeNull();
    expect(plan.provenance).toBeNull();
    expect(plan.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sha256_mismatch' }),
      expect.objectContaining({ code: 'duplicate_record_id' }),
      expect.objectContaining({ code: 'invalid_overlap_range' }),
    ]));
  });

  it('blocks unsupported per-input orientation before engine evaluation', () => {
    const invalid = cloningInput('left', `AAAAAAAA${O1}`);
    // @ts-expect-error Runtime validation must still reject untyped external payloads.
    invalid.orientation = 'sideways';
    const plan = planArtifactGibsonDesign({
      fragments: [invalid, cloningInput('right', `${O1}TTTTTTTT`)],
      topology: 'linear',
    });

    expect(plan.status).toBe('blocked');
    expect(plan.product).toBeNull();
    expect(plan.provenance).toBeNull();
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'invalid_orientation', recordId: 'left' }));
  });

  it('produces the same request digest for equivalent whitespace and case normalization', () => {
    const compact = planArtifactGibsonDesign({
      fragments: [
        cloningInput('left', `AAAAAAAA${O1}`),
        cloningInput('right', `${O1}TTTTTTTT`),
      ],
      topology: 'linear',
    });
    const formatted = planArtifactGibsonDesign({
      fragments: [
        cloningInput('left', `aaaa aaaa\n${O1.toLowerCase()}`),
        cloningInput('right', `${O1.toLowerCase()}\ntttt tttt`),
      ],
      topology: 'linear',
    });

    expect(formatted.provenance?.inputSha256s).toEqual(compact.provenance?.inputSha256s);
    expect(formatted.provenance?.requestSha256).toBe(compact.provenance?.requestSha256);
  });
});
