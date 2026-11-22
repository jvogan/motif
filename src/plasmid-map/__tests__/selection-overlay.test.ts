import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import {
  circularSelectionEdgePath,
  circularSelectionRadii,
  coordinateGridExtent,
  linearSelectionEdgePaths,
  selectionFadeGradients,
  selectionOverlayPaths,
  type SelectionFadeGradient,
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

  it('projects a circular range to one annular band clear of the center', () => {
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

  it('starts the band outside everything the map draws at the center', () => {
    const layout = computeMapLayout(circular());
    expect(layout.centerLabelRadius).toBeGreaterThan(0);
    expect(circularSelectionRadii(layout).inner).toBeGreaterThan(layout.centerLabelRadius as number);
  });

  it('spans a wedge from a third of the ring\'s radius to just past the ring', () => {
    const layout = computeMapLayout({
      ...circular(),
      features: [
        { id: 'a', name: 'Outer', type: 'cds', start: 200, end: 1400, strand: 1, color: '#2f9e44', metadata: {} },
        { id: 'b', name: 'Nested', type: 'cds', start: 400, end: 900, strand: -1, color: '#1f5fc0', metadata: {} },
        { id: 'c', name: 'Third', type: 'promoter', start: 500, end: 700, strand: 1, color: '#8a5500', metadata: {} },
      ],
    });
    const lanes = layout.featureLaneInnerRadius as number;
    expect(lanes).toBeGreaterThan(0);
    expect(lanes).toBeLessThan(layout.featureLaneOuterRadius as number);
    const { inner, outer } = circularSelectionRadii(layout);
    // The wash straddles the ring line and reaches a third of the way out from
    // the centre, well past the deepest lane, so the wedge reads as a slice of
    // the map rather than a stub at the ring.
    expect(outer).toBeGreaterThan(layout.radius);
    expect(outer - layout.radius).toBeLessThanOrEqual(6);
    expect(inner).toBeCloseTo(layout.radius / 3, 3);
    expect(lanes - inner).toBeGreaterThan(20);
    expect(inner).toBeGreaterThanOrEqual((layout.centerLabelRadius as number) + 4);
    // Every feature body lies inside the wedge, so the range covers every lane it crosses.
    expect(layout.features.length).toBe(3);
    for (const feature of layout.features) {
      for (const d of feature.segmentPaths) {
        for (const radius of radiiOf(d, layout)) {
          expect(radius).toBeGreaterThanOrEqual(inner - 0.5);
          expect(radius).toBeLessThanOrEqual(outer + 0.5);
        }
      }
    }
  });

  it('reaches just inside the lanes where they pack deeper than a third of the ring', () => {
    const base = computeMapLayout(circular());
    const ring = base.radius;
    // A crowded record: its innermost lane sits a quarter of the way out.
    const layout = { ...base, featureLaneInnerRadius: ring * 0.25, centerLabelRadius: ring * 0.1 };
    const { inner } = circularSelectionRadii(layout);
    expect(inner).toBeLessThan(ring / 3);
    expect(inner).toBeCloseTo(ring * 0.25 - 3, 3);
    // A lane edge between the reach and the ring does not pull the wedge back out.
    const shallow = circularSelectionRadii({ ...base, featureLaneInnerRadius: ring * 0.8, centerLabelRadius: ring * 0.1 });
    expect(shallow.inner).toBeCloseTo(ring / 3, 3);
  });

  it('keeps the band clear of the centre however long the name gets', () => {
    const short = circularSelectionRadii(computeMapLayout({ ...circular(), name: 'p' }));
    const layout = computeMapLayout({ ...circular(), name: 'x'.repeat(400) });
    const { inner, outer } = circularSelectionRadii(layout);
    const title = layout.centerLabelRadius as number;
    expect(inner).toBeLessThan(outer);
    // A short name leaves the wedge at a third of the ring; a long one widens the
    // title's clear disc past that, and the wedge stops 4 units outside it.
    expect(short.inner).toBeCloseTo(layout.radius / 3, 3);
    expect(title + 4).toBeGreaterThan(layout.radius / 3);
    expect(inner).toBeCloseTo(title + 4, 3);
    // Lanes packed into the title's disc still leave the disc clear.
    const crowded = circularSelectionRadii({ ...layout, featureLaneInnerRadius: title - 10 });
    expect(crowded.inner).toBeCloseTo(title + 4, 3);
    // A title disc that reaches the ring still leaves a pixel of wedge.
    const swamped = circularSelectionRadii({ ...layout, centerLabelRadius: layout.radius });
    expect(swamped.inner).toBeCloseTo(layout.radius - 1, 3);
    expect(swamped.inner).toBeLessThan(swamped.outer);
  });

  it('draws each radial edge as a line spanning exactly the wedge, capped by an inward triangle outside the ring', () => {
    const layout = computeMapLayout(circular());
    const { inner, outer } = circularSelectionRadii(layout);
    const edge = circularSelectionEdgePath(layout, 500);
    const num = '(-?[\\d.]+) (-?[\\d.]+)';
    const shape = new RegExp(`^M ${num} L ${num} M ${num} L ${num} L ${num} Z$`).exec(edge);
    expect(shape).not.toBeNull();
    const radii = radiiOf(edge, layout);
    // The line: inner arc to outer arc.
    expect(radii[0]).toBeCloseTo(inner, 0);
    expect(radii[1]).toBeCloseTo(outer, 0);
    // The triangle: its tip on the line's outer end, its base outside the ring.
    expect(radii[2]).toBeCloseTo(outer, 0);
    expect(radii[3]).toBeGreaterThan(outer + 6);
    expect(radii[4]).toBeGreaterThan(outer + 6);
    const n = shape!.slice(1).map(Number);
    const base = Math.hypot(n[6] - n[8], n[7] - n[9]);
    const height = Math.hypot((n[6] + n[8]) / 2 - n[4], (n[7] + n[9]) / 2 - n[5]);
    expect(base).toBeGreaterThanOrEqual(8);
    expect(base).toBeLessThanOrEqual(12);
    expect(height).toBeGreaterThanOrEqual(7);
    expect(height).toBeLessThanOrEqual(11);
    // Pointing inward: the base midpoint lies farther from the centre than the tip.
    const baseMid = Math.hypot((n[6] + n[8]) / 2 - layout.center.x, (n[7] + n[9]) / 2 - layout.center.y);
    expect(baseMid).toBeGreaterThan(radii[2]);
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
  /** The boundary line: the first subpath (the triangle marker follows it). */
  function lineOf(path: string): { x: number; y1: number; y2: number } {
    const n = path.split(' M ')[0].match(/-?\d+(?:\.\d+)?/g)!.map(Number);
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

  it('stops the boundaries at the band when asked to reach only the ruler', () => {
    const layout = computeMapLayout(linear());
    const [band] = selectionOverlayPaths(layout, [{ start: 500, end: 2500 }]);
    const { x0, x1 } = bandX(band);
    const edges = linearSelectionEdgePaths(layout, band, 'band').map(lineOf);
    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => edge.x)).toEqual([x0, x1]);
    for (const { y1, y2 } of edges) {
      expect(Math.min(y1, y2)).toBe(Math.round((layout.center.y - 9) * 1000) / 1000);
      expect(Math.max(y1, y2)).toBe(Math.round((layout.center.y + 9) * 1000) / 1000);
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

  it('keeps the single-base minimum band width, and marks it with one line, not two 3px apart', () => {
    const layout = computeMapLayout(linear());
    const [band] = selectionOverlayPaths(layout, [{ start: 1500, end: 1501 }]);
    const [, x0, x1] = /^M ([\d.-]+) [\d.-]+ L ([\d.-]+)/.exec(band)!.map(Number);
    expect(x1 - x0).toBeGreaterThanOrEqual(3);
    const edges = linearSelectionEdgePaths(layout, band).map(lineOf);
    expect(edges).toHaveLength(1);
    expect(edges[0].x).toBeCloseTo((x0 + x1) / 2, 2);
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

describe('the linear boundary marker', () => {
  it('caps each boundary line with a filled triangle on the backbone, pointing at it', () => {
    const layout = computeMapLayout(linear());
    const [band] = selectionOverlayPaths(layout, [{ start: 500, end: 2500 }]);
    const r = (v: number) => Math.round(v * 1000) / 1000;
    for (const reach of ['grid', 'band'] as const) {
      const edges = linearSelectionEdgePaths(layout, band, reach);
      expect(edges).toHaveLength(2);
      for (const edge of edges) {
        const m = /^M (-?[\d.]+) -?[\d.]+ L -?[\d.]+ -?[\d.]+ M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+) Z$/.exec(edge);
        expect(m, edge).not.toBeNull();
        const [x, tipX, tipY, ax, ay, bx, by] = m!.slice(1).map(Number);
        // The tip sits on the backbone at the boundary's own x.
        expect(tipX).toBe(x);
        expect(tipY).toBe(r(layout.center.y));
        // The base lies flat below it, inside the band, clear of the ruler
        // numerals above the backbone: the ring marker's 9 by 10.
        expect(ay).toBe(by);
        expect(ay).toBe(r(layout.center.y + 9));
        expect(bx - ax).toBe(10);
        expect((ax + bx) / 2).toBeCloseTo(x, 3);
      }
    }
  });
});

describe('a linear span too narrow to tell two edges apart', () => {
  it('draws one edge line through its middle, not two lines 3px apart', () => {
    const layout = computeMapLayout(linear());
    const [band] = selectionOverlayPaths(layout, [{ start: 1000, end: 1001 }]);
    const edges = linearSelectionEdgePaths(layout, band, 'band');
    expect(edges).toHaveLength(1);
    const wide = linearSelectionEdgePaths(layout, selectionOverlayPaths(layout, [{ start: 500, end: 2500 }])[0], 'band');
    expect(wide).toHaveLength(2);
  });
});

describe('a selection fades away from the backbone', () => {
  /** The gradient's opacity at one offset, padded past its first and last stops. */
  function opacityAt(gradient: SelectionFadeGradient, offset: number): number {
    const stops = gradient.stops;
    if (offset <= stops[0].offset) return stops[0].opacity;
    for (let i = 1; i < stops.length; i += 1) {
      const [a, b] = [stops[i - 1], stops[i]];
      if (offset <= b.offset) return a.opacity + ((b.opacity - a.opacity) * (offset - a.offset)) / (b.offset - a.offset);
    }
    return stops[stops.length - 1].opacity;
  }

  it('fades each circular end line from full at the ring to 0.15 at its inner end, its marker solid', () => {
    const layout = computeMapLayout({ ...circular(), features: [{ id: 'f', name: 'f', type: 'gene', start: 100, end: 900, strand: 1, color: '#888', metadata: {} }] });
    const fade = selectionFadeGradients(layout)!;
    const edge = fade.edge;
    expect(edge.kind).toBe('radial');
    if (edge.kind !== 'radial') return;
    expect([edge.cx, edge.cy]).toEqual([layout.center.x, layout.center.y]);
    const { inner, outer } = circularSelectionRadii(layout);
    const at = (r: number) => opacityAt(edge, r / edge.r);
    // The line runs from the outer arc (just past the ring) in to the inner arc.
    expect(at(outer)).toBe(1);
    expect(at(layout.radius)).toBeCloseTo(1, 3);
    expect(at(inner)).toBeCloseTo(0.15, 3);
    const half = at((inner + outer) / 2);
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(0.65);
    // The marker sits from the outer arc outward: solid all the way.
    expect(at(outer + 9)).toBe(1);
    // The wash eases from full (0.06 at the CSS opacity) at the ring to the share
    // the lines end at, so the wedge's inner arc dissolves into the canvas.
    expect(inner).toBeCloseTo(layout.radius / 3, 3);
    expect(opacityAt(fade.wash, inner / edge.r)).toBeCloseTo(0.15, 3);
    expect(opacityAt(fade.wash, layout.radius / edge.r)).toBeCloseTo(1, 3);
  });

  it('fades each linear boundary line downward from the backbone, solid over the band and the marker', () => {
    const layout = computeMapLayout(linear());
    const fade = selectionFadeGradients(layout)!;
    const edge = fade.edge;
    expect(edge.kind).toBe('linear');
    if (edge.kind !== 'linear') return;
    const extent = coordinateGridExtent(layout)!;
    expect([edge.x1, edge.x2, edge.y1, edge.y2]).toEqual([0, 0, layout.center.y, Math.round(extent.bottom * 1000) / 1000]);
    const span = edge.y2 - edge.y1;
    const at = (y: number) => opacityAt(edge, (y - edge.y1) / span);
    expect(at(layout.center.y - 9)).toBe(1);
    expect(at(layout.center.y + 9)).toBeCloseTo(1, 3);
    expect(at(edge.y2)).toBeCloseTo(0.15, 3);
    expect(opacityAt(fade.wash, 1)).toBeCloseTo(0.5, 3);
  });

  it('draws no fade for a linear layout whose lines stop at the band', () => {
    const layout = computeMapLayout(linear());
    expect(selectionFadeGradients({ ...layout, coordinates: layout.coordinates.map((c) => ({ ...c, grid: undefined })) })).toBeNull();
  });
});
