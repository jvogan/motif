import type { SequenceType } from './types';
import {
  normalizeSequenceHighlights,
  sequenceHighlightAtPosition,
  sequenceHighlightTitle,
} from './sequence-highlights';
import type { SequenceHighlight } from './sequence-highlights';
import { isPrositePattern, prositeToRegexSource, prositeMaxMatchLength } from './prosite';

export type SequenceLayoutMarkKind = 'paragraph' | 'line' | 'tab';
export type SequenceMotifAlphabet = 'dna' | 'rna' | 'protein' | 'auto';

export interface SequenceTextStyle {
  backgroundColor?: string | null;
  color?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  fontSize?: number | null;
  fontFamily?: string | null;
}

export const MIN_SEQUENCE_TEXT_STYLE_FONT_SIZE = 12;
export const MAX_SEQUENCE_TEXT_STYLE_FONT_SIZE = 16;

export interface SequenceStyleRange {
  id: string;
  start: number;
  end: number;
  style: SequenceTextStyle;
  createdAt: number;
  name?: string;
}

export interface SequenceLayoutMark {
  id: string;
  position: number;
  kind: SequenceLayoutMarkKind;
  createdAt: number;
  indentLevel?: number;
}

export interface SequenceMotifRule {
  id: string;
  name: string;
  pattern: string;
  alphabet: SequenceMotifAlphabet;
  enabled: boolean;
  style: SequenceTextStyle;
  createdAt: number;
  updatedAt?: number;
}

export interface SequenceFormatting {
  ranges: SequenceStyleRange[];
  layoutMarks: SequenceLayoutMark[];
  motifRules: SequenceMotifRule[];
}

/**
 * A user-saved named text-styling preset (size + family + color + weight/etc).
 * Reuses the same `SequenceTextStyle` payload that `applyStyle` pushes onto a
 * range, so applying a preset is identical to applying an ad-hoc style. Persisted
 * as an app-level preference (see the ui-store `stylePresets` slice), not on a
 * block, so a saved preset is reusable across every sequence.
 */
export interface SequenceStylePreset {
  id: string;
  name: string;
  style: SequenceTextStyle;
  createdAt: number;
}

export interface SequenceMotifMatch {
  ruleId: string;
  start: number;
  end: number;
  matched: string;
}

type StyleProperty = keyof SequenceTextStyle;

interface StyleProvider {
  id: string;
  priority: number;
  createdAt: number;
  label?: string;
}

interface ResolvedProperty<T> {
  value: T | null | undefined;
  provider: StyleProvider;
}

export interface ResolvedSequenceStyleOverlay {
  backgroundColor?: string | null;
  color?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  fontSize?: number | null;
  fontFamily?: string | null;
  titleParts: string[];
  layoutMarks: SequenceLayoutMark[];
}

type OverlayScratch = {
  [K in StyleProperty]?: ResolvedProperty<NonNullable<SequenceTextStyle[K]>>;
} & {
  titleParts: Set<string>;
  layoutMarks: SequenceLayoutMark[];
};

interface HighlightNormalizationCacheEntry {
  snapshots: HighlightInputSnapshot[];
  normalized: SequenceHighlight[];
}

interface HighlightInputSnapshot {
  entry: unknown;
  id: unknown;
  name: unknown;
  start: unknown;
  end: unknown;
  color: unknown;
  createdAt: unknown;
  metadata: unknown;
}

const MANUAL_STYLE_PRIORITY = 20;
const MOTIF_STYLE_PRIORITY = 10;
let lastSequenceFormattingCreatedAt = 0;

export const DEFAULT_SEQUENCE_FORMATTING: SequenceFormatting = {
  ranges: [],
  layoutMarks: [],
  motifRules: [],
};

const EMPTY_STYLE_KEYS: StyleProperty[] = [
  'backgroundColor',
  'color',
  'bold',
  'italic',
  'underline',
  'fontSize',
  'fontFamily',
];

