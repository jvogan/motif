// @vitest-environment jsdom

/**
 * Zooming a circular map magnifies the drawing, and its words stop growing at 1.6x their
 * fitted size. Only enzyme names used to stop: feature names, coordinate numbers and the
 * centre title grew with the zoom, to 99.5px, 99.5px and 93px at 8x against 19.9px enzyme
 * names (the bundled pUC19 at 1440x900, measured before this change). Each is now scaled back about
 * a point that keeps it where it belongs: a leader's end, its own anchor, its tick, or the
 * ring's centre.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SequenceMapView } from '../SequenceMapView';
import { computeMapLayout } from '../../../plasmid-map/layout';
import type { MapLayout, MapMode } from '../../../plasmid-map/types';
import type { Feature } from '../../../bio/types';

function gene(name: string, start: number, end: number): Feature {
  return { id: name, name, type: 'cds', start, end, strand: 1, color: '#8a8a8a', metadata: {} };
}

function layoutFor(mode: MapMode): MapLayout {
  return computeMapLayout({
    mode,
    name: 'zoom text fixture',
    length: 4000,
    topology: 'circular',
    sequenceType: 'dna',
    features: [
      // Long enough to carry its name on its own arc.
      gene('long backbone gene', 200, 1900),
      // Four neighbours too close to name in place: each gets a leader.
      gene('promoter one', 2400, 2420),
      gene('promoter two', 2430, 2450),
      gene('operator three', 2460, 2480),
      gene('binding site four', 2490, 2510),
      // Alone, and named beside itself with no leader.
      gene('tiny', 3200, 3230),
    ],
    restrictionSites: [{ enzyme: 'EcoRI', position: 1000, cutPosition: 1001, recognitionSequence: 'GAATTC', overhang: '5prime' }],
    width: mode === 'circular' ? 800 : 1200,
    height: mode === 'circular' ? 800 : 420,
  });
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(layout: MapLayout, k: number) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<SequenceMapView layout={layout} theme="light" viewport={{ k, tx: 0, ty: 0 }} />));
}

/** The point and factor of `translate(x y) scale(s) translate(-x -y)` at the start of a transform. */
function scaleAbout(transform: string | null): { x: number; y: number; s: number } | null {
  const m = transform?.match(/^translate\((-?[\d.e-]+) (-?[\d.e-]+)\) scale\(([\d.e-]+)\) translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/);
  if (!m) return null;
  const [x, y, s, nx, ny] = m.slice(1).map(Number);
  expect(nx).toBeCloseTo(-x, 9);
  expect(ny).toBeCloseTo(-y, 9);
  return { x, y, s };
}

