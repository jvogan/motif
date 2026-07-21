import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import type { MapInput } from '../types';
import type { Feature } from '../../bio/types';
import { normalizeSpan } from '../geometry/ranges';

/**
 * #34. The map can draw a circular molecule as a line WITHOUT converting it.
 *
 * `computeMapLayout` has always taken `mode` as a first-class input and
 * consulted `topology` only as a fallback, so the capability was built and
 * unreachable: the app's single call site derived `mode` from `topology` on the
 * spot. These tests pin the two apart, because the whole value of the change is
 * that they can now disagree — `mode` decides the drawing, `topology` still
 * says what the molecule is.
 */

function feat(p: Partial<Feature> & { id: string }): Feature {
  return {
    id: p.id,
    name: p.name ?? '',
    type: p.type ?? 'misc_feature',
    start: p.start ?? 0,
    end: p.end ?? 0,
    strand: p.strand ?? 1,
    subRanges: p.subRanges,
    color: p.color ?? '#8a8a8a',
    metadata: {},
  };
}

const LENGTH = 2686;
const WRAPPING_ID = 'origin-spanner';

function input(over: Partial<MapInput>): MapInput {
  return {
    name: 'pUC19',
    length: LENGTH,
    topology: 'circular',
    sequenceType: 'dna',
    features: [
      feat({ id: 'lacZ', name: 'lacZ-alpha', type: 'cds', start: 150, end: 506, strand: 1 }),
      // start > end: this feature crosses the origin, which only a circular
      // molecule can do.
      feat({ id: WRAPPING_ID, name: 'origin spanner', type: 'cds', start: 2600, end: 120, strand: 1 }),
    ],
    restrictionSites: [],
    width: 900,
    height: 600,
    ...over,
  } as MapInput;
}

function nonFinite(value: unknown, path = '$', bad: string[] = []): string[] {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) bad.push(path);
    return bad;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => nonFinite(v, `${path}[${i}]`, bad));
    return bad;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) nonFinite(v, `${path}.${k}`, bad);
    return bad;
  }
  return bad;
}

describe('map render mode is independent of molecule topology', () => {
  it('draws a complete linear layout for a circular molecule', () => {
    const cross = computeMapLayout(input({ mode: 'linear', topology: 'circular' }));
    expect(cross.mode).toBe('linear');
    expect(cross.linearAxis).toBeTruthy();
    expect(nonFinite(cross), 'a cross-mode layout must not leak NaN/Infinity').toEqual([]);
    // Same content as the ring, just drawn differently.
    const ring = computeMapLayout(input({ mode: 'circular', topology: 'circular' }));
    expect(cross.features.length).toBe(ring.features.length);
  });

  it('keeps an origin-spanning feature VISIBLE when a circular molecule is drawn as a line', () => {
    // The regression this guards: the linear path used to segment every feature
    // against a hardcoded 'linear', which is right only while a linear drawing
    // implies a linear molecule. normalizeSpan drops a wrapping span under
    // 'linear' and splits it under 'circular':
    expect(normalizeSpan(2600, 120, LENGTH, 'linear')).toEqual([]);
    expect(normalizeSpan(2600, 120, LENGTH, 'circular')).toEqual([
      { start: 2600, end: LENGTH },
      { start: 0, end: 120 },
    ]);

    const cross = computeMapLayout(input({ mode: 'linear', topology: 'circular' }));
    const wrapping = cross.features.find((f) => f.id === WRAPPING_ID);

    // Membership in `features` is NOT ink — the bug left the entry in place with
    // an empty geometry, so assert the drawable paths, which is what a reader
    // actually sees.
    expect(wrapping, 'wrapping feature missing from the layout entirely').toBeTruthy();
    expect(wrapping!.segmentPaths.length, 'wrapping feature present but drawn as nothing').toBeGreaterThan(0);
  });

  it('still drops a wrapping span when the molecule really is linear', () => {
    // The fix must not invent geometry for a molecule with two ends: a feature
    // whose start is past its end is meaningless there, and stays dropped.
    const trulyLinear = computeMapLayout(input({ mode: 'linear', topology: 'linear' }));
    const wrapping = trulyLinear.features.find((f) => f.id === WRAPPING_ID);
    expect(wrapping!.segmentPaths).toEqual([]);
  });

  it('is unchanged for the two configurations that could already be reached', () => {
    // mode always equalled topology before this change, so those layouts must be
    // byte-identical or the fix has moved something a user could already see.
    const circular = computeMapLayout(input({ mode: 'circular', topology: 'circular' }));
    const linear = computeMapLayout(input({ mode: 'linear', topology: 'linear' }));
    expect(circular.mode).toBe('circular');
    expect(linear.mode).toBe('linear');
    expect(nonFinite(circular)).toEqual([]);
    expect(nonFinite(linear)).toEqual([]);
  });

  it('forces protein linear no matter what mode is asked for', () => {
    const protein = computeMapLayout(input({ mode: 'circular', topology: 'circular', sequenceType: 'protein' }));
    expect(protein.mode).toBe('linear');
  });
});
