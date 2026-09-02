import { describe, it, expect } from 'vitest';
import {
  bpToAngle,
  describeCircularFeatureArrowBand,
  describeLinearFeatureArrowPath,
} from '../coordinates';

/**
 * The 3' arrowhead is INSCRIBED: it is cut out of the feature's own extent, not
 * added past the terminal base. These tests pin that on the drawn path, because
 * an arrowhead drawn outside the span puts the glyph over bases the feature does
 * not occupy and pulls it away from a ruler selection of the same range.
 */

/** Every explicit coordinate pair a path command lands on. */
function pathPoints(d: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const token of d.match(/[A-Za-z][^A-Za-z]*/g) ?? []) {
    const cmd = token[0];
    const nums = (token.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === 'M' || cmd === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] });
    } else if (cmd === 'A') {
      // rx ry rotation large-arc sweep x y
      for (let i = 0; i + 6 < nums.length; i += 7) points.push({ x: nums[i + 5], y: nums[i + 6] });
    } else if (cmd === 'H') {
      for (const x of nums) points.push({ x, y: points[points.length - 1]?.y ?? 0 });
    } else if (cmd === 'V') {
      for (const y of nums) points.push({ x: points[points.length - 1]?.x ?? 0, y });
    }
  }
  return points;
}

/** Degrees clockwise from 12 o'clock, matching the map's own convention. */
function angleAbout(cx: number, cy: number, p: { x: number; y: number }): number {
  const deg = (Math.atan2(p.x - cx, cy - p.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const TOL = 0.002; // path coordinates are rounded to 3 decimals

describe('describeLinearFeatureArrowPath: the head is inside the feature', () => {
  const X = 100;
  const W = 60;
  const Y = 20;
  const H = 16;

  it('draws a forward feature inside its own x-range with the tip on the last base', () => {
    const points = pathPoints(describeLinearFeatureArrowPath(X, Y, W, H, 0, 1, H / 2));
    const xs = points.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(X, 3);
    expect(Math.max(...xs)).toBeCloseTo(X + W, 3);
    // The single point at the far edge is the tip, on the axis mid-line.
    const atFarEdge = points.filter((p) => Math.abs(p.x - (X + W)) < TOL);
    expect(atFarEdge).toHaveLength(1);
    expect(atFarEdge[0].y).toBeCloseTo(Y + H / 2, 3);
    // The body stops short of the tip by the taper length.
    const body = xs.filter((x) => x < X + W - TOL);
    expect(Math.max(...body)).toBeCloseTo(X + W - H / 2, 3);
  });

  it('draws a reverse feature inside its own x-range with the tip on the first base', () => {
    const points = pathPoints(describeLinearFeatureArrowPath(X, Y, W, H, 0, -1, H / 2));
    const xs = points.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(X, 3);
    expect(Math.max(...xs)).toBeCloseTo(X + W, 3);
    const atNearEdge = points.filter((p) => Math.abs(p.x - X) < TOL);
    expect(atNearEdge).toHaveLength(1);
    expect(atNearEdge[0].y).toBeCloseTo(Y + H / 2, 3);
    const body = xs.filter((x) => x > X + TOL);
    expect(Math.min(...body)).toBeCloseTo(X + H / 2, 3);
  });

  it('keeps the footprint exact when the head is asked for more than the whole feature', () => {
    for (const direction of [1, -1] as const) {
      const xs = pathPoints(
        describeLinearFeatureArrowPath(X, Y, 6, H, 0, direction, 999),
      ).map((p) => p.x);
      expect(Math.min(...xs)).toBeCloseTo(X, 3);
      expect(Math.max(...xs)).toBeCloseTo(X + 6, 3);
    }
  });
});

describe('describeCircularFeatureArrowBand: the head is inside the feature', () => {
  const CX = 200;
  const CY = 200;
  const INNER = 120;
  const OUTER = 140;
  const START = 30;
  const END = 90;
  const TIP = 8;

  it('draws a forward band inside its own sweep with the tip on the last base', () => {
    const points = pathPoints(
      describeCircularFeatureArrowBand(CX, CY, INNER, OUTER, START, END, TIP, 1),
    );
    const angles = points.map((p) => angleAbout(CX, CY, p));
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(START - TOL);
    expect(Math.max(...angles)).toBeLessThanOrEqual(END + TOL);
    expect(Math.max(...angles)).toBeCloseTo(END, 2);
    // Exactly one vertex reaches the terminal base: the tip, at the mid radius.
    const tips = points.filter((p) => Math.abs(angleAbout(CX, CY, p) - END) < 0.01);
    expect(tips).toHaveLength(1);
    expect(Math.hypot(tips[0].x - CX, tips[0].y - CY)).toBeCloseTo((INNER + OUTER) / 2, 2);
    // The band itself stops the taper short of that base.
    const body = angles.filter((a) => a < END - 0.01);
    expect(Math.max(...body)).toBeLessThan(END - 1);
  });

  it('draws a reverse band inside its own sweep with the tip on the first base', () => {
    const points = pathPoints(
      describeCircularFeatureArrowBand(CX, CY, INNER, OUTER, START, END, -TIP, -1),
    );
    const angles = points.map((p) => angleAbout(CX, CY, p));
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(START - TOL);
    expect(Math.max(...angles)).toBeLessThanOrEqual(END + TOL);
    expect(Math.min(...angles)).toBeCloseTo(START, 2);
    const tips = points.filter((p) => Math.abs(angleAbout(CX, CY, p) - START) < 0.01);
    expect(tips).toHaveLength(1);
    expect(Math.hypot(tips[0].x - CX, tips[0].y - CY)).toBeCloseTo((INNER + OUTER) / 2, 2);
    const body = angles.filter((a) => a > START + 0.01);
    expect(Math.min(...body)).toBeGreaterThan(START + 1);
  });

  it('keeps the sweep exact when the head is asked for more than the whole band', () => {
    for (const [tip, direction] of [[999, 1], [-999, -1]] as const) {
      const angles = pathPoints(
        describeCircularFeatureArrowBand(CX, CY, INNER, OUTER, START, END, tip, direction),
      ).map((p) => angleAbout(CX, CY, p));
      expect(Math.min(...angles)).toBeGreaterThanOrEqual(START - TOL);
      expect(Math.max(...angles)).toBeLessThanOrEqual(END + TOL);
    }
  });

  it('places the tip on the terminal base in bp terms, not past it', () => {
    const length = 5369;
    const start = 4000;
    const end = 4300;
    const angles = pathPoints(
      describeCircularFeatureArrowBand(
        CX, CY, INNER, OUTER,
        bpToAngle(start, length),
        bpToAngle(end, length),
        6,
        1,
      ),
    ).map((p) => angleAbout(CX, CY, p));
    expect(Math.max(...angles)).toBeCloseTo(bpToAngle(end, length), 2);
  });
});
