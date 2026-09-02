import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

// A selector lookup must land on the rule that DECLARES it. `indexOf` alone lands
// on the first mention, and this stylesheet comments heavily and cross-references
// sibling rules by name — one such comment sits above .motif-cs-edit-toolbar and
// names .motif-cs-selection-actions, which silently pointed the selection-action
// guard at the toolbar's body. Comments cannot simply be stripped: cssBlockAfter
// takes a comment as an anchor on purpose. So require a `{` after the selector,
// which a prose mention never has.
function ruleStart(from: number, selector: string): number {
  for (let at = artifactCss.indexOf(selector, from); at >= 0; at = artifactCss.indexOf(selector, at + 1)) {
    const rest = artifactCss.slice(at + selector.length);
    if (/^\s*\{/.test(rest)) return at;
  }
  return -1;
}
const vectors = JSON.parse(readFileSync(resolve(here, '..', '..', '..', 'public', 'data', 'vectors.json'), 'utf8')) as Array<{
  name: string;
  features: Array<{ color: string }>;
}>;

type Rgb = [number, number, number];

function cssBlock(selector: string): string {
  const start = ruleStart(0, selector);
  expect(start, `missing CSS selector: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = artifactCss.indexOf('{', start);
  const close = artifactCss.indexOf('}', open);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return artifactCss.slice(open + 1, close);
}

function cssBlockAfter(anchor: string, selector: string): string {
  const anchorStart = artifactCss.indexOf(anchor);
  expect(anchorStart, `missing CSS anchor: ${anchor}`).toBeGreaterThanOrEqual(0);
  const start = ruleStart(anchorStart + anchor.length, selector);
  expect(start, `missing CSS selector after ${anchor}: ${selector}`).toBeGreaterThan(anchorStart);
  const open = artifactCss.indexOf('{', start);
  const close = artifactCss.indexOf('}', open);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return artifactCss.slice(open + 1, close);
}

function cssVariable(block: string, name: string): string {
  const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1];
  expect(value, `missing ${name}`).toBeTruthy();
  return value!;
}

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as Rgb;
}

function mix(foreground: Rgb, background: Rgb, foregroundWeight: number): Rgb {
  return foreground.map((channel, index) => channel * foregroundWeight + background[index] * (1 - foregroundWeight)) as Rgb;
}

function luminance(color: Rgb): number {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: Rgb, b: Rgb): number {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * CIELAB, D65. Feature fills are separated from the sequence surface by HUE far
 * more than by lightness — measured in the browser they sit at 1.20-1.60:1, and
 * the light themes are the weaker pair — so a WCAG ratio is the wrong instrument
 * for them and would only ever be satisfied by repainting the whole surface.
 */
function lab(color: Rgb): [number, number, number] {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [x, y, z] = [
    (0.4124 * linear[0] + 0.3576 * linear[1] + 0.1805 * linear[2]) / 0.95047,
    0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2],
    (0.0193 * linear[0] + 0.1192 * linear[1] + 0.9505 * linear[2]) / 1.08883,
  ];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Floor on how far a 24% feature fill sits from the sequence surface in CIELAB.
 *
 * It exists because the block no longer carries an outline: a clip-path was
 * cutting the border off both diagonals of every arrowhead, so the edge is gone
 * and the fill is what draws the shape. Across the four themes and the shipped
 * pUC19 palette the fills measure dE 15.12 to 31.25; 10 sits under the weakest
 * with room for a palette tweak and far above the ~2.3 a reader can just detect.
 *
 * The assertion this replaces recomputed the removed border's colour from the
 * theme tokens and checked it cleared 3:1. It never read the stylesheet, so it
 * would have gone on passing about a colour nothing paints.
 */
const MIN_FEATURE_FILL_DELTA_E = 10;

describe('Sequence visual consistency guards', () => {
  it('uses one metric grid for Sequence toggles and actions', () => {
    const metrics = cssBlock([
      '.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-segmented button,',
      '.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-display-switch,',
      '.motif-cs-sequence-panel .motif-cs-selection-actions .motif-cs-mini-button',
    ].join('\n'));

    expect(metrics).toMatch(/height:\s*26px/);
    expect(metrics).toMatch(/min-height:\s*26px/);
    expect(metrics).toMatch(/padding:\s*0 8px/);
    expect(metrics).toMatch(/border-width:\s*1px/);
    expect(metrics).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(metrics).toMatch(/font-size:\s*12px/);
    expect(metrics).toMatch(/font-weight:\s*700/);
  });

  it('gives every idle selection action the same complete rectangle', () => {
    const disabled = cssBlock('.motif-cs-selection-bar[data-empty] .motif-cs-selection-actions .motif-cs-mini-button:disabled');
    const weight = /border-color:\s*color-mix\(in srgb, var\(--border-control\) (\d+)%, transparent\)/.exec(disabled);
    expect(weight, 'idle border weight').not.toBeNull();
    // Present but subordinate. The live edge is this same token at 100%, and above
    // 70% the four idle actions start competing with the two available ones again.
    expect(Number(weight![1])).toBeGreaterThanOrEqual(40);
    expect(Number(weight![1])).toBeLessThan(70);
    expect(disabled).toMatch(/background:\s*var\(--control-bg\)/);
    expect(disabled).toMatch(/color:\s*var\(--text-muted\)/);
    expect(disabled).toMatch(/opacity:\s*1/);
    expect(disabled).not.toMatch(/border-color:\s*transparent/);
    expect(disabled).not.toMatch(/display:\s*none/);
  });

  it('sizes the action strip from the metric grid that sizes its buttons', () => {
    const metrics = cssBlock([
      '.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-segmented button,',
      '.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-display-switch,',
      '.motif-cs-sequence-panel .motif-cs-selection-actions .motif-cs-mini-button',
    ].join('\n'));
    // Read the button height out of the grid that sets it. A hardcoded 26 here
    // would go on passing after the grid moved and the strip did not, which is
    // how a 24px strip came to clip 2px off the bottom border of every button.
    const buttonHeight = /height:\s*(\d+)px/.exec(metrics);
    expect(buttonHeight, 'metric grid height').not.toBeNull();

    const base = cssBlock('.motif-cs-selection-actions');
    const clipPad = /padding-block:\s*(\d+)px/.exec(base);
    expect(clipPad, 'strip clip padding').not.toBeNull();

    for (const anchor of [
      '@media (max-width: 460px)',
      '@container (max-width: 640px)',
      '@container (max-width: 360px)',
    ]) {
      const strip = cssBlockAfter(anchor, '.motif-cs-selection-actions');
      const basis = /flex:\s*0 0 (\d+)px/.exec(strip);
      expect(basis, `strip flex-basis under ${anchor}`).not.toBeNull();
      // border-box, so the basis has to hold the button and both clip margins.
      expect(
        Number(basis![1]) - 2 * Number(clipPad![1]),
        `strip content height under ${anchor}`,
      ).toBeGreaterThanOrEqual(Number(buttonHeight![1]));
    }
  });

  it('leaves the action strip enough clip for the shared focus ring', () => {
    const ring = cssBlock([
      '.motif-cs-window-icon:focus-visible,',
      'summary.motif-cs-panel-head:focus-visible',
    ].join('\n'));
    const width = /outline:\s*(\d+)px/.exec(ring);
    const offset = /outline-offset:\s*(\d+)px/.exec(ring);
    expect(width, 'focus outline width').not.toBeNull();
    expect(offset, 'focus outline offset').not.toBeNull();

    const base = cssBlock('.motif-cs-selection-actions');
    const pad = /padding-block:\s*(\d+)px/.exec(base);
    const pull = /margin-block:\s*-(\d+)px/.exec(base);
    expect(pad, 'strip clip padding').not.toBeNull();
    expect(pull, 'strip clip pullback').not.toBeNull();

    // The outermost 1px of the ring may fall outside the clip: measured on the
    // built artifact, 3px of clip against a 2px outline at a 2px offset leaves
    // the ring at 5.20-6.51:1 on all four sides in all four themes.
    expect(Number(pad![1])).toBeGreaterThanOrEqual(Number(width![1]) + Number(offset![1]) - 1);
    // The pullback has to match the padding, or the strip changes the bar's height.
    expect(Number(pull![1])).toBe(Number(pad![1]));
  });

  it('uses complete compact labels instead of fragments', () => {
    expect(artifactCss).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.motif-cs-map-title-full\s*\{[\s\S]*?display:\s*none[\s\S]*?\.motif-cs-map-title-compact\s*\{[\s\S]*?display:\s*inline/);
    expect(artifactCss).toMatch(/@container \(max-width: 520px\)[\s\S]*?\.motif-cs-edit-toolbar \.motif-cs-label-full\s*\{[\s\S]*?display:\s*inline[\s\S]*?\.motif-cs-edit-toolbar \.motif-cs-label-short\s*\{[\s\S]*?display:\s*none/);
  });

  it('keeps every selection action reachable across the compact-width handoffs', () => {
    const actions = cssBlock('.motif-cs-selection-actions');
    expect(actions).toMatch(/display:\s*flex/);
    expect(actions).toMatch(/flex-wrap:\s*nowrap/);
    expect(actions).toMatch(/min-width:\s*0/);
    expect(actions).toMatch(/overflow-x:\s*auto/);
    expect(actions).toMatch(/overflow-y:\s*hidden/);
    expect(actions).toMatch(/scroll-padding-inline:\s*3px/);
    expect(actions).toMatch(/scrollbar-width:\s*thin/);
    expect(actions).toMatch(/scrollbar-color:/);
    expect(cssBlock('.motif-cs-selection-actions .motif-cs-mini-button'))
      .toMatch(/scroll-margin-inline:\s*3px/);

    const twoLineActions = cssBlockAfter('@container (max-width: 640px)', '.motif-cs-selection-actions');
    expect(twoLineActions).toMatch(/width:\s*100%/);
    expect(twoLineActions).toMatch(/max-width:\s*none/);
    expect(twoLineActions).toMatch(/flex-wrap:\s*nowrap/);

    const narrowActions = cssBlockAfter('@container (max-width: 360px)', '.motif-cs-selection-actions');
    expect(narrowActions).toMatch(/overflow-x:\s*auto/);
    expect(narrowActions).toMatch(/overflow-y:\s*hidden/);
    expect(narrowActions).toMatch(/flex-wrap:\s*nowrap/);
    expect(cssBlockAfter('@container (max-width: 360px)', '.motif-cs-selection-actions .motif-cs-label-full'))
      .toMatch(/display:\s*none/);
    expect(cssBlockAfter('@container (max-width: 360px)', '.motif-cs-selection-actions .motif-cs-label-short'))
      .toMatch(/display:\s*inline/);

    const finalNarrowInset = cssBlockAfter(
      '/* The shared 520px metric rule above follows the 360px shorthand-label rule in',
      '.motif-cs-sequence-panel .motif-cs-selection-actions .motif-cs-mini-button',
    );
    expect(finalNarrowInset).toMatch(/padding-inline:\s*3px/);
  });

  it('keeps Sequence annotations above their text and non-text contrast floors in every theme', () => {
    // Read the weight out of the rule rather than restating it. A hardcoded 0.24
    // here would go on testing a fill the stylesheet had stopped painting — the
    // same way the removed border assertion did.
    const fillDeclaration = cssBlockAfter('.motif-cs-feature-track-lane', '.motif-cs-feature-block');
    const weightMatch = /background:\s*color-mix\(in srgb, var\(--feature-color\) (\d+)%/.exec(fillDeclaration);
    expect(weightMatch, 'feature fill weight').not.toBeNull();
    const featureFillWeight = Number(weightMatch![1]) / 100;

    const themes = [
      cssBlock(':root,\nhtml[data-theme="light"]'),
      cssBlock('html[data-theme="dark"]'),
      cssBlock('html[data-theme="claude-light"]'),
      cssBlock('html[data-theme="claude-dark"]'),
    ].map((block) => ({
      background: rgb(cssVariable(block, '--bg-primary')),
      secondary: rgb(cssVariable(block, '--bg-secondary')),
      primaryText: rgb(cssVariable(block, '--text-primary')),
      mutedText: rgb(cssVariable(block, '--text-muted')),
      amber: rgb(cssVariable(block, '--amber')),
      subtleBorder: rgb(cssVariable(block, '--border-subtle')),
    }));
    const featureColors = [...new Set(vectors.find((record) => record.name === 'pUC19')!.features.map((feature) => feature.color))]
      .map(rgb);

    for (const theme of themes) {
      const emptyBar = mix(theme.background, theme.secondary, 0.94);
      expect(contrast(theme.mutedText, emptyBar), 'disabled text fell below 3:1').toBeGreaterThanOrEqual(3);
      expect(contrast(theme.mutedText, theme.background), 'enzyme label text fell below 4.5:1').toBeGreaterThanOrEqual(4.5);
      expect(contrast(mix(theme.amber, theme.subtleBorder, 0.62), theme.background), 'enzyme underline fell below 3:1').toBeGreaterThanOrEqual(3);

      for (const featureColor of featureColors) {
        const fill = mix(featureColor, theme.background, featureFillWeight);
        expect(contrast(theme.primaryText, fill), 'feature text fell below 4.5:1').toBeGreaterThanOrEqual(4.5);
        expect(deltaE(fill, theme.background), 'feature fill became indistinct from the surface')
          .toBeGreaterThanOrEqual(MIN_FEATURE_FILL_DELTA_E);
      }
    }
  });

  it('gives the active pane nav one neutral grammar in every theme', () => {
    // It had two: light and dark took no pill and coloured only the ICON with
    // the accent, while the claude themes took a solid --accent-base fill with
    // --accent-contrast on label and icon. Same control, same state, two
    // languages. The reference discipline puts a grey pill on an active nav and
    // reserves the accent for links, primary buttons, real toggles, focus rings
    // and text selection. Composited: the pill measures 1.19-1.28:1 against its
    // bar in the four themes, the active label 11.08-16.01:1 on the pill, and
    // the resting label 5.33-7.73:1 on the bar.
    const active = cssBlock('.motif-cs-pane-toggle[data-active="true"]');
    expect(active).toContain('background: color-mix(in srgb, var(--text-primary) 9%, transparent)');
    expect(active).not.toMatch(/background:\s*var\(--accent/);
    expect(cssBlock('.motif-cs-pane-toggle[data-active="true"] .motif-cs-nav-icon')).toContain('color: inherit');

    // No per-theme copy may reintroduce the accent fill or the accent icon.
    for (const theme of ['claude-light', 'claude-dark']) {
      expect(artifactCss).not.toContain(`html[data-theme="${theme}"] .motif-cs-pane-toggle[data-active="true"]`);
      expect(artifactCss).not.toContain(`html[data-theme="${theme}"] .motif-cs-window-toggle[data-active="true"]`);
    }
  });

  it('leaves the clip-path arrowhead unoutlined on all four sides', () => {
    // The head is cut with clip-path, and a clip-path cuts the border with it:
    // the top and bottom edges survived the full length and the two diagonals had
    // none, so a directional feature ended in an outline that stopped. Either the
    // border goes or the head does. The border went.
    // Anchored, because a bare lookup lands on the shared `user-select: none`
    // group where .motif-cs-feature-block is the last selector before the brace.
    const block = cssBlockAfter('.motif-cs-feature-track-lane', '.motif-cs-feature-block');
    // List them rather than pattern-match an absence: `not.toMatch(/border:\s*(?!0)/)`
    // passes on `border: 0;` for the wrong reason, because \s* backtracks to zero
    // characters and the lookahead then reads the space instead of the value.
    const borders = [...block.matchAll(/(border[a-z-]*)\s*:\s*([^;]+);/g)]
      .map((match) => `${match[1]}: ${match[2].trim()}`);
    expect(borders).toEqual(['border: 0', 'border-radius: 0']);

    // The guard is only about the head, so fail if the head stops being clipped.
    const forward = cssBlock('.motif-cs-feature-block[data-strand="1"][data-head="true"]');
    const reverse = cssBlockAfter(
      '.motif-cs-feature-block[data-strand="1"][data-head="true"]',
      '.motif-cs-feature-block[data-strand="-1"][data-head="true"]',
    );
    expect(forward).toMatch(/clip-path:\s*polygon\(/);
    expect(reverse).toMatch(/clip-path:\s*polygon\(/);

    // And the hover/selected state must not smuggle one back in either.
    const active = cssBlockAfter(
      '.motif-cs-feature-block:hover,',
      '.motif-cs-feature-block[data-selected="true"]',
    );
    expect(active).not.toMatch(/border/);
  });

  it('keeps complement bases muted but opaque enough for text contrast in every theme', () => {
    const complement = cssBlock('.motif-cs-seq-complement');
    expect(complement).toMatch(/color:\s*var\(--text-muted\)/);
    expect(complement).toMatch(/border-top:\s*1px dotted var\(--border-subtle\)/);
    expect(complement).not.toMatch(/opacity:/);

    const opacity = Number.parseFloat(/opacity:\s*([\d.]+)/.exec(complement)?.[1] ?? '1');
    const selectedComplement = cssBlock('.motif-cs-seq-bases:has(.motif-cs-seq-hl:not(.motif-cs-seq-hl-motif):not(.motif-cs-seq-hl-restriction)) .motif-cs-seq-complement');
    expect(selectedComplement).toMatch(/color:\s*var\(--text-secondary\)/);
    expect(selectedComplement).not.toMatch(/opacity:/);

    const themes = [
      cssBlock(':root,\nhtml[data-theme="light"]'),
      cssBlock('html[data-theme="dark"]'),
      cssBlock('html[data-theme="claude-light"]'),
      cssBlock('html[data-theme="claude-dark"]'),
    ].map((theme) => ({
      background: rgb(cssVariable(theme, '--bg-primary')),
      mutedText: rgb(cssVariable(theme, '--text-muted')),
      secondaryText: rgb(cssVariable(theme, '--text-secondary')),
      accent: rgb(cssVariable(theme, '--accent')),
    }));

    for (const theme of themes) {
      const effectiveText = mix(theme.mutedText, theme.background, opacity);
      const selectionWash = mix(theme.accent, theme.background, 0.3);
      expect(contrast(effectiveText, theme.background), 'complement text fell below 4.5:1').toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.secondaryText, selectionWash), 'selected complement text fell below 4.5:1').toBeGreaterThanOrEqual(4.5);
    }
  });
});
