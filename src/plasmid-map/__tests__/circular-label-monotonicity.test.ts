import { describe, expect, it } from 'vitest';
import vectors from '../../../public/data/vectors.json';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { resolveEnzymeUnion } from '../../bio/restriction-presets';
import type { Feature } from '../../bio/types';
import { computeMapLayout } from '../layout';
import { restrictionDensitySourcesForMap, restrictionSitesForInteractiveMap } from '../restriction-display';
import type { MapLayout } from '../types';

/**
 * A circular map that grows can draw FEWER labels than it drew when it was smaller.
 * These tests pin how often that happens today and how bad the worst step is. They
 * do NOT assert that it never happens, because it does.
 *
 * Two mechanisms produce it, both measured:
 *
 * 1. The per-label TEXT budget widens with the pane. `circularRecLabelMaxWidth` steps
 *    from 129.6px to 171px as `baseSide` crosses 480, so every cluster label may print
 *    more enzyme names, every label box gets wider, and the collision cascade in
 *    `placeCircularRadialLabels` deletes the ones that no longer fit. All five records
 *    below lose labels at that one step. It is a trade, not a straight regression: the
 *    map names MORE sites afterwards, which is why LOSS_AT_480 asserts both directions.
 *
 * 2. `layoutRadialTierLabels` searches tiers and bounded angular drift greedily, so its
 *    result is a discontinuous function of the ring radius. A 1px radius change can flip
 *    one label onto a tier where its leader crosses a neighbour's box; the cascade then
 *    deletes the leader's owner and the single-candidate re-pack finds nowhere to put it.
 *    This accounts for most of the census below and no threshold explains it.
 *
 * Four candidate one-line inversions were measured and none fixes it: holding the
 * restriction clearance constant (64 shrink steps to 70), removing the outer-tier bonus
 * above baseSide 600 (to 67), widening the angular search above 480 (to 61), and capping
 * the text budget continuously (to 59, at the cost of 2,505 enzyme names). Closing this
 * needs the radial placer to become continuous in the radius, which is a rewrite.
 *
 * The census rose from 64 to 69 when the re-pack pass gained its second, wider angular
 * attempt. That was a deliberate trade and it is priced here rather than hidden: over
 * the same 1,805 panes the ring gained 83 labels, 153 named sites and 18 distinct enzyme
 * names, 91 panes gained a label against 15 that lost one, every loss is -1, and every
 * one of the 15 is a frequent-cutter cluster that already carried a "+N" tail. Nothing
 * on the ring overlaps, leader-through-label crossings fell from 780 to 778, and the
 * fitted viewBox is byte-identical on all 1,805 panes.
 *
 * The census rose again, from 69 to 85, when pUC19, pBR322 and pcDNA3.1(+) were
 * replaced by the real plasmid sequences. The worst step
 * improved from -4 to -3 and is held there. The real records carry far more enzyme
 * clusters (pBR322 25 against 6), so their rings are harder to pack; the two
 * mechanisms above are unchanged, and the pET and Duet counts did not move.
 *
 * It rose from 85 to 86 when the cloning-site cluster began to outrank up to two
 * feature names around it. Over the 361 panes of this sweep the polylinker is named
 * on pUC19 at 361 instead of 275, on pBluescript SK(+) at 361 instead of 314 and on
 * pET-28a(+) at 91 instead of 3. pET-28a(+) pays for it: one more shrink step, and 2
 * panes where the cluster's name costs two feature names.
 *
 * Leading each cluster label with an enzyme that cuts once re-words labels, so their
 * widths and the packing move. The total stays 86: pBR322 17 to 15, pcDNA3.1(+) 14 to
 * 13, pETDuet-1 29 to 32.
 *
 * It rose from 86 to 87 when a small map began spelling a cluster's lead enzyme whole
 * and dropping the count's digits instead ("HaeIII +" for "HaeI… +1"). No pane lost a
 * label. pUC19 gained a feature name at baseSide 290 to 296, which it drops again at
 * 298, and that drop is the new step.
 */

