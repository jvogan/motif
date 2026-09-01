import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import {
  circularSelectionEdgePath,
  circularSelectionRadii,
  coordinateGridExtent,
  linearSelectionEdgePaths,
  selectionOverlayPaths,
} from '../selection-overlay';
import type { MapInput } from '../types';

function circular(): MapInput {
  return {
    mode: 'circular',
    name: 'p',
    length: 3000,
    topology: 'circular',
    sequenceType: 'dna',
    features: [],
    restrictionSites: [],
    width: 600,
    height: 600,
  };
}

function linear(): MapInput {
  return { ...circular(), mode: 'linear', topology: 'linear', width: 800, height: 300 };
}

/** Every coordinate pair in an SVG path, as its distance from the map center. */
function radiiOf(path: string, layout: { center: { x: number; y: number } }): number[] {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const points: number[] = [];
  // Commands are M/L (x y) and A (rx ry rot large sweep x y); in both, the pair
  // that lands on the curve is the last two numbers of the command.
  for (const command of path.split(/(?=[MLAZ])/)) {
    const values = command.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (values.length < 2) continue;
    const x = values[values.length - 2];
    const y = values[values.length - 1];
    points.push(Math.hypot(x - layout.center.x, y - layout.center.y));
  }
  expect(numbers.length).toBeGreaterThan(0);
  return points;
}

describe('selectionOverlayPaths', () => {
  it('returns nothing with no ranges', () => {
    expect(selectionOverlayPaths(computeMapLayout(circular()), [])).toEqual([]);
  });

  it('projects a circular range to one annular sector clear of the center', () => {
    const layout = computeMapLayout(circular());
    const paths = selectionOverlayPaths(layout, [{ start: 500, end: 900 }]);
    expect(paths).toHaveLength(1);
    // Not a pie slice: the path never returns to the center, and it closes with a
    // second arc back along the inner radius.
    expect(paths[0]).not.toContain(`M ${layout.center.x} ${layout.center.y}`);
    expect(paths[0].match(/A /g)).toHaveLength(2);
    expect(paths[0].endsWith('Z')).toBe(true);

    const { inner, outer } = circularSelectionRadii(layout);
    expect(inner).toBeGreaterThan(0);
    for (const radius of radiiOf(paths[0], layout)) {
      expect(radius).toBeGreaterThanOrEqual(inner - 0.5);
      expect(radius).toBeLessThanOrEqual(outer + 0.5);
    }
  });

  it('starts the sector outside everything the map draws at the center', () => {
    const layout = computeMapLayout(circular());
    expect(layout.centerLabelRadius).toBeGreaterThan(0);
    expect(circularSelectionRadii(layout).inner).toBeGreaterThan(layout.centerLabelRadius as number);
  });

  it('tracks the clearance a longer name needs rather than a fixed inset', () => {
    const short = computeMapLayout({ ...circular(), name: 'p' });
    const long = computeMapLayout({ ...circular(), name: 'pSB1C3-mCherry-terminator' });
    expect(long.centerLabelRadius as number).toBeGreaterThan(short.centerLabelRadius as number);
    expect(circularSelectionRadii(long).inner).toBeGreaterThan(circularSelectionRadii(short).inner);
  });

  it('keeps the sector a band however long the name gets', () => {
    const layout = computeMapLayout({ ...circular(), name: 'x'.repeat(400) });
    const { inner, outer } = circularSelectionRadii(layout);
    expect(inner).toBeLessThan(outer);
    expect(inner / outer).toBeLessThanOrEqual(0.62);
  });

  it('draws each radial edge as a line spanning exactly the sector it bounds', () => {
    const layout = computeMapLayout(circular());
    const { inner, outer } = circularSelectionRadii(layout);
    const edge = circularSelectionEdgePath(layout, 500);
    expect(edge).toMatch(/^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/);
    const [from, to] = radiiOf(edge, layout);
    expect(from).toBeCloseTo(inner, 0);
    expect(to).toBeCloseTo(outer, 0);
  });

  it('splits an origin-wrapping circular selection into two sectors', () => {
    const paths = selectionOverlayPaths(computeMapLayout(circular()), [{ start: 2900, end: 200 }]);
    expect(paths).toHaveLength(2);
    for (const d of paths) {
      expect(d).toContain('A ');
      expect(d.endsWith('Z')).toBe(true);
    }
  });

  it('projects a linear range to one closed rect band', () => {
    const paths = selectionOverlayPaths(computeMapLayout(linear()), [{ start: 100, end: 400 }]);
    expect(paths).toHaveLength(1);
    expect(paths[0].startsWith('M ')).toBe(true);
    expect(paths[0].endsWith('Z')).toBe(true);
    expect(paths[0]).not.toContain('A '); // no arc in linear
  });

  it('emits a path per focused range (multi-span selection)', () => {
    const paths = selectionOverlayPaths(computeMapLayout(circular()), [
      { start: 100, end: 200 },
      { start: 1000, end: 1100 },
    ]);
    expect(paths).toHaveLength(2);
  });

  it('drops degenerate ranges without throwing', () => {
    const layout = computeMapLayout(circular());
    expect(selectionOverlayPaths(layout, [{ start: 500, end: 500 }])).toEqual([]);
    expect(selectionOverlayPaths(layout, [{ start: NaN, end: 100 }])).toEqual([]);
  });
});

