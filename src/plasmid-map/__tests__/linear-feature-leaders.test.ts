import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import type { MapInput, MapLabelRender, MapLayout, Pt } from '../types';
import type { Feature } from '../../bio/types';
import { approxTextWidth, LABEL_LINE_HEIGHT_PX } from '../geometry/labels';

function feat(p: Partial<Feature> & { id: string; name: string; start: number; end: number }): Feature {
  return {
    id: p.id,
    name: p.name,
    type: p.type ?? 'misc_feature',
    start: p.start,
    end: p.end,
    strand: p.strand ?? 1,
    color: p.color ?? '#8a8a8a',
    metadata: {},
  };
}

function denseLinearInput(over: Partial<MapInput> = {}): MapInput {
  const starts = [80, 420, 760, 1110, 1480, 1850, 2230, 2630, 3060, 3500, 3950, 4420, 4910, 5410];
  const names = [
    'Chromophore',
    'Start Codon',
    'His Tag',
    'Linker Arm',
    'Catalytic Loop',
    'Signal Peptide',
    'Binding Patch',
    'Spacer Motif',
    'Helix Clamp',
    'Loop Insert',
    'Reverse Tag',
    'Tail Motif',
    'Stop Region',
    'Primer Handle',
  ];
  return {
    mode: 'linear',
    name: 'dense linear feature leaders',
    length: 6000,
    topology: 'linear',
    sequenceType: 'dna',
    width: 626,
    height: 340,
    features: starts.map((start, i) =>
      feat({
        id: `feature-${i}`,
        name: names[i],
        type: i % 4 === 0 ? 'cds' : i % 4 === 1 ? 'misc_feature' : i % 4 === 2 ? 'primer_bind' : 'gene',
        start,
        end: start + 54,
        strand: i >= 10 ? -1 : 1,
      }),
    ),
    restrictionSites: [],
    ...over,
  };
}

function tinyFeatureInput(features: Feature[], over: Partial<MapInput> = {}): MapInput {
  return {
    mode: 'linear',
    name: 'tiny feature leaders',
    length: 1000,
    topology: 'linear',
    sequenceType: 'dna',
    width: 500,
    height: 220,
    features,
    restrictionSites: [],
    ...over,
  };
}

interface FeatureLeader {
  id: string;
  row: number;
  startX: number;
  labelX: number;
  label: MapLabelRender;
  leader: readonly Pt[];
}

function featureLeaders(layout: MapLayout): FeatureLeader[] {
  const out: FeatureLeader[] = [];
  for (const f of layout.features) {
    if (!f.label || f.label.inside || f.label.leader.length < 2) continue;
    out.push({
      id: f.id,
      row: f.label.y,
      startX: f.label.leader[0].x,
      labelX: f.label.x,
      label: f.label,
      leader: f.label.leader,
    });
  }
  return out;
}

function outsideFeatureLabels(layout: MapLayout): MapLabelRender[] {
  return layout.features
    .map((f) => f.label)
    .filter((label): label is MapLabelRender => Boolean(label && !label.inside));
}

function orientation(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -1e-6 && cdA * cdB < -1e-6;
}

function polylinesCross(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      if (segmentsCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
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

function labelBox(l: MapLabelRender): Box {
  const w = approxTextWidth(l.text);
  const ax0 = l.anchor === 'start' ? 0 : l.anchor === 'end' ? -w : -w / 2;
  const ax1 = l.anchor === 'start' ? w : l.anchor === 'end' ? 0 : w / 2;
  const { ay0, ay1 } = labelVerticalOffsets(l.baseline);
  return {
    x0: l.x + ax0,
    y0: l.y + ay0,
    x1: l.x + ax1,
    y1: l.y + ay1,
  };
}

function overlaps(a: Box, b: Box, tol = 1.5): boolean {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) - tol;
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) - tol;
  return ox > 0 && oy > 0;
}

/**
 * Horizontal extent of a feature glyph parsed from its rendered SVG segment paths.
 * Only x-bearing command coords are read (M/L "x y" -> x, H "x", A "...x y" -> x) so
 * y-coords and arc radii never pollute the range. This captures the directional
 * arrowhead TIP, which the feature's body bp-extent (source.start/end) does not.
 */
