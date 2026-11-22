import { describe, expect, it } from 'vitest';
import { mapFeatureThroughSourceCoordinates } from '../assembly-feature-mapping';
import { extractFeatureSequence } from '../feature-location';
import { analyzeOverlap, gibsonAssemble } from '../gibson-assembly';
import { checkInternalSites, goldenGateAssemble, scanGoldenGateSites } from '../golden-gate';
import { simulatePCR } from '../pcr';
import { designPrimerPairWithDiagnostics } from '../primer-design';
import { predictHairpin, predictPrimerDimer, predictSelfDimer } from '../primer-thermodynamics';
import { reverseComplement } from '../reverse-complement';
import { calculateTm } from '../tm-calculator';
import type { Feature } from '../types';

const primerParams = {
  minLength: 18, maxLength: 18, minGC: 0, maxGC: 1, flankingWindow: 0,
  enforceTargetTm: false, requireGcClamp: false,
  maxHairpinDeltaG: null, maxSelfDimerDeltaG: null, maxCrossDimerDeltaG: null,
};
const forward = 'ACGTTGCAACCTGATCGT';
const rightBinding = 'ATGCCGTAGATCTACGGCAT';
const marker: Feature = {
  id: 'marker', name: 'Marker', start: 6, end: 2, strand: -1,
  type: 'misc_feature', color: '', metadata: {},
};
const overlap = 'GCTAAGTC';
const seam = 'ACGTTGCA';
const gatePart = (left: string, body: string, right: string) => (
  `GGTCTCA${left}${body}${right}AGAGACC`
);

