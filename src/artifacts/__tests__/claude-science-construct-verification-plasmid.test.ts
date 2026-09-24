import { describe, expect, it } from 'vitest';
import vectors from '../../../public/data/vectors.json';
import { reverseComplement } from '../../bio/reverse-complement';
import {
  ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS,
  verifyArtifactConstruct,
  type ArtifactConstructReadInput,
  type ArtifactConstructReadVerification,
  type ArtifactConstructVerificationResult,
  type ArtifactConstructVerificationThresholds,
} from '../claude-science-construct-verification';
import { sha256HexSync } from '../claude-science-sha256';

// Plasmid-scale mapping fixtures: Sanger-length reads cut from bundled records and
// from a random 10 kb reference, with the errors real reads carry.

function bundled(name: string): string {
  const record = (vectors as Array<{ name: string; sequence: string }>).find((entry) => entry.name === name);
  if (record === undefined) throw new Error(`Missing bundled record ${name}`);
  return record.sequence.toUpperCase();
}

function deterministicDna(length: number, seed: number): string {
  const bases = ['A', 'C', 'G', 'T'] as const;
  let state = seed >>> 0;
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    sequence += bases[(state >>> 28) & 3];
  }
  return sequence;
}

const PET28A = bundled('pET-28a(+)');
const PETDUET = bundled('pETDuet-1');
const RANDOM_10KB = deterministicDna(10_000, 0x10c0ffee);

function circularSlice(sequence: string, start: number, length: number): string {
  let slice = '';
  for (let offset = 0; offset < length; offset += 1) slice += sequence[(start + offset) % sequence.length];
  return slice;
}

function otherBase(base: string): string {
  return base === 'A' ? 'C' : 'A';
}

/** Substitute the template call at each offset; returns the edited calls and the new bases. */
function withSubstitutions(template: string, offsets: readonly number[]): { calls: string; alternates: string[] } {
  const calls = [...template];
  const alternates = offsets.map((offset) => {
    calls[offset] = otherBase(calls[offset]);
    return calls[offset];
  });
  return { calls: calls.join(''), alternates };
}

type ReadOptions = {
  qualityScores?: number[];
  reverse?: boolean;
};

function sangerRead(id: string, calls: string, options: ReadOptions = {}): ArtifactConstructReadInput {
  let baseCalls = calls;
  let qualityScores = options.qualityScores ?? new Array<number>(calls.length).fill(40);
  if (options.reverse) {
    baseCalls = reverseComplement(calls).toUpperCase();
    qualityScores = [...qualityScores].reverse();
  }
  return { id, name: `${id}.ab1`, baseCalls, qualityScores, sha256: sha256HexSync(baseCalls) };
}

function verify(
  reference: string,
  reads: ArtifactConstructReadInput[],
  thresholds: Partial<ArtifactConstructVerificationThresholds> = {},
): ArtifactConstructVerificationResult {
  return verifyArtifactConstruct({
    reference: {
      id: 'plasmid',
      name: 'Plasmid reference',
      sequence: reference,
      topology: 'circular',
      sha256: sha256HexSync(reference),
    },
    reads,
    thresholds: { minCoverageFraction: 0, ...thresholds },
  });
}

/** Reference position of the column that aligns a given raw call, or null. */
function positionOfRawCall(read: ArtifactConstructReadVerification, rawCallIndex: number): number | null {
  return read.mapping?.coordinateMap.columns.find((column) => (
    column.rawCallIndex === rawCallIndex && column.operation === 'match'
  ))?.referencePosition ?? null;
}

/** Apply reference-coordinate variants to the reference slice that starts at `offset`. */
function applyVariants(
  slice: string,
  offset: number,
  variants: ArtifactConstructVerificationResult['variants']['observed'],
): string {
  let edited = slice;
  for (const variant of [...variants].sort((left, right) => right.referenceStart - left.referenceStart)) {
    const from = variant.referenceStart - offset;
    const to = variant.referenceEnd - offset;
    edited = `${edited.slice(0, from)}${variant.alternate}${edited.slice(to)}`;
  }
  return edited;
}

const MAPPING_FAILURE_CODES = new Set(['unmapped_read', 'ambiguous_mapping', 'low_mapping_identity', 'excessive_indel']);

