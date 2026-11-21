import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

// The body of the rule whose selector list is exactly `selector`, so a selector that also
// appears inside a longer list or a comment is not mistaken for it.
function ruleBody(selector: string): string {
  const at = artifactCss.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = artifactCss.indexOf('{', at + selector.length);
  return artifactCss.slice(open + 1, artifactCss.indexOf('}', open));
}

// One "on" style everywhere: the --bg-active fill, primary text, and no edge of its own.
const ON_BORDER = /border-color:\s*transparent;/;
const ON_FILL = /background:\s*var\(--bg-active\);/;
const ON_TEXT = /color:\s*var\(--text-primary\);/;
// No ring: an inset outline is a border by another name.
const ON_RING = /box-shadow:\s*none;/;
// Hover deepens the on fill itself, so it always reads past rest (a 14% accent mix over
// the canvas would go lighter than rest). It deepens with the text colour, not the
// accent: an on toggle carries no blue, hovered or not.
const ON_HOVER = /background:\s*color-mix\(in srgb, var\(--text-primary\) 8%, var\(--bg-active\)\);/;

function themeHex(theme: string, name: string): number[] {
  const open = artifactCss.search(new RegExp(`(^|\\n)html\\[data-theme="${theme}"\\] \\{`));
  const block = artifactCss.slice(open, artifactCss.indexOf('\n}', open));
  const hit = new RegExp(`${name}:\\s*#([0-9a-f]{6});`).exec(block);
  expect(hit, `${name} in ${theme}`).not.toBeNull();
  return [0, 2, 4].map((i) => parseInt(hit![1].slice(i, i + 2), 16));
}
const channel = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const mixed = (fg: number[], bg: number[], share: number) => fg.map((v, i) => Math.round(v * share + bg[i] * (1 - share)));

