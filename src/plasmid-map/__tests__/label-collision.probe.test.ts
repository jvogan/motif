/**
 * Regression coverage for VISIBLE-label overlaps in the computed MapLayout
 * across dense scenarios. The invariant is that no two visible labels overlap.
 * It operates on the PUBLIC MapLayout contract
 * (features[].label / restrictions[].label / coordinates[].label), so it survives
 * internal label-placement changes.
 */
import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import type { MapInput, MapLabelRender, MapLayout } from '../types';
import type { Feature, RestrictionSite } from '../../bio/types';
import { approxTextWidth, LABEL_LINE_HEIGHT_PX } from '../geometry/labels';
import type { LabelFontMode } from '../geometry/labels';

function feat(p: Partial<Feature> & { id: string }): Feature {
  return {
    id: p.id, name: p.name ?? '', type: p.type ?? 'misc_feature',
    start: p.start ?? 0, end: p.end ?? 0, strand: p.strand ?? 1,
    subRanges: p.subRanges, color: p.color ?? '#8a8a8a', metadata: {},
  } as Feature;
}
function site(enzyme: string, position: number, cutPosition: number, rec: string, strand?: 1 | -1): RestrictionSite {
  return { enzyme, position, cutPosition, recognitionSequence: rec, overhang: 'blunt', ...(strand ? { strand } : {}) };
}

