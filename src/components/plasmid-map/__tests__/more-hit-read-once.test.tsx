// @vitest-environment jsdom

/**
 * A circular map's "+N" tails each get an invisible press square (more-hit-area).
 * Placing the squares reads the whole drawn map. Each mark with a multi-enzyme
 * label used to read it for itself, 19 reads a commit on pBR322; the map now
 * reads it once per commit and hands every mark its own square.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SequenceMapView } from '../SequenceMapView';
import { computeMapLayout } from '../../../plasmid-map/layout';
import { measureMoreHitSquares } from '../../../plasmid-map/more-hit-area';
import type { MapLayout, RestrictionSite } from '../../../plasmid-map/types';

vi.mock('../../../plasmid-map/more-hit-area', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../plasmid-map/more-hit-area')>();
  return { ...actual, measureMoreHitSquares: vi.fn(() => new Map()) };
});
const measure = vi.mocked(measureMoreHitSquares);

function site(enzyme: string, position: number): RestrictionSite {
  return { enzyme, position, cutPosition: position + 1, recognitionSequence: 'GACGTC', overhang: 'blunt' };
}

const CROWD = ['AatII', 'AflIII', 'BsiHKAI', 'Eco53kI', 'HincII', 'AhdI', 'BstZ17I', 'DrdI'];

// Three crowded clusters; two or more of their labels end in a "+N" tail.
function layoutFor(size = 600): MapLayout {
  return computeMapLayout({
    mode: 'circular',
    name: 'tail fixture',
    length: 6000,
    topology: 'circular',
    sequenceType: 'dna',
    features: [],
    restrictionSites: [1000, 3000, 5000].flatMap((start) => CROWD.map((enzyme, i) => site(enzyme, start + i * 4))),
    width: size,
    height: size,
  });
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function view(layout: MapLayout, activeClusterId: string | null = null) {
  return (
    <SequenceMapView
      layout={layout}
      theme="light"
      interactive
      activeClusterId={activeClusterId}
      onRestrictionClick={() => {}}
      onRestrictionMenu={() => {}}
    />
  );
}

function tailCount(): number {
  return host!.querySelectorAll('.motif-pm-restriction-label [data-label-more]').length;
}

function tailed(layout: MapLayout) {
  return layout.restrictions.filter((restriction) => / \+\d*$/.test(restriction.label?.text ?? ''));
}

beforeEach(() => {
  measure.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('the "+N" press squares', () => {
  it('read the drawn map once per commit, however many tails it draws', () => {
    const layout = layoutFor();
    act(() => root!.render(view(layout)));
    expect(tailed(layout).length, 'the fixture has more than one tail').toBeGreaterThan(1);
    expect(tailCount()).toBe(tailed(layout).length);
    expect(measure).toHaveBeenCalledTimes(1);

    // A new layout (a resize, a record switch) is one more read, not one per tail.
    const resized = layoutFor(640);
    act(() => root!.render(view(resized)));
    expect(tailCount()).toBe(tailed(resized).length);
    expect(tailCount()).toBeGreaterThan(1);
    expect(measure).toHaveBeenCalledTimes(2);

    // A commit that moves nothing on the map reads nothing.
    act(() => root!.render(view(resized, 'none')));
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('draws each mark its own square, only on a mark with a tail', () => {
    const layout = layoutFor();
    const withTail = tailed(layout);
    const [first] = withTail;
    const untailed = layout.restrictions.find((restriction) => !withTail.includes(restriction));
    expect(untailed, 'a mark without a tail').toBeDefined();
    const squares = new Map([[first.clusterId, { x: 11, y: 22, width: 33, height: 44 }]]);
    if (untailed) squares.set(untailed.clusterId, { x: 1, y: 2, width: 3, height: 4 });
    measure.mockImplementation(() => squares);
    act(() => root!.render(view(layout)));

    const drawn = [...host!.querySelectorAll('.motif-pm-restriction-more-hit')];
    expect(drawn).toHaveLength(1);
    expect(drawn[0].closest<SVGGElement>('.motif-pm-restriction')?.dataset.clusterId).toBe(first.clusterId);
    expect(['x', 'y', 'width', 'height'].map((name) => drawn[0].getAttribute(name))).toEqual(['11', '22', '33', '44']);
  });
});
