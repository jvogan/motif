import type { Feature } from './types';
import { NO_COLOR_VALUE } from './color-values';

export const SEQUENCE_HIGHLIGHT_KIND = 'sequence_highlight';
// #10b RE-BRIGHTEN (2026-06-02): a prior calm campaign muted this palette to a
// quiet sage/clay/teal trio + a muted gold default. Per direct user direction
// ("the highlight colors are not good — need more std colors and a custom
// palette"), the highlight palette is re-brightened and expanded to a full
// 12-swatch set: a vivid rainbow (amber → green → blue → … → purple) plus the
// dark "redact" swatch last. The default still LEADS the array (index 0 — the
// create-highlight path uses the first swatch as its default) and is a bright
// amber, kept distinct from the G-base hue used by base-coloring. Tests pass
// `#facc15` as a literal, so changing this constant stays safe.
export const DEFAULT_SEQUENCE_HIGHLIGHT_COLOR = '#e0b83c';
export const DARK_SEQUENCE_HIGHLIGHT_COLOR = '#111827';
export const DARK_THEME_DARK_HIGHLIGHT_BACKGROUND = '#f8fafc';
export const DARK_THEME_DARK_HIGHLIGHT_FOREGROUND = '#111827';

// The user-facing highlighter chooser. Mirrors the bright standard set used by
// the feature ColorField (`DEFAULT_STANDARD_COLORS`) so highlights and feature
// tints read as one family, with two deliberate pins: index 0 = the default
// amber, index 2 = `#60a5fa` (the blue an e2e flow applies by name), and the
// dark redact swatch held last. Custom user colors are appended at the picker
// sites (see FormatInspectorTab / SequenceHighlightTrack), not baked in here.
export const SEQUENCE_HIGHLIGHT_COLORS = [
  DEFAULT_SEQUENCE_HIGHLIGHT_COLOR, // amber (default)
  '#46c26b', // green
  '#60a5fa', // blue
  '#39b5c9', // cyan
  '#2fbfa4', // teal
  '#8fc740', // lime
  '#e89b3e', // orange
  '#e8794e', // burnt orange
  '#e0655f', // red
  '#db6a9e', // pink
  '#a47be0', // purple
  DARK_SEQUENCE_HIGHLIGHT_COLOR, // dark / redact
] as const;

const DARK_HIGHLIGHT_COLORS = new Set([
  DARK_SEQUENCE_HIGHLIGHT_COLOR,
  '#0f172a',
  '#111827',
  '#020617',
]);

// The genuinely-bright swatch hues that need DARK foreground text at high mix.
// At the default 34% band mix the bands are translucent and the base keeps its
// own color (this set is a no-op there). It only bites at high mix (>=50%, e.g.
// monochrome mode's 58%) in DARK theme, where a luminous band is opaque enough
// to wash out light text — those flip to dark ink (see sequenceHighlightForeground).
// The re-brightened palette's luminous members (amber/lime/green/cyan/teal/orange)
// join the legacy `#facc15`/`#4ade80` literals the unit tests pin. Cooler/darker
// hues (blue `#60a5fa`, purple, red, pink) keep light text and stay OUT of this set.
// NOTE: matched lowercased — keep every entry lowercase.
const BRIGHT_HIGHLIGHT_COLORS = new Set([
  '#facc15',
  '#4ade80',
  '#e0b83c', // amber (default)
  '#8fc740', // lime
  '#46c26b', // green
  '#39b5c9', // cyan
  '#2fbfa4', // teal
  '#e89b3e', // orange
]);

let lastSequenceHighlightCreatedAt = 0;

