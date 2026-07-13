import { describe, expect, it } from 'vitest';
import { pointOnCircle } from '../coordinates';
import {
  layoutRadialTierLabels,
  type RadialLabelBaseline,
  type RadialTextAnchor,
  type RadialTierLabelCandidate,
  type RadialTierLabelOptions,
  type RadialTierLabelPlacement,
} from '../radial-labels';
import type { BBox, Pt } from '../../types';

const EPS = 1e-6;

function baseOpts(overrides: Partial<RadialTierLabelOptions> = {}): RadialTierLabelOptions {
  return {
    cx: 100,
    cy: 100,
    baseRadius: 80,
    radiusStep: 16,
    angularThresholdDeg: 8,
    maxTier: 8,
    maxPushes: 8,
    obstacles: [],
    ...overrides,
  };
}

function candidate(
  id: string,
  angleDeg: number,
  opts: RadialTierLabelOptions,
  overrides: Partial<RadialTierLabelCandidate> = {},
): RadialTierLabelCandidate {
  return {
    id,
    angleDeg,
    anchor: pointOnCircle(opts.cx, opts.cy, opts.baseRadius, angleDeg),
    text: id,
    width: 20,
    height: 10,
    ...overrides,
  };
}

function boxFor(
  pos: Pt,
  textAnchor: RadialTextAnchor,
  baseline: RadialLabelBaseline,
  width: number,
  height: number,
): BBox {
  const minX = textAnchor === 'start' ? pos.x : textAnchor === 'end' ? pos.x - width : pos.x - width / 2;
  const maxX = textAnchor === 'start' ? pos.x + width : textAnchor === 'end' ? pos.x : pos.x + width / 2;
  const minY = baseline === 'hanging' ? pos.y : baseline === 'auto' ? pos.y - height : pos.y - height / 2;
  const maxY = baseline === 'hanging' ? pos.y + height : baseline === 'auto' ? pos.y : pos.y + height / 2;
  return { minX, minY, maxX, maxY };
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function segmentIntersectsBBox(a: Pt, b: Pt, box: BBox): boolean {
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
    clip(-dx, a.x - box.minX) &&
    clip(dx, box.maxX - a.x) &&
    clip(-dy, a.y - box.minY) &&
    clip(dy, box.maxY - a.y) &&
    t1 > t0 + EPS
  );
}

function polylineIntersectsBBox(polyline: readonly Pt[], box: BBox): boolean {
  for (let i = 1; i < polyline.length; i += 1) {
    if (segmentIntersectsBBox(polyline[i - 1], polyline[i], box)) return true;
  }
  return false;
}

function placedBox(
  placement: RadialTierLabelPlacement,
  candidates: readonly RadialTierLabelCandidate[],
): BBox {
  const source = candidates.find((item) => item.id === placement.id);
  if (source == null) throw new Error(`Missing dimensions for ${placement.id}`);
  return boxFor(placement.pos, placement.textAnchor, placement.baseline, source.width, source.height);
}

function assertNoOutputBoxesOverlap(
  placements: readonly RadialTierLabelPlacement[],
  candidates: readonly RadialTierLabelCandidate[],
): void {
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      expect(
        bboxIntersects(placedBox(placements[i], candidates), placedBox(placements[j], candidates)),
        `${placements[i].id} overlaps ${placements[j].id}`,
      ).toBe(false);
    }
  }
}

function assertNoLeaderCrossesObstacle(
  placements: readonly RadialTierLabelPlacement[],
  obstacles: readonly BBox[],
): void {
  for (const placement of placements) {
    for (const obstacle of obstacles) {
      expect(
        polylineIntersectsBBox(placement.leader, obstacle),
        `${placement.id} leader crosses obstacle`,
      ).toBe(false);
    }
  }
}

function angularDistanceDeg(a: number, b: number): number {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
}

