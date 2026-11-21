import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const tsx = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');

function ruleBody(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at + selector.length);
  return css.slice(open + 1, css.indexOf('}', open));
}

function themeHex(theme: string, name: string): number[] {
  const open = css.search(new RegExp(`(^|\\n)html\\[data-theme="${theme}"\\] \\{`));
  const block = css.slice(open, css.indexOf('\n}', open));
  const hit = new RegExp(`${name}:\\s*#([0-9a-f]{6});`).exec(block);
  expect(hit, `${name} in ${theme}`).not.toBeNull();
  return [0, 2, 4].map((i) => parseInt(hit![1].slice(i, i + 2), 16));
}
const channel = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const over = (fg: number[], bg: number[], alpha: number) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

describe('three button ranks: ghost, soft and primary', () => {
  it('a text command rests on the soft fill with primary text and no edge', () => {
    const base = ruleBody('.motif-cs-mini-button');
    expect(base).toMatch(/background:\s*var\(--control-soft\);/);
    expect(base).toMatch(/color:\s*var\(--text-primary\);/);
    expect(base).toMatch(/border:\s*1px solid transparent;/);
    expect(css).toMatch(/--control-soft:\s*color-mix\(in srgb, var\(--text-primary\) 6%, transparent\);/);
    expect(css).toMatch(/--control-soft-hover:\s*color-mix\(in srgb, var\(--text-primary\) 11%, transparent\);/);
  });

  it('the soft fill is a visible step on the pane and the raised surface in every theme', () => {
    for (const theme of ['light', 'dark']) {
      const text = themeHex(theme, '--text-primary');
      for (const surface of ['--bg-primary', '--bg-secondary']) {
        const bg = themeHex(theme, surface);
        const step = contrast(over(text, bg, 0.06), bg);
        expect(step, `${theme} ${surface}`).toBeGreaterThanOrEqual(1.08);
        expect(step, `${theme} ${surface}`).toBeLessThanOrEqual(1.22);
      }
    }
  });

  it('icon buttons, toggles and the sequence toolbar stay ghost', () => {
    const ghost = ruleBody('.motif-cs-mini-button:is(.motif-cs-icon-mini, [aria-pressed]),\n.motif-cs-edit-toolbar .motif-cs-mini-button');
    expect(ghost).toMatch(/background:\s*transparent;/);
  });

  it('the status line commands are soft too', () => {
    expect(ruleBody('.motif-cs-sequence-panel .motif-cs-selection-actions .motif-cs-mini-button')).toMatch(/background:\s*var\(--control-soft\);/);
    // Disabled, they drop the fill so the muted ink keeps 3:1.
    expect(ruleBody('.motif-cs-sequence-panel .motif-cs-selection-actions .motif-cs-mini-button:disabled')).toMatch(/background:\s*transparent;/);
  });

  it('Create protein in the Translation window is the one solid primary', () => {
    expect(tsx).toContain('className="motif-cs-mini-button motif-cs-mini-button-accent motif-cs-cloning-design-primary-button" type="button" disabled={!protein} onClick={onAddRecord}>Create protein</button>');
    const primary = ruleBody('.motif-cs-mini-button.motif-cs-cloning-design-primary-button');
    expect(primary).toMatch(/background:\s*var\(--accent-base\);/);
    expect(primary).toMatch(/color:\s*#ffffff;/);
  });

  it('white text on Create protein keeps 4.5:1 at rest, on hover or focus, and pressed, in every theme', () => {
    const white = [255, 255, 255];
    const ink = [0, 0, 0];
    expect(css).toMatch(/--shadow-ink:\s*#000000;/);
    const states: Array<[string, string]> = [
      ['hover', '.motif-cs-mini-button.motif-cs-cloning-design-primary-button:not(:disabled):is(:hover, :focus-visible)'],
      ['press', '.motif-cs-mini-button.motif-cs-cloning-design-primary-button:not(:disabled):active'],
    ];
    const mixes = states.map(([name, selector]) => {
      const body = ruleBody(selector);
      expect(body).toMatch(/color:\s*#ffffff;/);
      const hit = /background:\s*color-mix\(in srgb, var\(--accent-base\) (\d+)%, var\(--shadow-ink\)\);/.exec(body);
      expect(hit, `${name} darkens toward ink`).not.toBeNull();
      return [name, Number(hit![1]) / 100] as const;
    });
    // Press is a step past hover, so the two states read apart.
    expect(mixes[1][1]).toBeLessThan(mixes[0][1]);
    for (const theme of ['light', 'dark']) {
      const base = themeHex(theme, '--accent-base');
      expect(contrast(white, base), `${theme} rest`).toBeGreaterThanOrEqual(4.5);
      for (const [name, share] of mixes) {
        const fill = base.map((v, i) => Math.round(v * share + ink[i] * (1 - share)));
        expect(contrast(white, fill), `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('an on toggle carries a primary-text icon on a neutral fill a step past the soft fill', () => {
    // On toggles do not carry blue (an accent icon and a tinted fill would compete with the
    // data). They stay apart from a soft button by the fill: at least 1.1:1 off the soft wash.
    expect(ruleBody('.motif-cs-mini-button[data-active="true"] svg,\n.motif-cs-segmented button[data-active] svg')).toMatch(/color:\s*var\(--text-primary\);/);
    for (const theme of ['light', 'dark']) {
      const on = themeHex(theme, '--bg-active');
      const ink = themeHex(theme, '--text-primary');
      const soft = themeHex(theme, '--bg-primary').map((v, i) => Math.round(ink[i] * 0.06 + v * 0.94));
      expect(contrast(on, soft), theme).toBeGreaterThanOrEqual(1.1);
      expect(on[2] - on[0], `${theme} not blue`).toBeLessThanOrEqual(0);
    }
  });
});

describe('the find bar arrows and Done are soft buttons', () => {
  const find = readFileSync(resolve(here, '..', 'claude-science-find.css'), 'utf8');
  const body = (selector: string) => { const at = find.lastIndexOf(`\n${selector} {`); expect(at, selector).toBeGreaterThanOrEqual(0); const open = find.indexOf('{', at + selector.length); return find.slice(open + 1, find.indexOf('}', open)); };
  it('rest on the soft fill and darken on hover', () => {
    expect(body('.motif-cs-find-step')).toMatch(/background:\s*var\(--control-soft\);/);
    expect(body('.motif-cs-find-done')).toMatch(/background:\s*var\(--control-soft\);/);
    expect(body('.motif-cs-find-step:hover:not(:disabled),\n.motif-cs-find-done:hover')).toMatch(/background:\s*var\(--control-soft-hover\);/);
  });
});
