import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import vectors from '../../../public/data/vectors.json';
import {
  computePrimerPairTailStructureWarnings,
  DEFAULT_PRIMER_TM_CONDITION_PRESET_ID,
  designForwardPrimerWithDiagnostics,
  designPrimerPairWithDiagnostics,
  designReversePrimerWithDiagnostics,
  ENZYME_TAIL_PRESETS,
  PRIMER_TAIL_STRUCTURE_3_PRIME_REVIEW_CODE,
  PRIMER_TM_CONDITION_PRESETS,
  primerPairTailStructureWarnings,
  primerTailStructureReviewCodes,
  type PrimerCandidate,
  type PrimerDesignParams,
  type PrimerTailStructureWarning,
} from '../primer-design';
import { predictHairpin, predictSelfDimer } from '../primer-thermodynamics';
import { reverseComplement } from '../reverse-complement';

// Structure screening vetoes what the annealing region forms by itself; what
// needs the 5′ tail is a warning. These tests pin both halves of that rule and
// the promise that nothing else moved.

const sequenceOf = (name: string): string => {
  const record = (vectors as Array<{ name: string; sequence: string }>).find((entry) => entry.name === name);
  if (!record) throw new Error(`missing fixture ${name}`);
  return record.sequence;
};
const tmPreset = PRIMER_TM_CONDITION_PRESETS.find((preset) => preset.id === DEFAULT_PRIMER_TM_CONDITION_PRESET_ID)!;
// The primer workspace's Standard PCR request.
const workspaceParams = (overrides: Partial<PrimerDesignParams>): PrimerDesignParams => ({
  targetStart: 0,
  targetEnd: 1,
  minLength: 18,
  maxLength: 28,
  targetTm: 60,
  tmTolerance: 5,
  minGC: 0.3,
  maxGC: 0.7,
  flankingWindow: 50,
  requireGcClamp: true,
  tmConditionPresetId: tmPreset.id,
  tmOptions: { ...tmPreset.options },
  maxCrossDimerDeltaG: -5,
  maxPairs: 10,
  ...overrides,
});
const tailOf = (name: string): string => ENZYME_TAIL_PRESETS.find((preset) => preset.name === name)!.tail;
const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const lacZ = { targetStart: 149, targetEnd: 506 };
const pairKey = (pair: { forward: PrimerCandidate; reverse: PrimerCandidate }) => (
  `${pair.forward.start}-${pair.forward.end}:${pair.reverse.start}-${pair.reverse.end}:${pair.forward.fullSequence}:${pair.reverse.fullSequence}`
);
const tier = (warnings: readonly PrimerTailStructureWarning[] | undefined): number => (
  !warnings || warnings.length === 0 ? 0 : warnings.some((warning) => warning.threePrimeDeltaG !== null) ? 2 : 1
);

