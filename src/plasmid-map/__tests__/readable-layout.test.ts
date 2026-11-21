import { describe, expect, it } from 'vitest';
import vectors from '../../../public/data/vectors.json';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { resolveEnzymeUnion } from '../../bio/restriction-presets';
import type { Feature } from '../../bio/types';
import { restrictionSitesForInteractiveMap } from '../restriction-display';
import { computeMapLayout } from '../layout';
import { computeReadableMapLayout, mapScreenScale, MIN_SCREEN_MAP_LABEL_PX } from '../readable-layout';
import { LABEL_FONT_PX } from '../geometry/labels';
import type { MapInput } from '../types';

/** The built-in pUC19 with every common enzyme, as the map draws it on "All". */
function input(width: number, height: number): MapInput {
  const record = vectors.find((candidate) => candidate.name === 'pUC19')!;
  const sites = findRestrictionSites(record.sequence, resolveEnzymeUnion(['common']), { topology: 'circular' });
  return {
    mode: 'circular',
    name: record.name,
    length: record.sequence.length,
    topology: 'circular',
    sequenceType: 'dna',
    features: record.features.map((f) => ({ ...f, metadata: f.metadata ?? {} })) as Feature[],
    restrictionSites: restrictionSitesForInteractiveMap(sites),
    width,
    height,
    display: { labelDensity: 'high', labelFontMode: 'proportional', circularOutsideGutterScale: 0.28 },
  };
}

describe('readable circular map layout', () => {
  it('keeps 16px map labels at 12 screen px or more in a 290px pane', () => {
    const minScale = MIN_SCREEN_MAP_LABEL_PX / LABEL_FONT_PX;
    const plain = computeMapLayout(input(290, 320));
    expect(mapScreenScale(plain, 290, 320)).toBeLessThan(minScale);

    const readable = computeReadableMapLayout(input(290, 320));
    expect(mapScreenScale(readable, 290, 320)).toBeGreaterThanOrEqual(minScale - 0.01);
    expect(readable.features.filter((f) => f.label).length).toBeGreaterThan(0);
  });

  it('leaves a wide pane and a linear map exactly as computeMapLayout draws them', () => {
    expect(computeReadableMapLayout(input(1000, 800))).toEqual(computeMapLayout(input(1000, 800)));
    const linear = { ...input(290, 320), mode: 'linear' as const };
    expect(computeReadableMapLayout(linear)).toEqual(computeMapLayout(linear));
  });
});
