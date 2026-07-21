import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Colour guards for the MSA viewer's accent-derived marks.
 *
 * Two failure modes live here, and both are silent — they change a number
 * nobody is looking at and leave the pixels looking roughly the same:
 *
 *  1. The selection band gets re-mixed toward `--text-primary`. That reads like
 *     free contrast (ink is by definition the highest-contrast colour against
 *     the background) but the band's real neighbour is the roving CURSOR, which
 *     IS ink — a drag-select parks the cursor on the band's own corner. Mixing
 *     toward ink spends surplus (band vs backdrop) to buy a shortage (band vs
 *     cursor) backwards.
 *
 *  2. The Template badge drifts below WCAG AA. It clears 4.50 by roughly 0.04 in
 *     claude-dark, so any nudge to `--accent`, to `--bg-primary`, or to the
 *     badge's own mix ratio breaks it with no visible symptom.
 *
 * Everything below is derived from the stylesheets on disk, so a token edit is
 * caught wherever it happens. The FLOORS are absolute constants and must stay
 * that way: a floor expressed in terms of the tokens under test moves with the
 * change and passes it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const overlayCss = readFileSync(resolve(here, '..', 'claude-science-msa.css'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

/** WCAG 2.x AA floor for normal-size text. Absolute. Never derive this. */
const AA_NORMAL_TEXT = 4.5;
/** WCAG 2.x 1.4.11 floor for a non-text UI boundary against its backdrop. */
const NON_TEXT_UI = 3;
/**
 * WCAG "large text" starts at 18.66px when bold (14pt) or 24px otherwise, and
 * only large text may fall back to the 3.00 floor. The Template badge is 8px at
 * weight 760 — nowhere near it — so 4.50 is the floor that applies, and dropping
 * this guard to 3.00 would not be a fix, it would be an exemption the badge does
 * not qualify for. `badgeIsLargeText` below re-checks that premise from the
 * stylesheet rather than trusting this comment.
 */
const LARGE_TEXT_MIN_PX_BOLD = 18.66; // 14pt
const LARGE_TEXT_MIN_PX = 24; // 18pt
const BOLD_THRESHOLD = 700;

type Rgb = readonly [number, number, number];

const THEME_SELECTORS: Record<string, string> = {
  light: 'html\\[data-theme="light"\\]',
  dark: 'html\\[data-theme="dark"\\]',
  'claude-light': 'html\\[data-theme="claude-light"\\]',
  'claude-dark': 'html\\[data-theme="claude-dark"\\]',
};

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface CssRule {
  selectors: string;
  body: string;
  /** True when the rule sits inside `@media`/`@supports`/any other at-rule. */
  conditional: boolean;
}

/**
 * Brace-depth scan of a stylesheet into flat rules. A plain regex cannot do this:
 * `.motif-cs-msa-template-badge` is declared in two adjacent blocks, and a regex
 * that anchors on the preceding `}` consumes that brace on the first match and
 * then cannot find a delimiter for the second — it silently returns one rule
 * where there are two, which is exactly the kind of quiet under-read this file
 * exists to prevent.
 */
function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const stack: { prelude: string; atRule: boolean }[] = [];
  let buffer = '';
  for (const part of stripComments(css).split(/([{}])/)) {
    if (part === '{') {
      const prelude = buffer.trim();
      stack.push({ prelude, atRule: prelude.startsWith('@') });
      buffer = '';
    } else if (part === '}') {
      const frame = stack.pop();
      if (frame && !frame.atRule) {
        rules.push({
          selectors: frame.prelude,
          body: buffer,
          conditional: stack.some((entry) => entry.atRule),
        });
      }
      buffer = '';
    } else {
      buffer += part;
    }
  }
  return rules;
}

const ARTIFACT_RULES = parseRules(artifactCss);
const OVERLAY_RULES = parseRules(overlayCss);

/**
 * Rules whose selector list mentions `selectorPattern`, in source order, split
 * into the unconditional ones and any that sit inside an at-rule. Callers read
 * the unconditional list last-wins — the order the cascade applies — and assert
 * the conditional list is empty, so a `@media` override cannot appear later and
 * change the answer without anyone noticing.
 */
function matchingRules(rules: CssRule[], selectorPattern: string): { plain: CssRule[]; conditional: CssRule[] } {
  // `(?![\w-])` stops `.motif-cs-msa-matrix` from also matching
  // `.motif-cs-msa-matrix-frame`/`-row`/`-scroll`/`-shell`.
  const re = new RegExp(`${selectorPattern}(?![\\w-])`);
  const hit = rules.filter((rule) => re.test(rule.selectors));
  return {
    plain: hit.filter((rule) => !rule.conditional),
    conditional: hit.filter((rule) => rule.conditional),
  };
}

/** Last-wins lookup for a property across every unconditional rule for the selector. */
function declaredValue(rules: CssRule[], selectorPattern: string, property: string): string | null {
  const { plain, conditional } = matchingRules(rules, selectorPattern);
  if (conditional.length > 0) {
    throw new Error(
      `${selectorPattern} is also styled inside an at-rule (${conditional.length} block(s)). ` +
        'This guard only reads the unconditional cascade — extend it before relying on it again.',
    );
  }
  let found: string | null = null;
  for (const rule of plain) {
    const re = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, 'g');
    for (const match of rule.body.matchAll(re)) found = match[1].trim();
  }
  return found;
}