function featureGroup(id: string): SVGGElement {
  const group = host!.querySelector<SVGGElement>(`.motif-pm-feature[data-feature-id="${id}"]`);
  expect(group, `feature ${id} is not drawn`).not.toBeNull();
  return group!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('circular map text at zoom', () => {
  it('holds every kind of feature name at 1.6x, anchored where it was drawn', () => {
    const layout = layoutFor('circular');
    render(layout, 8);
    const byId = new Map(layout.features.map((feature) => [feature.id, feature]));

    // A name at the end of a leader shrinks toward that end; the leader keeps its geometry.
    const leadered = layout.features.filter((feature) => feature.label && !feature.label.arcPath && feature.label.leader.length > 1);
    expect(leadered.map((feature) => feature.id).sort()).toEqual(['binding site four', 'operator three', 'promoter one', 'promoter two']);
    for (const feature of leadered) {
      const group = featureGroup(feature.id);
      const end = feature.label!.leader[feature.label!.leader.length - 1];
      const about = scaleAbout(group.querySelector('.motif-pm-feature-label')!.getAttribute('transform'));
      expect(about, `${feature.id} is not counter-scaled`).not.toBeNull();
      expect(about!.s).toBeCloseTo(0.2, 9);
      expect(about!.x).toBeCloseTo(end.x, 9);
      expect(about!.y).toBeCloseTo(end.y, 9);
      expect(group.querySelector('.motif-pm-leader')!.getAttribute('transform')).toBeNull();
      expect(group.querySelector('.motif-pm-feature-annotation')!.getAttribute('transform')).toBeNull();
    }

    // A name with no leader shrinks about its own anchor.
    const tiny = byId.get('tiny')!;
    expect(tiny.label?.arcPath).toBeFalsy();
    expect(tiny.label?.leader.length ?? 0).toBeLessThan(2);
    const tinyAbout = scaleAbout(featureGroup('tiny').querySelector('.motif-pm-feature-label')!.getAttribute('transform'));
    expect(tinyAbout).toEqual({ x: tiny.label!.x, y: tiny.label!.y, s: 0.2 });

    // A name on its arc keeps its place on the arc and shrinks its font instead.
    const arc = featureGroup('long backbone gene');
    expect(byId.get('long backbone gene')!.label?.arcPath).toBeTruthy();
    const arcAnnotation = arc.querySelector<SVGGElement>('.motif-pm-feature-annotation')!;
    expect(arcAnnotation.style.getPropertyValue('--pm-zoom-text-scale')).toBe('0.2');
    expect(arc.querySelector('.motif-pm-feature-label')!.getAttribute('transform')).toBeNull();
  });

  it('holds the coordinate numbers and the centre title at 1.6x', () => {
    const layout = layoutFor('circular');
    render(layout, 8);

    const labelled = layout.coordinates.filter((coord) => coord.label);
    const numbers = [...host!.querySelectorAll('.motif-pm-coord-label')];
    expect(numbers).toHaveLength(labelled.length);
    expect(numbers.length).toBeGreaterThan(3);
    labelled.forEach((coord, i) => {
      const about = scaleAbout(numbers[i].getAttribute('transform'));
      expect(about, `coordinate ${coord.bp} is not counter-scaled`).not.toBeNull();
      expect(about!.s).toBeCloseTo(0.2, 9);
      // About one end of its own tick, so the number stays beside it.
      const ends = [[coord.tick.x1, coord.tick.y1], [coord.tick.x2, coord.tick.y2]];
      expect(ends.some(([x, y]) => Math.abs(x - about!.x) < 1e-9 && Math.abs(y - about!.y) < 1e-9)).toBe(true);
    });

    const center = scaleAbout(host!.querySelector('.motif-pm-center')!.getAttribute('transform'));
    expect(center).toEqual({ x: layout.center.x, y: layout.center.y, s: 0.2 });
  });

  it('grows with the zoom up to the cap and leaves Fit and linear maps alone', () => {
    const circular = layoutFor('circular');
    // 1.25x is under the cap: nothing is counter-scaled yet.
    render(circular, 1.25);
    expect(host!.querySelectorAll('[data-semantic-scale]')).toHaveLength(0);
    expect(host!.querySelector('.motif-pm-center')!.getAttribute('transform')).toBeNull();
    act(() => root!.unmount());
    host!.remove();

    // 3.2x is twice the cap: every name is drawn at half its zoomed size.
    render(circular, 3.2);
    expect(scaleAbout(host!.querySelector('.motif-pm-center')!.getAttribute('transform'))!.s).toBeCloseTo(0.5, 9);
    expect(scaleAbout(featureGroup('tiny').querySelector('.motif-pm-feature-label')!.getAttribute('transform'))!.s).toBeCloseTo(0.5, 9);
    act(() => root!.unmount());
    host!.remove();

    // A linear map is not capped here; its zoom wants a re-layout, not a counter-scale.
    render(layoutFor('linear'), 8);
    const transforms = [...host!.querySelectorAll('.motif-pm-feature-label, .motif-pm-coord-label')]
      .map((text) => text.getAttribute('transform'))
      .filter((transform) => transform && transform.includes('scale('));
    expect(transforms).toEqual([]);
    expect(host!.querySelectorAll('[data-semantic-scale]')).toHaveLength(0);
  });

  it('sizes an arc name from the factor its group carries', () => {
    // jsdom does not resolve the stylesheet, so read the rule the factor feeds. Without it
    // the arc name keeps 16px and grows with the zoom while every other name holds.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'plasmid-map.css'), 'utf8');
    const rule = css.slice(css.indexOf('\n.motif-pm-feature-label {'), css.indexOf('}', css.indexOf('\n.motif-pm-feature-label {')));
    expect(rule).toMatch(/font-size:\s*calc\(16px \* var\(--pm-zoom-text-scale, 1\)\)/);
  });
});
