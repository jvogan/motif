/**
 * One drawing language for the map: lines at 1px or 1.5px on screen, flat fills,
 * no glow, and a halo for keyboard focus on every focusable mark. These guards read
 * the stylesheets and the renderer as text, as the other map guards do.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const mapCss = readFileSync(resolve(here, '..', 'plasmid-map.css'), 'utf8');
const mapView = readFileSync(resolve(here, '..', 'SequenceMapView.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', '..', '..', 'artifacts', 'motif-artifact.css'), 'utf8');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('}', start) + 1);
}

function width(body: string): number {
  return Number(body.match(/stroke-width:\s*([\d.]+);/)?.[1]);
}

describe('map line weights', () => {
  it('draws ticks, leaders and feature outlines at 1px and a selected outline at 1.5px', () => {
    expect(width(rule(mapCss, '.motif-pm-tick'))).toBe(1);
    expect(width(rule(mapCss, '.motif-pm-leader'))).toBe(1);
    expect(width(rule(mapCss, '.motif-pm-coord-tick'))).toBe(1);
    expect(width(rule(mapCss, '.motif-pm-feature-body'))).toBe(1);
    expect(width(rule(mapCss, ".motif-pm-feature[data-selected='true'] .motif-pm-feature-body"))).toBe(1.5);
  });

  it('never fades or thickens an unlabelled site tick to show density', () => {
    const tick = mapView.slice(mapView.indexOf('function RestrictionDensityTick'));
    const body = tick.slice(0, tick.indexOf('\n}\n'));
    expect(body).not.toMatch(/strokeOpacity|strokeWidth/);
    expect(mapView).toContain("stroke: 'var(--border-strong,");
  });

  it('draws no glow anywhere on the map', () => {
    // `filter` on a mark, not the unrelated `backdrop-filter` of a panel.
    expect(mapCss).not.toMatch(/drop-shadow|(?<![-\w])filter:/);
  });
});

describe('saved range overlays', () => {
  it('outline at 1.5px, or 1px on a linear map, whatever their kind', () => {
    expect(width(rule(mapCss, '.motif-pm-range-overlay-shape'))).toBe(1.5);
    expect(width(rule(mapCss, ".motif-pm-container[data-map-mode='linear'] .motif-pm-range-overlay-shape"))).toBe(1);
    const kinds = [...mapCss.matchAll(/\[data-overlay-kind='[a-z]+'\][^{]*\{[^}]*\}/g)].map((match) => match[0]);
    expect(kinds.length).toBeGreaterThanOrEqual(16);
    for (const kind of kinds) expect(kind, kind.split('{')[0]).not.toMatch(/stroke-width/);
  });

  it('state the selection after every kind rule, so it wins in both map modes', () => {
    const selected = mapCss.indexOf(".motif-pm-range-overlays .motif-pm-range-overlay[data-selected='true'] .motif-pm-range-overlay-shape");
    expect(selected).toBeGreaterThan(mapCss.lastIndexOf("[data-overlay-kind="));
    expect(rule(mapCss, '.motif-pm-range-overlays[data-interactive=\'true\'] .motif-pm-range-overlay:focus-visible .motif-pm-range-overlay-hit'))
      .toMatch(/stroke-opacity:\s*0\.28;/);
  });
});

describe('keyboard focus on map marks', () => {
  it('replaces the shell rectangle with the mark\'s own halo', () => {
    const shellOverride = artifactCss.slice(artifactCss.indexOf('#root .motif-pm-feature:focus-visible,'));
    expect(shellOverride.slice(0, shellOverride.indexOf('}') + 1)).toMatch(
      /#root \.motif-pm-feature:focus-visible,\s*#root \.motif-pm-restriction:focus-visible,\s*#root \.motif-pm-range-overlay:focus-visible \{\s*outline: none;/,
    );
    expect(rule(mapCss, '.motif-pm-feature:focus-visible .motif-pm-feature-hit')).toMatch(/stroke-opacity:\s*0\.28;/);
    expect(rule(mapCss, '.motif-pm-restriction:focus-visible .motif-pm-tick-hit')).toMatch(/stroke-opacity:\s*0\.28;/);
  });

  it('keeps a focused site\'s name in full ink on its halo, after the Type IIS tan rules', () => {
    const selector = '[data-theme] .motif-pm-restrictions .motif-pm-restriction:focus-visible .motif-pm-restriction-label';
    const body = rule(mapCss, selector);
    expect(body).toContain('fill: var(--text-primary');
    expect(body).toContain('paint-order: stroke;');
    expect(mapCss.indexOf(`${selector} {`)).toBeGreaterThan(mapCss.lastIndexOf("[data-theme='dark'] .motif-pm-restriction-enz--typeiis"));
  });
});
