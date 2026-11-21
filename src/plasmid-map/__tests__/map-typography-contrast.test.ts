import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LABEL_FONT_PX } from '../geometry/labels';
import { LINEAR_REC_LABEL_FONT_PX } from '../layout';

const here = dirname(fileURLToPath(import.meta.url));
const mapCss = readFileSync(resolve(here, '..', '..', 'components', 'plasmid-map', 'plasmid-map.css'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', '..', 'artifacts', 'motif-artifact.css'), 'utf8');

function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('}', start) + 1);
}

function token(body: string, name: string): string {
  const match = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(match, `${name} token`).not.toBeNull();
  return match![1];
}

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [r, g, blue] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
  };
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('map typography and backbone visual contracts', () => {
  it('keeps rendered annotation metrics in sync with the readable CSS face', () => {
    expect(LABEL_FONT_PX).toBe(16);
    for (const selector of ['.motif-pm-coord-label', '.motif-pm-restriction-label']) {
      expect(ruleBody(mapCss, selector)).toMatch(/font-size:\s*16px;/);
    }
    // Still 16px wherever the map is not zoomed past the text cap: the factor is 1
    // unless SequenceMapView sets it on a zoomed circular map's arc-borne name.
    expect(ruleBody(mapCss, '.motif-pm-feature-label')).toMatch(/font-size:\s*calc\(16px \* var\(--pm-zoom-text-scale, 1\)\);/);
  });

  it('sets every name on the map in the one UI face', () => {
    // Feature names, enzyme names, ruler numerals and the centre title share one
    // face: no class is monospace, enzyme names included.
    expect(mapCss).toMatch(/\n\.motif-plasmid-map \{[^}]*font-family:\s*var\(--font-ui,/);
    expect(ruleBody(mapCss, '.motif-pm-feature-label')).toMatch(/font-family:\s*var\(--font-ui,/);
    expect(ruleBody(mapCss, '.motif-pm-restriction-label')).toMatch(/font-family:\s*var\(--font-ui,/);
    for (const selector of ['.motif-pm-coord-label', '.motif-pm-center-name', '.motif-pm-center-len']) {
      expect(ruleBody(mapCss, selector)).not.toMatch(/font-family/);
    }
    expect(mapCss).not.toMatch(/\.motif-pm-(restriction|feature|coord|center)[\w-]*[^{}]*\{[^}]*--font-mono/);
  });

  it('draws the linear ruler no larger than the names it sits above', () => {
    // A ruler is the quietest thing on a map. In linear mode the drawing renders
    // at scale 1, so the base 16px made these numerals the largest type in the
    // workspace — larger than the 13px enzyme names beneath them and the 11px
    // pane title above. Both linear annotation faces now draw at
    // LINEAR_REC_LABEL_FONT_PX, which is the size the minimum-screen-px
    // floor is calculated against. Nothing in the linear path measures a
    // coordinate label: they are anchored 'middle' with no width-based collision
    // pass, so shrinking the face cannot move or drop one.
    const body = ruleBody(mapCss, ".motif-pm-container[data-map-mode='linear'] .motif-pm-coord-label");
    expect(body).toMatch(new RegExp(`font-size:\\s*${LINEAR_REC_LABEL_FONT_PX}px;`));
    expect(LINEAR_REC_LABEL_FONT_PX).toBeLessThan(LABEL_FONT_PX);
  });

  it('draws the linear enzyme band at the size its geometry reserves', () => {
    // Two numbers that must not drift apart: layout.ts reserves each linear enzyme
    // label's box at LINEAR_REC_LABEL_FONT_PX, and this rule is what the browser
    // actually draws. If the CSS grew and the reservation did not, the placer would
    // pack labels that overprint each other on screen while every unit test passed.
    const body = ruleBody(mapCss, ".motif-pm-container[data-map-mode='linear'] .motif-pm-restriction-label");
    expect(body).toMatch(new RegExp(`font-size:\\s*${LINEAR_REC_LABEL_FONT_PX}px;`));
    expect(LINEAR_REC_LABEL_FONT_PX).toBeLessThan(LABEL_FONT_PX);
  });

  it('clears 4.5:1 on a Type IIS enzyme name in every product theme', () => {
    // These names render at LABEL_FONT_PX, which is under the 24px WCAG calls
    // large, so the floor is 4.5 and not 3.
    const lightTan = ruleBody(mapCss, ".motif-pm-restriction-enz--typeiis").match(/#[0-9a-f]{6}/i)![0];
    const darkTan = mapCss.match(/--pm-typeiis-dark,\s*(#[0-9a-f]{6})/i)![1];

    // The dark theme must name itself in the override, or it inherits a tan mixed
    // for a white ground.
    expect(mapCss).toContain("[data-theme='dark'] .motif-pm-restriction-enz--typeiis {");

    // The light tan keeps headroom to 5.5, so a popover's drop shadow over the map, or any
    // wash over the label, cannot take "BsaI" under 4.5.
    for (const [selector, tan, floor] of [
      [':root,\nhtml[data-theme="light"]', lightTan, 5.5],
      ['html[data-theme="dark"]', darkTan, 4.5],
    ] as const) {
      const body = ruleBody(artifactCss, selector);
      expect(contrast(tan, token(body, '--bg-primary')), selector).toBeGreaterThanOrEqual(floor);
    }
  });

  it('draws the 2px ring in the muted text token, clear of 4.5:1 in every product theme', () => {
    // A 2px ring holds beside 19-unit feature bands, where a thinner line would look like
    // a hairline. The muted text grey holds 4.5:1 or more on the map ground in both
    // themes, and the Line view's axis is the same element.
    const backbone = ruleBody(mapCss, '.motif-pm-backbone');
    expect(backbone).toContain('stroke: var(--text-muted');
    expect(backbone).toMatch(/stroke-width:\s*2;/);
    expect(mapCss).not.toMatch(/\[data-theme=['"](?:light|dark)['"]\][^{]*\.motif-pm-backbone/);

    for (const selector of [
      'html[data-theme="dark"]',
      ':root,\nhtml[data-theme="light"]',
    ]) {
      const body = ruleBody(artifactCss, selector);
      // The ring draws in the muted text token at 4.5:1 or more; the unlabelled site
      // ticks keep the strong border token, a non-text edge at 3:1 or more.
      expect(contrast(token(body, '--text-muted'), token(body, '--bg-primary')), selector)
        .toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(body, '--border-strong'), token(body, '--bg-primary')), selector)
        .toBeGreaterThanOrEqual(3);
    }
  });
});

describe('form placeholder legibility', () => {
  // Several placeholders carry the input's expected format rather than a
  // restatement of its label — "Known enzyme (for example, EcoRV)" — so they
  // have to be readable, not merely present. Lightening --text-muted toward the
  // field background would put them under the 4.5:1 floor.
  it('sets the placeholder to --text-muted with nothing mixed into it', () => {
    // Textareas share the rule: the import box's placeholder takes --text-muted, not the
    // browser's default grey.
    const body = ruleBody(artifactCss, '.motif-cs-field::placeholder,\n.motif-cs-input::placeholder,\n.motif-cs-textarea::placeholder');
    expect(body).toMatch(/color:\s*var\(--text-muted\)\s*;/);
    expect(body, 'a blend toward the background would drop this below 4.5:1')
      .not.toMatch(/color:\s*color-mix\([^;]*--bg-/);
  });

  it('clears 4.5:1 against the field background in every theme', () => {
    for (const selector of [
      ':root,\nhtml[data-theme="light"]',
      'html[data-theme="dark"]',
    ]) {
      const body = ruleBody(artifactCss, selector);
      expect(contrast(token(body, '--text-muted'), token(body, '--bg-primary')), selector)
        .toBeGreaterThanOrEqual(4.5);
    }
  });
});
