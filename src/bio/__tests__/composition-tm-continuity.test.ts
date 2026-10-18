import { describe, expect, it } from 'vitest';
import { meltingTemperature, meltingTemperatureFromComposition, nucleotideComposition } from '../gc-content';

// 20 nt, 10 G/C.
const OLIGO_20 = 'ACGTGCATGCAGTCAGTAGA';

describe('composition-only melting temperature', () => {
  it('does not drop sharply between a 20-mer and its one-base extension', () => {
    const twenty = meltingTemperature(OLIGO_20);
    const twentyOne = meltingTemperature(`${OLIGO_20}A`);
    expect(twenty).not.toBeNull();
    expect(twentyOne).not.toBeNull();
    expect(Math.abs((twentyOne as number) - (twenty as number))).toBeLessThan(2);
    for (const value of [twenty, twentyOne] as number[]) {
      expect(value).toBeGreaterThan(45);
      expect(value).toBeLessThan(65);
    }
  });

  it('changes by no more than one Wallace base step for any single-base extension', () => {
    for (const seed of ['A', 'G', 'AT', 'GC']) {
      for (const base of ['A', 'T', 'G', 'C']) {
        let sequence = seed.repeat(8).slice(0, 8);
        let previous = meltingTemperature(sequence) as number;
        for (let length = 9; length <= 40; length += 1) {
          sequence += length % 2 === 0 ? base : seed[0];
          const next = meltingTemperature(sequence) as number;
          expect(Math.abs(next - previous), `${sequence}`).toBeLessThanOrEqual(4.5);
          previous = next;
        }
      }
    }
  });

  it('keeps the Wallace rule for short oligos and the basic formula for long ones', () => {
    expect(meltingTemperature('ACGTACGTAC')).toBe(2 * 5 + 4 * 5);
    const long = 'ACGT'.repeat(10);
    expect(meltingTemperature(long)).toBeCloseTo(64.9 + 41 * (20 - 16.4) / 40, 6);
  });

  it('keeps null for an empty composition', () => {
    expect(meltingTemperatureFromComposition(nucleotideComposition(''))).toBeNull();
    expect(meltingTemperature('NNNN')).toBeNull();
  });
});