const STYLE_PROPERTY_SET = new Set<StyleProperty>(EMPTY_STYLE_KEYS);
const EMPTY_SEQUENCE_HIGHLIGHTS: SequenceHighlight[] = [];
const LEGACY_SEQUENCE_HIGHLIGHT_DEFAULT_NAME_PATTERN = /^Highlight \d+$/;
const sequenceHighlightNormalizationCache = new WeakMap<SequenceHighlight[], HighlightNormalizationCacheEntry>();

const DNA_IUPAC: Record<string, string> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: '[TU]',
  U: '[TU]',
  R: '[AG]',
  Y: '[CTU]',
  S: '[GC]',
  W: '[ATU]',
  K: '[GTU]',
  M: '[AC]',
  B: '[CGTU]',
  D: '[AGTU]',
  H: '[ACTU]',
  V: '[ACG]',
  N: '[ACGTU]',
};

const PROTEIN_IUPAC: Record<string, string> = {
  B: '[DN]',
  Z: '[EQ]',
  J: '[IL]',
  X: '[A-Z*]',
  '*': '\\*',
};

function randomId(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function nextSequenceFormattingCreatedAt(now = Date.now()): number {
  lastSequenceFormattingCreatedAt = Math.max(now, lastSequenceFormattingCreatedAt + 1);
  return lastSequenceFormattingCreatedAt;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeStyle(value: unknown): SequenceTextStyle {
  const record = asRecord(value);
  if (!record) return {};

  const style: SequenceTextStyle = {};
  if ('backgroundColor' in record) {
    style.backgroundColor = typeof record.backgroundColor === 'string'
      ? record.backgroundColor
      : record.backgroundColor === null ? null : undefined;
  }
  if ('color' in record) {
    style.color = typeof record.color === 'string'
      ? record.color
      : record.color === null ? null : undefined;
  }
  if ('bold' in record) {
    style.bold = typeof record.bold === 'boolean'
      ? record.bold
      : record.bold === null ? null : undefined;
  }
  if ('italic' in record) {
    style.italic = typeof record.italic === 'boolean'
      ? record.italic
      : record.italic === null ? null : undefined;
  }
  if ('underline' in record) {
    style.underline = typeof record.underline === 'boolean'
      ? record.underline
      : record.underline === null ? null : undefined;
  }
  if ('fontSize' in record) {
    const fontSize = typeof record.fontSize === 'number' ? record.fontSize : Number(record.fontSize);
    style.fontSize = Number.isFinite(fontSize) && fontSize > 0
      ? Math.min(MAX_SEQUENCE_TEXT_STYLE_FONT_SIZE, Math.max(MIN_SEQUENCE_TEXT_STYLE_FONT_SIZE, fontSize))
      : record.fontSize === null ? null : undefined;
  }
  if ('fontFamily' in record) {
    style.fontFamily = typeof record.fontFamily === 'string'
      ? record.fontFamily
      : record.fontFamily === null ? null : undefined;
  }
  return Object.fromEntries(
    Object.entries(style).filter(([, entryValue]) => entryValue !== undefined),
  ) as SequenceTextStyle;
}

function normalizeRange(value: unknown): SequenceStyleRange | null {
  const record = asRecord(value);
  if (!record) return null;
  const start = Math.max(0, Math.floor(Number(record.start)));
  const end = Math.max(start, Math.floor(Number(record.end)));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const style = normalizeStyle(record.style);
  if (Object.keys(style).length === 0) return null;
  return {
    id: typeof record.id === 'string' && record.id ? record.id : randomId('style-range'),
    start,
    end,
    style,
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    name: typeof record.name === 'string' ? record.name : undefined,
  };
}

function normalizeLayoutMark(value: unknown): SequenceLayoutMark | null {
  const record = asRecord(value);
  if (!record) return null;
  const position = Math.max(0, Math.floor(Number(record.position)));
  const kind = record.kind;
  if (!Number.isFinite(position) || (kind !== 'paragraph' && kind !== 'line' && kind !== 'tab')) return null;
  const indentLevel = Math.max(0, Math.floor(Number(record.indentLevel ?? 1)));
  return {
    id: typeof record.id === 'string' && record.id ? record.id : randomId('layout-mark'),
    position,
    kind,
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    indentLevel: Number.isFinite(indentLevel) ? indentLevel : undefined,
  };
}

function normalizeMotifRule(value: unknown): SequenceMotifRule | null {
  const record = asRecord(value);
  if (!record) return null;
  const pattern = typeof record.pattern === 'string' ? record.pattern.trim() : '';
  if (!pattern) return null;
  const alphabet = record.alphabet === 'dna' || record.alphabet === 'rna' || record.alphabet === 'protein'
    ? record.alphabet
    : 'auto';
  return {
    id: typeof record.id === 'string' && record.id ? record.id : randomId('motif-rule'),
    name: typeof record.name === 'string' && record.name.trim()
      ? record.name.trim()
      : pattern.toUpperCase(),
    pattern,
    alphabet,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    style: normalizeStyle(record.style),
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    updatedAt: Number.isFinite(Number(record.updatedAt)) ? Number(record.updatedAt) : undefined,
  };
}

function isValidStyleValue(property: StyleProperty, value: unknown): boolean {
  if (value === null) return true;
  switch (property) {
    case 'backgroundColor':
    case 'color':
    case 'fontFamily':
      return typeof value === 'string';
    case 'bold':
    case 'italic':
    case 'underline':
      return typeof value === 'boolean';
    case 'fontSize':
      return typeof value === 'number' && Number.isFinite(value) && value > 0;
    default:
      return false;
  }
}

function isNormalizedStyle(value: unknown, requireNonEmpty: boolean): value is SequenceTextStyle {
  const record = asRecord(value);
  if (!record) return false;
  const keys = Object.keys(record);
  if (requireNonEmpty && keys.length === 0) return false;
  for (const key of keys) {
    if (!STYLE_PROPERTY_SET.has(key as StyleProperty)) return false;
    if (!isValidStyleValue(key as StyleProperty, record[key])) return false;
  }
  for (const property of EMPTY_STYLE_KEYS) {
    if (property in record && !Object.prototype.propertyIsEnumerable.call(record, property)) return false;
  }
  return true;
}

function isNormalizedRange(value: unknown): value is SequenceStyleRange {
  const record = asRecord(value);
  if (!record) return false;
  return typeof record.id === 'string' && record.id.length > 0
    && typeof record.start === 'number' && Number.isInteger(record.start) && record.start >= 0
    && typeof record.end === 'number' && Number.isInteger(record.end) && record.end > record.start
    && typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    && (record.name === undefined || typeof record.name === 'string')
    && isNormalizedStyle(record.style, true);
}

function isNormalizedLayoutMark(value: unknown): value is SequenceLayoutMark {
  const record = asRecord(value);
  if (!record) return false;
  return typeof record.id === 'string' && record.id.length > 0
    && typeof record.position === 'number' && Number.isInteger(record.position) && record.position >= 0
    && (record.kind === 'paragraph' || record.kind === 'line' || record.kind === 'tab')
    && typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    && (typeof record.indentLevel === 'number' && Number.isInteger(record.indentLevel) && record.indentLevel >= 0);
}

function isNormalizedMotifRule(value: unknown): value is SequenceMotifRule {
  const record = asRecord(value);
  if (!record) return false;
  return typeof record.id === 'string' && record.id.length > 0
    && typeof record.name === 'string' && record.name.length > 0
    && typeof record.pattern === 'string' && record.pattern.length > 0 && record.pattern === record.pattern.trim()
    && (record.alphabet === 'dna' || record.alphabet === 'rna' || record.alphabet === 'protein' || record.alphabet === 'auto')
    && typeof record.enabled === 'boolean'
    && typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    && (record.updatedAt === undefined || (typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)))
    && isNormalizedStyle(record.style, false);
}

function isNormalizedSequenceFormatting(value: unknown): value is SequenceFormatting {
  const record = asRecord(value);
  if (!record) return false;
  return Array.isArray(record.ranges)
    && Array.isArray(record.layoutMarks)
    && Array.isArray(record.motifRules)
    && record.ranges.every(isNormalizedRange)
    && record.layoutMarks.every(isNormalizedLayoutMark)
    && record.motifRules.every(isNormalizedMotifRule);
}

function normalizedSequenceFormattingForHitMap(value: SequenceFormatting | null | undefined): SequenceFormatting {
  return isNormalizedSequenceFormatting(value) ? value : normalizeSequenceFormatting(value);
}

function isNormalizedSequenceHighlight(value: unknown): value is SequenceHighlight {
  const record = asRecord(value);
  if (!record) return false;
  return typeof record.id === 'string' && record.id.length > 0
    && typeof record.name === 'string' && record.name.length > 0
    && !LEGACY_SEQUENCE_HIGHLIGHT_DEFAULT_NAME_PATTERN.test(record.name)
    && typeof record.start === 'number' && Number.isInteger(record.start) && record.start >= 0
    && typeof record.end === 'number' && Number.isInteger(record.end) && record.end > record.start
    && typeof record.color === 'string' && record.color.length > 0
    && typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    && (record.metadata === undefined || asRecord(record.metadata) !== null);
}

function hasNormalizedSequenceHighlightShapes(highlights: SequenceHighlight[]): boolean {
  for (const highlight of highlights) {
    if (!isNormalizedSequenceHighlight(highlight)) return false;
  }
  return true;
}

function snapshotHighlightInput(entry: unknown): HighlightInputSnapshot {
  const record = asRecord(entry);
  return {
    entry,
    id: record?.id,
    name: record?.name,
    start: record?.start,
    end: record?.end,
    color: record?.color,
    createdAt: record?.createdAt,
    metadata: record?.metadata,
  };
}

function highlightCacheMatches(entry: HighlightNormalizationCacheEntry, highlights: SequenceHighlight[]): boolean {
  if (entry.snapshots.length !== highlights.length) return false;
  for (let index = 0; index < highlights.length; index += 1) {
    const snapshot = entry.snapshots[index];
    const current = snapshotHighlightInput(highlights[index]);
    if (
      snapshot.entry !== current.entry
      || !Object.is(snapshot.id, current.id)
      || !Object.is(snapshot.name, current.name)
      || !Object.is(snapshot.start, current.start)
      || !Object.is(snapshot.end, current.end)
      || !Object.is(snapshot.color, current.color)
      || !Object.is(snapshot.createdAt, current.createdAt)
      || snapshot.metadata !== current.metadata
    ) {
      return false;
    }
  }
  return true;
}

function normalizedSequenceHighlightsForHitMap(highlights: SequenceHighlight[] | null | undefined): SequenceHighlight[] {
  if (!highlights || highlights.length === 0) return EMPTY_SEQUENCE_HIGHLIGHTS;
  if (hasNormalizedSequenceHighlightShapes(highlights)) return highlights;

  const cached = sequenceHighlightNormalizationCache.get(highlights);
  if (cached && highlightCacheMatches(cached, highlights)) return cached.normalized;

  const normalized = normalizeSequenceHighlights(highlights);
  sequenceHighlightNormalizationCache.set(highlights, {
    snapshots: highlights.map(snapshotHighlightInput),
    normalized,
  });
  return normalized;
}

export function emptySequenceFormatting(): SequenceFormatting {
  return deepClone(DEFAULT_SEQUENCE_FORMATTING);
}

export function normalizeSequenceFormatting(value: unknown): SequenceFormatting {
  if (typeof value === 'string') {
    try {
      return normalizeSequenceFormatting(JSON.parse(value));
    } catch {
      return emptySequenceFormatting();
    }
  }
  const record = asRecord(value);
  if (!record) return emptySequenceFormatting();
  return {
    ranges: Array.isArray(record.ranges)
      ? record.ranges.map(normalizeRange).filter((range): range is SequenceStyleRange => Boolean(range))
      : [],
    layoutMarks: Array.isArray(record.layoutMarks)
      ? record.layoutMarks.map(normalizeLayoutMark).filter((mark): mark is SequenceLayoutMark => Boolean(mark))
      : [],
    motifRules: Array.isArray(record.motifRules)
      ? record.motifRules.map(normalizeMotifRule).filter((rule): rule is SequenceMotifRule => Boolean(rule))
      : [],
  };
}

export function cloneSequenceFormatting(formatting: SequenceFormatting | null | undefined): SequenceFormatting {
  return normalizeSequenceFormatting(deepClone(formatting ?? DEFAULT_SEQUENCE_FORMATTING));
}

export function makeSequenceStyleRange(
  range: { start: number; end: number },
  style: SequenceTextStyle,
  name?: string,
): SequenceStyleRange {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(start + 1, Math.max(range.start, range.end));
  return {
    id: randomId('style-range'),
    start,
    end,
    style: normalizeStyle(style),
    createdAt: nextSequenceFormattingCreatedAt(),
    name,
  };
}

export function makeSequenceLayoutMark(position: number, kind: SequenceLayoutMarkKind, indentLevel?: number): SequenceLayoutMark {
  return {
    id: randomId('layout-mark'),
    position: Math.max(0, Math.floor(position)),
    kind,
    createdAt: nextSequenceFormattingCreatedAt(),
    indentLevel,
  };
}

export function makeSequenceMotifRule(
  pattern: string,
  style: SequenceTextStyle,
  alphabet: SequenceMotifAlphabet = 'auto',
  name?: string,
): SequenceMotifRule {
  const cleanPattern = pattern.trim();
  return {
    id: randomId('motif-rule'),
    name: name?.trim() || cleanPattern.toUpperCase(),
    pattern: cleanPattern,
    alphabet,
    enabled: true,
    style: normalizeStyle(style),
    createdAt: nextSequenceFormattingCreatedAt(),
    updatedAt: nextSequenceFormattingCreatedAt(),
  };
}

export function makeSequenceStylePreset(name: string, style: SequenceTextStyle): SequenceStylePreset {
  return {
    id: randomId('style-preset'),
    name: name.trim() || 'Preset',
    style: normalizeStyle(style),
    createdAt: Date.now(),
  };
}

/**
 * Coerce an unknown value (e.g. a JSON-parsed localStorage entry) into a valid
 * `SequenceStylePreset`, or null if it cannot be salvaged. A preset whose style
 * is empty after normalization is dropped — it would apply nothing.
 */
export function normalizeSequenceStylePreset(value: unknown): SequenceStylePreset | null {
  const record = asRecord(value);
  if (!record) return null;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) return null;
  const style = normalizeStyle(record.style);
  if (Object.keys(style).length === 0) return null;
  return {
    id: typeof record.id === 'string' && record.id ? record.id : randomId('style-preset'),
    name,
    style,
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
  };
}

