import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import { approxTextWidth, capitalWidthPadPx } from '../geometry/labels';
import type { MapInput, MapLabelRender } from '../types';
import type { Feature } from '../../bio/types';

/**
 * The 229,354 bp HCMV record X17403 names its genes in capitals and digits. The
 * linear map spaced its outside names by the fixed-advance estimate, which runs
 * short for capitals, so two names on one row painted into each other
 * ("HCMVUL56HCMVUL96"). Widths below are Chromium's painted widths of those names
 * at the map's label size, in layout units.
 */

const PAINTED: Record<string, number> = { HCMVUL56: 76.7, HCMVUL96: 76.9 };
const LENGTH = 20000;

function feat(p: Partial<Feature> & { id: string }): Feature {
  return {
    id: p.id,
    name: p.name ?? p.id,
    type: p.type ?? 'cds',
    start: p.start ?? 0,
    end: p.end ?? 0,
    strand: p.strand ?? 1,
    color: '#8a8a8a',
    metadata: {},
  };
}

function input(bStart: number): MapInput {
  return {
    mode: 'linear',
    name: 'capital names',
    length: LENGTH,
    topology: 'linear',
    sequenceType: 'dna',
    features: [
      feat({ id: 'a', name: 'HCMVUL56', start: 200, end: 240, strand: -1 }),
      feat({ id: 'b', name: 'HCMVUL96', start: bStart, end: bStart + 40, strand: -1 }),
    ],
    restrictionSites: [],
    width: 1100,
    height: 320,
  };
}

/** The painted x-extent of a name, from its anchor and its painted width. */
function painted(label: MapLabelRender): [number, number] {
  const w = PAINTED[label.text];
  if (label.anchor === 'start') return [label.x, label.x + w];
  if (label.anchor === 'end') return [label.x - w, label.x];
  return [label.x - w / 2, label.x + w / 2];
}

describe('outside names set in capitals on the linear map', () => {
  it('pads a name for the capitals its lowercase letters do not offset', () => {
    expect(capitalWidthPadPx('HCMVUL56')).toBeGreaterThan(PAINTED.HCMVUL56 - approxTextWidth('HCMVUL56'));
    expect(capitalWidthPadPx('lacZ-alpha')).toBe(0);
    expect(capitalWidthPadPx('HCMVUL56', undefined, 'monospace')).toBe(0);
  });

  it('never paints two names on one row into each other', () => {
    let bothShown = 0;
    for (let bStart = 4000; bStart > 240; bStart -= 5) {
      const layout = computeMapLayout(input(bStart));
      const a = layout.features.find((f) => f.id === 'a')!.label;
      const b = layout.features.find((f) => f.id === 'b')!.label;
      if (!a || !b || a.inside || b.inside || a.y !== b.y) continue;
      bothShown += 1;
      const [a0, a1] = painted(a);
      const [b0, b1] = painted(b);
      const gap = Math.max(b0 - a1, a0 - b1);
      expect(gap, `b at ${bStart}`).toBeGreaterThanOrEqual(0);
    }
    expect(bothShown).toBeGreaterThan(3);
  });
});