describe('toggle "on" state', () => {
  // A solid --accent-base fill would make Replace, Site labels and single-cutters the loudest
  // things on screen. Every toggle uses one quiet "on": the --bg-active fill with
  // primary text and no edge, the same fill as the selected record row.
  it.each([
    '.motif-cs-mini-button[data-active="true"]',
    '.motif-cs-edit-mode-toggle button[data-active]',
    '.motif-cs-segmented button[data-active]',
    '.motif-cs-theme-choice[data-active="true"]',
  ])('%s wears the --bg-active fill with no edge, not the solid accent', (selector) => {
    const body = ruleBody(selector);
    expect(body).toMatch(ON_BORDER);
    expect(body).toMatch(ON_FILL);
    expect(body).toMatch(ON_TEXT);
    expect(body).toMatch(ON_RING);
    expect(body).not.toMatch(/inset|var\(--accent-rule\)/);
    expect(body).not.toMatch(/var\(--accent-base\)|var\(--accent-contrast\)/);
    // Same weight on and off, or the button widens when it turns on.
    expect(body).not.toMatch(/font-weight/);
  });

  // With no edge cue, the fill must carry "on" by itself: it steps at least 1.25:1
  // off every surface a toggle sits on, hover goes further, and it stays apart from
  // the neutral soft fill and from the solid primary.
  it.each(['light', 'dark'])('%s: the on fill steps 1.25:1 off every surface and hover goes further', (theme) => {
    const on = themeHex(theme, '--bg-active');
    const hover = mixed(themeHex(theme, '--text-primary'), on, 0.08);
    for (const surface of ['--bg-primary', '--bg-secondary', '--panel-bg', '--topbar-bg']) {
      const bg = themeHex(theme, surface);
      expect(contrast(on, bg), `${theme} on vs ${surface}`).toBeGreaterThanOrEqual(1.25);
      expect(contrast(hover, bg), `${theme} hover vs ${surface}`).toBeGreaterThan(contrast(on, bg));
    }
    const text = themeHex(theme, '--text-primary');
    expect(contrast(text, on), `${theme} text on`).toBeGreaterThanOrEqual(7);
    expect(contrast(text, hover), `${theme} text on hover`).toBeGreaterThanOrEqual(7);
    expect(contrast(themeHex(theme, '--text-secondary'), on), `${theme} secondary text on`).toBeGreaterThanOrEqual(4.5);
    // Neutral, so an on toggle never competes with the data: no more hue than the theme's own
    // neutral surface (pure grey in light and dark), and a visible step off the soft fill.
    const soft = mixed(text, themeHex(theme, '--bg-primary'), 0.06);
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(on), `${theme} neutral`).toBeLessThanOrEqual(spread(themeHex(theme, '--bg-tertiary')) + 1);
    expect(on[2] - on[0], `${theme} not blue`).toBeLessThanOrEqual(0);
    expect(contrast(on, soft), `${theme} on vs soft`).toBeGreaterThanOrEqual(1.1);
    // Apart from the solid primary button.
    expect(contrast(on, themeHex(theme, '--accent-base')), `${theme} on vs primary`).toBeGreaterThanOrEqual(2);
  });

  // The selected record row (and its strip tab) keeps the accent, at the quietest tint that
  // passes the row's guards, quiet both ways: its step off the hover fill, the tightest
  // neighbour, sits just over the 1.25:1 floor, and its tint is exactly 10 channels of spread
  // past the neutral, leaning the accent's way. The step off hover is checked too: an open
  // row in dark of rgb(48,53,58) against a hover of rgb(48,48,48) would be 1.07:1; the
  // surfaces sit at 1.33 to 1.48.
  it.each(['light', 'dark'])('%s: the selected row keeps the quietest accent tint that passes', (theme) => {
    const on = themeHex(theme, '--bg-active');
    const row = themeHex(theme, '--bg-selected');
    const accent = themeHex(theme, '--accent');
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    const steps = ['--bg-primary', '--bg-secondary', '--panel-bg', '--topbar-bg'].map((s) => contrast(row, themeHex(theme, s)));
    expect(Math.min(...steps), `${theme} row floor`).toBeGreaterThanOrEqual(1.25);
    const offHover = contrast(row, themeHex(theme, '--bg-hover'));
    expect(offHover, `${theme} row apart from hover`).toBeGreaterThanOrEqual(1.25);
    expect(offHover, `${theme} row stays quiet`).toBeLessThanOrEqual(1.28);
    expect(contrast(themeHex(theme, '--text-primary'), row), `${theme} text on row`).toBeGreaterThanOrEqual(7);
    expect(contrast(themeHex(theme, '--text-secondary'), row), `${theme} secondary on row`).toBeGreaterThanOrEqual(4.5);
    expect(spread(row) - spread(on), `${theme} tinted`).toBeGreaterThanOrEqual(10);
    expect(spread(row) - spread(on), `${theme} quietest tint`).toBeLessThanOrEqual(11);
    // The tint leans the accent's way: its strongest channel is the accent's strongest.
    expect(row.indexOf(Math.max(...row)), `${theme} accent hue`).toBe(accent.indexOf(Math.max(...accent)));
  });

  it('gives the selected record row and its strip tab the row tint, not the toggle fill', () => {
    expect(ruleBody('.motif-cs-row[data-active="true"]')).toMatch(/background-color:\s*var\(--bg-selected\);/);
    expect(ruleBody('.motif-cs-record-tab[data-active="true"]')).toMatch(/background-color:\s*var\(--bg-selected\);/);
    // A collapsed group holding the selected record says so with the same tint (the later of
    // its two rules; the first shares its hover fill).
    const head = artifactCss.lastIndexOf('\n.motif-cs-inventory-group-head[data-active="true"] {');
    expect(artifactCss.slice(head, artifactCss.indexOf('}', head))).toMatch(/background:\s*var\(--bg-selected\);/);
  });

  it('draws an on icon, top-bar icon and switch thumb in the text colour, not the accent', () => {
    expect(ruleBody('.motif-cs-mini-button[data-active="true"] svg,\n.motif-cs-segmented button[data-active] svg')).toMatch(/color:\s*var\(--text-primary\);/);
    expect(ruleBody('.motif-cs-pane-toggle[data-active="true"] .motif-cs-nav-icon')).toMatch(/color:\s*var\(--text-primary\);/);
    expect(ruleBody('.motif-cs-display-switch[data-active="true"] .motif-cs-switch-track > span')).toMatch(/background:\s*var\(--text-primary\);/);
    expect(ruleBody('.motif-cs-msa-selection-actions .motif-cs-mini-button[data-active="true"]')).toMatch(/color:\s*var\(--text-primary\);/);
  });

  it('keeps the Show tracks and Complement switches free of the ring', () => {
    const body = ruleBody('.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-display-switch[data-active="true"]');
    expect(body).toMatch(/box-shadow:\s*none;/);
    expect(body).toMatch(/background:\s*transparent;/);
  });

  it('deepens the fill on hover and focus, as the top-bar toggles do', () => {
    const body = ruleBody([
      '.motif-cs-mini-button[data-active="true"]:hover,',
      '.motif-cs-mini-button[data-active="true"]:focus-visible,',
      '.motif-cs-segmented button[data-active]:hover,',
      '.motif-cs-segmented button[data-active]:focus-visible,',
      '.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-segmented button[data-active]:hover',
    ].join('\n'));
    expect(body).toMatch(ON_HOVER);
  });

  it('keeps the typing-mode label readable on the tint', () => {
    const body = ruleBody('.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-segmented button[data-active]');
    expect(body).toMatch(ON_TEXT);
    expect(body).not.toMatch(/font-weight|--accent-contrast/);
  });
});