function providerWins(left: StyleProvider, right: StyleProvider | undefined): boolean {
  if (!right) return true;
  if (left.priority !== right.priority) return left.priority > right.priority;
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt;
  return left.id.localeCompare(right.id) > 0;
}

function hasOwnStyleProperty(style: SequenceTextStyle, property: StyleProperty): boolean {
  return Object.prototype.hasOwnProperty.call(style, property);
}

function getScratch(map: Map<number, OverlayScratch>, position: number): OverlayScratch {
  const existing = map.get(position);
  if (existing) return existing;
  const next: OverlayScratch = { titleParts: new Set<string>(), layoutMarks: [] };
  map.set(position, next);
  return next;
}

function applyStyleToPosition(
  map: Map<number, OverlayScratch>,
  position: number,
  style: SequenceTextStyle,
  provider: StyleProvider,
): void {
  const scratch = getScratch(map, position);
  for (const property of EMPTY_STYLE_KEYS) {
    if (!hasOwnStyleProperty(style, property)) continue;
    const current = scratch[property];
    if (providerWins(provider, current?.provider)) {
      scratch[property] = {
        value: style[property] as never,
        provider,
      };
    }
  }
  if (provider.label) scratch.titleParts.add(provider.label);
}

function applyStyleRange(
  map: Map<number, OverlayScratch>,
  start: number,
  end: number,
  style: SequenceTextStyle,
  provider: StyleProvider,
): void {
  for (let position = start; position < end; position += 1) {
    applyStyleToPosition(map, position, style, provider);
  }
}

