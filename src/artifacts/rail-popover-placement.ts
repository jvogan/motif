/**
 * Placement solver for the tools-rail popovers.
 *
 * The rail popovers used to open at a literal CSS position — `top: 84px;
 * right: 58px` — with no idea what was underneath them. Measured with a
 * floating window open, all 15 of them landed squarely on that window's
 * Maximize / Collapse / Close cluster, 45 of 45 control instances covered, and
 * there was no way out: the popover is right-anchored and not draggable, so the
 * user could not move either thing out of the other's way.
 *
 * Obstacles are TIERED, which is what makes this more than a constant nudge:
 *   'hard' — must never be covered. A window's title bar (which carries
 *            Maximize / Collapse / Close) and the control row directly beneath
 *            it, plus the topbar / record-tabs band. Covering these is what
 *            makes the app feel broken, because the control that would undo the
 *            overlap is the control being hidden.
 *   'soft'  — prefer not to cover. Window bodies, floating panes. Overlapping
 *            the content is bad but recoverable — you can scroll it, or close
 *            the popover with the button that is still visible.
 *
 * POLICY: stability. The popover keeps the horizontal dock the stylesheet gives
 * it and keeps its vertical home too, moving only far enough down (or up) to
 * clear the hard zones. It may cover some of the window body; that is the
 * accepted trade. The point of a rail is that the panel is in the same place
 * every time, so the solver is a pure function of the layout — same layout in,
 * same pixel out, with no hysteresis and no memory of previous solves.
 *
 * Horizontal placement is therefore not searched at all. The docked column is
 * an input, which lets the vertical search reduce to intervals: hard zones cut
 * the column into free bands, and the answer is the band that costs least.
 */

export type PlacementPriority = 'hard' | 'soft';

export type PlacementRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PlacementObstacle = PlacementRect & {
  id: string;
  priority: PlacementPriority;
};

export type RailPopoverPlacementInput = {
  /** The docked x-span the stylesheet gives the popover. Owned by CSS, not searched. */
  column: { left: number; right: number };
  /** Where the popover sits when nothing is in the way — the stylesheet's own offset. */
  homeTop: number;
  /**
   * Content height, or the height the user dragged the popover to. Deliberately
   * NOT an input to the choice — only to `hiddenHeight`. Letting it choose was
   * measured making a tall panel and a short panel land in different places at
   * the same window position, which breaks the one thing a rail promises.
   */
  desiredHeight: number;
  viewportHeight: number;
  /** The stylesheet's bottom breathing room, read back from its own max-height. */
  bottomGutter: number;
  obstacles: PlacementObstacle[];
  /** Mirrors the stylesheet's min-height: a band narrower than this cannot hold the popover. */
  minHeight?: number;
  /** A band narrower than this is a last resort, not a choice. See the constant. */
  minUsableHeight?: number;
  /** Breathing room left between the popover and a hard zone it is tucking beside. */
  gap?: number;
};

export type RailPopoverPlacement = {
  top: number;
  /** Cap for the popover — and, because the drag-resize reads its limit off the
   *  computed max-height, the limit the user's drag is allowed to reach. */
  maxHeight: number;
  clearsHard: boolean;
  /** px² of hard zone the popover would still cover. 0 in every good outcome. */
  hardOverlap: number;
  softOverlap: number;
  /** px of desired height that does not fit in the chosen band. */
  hiddenHeight: number;
  strategy: 'home' | 'shifted-down' | 'shifted-up' | 'no-clear-band';
};

/** Mirrors the stylesheet's `min-height` for the popover body. */
export const RAIL_POPOVER_MIN_HEIGHT = 96;
/**
 * The smallest band worth putting a panel in.
 *
 * The stylesheet's 96px is the smallest popover that can legally exist, not the
 * smallest one worth opening: measured against the live panels, a 96px band
 * renders exactly ONE of the fourteen rail panels whole. Preferring a band that
 * small over a roomier one further away recreates this codebase's signature
 * defect — a box reserving less room than its content needs — except that here
 * the solver would be choosing to do it, with space visibly free elsewhere.
 *
 * Derived from what the panels actually need, measured at 1440x980:
 *   content heights 94, 111, 156, 171, 179, 193, 205, 220, 337, 367, 490, 686,
 *   811, 939 — median 220.
 *   96px band -> 1/14 panels whole      240px -> 8/14
 *   200px     -> 6/14                   300px -> 8/14 (buys nothing over 240)
 *                                       356px -> 9/14
 * 240 is the cheapest floor that clears the median panel, and nothing improves
 * again until 356 — so anything between them costs displacement for no gain.
 *
 * A band under this is still taken when it is the ONLY way to clear a hard zone;
 * never covering Close is the one rule that does not bend.
 */