export interface SequenceHighlight {
  id: string;
  name: string;
  start: number;
  end: number;
  color: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export function isLinkedFeatureSequenceHighlight(
  highlight: Pick<SequenceHighlight, 'metadata'> | null | undefined,
): boolean {
  return typeof highlight?.metadata?.featureId === 'string';
}

export function isSequenceHighlight(feature: Pick<Feature, 'metadata'> | null | undefined): boolean {
  if (!feature?.metadata) return false;
  return feature.metadata.kind === SEQUENCE_HIGHLIGHT_KIND
    || feature.metadata.role === SEQUENCE_HIGHLIGHT_KIND
    || feature.metadata.sequenceHighlight === true;
}

export function linkedFeatureHighlightColor(feature: Pick<Feature, 'id' | 'color'>): string {
  if (feature.color && feature.color !== NO_COLOR_VALUE) return feature.color;
  let hash = 0;
  for (let index = 0; index < feature.id.length; index += 1) {
    hash = (hash * 31 + feature.id.charCodeAt(index)) >>> 0;
  }
  return SEQUENCE_HIGHLIGHT_COLORS[hash % SEQUENCE_HIGHLIGHT_COLORS.length];
}

export function sortedSequenceHighlights(highlights: SequenceHighlight[]): SequenceHighlight[] {
  return [...highlights]
    .sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
}

export function annotationFeatures(features: Feature[]): Feature[] {
  return features.filter((feature) => !isSequenceHighlight(feature));
}

function sequenceHighlightCreatedAt(highlight: Pick<SequenceHighlight, 'createdAt'>): number {
  return Number.isFinite(highlight.createdAt) ? highlight.createdAt : 0;
}

// Which highlight "wins" (paints on top) at a base covered by several:
//   1. the SMALLER span wins — a feature nested inside a larger one stays
//      visible instead of being buried under the big highlight;
//   2. ties on span break by recency (a freshly (re)applied highlight, e.g.
//      one the user just toggled on or clicked, pulls to the front);
//   3. id is the final deterministic tiebreak.
export function sequenceHighlightAtPosition(highlights: SequenceHighlight[], position: number): SequenceHighlight | null {
  let winner: SequenceHighlight | null = null;
  let winnerSpan = Infinity;
  for (const highlight of highlights) {
    if (position < highlight.start || position >= highlight.end) continue;
    const span = highlight.end - highlight.start;
    if (!winner) {
      winner = highlight;
      winnerSpan = span;
      continue;
    }
    const createdAt = sequenceHighlightCreatedAt(highlight);
    const winnerCreatedAt = sequenceHighlightCreatedAt(winner);
    const wins =
      span < winnerSpan
      || (span === winnerSpan && createdAt > winnerCreatedAt)
      || (span === winnerSpan && createdAt === winnerCreatedAt && highlight.id.localeCompare(winner.id) > 0);
    if (wins) {
      winner = highlight;
      winnerSpan = span;
    }
  }
  return winner;
}

export function nextSequenceHighlightCreatedAt(now = Date.now()): number {
  lastSequenceHighlightCreatedAt = Math.max(now, lastSequenceHighlightCreatedAt + 1);
  return lastSequenceHighlightCreatedAt;
}

export function isDarkSequenceHighlightColor(color: string | null | undefined): boolean {
  const normalized = (color || '').trim().toLowerCase();
  return DARK_HIGHLIGHT_COLORS.has(normalized);
}

export function sequenceHighlightBackground(
  color: string | null | undefined,
  mix = '34%',
  theme?: 'dark' | 'light',
): string {
  const resolved = color || DEFAULT_SEQUENCE_HIGHLIGHT_COLOR;
  if (isDarkSequenceHighlightColor(resolved)) {
    if (theme === 'dark') {
      const lightMix = mix === '34%' ? '70%' : '78%';
      return `color-mix(in srgb, ${DARK_THEME_DARK_HIGHLIGHT_BACKGROUND} ${lightMix}, transparent)`;
    }
    // Light theme: a subtle tint (<=25%) so the bases underneath stay legible
    // instead of being blacked out by the opaque dark swatch.
    return `color-mix(in srgb, ${resolved} 22%, transparent)`;
  }
  return `color-mix(in srgb, ${resolved} ${mix}, transparent)`;
}

export function sequenceHighlightForeground(
  color: string | null | undefined,
  theme?: 'dark' | 'light',
  mix = '34%',
): string | undefined {
  const normalized = (color || '').trim().toLowerCase();
  if (isDarkSequenceHighlightColor(normalized)) {
    // Light theme now paints a translucent tint (see sequenceHighlightBackground),
    // so let the base keep its normal residue/base color instead of forcing white.
    return theme === 'dark' ? DARK_THEME_DARK_HIGHLIGHT_FOREGROUND : undefined;
  }
  const mixAmount = Number.parseFloat(mix);
  if (theme === 'dark' && BRIGHT_HIGHLIGHT_COLORS.has(normalized) && Number.isFinite(mixAmount) && mixAmount >= 50) {
    return DARK_THEME_DARK_HIGHLIGHT_FOREGROUND;
  }
  return undefined;
}

/**
 * Default name format for a newly-created saved highlight ("Region N").
 *
 * Phase 39 W4 (D8 P0-3): renamed from "Highlight N" so the persisted entity
 * does not collide with the live range-selection chip ("Selected bases X-Y").
 * Legacy snapshots are normalised in `normalizeSequenceHighlights()`.
 */
export const DEFAULT_SEQUENCE_HIGHLIGHT_NAME_PREFIX = 'Region';

/** Legacy default name format we used to emit before Phase 39 W4. */
const LEGACY_HIGHLIGHT_DEFAULT_NAME_PATTERN = /^Highlight (\d+)$/;

export function makeSequenceHighlight(
  range: { start: number; end: number },
  color: string,
  ordinal: number,
): SequenceHighlight {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(start + 1, Math.max(range.start, range.end));
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `highlight-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    id: randomId,
    name: `${DEFAULT_SEQUENCE_HIGHLIGHT_NAME_PREFIX} ${ordinal}`,
    start,
    end,
    color: color || DEFAULT_SEQUENCE_HIGHLIGHT_COLOR,
    createdAt: nextSequenceHighlightCreatedAt(),
    metadata: {
      kind: SEQUENCE_HIGHLIGHT_KIND,
    },
  };
}

export function sequenceHighlightTitle(highlight: Pick<SequenceHighlight, 'name' | 'start' | 'end'>): string {
  return `${highlight.name} ${highlight.start + 1}-${highlight.end}`;
}

export function sequenceHighlightsFromLegacyFeatures(features: Feature[]): SequenceHighlight[] {
  return features.filter(isSequenceHighlight).map((feature) => ({
    id: feature.id,
    name: feature.name,
    start: feature.start,
    end: feature.end,
    color: feature.color || DEFAULT_SEQUENCE_HIGHLIGHT_COLOR,
    createdAt: typeof feature.metadata.createdAt === 'number' ? feature.metadata.createdAt : 0,
    metadata: { ...feature.metadata },
  }));
}

export function cloneSequenceHighlights(highlights: SequenceHighlight[]): SequenceHighlight[] {
  return JSON.parse(JSON.stringify(highlights)) as SequenceHighlight[];
}

export function normalizeSequenceHighlights(value: unknown): SequenceHighlight[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index): SequenceHighlight | null => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Partial<SequenceHighlight>;
      const start = Math.max(0, Math.floor(Number(record.start)));
      const end = Math.max(start, Math.floor(Number(record.end)));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      // Phase 39 W4 (D8 P0-3) backfill: legacy `Highlight N` → `Region N`.
      const rawName = typeof record.name === 'string' && record.name
        ? record.name
        : `${DEFAULT_SEQUENCE_HIGHLIGHT_NAME_PREFIX} ${index + 1}`;
      const legacyMatch = rawName.match(LEGACY_HIGHLIGHT_DEFAULT_NAME_PATTERN);
      const name = legacyMatch
        ? `${DEFAULT_SEQUENCE_HIGHLIGHT_NAME_PREFIX} ${legacyMatch[1]}`
        : rawName;
      return {
        id: typeof record.id === 'string' && record.id ? record.id : `highlight-${index}`,
        name,
        start,
        end,
        color: typeof record.color === 'string' && record.color ? record.color : DEFAULT_SEQUENCE_HIGHLIGHT_COLOR,
        createdAt: Number.isFinite(Number(record.createdAt)) ? Number(record.createdAt) : 0,
        metadata: record.metadata && typeof record.metadata === 'object' ? { ...record.metadata } : undefined,
      };
    })
    .filter((entry): entry is SequenceHighlight => Boolean(entry));
}

export function shiftSequenceHighlightsForRange(
  highlights: SequenceHighlight[],
  start: number,
  end: number,
): SequenceHighlight[] {
  return highlights
    .filter((highlight) => highlight.start < end && highlight.end > start)
    .map((highlight) => ({
      ...highlight,
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `highlight-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      start: Math.max(0, highlight.start - start),
      end: Math.min(end - start, highlight.end - start),
      createdAt: nextSequenceHighlightCreatedAt(),
    }))
    .filter((highlight) => highlight.end > highlight.start);
}

