import { describe, expect, it } from 'vitest';
import { reverseComplement } from '../../bio/reverse-complement';
import {
  ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS,
  ArtifactConstructVerificationError,
  verifyArtifactConstruct,
  type ArtifactConstructExpectedVariantInput,
  type ArtifactConstructReadInput,
  type ArtifactConstructVerificationInput,
} from '../claude-science-construct-verification';
import { sha256HexSync } from '../claude-science-sha256';

function deterministicDna(length: number, seed = 0x5eed1234): string {
  const bases = ['A', 'C', 'G', 'T'] as const;
  let state = seed >>> 0;
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    sequence += bases[(state >>> 28) & 3];
  }
  return sequence;
}

function read(
  id: string,
  baseCalls: string,
  qualityScores: readonly number[] | null = new Array(baseCalls.length).fill(40),
  name?: string,
): ArtifactConstructReadInput {
  return {
    id,
    ...(name === undefined ? {} : { name }),
    baseCalls,
    ...(qualityScores === null ? {} : { qualityScores }),
    sha256: sha256HexSync(baseCalls.toUpperCase()),
  };
}

function verificationInput(
  sequence: string,
  reads: ArtifactConstructReadInput[],
  overrides: Partial<Omit<ArtifactConstructVerificationInput, 'reference' | 'reads'>> = {},
  topology: 'linear' | 'circular' = 'linear',
): ArtifactConstructVerificationInput {
  return {
    reference: {
      id: 'reference',
      name: 'Reference display name',
      sequence,
      topology,
      sha256: sha256HexSync(sequence),
    },
    reads,
    ...overrides,
  };
}

function substitute(sequence: string, position: number): { sequence: string; alternate: string } {
  const referenceBase = sequence[position];
  const alternate = referenceBase === 'A' ? 'C' : 'A';
  return {
    sequence: `${sequence.slice(0, position)}${alternate}${sequence.slice(position + 1)}`,
    alternate,
  };
}

function expectedSubstitution(
  reference: string,
  position: number,
  alternate: string,
): ArtifactConstructExpectedVariantInput {
  return {
    id: `expected-${position}`,
    type: 'substitution',
    referenceStart: position,
    referenceEnd: position + 1,
    reference: reference[position],
    alternate,
  };
}

