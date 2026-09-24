import { describe, expect, it } from 'vitest';
import { computeMapLayout } from '../layout';
import type { MapInput, MapInputFeature } from '../types';

function misc(id: string, name: string, start: number, end: number, titleName?: string): MapInputFeature {
  return {
    id,
    name,
    type: 'misc_feature',
    start,
    end,
    strand: 1,
    color: '#8a8a8a',
    metadata: {},
    ...(titleName === undefined ? {} : { titleName }),
  };
}

function keptLabels(features: MapInputFeature[]): string[] {
  const input: MapInput = {
    mode: 'circular',
    name: 'rbs priority',
    length: 6000,
    topology: 'circular',
    sequenceType: 'dna',
    features,
    restrictionSites: [],
    width: 720,
    height: 720,
    display: { maxFeatureLabels: 2 },
  };
  return computeMapLayout(input).features.filter((f) => f.label !== null).map((f) => f.id).sort();
}

describe('circular label priority for a generic site named as an RBS', () => {
  // Three 40 bp generic sites outrank a 20 bp generic site on span alone; an
  // RBS name lifts the short site above them. The host draws a shortened name
  // and passes the full one as titleName, so the role must be read from that.
  const generic = [
    misc('site-a', 'site A', 500, 540),
    misc('site-b', 'site B', 2000, 2040),
    misc('site-c', 'site C', 3500, 3540),
  ];

  it('keeps an RBS whose drawn name was cut or lost its "(RBS)"', () => {
    expect(keptLabels([
      ...generic,
      misc('cut', 'ribosome bind…', 4500, 4520, 'ribosome binding site'),
      misc('stripped', 'Shine-Dalgarno', 5200, 5220, 'Shine-Dalgarno (RBS)'),
    ])).toEqual(['cut', 'stripped']);
  });

  it('does not promote a short generic site whose full name is not an RBS', () => {
    expect(keptLabels([
      ...generic,
      misc('short', 'Shine-Dalgarno', 4500, 4520, 'Shine-Dalgarno'),
    ])).toEqual(['site-a', 'site-b']);
  });
});
