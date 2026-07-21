import { describe, expect, it } from 'vitest';
import {
  RAIL_POPOVER_MIN_HEIGHT,
  chooseRailPopoverPlacement,
  type PlacementObstacle,
  type RailPopoverPlacementInput,
} from '../rail-popover-placement';

/*
 * Every number below was measured in the running app at 1440x980 with the
 * alignment window open: topbar 0-38, record tabs 38-70, window at (250, 80)
 * 940x820, its title bar 81-124, its control row 134-178, and the popover
 * docked at x 1038-1382 with a resting offset of 84 and a 22px bottom gutter.
 */
const VIEWPORT_HEIGHT = 980;
const COLUMN = { left: 1038, right: 1382 };
const HOME_TOP = 84;
const BOTTOM_GUTTER = 22;
const SAFE_BOTTOM = VIEWPORT_HEIGHT - BOTTOM_GUTTER;

const TOP_CHROME: PlacementObstacle = { id: 'top-chrome', priority: 'hard', left: 0, top: 0, width: 1440, height: 70 };

/** The hard + soft zones a window at `top` contributes, at its measured proportions. */
function windowAt(top: number, { height = 820, left = 250, width = 940 } = {}): PlacementObstacle[] {
  return [
    { id: 'window', priority: 'soft', left, top, width, height },
    { id: 'window-head', priority: 'hard', left: left + 1, top: top + 1, width: width - 2, height: 43 },
    { id: 'window-controls', priority: 'hard', left: left + 11, top: top + 54, width: width - 22, height: 44 },
  ];
}

function place(overrides: Partial<RailPopoverPlacementInput> = {}) {
  return chooseRailPopoverPlacement({
    column: COLUMN,
    homeTop: HOME_TOP,
    desiredHeight: 874,
    viewportHeight: VIEWPORT_HEIGHT,
    bottomGutter: BOTTOM_GUTTER,
    obstacles: [TOP_CHROME],
    ...overrides,
  });
}

/** Does the placement, at the height it will actually render, sit on a hard zone? */
function coversHard(placement: { top: number; maxHeight: number }, obstacles: PlacementObstacle[], desiredHeight = 874) {
  const height = Math.min(desiredHeight, placement.maxHeight);
  return obstacles.filter((o) => o.priority === 'hard').some((o) => (
    o.left < COLUMN.right && o.left + o.width > COLUMN.left
    && o.top < placement.top + height && o.top + o.height > placement.top
  ));
}

