import type { FeatureType } from './types';
import { mixOpaqueHex } from './color-mix';

type FeatureColorInput = {
  name?: unknown;
  type?: unknown;
  color?: unknown;
};

// Generated colors are semantic theme references rather than fixed paint.
// Explicit caller colors remain literal because that is a user-authored choice;
// missing colors follow the active Motif appearance without rewriting records.
const ACCENT = 'var(--accent, #7E9BBF)';
const AMBER = 'var(--amber, #C6A86B)';
const RED = 'var(--red, #C28C88)';
const RED_ALT = 'var(--red, #C49374)';
const NEUTRAL = 'var(--feature-neutral, #8B8F99)';
const PURPLE = 'var(--purple, #9E96B4)';
const GREEN = 'var(--green, #7FA98F)';
const GREEN_RNA = 'var(--green, #6FB0A4)';
const GREEN_PEPTIDE = 'var(--green, #9DB585)';
const FEATURE_COLORS: Readonly<Record<FeatureType, string>> = {
  gene: ACCENT,
  cds: ACCENT,
  promoter: AMBER,
  terminator: RED,
  misc_feature: NEUTRAL,
  origin: PURPLE,
  primer_bind: RED_ALT,
  orf: GREEN,
  rbs: AMBER,
  resistance: RED_ALT,
  restriction_site: NEUTRAL,
  mRNA: GREEN_RNA,
  rRNA: GREEN_RNA,
  tRNA: GREEN_RNA,
  ncRNA: PURPLE,
  regulatory: AMBER,
  repeat_region: PURPLE,
  sig_peptide: GREEN_PEPTIDE,
  mat_peptide: GREEN_PEPTIDE,
  transit_peptide: GREEN_PEPTIDE,
  intron: NEUTRAL,
  exon: GREEN_RNA,
  polyA_signal: RED,
  enhancer: AMBER,
  custom: NEUTRAL,
};