function escapeRegexChar(char: string): string {
  return char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function alphabetForRule(rule: SequenceMotifRule, sequenceType: SequenceType): Exclude<SequenceMotifAlphabet, 'auto'> {
  if (rule.alphabet !== 'auto') return rule.alphabet;
  if (sequenceType === 'rna') return 'rna';
  if (sequenceType === 'protein') return 'protein';
  return 'dna';
}

export function iupacPatternToRegexSource(
  pattern: string,
  alphabet: Exclude<SequenceMotifAlphabet, 'auto'>,
): string | null {
  const trimmed = pattern.replace(/\s+/g, '');
  if (!trimmed) return null;
  // Advanced motif syntax: a PROSITE pattern ([..], {..}, x(n), <, >, -) is
  // parsed by the PROSITE engine; a plain IUPAC/literal string (ATGN) keeps the
  // per-character IUPAC expansion below.
  if (isPrositePattern(trimmed)) {
    return prositeToRegexSource(trimmed, alphabet);
  }
  const clean = trimmed.toUpperCase();
  let source = '';
  for (const char of clean) {
    if (alphabet === 'protein') {
      source += PROTEIN_IUPAC[char] ?? escapeRegexChar(char);
      continue;
    }
    source += DNA_IUPAC[char] ?? escapeRegexChar(char);
  }
  return source;
}

export function findDegenerateMotifMatches(
  sequence: string,
  rule: SequenceMotifRule,
  sequenceType: SequenceType,
  options: number | {
    maxMatches?: number;
    searchStart?: number;
    searchEnd?: number;
  } = 5000,
): SequenceMotifMatch[] {
  if (!rule.enabled) return [];
  const maxMatches = typeof options === 'number' ? options : options.maxMatches ?? 5000;
  const searchStart = typeof options === 'number'
    ? 0
    : Math.min(sequence.length, Math.max(0, Math.floor(options.searchStart ?? 0)));
  const searchEnd = typeof options === 'number'
    ? sequence.length
    : Math.min(sequence.length, Math.max(searchStart, Math.floor(options.searchEnd ?? sequence.length)));
  if (searchEnd <= searchStart) return [];

  const alphabet = alphabetForRule(rule, sequenceType);
  const source = iupacPatternToRegexSource(rule.pattern, alphabet);
  if (!source) return [];
  const matches: SequenceMotifMatch[] = [];
  const regex = new RegExp(`(?=(${source}))`, 'gi');
  const normalizedSequence = sequence.slice(searchStart, searchEnd).toUpperCase();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalizedSequence)) && matches.length < maxMatches) {
    const matched = match[1] ?? '';
    if (matched.length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    const absoluteStart = searchStart + match.index;
    matches.push({
      ruleId: rule.id,
      start: absoluteStart,
      end: absoluteStart + matched.length,
      matched,
    });
    regex.lastIndex = match.index + 1;
  }
  return matches;
}

