import { describe, expect, it } from 'vitest';
import vectors from '../../../public/data/vectors.json';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { resolveEnzymeUnion } from '../../bio/restriction-presets';
import type { Feature } from '../../bio/types';
import { computeMapLayout } from '../layout';
import { restrictionDensitySourcesForMap, restrictionSitesForInteractiveMap } from '../restriction-display';
import { approxTextWidth, CIRCULAR_LABEL_BOX_HEIGHT_PX, type LabelFontMode } from '../geometry/labels';
import type { MapLabelRender, MapLayout } from '../types';

/**
 * The circular label pass settles a collision by DELETING a label, never by moving
 * it, so a label removed for one overlap used to stay off the map even when the
 * settled layout had room for it elsewhere. `placeCircularRadialLabels` now re-packs
 * every evicted label against the labels that remain.
 *
 * A second collision settles between the two label families: on a wide pane the
 * complete enzyme inventory wins and `dropFeatureLabelsConflictingWithRestrictionLabels`
 * deletes the feature name. computeCircularLayout now re-places those too, once both
 * layers are final.
 *
 * PANES below is the map pane's own content box, read off the painted artifact with
 * every disclosure left as the page opened it. Force-opening the one that holds the
 * shape toggle costs the pane 322px of height at 1920x1080 and puts `baseSide` under
 * the 600px thresholds in this file, which hides both of the paths tested here.
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

function circularLayout(recordName: string, width: number, height: number): MapLayout {
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
  return computeMapLayout({
    mode: 'circular',
    name: record.name,
    length: record.sequence.length,
    topology: 'circular',
    sequenceType: 'dna',
    features,
    restrictionSites: restrictionSitesForInteractiveMap(sites),
    restrictionDensitySources: restrictionDensitySourcesForMap(sites, record.sequence.length),
    width,
    height,
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
  });
}

const chipText = (layout: MapLayout, kind: string): string | undefined =>
  layout.overflows?.find((overflow) => overflow.kind === kind)?.text;

const RECORDS = ['pUC19', 'pET-28a(+)', 'pETDuet-1', 'pBR322', 'pcDNA3.1(+)'];
/** The map pane's content box at 1100x650, 1280x720, 1366x768, 1440x900, 1680x1050, 1920x1080. */
const PANES: [number, number][] = [
  [1032, 260], [1212, 310], [1298, 358], [1372, 379], [780, 890], [955, 920],
];

interface LabelBox { text: string; x0: number; y0: number; x1: number; y1: number }

function labelBox(label: MapLabelRender, mode: LabelFontMode): LabelBox {
  const width = approxTextWidth(label.text, undefined, mode);
  const x0 = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - width : label.x - width / 2;
  const y0 = label.baseline === 'middle'
    ? label.y - CIRCULAR_LABEL_BOX_HEIGHT_PX / 2
    : label.baseline === 'hanging' ? label.y : label.y - CIRCULAR_LABEL_BOX_HEIGHT_PX;
  return { text: label.text, x0, y0, x1: x0 + width, y1: y0 + CIRCULAR_LABEL_BOX_HEIGHT_PX };
}

