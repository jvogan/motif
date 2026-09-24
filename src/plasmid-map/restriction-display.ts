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

/** One enzyme's cut sites inside a map restriction cluster. */
export interface RestrictionClusterEnzyme {
  enzyme: string;
  tickIds: readonly string[];
}

function enzymeOfLayoutTickId(tickId: string): string {
  const at = tickId.lastIndexOf('@');
  return at > 0 ? tickId.slice(0, at) : tickId;
}

/**
 * The enzymes a restriction cluster holds, each with its own tick ids, in the order
 * the cluster's tooltip names them (the order its label reads in), then any the
 * tooltip does not name. A cluster label names its first few enzymes and folds the
 * rest into "+N"; a click on one name has to select that enzyme, not all of them —
 * "HindIII +13" on the synthetic pUC19 once bundled held 14 enzymes and 17 sites.
 */
export function restrictionClusterEnzymes(
  restriction: { tickIds: readonly string[]; title?: string },
): RestrictionClusterEnzyme[] {
  const byEnzyme = new Map<string, string[]>();
  for (const tickId of restriction.tickIds) {
    const enzyme = enzymeOfLayoutTickId(tickId);
    const ids = byEnzyme.get(enzyme);
    if (ids) ids.push(tickId);
    else byEnzyme.set(enzyme, [tickId]);
  }
  const titled = (restriction.title?.split(' · ', 1)[0] ?? '')
    .split(', ')
    .map((name) => name.trim())
    .filter((name) => byEnzyme.has(name));
  const order = [...new Set([...titled, ...byEnzyme.keys()])];
  return order.map((enzyme) => ({ enzyme, tickIds: byEnzyme.get(enzyme) ?? [] }));
}

/**
 * The enzyme a drawn label token names, or null for the "+N" tail and for a token
 * that names nothing in the cluster. A token cut short to fit ("HindI…") still
 * commits the label to one enzyme when exactly one name in the cluster starts with
 * what is left of it.
 */
export function restrictionLabelTokenEnzyme(
  token: string,
  enzymes: readonly RestrictionClusterEnzyme[],
): string | null {
  const text = token.trim();
  if (!text || /^\+\d+$/.test(text)) return null;
  const exact = enzymes.find((entry) => entry.enzyme === text);
  if (exact) return exact.enzyme;
  if (!text.endsWith('…')) return null;
  const stem = text.slice(0, -1);
  const matches = enzymes.filter((entry) => entry.enzyme.startsWith(stem));
  return matches.length === 1 ? matches[0].enzyme : null;
}

/**
 * Split a cluster label into the tokens it is drawn from — enzyme names joined with
 * ", " and an optional "+N" tail after a space, or a bare "+" where a small circular
 * map had no room for the count — so each name can be its own target.
 * Joining the tokens back with those rules reproduces `text` exactly.
 */
export function restrictionLabelTokens(text: string): string[] {
  const tail = /^(.*\S) (\+\d*)$/.exec(text);
  const head = tail ? tail[1] : text;
  const names = head.split(', ');
  return tail ? [...names, tail[2]] : names;
}
