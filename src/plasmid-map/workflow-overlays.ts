/**
 * Pure adapters from workflow result shapes into map range overlays.
 *
 * These functions deliberately return the same serializable range-overlay
 * contract used by saved annotations. Workflow dialogs can pass their computed
 * objects in without moving coordinate math into React renderers.
 */
import type { DiffOp, DiffSegment } from '../bio/sequence-diff';
import type { DigestFragment } from '../bio/restriction-digest';
import type { PCRResult } from '../bio/pcr';
import type { PrimerCandidate } from '../bio/primer-design';
import type { Topology } from '../bio/types';
import type { MapRangeOverlayInput, MapRangeOverlayKind, MapRangeOverlayVariant } from './range-overlays';
import type { SelectionRange } from './selection-overlay';

export type WorkflowOverlayKind =
  | 'restriction_digest'
  | 'primer_design'
  | 'pcr'
  | 'gibson'
  | 'golden_gate'
  | 'ligation'
  | 'sequence_compare';

export type WorkflowOverlayRole =
  | 'recognition_site'
  | 'cut_site'
  | 'fragment'
  | 'primer_binding'
  | 'amplicon'
  | 'part_span'
  | 'insert'
  | 'overlap'
  | 'junction'
  | 'linker'
  | 'tail_anchor'
  | 'match'
  | 'mismatch'
  | 'insertion'
  | 'deletion';

export interface WorkflowRangeRef {
  /** 0-indexed, half-open coordinate in either source or product space. */
  start: number;
  /** May exceed sequenceLength for circular raw source spans that cross origin. */
  end: number;
  strand?: 1 | -1 | 0;
  topology: Topology;
  sequenceLength: number;
  wrapsOrigin?: boolean;
}

export interface WorkflowMapOverlayDTO {
  id: string;
  workflow: WorkflowOverlayKind;
  role: WorkflowOverlayRole;
  label: string;
  space: 'source' | 'product';
  ranges: readonly WorkflowRangeRef[];
  blockId?: string;
  blockName?: string;
  productName?: string;
  orderIndex?: number;
  enzyme?: string;
  recognitionSequence?: string;
  cutPosition?: number;
  overhang5?: string;
  overhang3?: string;
  overhangType?: 'blunt' | '5prime' | '3prime';
  primerDirection?: 'forward' | 'reverse';
  primerSequence?: string;
  primerFullSequence?: string;
  primerTail?: string;
  tm?: number | null;
  gcPercent?: number;
  junctionType?: 'overlap' | 'sticky' | 'blunt' | 'incompatible';
  compatible?: boolean;
  closing?: boolean;
  lengthBp?: number;
  warnings?: readonly string[];
  color?: string;
}

export interface CompareOverlaySequenceRef {
  blockId: string;
  name: string;
  type: string;
  length: number;
}

export interface CompareOverlayProjection {
  blockId: string;
  role: 'reference' | 'query';
  ranges: readonly SelectionRange[];
  anchorOnly: boolean;
  primaryRange: SelectionRange | null;
  focusedRanges: readonly SelectionRange[] | null;
}

export interface CompareOverlayItemDto {
  id: string;
  segmentIndex: number;
  op: DiffOp;
  alignmentStart: number;
  alignmentEnd: number;
  referenceRange: SelectionRange | null;
  queryRange: SelectionRange | null;
  referenceAnchor: number;
  queryAnchor: number;
  referenceText: string;
  queryText: string;
  projection: CompareOverlayProjection;
  label: string;
  color?: string;
}

export interface CompareOverlaySetDto {
  schemaVersion: 1;
  id: string;
  engine: 'motif-sequence-diff';
  algorithm: 'needleman-wunsch' | 'simple';
  reference: CompareOverlaySequenceRef;
  query: CompareOverlaySequenceRef;
  projectionBlockId: string;
  projectionRole: 'reference' | 'query';
  summary: {
    identity: number;
    mismatches: number;
    insertions: number;
    deletions: number;
    alignedLength: number;
    segmentCount: number;
    warnings?: readonly string[];
  };
  items: readonly CompareOverlayItemDto[];
}

