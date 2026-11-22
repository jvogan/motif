import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

const THEMES = ['light', 'dark'] as const;

// The value of a custom property inside one theme block (6-digit hex only).
function themeColour(theme: string, name: string): [number, number, number] {
  const open = artifactCss.search(new RegExp(`(^|\\n)html\\[data-theme="${theme}"\\] \\{`));
  expect(open, `no theme block for ${theme}`).toBeGreaterThanOrEqual(0);
  const block = artifactCss.slice(open, artifactCss.indexOf('\n}', open));
  const hit = new RegExp(`${name}:\\s*#([0-9a-f]{6});`).exec(block);
  expect(hit, `${name} in ${theme}`).not.toBeNull();
  const hex = hit![1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

const mix = (a: number[], b: number[], share: number) => a.map((v, i) => Math.round(v * share + b[i] * (1 - share)));
const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function rootBody(): string {
  const open = artifactCss.indexOf('\n:root {');
  expect(open).toBeGreaterThanOrEqual(0);
  return artifactCss.slice(open, artifactCss.indexOf('\n}', open));
}

describe('control hover and pressed fills', () => {
  // A hover mix 1 of 255 from the resting fill would change no pixel on a hovered Tools,
  // Translation or Find button. Buttons rest transparent and hover takes --bg-hover, the
  // one hover fill.
  it('takes its hover fill from --bg-hover and its pressed fill one step past it', () => {
    const root = rootBody();
    expect(root).toMatch(/--control-hover:\s*var\(--bg-hover\);/);
    expect(root).toMatch(/--control-active:\s*color-mix\(in srgb, var\(--text-primary\) \d+%, var\(--bg-hover\)\);/);
  });

  it.each(THEMES)('%s: hover is at least 8 of 255 from the resting fill and keeps text readable', (theme) => {
    const hover = themeColour(theme, '--bg-hover');
    // A button rests transparent, so its resting colour is whatever surface it sits on:
    // the canvas (windows and popovers paint it too), the secondary surface, the panel
    // and the top bar. Hover must step at least 8 of 255 off each one.
    for (const surface of ['--bg-primary', '--bg-secondary', '--panel-bg', '--topbar-bg']) {
      const resting = themeColour(theme, surface);
      const step = Math.max(...hover.map((v, i) => Math.abs(v - resting[i])));
      expect(step, `${theme} hover on ${surface}`).toBeGreaterThanOrEqual(8);
    }
    // Secondary text, and the muted text a few controls use, stay at 4.5:1 or better on the hover fill.
    expect(contrast(themeColour(theme, '--text-secondary'), hover)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(themeColour(theme, '--text-muted'), hover)).toBeGreaterThanOrEqual(4.5);
    // Pressed (7% of the primary text colour over the hover fill) is a further step and keeps primary text at 7:1.
    const pressed = mix(themeColour(theme, '--text-primary'), hover, 0.07);
    expect(Math.max(...pressed.map((v, i) => Math.abs(v - hover[i])))).toBeGreaterThanOrEqual(4);
    expect(contrast(themeColour(theme, '--text-primary'), pressed)).toBeGreaterThanOrEqual(7);
  });

  it('paints the pressed fill on every outlined control family, and on the selection actions', () => {
    for (const family of [
      '.motif-cs-pane-toggle',
      '.motif-cs-mini-button',
      '.motif-cs-icon-button',
      '.motif-cs-rail-popover-close',
      '.motif-cs-find-done',
      '.motif-cs-segmented button',
    ]) {
      expect(artifactCss, family).toMatch(new RegExp(`${family.replace(/[\\.[\]]/g, '\\$&')}[,\\s\\S]{0,400}\\):active:not\\(`));
    }
    expect(artifactCss).toMatch(/\.motif-cs-selection-actions \.motif-cs-mini-button:active:not\([^)]*\) \{\s*background: var\(--control-active\);/);
    // The selection actions rest on the soft fill with a higher-specificity rule, so they need
    // their own hover fill: the soft button's darker step.
    expect(artifactCss).toMatch(/\.motif-cs-selection-actions \.motif-cs-mini-button:where\(:hover, :focus-visible\):not\(:disabled\)[\s\S]{0,200}background: var\(--control-soft-hover\);/);
  });

  it('no pressed rule resizes or moves a control', () => {
    const at = artifactCss.indexOf('/* Pressed: while the button is down');
    expect(at).toBeGreaterThan(0);
    const block = artifactCss.slice(at, artifactCss.indexOf('/* An inline link-button', at));
    expect(block).not.toMatch(/\b(width|height|padding|margin|transform|font-weight|border-width|top|left)\s*:/);
  });
});
