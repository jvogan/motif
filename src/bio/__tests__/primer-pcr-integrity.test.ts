import { describe, expect, it } from 'vitest';
import { findPrimerBindings, simulatePCR } from '../pcr';
import { designForwardPrimerWithDiagnostics } from '../primer-design';
import { predictHairpin, predictPrimerDimer } from '../primer-thermodynamics';
import { calculateTm, saltCorrectedTm } from '../tm-calculator';
import { reverseComplement } from '../reverse-complement';
import type { Feature } from '../types';

const binding = 'ACGTTGCAAC';

describe('primer, PCR, and Tm integrity', () => {
  it('keeps ambiguity and rejects gaps instead of deleting residues before Tm', () => {
    const ambiguous = calculateTm(' ATG NNN ');
    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.evaluatedSequence).toBe('ATGNNN');
    expect(ambiguous.method).toBe('none');

    const gapped = calculateTm('ATG-NNN');
    expect(gapped.status).toBe('invalid');
    expect(gapped.evaluatedSequence).toBe('ATG-NNN');
    expect(gapped.message).toMatch(/invalid/i);
  });

  it('fails closed on non-finite and non-physical Tm conditions', () => {
    expect(calculateTm('ACGTACGTACGTAC', { naConcentration: Number.NaN }).status).toBe('invalid');
    expect(calculateTm('ACGTACGTACGTAC', { naConcentration: 0 }).status).toBe('invalid');
    expect(calculateTm('ACGTACGTACGTAC', { primerConcentration: 0 }).status).toBe('invalid');
    expect(calculateTm('ACGTACGTACGTAC', { method: 'not-a-method' as never }).status).toBe('invalid');
    expect(() => saltCorrectedTm(330, 50, 0, 0.5, 20, 'owczarzy', {
      deltaH: -10_000,
      deltaS: Number.NaN,
      ctMolar: 250e-9,
    })).toThrow(/finite/i);
  });

  it('enumerates repeated binding sites and exposes a configurable mismatch policy', () => {
    const template = `${binding}GGGG${binding}`;
    const candidates = findPrimerBindings(template, `GGGG${binding}`, { minMatched3PrimeLength: 10 });
    expect(candidates.map((candidate) => candidate.bindStart)).toEqual(expect.arrayContaining([0, 14]));
    expect(candidates.length).toBeGreaterThan(2);
    expect(candidates.every((candidate) => candidate.status === 'exact')).toBe(true);

    const mismatchTemplate = `TCGTTGCAACGGGG`;
    expect(findPrimerBindings(mismatchTemplate, binding)).toEqual([]);
    const mismatch = findPrimerBindings(mismatchTemplate, binding, {
      minMatched3PrimeLength: 9,
      maxMismatches: 1,
    });
    expect(mismatch[0]).toMatchObject({
      bindStart: 0,
      mismatchCount: 1,
      matched3PrimeLength: 9,
      status: 'mismatch',
    });

    const conditionalMismatch = findPrimerBindings('TCGTTGCAACNN', 'NCGTTGCAAC', {
      minMatched3PrimeLength: 9,
      maxMismatches: 1,
    });
    expect(conditionalMismatch[0]?.status).toBe('ambiguous');
  });

  it('preserves explicit tails, reports competing products, and preserves template IUPAC symbols', () => {
    const template = `${binding}NNNN${binding}TTTT${binding}`;
    const reverse = reverseComplement(binding);
    const result = simulatePCR(
      template,
      `GGTCTCN${binding}`,
      `GAGACCN${reverse}`,
      [],
      'linear',
      {
        forward: { start: 0, end: 10 },
        reverse: { start: 14, end: 24 },
      },
      { minMatched3PrimeLength: 10 },
    );

    expect(result).not.toBeNull();
    expect(result?.forward.tail).toBe('GGTCTCN');
    expect(result?.reverse.tail).toBe('GAGACCN');
    expect(result?.product).toContain('NNNN');
    expect(result?.status).toBe('ambiguous');
    expect(result?.competingProducts).toEqual([]);
    expect(result?.warnings.join(' ')).toMatch(/conditional/i);

    const competing = simulatePCR(
      `${binding}TTTT${binding}TTTT${binding}`,
      binding,
      reverse,
      [],
      'linear',
      undefined,
      { minMatched3PrimeLength: 10 },
    );
    expect(competing?.competingProducts.length).toBeGreaterThan(0);
    expect(competing?.status).toBe('ambiguous');
    expect(competing?.warnings.join(' ')).toMatch(/competing/i);
  });

  it('does not fabricate a contiguous template from invalid characters', () => {
    expect(findPrimerBindings(`AAA-${binding}`, binding)).toEqual([]);
    expect(simulatePCR(`AAA-${binding}`, binding, reverseComplement(binding))).toBeNull();
  });

  it('keeps primer design tails exact and uses the full oligo for structure filters', () => {
    const sequence = 'ACGT'.repeat(40);
    const design = designForwardPrimerWithDiagnostics(sequence, {
      targetStart: 40,
      targetEnd: 60,
      minLength: 18,
      maxLength: 18,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 0,
      forwardTail: 'GGTCTCN',
    });
    expect(design.candidates.length).toBeGreaterThan(0);
    expect(design.candidates[0].tail).toBe('GGTCTCN');
    expect(design.candidates[0].fullSequence).toBe(`GGTCTCN${design.candidates[0].sequence}`);
    expect(design.candidates[0].secondaryStructureStatus).toBe('ambiguous');
    expect(design.warnings).toContain('Oligo tail contains IUPAC ambiguity symbols; secondary-structure diagnostics require review.');

    const invalidTail = designForwardPrimerWithDiagnostics(sequence, {
      targetStart: 40,
      targetEnd: 60,
      minLength: 18,
      maxLength: 18,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 0,
      forwardTail: 'GGT-CTC',
    });
    expect(invalidTail.candidates).toEqual([]);
    expect(invalidTail.warnings?.join(' ')).toMatch(/invalid nucleotide/i);
  });

  it('marks full ordered oligos with ambiguous tails for secondary-structure review', () => {
    const hairpin = predictHairpin('GGTCTCNACGTACGTACGTACGT');
    const dimer = predictPrimerDimer('GGTCTCNACGTACGTACGTACGT', 'GAGACCNACGTACGTACGTACGT');
    expect(hairpin.status).toBe('ambiguous');
    expect(hairpin.evaluatedSequence).toContain('N');
    expect(dimer.status).toBe('ambiguous');
    expect(dimer.evaluatedSequence).toContain('|');
  });

  it('splits a circular origin feature into product coordinates', () => {
    const template = `${binding}${'A'.repeat(20)}${binding}`;
    const reverse = reverseComplement(binding);
    const feature: Feature = {
      id: 'origin-feature',
      name: 'origin feature',
      type: 'cds',
      start: 35,
      end: 5,
      strand: 1,
      color: '#000000',
      metadata: {},
    };
    const result = simulatePCR(
      template,
      binding,
      reverse,
      [feature],
      'circular',
      {
        forward: { start: 30, end: 40 },
        reverse: { start: 0, end: 10 },
      },
    );
    expect(result?.wrapsOrigin).toBe(true);
    expect(result?.features[0]).toMatchObject({
      start: 5,
      end: 15,
      subRanges: [
        { start: 5, end: 10 },
        { start: 10, end: 15 },
      ],
      metadata: { pcrSourceSplitAtOrigin: true },
    });
  });
});
