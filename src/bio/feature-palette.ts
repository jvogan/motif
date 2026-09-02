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
 * tokens and approved color mixes use their portable palette fallback.
 */
export function materializeFeatureColor(featureColor: string): string {
  const trimmed = featureColor.trim();
  if (!THEME_COLOR_TOKEN.test(trimmed) && !THEME_COLOR_MIX.test(trimmed)) return trimmed;
  const reference = THEME_COLOR_REFERENCE.exec(trimmed);
  if (!reference) return THEME_COLOR_FALLBACKS['feature-neutral'];
  const token = reference[1] as keyof typeof THEME_COLOR_FALLBACKS;
  return reference[2] ?? THEME_COLOR_FALLBACKS[token];
}