export function buildSequenceStyleHitMap({
  formatting,
  highlights = [],
  sequence,
  sequenceType,
  lineStart = 0,
  lineEnd = sequence.length,
}: {
  formatting?: SequenceFormatting | null;
  highlights?: SequenceHighlight[];
  sequence: string;
  sequenceType: SequenceType;
  lineStart?: number;
  lineEnd?: number;
}): Map<number, ResolvedSequenceStyleOverlay> {
  const normalized = normalizedSequenceFormattingForHitMap(formatting);
  const start = Math.max(0, lineStart);
  const end = Math.min(sequence.length, Math.max(start, lineEnd));
  const scratch = new Map<number, OverlayScratch>();
  if (end <= start) return new Map();

  for (const rule of normalized.motifRules) {
    if (!rule.enabled || Object.keys(rule.style).length === 0) continue;
    // A PROSITE pattern's text is far longer than its match (e.g. `x(8)` is 4
    // chars but matches 8 residues), so use the real max match length for the
    // line-window overlap or boundary-straddling hits would be dropped.
    const motifLength = isPrositePattern(rule.pattern)
      ? prositeMaxMatchLength(rule.pattern)
      : rule.pattern.toUpperCase().replace(/\s+/g, '').length;
    const overlap = Math.max(0, motifLength - 1);
    const matches = findDegenerateMotifMatches(sequence, rule, sequenceType, {
      searchStart: Math.max(0, start - overlap),
      searchEnd: Math.min(sequence.length, end + overlap),
    });
    for (const match of matches) {
      const matchStart = Math.max(start, match.start);
      const matchEnd = Math.min(end, match.end);
      if (matchEnd <= matchStart) continue;
      applyStyleRange(scratch, matchStart, matchEnd, rule.style, {
        id: rule.id,
        priority: MOTIF_STYLE_PRIORITY,
        createdAt: rule.updatedAt ?? rule.createdAt,
        label: `Motif ${rule.name}: ${match.matched}`,
      });
    }
  }

  for (const range of normalized.ranges) {
    const rangeStart = Math.max(start, range.start);
    const rangeEnd = Math.min(end, range.end);
    if (rangeEnd <= rangeStart) continue;
    applyStyleRange(scratch, rangeStart, rangeEnd, range.style, {
      id: range.id,
      priority: MANUAL_STYLE_PRIORITY,
      createdAt: range.createdAt,
      label: range.name ? `${range.name} ${range.start + 1}-${range.end}` : undefined,
    });
  }

  for (const highlight of normalizedSequenceHighlightsForHitMap(highlights)) {
    const highlightStart = Math.max(start, highlight.start);
    const highlightEnd = Math.min(end, highlight.end);
    if (highlightEnd <= highlightStart) continue;
    applyStyleRange(scratch, highlightStart, highlightEnd, { backgroundColor: highlight.color }, {
      id: highlight.id,
      priority: MANUAL_STYLE_PRIORITY,
      createdAt: highlight.createdAt,
      label: sequenceHighlightTitle(highlight),
    });
  }

  for (const mark of normalized.layoutMarks) {
    if (mark.position < start || mark.position >= end) continue;
    getScratch(scratch, mark.position).layoutMarks.push(mark);
  }

  const resolved = new Map<number, ResolvedSequenceStyleOverlay>();
  for (const [position, entry] of scratch) {
    resolved.set(position, {
      backgroundColor: entry.backgroundColor?.value as string | null | undefined,
      color: entry.color?.value as string | null | undefined,
      bold: entry.bold?.value as boolean | null | undefined,
      italic: entry.italic?.value as boolean | null | undefined,
      underline: entry.underline?.value as boolean | null | undefined,
      fontSize: entry.fontSize?.value as number | null | undefined,
      fontFamily: entry.fontFamily?.value as string | null | undefined,
      titleParts: Array.from(entry.titleParts),
      layoutMarks: [...entry.layoutMarks].sort((left, right) => (
        left.position - right.position || left.createdAt - right.createdAt || left.id.localeCompare(right.id)
      )),
    });
  }
  return resolved;
}

