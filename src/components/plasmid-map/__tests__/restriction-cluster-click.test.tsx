// @vitest-environment jsdom

/**
 * A crowded restriction cluster's label names its first few enzymes and folds the rest
 * into "+N". Clicking "HindIII" in "HindIII +13" on pUC19 used to select all 14 enzymes
 * and 17 sites under it, and the selection bar read "HindIII +13 site". A press on a
 * name now selects that enzyme; the tail, the tick and Enter ask the host for the list.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SequenceMapView } from '../SequenceMapView';
import { computeMapLayout } from '../../../plasmid-map/layout';
import {
  restrictionClusterEnzymes,
  restrictionLabelTokenEnzyme,
  restrictionLabelTokens,
} from '../../../plasmid-map/restriction-display';
import type { MapInput, MapLayout, RestrictionSite } from '../../../plasmid-map/types';

function site(enzyme: string, position: number): RestrictionSite {
  return { enzyme, position, cutPosition: position + 1, recognitionSequence: 'GACGTC', overhang: 'blunt' };
}

const CROWD = ['AatII', 'AflIII', 'BsiHKAI', 'Eco53kI', 'HincII', 'AhdI', 'BstZ17I', 'DrdI', 'PshAI', 'XcmI'];

function layoutFor(mode: 'circular' | 'linear'): MapLayout {
  const input: MapInput = {
    mode,
    name: 'cluster click fixture',
    length: 6000,
    topology: mode,
    sequenceType: 'dna',
    features: [],
    restrictionSites: [
      // AatII cuts twice inside the crowd, so its own selection is two sites.
      site('AatII', 998),
      ...CROWD.map((enzyme, i) => site(enzyme, 1000 + i * 4)),
      site('EcoRI', 3000),
    ],
    width: mode === 'circular' ? 600 : 1000,
    height: mode === 'circular' ? 600 : 420,
  };
  return computeMapLayout(input);
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(layout: MapLayout, withMenu = true) {
  const onRestrictionClick = vi.fn();
  const onRestrictionMenu = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <SequenceMapView
        layout={layout}
        theme="light"
        interactive
        onRestrictionClick={onRestrictionClick}
        onRestrictionMenu={withMenu ? onRestrictionMenu : undefined}
      />,
    );
  });
  return { onRestrictionClick, onRestrictionMenu };
}

function crowdGroup(layout: MapLayout): SVGGElement {
  const crowd = layout.restrictions.find((restriction) => restriction.tickIds.length > 5)!;
  expect(crowd, 'the crowded cluster').toBeDefined();
  expect(crowd.label?.text, 'the crowd label has a "+N" tail').toMatch(/ \+\d+$/);
  const group = [...host!.querySelectorAll<SVGGElement>('.motif-pm-restriction')]
    .find((element) => element.dataset.clusterId === crowd.clusterId);
  expect(group).toBeDefined();
  return group!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('clicking a restriction cluster label', () => {
  it.each(['circular', 'linear'] as const)('selects the one enzyme a %s label name was clicked on', (mode) => {
    const layout = layoutFor(mode);
    const { onRestrictionClick, onRestrictionMenu } = render(layout);
    const group = crowdGroup(layout);
    const name = group.querySelector<SVGTSpanElement>('tspan[data-enzyme]');
    expect(name, 'a name token').not.toBeNull();
    const enzyme = name!.getAttribute('data-enzyme')!;

    act(() => name!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onRestrictionMenu).not.toHaveBeenCalled();
    expect(onRestrictionClick).toHaveBeenCalledTimes(1);
    const [clusterId, tickIds, picked] = onRestrictionClick.mock.calls[0];
    expect(clusterId).toBe(group.dataset.clusterId);
    expect(picked).toBe(enzyme);
    // Only that enzyme's sites: every id is `${enzyme}@${position}`.
    expect(tickIds.length).toBeGreaterThan(0);
    expect(tickIds.every((id: string) => id.startsWith(`${enzyme}@`))).toBe(true);
    if (enzyme === 'AatII') expect(tickIds).toHaveLength(2);
  });

  it('asks for the list from the "+N" tail, the tick, and Enter', () => {
    const layout = layoutFor('circular');
    const { onRestrictionClick, onRestrictionMenu } = render(layout);
    const group = crowdGroup(layout);
    const tail = group.querySelector<SVGTSpanElement>('tspan[data-label-more]');
    expect(tail?.textContent).toMatch(/^\+\d+$/);

    act(() => tail!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => group.querySelector('.motif-pm-tick-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

    expect(onRestrictionClick).not.toHaveBeenCalled();
    expect(onRestrictionMenu).toHaveBeenCalledTimes(3);
    const [clusterId, enzymes, anchor] = onRestrictionMenu.mock.calls[0];
    expect(clusterId).toBe(group.dataset.clusterId);
    expect(enzymes.map((entry: { enzyme: string }) => entry.enzyme).sort()).toEqual([...CROWD].sort());
    expect(anchor).toBe(tail);
    expect(group.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('selects a one-enzyme cluster wherever it is pressed, naming the enzyme', () => {
    const layout = layoutFor('circular');
    const { onRestrictionClick, onRestrictionMenu } = render(layout);
    const lone = layout.restrictions.find((restriction) => restriction.tickIds.every((id) => id.startsWith('EcoRI@')))!;
    const group = [...host!.querySelectorAll<SVGGElement>('.motif-pm-restriction')]
      .find((element) => element.dataset.clusterId === lone.clusterId)!;

    act(() => group.querySelector('.motif-pm-tick-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onRestrictionMenu).not.toHaveBeenCalled();
    expect(onRestrictionClick).toHaveBeenCalledWith(lone.clusterId, lone.tickIds, 'EcoRI');
    expect(group.hasAttribute('aria-haspopup')).toBe(false);
  });

  it('keeps selecting the whole cluster for a host that offers no list', () => {
    const layout = layoutFor('circular');
    const { onRestrictionClick } = render(layout, false);
    const group = crowdGroup(layout);
    act(() => group.querySelector('tspan[data-label-more]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const crowd = layout.restrictions.find((restriction) => restriction.clusterId === group.dataset.clusterId)!;
    expect(onRestrictionClick).toHaveBeenCalledWith(crowd.clusterId, crowd.tickIds);
  });

  it('draws the label text unchanged', () => {
    for (const mode of ['circular', 'linear'] as const) {
      const layout = layoutFor(mode);
      render(layout);
      const drawn = [...host!.querySelectorAll('.motif-pm-restriction-label')].map((text) => text.textContent);
      expect(drawn).toEqual(layout.restrictions.flatMap((restriction) => (restriction.label ? [restriction.label.text] : [])));
      act(() => root?.unmount());
      host?.remove();
    }
    root = null;
    host = null;
  });
});

describe('restriction cluster label tokens', () => {
  const enzymes = restrictionClusterEnzymes({
    tickIds: ['HindIII@757', 'AluI@758', 'AluI@803', 'HpaII@790', 'MspI@790'],
    title: 'HindIII, AluI, HpaII, MspI · 4 enzymes · 5 sites',
  });

  it('groups a cluster by enzyme in the order its tooltip names them', () => {
    expect(enzymes).toEqual([
      { enzyme: 'HindIII', tickIds: ['HindIII@757'] },
      { enzyme: 'AluI', tickIds: ['AluI@758', 'AluI@803'] },
      { enzyme: 'HpaII', tickIds: ['HpaII@790'] },
      { enzyme: 'MspI', tickIds: ['MspI@790'] },
    ]);
  });

  it('maps a drawn token to one enzyme, including a name cut short to fit', () => {
    expect(restrictionLabelTokenEnzyme('HindIII', enzymes)).toBe('HindIII');
    expect(restrictionLabelTokenEnzyme('HindI…', enzymes)).toBe('HindIII');
    // "H…" could be HindIII or HpaII, so it names neither.
    expect(restrictionLabelTokenEnzyme('H…', enzymes)).toBeNull();
    expect(restrictionLabelTokenEnzyme('+13', enzymes)).toBeNull();
  });

  it('splits a label so its tokens rejoin to the same text', () => {
    expect(restrictionLabelTokens('HindIII +13')).toEqual(['HindIII', '+13']);
    expect(restrictionLabelTokens('BsmBI, Esp3I +3')).toEqual(['BsmBI', 'Esp3I', '+3']);
    expect(restrictionLabelTokens('AluI, PstI')).toEqual(['AluI', 'PstI']);
    expect(restrictionLabelTokens('EcoRI')).toEqual(['EcoRI']);
    // A small circular map drops the count's digits before any of the name's letters.
    expect(restrictionLabelTokens('EcoRI +')).toEqual(['EcoRI', '+']);
    expect(restrictionLabelTokenEnzyme('+', enzymes)).toBeNull();
  });
});
