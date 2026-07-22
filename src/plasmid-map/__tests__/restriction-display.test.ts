import { describe, expect, it } from 'vitest';
import type { RestrictionSite } from '../../bio/types';
import {
  MAX_INTERACTIVE_MAP_RESTRICTION_SITES,
  MAX_MAP_RESTRICTION_DENSITY_MARKS,
  restrictionDensitySourcesForMap,
  restrictionSitesForInteractiveMap,
} from '../restriction-display';

function site(position: number, enzyme = `E${position}`): RestrictionSite {
  return {
    enzyme,
    position,
    cutPosition: position + 1,
    recognitionSequence: 'AAAA',
    overhang: 'blunt',
    strand: 1,
  };
}

describe('restriction map display budgets', () => {
  it('returns the original site collection below the interactive boundary', () => {
    const sites = [site(10), site(20)];
    expect(restrictionSitesForInteractiveMap(sites)).toBe(sites);
  });

  it('samples interactive sites across the complete coordinate range', () => {
    const sites = Array.from(
      { length: MAX_INTERACTIVE_MAP_RESTRICTION_SITES * 4 },
      (_, index) => site(index),
    ).reverse();
    const selected = restrictionSitesForInteractiveMap(sites);

    expect(selected).toHaveLength(MAX_INTERACTIVE_MAP_RESTRICTION_SITES);
    expect(selected[0].position).toBe(0);
    expect(selected.at(-1)?.position).toBe(sites.length - 1);
    expect(selected.every((entry, index) => index === 0 || entry.position > selected[index - 1].position)).toBe(true);
  });

  it('bins density marks while preserving the exact raw-site population', () => {
    const sites = Array.from({ length: 125_000 }, (_, index) => site(index * 2, `E${index % 7}`));
    const density = restrictionDensitySourcesForMap(sites, 250_000);

    expect(density.length).toBeLessThanOrEqual(MAX_MAP_RESTRICTION_DENSITY_MARKS);
    expect(density.reduce((sum, mark) => sum + mark.siteCount, 0)).toBe(sites.length);
    expect(density[0].position).toBeGreaterThanOrEqual(0);
    expect(density.at(-1)?.position).toBeLessThan(250_000);
  });
});