interface Box { x0: number; y0: number; x1: number; y1: number; }
function labelVerticalOffsets(baseline: MapLabelRender['baseline'] | undefined): { ay0: number; ay1: number } {
  if (baseline === 'middle') return { ay0: -LABEL_LINE_HEIGHT_PX / 2, ay1: LABEL_LINE_HEIGHT_PX / 2 };
  if (baseline === 'hanging') return { ay0: 0, ay1: LABEL_LINE_HEIGHT_PX };
  if (baseline === 'auto') return { ay0: -LABEL_LINE_HEIGHT_PX, ay1: 0 };
  return { ay0: -LABEL_LINE_HEIGHT_PX * 0.8, ay1: LABEL_LINE_HEIGHT_PX * 0.3 };
}
/** AABB of a rendered label's glyph box, replicating layout.ts growByLabel (rotation-aware). */
function labelBox(l: MapLabelRender, fontMode: LabelFontMode = 'proportional'): Box {
  const w = approxTextWidth(l.text, undefined, fontMode);
  const ax0 = l.anchor === 'start' ? 0 : l.anchor === 'end' ? -w : -w / 2;
  const ax1 = l.anchor === 'start' ? w : l.anchor === 'end' ? 0 : w / 2;
  const { ay0, ay1 } = labelVerticalOffsets(l.baseline);
  const rot = l.rotate ?? 0;
  if (rot === 0) return { x0: l.x + ax0, y0: l.y + ay0, x1: l.x + ax1, y1: l.y + ay1 };
  const rad = (rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const xs: number[] = [], ys: number[] = [];
  for (const [dx, dy] of [[ax0, ay0], [ax1, ay0], [ax1, ay1], [ax0, ay1]] as const) {
    xs.push(l.x + dx * cos - dy * sin);
    ys.push(l.y + dx * sin + dy * cos);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
/** Overlap area of two AABBs (0 if disjoint). A tiny tolerance avoids counting labels that merely touch. */
function overlapArea(a: Box, b: Box, tol = 1.5): number {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) - tol;
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) - tol;
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

interface Tagged { fam: string; key: string; box: Box; text: string; label: MapLabelRender; }
function visibleLabels(layout: MapLayout, fontMode: LabelFontMode = 'proportional'): Tagged[] {
  const out: Tagged[] = [];
  for (const f of layout.features) if (f.label) out.push({ fam: 'feat', key: f.id, box: labelBox(f.label, fontMode), text: f.label.text, label: f.label });
  for (const r of layout.restrictions) if (r.label) out.push({ fam: 'rest', key: r.clusterId, box: labelBox(r.label, fontMode), text: r.label.text, label: r.label });
  for (const c of layout.coordinates) if (c.label) {
    const label = { ...c.label, leader: [], inside: true } as MapLabelRender;
    out.push({ fam: 'coord', key: `c${c.bp}`, box: labelBox(label, fontMode), text: c.label.text, label });
  }
  return out;
}
function findOverlaps(layout: MapLayout, fontMode: LabelFontMode = 'proportional') {
  const labels = visibleLabels(layout, fontMode);
  const pairs: { a: Tagged; b: Tagged; area: number }[] = [];
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const area = overlapArea(labels[i].box, labels[j].box);
      if (area > 0) pairs.push({ a: labels[i], b: labels[j], area });
    }
  return { total: labels.length, pairs };
}

function denseFeatures(n: number, len: number): Feature[] {
  const kinds = ['cds', 'promoter', 'rbs', 'terminator', 'origin', 'resistance', 'gene', 'misc_feature'];
  const out: Feature[] = [];
  const step = Math.floor(len / n);
  for (let i = 0; i < n; i++) {
    const s = i * step + 5;
    out.push(feat({ id: `f${i}`, name: `${kinds[i % kinds.length]}-${i + 1}`, type: kinds[i % kinds.length] as Feature['type'], start: s, end: s + Math.floor(step * 0.6), strand: (i % 3 === 0 ? -1 : i % 3 === 1 ? 1 : 0) as Feature['strand'] }));
  }
  return out;
}
function denseSites(n: number, len: number): RestrictionSite[] {
  const enz = ['EcoRI', 'BamHI', 'HindIII', 'AluI', 'HaeIII', 'TaqI', 'BsaI', 'BbsI', 'HpaII', 'MspI', 'ScaI', 'NcoI'];
  const out: RestrictionSite[] = [];
  const step = Math.floor(len / n);
  for (let i = 0; i < n; i++) out.push(site(enz[i % enz.length], i * step + 11, i * step + 12, 'GAATTC', i % 5 === 0 ? -1 : 1));
  return out;
}
function poleFeatures(len: number): Feature[] {
  return [
    feat({ id: 'pole-12', name: 'pole-12', start: 0, end: 12 }),
    feat({ id: 'pole-3', name: 'pole-3', start: Math.floor(len / 4), end: Math.floor(len / 4) + 12 }),
    feat({ id: 'pole-6', name: 'pole-6', start: Math.floor(len / 2), end: Math.floor(len / 2) + 12 }),
    feat({ id: 'pole-9', name: 'pole-9', start: Math.floor((len * 3) / 4), end: Math.floor((len * 3) / 4) + 12 }),
  ];
}

function overlapStrings(pairs: ReturnType<typeof findOverlaps>['pairs']): string[] {
  return pairs.map(
    (p) =>
      `${p.a.fam}/${p.b.fam}:${p.a.key}:${p.a.text} × ${p.b.key}:${p.b.text} area=${Math.round(p.area)}`,
  );
}

interface Segment { key: string; a: { x: number; y: number }; b: { x: number; y: number }; }

function pointEq(a: Segment['a'], b: Segment['a']): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function orient(a: Segment['a'], b: Segment['a'], c: Segment['a']): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Segment['a'], b: Segment['a'], p: Segment['a']): boolean {
  return (
    Math.min(a.x, b.x) - 1e-6 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-6 &&
    Math.min(a.y, b.y) - 1e-6 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-6 &&
    Math.abs(orient(a, b, p)) < 1e-6
  );
}

