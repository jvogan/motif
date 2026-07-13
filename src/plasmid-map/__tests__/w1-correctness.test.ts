/**
 * W1 correctness hardening — pure-layout guards.
 * (1) Non-finite length/width/height never produce a NaN viewBox (which would blank
 *     the whole SVG). (2) Restriction clustering is fully deterministic (order-
 *     independent) after the cutPosition/strand tie-breakers.
 */
import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import type { MapInput, MapLayout } from '../types';
import { normalizeSpan } from '../geometry/ranges';
import { buildRestrictionClusters } from '../geometry/restrictions';
import type { RestrictionSite } from '../../bio/types';

const baseInput = (over: Partial<MapInput>): MapInput => ({
  mode: 'circular',
  name: 't',
  length: 3000,
  topology: 'circular',
  sequenceType: 'dna',
  features: [],
  restrictionSites: [],
  width: 600,
  height: 600,
  ...over,
});

function isFiniteLayout(layout: MapLayout): boolean {
  if (/NaN|Infinity/.test(layout.viewBox)) return false;
  const { x, y, width, height } = layout.bg;
  return [x, y, width, height].every(Number.isFinite);
}

describe('W1: non-finite input guards', () => {
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    it(`length=${bad} → finite circular viewBox`, () => {
      expect(isFiniteLayout(computeMapLayout(baseInput({ length: bad })))).toBe(true);
    });
    it(`width=${bad} → finite viewBox`, () => {
      expect(isFiniteLayout(computeMapLayout(baseInput({ width: bad })))).toBe(true);
    });
    it(`height=${bad} (linear) → finite viewBox`, () => {
      expect(
        isFiniteLayout(computeMapLayout(baseInput({ mode: 'linear', topology: 'linear', height: bad }))),
      ).toBe(true);
    });
  }

  it('a non-finite length with real features/sites still yields a finite layout', () => {
    const layout = computeMapLayout(
      baseInput({
        length: Number.NaN,
        features: [{ id: 'f', name: 'x', type: 'cds', start: 10, end: 90, strand: 1, color: '#888', metadata: {} } as never],
        restrictionSites: [{ enzyme: 'EcoRI', position: 50, cutPosition: 51, recognitionSequence: 'GAATTC', overhang: 'blunt' }],
      }),
    );
    expect(isFiniteLayout(layout)).toBe(true);
  });

  it('normalizeSpan drops a non-finite length', () => {
    expect(normalizeSpan(0, 10, Number.NaN, 'circular')).toEqual([]);
    expect(normalizeSpan(0, 10, Infinity, 'linear')).toEqual([]);
  });
});

describe('W1: restriction clustering determinism', () => {
  const site = (enzyme: string, position: number, cutPosition: number, strand?: 1 | -1): RestrictionSite => ({
    enzyme,
    position,
    cutPosition,
    recognitionSequence: 'GAATTC',
    overhang: 'blunt',
    ...(strand ? { strand } : {}),
  });

  it('is order-independent — shuffled input yields byte-identical clusters', () => {
    const sites = [
      site('EcoRI', 100, 103),
      site('BsaI', 100, 108, -1), // same position, different enzyme + strand
      site('AluI', 100, 106), // same position again → exercises the tie-breakers
      site('HaeIII', 500, 502),
      site('TaqI', 503, 505),
    ];
    const opts = { minSepBp: 10, maxNamesPerCluster: 3, circular: true };
    const forward = JSON.stringify(buildRestrictionClusters(sites, 3000, opts).clusters);
    const reversed = JSON.stringify(buildRestrictionClusters([...sites].reverse(), 3000, opts).clusters);
    const rotated = JSON.stringify(
      buildRestrictionClusters([sites[2], sites[4], sites[0], sites[3], sites[1]], 3000, opts).clusters,
    );
    expect(reversed).toBe(forward);
    expect(rotated).toBe(forward);
  });
});