describe('chooseRailPopoverPlacement', () => {
  it('leaves the popover at the stylesheet offset when nothing is under it', () => {
    const placement = place();
    expect(placement.top).toBe(HOME_TOP);
    expect(placement.strategy).toBe('home');
    // The stylesheet's own bound: 100vh - offset - 22.
    expect(placement.maxHeight).toBe(VIEWPORT_HEIGHT - HOME_TOP - BOTTOM_GUTTER);
  });

  it('drops below the title bar and control row of a window parked at the top', () => {
    const obstacles = [TOP_CHROME, ...windowAt(80)];
    const placement = place({ obstacles });
    // Control row ends at 80 + 54 + 44 = 178, plus RAIL_POPOVER_GAP of breathing room.
    expect(placement.top).toBe(186);
    expect(placement.strategy).toBe('shifted-down');
    expect(placement.clearsHard).toBe(true);
    expect(coversHard(placement, obstacles)).toBe(false);
  });

  it('re-derives the height bound from where it actually landed', () => {
    const placement = place({ obstacles: [TOP_CHROME, ...windowAt(80)] });
    // Not the stylesheet's 100vh - 84 - 22: the popover is no longer at 84.
    expect(placement.maxHeight).toBe(SAFE_BOTTOM - placement.top);
    expect(placement.maxHeight).toBe(VIEWPORT_HEIGHT - placement.top - BOTTOM_GUTTER);
    expect(placement.maxHeight).toBeLessThan(VIEWPORT_HEIGHT - HOME_TOP - BOTTOM_GUTTER);
  });

  it('stays home and shortens when the window sits low enough to leave room above it', () => {
    const obstacles = [TOP_CHROME, ...windowAt(500)];
    const placement = place({ obstacles });
    expect(placement.top).toBe(HOME_TOP);
    expect(placement.strategy).toBe('home');
    // Bounded by the title bar above it (501), less the gap, less the offset —
    // not by the bottom of the screen.
    expect(placement.maxHeight).toBe(409);
    expect(coversHard(placement, obstacles)).toBe(false);
  });

  it('ignores a window that does not reach the docked column', () => {
    const obstacles = [TOP_CHROME, ...windowAt(80, { left: 20, width: 600 })];
    const placement = place({ obstacles });
    expect(placement.top).toBe(HOME_TOP);
    expect(placement.strategy).toBe('home');
  });

  it('clears both title bars when two windows are stacked', () => {
    // The band between the windows is 441 - 8 - (178 + 8) = 247px: big enough to
    // be worth using, and nearer home than the band below the lower window.
    const obstacles = [TOP_CHROME, ...windowAt(80, { height: 300 }), ...windowAt(440, { height: 400 })];
    const placement = place({ obstacles });
    expect(placement.clearsHard).toBe(true);
    expect(coversHard(placement, obstacles)).toBe(false);
    expect(placement.top).toBe(186);
    expect(placement.maxHeight).toBe(247);
  });

  it('passes over a band too small to be worth using and takes the roomier one', () => {
    // The same layout 20px higher squeezes the middle band to 227px. Under the
    // stylesheet's bare 96px minimum that band wins on nearness alone and the
    // panel opens into it; a usable band exists further down, so take that
    // instead of reserving less room than the panel needs and hiding the rest.
    const obstacles = [TOP_CHROME, ...windowAt(80, { height: 300 }), ...windowAt(420, { height: 400 })];
    const placement = place({ obstacles });
    expect(placement.clearsHard).toBe(true);
    expect(coversHard(placement, obstacles)).toBe(false);
    expect(placement.top).toBe(526);
    expect(placement.maxHeight).toBe(432);
    // Drop the floor back to the stylesheet minimum and the sliver returns.
    const sliver = place({ obstacles, minUsableHeight: RAIL_POPOVER_MIN_HEIGHT });
    expect(sliver.top).toBe(186);
    expect(sliver.maxHeight).toBe(227);
  });

  it('goes below a window rather than open 109px above it', () => {
    // The measured regression: window dragged to y=200 leaves a 115px band above
    // its title bar, and the popover sitting at home inside it gets 109px — which
    // renders one of the fourteen rail panels whole.
    const obstacles = [TOP_CHROME, ...windowAt(200)];
    const placement = place({ obstacles });
    expect(placement.top).toBe(306);
    expect(placement.maxHeight).toBe(652);
    expect(coversHard(placement, obstacles)).toBe(false);
    expect(place({ obstacles, minUsableHeight: RAIL_POPOVER_MIN_HEIGHT }).maxHeight).toBe(109);
  });

  it('will not wedge into a band the popover cannot physically fit in', () => {
    // Two clear bands, neither usable: 56px nearer home and 142px further away.
    // 56 is under the stylesheet's own min-height, so a popover put there would
    // overflow its band and land back on the hard zone it was avoiding.
    const obstacles: PlacementObstacle[] = [
      TOP_CHROME,
      { id: 'window-head', priority: 'hard', left: 250, top: 142, width: 940, height: 60 },
      { id: 'window-head-2', priority: 'hard', left: 250, top: 360, width: 940, height: 598 },
    ];
    const placement = place({ obstacles });
    expect(placement.top).toBe(210);
    expect(placement.maxHeight).toBe(142);
    expect(placement.maxHeight).toBeGreaterThanOrEqual(RAIL_POPOVER_MIN_HEIGHT);
    expect(coversHard(placement, obstacles)).toBe(false);
  });

  it('still takes an undersized band when it is the only way to clear a hard zone', () => {
    // Never covering the window controls is the rule that does not bend: a 149px
    // band beats staying home on top of Close, even though 149 is under the floor.
    const obstacles: PlacementObstacle[] = [
      TOP_CHROME,
      ...windowAt(240),
      { id: 'window-head-2', priority: 'hard', left: 250, top: 346, width: 940, height: 612 },
    ];
    const placement = place({ obstacles });
    expect(placement.clearsHard).toBe(true);
    expect(coversHard(placement, obstacles)).toBe(false);
    expect(placement.top).toBe(84);
    expect(placement.maxHeight).toBe(149);
  });

  it('refuses a band too small to hold the popover', () => {
    // Window head at 150 leaves 150 - 8 - 78 = 64px above it, under the minimum.
    const obstacles = [TOP_CHROME, ...windowAt(149)];
    const placement = place({ obstacles });
    expect(placement.top).toBeGreaterThan(149);
    expect(placement.maxHeight).toBeGreaterThanOrEqual(RAIL_POPOVER_MIN_HEIGHT);
    expect(coversHard(placement, obstacles)).toBe(false);
  });

  it('places a short panel and a tall panel identically', () => {
    const obstacles = [TOP_CHROME, ...windowAt(280)];
    const short = place({ obstacles, desiredHeight: 96 });
    const tall = place({ obstacles, desiredHeight: 1344 });
    expect(short.top).toBe(tall.top);
    expect(short.maxHeight).toBe(tall.maxHeight);
    // Only the reported shortfall differs — that is what the height is for.
    expect(short.hiddenHeight).toBe(0);
    expect(tall.hiddenHeight).toBeGreaterThan(0);
  });

  it('is a pure function of the layout — same input, same pixel', () => {
    const obstacles = [TOP_CHROME, ...windowAt(80)];
    const answers = Array.from({ length: 8 }, () => JSON.stringify(place({ obstacles })));
    expect(new Set(answers).size).toBe(1);
  });

  it('never lets the popover run off the bottom of the viewport', () => {
    for (let windowTop = 72; windowTop <= 900; windowTop += 1) {
      const placement = place({ obstacles: [TOP_CHROME, ...windowAt(windowTop)] });
      expect(placement.top).toBeGreaterThanOrEqual(0);
      expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(SAFE_BOTTOM);
    }
  });

  it('clears the hard zones at every window position it can be dragged to', () => {
    const failures: number[] = [];
    for (let windowTop = 72; windowTop <= 900; windowTop += 1) {
      const obstacles = [TOP_CHROME, ...windowAt(windowTop)];
      if (coversHard(place({ obstacles }), obstacles)) failures.push(windowTop);
    }
    expect(failures).toEqual([]);
  });

  it('honours the 132px offset the narrow-viewport media query switches to', () => {
    const obstacles = [TOP_CHROME, ...windowAt(600)];
    const placement = place({ homeTop: 132, obstacles, viewportHeight: 800 });
    expect(placement.top).toBe(132);
    expect(placement.maxHeight).toBe(461);
  });

  it('reports the overlap it could not avoid rather than pretending it cleared', () => {
    // A window tall enough that its hard zones leave no band anywhere.
    const obstacles: PlacementObstacle[] = [
      TOP_CHROME,
      { id: 'window-head', priority: 'hard', left: 0, top: 60, width: 1440, height: 900 },
    ];
    const placement = place({ obstacles });
    expect(placement.clearsHard).toBe(false);
    expect(placement.strategy).toBe('no-clear-band');
    expect(placement.hardOverlap).toBeGreaterThan(0);
  });

  it('prefers the band that covers less of the window body when travel ties', () => {
    // One hard zone at 408-592 leaves bands [0, 400] and [600, 958] after the
    // breathing room. Their nearest-to-home positions are 160 and 600 — exactly
    // 220px either side of a home of 380, so only soft overlap tells them apart.
    const hardZone: PlacementObstacle = { id: 'window-head', priority: 'hard', left: 1000, top: 408, width: 400, height: 184 };
    const softOver = (top: number, height: number): PlacementObstacle => ({ id: 'window', priority: 'soft', left: 1000, top, width: 400, height });

    const softAbove = place({ homeTop: 380, obstacles: [hardZone, softOver(160, 240)] });
    expect(softAbove.top).toBe(600);
    expect(softAbove.softOverlap).toBe(0);

    const softBelow = place({ homeTop: 380, obstacles: [hardZone, softOver(600, 358)] });
    expect(softBelow.top).toBe(160);
    expect(softBelow.softOverlap).toBe(0);
  });
});
