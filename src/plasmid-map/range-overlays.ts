/**
 * Pure projected range overlays for biological map layers that are already
 * expressed as durable sequence ranges (saved highlights first; comments/scars
 * can follow this contract without adding renderer-local coordinate math).
 */
import type { MutationScar, ORF } from '../bio/types';
import type { SequenceVariant, SequenceVariantKind } from '../bio/sequence-variants';
import { sequenceVariantLabel } from '../bio/sequence-variants';
import type { SequenceMotifRule } from '../bio/sequence-formatting';
import { findDegenerateMotifMatches } from '../bio/sequence-formatting';
import { isPrositePattern, prositeMaxMatchLength } from '../bio/prosite';
import type { MapLayout } from './types';
import { normalizeSpan } from './geometry/ranges';
import { selectionOverlayPaths, type SelectionRange } from './selection-overlay';

export type MapRangeOverlayKind =
  | 'highlight'
  | 'comment'
  | 'scar'
  | 'orf'
  | 'motif'
  | 'variant'
  | 'digest'
  | 'design'
  | 'compare';
export type MapRangeOverlayVariant =
  | MutationScar['type']
  | SequenceVariantKind
  | 'forward'
  | 'reverse'
  | 'dna'
  | 'rna'
  | 'protein'
  | 'fragment'
  | 'amplicon'
  | 'primer-forward'
  | 'primer-reverse'
  | 'match'
  | 'mismatch';

export const MAP_COMMENT_OVERLAY_COLOR = '#2563eb';
export const MAP_SCAR_OVERLAY_COLORS = {
  substitution: '#d97706',
  insertion: '#15803d',
  deletion: '#dc2626',
} as const satisfies Record<MutationScar['type'], string>;
export const MAP_ORF_OVERLAY_COLORS = {
  forward: '#0f766e',
  reverse: '#6d5bd0',
} as const satisfies Record<'forward' | 'reverse', string>;
export const MAP_MOTIF_OVERLAY_COLOR = '#0e7490';
export const MAP_MOTIF_OVERLAY_MAX_RULES = 12;
export const MAP_MOTIF_OVERLAY_MAX_MATCHES_PER_RULE = 250;
export const MAP_MOTIF_OVERLAY_MAX_TOTAL_MATCHES = 800;
export const MAP_VARIANT_OVERLAY_COLORS = {
  substitution: '#be185d',
  insertion: '#047857',
  deletion: '#dc2626',
  indel: '#b45309',
  other: '#475569',
} as const satisfies Record<SequenceVariantKind, string>;

export interface MapRangeOverlayInput {
  id: string;
  objectId?: string;
  kind: MapRangeOverlayKind;
  variant?: MapRangeOverlayVariant;
  label: string;
  color: string;
  ranges: readonly SelectionRange[];
}

export interface MapRangeOverlayRender {
  id: string;
  objectId?: string;
  kind: MapRangeOverlayKind;
  variant?: MapRangeOverlayVariant;
  label: string;
  color: string;
  paths: readonly string[];
  primaryRange: SelectionRange | null;
  focusedRanges: readonly SelectionRange[] | null;
  title: string;
}

