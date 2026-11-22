import { describe, expect, it } from 'vitest';
import vectors from '../../../public/data/vectors.json';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { resolveEnzymeUnion } from '../../bio/restriction-presets';
import type { Feature } from '../../bio/types';
import { approxTextWidth, capitalWidthPadPx, LABEL_FONT_PX } from '../geometry/labels';
import { circularPaneRingDiameter } from '../layout';
import {
  computeReadableMapLayout,
  isSmallMapPane,
  mapScreenScale,
  MIN_SCREEN_MAP_LABEL_PX,
  ringScreenDiameter,
  SMALL_MAP_PANE_RING_PX,
} from '../readable-layout';
import { restrictionDensitySourcesForMap, restrictionSitesForInteractiveMap } from '../restriction-display';
import type { MapInput, MapLabelRender, MapLayout, Pt } from '../types';

/**
 * A circular map in a pane whose label-free ring is under SMALL_MAP_PANE_RING_PX is laid
 * out as a miniature. Every assertion below runs over real sample records across a
 * sweep of small panes, so the rules are not fitted to one record or one size.
 */
const RECORDS = ['pUC19', 'pcDNA3.1(+)', 'pET-28a(+)', 'pBluescript SK(+)'] as const;
const SIZES: readonly [number, number][] = [
  [180, 170], [220, 200], [240, 300], [280, 258], [300, 280], [320, 420],
  [360, 288], [400, 340], [420, 372], [480, 300], [560, 330], [640, 360],
  // Panes that keep the full-size drawing: the map frame at 660x788, 700x860, 1280x820
  // and 1440x900.
  [640, 392], [680, 428], [610, 666], [706, 746],
];

type SizelessInput = Omit<MapInput, 'width' | 'height'>;
const prepared = new Map<string, SizelessInput>();

function input(recordName: string, width: number, height: number, smallRing?: boolean, uniqueSites = false): MapInput {
  const key = `${recordName}${uniqueSites ? ' unique' : ''}`;
  let entry = prepared.get(key);
  if (!entry) {
    const record = vectors.find((candidate) => candidate.name === recordName)!;
    const found = findRestrictionSites(
      record.sequence,
      resolveEnzymeUnion(['common', 'golden-gate-type-iis']),
      { topology: 'circular' },
    );
    // The map's Sites menu opens on unique cutters.
    const sites = uniqueSites
      ? found.filter((site) => found.filter((other) => other.enzyme === site.enzyme).length === 1)
      : found;
    entry = {
      mode: 'circular',
      name: record.name,
      length: record.sequence.length,
      topology: 'circular',
      sequenceType: 'dna',
      features: record.features.map((feature) => ({ ...feature, metadata: feature.metadata ?? {} })) as Feature[],
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
    prepared.set(key, entry);
  }
  return {
    ...entry,
    width,
    height,
    display: { ...entry.display, ...(smallRing === undefined ? {} : { smallRing }) },
  };
}

/** The full-size layout: what a pane draws when its ring is not small. */
const fullSize = (name: string, width: number, height: number) =>
  computeReadableMapLayout(input(name, width, height, false));

interface Case {
  name: string;
  width: number;
  height: number;
  layout: MapLayout;
  full: MapLayout;
}

const cases: Case[] = [];
const largeCases: Case[] = [];
for (const name of RECORDS) {
  for (const [width, height] of SIZES) {
    const full = fullSize(name, width, height);
    const layout = computeReadableMapLayout(input(name, width, height));
    const entry = { name, width, height, layout, full };
    if (isSmallMapPane(width, height, input(name, width, height).display)) cases.push(entry);
    else largeCases.push(entry);
  }
}

const label = (c: Case) => `${c.name} ${c.width}x${c.height}`;

describe('a small ring is drawn as a miniature', () => {
  it('covers small rings for every record, and large ones too', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(largeCases.length).toBeGreaterThanOrEqual(3);
    for (const name of RECORDS) expect(cases.some((c) => c.name === name)).toBe(true);
  });

  it('leaves every record in a full-size pane exactly as the full-size layout draws it', () => {
    for (const c of largeCases) {
      expect(c.layout, label(c)).toEqual(c.full);
      expect(c.layout.smallRing, label(c)).toBeUndefined();
    }
    for (const c of cases) expect(c.layout.smallRing, label(c)).toBe(true);
  });

  it('draws its names at the readable size, neither shrunk below it nor blown up', () => {
    // The pane centres the drawn box (meet); the scale it applies sets the type size.
    for (const c of cases) {
      const scale = mapScreenScale(c.layout, c.width, c.height);
      expect(scale, label(c)).toBeGreaterThanOrEqual(MIN_SCREEN_MAP_LABEL_PX / 16 - 0.001);
      expect(scale, label(c)).toBeLessThanOrEqual(1.1);
    }
  });
});

