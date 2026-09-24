/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseRailPopoverPlacement, collectRailPopoverObstacles } from '../rail-popover-placement';

/*
 * The geometry below is the running app at 1440x900 with the panes stacked:
 * sequence record title 80-106, editing toolbar 158-188, selection actions
 * 188-222, map title row (which holds the map toolbar) 441-471, map dock
 * summaries 857-889, and the popover docked at x 1038-1382, home 84, 22px
 * bottom gutter. jsdom does no layout, so each node carries its measured box.
 */
const COLUMN = { left: 1038, right: 1382 };

function box(element: Element, left: number, top: number, width: number, height: number) {
  (element as HTMLElement).dataset.box = `${left},${top},${width},${height}`;
  return element;
}

function el(tag: string, className: string, parent: Element, rect?: [number, number, number, number]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  if (rect) box(node, ...rect);
  return node;
}

function buildStackedWorkbench() {
  const shell = el('div', 'motif-cs-shell', document.body, [0, 0, 1440, 900]);
  el('header', 'motif-cs-topbar', shell, [0, 0, 1440, 38]);
  el('nav', 'motif-cs-record-tabs', shell, [0, 38, 1440, 32]);

  const sequence = el('section', 'motif-cs-sequence-column motif-cs-pane', shell, [227, 80, 1155, 350]);
  sequence.setAttribute('data-pane-key', 'sequence');
  sequence.setAttribute('data-pane-placement', 'docked');
  el('div', 'motif-cs-title-row motif-cs-sequence-title', sequence, [227, 80, 1155, 26]);
  const panel = el('section', 'motif-cs-panel motif-cs-sequence-panel', sequence, [227, 120, 1155, 300]);
  el('div', 'motif-cs-panel-head', panel, [227, 120, 1155, 38]);
  el('div', 'motif-cs-edit-toolbar', panel, [227, 158, 1155, 30]);
  el('div', 'motif-cs-selection-bar', panel, [227, 188, 1155, 34]);

  const map = el('section', 'motif-cs-map-column motif-cs-pane', shell, [10, 441, 1372, 448]);
  map.setAttribute('data-pane-key', 'map');
  map.setAttribute('data-pane-placement', 'docked');
  const mapTitle = el('div', 'motif-cs-pane-title', map, [10, 441, 1372, 30]);
  el('div', 'motif-cs-map-toolbar', mapTitle, [1140, 441, 176, 28]);
  const strip = el('div', 'motif-cs-map-dock-strip', map, [10, 857, 1372, 32]);
  const visibility = el('details', 'motif-cs-panel', strip, [10, 857, 686, 32]);
  el('summary', 'motif-cs-panel-head', visibility, [10, 857, 686, 32]);
  const digest = el('details', 'motif-cs-panel', strip, [697, 857, 685, 32]);
  el('summary', 'motif-cs-panel-head', digest, [697, 857, 685, 32]);

  // The rail. Its own popover body reuses `.motif-cs-pane-title` for a scope
  // label (the Translation panel does), which must never read as an obstacle:
  // the popover would be avoiding itself.
  const tools = el('aside', 'motif-cs-inspector motif-cs-pane', shell, [1392, 70, 48, 830]);
  tools.setAttribute('data-pane-key', 'tools');
  const popover = el('div', 'motif-cs-tool-panel-body', tools, [1038, 84, 344, 600]);
  el('span', 'motif-cs-pane-title', popover, [1050, 120, 200, 20]);
  return { shell, sequence, map, panel };
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [left, top, width, height] = ((this as HTMLElement).dataset?.box ?? '0,0,0,0').split(',').map(Number);
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('collectRailPopoverObstacles — docked panes', () => {
  it('treats each content pane\'s title and toolbar rows as hard zones', () => {
    buildStackedWorkbench();
    const hard = collectRailPopoverObstacles(document)
      .filter((o) => o.id.startsWith('pane-controls-'))
      .map((o) => `${o.id} ${o.top}-${o.top + o.height}`);
    expect(hard).toEqual(expect.arrayContaining([
      'pane-controls-sequence 80-106',
      'pane-controls-sequence 158-188',
      'pane-controls-sequence 188-222',
      'pane-controls-map 441-471',
      'pane-controls-map 857-889',
    ]));
    // The sequence panel's plain heading carries no controls and is not a zone.
    expect(hard).not.toContain('pane-controls-sequence 120-158');
  });

  it('never counts a row inside the rail, including the open popover itself', () => {
    buildStackedWorkbench();
    const ids = collectRailPopoverObstacles(document).map((o) => o.id);
    expect(ids.some((id) => id.includes('tools'))).toBe(false);
    expect(collectRailPopoverObstacles(document).some((o) => o.top === 120 && o.left === 1050)).toBe(false);
  });

  it('ignores the part of a row its pane has scrolled out of view', () => {
    const { panel } = buildStackedWorkbench();
    // The editing rows scrolled up and out of a pane body that starts at 200.
    panel.style.overflowY = 'auto';
    box(panel, 227, 200, 1155, 220);
    const sequenceZones = collectRailPopoverObstacles(document)
      .filter((o) => o.id === 'pane-controls-sequence')
      .map((o) => `${o.top}-${o.top + o.height}`);
    // Title row (outside the scroller) stays; the toolbar is gone; the selection
    // bar keeps only its 22px that is still showing.
    expect(sequenceZones).toEqual(['80-106', '200-222']);
  });

  it('moves the popover off every pane control row it used to cover', () => {
    buildStackedWorkbench();
    const obstacles = collectRailPopoverObstacles(document);
    const placement = chooseRailPopoverPlacement({
      column: COLUMN,
      homeTop: 84,
      desiredHeight: 700,
      viewportHeight: 900,
      bottomGutter: 22,
      obstacles,
    });
    // Measured on the unfixed build: home at 84, covering Export, Pop out,
    // Collapse, Detail, Complement and — for a tall panel — the map toolbar.
    expect(placement.clearsHard).toBe(true);
    expect(placement.top).toBe(479);
    expect(placement.top + placement.maxHeight).toBe(849);
    for (const zone of obstacles.filter((o) => o.priority === 'hard' && o.left < COLUMN.right && o.left + o.width > COLUMN.left)) {
      const rendered = Math.min(700, placement.maxHeight);
      const overlaps = zone.top < placement.top + rendered && zone.top + zone.height > placement.top;
      expect(overlaps, `${zone.id} ${zone.top}-${zone.top + zone.height}`).toBe(false);
    }
  });
});