describe('layoutRadialTierLabels', () => {
  it('centers a side label on its leader and clears the ring-side anchor', () => {
    const opts = baseOpts({ baseRadius: 100 });
    const c = candidate('EcoRI', 90, opts, { width: 24, height: 10 });

    const placed = layoutRadialTierLabels([c], opts);

    expect(placed).toHaveLength(1);
    expect(placed[0].id).toBe('EcoRI');
    expect(placed[0].pos.x - c.width / 2).toBeGreaterThan(c.anchor.x);
    expect(placed[0].pos.y).toBeCloseTo(c.anchor.y, 6);
    expect(placed[0].tier).toBe(0);
    expect(placed[0].textAnchor).toBe('middle');
    expect(placed[0].baseline).toBe('middle');
    expect(placed[0].leader.at(-1)).toEqual(placed[0].pos);
  });

  it('places a pole label at its anchor with no leader', () => {
    const opts = baseOpts({ baseRadius: 100 });
    const c = candidate('top', 0, opts, { width: 24, height: 10 });

    const placed = layoutRadialTierLabels([c], opts);

    expect(placed).toHaveLength(1);
    expect(placed[0].pos.x).toBeCloseTo(c.anchor.x, 6);
    expect(placed[0].pos.y).toBeCloseTo(c.anchor.y, 6);
    expect(placed[0].leader).toEqual([]);
    expect(placed[0].textAnchor).toBe('middle');
    expect(placed[0].baseline).toBe('auto');
  });

  it('keeps a strongly shifted label direct when the chord is unobstructed', () => {
    const opts = baseOpts({ baseRadius: 130, radiusStep: 20 });
    const c = candidate('BglII', 104, opts, {
      anchor: pointOnCircle(opts.cx, opts.cy, 100, 90),
      width: 12,
      height: 8,
    });

    const placed = layoutRadialTierLabels([c], opts);
    const leader = placed[0].leader;

    expect(leader).toHaveLength(2);
    expect(leader[0]).toEqual(c.anchor);
    expect(leader.at(-1)).toEqual(placed[0].pos);
    expect(placed[0].textAnchor).toBe('middle');
  });

  it('uses the radial elbow only when it clears an obstacle crossed by the direct chord', () => {
    const obstacle: BBox = { minX: 207, minY: 107, maxX: 212, maxY: 114 };
    const opts = baseOpts({
      baseRadius: 130,
      radiusStep: 20,
      leaderObstacles: [obstacle],
    });
    const c = candidate('BglII', 104, opts, {
      anchor: pointOnCircle(opts.cx, opts.cy, 100, 90),
      width: 12,
      height: 8,
    });

    const placed = layoutRadialTierLabels([c], opts);
    const leader = placed[0].leader;

    expect(leader).toHaveLength(3);
    expect(leader[0]).toEqual(c.anchor);
    expect(leader.at(-1)).toEqual(placed[0].pos);
    expect(leader[1].y).toBeCloseTo(c.anchor.y, 6);
    expect(leader[1].x).toBeGreaterThan(c.anchor.x);
    expect(leader[1].x - c.anchor.x).toBeLessThanOrEqual(16 + EPS);
    expect(polylineIntersectsBBox(leader, obstacle)).toBe(false);
  });

  it('keeps a sparse three-label angular cluster individual and near true angles', () => {
    const opts = baseOpts({
      baseRadius: 120,
      radiusStep: 22,
      angularThresholdDeg: 20,
      maxTier: 4,
      maxPushes: 4,
    });
    const candidates = [45, 60, 75].map((angle, index) =>
      candidate(`label-${index}`, angle, opts, { width: 8, height: 6 }),
    );

    const placed = layoutRadialTierLabels(candidates, opts);

    expect(placed).toHaveLength(3);
    expect(placed.every((item) => item.group == null)).toBe(true);
    for (const source of candidates) {
      const out = placed.find((item) => item.id === source.id);
      expect(out).toBeDefined();
      expect(angularDistanceDeg(out!.angleDeg, source.angleDeg)).toBeLessThan(1e-6);
    }
    assertNoOutputBoxesOverlap(placed, candidates);
  });

  it('places a dense 20-label arc without output bbox overlaps or obstacle-crossing leaders', () => {
    const obstacle: BBox = { minX: 10, minY: 10, maxX: 25, maxY: 25 };
    const opts = baseOpts({
      baseRadius: 140,
      radiusStep: 14,
      angularThresholdDeg: 3,
      maxTier: 80,
      maxPushes: 80,
      obstacles: [obstacle],
    });
    const candidates = Array.from({ length: 20 }, (_, index) =>
      candidate(`dense-${index}`, 80 + index * 1.5, opts, { width: 12, height: 8 }),
    );

    const placed = layoutRadialTierLabels(candidates, opts);

    expect(placed).toHaveLength(20);
    expect(placed.every((item) => item.group == null)).toBe(true);
    assertNoOutputBoxesOverlap(placed, candidates);
    assertNoLeaderCrossesObstacle(placed, opts.obstacles);
    // Every label still lands with no overlaps and clean leaders (asserted above). The
    // packer now prefers spots that keep a readable horizontal gap between same-row
    // neighbors, so a label may be nudged off its true angle by up to the angular-shift
    // budget (default max(DEFAULT_ANGLE_STEP_DEG=1.5, angularThresholdDeg/2)) rather than
    // sitting at the exact tick angle. Previously this asserted zero drift (< 1e-6).
    const maxAngleShiftDeg = Math.max(1.5, opts.angularThresholdDeg / 2);
    for (const source of candidates) {
      const out = placed.find((item) => item.id === source.id);
      expect(out).toBeDefined();
      expect(angularDistanceDeg(out!.angleDeg, source.angleDeg)).toBeLessThanOrEqual(maxAngleShiftDeg + 1e-6);
    }
  });

  it('pushes outward when an obstacle overlaps the base label box', () => {
    const opts = baseOpts({
      baseRadius: 100,
      radiusStep: 20,
      angularThresholdDeg: 4,
      maxTier: 3,
      maxPushes: 3,
    });
    const c = candidate('blocked', 45, opts, { width: 30, height: 10 });
    const obstacle: BBox = {
      minX: c.anchor.x + 19,
      minY: c.anchor.y - 1,
      maxX: c.anchor.x + 27,
      maxY: c.anchor.y + 4,
    };

    const placed = layoutRadialTierLabels([c], { ...opts, obstacles: [obstacle] });

    expect(placed).toHaveLength(1);
    expect(placed[0].tier).toBeGreaterThan(0);
    expect(placed[0].leader.length).toBeGreaterThan(1);
    expect(bboxIntersects(placedBox(placed[0], [c]), obstacle)).toBe(false);
    assertNoLeaderCrossesObstacle(placed, [obstacle]);
    expect(angularDistanceDeg(placed[0].angleDeg, c.angleDeg)).toBeLessThan(1e-6);
  });

  it('uses the largest angular gap as a seam so 0/360 clusters tier together', () => {
    const opts = baseOpts({
      baseRadius: 100,
      radiusStep: 18,
      angularThresholdDeg: 8,
      maxTier: 4,
      maxPushes: 4,
    });
    const candidates = [358, 2, 6].map((angle, index) =>
      candidate(`wrap-${index}`, angle, opts, { width: 8, height: 6 }),
    );

    const placed = layoutRadialTierLabels(candidates, opts);
    const byId = new Map(placed.map((item) => [item.id, item]));

    expect(placed).toHaveLength(3);
    expect(byId.get('wrap-0')?.tier).toBe(0);
    expect(byId.get('wrap-1')?.tier).toBe(1);
    expect(byId.get('wrap-2')?.tier).toBe(2);
    for (const source of candidates) {
      expect(angularDistanceDeg(byId.get(source.id)!.angleDeg, source.angleDeg)).toBeLessThan(1e-6);
    }
  });

  it('collapses trailing dense-cluster members into a bounded group label', () => {
    const opts = baseOpts({
      baseRadius: 100,
      radiusStep: 30,
      angularThresholdDeg: 2,
      maxTier: 2,
      maxPushes: 0,
      defaultLabelHeight: 10,
    });
    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate(`g-${index}`, 90, opts, {
        text: `LABEL_${index.toString().padStart(4, '0')}`,
        width: 60,
        height: 10,
      }),
    );

    const placed = layoutRadialTierLabels(candidates, opts);
    const group = placed.find((item) => item.group != null);

    expect(placed).toHaveLength(2);
    expect(group).toBeDefined();
    expect(group!.group).toEqual({
      members: ['g-1', 'g-2', 'g-3', 'g-4', 'g-5'],
      text: 'LABEL_0001, LABEL_0002 +3',
    });
    expect(group!.tier).toBe(2);
    expect(placed.find((item) => item.id === 'g-0')).toBeDefined();
  });

  it('keeps no-group dense labels individual with direct leaders', () => {
    const opts = baseOpts({
      baseRadius: 100,
      radiusStep: 18,
      angularThresholdDeg: 8,
      maxTier: 8,
      maxPushes: 8,
      allowGrouping: false,
    });
    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate(`ng-${index}`, 90, opts, { width: 14, height: 8 }),
    );

    const placed = layoutRadialTierLabels(candidates, opts);

    expect(placed).toHaveLength(candidates.length);
    expect(placed.every((item) => item.group == null)).toBe(true);
    expect(placed.every((item) => item.leader.length <= 2)).toBe(true);
    assertNoOutputBoxesOverlap(placed, candidates);
  });

  it('never groups candidates with different group keys at the same angle', () => {
    const opts = baseOpts({
      baseRadius: 100,
      radiusStep: 18,
      angularThresholdDeg: 8,
      maxTier: 4,
      maxPushes: 4,
    });
    const candidates = [
      candidate('feature-gene', 90, opts, {
        groupKey: 'feature',
        text: 'gene-7',
        width: 42,
        height: 10,
        priority: 1_000_000,
      }),
      candidate('restriction-cluster', 90, opts, {
        groupKey: 'restriction',
        text: 'BsmBI,Esp3I +13',
        width: 96,
        height: 10,
        priority: 100,
      }),
    ];

    const placed = layoutRadialTierLabels(candidates, opts);

    expect(placed).toHaveLength(2);
    expect(placed.every((item) => item.group == null)).toBe(true);
    expect(placed.map((item) => item.id).sort()).toEqual(['feature-gene', 'restriction-cluster']);
  });
});