export function resolveSequenceStyleAtPosition(args: {
  formatting?: SequenceFormatting | null;
  highlights?: SequenceHighlight[];
  sequence: string;
  sequenceType: SequenceType;
  position: number;
}): ResolvedSequenceStyleOverlay | null {
  const hit = buildSequenceStyleHitMap({
    ...args,
    lineStart: args.position,
    lineEnd: args.position + 1,
  }).get(args.position);
  if (hit) return hit;
  const highlight = sequenceHighlightAtPosition(args.highlights ?? [], args.position);
  if (!highlight) return null;
  return {
    backgroundColor: highlight.color,
    titleParts: [sequenceHighlightTitle(highlight)],
    layoutMarks: [],
  };
}

export function hasVisibleSequenceStyleOverlay(overlay: ResolvedSequenceStyleOverlay | undefined): boolean {
  if (!overlay) return false;
  return Boolean(
    overlay.backgroundColor !== undefined
      || overlay.color !== undefined
      || overlay.bold !== undefined
      || overlay.italic !== undefined
      || overlay.underline !== undefined
      || overlay.fontSize !== undefined
      || overlay.fontFamily !== undefined
      || overlay.layoutMarks.length > 0,
  );
}

export function shiftSequenceFormattingForRange(
  formatting: SequenceFormatting | null | undefined,
  start: number,
  end: number,
): SequenceFormatting {
  const normalized = normalizeSequenceFormatting(formatting);
  return {
    ranges: normalized.ranges
      .filter((range) => range.start < end && range.end > start)
      .map((range) => ({
        ...range,
        id: randomId('style-range'),
        start: Math.max(0, range.start - start),
        end: Math.min(end - start, range.end - start),
        createdAt: nextSequenceFormattingCreatedAt(),
      }))
      .filter((range) => range.end > range.start),
    layoutMarks: normalized.layoutMarks
      .filter((mark) => mark.position >= start && mark.position < end)
      .map((mark) => ({
        ...mark,
        id: randomId('layout-mark'),
        position: mark.position - start,
        createdAt: nextSequenceFormattingCreatedAt(),
      })),
    motifRules: deepClone(normalized.motifRules),
  };
}