describe('primer tail structure: veto on the annealing region, warn on the tail', () => {
  // Hashes of the complete result objects, recorded from the engine before the
  // tail rule existed. Any change to an untailed design changes one of them.
  it('returns byte-identical results for every untailed design', () => {
    const fixture = 'ATGCGTACGATCCGTAAGCTGACCTAGTCGATGCTACGGTCAATCG'.repeat(24);
    const cases: Array<[string, string, PrimerDesignParams, string]> = [
      ['pUC19 standard', sequenceOf('pUC19'), workspaceParams(lacZ), '1010898cd021da71d3e4904cf44e39dda2f4556344abcf4627c3b91d172e3a5c'],
      ['pET-28a standard', sequenceOf('pET-28a(+)'), workspaceParams({ targetStart: 50, targetEnd: 550 }), '765d29ba2111d029d6087ccfe372739d06110f7d4b8768649e7580a9975fb5cf'],
      ['pUC19 cloning', sequenceOf('pUC19'), workspaceParams({ ...lacZ, minLength: 20, maxLength: 32, targetTm: 62, tmTolerance: 4, flankingWindow: 75 }), '0c93fb3cb120b61ae7ba719838bb75c3bc2ee713df68018fc9a14f18e1f18395'],
      ['pUC19 touchdown', sequenceOf('pUC19'), workspaceParams({ ...lacZ, minLength: 22, maxLength: 30, targetTm: 65, tmTolerance: 3, minGC: 0.4 }), 'c0f541e0c949b74c29ad13b47f58b5e1cf0bb920ed3cb1a3d135dc7467ce6ecc'],
      ['repeat fixture', fixture, workspaceParams({ targetStart: 350, targetEnd: 750 }), '8f5c4a1c7c8ec9dd11eccb9d15d849cdedc941ad099c1835a15f5b113555d22c'],
      ['pBR322 wide scan', sequenceOf('pBR322'), workspaceParams({ targetStart: 1000, targetEnd: 1600, maxLength: 36, flankingWindow: 250, tmTolerance: 8, requireGcClamp: false }), 'f9f50ee42a4388736e13d52d3ff4f58d033310bbb044b42d11cea4e646d5f7f0'],
      ['pUC19 wide scan', sequenceOf('pUC19'), workspaceParams({ ...lacZ, maxLength: 36, flankingWindow: 250, tmTolerance: 8, requireGcClamp: false }), '2c52783946e2e010894d4f367493be5f0690760627a6451234840850f810de40'],
      ['engine defaults', 'ACGT'.repeat(80), { targetStart: 20, targetEnd: 80 }, '27d5a07671fa71ab129dc2efa1b9869faea310280fb695690e3d39cd119a5dcf'],
    ];
    for (const [label, sequence, params, expected] of cases) {
      expect(sha256(designPrimerPairWithDiagnostics(sequence, params)), label).toBe(expected);
    }
    // The directional scans, including every candidate's order, for the two largest scans.
    const puc = sequenceOf('pUC19');
    expect(sha256(designForwardPrimerWithDiagnostics(puc, workspaceParams(lacZ)))).toBe('57bf6efdc15ba45d566f2e3584283431d5f6316481320882bb310666a760fa82');
    expect(sha256(designReversePrimerWithDiagnostics(puc, workspaceParams(lacZ)))).toBe('222d5cd53bc3f018db0e635f0450bcc97dc06f07ec31631393a742cb9b11baea');
    const wide = workspaceParams({ ...lacZ, maxLength: 36, flankingWindow: 250, tmTolerance: 8, requireGcClamp: false });
    expect(sha256(designForwardPrimerWithDiagnostics(puc, wide))).toBe('7d91c5f09bd95ee490ce5aab1057ae144785354115cbc12625a144a9ee86d072');
    expect(sha256(designReversePrimerWithDiagnostics(puc, wide))).toBe('3fe9bb37ce86128e1980c9c763a644b35d8dcb85a9378ac1aa5e7622cd5b57a3');
  }, 120_000);

  it('keeps the EcoRI/HindIII ranking that already returned pairs', () => {
    const tails = { forwardTail: tailOf('EcoRI'), reverseTail: tailOf('HindIII') };
    const puc = designPrimerPairWithDiagnostics(sequenceOf('pUC19'), workspaceParams({ ...lacZ, ...tails }));
    const pet = designPrimerPairWithDiagnostics(sequenceOf('pET-28a(+)'), workspaceParams({ targetStart: 50, targetEnd: 550, ...tails }));
    expect(sha256(puc.pairs.map(pairKey))).toBe('35c793741e69e5ea013f8e4870557809d02eb73a6675e9e2dcc1ce5738b2ab54');
    expect(sha256(pet.pairs.map(pairKey))).toBe('d574945aafd9bfa4b7f48d0d9e51f2dc39841c5d6944ffe05e1f5f11cf980a9e');
    expect([...puc.pairs, ...pet.pairs].every((pair) => primerPairTailStructureWarnings(pair).length === 0)).toBe(true);
  }, 120_000);

  it('returns pairs for an NdeI/XhoI design and names the site and ΔG of the tail structure', () => {
    const result = designPrimerPairWithDiagnostics(sequenceOf('pUC19'), workspaceParams({
      ...lacZ,
      forwardTail: tailOf('NdeI'),
      reverseTail: tailOf('XhoI'),
    }));
    // Before this rule the same request returned 0 pairs: CTCGAG is its own
    // reverse complement, so every tailed reverse oligo failed self-dimer.
    expect(result.pairs).toHaveLength(10);
    const xhoI = result.pairs
      .flatMap((pair) => primerPairTailStructureWarnings(pair))
      .find((warning) => warning.site?.name === 'XhoI');
    expect(xhoI).toBeDefined();
    expect(xhoI?.site?.sequence).toBe('CTCGAG');
    expect(xhoI?.deltaG).toBeLessThan(xhoI?.cutoff ?? 0);
    expect(xhoI?.message).toMatch(/XhoI site CTCGAG/);
    expect(xhoI?.message).toMatch(/−\d+\.\d kcal\/mol/);
    // Every returned oligo's annealing region passes both structure cutoffs alone.
    for (const pair of result.pairs) {
      for (const candidate of [pair.forward, pair.reverse]) {
        expect(predictHairpin(candidate.sequence).deltaG).toBeGreaterThanOrEqual(-3);
        expect(predictSelfDimer(candidate.sequence).deltaG).toBeGreaterThanOrEqual(-5);
      }
    }
  }, 60_000);

  it('still rejects a candidate whose annealing region folds on its own, tail or not', () => {
    const params: PrimerDesignParams = {
      targetStart: 40,
      targetEnd: 60,
      minLength: 18,
      maxLength: 18,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 0,
    };
    // ACGT repeats are self-complementary, so the annealing region fails by itself.
    const untailed = designForwardPrimerWithDiagnostics('ACGT'.repeat(40), params);
    const tailed = designForwardPrimerWithDiagnostics('ACGT'.repeat(40), { ...params, forwardTail: tailOf('XhoI') });
    expect(untailed.candidates).toEqual([]);
    expect(tailed.candidates).toEqual([]);
    expect((tailed.rejections.hairpin ?? 0) + (tailed.rejections.dimer ?? 0)).toBeGreaterThan(0);
    expect((tailed.rejections.hairpin ?? 0) + (tailed.rejections.dimer ?? 0))
      .toBe((untailed.rejections.hairpin ?? 0) + (untailed.rejections.dimer ?? 0));
  });

  it('flags a tail that pairs the primer’s own 3′ end for review and ranks it after cleaner candidates', () => {
    // The best-ranked forward primer for the pUC19 lacZ target (bases
    // 147-164), so the scan below returns it and the candidates that share
    // its 3′ end.
    const binding = 'TATGCGGCATCAGAGCAG';
    // Tail = GC clamp + the reverse complement of the primer's last 8 bases:
    // the 3′ end folds back onto the tail and can be extended.
    const selfPriming = computePrimerPairTailStructureWarnings({
      forward: { sequence: binding, tail: `GCGC${reverseComplement(binding.slice(-8))}` },
      reverse: { sequence: 'GGAAGCATTATTTTCGCAAAATGTAC', tail: '' },
    });
    expect(selfPriming.length).toBeGreaterThan(0);
    expect(selfPriming.every((warning) => warning.threePrimeDeltaG !== null && warning.involves === 'tail-and-annealing')).toBe(true);
    expect(selfPriming[0].message).toMatch(/3′ end pairs .* and can extend/);
    expect(primerTailStructureReviewCodes(selfPriming)).toEqual([PRIMER_TAIL_STRUCTURE_3_PRIME_REVIEW_CODE]);

    // A palindromic site that pairs only within the tail warns without review.
    const palindrome = computePrimerPairTailStructureWarnings({
      forward: { sequence: binding, tail: tailOf('XhoI') },
      reverse: { sequence: 'GGAAGCATTATTTTCGCAAAATGTAC', tail: '' },
    });
    expect(palindrome.map((warning) => [warning.kind, warning.involves, warning.threePrimeDeltaG])).toEqual([['self-dimer', 'tail', null]]);
    expect(primerTailStructureReviewCodes(palindrome)).toEqual([]);

    // In a scan, every clean candidate ranks before any warned one, and every
    // tail-only warning before any 3′-end warning.
    const scan = designForwardPrimerWithDiagnostics(sequenceOf('pUC19'), workspaceParams({
      ...lacZ,
      forwardTail: `GCGC${reverseComplement(binding.slice(-8))}`,
    }));
    const tiers = scan.candidates.map((candidate) => tier(candidate.tailStructureWarnings));
    expect(new Set(tiers)).toEqual(new Set([0, 1, 2]));
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  }, 60_000);
});
