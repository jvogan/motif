import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import type { MapInput } from '../types';
import type { Feature } from '../../bio/types';

/**
 * A feature's drawn glyph must occupy exactly the span its bases occupy, in both
 * map modes. The arrowhead is cut out of that span rather than added past it, so
 * a ruler selection over the feature's range lands under the feature's shape —
 * the same projection draws both.
 */

const LENGTH = 5369;

function feat(p: Partial<Feature> & { id: string }): Feature {
  return {
    id: p.id,
    name: p.name ?? p.id,
    type: p.type ?? 'misc_feature',
    start: p.start ?? 0,
    end: p.end ?? 0,
    strand: p.strand ?? 1,
    subRanges: p.subRanges,
    color: '#8a8a8a',
    metadata: {},
  };
}

// One long and one short feature per strand, plus a two-exon feature on each
// strand: a short feature is where the old outside arrowhead doubled the glyph,
// and a split feature is where only the terminal exon may carry the point.
const features: Feature[] = [
  feat({ id: 'fwdLong', name: 'fwd long', start: 400, end: 1400, strand: 1 }),
  feat({ id: 'fwdShort', name: 'fwd short', start: 1600, end: 1618, strand: 1 }),
  feat({ id: 'revLong', name: 'rev long', start: 2000, end: 3000, strand: -1 }),
  feat({ id: 'revShort', name: 'rev short', start: 3200, end: 3218, strand: -1 }),
  feat({
    id: 'fwdSplit', name: 'fwd split', start: 3400, end: 4000, strand: 1,
    subRanges: [{ start: 3400, end: 3600 }, { start: 3800, end: 4000 }],
  }),
  feat({
    id: 'revSplit', name: 'rev split', start: 4200, end: 4800, strand: -1,
    subRanges: [{ start: 4200, end: 4400 }, { start: 4600, end: 4800 }],
  }),
  feat({ id: 'none', name: 'directionless', start: 5000, end: 5200, strand: 0 }),
];

function input(mode: 'circular' | 'linear'): MapInput {
  return {
    mode,
    name: 'arrow extent',
    length: LENGTH,
    topology: 'circular',
    sequenceType: 'dna',
    features,
    restrictionSites: [],
    width: mode === 'linear' ? 1100 : 760,
    height: mode === 'linear' ? 320 : 760,
  };
}

/** Every explicit coordinate a path command lands on. */
function pathPoints(d: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const token of d.match(/[A-Za-z][^A-Za-z]*/g) ?? []) {
    const cmd = token[0];
    const nums = (token.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === 'M' || cmd === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] });
    } else if (cmd === 'A') {
      for (let i = 0; i + 6 < nums.length; i += 7) points.push({ x: nums[i + 5], y: nums[i + 6] });
    } else if (cmd === 'H') {
      for (const x of nums) points.push({ x, y: points[points.length - 1]?.y ?? 0 });
    } else if (cmd === 'V') {
      for (const y of nums) points.push({ x: points[points.length - 1]?.x ?? 0, y });
    }
  }
  return points;
}