export function shiftSequenceFormattingForInsertion(
  formatting: SequenceFormatting | null | undefined,
  editPos: number,
  delta: number,
): SequenceFormatting {
  const normalized = normalizeSequenceFormatting(formatting);
  if (delta <= 0) return normalized;
  return {
    ranges: normalized.ranges.map((range) => ({
      ...range,
      start: range.start > editPos ? range.start + delta : range.start,
      end: range.end > editPos ? range.end + delta : range.end,
    })),
    layoutMarks: normalized.layoutMarks.map((mark) => ({
      ...mark,
      position: mark.position >= editPos ? mark.position + delta : mark.position,
    })),
    motifRules: deepClone(normalized.motifRules),
  };
}

export function shiftSequenceFormattingForDeletion(
  formatting: SequenceFormatting | null | undefined,
  pos: number,
  count: number,
  rawLength: number,
): SequenceFormatting {
  const normalized = normalizeSequenceFormatting(formatting);
  if (count <= 0 || pos < 0 || pos >= rawLength) return normalized;
  const effectiveCount = Math.min(count, rawLength - pos);
  const endOfDeletion = pos + effectiveCount;
  return {
    ranges: normalized.ranges
      .map((range) => {
        let nextStart = range.start;
        let nextEnd = range.end;
        if (range.start >= endOfDeletion) {
          nextStart = range.start - effectiveCount;
        } else if (range.start > pos) {
          nextStart = pos;
        }
        if (range.end >= endOfDeletion) {
          nextEnd = range.end - effectiveCount;
        } else if (range.end > pos) {
          nextEnd = pos;
        }
        return { ...range, start: nextStart, end: nextEnd };
      })
      .filter((range) => range.end > range.start),
    layoutMarks: normalized.layoutMarks
      .filter((mark) => mark.position < pos || mark.position >= endOfDeletion)
      .map((mark) => ({
        ...mark,
        position: mark.position >= endOfDeletion ? mark.position - effectiveCount : mark.position,
      })),
    motifRules: deepClone(normalized.motifRules),
  };
}