export const RAIL_POPOVER_MIN_USABLE_HEIGHT = 240;
/** Breathing room so the popover reads as beside a hard zone rather than welded to it. */
export const RAIL_POPOVER_GAP = 8;

/** Clearing a hard zone is not negotiable, so it outweighs every other term. */
const HARD_WEIGHT = 1e6;
/** Travel away from home, in px. The panel showing up where you expect it is the policy. */
const DRIFT_WEIGHT = 1;
/** Covering the window body is the accepted cost of staying docked, so this only
 *  breaks ties between bands that are otherwise equally good. Scored against the
 *  band rather than the rendered panel, so a short panel and a tall one are
 *  placed identically. */
const SOFT_WEIGHT = 120;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

function overlapArea(a: PlacementRect, b: PlacementRect): number {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return x * y;
}

function overlapsColumn(obstacle: PlacementRect, column: { left: number; right: number }): boolean {
  return obstacle.left < column.right && obstacle.left + obstacle.width > column.left;
}

/** Merge the hard zones that cross the docked column into disjoint, sorted y-bands. */
function mergeBands(bands: Array<[number, number]>): Array<[number, number]> {
  const sorted = bands.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function chooseRailPopoverPlacement(input: RailPopoverPlacementInput): RailPopoverPlacement {
  const gap = input.gap ?? RAIL_POPOVER_GAP;
  const minHeight = input.minHeight ?? RAIL_POPOVER_MIN_HEIGHT;
  const minUsableHeight = Math.max(minHeight, input.minUsableHeight ?? RAIL_POPOVER_MIN_USABLE_HEIGHT);
  const safeTop = 0;
  const safeBottom = Math.max(safeTop + minHeight, input.viewportHeight - input.bottomGutter);
  const columnWidth = Math.max(0, input.column.right - input.column.left);
  const desired = Math.max(minHeight, Math.round(input.desiredHeight));
  const homeTop = clamp(Math.round(input.homeTop), safeTop, safeBottom - minHeight);

  const hard = input.obstacles.filter((o) => o.priority === 'hard');
  const soft = input.obstacles.filter((o) => o.priority !== 'hard');

  const blocked = mergeBands(hard
    .filter((o) => overlapsColumn(o, input.column))
    .map((o) => [Math.max(safeTop, o.top), Math.min(safeBottom, o.top + o.height)] as [number, number]));

  // What the hard zones leave behind. A band's start abuts a hard zone unless it
  // is the top of the safe area, and likewise for its end — so trimming by `gap`
  // exactly where a hard zone is adjacent gives breathing room without eating
  // into the screen edges, which have their own gutters already.
  const free: Array<[number, number]> = [];
  let cursor = safeTop;
  for (const [start, end] of blocked) {
    if (start > cursor) free.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (safeBottom > cursor) free.push([cursor, safeBottom]);

  const bands = free.map(([start, end]): [number, number] => [
    start > safeTop ? start + gap : start,
    end < safeBottom ? end - gap : end,
  ]);

  // Two tiers, not one threshold. A band that can hold a usable panel is always
  // preferred, however far away it is; a band that merely satisfies the
  // stylesheet's minimum is taken only when it is the only thing on offer,
  // because clearing the hard zones still beats being 96px tall AND on top of
  // Close. Both floors are constants, so which tier applies — and therefore
  // where the popover lands — stays a function of the layout alone.
  const usable = bands.filter(([start, end]) => end - start >= minUsableHeight);
  const tier = usable.length > 0 ? usable : bands.filter(([start, end]) => end - start >= minHeight);
  const floor = usable.length > 0 ? minUsableHeight : minHeight;

  const candidates = tier.map(([start, end]) => {
    // Sit at home when home is inside the band; otherwise at the near edge. The
    // clamp uses the tier's floor rather than the desired height, so a tall
    // popover in a roomy band still opens at home and simply runs shorter — and
    // so a band that qualified on size cannot then hand back a sliver because
    // home happened to sit near its bottom edge.
    const top = clamp(homeTop, start, Math.max(start, end - floor));
    return { top, available: end - top };
  });

  // Nothing clears. Stay home rather than wedging into a band too small to hold
  // the popover, which would cover a hard zone AND move — the worst of both.
  if (candidates.length === 0) candidates.push({ top: homeTop, available: safeBottom - homeTop });

  // Score the BAND, not the panel that is about to sit in it. Every term here is
  // a function of the layout alone, which is what makes all 15 panels land on
  // the same pixel for a given window arrangement.
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const band: PlacementRect = { left: input.column.left, top: candidate.top, width: columnWidth, height: candidate.available };
    const area = columnWidth * candidate.available;
    const score = hard.reduce((sum, o) => sum + overlapArea(band, o), 0) * HARD_WEIGHT
      + Math.abs(candidate.top - homeTop) * DRIFT_WEIGHT
      + (area > 0 ? soft.reduce((sum, o) => sum + overlapArea(band, o), 0) / area : 0) * SOFT_WEIGHT;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  const maxHeight = Math.max(minHeight, Math.round(best.available));
  // Report against what the popover will actually occupy, which is the answer to
  // "does this cover Close", rather than against the whole band it may not fill.
  const rendered: PlacementRect = {
    left: input.column.left,
    top: best.top,
    width: columnWidth,
    height: Math.min(desired, best.available),
  };
  const bestHard = hard.reduce((sum, o) => sum + overlapArea(rendered, o), 0);
  const bestSoft = soft.reduce((sum, o) => sum + overlapArea(rendered, o), 0);
  const clearsHard = bestHard === 0;
  return {
    top: Math.round(best.top),
    maxHeight,
    clearsHard,
    hardOverlap: bestHard,
    softOverlap: bestSoft,
    hiddenHeight: Math.max(0, desired - maxHeight),
    strategy: !clearsHard
      ? 'no-clear-band'
      : best.top === homeTop
        ? 'home'
        : best.top > homeTop
          ? 'shifted-down'
          : 'shifted-up',
  };
}

/** Topbar + record tabs: the app chrome the popover must never sit on. */
const TOP_CHROME_SELECTOR = '.motif-cs-topbar, .motif-cs-record-tabs';
const WINDOW_SELECTOR = '.motif-cs-window';
const WINDOW_HEAD_SELECTOR = '.motif-cs-window-head';
/** A window's own control row, whatever the window holds. Matching on the class
 *  substring keeps this from becoming a list that has to be revisited every time
 *  a new window type lands; the adjacency test below is what makes it safe. */
const WINDOW_CONTROL_ROW_SELECTOR = '[class*="-toolbar"]';
/** How far below the title bar a row can start and still count as its control row. */
const CONTROL_ROW_ADJACENCY = 40;
const FLOATING_PANE_SELECTOR = '[data-pane-placement="floating"]';

function toRect(element: Element): PlacementRect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

const hasArea = (rect: PlacementRect): boolean => rect.width > 0 && rect.height > 0;

/**
 * Read the obstacle list out of live DOM. Kept out of the solver so the solver
 * stays a pure function of geometry and can be tested without a document.
 */
export function collectRailPopoverObstacles(root: Document | HTMLElement): PlacementObstacle[] {
  const obstacles: PlacementObstacle[] = [];
  const push = (id: string, priority: PlacementPriority, rect: PlacementRect) => {
    if (hasArea(rect)) obstacles.push({ id, priority, ...rect });
  };

  for (const element of root.querySelectorAll(TOP_CHROME_SELECTOR)) {
    push('top-chrome', 'hard', toRect(element));
  }

  let index = 0;
  for (const element of root.querySelectorAll(WINDOW_SELECTOR)) {
    const suffix = index > 0 ? `-${index}` : '';
    index += 1;
    push('window', 'soft', toRect(element));
    const head = element.querySelector(WINDOW_HEAD_SELECTOR);
    if (!head) continue;
    const headRect = toRect(head);
    push(`window-head${suffix}`, 'hard', headRect);
    const headBottom = headRect.top + headRect.height;
    for (const row of element.querySelectorAll(WINDOW_CONTROL_ROW_SELECTOR)) {
      const rowRect = toRect(row);
      const offset = rowRect.top - headBottom;
      if (offset < 0 || offset > CONTROL_ROW_ADJACENCY) continue;
      push(`window-controls${suffix}`, 'hard', rowRect);
    }
  }

  for (const element of root.querySelectorAll(FLOATING_PANE_SELECTOR)) {
    push('floating-pane', 'soft', toRect(element));
  }

  return obstacles;
}
