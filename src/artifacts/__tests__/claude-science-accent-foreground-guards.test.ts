import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactDir = resolve(here, '..');
const stylesheets = readdirSync(artifactDir)
  .filter((name) => name.endsWith('.css'))
  .map((name) => ({ name, text: readFileSync(resolve(artifactDir, name), 'utf8') }));
const artifactCss = stylesheets.find((sheet) => sheet.name === 'motif-artifact.css')!.text;

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

type Rgb = [number, number, number];

const THEMES = {
  light: 'html[data-theme="light"]',
  dark: 'html[data-theme="dark"]',
  'claude-light': 'html[data-theme="claude-light"]',
  'claude-dark': 'html[data-theme="claude-dark"]',
} as const;
type ThemeName = keyof typeof THEMES;
const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

/** The palette block for one theme. Theme blocks declare no nested rules. */
function themeBlock(theme: ThemeName): string {
  const selector = THEMES[theme];
  const at = artifactCss.indexOf(`${selector} {`);
  expect(at, `missing theme block: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = artifactCss.indexOf('{', at);
  const close = artifactCss.indexOf('}', open);
  expect(close).toBeGreaterThan(open);
  return artifactCss.slice(open + 1, close);
}

/**
 * A token's value in one theme, following a single `var(--other)` indirection.
 * `--accent-fill-contrast` is declared as `var(--bg-primary)` so that a theme
 * cannot drift its accent foreground away from the surface it is punched out
 * of; resolving one hop is what makes that declaration readable here.
 */
function token(theme: ThemeName, name: string): string {
  const block = themeBlock(theme);
  const raw = new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  expect(raw, `missing ${name} in ${theme}`).toBeTruthy();
  const indirect = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw!);
  if (!indirect) return raw!;
  const target = new RegExp(`${indirect[1]}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  expect(target, `${name} in ${theme} points at ${indirect[1]}, which the block does not define`).toBeTruthy();
  return target!;
}

function rgb(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  expect(hex, `not a six-digit hex colour: ${value}`).toBeTruthy();
  const digits = hex![1];
  return [0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16)) as Rgb;
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

/** `color-mix(in srgb, ...)` interpolates the gamma-encoded sRGB coordinates. */
function mixSrgb(a: Rgb, b: Rgb, weightOfA: number): Rgb {
  return a.map((channel, index) => channel * weightOfA + b[index] * (1 - weightOfA)) as Rgb;
}

/** The declaration block enclosing `at`, found by balancing braces outwards. */
function enclosingBlock(text: string, at: number): string {
  let depth = 0;
  let open = -1;
  for (let index = at; index >= 0; index -= 1) {
    if (text[index] === '}') depth += 1;
    else if (text[index] === '{') {
      if (depth === 0) { open = index; break; }
      depth -= 1;
    }
  }
  expect(open, 'declaration is not inside a block').toBeGreaterThanOrEqual(0);
  depth = 0;
  for (let index = open + 1; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      if (depth === 0) return text.slice(open + 1, index);
      depth -= 1;
    }
  }
  throw new Error('unterminated block');
}

const AA_TEXT = 4.5;