export const MAP_DIGEST_OVERLAY_COLOR = '#7c3aed';
export const MAP_DESIGN_OVERLAY_COLORS = {
  amplicon: '#0e7490',
  'primer-forward': '#15803d',
  'primer-reverse': '#6d5bd0',
} as const satisfies Record<'amplicon' | 'primer-forward' | 'primer-reverse', string>;
export const MAP_COMPARE_OVERLAY_COLORS = {
  match: '#64748b',
  mismatch: '#be185d',
  insertion: '#047857',
  deletion: '#dc2626',
} as const satisfies Record<DiffOp, string>;

function finiteInt(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.floor(value);
}

function finiteWorkflowRange(start: number, end: number, length: number): SelectionRange | null {
  if (!Number.isFinite(length) || length <= 0) return null;
  const s = finiteInt(start);
  const e = finiteInt(end);
  if (s === null || e === null || e <= s) return null;
  return { start: s, end: e };
}

function oneUnitAnchor(position: number, length: number): SelectionRange | null {
  if (!Number.isFinite(length) || length <= 0) return null;
  const raw = finiteInt(position);
  if (raw === null) return null;
  const start = Math.max(0, Math.min(Math.max(0, length - 1), raw));
  return { start, end: Math.min(length, start + 1) };
}

function ntLabel(value: number): string {
  return `${Math.max(0, Math.floor(value))} nt`;
}

function tmLabel(tm: number | null | undefined): string {
  return typeof tm === 'number' && Number.isFinite(tm) ? `${tm.toFixed(1)} C` : 'Tm n/a';
}

function enzymeEndLabel(left: string | null | undefined, right: string | null | undefined): string {
  if (left && right) return `${left} to ${right}`;
  if (left) return `${left} to linear end`;
  if (right) return `linear end to ${right}`;
  return 'uncut molecule';
}

function mapKindForWorkflow(workflow: WorkflowOverlayKind): Extract<MapRangeOverlayKind, 'digest' | 'design' | 'compare'> {
  if (workflow === 'restriction_digest') return 'digest';
  if (workflow === 'sequence_compare') return 'compare';
  return 'design';
}

function variantForWorkflowOverlay(dto: WorkflowMapOverlayDTO): MapRangeOverlayVariant | undefined {
  if (dto.role === 'fragment') return 'fragment';
  if (dto.role === 'amplicon') return 'amplicon';
  if (dto.role === 'primer_binding') {
    return dto.primerDirection === 'reverse' ? 'primer-reverse' : 'primer-forward';
  }
  if (dto.role === 'match' || dto.role === 'mismatch' || dto.role === 'insertion' || dto.role === 'deletion') {
    return dto.role;
  }
  return undefined;
}

function colorForWorkflowOverlay(dto: WorkflowMapOverlayDTO): string {
  if (dto.color?.trim()) return dto.color.trim();
  const variant = variantForWorkflowOverlay(dto);
  if (dto.workflow === 'restriction_digest') return MAP_DIGEST_OVERLAY_COLOR;
  if (dto.workflow === 'sequence_compare') {
    if (variant === 'match' || variant === 'mismatch' || variant === 'insertion' || variant === 'deletion') {
      return MAP_COMPARE_OVERLAY_COLORS[variant];
    }
    return MAP_COMPARE_OVERLAY_COLORS.mismatch;
  }
  if (variant === 'primer-forward' || variant === 'primer-reverse' || variant === 'amplicon') {
    return MAP_DESIGN_OVERLAY_COLORS[variant];
  }
  return MAP_DESIGN_OVERLAY_COLORS.amplicon;
}

function isAnchorRole(role: WorkflowOverlayRole): boolean {
  return role === 'cut_site' || role === 'recognition_site' || role === 'tail_anchor' || role === 'junction' || role === 'insertion';
}

function workflowRangeToMapRange(range: WorkflowRangeRef, role: WorkflowOverlayRole): SelectionRange | null {
  if (!Number.isFinite(range.sequenceLength) || range.sequenceLength <= 0) return null;
  if (range.end > range.start) return finiteWorkflowRange(range.start, range.end, range.sequenceLength);
  if (isAnchorRole(role)) return oneUnitAnchor(range.start, range.sequenceLength);
  if (range.topology === 'circular' && range.end !== range.start) {
    return finiteWorkflowRange(range.start, range.end + range.sequenceLength, range.sequenceLength);
  }
  return null;
}

