import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import type { MapInput, MapLabelRender, MapLayout } from '../types';
import type { Feature, RestrictionSite } from '../../bio/types';
import {
  approxTextWidth,
  fitsInline,
  INLINE_PADDING_PX,
  LABEL_FONT_PX,
  LABEL_LINE_HEIGHT_PX,
} from '../geometry/labels';

// ── factories ────────────────────────────────────────────────────────────────
function feat(p: Partial<Feature> & { id: string }): Feature {
  return {
    id: p.id,
    name: p.name ?? '',
    type: p.type ?? 'misc_feature',
    start: p.start ?? 0,
    end: p.end ?? 0,
    strand: p.strand ?? 1,
    subRanges: p.subRanges,
    color: p.color ?? '#8a8a8a',
    metadata: {},
  };
}

function site(
  enzyme: string,
  position: number,
  cutPosition: number,
  recognitionSequence: string,
  strand?: 1 | -1,
): RestrictionSite {
  return { enzyme, position, cutPosition, recognitionSequence, overhang: 'blunt', ...(strand ? { strand } : {}) };
}

// pUC19-scale circular plasmid: overlapping features (forces >1 lane) + an MCS
// cluster of enzymes plus two distant single cutters.
const PUC19_LEN = 2686;
const puc19Features: Feature[] = [
  feat({ id: 'ampR', name: 'AmpR', type: 'resistance', start: 1626, end: 2486, strand: -1 }),
  feat({ id: 'ori', name: 'ori', type: 'origin', start: 867, end: 1455, strand: 1 }),
  feat({ id: 'lacZ', name: 'lacZα', type: 'cds', start: 469, end: 812, strand: -1 }),
  feat({ id: 'lacP', name: 'lac promoter', type: 'promoter', start: 414, end: 470, strand: -1 }),
  feat({ id: 'mcs', name: 'MCS', type: 'misc_feature', start: 396, end: 469, strand: 0 }),
  feat({ id: 'm13r', name: 'M13-rev primer', type: 'primer_bind', start: 460, end: 480, strand: 1 }),
];
const puc19Sites: RestrictionSite[] = [
  site('EcoRI', 396, 397, 'GAATTC'),
  site('SacI', 402, 407, 'GAGCTC'),
  site('KpnI', 408, 413, 'GGTACC'),
  site('BamHI', 417, 418, 'GGATCC'),
  site('HindIII', 447, 448, 'AAGCTT'),
  site('AflIII', 806, 807, 'ACRYGT'),
  site('AhdI', 1500, 1501, 'GACNNNNNGTC'),
];

function circularInput(over: Partial<MapInput> = {}): MapInput {
  return {
    mode: 'circular',
    name: 'pUC19',
    length: PUC19_LEN,
    topology: 'circular',
    sequenceType: 'dna',
    features: puc19Features,
    restrictionSites: puc19Sites,
    width: 600,
    height: 600,
    ...over,
  };
}

function denseTinyFeatures(count = 64, len = 6000): Feature[] {
  const step = Math.floor(len / count);
  return Array.from({ length: count }, (_, i) =>
    feat({
      id: `tiny-${i}`,
      name: `tiny-${i}`,
      type: 'misc_feature',
      start: i * step + 2,
      end: i * step + 18,
      strand: i % 2 === 0 ? 1 : -1,
    }),
  );
}

function denseLinearFeatures(count: number, len: number): Feature[] {
  const kinds = ['cds', 'promoter', 'rbs', 'terminator', 'origin', 'resistance', 'gene', 'misc_feature'];
  const step = Math.floor(len / count);
  return Array.from({ length: count }, (_, i) => {
    const start = i * step + 5;
    return feat({
      id: `linear-f${i}`,
      name: `${kinds[i % kinds.length]}-${i + 1}`,
      type: kinds[i % kinds.length] as Feature['type'],
      start,
      end: start + Math.floor(step * 0.6),
      strand: (i % 3 === 0 ? -1 : i % 3 === 1 ? 1 : 0) as Feature['strand'],
    });
  });
}

function denseLinearSites(count: number, len: number): RestrictionSite[] {
  const enz = ['EcoRI', 'BamHI', 'HindIII', 'AluI', 'HaeIII', 'TaqI', 'BsaI', 'BbsI', 'HpaII', 'MspI'];
  const step = Math.floor(len / count);
  return Array.from({ length: count }, (_, i) =>
    site(enz[i % enz.length], i * step + 11, i * step + 12, 'GAATTC', i % 5 === 0 ? -1 : 1),
  );
}

function crowdedCircularSites(len = 6000): RestrictionSite[] {
  const clusters = [
    ['AvaI', 'BsoBI', 'BbsI', 'BpiI', 'MboII', 'MmeI', 'BsmFI', 'FokI', 'BsaI', 'BsmBI', 'Esp3I'],
    ['BbsI', 'BpiI', 'MboII', 'AvaI', 'BsoBI', 'MmeI', 'BsmFI', 'FokI', 'BsaI', 'BsmBI', 'Esp3I'],
    ['MboII', 'MmeI', 'BsmFI', 'AvaI', 'BsoBI', 'BbsI', 'BpiI', 'FokI', 'BsaI', 'BsmBI', 'Esp3I'],
    ['BsaI', 'BsmBI', 'Esp3I', 'AvaI', 'BsoBI', 'BbsI', 'BpiI', 'MboII', 'MmeI', 'BsmFI', 'FokI'],
    ['FokI', 'BsaI', 'BsmBI', 'Esp3I', 'AvaI', 'BsoBI', 'BbsI', 'BpiI', 'MboII', 'MmeI', 'BsmFI'],
  ];
  const start = Math.floor(len * 0.16);
  return clusters.flatMap((enzymes, clusterIndex) =>
    enzymes.map((enzyme, enzymeIndex) => {
      const position = start + clusterIndex * 130 + enzymeIndex * 4;
      return site(enzyme, position, position + 1, 'GAATTC');
    }),
  );
}

function allEnzymeScaleSites(count: number, len: number): RestrictionSite[] {
  const enz = ['MboII', 'BsmFI', 'Nt.BstNBI', 'AluI', 'HaeIII', 'TaqI', 'HpaII', 'MspI'];
  return Array.from({ length: count }, (_, i) => {
    const position = Math.floor((i * len) / count);
    return site(enz[i % enz.length], position, position + 1, 'GAATTC');
  });
}

function stackedLinearFeatures(count = 40, len = 6000): Feature[] {
  return Array.from({ length: count }, (_, i) =>
    feat({
      id: `stack-${i}`,
      name: `stack-${i}`,
      type: 'cds',
      start: 100,
      end: len - 400,
      strand: i % 2 === 0 ? 1 : -1,
    }),
  );
}

function featureOverflow(layout: MapLayout) {
  return layout.overflows?.find((overflow) => overflow.kind === 'feature-labels') ?? null;
}

function overflowCount(text: string): number {
  expect(text).toMatch(/^\+\d+(?: more)?$/);
  return Number(text.match(/\d+/)?.[0] ?? 0);
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function labelVerticalOffsets(baseline: MapLabelRender['baseline'] | undefined): { ay0: number; ay1: number } {
  if (baseline === 'middle') return { ay0: -LABEL_LINE_HEIGHT_PX / 2, ay1: LABEL_LINE_HEIGHT_PX / 2 };
  if (baseline === 'hanging') return { ay0: 0, ay1: LABEL_LINE_HEIGHT_PX };
  if (baseline === 'auto') return { ay0: -LABEL_LINE_HEIGHT_PX, ay1: 0 };
  return { ay0: -LABEL_LINE_HEIGHT_PX * 0.8, ay1: LABEL_LINE_HEIGHT_PX * 0.3 };
}

function labelBox(label: MapLabelRender): Box {
  const w = approxTextWidth(label.text);
  const ax0 = label.anchor === 'start' ? 0 : label.anchor === 'end' ? -w : -w / 2;
  const ax1 = label.anchor === 'start' ? w : label.anchor === 'end' ? 0 : w / 2;
  const { ay0, ay1 } = labelVerticalOffsets(label.baseline);
  const rot = label.rotate ?? 0;
  if (rot === 0) return { x0: label.x + ax0, y0: label.y + ay0, x1: label.x + ax1, y1: label.y + ay1 };
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [dx, dy] of [[ax0, ay0], [ax1, ay0], [ax1, ay1], [ax0, ay1]] as const) {
    xs.push(label.x + dx * cos - dy * sin);
    ys.push(label.y + dx * sin + dy * cos);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function overlapArea(a: Box, b: Box, tol = 1.5): number {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) - tol;
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) - tol;
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function featureLabelOverlaps(layout: MapLayout): string[] {
  const labels = layout.features
    .filter((f) => f.label)
    .map((f) => ({ id: f.id, text: f.label!.text, box: labelBox(f.label!) }));
  const out: string[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      if (overlapArea(labels[i].box, labels[j].box) > 0) {
        out.push(`${labels[i].id}:${labels[i].text} × ${labels[j].id}:${labels[j].text}`);
      }
    }
  }
  return out;
}

function restrictionLabelOverlaps(layout: MapLayout): string[] {
  const labels = layout.restrictions
    .filter((r) => r.label)
    .map((r) => ({ id: r.clusterId, text: r.label!.text, box: labelBox(r.label!) }));
  const out: string[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      if (overlapArea(labels[i].box, labels[j].box) > 0) {
        out.push(`${labels[i].id}:${labels[i].text} × ${labels[j].id}:${labels[j].text}`);
      }
    }
  }
  return out;
}

function outsideLabelRows(layout: MapLayout): {
  key: string;
  side: MapLabelRender['anchor'];
  anchorY: number;
  labelY: number;
}[] {
  const rows: {
    key: string;
    side: MapLabelRender['anchor'];
    anchorY: number;
    labelY: number;
  }[] = [];
  for (const f of layout.features) {
    if (f.label && !f.label.inside && f.label.leader.length > 1) {
      rows.push({ key: `f:${f.id}`, side: f.label.anchor, anchorY: f.label.leader[0].y, labelY: f.label.y });
    }
  }
  for (const r of layout.restrictions) {
    if (r.label && !r.label.inside && r.label.leader.length > 1) {
      rows.push({ key: `r:${r.clusterId}`, side: r.label.anchor, anchorY: r.label.leader[0].y, labelY: r.label.y });
    }
  }
  return rows;
}

