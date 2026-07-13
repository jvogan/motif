/**
 * W (map-benchling-polish, linear leaders): the LINEAR restriction-label band must
 * read like Benchling — labels sit close to their ticks so leaders stay SHORT,
 * NEAR-VERTICAL and NON-CROSSING. The old fixed-72px slot de-collision cascaded
 * left-clustered labels far to the right on long shallow (near-horizontal) leaders
 * that fanned across the map — the user-flagged tangle. These tests pin the new
 * width-aware minimum-displacement placement (placeRestrictionRow) and the whole-
 * layout leader geometry so the tangle can't regress.
 */
import { describe, it, expect } from 'vitest';
import { computeMapLayout, placeRestrictionRow } from '../layout';
import type { MapInput, MapLabelRender, MapLayout, Pt } from '../types';
import type { RestrictionSite } from '../../bio/types';
import { approxTextWidth, LABEL_LINE_HEIGHT_PX } from '../geometry/labels';

const READABLE_REC_LABEL_MIN_GAP = 12;
const RESTRICTION_LABEL_TOUCH_GAP = 2;

function site(enzyme: string, position: number): RestrictionSite {
  return { enzyme, position, cutPosition: position + 1, recognitionSequence: 'GAATTC', overhang: 'blunt' };
}

/** Restriction leaders as {tickX, labelX, labelY, leader} tuples (leader[0]=tick, label.x=slot). */
function restrictionLeaders(
  layout: MapLayout,
): { tickX: number; labelX: number; labelY: number; leader: readonly Pt[] }[] {
  const out: { tickX: number; labelX: number; labelY: number; leader: readonly Pt[] }[] = [];
  for (const r of layout.restrictions) {
    if (!r.label || r.label.leader.length < 2) continue;
    out.push({ tickX: r.label.leader[0].x, labelX: r.label.x, labelY: r.label.y, leader: r.label.leader });
  }
  return out;
}