function themeTokens(theme: string): Record<string, string> {
  const { plain, conditional } = matchingRules(ARTIFACT_RULES, THEME_SELECTORS[theme]);
  if (plain.length === 0) throw new Error(`No rule block found for theme "${theme}"`);
  if (conditional.length > 0) {
    // Same contract as declaredValue: a `@media (prefers-contrast: more)` block
    // that re-points --accent would change the answer for a viewer this guard
    // never measured. Refuse rather than read half the cascade.
    throw new Error(`Theme "${theme}" is also redefined inside an at-rule — extend this guard before trusting it.`);
  }
  const tokens: Record<string, string> = {};
  for (const rule of plain) {
    for (const match of rule.body.matchAll(/(--[a-zA-Z0-9_-]+)\s*:([^;]*)/g)) {
      tokens[match[1]] = match[2].trim();
    }
  }
  return tokens;
}

function parseHex(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) throw new Error(`Expected a 6-digit hex colour, got "${value}"`);
  const n = Number.parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Resolve a declaration to an RGB triple. Understands a bare `var(--token)`, a
 * literal hex, and the single `color-mix(in srgb, var(--a) N%, var(--b))` shape
 * the badge uses. Anything else THROWS rather than guessing — an unparsed
 * declaration must fail this suite, not slip through it.
 */