describe('verifyArtifactConstruct on plasmid-scale references', () => {
  it('maps an exact 800 bp read on pET-28a(+) with a proven margin', () => {
    const result = verify(PET28A, [sangerRead('exact', PET28A.slice(1_200, 2_000))]);

    expect(result.reads[0]).toMatchObject({
      status: 'mapped',
      mapping: {
        orientation: 'forward',
        referenceStart: 1_200,
        referenceEnd: 2_000,
        wraps: false,
        score: 2_400,
        // No other placement scores within the margin window.
        secondBestScore: null,
        mappingMargin: null,
      },
    });
    expect(result.state).toBe('consistent');
    expect(result.reasons).toEqual([]);
  });

  it('maps a read carrying three SNPs and calls each SNP at its reference position', () => {
    const template = PET28A.slice(3_000, 3_800);
    const offsets = [150, 400, 650];
    const { calls, alternates } = withSubstitutions(template, offsets);
    const result = verify(PET28A, [sangerRead('snp', calls)]);

    expect(result.reads[0]).toMatchObject({
      status: 'mapped',
      mapping: { orientation: 'forward', referenceStart: 3_000, referenceEnd: 3_800, substitutions: 3 },
    });
    expect(result.state).toBe('inconsistent');
    expect(result.variants.observed.map((variant) => [variant.type, variant.referenceStart, variant.alternate]))
      .toEqual(offsets.map((offset, index) => ['substitution', 3_000 + offset, alternates[index]]));
    expect(result.reasons.some((reason) => MAPPING_FAILURE_CODES.has(reason.code))).toBe(false);
  });

  it('maps a reverse-strand read and reports the SNP on the reference strand', () => {
    const template = PET28A.slice(2_200, 3_100);
    const { calls, alternates } = withSubstitutions(template, [300]);
    const result = verify(PET28A, [sangerRead('reverse', calls, { reverse: true })]);

    expect(result.reads[0]).toMatchObject({
      status: 'mapped',
      mapping: { orientation: 'reverse', referenceStart: 2_200, referenceEnd: 3_100 },
    });
    expect(result.state).toBe('inconsistent');
    expect(result.variants.observed).toEqual([
      expect.objectContaining({ type: 'substitution', referenceStart: 2_500, alternate: alternates[0] }),
    ]);
  });

  it('maps reads with 1-3 bp indels on pETDuet-1, including one four calls from the read end', () => {
    const start = 1_500;
    const template = PETDUET.slice(start, start + 800);
    // Positions where left-normalization cannot move the event, so its coordinate is exact.
    const deletionAt = (from: number, length: number) => {
      let offset = from;
      while (template[offset - 1] === template[offset + length - 1]) offset += 1;
      return offset;
    };
    const oneBase = deletionAt(300, 1);
    const threeBase = deletionAt(520, 3);
    const nearEnd = deletionAt(795, 1);
    const cases = [
      { id: 'deletion-1', calls: template.slice(0, oneBase) + template.slice(oneBase + 1), type: 'deletion', at: oneBase, length: 1 },
      { id: 'deletion-3', calls: template.slice(0, threeBase) + template.slice(threeBase + 3), type: 'deletion', at: threeBase, length: 3 },
      { id: 'deletion-near-end', calls: template.slice(0, nearEnd) + template.slice(nearEnd + 1), type: 'deletion', at: nearEnd, length: 1 },
    ];
    const insertionOffset = 410;
    const inserted = template[insertionOffset - 1] === 'T' ? 'GG' : 'GT';
    cases.push({
      id: 'insertion-2',
      calls: template.slice(0, insertionOffset) + inserted + template.slice(insertionOffset),
      type: 'insertion',
      at: insertionOffset,
      length: 0,
    });
    expect(nearEnd).toBeGreaterThanOrEqual(template.length - 5);

    for (const entry of cases) {
      const result = verify(PETDUET, [sangerRead(entry.id, entry.calls)]);
      expect(result.reads[0], entry.id).toMatchObject({
        status: 'mapped',
        mapping: { orientation: 'forward', referenceStart: start },
      });
      expect(result.state, entry.id).toBe('inconsistent');
      // Gap columns cost the same wherever they sit, so a multi-base event may be
      // reported as equal-scoring pieces. The reported edits must reproduce the read
      // and sit where the edit was made.
      const observed = result.variants.observed;
      expect(observed.length, entry.id).toBeGreaterThan(0);
      expect(observed.every((variant) => variant.type === entry.type), entry.id).toBe(true);
      for (const variant of observed) {
        expect(variant.referenceStart - start, entry.id).toBeGreaterThanOrEqual(entry.at - 6);
        expect(variant.referenceEnd - start, entry.id).toBeLessThanOrEqual(entry.at + entry.length + 6);
      }
      expect(applyVariants(PETDUET.slice(start, start + 800), start, observed), entry.id).toBe(entry.calls);
      if (entry.length <= 1) {
        expect(observed, entry.id).toEqual([
          expect.objectContaining({ referenceStart: start + entry.at, referenceEnd: start + entry.at + entry.length }),
        ]);
      }
    }
  });

  it('maps origin-spanning reads on both strands with wrapped coordinates', () => {
    const length = PET28A.length;
    const forward = sangerRead('origin-forward', circularSlice(PET28A, length - 350, 800));
    const reverse = sangerRead('origin-reverse', circularSlice(PET28A, length - 500, 900), { reverse: true });
    const result = verify(PET28A, [forward, reverse]);

    expect(result.reads[0]).toMatchObject({
      status: 'mapped',
      mapping: { orientation: 'forward', referenceStart: length - 350, referenceEnd: 450, wraps: true },
    });
    expect(result.reads[1]).toMatchObject({
      status: 'mapped',
      mapping: { orientation: 'reverse', referenceStart: length - 500, referenceEnd: 400, wraps: true },
    });
    expect(result.state).toBe('consistent');
  });

  it('trims degraded low-quality ends and still maps the first template call to its base', () => {
    const start = 2_600;
    const degrade = (calls: string) => [...calls].map((base, index) => (index % 3 === 1 ? otherBase(base) : base)).join('');
    const head = degrade(PET28A.slice(start - 30, start));
    const tail = degrade(PET28A.slice(start + 800, start + 845));
    const calls = head + PET28A.slice(start, start + 800) + tail;
    const qualityScores = [
      ...new Array<number>(head.length).fill(6),
      ...new Array<number>(800).fill(40),
      ...new Array<number>(tail.length).fill(6),
    ];
    const result = verify(PET28A, [sangerRead('low-quality-ends', calls, { qualityScores })]);
    const read = result.reads[0];

    expect(read.status).toBe('mapped');
    expect(read.mapping?.orientation).toBe('forward');
    expect(read.trim.removedFromStart).toBeGreaterThan(0);
    expect(read.trim.removedFromEnd).toBeGreaterThan(0);
    expect(positionOfRawCall(read, head.length)).toBe(start);
    expect(positionOfRawCall(read, head.length + 799)).toBe(start + 799);
    // The low-quality calls that survive trimming are review-only, never a mapping failure.
    expect(result.state).toBe('needs_review');
    expect(new Set(result.reasons.map((reason) => reason.code))).toEqual(new Set(['low_confidence_variant']));
  });

  it('keeps a read inside a duplicated cassette ambiguous and maps reads anchored by unique flanks', () => {
    const cassette = PET28A.slice(1_000, 2_500);
    const duplicated = PET28A.slice(0, 4_000) + cassette + PET28A.slice(4_000);
    const inside = verify(duplicated, [sangerRead('inside-repeat', duplicated.slice(1_300, 2_000))]);

    expect(inside.reads[0]).toMatchObject({
      status: 'ambiguous_mapping',
      mapping: { orientation: 'forward', referenceStart: 1_300, score: 2_100, secondBestScore: 2_100, mappingMargin: 0 },
    });
    expect(inside.state).toBe('needs_review');
    expect(inside.reasons).toContainEqual(expect.objectContaining({ code: 'ambiguous_mapping', readId: 'inside-repeat' }));

    const flanked = verify(duplicated, [sangerRead('flanked', duplicated.slice(3_700, 4_400))]);
    expect(flanked.reads[0]).toMatchObject({
      status: 'mapped',
      mapping: { orientation: 'forward', referenceStart: 3_700, secondBestScore: null },
    });

    // pETDuet-1 carries a natural 52 bp repeat (its two T7 promoter and lac operator copies);
    // reads over either copy are placed by their unique flanks.
    const firstCopy = verify(PETDUET, [sangerRead('duet-copy-1', PETDUET.slice(0, 700))]);
    const originCopy = verify(PETDUET, [sangerRead('duet-copy-2', circularSlice(PETDUET, 5_100, 700))]);
    expect(firstCopy.reads[0]).toMatchObject({ status: 'mapped', mapping: { orientation: 'forward', referenceStart: 0 } });
    expect(originCopy.reads[0]).toMatchObject({
      status: 'mapped',
      mapping: { orientation: 'forward', referenceStart: 5_100, wraps: true },
    });
  });

  it('calls a one-SNP twin cassette ambiguous unless the margin separates the copies', () => {
    const cassette = PET28A.slice(1_000, 2_500);
    const { calls: variantCopy } = withSubstitutions(cassette, [700]);
    const reference = PET28A.slice(0, 4_000) + variantCopy + PET28A.slice(4_000);
    const fromFirst = sangerRead('first-copy', reference.slice(1_300, 2_000));
    const fromSecond = sangerRead('second-copy', reference.slice(4_300, 5_000));

    const defaultMargin = verify(reference, [fromFirst]);
    expect(defaultMargin.reads[0]).toMatchObject({
      status: 'ambiguous_mapping',
      mapping: {
        referenceStart: 1_300,
        score: 2_100,
        // The other copy differs by one mismatch: 6 points in 3 * 700.
        secondBestScore: 2_094,
        mappingMargin: 6 / 2_100,
      },
    });
    expect(defaultMargin.state).toBe('needs_review');

    // A margin below 6 / 2100 separates the copies, and each read goes to its own.
    const first = verify(reference, [fromFirst], { minMappingMargin: 0.002 });
    const second = verify(reference, [fromSecond], { minMappingMargin: 0.002 });
    expect(first.reads[0]).toMatchObject({ status: 'mapped', mapping: { orientation: 'forward', referenceStart: 1_300 } });
    expect(second.reads[0]).toMatchObject({ status: 'mapped', mapping: { orientation: 'forward', referenceStart: 4_300 } });
    expect(first.state).toBe('consistent');
    expect(second.state).toBe('consistent');
  });

  it('does not map a read from a different plasmid', () => {
    // pETDuet-1's ampicillin-resistance gene has no counterpart in kanamycin-resistant pET-28a(+).
    const result = verify(PET28A, [sangerRead('wrong-plasmid', PETDUET.slice(1_150, 1_850))]);

    expect(result.reads[0].status).toBe('low_mapping_identity');
    expect(result.reads[0].mapping?.identity).toBeLessThan(0.82);
    expect(result.coverage.coveredBases).toBe(0);
    expect(result.state).toBe('needs_review');
  });

  it('reports foreign reads on a full plate as not mapped and still maps the rest within the budget', () => {
    const reads: ArtifactConstructReadInput[] = [];
    const starts: number[] = [];
    for (let index = 0; index < 96; index += 1) {
      if (index < 10) {
        const start = 1_100 + (index * 40);
        reads.push(sangerRead(`other-plasmid-${index}`, PETDUET.slice(start, start + 800), { reverse: index % 2 === 1 }));
      } else if (index < 20) {
        reads.push(sangerRead(`unrelated-${index}`, deterministicDna(800, 0x5000 + index)));
      } else {
        const start = ((index * 71) + 13) % PET28A.length;
        const { calls } = withSubstitutions(circularSlice(PET28A, start, 800), [150 + (index % 40), 610 - (index % 30)]);
        reads.push(sangerRead(`plate-${index}`, calls, { reverse: index % 2 === 1 }));
        starts.push(start);
      }
    }

    const result = verify(PET28A, reads);

    // A seeded pass proves no locus is close enough to these reads, so they cost little.
    // Sent through the sampled search instead, twenty of them exhaust the shared budget.
    for (const read of result.reads.slice(0, 10)) {
      expect(['unmapped', 'low_mapping_identity'], read.id).toContain(read.status);
    }
    expect(result.reads.slice(10, 20).map((read) => read.status)).toEqual(new Array(10).fill('unmapped'));
    // Their share of the budget ran out before the whole reference was searched.
    expect(result.reads.slice(10, 20).map((read) => read.searchIncomplete)).toEqual(new Array(10).fill(true));
    result.reads.slice(20).forEach((read, index) => {
      expect(read.status, read.id).toBe('mapped');
      expect(read.mapping?.referenceStart, read.id).toBe(starts[index]);
      expect(read, read.id).not.toHaveProperty('searchIncomplete');
    });
    expect(result.provenance.workUnits).toBeLessThan(ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxWorkUnits);
  });

  it('keeps a read inside a five-copy cassette review-only when a full plate leaves too little budget to prove it', () => {
    const unique = RANDOM_10KB.slice(0, 5_000);
    const reference = unique + deterministicDna(1_000, 0xca55e77e).repeat(5);
    const reads: ArtifactConstructReadInput[] = [];
    const starts: number[] = [];
    for (let index = 0; index < 95; index += 1) {
      const start = 50 + ((index * 41) % 4_100);
      const { calls } = withSubstitutions(unique.slice(start, start + 800), [200 + (index % 50)]);
      reads.push(sangerRead(`unique-${index}`, calls, { reverse: index % 2 === 1 }));
      starts.push(start);
    }
    // One miscall rules out the exact-occurrence shortcut, and aligning around all five
    // copies costs more than this read's share of a 96-read budget.
    const { calls: cassetteCalls } = withSubstitutions(reference.slice(7_100, 7_900), [400]);
    reads.push(sangerRead('in-cassette', cassetteCalls));

    const result = verify(reference, reads);

    result.reads.slice(0, 95).forEach((read, index) => {
      expect(read.status, read.id).toBe('mapped');
      expect(read.mapping?.referenceStart, read.id).toBe(starts[index]);
    });
    // The budget stopped the search before it proved anything about this read, so the
    // read is not reported as having no locus; it stays ambiguous with no proven runner-up.
    expect(result.reads[95]).toMatchObject({ status: 'ambiguous_mapping', mapping: { secondBestScore: null } });
  });

  it('maps a 96-read plate with miscalls, indels and low-quality ends on a 10 kb reference within the work budget', () => {
    const reads: ArtifactConstructReadInput[] = [];
    const truths: Array<{ start: number; reverse: boolean; firstRawCall: number }> = [];
    for (let index = 0; index < 96; index += 1) {
      const start = ((index * 104) + 37) % RANDOM_10KB.length;
      const calls = [...circularSlice(RANDOM_10KB, start, 800)];
      const qualityScores = new Array<number>(calls.length).fill(40);
      for (const offset of [120 + (index % 50), 560 - (index % 70)]) {
        calls[offset] = otherBase(calls[offset]);
        qualityScores[offset] = 12;
      }
      const deletionAt = 300 + ((index * 7) % 200);
      const deletionLength = 1 + (index % 3);
      calls.splice(deletionAt, deletionLength);
      qualityScores.splice(deletionAt, deletionLength);
      const head = deterministicDna(20, 0x3000 + index);
      const tail = deterministicDna(30, 0x4000 + index);
      const reverse = index % 2 === 1;
      const read = sangerRead(`plate-${index}`, head + calls.join('') + tail, {
        qualityScores: [...new Array<number>(20).fill(6), ...qualityScores, ...new Array<number>(30).fill(6)],
        reverse,
      });
      reads.push(read);
      truths.push({ start, reverse, firstRawCall: reverse ? read.baseCalls.length - 1 - 20 : 20 });
    }

    const result = verify(RANDOM_10KB, reads, { minCoverageFraction: 1 });

    result.reads.forEach((read, index) => {
      expect(read.status, read.id).toBe('mapped');
      expect(read.mapping?.orientation, read.id).toBe(truths[index].reverse ? 'reverse' : 'forward');
      expect(positionOfRawCall(read, truths[index].firstRawCall), read.id).toBe(truths[index].start);
    });
    expect(result.coverage.coveredFraction).toBe(1);
    expect(result.provenance.workUnits).toBeLessThan(ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxWorkUnits);
    // Single-read miscalls at quality 12 are review-only; nothing fails to map.
    expect(result.state).toBe('needs_review');
    expect(new Set(result.reasons.map((reason) => reason.code))).toEqual(new Set(['low_confidence_variant']));
  });
});

