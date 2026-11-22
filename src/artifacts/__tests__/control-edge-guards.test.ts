import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '..');
const sheets = readdirSync(dir).filter((name) => name.endsWith('.css'));
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8');
const artifactCss = read('motif-artifact.css');

function ruleBody(selector: string): string {
  const at = artifactCss.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = artifactCss.indexOf('{', at + selector.length);
  return artifactCss.slice(open + 1, artifactCss.indexOf('}', open));
}

function themeHex(theme: string, name: string): number[] {
  const open = artifactCss.search(new RegExp(`(^|\\n)html\\[data-theme="${theme}"\\] \\{`));
  const block = artifactCss.slice(open, artifactCss.indexOf('\n}', open));
  const hit = new RegExp(`${name}:\\s*#([0-9a-f]{6});`).exec(block);
  expect(hit, `${name} in ${theme}`).not.toBeNull();
  return [0, 2, 4].map((i) => parseInt(hit![1].slice(i, i + 2), 16));
}
const channel = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe('buttons have no outline; fields keep one edge', () => {
  // A dark 1px --border-control edge (#6b6b6b light, #ababab dark) would make every
  // button an outlined box. No stylesheet defines the token: buttons rest as text or
  // icons on the surface and fill on hover.
  it('defines no --border-control in any stylesheet', () => {
    for (const name of sheets) expect(read(name), name).not.toContain('--border-control');
  });

  it.each([
    ['.motif-cs-pane-toggle', 'transparent'],
    ['.motif-cs-mini-button', 'var\\(--control-soft\\)'],
    ['.motif-cs-icon-button', 'transparent'],
    ['.motif-cs-map-button', 'transparent'],
  ])(
    '%s rests with a clear 1px edge and its rank\'s fill (%s), so it has no outline and keeps its size',
    (selector, fill) => {
      const body = ruleBody(selector);
      expect(body).toMatch(/border:\s*1px solid transparent;/);
      // The text command is the soft rank (a resting neutral wash); toggles and icon buttons stay ghost.
      expect(body).toMatch(new RegExp(`background:\\s*${fill};`));
    },
  );

  it.each([
    ['.motif-cs-mini-button:hover,\n.motif-cs-mini-button:focus-visible', 'var\\(--control-soft-hover\\)'],
    ['.motif-cs-icon-button:hover,\n.motif-cs-icon-button:focus-visible', 'var\\(--control-hover\\)'],
    ['.motif-cs-map-button:hover,\n.motif-cs-map-button:focus-visible', 'var\\(--control-hover\\)'],
  ])(
    'hover fills %s with %s and draws no edge',
    (selector, fill) => {
      const body = ruleBody(selector);
      expect(body).toMatch(/border-color:\s*transparent;/);
      expect(body).toMatch(new RegExp(`background:\\s*${fill};`));
    },
  );

  it.each(['.motif-cs-segmented', '.motif-cs-input', '.motif-cs-color-field', '.motif-cs-map-sites-toggle'])(
    '%s keeps the one field edge, --border-strong',
    (selector) => {
      expect(ruleBody(selector)).toMatch(/border:\s*1px solid var\(--border-strong\);/);
    },
  );

  it('draws no control edge with an inset shadow anywhere', () => {
    for (const name of sheets) {
      expect(read(name), name).not.toMatch(/inset 0 0 0 [12]px var\(--(accent-rule|border-control)\)/);
    }
  });

  it('gives a forced-colours user the system button edge back', () => {
    const at = artifactCss.indexOf('@media (forced-colors: active)');
    const block = artifactCss.slice(at, artifactCss.indexOf('\n}\n', at));
    expect(block).toMatch(/\.motif-cs-pane-toggle[^{]*\.motif-cs-mini-button[^{]*\{\s*border-color:\s*ButtonText;/);
    expect(block).toMatch(/\[data-active\][^{]*\{\s*border-color:\s*Highlight;/);
  });
});

describe('one "on" fill in every theme', () => {
  // --bg-active is the shared "on" fill under primary text, so it is a light tint in
  // every theme, not a solid accent for white text.
  it.each(['light', 'dark'])('%s: primary text reads at 7:1 or better on --bg-active', (theme) => {
    expect(contrast(themeHex(theme, '--text-primary'), themeHex(theme, '--bg-active'))).toBeGreaterThanOrEqual(7);
  });

  it('fills the selected record row 4px in from both sides with a 6px radius, text unmoved', () => {
    const body = ruleBody('.motif-cs-inventory-record-row');
    expect(body).toMatch(/padding-inline:\s*6px;/);
    expect(body).toMatch(/border-inline:\s*4px solid transparent;/);
    expect(body).toMatch(/border-radius:\s*6px;/);
    expect(body).toMatch(/background-clip:\s*padding-box;/);
    // The selected row keeps the accent at its quietest passing tint (on toggles are
    // neutral, the selected row is not).
    expect(ruleBody('.motif-cs-row[data-active="true"]')).toMatch(/background-color:\s*var\(--bg-selected\);/);
  });

  it('tints a collapsed Records group that holds the selected record with the on fill', () => {
    // The selected row is hidden inside a collapsed group, so the group head is the only
    // place the selection shows.
    // The last rule for the bare selector wins (an earlier list shares the hover fill).
    const at = artifactCss.lastIndexOf('\n.motif-cs-inventory-group-head[data-active="true"] {');
    expect(at).toBeGreaterThanOrEqual(0);
    const body = artifactCss.slice(artifactCss.indexOf('{', at) + 1, artifactCss.indexOf('}', at));
    expect(body).toMatch(/background:\s*var\(--bg-selected\);/);
    expect(body).toMatch(/color:\s*var\(--text-primary\);/);
    expect(body).not.toMatch(/background:\s*transparent;/);
  });

  it('moves muted text to secondary wherever the on fill sits under it', () => {
    // The on fill steps 1.25:1 off its surface, so muted text on it would read 3.85:1 in light.
    const body = ruleBody([
      '.motif-cs-row[data-active="true"] .motif-cs-row-main small,',
      '.motif-cs-row[data-active="true"] .motif-cs-row-meta,',
      '.motif-cs-inventory-group-head[data-active="true"] small,',
      '.motif-cs-gel-source-row:is(:hover, [data-selected]) small,',
      '.motif-cs-msa-record-option[data-active="true"] :is(small, em),',
      '.motif-cs-primer-pair-row[data-selected] small',
    ].join('\n'));
    expect(body).toMatch(/color:\s*var\(--text-secondary\);/);
  });

  it('keeps the 4px inset on hover and when selected: no state rule resets background-clip with the shorthand', () => {
    // A `background:` shorthand resets background-clip to border-box, so a state rule
    // that used it would run the row's fill edge to edge over the 4px transparent sides.
    // Every rule that can win over the inset must set only background-color.
    const shorthand = /(^|[\s;])background:/;
    for (const selector of [
      '.motif-cs-row:hover,\n.motif-cs-row:focus-visible',
      '.motif-cs-row[data-active="true"]',
      '.motif-cs-record-tab:hover,\n.motif-cs-record-tab:focus-visible',
      '.motif-cs-record-tab[data-active="true"]',
    ]) {
      expect(ruleBody(selector), selector).not.toMatch(shorthand);
    }
    const compact = artifactCss.indexOf('  .motif-cs-sidebar .motif-cs-row.motif-cs-row-compact[data-active="true"] {');
    expect(compact).toBeGreaterThanOrEqual(0);
    expect(artifactCss.slice(compact, artifactCss.indexOf('}', compact))).not.toMatch(shorthand);
  });
});

describe('the selection is its own colour', () => {
  // A 42% mix would make the selected-bases fill rgb(148,192,234) in light and (39,84,125)
  // in dark, and text on it would fall from 14.1 to 10.2:1 and from 11.4 to 7.7:1. The
  // lighter 22% tint, rgb(199,222,244) and (35,58,80), is the selection fill.
  it('mixes 22% accent into the selection fill', () => {
    const weight = Number(/--selection-bg:\s*color-mix\(in srgb, var\(--accent\) (\d+)%, var\(--bg-primary\)\);/.exec(artifactCss)?.[1]);
    expect(weight).toBe(22);
  });

  it('keeps the selection apart from a Find match and from the hover fill in every theme', () => {
    const weight = Number(/--selection-bg:\s*color-mix\(in srgb, var\(--accent\) (\d+)%, var\(--bg-primary\)\);/.exec(artifactCss)?.[1]) / 100;
    const find = read('claude-science-find.css');
    const findWeight = Number(/\.motif-cs-find-hit \{\s*background: color-mix\(in srgb, var\(--purple\) (\d+)%, transparent\);/.exec(find)?.[1]) / 100;
    expect(findWeight).toBeGreaterThan(0);
    const mixOn = (a: number[], b: number[], w: number) => a.map((v, i) => v * w + b[i] * (1 - w));
    const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
    for (const theme of ['light', 'dark']) {
      const bg = themeHex(theme, '--bg-primary');
      const selection = mixOn(themeHex(theme, '--accent'), bg, weight);
      // In both themes the selection fill stays at least 24 RGB units from the Find tint and from hover.
      expect(distance(selection, mixOn(themeHex(theme, '--purple'), bg, findWeight)), `${theme} find`).toBeGreaterThanOrEqual(24);
      expect(distance(selection, themeHex(theme, '--bg-hover')), `${theme} hover`).toBeGreaterThanOrEqual(24);
      expect(contrast(themeHex(theme, '--text-primary'), selection), `${theme} text`).toBeGreaterThanOrEqual(9);
    }
  });

  it('paints the map selection as a light wash of the selection hue, never an opaque band', () => {
    // The map selection is a light accent wash, not an opaque --selection-bg band, which
    // would be a dark tube round the ring and sink the numerals under it. A wash up to
    // 0.06 keeps a numeral at 90% of its bare contrast, and no theme raises it.
    const band = ruleBody('.motif-cs-map-frame .motif-pm-selection-layer .motif-pm-selection');
    // The accent, through the fade gradient whose stops carry the accent; solid
    // accent without it.
    expect(band).toMatch(/fill:\s*var\(--motif-selection-wash-paint, var\(--accent\)\);/);
    expect(ruleBody('.motif-cs-selection-fade [data-role="wash"] stop')).toMatch(/stop-color:\s*var\(--accent\);/);
    const opacity = Number(/fill-opacity:\s*([\d.]+);/.exec(band)?.[1]);
    expect(opacity).toBeGreaterThanOrEqual(0.05);
    expect(opacity).toBeLessThanOrEqual(0.06);
    expect(artifactCss).not.toMatch(/\]\s+\.motif-cs-map-frame \.motif-pm-selection-layer \.motif-pm-selection\s*\{[^}]*fill-opacity/);
    expect(ruleBody('.motif-cs-seq-hl')).toMatch(/background:\s*var\(--selection-bg\);/);
  });
});

describe('one radius pair, one floating shadow, one hairline', () => {
  const root = (() => { const at = artifactCss.indexOf('\n:root {'); return artifactCss.slice(at, artifactCss.indexOf('\n}', at)); })();

  it('sets the radius pair to 6 and 10, once, for every theme', () => {
    expect(root).toMatch(/--radius-sm:\s*6px;/);
    expect(root).toMatch(/--radius-md:\s*10px;/);
    // Each radius token is defined once, so a dark block cannot keep different corners.
    expect(artifactCss.match(/--radius-(sm|md):/g)).toHaveLength(2);
  });

  it('casts one shadow, the floating token, and nothing else draws a blurred shadow', () => {
    expect(root).toMatch(/--elevation-popover:\s*0 8px 24px color-mix\(in srgb, var\(--shadow-ink\) 12%, transparent\), 0 1px 3px color-mix\(in srgb, var\(--shadow-ink\) 8%, transparent\), 0 0 0 1px var\(--elevation-edge\);/);
    for (const name of sheets) {
      const css = read(name).replace(/\/\*[\s\S]*?\*\//g, '');
      const blurred = (css.match(/box-shadow:[^;]*;/g) ?? []).filter((d) => /(^|[\s,:])-?\d+px -?\d+px [1-9]\d*px/.test(d));
      expect(blurred, name).toEqual([]);
    }
  });

  it('gives the shadow a 1px edge only where a shadow alone does not show', () => {
    expect(root).toMatch(/--elevation-edge:\s*transparent;/);
    expect(themeHex('dark', '--elevation-edge')).toEqual([0x4a, 0x4a, 0x4a]);
  });

  it('draws every hairline in the one hairline colour, not a faded copy of it', () => {
    for (const name of sheets) expect(read(name), name).not.toMatch(/border(-[a-z]+)?: 1px solid color-mix\(in srgb, var\(--border-subtle\) \d+%, transparent\)/);
    expect(artifactCss).not.toMatch(/1px solid var\(--border\);/);
  });
});

describe('monospace is for sequence data, not interface copy', () => {
  // Status lines, counts and measured values ("1 selected", "Reaction: BsaI", "59.7 °C",
  // "Point at or focus a band") are not set in the monospace family beside sans copy.
  it.each([
    ['claude-science-agent-results.css', '.motif-cs-agent-results-toolbar > span'],
    ['claude-science-agent-results.css', '.motif-cs-agent-result-pager,\n.motif-cs-agent-results-pagination'],
    ['claude-science-cloning-design-workspace.css', '.motif-cs-cloning-design-reaction'],
    ['claude-science-cloning-design-workspace.css', '.motif-cs-cloning-design-check > span'],
    ['claude-science-cloning-design-workspace.css', '.motif-cs-cloning-design-review-head > small'],
    ['claude-science-primer-workspace.css', '.motif-cs-primer-metric strong'],
    ['claude-science-primer-workspace.css', '.motif-cs-primer-cross-check strong'],
    ['claude-science-msa.css', '.motif-cs-msa-workspace .motif-cs-msa-row-stats-summary-meta'],
    ['claude-science-construct-verification.css', '.motif-cs-construct-verification-read > span'],
    ['motif-artifact.css', '.motif-cs-msa-selection-actions > span'],
    ['motif-artifact.css', '.motif-cs-sanger-call-status'],
    ['motif-artifact.css', '.motif-cs-sanger-legend'],
    ['motif-artifact.css', '.motif-cs-gel-readout'],
  ])('%s %s uses the interface family', (name, selector) => {
    const css = read(name);
    // The last rule with exactly this selector list: an earlier one may only lay it out.
    const at = css.lastIndexOf(`\n${selector} {`);
    expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    expect(body).toContain('var(--font-ui)');
    expect(body).not.toContain('var(--font-mono)');
  });
});