export function shiftSequenceHighlightsForInsertion(
  highlights: SequenceHighlight[],
  editPos: number,
  delta: number,
): SequenceHighlight[] {
  if (delta <= 0) return cloneSequenceHighlights(highlights);
  return highlights.map((highlight) => ({
    ...highlight,
    start: highlight.start > editPos ? highlight.start + delta : highlight.start,
    end: highlight.end > editPos ? highlight.end + delta : highlight.end,
  }));
}

export function shiftSequenceHighlightsForDeletion(
  highlights: SequenceHighlight[],
  pos: number,
  count: number,
  rawLength: number,
): SequenceHighlight[] {
  if (count <= 0 || pos < 0 || pos >= rawLength) return cloneSequenceHighlights(highlights);
  const effectiveCount = Math.min(count, rawLength - pos);
  const endOfDeletion = pos + effectiveCount;

  return highlights
    .map((highlight) => {
      let nextStart = highlight.start;
      let nextEnd = highlight.end;

      if (highlight.start >= endOfDeletion) {
        nextStart = highlight.start - effectiveCount;
      } else if (highlight.start > pos) {
        nextStart = pos;
      }

      if (highlight.end >= endOfDeletion) {
        nextEnd = highlight.end - effectiveCount;
      } else if (highlight.end > pos) {
        nextEnd = pos;
      }

      return { ...highlight, start: nextStart, end: nextEnd };
    })
    .filter((highlight) => highlight.end > highlight.start);
}

export const makeSequenceHighlightFeature = makeSequenceHighlight;