const FEATURE_TYPE_BY_LOWER = new Map<Lowercase<FeatureType>, FeatureType>(
  (Object.keys(FEATURE_COLORS) as FeatureType[]).map((type) => [type.toLowerCase() as Lowercase<FeatureType>, type]),
);
const SIMPLE_CSS_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\)|[a-z]+)$/iu;
const THEME_COLOR_TOKEN = /^var\(--(?:accent|green|purple|amber|red|feature-neutral)(?:, #[0-9a-f]{6})?\)$/iu;
const THEME_COLOR_MIX = /^color-mix\(in srgb, var\(--(?:accent|green|purple|amber|red|feature-neutral)(?:, #[0-9a-f]{6})?\) (?:7[2-9]|8\d|9[0-2])%, var\(--bg-primary\)\)$/iu;
const MAX_FEATURE_COLOR_LENGTH = 80;
const UNKNOWN_TYPE_RAMP = [
  ACCENT,
  GREEN,
  PURPLE,
  AMBER,
  RED,
  NEUTRAL,
] as const;

const THEME_COLOR_FALLBACKS = {
  accent: '#7E9BBF',
  green: '#7FA98F',
  purple: '#9E96B4',
  amber: '#C6A86B',
  red: '#C28C88',
  'feature-neutral': '#8B8F99',
} as const;

const THEME_COLOR_REFERENCE = /var\(--(accent|green|purple|amber|red|feature-neutral)(?:,\s*(#[0-9a-f]{6}))?\)/iu;
const THEME_COLOR_PICKER_TOKEN = /^var\(--(accent|green|purple|amber|red|feature-neutral)(?:,\s*(#[0-9a-f]{6}))?\)$/iu;
const THEME_COLOR_PICKER_MIX = /^color-mix\(in srgb,\s*var\(--(accent|green|purple|amber|red|feature-neutral)(?:,\s*(#[0-9a-f]{6}))?\)\s+((?:7[2-9]|8\d|9[0-2]))%,\s*var\(--bg-primary\)\)$/iu;

function opaqueHex(value: string | undefined): string | null {
  if (!value) return null;
  const hex = /^#([0-9a-f]{3}(?:[0-9a-f]{3})?)$/iu.exec(value.trim())?.[1];
  if (!hex) return null;
  return `#${(hex.length === 3 ? hex.replace(/./gu, '$&$&') : hex).toLowerCase()}`;
}

function translucentHex(value: string): { foreground: string; alpha: number } | null {
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/iu.exec(value.trim())?.[1];
  if (!hex) return null;
  const short = hex.length === 4;
  const alpha = short ? hex[3] + hex[3] : hex.slice(6);
  const foreground = short ? hex.slice(0, 3).replace(/./gu, '$&$&') : hex.slice(0, 6);
  return {
    foreground: `#${foreground.toLowerCase()}`,
    alpha: Number.parseInt(alpha, 16) / 255,
  };
}

function computedRgbToOpaqueHex(value: string, background: string): string | null {
  // CSSOM serializes a computed color as rgb()/rgba(), using either comma or
  // space/slash syntax. This extracts that already-validated browser output;
  // it is not used to accept arbitrary author CSS.
  const components = /^rgba?\((.*)\)$/iu.exec(value.trim())?.[1].match(/[\d.]+%?/gu);
  if (!components || components.length < 3) return null;
  const foreground = `#${components.slice(0, 3)
    .map((component) => Math.round(Math.max(0, Math.min(255,
      Number.parseFloat(component) * (component.endsWith('%') ? 2.55 : 1),
    ))).toString(16).padStart(2, '0')).join('')}`;
  const alpha = components[3];
  return alpha
    ? mixOpaqueHex(foreground, Number.parseFloat(alpha) / (alpha.endsWith('%') ? 100 : 1), background)
    : foreground;
}

function resolveBrowserCssLiteral(value: string, background: string): string | null {
  type CssLiteralProbe = {
    style: {
      color: string;
    };
    remove(): void;
  };
  type CssLiteralDocument = {
    documentElement: { append(node: CssLiteralProbe): void };
    defaultView: { getComputedStyle(node: CssLiteralProbe): { color: string } } | null;
    createElement(name: string): CssLiteralProbe;
  };
  const browserDocument = (globalThis as unknown as { document?: CssLiteralDocument }).document;
  if (!browserDocument?.documentElement) return null;
  const view = browserDocument.defaultView;
  if (!view) return null;

  const probe = browserDocument.createElement('span');
  // The probe has no content, so assigning its color cannot paint or alter
  // layout; its computed color is all that is observed.
  probe.style.color = value;
  if (!probe.style.color) return null;

  browserDocument.documentElement.append(probe);
  try {
    return computedRgbToOpaqueHex(view.getComputedStyle(probe).color, background);
  } finally {
    probe.remove();
  }
}

function stableHash(value: string): number {
  // FNV-1a over UTF-16 code units. Math.imul keeps the result identical in
  // browsers, Node, reloads, and serialized workspace round-trips.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function validExplicitColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  if (!color || color.length > MAX_FEATURE_COLOR_LENGTH) return null;
  return SIMPLE_CSS_COLOR.test(color) || THEME_COLOR_TOKEN.test(color) || THEME_COLOR_MIX.test(color)
    ? color
    : null;
}

function typeToken(type: unknown, name: string): string {
  const normalizedType = typeof type === 'string'
    ? FEATURE_TYPE_BY_LOWER.get(type.trim().toLowerCase() as Lowercase<FeatureType>)
    : undefined;
  if (normalizedType && normalizedType !== 'custom') return FEATURE_COLORS[normalizedType];
  // Every unrecognized label crosses the artifact boundary as `custom`.
  // Hash the canonical type key so MCP, file, and page API routes agree even
  // when one route sees the raw unknown label before type normalization.
  return UNKNOWN_TYPE_RAMP[stableHash(`custom:${name}`) % UNKNOWN_TYPE_RAMP.length];
}

/**
 * Resolve a feature color at every ingestion boundary.
 *
 * Safe explicit caller colors are returned byte-for-byte after trimming.
 * Missing or unsafe colors receive a deterministic semantic theme token with a
 * literal fallback. Known feature types follow the active appearance; custom
 * and unknown types hash into a curated token ramp. The fallback keeps the
 * value usable in exported SVG and other consumers that do not define Motif's
 * CSS variables.
 */
export function resolveFeatureColor(feature: FeatureColorInput): string {
  const explicit = validExplicitColor(feature.color);
  if (explicit) return explicit;

  const name = typeof feature.name === 'string' && feature.name.trim()
    ? feature.name.trim().toLowerCase()
    : 'unnamed feature';
  return typeToken(feature.type, name);
}

/**
 * Materialize a semantic feature color for exports that cannot rely on Motif's
 * CSS variables. Literal caller colors pass through unchanged; exact theme
 * tokens use their portable palette fallback, while approved color mixes are
 * resolved against the export background as one deterministic opaque sRGB
 * color.
 */
export function materializeFeatureColor(featureColor: string, backgroundColor = '#ffffff'): string {
  const trimmed = featureColor.trim();
  if (!THEME_COLOR_TOKEN.test(trimmed) && !THEME_COLOR_MIX.test(trimmed)) return trimmed;
  const reference = THEME_COLOR_REFERENCE.exec(trimmed);
  if (!reference) return THEME_COLOR_FALLBACKS['feature-neutral'];
  const token = reference[1] as keyof typeof THEME_COLOR_FALLBACKS;
  const foreground = reference[2] ?? THEME_COLOR_FALLBACKS[token];
  const mix = THEME_COLOR_PICKER_MIX.exec(trimmed);
  if (!mix) return foreground;

  return mixOpaqueHex(
    opaqueHex(foreground) ?? THEME_COLOR_FALLBACKS[token].toLowerCase(),
    Number(mix[3]) / 100,
    opaqueHex(backgroundColor) ?? '#ffffff',
  );
}

/**
 * Present a stored feature color in a native color input without rewriting it.
 *
 * Native `input[type=color]` controls accept opaque sRGB values, not the
 * broader CSS colors used by Motif records. The optional resolver reads the
 * active theme's inherited custom properties in a browser. Semantic colors
 * use their portable fallback when a theme value is missing; safe named,
 * rgb(), and hsl() literals use the browser's CSS parser, with translucency
 * composited over the active workspace background. Non-browser consumers use
 * the same deterministic hex and semantic fallbacks as before.
 * Callers should keep the original feature color as their source of truth and
 * replace it only after the user chooses a new picker color.
 */
export function resolveFeatureColorPickerValue(
  featureColor: string,
  resolveThemeVariable: (name: `--${string}`) => string | undefined = () => undefined,
): string {
  const trimmed = featureColor.trim();
  const literal = opaqueHex(trimmed);
  if (literal) return literal;
  const translucentLiteral = translucentHex(trimmed);
  if (translucentLiteral) {
    return mixOpaqueHex(
      translucentLiteral.foreground,
      translucentLiteral.alpha,
      opaqueHex(resolveThemeVariable('--bg-primary')) ?? '#ffffff',
    );
  }

  const semanticMatch = THEME_COLOR_PICKER_MIX.exec(trimmed)
    ?? THEME_COLOR_PICKER_TOKEN.exec(trimmed);
  if (semanticMatch) {
    const token = semanticMatch[1] as keyof typeof THEME_COLOR_FALLBACKS;
    const foreground = opaqueHex(resolveThemeVariable(`--${token}`))
      ?? opaqueHex(semanticMatch[2])
      ?? THEME_COLOR_FALLBACKS[token].toLowerCase();
    const percentage = semanticMatch[3];
    if (!percentage) return foreground;
    const background = opaqueHex(resolveThemeVariable('--bg-primary'));
    return background
      ? mixOpaqueHex(foreground, Number(percentage) / 100, background)
      : foreground;
  }

  if (SIMPLE_CSS_COLOR.test(trimmed)) {
    const background = opaqueHex(resolveThemeVariable('--bg-primary')) ?? '#ffffff';
    const resolvedLiteral = resolveBrowserCssLiteral(trimmed, background);
    if (resolvedLiteral) return resolvedLiteral;
  }

  // Non-browser consumers and invalid CSS values cannot resolve a literal to
  // the picker's required opaque sRGB form. Use the neutral swatch there until
  // a user intentionally replaces the stored value through the picker.
  return THEME_COLOR_FALLBACKS['feature-neutral'].toLowerCase();
}
