/**
 * Invisible press targets for the "+N" tail of circular restriction labels.
 *
 * The tail is the only part of a cluster label that opens the rest of the cluster.
 * On a small circular map it is one glyph: "EcoRI +" drew its "+" 3.6-4.2 CSS px
 * wide and 7-8 tall at 900x680. WCAG 2.5.8 asks for a 24x24 CSS px target, so a
 * tail gets a square of that size, where the drawing has room for one, that
 * overlaps the tail, starts right of the last enzyme name (the names keep their
 * own targets), and keeps 1px from every other label, leader, tick, overlaid
 * control, the ring, and another tail's square. Everything here is in screen
 * (CSS) pixels, the unit the criterion is written in; the caller maps the result
 * back into SVG user units.
 */

export type HitRect = { x: number; y: number; width: number; height: number };

export type MoreHitRequest = {
  id: string;
  /** Box of the tail glyphs. */
  tail: HitRect;
  /** Right edge of the label's last enzyme name; the square starts at or after it. */
  namesRight: number;
};

export type MoreHitObstacles = {
  /** Other press targets, drawn as boxes (label text, overflow chips). */
  rects: readonly (HitRect & { owner?: string })[];
  /** Stroked press targets (leaders, tick hit lines), with half their stroke width. */
  segments: readonly { x1: number; y1: number; x2: number; y2: number; pad: number; owner?: string }[];
  /** The ring and everything drawn on or inside it. */
  disks: readonly { cx: number; cy: number; r: number }[];
  /** The visible drawing; a square must lie inside it. */
  bounds: HitRect;
};

export const MORE_HIT_TARGET_PX = 24;

function rectsOverlap(a: HitRect, b: HitRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function segmentHitsRect(
  s: { x1: number; y1: number; x2: number; y2: number; pad: number },
  r: HitRect,
): boolean {
  // Grow the square by the stroke's half width, then test the centre line against
  // it by clipping the segment to the box (Liang-Barsky).
  const minX = r.x - s.pad;
  const maxX = r.x + r.width + s.pad;
  const minY = r.y - s.pad;
  const maxY = r.y + r.height + s.pad;
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, s.x1 - minX],
    [dx, maxX - s.x1],
    [-dy, s.y1 - minY],
    [dy, maxY - s.y1],
  ];
  for (const [p, q] of edges) {
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
}

function diskHitsRect(d: { cx: number; cy: number; r: number }, r: HitRect): boolean {
  const nx = Math.max(r.x, Math.min(d.cx, r.x + r.width));
  const ny = Math.max(r.y, Math.min(d.cy, r.y + r.height));
  return (nx - d.cx) ** 2 + (ny - d.cy) ** 2 < d.r ** 2;
}

function inside(r: HitRect, b: HitRect): boolean {
  return r.x >= b.x && r.y >= b.y && r.x + r.width <= b.x + b.width && r.y + r.height <= b.y + b.height;
}

/**
 * One square per request that fits, keyed by request id: 24px where possible,
 * else 20, else 16; a request with no clear square is left out and keeps only its
 * drawn glyphs. A square must overlap the
 * tail, so glyph and square form one target, and start at or right of the names.
 * No two squares overlap. The request with the fewest clear positions is placed
 * first, at the position that leaves the other requests the most room, then the
 * one nearest the tail's centre.
 */
export function placeMoreHitAreas(
  requests: readonly MoreHitRequest[],
  obstacles: MoreHitObstacles,
  side = MORE_HIT_TARGET_PX,
): Map<string, HitRect> {
  const placed = new Map<string, HitRect>();
  // A 24px square first. Where none fits, the tail still gets the largest of 20 and
  // 16 that does: smaller than the criterion, but four to nine times the glyph.
  for (const size of [side, side - 4, side - 8]) {
    const pending = requests.filter((request) => !placed.has(request.id));
    placeSquares(pending, obstacles, size, placed);
  }
  return placed;
}

