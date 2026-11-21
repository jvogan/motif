import { describe, expect, it } from 'vitest';
import { mapFeaturesForDrawing } from '../motif-artifact';
import { computeMapLayout } from '../../plasmid-map/layout';
import { parseFeatures } from '../../bio/genbank-parser';
import type { Feature } from '../../bio/types';

function feature(id: string, name: string, type: Feature['type'], start: number, end: number): Feature {
  return { id, name, type, start, end, strand: 1, color: '#8a8a8a', metadata: {} };
}

// The map draws the name the record gives each feature, end-truncated only where
// it does not fit. Its tooltip and accessible name always carry the full name.
const features = [
  feature('box', 'sigma70 -35 box', 'regulatory', 39, 45),
  feature('primer', 'M13/pUC forward primer (-47)', 'primer_bind', 300, 323),
  feature('amp', 'AmpR promoter', 'promoter', 900, 1005),
  feature('ori', 'ori', 'origin', 1500, 2089),
];

describe('map feature names', () => {
  it('passes every name through unchanged', () => {
    expect(mapFeaturesForDrawing(features).map((f) => f.name)).toEqual([
      'sigma70 -35 box',
      'M13/pUC forward primer (-47)',
      'AmpR promoter',
      'ori',
    ]);
  });

  it('leaves whole-record source features off the map', () => {
    const source: Feature = {
      ...feature('src', 'source', 'custom', 0, 3000),
      metadata: { motifOriginalFeatureKey: 'source' },
    };
    expect(mapFeaturesForDrawing([source, ...features]).map((f) => f.id)).toEqual(['box', 'primer', 'amp', 'ori']);
  });

  for (const mode of ['circular', 'linear'] as const) {
    it(`announces the full name on the ${mode} map`, () => {
      const layout = computeMapLayout({
        mode,
        name: 'demo',
        length: 3000,
        topology: 'circular',
        sequenceType: 'dna',
        features: mapFeaturesForDrawing(features),
        restrictionSites: [],
        width: 900,
        height: 700,
      });
      const byId = new Map(layout.features.map((f) => [f.id, f]));
      expect(byId.get('box')!.title).toBe('sigma70 -35 box · regulatory · 40–45 →');
      expect(byId.get('primer')!.title).toBe('M13/pUC forward primer (-47) · primer_bind · 301–323 →');
      expect(byId.get('amp')!.title).toBe('AmpR promoter · promoter · 901–1005 →');
      expect(byId.get('ori')!.title).toBe('ori · origin · 1501–2089 →');
      // The drawn labels are the record's names, never abbreviations.
      const drawn = layout.features.map((f) => f.label?.text).filter(Boolean);
      expect(drawn).toContain('AmpR promoter');
      expect(drawn).not.toContain('AmpR prom.');
    });

    it(`names a regulatory feature's class on the ${mode} map`, () => {
      const [box] = parseFeatures([
        '     -35_signal      40..45',
        '                     /label="sigma70 -35 box"',
      ].join('\n'));
      const layout = computeMapLayout({
        mode,
        name: 'demo',
        length: 300,
        topology: 'linear',
        sequenceType: 'dna',
        features: mapFeaturesForDrawing([box]),
        restrictionSites: [],
        width: 900,
        height: 700,
      });
      expect(layout.features[0].title).toBe('sigma70 -35 box · regulatory (minus_35_signal) · 40–45 →');
    });
  }
});
