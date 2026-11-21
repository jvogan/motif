import { describe, expect, it } from 'vitest';
import {
  CALLOUT_CLEARANCE_PX,
  LEADER_MIN_PX,
  placeSelectedNameCallout,
  type CalloutBox,
  type SelectedNameCalloutInput,
} from '../selected-name-callout';
import type { Pt } from '../types';

const CENTER: Pt = { x: 300, y: 300 };
const RING = 250;

/** An arc band from `r0` to `r1` between two angles, sampled every 1.5px along its outline. */
function band(a0: number, a1: number, r0: number, r1: number): Pt[] {
  const out: Pt[] = [];
  const arc = (r: number) => {
    const n = Math.max(2, Math.ceil(((a1 - a0) * r) / 1.5));
    for (let i = 0; i <= n; i += 1) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push({ x: CENTER.x + Math.cos(a) * r, y: CENTER.y + Math.sin(a) * r });
    }
  };
  arc(r0);
  arc(r1);
  for (const a of [a0, a1]) out.push(...spoke(a, r0, r1));
  return out;
}

/** A radial line at angle `a` from `r0` to `r1`, sampled every 1.5px. */
function spoke(a: number, r0: number, r1: number): Pt[] {
  const out: Pt[] = [];
  const n = Math.ceil((r1 - r0) / 1.5);
  for (let i = 0; i <= n; i += 1) {
    const r = r0 + ((r1 - r0) * i) / n;
    out.push({ x: CENTER.x + Math.cos(a) * r, y: CENTER.y + Math.sin(a) * r });
  }
  return out;
}

// A short feature at the top right, a little past one o'clock.
const A0 = -Math.PI / 2 + 0.95;
const A1 = A0 + 0.06;
const MID = (A0 + A1) / 2;
const FEATURE = band(A0, A1, 200, 212);
const CENTRE_TITLE: CalloutBox = { x: 260, y: 285, width: 80, height: 34 };

function input(overrides: Partial<SelectedNameCalloutInput> = {}): SelectedNameCalloutInput {
  return {
    center: CENTER,
    angle: MID,
    innerRadius: 200,
    outerRadius: 212,
    ringRadius: RING,
    width: 150,
    height: 16,
    feature: FEATURE,
    lines: [],
    names: [CENTRE_TITLE],
    bounds: { x: 0, y: 0, width: 600, height: 600 },
    ...overrides,
  };
}

function touches(a: CalloutBox, b: CalloutBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(p: Pt, box: CalloutBox): boolean {
  return p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height;
}

function within(box: CalloutBox, bounds: CalloutBox): boolean {
  return box.x >= bounds.x && box.y >= bounds.y
    && box.x + box.width <= bounds.x + bounds.width
    && box.y + box.height <= bounds.y + bounds.height;
}

function nearestGap(box: CalloutBox, points: readonly Pt[]): number {
  return Math.min(...points.map((p) => {
    const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.width));
    const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.height));
    return Math.hypot(dx, dy);
  }));
}

describe('placeSelectedNameCallout', () => {
  it('sets the name just inside the feature, toward the centre, when that spot is clean', () => {
    const placed = placeSelectedNameCallout(input());
    expect(placed).not.toBeNull();
    const { box, leader, side } = placed!;
    expect(side).toBe('inside');
    expect(leader).toBeNull();
    // Right against the feature: within the leader threshold and clear of its outline.
    expect(nearestGap(box, FEATURE)).toBeLessThanOrEqual(LEADER_MIN_PX);
    expect(nearestGap(box, FEATURE)).toBeGreaterThanOrEqual(CALLOUT_CLEARANCE_PX);
    // Toward the centre: the plate's middle is nearer the centre than the feature is.
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(Math.hypot(mid.x - CENTER.x, mid.y - CENTER.y)).toBeLessThan(200);
    expect(box.width).toBe(150);
    expect(box.height).toBe(16);
  });

  it('moves off the selection wedge lines and ties the name back with a leader when it sits away', () => {
    // The wedge's two edges run from near the centre title out past the ring.
    const lines = [...spoke(A0, 60, RING + 20), ...spoke(A1, 60, RING + 20)];
    const placed = placeSelectedNameCallout(input({ lines }));
    expect(placed).not.toBeNull();
    const { box, leader } = placed!;
    expect(lines.some((p) => inside(p, box))).toBe(false);
    expect(FEATURE.some((p) => inside(p, box))).toBe(false);
    expect(touches(box, CENTRE_TITLE)).toBe(false);
    const gap = nearestGap(box, FEATURE);
    if (gap > LEADER_MIN_PX) {
      expect(leader).not.toBeNull();
      const [start, end] = leader!;
      expect(start.x).toBeGreaterThanOrEqual(box.x);
      expect(start.x).toBeLessThanOrEqual(box.x + box.width);
      expect(FEATURE).toContainEqual(end);
    } else {
      expect(leader).toBeNull();
    }
  });

  it('never covers the centre name, another name or the feature', () => {
    // A name sits right where the plain inside spot would go.
    const blocker: CalloutBox = { x: 330, y: 150, width: 120, height: 40 };
    const names = [CENTRE_TITLE, blocker];
    const placed = placeSelectedNameCallout(input({ names }));
    expect(placed).not.toBeNull();
    for (const name of names) expect(touches(placed!.box, name)).toBe(false);
    expect(FEATURE.some((p) => inside(p, placed!.box))).toBe(false);

    // A tiny ring: every inside spot would sit on the centre title, so the name goes
    // outside or nowhere, and never over the title.
    const tiny = band(A0, A1, 46, 54);
    const small = placeSelectedNameCallout(input({
      feature: tiny,
      innerRadius: 46,
      outerRadius: 54,
      ringRadius: 60,
      names: [{ x: 250, y: 270, width: 100, height: 60 }],
    }));
    if (small) {
      expect(touches(small.box, { x: 250, y: 270, width: 100, height: 60 })).toBe(false);
      expect(small.side).toBe('outside');
    }
  });

  it('shows nothing when no spot is clean', () => {
    // Names cover the whole drawing.
    expect(placeSelectedNameCallout(input({ names: [{ x: 0, y: 0, width: 600, height: 600 }] }))).toBeNull();
    // A name wider than the drawing is not cut to fit.
    expect(placeSelectedNameCallout(input({ width: 700 }))).toBeNull();
    // Nothing drawn to tie it to.
    expect(placeSelectedNameCallout(input({ feature: [] }))).toBeNull();
  });

  it('never cuts the name at the drawing edge', () => {
    // The drawing ends just past the feature: the only clean spots run off the edge.
    const bounds = { x: 380, y: 0, width: 220, height: 600 };
    const placed = placeSelectedNameCallout(input({ bounds }));
    if (placed) expect(within(placed.box, bounds)).toBe(true);
    // The plate keeps its full width whatever the room.
    for (const width of [60, 150, 240]) {
      const result = placeSelectedNameCallout(input({ width, bounds }));
      if (result) {
        expect(result.box.width).toBe(width);
        expect(within(result.box, bounds)).toBe(true);
      }
    }
  });
});