function glyphXRange(paths: readonly string[]): { minX: number; maxX: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  const see = (v: number): void => {
    if (Number.isFinite(v)) {
      minX = Math.min(minX, v);
      maxX = Math.max(maxX, v);
    }
  };
  for (const path of paths) {
    for (const cmd of path.match(/[MLHVA][^MLHVAZ]*/g) ?? []) {
      const nums = (cmd.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const type = cmd[0];
      if (type === 'M' || type === 'L' || type === 'H') see(nums[0]);
      else if (type === 'A') see(nums[5]); // rx ry rot large sweep x y -> x
      // V is "y" only -> no x contribution
    }
  }
  return { minX, maxX };
}

describe('linear feature leaders', () => {
  it('does not draw a stub leader when a tiny feature label lands adjacent to its glyph', () => {
    const layout = computeMapLayout(
      tinyFeatureInput([feat({ id: 'chromophore', name: 'Chromophore', start: 100, end: 104 })]),
    );
    const label = layout.features.find((f) => f.id === 'chromophore')?.label;

    expect(label).not.toBeNull();
    expect(label!.inside).toBe(false);
    expect(label!.leader).toHaveLength(0);
  });

  it('does not draw decorative stubs for dense labels that remain adjacent to glyphs', () => {
    const layout = computeMapLayout(denseLinearInput());

    expect(outsideFeatureLabels(layout).length).toBeGreaterThanOrEqual(10);
    expect(featureLeaders(layout)).toHaveLength(0);
  });

  it('emits only vertical feature leaders when a label is truly displaced', () => {
    const layout = computeMapLayout(denseLinearInput());
    const leaders = featureLeaders(layout);
    expect(outsideFeatureLabels(layout).length).toBeGreaterThanOrEqual(10);

    for (let i = 0; i < leaders.length; i += 1) {
      expect(leaders[i].leader).toHaveLength(2);
      expect(leaders[i].leader[0].x).toBe(leaders[i].leader[1].x);
      expect(leaders[i].leader[0].x).toBe(leaders[i].labelX);
      for (let j = i + 1; j < leaders.length; j += 1) {
        expect(polylinesCross(leaders[i].leader, leaders[j].leader)).toBe(false);
      }
    }
  });

  it('does not overlap visible feature labels in the same linear row', () => {
    const layout = computeMapLayout(denseLinearInput());
    const byRow = new Map<number, MapLabelRender[]>();
    for (const label of outsideFeatureLabels(layout)) {
      const row = byRow.get(label.y) ?? [];
      row.push(label);
      byRow.set(label.y, row);
    }

    for (const row of byRow.values()) {
      for (let i = 0; i < row.length; i += 1) {
        const a = labelBox(row[i]);
        for (let j = i + 1; j < row.length; j += 1) {
          expect(overlaps(a, labelBox(row[j]))).toBe(false);
        }
      }
    }
  });

  it('keeps outside feature labels clear of their own glyph edge (arrowhead tip included)', () => {
    const layout = computeMapLayout(denseLinearInput());

    for (const feature of layout.features) {
      const label = feature.label;
      if (!label || label.inside) continue;
      const textBox = labelBox(label);
      // The glyph's TRUE horizontal extent is its rendered segment paths, which
      // include the directional arrowhead tip (it juts ~rowHeight/2 past the body).
      // Measuring against source.start/end (body only) missed the tip — the exact
      // bug: a 4px body-edge gap still overlapped the arrow by ~3px. Require the
      // label to clear the real glyph edge on its side.
      const { minX, maxX } = glyphXRange(feature.segmentPaths);
      if (label.anchor === 'start') {
        // label sits to the RIGHT: its left edge must clear the glyph's right edge.
        expect(textBox.x0 - maxX).toBeGreaterThanOrEqual(4 - 0.5);
      } else {
        // label sits to the LEFT: its right edge must clear the glyph's left edge.
        expect(minX - textBox.x1).toBeGreaterThanOrEqual(4 - 0.5);
      }
    }
  });
});