// A deletion before every whole seed block puts each seed hit g diagonals right of the
// read start, so the search window must reach D / 4 to the left as well as the right.
describe('seeded search with a deletion before every whole seed block', () => {
  function verifyLinear(reference: string, calls: string): ArtifactConstructVerificationResult {
    return verifyArtifactConstruct({
      reference: { id: 'linear', sequence: reference, topology: 'linear', sha256: sha256HexSync(reference) },
      reads: [sangerRead('read', calls)],
      thresholds: { minCoverageFraction: 0 },
    });
  }

  it('keeps the read start and the head SNP on a short linear reference', () => {
    const reference = 'ATTTCAGGTTCATTCCTTAGCTCATGCACACGGTCAGTGCGATCTGTGAAATTGGACGAGGCGGTTGCTATAAAGAGC'
      + 'GGTGGGGCTCGCCAGGCGCAAAAGTAGTTGAAGTAAAGCCCTGGGCAGATGTATGCATCACAGATGTACGCGGACTCCGACC'
      + 'TGCAGACACCCGATCGTCTGAAACGTAGGCCCATTACCCCGTATTCGCATACGTACGCTGGAACGTACAGCTAG';
    // Calls 0-25 carry a SNP in each 12-call block, then a 14 bp deletion.
    const calls = withSubstitutions(reference.slice(0, 26), [3, 18]).calls + reference.slice(40);

    const result = verifyLinear(reference, calls);

    // 598 is the full dynamic-programming optimum over the whole reference, both strands.
    expect(result.reads[0]).toMatchObject({ status: 'mapped', mapping: { score: 598, referenceStart: 0 } });
    expect(result.variants.observed).toContainEqual(expect.objectContaining({ type: 'substitution', referenceStart: 3 }));
    expect(result.reasons.map((reason) => reason.code)).not.toContain('partial_reference_coverage');
  });

  it('keeps the read start of a pET-28a(+) read with a 14 bp deletion after call 20', () => {
    const { calls: head } = withSubstitutions(PET28A.slice(2_500, 2_520), [3, 18]);
    const result = verify(PET28A, [sangerRead('deletion', head + PET28A.slice(2_534, 2_814))]);

    // 838 is the full dynamic-programming optimum over the whole circle, both strands.
    expect(result.reads[0]).toMatchObject({ status: 'mapped', mapping: { score: 838, referenceStart: 2_500 } });
    expect(positionOfRawCall(result.reads[0], 0)).toBe(2_500);
  });

  it('keeps a read ambiguous when the other copy of its region has an insertion near its start', () => {
    // Copy A at 500-900 is the read exactly; copy B at 2000 has 6 bp inserted after its
    // eighth base, so B's best alignment scores 1176 of 1200, inside the 0.03 margin.
    const base = deterministicDna(3_000, 1);
    const region = base.slice(500, 900);
    const reference = base.slice(0, 2_000) + region.slice(0, 8) + deterministicDna(6, 7_778) + region.slice(8)
      + base.slice(2_400);

    const result = verifyLinear(reference, region);

    expect(result.reads[0]).toMatchObject({
      status: 'ambiguous_mapping',
      mapping: { referenceStart: 500, score: 1_200, secondBestScore: 1_176 },
    });
  });
});