function resolveColour(declaration: string, tokens: Record<string, string>): Rgb {
  const value = declaration.trim();

  const varOnly = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/.exec(value);
  if (varOnly) {
    const token = tokens[varOnly[1]];
    if (!token) throw new Error(`Token ${varOnly[1]} is not defined for this theme`);
    return resolveColour(token, tokens);
  }

  if (value.startsWith('#')) return parseHex(value);

  const mix = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/.exec(value);
  if (mix) {
    const a = resolveColour(mix[1], tokens);
    const b = resolveColour(mix[3], tokens);
    const weight = Number(mix[2]) / 100;
    // Chrome interpolates in gamma-encoded sRGB for `in srgb` and does NOT
    // quantise the result to 8 bits, so this stays in continuous space too.
    // That is also the stricter reading: the 8-bit-rounded claude-dark badge
    // measures 4.553 where the continuous value measures 4.544.
    return [0, 1, 2].map((i) => a[i] * weight + b[i] * (1 - weight)) as unknown as Rgb;
  }

  throw new Error(`Unrecognised colour declaration "${value}" — extend resolveColour rather than skipping it`);
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const THEMES = Object.keys(THEME_SELECTORS);

describe('MSA selection band stays undiluted accent', () => {
  it('declares the selection rule as the theme accent with no mix toward ink', () => {
    const declaration = declaredValue(OVERLAY_RULES, '\\.motif-cs-msa-matrix', '--motif-cs-msa-selection-rule');
    expect(declaration).toBe('var(--accent)');
  });

  it('never re-mixes the selection rule toward the cursor colour', () => {
    // The shape guard, independent of the exact value above: a mix toward
    // `--text-primary` is the specific regression, because `--text-primary` is
    // what `--motif-cs-msa-cursor-rule` resolves to. Re-mixing pulls the band
    // and the cursor back onto one channel.
    const cursorRule = declaredValue(OVERLAY_RULES, '\\.motif-cs-msa-matrix-frame', '--motif-cs-msa-cursor-rule');
    expect(cursorRule).toBe('var(--text-primary)');

    const declaration = declaredValue(OVERLAY_RULES, '\\.motif-cs-msa-matrix', '--motif-cs-msa-selection-rule') ?? '';
    expect(declaration).not.toMatch(/color-mix/);
    expect(declaration).not.toMatch(/--text-primary/);
  });

  it.each(THEMES)('keeps the band readable against its backdrop in %s', (theme) => {
    const tokens = themeTokens(theme);
    const band = resolveColour(
      declaredValue(OVERLAY_RULES, '\\.motif-cs-msa-matrix', '--motif-cs-msa-selection-rule') ?? '',
      tokens,
    );
    const backdrop = resolveColour('var(--bg-primary)', tokens);
    // The band is a region boundary, not text, so 1.4.11's 3.00 is the correct
    // floor here. Measured in Chrome after the de-mix: 5.29-5.76 in the four
    // themes, so this has real headroom and is not a rubber stamp.
    expect(contrastRatio(band, backdrop)).toBeGreaterThanOrEqual(NON_TEXT_UI);
  });
});

describe('Template badge holds WCAG AA', () => {
  const badgeSelector = '\\.motif-cs-msa-template-badge';

  it('is still small text, so the 4.50 floor is the one that applies', () => {
    // If this fails the badge grew into WCAG "large text" territory. That is a
    // real design decision, not licence to drop the floor below — re-derive it
    // deliberately, do not delete this test.
    const font = declaredValue(ARTIFACT_RULES, badgeSelector, 'font') ?? '';
    const weightDecl = declaredValue(ARTIFACT_RULES, badgeSelector, 'font-weight') ?? '';
    const sizePx = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]);
    const weight = Number(/(\d+)/.exec(weightDecl)?.[1]);
    expect(Number.isFinite(sizePx)).toBe(true);
    expect(Number.isFinite(weight)).toBe(true);
    const badgeIsLargeText =
      weight >= BOLD_THRESHOLD ? sizePx >= LARGE_TEXT_MIN_PX_BOLD : sizePx >= LARGE_TEXT_MIN_PX;
    expect(badgeIsLargeText).toBe(false);
  });

  it.each(THEMES)('clears 4.50:1 in %s', (theme) => {
    const tokens = themeTokens(theme);
    const foreground = resolveColour(declaredValue(ARTIFACT_RULES, badgeSelector, 'color') ?? '', tokens);
    const background = resolveColour(declaredValue(ARTIFACT_RULES, badgeSelector, 'background') ?? '', tokens);
    const ratio = contrastRatio(foreground, background);
    // Reported to 3dp so a failure states the margin instead of just "false".
    expect(
      ratio,
      `Template badge in ${theme} measures ${ratio.toFixed(3)}:1 against a ${AA_NORMAL_TEXT} floor. ` +
        'Darken --accent (or deepen the badge background) until it clears; do NOT lower the floor — ' +
        '8px at weight 760 does not qualify for the 3.00 large-text exemption.',
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

});