describe('toggle "on" state in the floating workspaces', () => {
  const sheet = (name: string) => readFileSync(resolve(here, '..', name), 'utf8');
  const bodyIn = (css: string, selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', at + selector.length);
    return css.slice(open + 1, css.indexOf('}', open));
  };

  it.each([
    ['claude-science-primer-workspace.css', '.motif-cs-primer-preset[data-active]'],
    ['claude-science-cloning-design-workspace.css', '.motif-cs-cloning-design-methods button[data-selected]'],
    ['claude-science-cloning-design-workspace.css', '.motif-cs-cloning-design-segmented label[data-selected]'],
    ['claude-science-cloning-design-workspace.css', '.motif-cs-cloning-design-orientation button[data-selected]'],
    ['claude-science-msa.css', ".motif-cs-msa-workspace .motif-cs-msa-row-stats-scroll th > button[data-active='true']"],
  ])('%s %s wears the --bg-active fill with no ring', (file, selector) => {
    const body = bodyIn(sheet(file), selector);
    expect(body).toMatch(ON_FILL);
    expect(body).toMatch(ON_TEXT);
    expect(body).toMatch(ON_RING);
    expect(body).not.toMatch(/font-weight/);
  });

  it.each([
    ['claude-science-primer-workspace.css', '.motif-cs-primer-pair-row[data-selected]'],
    ['motif-artifact.css', '.motif-cs-msa-record-option[data-active="true"]'],
  ])('%s %s is a selected row: the one "on" fill and no ring', (file, selector) => {
    const body = bodyIn(sheet(file), selector);
    expect(body).toMatch(ON_FILL);
    expect(body).toMatch(ON_RING);
    expect(body).not.toMatch(/inset|var\(--accent-rule\)/);
  });

  it('draws the chosen primer purpose like a segmented option: the fill inside the group\'s one field edge', () => {
    const css = sheet('claude-science-primer-workspace.css');
    const body = bodyIn(css, '.motif-cs-primer-intent label[data-checked]');
    expect(body).toMatch(ON_FILL);
    expect(body).toMatch(ON_TEXT);
    expect(body).toMatch(/border-color:\s*transparent;/);
    expect(body).toMatch(ON_RING);
    expect(body).not.toMatch(/inset|var\(--accent-rule\)/);
    expect(body).not.toMatch(/font-weight|margin|padding|width|height/);
    expect(bodyIn(css, '.motif-cs-primer-intent')).toMatch(/gap:\s*0;[\s\S]*padding:\s*1px;[\s\S]*border:\s*1px solid var\(--border-strong\);[\s\S]*isolation:\s*isolate;/);
  });

  it('leaves no solid accent fill on a workspace toggle or row', () => {
    for (const file of ['claude-science-primer-workspace.css', 'claude-science-cloning-design-workspace.css', 'claude-science-msa.css']) {
      expect(sheet(file), file).not.toMatch(/background:\s*var\(--accent-base\)/);
    }
    expect(artifactCss).not.toContain('.motif-cs-msa-record-option[data-active="true"]:hover {');
  });
});