function angleAbout(cx: number, cy: number, p: { x: number; y: number }): number {
  const deg = (Math.atan2(p.x - cx, cy - p.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const TOL = 0.01; // path coordinates carry 3 decimals; angles convert through them

/**
 * The distinct heights a path visits at one x. A flat edge visits the top and the
 * bottom of the row; an arrowhead tip visits only the mid-line, alone.
 */
function heightsAtX(points: { x: number; y: number }[], x: number): number[] {
  return [...new Set(points.filter((p) => Math.abs(p.x - x) < TOL).map((p) => Math.round(p.y * 100) / 100))]
    .sort((a, b) => a - b);
}

/** The same, radially: the distinct radii a circular path visits at one angle. */
function radiiAtAngle(
  points: { x: number; y: number }[],
  cx: number,
  cy: number,
  deg: number,
): number[] {
  return [...new Set(
    points
      .filter((p) => Math.abs(angleAbout(cx, cy, p) - deg) < 0.05)
      .map((p) => Math.round(Math.hypot(p.x - cx, p.y - cy) * 10) / 10),
  )].sort((a, b) => a - b);
}

describe('feature glyph extent: linear', () => {
  const layout = computeMapLayout(input('linear'));
  const axis = layout.linearAxis!;
  const bpToX = (bp: number) => axis.startX + (bp / LENGTH) * axis.width;

  it('draws every feature exactly across the x-range of its own bases', () => {
    expect(layout.features.length).toBe(features.length);
    for (const render of layout.features) {
      const source = features.find((f) => f.id === render.id)!;
      const xs = render.segmentPaths.flatMap((d) => pathPoints(d).map((p) => p.x));
      expect(xs.length).toBeGreaterThan(0);
      expect(Math.min(...xs)).toBeCloseTo(bpToX(source.start), 2);
      expect(Math.max(...xs)).toBeCloseTo(bpToX(source.end), 2);
    }
  });

  it('puts the 3-prime tip on the terminal base of the terminal segment only', () => {
    for (const id of ['fwdSplit', 'revSplit']) {
      const render = layout.features.find((f) => f.id === id)!;
      const source = features.find((f) => f.id === id)!;
      expect(render.segmentPaths).toHaveLength(2);
      const forward = source.strand === 1;
      const terminal = render.segmentPaths[1];
      const other = render.segmentPaths[0];
      const sub = source.subRanges!;
      // The terminal segment carries the point: at its 3' base the path visits
      // one height only, the row's mid-line.
      const tipX = bpToX(forward ? sub[1].end : sub[1].start);
      const terminalPoints = pathPoints(terminal);
      const tipHeights = heightsAtX(terminalPoints, tipX);
      expect(tipHeights).toHaveLength(1);
      const rowTop = Math.min(...terminalPoints.map((p) => p.y));
      const rowBottom = Math.max(...terminalPoints.map((p) => p.y));
      expect(tipHeights[0]).toBeCloseTo((rowTop + rowBottom) / 2, 2);
      // The other segment is a plain bar: both of its edges span the whole row.
      const otherPoints = pathPoints(other);
      for (const bp of [sub[0].start, sub[0].end]) {
        expect(heightsAtX(otherPoints, bpToX(bp))).toEqual([rowTop, rowBottom]);
      }
    }
  });

  it('leaves a directionless feature as a plain bar', () => {
    const render = layout.features.find((f) => f.id === 'none')!;
    const points = pathPoints(render.segmentPaths[0]);
    const rowTop = Math.min(...points.map((p) => p.y));
    const rowBottom = Math.max(...points.map((p) => p.y));
    expect(heightsAtX(points, bpToX(5000))).toEqual([rowTop, rowBottom]);
    expect(heightsAtX(points, bpToX(5200))).toEqual([rowTop, rowBottom]);
  });

  it('keeps a body under the arrowhead of a short feature', () => {
    for (const id of ['fwdShort', 'revShort']) {
      const source = features.find((f) => f.id === id)!;
      const render = layout.features.find((f) => f.id === id)!;
      const points = pathPoints(render.segmentPaths[0]);
      const span = bpToX(source.end) - bpToX(source.start);
      const forward = source.strand === 1;
      const tipX = forward ? bpToX(source.end) : bpToX(source.start);
      const backEdge = forward
        ? Math.max(...points.filter((p) => Math.abs(p.x - tipX) >= TOL).map((p) => p.x))
        : Math.min(...points.filter((p) => Math.abs(p.x - tipX) >= TOL).map((p) => p.x));
      expect(Math.abs(backEdge - tipX)).toBeLessThanOrEqual(span / 2 + TOL);
    }
  });
});

describe('feature glyph extent: circular', () => {
  const layout = computeMapLayout(input('circular'));
  const { x: cx, y: cy } = layout.center;
  const bpToDeg = (bp: number) => (bp / LENGTH) * 360;

  it('draws every feature exactly across the arc of its own bases', () => {
    expect(layout.features.length).toBe(features.length);
    for (const render of layout.features) {
      const source = features.find((f) => f.id === render.id)!;
      const angles = render.segmentPaths.flatMap((d) =>
        pathPoints(d).map((p) => angleAbout(cx, cy, p)));
      expect(angles.length).toBeGreaterThan(0);
      expect(Math.min(...angles)).toBeCloseTo(bpToDeg(source.start), 1);
      expect(Math.max(...angles)).toBeCloseTo(bpToDeg(source.end), 1);
    }
  });

  it('puts the 3-prime tip on the terminal base of the terminal segment only', () => {
    for (const id of ['fwdSplit', 'revSplit']) {
      const render = layout.features.find((f) => f.id === id)!;
      const source = features.find((f) => f.id === id)!;
      expect(render.segmentPaths).toHaveLength(2);
      const forward = source.strand === 1;
      const sub = source.subRanges!;
      const tipDeg = bpToDeg(forward ? sub[1].end : sub[1].start);
      const terminalPoints = pathPoints(render.segmentPaths[1]);
      // At the 3' base the terminal band visits one radius only: the band's middle.
      const tipRadii = radiiAtAngle(terminalPoints, cx, cy, tipDeg);
      expect(tipRadii).toHaveLength(1);
      const otherPoints = pathPoints(render.segmentPaths[0]);
      const bandRadii = radiiAtAngle(otherPoints, cx, cy, bpToDeg(sub[0].start));
      expect(bandRadii).toHaveLength(2);
      expect(tipRadii[0]).toBeCloseTo((bandRadii[0] + bandRadii[1]) / 2, 1);
      // The other segment is a plain band: both of its edges span inner to outer.
      expect(radiiAtAngle(otherPoints, cx, cy, bpToDeg(sub[0].end))).toEqual(bandRadii);
    }
  });

  it('keeps a body under the arrowhead of a short feature', () => {
    for (const id of ['fwdShort', 'revShort']) {
      const source = features.find((f) => f.id === id)!;
      const render = layout.features.find((f) => f.id === id)!;
      const angles = pathPoints(render.segmentPaths[0]).map((p) => angleAbout(cx, cy, p));
      const sweep = bpToDeg(source.end) - bpToDeg(source.start);
      const forward = source.strand === 1;
      const tipDeg = forward ? bpToDeg(source.end) : bpToDeg(source.start);
      const body = angles.filter((a) => Math.abs(a - tipDeg) >= 0.05);
      const backEdge = forward ? Math.max(...body) : Math.min(...body);
      expect(Math.abs(backEdge - tipDeg)).toBeLessThanOrEqual(sweep / 2 + 0.05);
    }
  });
});
