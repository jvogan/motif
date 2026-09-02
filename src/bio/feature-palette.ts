import type { FeatureType } from './types';

type FeatureColorInput = {
  name?: unknown;
  type?: unknown;
  color?: unknown;
};

type FeaturePaletteEntry = {
  /** Theme token with a portable fallback for non-browser consumers. */
  token: string;
};

// Generated colors are semantic theme references rather than fixed paint.
// Explicit caller colors remain literal because that is a user-authored choice;
// missing colors follow the active Motif appearance without rewriting records.
const FEATURE_COLORS: Readonly<Record<FeatureType, FeaturePaletteEntry>> = {
  gene: { token: 'var(--accent, #7E9BBF)' },
  cds: { token: 'var(--accent, #7E9BBF)' },
  promoter: { token: 'var(--amber, #C6A86B)' },
  terminator: { token: 'var(--red, #C28C88)' },
  misc_feature: { token: 'var(--feature-neutral, #8B8F99)' },
  origin: { token: 'var(--purple, #9E96B4)' },
  primer_bind: { token: 'var(--red, #C49374)' },
  orf: { token: 'var(--green, #7FA98F)' },
  rbs: { token: 'var(--amber, #C6A86B)' },
  resistance: { token: 'var(--red, #C49374)' },
  restriction_site: { token: 'var(--feature-neutral, #8B8F99)' },
  mRNA: { token: 'var(--green, #6FB0A4)' },
  rRNA: { token: 'var(--green, #6FB0A4)' },
  tRNA: { token: 'var(--green, #6FB0A4)' },
  ncRNA: { token: 'var(--purple, #9E96B4)' },
  regulatory: { token: 'var(--amber, #C6A86B)' },
  repeat_region: { token: 'var(--purple, #9E96B4)' },
  sig_peptide: { token: 'var(--green, #9DB585)' },
  mat_peptide: { token: 'var(--green, #9DB585)' },
  transit_peptide: { token: 'var(--green, #9DB585)' },
  intron: { token: 'var(--feature-neutral, #8B8F99)' },
  exon: { token: 'var(--green, #6FB0A4)' },
  polyA_signal: { token: 'var(--red, #C28C88)' },
  enhancer: { token: 'var(--amber, #C6A86B)' },
  custom: { token: 'var(--feature-neutral, #8B8F99)' },
};

