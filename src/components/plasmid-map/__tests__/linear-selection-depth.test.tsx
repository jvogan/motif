// @vitest-environment jsdom

/**
 * A linear selection used to mark the ruler and nothing else: an 18px band on the
 * axis over a drawing that runs to the bottom of the feature rows. SequenceMapView
 * now draws each span's two boundaries down to the depth the coordinate gridlines
 * reach, so the restriction band and the feature rows the same bases pass through
 * are inside something the reader can see.
 *
 * The boundaries go in their own group. The artifact styles a circular selection's
 * radial edges with :nth-child(3n + 2) and (3n + 3) over the selection layer's
 * children, and a fourth path in that layer would shift every span's triplet.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SequenceMapView } from '../SequenceMapView';
import { computeMapLayout } from '../../../plasmid-map/layout';
import {
  linearSelectionColumnPath,
  linearSelectionEdgePaths,
  selectionOverlayPaths,
} from '../../../plasmid-map/selection-overlay';
import { projectRangeOverlays } from '../../../plasmid-map/range-overlays';
import type { MapInput, MapLayout } from '../../../plasmid-map/types';

const here = dirname(fileURLToPath(import.meta.url));
const mapCss = readFileSync(resolve(here, '..', 'plasmid-map.css'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', '..', '..', 'artifacts', 'motif-artifact.css'), 'utf8');

const base: MapInput = {
  mode: 'linear',
  name: 'selection depth fixture',
  length: 2686,
  topology: 'linear',
  sequenceType: 'dna',
  features: [
    { id: 'f1', name: 'AmpR', type: 'resistance', start: 300, end: 900, strand: 1, color: '#888', metadata: {} },
    { id: 'f2', name: 'ori', type: 'origin', start: 1200, end: 1800, strand: 1, color: '#888', metadata: {} },
  ],
  restrictionSites: [
    { enzyme: 'EcoRI', position: 700, cutPosition: 701, recognitionSequence: 'GAATTC', overhang: '5prime' },
    { enzyme: 'HindIII', position: 1500, cutPosition: 1501, recognitionSequence: 'AAGCTT', overhang: '5prime' },
  ],
  width: 900,
  height: 320,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(layout: MapLayout, selectionPaths: readonly string[], selectedFeatureId?: string): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <SequenceMapView layout={layout} theme="light" interactive selectionPaths={selectionPaths} selectedFeatureId={selectedFeatureId} />,
    );
  });
  return host;
}

/** The y of every coordinate pair in a path of `M`/`L` commands. */
function ysOf(d: string): number[] {
  const n = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  return n.filter((_, index) => index % 2 === 1);
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('a linear selection reaches the depth the gridlines do', () => {
  it('draws both boundaries to the bottom of the coordinate gridlines', () => {
    const layout = computeMapLayout(base);
    const paths = selectionOverlayPaths(layout, [{ start: 600, end: 1600 }]);
    const el = render(layout, paths);

    const band = el.querySelector<SVGPathElement>('.motif-pm-selection-layer .motif-pm-selection');
    expect(band).not.toBeNull();
    const edges = [...el.querySelectorAll<SVGPathElement>('.motif-pm-selection-edges .motif-pm-selection-edge')];
    expect(edges).toHaveLength(2);

    const gridBottom = Math.max(...layout.coordinates.flatMap((c) => (c.grid ? [c.grid.y2] : [])));
    const bandBottom = Math.max(...ysOf(band!.getAttribute('d')!));
    // The point of the change: the band stops far short of where the gridlines do.
    expect(gridBottom - bandBottom).toBeGreaterThan(50);
    for (const edge of edges) {
      expect(Math.max(...ysOf(edge.getAttribute('d')!))).toBe(gridBottom);
    }
  });

  it('spans the wash over the extent the boundary lines reach, as one column', () => {
    // The app draws linearSelectionColumnPath: the wash runs from the top of the
    // ruler band to the bottom of the gridlines, where the lines end, not just the
    // 18px band, so the selected stretch reads as one column.
    const layout = computeMapLayout(base);
    const band = selectionOverlayPaths(layout, [{ start: 600, end: 1600 }]);
    const column = band.map((d) => linearSelectionColumnPath(layout, d));
    const el = render(layout, column);
    const wash = el.querySelector<SVGPathElement>('.motif-pm-selection-layer .motif-pm-selection');
    expect(wash).not.toBeNull();
    const washYs = ysOf(wash!.getAttribute('d')!);
    const gridBottom = Math.max(...layout.coordinates.flatMap((c) => (c.grid ? [c.grid.y2] : [])));
    const bandTop = Math.min(...ysOf(band[0]));
    expect(Math.min(...washYs)).toBe(bandTop);
    expect(Math.max(...washYs)).toBe(gridBottom);
    // Same x as the band, so the lines read back from the column are unchanged.
    const edges = [...el.querySelectorAll<SVGPathElement>('.motif-pm-selection-edges .motif-pm-selection-edge')];
    expect(edges.map((e) => e.getAttribute('d'))).toEqual(linearSelectionEdgePaths(layout, band[0]));
    for (const edge of edges) {
      const lineYs = ysOf(edge.getAttribute('d')!).slice(0, 2);
      expect([Math.min(...lineYs), Math.max(...lineYs)]).toEqual([Math.min(...washYs), Math.max(...washYs)]);
    }
    // A selected feature's lines stop at the band, and so does its wash.
    expect(linearSelectionColumnPath(layout, band[0], 'band')).toBe(band[0]);
    // A circular sector is not a band and comes back untouched.
    const circular = computeMapLayout({ ...base, mode: 'circular', topology: 'circular', width: 600, height: 600 });
    const sector = selectionOverlayPaths(circular, [{ start: 600, end: 1600 }])[0];
    expect(linearSelectionColumnPath(circular, sector)).toBe(sector);
  });

  it('stops a selected feature\'s boundaries at the ruler band and keeps its tint', () => {
    // The feature's own outline already says which row it is, so its boundaries
    // need not cross every lane. A dragged range keeps them full height (above).
    const layout = computeMapLayout(base);
    const paths = selectionOverlayPaths(layout, [{ start: 300, end: 900 }]);
    const el = render(layout, paths, 'f1');
    const band = el.querySelector<SVGPathElement>('.motif-pm-selection-layer .motif-pm-selection');
    expect(band).not.toBeNull();
    const bandYs = ysOf(band!.getAttribute('d')!);
    const edges = [...el.querySelectorAll<SVGPathElement>('.motif-pm-selection-edges .motif-pm-selection-edge')];
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      const ys = ysOf(edge.getAttribute('d')!);
      expect(Math.min(...ys)).toBe(Math.min(...bandYs));
      expect(Math.max(...ys)).toBe(Math.max(...bandYs));
    }
  });

  it('paints the boundaries before the names they run past', () => {
    const layout = computeMapLayout(base);
    const el = render(layout, selectionOverlayPaths(layout, [{ start: 600, end: 1600 }]));
    const groups = [...el.querySelectorAll('svg.motif-plasmid-map .motif-pm-viewport > g')]
      .map((g) => g.getAttribute('class'));
    const edges = groups.indexOf('motif-pm-selection-edges');
    expect(edges).toBeGreaterThan(-1);
    // Under the coordinate numbers, the feature labels and the enzyme names, so a
    // boundary passes behind a glyph rather than through it.
    for (const later of ['motif-pm-coords', 'motif-pm-features', 'motif-pm-restrictions']) {
      expect(groups.indexOf(later), later).toBeGreaterThan(edges);
    }
  });

  it('leaves range overlays on the axis, where the same band code puts them', () => {
    // selectionOverlayPaths draws both the sequence selection and every range
    // overlay -- a motif match, an ORF, a saved highlight. Carrying the depth in
    // the view rather than in that function is what keeps a motif search with
    // fifty matches from painting fifty full-depth columns.
    const layout = computeMapLayout(base);
    const overlays = projectRangeOverlays(layout, [
      { id: 'o1', kind: 'motif', label: 'hit', color: '#3366cc', ranges: [{ start: 600, end: 700 }] },
    ]);
    expect(overlays).toHaveLength(1);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<SequenceMapView layout={layout} theme="light" interactive rangeOverlays={overlays} />);
    });
    expect(host.querySelectorAll('.motif-pm-range-overlay-shape')).toHaveLength(1);
    expect(host.querySelectorAll('.motif-pm-selection-edge')).toHaveLength(0);
  });

  it('adds nothing to the selection layer a circular map counts in threes', () => {
    const circular = computeMapLayout({ ...base, mode: 'circular', topology: 'circular', width: 600, height: 600 });
    const paths = selectionOverlayPaths(circular, [{ start: 600, end: 1600 }]);
    const el = render(circular, paths);
    expect(el.querySelectorAll('.motif-pm-selection-edges')).toHaveLength(0);
    expect(el.querySelectorAll('.motif-pm-selection-layer > *')).toHaveLength(paths.length);
  });

  it('gives the boundaries the primary text colour rather than the gridline border tone', () => {
    // The lines are read against a field of coordinate gridlines. Those draw
    // --border under stroke-opacity, so a boundary in the same paint at the same
    // weight would be one more guide rather than the edge of a selection. The
    // map's only host draws it in .motif-cs-map-frame, where the artifact's
    // rule, shared with the circular map's end lines, outranks this sheet's.
    const ruleAt = artifactCss.indexOf('.motif-cs-map-frame .motif-pm-selection-edges .motif-pm-selection-edge {');
    expect(ruleAt).toBeGreaterThan(-1);
    const body = artifactCss.slice(ruleAt, artifactCss.indexOf('}', ruleAt) + 1);
    // Through the fade gradient (text-colour stops, solid at the backbone);
    // the solid text colour where there is none.
    expect(body).toMatch(/stroke:\s*var\(--motif-selection-edge-paint, var\(--text-primary\)\);/);
    // The circular map's weight, at full strength: the text colour marks the
    // boundary, and 1.5px keeps it a line rather than a bar.
    expect(body).toMatch(/stroke-width:\s*1\.5;/);
    expect(body).toMatch(/stroke-opacity:\s*1;/);
    // The path's closed triangle at the backbone is filled in the same colour.
    expect(body).toMatch(/fill:\s*var\(--text-primary\);/);
    expect(body).toMatch(/fill-opacity:\s*1;/);
    // Antialiased: 1.5px under crispEdges paints 1 column at some x and 2 at
    // others, so one selection could draw its two ends unequally.
    expect(body).toMatch(/shape-rendering:\s*auto;/);
    const grid = mapCss.slice(mapCss.indexOf('.motif-pm-coord-grid {'));
    expect(grid.slice(0, grid.indexOf('}') + 1)).toMatch(/stroke-opacity:\s*0\.5;/);

    // Each boundary path carries that triangle: tip on the backbone, closed.
    const layout = computeMapLayout(base);
    const el = render(layout, selectionOverlayPaths(layout, [{ start: 600, end: 1600 }]));
    const edges = [...el.querySelectorAll<SVGPathElement>('.motif-pm-selection-edges .motif-pm-selection-edge')];
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      const d = edge.getAttribute('d')!;
      const triangle = d.slice(d.lastIndexOf('M'));
      expect(triangle).toMatch(/Z$/);
      const ys = ysOf(triangle);
      expect(ys).toHaveLength(3);
      expect(Math.min(...ys)).toBeCloseTo(layout.center.y, 1);
    }
  });

  it('keeps a system colour for the boundaries under forced colors', () => {
    const forced = mapCss.slice(mapCss.indexOf('@media (forced-colors: active)'));
    const rule = forced.slice(forced.indexOf('.motif-pm-selection-edge {'));
    expect(rule.slice(0, rule.indexOf('}') + 1)).toMatch(/stroke:\s*Highlight;/);
  });
});