function placeSquares(
  requests: readonly MoreHitRequest[],
  obstacles: MoreHitObstacles,
  side: number,
  placed: Map<string, HitRect>,
): void {
  const range = (from: number, to: number) => {
    const values: number[] = [];
    for (let v = from; v < to; v += 1) values.push(v);
    return values;
  };
  const placedSquares = [...placed.values()];
  const options = requests.map((request) => {
    const { tail } = request;
    const cx = tail.x + tail.width / 2;
    const cy = tail.y + tail.height / 2;
    const lefts = range(Math.max(request.namesRight, tail.x - side + 1), tail.x + tail.width);
    const tops = range(tail.y - side + 1, tail.y + tail.height);
    // Every square this request can take, grown by the pixel of air below, lies
    // in this box; an obstacle clear of it is clear of all of them. One more
    // pixel on each side absorbs rounding, so the result is the same as testing
    // every obstacle against every square, only without most of the tests.
    const reach = lefts.length > 0 && tops.length > 0
      ? { x: lefts[0] - 2, y: tops[0] - 2, width: lefts[lefts.length - 1] - lefts[0] + side + 4, height: tops[tops.length - 1] - tops[0] + side + 4 }
      : null;
    const rects = reach ? obstacles.rects.filter((r) => r.owner !== request.id && rectsOverlap(reach, r)) : [];
    const segments = reach ? obstacles.segments.filter((sg) => sg.owner !== request.id && segmentHitsRect(sg, reach)) : [];
    const disks = reach ? obstacles.disks.filter((d) => diskHitsRect(d, reach)) : [];
    const others = reach ? placedSquares.filter((other) => rectsOverlap(reach, other)) : [];
    const squares: { square: HitRect; distance: number }[] = [];
    for (const x of lefts) {
      for (const y of tops) {
        const square = { x, y, width: side, height: side };
        // Text answers a press a fraction of a pixel outside its box, so a square
        // keeps one pixel of air from every other target.
        const grown = { x: square.x - 1, y: square.y - 1, width: side + 2, height: side + 2 };
        if (
          inside(square, obstacles.bounds)
          && !rects.some((r) => rectsOverlap(grown, r))
          && !segments.some((sg) => segmentHitsRect(sg, grown))
          && !disks.some((d) => diskHitsRect(d, square))
          && !others.some((other) => rectsOverlap(square, other))
        ) {
          squares.push({ square, distance: Math.hypot(square.x + side / 2 - cx, square.y + side / 2 - cy) });
        }
      }
    }
    return { id: request.id, squares, reach: reach ?? { x: 0, y: 0, width: 0, height: 0 } };
  });
  let open = options.filter((option) => option.squares.length > 0);
  while (open.length > 0) {
    open.sort((a, b) => a.squares.length - b.squares.length);
    const [next, ...rest] = open;
    let best = next.squares[0];
    let bestKept = -1;
    for (const candidate of next.squares) {
      // A request whose squares all lie clear of the candidate keeps every one;
      // only the neighbours whose reach it touches need counting square by square.
      let kept = 0;
      for (const other of rest) {
        if (!rectsOverlap(other.reach, candidate.square)) {
          kept += other.squares.length;
          continue;
        }
        for (const o of other.squares) {
          if (!rectsOverlap(o.square, candidate.square)) kept += 1;
        }
      }
      if (kept > bestKept || (kept === bestKept && candidate.distance < best.distance)) {
        best = candidate;
        bestKept = kept;
      }
    }
    placed.set(next.id, best.square);
    open = rest
      .map((other) => ({ ...other, squares: other.squares.filter((o) => !rectsOverlap(o.square, best.square)) }))
      .filter((other) => other.squares.length > 0);
  }
}

function box(rect: DOMRect): HitRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function screenSegments(
  element: SVGGeometryElement,
  points: readonly { x: number; y: number }[],
  pad: number,
  owner: string | undefined,
): MoreHitObstacles['segments'] {
  const ctm = element.getScreenCTM();
  if (!ctm) return [];
  const screen = points.map((p) => new DOMPoint(p.x, p.y).matrixTransform(ctm));
  return screen.slice(1).map((p, i) => ({ x1: screen[i].x, y1: screen[i].y, x2: p.x, y2: p.y, pad, owner }));
}

/**
 * Reads the drawn circular map and places every tail's square, in screen pixels,
 * keyed by cluster id. Returns an empty map when the drawing has no layout box
 * (jsdom, a hidden pane).
 */
export function measureMoreHitAreas(svg: SVGSVGElement): Map<string, HitRect> {
  // Reading the drawing is cheap and placing is not, so each call reads, and the
  // placement is reused while what it read is unchanged. The reading, not the
  // time, is the cache key.
  const read = readDrawing(svg);
  if (!read) return new Map();
  const key = JSON.stringify(read);
  const cached = placements.get(svg);
  if (cached && cached.key === key) return cached.result;
  const result = placeMoreHitAreas(read.requests, read.obstacles);
  placements.set(svg, { key, result });
  return result;
}

const placements = new WeakMap<SVGSVGElement, { key: string; result: Map<string, HitRect> }>();

/**
 * Every tail's square in the user units of its own mark's group, keyed by
 * cluster id. The map calls this once per commit for all of its marks: each
 * call reads the whole drawing, 81 box reads for pBR322's 15 tails at 1440x900.
 */