const KNOWN_FEATURE_TYPES = new Set<FeatureType>(Object.keys(FEATURE_COLORS) as FeatureType[]);
const FEATURE_TYPE_BY_LOWER = new Map<Lowercase<FeatureType>, FeatureType>(
  (Object.keys(FEATURE_COLORS) as FeatureType[]).map((type) => [type.toLowerCase() as Lowercase<FeatureType>, type]),
);
const SIMPLE_CSS_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\)|[a-z]+)$/iu;
const THEME_COLOR_TOKEN = /^var\(--(?:accent|green|purple|amber|red|feature-neutral)(?:, #[0-9a-f]{6})?\)$/iu;
const THEME_COLOR_MIX = /^color-mix\(in srgb, var\(--(?:accent|green|purple|amber|red|feature-neutral)(?:, #[0-9a-f]{6})?\) (?:7[2-9]|8\d|9[0-2])%, var\(--bg-primary\)\)$/iu;
const MAX_FEATURE_COLOR_LENGTH = 80;
const UNKNOWN_TYPE_RAMP = [
  'var(--accent, #7E9BBF)',
  'var(--green, #7FA98F)',
  'var(--purple, #9E96B4)',
  'var(--amber, #C6A86B)',
  'var(--red, #C28C88)',
  'var(--feature-neutral, #8B8F99)',
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
  const trimmed = value.trim();
  const long = /^#([0-9a-f]{6})$/iu.exec(trimmed);
  if (long) return `#${long[1].toLowerCase()}`;
  const short = /^#([0-9a-f]{3})$/iu.exec(trimmed);
  if (!short) return null;
  return `#${[...short[1]].map((digit) => `${digit}${digit}`).join('').toLowerCase()}`;
}

function translucentHex(value: string): { foreground: string; alpha: number } | null {
  const trimmed = value.trim();
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})$/iu.exec(trimmed);
  if (long) {
    return {
      foreground: `#${long[1].toLowerCase()}`,
      alpha: Number.parseInt(long[2], 16) / 255,
    };
  }
  const short = /^#([0-9a-f]{3})([0-9a-f])$/iu.exec(trimmed);
  if (!short) return null;
  return {
    foreground: `#${[...short[1]].map((digit) => `${digit}${digit}`).join('').toLowerCase()}`,
    alpha: Number.parseInt(short[2], 16) / 15,
  };
}

function mixOpaqueHex(foreground: string, foregroundWeight: number, background: string): string {
  const weight = Math.max(0, Math.min(1, foregroundWeight));
  const channels = [1, 3, 5].map((offset) => {
    const foregroundChannel = Number.parseInt(foreground.slice(offset, offset + 2), 16);
    const backgroundChannel = Number.parseInt(background.slice(offset, offset + 2), 16);
    return Math.round(foregroundChannel * weight + backgroundChannel * (1 - weight))
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

function computedRgbToOpaqueHex(value: string, background: string): string | null {
  const match = /^rgba?\((.*)\)$/iu.exec(value.trim());
  if (!match) return null;

  // Browsers normally serialize computed colors with commas, while newer
  // engines are also allowed to use the space-and-slash form. Normalize both
  // without accepting any additional author-controlled CSS syntax here.
  const components = match[1].replaceAll(',', ' ').replace('/', ' / ').trim().split(/\s+/u);
  const slashIndex = components.indexOf('/');
  const channels = components.slice(0, slashIndex >= 0 ? slashIndex : 3);
  const alphaText = slashIndex >= 0 ? components[slashIndex + 1] : components[3];
  if (channels.length !== 3) return null;

  const channelHex = channels.map((component) => {
    const percentage = component.endsWith('%');
    const numeric = Number.parseFloat(component);
    if (!Number.isFinite(numeric)) return null;
    const channel = percentage ? numeric * 2.55 : numeric;
    return Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0');
  });
  if (channelHex.some((channel) => channel === null)) return null;

  const foreground = `#${channelHex.join('')}`;
  if (!alphaText) return foreground;
  const alphaNumeric = Number.parseFloat(alphaText);
  if (!Number.isFinite(alphaNumeric)) return null;
  const alpha = alphaText.endsWith('%') ? alphaNumeric / 100 : alphaNumeric;
  return mixOpaqueHex(foreground, alpha, background);
}

function resolveBrowserCssLiteral(value: string, background: string): string | null {
  type CssLiteralProbe = {
    setAttribute(name: string, value: string): void;
    style: {
      position: string;
      visibility: string;
      pointerEvents: string;
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
  probe.setAttribute('aria-hidden', 'true');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
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

function typeAndToken(type: unknown, name: string): { typeKey: string; token: string } {
  const normalizedType = typeof type === 'string'
    ? FEATURE_TYPE_BY_LOWER.get(type.trim().toLowerCase() as Lowercase<FeatureType>)
    : undefined;
  if (normalizedType && KNOWN_FEATURE_TYPES.has(normalizedType) && normalizedType !== 'custom') {
    const featureType = normalizedType;
    const entry = FEATURE_COLORS[featureType];
    return {
      typeKey: featureType,
      token: entry.token,
    };
  }
  // Every unrecognized label crosses the artifact boundary as `custom`.
  // Hash the canonical type key so MCP, file, and page API routes agree even
  // when one route sees the raw unknown label before type normalization.
  const typeKey = 'custom';
  const rampIndex = stableHash(`${typeKey}:${name}`) % UNKNOWN_TYPE_RAMP.length;
  return { typeKey, token: UNKNOWN_TYPE_RAMP[rampIndex] };
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
  return typeAndToken(feature.type, name).token;
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
  const literal = opaqueHex(featureColor);
  if (literal) return literal;
  const translucentLiteral = translucentHex(featureColor);
  if (translucentLiteral) {
    return mixOpaqueHex(
      translucentLiteral.foreground,
      translucentLiteral.alpha,
      opaqueHex(resolveThemeVariable('--bg-primary')) ?? '#ffffff',
    );
  }

  const tokenMatch = THEME_COLOR_PICKER_TOKEN.exec(featureColor.trim());
  if (tokenMatch) {
    const token = tokenMatch[1] as keyof typeof THEME_COLOR_FALLBACKS;
    return opaqueHex(resolveThemeVariable(`--${token}`))
      ?? opaqueHex(tokenMatch[2])
      ?? THEME_COLOR_FALLBACKS[token].toLowerCase();
  }

  const mixMatch = THEME_COLOR_PICKER_MIX.exec(featureColor.trim());
  if (mixMatch) {
    const token = mixMatch[1] as keyof typeof THEME_COLOR_FALLBACKS;
    const foreground = opaqueHex(resolveThemeVariable(`--${token}`))
      ?? opaqueHex(mixMatch[2])
      ?? THEME_COLOR_FALLBACKS[token].toLowerCase();
    const background = opaqueHex(resolveThemeVariable('--bg-primary'));
    return background
      ? mixOpaqueHex(foreground, Number(mixMatch[3]) / 100, background)
      : foreground;
  }

  const trimmed = featureColor.trim();
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
