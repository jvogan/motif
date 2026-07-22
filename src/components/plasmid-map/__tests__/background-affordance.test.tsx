// @vitest-environment jsdom

/**
 * SequenceMapView supplies the drawing surface and wheel behavior. The Motif workbench
 * host assigns blank-canvas pointer drags by geometry: near the circular backbone or
 * linear axis they select a range; elsewhere they pan the viewport. Cursor rules must
 * follow that explicit host state so the background advertises the gesture a press will
 * perform at the current point.
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
/** Match code rather than explanatory comments. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const viewSource = readFileSync(resolve(here, '..', 'SequenceMapView.tsx'), 'utf8');
const viewCode = stripComments(viewSource);

/** Both stylesheets can style the shared background class. */
const stylesheets = [
  ['plasmid-map.css', resolve(here, '..', 'plasmid-map.css')],
  ['motif-artifact.css', resolve(here, '..', '..', '..', 'artifacts', 'motif-artifact.css')],
].map(([name, path]) => {
  const text = readFileSync(path, 'utf8');
  return { name, text, code: stripComments(text) };
});
const mapCss = stylesheets[0].text;

/** Rule blocks whose selector targets the map background. */
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

  it('scopes grab cursors to the host pan state', () => {
    const grabRules = stylesheets.flatMap(({ name, code }) =>
      backgroundRules(code)
        .filter((rule) => /cursor\s*:\s*grabb?(?:ing)?/.test(rule.body))
        .map((rule) => ({ name, ...rule })),
    );

    expect(grabRules.length).toBe(2);
    for (const rule of grabRules) {
      expect(rule.selector, `${rule.name} has an unscoped map grab cursor`).toContain(
        '[data-map-pointer-action="pan"]',
      );
    }
    expect(grabRules.some((rule) => /cursor\s*:\s*grab\s*;/.test(rule.body))).toBe(true);
    expect(grabRules.some((rule) => /cursor\s*:\s*grabbing\s*;/.test(rule.body))).toBe(true);

    // Both files must still contribute a background rule, or this scan would miss a
    // renamed class or moved stylesheet.
    for (const { name, code } of stylesheets) {
      expect(backgroundRules(code).length, `${name} contributed no .motif-pm-bg rule`).toBeGreaterThan(0);
    }
  });

  it('detects an unscoped grab rule while accepting the host pan state', () => {
    const reintroduced = `
      .motif-pm-bg { cursor: grab; touch-action: none; }
      .motif-cs-map-frame[data-map-pointer-action="pan"] .motif-pm-bg { cursor: grab; }
    `;
    const caught = backgroundRules(reintroduced).filter((rule) => (
      /cursor\s*:\s*grab/.test(rule.body)
      && !rule.selector.includes('[data-map-pointer-action="pan"]')
    ));

    expect(caught.map((rule) => rule.selector)).toEqual(['.motif-pm-bg']);
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

  it('keeps host pointer handling out of the drawing component', () => {
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
