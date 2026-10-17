import { describe, expect, it } from 'vitest';
import { toFasta } from '../fasta-parser';
import { atContent, gcContentWindow } from '../gc-content';
import { migrationDistance, renderGelASCII, simulateGel } from '../gel-simulation';
import {
  buildSyntheticGoldenGateVector,
  MAX_SYNTHETIC_VECTOR_FILLER_LENGTH,
} from '../golden-gate';
import { restrictionDigestDetailed } from '../restriction-digest';
import type { RestrictionEnzyme } from '../types';

describe('defensive bounds', () => {
  it('rejects non-positive sliding-window steps before iterating', () => {
    expect(() => gcContentWindow('ACGTACGT', 4, 0)).toThrow(/step/);
    expect(() => gcContentWindow('ACGTACGT', 4, -1)).toThrow(/step/);
    expect(() => gcContentWindow('ACGTACGT', 4, Number.NaN)).toThrow(/step/);
  });

  it('keeps composition fractions defined on ambiguous or empty input', () => {
    expect(atContent('')).toBe(0);
    expect(atContent('NNN')).toBe(0);
    expect(atContent('AATTGGCC')).toBe(0.5);
  });

  it('rejects fractional sliding-window steps before typed-array indexing', () => {
    expect(() => gcContentWindow('ACGTACGT', 4, 0.5)).toThrow(/positive integer/i);
  });

  it('rejects non-positive FASTA line widths', () => {
    const record = { header: 'seq', description: '', sequence: 'ACGT' };
    expect(() => toFasta([record], 0)).toThrow(/lineWidth/);
    expect(() => toFasta([record], -10)).toThrow(/lineWidth/);
    expect(() => toFasta([record], Number.POSITIVE_INFINITY)).toThrow(/lineWidth/);
  });

  it('rejects non-finite and out-of-range gel inputs', () => {
    expect(() => migrationDistance(Number.NaN, 1)).toThrow(/sizeBP/);
    expect(() => migrationDistance(1000, Number.POSITIVE_INFINITY)).toThrow(/agarosePercent/);
    expect(() => simulateGel([{ name: 'sample', fragments: [1000] }], { width: 1 })).toThrow(/width/);
    expect(() => simulateGel([{ name: 'sample', fragments: [1000] }], { height: Number.NaN })).toThrow(/height/);
    expect(() => simulateGel([{ name: 'sample', fragments: [1000] }], { agarosePercent: 0.1 })).toThrow(/agarosePercent/);
    expect(() => simulateGel([{ name: 'sample', fragments: [Number.POSITIVE_INFINITY] }])).toThrow(/fragments/);
    const valid = simulateGel([{ name: 'sample', fragments: [1000] }]);
    expect(() => renderGelASCII({ ...valid, agarosePercent: Number.NaN })).toThrow(/agarosePercent/);
    expect(() => renderGelASCII({ ...valid, bands: [{ ...valid.bands[0], migrationDistance: Number.NaN }] })).toThrow(/migrationDistance/);
  });

  it('aligns ASCII lane labels with the lane columns drawn below them', () => {
    const laneWidth = 8;
    const gel = simulateGel(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name, fragments: [1000] })),
      { width: laneWidth, height: 4 },
    );
    const [header, topBorder] = gel.ascii.split('\n');
    // Lane cells start at column 3 and repeat every laneWidth + 1 columns.
    expect(topBorder.indexOf('┌')).toBe(2);
    gel.lanes.forEach((label, index) => {
      const laneStart = 3 + index * (laneWidth + 1);
      const labelColumn = header.indexOf(label);
      expect(labelColumn, label).toBeGreaterThanOrEqual(laneStart);
      expect(labelColumn + label.length, label).toBeLessThanOrEqual(laneStart + laneWidth);
    });
  });

  it('bounds synthetic vector filler and validates its alphabet', () => {
    expect(() => buildSyntheticGoldenGateVector('ACGT', 'TGCA', {
      fillerLength: MAX_SYNTHETIC_VECTOR_FILLER_LENGTH + 1,
    })).toThrow(/fillerLength/);
    expect(() => buildSyntheticGoldenGateVector('ACGT', 'TGCA', {
      filler: 'ACGN',
    })).toThrow(/A\/C\/G\/T/);
    expect(() => buildSyntheticGoldenGateVector('ACGT', 'TGCA', {
      filler: 'ACGT',
      fillerLength: 3,
    })).toThrow(/match/);
  });

  it('retains every enzyme identity at a shared physical cut coordinate', () => {
    const base: RestrictionEnzyme = {
      name: 'Shared-A',
      recognitionSequence: 'GAATTC',
      cutOffset: 1,
      complementCutOffset: 5,
      overhang: '5prime',
    };
    const result = restrictionDigestDetailed(
      'AAAAGAATTCAAAA',
      ['Shared-A', 'Shared-B'],
      'linear',
      undefined,
      [base, { ...base, name: 'Shared-B' }],
    );

    expect(result.issues).toEqual([]);
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0]?.enzymes).toEqual(['Shared-A', 'Shared-B']);
    expect(result.fragments[0]?.rightEnzymes).toEqual(['Shared-A', 'Shared-B']);
  });
});
