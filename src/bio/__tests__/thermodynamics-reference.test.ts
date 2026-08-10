/**
 * Reference fixtures:
 * - Owczarzy et al. 2008: https://doi.org/10.1021/bi702363u
 * - SantaLucia 1998: https://doi.org/10.1073/pnas.95.4.1460
 * - Thermo Fisher DNA mass reference:
 *   https://www.thermofisher.com/us/en/home/references/ambion-tech-support/
 *   rna-tools-and-calculators/dna-and-rna-molecular-weights-and-conversions.html
 */
import { describe, expect, it } from 'vitest';
import {
  calculateTm,
  duplexThermodynamics,
  freeMagnesiumConcentration,
} from '../tm-calculator';
import {
  calculateDnaMolecularWeight,
  molecularWeight,
} from '../gc-content';
import { analyzeOverlap } from '../gibson-assembly';

const balanced20 = 'ACGTACGTACGTACGTACGT';

describe('condition-matched nearest-neighbor reference fixtures', () => {
  it('matches all three Owczarzy 2008 salt-decision branches', () => {
    // Expected values are independently reproduced from Owczarzy et al.
    // 2008 eqs. 16–20 with SantaLucia/Allawi DNA_NN3 parameters, Ct=250 nM.
    expect(calculateTm(balanced20, {
      naConcentration: 50,
      mgConcentration: 0.01,
    }).tm).toBe(55.2); // R < 0.22: monovalent-dominant
    expect(calculateTm(balanced20, {
      naConcentration: 10,
      mgConcentration: 5,
      dntpConcentration: 0.2,
    }).tm).toBe(64.2); // 0.22 <= R < 6: mixed
    expect(calculateTm(balanced20, {
      naConcentration: 5,
      mgConcentration: 1.5,
    }).tm).toBe(62.4); // R >= 6: Mg-dominant
  });

  it('uses the Mg–dNTP equilibrium when dNTP is not in excess Mg', () => {
    expect(freeMagnesiumConcentration(0.001, 0.001)).toBeCloseTo(0.0001666667, 9);
    expect(calculateTm(balanced20, {
      naConcentration: 50,
      mgConcentration: 1,
      dntpConcentration: 1,
    }).tm).toBe(56.2);
  });

  it('uses base-specific terminal initiation and self-complement symmetry', () => {
    expect(duplexThermodynamics('ATGC')).toMatchObject({ deltaH: -23100 });
    expect(duplexThermodynamics('ATGC').deltaS).toBeCloseTo(-66.2, 10);
    expect(duplexThermodynamics('GCGC')).toMatchObject({ deltaH: -30000 });
    expect(duplexThermodynamics('GCGC').deltaS).toBeCloseTo(-81.6, 10);
    const ordinary = duplexThermodynamics('ATGCATGCATGCAT');
    const self = duplexThermodynamics('ATGCATGCATGCAT', { selfComplementary: true });
    expect(self.deltaH).toBe(ordinary.deltaH);
    expect(self.deltaS).toBeCloseTo(ordinary.deltaS - 1.4, 10);
    expect(calculateTm('ATGCATGCATGCAT', { naConcentration: 50 }).deltaS)
      .toBeCloseTo(self.deltaS, 10);
    expect(calculateTm('ATGCATGCATGCAT', { naConcentration: 50, selfComplementary: false }).deltaS)
      .toBeCloseTo(ordinary.deltaS, 10);
  });
});

describe('single-strand DNA molecular-weight reference fixtures', () => {
  const seq100 = 'ACGT'.repeat(25);

  it('matches 1-, 20-, and 100-nt average and monoisotopic masses', () => {
    expect(molecularWeight('A', { fivePrime: 'hydroxyl' })).toBe(251.26);
    expect(molecularWeight(balanced20, { fivePrime: 'hydroxyl' })).toBe(6116.99);
    expect(molecularWeight(seq100, { fivePrime: 'hydroxyl' })).toBe(30832.73);
    expect(molecularWeight('A', { mode: 'monoisotopic', fivePrime: 'hydroxyl' })).toBe(251.10);
    expect(molecularWeight(balanced20, { mode: 'monoisotopic', fivePrime: 'hydroxyl' })).toBe(6114.06);
    expect(molecularWeight(seq100, { mode: 'monoisotopic', fivePrime: 'hydroxyl' })).toBe(30818.11);
  });

  it('keeps terminal chemistry and topology explicit', () => {
    expect(molecularWeight(balanced20)).toBe(6196.95); // documented 5′-phosphate UI default
    expect(molecularWeight(balanced20, { fivePrime: 'hydroxyl', threePrime: 'phosphate' })).toBe(6196.95);
    expect(molecularWeight(balanced20, { topology: 'circular' })).toBe(6178.94);
    expect(molecularWeight(balanced20, { topology: 'circular', fivePrime: 'hydroxyl' })).toBe(6178.94);
  });

  it('qualifies ambiguity instead of silently charging an N fallback', () => {
    expect(calculateDnaMolecularWeight('AN').status).toBe('ambiguous');
    expect(() => molecularWeight('AN')).toThrow(/ambiguity/i);
    expect(calculateDnaMolecularWeight('AN', { ambiguity: 'average' })).toMatchObject({
      status: 'ambiguous',
      mass: 640.17,
    });
    expect(molecularWeight('AN', { ambiguity: 'average' })).toBe(640.17);
  });
});

describe('Gibson overlap thermodynamic provenance', () => {
  it('uses the shared nearest-neighbor calculator with bounded assumptions', () => {
    const analysis = analyzeOverlap(
      `TTTT${'ACGT'.repeat(5)}`,
      `${'ACGT'.repeat(5)}AAAA`,
      15,
      20,
    );
    expect(analysis.selected).not.toBeNull();
    expect(analysis.selected?.tmEvidence).toMatchObject({
      method: 'nearest-neighbor',
      saltCorrection: 'owczarzy',
      naConcentrationMolar: 0.05,
      mgConcentrationMolar: 0,
    });
    expect(analysis.selected?.tm).toBe(calculateTm(analysis.selected?.sequence ?? '', {
      naConcentration: 50,
      mgConcentration: 0,
      saltCorrection: 'owczarzy',
      primerConcentration: 250,
    }).tm);
  });

  it('records the short-overlap fallback rather than claiming nearest-neighbor salt correction', () => {
    const analysis = analyzeOverlap('AAAA', 'AAAA', 4, 4);
    expect(analysis.selected?.tmEvidence).toMatchObject({
      method: 'wallace',
      saltCorrection: 'none',
    });
  });

  it('rejects non-finite or unbounded overlap ranges in the core API', () => {
    expect(() => analyzeOverlap('AAAA', 'AAAA', Number.NEGATIVE_INFINITY, 20)).toThrow(/finite/i);
    expect(() => analyzeOverlap('AAAA', 'AAAA', 10, Number.NaN)).toThrow(/finite/i);
    expect(() => analyzeOverlap('AAAA', 'AAAA', 1, 201)).toThrow(/between 1 and 200/i);
  });
});
