import { describe, expect, it } from 'vitest';
import { unnamedFeaturesTitle } from '../unnamed-features';
import type { MapFeatureRender } from '../types';

describe('unnamedFeaturesTitle', () => {
  const feature = (id: string, name: string, startBp: number, named: boolean): MapFeatureRender => ({
    id,
    name,
    type: 'misc_feature',
    displayStrand: 1,
    color: '',
    lane: 0,
    segmentPaths: ['M0 0'],
    label: named ? { text: name, x: 0, y: 0, anchor: 'start', leader: [], inside: false } : null,
    midBp: startBp + 5,
    startBp,
  });

  it('lists the unnamed features in map order, then says what a click does', () => {
    const title = unnamedFeaturesTitle([
      feature('a', 'M13/pUC reverse primer (-48)', 476, false),
      feature('b', 'AmpR', 1000, true),
      feature('c', 'MCS', 395, false),
    ]);
    expect(title).toBe('Not named on the map: MCS, M13/pUC reverse primer (-48). Click to list all features.');
  });

  it('lists five names and counts the rest', () => {
    const many = Array.from({ length: 8 }, (_, i) => feature(`f${i}`, `F${i}`, 800 - i * 100, false));
    expect(unnamedFeaturesTitle(many)).toBe(
      'Not named on the map: F7, F6, F5, F4, F3 and 3 more. Click to list all features.',
    );
  });

  it('says nothing when every feature is named', () => {
    expect(unnamedFeaturesTitle([feature('a', 'AmpR', 10, true)])).toBeNull();
  });
});