describe('linear selection minimum width', () => {
  /** The x range of a rectangular linear band path. */
  function xSpan(path: string): { x0: number; x1: number; width: number } {
    const xs = [...path.matchAll(/[ML] (-?\d+(?:\.\d+)?) /g)].map((m) => Number(m[1]));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    return { x0, x1, width: x1 - x0 };
  }

  it('paints a single base wide enough to see', () => {
    // The band is span/length * axisWidth. On this 3,000 bp record one base is
    // well under a pixel, and since the accent stroke was removed the fill is
    // the whole mark -- so at its natural width the selection painted nothing.
    const layout = computeMapLayout(linear());
    const [path] = selectionOverlayPaths(layout, [{ start: 1500, end: 1501 }]);
    expect(path).toBeTruthy();
    expect(xSpan(path).width).toBeGreaterThanOrEqual(3);
  });

  it('leaves a selection that is already wide enough exactly where it was', () => {
    const layout = computeMapLayout(linear());
    const [narrowed] = selectionOverlayPaths(layout, [{ start: 500, end: 2500 }]);
    const span = xSpan(narrowed);
    expect(span.width).toBeGreaterThan(3);
    // Same coordinates the unclamped code produced: the clamp is a floor, not
    // a transform.
    const padX = layout.center.x;
    const axisWidth = Math.max(1, layout.width - 2 * padX);
    expect(span.x0).toBeCloseTo(padX + (500 / 3000) * axisWidth, 0);
    expect(span.x1).toBeCloseTo(padX + (2500 / 3000) * axisWidth, 0);
  });

  it('grows a narrow band around its own centre', () => {
    const layout = computeMapLayout(linear());
    const padX = layout.center.x;
    const axisWidth = Math.max(1, layout.width - 2 * padX);
    const [path] = selectionOverlayPaths(layout, [{ start: 1500, end: 1501 }]);
    const span = xSpan(path);
    const natural = padX + (1500.5 / 3000) * axisWidth;
    expect((span.x0 + span.x1) / 2).toBeCloseTo(natural, 0);
  });

  it('keeps a widened band inside the axis at either end', () => {
    const layout = computeMapLayout(linear());
    const padX = layout.center.x;
    const axisWidth = Math.max(1, layout.width - 2 * padX);
    const [atStart] = selectionOverlayPaths(layout, [{ start: 0, end: 1 }]);
    const [atEnd] = selectionOverlayPaths(layout, [{ start: 2999, end: 3000 }]);
    expect(xSpan(atStart).x0).toBeGreaterThanOrEqual(padX - 0.51);
    expect(xSpan(atEnd).x1).toBeLessThanOrEqual(padX + axisWidth + 0.51);
    expect(xSpan(atStart).width).toBeGreaterThanOrEqual(3);
    expect(xSpan(atEnd).width).toBeGreaterThanOrEqual(3);
  });
});