/** Liang-Barsky: does any segment of `leader` pass through `box`? */
function leaderCrossesBox(leader: readonly { x: number; y: number }[], box: LabelBox): boolean {
  for (let i = 1; i < leader.length; i += 1) {
    const a = leader[i - 1];
    const b = leader[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    const clip = (p: number, q: number): boolean => {
      if (Math.abs(p) < 1e-9) return q >= 0;
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
      return true;
    };
    if (clip(-dx, a.x - box.x0) && clip(dx, box.x1 - a.x) && clip(-dy, a.y - box.y0) && clip(dy, box.y1 - a.y) && t1 > t0 + 1e-6) {
      return true;
    }
  }
  return false;
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5
    && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
}

describe('circular labels evicted by the collision cascade are re-packed', () => {
  it('names the pUC19 cluster the collision cascade evicted', () => {
    const layout = circularLayout('pUC19', 1298, 358);
    const named = layout.restrictions.filter((item) => item.label).map((item) => item.label!.text);

    // The cascade evicted this cluster because its box came within 4px of a feature
    // label, against a rule the packer reads as 2px.
    expect(named).toContain('SacI +2');
    // 54, not the "+1" this read before the chip counted the right thing: 21 of the
    // 22 clusters carry a label, but those labels name only 23 of the 77 sites — the
    // rest sit behind a "+N" tail. See unnamedClusterSites in layout.ts. The noun is
    // dropped here because the full sentence would reach the AmpR name at this pane.
    expect(chipText(layout, 'restriction-labels')).toBe('54 unnamed');
  });

  it('keeps AmpR prom. on pUC19 at the widest pane', () => {
    // The enzyme-inventory reconciliation deleted this name where it stood, because
    // the rescued "AluI" label was placed over it by a pass that ignores feature
    // labels. Both names fit once the map has settled.
    const layout = circularLayout('pUC19', 955, 920);
    const named = layout.features.filter((item) => item.label).map((item) => item.label!.text);

    expect(named).toContain('AmpR prom.');
    expect(named).toContain('M13/pUC fwd');
    expect(layout.restrictions.filter((item) => item.label)).toHaveLength(22);
    expect(chipText(layout, 'feature-labels')).toBe('+1 more');
    // Every cluster is labelled and the chip still fires: labelling all 22 names 39
    // of the 77 sites, and the old count — clusters without a label — was 0 here, so
    // the map said nothing at all about the 38 ticks a reader cannot put a name to.
    expect(chipText(layout, 'restriction-labels')).toBe('38 unnamed sites');
  });

  it('names the pcDNA3.1(+) cluster the feature reconciliation removed', () => {
    // The mirror of the AmpR prom. case: here the reconciliation runs the other way
    // and deletes the enzyme cluster where it stood.
    const layout = circularLayout('pcDNA3.1(+)', 1372, 379);
    expect(layout.restrictions.filter((item) => item.label)).toHaveLength(11);
    // Was "+7 more sites": the 2 unlabelled clusters hold 7 sites, but 35 more sit
    // under the 11 labels that name some other enzyme in their own cluster.
    expect(chipText(layout, 'restriction-labels')).toBe('42 unnamed sites');
  });

  it('names every pETDuet-1 feature instead of summarizing one away', () => {
    const layout = circularLayout('pETDuet-1', 1032, 260);
    const drawn = layout.features.filter((feature) => feature.segmentPaths.length > 0);

    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.filter((feature) => !feature.label)).toEqual([]);
    expect(chipText(layout, 'feature-labels')).toBeUndefined();
  });

  it('re-packs without putting one visible label on top of another', () => {
    // Every record and pane size the artifact is swept at: a re-packed label must
    // not return to the map by covering a neighbour.
    const overlaps: string[] = [];
    let pairs = 0;
    for (const name of RECORDS) {
      for (const [width, height] of PANES) {
        const layout = circularLayout(name, width, height);
        const boxes = [
          ...layout.features.filter((item) => item.label).map((item) => labelBox(item.label!, 'proportional')),
          ...layout.restrictions.filter((item) => item.label).map((item) => labelBox(item.label!, 'monospace')),
        ];
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            pairs += 1;
            if (!boxesOverlap(boxes[i], boxes[j])) continue;
            overlaps.push(`${name} ${width}x${height}: ${boxes[i].text} over ${boxes[j].text}`);
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(3000);
    expect(overlaps).toEqual([]);
  });

  it('re-packs without routing a leader through another label', () => {
    // A box sweep cannot see this one: a re-packed label can clear every box and
    // still have a neighbour's leader drawn across it. 19 crossings over the 30
    // circular cases, down from 20 before the re-pack passes; accepting a re-packed
    // spot without re-testing it against the settled leaders takes it to 21.
    let crossings = 0;
    let leaders = 0;
    for (const name of RECORDS) {
      for (const [width, height] of PANES) {
        const layout = circularLayout(name, width, height);
        const items = [
          ...layout.features.filter((item) => item.label).map((item) => ({ box: labelBox(item.label!, 'proportional'), leader: item.label!.leader })),
          ...layout.restrictions.filter((item) => item.label).map((item) => ({ box: labelBox(item.label!, 'monospace'), leader: item.label!.leader })),
        ];
        for (const item of items) {
          if (item.leader.length > 1) leaders += 1;
          for (const other of items) {
            if (other === item) continue;
            if (leaderCrossesBox(item.leader, other.box)) { crossings += 1; break; }
          }
        }
      }
    }
    expect(leaders).toBeGreaterThan(100);
    expect(crossings).toBeLessThanOrEqual(19);
  });

  it('reports an overlap when two labels really are on top of each other', () => {
    // Proof the sweep above can fire: the same predicate on two boxes that do overlap.
    const layout = circularLayout('pUC19', 955, 920);
    const label = layout.restrictions.find((item) => item.label)!.label!;
    const box = labelBox(label, 'monospace');
    expect(boxesOverlap(box, labelBox({ ...label, x: label.x + 2 }, 'monospace'))).toBe(true);
    expect(boxesOverlap(box, labelBox({ ...label, x: label.x + 400 }, 'monospace'))).toBe(false);
  });
});