/** The artifact's own map-label shortening, so these names match the painted page. */
function compactMapName(name: string): string {
  const compact = name
    .replace(/\bforward\b/gi, 'fwd')
    .replace(/\breverse\b/gi, 'rev')
    .replace(/\bpromoter\b/gi, 'prom.')
    .replace(/\bprimer\b/gi, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > 14 ? `${compact.slice(0, 13).trimEnd()}…` : compact;
}

const RECORDS = ['pUC19', 'pET-28a(+)', 'pETDuet-1', 'pBR322', 'pcDNA3.1(+)'] as const;

type SizelessMapInput = Omit<Parameters<typeof computeMapLayout>[0], 'width' | 'height'>;

/** Restriction digestion is the slow part and does not depend on the pane; do it once. */
const prepared = new Map<string, SizelessMapInput>();

function circularLayout(recordName: string, width: number, height: number): MapLayout {
  let entry = prepared.get(recordName);
  if (!entry) {
    const record = vectors.find((candidate) => candidate.name === recordName)!;
    const sites = findRestrictionSites(
      record.sequence,
      resolveEnzymeUnion(['common', 'golden-gate-type-iis']),
      { topology: 'circular' },
    );
    const features = record.features.map((feature) => ({
      ...feature,
      name: compactMapName(feature.name),
      metadata: feature.metadata ?? {},
    })) as Feature[];
    entry = {
      mode: 'circular',
      name: record.name,
      length: record.sequence.length,
      topology: 'circular',
      sequenceType: 'dna',
      features,
      restrictionSites: restrictionSitesForInteractiveMap(sites),
      restrictionDensitySources: restrictionDensitySourcesForMap(sites, record.sequence.length),
      fillAvailableHeight: true,
      display: {
        labelDensity: 'high',
        labelFontMode: 'proportional',
        circularOutsideGutterScale: 0.28,
        maxFeatureLabels: 18,
        maxRestrictionLabels: 24,
        showFeatureLabels: true,
        showRestrictionLabels: true,
      },
    };
    prepared.set(recordName, entry);
  }
  return computeMapLayout({ ...entry, width, height });
}

interface Reading {
  /** One entry per cluster tick that a drawn label points at, keyed by tick id. */
  namedTicks: Set<string>;
  /** One entry per drawn feature label, keyed by feature id. */
  namedFeatures: Set<string>;
  /** Drawn labels: one per labelled cluster plus one per labelled feature. */
  labels: number;
  /** Sites whose OWN enzyme name is printed, rather than counted in a "+N" tail. */
  namedSites: number;
}

function read(layout: MapLayout): Reading {
  const namedTicks = new Set<string>();
  let labels = 0;
  let namedSites = 0;
  for (const restriction of layout.restrictions) {
    if (!restriction.label) continue;
    labels += 1;
    const spelled = (restriction.labelSegments ?? []).filter((segment) => !segment.text.startsWith('+')).length;
    namedSites += Math.min(spelled, restriction.tickIds.length);
    for (const tickId of restriction.tickIds) namedTicks.add(tickId);
  }
  const namedFeatures = new Set<string>();
  for (const feature of layout.features) {
    if (!feature.label) continue;
    labels += 1;
    namedFeatures.add(feature.id);
  }
  return { namedTicks, namedFeatures, labels, namedSites };
}

const signature = (reading: Reading): string =>
  `${[...reading.namedTicks].sort().join(';')}||${[...reading.namedFeatures].sort().join(';')}`;

describe('circular label placement across pane sizes', () => {
  it('reads the pane only through min(width, height)', () => {
    // Nothing in the circular label pipeline reads width and height separately: every
    // radius, gutter, text budget and threshold is a function of `baseSide`. That makes
    // the label set a function of ONE number, which is what lets the census below sweep
    // a single axis and still cover every pane shape.
    const differences: string[] = [];
    let comparisons = 0;
    for (const name of RECORDS) {
      for (let baseSide = 240; baseSide <= 960; baseSide += 20) {
        const landscape = signature(read(circularLayout(name, baseSide + 400, baseSide)));
        const portrait = signature(read(circularLayout(name, baseSide, baseSide + 400)));
        const square = signature(read(circularLayout(name, baseSide, baseSide)));
        comparisons += 2;
        if (portrait !== landscape) differences.push(`${name} ${baseSide}: portrait differs from landscape`);
        if (square !== landscape) differences.push(`${name} ${baseSide}: square differs from landscape`);
      }
    }
    expect(comparisons).toBe(370);
    expect(differences).toEqual([]);
  }, 120_000);

  it('drops a label at 87 of the 1800 steps that make the pane bigger', () => {
    // The census. Each record is swept over baseSide 240 to 960 in 2px steps, which
    // spans every map pane the artifact produces (260 at the shortest dock, 955 at the
    // tallest window). A step counts as a shrink when the pane grew and the map came
    // back with fewer drawn labels than it had.
    const shrinkByRecord: Record<string, number> = {};
    let steps = 0;
    let worst = 0;
    for (const name of RECORDS) {
      shrinkByRecord[name] = 0;
      let previous: Reading | null = null;
      for (let baseSide = 240; baseSide <= 960; baseSide += 2) {
        const reading = read(circularLayout(name, baseSide + 400, baseSide));
        if (previous) {
          steps += 1;
          const delta = reading.labels - previous.labels;
          if (delta < 0) {
            shrinkByRecord[name] += 1;
            worst = Math.min(worst, delta);
          }
        }
        previous = reading;
      }
    }

    // One assertion so a change to the worst step cannot hide behind the per-record
    // counts. Raising any count means a pane change took a name off the ring that used
    // to be there. Lowering one is an improvement — re-measure and re-pin it.
    // repin:census:start
    expect({ steps, worst, ...shrinkByRecord }).toEqual({
      steps: 1800,
      worst: -3,
      'pUC19': 11,
      'pET-28a(+)': 16,
      'pETDuet-1': 32,
      'pBR322': 15,
      'pcDNA3.1(+)': 13,
    });
    // repin:census:end
  }, 120_000);

  it('trades labels for enzyme names at the baseSide 480 text-budget step', () => {
    // A cliff every record falls off. Growing the pane by 2px here costs pET-28a(+)
    // and pETDuet-1 three labels, pBR322 and pcDNA3.1(+) two and pUC19 one, and pays
    // for them in enzyme names the surviving labels now spell out instead of summing
    // into "+N": every record names more sites afterwards than before.
    const observed = RECORDS.map((name) => {
      const before = read(circularLayout(name, 878, 478));
      const after = read(circularLayout(name, 880, 480));
      return `${name} ${after.labels - before.labels} labels ${after.namedSites - before.namedSites} names`;
    });

    // repin:trade-480:start
    expect(observed).toEqual([
      'pUC19 -1 labels 7 names',
      'pET-28a(+) -3 labels 9 names',
      'pETDuet-1 -3 labels 9 names',
      'pBR322 -2 labels 12 names',
      'pcDNA3.1(+) -2 labels 16 names',
    ]);
    // repin:trade-480:end
  }, 120_000);
});