describe('verifyArtifactConstruct', () => {
  it('maps exact full-reference reads in both orientations and proves bidirectional depth', () => {
    const reference = deterministicDna(160);
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('forward', reference),
      read('reverse', reverseComplement(reference)),
    ], {
      requiredRegions: [{
        id: 'whole-reference',
        start: 0,
        end: reference.length,
        minDepth: 2,
        requireBothStrands: true,
      }],
    }));

    expect(result.state).toBe('consistent');
    expect(result.reasons).toEqual([]);
    expect(result.reads.map((entry) => entry.mapping?.orientation)).toEqual(['forward', 'reverse']);
    expect(result.coverage.depth).toEqual(new Array(reference.length).fill(2));
    expect(result.coverage.forward).toEqual(new Array(reference.length).fill(1));
    expect(result.coverage.reverse).toEqual(new Array(reference.length).fill(1));
    expect(result.coverage.requiredRegions[0]).toMatchObject({
      status: 'covered',
      bothStrandsCoveredBases: reference.length,
    });
    expect(result.consensus.sequence).toBe(reference);

    const reverseRawIndices = result.reads[1].mapping?.coordinateMap.rawCallIndices
      .filter((index): index is number => index !== null);
    expect(reverseRawIndices?.[0]).toBe(reference.length - 1);
    expect(reverseRawIndices?.at(-1)).toBe(0);
  });

  it('maps a circular read across the origin with wrapped coordinates', () => {
    const reference = deterministicDna(160, 0xabc123);
    const baseCalls = reference.slice(125) + reference.slice(0, 45);
    const result = verifyArtifactConstruct(verificationInput(reference, [read('origin-read', baseCalls)], {
      requiredRegions: [{ id: 'origin', start: 125, end: 45 }],
      thresholds: { minCoverageFraction: 0 },
    }, 'circular'));

    expect(result.state).toBe('consistent');
    expect(result.reads[0]).toMatchObject({
      status: 'mapped',
      mapping: { orientation: 'forward', referenceStart: 125, referenceEnd: 45, wraps: true },
    });
    expect(result.coverage.requiredRegions[0]).toMatchObject({ wraps: true, status: 'covered' });
  });

  it('proves a unique exact global maximum without exhaustively scanning a large reference', () => {
    const reference = deterministicDna(5_000, 0x101010);
    const baseCalls = reference.slice(2_100, 2_900);
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('large-exact-read', baseCalls),
    ], { thresholds: { minCoverageFraction: 0, minMappingMargin: 0 } }));

    expect(result.reads[0]).toMatchObject({
      status: 'mapped',
      mapping: {
        orientation: 'forward',
        referenceStart: 2_100,
        score: baseCalls.length * 3,
        secondBestScore: null,
      },
    });
    expect(result.state).toBe('consistent');
  });

  it('enforces mapping margin against a near-exact runner-up even with one exact locus', () => {
    const baseCalls = deterministicDna(100, 0x303030);
    const nearCopy = substitute(baseCalls, 50).sequence;
    const reference = [
      deterministicDna(20, 0x303031),
      baseCalls,
      deterministicDna(20, 0x303032),
      nearCopy,
      deterministicDna(20, 0x303033),
    ].join('');
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('exact-with-near-copy', baseCalls),
    ], { thresholds: { minCoverageFraction: 0 } }));

    expect(result.reads[0]).toMatchObject({
      status: 'ambiguous_mapping',
      mapping: {
        referenceStart: 20,
        score: baseCalls.length * 3,
        secondBestScore: (baseCalls.length * 3) - 6,
        mappingMargin: 0.02,
      },
    });
    expect(result.state).toBe('needs_review');
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: 'ambiguous_mapping',
      readId: 'exact-with-near-copy',
    }));
  });

  it('proves the default runner-up margin for two exact full-length reads within the shared budget', () => {
    const reference = deterministicDna(240, 0x404040);
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('full-forward', reference),
      read('full-reverse', reverseComplement(reference)),
    ], { thresholds: { minCoverageFraction: 0, requireBothStrands: true } }));

    expect(result.reads).toEqual([
      expect.objectContaining({ status: 'mapped', mapping: expect.objectContaining({ orientation: 'forward' }) }),
      expect.objectContaining({ status: 'mapped', mapping: expect.objectContaining({ orientation: 'reverse' }) }),
    ]);
    expect(result.state).toBe('consistent');
    expect(result.provenance.workUnits).toBeLessThan(ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxWorkUnits);
  });

  it('keeps non-exhaustive seeded mappings review-only in either orientation', () => {
    const reference = deterministicDna(5_000, 0x202020);
    const source = reference.slice(2_400, 2_600);
    const changed = substitute(source, 100).sequence;
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('large-forward-noisy', changed),
      read('large-reverse-noisy', reverseComplement(changed)),
    ], { thresholds: { minCoverageFraction: 0 } }));

    expect(result.reads).toEqual([
      expect.objectContaining({
        status: 'ambiguous_mapping',
        mapping: expect.objectContaining({ orientation: 'forward', referenceStart: 2_400 }),
      }),
      expect.objectContaining({
        status: 'ambiguous_mapping',
        mapping: expect.objectContaining({ orientation: 'reverse', referenceStart: 2_400 }),
      }),
    ]);
    expect(result.state).toBe('needs_review');
    expect(result.reasons.filter((entry) => entry.code === 'ambiguous_mapping')).toHaveLength(2);
  });

  it('makes an unexpected high-confidence SNV inconsistent and accepts it when expected', () => {
    const reference = deterministicDna(150, 0x1234567);
    const changed = substitute(reference, 73);
    const unexpected = verifyArtifactConstruct(verificationInput(reference, [read('variant-read', changed.sequence)]));

    expect(unexpected.state).toBe('inconsistent');
    expect(unexpected.reasons).toContainEqual(expect.objectContaining({ code: 'unexpected_variant' }));
    expect(unexpected.variants.observed).toContainEqual(expect.objectContaining({
      type: 'substitution',
      referenceStart: 73,
      reference: reference[73],
      alternate: changed.alternate,
      confidence: 'high',
    }));

    const expected = verifyArtifactConstruct(verificationInput(reference, [read('variant-read', changed.sequence)], {
      expectedVariants: [expectedSubstitution(reference, 73, changed.alternate)],
    }));
    expect(expected.state).toBe('consistent');
    expect(expected.variants.expected[0]).toMatchObject({ status: 'observed' });
    expect(expected.variants.unexpected).toEqual([]);
  });

  it('distinguishes a covered missing expected variant from inconclusive coverage', () => {
    const reference = deterministicDna(150, 0x9911);
    const alternate = reference[100] === 'A' ? 'C' : 'A';
    const expected = expectedSubstitution(reference, 100, alternate);
    const absent = verifyArtifactConstruct(verificationInput(reference, [read('reference-read', reference)], {
      expectedVariants: [expected],
    }));
    expect(absent.state).toBe('inconsistent');
    expect(absent.variants.expected[0]).toMatchObject({ status: 'not_observed', depth: 1 });
    expect(absent.reasons).toContainEqual(expect.objectContaining({ code: 'expected_variant_not_observed' }));

    const partial = verifyArtifactConstruct(verificationInput(reference, [
      read('left-read', reference.slice(0, 70)),
    ], {
      expectedVariants: [expected],
      thresholds: { minCoverageFraction: 0 },
    }));
    expect(partial.state).toBe('needs_review');
    expect(partial.variants.expected[0]).toMatchObject({ status: 'not_covered', depth: 0 });
    expect(partial.reasons).toContainEqual(expect.objectContaining({
      code: 'expected_variant_not_covered',
      severity: 'review',
    }));

    const missingQuality = verifyArtifactConstruct(verificationInput(reference, [
      read('qualityless-reference', reference, null),
    ], { expectedVariants: [expected] }));
    expect(missingQuality.state).toBe('needs_review');
    expect(missingQuality.variants.expected[0]).toMatchObject({ status: 'not_covered', depth: 0 });
    expect(missingQuality.reasons.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'missing_quality',
      'expected_variant_not_covered',
    ]));

    const internalLowQuality = new Array(reference.length).fill(40);
    internalLowQuality[100] = 5;
    const lowQuality = verifyArtifactConstruct(verificationInput(reference, [
      read('low-quality-reference', reference, internalLowQuality),
    ], { expectedVariants: [expected] }));
    expect(lowQuality.state).toBe('needs_review');
    expect(lowQuality.variants.expected[0]).toMatchObject({ status: 'not_covered', depth: 0 });
  });

  it('treats missing quality and low-confidence edits as review-only and gates consensus edits', () => {
    const reference = deterministicDna(140, 0x445566);
    const changed = substitute(reference, 64);
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('qualityless', changed.sequence, null),
    ]));

    expect(result.state).toBe('needs_review');
    expect(result.reasons.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'missing_quality',
      'low_confidence_variant',
    ]));
    expect(result.variants.observed[0]).toMatchObject({ confidence: 'low' });
    expect(result.consensus.calls[64]).toMatchObject({ call: 'N', status: 'conflict' });
    expect(result.consensus.sequence[64]).toBe('N');
    expect(result.consensus.variants).toEqual([]);
    expect(result.reasons.some((entry) => entry.code === 'conflicting_consensus')).toBe(false);
  });

  it('quality-trims ends without changing calls and reports resulting partial coverage', () => {
    const reference = deterministicDna(140, 0x998877);
    const qualities = [
      ...new Array(15).fill(5),
      ...new Array(110).fill(40),
      ...new Array(15).fill(5),
    ];
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('trimmed', reference, qualities),
    ], { thresholds: { trimWindow: 5 } }));

    expect(result.state).toBe('needs_review');
    expect(result.reads[0]).toMatchObject({
      status: 'mapped',
      trim: { rawStart: 13, rawEnd: 127, trimmedLength: 114 },
    });
    expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'partial_reference_coverage' }));
  });

  it('does not turn an IUPAC no-call into identity, depth, conflict, or supported absence', () => {
    const reference = deterministicDna(140, 0x2020);
    const noCallPosition = 71;
    const withNoCall = `${reference.slice(0, noCallPosition)}N${reference.slice(noCallPosition + 1)}`;
    const alternate = reference[noCallPosition] === 'A' ? 'C' : 'A';
    const result = verifyArtifactConstruct(verificationInput(reference, [read('n-call', withNoCall)], {
      expectedVariants: [expectedSubstitution(reference, noCallPosition, alternate)],
    }));

    expect(result.state).toBe('needs_review');
    expect(result.reads[0].mapping?.matches).toBe(reference.length - 1);
    expect(result.coverage.depth[noCallPosition]).toBe(0);
    expect(result.consensus.calls[noCallPosition]).toMatchObject({ status: 'uncovered', call: 'N' });
    expect(result.variants.expected[0]).toMatchObject({ status: 'not_covered', depth: 0 });
    expect(result.reasons.some((entry) => entry.code === 'conflicting_consensus')).toBe(false);
  });

  it('requires one read to span both insertion flanks before declaring expected absence', () => {
    const reference = deterministicDna(160, 0x8181);
    const expected: ArtifactConstructExpectedVariantInput = {
      id: 'expected-insertion',
      type: 'insertion',
      referenceStart: 80,
      referenceEnd: 80,
      reference: '',
      alternate: 'GG',
    };
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('left-only', reference.slice(25, 80)),
      read('right-only', reference.slice(80, 135)),
    ], {
      expectedVariants: [expected],
      thresholds: { minCoverageFraction: 0 },
    }));

    expect(result.state).toBe('needs_review');
    expect(result.coverage.depth[79]).toBe(1);
    expect(result.coverage.depth[80]).toBe(1);
    expect(result.variants.expected[0]).toMatchObject({ status: 'not_covered', depth: 0 });
  });

  it('requires one read to span an entire deletion event before declaring expected absence', () => {
    const reference = deterministicDna(160, 0x9191);
    const deletionStart = Array.from({ length: 41 }, (_, offset) => 60 + offset)
      .find((position) => reference[position - 1] !== reference[position + 2]) as number;
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('deletion-left', reference.slice(deletionStart - 55, deletionStart + 2)),
      read('deletion-right', reference.slice(deletionStart + 2, deletionStart + 57)),
    ], {
      expectedVariants: [{
        id: 'expected-deletion',
        type: 'deletion',
        referenceStart: deletionStart,
        referenceEnd: deletionStart + 3,
        reference: reference.slice(deletionStart, deletionStart + 3),
        alternate: '',
      }],
      thresholds: { minCoverageFraction: 0 },
    }));

    expect(result.coverage.depth.slice(deletionStart, deletionStart + 3)).toEqual([1, 1, 1]);
    expect(result.variants.expected[0]).toMatchObject({ status: 'not_covered', depth: 0 });
    expect(result.state).toBe('needs_review');
  });

  it('calls bounded insertions and applies the same high-confidence consensus gate', () => {
    const reference = deterministicDna(150, 0x31337);
    const position = 70;
    const insertedBase = reference[position - 1] === 'A' ? 'C' : 'A';
    const alternate = insertedBase.repeat(3);
    const insertedRead = `${reference.slice(0, position)}${alternate}${reference.slice(position)}`;
    const result = verifyArtifactConstruct(verificationInput(reference, [read('insertion-read', insertedRead)], {
      expectedVariants: [{
        id: 'expected-insertion',
        type: 'insertion',
        referenceStart: position,
        referenceEnd: position,
        reference: '',
        alternate,
      }],
    }));

    expect(result.state).toBe('consistent');
    expect(result.variants.expected[0]).toMatchObject({ status: 'observed' });
    expect(result.consensus.variants).toContainEqual(expect.objectContaining({
      type: 'insertion',
      alternate,
    }));
    expect(result.consensus.sequence).toBe(insertedRead);
  });

  it('uses quality weights, not a raw read majority, for consensus and variant fraction', () => {
    const reference = deterministicDna(140, 0x5151);
    const position = 67;
    const changed = substitute(reference, position);
    const lowReferenceQuality = new Array(reference.length).fill(40);
    lowReferenceQuality[position] = 5;
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('low-reference', reference, lowReferenceQuality),
      read('high-alternate', changed.sequence),
    ]));

    expect(result.state).toBe('inconsistent');
    expect(result.consensus.calls[position]).toMatchObject({ call: changed.alternate, status: 'variant' });
    expect(result.variants.observed[0].fraction).toBeGreaterThan(0.8);
    expect(result.variants.observed[0]).toMatchObject({ confidence: 'high', support: 1, depth: 2 });
  });

  it('left-normalizes repeat-context indels before matching expected variants', () => {
    const reference = `${deterministicDna(69, 0x111)}CAAAAAA${deterministicDna(70, 0x222)}`;
    const deletedRead = `${reference.slice(0, 73)}${reference.slice(74)}`;
    const result = verifyArtifactConstruct(verificationInput(reference, [read('deletion-read', deletedRead)], {
      expectedVariants: [{
        id: 'expected-repeat-deletion',
        type: 'deletion',
        referenceStart: 73,
        referenceEnd: 74,
        reference: 'A',
        alternate: '',
      }],
    }));

    expect(result.variants.expected[0]).toMatchObject({
      status: 'observed',
      referenceStart: 70,
      referenceEnd: 71,
    });
    expect(result.variants.observed[0]).toMatchObject({
      type: 'deletion',
      referenceStart: 70,
      referenceEnd: 71,
      expectedVariantId: 'expected-repeat-deletion',
    });
    expect(result.state).toBe('consistent');
    expect(result.consensus.variants).toContainEqual(expect.objectContaining({
      type: 'deletion',
      referenceStart: 70,
    }));
    expect(result.consensus.sequence).toBe(`${reference.slice(0, 70)}${reference.slice(71)}`);
  });

  it('keeps repeated loci ambiguous and multi-lap circular mappings review-only', () => {
    const repeatedReference = 'ACGT'.repeat(40);
    const repeated = verifyArtifactConstruct(verificationInput(repeatedReference, [
      read('repeat', 'ACGT'.repeat(15)),
    ], { thresholds: { minCoverageFraction: 0 } }));
    expect(repeated.state).toBe('needs_review');
    expect(repeated.reads[0].status).toBe('ambiguous_mapping');

    const circularReference = deterministicDna(60, 0x9090);
    const multiLap = circularReference + circularReference.slice(0, 45);
    const circular = verifyArtifactConstruct(verificationInput(circularReference, [
      read('multi-lap', multiLap),
    ], { thresholds: { minCoverageFraction: 0 } }, 'circular'));
    expect(circular.state).toBe('needs_review');
    expect(circular.reads[0].status).toBe('ambiguous_mapping');
    expect(circular.coverage.coveredBases).toBe(0);
  });

  it('recovers a noisy true locus when exhaustive scoring fits the work budget', () => {
    const uniqueLocus = `AAAAAAAAAAA${deterministicDna(109, 0x424242)}`;
    const reference = `${'A'.repeat(700)}${uniqueLocus}${deterministicDna(80, 0x1212)}`;
    let noisyRead = uniqueLocus;
    const expectedVariants: ArtifactConstructExpectedVariantInput[] = [];
    for (let offset = 20; offset < uniqueLocus.length; offset += 10) {
      const absolute = 700 + offset;
      const changed = substitute(noisyRead, offset);
      noisyRead = changed.sequence;
      expectedVariants.push(expectedSubstitution(reference, absolute, changed.alternate));
    }
    const result = verifyArtifactConstruct(verificationInput(reference, [read('late-locus', noisyRead)], {
      expectedVariants,
      thresholds: { minCoverageFraction: 0 },
    }));

    expect(result.reads[0]).toMatchObject({
      status: 'mapped',
      mapping: { referenceStart: 700, orientation: 'forward' },
    });
    expect(result.state).toBe('consistent');
  });

  it('cannot promote an omitted equal-scoring locus to a unique mapping', () => {
    const bases = ['A', 'C', 'G', 'T'] as const;
    let readState = 777;
    let baseCalls = '';
    for (let index = 0; index < 100; index += 1) {
      readState = (Math.imul(readState, 1_664_525) + 1_013_904_223) >>> 0;
      baseCalls += bases[Math.floor((readState / (2 ** 32)) * 4)];
    }
    const mutateAt = (positions: readonly number[]) => {
      const calls = [...baseCalls];
      for (const position of positions) calls[position] = calls[position] === 'A' ? 'C' : 'A';
      return calls.join('');
    };
    const mutationSets = [
      [57, 64, 66, 90, 94, 95],
      [22, 28, 29, 31, 32, 41, 43, 46],
      [39, 40, 43, 44, 74, 81, 87, 88, 94],
      [5, 33, 34, 35, 38, 39, 40, 71, 79],
      [39, 40, 44, 46, 63, 67, 69, 80],
      [5, 10, 17, 21, 27, 28, 34, 35, 46],
      [5, 6, 11, 22, 25, 30, 33, 68, 70],
      [4, 21, 24, 26, 38, 69, 74, 77],
      [13, 15, 19, 62, 64, 79, 80, 81, 83, 86],
      [54, 63, 65, 67, 73, 83, 88, 89],
      [15, 20, 29, 77, 80, 82, 84, 85, 93],
      [26, 46, 55, 58, 60, 61, 90, 91, 92],
      [6, 18, 20, 72, 78, 82, 89, 91],
      [34, 39, 43, 50, 55, 73, 74, 75, 78],
      [12, 24, 25, 28, 29, 34, 44, 45, 50, 52],
      [16, 19, 21, 26, 48, 53, 55, 91],
      [18, 41, 57, 70, 75, 89],
    ] as const;
    let spacerState = 991;
    const nextSpacer = () => {
      let spacer = '';
      for (let index = 0; index < 80; index += 1) {
        spacerState = (Math.imul(spacerState, 1_664_525) + 1_013_904_223) >>> 0;
        spacer += bases[(spacerState >>> 28) & 3];
      }
      return spacer;
    };
    const reference = `${mutationSets.map((positions) => (
      `${nextSpacer()}${mutateAt(positions)}`
    )).join('')}${nextSpacer()}`;

    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('candidate-cap-read', baseCalls),
    ], { thresholds: { minCoverageFraction: 0 } }));

    expect(result.reads[0]).toMatchObject({
      status: 'ambiguous_mapping',
      mapping: { referenceStart: 80, score: 264 },
    });
    expect(result.reads[0].mapping?.secondBestScore).toBeNull();
    expect(result.reads[0].mapping?.mappingMargin).toBeNull();
    expect(result.state).toBe('needs_review');
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: 'ambiguous_mapping',
      readId: 'candidate-cap-read',
    }));
  });

  it('scores equal loci hidden inside one seed-vote neighborhood', () => {
    const baseCalls = 'GAGCTCAACCGTACTGGATTCACGTCGATTCCAGCCGGGC';
    const reference = [
      'ATAGCATTTCCAATCTCAAGGCGAAGATGT',
      'GAGCTAACCCATAATAGCTTCACGTCGATTCCAGCCGAGC',
      'AACTCTCC',
      'GAACTAACCCGTACTGGATTCAAGTCGCTTACAGCAGGGC',
      'CCACGCAGGGCTGGTAGGTGAAGAGAGATA',
    ].join('');
    const result = verifyArtifactConstruct(verificationInput(reference, [
      read('clustered-equal-score-read', baseCalls),
    ], { thresholds: { minCoverageFraction: 0 } }));

    expect(result.reads[0]).toMatchObject({
      status: 'ambiguous_mapping',
      mapping: { referenceStart: 30, score: 79, secondBestScore: 79, mappingMargin: 0 },
    });
    expect(result.state).toBe('needs_review');
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: 'ambiguous_mapping',
      readId: 'clustered-equal-score-read',
    }));
  });

  it('is deterministic, does not mutate input, and hashes scientific identity rather than names/order', () => {
    const reference = deterministicDna(130, 0x777);
    const original = verificationInput(reference, [
      read('b-read', reference, null, 'Second display name'),
      read('a-read', reverseComplement(reference), new Array(reference.length).fill(40), 'First display name'),
    ]);
    const snapshot = structuredClone(original);
    const first = verifyArtifactConstruct(original);
    const second = verifyArtifactConstruct(original);
    expect(second).toEqual(first);
    expect(original).toEqual(snapshot);

    const renamedAndReordered = structuredClone(original);
    renamedAndReordered.reference.name = 'Renamed reference';
    renamedAndReordered.reads = [...renamedAndReordered.reads].reverse().map((entry) => ({
      ...entry,
      name: `Renamed ${entry.id}`,
    }));
    const renamed = verifyArtifactConstruct(renamedAndReordered);
    expect(renamed.provenance.requestSha256).toBe(first.provenance.requestSha256);
    expect(first.provenance.engine).toBe('motif-construct-verification');
    expect(first.provenance.engineVersion).toBe('1');
  });

  it('rejects malformed hashes, quality arrays, and oversized inputs with typed codes', () => {
    const reference = deterministicDna(80);
    const badHash = verificationInput(reference, [read('read', reference)]);
    badHash.reference.sha256 = '0'.repeat(64);
    expect(() => verifyArtifactConstruct(badHash)).toThrowError(expect.objectContaining({
      name: 'ArtifactConstructVerificationError',
      code: 'invalid_input',
    }));

    const badQuality = verificationInput(reference, [{
      ...read('read', reference),
      qualityScores: [40],
    }]);
    expect(() => verifyArtifactConstruct(badQuality)).toThrowError(ArtifactConstructVerificationError);
    try {
      verifyArtifactConstruct(badQuality);
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_input' });
    }

    const oversizedReference = 'A'.repeat(
      ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReferenceLength + 1,
    );
    expect(() => verifyArtifactConstruct({
      reference: {
        id: 'too-large',
        sequence: oversizedReference,
        topology: 'linear',
        sha256: sha256HexSync(oversizedReference),
      },
      reads: [],
    })).toThrowError(expect.objectContaining({ code: 'too_large' }));
  });

  it('fails closed when repetitive alignment work exceeds the explicit budget', { timeout: 20_000 }, () => {
    const reference = 'A'.repeat(ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReferenceLength);
    const baseCalls = `${'A'.repeat(ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReadLength - 1)}C`;
    const input = verificationInput(reference, [
      read('repeat-1', baseCalls),
      read('repeat-2', baseCalls),
      read('repeat-3', baseCalls),
      read('repeat-4', baseCalls),
    ]);
    expect(() => verifyArtifactConstruct(input)).toThrowError(expect.objectContaining({
      code: 'work_budget',
    }));
  });
});