export function workflowOverlayToMapRangeInput(dto: WorkflowMapOverlayDTO): MapRangeOverlayInput | null {
  if (!dto.id.trim() || !dto.label.trim()) return null;
  const ranges = dto.ranges
    .map((range) => workflowRangeToMapRange(range, dto.role))
    .filter((range): range is SelectionRange => Boolean(range));
  if (ranges.length === 0) return null;
  return {
    id: `${mapKindForWorkflow(dto.workflow)}:${dto.id}`,
    objectId: dto.id,
    kind: mapKindForWorkflow(dto.workflow),
    variant: variantForWorkflowOverlay(dto),
    label: dto.label,
    color: colorForWorkflowOverlay(dto),
    ranges,
  };
}

export function workflowOverlaysToMapRangeInputs(dtos: readonly WorkflowMapOverlayDTO[]): MapRangeOverlayInput[] {
  return dtos
    .map(workflowOverlayToMapRangeInput)
    .filter((input): input is MapRangeOverlayInput => Boolean(input));
}

export function compareOverlaySetToMapRangeInputs(set: CompareOverlaySetDto): MapRangeOverlayInput[] {
  return set.items
    .flatMap((item): MapRangeOverlayInput[] => {
      const ranges = item.projection.ranges.filter((range) =>
        Number.isFinite(range.start)
        && Number.isFinite(range.end)
        && range.end > range.start,
      );
      if (ranges.length === 0) return [];
      return [{
        id: `compare:${item.id}`,
        objectId: item.id,
        kind: 'compare' as const,
        variant: item.op,
        label: item.label,
        color: item.color?.trim() || MAP_COMPARE_OVERLAY_COLORS[item.op],
        ranges,
      }];
    });
}

export function digestFragmentRangeOverlayInput(
  fragment: Pick<DigestFragment, 'startInOriginal' | 'endInOriginal' | 'length' | 'leftEnzyme' | 'rightEnzyme'>,
  index: number,
  sequenceLength: number,
): MapRangeOverlayInput | null {
  const range = finiteWorkflowRange(fragment.startInOriginal, fragment.endInOriginal, sequenceLength);
  if (!range) return null;
  const id = `digest:fragment:${index}:${range.start}:${range.end}`;
  return {
    id,
    objectId: id,
    kind: 'digest',
    variant: 'fragment',
    label: `Digest fragment ${index + 1} (${enzymeEndLabel(fragment.leftEnzyme, fragment.rightEnzyme)}, ${fragment.length} bp)`,
    color: MAP_DIGEST_OVERLAY_COLOR,
    ranges: [range],
  };
}

export function digestFragmentRangeOverlayInputs(
  fragments: readonly Pick<DigestFragment, 'startInOriginal' | 'endInOriginal' | 'length' | 'leftEnzyme' | 'rightEnzyme'>[],
  sequenceLength: number,
): MapRangeOverlayInput[] {
  return fragments
    .map((fragment, index) => digestFragmentRangeOverlayInput(fragment, index, sequenceLength))
    .filter((input): input is MapRangeOverlayInput => Boolean(input));
}

export function primerCandidateRangeOverlayInput(
  candidate: Pick<PrimerCandidate, 'direction' | 'start' | 'end' | 'length'> & { tm?: number | null },
  index: number,
  sequenceLength: number,
): MapRangeOverlayInput | null {
  const range = finiteWorkflowRange(candidate.start, candidate.end, sequenceLength);
  if (!range) return null;
  const variant: Extract<MapRangeOverlayVariant, 'primer-forward' | 'primer-reverse'> =
    candidate.direction === 'reverse' ? 'primer-reverse' : 'primer-forward';
  const labelDirection = candidate.direction === 'reverse' ? 'Reverse' : 'Forward';
  const id = `design:primer:${candidate.direction}:${range.start}:${range.end}:${index}`;
  return {
    id,
    objectId: id,
    kind: 'design',
    variant,
    label: `${labelDirection} primer ${candidate.length} nt (${tmLabel(candidate.tm)})`,
    color: MAP_DESIGN_OVERLAY_COLORS[variant],
    ranges: [range],
  };
}

