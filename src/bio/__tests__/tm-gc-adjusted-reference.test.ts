import { describe, expect, it } from 'vitest';
import { calculateTm } from '../tm-calculator';

// 22 nt, 11 G/C (50% GC).
const PRIMER_22 = 'ACGTGCATGCAGTCAGTAGATC';

describe('GC-adjusted Tm reference condition', () => {
  it('returns the formula value at its own 50 mM Na+ reference condition', () => {
    // 64.9 + 41 * (11 - 16.4) / 22 = 54.84 °C, already a 50 mM Na+ estimate.
    const result = calculateTm(PRIMER_22, { method: 'gc-adjusted' });
    expect(result.tm).toBeCloseTo(54.8, 1);
    expect(result.tm).toBeGreaterThan(52);
    expect(result.tm).toBeLessThan(65);
  });

  it('stays within a few degrees of the nearest-neighbor estimate under default conditions', () => {
    const gc = calculateTm(PRIMER_22, { method: 'gc-adjusted' }).tm;
    const nn = calculateTm(PRIMER_22).tm;
    expect(Math.abs(gc - nn)).toBeLessThan(6);
  });

  it('still responds to buffer changes relative to the reference condition', () => {
    const reference = calculateTm(PRIMER_22, { method: 'gc-adjusted' }).tm;
    const highSalt = calculateTm(PRIMER_22, { method: 'gc-adjusted', naConcentration: 1000 }).tm;
    const lowSalt = calculateTm(PRIMER_22, { method: 'gc-adjusted', naConcentration: 10 }).tm;
    const withMg = calculateTm(PRIMER_22, { method: 'gc-adjusted', mgConcentration: 1.5, dntpConcentration: 0.2 }).tm;
    expect(highSalt).toBeGreaterThan(reference + 5);
    expect(lowSalt).toBeLessThan(reference);
    expect(withMg).toBeGreaterThan(reference);
  });

  it('keeps correcting the Wallace rule from its high-salt reference condition', () => {
    // 2 * 11 + 4 * 11 = 66 °C at ~1 M Na+; no correction is applied there.
    expect(calculateTm(PRIMER_22, { method: 'wallace', naConcentration: 1000 }).tm).toBe(66);
    expect(calculateTm(PRIMER_22, { method: 'wallace' }).tm).toBeLessThan(66);
  });
});