describe('accent foreground tokens', () => {
  // --accent-contrast is the foreground for an --accent-base fill, which is the
  // fill every "on" state in this artifact uses. --accent-base carries the same
  // value in a theme and its dark twin, so the light and dark numbers match.
  it.each(THEME_NAMES)('%s reads --accent-contrast on an --accent-base fill above AA', (theme) => {
    const ratio = contrast(rgb(token(theme, '--accent-contrast')), rgb(token(theme, '--accent-base')));
    expect(ratio, `${theme} --accent-contrast on --accent-base is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // --accent-fill-contrast is the foreground for an --accent fill. The dark
  // themes lighten --accent so that accent TEXT clears AA on a dark surface,
  // which is exactly why the near-white --accent-contrast cannot go on it: it
  // read 2.86 in dark and 2.33 in claude-dark on the two primary buttons that
  // did, before this token existed.
  it.each(THEME_NAMES)('%s reads --accent-fill-contrast on an --accent fill above AA', (theme) => {
    const ratio = contrast(rgb(token(theme, '--accent-fill-contrast')), rgb(token(theme, '--accent')));
    expect(ratio, `${theme} --accent-fill-contrast on --accent is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // Every hover fill an --accent-filled button declares, read out of the
  // stylesheet rather than restated here, so that changing the mix moves this
  // number. These mix --accent toward --text-primary, which moves away from the
  // label in every theme because --text-primary is dark where the label is
  // light and light where it is dark.
  const hoverFills = stylesheets.flatMap((sheet) => {
    const text = stripComments(sheet.text);
    const rule = /:hover:not\(:disabled\)\s*\{[^}]*?background:\s*color-mix\(in srgb,\s*var\(--accent\)\s*(\d+)%,\s*var\((--[a-z-]+)\)\s*\)/g;
    return [...text.matchAll(rule)].map((match) => ({
      sheet: sheet.name,
      weight: Number(match[1]) / 100,
      towards: match[2],
    }));
  });

  it('finds a declared hover fill for the accent-filled buttons', () => {
    expect(hoverFills.length).toBeGreaterThanOrEqual(2);
  });

  it.each(THEME_NAMES)('%s keeps the primary-button label above AA on every hover fill', (theme) => {
    for (const fill of hoverFills) {
      const hover = mixSrgb(rgb(token(theme, '--accent')), rgb(token(theme, fill.towards)), fill.weight);
      const ratio = contrast(rgb(token(theme, '--accent-fill-contrast')), hover);
      expect(ratio, `${theme} label on ${fill.sheet} hover fill is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  // A fill of --accent must never take --accent-contrast. This is the pairing
  // that produced the failure, and a value guard alone cannot catch it coming
  // back on a fourth button.
  it('pairs every --accent fill with --accent-fill-contrast', () => {
    const pairs: string[] = [];
    for (const sheet of stylesheets) {
      const text = stripComments(sheet.text);
      const needle = /background:\s*var\(--accent\)\s*;/g;
      for (let match = needle.exec(text); match; match = needle.exec(text)) {
        const block = enclosingBlock(text, match.index);
        const color = /(?:^|[;{])\s*color:\s*([^;]+);/.exec(block)?.[1]?.trim();
        if (!color) continue;
        pairs.push(`${sheet.name}: ${color}`);
      }
    }
    expect(pairs.length, 'no rule fills with var(--accent) and declares a colour').toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair, 'an --accent fill took a foreground other than --accent-fill-contrast').toContain('var(--accent-fill-contrast)');
    }
  });

  // --accent-hover was referenced once here and defined nowhere, so the hover
  // declaration was invalid at computed-value time and the button lost its fill.
  // The whole accent family is a static palette with no runtime writer, so every
  // reference to one must resolve inside these stylesheets.
  it('defines every accent token the artifact stylesheets reference', () => {
    const defined = new Set<string>();
    const referenced = new Map<string, string[]>();
    for (const sheet of stylesheets) {
      const text = stripComments(sheet.text);
      for (const match of text.matchAll(/(--accent[a-z0-9-]*)\s*:/g)) defined.add(match[1]);
      text.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(/var\(\s*(--accent[a-z0-9-]*)/g)) {
          const hits = referenced.get(match[1]) ?? [];
          hits.push(`${sheet.name}:${index + 1}`);
          referenced.set(match[1], hits);
        }
      });
    }
    expect(referenced.has('--accent-fill-contrast'), 'the sweep found no accent references at all').toBe(true);
    const undefinedRefs = [...referenced].filter(([name]) => !defined.has(name));
    expect(undefinedRefs.map(([name, hits]) => `${name} at ${hits.join(', ')}`)).toEqual([]);
  });
});