describe('the pane alone picks the drawing', () => {
  it('gives every record in one pane the same drawing', () => {
    for (const [width, height] of SIZES) {
      const styles = RECORDS.map((name) => computeReadableMapLayout(input(name, width, height)).smallRing === true);
      expect(new Set(styles).size, `${width}x${height}`).toBe(1);
    }
  });

  it('keeps the full-size drawing for all three records at 660x788, whatever ring each gets', () => {
    // The map frame at 660x788 is 640x392. The rings the records end up with there lie
    // on both sides of 340px; a switch that read the drawn-ring size would flip the
    // style as the record changed.
    // Unique cutters, as the map's Sites menu opens with.
    const layouts = ['pUC19', 'pcDNA3.1(+)', 'pET-28a(+)'].map((name) => ({
      name,
      layout: computeReadableMapLayout(input(name, 640, 392, undefined, true)),
      full: computeReadableMapLayout(input(name, 640, 392, false, true)),
    }));
    for (const { name, layout, full } of layouts) expect(layout, name).toEqual(full);
    const rings = layouts.map(({ layout }) => ringScreenDiameter(layout, 640, 392));
    expect(rings[0], 'pUC19').toBeGreaterThanOrEqual(340);
    expect(rings[1], 'pcDNA3.1(+)').toBeLessThan(340);
    expect(rings[2], 'pET-28a(+)').toBeLessThan(340);
    for (const { name } of layouts) {
      expect(computeReadableMapLayout(input(name, 420, 372)).smallRing, `${name} 420x372`).toBe(true);
    }
  });

  it('switches on the label-free ring the pane gives, at one threshold', () => {
    const display = input('pUC19', 640, 392).display;
    expect(circularPaneRingDiameter(640, 392, display)).toBeGreaterThanOrEqual(SMALL_MAP_PANE_RING_PX);
    expect(circularPaneRingDiameter(420, 372, display)).toBeLessThan(SMALL_MAP_PANE_RING_PX);
    // The shorter side sets it, so a wide, short pane is small too.
    expect(isSmallMapPane(1200, 346, display)).toBe(true);
    expect(isSmallMapPane(392, 1200, display)).toBe(false);
  });
});

describe('a small ring thins its names as it shrinks', () => {
  const slotsFor = (layout: MapLayout) => Math.max(2, Math.floor(layout.radius / 15));
  const spanOf = (layout: MapLayout, feature: Feature) =>
    feature.end >= feature.start ? feature.end - feature.start : layout.length - feature.start + feature.end;

  it('names fewer things on a smaller ring, features before cut sites, largest features first', () => {
    for (const c of cases) {
      const { layout } = c;
      const slots = slotsFor(layout);
      const namedFeatures = layout.features.filter((f) => f.label);
      const namedSites = layout.restrictions.filter((r) => r.label).length;
      expect(namedFeatures.length + namedSites, label(c)).toBeLessThanOrEqual(slots);
      // Cut sites get only the slots features leave over. Features keep at least six
      // names at these display settings (circularFeatureLabelBudget), or the slots.
      expect(namedSites, label(c)).toBeLessThanOrEqual(Math.max(0, slots - Math.min(slots, 6, layout.features.length)));
      // A named feature is one of the `slots` largest. The existing type weight can
      // reorder features within 4.8% of the record of each other
      // (circularFeatureLabelPriority: an origin before a slightly longer promoter).
      const source = input(c.name, c.width, c.height).features;
      const spans = source.map((f) => spanOf(layout, f)).sort((a, b) => b - a);
      const cutoff = spans[Math.min(slots, spans.length) - 1];
      for (const feature of namedFeatures) {
        const span = spanOf(layout, source.find((f) => f.id === feature.id)!);
        expect(span, `${label(c)} ${feature.name}`).toBeGreaterThanOrEqual(cutoff - layout.length * 0.048);
      }
    }
  });

  it('keeps every cut site drawn as a tick', () => {
    for (const c of cases) {
      expect(c.layout.restrictions.length, label(c)).toBe(c.full.restrictions.length);
      expect(c.layout.restrictionDensityTicks.length, label(c)).toBe(c.full.restrictionDensityTicks.length);
    }
  });
});

function arcRadii(path: string): number[] {
  return [...path.matchAll(/A\s*([\d.]+)[ ,]+([\d.]+)/g)].map((m) => Number(m[1]));
}

