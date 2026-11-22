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
 * The block carries no outline: a clip-path would cut a border off both diagonals
 * of every arrowhead, so the fill is what draws the shape. Across both themes and
 * the shipped pUC19 palette 10 sits under the weakest fill with room for a palette
 * tweak and far above the ~2.3 a reader can just detect.
 *
 * The guard reads the fills the stylesheet paints. It does not recompute a border
 * colour from the theme tokens, which would pass about a colour nothing paints.
 */
const MIN_FEATURE_FILL_DELTA_E = 10;

describe('Sequence visual consistency guards', () => {
  it('uses the 28px small-control height for every Sequence toggle and action', () => {
    const toolbar = cssBlock('.motif-cs-sequence-panel .motif-cs-edit-toolbar button');
    const actions = cssBlock('.motif-cs-sequence-panel .motif-cs-selection-actions .motif-cs-mini-button');
    for (const metrics of [toolbar, actions]) {
      expect(metrics).toMatch(/height:\s*var\(--control-h-sm\)/);
      expect(metrics).toMatch(/min-height:\s*var\(--control-h-sm\)/);
      expect(metrics).toMatch(/padding:\s*0 var\(--space-2\)/);
      expect(metrics).toMatch(/border-radius:\s*var\(--radius-sm\)/);
      expect(metrics).toMatch(/font-size:\s*var\(--fs-sm\)/);
      expect(metrics).toMatch(/font-weight:\s*500/);
    }
    // The options of a segmented group in the edit toolbar fill the whole group.
    const options = cssBlock('.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-segmented button');
    expect(options).toMatch(/height:\s*var\(--control-h-sm\)/);
    expect(options).toMatch(/min-height:\s*var\(--control-h-sm\)/);
    const group = cssBlock('.motif-cs-edit-toolbar .motif-cs-segmented');
    expect(group).toMatch(/padding:\s*0;/);
    // One control height, 28, for the group AND each option: the group's 1px edge is an
    // inset shadow that takes no layout space, so the options fill the full 28px.
    expect(group).toMatch(/border:\s*0;/);
    expect(group).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--border-strong\);/);
    expect(group).not.toMatch(/(^|[\s;])(min-|max-)?height:/);
    expect(Number(/--control-h-sm:\s*(\d+)px;/.exec(artifactCss)?.[1])).toBe(28);
    // The on fill stops inside the option's clear 1px edge, so it never covers the group's edge.
    expect(cssBlock('html[data-theme] .motif-cs-edit-toolbar .motif-cs-segmented > button[data-active]')).toMatch(/background-clip:\s*padding-box;/);
    const shape = cssBlock('.motif-cs-map-toolbar .motif-cs-map-shape');
    expect(shape).toMatch(/height:\s*28px;/);
    expect(shape).toMatch(/border:\s*0;/);
    expect(shape).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--border-strong\);/);
    const segment = cssBlock('.motif-cs-map-toolbar .motif-cs-map-shape > button');
    expect(segment).toMatch(/height:\s*28px;/);
    expect(segment).toMatch(/min-height:\s*28px;/);
    expect(segment).toMatch(/border:\s*1px solid transparent;/);
    // Forced colours drop the shadow; a system-colour outline drawn inside keeps the edge.
    expect(artifactCss).toMatch(/@media \(forced-colors: active\) \{\s*\.motif-cs-edit-toolbar \.motif-cs-segmented,\s*\.motif-cs-map-toolbar \.motif-cs-map-shape \{\s*outline: 1px solid CanvasText;\s*outline-offset: -1px;/);
  });

  it('leaves the toolbar flat: no box around a toggle until it is hovered', () => {
    const toolbar = cssBlock('.motif-cs-sequence-panel .motif-cs-edit-toolbar button');
    expect(toolbar).toMatch(/border:\s*1px solid transparent/);
    expect(toolbar).toMatch(/background:\s*transparent/);
    // A switch reads "on" from its track and a heavier label. Its fill stays
    // transparent in every theme, because the per-theme active fill would
    // otherwise paint --accent-contrast white on the pane.
    const on = cssBlock('.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-display-switch[data-active="true"]');
    expect(on).toMatch(/background:\s*transparent/);
    expect(on).toMatch(/border-color:\s*transparent/);
    expect(on).toMatch(/color:\s*var\(--text-primary\)/);
    expect(on).toMatch(/font-weight:\s*600/);
    // Keyboard focus keeps a visible ring on every toolbar button.
    expect(cssBlock('.motif-cs-sequence-panel .motif-cs-edit-toolbar button:focus-visible')).toMatch(/outline:\s*2px solid var\(--focus-ring\)/);
  });

  it('shows one hint while nothing is selected and keeps one row height', () => {
    // Copy and Add feature stay in place without a selection, disabled, so a
    // selection never shifts the dock; no rule hides a dock control by state.
    expect(artifactCss).not.toContain('.motif-cs-selection-bar[data-empty] .motif-cs-selection-actions > .motif-cs-mini-button');
    expect(cssBlock('.motif-cs-selection-bar')).toMatch(/min-height:\s*32px/);
    const hint = cssBlock('.motif-cs-selection-bar[data-empty] .motif-cs-selection-name');
    expect(hint).toMatch(/color:\s*var\(--text-secondary\)/);
    expect(hint).toMatch(/font-weight:\s*400/);
    // The length is part of the one readout ("1–38 · 38 bp"), not a second chip.
    expect(artifactCss).not.toContain('.motif-cs-selection-label .motif-cs-chip');
    // The readout fills its slot whatever it says, and its digits keep one width
    // while a drag changes them.
    expect(/\n\.motif-cs-selection-name \{([^}]*)\}/.exec(artifactCss)?.[1]).toMatch(/flex:\s*1 1 auto/);
    expect(cssBlock('.motif-cs-selection-label')).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('keeps every selection action reachable at every width without a scroller', () => {
    const bar = cssBlock('.motif-cs-selection-bar');
    expect(bar).toMatch(/display:\s*flex/);
    expect(bar).toMatch(/flex-wrap:\s*wrap/);
    // The bare selector also ends the empty-bar rule, so match the rule that opens a line.
    const actions = /\n\.motif-cs-selection-actions \{([^}]*)\}/.exec(artifactCss)?.[1] ?? '';
    expect(actions, 'missing .motif-cs-selection-actions rule').not.toBe('');
    expect(actions).toMatch(/display:\s*flex/);
    expect(actions).toMatch(/flex:\s*0 0 auto/);
    expect(actions).not.toMatch(/overflow/);
    // The readout gives way first, so a long feature name never pushes Create away.
    const label = cssBlock('.motif-cs-selection-label');
    expect(label).toMatch(/flex:\s*1 1 8ch/);
    expect(label).toMatch(/min-width:\s*0/);
    expect(/\n\.motif-cs-selection-name \{([^}]*)\}/.exec(artifactCss)?.[1]).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('uses complete labels instead of fragments', () => {
    expect(artifactCss).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.motif-cs-map-title-full\s*\{[\s\S]*?display:\s*none[\s\S]*?\.motif-cs-map-title-compact\s*\{[\s\S]*?display:\s*inline/);
    // The Sequence pane never swaps to fragments: three dock actions fit at every
    // width, and the rest live in Create in full words.
    expect(artifactCss).not.toContain('.motif-cs-label-short');
    expect(artifactCss).not.toContain('.motif-cs-label-full');
  });

  it('keeps Sequence annotations above their text and non-text contrast floors in every theme', () => {
    // Read the weight out of the rule rather than restating it. A hardcoded 0.24
    // here would go on testing a fill the stylesheet may no longer paint.
    const fillDeclaration = cssBlockAfter('.motif-cs-feature-track-lane', '.motif-cs-feature-block');
    const weightMatch = /background:\s*color-mix\(in srgb, var\(--feature-color\) (\d+)%/.exec(fillDeclaration);
    expect(weightMatch, 'feature fill weight').not.toBeNull();
    const featureFillWeight = Number(weightMatch![1]) / 100;

    const themes = [
      cssBlock(':root,\nhtml[data-theme="light"]'),
      cssBlock('html[data-theme="dark"]'),
    ].map((block) => ({
      background: rgb(cssVariable(block, '--bg-primary')),
      secondary: rgb(cssVariable(block, '--bg-secondary')),
      primaryText: rgb(cssVariable(block, '--text-primary')),
      mutedText: rgb(cssVariable(block, '--text-muted')),
      amber: rgb(cssVariable(block, '--amber')),
    }));
    const featureColors = [...new Set(vectors.find((record) => record.name === 'pUC19')!.features.map((feature) => feature.color))]
      .map(rgb);
    // The underline is what marks a label as a button, so it is held to the text floor, and its weight
    // is read out of the rule rather than restated.
    const underline = /border-bottom:\s*1px solid color-mix\(in srgb, var\(--amber\) (\d+)%, var\(--bg-primary\)\)/
      .exec(cssBlock('.motif-cs-restriction-label'));
    expect(underline, 'enzyme underline declaration').not.toBeNull();
    const underlineWeight = Number(underline![1]) / 100;

    for (const theme of themes) {
      const emptyBar = mix(theme.background, theme.secondary, 0.94);
      expect(contrast(theme.mutedText, emptyBar), 'disabled text fell below 3:1').toBeGreaterThanOrEqual(3);
      expect(contrast(theme.mutedText, theme.background), 'enzyme label text fell below 4.5:1').toBeGreaterThanOrEqual(4.5);
      expect(contrast(mix(theme.amber, theme.background, underlineWeight), theme.background), 'enzyme underline fell below 4.5:1').toBeGreaterThanOrEqual(4.5);

      for (const featureColor of featureColors) {
        const fill = mix(featureColor, theme.background, featureFillWeight);
        expect(contrast(theme.primaryText, fill), 'feature text fell below 4.5:1').toBeGreaterThanOrEqual(4.5);
        expect(deltaE(fill, theme.background), 'feature fill became indistinct from the surface')
          .toBeGreaterThanOrEqual(MIN_FEATURE_FILL_DELTA_E);
      }
    }
  });

  it('gives every top-bar toggle one on/off grammar in every theme', () => {
    // One grammar for every theme: no outline (the 1px stays, transparent), off is
    // secondary text with a muted icon, on is the one --bg-active fill (neutral)
    // with primary text and a primary icon. Two cues, so on and off differ by more
    // than the fill's 1.1:1. Not a solid accent block, and the weight does not
    // change, because a bolder label is wider and would move the row. A grey pill
    // on a borderless label would make the panes read as tabs and an off pane
    // ("Records") as plain text.
    const base = cssBlock('.motif-cs-pane-toggle');
    expect(base).toContain('border: 1px solid transparent');
    expect(base).toContain('background: transparent');
    expect(base).toContain('color: var(--text-secondary)');
    const active = cssBlock('.motif-cs-pane-toggle[data-active="true"]');
    expect(active).toContain('background-color: var(--bg-active)');
    expect(active).toContain('border-color: transparent');
    expect(active).toContain('box-shadow: none');
    expect(active).toContain('color: var(--text-primary)');
    expect(active).not.toMatch(/background:\s*var\(--accent/);
    expect(active).not.toMatch(/font-weight/);
    expect(cssBlock('.motif-cs-pane-toggle[data-active="true"] .motif-cs-nav-icon')).toContain('color: var(--text-primary)');

    // No per-theme copy may reintroduce the accent fill or the accent icon.
    expect(artifactCss).not.toMatch(/html\[data-theme="[a-z-]+"\] \.motif-cs-(pane|window)-toggle\[data-active="true"\]/);
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

  it('draws focus inside the arrowhead, the panel summaries and the record tabs, where an outer ring is cut', () => {
    // The clip-path above cuts the shared 2px-outside outline too: a focused
    // arrowhead would paint only its hover tint. `details.motif-cs-panel` clips
    // its summary's outline, and the record tab strip clips a tab's. Each draws
    // its ring inside.
    const head = cssBlock('.motif-cs-feature-block[data-head="true"]:focus-visible');
    expect(head).toMatch(/inset 0 0 0 2px var\(--focus-ring\)/);
    expect(head).toMatch(/inset 0 0 0 3px var\(--bg-primary\)/);
    // It must outrank the shared focus rule's `box-shadow: none`, which is 0,2,0
    // and comes earlier in that section.
    const shared = artifactCss.indexOf('.motif-cs-feature-block:focus-visible,');
    expect(shared).toBeGreaterThanOrEqual(0);
    expect(artifactCss.indexOf('.motif-cs-feature-block[data-head="true"]:focus-visible {')).toBeGreaterThan(shared);

    // The shell-wide `#root :focus-visible` (1,1,0) sets the outline offset, so
    // only a #root-scoped rule can move these rings inward.
    const inset = cssBlock('#root summary.motif-cs-panel-head:focus-visible,\n#root .motif-cs-record-tab:focus-visible');
    expect(inset).toMatch(/outline-offset:\s*-2px/);

    // The head ring must stand at 3:1 against the surface outside it and the
    // resting fill it paints over, for every pUC19 feature colour in every theme.
    const fillDeclaration = cssBlockAfter('.motif-cs-feature-track-lane', '.motif-cs-feature-block');
    const featureFillWeight = Number(/background:\s*color-mix\(in srgb, var\(--feature-color\) (\d+)%/.exec(fillDeclaration)![1]) / 100;
    const featureColors = [...new Set(vectors.find((record) => record.name === 'pUC19')!.features.map((feature) => feature.color))]
      .map(rgb);
    for (const block of [
      cssBlock(':root,\nhtml[data-theme="light"]'),
      cssBlock('html[data-theme="dark"]'),
    ]) {
      const background = rgb(cssVariable(block, '--bg-primary'));
      const ringHex = /--focus-ring:\s*(#[0-9a-f]{6})/i.exec(block)?.[1] ?? cssVariable(block, '--accent');
      const ring = rgb(ringHex);
      expect(contrast(ring, background), 'focus ring against the surface').toBeGreaterThanOrEqual(3);
      for (const featureColor of featureColors) {
        const restingFill = mix(featureColor, background, featureFillWeight);
        expect(contrast(ring, restingFill), 'focus ring against a resting feature fill').toBeGreaterThanOrEqual(3);
      }
    }
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
    ].map((theme) => ({
      background: rgb(cssVariable(theme, '--bg-primary')),
      mutedText: rgb(cssVariable(theme, '--text-muted')),
      secondaryText: rgb(cssVariable(theme, '--text-secondary')),
      accent: rgb(cssVariable(theme, '--accent')),
    }));

    // The wash is the shared selection token, so read its weight out of the token
    // rather than restating it, so the guard follows the tint the stylesheet paints.
    const washWeight = Number(
      /--selection-bg:\s*color-mix\(in srgb, var\(--accent\) (\d+)%, var\(--bg-primary\)\)/.exec(artifactCss)?.[1],
    ) / 100;
    expect(washWeight, 'selection token weight').toBeGreaterThan(0);
    expect(cssBlock('.motif-cs-seq-hl')).toMatch(/background:\s*var\(--selection-bg\)/);

    for (const theme of themes) {
      const effectiveText = mix(theme.mutedText, theme.background, opacity);
      const selectionWash = mix(theme.accent, theme.background, washWeight);
      expect(contrast(effectiveText, theme.background), 'complement text fell below 4.5:1').toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.secondaryText, selectionWash), 'selected complement text fell below 4.5:1').toBeGreaterThanOrEqual(4.5);
    }
  });
});