export function measureMoreHitSquares(svg: SVGSVGElement): Map<string, HitRect> {
  const screen = measureMoreHitAreas(svg);
  const squares = new Map<string, HitRect>();
  if (screen.size === 0) return squares;
  for (const group of svg.querySelectorAll<SVGGElement>('.motif-pm-restriction')) {
    const id = group.dataset.clusterId;
    const rect = id ? screen.get(id) : undefined;
    const toUser = rect ? group.getScreenCTM()?.inverse() : undefined;
    if (!id || !rect || !toUser) continue;
    const a = new DOMPoint(rect.x, rect.y).matrixTransform(toUser);
    const b = new DOMPoint(rect.x + rect.width, rect.y + rect.height).matrixTransform(toUser);
    squares.set(id, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
  }
  return squares;
}

/**
 * `next`, with each square that moved less than 0.01 unit replaced by the one in
 * `current`, and `current` itself when nothing moved, so a mark whose square is
 * unchanged is not drawn again.
 */
export function keepSettledSquares(
  current: ReadonlyMap<string, HitRect>,
  next: ReadonlyMap<string, HitRect>,
): ReadonlyMap<string, HitRect> {
  const settled = (a: HitRect, b: HitRect) => (
    Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01
    && Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01
  );
  let changed = current.size !== next.size;
  const kept = new Map<string, HitRect>();
  for (const [id, square] of next) {
    const before = current.get(id);
    if (before && settled(before, square)) kept.set(id, before);
    else {
      kept.set(id, square);
      changed = true;
    }
  }
  return changed ? kept : current;
}

function readDrawing(svg: SVGSVGElement): { requests: MoreHitRequest[]; obstacles: MoreHitObstacles } | null {
  const frame = svg.getBoundingClientRect();
  const backbone = svg.querySelector<SVGGraphicsElement>('.motif-pm-backbone');
  if (frame.width === 0 || frame.height === 0 || !backbone) return null;
  const ring = backbone.getBoundingClientRect();
  const clip = svg.parentElement?.getBoundingClientRect() ?? frame;
  const left = Math.max(frame.left, clip.left);
  const top = Math.max(frame.top, clip.top);
  const bounds = {
    x: left,
    y: top,
    width: Math.min(frame.right, clip.right) - left,
    height: Math.min(frame.bottom, clip.bottom) - top,
  };
  const ownerOf = (el: Element) => el.closest<SVGGElement>('.motif-pm-restriction')?.dataset.clusterId;
  const requests: MoreHitRequest[] = [];
  for (const tail of svg.querySelectorAll<SVGTSpanElement>('.motif-pm-restriction-label [data-label-more]')) {
    const id = ownerOf(tail);
    const text = tail.closest('text');
    if (!id || !text) continue;
    const names = [...text.querySelectorAll('tspan')].filter((span) => span !== tail);
    const tailBox = box(tail.getBoundingClientRect());
    requests.push({
      id,
      tail: tailBox,
      namesRight: names.length > 0
        ? Math.max(...names.map((span) => span.getBoundingClientRect().right))
        : tailBox.x,
    });
  }
  if (requests.length === 0) return null;
  const rects = [...svg.querySelectorAll('text')].map((text) => ({ ...box(text.getBoundingClientRect()), owner: ownerOf(text) }));
  // Controls the frame lays over the drawing, such as the overflow chips.
  for (const control of svg.parentElement?.querySelectorAll('button, a[href], [role="button"]') ?? []) {
    if (!svg.contains(control)) rects.push({ ...box(control.getBoundingClientRect()), owner: undefined });
  }
  const segments: MoreHitObstacles['segments'][number][] = [];
  for (const leader of svg.querySelectorAll<SVGPolylineElement>('.motif-pm-leader')) {
    segments.push(...screenSegments(leader, [...leader.points], 1, ownerOf(leader)));
  }
  for (const tick of svg.querySelectorAll<SVGLineElement>('.motif-pm-tick-hit')) {
    // The hit stroke is 14 CSS px wide at any zoom (non-scaling), so pad by 7.
    const points = [
      { x: tick.x1.baseVal.value, y: tick.y1.baseVal.value },
      { x: tick.x2.baseVal.value, y: tick.y2.baseVal.value },
    ];
    segments.push(...screenSegments(tick, points, 7, ownerOf(tick)));
  }
  // Features, their inside labels, the ruler and the ticks' roots are on or
  // inside the ring; 2px of air keeps a square off the backbone stroke.
  const disks = [{ cx: ring.x + ring.width / 2, cy: ring.y + ring.height / 2, r: Math.max(ring.width, ring.height) / 2 + 2 }];
  return { requests, obstacles: { rects, segments, disks, bounds } };
}