describe('an "on" control has no edge of its own', () => {
  it('fills an on segment inside the group\'s one field edge, with no box of its own', () => {
    const body = ruleBody('html[data-theme] .motif-cs-segmented > button[data-active]');
    expect(body).toMatch(/border-color:\s*transparent;/);
    expect(body).toMatch(ON_RING);
    expect(body).toMatch(/border-radius:\s*2px;/);
    expect(body).not.toMatch(/inset|var\(--accent-rule\)/);
    // The group keeps the field edge: 1px padding inside a 1px --border-strong border.
    expect(ruleBody('.motif-cs-segmented')).toMatch(/padding:\s*1px;[\s\S]*border:\s*1px solid var\(--border-strong\);[\s\S]*isolation:\s*isolate;/);
    expect(body).not.toMatch(/margin|padding|width|height/);
  });

  it('gives an open Sites or Digest head the one "on" fill and no drawn edge', () => {
    expect(ruleBody('.motif-cs-map-dock-strip > details[open] > .motif-cs-panel-head')).toMatch(ON_FILL);
    expect(ruleBody('.motif-cs-map-dock-strip > details[open] > .motif-cs-panel-head:hover,\n.motif-cs-map-dock-strip > details[open] > .motif-cs-panel-head:focus-visible')).toMatch(ON_HOVER);
    // No 2px accent edge is drawn with inset shadows over the strip's rules.
    expect(artifactCss).not.toMatch(/--motif-cs-dock-head-edge/);
    expect(artifactCss).not.toMatch(/\.motif-cs-map-dock-strip[^{]*\{[^}]*accent-rule/);
  });

  it('draws Records, Sequence and Map as three separate toggles, not one joined group', () => {
    const base = ruleBody('.motif-cs-pane-toggle');
    expect(base).toMatch(/border:\s*1px solid transparent;/);
    expect(base).toMatch(/background:\s*transparent;/);
    // The fill stops inside the clear edge, so two neighbouring "on" toggles show a gap.
    expect(base).toMatch(/background-clip:\s*padding-box;/);
    // A background shorthand in a state rule resets that clip to border-box and closes the
    // gap, so the hover, on, on-hover, drop-target and disabled-on rules set the colour only.
    for (const selector of [
      '.motif-cs-pane-toggle:hover,\n.motif-cs-pane-toggle:focus-visible',
      '.motif-cs-pane-toggle[data-active="true"]',
      '.motif-cs-pane-toggle[data-active="true"]:hover,\n.motif-cs-pane-toggle[data-active="true"]:focus-visible',
      '.motif-cs-pane-toggle[data-drop-target="true"]',
    ]) {
      expect(ruleBody(selector), selector).not.toMatch(/(^|[\s;])background:/);
    }
    expect(ruleBody('.motif-cs-pane-toggle:not([data-pane-toggle="tools"]) + .motif-cs-pane-toggle:not([data-pane-toggle="tools"])')).toMatch(/margin-left:\s*2px;/);
    // No joined corners and no seam rule between two on toggles.
    expect(artifactCss).not.toMatch(/\.motif-cs-pane-toggle[^{]*\{[^}]*border-(start|end)-(start|end)-radius:\s*0/);
    expect(artifactCss).not.toContain('.motif-cs-pane-toggle[data-active="true"]:not([data-pane-toggle="tools"]) + .motif-cs-pane-toggle[data-active="true"]');
  });
});
