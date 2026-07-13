/**
 * Restriction ticks + proximity clustering for the map's outer label ring.
 *
 * The map does NOT rescan — it consumes the RestrictionSite[] the block already
 * computed (so map and detail overlay agree by construction). Here we only:
 *   - normalize each site to a stable tick (id, position, cut, strand, TypeIIS),
 *   - cluster nearby ticks so dense regions collapse to "EnzA,EnzB +N" labels.
 *
 * Type IIS classification is geometric (cut falls outside the recognition window),
 * so it holds even when the native scanner drops `strand` (see NOTES.md). The
 * exact top/bottom cut bonds for the sequence overlay come from the existing
 * computeRestrictionCutGeometry at interaction time, not from this layer.
 */
import type { RestrictionSite } from '../../bio/types';

export interface MapRestrictionTick {
  /** Stable id: `${enzyme}@${position}`. */
  id: string;
  enzyme: string;
  /** Recognition-window start (0-indexed) — where the tick anchors on the ring. */
  position: number;
  /** Forward-strand cut bond. */
  cutPosition: number;
  /** Recognition strand (defaults to forward when the scanner omits it). */
  strand: 1 | -1;
  /** Cut falls outside the recognition window (Type IIS visual language). */
  isTypeIIS: boolean;
}

export interface MapRestrictionCluster {
  id: string;
  /** Representative bp for the label anchor + leader (a real tick position). */
  anchorBp: number;
  ticks: readonly MapRestrictionTick[];
  /** Distinct enzyme names, first-occurrence (position) order (deduped). */
  enzymes: readonly string[];
  /** Names actually shown before overflow. */
  shownEnzymes: readonly string[];
  /** Count folded into the "+N" suffix. */
  overflow: number;
  /** Any tick in the cluster is Type IIS (drives the distinct tan/orange color). */
  hasTypeIIS: boolean;
}

/**
 * Normalize a RestrictionSite into a map tick. When the molecule is circular the
 * cutPosition may already be modulo-normalized (e.g. a site at position 96 on a
 * 100bp circle cutting at bond 1 = raw 101), so Type IIS is classified by the
 * MODULAR distance from the recognition start rather than a raw comparison.
 */
export function toRestrictionTick(
  site: RestrictionSite,
  length?: number,
  circular?: boolean,
): MapRestrictionTick {
  const strand: 1 | -1 = site.strand === -1 ? -1 : 1;
  const recogLen = site.recognitionSequence.length;
  let isTypeIIS: boolean;
  if (circular && length && length > 0) {
    const delta = (((site.cutPosition - site.position) % length) + length) % length;
    isTypeIIS = delta > recogLen;
  } else {
    isTypeIIS = site.cutPosition < site.position || site.cutPosition > site.position + recogLen;
  }
  return {
    id: `${site.enzyme}@${site.position}`,
    enzyme: site.enzyme,
    position: site.position,
    cutPosition: site.cutPosition,
    strand,
    isTypeIIS,
  };
}

export interface ClusterOptions {
  /** Ticks within this many bp of each other collapse into one cluster. */
  minSepBp: number;
  /** Refuse transitive chains whose total cluster span would exceed this cap. */
  maxClusterSpanBp?: number;
  /** Max enzyme names shown before "+N". */
  maxNamesPerCluster: number;
  /** Merge the origin seam (first + last group) when circular. */
  circular: boolean;
}

/**
 * Cluster ticks by bp proximity. Deterministic (sorted by position then enzyme).
 * For circular molecules the origin seam is merged so ticks straddling 0 don't
 * split into two half-clusters.
 */
