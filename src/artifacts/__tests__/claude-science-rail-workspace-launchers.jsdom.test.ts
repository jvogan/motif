/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRailFlyouts, openMapDockPanel, openRailToolPanel, placeRailFlyout, primerLauncherTarget, railWorkspaceClick } from '../motif-artifact';

afterEach(() => {
  document.body.replaceChildren();
});

/** A collapsed rail with one tool, and optionally that tool's open workspace window. */
function build({ pinned = false, open = false, windowTitle }: { pinned?: boolean; open?: boolean; windowTitle?: string }) {
  document.body.innerHTML = `
    <aside class="motif-cs-inspector" data-tools-pinned="${pinned}">
      <details data-rail-tool="primer-design"${open ? ' open' : ''}><summary>Primer</summary></details>
    </aside>
    ${windowTitle ? `<div class="motif-cs-window" role="dialog" aria-label="${windowTitle}" tabindex="-1"></div>` : ''}`;
  const summary = document.querySelector('summary') as HTMLElement;
  const preventDefault = vi.fn();
  return { summary, preventDefault, window: document.querySelector<HTMLElement>('.motif-cs-window') };
}

describe('a rail head whose workspace is open', () => {
  it('brings the workspace forward instead of opening its launcher over it', () => {
    const { summary, preventDefault, window } = build({ windowTitle: 'Primer Design' });
    railWorkspaceClick('Primer Design')({ currentTarget: summary, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(window);
  });

  it('opens the launcher as before when no workspace is open', () => {
    const { summary, preventDefault } = build({ windowTitle: 'Primer Design' });
    railWorkspaceClick(null)({ currentTarget: summary, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('still closes a launcher that is already open', () => {
    const { summary, preventDefault } = build({ open: true, windowTitle: 'Primer Design' });
    railWorkspaceClick('Primer Design')({ currentTarget: summary, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('leaves the pinned Tools pane alone, where the launcher is not a popover', () => {
    const { summary, preventDefault } = build({ pinned: true, windowTitle: 'Primer Design' });
    railWorkspaceClick('Primer Design')({ currentTarget: summary, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('opens the launcher when the named window is not actually on screen', () => {
    const { summary, preventDefault } = build({});
    railWorkspaceClick('Primer Design')({ currentTarget: summary, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('what the Primer launcher says it will target', () => {
  it('says there is no selection rather than "whole record"', () => {
    // With nothing selected the workspace opens on a default 500 bp window, not
    // the whole record, so the launcher must not claim the whole record.
    const target = primerLauncherTarget(null, 2578);
    expect(target.meta).toBe('no selection');
    expect(target.detail).toContain('default target');
    expect(`${target.meta} ${target.detail}`).not.toMatch(/whole record/i);
  });

  it('names the selection the workspace will use, in 1-based bases', () => {
    expect(primerLauncherTarget({ start: 99, end: 400 }, 2578)).toEqual({
      meta: '301 bp selected',
      detail: 'Targets bases 100–400, the current selection.',
    });
  });

  it('does not promise a selection the workspace falls back from', () => {
    expect(primerLauncherTarget({ start: 2500, end: 2700 }, 2578).meta).toBe('selection wraps');
  });
});

describe('the Cloning launcher for restriction cloning', () => {
  function buildDock() {
    document.body.innerHTML = `
      <section class="motif-cs-map-column">
        <div class="motif-cs-map-dock-strip">
          <details name="motif-cs-map-dock"><summary><span><span class="motif-cs-full-label">Map Visibility</span></span></summary></details>
          <details name="motif-cs-map-dock"><summary><span><span class="motif-cs-full-label">Digest Preview</span><span class="motif-cs-compact-label">Digest</span></span></summary></details>
        </div>
      </section>`;
    const [visibility, digest] = Array.from(document.querySelectorAll('details'));
    return { column: document.querySelector('section') as HTMLElement, visibility, digest };
  }

  it('opens Digest Preview under the map, found by the name on its head', () => {
    const { column, visibility, digest } = buildDock();
    expect(openMapDockPanel(column, 'Digest Preview')).toBe(digest);
    expect(digest.open).toBe(true);
    expect(visibility.open).toBe(false);
  });

  it('opens nothing when the map is hidden or the name does not match exactly', () => {
    const { column, visibility, digest } = buildDock();
    expect(openMapDockPanel(null, 'Digest Preview')).toBeNull();
    expect(openMapDockPanel(column, 'Digest')).toBeNull();
    expect(visibility.open || digest.open).toBe(false);
  });
});

describe('the link between Results and Workflow Results', () => {
  function buildRail() {
    document.body.innerHTML = `
      <aside class="motif-cs-inspector">
        <details name="motif-cs-tools" data-rail-tool="analysis-results" open><summary>Results</summary><p><button>Workflow Results</button></p></details>
        <details name="motif-cs-tools" data-rail-tool="workflows"><summary>Workflow Results</summary></details>
      </aside>`;
    return {
      results: document.querySelector<HTMLDetailsElement>('[data-rail-tool="analysis-results"]')!,
      workflows: document.querySelector<HTMLDetailsElement>('[data-rail-tool="workflows"]')!,
    };
  }

  it('opens the other panel and moves focus to its head', () => {
    const { workflows } = buildRail();
    expect(openRailToolPanel('workflows')).toBe(workflows);
    expect(workflows.open).toBe(true);
    expect(document.activeElement).toBe(workflows.querySelector('summary'));
  });

  it('does nothing for a tool that is not rendered', () => {
    const { results } = buildRail();
    const before = document.activeElement;
    expect(openRailToolPanel('missing-tool')).toBeNull();
    expect(results.open).toBe(true);
    expect(document.activeElement).toBe(before);
  });
});

describe('the rail name flyout on a scrolling rail', () => {
  const box = (top: number, left: number, height: number, width: number) =>
    ({ top, bottom: top + height, left, right: left + width, height, width, x: left, y: top, toJSON: () => ({}) });

  function buildScrollingRail(pinned = false) {
    document.body.innerHTML = `
      <aside class="motif-cs-inspector" data-tools-pinned="${pinned}">
        <div class="motif-cs-pane-title"><button class="motif-cs-pane-collapse" title="Expand tools panel"><svg></svg></button></div>
        <details data-rail-tool="settings"><summary title="Settings"><svg></svg><span>Settings</span></summary></details>
      </aside>`;
    const rail = document.querySelector<HTMLElement>('aside')!;
    const head = rail.querySelector<HTMLElement>('summary')!;
    const chevron = rail.querySelector<HTMLElement>('.motif-cs-pane-collapse')!;
    // A 1440x680 window: the rail runs from the 70px top bar to the bottom, and
    // the head is 600px down it, centre 617, left edge 1397.
    rail.getBoundingClientRect = () => box(70, 1392, 610, 48);
    head.getBoundingClientRect = () => box(600, 1397, 34, 38);
    chevron.getBoundingClientRect = () => box(78, 1397, 32, 38);
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1440 });
    return { rail, head, chevron };
  }

  it('fixes the name at the hovered head: its centre, 11px left of the icon', () => {
    const { rail, head } = buildScrollingRail();
    placeRailFlyout({ target: head.querySelector('svg'), currentTarget: rail });
    expect(head.dataset.railFlyout).toBe('placed');
    expect(head.style.getPropertyValue('--motif-cs-rail-flyout-top')).toBe('617px');
    expect(head.style.getPropertyValue('--motif-cs-rail-flyout-right')).toBe('54px');
  });

  it('places the chevron the same way and leaves the pinned pane alone', () => {
    const { rail, chevron } = buildScrollingRail();
    placeRailFlyout({ target: chevron, currentTarget: rail });
    expect(chevron.dataset.railFlyout).toBe('placed');
    const pinned = buildScrollingRail(true);
    placeRailFlyout({ target: pinned.head, currentTarget: pinned.rail });
    expect(pinned.head.dataset.railFlyout).toBeUndefined();
  });

  it('places no name beside a head the rail has scrolled out of view', () => {
    const { rail, head } = buildScrollingRail();
    head.getBoundingClientRect = () => box(664, 1397, 34, 38);
    placeRailFlyout({ target: head, currentTarget: rail });
    expect(head.dataset.railFlyout).toBeUndefined();
  });

  it('forgets every measured position when the rail scrolls', () => {
    const { rail, head, chevron } = buildScrollingRail();
    placeRailFlyout({ target: head, currentTarget: rail });
    placeRailFlyout({ target: chevron, currentTarget: rail });
    clearRailFlyouts({ currentTarget: rail });
    expect(rail.querySelectorAll('[data-rail-flyout]')).toHaveLength(0);
  });

  it('measures the focused head again once the rail has scrolled it into view', () => {
    // Tab to a head below the fold: its focus event fires while it is still
    // under the bottom edge, then the rail scrolls it up.
    const { rail, head } = buildScrollingRail();
    head.tabIndex = 0;
    head.getBoundingClientRect = () => box(700, 1397, 34, 38);
    head.focus();
    placeRailFlyout({ target: head, currentTarget: rail });
    expect(head.dataset.railFlyout).toBeUndefined();
    head.getBoundingClientRect = () => box(640, 1397, 34, 38);
    clearRailFlyouts({ currentTarget: rail });
    expect(head.dataset.railFlyout).toBe('placed');
    expect(head.style.getPropertyValue('--motif-cs-rail-flyout-top')).toBe('657px');
  });
});
