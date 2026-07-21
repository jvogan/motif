// @vitest-environment jsdom

/**
 * The "+N more sites" chip carries the only sentence on the map that says what its
 * count means and that no site was actually dropped from the drawing. That sentence
 * lives in a native <title>, which a mouse can only reach if the chip is a hit target
 * — and .motif-pm-overflows sets pointer-events:none, so it was not one: the browser
 * resolved the chip's own centre to .motif-pm-bg.
 *
 * Making it hit-testable is only half the fix. The background owns click (to clear the
 * selection) and pointerdown (to start a range drag), so these tests pin BOTH: the chip
 * is reachable, and it hands those interactions on rather than eating them.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SequenceMapView } from '../SequenceMapView';
import { computeMapLayout } from '../../../plasmid-map/layout';
import type { MapLayout } from '../../../plasmid-map/types';
import type { RestrictionSite } from '../../../bio/types';

const here = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(resolve(here, '..', 'SequenceMapView.tsx'), 'utf8');
const mapCss = readFileSync(resolve(here, '..', 'plasmid-map.css'), 'utf8');

/** Dense enough that the label band overflows and the chip is emitted. */
function overflowingLayout(): MapLayout {
  const length = 4000;
  const sites: RestrictionSite[] = Array.from({ length: 40 }, (_, i) => ({
    enzyme: `Enzyme${i}`,
    position: 50 + i * 100,
    cutPosition: 51 + i * 100,
    recognitionSequence: 'GAATTC',
    overhang: 'blunt',
  }));
  return computeMapLayout({
    mode: 'linear',
    name: 'overflow chip fixture',
    length,
    topology: 'linear',
    sequenceType: 'dna',
    features: [],
    restrictionSites: sites,
    width: 1000,
    height: 420,
    display: { maxRestrictionLabels: 8 },
  });
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(props: Partial<Parameters<typeof SequenceMapView>[0]> = {}) {
  const layout = overflowingLayout();
  expect(layout.overflows?.some((o) => o.kind === 'restriction-labels')).toBe(true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<SequenceMapView layout={layout} theme="light" interactive {...props} />);
  });
  const group = host.querySelector<SVGGElement>('g.motif-pm-overflow-chip');
  const chip = host.querySelector<SVGTextElement>('text.motif-pm-overflow');
  expect(group).not.toBeNull();
  expect(chip).not.toBeNull();
  return { group: group!, chip: chip!, layout };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe('the "+N more sites" chip can be reached without stealing the background', () => {
  it('puts the explanation in a <title> the browser can serve to a pointer', () => {
    const { group, chip } = render();

    // <title> must be the FIRST child: that is what makes it the tooltip for the
    // element rather than stray text painted into the chip. It hangs off the GROUP so
    // the hit rect inherits it too — a rect that enlarges the target but resolves to
    // no tooltip would be a bigger nothing.
    expect(group.firstElementChild?.tagName.toLowerCase()).toBe('title');
    expect(group.firstElementChild?.textContent).toContain('hidden labels');
    expect(group.firstElementChild?.textContent).toContain('All density ticks remain visible.');
    expect(chip.textContent).toContain('more sites');
    expect(chip.querySelector('title')).toBeNull();
  });

  it('draws the hit rect at the geometry the layout computed, not one of its own', () => {
    const { group, layout } = render();
    const expected = layout.overflows!.find((o) => o.kind === 'restriction-labels')!.hit;
    const rect = group.querySelector<SVGRectElement>('rect.motif-pm-overflow-hit');

    expect(rect).not.toBeNull();
    expect(Number(rect!.getAttribute('x'))).toBe(expected.x);
    expect(Number(rect!.getAttribute('y'))).toBe(expected.y);
    expect(Number(rect!.getAttribute('width'))).toBe(expected.width);
    expect(Number(rect!.getAttribute('height'))).toBe(expected.height);
    // Fixture geometry, absolute — a rect that quietly collapsed to zero would still
    // satisfy the equality above.
    expect(expected).toEqual({ x: 885.091, y: 60.8, width: 94.909, height: 14 });
  });

  it('paints the rect under the glyphs so it never hides the count it explains', () => {
    const { group } = render();
    const kids = [...group.children].map((c) => c.tagName.toLowerCase());
    expect(kids).toEqual(['title', 'rect', 'text']);
  });

  it('hands press and click on to the surfaces that own the map drag and clear', () => {
    // The map's drag (range selection) is listened for on the host's wrapper and its
    // background-clear on the <svg> root, so BOTH reach the chip only by bubbling.
    // This is the whole reason a hit-testable chip costs the map nothing.
    const { chip } = render();
    const surface = document.createElement('div');
    const seen: string[] = [];
    surface.addEventListener('pointerdown', () => seen.push('pointerdown'));
    surface.addEventListener('click', () => seen.push('click'));
    // Stand in for the host's [data-map-interaction-surface] wrapper.
    host!.parentNode!.insertBefore(surface, host);
    surface.appendChild(host!);

    act(() => {
      chip.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(seen).toEqual(['pointerdown', 'click']);
  });

  it('declares no pointer handler of its own that could swallow either', () => {
    // Cheapest way to keep the bubbling above true: the chip carries no pointer props
    // at all — on the group, the rect or the text. A handler added to any of them
    // would not fail to render, it would just quietly start competing with the host
    // for the gesture.
    const chipStart = viewSource.indexOf('className="motif-pm-overflow-chip"');
    const chipEnd = viewSource.indexOf('</g>', chipStart);
    const chipJsx = viewSource.slice(chipStart, chipEnd);

    expect(chipStart).toBeGreaterThan(-1);
    expect(chipJsx).toContain('motif-pm-overflow-hit');
    expect(chipJsx).not.toMatch(/onPointer|onMouseDown|stopPropagation/);
  });
});

describe('plasmid-map.css keeps the chip hit-testable and visibly hoverable', () => {
  const chipRule = mapCss.slice(
    mapCss.indexOf('.motif-pm-overflow {'),
    mapCss.indexOf('}', mapCss.indexOf('.motif-pm-overflow {')),
  );
  // The rule's own comment explains at length what was tried and dropped, so the
  // negative assertions below have to look at declarations, not prose.
  const chipDecls = chipRule.replace(/\/\*[\s\S]*?\*\//g, '');

  it('re-enables pointer events the .motif-pm-overflows group switched off', () => {
    expect(mapCss).toContain('.motif-pm-overflows {\n  pointer-events: none;');
    expect(chipDecls).toContain('pointer-events: all;');
    expect(chipDecls).toContain('cursor: help;');
  });

  it('keeps the target independent of whether the chip is painted', () => {
    // `all`, not `visiblePainted`: the chip is the faintest ink on the map, and a theme
    // or forced-colors pass that drove its fill to zero would otherwise take the only
    // explanation of the count with it.
    expect(chipDecls).toMatch(/pointer-events:\s*all;/);
    expect(chipDecls).not.toMatch(/pointer-events:\s*visiblePainted/);
  });

  it('carries no stroke hit-area, which measurement showed does nothing for text', () => {
    // Chromium resolves a hit anywhere inside a text run's box, so the fattened
    // transparent stroke used by .motif-pm-tick-hit leaves this element's hit region
    // byte-identical at stroke-width 0, 12 and 40. Shipping it would be a decoration
    // that reads like the mechanism. A genuinely bigger target needs real geometry.
    expect(chipDecls).not.toMatch(/stroke/);
    expect(chipDecls).not.toMatch(/paint-order/);
  });

  it('lands the hover rule after the theme rules that also set fill-opacity', () => {
    const hoverAt = mapCss.indexOf('.motif-pm-overflow-chip:hover');
    const lastThemeAt = mapCss.lastIndexOf("] .motif-pm-container[data-map-mode='circular'] .motif-pm-overflow {");

    expect(hoverAt).toBeGreaterThan(-1);
    expect(hoverAt).toBeGreaterThan(lastThemeAt);
    // ...and out-specifies them, or the chip would never visibly react to a pointer.
    expect(mapCss).toContain(".motif-pm-container[data-map-mode='circular'] .motif-pm-overflow-chip:hover .motif-pm-overflow");
  });

  it('keys hover on the group, so the enlarged target reacts as well as answering', () => {
    // The rect is the text's SIBLING. A rule written `.motif-pm-overflow:hover` only
    // fires over the glyphs, so every point the new rect added would serve a tooltip
    // from a chip that visibly did nothing.
    const hoverRules = mapCss.match(/^[^\n{]*:hover[^\n{]*\{/gm) ?? [];
    const chipHover = hoverRules.filter((r) => r.includes('motif-pm-overflow'));

    expect(chipHover.length).toBeGreaterThan(0);
    for (const rule of chipHover) {
      expect(rule).toContain('.motif-pm-overflow-chip:hover');
      expect(rule).not.toMatch(/\.motif-pm-overflow:hover/);
    }
  });

  it('makes the hit rect present but invisible, and hit-testable', () => {
    const start = mapCss.indexOf('.motif-pm-overflow-hit {');
    const rule = mapCss.slice(start, mapCss.indexOf('}', start));

    expect(start).toBeGreaterThan(-1);
    // `fill: none` is not hit-testable in every engine even under pointer-events: all;
    // transparent is. This is the difference between a target and a decoration.
    expect(rule).toMatch(/fill:\s*transparent;/);
    expect(rule).not.toMatch(/fill:\s*none;/);
    expect(rule).toMatch(/pointer-events:\s*all;/);
  });
});