function segmentsIntersect(a: Segment['a'], b: Segment['a'], c: Segment['a'], d: Segment['a']): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (Math.abs(o1) < 1e-6 && onSegment(a, b, c)) return true;
  if (Math.abs(o2) < 1e-6 && onSegment(a, b, d)) return true;
  if (Math.abs(o3) < 1e-6 && onSegment(c, d, a)) return true;
  if (Math.abs(o4) < 1e-6 && onSegment(c, d, b)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function segmentIntersectsBox(seg: Segment, box: Box): boolean {
  const inside = (p: Segment['a']) => p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1;
  if (inside(seg.a) || inside(seg.b)) return true;
  const corners = [
    { x: box.x0, y: box.y0 },
    { x: box.x1, y: box.y0 },
    { x: box.x1, y: box.y1 },
    { x: box.x0, y: box.y1 },
  ];
  for (let i = 0; i < corners.length; i += 1) {
    if (segmentsIntersect(seg.a, seg.b, corners[i], corners[(i + 1) % corners.length])) return true;
  }
  return false;
}

function leaderSegments(labels: readonly Tagged[]): Segment[] {
  const out: Segment[] = [];
  for (const item of labels) {
    const leader = item.label.leader ?? [];
    for (let i = 1; i < leader.length; i += 1) {
      out.push({ key: `${item.fam}:${item.key}`, a: leader[i - 1], b: leader[i] });
    }
  }
  return out;
}

function centerTitleBoxes(layout: MapLayout, fontMode: LabelFontMode): Tagged[] {
  if (!layout.centerTitle) return [];
  const labels: Tagged[] = layout.centerTitle.lines.map((line, i) => {
    const label: MapLabelRender = {
      text: line.text,
      x: layout.center.x,
      y: line.baselineY,
      anchor: 'middle',
      rotate: 0,
      leader: [],
      inside: true,
    };
    return { fam: 'center', key: `title-${i}`, box: labelBox(label, fontMode), text: line.text, label };
  });
  const lenLabel: MapLabelRender = {
    text: `${layout.length} bp`,
    x: layout.center.x,
    y: layout.centerTitle.lenBaselineY,
    anchor: 'middle',
    rotate: 0,
    leader: [],
    inside: true,
  };
  labels.push({ fam: 'center', key: 'length', box: labelBox(lenLabel, fontMode), text: lenLabel.text, label: lenLabel });
  return labels;
}

function outsideBackbone(box: Box, layout: MapLayout): boolean {
  const pad = 2;
  const closestX = Math.max(box.x0, Math.min(layout.center.x, box.x1));
  const closestY = Math.max(box.y0, Math.min(layout.center.y, box.y1));
  return Math.hypot(closestX - layout.center.x, closestY - layout.center.y) >= layout.radius + pad;
}

function pointDistanceToRadialLine(layout: MapLayout, anchor: Segment['a'], point: Segment['a']): number {
  const radial = { x: anchor.x - layout.center.x, y: anchor.y - layout.center.y };
  const v = { x: point.x - anchor.x, y: point.y - anchor.y };
  const radialLen = Math.hypot(radial.x, radial.y);
  if (radialLen === 0) return 0;
  return Math.abs(radial.x * v.y - radial.y * v.x) / radialLen;
}

function extendedCollisionIssues(layout: MapLayout, fontMode: LabelFontMode = 'proportional'): string[] {
  const issues: string[] = [];
  const labels = visibleLabels(layout, fontMode);
  const leaders = leaderSegments(labels);
  const centerBoxes = centerTitleBoxes(layout, fontMode);

  for (let i = 0; i < leaders.length; i += 1) {
    for (let j = i + 1; j < leaders.length; j += 1) {
      if (leaders[i].key === leaders[j].key) continue;
      if (
        pointEq(leaders[i].a, leaders[j].a) ||
        pointEq(leaders[i].a, leaders[j].b) ||
        pointEq(leaders[i].b, leaders[j].a) ||
        pointEq(leaders[i].b, leaders[j].b)
      ) {
        continue;
      }
      if (segmentsIntersect(leaders[i].a, leaders[i].b, leaders[j].a, leaders[j].b)) {
        issues.push(`leader-cross:${leaders[i].key}×${leaders[j].key}`);
      }
    }
  }

  for (const leader of leaders) {
    for (const label of labels) {
      if (`${label.fam}:${label.key}` === leader.key) continue;
      if (segmentIntersectsBox(leader, label.box)) {
        issues.push(`leader-through-label:${leader.key}→${label.fam}:${label.key}`);
      }
    }
  }

  for (const label of labels) {
    if (label.box.y0 < layout.bg.y - 1 || label.box.y1 > layout.bg.y + layout.bg.height + 1) {
      issues.push(`label-clipped-y:${label.fam}:${label.key}`);
    }
    if ((label.fam === 'feat' || label.fam === 'rest') && (!label.label.inside || label.label.leader.length > 0)) {
      if (!outsideBackbone(label.box, layout)) issues.push(`outside-label-on-ring:${label.fam}:${label.key}`);
    }
    if (
      layout.mode === 'circular' &&
      (label.fam === 'feat' || label.fam === 'rest') &&
      !label.label.inside &&
      label.label.leader.length > 1
    ) {
      if (label.label.anchor !== 'middle') issues.push(`outside-label-not-centered:${label.fam}:${label.key}`);
      for (let i = 1; i < label.label.leader.length; i += 1) {
        const segment = {
          key: `${label.fam}:${label.key}`,
          a: label.label.leader[i - 1],
          b: label.label.leader[i],
        };
        if (segmentIntersectsBox(segment, label.box)) {
          issues.push(`leader-enters-own-label:${label.fam}:${label.key}`);
        }
      }
      if (label.label.leader.length > 2 && pointDistanceToRadialLine(layout, label.label.leader[0], label.label.leader[1]) > 0.75) {
        issues.push(`leader-first-segment-not-radial:${label.fam}:${label.key}`);
      }
    }
    for (const center of centerBoxes) {
      if (overlapArea(label.box, center.box, 1) > 0) {
        issues.push(`label-on-center:${label.fam}:${label.key}×${center.key}`);
      }
    }
  }

  const featureNames = new Map(layout.features.map((f) => [f.id, f.name]));
  const featureLabels = labels.filter((l) => l.fam === 'feat');
  const truncated = featureLabels.filter((l) => l.text.endsWith('…'));
  if (truncated.length / Math.max(1, featureLabels.length) > 0.1) {
    issues.push(`truncation-ratio:${truncated.length}/${featureLabels.length}`);
  }
  for (const label of truncated) {
    const full = featureNames.get(label.key) ?? '';
    const kept = label.text.slice(0, -1).trimEnd();
    if (full && kept.length / full.length < 0.4) issues.push(`hard-truncation:${label.key}:${label.text}`);
    const ambiguous = [...featureNames.entries()].some(
      ([id, name]) => id !== label.key && name !== full && name.startsWith(kept),
    );
    if (ambiguous) issues.push(`ambiguous-truncation:${label.key}:${label.text}`);
  }

  return issues;
}

const base = (over: Partial<MapInput>): MapInput => ({
  mode: 'circular', name: 'probe', length: 6000, topology: 'circular', sequenceType: 'dna',
  features: [], restrictionSites: [], width: 720, height: 720, ...over,
});

describe('label collision regression coverage', () => {
  const scenarios: { name: string; input: MapInput }[] = [
    { name: 'circular 40feat/20site @720', input: base({ mode: 'circular', topology: 'circular', features: denseFeatures(40, 6000), restrictionSites: denseSites(20, 6000) }) },
    { name: 'circular 22feat/12site @720', input: base({ mode: 'circular', topology: 'circular', length: 9276, features: denseFeatures(22, 9276), restrictionSites: denseSites(12, 9276) }) },
    { name: 'circular 40feat/20site @320(dock)', input: base({ mode: 'circular', topology: 'circular', width: 320, height: 320, features: denseFeatures(40, 6000), restrictionSites: denseSites(20, 6000) }) },
    { name: 'linear 24feat/28site @1000', input: base({ mode: 'linear', topology: 'linear', length: 9276, width: 1000, height: 420, features: denseFeatures(24, 9276), restrictionSites: denseSites(28, 9276) }) },
    { name: 'linear 40feat/20site @1000', input: base({ mode: 'linear', topology: 'linear', width: 1000, height: 420, features: denseFeatures(40, 6000), restrictionSites: denseSites(20, 6000) }) },
  ];

  for (const s of scenarios) {
    it(`reports overlaps: ${s.name}`, () => {
      const layout = computeMapLayout(s.input);
      const { total, pairs } = findOverlaps(layout);
      const byFam = pairs.reduce<Record<string, number>>((m, p) => {
        const k = [p.a.fam, p.b.fam].sort().join('×');
        m[k] = (m[k] ?? 0) + 1; return m;
      }, {});
      console.log(`\n[${s.name}] visibleLabels=${total} laneCount=${layout.budgets.laneCount} hiddenLabels=${layout.budgets.hiddenLabelCount} OVERLAP_PAIRS=${pairs.length} ${JSON.stringify(byFam)}`);
      for (const p of pairs.slice(0, 6)) {
        console.log(`   overlap[${p.a.fam}/${p.b.fam}] "${p.a.text}" ⨯ "${p.b.text}" area≈${Math.round(p.area)}`);
      }
      expect(overlapStrings(pairs)).toEqual([]);
    });
  }

  const denseCircularScenarios: { name: string; input: MapInput; fontMode?: LabelFontMode }[] = [
    {
      name: 'circular 50feat adaptive outside fan @720',
      input: base({ features: denseFeatures(50, 6000), restrictionSites: denseSites(24, 6000) }),
    },
    {
      name: 'circular 80feat adaptive outside fan @720',
      input: base({ features: denseFeatures(80, 6000), restrictionSites: denseSites(24, 6000) }),
    },
    {
      name: 'circular 120feat adaptive outside fan HC @720',
      input: base({
        features: denseFeatures(120, 6000),
        restrictionSites: denseSites(24, 6000),
        display: { labelFontMode: 'monospace' },
      }),
      fontMode: 'monospace',
    },
  ];

  for (const s of denseCircularScenarios) {
    it(`passes extended dense circular gate: ${s.name}`, () => {
      const layout = computeMapLayout(s.input);
      const fontMode = s.fontMode ?? 'proportional';
      const { pairs } = findOverlaps(layout, fontMode);
      const marker = layout.overflows?.find((overflow) => overflow.kind === 'feature-labels');
      const visibleFeatureLabels = layout.features.filter((f) => f.label).length;

      expect(layout.radius).toBeGreaterThan(computeMapLayout(base({ features: denseFeatures(24, 6000) })).radius);
      expect(layout.bg.height).toBeGreaterThan(s.input.height);
      expect(visibleFeatureLabels).toBeLessThanOrEqual(36);
      expect(marker?.text).toMatch(/^\+\d+ more$/);
      expect(overlapStrings(pairs)).toEqual([]);
      expect(extendedCollisionIssues(layout, fontMode)).toEqual([]);
    });
  }

  it('labels sparse circular pole features without overlaps', () => {
    const len = 6000;
    const features = poleFeatures(len);
    const layout = computeMapLayout(base({ length: len, features, restrictionSites: [] }));
    const { total, pairs } = findOverlaps(layout);

    console.log(`\n[circular sparse poles @720] visibleLabels=${total} laneCount=${layout.budgets.laneCount} hiddenLabels=${layout.budgets.hiddenLabelCount} OVERLAP_PAIRS=${pairs.length} {}`);
    expect(layout.features.map((f) => [f.id, Boolean(f.label)])).toEqual(
      features.map((f) => [f.id, true]),
    );
    expect(overlapStrings(pairs)).toEqual([]);
  });

  it('labels a lone circular feature at 12:00 on an empty ring', () => {
    const layout = computeMapLayout(
      base({
        length: 4000,
        features: [feat({ id: 'lone-12', name: 'lone origin feature', start: 0, end: 12 })],
        restrictionSites: [],
      }),
    );
    const { total, pairs } = findOverlaps(layout);

    console.log(`\n[circular lone 12:00 @720] visibleLabels=${total} laneCount=${layout.budgets.laneCount} hiddenLabels=${layout.budgets.hiddenLabelCount} OVERLAP_PAIRS=${pairs.length} {}`);
    expect(layout.features[0].label).not.toBeNull();
    expect(overlapStrings(pairs)).toEqual([]);
  });
});
