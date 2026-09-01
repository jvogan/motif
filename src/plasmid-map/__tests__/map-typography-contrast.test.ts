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
    for (const selector of ['.motif-pm-coord-label', '.motif-pm-feature-label', '.motif-pm-restriction-label']) {
      expect(ruleBody(mapCss, selector)).toMatch(/font-size:\s*16px;/);
    }
  });

  it('draws the linear ruler no larger than the names it sits above', () => {
    // A ruler is the quietest thing on a map. In linear mode the drawing renders
    // at scale 1, so the base 16px made these numerals the largest type in the
    // workspace — larger than the 13px enzyme names beneath them and the 11px
    // pane title above. Both linear annotation faces now draw at
    // LINEAR_REC_LABEL_FONT_PX, which is the size campaign 15's minimum-screen-px
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
    // large, so the floor is 4.5 and not 3. Measured on the built artifact
    // before this was fixed: 4.34 light, 4.27 claude-light, 3.63 claude-dark —
    // claude-dark was missing from the dark override and fell through to the
    // light tan. Only `dark` passed, at 7.21.
    const lightTan = ruleBody(mapCss, ".motif-pm-restriction-enz--typeiis").match(/#[0-9a-f]{6}/i)![0];
    const darkTan = mapCss.match(/--pm-typeiis-dark,\s*(#[0-9a-f]{6})/i)![1];

    // Both dark themes must name themselves in the override, or they inherit a
    // tan mixed for a white ground.
    expect(mapCss).toContain("[data-theme='claude-dark'] .motif-pm-restriction-enz--typeiis");

    for (const [selector, tan] of [
      [':root,\nhtml[data-theme="light"]', lightTan],
      ['html[data-theme="claude-light"]', lightTan],
      ['html[data-theme="dark"]', darkTan],
      ['html[data-theme="claude-dark"]', darkTan],
    ] as const) {
      const body = ruleBody(artifactCss, selector);
      expect(contrast(tan, token(body, '--bg-primary')), selector).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses the strong border token and clears 3:1 in every product theme', () => {
    const backbone = ruleBody(mapCss, '.motif-pm-backbone');
    expect(backbone).toContain('stroke: var(--border-strong');
    expect(mapCss).not.toMatch(/\[data-theme=['"](?:light|dark)['"]\][^{]*\.motif-pm-backbone/);

    for (const selector of [
      'html[data-theme="dark"]',
      ':root,\nhtml[data-theme="light"]',
      'html[data-theme="claude-light"]',
      'html[data-theme="claude-dark"]',
    ]) {
      const body = ruleBody(artifactCss, selector);
      expect(contrast(token(body, '--border-strong'), token(body, '--bg-primary')), selector)
        .toBeGreaterThanOrEqual(3);
    }
  });
});

describe('form placeholder legibility', () => {
  // Several placeholders carry the input's expected format rather than a
  // restatement of its label — "Known enzyme (for example, EcoRV)" — so they
  // have to be readable, not merely present. Lightening --text-muted toward the
  // field background put three of the four themes under the floor.
  it('sets the placeholder to --text-muted with nothing mixed into it', () => {
    const body = ruleBody(artifactCss, '.motif-cs-field::placeholder,\n.motif-cs-input::placeholder');
    expect(body).toMatch(/color:\s*var\(--text-muted\)\s*;/);
    expect(body, 'a blend toward the background is what dropped this below 4.5:1')
      .not.toMatch(/color:\s*color-mix\([^;]*--bg-/);
  });

  it('clears 4.5:1 against the field background in every theme', () => {
    for (const selector of [
      ':root,\nhtml[data-theme="light"]',
      'html[data-theme="dark"]',
      'html[data-theme="claude-light"]',
      'html[data-theme="claude-dark"]',
    ]) {
      const body = ruleBody(artifactCss, selector);
      expect(contrast(token(body, '--text-muted'), token(body, '--bg-primary')), selector)
        .toBeGreaterThanOrEqual(4.5);
    }
  });
});