export interface MapCommentRangeSource {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface MapMotifRangeOverlayInputOptions {
  maxRules?: number;
  maxMatchesPerRule?: number;
  maxTotalMatches?: number;
}

function finiteRange(range: SelectionRange): boolean {
  return Number.isFinite(range.start) && Number.isFinite(range.end) && range.end !== range.start;
}

function overlayColor(color: string): string {
  return color.trim() || '#e0b83c';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteInt(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.floor(value);
}

function oneUnitAnchor(position: number, length: number): SelectionRange | null {
  if (!Number.isFinite(length) || length <= 0) return null;
  const raw = finiteInt(position);
  if (raw === null) return null;
  const start = clamp(raw, 0, Math.max(0, length - 1));
  return { start, end: Math.min(length, start + 1) };
}

function shortLabel(value: string, fallback: string): string {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return fallback;
  return firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine;
}

function motifAlphabet(rule: Pick<SequenceMotifRule, 'alphabet'>, sequenceType: 'dna' | 'rna' | 'protein'): 'dna' | 'rna' | 'protein' {
  if (rule.alphabet === 'dna' || rule.alphabet === 'rna' || rule.alphabet === 'protein') return rule.alphabet;
  return sequenceType === 'protein' ? 'protein' : sequenceType === 'rna' ? 'rna' : 'dna';
}

function motifColor(rule: Pick<SequenceMotifRule, 'style'>): string {
  const color = rule.style.backgroundColor || rule.style.color || MAP_MOTIF_OVERLAY_COLOR;
  return overlayColor(color);
}

function motifMaxLength(rule: Pick<SequenceMotifRule, 'pattern'>): number {
  const clean = rule.pattern.replace(/\s+/g, '');
  if (!clean) return 0;
  return isPrositePattern(clean) ? prositeMaxMatchLength(clean) : clean.length;
}

function hasTerminalAnchor(rule: Pick<SequenceMotifRule, 'pattern'>): boolean {
  const clean = rule.pattern.replace(/\s+/g, '');
  return isPrositePattern(clean) && (clean.startsWith('<') || clean.endsWith('>'));
}

export function commentOverlayRange(comment: Pick<MapCommentRangeSource, 'start' | 'end'>, length: number): SelectionRange | null {
  if (!Number.isFinite(length) || length <= 0) return null;
  const rawStart = finiteInt(comment.start);
  const rawEnd = finiteInt(comment.end);
  if (rawStart === null || rawEnd === null) return null;
  const start = clamp(rawStart, 0, length);
  const end = clamp(rawEnd, 0, length);
  if (end > start) return { start, end };
  return oneUnitAnchor(start, length);
}

export function scarOverlayRange(scar: Pick<MutationScar, 'position'>, length: number): SelectionRange | null {
  return oneUnitAnchor(scar.position, length);
}

export function variantOverlayRange(
  variant: Pick<SequenceVariant, 'start' | 'end' | 'kind'>,
  length: number,
): SelectionRange | null {
  if (!Number.isFinite(length) || length <= 0) return null;
  const rawStart = finiteInt(variant.start);
  if (rawStart === null) return null;
  if (variant.kind === 'insertion') return oneUnitAnchor(rawStart, length);
  const rawEnd = typeof variant.end === 'number' ? finiteInt(variant.end) : null;
  if (rawEnd === null) return oneUnitAnchor(rawStart, length);
  if (rawEnd > rawStart) return { start: rawStart, end: rawEnd };
  return oneUnitAnchor(rawStart, length);
}

export function commentRangeOverlayInput(
  comment: MapCommentRangeSource,
  length: number,
): MapRangeOverlayInput | null {
  const range = commentOverlayRange(comment, length);
  if (!range) return null;
  return {
    id: `comment:${comment.id}`,
    objectId: comment.id,
    kind: 'comment',
    label: shortLabel(comment.text, 'Comment'),
    color: MAP_COMMENT_OVERLAY_COLOR,
    ranges: [range],
  };
}

export function scarRangeOverlayInput(
  scar: MutationScar,
  length: number,
  sequence = '',
): MapRangeOverlayInput | null {
  const range = scarOverlayRange(scar, length);
  if (!range) return null;
  const pos = Math.max(0, scar.position) + 1;
  const label = (() => {
    switch (scar.type) {
      case 'substitution':
        return `Substitution ${scar.original ?? '?'}->${sequence[scar.position] ?? '?'}`;
      case 'insertion':
        return `Insertion ${scar.inserted ?? ''}`.trim();
      case 'deletion':
        return `Deletion ${scar.original ?? ''}`.trim();
      default:
        return 'Edit scar';
    }
  })();
  return {
    id: `scar:${scar.id}`,
    objectId: scar.id,
    kind: 'scar',
    variant: scar.type,
    label: `${label} at ${pos}`,
    color: MAP_SCAR_OVERLAY_COLORS[scar.type],
    ranges: [range],
  };
}

export function variantRangeOverlayInput(
  variant: SequenceVariant,
  length: number,
): MapRangeOverlayInput | null {
  const range = variantOverlayRange(variant, length);
  if (!range) return null;
  return {
    id: `variant:${variant.id}`,
    objectId: variant.id,
    kind: 'variant',
    variant: variant.kind,
    label: sequenceVariantLabel(variant),
    color: overlayColor(variant.color ?? MAP_VARIANT_OVERLAY_COLORS[variant.kind]),
    ranges: [range],
  };
}

export function orfOverlayRanges(orf: Pick<ORF, 'start' | 'end'>, length: number): SelectionRange[] {
  return normalizeSpan(orf.start, orf.end, length, 'circular');
}

export function orfRangeOverlayInput(
  orf: ORF,
  index: number,
  length: number,
): MapRangeOverlayInput | null {
  const ranges = orfOverlayRanges(orf, length);
  if (ranges.length === 0) return null;
  const direction = orf.strand === 1 ? 'forward' : 'reverse';
  const strandLabel = orf.strand === 1 ? '+' : '-';
  const id = `orf:${strandLabel}${orf.frame}:${orf.start}:${orf.end}:${index}`;
  return {
    id,
    objectId: id,
    kind: 'orf',
    variant: direction,
    label: `ORF ${strandLabel}${orf.frame} ${orf.aminoAcids} aa`,
    color: MAP_ORF_OVERLAY_COLORS[direction],
    ranges,
  };
}

export function motifRangeOverlayInputs(
  args: {
    sequence: string;
    sequenceType: 'dna' | 'rna' | 'protein';
    topology: 'linear' | 'circular';
    rules: readonly SequenceMotifRule[];
  },
  options: MapMotifRangeOverlayInputOptions = {},
): MapRangeOverlayInput[] {
  const length = args.sequence.length;
  if (!Number.isFinite(length) || length <= 0) return [];
  const maxRules = Math.max(0, Math.floor(options.maxRules ?? MAP_MOTIF_OVERLAY_MAX_RULES));
  const maxMatchesPerRule = Math.max(0, Math.floor(options.maxMatchesPerRule ?? MAP_MOTIF_OVERLAY_MAX_MATCHES_PER_RULE));
  const maxTotalMatches = Math.max(0, Math.floor(options.maxTotalMatches ?? MAP_MOTIF_OVERLAY_MAX_TOTAL_MATCHES));
  if (maxRules === 0 || maxMatchesPerRule === 0 || maxTotalMatches === 0) return [];

  const overlays: MapRangeOverlayInput[] = [];
  let totalMatches = 0;
  let scannedRules = 0;
  for (const rule of args.rules) {
    if (!rule.enabled || !rule.pattern.trim()) continue;
    if (scannedRules >= maxRules || totalMatches >= maxTotalMatches) break;
    scannedRules += 1;
    const remaining = Math.min(maxMatchesPerRule, maxTotalMatches - totalMatches);
    const maxLength = motifMaxLength(rule);
    const circularOverlap = args.topology === 'circular' && args.sequenceType !== 'protein' && !hasTerminalAnchor(rule)
      ? Math.min(Math.max(0, maxLength - 1), Math.max(0, length - 1))
      : 0;
    const matchSequence = circularOverlap > 0
      ? `${args.sequence}${args.sequence.slice(0, circularOverlap)}`
      : args.sequence;
    const matches = findDegenerateMotifMatches(matchSequence, rule, args.sequenceType, remaining);
    if (matches.length === 0) continue;
    const ranges = matches
      .filter((match) => match.start < length)
      .flatMap((match) => normalizeSpan(match.start, match.end, length, args.topology))
      .filter(finiteRange);
    if (ranges.length === 0) continue;
    const alphabet = motifAlphabet(rule, args.sequenceType);
    overlays.push({
      id: `motif:${rule.id}`,
      objectId: rule.id,
      kind: 'motif',
      variant: alphabet,
      label: `Motif ${rule.name || rule.pattern}`,
      color: motifColor(rule),
      ranges,
    });
    totalMatches += ranges.length;
  }
  return overlays;
}

function copyRange(range: SelectionRange): SelectionRange {
  return { start: range.start, end: range.end };
}

function projectOverlayRanges(layout: MapLayout, ranges: readonly SelectionRange[]): SelectionRange[] {
  return ranges
    .filter(finiteRange)
    .flatMap((range) => normalizeSpan(range.start, range.end, layout.length, layout.topology))
    .map(copyRange);
}

export function projectRangeOverlays(
  layout: MapLayout,
  overlays: readonly MapRangeOverlayInput[],
): MapRangeOverlayRender[] {
  if (layout.length <= 0 || overlays.length === 0) return [];
  return overlays.flatMap((overlay) => {
    const ranges = projectOverlayRanges(layout, overlay.ranges);
    if (ranges.length === 0) return [];
    const paths = selectionOverlayPaths(layout, ranges);
    if (paths.length === 0) return [];
    return [{
      id: overlay.id,
      objectId: overlay.objectId,
      kind: overlay.kind,
      variant: overlay.variant,
      label: overlay.label,
      color: overlayColor(overlay.color),
      paths,
      primaryRange: copyRange(ranges[0]),
      focusedRanges: ranges.length > 1 ? ranges.map(copyRange) : null,
      title: `${overlay.label} (${overlay.kind})`,
    }];
  });
}