describe('design arithmetic', () => {
  it('matches independently calculated unified and salt-corrected Tm values', () => {
    expect(calculateTm(' acgttgcaac ctgatcgt ')).toMatchObject({
      evaluatedSequence: forward, tm: 53.4, deltaH: -140700, deltaS: expect.closeTo(-378.4, 8),
    });
    expect(calculateTm('CGGTATCGACGGCTATGCCA').tm).toBe(59.2);
    expect(calculateTm(rightBinding).tm).toBe(55.8);
    expect(calculateTm(forward, { saltCorrection: 'santalucia' }).tm).toBe(54);
    expect(calculateTm(forward, { mgConcentration: 1.5, dntpConcentration: 0.2 }).tm).toBe(59.7);
    expect(calculateTm(forward, { naConcentration: 1000, primerConcentration: 1000 }).tm).toBe(71.2);
    expect(calculateTm('ACGT'.repeat(1000)).tm).toBe(79.5);
    expect(calculateTm('A')).toMatchObject({ tm: 2, method: 'wallace (short, no salt correction)' });
    expect(calculateTm('')).toMatchObject({ status: 'invalid' });
    expect(calculateTm('ACGN')).toMatchObject({ status: 'ambiguous', evaluatedSequence: 'ACGN' });
  });

  it('uses the Wetmur sodium activity correction', () => {
    expect(calculateTm(forward, { saltCorrection: 'wetmur' }).tm).toBe(50.9);
    expect(calculateTm(forward, { saltCorrection: 'wetmur', naConcentration: 1000 }).tm).toBe(68.9);
  });

  it('finds unequal-length dimers and reports the signed shift', () => {
    expect(predictPrimerDimer('GGG', 'CCCTTT')).toMatchObject({
      pairLength: 3, offset: -3, threePrimeOverlap: { primer1: 3, primer2: 0 },
    });
    expect(predictPrimerDimer('AAAGGG', 'CCC')).toMatchObject({
      pairLength: 3, offset: 3, threePrimeOverlap: { primer1: 3, primer2: 3 },
    });
    expect(predictSelfDimer('GCGCGC')).toMatchObject({ pairLength: 6, offset: 0 });
    expect(predictSelfDimer('AAAAAA')).toMatchObject({ pairLength: 0 });
    expect(predictHairpin('AAAAAAAAA')).toMatchObject({ stemLength: 0 });
  });

  it('keeps the earliest hairpin when a later stem ties', () => {
    expect(predictHairpin('GCCAAAGGCAAAGGC')).toMatchObject({
      stemLength: 3, loopSize: 3, deltaG: -2.12, structure: "5'-GCC-...-GGC-3'",
    });
  });

  it('rejects a design whose binding spans extend outside its amplicon', () => {
    const result = designPrimerPairWithDiagnostics(forward.repeat(3), {
      ...primerParams, targetStart: 18, targetEnd: 25,
    });
    expect(result.pairs).toEqual([]);
    expect(result.rejections.productLength).toBe(1);
  });

  it('agrees on the annealing sequence, Tm and GC at both linear template ends', () => {
    const right = rightBinding.slice(0, 18);
    const template = forward + 'CCCC' + right;
    const pair = designPrimerPairWithDiagnostics(template, {
      ...primerParams, targetStart: 0, targetEnd: 40, forwardTail: 'AA', reverseTail: 'GC',
    }).pairs[0];
    expect(pair?.forward).toMatchObject({ sequence: forward, start: 0, end: 18, length: 18, fullLength: 20, gcPercent: 50 });
    expect(pair?.reverse).toMatchObject({ sequence: 'GCCGTAGATCTACGGCAT', start: 22, end: 40, direction: 'reverse' });
    const product = simulatePCR(template, pair.forward.fullSequence, pair.reverse.fullSequence, [], 'linear', {
      forward: { start: 0, end: 18 }, reverse: { start: 22, end: 40 },
    });
    expect(pair.productLength).toBe(40);
    expect(product?.product).toBe('AA' + template + 'GC');
    expect(product?.forward.tm).toBe(pair.forward.tm);
    expect(product?.forward.gcPercent).toBe(pair.forward.gcPercent);
  });

  it.each([5, 25])('preserves binding and tail geometry when a circular template is rotated by %i', (rotation) => {
    const right = rightBinding.slice(0, 18);
    const source = forward + 'CCCC' + right + 'AGGA';
    const template = source.slice(rotation) + source.slice(0, rotation);
    const length = source.length;
    const forwardStart = length - rotation;
    const reverseStart = (22 + length - rotation) % length;
    const forwardEnd = (forwardStart + forward.length) % length;
    const reverseEnd = (reverseStart + right.length) % length;
    const product = simulatePCR(template, 'AA' + forward, 'CG' + reverseComplement(right), [], 'circular', {
      forward: { start: forwardStart, end: forwardEnd },
      reverse: { start: reverseStart, end: reverseEnd },
    });
    expect(product).toMatchObject({
      product: 'AA' + forward + 'CCCC' + right + 'CG',
      wrapsOrigin: true,
      forward: { bindStart: forwardStart, bindEnd: forwardEnd },
      reverse: { bindStart: reverseStart, bindEnd: reverseEnd },
    });
    expect(product?.forward.spansOrigin).toBe(rotation === 5 ? true : undefined);
    expect(product?.reverse.spansOrigin).toBe(rotation === 25 ? true : undefined);
  });

  it('labels only the retained Gibson closing overlap', () => {
    const product = gibsonAssemble([
      { name: 'A', sequence: seam + 'TT' + overlap },
      { name: 'B', sequence: overlap + 'GG' + seam },
    ], 8, 8, 'circular');
    expect(product.sequence).toBe('ACGTTGCATTGCTAAGTCGG');
    const closing = product.features.find((feature) => feature.metadata.closing === true)!;
    expect(extractFeatureSequence(product.sequence, closing)).toBe(seam);
    expect(closing).toMatchObject({ start: 0, end: 8 });
  });

  it('reports repeated Gibson lengths and the Tm of a palindromic overlap', () => {
    expect(analyzeOverlap('CG' + 'AT'.repeat(6), 'AT'.repeat(6) + 'GC', 8, 12))
      .toMatchObject({ ambiguous: true, candidates: [{ length: 12 }, { length: 10 }, { length: 8 }] });
    expect(analyzeOverlap('TT' + rightBinding, rightBinding + 'CC', 20, 20).selected)
      .toMatchObject({ length: 20, tm: 55.8, position1: 2, position2: 20 });
  });

  it.each([
    ['BsaI', 'GGTCTC', 'A', 'AGTC', 7, 11],
    ['BsmBI', 'CGTCTC', 'A', 'AGTC', 7, 11],
    ['BbsI', 'GAAGAC', 'AA', 'AGTC', 8, 12],
    ['SapI', 'GCTCTTC', 'A', 'AGT', 8, 11],
  ])('extracts %s cuts and overhangs on both strands', (enzyme, recognition, spacer, end, cut, bottomCut) => {
    const source = recognition + spacer + end + 'TT';
    expect(scanGoldenGateSites(source, enzyme).sites).toEqual([
      { position: 0, enzyme, strand: 1, cutPosition: cut, overhang: end },
    ]);
    expect(scanGoldenGateSites(reverseComplement(source), enzyme).sites).toEqual([
      { position: source.length - recognition.length, enzyme, strand: -1,
        cutPosition: source.length - bottomCut, overhang: end },
    ]);
  });

  it('detects a Type IIS site regenerated across the product origin', () => {
    const circle = 'GTCTCATCTTGCGGAAGG';
    expect(checkInternalSites(circle, 'BsaI', 'circular')).toEqual([{ position: 17, strand: 1 }]);
    expect(checkInternalSites(reverseComplement(circle), 'BsaI', 'circular')).toEqual([{ position: 13, strand: -1 }]);
    expect(checkInternalSites(circle, 'BsaI')).toEqual([]);
    const product = goldenGateAssemble([
      { name: 'A', sequence: gatePart('GTCT', 'CA', 'TCTT') },
      { name: 'B', sequence: gatePart('TCTT', 'GCGGAAGG', 'GTCT') },
    ]);
    expect(product.sequence).toBe(circle);
    expect(product.warnings.join(' ')).toMatch(/circular product contains 1 BsaI recognition site/i);
  });

  it('labels only the retained Golden Gate closing scar', () => {
    const product = goldenGateAssemble([
      { name: 'A', sequence: gatePart('AATG', 'GG', 'GACT') },
      { name: 'B', sequence: gatePart('GACT', 'CC', 'AATG') },
    ]);
    // Joining keeps A's GACT and trims B's leading copy. Closure trims B's
    // trailing AATG, leaving A's AATG at the product origin.
    expect(product).toMatchObject({ topology: 'circular', sequence: 'AATGGGGACTCC' });
    const closingScars = product.features.filter((feature) => feature.metadata.circular === true);
    expect(closingScars).toHaveLength(1);
    const [closing] = closingScars;
    expect(closing).toMatchObject({ name: 'Junction B -> A (AATG)', start: 0, end: 4 });
    expect(closing.subRanges).toBeUndefined();
    expect(extractFeatureSequence(product.sequence, closing)).toBe('AATG');
  });

  it('maps an aggregate reverse feature spanning the source origin', () => {
    const mapped = mapFeatureThroughSourceCoordinates(marker, {
      sourceLength: 8, productLength: 10, sourceToProduct: [1, 2, 3, 4, 5, 6, 7, 8],
    });
    expect(mapped).toMatchObject({
      start: 1, end: 9, strand: -1,
      subRanges: [{ start: 1, end: 3, strand: -1 }, { start: 7, end: 9, strand: -1 }],
    });
  });

  it('orders inherited reverse ranges across the product origin', () => {
    const mapped = mapFeatureThroughSourceCoordinates({
      ...marker, start: 1, end: 5, subRanges: [{ start: 1, end: 5 }],
    }, {
      sourceLength: 6, productLength: 7, sourceToProduct: [4, 5, 6, 0, 1, 2],
    });
    expect(mapped?.subRanges).toEqual([{ start: 0, end: 2 }, { start: 5, end: 7 }]);
  });
});
