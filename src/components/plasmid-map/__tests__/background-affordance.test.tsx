// @vitest-environment jsdom

/**
 * The map background used to promise a drag it could not perform. Once the viewport
 * was transformed the rect flipped `data-pannable="true"` and the stylesheet answered
 * with `cursor: grab` / `grabbing`, but no host ever passed onPanStart/onPanMove/
 * onPanEnd, so the press was dropped on the first line of the handler and the map moved
 * by zero pixels. Grabbing something that does not move is a worse first impression
 * than a background that never invited the gesture.
 *
 * The affordance was deleted rather than wired: the background drag is already claimed
 * by the host's range selection, and plain wheel already translates the viewport while
 * ctrl/pinch scales it — so there is no free gesture, and inventing one (space-drag,
 * middle-drag) would hide the answer behind something undiscoverable.
 *
 * These tests hold the map to claiming only what it does.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SequenceMapView } from '../SequenceMapView';
import { computeMapLayout } from '../../../plasmid-map/layout';

const here = dirname(fileURLToPath(import.meta.url));
/**
 * Match against CODE, not prose: the comments in both files name the deleted
 * affordance on purpose, so that the next reader learns why it is gone rather than
 * re-adding it. (Crude but sufficient here — neither file contains a `//` inside a
 * string literal.)
 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const viewSource = readFileSync(resolve(here, '..', 'SequenceMapView.tsx'), 'utf8');
const viewCode = stripComments(viewSource);

/**
 * BOTH stylesheets, because the affordance was declared in both: the component's own
 * `cursor: grab`, and a host override in motif-artifact.css that quietly restored
 * `crosshair` on top of it. Pinning the guard to only the copy that was fixed is the
 * exact failure this branch has hit before — one value declared twice, one copy
 * corrected, the test watching the corrected one.
 */
const stylesheets = [
  ['plasmid-map.css', resolve(here, '..', 'plasmid-map.css')],
  ['motif-artifact.css', resolve(here, '..', '..', '..', 'artifacts', 'motif-artifact.css')],
].map(([name, path]) => {
  const text = readFileSync(path, 'utf8');
  return { name, text, code: stripComments(text) };
});
const mapCss = stylesheets[0].text;

/**
 * Rule blocks whose SELECTOR targets the map background. `grab` has to be judged per
 * selector, not per file: motif-artifact.css uses grab/grabbing legitimately for window
 * drag handles and row grips, and claude-science-msa.css for the reorder grip. Those are
 * real affordances with real handlers. A blanket "no grab anywhere" rule would reject
 * those valid controls instead of guarding the map background.
 */
const backgroundRules = (css: string) =>
  css.split('}').map((chunk) => {
    const brace = chunk.lastIndexOf('{');
    return brace < 0
      ? null
      : { selector: chunk.slice(0, brace).split(/[;{}]/).pop()!.trim(), body: chunk.slice(brace + 1) };
  }).filter((rule): rule is { selector: string; body: string } => !!rule && rule.selector.includes('motif-pm-bg'));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderMap(viewport: { k: number; tx: number; ty: number }): SVGRectElement {
  const layout = computeMapLayout({
    mode: 'circular',
    name: 'pan affordance fixture',
    length: 2686,
    topology: 'circular',
    sequenceType: 'dna',
    features: [],
    restrictionSites: [],
    width: 600,
    height: 600,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<SequenceMapView layout={layout} theme="light" interactive viewport={viewport} />);
  });
  const bg = host.querySelector<SVGRectElement>('rect.motif-pm-bg');
  expect(bg).not.toBeNull();
  return bg!;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('the map background claims only the gestures it can perform', () => {
  it('flags nothing as pannable, zoomed in or not', () => {
    expect(renderMap({ k: 1, tx: 0, ty: 0 }).getAttribute('data-pannable')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    // 195% with an offset: precisely the state that used to turn on the grab cursor.
    expect(renderMap({ k: 1.953125, tx: -343.6, ty: -82.2 }).getAttribute('data-pannable')).toBeNull();
  });

  it('never advertises a grab cursor, in either stylesheet that styles it', () => {
    const offenders = stylesheets.flatMap(({ name, code }) =>
      backgroundRules(code)
        .filter((rule) => /grab/.test(rule.body))
        .map((rule) => `${name}: ${rule.selector}`),
    );

    expect(offenders).toEqual([]);
    // Both files must actually contribute a rule, or "no offenders" is vacuous — a
    // renamed class or a changed path would silently reduce this to scanning nothing.
    for (const { name, code } of stylesheets) {
      expect(backgroundRules(code).length, `${name} contributed no .motif-pm-bg rule`).toBeGreaterThan(0);
    }
  });

  it('would catch the grab rule coming back in either file', () => {
    // Proof the detector fires without editing another stylesheet. The fixture
    // is the rule this component used to ship, and the second
    // block is a real grab affordance from the same stylesheet that must NOT trip it.
    const reintroduced = `
      .motif-pm-bg[data-pannable='true'] { cursor: grab; touch-action: none; }
      .motif-cs-window-titlebar { cursor: grab; }
    `;
    const caught = backgroundRules(reintroduced).filter((rule) => /grab/.test(rule.body));

    expect(caught.map((rule) => rule.selector)).toEqual([".motif-pm-bg[data-pannable='true']"]);
  });

  it('leaves the pan attributes declared in neither stylesheet', () => {
    // These two names only ever existed to drive the dead affordance, so outside a
    // comment they cannot mean anything else in either file.
    for (const { name, code } of stylesheets) {
      expect(code, `${name} still selects on data-pannable`).not.toContain('data-pannable');
      expect(code, `${name} still selects on data-panning`).not.toContain('data-panning');
    }
  });

  it('keeps the background a bare hit surface with no pointer handlers', () => {
    const bgStart = viewCode.indexOf('className="motif-pm-bg"');
    const bgEnd = viewCode.indexOf('/>', bgStart);
    const bgJsx = viewCode.slice(bgStart, bgEnd);

    expect(bgStart).toBeGreaterThan(-1);
    expect(bgJsx).not.toMatch(/onPointer|data-pannable/);
  });

  it('carries no pan plumbing left over to be re-enabled by accident', () => {
    // Dead props are an invitation to re-wire the wrong gesture; the viewport API is
    // deliberately wheel-only now.
    expect(viewCode).not.toMatch(/onPanStart|onPanMove|onPanEnd|isPanning|panPointerRef/);
    expect(viewCode).toContain('onWheelZoom?:');
  });

  it('still keeps touch drags from being stolen by page scroll', () => {
    // The one genuinely functional property in the old data-pannable block; it now
    // applies always, not just once the viewport happens to be transformed.
    const bgRule = mapCss.slice(
      mapCss.indexOf('.motif-pm-bg {'),
      mapCss.indexOf('}', mapCss.indexOf('.motif-pm-bg {')),
    );
    expect(bgRule).toContain('touch-action: none;');
    expect(bgRule).toContain('pointer-events: all;');
  });
});