export function primerCandidateRangeOverlayInputs(
  candidates: readonly Pick<PrimerCandidate, 'direction' | 'start' | 'end' | 'length' | 'tm'>[],
  sequenceLength: number,
): MapRangeOverlayInput[] {
  return candidates
    .map((candidate, index) => primerCandidateRangeOverlayInput(candidate, index, sequenceLength))
    .filter((input): input is MapRangeOverlayInput => Boolean(input));
}

export function pcrResultRangeOverlayInputs(
  result: Pick<PCRResult, 'productLength' | 'forward' | 'reverse'>,
  sequenceLength: number,
  topology: Topology,
): MapRangeOverlayInput[] {
  const inputs: MapRangeOverlayInput[] = [];
  const fwd = primerCandidateRangeOverlayInput({
    direction: 'forward',
    start: result.forward.bindStart,
    end: result.forward.bindEnd,
    length: result.forward.bindEnd - result.forward.bindStart,
    tm: result.forward.tm,
  }, 0, sequenceLength);
  if (fwd) {
    const id = `design:pcr:forward:${result.forward.bindStart}:${result.forward.bindEnd}`;
    inputs.push({ ...fwd, id, objectId: id });
  }

  const rev = primerCandidateRangeOverlayInput({
    direction: 'reverse',
    start: result.reverse.bindStart,
    end: result.reverse.bindEnd,
    length: result.reverse.bindEnd - result.reverse.bindStart,
    tm: result.reverse.tm,
  }, 1, sequenceLength);
  if (rev) {
    const id = `design:pcr:reverse:${result.reverse.bindStart}:${result.reverse.bindEnd}`;
    inputs.push({ ...rev, id, objectId: id });
  }

  const ampliconEnd = topology === 'circular' && result.reverse.bindEnd <= result.forward.bindStart
    ? result.reverse.bindEnd + sequenceLength
    : result.reverse.bindEnd;
  const ampliconRange = finiteWorkflowRange(result.forward.bindStart, ampliconEnd, sequenceLength);
  if (ampliconRange) {
    const id = `design:amplicon:${ampliconRange.start}:${ampliconRange.end}`;
    inputs.push({
      id,
      objectId: id,
      kind: 'design',
      variant: 'amplicon',
      label: `PCR amplicon ${ntLabel(result.productLength)}`,
      color: MAP_DESIGN_OVERLAY_COLORS.amplicon,
      ranges: [ampliconRange],
    });
  }

  return inputs;
}

function nongapLength(text: string): number {
  return text.replace(/-/g, '').length;
}

function compareSegmentRange(segment: DiffSegment, target: 'seq1' | 'seq2', sequenceLength: number): SelectionRange | null {
  const start = target === 'seq1' ? segment.seq1Start : segment.seq2Start;
  const text = target === 'seq1' ? segment.seq1Text : segment.seq2Text;
  const span = nongapLength(text);
  if (span > 0) return finiteWorkflowRange(start, start + span, sequenceLength);
  return oneUnitAnchor(start, sequenceLength);
}

export function compareDiffSegmentRangeOverlayInput(
  segment: DiffSegment,
  index: number,
  sequenceLength: number,
  options: { target?: 'seq1' | 'seq2'; includeMatches?: boolean } = {},
): MapRangeOverlayInput | null {
  const target = options.target ?? 'seq1';
  if (segment.op === 'match' && !options.includeMatches) return null;
  const range = compareSegmentRange(segment, target, sequenceLength);
  if (!range) return null;
  const id = `compare:${target}:${segment.op}:${index}:${range.start}:${range.end}`;
  return {
    id,
    objectId: id,
    kind: 'compare',
    variant: segment.op,
    label: `Compare ${segment.op} ${index + 1}`,
    color: MAP_COMPARE_OVERLAY_COLORS[segment.op],
    ranges: [range],
  };
}

export function compareDiffSegmentRangeOverlayInputs(
  segments: readonly DiffSegment[],
  sequenceLength: number,
  options: { target?: 'seq1' | 'seq2'; includeMatches?: boolean } = {},
): MapRangeOverlayInput[] {
  return segments
    .map((segment, index) => compareDiffSegmentRangeOverlayInput(segment, index, sequenceLength, options))
    .filter((input): input is MapRangeOverlayInput => Boolean(input));
}