describe('an unmapped read whose search the work budget stopped', () => {
  function verifyLinear(reference: string, reads: ArtifactConstructReadInput[]): ArtifactConstructVerificationResult {
    return verifyArtifactConstruct({
      reference: { id: 'linear', sequence: reference, topology: 'linear', sha256: sha256HexSync(reference) },
      reads,
      thresholds: { minCoverageFraction: 0 },
    });
  }

  it('is marked incomplete and its reason says the search stopped, not that it could not be mapped', () => {
    // A 5,000-call read with no counterpart in a 12 kb reference: seeded passes prove
    // no close alignment, and aligning the whole reference costs more than the budget.
    const result = verifyLinear(deterministicDna(12_000, 0xabc123), [sangerRead('stray', deterministicDna(5_000, 0x5eed + 5_000))]);

    expect(result.reads[0]).toMatchObject({ status: 'unmapped', searchIncomplete: true, mapping: null });
    expect(result.reasons.find((entry) => entry.code === 'unmapped_read')?.message)
      .toBe('The search for stray.ab1 stopped at its work budget before it found a close alignment to the reference.');
  });

  it('aligns the same kind of read when the budget covers the whole reference', () => {
    // 2,000 calls on 10 kb: the whole-reference pass fits, so the read gets a real
    // (poor) alignment rather than an unmapped verdict, and carries no marker.
    const result = verifyLinear(deterministicDna(10_000, 0xabc123), [sangerRead('stray', deterministicDna(2_000, 0x5eed + 2_000))]);

    expect(result.reads[0].status).toBe('low_mapping_identity');
    expect(result.reads[0]).not.toHaveProperty('searchIncomplete');
    expect(result.reasons.find((entry) => entry.code === 'unmapped_read')).toBeUndefined();
  });
});