export function clusterRestrictionTicks(
  ticks: readonly MapRestrictionTick[],
  length: number,
  opts: ClusterOptions,
): MapRestrictionCluster[] {
  if (ticks.length === 0 || length <= 0) return [];
  const minSepBp = Math.max(0, opts.minSepBp);
  const maxClusterSpanBp = Math.max(
    0,
    opts.maxClusterSpanBp ?? opts.minSepBp,
  );

  const sorted = [...ticks].sort(
    (a, b) =>
      a.position - b.position ||
      (a.enzyme < b.enzyme ? -1 : a.enzyme > b.enzyme ? 1 : 0) ||
      // Fully order same-position, same-enzyme ticks (isoschizomers / both-strand
      // matches) so cluster grouping + output are deterministic, not sort-stable-dependent.
      a.cutPosition - b.cutPosition ||
      a.strand - b.strand,
  );

  const groups: MapRestrictionTick[][] = [];
  let current: MapRestrictionTick[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = current[current.length - 1];
    const next = sorted[i];
    const gap = next.position - prev.position;
    const span = next.position - current[0].position;
    if (gap <= minSepBp && span <= maxClusterSpanBp) {
      current.push(next);
    } else {
      groups.push(current);
      current = [next];
    }
  }
  groups.push(current);

  // Circular origin-seam merge: fold the last group into the first if the wrap
  // gap between them is within the clustering threshold.
  if (opts.circular && groups.length > 1) {
    const firstPos = groups[0][0].position;
    const lastGroup = groups[groups.length - 1];
    const lastPos = lastGroup[lastGroup.length - 1].position;
    const wrapGap = length - lastPos + firstPos;
    const wrapSpan =
      length - lastGroup[0].position + groups[0][groups[0].length - 1].position;
    if (wrapGap <= minSepBp && wrapSpan <= maxClusterSpanBp) {
      groups[0] = [...groups.pop()!, ...groups[0]];
    }
  }

  return groups.map((group, index) => buildCluster(group, index, opts.maxNamesPerCluster));
}

function buildCluster(
  group: readonly MapRestrictionTick[],
  index: number,
  maxNames: number,
): MapRestrictionCluster {
  // Display/name lists are DISTINCT enzyme names — an enzyme that cuts several
  // times inside one cluster becomes a single name, never "BsmFI,BsmFI". Set
  // preserves first-occurrence (position) order; ticks[] below keeps every real
  // cut site, so tick counts / overflow-site banners are unaffected.
  const enzymes = [...new Set(group.map((t) => t.enzyme))];
  // Show Type IIS names first, still DISTINCT, before capping to maxNames.
  const shownEnzymes = [
    ...new Set([
      ...group.filter((t) => t.isTypeIIS).map((t) => t.enzyme),
      ...group.filter((t) => !t.isTypeIIS).map((t) => t.enzyme),
    ]),
  ].slice(0, Math.max(1, maxNames));
  // "+N" counts DISTINCT enzymes not shown (not raw ticks).
  const overflow = enzymes.length - shownEnzymes.length;
  // Anchor on a real middle tick so wrap-merged clusters still get a sane bp.
  const anchor = group[Math.floor(group.length / 2)];
  return {
    id: `recl-${index}-${group[0].id}`,
    anchorBp: anchor.position,
    ticks: group,
    enzymes,
    shownEnzymes,
    overflow,
    hasTypeIIS: group.some((t) => t.isTypeIIS),
  };
}

/** Convenience: sites -> ticks -> clusters in one call. */
export function buildRestrictionClusters(
  sites: readonly RestrictionSite[],
  length: number,
  opts: ClusterOptions,
): { ticks: MapRestrictionTick[]; clusters: MapRestrictionCluster[] } {
  // Drop non-finite positions so a corrupt site can never produce NaN tick/label
  // coordinates (which would otherwise poison the fitted viewBox for the whole map).
  const clean = sites.filter(
    (s) => Number.isFinite(s.position) && Number.isFinite(s.cutPosition),
  );
  const ticks = clean.map((s) => toRestrictionTick(s, length, opts.circular));
  const clusters = clusterRestrictionTicks(ticks, length, opts);
  return { ticks, clusters };
}
