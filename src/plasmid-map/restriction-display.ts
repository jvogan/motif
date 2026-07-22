import type { RestrictionSite } from '../bio/types';
import type { MapRestrictionDensitySource } from './types';

export const MAX_INTERACTIVE_MAP_RESTRICTION_SITES = 512;
export const MAX_MAP_RESTRICTION_DENSITY_MARKS = 512;

function compareRestrictionSites(a: RestrictionSite, b: RestrictionSite): number {
  return a.position - b.position
    || a.enzyme.localeCompare(b.enzyme)
    || a.cutPosition - b.cutPosition
    || (a.strand ?? 1) - (b.strand ?? 1)
    || a.recognitionSequence.localeCompare(b.recognitionSequence);
}

/**
 * Keep normal records exact. At the extreme boundary, choose evenly spaced sites
 * from position-sorted data so interactive SVG controls stay bounded without
 * favoring the beginning of a record.
 */
export function restrictionSitesForInteractiveMap(
  sites: readonly RestrictionSite[],
  limit = MAX_INTERACTIVE_MAP_RESTRICTION_SITES,
): readonly RestrictionSite[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : MAX_INTERACTIVE_MAP_RESTRICTION_SITES;
  if (sites.length <= safeLimit) return sites;
  const sorted = [...sites].sort(compareRestrictionSites);
  if (safeLimit === 1) return [sorted[Math.floor((sorted.length - 1) / 2)]];
  return Array.from({ length: safeLimit }, (_, index) => (
    sorted[Math.floor(index * (sorted.length - 1) / (safeLimit - 1))]
  ));
}

/**
 * Aggregate the decorative density substrate in sequence space before layout.
 * Each returned mark carries its raw-site count, so the renderer and tests can
 * reconcile the visible marks with the complete site list.
 */
export function restrictionDensitySourcesForMap(
  sites: readonly RestrictionSite[],
  sequenceLength: number,
  limit = MAX_MAP_RESTRICTION_DENSITY_MARKS,
): readonly MapRestrictionDensitySource[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : MAX_MAP_RESTRICTION_DENSITY_MARKS;
  if (sites.length <= safeLimit) {
    return sites.map((site, index) => ({
      id: `site-${index}-${site.enzyme}-${site.position}`,
      position: site.position,
      siteCount: 1,
    }));
  }

  type Bin = { count: number; positionTotal: number };
  const bins: Array<Bin | undefined> = new Array(safeLimit);
  const usableLength = Number.isFinite(sequenceLength) && sequenceLength > 0 ? sequenceLength : 0;
  sites.forEach((site, index) => {
    const sequenceRatio = usableLength > 0 && Number.isFinite(site.position)
      ? site.position / usableLength
      : index / sites.length;
    const boundedRatio = Math.max(0, Math.min(1 - Number.EPSILON, sequenceRatio));
    const binIndex = Math.floor(boundedRatio * safeLimit);
    const bin = bins[binIndex];
    if (bin) {
      bin.count += 1;
      bin.positionTotal += site.position;
    } else {
      bins[binIndex] = { count: 1, positionTotal: site.position };
    }
  });

  const sources: MapRestrictionDensitySource[] = [];
  bins.forEach((bin, binIndex) => {
    if (!bin) return;
    sources.push({
      id: `bin-${binIndex}`,
      position: bin.positionTotal / bin.count,
      siteCount: bin.count,
    });
  });
  return sources;
}
