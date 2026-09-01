import type { FeatureType } from './types';

type FeatureColorInput = {
  name?: unknown;
  type?: unknown;
  color?: unknown;
};

type FeaturePaletteEntry = {
  /** The former GenBank-import default, retained as the palette's visual seed. */
  seed: string;
};

// This is the former GenBank-only FEATURE_COLORS table. Its seed values keep
// the same semantic grouping while producing portable record data.
const FEATURE_COLORS: Readonly<Record<FeatureType, FeaturePaletteEntry>> = {
  gene: { seed: '#7E9BBF' },
  cds: { seed: '#7E9BBF' },
  promoter: { seed: '#C6A86B' },
  terminator: { seed: '#C28C88' },
  misc_feature: { seed: '#8B8F99' },
  origin: { seed: '#9E96B4' },
  primer_bind: { seed: '#C49374' },
  orf: { seed: '#7FA98F' },
  rbs: { seed: '#C6A86B' },
  resistance: { seed: '#C49374' },
  restriction_site: { seed: '#8B8F99' },
  mRNA: { seed: '#6FB0A4' },
  rRNA: { seed: '#6FB0A4' },
  tRNA: { seed: '#6FB0A4' },
  ncRNA: { seed: '#9E96B4' },
  regulatory: { seed: '#C6A86B' },
  repeat_region: { seed: '#9E96B4' },
  sig_peptide: { seed: '#9DB585' },
  mat_peptide: { seed: '#9DB585' },
  transit_peptide: { seed: '#9DB585' },
  intron: { seed: '#8B8F99' },
  exon: { seed: '#6FB0A4' },
  polyA_signal: { seed: '#C28C88' },
  enhancer: { seed: '#C6A86B' },
  custom: { seed: '#8B8F99' },
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
  '#7E9BBF',
  '#7FA98F',
  '#9E96B4',
  '#C6A86B',
  '#C28C88',
  '#8B8F99',
] as const;

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

function typeAndSeed(type: unknown, name: string): { typeKey: string; seed: string } {
  const normalizedType = typeof type === 'string'
    ? FEATURE_TYPE_BY_LOWER.get(type.trim().toLowerCase() as Lowercase<FeatureType>)
    : undefined;
  if (normalizedType && KNOWN_FEATURE_TYPES.has(normalizedType) && normalizedType !== 'custom') {
    const featureType = normalizedType;
    const entry = FEATURE_COLORS[featureType];
    return {
      typeKey: featureType,
      seed: entry.seed,
    };
  }
  // Every unrecognized label crosses the artifact boundary as `custom`.
  // Hash the canonical type key so MCP, file, and page API routes agree even
  // when one route sees the raw unknown label before type normalization.
  const typeKey = 'custom';
  const rampIndex = stableHash(`${typeKey}:${name}`) % UNKNOWN_TYPE_RAMP.length;
  return { typeKey, seed: UNKNOWN_TYPE_RAMP[rampIndex] };
}

function tintSeed(seed: string, hash: number): string {
  const factor = 0.82 + (hash % 21) * 0.018;
  const channel = (offset: number): string => Math.max(0, Math.min(255,
    Math.round(Number.parseInt(seed.slice(offset, offset + 2), 16) * factor),
  )).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * Resolve a feature color at every ingestion boundary.
 *
 * Safe explicit caller colors are returned byte-for-byte after trimming.
 * Missing or unsafe colors receive a deterministic portable hex color. Known
 * feature types stay in the hue family seeded by the former GenBank palette;
 * the feature name selects a stable tint so adjacent same-type annotations do
 * not collapse into one visual block. Custom/unknown types hash into a curated
 * categorical ramp instead of the historical flat grey. Generated defaults
 * stay out of CSS-expression space so native color inputs, exports, and
 * non-browser hosts all receive the same valid value; renderers remain free to
 * derive theme surfaces.
 */
export function resolveFeatureColor(feature: FeatureColorInput): string {
  const explicit = validExplicitColor(feature.color);
  if (explicit) return explicit;

  const name = typeof feature.name === 'string' && feature.name.trim()
    ? feature.name.trim().toLowerCase()
    : 'unnamed feature';
  const { typeKey, seed } = typeAndSeed(feature.type, name);
  const hash = stableHash(`${typeKey}:${name}`);
  return tintSeed(seed, hash);
}