describe('a small ring keeps its arcs near the backbone and the middle for the name', () => {
  it('keeps every feature arc clear of the record name', () => {
    for (const c of cases) {
      const { layout } = c;
      // centerLabelRadius is the corner of the padded box around the name and length.
      expect(layout.centerLabelRadius!, label(c)).toBeLessThan(layout.featureLaneInnerRadius!);
      // The name is whole, not cut to make room, wherever the ring is big enough to hold it.
      if (ringScreenDiameter(layout, c.width, c.height) >= 150) {
        for (const line of layout.centerTitle!.lines) expect(line.text, label(c)).not.toContain('…');
      }
    }
  });

  it('puts the feature arcs on a thin track just inside the backbone', () => {
    for (const c of cases) {
      const { layout } = c;
      const R = layout.radius;
      expect(R - layout.featureLaneOuterRadius!, label(c)).toBeLessThanOrEqual(Math.max(4, R * 0.05) + 0.01);
      for (const feature of layout.features) {
        for (const path of feature.segmentPaths) {
          const radii = arcRadii(path);
          expect(Math.max(...radii) - Math.min(...radii), `${label(c)} ${feature.name}`).toBeLessThanOrEqual(R * 0.11 + 0.6);
        }
      }
      // No ruler numbers between the backbone and the arcs; the ruler ticks stay.
      expect(layout.coordinates.length, label(c)).toBe(c.full.coordinates.length);
      expect(layout.coordinates.every((tick) => tick.label === null), label(c)).toBe(true);
    }
  });

});

const outsideLabels = (layout: MapLayout) =>
  [...layout.features.map((f) => f.label), ...layout.restrictions.map((r) => r.label)]
    .filter((l): l is NonNullable<typeof l> => Boolean(l && !l.inside && l.leader.length >= 2));

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

/** How far a leader turns round the ring between its two ends, in degrees. */
function leaderTurn(layout: MapLayout, leader: readonly Pt[]): number {
  const angle = (p: Pt) => Math.atan2(p.x - layout.center.x, layout.center.y - p.y) * (180 / Math.PI);
  return Math.abs(((angle(leader[leader.length - 1]) - angle(leader[0]) + 540) % 360) - 180);
}

describe('a small ring keeps its leaders short', () => {
  it('runs every leader outward beside what it names, never into the middle or across the name', () => {
    for (const c of cases) {
      const { layout } = c;
      for (const l of outsideLabels(layout)) {
        expect(leaderTurn(layout, l.leader), `${label(c)} ${l.text}`).toBeLessThanOrEqual(16.01);
        for (const p of l.leader) {
          expect(Math.hypot(p.x - layout.center.x, p.y - layout.center.y), `${label(c)} ${l.text}`)
            .toBeGreaterThanOrEqual(layout.featureLaneInnerRadius! - 0.5);
        }
        for (let i = 0; i + 1 < l.leader.length; i += 1) {
          expect(distanceToSegment(layout.center, l.leader[i], l.leader[i + 1]), `${label(c)} ${l.text}`)
            .toBeGreaterThan(layout.centerLabelRadius!);
        }
      }
    }
  });

  it('still fans out the names of a tight cloning region', () => {
    // pET-28a(+)'s T7 promoter, lac operator, RBS, 6xHis and T7 terminator share about
    // 20 degrees. On its miniature in a 640x392 pane three tiers name lac operator and
    // T7 terminator; RBS and 6xHis are left off because the leader of the larger name
    // beside each runs through it.
    const layout = computeReadableMapLayout(input('pET-28a(+)', 640, 392, true, true));
    expect(layout.smallRing).toBe(true);
    expect(layout.features.filter((f) => f.label).length).toBeGreaterThanOrEqual(3);
  });

  it('is a rule the full-size layout breaks on these panes', () => {
    const swinging = cases.filter((c) => outsideLabels(c.full).some((l) => leaderTurn(c.full, l.leader) > 16.01));
    expect(swinging.length).toBeGreaterThan(0);
  });
});

describe('a small ring draws a name whole or not at all', () => {
  it('never cuts a feature or enzyme name, and counts every unnamed feature', () => {
    for (const c of cases) {
      const { layout } = c;
      for (const feature of layout.features) {
        if (feature.label) expect(feature.label.text, label(c)).toBe(feature.name);
      }
      for (const site of layout.restrictions) {
        if (site.label) expect(site.label.text, label(c)).not.toContain('…');
      }
      const named = layout.features.filter((f) => f.label).length;
      const summary = layout.overflowSummaries?.find((s) => s.kind === 'feature-labels');
      expect(named + (summary?.unlabelled ?? 0) + (summary?.hiddenBodies ?? 0), label(c)).toBe(layout.features.length);
    }
  });

  it('is a rule the full-size layout breaks on these panes', () => {
    const cut = cases.filter((c) => c.full.features.some((f) => f.label && f.label.text !== f.name));
    expect(cut.length).toBeGreaterThan(0);
  });
});