export function clearSequenceStyleRangesInRange(
  formatting: SequenceFormatting | null | undefined,
  start: number,
  end: number,
): SequenceFormatting {
  const normalized = normalizeSequenceFormatting(formatting);
  const rangeStart = Math.max(0, Math.min(start, end));
  const rangeEnd = Math.max(rangeStart, Math.max(start, end));
  if (rangeEnd <= rangeStart) return normalized;

  const nextRanges: SequenceStyleRange[] = [];
  for (const range of normalized.ranges) {
    if (range.end <= rangeStart || range.start >= rangeEnd) {
      nextRanges.push(range);
      continue;
    }
    if (range.start < rangeStart) {
      nextRanges.push({
        ...range,
        id: randomId('style-range'),
        end: rangeStart,
        createdAt: Date.now(),
      });
    }
    if (range.end > rangeEnd) {
      nextRanges.push({
        ...range,
        id: randomId('style-range'),
        start: rangeEnd,
        createdAt: Date.now(),
      });
    }
  }

  return {
    ...normalized,
    ranges: nextRanges.filter((range) => range.end > range.start),
  };
}

export function removeFormattingItem(
  formatting: SequenceFormatting | null | undefined,
  id: string,
): SequenceFormatting {
  const normalized = normalizeSequenceFormatting(formatting);
  return {
    ranges: normalized.ranges.filter((range) => range.id !== id),
    layoutMarks: normalized.layoutMarks.filter((mark) => mark.id !== id),
    motifRules: normalized.motifRules.filter((rule) => rule.id !== id),
  };
}
