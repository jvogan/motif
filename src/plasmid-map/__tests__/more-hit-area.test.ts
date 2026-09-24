import { describe, expect, it } from 'vitest';
import {
  keepSettledSquares,
  placeMoreHitAreas,
  type HitRect,
  type MoreHitObstacles,
  type MoreHitRequest,
} from '../more-hit-area';

// Geometry measured at 900x680 on pET-28a(+): "HaeIII +" drew its "+" 3.6 x 7 CSS px,
// one space right of the name.
const tail = { x: 499.8, y: 521.9, width: 3.6, height: 7 };
const namesRight = 496.2;
const bounds = { x: 10, y: 479, width: 832, height: 156 };
const none: MoreHitObstacles = { rects: [], segments: [], disks: [], bounds };

function overlaps(a: HitRect, b: HitRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('placeMoreHitAreas', () => {
  it('gives a lone tail a 24x24 CSS px square that touches it and leaves the name alone', () => {
    const square = placeMoreHitAreas([{ id: 'a', tail, namesRight }], none).get('a');
    expect(square).toMatchObject({ width: 24, height: 24 });
    expect(overlaps(square!, tail)).toBe(true);
    expect(square!.x).toBeGreaterThanOrEqual(namesRight);
  });

  it('keeps the square off a neighbouring label, a leader, and the ring', () => {
    const below = { x: 480.7, y: 534.1, width: 28.8, height: 7, owner: 'b' };
    const above = { x: 470, y: 505, width: 60, height: 7, owner: 'c' };
    const obstacles: MoreHitObstacles = {
      rects: [below, above],
      segments: [{ x1: 540, y1: 480, x2: 530, y2: 560, pad: 1, owner: 'd' }],
      disks: [{ cx: 425, cy: 562.5, r: 47 }],
      bounds,
    };
    const square = placeMoreHitAreas([{ id: 'a', tail, namesRight }], obstacles).get('a');
    expect(square, 'a square fits between the neighbours').toBeDefined();
    for (const rect of [below, above]) {
      const grown = { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 };
      expect(overlaps(square!, grown)).toBe(false);
    }
    expect(square!.x + square!.width).toBeLessThanOrEqual(529);
    expect(overlaps(square!, tail)).toBe(true);
  });

  it('ignores the tail’s own label, leader and tick, which open the same list', () => {
    const own = { x: 474.5, y: 521.9, width: 28.8, height: 7, owner: 'a' };
    const obstacles: MoreHitObstacles = {
      rects: [own],
      segments: [{ x1: 470, y1: 525, x2: 520, y2: 525, pad: 7, owner: 'a' }],
      disks: [],
      bounds,
    };
    expect(placeMoreHitAreas([{ id: 'a', tail, namesRight }], obstacles).get('a')).toMatchObject({ width: 24, height: 24 });
  });

  it('never lets two tails’ squares overlap', () => {
    const second = { x: 505.9, y: 534.1, width: 3.6, height: 7 };
    const placed = placeMoreHitAreas([
      { id: 'a', tail, namesRight },
      { id: 'b', tail: second, namesRight: 502.3 },
    ], none);
    expect(placed.size).toBe(2);
    expect(overlaps(placed.get('a')!, placed.get('b')!)).toBe(false);
  });

  it('falls back to a smaller square, then to none, when the room runs out', () => {
    // A 22px-tall slot: no 24 square fits, a 20 one does.
    const slot: MoreHitObstacles = {
      rects: [
        { x: 400, y: tail.y - 8, width: 200, height: 1, owner: 'x' },
        { x: 400, y: tail.y + 15, width: 200, height: 1, owner: 'y' },
      ],
      segments: [],
      disks: [],
      bounds,
    };
    expect(placeMoreHitAreas([{ id: 'a', tail, namesRight }], slot).get('a')).toMatchObject({ width: 20, height: 20 });
    const shut: MoreHitObstacles = { ...slot, rects: [{ x: 400, y: tail.y - 2, width: 200, height: 1, owner: 'x' }, { x: 400, y: tail.y + 9, width: 200, height: 1, owner: 'y' }] };
    expect(placeMoreHitAreas([{ id: 'a', tail, namesRight }], shut).has('a')).toBe(false);
  });
});

// The placement as first written: every candidate square tested against every
// obstacle, and every other request's squares counted one by one. The shipped
// version skips the tests an obstacle's or a request's box rules out; it must
// place exactly the same squares.
function referencePlace(requests: readonly MoreHitRequest[], obstacles: MoreHitObstacles): Map<string, HitRect> {
  const placed = new Map<string, HitRect>();
  const range = (from: number, to: number) => {
    const values: number[] = [];
    for (let v = from; v < to; v += 1) values.push(v);
    return values;
  };
  const inside = (r: HitRect, b: HitRect) => r.x >= b.x && r.y >= b.y && r.x + r.width <= b.x + b.width && r.y + r.height <= b.y + b.height;
  const segmentHits = (s: MoreHitObstacles['segments'][number], r: HitRect) => {
    const [minX, maxX, minY, maxY] = [r.x - s.pad, r.x + r.width + s.pad, r.y - s.pad, r.y + r.height + s.pad];
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    let [t0, t1] = [0, 1];
    for (const [p, q] of [[-dx, s.x1 - minX], [dx, maxX - s.x1], [-dy, s.y1 - minY], [dy, maxY - s.y1]]) {
      if (p === 0) {
        if (q < 0) return false;
        continue;
      }
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
    return t0 < t1;
  };
  const diskHits = (d: { cx: number; cy: number; r: number }, r: HitRect) => {
    const nx = Math.max(r.x, Math.min(d.cx, r.x + r.width));
    const ny = Math.max(r.y, Math.min(d.cy, r.y + r.height));
    return (nx - d.cx) ** 2 + (ny - d.cy) ** 2 < d.r ** 2;
  };
  for (const side of [24, 20, 16]) {
    const options = requests.filter((request) => !placed.has(request.id)).map((request) => {
      const { tail } = request;
      const cx = tail.x + tail.width / 2;
      const cy = tail.y + tail.height / 2;
      const squares = range(Math.max(request.namesRight, tail.x - side + 1), tail.x + tail.width)
        .flatMap((x) => range(tail.y - side + 1, tail.y + tail.height).map((y) => ({ x, y, width: side, height: side })))
        .filter((square) => {
          const grown = { x: square.x - 1, y: square.y - 1, width: side + 2, height: side + 2 };
          return inside(square, obstacles.bounds)
            && !obstacles.rects.some((r) => r.owner !== request.id && overlaps(grown, r))
            && !obstacles.segments.some((sg) => sg.owner !== request.id && segmentHits(sg, grown))
            && !obstacles.disks.some((d) => diskHits(d, square))
            && ![...placed.values()].some((other) => overlaps(square, other));
        })
        .map((square) => ({ square, distance: Math.hypot(square.x + side / 2 - cx, square.y + side / 2 - cy) }));
      return { id: request.id, squares };
    });
    let open = options.filter((option) => option.squares.length > 0);
    while (open.length > 0) {
      open.sort((a, b) => a.squares.length - b.squares.length);
      const [next, ...rest] = open;
      let best = next.squares[0];
      let bestKept = -1;
      for (const candidate of next.squares) {
        const kept = rest.reduce((sum, other) => sum + other.squares.filter((o) => !overlaps(o.square, candidate.square)).length, 0);
        if (kept > bestKept || (kept === bestKept && candidate.distance < best.distance)) {
          best = candidate;
          bestKept = kept;
        }
      }
      placed.set(next.id, best.square);
      open = rest
        .map((other) => ({ ...other, squares: other.squares.filter((o) => !overlaps(o.square, best.square)) }))
        .filter((other) => other.squares.length > 0);
    }
  }
  return placed;
}

// Stacks of labels beside a ring, 10-14 px apart, with leaders, tick hit strokes,
// feature names and overflow chips scattered around: the shape of a real map.
function crowdedMap(seed: number): { requests: MoreHitRequest[]; obstacles: MoreHitObstacles } {
  let state = seed;
  const rnd = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const w = 300 + rnd() * 900;
  const h = 150 + rnd() * 700;
  const frame = { x: rnd() * 20, y: rnd() * 400, width: w, height: h };
  const cx = frame.x + w / 2;
  const cy = frame.y + h / 2;
  const ring = Math.min(w, h) * (0.2 + rnd() * 0.2);
  const requests: MoreHitRequest[] = [];
  const rects: MoreHitObstacles['rects'][number][] = [];
  const segments: MoreHitObstacles['segments'][number][] = [];
  const count = 1 + Math.floor(rnd() * 24);
  for (let i = 0; i < count; i += 1) {
    const right = rnd() < 0.5;
    const y = cy - ring + (i % 12) * (10 + rnd() * 4) + rnd() * 2;
    const nameWidth = 20 + rnd() * 60;
    const x = right ? cx + ring + 10 + rnd() * 30 : cx - ring - 10 - nameWidth - 12 - rnd() * 30;
    const id = `k${i}`;
    const tailBox = { x: x + nameWidth + 2 + rnd() * 2, y, width: rnd() < 0.5 ? 3.6 + rnd() * 0.6 : 11 + rnd() * 2, height: 7 + rnd() * 4 };
    requests.push({ id, tail: tailBox, namesRight: x + nameWidth });
    rects.push({ x, y, width: tailBox.x + tailBox.width - x, height: tailBox.height, owner: id });
    segments.push({ x1: right ? x - 2 : tailBox.x + tailBox.width + 2, y1: y + 4, x2: cx + (right ? ring : -ring), y2: cy + (y - cy) * 0.8, pad: 1, owner: id });
    segments.push({ x1: cx + (right ? 0.95 : -0.95) * ring, y1: cy + (y - cy) * 0.7, x2: cx + (right ? 1.05 : -1.05) * ring, y2: cy + (y - cy) * 0.75, pad: 7, owner: id });
  }
  for (let j = 0; j < 8; j += 1) {
    rects.push({ x: frame.x + rnd() * w, y: frame.y + rnd() * h, width: 20 + rnd() * 60, height: 8 + rnd() * 6, owner: rnd() < 0.3 ? undefined : `f${j}` });
  }
  return { requests, obstacles: { rects, segments, disks: [{ cx, cy, r: ring + 2 }], bounds: frame } };
}

describe('placeMoreHitAreas against the plain definition', () => {
  it('places the same squares as testing every square against everything', () => {
    let squares = 0;
    let crowded = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const { requests, obstacles } = crowdedMap(seed);
      const expected = referencePlace(requests, obstacles);
      expect([...placeMoreHitAreas(requests, obstacles).entries()], `seed ${seed}`).toEqual([...expected.entries()]);
      squares += expected.size;
      if (expected.size < requests.length) crowded += 1;
    }
    // The fixtures exercise both outcomes: tails that get a square and tails left without one.
    expect(squares).toBeGreaterThan(100);
    expect(crowded).toBeGreaterThan(5);
  });
});

describe('keepSettledSquares', () => {
  const a = { x: 1, y: 2, width: 24, height: 24 };
  const b = { x: 50, y: 60, width: 20, height: 20 };

  it('keeps the current map when no square moved by 0.01 unit or more', () => {
    const current = new Map([['a', a], ['b', b]]);
    expect(keepSettledSquares(current, new Map([['a', { ...a, x: 1.005 }], ['b', { ...b }]]))).toBe(current);
  });

  it('keeps each unmoved square and takes each moved, added or removed one', () => {
    const current = new Map([['a', a], ['b', b]]);
    const moved = { ...b, y: 61 };
    const next = keepSettledSquares(current, new Map([['a', { ...a }], ['b', moved]]));
    expect(next).not.toBe(current);
    expect(next.get('a')).toBe(a);
    expect(next.get('b')).toBe(moved);
    expect([...keepSettledSquares(current, new Map([['a', { ...a }]])).keys()]).toEqual(['a']);
    const empty = new Map();
    expect(keepSettledSquares(empty, new Map())).toBe(empty);
  });
});