interface Box { minX: number; minY: number; maxX: number; maxY: number }

/** What a straight name paints: its glyph cell, 1.2em high with 0.24em under the baseline. */
function paintedBox(label: MapLabelRender, fontMode: 'proportional' | 'monospace'): Box {
  const width = approxTextWidth(label.text, undefined, fontMode) + capitalWidthPadPx(label.text, undefined, fontMode);
  const cell = LABEL_FONT_PX * 1.2;
  const descent = LABEL_FONT_PX * 0.24;
  const minX = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - width : label.x - width / 2;
  const minY = label.baseline === 'middle' ? label.y - cell / 2 : label.baseline === 'hanging' ? label.y - descent : label.y - (cell - descent);
  return { minX, minY, maxX: minX + width, maxY: minY + cell };
}

const grow = (b: Box, pad: number): Box => ({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad });
const boxesMeet = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

function segmentMeetsBox(a: Pt, b: Pt, box: Box): boolean {
  for (let k = 0; k <= 200; k += 1) {
    const x = a.x + ((b.x - a.x) * k) / 200;
    const y = a.y + ((b.y - a.y) * k) / 200;
    if (x > box.minX && x < box.maxX && y > box.minY && y < box.maxY) return true;
  }
  return false;
}

function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const side = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = side(p3, p4, p1);
  const d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3);
  const d4 = side(p1, p2, p4);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

/** 2px on screen at the smallest scale a miniature is drawn at. */
const NAME_GAP = 2 * (16 / 12);

/** Every pair of names that touch: a leader through a name, two names too close, or two crossing leaders. */
function nameConflicts(layout: MapLayout): string[] {
  const names = [
    ...layout.features.filter((f) => f.label && !f.label.arcPath).map((f) => ({ label: f.label!, box: paintedBox(f.label!, 'proportional') })),
    ...layout.restrictions.filter((r) => r.label && !r.label.arcPath).map((r) => ({ label: r.label!, box: paintedBox(r.label!, 'proportional') })),
  ];
  const found: string[] = [];
  for (const a of names) {
    for (const b of names) {
      if (a === b) continue;
      const pair = `${a.label.text} / ${b.label.text}`;
      if (a.label.text < b.label.text && boxesMeet(grow(a.box, NAME_GAP), b.box)) found.push(`names too close: ${pair}`);
      const leader = a.label.leader;
      for (let i = 0; i + 1 < leader.length; i += 1) {
        if (segmentMeetsBox(leader[i], leader[i + 1], grow(b.box, NAME_GAP))) {
          found.push(`leader through name: ${pair}`);
          break;
        }
      }
      const other = b.label.leader;
      if (a.label.text < b.label.text && leader.length > 1 && other.length > 1) {
        let crossed = false;
        for (let i = 0; i + 1 < leader.length && !crossed; i += 1) {
          for (let j = 0; j + 1 < other.length && !crossed; j += 1) crossed = segmentsCross(leader[i], leader[i + 1], other[j], other[j + 1]);
        }
        if (crossed) found.push(`leaders cross: ${pair}`);
      }
    }
  }
  return found;
}

describe('a small ring keeps every name clear of the others', () => {
  it('lets no leader run through a name, no two names touch and no two leaders cross on pET-28a(+)', () => {
    // The map frames at 440x800, 380x700 and 300x600, with the unique cutters the Sites
    // menu opens on: no leader of "lac operator" runs through "RBS", none of "6xHis"
    // through "T7 terminator", and "RBS" does not sit on the bottom of "T7 terminator".
    for (const [width, height] of [[420, 374], [360, 290], [280, 260]] as const) {
      const layout = computeReadableMapLayout(input('pET-28a(+)', width, height, undefined, true));
      expect(layout.smallRing, `${width}x${height}`).toBe(true);
      expect(nameConflicts(layout), `${width}x${height}`).toEqual([]);
      // The cloning region still names more than one thing.
      expect(layout.features.filter((f) => f.label).length, `${width}x${height}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('holds for every record and pane in the sweep, and counts each name it leaves off', () => {
    for (const c of cases) {
      expect(nameConflicts(c.layout), label(c)).toEqual([]);
      const named = c.layout.features.filter((f) => f.label).length;
      const summary = c.layout.overflowSummaries?.find((s) => s.kind === 'feature-labels');
      expect(named + (summary?.unlabelled ?? 0) + (summary?.hiddenBodies ?? 0), label(c)).toBe(c.layout.features.length);
    }
    for (const name of RECORDS) {
      for (const [width, height] of [[420, 374], [360, 290], [280, 260]] as const) {
        expect(nameConflicts(computeReadableMapLayout(input(name, width, height, undefined, true))), `${name} ${width}x${height}`).toEqual([]);
      }
    }
  });
});