describe('linear selection boundary lines', () => {
  /** The x range of a rectangular linear band path. */
  function bandX(path: string): { x0: number; x1: number } {
    const xs = [...path.matchAll(/[ML] (-?\d+(?:\.\d+)?) /g)].map((m) => Number(m[1]));
    return { x0: Math.min(...xs), x1: Math.max(...xs) };
  }

  /** The endpoints of an `M x y L x y` line. */
  function lineOf(path: string): { x: number; y1: number; y2: number } {
    const n = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(n).toHaveLength(4);
    expect(n[0]).toBe(n[2]); // vertical
    return { x: n[0], y1: n[1], y2: n[3] };
  }

  function gridBottomOf(layout: ReturnType<typeof computeMapLayout>): number {
    const bottoms = layout.coordinates.flatMap((c) => (c.grid ? [c.grid.y2] : []));
    expect(bottoms.length).toBeGreaterThan(0);
    return Math.max(...bottoms);
  }

  /** The same linear layout with the grid stripped off every coordinate tick. */
  function withoutGrid(layout: ReturnType<typeof computeMapLayout>) {
    return {
      ...layout,
      coordinates: layout.coordinates.map(({ grid: _grid, ...rest }) => rest),
    };
  }

  it('carries both boundaries down to where the coordinate gridlines stop', () => {
    const layout = computeMapLayout(linear());
    const [band] = selectionOverlayPaths(layout, [{ start: 500, end: 2500 }]);
    const edges = linearSelectionEdgePaths(layout, band);
    expect(edges).toHaveLength(2);
    const gridBottom = gridBottomOf(layout);
    // Deep enough to be the point of the change: the band alone is 18px.
    expect(gridBottom - layout.center.y).toBeGreaterThan(40);
    for (const edge of edges) {
      const { y1, y2 } = lineOf(edge);
      expect(Math.max(y1, y2)).toBe(gridBottom);
      // Continuous with the band rather than starting inside it.
      expect(Math.min(y1, y2)).toBeLessThanOrEqual(layout.center.y - 9);
    }
  });

  it('stands the boundaries on the band it bounds, at the same two bp', () => {
    const layout = computeMapLayout(linear());
    const [band] = selectionOverlayPaths(layout, [{ start: 500, end: 2500 }]);
    const { x0, x1 } = bandX(band);
    const [start, end] = linearSelectionEdgePaths(layout, band).map(lineOf);
    expect(start.x).toBe(x0);
    expect(end.x).toBe(x1);
    // And the band itself is where it was: bp 500 and bp 2500 of a 3,000 bp axis.
    const padX = layout.center.x;
    const axisWidth = Math.max(1, layout.width - 2 * padX);
    expect(x0).toBeCloseTo(padX + (500 / 3000) * axisWidth, 0);
    expect(x1).toBeCloseTo(padX + (2500 / 3000) * axisWidth, 0);
  });

  it('keeps the single-base minimum width between the two boundaries', () => {
    const layout = computeMapLayout(linear());
    const [band] = selectionOverlayPaths(layout, [{ start: 1500, end: 1501 }]);
    const [start, end] = linearSelectionEdgePaths(layout, band).map(lineOf);
    expect(end.x - start.x).toBeGreaterThanOrEqual(3);
  });

  it('falls back to the band alone when no tick carries a grid', () => {
    const layout = computeMapLayout(linear());
    const [band] = selectionOverlayPaths(layout, [{ start: 500, end: 2500 }]);
    const stripped = withoutGrid(layout);
    expect(coordinateGridExtent(stripped)).toBeNull();
    expect(linearSelectionEdgePaths(stripped, band)).toEqual([]);
    // The band is what it always was; only the extension is missing.
    expect(selectionOverlayPaths(stripped, [{ start: 500, end: 2500 }])).toEqual([band]);
  });

  it('draws no linear boundary on a circular layout', () => {
    // A circular layout's ticks carry no grid, and one shallower than the band
    // is rejected on depth, so either would stop this for the wrong reason.
    // Splice on a grid that runs the height of the map: now only the mode test
    // stands between it and two lines drawn down a ring.
    const linearLayout = computeMapLayout(linear());
    const circularLayout = computeMapLayout(circular());
    const gridded = {
      ...circularLayout,
      coordinates: circularLayout.coordinates.map((coord) => ({
        ...coord,
        grid: { x1: 0, y1: 10, x2: 0, y2: circularLayout.height - 10 },
      })),
    };
    const extent = coordinateGridExtent(gridded)!;
    expect(extent).not.toBeNull();
    expect(extent.bottom).toBeGreaterThan(circularLayout.center.y + 9);
    const [band] = selectionOverlayPaths(linearLayout, [{ start: 500, end: 2500 }]);
    expect(linearSelectionEdgePaths(gridded, band)).toEqual([]);
  });

  it('draws no boundary for a path this module did not emit as a band', () => {
    const layout = computeMapLayout(linear());
    const [sector] = selectionOverlayPaths(computeMapLayout(circular()), [{ start: 500, end: 900 }]);
    // The reader only accepts the four-corner band, so a sector -- which opens
    // with the same `M x y` -- yields nothing rather than two lines off the map.
    expect(linearSelectionEdgePaths(layout, sector)).toEqual([]);
    expect(linearSelectionEdgePaths(layout, '')).toEqual([]);
  });

  it('reads the gridlines top and bottom off the ticks that carry one', () => {
    const layout = computeMapLayout(linear());
    const extent = coordinateGridExtent(layout)!;
    expect(extent).not.toBeNull();
    expect(extent.bottom).toBe(gridBottomOf(layout));
    expect(extent.top).toBe(Math.min(...layout.coordinates.flatMap((c) => (c.grid ? [c.grid.y1] : []))));
  });
});