interface LabelBox {
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

function labelBox(label: MapLabelRender): LabelBox {
  const w = approxTextWidth(label.text);
  const ax0 = label.anchor === 'start' ? 0 : label.anchor === 'end' ? -w : -w / 2;
  const ax1 = label.anchor === 'start' ? w : label.anchor === 'end' ? 0 : w / 2;
  const { ay0, ay1 } = labelVerticalOffsets(label.baseline);
  return {
    x0: label.x + ax0,
    y0: label.y + ay0,
    x1: label.x + ax1,
    y1: label.y + ay1,
  };
}

function restrictionLeaderTouch(label: MapLabelRender): Pt {
  return { x: label.x, y: label.y - LABEL_LINE_HEIGHT_PX / 2 - RESTRICTION_LABEL_TOUCH_GAP };
}

function denseAllEnzymesInput(): MapInput {
  return {
    mode: 'linear',
    name: 'dense all enzymes',
    length: 1000,
    topology: 'linear',
    sequenceType: 'dna',
    width: 420,
    height: 220,
    features: [],
    restrictionSites: Array.from({ length: 10 }, (_, i) => site(`Enzyme${String(i).padStart(4, '0')}`, 100 + i * 30)),
  };
}

function segmentIntersectsBox(a: Pt, b: Pt, box: LabelBox): boolean {
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

function polylineIntersectsBox(polyline: readonly Pt[], box: LabelBox): boolean {
  for (let i = 1; i < polyline.length; i += 1) {
    if (segmentIntersectsBox(polyline[i - 1], polyline[i], box)) return true;
  }
  return false;
}

/** Proper segment intersection (real X crossing; endpoint/collinear touches ignored). */
function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const o = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function polylinesCross(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      if (segmentsCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

// Reproduces the eGFP dock case: sites clustered heavily in the first third then
// sparse — the exact distribution that made the old greedy-right pass fan out.
function egfpLikeInput(over: Partial<MapInput> = {}): MapInput {
  const positions = [30, 68, 85, 100, 126, 148, 164, 300, 323, 361, 393, 435, 449, 482, 568, 587];
  const enzymes = ['AluI', 'TaqI', 'HaeIII', 'HpaII', 'AluI', 'HpaII', 'HaeIII', 'TaqI', 'TaqI', 'AluI', 'HaeIII', 'TaqI', 'AluI', 'HaeIII', 'HpaII', 'AluI'];
  return {
    mode: 'linear',
    name: 'eGFP',
    length: 720,
    topology: 'linear',
    sequenceType: 'dna',
    width: 626,
    height: 200,
    features: [],
    restrictionSites: positions.map((p, i) => site(enzymes[i], p)),
    ...over,
  };
}

describe('placeRestrictionRow (width-aware min-displacement)', () => {
  it('keeps left-clustered labels near their ticks instead of cascading right', () => {
    // Four labels whose ticks are packed into the first ~115px. The old fixed-slot
    // pass pushed the 4th label ~112px right of its tick; min-displacement must not.
    const entries = [
      { key: 'a', tickX: 50, halfW: 22 },
      { key: 'b', tickX: 85, halfW: 19 },
      { key: 'c', tickX: 126, halfW: 12 },
      { key: 'd', tickX: 164, halfW: 19 },
    ];
    const placed = placeRestrictionRow(entries, 28, 598, READABLE_REC_LABEL_MIN_GAP);

    const centers = entries.map((e) => placed.get(e.key)!);
    // in tick order (no crossing) …
    for (let i = 1; i < centers.length; i += 1) expect(centers[i]).toBeGreaterThan(centers[i - 1]);
    // … non-overlapping (>= halfW_i + halfW_{i+1} + gap apart) …
    for (let i = 1; i < centers.length; i += 1) {
      expect(centers[i] - centers[i - 1]).toBeGreaterThanOrEqual(
        entries[i].halfW + entries[i - 1].halfW + READABLE_REC_LABEL_MIN_GAP - 1e-6,
      );
    }
    // … and every label stays close to its tick (short, near-vertical leaders).
    for (const e of entries) expect(Math.abs(placed.get(e.key)! - e.tickX)).toBeLessThanOrEqual(40);
  });

  it('leaves a single sparse label exactly on its tick and is deterministic', () => {
    const solo = placeRestrictionRow([{ key: 'x', tickX: 300, halfW: 20 }], 28, 598, 6);
    expect(solo.get('x')).toBe(300);
    const a = placeRestrictionRow([{ key: 'x', tickX: 300, halfW: 20 }], 28, 598, 6);
    expect([...a]).toEqual([...solo]);
  });

  it('keeps labels whole within [loX, hiX] even when pinned to the right edge', () => {
    const entries = [
      { key: 'p', tickX: 560, halfW: 20 },
      { key: 'q', tickX: 590, halfW: 20 },
    ];
    const placed = placeRestrictionRow(entries, 28, 600, READABLE_REC_LABEL_MIN_GAP);
    expect(placed.get('p')!).toBeLessThanOrEqual(
      placed.get('q')! - (20 + 20 + READABLE_REC_LABEL_MIN_GAP) + 1e-6,
    );
    expect(placed.get('q')! + 20).toBeLessThanOrEqual(600 + 1e-6);
    expect(placed.get('p')! - 20).toBeGreaterThanOrEqual(28 - 1e-6);
  });
});

describe('linear restriction leaders (non-crossing, near-vertical)', () => {
  it('draws a connector for same-x labels instead of leaving them floating', () => {
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'single restriction',
      length: 1000,
      topology: 'linear',
      sequenceType: 'dna',
      width: 420,
      height: 220,
      features: [],
      restrictionSites: [site('EcoRI', 500)],
    });
    const restriction = layout.restrictions[0];

    expect(restriction.label).not.toBeNull();
    expect(restriction.label!.leader.length).toBeGreaterThanOrEqual(2);
    expect(restriction.label!.leader[0]).toEqual({ x: restriction.tick.x2, y: restriction.tick.y2 });
    expect(restriction.label!.leader.at(-1)).toEqual(restrictionLeaderTouch(restriction.label!));
  });

  it('keeps every visible restriction label connected to its tick', () => {
    const layout = computeMapLayout(egfpLikeInput());
    const visible = layout.restrictions.filter((r) => r.label);

    expect(visible.length).toBeGreaterThan(10);
    for (const restriction of visible) {
      expect(restriction.label!.leader.length).toBeGreaterThanOrEqual(2);
      expect(restriction.label!.leader[0]).toEqual({ x: restriction.tick.x2, y: restriction.tick.y2 });
      expect(restriction.label!.leader.at(-1)).toEqual(restrictionLeaderTouch(restriction.label!));
    }
  });

  it('keeps dense visible restriction labels separated by the readable row gap', () => {
    const layout = computeMapLayout(denseAllEnzymesInput());
    const byRow = new Map<number, LabelBox[]>();
    for (const r of layout.restrictions) {
      if (!r.label) continue;
      const row = byRow.get(r.label.y) ?? [];
      row.push(labelBox(r.label));
      byRow.set(r.label.y, row);
    }

    expect([...byRow.values()].reduce((sum, row) => sum + row.length, 0)).toBe(10);
    for (const row of byRow.values()) {
      row.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1);
      for (let i = 1; i < row.length; i += 1) {
        expect(row[i].x0 - row[i - 1].x1).toBeGreaterThanOrEqual(READABLE_REC_LABEL_MIN_GAP);
      }
    }
  });

  it("does not route restriction leaders through another restriction label's box", () => {
    const layout = computeMapLayout(denseAllEnzymesInput());
    const labels = layout.restrictions
      .filter((r) => r.label)
      .map((r) => ({ id: r.clusterId, label: r.label!, box: labelBox(r.label!) }));

    for (const r of layout.restrictions) {
      if (!r.label || r.label.leader.length < 2) continue;
      for (const other of labels) {
        if (other.id === r.clusterId) continue;
        expect(polylineIntersectsBox(r.label.leader, other.box)).toBe(false);
      }
    }
  });

  it("stops restriction leaders at their own label edge instead of running into text", () => {
    const layout = computeMapLayout(egfpLikeInput());

    for (const r of layout.restrictions) {
      if (!r.label || r.label.leader.length < 2) continue;
      expect(r.label.leader.at(-1)).toEqual(restrictionLeaderTouch(r.label));
      expect(polylineIntersectsBox(r.label.leader, labelBox(r.label))).toBe(false);
    }
  });

  it('never lets two restriction leaders cross in the dense eGFP band', () => {
    const layout = computeMapLayout(egfpLikeInput());
    const leaders = restrictionLeaders(layout);
    expect(layout.restrictions.filter((r) => r.label).length).toBeGreaterThan(10); // dense enough to matter
    expect(leaders.length).toBeGreaterThan(0);

    for (let i = 0; i < leaders.length; i += 1)
      for (let j = i + 1; j < leaders.length; j += 1)
        expect(polylinesCross(leaders[i].leader, leaders[j].leader)).toBe(false);
  });

  it('uses orthogonal restriction elbows that touch the label top edge', () => {
    const layout = computeMapLayout(egfpLikeInput());
    const leaders = restrictionLeaders(layout);
    expect(leaders.length).toBeGreaterThan(0);

    for (const l of leaders) {
      // The old placement produced offsets up to ~112px; width-aware placement keeps
      // them tight. 40px is a generous ceiling that the old fan blew past.
      expect(Math.abs(l.labelX - l.tickX)).toBeLessThanOrEqual(40);
      expect(l.leader.at(-1)).toEqual({
        x: l.labelX,
        y: l.labelY - LABEL_LINE_HEIGHT_PX / 2 - RESTRICTION_LABEL_TOUCH_GAP,
      });
      for (let i = 1; i < l.leader.length; i += 1) {
        const a = l.leader[i - 1];
        const b = l.leader[i];
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
      const final = l.leader[l.leader.length - 1];
      const beforeFinal = l.leader[l.leader.length - 2];
      expect(beforeFinal.x).toBe(final.x);
      expect(final.x).toBe(l.labelX);
    }
  });

  it('assigns row slots in tick order so same-row leaders stay monotonic', () => {
    const layout = computeMapLayout(egfpLikeInput());
    const byRow = new Map<number, { tickX: number; labelX: number }[]>();
    for (const l of restrictionLeaders(layout)) {
      const row = byRow.get(l.labelY) ?? [];
      row.push(l);
      byRow.set(l.labelY, row);
    }
    for (const row of byRow.values()) {
      row.sort((a, b) => a.tickX - b.tickX);
      for (let i = 1; i < row.length; i += 1) expect(row[i].labelX).toBeGreaterThan(row[i - 1].labelX);
    }
  });

  it('is deterministic for the dense linear restriction band', () => {
    const a = JSON.stringify(computeMapLayout(egfpLikeInput()));
    const b = JSON.stringify(computeMapLayout(egfpLikeInput()));
    expect(a).toBe(b);
  });
});
