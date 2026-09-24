// @vitest-environment jsdom

/**
 * Arrow keys through the map's features and sites. The roving order used to be the
 * record's feature list, then every site: on a record whose features were not listed
 * by position, ArrowRight went backward around the ring, and the sites began a second
 * lap after the last feature. One lap now visits every item in the order of the start
 * each one's name announces, and the items still paint in layout order.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SequenceMapView } from '../SequenceMapView';
import { computeMapLayout } from '../../../plasmid-map/layout';
import type { MapInput, MapLayout, MapMode, RestrictionSite } from '../../../plasmid-map/types';
import type { Feature } from '../../../bio/types';

function gene(id: string, start: number, end: number, strand: 1 | -1): Feature {
  return { id, name: `${id} gene`, type: 'cds', start, end, strand, color: '#8a8a8a', metadata: {} };
}

function site(enzyme: string, position: number, recognitionSequence: string): RestrictionSite {
  return { enzyme, position, cutPosition: position + 1, recognitionSequence, overhang: '5prime' };
}

function layoutFor(mode: MapMode): MapLayout {
  const input: MapInput = {
    mode,
    name: 'keyboard order fixture',
    length: 4000,
    topology: mode,
    sequenceType: 'dna',
    // Listed out of position order on purpose, the way records arrive. `inner` sits
    // inside `early`: it starts later and ends sooner, so its midpoint (175) comes
    // before early's (250) while its start comes after.
    features: [
      gene('late', 2000, 2400, 1),
      gene('inner', 150, 200, 1),
      gene('early', 100, 400, 1),
      gene('middle', 1000, 1200, -1),
    ],
    restrictionSites: [
      site('EcoRI', 50, 'GAATTC'),
      site('BamHI', 1500, 'GGATCC'),
      site('HindIII', 3000, 'AAGCTT'),
    ],
    width: mode === 'circular' ? 800 : 1200,
    height: mode === 'circular' ? 800 : 420,
  };
  return computeMapLayout(input);
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(layout: MapLayout) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<SequenceMapView layout={layout} theme="light" interactive />));
}

function press(key: string) {
  const target = document.activeElement!;
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
}

/** Home, then ArrowRight once per item: the name of every stop, and where the lap ends. */
function walk(): { stops: string[]; wrappedTo: string | null } {
  const items = host!.querySelectorAll('svg [data-map-interaction-index]');
  const start = host!.querySelector<SVGGElement>('svg [data-map-interaction-index][tabindex="0"]');
  expect(start, 'no map item holds the roving tab stop').not.toBeNull();
  act(() => start!.focus());
  expect(document.activeElement, 'focus did not reach the map').toBe(start);
  press('Home');
  const stops: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    expect(document.activeElement!.hasAttribute('data-map-interaction-index'), 'focus left the map').toBe(true);
    stops.push(document.activeElement!.getAttribute('aria-label')!.split(/ · |, /)[0]);
    press('ArrowRight');
  }
  return { stops, wrappedTo: document.activeElement!.getAttribute('aria-label')!.split(/ · |, /)[0] };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('map keyboard order', () => {
  for (const mode of ['circular', 'linear'] as const) {
    it(`walks a ${mode} map's features and sites in position order in one lap`, () => {
      const layout = layoutFor(mode);
      expect(layout.features.filter((feature) => feature.segmentPaths.length > 0)).toHaveLength(4);
      expect(layout.restrictions).toHaveLength(3);
      render(layout);

      const { stops, wrappedTo } = walk();
      // The starts a screen reader announces climb: 51, 101, 151, 1,001, 1,501, 2,001, 3,001.
      expect(stops).toEqual(['EcoRI', 'early gene', 'inner gene', 'middle gene', 'BamHI', 'late gene', 'HindIII']);
      expect(wrappedTo).toBe('EcoRI');

      // ArrowLeft retraces the same order, and End lands on the last position.
      press('ArrowLeft');
      expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^HindIII,/);
      press('ArrowLeft');
      expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^late gene · /);
      press('Home');
      press('End');
      expect(document.activeElement!.getAttribute('aria-label')).toMatch(/^HindIII,/);
    });
  }

  it('keeps painting features in layout order', () => {
    const layout = layoutFor('circular');
    render(layout);
    const painted = [...host!.querySelectorAll<SVGGElement>('.motif-pm-feature')].map((group) => group.dataset.featureId);
    expect(painted).toEqual(layout.features.map((feature) => feature.id));
    expect(painted).not.toEqual(['early', 'inner', 'middle', 'late']);
  });
});