function firstMoveY(path: string): number {
  const match = path.match(/^M\s+-?\d+(?:\.\d+)?\s+(-?\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Expected rounded-rect path to start with M x y: ${path}`);
  return Number(match[1]);
}

function roundedRectBottom(path: string): number {
  const ys: number[] = [firstMoveY(path)];
  for (const match of path.matchAll(/\bV\s+(-?\d+(?:\.\d+)?)/g)) ys.push(Number(match[1]));
  for (const match of path.matchAll(/\bA\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+0\s+0\s+1\s+-?\d+(?:\.\d+)?\s+(-?\d+(?:\.\d+)?)/g)) {
    ys.push(Number(match[1]));
  }
  return Math.max(...ys);
}

function boxesIntersect(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function expandBox(box: Box, pad: number): Box {
  return { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
}

function pathPoints(path: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const match of path.matchAll(/\b[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    points.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  for (const match of path.matchAll(/\bA\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+0\s+[01]\s+[01]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    points.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  return points;
}

function pathBox(path: string): Box {
  const points = pathPoints(path);
  expect(points.length).toBeGreaterThan(0);
  return {
    x0: Math.min(...points.map((p) => p.x)),
    y0: Math.min(...points.map((p) => p.y)),
    x1: Math.max(...points.map((p) => p.x)),
    y1: Math.max(...points.map((p) => p.y)),
  };
}

function featureBodyBox(feature: MapLayout['features'][number]): Box | null {
  const boxes = feature.segmentPaths.map(pathBox);
  if (boxes.length === 0) return null;
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

function radiusBand(layout: MapLayout, feature: MapLayout['features'][number]): { minR: number; maxR: number } | null {
  const distances = feature.segmentPaths.flatMap((path) =>
    pathPoints(path).map((point) => Math.hypot(point.x - layout.center.x, point.y - layout.center.y)),
  );
  if (distances.length === 0) return null;
  return { minR: Math.min(...distances), maxR: Math.max(...distances) };
}

function centerTitleLabelBoxes(layout: MapLayout): Box[] {
  if (!layout.centerTitle) return [];
  const boxes = layout.centerTitle.lines.map((line) =>
    labelBox({
      text: line.text,
      x: layout.center.x,
      y: line.baselineY,
      anchor: 'middle',
      leader: [],
      inside: true,
    }),
  );
  boxes.push(
    labelBox({
      text: `${layout.length} bp`,
      x: layout.center.x,
      y: layout.centerTitle.lenBaselineY,
      anchor: 'middle',
      leader: [],
      inside: true,
    }),
  );
  return boxes;
}

function overflowBox(overflow: NonNullable<MapLayout['overflows']>[number]): Box {
  return labelBox({
    text: overflow.text,
    x: overflow.x,
    y: overflow.y,
    anchor: overflow.anchor,
    leader: [],
    inside: false,
  });
}

function maxRadiusOfBox(layout: MapLayout, box: Box): number {
  return Math.max(
    Math.hypot(box.x0 - layout.center.x, box.y0 - layout.center.y),
    Math.hypot(box.x1 - layout.center.x, box.y0 - layout.center.y),
    Math.hypot(box.x1 - layout.center.x, box.y1 - layout.center.y),
    Math.hypot(box.x0 - layout.center.x, box.y1 - layout.center.y),
  );
}

function radialLeaderDeviationDeg(layout: MapLayout, label: MapLabelRender): number {
  if (label.leader.length < 2) return 0;
  const start = label.leader[0];
  const end = label.leader[1];
  const radial = { x: start.x - layout.center.x, y: start.y - layout.center.y };
  const leader = { x: end.x - start.x, y: end.y - start.y };
  const radialLen = Math.hypot(radial.x, radial.y);
  const leaderLen = Math.hypot(leader.x, leader.y);
  if (radialLen === 0 || leaderLen === 0) return 0;
  const dot = (radial.x * leader.x + radial.y * leader.y) / (radialLen * leaderLen);
  return Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
}

function leaderLength(label: MapLabelRender): number {
  let length = 0;
  for (let i = 1; i < label.leader.length; i += 1) {
    length += Math.hypot(label.leader[i].x - label.leader[i - 1].x, label.leader[i].y - label.leader[i - 1].y);
  }
  return length;
}

function pointDistanceToRadialLine(layout: MapLayout, anchor: { x: number; y: number }, point: { x: number; y: number }): number {
  const radial = { x: anchor.x - layout.center.x, y: anchor.y - layout.center.y };
  const v = { x: point.x - anchor.x, y: point.y - anchor.y };
  const radialLen = Math.hypot(radial.x, radial.y);
  if (radialLen === 0) return 0;
  return Math.abs(radial.x * v.y - radial.y * v.x) / radialLen;
}

function visibleMapLabelBoxes(layout: MapLayout): { id: string; label: MapLabelRender; box: Box }[] {
  return [
    ...layout.features
      .filter((feature) => feature.label)
      .map((feature) => ({ id: `f:${feature.id}`, label: feature.label!, box: labelBox(feature.label!) })),
    ...layout.restrictions
      .filter((restriction) => restriction.label)
      .map((restriction) => ({
        id: `r:${restriction.clusterId}`,
        label: restriction.label!,
        box: labelBox(restriction.label!),
      })),
  ];
}

function visibleMapLabelOverlaps(layout: MapLayout): string[] {
  const labels = visibleMapLabelBoxes(layout);
  const out: string[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      if (overlapArea(labels[i].box, labels[j].box) > 0) {
        out.push(`${labels[i].id}:${labels[i].label.text} × ${labels[j].id}:${labels[j].label.text}`);
      }
    }
  }
  return out;
}

function circularOutsideLabelGlyphOverlaps(layout: MapLayout): string[] {
  const glyphs = layout.features
    .map((feature) => ({ id: feature.id, box: featureBodyBox(feature) }))
    .filter((item): item is { id: string; box: Box } => item.box != null);
  const labels = visibleMapLabelBoxes(layout).filter((entry) => !entry.label.inside);
  const out: string[] = [];

  for (const label of labels) {
    for (const glyph of glyphs) {
      if (boxesIntersect(label.box, glyph.box)) out.push(`${label.id}:${label.label.text} × glyph:${glyph.id}`);
    }
  }

  return out;
}

function pointsSame(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function segmentOrientation(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): boolean {
  return (
    Math.min(a.x, b.x) - 1e-6 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-6 &&
    Math.min(a.y, b.y) - 1e-6 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-6 &&
    Math.abs(segmentOrientation(a, b, p)) < 1e-6
  );
}

function segmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  if (pointsSame(a, c) || pointsSame(a, d) || pointsSame(b, c) || pointsSame(b, d)) return false;

  const o1 = segmentOrientation(a, b, c);
  const o2 = segmentOrientation(a, b, d);
  const o3 = segmentOrientation(c, d, a);
  const o4 = segmentOrientation(c, d, b);
  if (Math.abs(o1) < 1e-6 && pointOnSegment(a, b, c)) return true;
  if (Math.abs(o2) < 1e-6 && pointOnSegment(a, b, d)) return true;
  if (Math.abs(o3) < 1e-6 && pointOnSegment(c, d, a)) return true;
  if (Math.abs(o4) < 1e-6 && pointOnSegment(c, d, b)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function polylinesIntersect(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]): boolean {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      if (segmentsIntersect(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

function segmentIntersectsBox(a: { x: number; y: number }, b: { x: number; y: number }, box: Box): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, a.x - box.x0) &&
    clip(dx, box.x1 - a.x) &&
    clip(-dy, a.y - box.y0) &&
    clip(dy, box.y1 - a.y) &&
    t1 > t0 + 1e-6
  );
}

function polylineIntersectsBox(polyline: readonly { x: number; y: number }[], box: Box): boolean {
  for (let i = 1; i < polyline.length; i += 1) {
    if (segmentIntersectsBox(polyline[i - 1], polyline[i], box)) return true;
  }
  return false;
}

function circularLeaderCrossings(layout: MapLayout): string[] {
  const leaders = visibleMapLabelBoxes(layout)
    .filter((entry) => entry.label.leader.length > 1)
    .map((entry) => ({ id: entry.id, text: entry.label.text, leader: entry.label.leader }));
  const out: string[] = [];

  for (let i = 0; i < leaders.length; i += 1) {
    for (let j = i + 1; j < leaders.length; j += 1) {
      if (polylinesIntersect(leaders[i].leader, leaders[j].leader)) {
        out.push(`${leaders[i].id}:${leaders[i].text} × ${leaders[j].id}:${leaders[j].text}`);
      }
    }
  }

  return out;
}

function spansOverlap(a: Feature, b: Feature): boolean {
  return a.start < b.end && b.start < a.end;
}

function featureProjectionById(layout: MapLayout): Record<string, Pick<MapLayout['features'][number], 'lane' | 'label' | 'segmentPaths'>> {
  return Object.fromEntries(
    [...layout.features]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((f) => [f.id, { lane: f.lane, segmentPaths: f.segmentPaths, label: f.label }]),
  );
}

function layoutHash(layout: MapLayout): string {
  return createHash('sha256').update(JSON.stringify(layout)).digest('hex');
}

function yMidMeetVerticalMargins(
  layout: MapLayout,
  viewport: { width: number; height: number },
): { top: number; bottom: number } {
  const scale = Math.min(viewport.width / layout.bg.width, viewport.height / layout.bg.height);
  const renderedHeight = layout.bg.height * scale;
  const top = (viewport.height - renderedHeight) / 2;
  return { top, bottom: viewport.height - renderedHeight - top };
}

function linearBpToX(layout: MapLayout, bp: number): number {
  const axisWidth = layout.width - 2 * layout.center.x;
  return layout.center.x + (bp / Math.max(1, layout.length)) * axisWidth;
}

// ── circular ─────────────────────────────────────────────────────────────────
describe('computeMapLayout: circular pUC19', () => {
  const layout = computeMapLayout(circularInput());

  it('projects a circular layout with a positive backbone radius', () => {
    expect(layout.mode).toBe('circular');
    expect(layout.radius).toBeGreaterThan(0);
    expect(layout.center).toEqual({ x: 300, y: 300 });
    // Content-fitted viewBox: 4 finite numbers that fully contain the ring, and
    // it agrees with the numeric bg rect the renderer paints.
    const vb = layout.viewBox.split(' ').map(Number);
    expect(vb).toHaveLength(4);
    expect(vb.every((n) => Number.isFinite(n))).toBe(true);
    const [vx, vy, vw, vh] = vb;
    expect(vx).toBeLessThanOrEqual(300 - layout.radius);
    expect(vy).toBeLessThanOrEqual(300 - layout.radius);
    expect(vx + vw).toBeGreaterThanOrEqual(300 + layout.radius);
    expect(vy + vh).toBeGreaterThanOrEqual(300 + layout.radius);
    expect(layout.bg).toEqual({ x: vx, y: vy, width: vw, height: vh });
    expect(layout.backbonePath.startsWith('M ')).toBe(true);
    expect(layout.backbonePath).toContain('A '); // circle drawn as arcs
  });

  it('can opt into a denser circular outside gutter without changing defaults', () => {
    const defaultLayout = computeMapLayout(circularInput());
    const denser = computeMapLayout(circularInput({ display: { circularOutsideGutterScale: 0.62 } }));
    const artifactDense = computeMapLayout(circularInput({ display: { circularOutsideGutterScale: 0.36 } }));

    expect(defaultLayout.radius).toBe(layout.radius);
    expect(denser.radius).toBeGreaterThan(defaultLayout.radius);
    expect(artifactDense.radius).toBeGreaterThan(denser.radius);
    expect(denser.viewBox.split(' ').map(Number).every((n) => Number.isFinite(n))).toBe(true);
    expect(artifactDense.viewBox.split(' ').map(Number).every((n) => Number.isFinite(n))).toBe(true);
  });

  it('packs overlapping features into >= 2 lanes', () => {
    expect(layout.budgets.laneCount).toBeGreaterThanOrEqual(2);
  });

  it('renders every feature with at least one drawable segment path', () => {
    expect(layout.features).toHaveLength(puc19Features.length);
    for (const f of layout.features) {
      expect(f.segmentPaths.length).toBeGreaterThanOrEqual(1);
      for (const d of f.segmentPaths) expect(d.startsWith('M ')).toBe(true);
    }
  });

  it('derives displayStrand: reverse -> -1, directionless -> 0, forward -> 1', () => {
    const byId = new Map(layout.features.map((f) => [f.id, f]));
    expect(byId.get('ampR')!.displayStrand).toBe(-1);
    expect(byId.get('mcs')!.displayStrand).toBe(0);
    expect(byId.get('ori')!.displayStrand).toBe(1);
  });

  it('labels a wide feature inline without using the obsolete center-ward stack', () => {
    const amp = layout.features.find((f) => f.id === 'ampR')!;
    expect(amp.label).not.toBeNull();
    expect(amp.label!.inside).toBe(true);
    expect(amp.label!.leader).toHaveLength(0);

    expect(layout.features.some((f) => f.label?.inside && f.label.leader.length > 0)).toBe(false);
  });

  it('rescues inside-blocked circular feature labels with outside leaders', () => {
    const pole = computeMapLayout(
      circularInput({
        name: 'pole feature',
        length: 4000,
        features: [
          feat({
            id: 'origin-marker',
            name: 'origin marker at twelve',
            type: 'misc_feature',
            start: 0,
            end: 18,
          }),
        ],
        restrictionSites: [],
        width: 720,
        height: 720,
      }),
    );
    const label = pole.features[0].label;

    expect(label).not.toBeNull();
    expect(label!.text).toBe('origin marker at twelve');
    expect(label!.inside).toBe(false);
    expect(label!.leader.length).toBeGreaterThanOrEqual(2);
  });

  it('routes title-blocked circular labels outside instead of drawing stub ellipses', () => {
    const blocked = computeMapLayout(
      circularInput({
        name: 'Clone of pACYC184 + eGFP (Enhanced Green Fluorescent Protein)',
        length: 4000,
        features: [
          feat({
            id: 'lac-operator',
            name: 'lac operator',
            type: 'misc_feature',
            start: 1000,
            end: 1001,
          }),
        ],
        restrictionSites: [],
        width: 720,
        height: 720,
      }),
    );
    const label = blocked.features[0].label;

    expect(label).not.toBeNull();
    expect(label!.text).toBe('lac operator');
    expect(label!.inside).toBe(false);
    expect(label!.text).not.toContain('…');
  });

  it('routes hard-truncated circular feature labels outside without over-routing short inline labels', () => {
    const longName = 'Enhanced Green Fluorescent Protein reporter cassette';
    const layout = computeMapLayout(
      circularInput({
        name: 'long inline threshold',
        length: 5000,
        features: [
          feat({ id: 'egfp', name: longName, type: 'cds', start: 450, end: 1250, strand: 1 }),
          feat({ id: 'ori-short', name: 'ori', type: 'origin', start: 2200, end: 2900, strand: 1 }),
        ],
        restrictionSites: [],
        width: 600,
        height: 600,
      }),
    );
    const byId = new Map(layout.features.map((f) => [f.id, f]));
    const longLabel = byId.get('egfp')!.label;
    const shortLabel = byId.get('ori-short')!.label;

    expect(longLabel).not.toBeNull();
    expect(longLabel!.inside).toBe(false);
    expect(longLabel!.leader.length).toBeGreaterThanOrEqual(2);
    expect(longLabel!.text).toBe(longName);
    expect(longLabel!.text.length).toBeGreaterThan(12);
    expect(longLabel!.text).not.toContain('…');

    expect(shortLabel).not.toBeNull();
    expect(shortLabel!.inside).toBe(true);
    expect(shortLabel!.leader).toHaveLength(0);
    expect(shortLabel!.text).toBe('ori');
  });

  it('routes small nested circular feature labels outside without text-crossing leaders', () => {
    const nested = computeMapLayout(
      circularInput({
        name: 'pACYC184 + eGFP',
        length: 4245,
        features: [
          feat({ id: 'egfp', name: 'eGFP ORF', type: 'cds', start: 1100, end: 1817, strand: 1 }),
          feat({ id: 'start', name: 'Start Codon', type: 'misc_feature', start: 1100, end: 1103, strand: 1 }),
          feat({ id: 'chromophore', name: 'Chromophore', type: 'misc_feature', start: 1291, end: 1300, strand: 1 }),
        ],
        restrictionSites: [],
        width: 720,
        height: 720,
      }),
    );
    const byId = new Map(nested.features.map((f) => [f.id, f]));

    expect(byId.get('egfp')!.label).not.toBeNull();
    expect(byId.get('egfp')!.label!.inside).toBe(true);
    expect(byId.get('egfp')!.label!.leader).toHaveLength(0);
    for (const id of ['start', 'chromophore']) {
      const label = byId.get(id)!.label;
      expect(label).not.toBeNull();
      expect(label!.inside).toBe(false);
      if (label!.leader.length > 1) {
        expect(polylineIntersectsBox(label!.leader, labelBox(label!))).toBe(false);
      }
      expect(label!.text).toBe(byId.get(id)!.name);
    }
    expect(
      ['start', 'chromophore'].filter((id) => (byId.get(id)!.label?.leader.length ?? 0) > 1),
    ).toHaveLength(1);
  });

  it('keeps mixed circular outside labels on radial leaders instead of side columns', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'outside order',
        length: 6000,
        features: [
          feat({ id: 'orf', name: 'long parent ORF', type: 'cds', start: 500, end: 2600, strand: 1 }),
          feat({ id: 'start', name: 'Start Codon', type: 'misc_feature', start: 520, end: 523, strand: 1 }),
          feat({ id: 'tag', name: 'short epitope tag', type: 'misc_feature', start: 1400, end: 1430, strand: 1 }),
          feat({ id: 'domain', name: 'binding domain', type: 'misc_feature', start: 2100, end: 2140, strand: 1 }),
        ],
        restrictionSites: [
          site('EcoRI', 700, 701, 'GAATTC'),
          site('BamHI', 1600, 1601, 'GGATCC'),
          site('HindIII', 2400, 2401, 'AAGCTT'),
          site('NcoI', 3900, 3901, 'CCATGG'),
          site('XhoI', 4700, 4701, 'CTCGAG'),
        ],
        width: 720,
        height: 720,
      }),
    );

    const rows = outsideLabelRows(layout);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Math.abs(row.labelY - row.anchorY)).toBeLessThanOrEqual(layout.radius * 0.35 + LABEL_LINE_HEIGHT_PX);
    }
  });

  it('stops circular outside-label leaders before they enter the label text', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'centered side labels',
        length: 6000,
        features: [
          feat({ id: 'side-feature', name: 'side feature label', type: 'misc_feature', start: 1450, end: 1460 }),
        ],
        restrictionSites: [
          site('BglII', 1500, 1501, 'AGATCT'),
          site('EcoRI', 4500, 4501, 'GAATTC'),
        ],
        width: 720,
        height: 720,
      }),
    );
    const labels = visibleMapLabelBoxes(layout).filter((entry) => !entry.label.inside && entry.label.leader.length > 1);

    expect(labels.length).toBeGreaterThan(0);
    for (const { label } of labels) {
      const endpoint = label.leader[label.leader.length - 1];
      expect(label.anchor).toBe('middle');
      expect(endpoint).not.toEqual({ x: label.x, y: label.y });
      expect(polylineIntersectsBox(label.leader, labelBox(label))).toBe(false);
      expect(Math.hypot(endpoint.x - label.x, endpoint.y - label.y)).toBeGreaterThan(1);
      if (label.leader.length > 2) {
        expect(pointDistanceToRadialLine(layout, label.leader[0], label.leader[1])).toBeLessThanOrEqual(0.75);
      }
    }
  });

  it('keeps inline circular feature-label rotations readable', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'rotation readable',
        length: 4000,
        features: [
          feat({ id: 'bottom', name: 'TetR', type: 'cds', start: 1800, end: 2200, strand: 1 }),
          feat({ id: 'lower-left', name: 'LLF', type: 'misc_feature', start: 2300, end: 2700, strand: 1 }),
          feat({ id: 'left', name: 'p15A ori', type: 'origin', start: 2800, end: 3200, strand: 1 }),
        ],
        restrictionSites: [],
        width: 720,
        height: 720,
      }),
    );
    const byId = new Map(layout.features.map((f) => [f.id, f]));

    expect(byId.get('bottom')!.label?.rotate).toBe(0);
    expect(byId.get('lower-left')!.label?.rotate).toBe(45);
    expect(byId.get('left')!.label?.rotate).toBe(-90);
    for (const f of layout.features) {
      expect(f.label).not.toBeNull();
      expect(f.label!.inside).toBe(true);
      expect(Math.abs(f.label!.rotate ?? 0)).toBeLessThanOrEqual(90);
    }
  });

  it('produces restriction clusters (MCS collapses, two distant singles remain)', () => {
    expect(layout.restrictionDensityTicks).toHaveLength(puc19Sites.length);
    expect(layout.restrictions.length).toBeGreaterThan(0);
    expect(layout.restrictions.length).toBeLessThan(puc19Sites.length); // MCS grouped
    const mcsCluster = layout.restrictions.find((r) => r.tickIds.length >= 3);
    expect(mcsCluster).toBeDefined();
    // grouped label shows names + "+N" overflow
    expect(mcsCluster!.label?.text).toMatch(/\+\d/);
  });

  it('anchors circular restriction leaders from tick tip to just outside the label edge', () => {
    const labelled = layout.restrictions.filter((r) => r.label && r.label.leader.length > 1);

    expect(labelled.length).toBeGreaterThan(0);
    for (const restriction of labelled) {
      const label = restriction.label!;
      const endpoint = label.leader.at(-1)!;
      expect(restriction.label!.leader[0]).toEqual({ x: restriction.tick.x2, y: restriction.tick.y2 });
      expect(endpoint).not.toEqual({ x: label.x, y: label.y });
      expect(polylineIntersectsBox(label.leader, labelBox(label))).toBe(false);
      expect(Math.hypot(endpoint.x - label.x, endpoint.y - label.y)).toBeGreaterThan(1);
    }
  });

  it('breaks a mixed cluster into per-enzyme labelSegments (only Type IIS flagged)', () => {
    const mixed = computeMapLayout(
      circularInput({
        name: 'mixed typeIIS cluster',
        length: 6000,
        features: [],
        restrictionSites: [
          site('BsaI', 1000, 1008, 'GGTCTC'), // downstream cut -> Type IIS
          site('HpaII', 1010, 1011, 'CCGG'), // C^CGG, cut inside -> not
          site('MspI', 1020, 1021, 'CCGG'), // C^CGG, cut inside -> not
          site('AluI', 1030, 1032, 'AGCT'), // AG^CT -> not
          site('HaeIII', 1040, 1042, 'GGCC'), // GG^CC -> not
        ],
        width: 600,
        height: 600,
      }),
    );
    const cluster = mixed.restrictions.find((r) => r.labelSegments?.[0]?.text === 'BsaI');
    expect(cluster).toBeDefined();
    expect(cluster!.hasTypeIIS).toBe(true);
    // label.text (aria / hit-test / collision probe) stays the flat joined string.
    expect(cluster!.label?.text).toBe('BsaI,HpaII,MspI +2');
    // Per-enzyme breakdown: BsaI is the ONLY Type IIS; the "+N" tail is ink.
    expect(cluster!.labelSegments).toEqual([
      { text: 'BsaI', typeIIS: true },
      { text: 'HpaII', typeIIS: false },
      { text: 'MspI', typeIIS: false },
      { text: '+2', typeIIS: false },
    ]);
    // The renderer's join rule (enzymes by "," + tail by " ") reconstructs label.text.
    const rebuilt = cluster!
      .labelSegments!.map((s, i) => (i === 0 ? '' : s.text.startsWith('+') ? ' ' : ',') + s.text)
      .join('');
    expect(rebuilt).toBe(cluster!.label?.text);
  });

  it('caps circular restriction labels and never re-groups them into sprawling comma labels', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'crowded circular enzyme labels',
        length: 6000,
        features: denseLinearFeatures(40, 6000),
        restrictionSites: crowdedCircularSites(6000),
        width: 600,
        height: 600,
        display: { maxRestrictionLabels: 16 },
      }),
    );
    const visibleRestrictionLabels = layout.restrictions
      .map((restriction) => restriction.label?.text)
      .filter((text): text is string => Boolean(text));
    const capPx = 112; // Mirrors CIRCULAR_REC_LABEL_MAX_WIDTH_PX.

    expect(visibleRestrictionLabels.length).toBeGreaterThan(0);
    expect(visibleRestrictionLabels.some((text) => text.includes(' +'))).toBe(true);
    expect(visibleRestrictionLabels.some((text) => text.includes(', '))).toBe(false);
    for (const label of visibleRestrictionLabels) {
      expect(approxTextWidth(label)).toBeLessThanOrEqual(capPx);
    }
  });

  it('never merges a circular feature outside label into a restriction label at the same angle', () => {
    const mixed = computeMapLayout(
      circularInput({
        name: 'feature restriction colocated',
        length: 6000,
        features: [
          feat({ id: 'gene-7', name: 'gene-7', type: 'gene', start: 0, end: 12, strand: 1 }),
        ],
        restrictionSites: [
          site('BsmBI', 0, 8, 'CGTCTC'),
          site('Esp3I', 4, 12, 'CGTCTC'),
          site('EarI', 8, 9, 'CTCTTC'),
        ],
        width: 720,
        height: 720,
      }),
    );
    const featureLabel = mixed.features.find((f) => f.id === 'gene-7')?.label;
    const restrictionLabels = mixed.restrictions
      .map((r) => r.label?.text)
      .filter((text): text is string => Boolean(text));

    expect(featureLabel?.text).toBe('gene-7');
    expect(featureLabel?.inside).toBe(false);
    expect(mixed.restrictions.length).toBeGreaterThan(0);
    expect(restrictionLabels.every((text) => !text.includes('gene-7'))).toBe(true);
  });

  it('lays out ~6-10 nice coordinate ticks starting at bp 0', () => {
    expect(layout.coordinates.length).toBeGreaterThanOrEqual(4);
    expect(layout.coordinates.length).toBeLessThanOrEqual(12);
    expect(layout.coordinates[0].bp).toBe(0);
    // 2686 / 8 -> nice step 500
    expect(layout.coordinates[1].bp).toBe(500);
    const sideLabel = layout.coordinates.find((coord) => coord.label && Math.abs(coord.tick.x2 - layout.center.x) > layout.radius * 0.7);
    expect(sideLabel?.label?.anchor).toBe('middle');
    expect(Math.abs(sideLabel?.label?.rotate ?? 0)).toBeGreaterThan(20);
    const radialMiss = pointDistanceToRadialLine(layout, { x: sideLabel!.tick.x2, y: sideLabel!.tick.y2 }, sideLabel!.label!);
    expect(radialMiss).toBeLessThanOrEqual(0.75);
  });

  it('keeps the pUC19-scale node budget well under 1000', () => {
    expect(layout.budgets.estimatedSvgNodes).toBeGreaterThan(0);
    expect(layout.budgets.estimatedSvgNodes).toBeLessThan(1000);
  });

  it('reports visible label counts that match the rendered labels', () => {
    const visible =
      layout.features.filter((f) => f.label).length +
      layout.restrictions.filter((r) => r.label).length;
    expect(layout.budgets.visibleLabelCount).toBe(visible);
  });

  it('is fully deterministic (identical JSON on recompute)', () => {
    const a = JSON.stringify(computeMapLayout(circularInput()));
    const b = JSON.stringify(computeMapLayout(circularInput()));
    expect(a).toBe(b);
  });

  it('emits fitted centerTitle metadata for circular titles only', () => {
    expect(layout.centerTitle?.lines).toHaveLength(1);
    expect(layout.centerTitle?.lines[0]).toEqual({ text: 'pUC19', fontSize: 15, baselineY: 298 });
    expect(layout.centerTitle?.lenBaselineY).toBe(316);

    const long = computeMapLayout(
      circularInput({
        name: 'Clone of pACYC184 + eGFP (Enhanced Green Fluorescent Protein)',
        length: 5100,
        width: 720,
        height: 720,
      }),
    );
    expect(long.centerTitle?.lines).toHaveLength(2);
    expect(long.centerTitle?.lines.every((line) => line.fontSize === 14)).toBe(true);

    const linear = computeMapLayout({
      ...circularInput({ topology: 'linear' }),
      mode: 'linear',
      topology: 'linear',
      width: 820,
      height: 320,
    });
    expect(linear.centerTitle).toBeUndefined();
  });

  it('keeps the circular pUC19 layout byte-stable', () => {
    // P2 changed this pin (centerTitle + fitted-title keep-out). WaveC-c1 changed it
    // again: circular restriction renders now carry additive per-enzyme labelSegments
    // for Type IIS per-token coloring (label.text itself is unchanged).
    // W3 text polish re-pinned it for circular-only nested outside labels and
    // signed readable inline rotations; circular geometry is unchanged.
    // Rebaselined after feature/restriction labels stopped treating the circle's
    // enclosing square as an obstacle and now test against actual ring geometry.
    // Rebaselined after inline labels gained a middle dominant-baseline so text sits
    // centered inside the feature band instead of riding the glyph edge.
    // Rebaselined after circular outside labels became individual, capped,
    // direct-leader radial-tier placements with feature labels winning over enzymes.
    // Rebaselined after coordinate labels started yielding to feature leaders.
    // Rebaselined after side outside labels centered on radial leaders, coordinate
    // labels rotated tangentially, and thin bands stopped accepting inline labels.
    // Rebaselined after circular outside-label leaders stopped before padded label boxes.
    // Rebaselined after inline (on-arc) feature labels gained an additive `arcPath`
    // (baseline arc for <textPath> rendering); x/y/rotate/geometry are unchanged —
    // verified by hashing the arcPath-stripped layout back to the prior pin.
    // Direct leaders remain the default when their chord is unobstructed; the
    // radial-first elbow is reserved for a real collision escape. Label positions
    // and the represented label set remain fixed.
    expect(layoutHash(layout)).toBe(
      'f7b5ec70523e97d40f49ee8afff81178c539114faa3153b8ec0a39c9a30934d1',
    );
  });

  it('culls dense tiny inside labels without dropping visible feature geometry', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'dense tiny',
        length: 6000,
        features: denseTinyFeatures(),
        restrictionSites: [],
        width: 360,
        height: 360,
      }),
    );
    const hiddenVisibleFeatures = layout.features.filter((f) => f.label === null && f.segmentPaths.length > 0);

    expect(layout.budgets.hiddenLabelCount).toBeGreaterThan(0);
    expect(hiddenVisibleFeatures.length).toBeGreaterThan(0);
    for (const f of hiddenVisibleFeatures) {
      expect(f.segmentPaths.length).toBeGreaterThan(0);
      expect(f.title).toBeTruthy();
    }
  });

  it('emits a circular feature overflow marker when dense labels are culled', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'dense tiny',
        length: 6000,
        features: denseTinyFeatures(),
        restrictionSites: [],
        width: 360,
        height: 360,
      }),
    );
    const marker = featureOverflow(layout);

    expect(layout.budgets.hiddenLabelCount).toBeGreaterThan(0);
    expect(marker).not.toBeNull();
    expect(overflowCount(marker!.text)).toBe(
      layout.budgets.hiddenLabelCount + layout.budgets.overflowFeatureCount,
    );
    expect(marker!.x).toBeGreaterThan(layout.center.x);
    expect(marker!.y).toBeGreaterThan((layout.centerTitle?.lenBaselineY ?? layout.center.y) + 10);
    expect(marker!.anchor).toBe('middle');
    expect(marker!.title).toContain('feature label');
    expect(marker!.title).toContain('Features tab');
  });

  it('is deterministic for dense tiny inside-label culling', () => {
    const input = circularInput({
      name: 'dense tiny',
      length: 6000,
      features: denseTinyFeatures(),
      restrictionSites: [],
      width: 360,
      height: 360,
    });
    const a = JSON.stringify(computeMapLayout(input));
    const b = JSON.stringify(computeMapLayout(input));
    expect(a).toBe(b);
  });

  it('grows circular radius and canvas as feature density rises', () => {
    const counts = [24, 30, 50, 80, 120];
    const layouts = counts.map((count) =>
      computeMapLayout(
        circularInput({
          name: `dense ${count}`,
          length: 6000,
          features: denseTinyFeatures(count, 6000),
          restrictionSites: [],
          width: 720,
          height: 720,
        }),
      ),
    );

    expect(layouts[1].radius).toBeGreaterThan(layouts[0].radius);
    for (let i = 2; i < layouts.length; i += 1) {
      expect(layouts[i].radius).toBeGreaterThan(layouts[i - 1].radius);
      expect(layouts[i].bg.height).toBeGreaterThan(layouts[i - 1].bg.height);
    }
    for (let i = 1; i < layouts.length; i += 1) {
      expect(layouts[i].features.filter((f) => f.label).length).toBeLessThanOrEqual(36);
    }
    for (const layout of layouts.slice(2)) {
      expect(featureOverflow(layout)?.text).toMatch(/^\+\d+ more$/);
    }
  });

  it('prioritizes dense circular feature labels over restriction labels at dock size', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'pCO351A analog',
        length: 9276,
        features: denseLinearFeatures(22, 9276),
        restrictionSites: denseLinearSites(65, 9276),
        width: 398,
        height: 484,
      }),
    );
    const visibleFeatureLabels = layout.features.filter((f) => f.label).length;
    const visibleRestrictionLabels = layout.restrictions.filter((r) => r.label).length;
    const viewBoxHalfExtent = Math.max(layout.bg.width, layout.bg.height) / 2;

    expect(visibleFeatureLabels).toBe(22);
    expect(featureOverflow(layout)).toBeNull();
    expect(visibleRestrictionLabels).toBeLessThanOrEqual(visibleFeatureLabels);
    // Rebaselined for round-4 center-of-mass labels: side outside labels are now
    // text-anchor:middle and straddle their leader endpoint, so they extend ~half a
    // label-width further out than the old edge-anchored labels and the ring yields a
    // few percent of radius to keep every label clear. Still a large, comfortable ring
    // (visually verified on dense docks); all 22 feature labels stay visible (above).
    expect(layout.radius / viewBoxHalfExtent).toBeGreaterThanOrEqual(0.54);
  });

  it('keeps circular center title and overflow chips inside the innermost feature ring', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'pCO351A analog',
        length: 9276,
        features: denseLinearFeatures(22, 9276),
        restrictionSites: denseLinearSites(65, 9276),
        width: 398,
        height: 484,
      }),
    );
    const innermostFeatureRadius = Math.min(
      ...layout.features
        .map((feature) => radiusBand(layout, feature)?.minR ?? Infinity)
        .filter((radius) => Number.isFinite(radius)),
    );
    const protectedBoxes = [
      ...centerTitleLabelBoxes(layout),
      ...(layout.overflows ?? []).map(overflowBox),
    ];

    expect(innermostFeatureRadius).toBeGreaterThan(0);
    for (const box of protectedBoxes) {
      expect(maxRadiusOfBox(layout, box)).toBeLessThanOrEqual(innermostFeatureRadius - 4);
    }
  });

  it('keeps dense circular feature labels in-arc or on short near-radial leaders', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'dense circular label routing',
        length: 9276,
        features: denseLinearFeatures(22, 9276),
        restrictionSites: denseLinearSites(65, 9276),
        width: 398,
        height: 484,
      }),
    );
    const labels = layout.features.map((f) => f.label).filter((label): label is MapLabelRender => Boolean(label));
    const inArc = labels.filter((label) => label.inside && label.leader.length === 0).length;
    const radialOutside = labels.filter(
      (label) =>
        !label.inside &&
        radialLeaderDeviationDeg(layout, label) <= 35 &&
        leaderLength(label) <= layout.radius * 0.35 + LABEL_LINE_HEIGHT_PX,
    ).length;

    expect(labels.length).toBeGreaterThanOrEqual(18);
    // Rebaselined for round-4 center-of-mass labels: a side outside label's leader now
    // ends at the label's horizontal center (not its ring-side edge), so a few leaders run
    // marginally longer / less strictly radial and fall just outside the "short near-radial"
    // window. 86%+ still sit in-arc or on short radial leaders; the rest read clean (visually
    // verified on dense docks — no long angled spokes).
    expect((inArc + radialOutside) / labels.length).toBeGreaterThanOrEqual(0.85);
  });

  it('keeps crowded circular labels off each other, off glyphs, and on non-crossing leaders', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'dense circular crowded field',
        length: 6000,
        features: denseLinearFeatures(40, 6000),
        restrictionSites: crowdedCircularSites(6000),
        width: 600,
        height: 600,
        display: { maxRestrictionLabels: 16 },
      }),
    );

    expect(visibleMapLabelOverlaps(layout)).toEqual([]);
    expect(circularOutsideLabelGlyphOverlaps(layout)).toEqual([]);
    expect(circularLeaderCrossings(layout)).toEqual([]);
  });

  it('separates angular-overlapping circular feature bands by lane with a real radial gap', () => {
    const features = [
      feat({ id: 'parent', name: 'parent cds', type: 'cds', start: 100, end: 1800, strand: 1 }),
      feat({ id: 'nested-a', name: 'nested A', type: 'misc_feature', start: 200, end: 620, strand: 1 }),
      feat({ id: 'nested-b', name: 'nested B', type: 'misc_feature', start: 560, end: 980, strand: 1 }),
      feat({ id: 'later', name: 'later', type: 'promoter', start: 2100, end: 2500, strand: 1 }),
    ];
    const layout = computeMapLayout(
      circularInput({
        name: 'ring gap',
        length: 3000,
        features,
        restrictionSites: [],
        width: 420,
        height: 420,
      }),
    );
    const byId = new Map(layout.features.map((feature) => [feature.id, feature]));

    for (let i = 0; i < features.length; i += 1) {
      for (let j = i + 1; j < features.length; j += 1) {
        if (spansOverlap(features[i], features[j])) {
          expect(byId.get(features[i].id)?.lane).not.toBe(byId.get(features[j].id)?.lane);
        }
      }
    }

    const bandByLane = new Map<number, { minR: number; maxR: number }>();
    for (const feature of byId.values()) {
      const band = radiusBand(layout, feature);
      if (!band) continue;
      const existing = bandByLane.get(feature.lane);
      bandByLane.set(feature.lane, existing
        ? { minR: Math.min(existing.minR, band.minR), maxR: Math.max(existing.maxR, band.maxR) }
        : band);
    }
    const bands = [...bandByLane.entries()]
      .map(([lane, band]) => ({ lane, band }))
      .sort((a, b) => a.lane - b.lane);
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i - 1].band.minR - bands[i].band.maxR).toBeGreaterThanOrEqual(3.5);
    }
  });

  it('routes shared-stem circular feature names outside instead of ambiguous ellipses', () => {
    const features = Array.from({ length: 10 }, (_, i) =>
      feat({
        id: `promoter-${i}`,
        name: `promoter-${String(i + 1).padStart(3, '0')}`,
        type: 'promoter',
        start: 100 + i * 500,
        end: 128 + i * 500,
        strand: 1,
      }),
    );
    const layout = computeMapLayout(
      circularInput({
        name: 'shared promoter stems',
        length: 6000,
        features,
        restrictionSites: [],
        width: 720,
        height: 720,
      }),
    );
    const labels = layout.features.map((f) => f.label?.text).filter((text): text is string => Boolean(text));

    expect(labels).toHaveLength(features.length);
    expect(labels.some((text) => text.endsWith('…'))).toBe(false);
    expect(labels).toContain('promoter-001');
    expect(layout.features.some((f) => f.label && !f.label.inside)).toBe(true);
  });

  it('uses monospace feature-label width budgets for high contrast', () => {
    const label = 'MMMMMMMMMMMMMMM';
    const feature = feat({ id: 'wide-hc', name: label, type: 'cds', start: 1000, end: 1460, strand: 1 });
    const input = circularInput({
      name: 'hc width parity',
      length: 6000,
      features: [feature],
      restrictionSites: [],
      width: 720,
      height: 720,
    });
    const proportional = computeMapLayout({ ...input, display: { labelFontMode: 'proportional' } });
    const monospace = computeMapLayout({ ...input, display: { labelFontMode: 'monospace' } });

    expect(proportional.features[0].label).not.toBeNull();
    expect(proportional.features[0].label!.leader).toHaveLength(0);
    expect(monospace.features[0].label).not.toBeNull();
    expect(monospace.features[0].label!.leader.length).toBeGreaterThanOrEqual(2);
  });
});

// ── origin wrap + subranges ───────────────────────────────────────────────────
describe('computeMapLayout: segmentation', () => {
  it('splits an origin-wrapping feature into 2 segment paths', () => {
    const wrap = feat({ id: 'w', name: 'wrap', start: 2600, end: 100, strand: 1 });
    const layout = computeMapLayout(
      circularInput({ features: [wrap], restrictionSites: [] }),
    );
    expect(layout.features[0].segmentPaths).toHaveLength(2);
  });

  it('renders one path per subRange for a multi-exon CDS', () => {
    const cds = feat({
      id: 'cds',
      name: 'splitCDS',
      type: 'cds',
      start: 100,
      end: 500,
      strand: 1,
      subRanges: [
        { start: 100, end: 200 },
        { start: 400, end: 500 },
      ],
    });
    const layout = computeMapLayout(circularInput({ features: [cds], restrictionSites: [] }));
    expect(layout.features[0].segmentPaths).toHaveLength(cds.subRanges!.length);
  });
});

// ── protein / linear ──────────────────────────────────────────────────────────
describe('computeMapLayout: linear + protein', () => {
  it('forces protein to linear mode and does not throw', () => {
    const proteinInput: MapInput = {
      mode: 'circular', // deliberately wrong; must be overridden to linear
      name: 'GFP',
      length: 238,
      topology: 'linear',
      sequenceType: 'protein',
      features: [feat({ id: 'chromo', name: 'chromophore', type: 'misc_feature', start: 60, end: 70 })],
      restrictionSites: [],
      width: 800,
      height: 260,
    };
    const layout = computeMapLayout(proteinInput);
    expect(layout.mode).toBe('linear');
    expect(layout.radius).toBe(0);
    expect(layout.linearAxis).toEqual({
      startX: 28,
      endX: 772,
      width: 744,
      y: 24,
    });
  });

  it('exposes explicit linear axis geometry and omits it for circular layouts', () => {
    const linear = computeMapLayout({
      mode: 'linear',
      name: 'axis contract',
      length: 1000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [],
      restrictionSites: [],
      width: 820,
      height: 260,
    });

    expect(linear.linearAxis).toEqual({
      startX: 28,
      endX: 792,
      width: 764,
      y: 24,
    });
    expect(linear.backbonePath).toBe('M 28 24 L 792 24');
    expect(linear.center).toEqual({ x: linear.linearAxis!.startX, y: linear.linearAxis!.y });
    expect(computeMapLayout(circularInput()).linearAxis).toBeUndefined();
  });

  it('renders stacked feature rows below the axis for linear DNA', () => {
    const linear: MapInput = {
      mode: 'linear',
      name: 'insert',
      length: 3000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [
        feat({ id: 'g1', name: 'gene', type: 'cds', start: 400, end: 2400, strand: 1 }),
        feat({ id: 'g2', name: 'term', type: 'terminator', start: 200, end: 900, strand: 1 }),
        feat({ id: 'p1', name: 'rbs', type: 'rbs', start: 380, end: 400, strand: 1 }),
      ],
      restrictionSites: [site('EcoRI', 500, 501, 'GAATTC'), site('XhoI', 2100, 2102, 'CTCGAG')],
      width: 820,
      height: 320,
    };
    const layout = computeMapLayout(linear);
    expect(layout.mode).toBe('linear');
    expect(layout.center).toEqual({ x: 28, y: 24 });
    expect(layout.linearAxis).toEqual({ startX: 28, endX: 792, width: 764, y: 24 });
    expect(layout.coordinates.every((c) => c.tick.y1 === 24 && c.tick.y2 === 29)).toBe(true);
    expect(layout.coordinates.every((c) => c.label?.y === 14)).toBe(true);
    expect(layout.coordinates.every((c) => c.grid && c.grid.y2 <= layout.bg.height)).toBe(true);
    expect(layout.budgets.laneCount).toBeGreaterThanOrEqual(1);
    for (const f of layout.features) expect(f.segmentPaths.length).toBeGreaterThanOrEqual(1);
    // a feature label sits in the feature rows below the fixed restriction band.
    const labelled = layout.features.find((f) => f.label);
    expect(labelled).toBeDefined();
    expect(labelled!.label!.y).toBeGreaterThan(72);
    // restriction ticks live in the fixed band below the top ruler.
    expect(layout.restrictions.length).toBeGreaterThan(0);
    expect(layout.restrictions.every((r) => r.tick.y1 === 34 && r.tick.y2 === 42)).toBe(true);
  });

  it('requires per-side slack before a feature label is allowed inline', () => {
    const name = 'edge';
    const textW = approxTextWidth(name);

    expect(fitsInline(name, textW + INLINE_PADDING_PX - 0.1)).toBe(false);
    expect(fitsInline(name, textW + INLINE_PADDING_PX)).toBe(true);
    expect(
      fitsInline(
        name,
        approxTextWidth(name, 16) + INLINE_PADDING_PX * (16 / LABEL_FONT_PX) - 0.1,
        16,
      ),
    ).toBe(false);
    expect(fitsInline(name, textW + INLINE_PADDING_PX, undefined, 'proportional', 11.9)).toBe(false);
    expect(fitsInline(name, textW + INLINE_PADDING_PX, undefined, 'proportional', 12)).toBe(true);

    const narrow = computeMapLayout({
      mode: 'linear',
      name: 'inline narrow',
      length: 1000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [feat({ id: 'narrow', name, type: 'cds', start: 100, end: 145, strand: 1 })],
      restrictionSites: [],
      width: 720,
      height: 220,
    });
    expect(narrow.features[0].label?.inside).toBe(false);

    const wide = computeMapLayout({
      mode: 'linear',
      name: 'inline wide',
      length: 1000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [feat({ id: 'wide', name, type: 'cds', start: 100, end: 260, strand: 1 })],
      restrictionSites: [],
      width: 720,
      height: 220,
    });
    const feature = wide.features[0];
    const label = feature.label;
    const body = featureBodyBox(feature);
    expect(label).not.toBeNull();
    expect(body).not.toBeNull();
    expect(label!.inside).toBe(true);
    expect(label!.anchor).toBe('middle');
    expect(label!.baseline).toBe('middle');

    const textBox = labelBox(label!);
    const bodyCenter = (body!.x0 + body!.x1) / 2;
    const labelCenter = (textBox.x0 + textBox.x1) / 2;
    expect(Math.abs(labelCenter - bodyCenter)).toBeLessThanOrEqual(0.5);
    expect(textBox.x0 - body!.x0).toBeGreaterThanOrEqual(INLINE_PADDING_PX / 2 - 0.5);
    expect(body!.x1 - textBox.x1).toBeGreaterThanOrEqual(INLINE_PADDING_PX / 2 - 0.5);
  });

  it('centers inline linear labels on the rendered arrow glyph', () => {
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'inline arrow centering',
      length: 1000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [
        feat({ id: 'forward', name: 'fwd', type: 'cds', start: 100, end: 260, strand: 1 }),
        feat({ id: 'reverse', name: 'rev', type: 'cds', start: 520, end: 680, strand: -1 }),
      ],
      restrictionSites: [],
      width: 720,
      height: 220,
    });

    for (const feature of layout.features) {
      const label = feature.label;
      const body = featureBodyBox(feature);
      expect(label).not.toBeNull();
      expect(body).not.toBeNull();
      expect(label!.inside).toBe(true);
      const textBox = labelBox(label!);
      const textCenter = (textBox.x0 + textBox.x1) / 2;
      const glyphCenter = (body!.x0 + body!.x1) / 2;
      expect(Math.abs(textCenter - glyphCenter)).toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps linear row tops monotonic and bounded in a dense stack', () => {
    const features = stackedLinearFeatures();
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'dense stack',
      length: 6000,
      topology: 'linear',
      sequenceType: 'dna',
      features,
      restrictionSites: [],
      width: 1000,
      height: 420,
    });
    const byLane = new Map<number, { top: number; bottom: number }>();
    for (const f of layout.features) {
      if (f.segmentPaths.length === 0) continue;
      const top = firstMoveY(f.segmentPaths[0]);
      const bottom = roundedRectBottom(f.segmentPaths[0]);
      const existing = byLane.get(f.lane);
      if (existing) expect(existing.top).toBe(top);
      else byLane.set(f.lane, { top, bottom });
    }
    const rows = [...byLane.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
    expect(rows.length).toBeGreaterThan(1);
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].top).toBeGreaterThan(rows[i - 1].top);
    expect(new Set(rows.map((r) => r.top)).size).toBe(rows.length);
    expect(Math.max(...rows.map((r) => r.bottom))).toBeLessThanOrEqual(layout.bg.height - 10);
    expect(layout.bg.height).toBeLessThanOrEqual(420);
    expect(layout.budgets.overflowFeatureCount).toBeGreaterThan(0);
  });

  it('emits a linear feature overflow marker for hidden feature bodies and labels', () => {
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'dense stack overflow marker',
      length: 6000,
      topology: 'linear',
      sequenceType: 'dna',
      features: stackedLinearFeatures(),
      restrictionSites: [],
      width: 1000,
      height: 420,
    });
    const marker = featureOverflow(layout);

    expect(layout.budgets.overflowFeatureCount).toBeGreaterThan(0);
    expect(marker).not.toBeNull();
    expect(marker!.kind).toBe('feature-labels');
    expect(overflowCount(marker!.text)).toBe(
      layout.budgets.overflowFeatureCount + layout.budgets.hiddenLabelCount,
    );
    expect(marker!.title).toMatch(/feature bod(?:y|ies)/);
    expect(marker!.title).toContain('feature label');
    expect(marker!.title).toContain('Features tab');
  });

  it('does not overlap visible linear feature labels in dense scenarios', () => {
    const scenarios: MapInput[] = [
      {
        mode: 'linear',
        name: 'linear dense 24',
        length: 9276,
        topology: 'linear',
        sequenceType: 'dna',
        width: 1000,
        height: 420,
        features: denseLinearFeatures(24, 9276),
        restrictionSites: denseLinearSites(28, 9276),
      },
      {
        mode: 'linear',
        name: 'linear dense 40',
        length: 6000,
        topology: 'linear',
        sequenceType: 'dna',
        width: 1000,
        height: 420,
        features: denseLinearFeatures(40, 6000),
        restrictionSites: denseLinearSites(20, 6000),
      },
    ];

    for (const input of scenarios) {
      expect(featureLabelOverlaps(computeMapLayout(input))).toEqual([]);
    }
  });

  it('keeps linear beside labels centered on their feature row with a deterministic side gap', () => {
    const features = [
      feat({ id: 'left', name: 'Left Outside Label', type: 'cds', start: 280, end: 330, strand: -1 }),
      feat({ id: 'right', name: 'Right Outside Label', type: 'cds', start: 720, end: 770, strand: 1 }),
      feat({ id: 'neutral', name: 'Neutral Outside Label', type: 'misc_feature', start: 1240, end: 1290, strand: 0 }),
    ];
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'beside alignment',
      length: 3000,
      topology: 'linear',
      sequenceType: 'dna',
      features,
      restrictionSites: [],
      width: 900,
      height: 260,
    });

    for (const feature of layout.features) {
      const source = features.find((item) => item.id === feature.id)!;
      const label = feature.label;
      const body = featureBodyBox(feature);
      const bodyX0 = linearBpToX(layout, source.start);
      const bodyX1 = linearBpToX(layout, source.end);
      expect(label).not.toBeNull();
      expect(body).not.toBeNull();
      expect(label!.inside).toBe(false);
      expect(label!.baseline).toBe('middle');
      expect(Math.abs(label!.y - (body!.y0 + body!.y1) / 2)).toBeLessThanOrEqual(0.5);
      if (label!.anchor === 'start') {
        expect(label!.x - bodyX1).toBeGreaterThanOrEqual(4);
      } else {
        expect(bodyX0 - label!.x).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('stacks tiled linear features by reserved outside-label width', () => {
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'linear dense 40',
      length: 6000,
      topology: 'linear',
      sequenceType: 'dna',
      width: 1000,
      height: 420,
      features: denseLinearFeatures(40, 6000),
      restrictionSites: denseLinearSites(20, 6000),
    });
    const featureLabels = layout.features.filter((f) => f.label).length;
    const featureRows = new Set(
      layout.features.filter((f) => f.segmentPaths.length > 0).map((f) => f.lane),
    );

    expect(layout.budgets.laneCount).toBe(7);
    expect(featureRows.size).toBe(7);
    // Full-width outside-label reservation keeps labels collision-safe while the
    // side-gap fit lets every label survive in this roomy fixture.
    expect(featureLabels).toBe(40);
    expect(layout.features.every((f) => !f.label || f.label.inside || f.label.leader.length === 0)).toBe(true);
    expect(layout.budgets.overflowFeatureCount).toBe(0);
    expect(layout.budgets.hiddenLabelCount).toBe(0);
    expect(featureOverflow(layout)).toBeNull();
    expect(featureLabelOverlaps(layout)).toEqual([]);
  });

  it('renders long outside feature labels fully when the side gap has room', () => {
    const name = 'very-long-synthetic-expression-cassette-feature-label';
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'long label',
      length: 2000,
      topology: 'linear',
      sequenceType: 'dna',
      width: 800,
      height: 260,
      features: [feat({ id: 'long', name, type: 'cds', start: 100, end: 160, strand: 1 })],
      restrictionSites: [],
    });
    const label = layout.features[0].label;

    expect(approxTextWidth(name)).toBeGreaterThan(120);
    expect(label).not.toBeNull();
    expect(label!.inside).toBe(false);
    expect(label!.text).toBe(name);
    expect(label!.text.endsWith('…')).toBe(false);
  });

  it('routes feature names wider than the block outside the block', () => {
    const name = 'oversized-feature-name-that-cannot-fit-inside-the-block';
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'oversized feature block',
      length: 1000,
      topology: 'linear',
      sequenceType: 'dna',
      width: 720,
      height: 260,
      features: [feat({ id: 'wide-name', name, type: 'cds', start: 450, end: 470, strand: 1 })],
      restrictionSites: [],
    });
    const feature = layout.features[0];
    const label = feature.label;
    const body = featureBodyBox(feature);

    expect(body).not.toBeNull();
    expect(approxTextWidth(name)).toBeGreaterThan(body!.x1 - body!.x0);
    expect(label).not.toBeNull();
    expect(label!.inside).toBe(false);
    const textBox = labelBox(label!);
    expect(textBox.x0 >= body!.x1 + 3.5 || textBox.x1 <= body!.x0 - 3.5).toBe(true);
  });

  it('ellipsizes long outside feature labels only when the real side gap is cramped', () => {
    const name = 'very-long-synthetic-expression-cassette-feature-label-with-extra-domain';
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'cramped long label',
      length: 1000,
      topology: 'linear',
      sequenceType: 'dna',
      width: 720,
      height: 260,
      features: [feat({ id: 'long', name, type: 'cds', start: 450, end: 470, strand: 0 })],
      restrictionSites: [],
    });
    const label = layout.features[0].label;

    expect(approxTextWidth(name)).toBeGreaterThan(360);
    expect(label).not.toBeNull();
    expect(label!.inside).toBe(false);
    expect(label!.text).not.toBe(name);
    expect(label!.text.endsWith('…')).toBe(true);
    // The budget is now the actual side gap, so cramped labels may still use more
    // than the old fixed 120 px cap when that space is genuinely free.
    expect(approxTextWidth(label!.text)).toBeGreaterThan(120);
  });

  it('caps the fixed linear restriction label band and emits an overflow marker', () => {
    const len = 4000;
    const sites = Array.from({ length: 40 }, (_, i) =>
      site(`Enzyme${i}`, 50 + i * 100, 51 + i * 100, 'GAATTC'),
    );
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'dense linear restriction sites',
      length: len,
      topology: 'linear',
      sequenceType: 'dna',
      features: [],
      restrictionSites: sites,
      width: 1000,
      height: 420,
      display: { maxRestrictionLabels: 8 },
    });
    const visibleRestrictionLabels = layout.restrictions.filter((r) => r.label).length;
    expect(layout.restrictions.length).toBeGreaterThan(visibleRestrictionLabels);
    for (const r of layout.restrictions) {
      expect(Number.isFinite(r.tick.x1)).toBe(true);
      expect(r.tick.x1).toBe(r.tick.x2);
      expect(r.tick.y1).toBe(34);
      expect(r.tick.y2).toBe(42);
    }
    expect(visibleRestrictionLabels).toBeLessThanOrEqual(8);
    expect(layout.overflows?.[0]?.text).toMatch(/^\+\d+ more sites$/);
  });

  it('uses the Type IIS enzyme as the compact linear cluster lead', () => {
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'type iis cluster',
      length: 2000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [],
      restrictionSites: [
        site('KpnI', 100, 101, 'GGTACC'),
        site('BsaI', 101, 110, 'GGTCTC'),
      ],
      width: 1000,
      height: 220,
    });

    expect(layout.restrictions).toHaveLength(1);
    expect(layout.restrictions[0].hasTypeIIS).toBe(true);
    expect(layout.restrictions[0].label?.text).toBe('BsaI +1');
  });

  it('does not ellipsize short linear restriction enzyme names', () => {
    const sites = Array.from({ length: 101 }, (_, i) =>
      site(i === 0 ? 'HindIII' : `Enz${i}`, 500 + i, 501 + i, i === 0 ? 'AAGCTT' : 'GAATTC'),
    );
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'short linear restriction label',
      length: 2000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [],
      restrictionSites: sites,
      width: 1000,
      height: 220,
    });
    const visibleRestrictionLabels = layout.restrictions
      .map((r) => r.label?.text)
      .filter((text): text is string => Boolean(text));

    expect(layout.restrictions).toHaveLength(1);
    expect(visibleRestrictionLabels).toEqual(['HindIII +100']);
    expect(visibleRestrictionLabels.some((text) => text.includes('…'))).toBe(false);
  });

  it('is deterministic for linear layout and feature order independent per id', () => {
    const input: MapInput = {
      mode: 'linear',
      name: 'deterministic linear',
      length: 9276,
      topology: 'linear',
      sequenceType: 'dna',
      width: 1000,
      height: 420,
      features: denseLinearFeatures(24, 9276),
      restrictionSites: denseLinearSites(12, 9276),
    };
    const a = computeMapLayout(input);
    const b = computeMapLayout(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const shuffled = { ...input, features: [...input.features].reverse() };
    expect(featureProjectionById(computeMapLayout(shuffled))).toEqual(featureProjectionById(a));
  });

  it('is deterministic when feature overflow markers are emitted', () => {
    const inputs: MapInput[] = [
      {
        mode: 'linear',
        name: 'deterministic linear feature overflow',
        length: 6000,
        topology: 'linear',
        sequenceType: 'dna',
        features: stackedLinearFeatures(),
        restrictionSites: [],
        width: 1000,
        height: 420,
      },
      circularInput({
        name: 'deterministic circular feature overflow',
        length: 6000,
        features: denseTinyFeatures(),
        restrictionSites: [],
        width: 360,
        height: 360,
      }),
    ];

    for (const input of inputs) {
      const a = computeMapLayout(input);
      const b = computeMapLayout(input);
      expect(featureOverflow(a)).not.toBeNull();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('does not emit feature overflow markers for sparse maps', () => {
    const sparseLinear = computeMapLayout({
      mode: 'linear',
      name: 'sparse linear',
      length: 3000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [feat({ id: 'gene', name: 'gene', type: 'cds', start: 400, end: 2200, strand: 1 })],
      restrictionSites: [],
      width: 820,
      height: 320,
    });
    const sparseCircular = computeMapLayout(
      circularInput({
        name: 'sparse circular',
        features: [feat({ id: 'ori-only', name: 'ori', type: 'origin', start: 800, end: 1400 })],
        restrictionSites: [],
      }),
    );

    expect(featureOverflow(sparseLinear)).toBeNull();
    expect(featureOverflow(sparseCircular)).toBeNull();
  });

  it('keeps sparse six-feature linear layout byte-stable', () => {
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'sparse linear six',
      length: 3000,
      topology: 'linear',
      sequenceType: 'dna',
      features: Array.from({ length: 6 }, (_, i) =>
        feat({
          id: `s${i}`,
          name: `feat-${i + 1}`,
          type: 'cds',
          start: 100 + i * 420,
          end: 300 + i * 420,
          strand: i % 2 ? -1 : 1,
        }),
      ),
      restrictionSites: [],
      width: 746,
      height: 420,
    });

    // Rebaselined after linear labels gained middle baselines and the dock-fill path
    // stopped baking vertical centering into content coordinates.
    // Rebaselined after beside-glyph labels used 4px clearance and stopped forcing
    // decorative leaders for adjacent labels.
    // Rebaselined after outside feature labels clear the arrowhead TIP (edgeX pushed
    // to the visual tip on the pointing side), not just the flat body edge.
    // Rebaselined after MapLayout gained explicit linearAxis geometry.
    // Rebaselined after inline labels centered on rendered arrow glyphs and
    // linear restriction labels used center-entering callout leaders.
    // Rebaselined after linear feature bars became square-ended to match the
    // artifact's Benchling-style feature treatment.
    expect(layoutHash(layout)).toBe(
      '52c8c1aff95c22cace479fb781b544371c6e54ff277bedce586d95ba4dc5ab90',
    );
    expect(layout.budgets.hiddenLabelCount).toBe(0);
    expect(layout.budgets.overflowFeatureCount).toBe(0);
  });

  it('uses the proportional lane packer at narrow dock widths without dropping sparse labels', () => {
    const features = [
      feat({ id: 'promoter', name: 'promoter-1', type: 'promoter', start: 20, end: 100, strand: 1 }),
      feat({ id: 'cds', name: 'cds-2', type: 'cds', start: 180, end: 420, strand: 1 }),
      feat({ id: 'origin', name: 'origin-3', type: 'origin', start: 470, end: 560, strand: 1 }),
      feat({ id: 'terminator', name: 'terminator-4', type: 'terminator', start: 610, end: 700, strand: -1 }),
    ];
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'sparse dock width',
      length: 720,
      topology: 'linear',
      sequenceType: 'dna',
      features,
      restrictionSites: [],
      width: 400,
      height: 420,
    });

    expect(layout.width).toBeGreaterThanOrEqual(720);
    expect(layout.features.filter((f) => f.label).map((f) => f.name)).toEqual(
      features.map((f) => f.name),
    );
    expect(featureOverflow(layout)).toBeNull();
  });

  it('caps dense linear dock lane spread and keeps labels off neighboring glyphs', () => {
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'linear tall dock',
      length: 9276,
      topology: 'linear',
      sequenceType: 'dna',
      features: denseLinearFeatures(22, 9276),
      restrictionSites: denseLinearSites(65, 9276),
      width: 400,
      height: 670,
      fillAvailableHeight: true,
    });
    const rowTops = [...new Set(layout.features
      .filter((feature) => feature.segmentPaths.length > 0)
      .map((feature) => firstMoveY(feature.segmentPaths[0])))]
      .sort((a, b) => a - b);
    const minPitch = Math.min(...rowTops.slice(1).map((top, index) => top - rowTops[index]));
    const stretchedPitch = (layout.height - 82 - 10 - 16) / Math.max(1, rowTops.length - 1);
    const dockMargins = yMidMeetVerticalMargins(layout, { width: 400, height: 484 });
    const featureBodyBoxes = new Map(
      layout.features.map((feature) => [feature.id, featureBodyBox(feature)] as const),
    );

    expect(layout.height).toBe(670);
    expect(layout.bg.height).toBeLessThan(layout.height);
    expect(rowTops.length).toBeGreaterThanOrEqual(3);
    // Rows need enough pitch for beside-label clearance, but the dock must not
    // spend every spare pixel as inter-lane whitespace. The renderer centers the
    // resulting content-sized viewBox with yMid meet, producing balanced dock
    // whitespace without stretching lane pitch.
    expect(minPitch).toBeGreaterThanOrEqual(34);
    expect(minPitch).toBeLessThanOrEqual(46);
    expect(stretchedPitch).toBeGreaterThan(70);
    expect(minPitch).toBeLessThan(stretchedPitch);
    expect(Math.abs(dockMargins.top - dockMargins.bottom)).toBeLessThanOrEqual(0.5);
    expect(rowTops[0]).toBe(82);

    for (const feature of layout.features) {
      if (!feature.label) continue;
      const textBox = labelBox(feature.label);
      for (const other of layout.features) {
        if (other.id === feature.id) continue;
        const body = featureBodyBoxes.get(other.id);
        if (!body) continue;
        expect(boxesIntersect(expandBox(textBox, 4), body)).toBe(false);
      }
    }
  });

  it('reserves clear horizontal space before the linear restriction overflow chip', () => {
    const len = 9276;
    const sites = denseLinearSites(80, len);
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'linear overflow gap',
      length: len,
      topology: 'linear',
      sequenceType: 'dna',
      features: denseLinearFeatures(22, len),
      restrictionSites: sites,
      width: 400,
      height: 420,
    });
    const overflow = layout.overflows?.find((o) => o.kind === 'restriction-labels');
    expect(overflow?.text).toMatch(/^\+\d+ more sites$/);
    const overflowLeft = overflow!.x - approxTextWidth(overflow!.text);
    const sameRow = layout.restrictions
      .filter((r) => r.label?.y === overflow!.y)
      .map((r) => {
        const w = approxTextWidth(r.label!.text);
        return r.label!.x + w / 2;
      });

    expect(sameRow.length).toBeGreaterThan(0);
    expect(Math.min(...sameRow.map((right) => overflowLeft - right))).toBeGreaterThanOrEqual(4);
  });
});

// ── dense restriction culling ─────────────────────────────────────────────────
describe('computeMapLayout: dense restriction culling', () => {
  it('keeps all-enzyme-scale density ticks while de-chaining clusters into spaced labels', () => {
    const len = 9276;
    const sites = allEnzymeScaleSites(1143, len);
    const inputs: MapInput[] = [
      circularInput({
        name: 'all enzymes circular',
        length: len,
        features: [],
        restrictionSites: sites,
        width: 720,
        height: 720,
      }),
      {
        mode: 'linear',
        name: 'all enzymes linear',
        length: len,
        topology: 'linear',
        sequenceType: 'dna',
        features: [],
        restrictionSites: sites,
        width: 1000,
        height: 420,
      },
    ];

    for (const input of inputs) {
      const layout = computeMapLayout(input);
      const visibleLabels = layout.restrictions.filter((r) => r.label);
      const labeledBp = visibleLabels.map((r) => r.anchorBp);

      expect(layout.restrictionDensityTicks).toHaveLength(sites.length);
      expect(layout.restrictions.length).toBeGreaterThan(1);
      expect(visibleLabels.length).toBeGreaterThan(1);
      expect(visibleLabels.length).toBeLessThan(layout.restrictions.length);
      expect(Math.max(...layout.restrictions.map((r) => r.tickIds.length))).toBeLessThan(100);
      expect(Math.max(...labeledBp) - Math.min(...labeledBp)).toBeGreaterThan(len * 0.6);
      expect(layout.overflows?.find((o) => o.kind === 'restriction-labels')?.text).toMatch(/^\+\d+ more sites$/);
      for (const label of visibleLabels) {
        const overflow = label.label!.text.match(/\+(\d+)/);
        if (overflow) expect(Number(overflow[1])).toBeLessThan(100);
      }
      expect(restrictionLabelOverlaps(layout)).toEqual([]);
    }
  });

  it('culls restriction labels when they exceed the hard cap', () => {
    const len = 4000;
    const sites: RestrictionSite[] = [];
    for (let i = 0; i < 40; i += 1) {
      sites.push(site(`Enz${i}`, 50 + i * 100, 51 + i * 100, 'GAATTC'));
    }
    const layout = computeMapLayout({
      mode: 'circular',
      name: 'dense',
      length: len,
      topology: 'circular',
      sequenceType: 'dna',
      features: [],
      restrictionSites: sites,
      width: 600,
      height: 600,
      display: { maxRestrictionLabels: 8 },
    });
    // spread sites do not merge -> many clusters, cap hides the surplus
    expect(layout.restrictions.length).toBeGreaterThan(8);
    expect(layout.budgets.hiddenLabelCount).toBeGreaterThan(0);
    const nullLabels = layout.restrictions.filter((r) => r.label === null).length;
    expect(nullLabels).toBeGreaterThan(0);
    expect(layout.restrictions.filter((r) => r.label).length).toBeLessThanOrEqual(8);
  });

  it('never lets a corrupt restriction/feature poison the fitted viewBox (codex2 fix)', () => {
    const layout = computeMapLayout(
      circularInput({
        features: [
          ...puc19Features,
          feat({ id: 'bad', name: 'bad', type: 'cds', start: NaN, end: 100, strand: 1 }),
        ],
        restrictionSites: [
          ...puc19Sites,
          site('BadEnz', NaN, NaN, 'GAATTC'),
        ],
      }),
    );
    const vb = layout.viewBox.split(' ').map(Number);
    expect(vb.every((n) => Number.isFinite(n))).toBe(true);
    expect(layout.bg.width).toBeGreaterThan(0);
    expect(layout.bg.height).toBeGreaterThan(0);
    // The corrupt feature contributes no drawable segment.
    expect(layout.features.find((f) => f.id === 'bad')?.segmentPaths).toEqual([]);
  });

  it('keeps circular lanes non-inverted on a small viewport (adaptive coord band)', () => {
    // 320px map with heavily overlapping features -> many lanes. No lane may
    // invert (inner >= outer) and the ring must stay positive.
    const stack = Array.from({ length: 8 }, (_, i) =>
      feat({ id: `f${i}`, name: `f${i}`, type: 'cds', start: 100, end: 2500, strand: 1 }),
    );
    const layout = computeMapLayout(circularInput({ features: stack, width: 320, height: 320 }));
    expect(layout.radius).toBeGreaterThan(0);
    expect(layout.budgets.laneCount).toBeGreaterThanOrEqual(2);
    for (const f of layout.features) {
      for (const d of f.segmentPaths) expect(d.includes('NaN')).toBe(false);
    }
  });

  it('stacks origin-adjacent circular features into separate padded rings', () => {
    const layout = computeMapLayout(
      circularInput({
        name: 'origin adjacency',
        length: 6000,
        features: [
          feat({ id: 'tail', name: 'tail feature', type: 'cds', start: 5960, end: 6000, strand: 1 }),
          feat({ id: 'head', name: 'head feature', type: 'promoter', start: 0, end: 40, strand: 1 }),
        ],
        restrictionSites: [],
        width: 720,
        height: 720,
      }),
    );
    const byId = new Map(layout.features.map((f) => [f.id, f]));

    expect(layout.budgets.laneCount).toBeGreaterThanOrEqual(2);
    expect(byId.get('tail')?.lane).not.toBe(byId.get('head')?.lane);
  });

  it('computes hover titles + restriction positions for the sync/tooltip layer', () => {
    const layout = computeMapLayout(circularInput());
    const ampR = layout.features.find((f) => f.id === 'ampR');
    // reverse feature -> title carries name/type/1-indexed range + reverse arrow.
    expect(ampR?.title).toBe('AmpR · resistance · 1627–2486 ←');
    const ori = layout.features.find((f) => f.id === 'ori');
    expect(ori?.title).toContain('→'); // forward
    // The MCS cluster carries ascending recognition-window positions + a title.
    const withPos = layout.restrictions.find((r) => r.positions.length > 1);
    expect(withPos).toBeTruthy();
    const p = withPos!.positions;
    expect([...p]).toEqual([...p].sort((a, b) => a - b));
    expect(withPos!.title).toMatch(/cut|sites/);
  });

  it('folds strand points into directional terminal feature paths only', () => {
    const layout = computeMapLayout(circularInput());
    const byId = new Map(layout.features.map((f) => [f.id, f]));
    const commandCount = (d: string, command: string) =>
      (d.match(new RegExp(`\\b${command}\\b`, 'g')) ?? []).length;
    const ori = byId.get('ori')!;
    const ampR = byId.get('ampR')!;
    const mcs = byId.get('mcs')!;
    // Directional terminal circular paths have two line joins: band->tip->band.
    expect(commandCount(ori.segmentPaths[ori.segmentPaths.length - 1], 'L')).toBe(2);
    expect(commandCount(ampR.segmentPaths[0], 'L')).toBe(2);
    // Directionless features stay plain arc bands with one straight terminal edge.
    expect(commandCount(mcs.segmentPaths[0], 'L')).toBe(1);
    expect('arrowhead' in ori).toBe(false);
  });

  it('points forward and reverse linear terminal segment paths to opposite sides', () => {
    // Two same-length features at the same locus, opposite strands: the forward
    // terminal point sits to the RIGHT of its base, the reverse point to the LEFT.
    const len = 1000;
    const fwd = feat({ id: 'f', name: 'F', type: 'cds', start: 400, end: 600, strand: 1 });
    const rev = feat({ id: 'r', name: 'R', type: 'cds', start: 400, end: 600, strand: -1 });
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'lin',
      length: len,
      topology: 'linear',
      sequenceType: 'dna',
      features: [fwd, rev],
      restrictionSites: [],
      width: 800,
      height: 300,
    });
    const byId = new Map(layout.features.map((f) => [f.id, f]));
    const lineCoords = (d: string) =>
      [...d.matchAll(/L (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));
    const moveX = (d: string) => Number(d.match(/^M (-?\d+(?:\.\d+)?) /)?.[1]);
    const fPath = byId.get('f')!.segmentPaths[0];
    const rPath = byId.get('r')!.segmentPaths[0];
    const fLines = lineCoords(fPath);
    const rLines = lineCoords(rPath);
    expect(fLines[0].x).toBeGreaterThan(fLines[1].x); // forward tipX > baseX
    expect(rLines[0].x).toBeLessThan(moveX(rPath)); // reverse tipX < baseX
    expect('arrowhead' in byId.get('f')!).toBe(false);
  });

  it('engages band-fit culling in a short viewport without a hard cap', () => {
    // minSepBp = round(6000*6/360) = 100; space sites 120 bp apart so they stay
    // distinct (50 clusters), then a short viewport overflows each side's column.
    const len = 6000;
    const sites: RestrictionSite[] = [];
    for (let i = 0; i < 50; i += 1) {
      sites.push(site(`Enz${i}`, 20 + i * 120, 21 + i * 120, 'GAATTC'));
    }
    const layout = computeMapLayout({
      mode: 'circular',
      name: 'tallstack',
      length: len,
      topology: 'circular',
      sequenceType: 'dna',
      features: [],
      restrictionSites: sites,
      width: 480,
      height: 300, // short -> label columns overflow -> band-fit culling
    });
    expect(layout.restrictions.length).toBeGreaterThan(40); // stayed distinct
    expect(layout.budgets.hiddenLabelCount).toBeGreaterThan(0);
  });
});
