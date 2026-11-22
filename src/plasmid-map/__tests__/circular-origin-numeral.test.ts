import { describe, expect, it } from 'vitest';
import vectors from '../../../public/data/vectors.json';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { resolveEnzymeUnion } from '../../bio/restriction-presets';
import type { Feature } from '../../bio/types';
import { computeMapLayout } from '../layout';
import { restrictionDensitySourcesForMap, restrictionSitesForInteractiveMap } from '../restriction-display';
import { approxTextWidth, LABEL_FONT_PX } from '../geometry/labels';
import type { MapLayout } from '../types';

/**
 * "0" at 12 o'clock is what orients a circular map. The ruler drops a number that a
 * leader or a name crosses, but never "0": a leader that would cross it is routed
 * around it. PANES is the map pane's content box at 700x860, 1280x820, 1440x900,
 * 1920x1080 and 1024x768, read off the painted artifact. Without the routing, 19 of the first
 * 52 states have no "0"; pETDuet-1 at 1024x768 is a name on the very spoke of "0".
 */
const PANES: readonly (readonly [number, number])[] = [[680, 428], [610, 666], [706, 746], [956, 926], [456, 582]];

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

function circularLayout(record: (typeof vectors)[number], width: number, height: number): MapLayout {
  const sites = findRestrictionSites(record.sequence, resolveEnzymeUnion(['common', 'golden-gate-type-iis']), { topology: 'circular' });
  const features = record.features.map((feature) => ({
    ...feature,
    name: compactMapName(feature.name),
    metadata: (feature as { metadata?: Record<string, unknown> }).metadata ?? {},
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

type Box = { x0: number; y0: number; x1: number; y1: number };

/** "0" is one digit drawn upright at 12 o'clock: its box, centred on its anchor. */
function originBox(label: { text: string; x: number; y: number }): Box {
  const w = approxTextWidth(label.text, LABEL_FONT_PX, 'proportional');
  const h = LABEL_FONT_PX * 0.72;
  return { x0: label.x - w / 2, y0: label.y - h, x1: label.x + w / 2, y1: label.y };
}

function segmentHitsBox(a: { x: number; y: number }, b: { x: number; y: number }, box: Box): boolean {
  for (let i = 0; i <= 40; i += 1) {
    const x = a.x + ((b.x - a.x) * i) / 40;
    const y = a.y + ((b.y - a.y) * i) / 40;
    if (x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1) return true;
  }
  return false;
}

describe('the circular ruler keeps "0"', () => {
  it('draws "0" for every sample record at five window sizes, with no leader through it', () => {
    const missing: string[] = [];
    const crossed: string[] = [];
    let states = 0;
    for (const record of vectors) {
      for (const [width, height] of PANES) {
        const layout = circularLayout(record, width, height);
        states += 1;
        const origin = layout.coordinates.find((coordinate) => coordinate.bp === 0);
        if (!origin?.label || origin.label.text !== '0') {
          missing.push(`${record.name} ${width}x${height}`);
          continue;
        }
        const box = originBox(origin.label);
        for (const feature of layout.features) {
          const leader = feature.label?.leader ?? [];
          for (let i = 1; i < leader.length; i += 1) {
            if (segmentHitsBox(leader[i - 1], leader[i], box)) {
              crossed.push(`${record.name} ${width}x${height}: ${feature.label!.text}`);
              break;
            }
          }
        }
      }
    }
    expect(states).toBe(65);
    expect(missing).toEqual([]);
    expect(crossed).toEqual([]);
  });
});
