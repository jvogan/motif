/**
 * Pure biological mapping workbench contract.
 *
 * This is intentionally renderer/store agnostic. The UI store can use these
 * objects as durable selection/control state, while legacy sequence renderers
 * keep consuming selectedRange/focusedRanges/selectedFeatureId until the broader
 * workbench is ready.
 */
import type { MapDisplayOptions, MapRestrictionRender, MapSpan } from './types';

export const BIO_MAP_LAYER_KINDS = [
  'features',
  'restrictions',
  'orfs',
  'motifs',
  'variants',
  'comments',
  'highlights',
  'scars',
  'digest',
  'design',
  'compare',
] as const;

export type BioMapLayerKind = typeof BIO_MAP_LAYER_KINDS[number];
export type BioMapLabelDensity = NonNullable<MapDisplayOptions['labelDensity']>;
export type BioMapSelectionSource = 'workspace' | 'map' | 'inspector' | 'sequence';

export const BIO_MAP_LABEL_DENSITIES = ['auto', 'low', 'medium', 'high'] as const satisfies readonly BioMapLabelDensity[];

export const DEFAULT_BIO_MAP_VISIBLE_LAYERS = {
  features: true,
  restrictions: true,
  orfs: true,
  motifs: true,
  variants: true,
  comments: true,
  highlights: true,
  scars: true,
  digest: false,
  design: false,
  compare: false,
} as const satisfies Record<BioMapLayerKind, boolean>;

export type WorkbenchObjectKind =
  | 'range'
  | 'feature'
  | 'restriction-site'
  | 'restriction-cluster'
  | 'orf'
  | 'motif'
  | 'variant'
  | 'comment'
  | 'highlight'
  | 'scar'
  | 'digest'
  | 'design'
  | 'compare';

export interface WorkbenchObjectRef {
  blockId: string;
  kind: WorkbenchObjectKind;
  /** Stable domain id when one exists: feature id, ORF id, comment id, etc. */
  id?: string;
  /** Parent restriction cluster for single-site restriction selections. */
  clusterId?: string;
  /** Restriction clusters carry every underlying tick id for exact reactivation. */
  tickIds?: readonly string[];
  /** Recognition-window starts or other bp anchors, always 0-indexed. */
  positions?: readonly number[];
  /** Optional display/debug hint; never used as identity. */
  label?: string;
}

export interface BioMapSelection {
  ref: WorkbenchObjectRef;
  source: BioMapSelectionSource;
  /** Single range used for caret/reveal/legacy selectedRange. */
  primaryRange: MapSpan | null;
  /** Multi-span highlight channel for joined features or restriction windows. */
  focusedRanges: readonly MapSpan[] | null;
}

export interface LegacyBioMapSelection {
  selectedFeatureId: string | null;
  selectionSource: 'workspace' | 'map' | null;
  selectedRange: MapSpan | null;
  focusedRanges: readonly MapSpan[] | null;
}

function copyRange(range: MapSpan): MapSpan {
  return { start: range.start, end: range.end };
}

function nonEmptyRanges(ranges: readonly MapSpan[] | null | undefined): readonly MapSpan[] | null {
  if (!ranges || ranges.length === 0) return null;
  return ranges.map(copyRange).filter((range) => range.end > range.start);
}

function legacySource(source: BioMapSelectionSource): 'workspace' | 'map' {
  return source === 'map' ? 'map' : 'workspace';
}

export function isBioMapLayerKind(value: string): value is BioMapLayerKind {
  return (BIO_MAP_LAYER_KINDS as readonly string[]).includes(value);
}

export function isBioMapLabelDensity(value: string): value is BioMapLabelDensity {
  return (BIO_MAP_LABEL_DENSITIES as readonly string[]).includes(value);
}

export function normalizeBioMapSelection(selection: BioMapSelection | null): BioMapSelection | null {
  if (!selection) return null;
  return {
    ref: {
      ...selection.ref,
      tickIds: selection.ref.tickIds ? [...selection.ref.tickIds] : undefined,
      positions: selection.ref.positions ? [...selection.ref.positions] : undefined,
    },
    source: selection.source,
    primaryRange: selection.primaryRange ? copyRange(selection.primaryRange) : null,
    focusedRanges: nonEmptyRanges(selection.focusedRanges),
  };
}

export function legacySelectionForBioMapSelection(selection: BioMapSelection | null): LegacyBioMapSelection {
  if (!selection) {
    return {
      selectedFeatureId: null,
      selectionSource: null,
      selectedRange: null,
      focusedRanges: null,
    };
  }
  return {
    selectedFeatureId: selection.ref.kind === 'feature' ? selection.ref.id ?? null : null,
    selectionSource: legacySource(selection.source),
    selectedRange: selection.primaryRange ? copyRange(selection.primaryRange) : null,
    focusedRanges: nonEmptyRanges(selection.focusedRanges),
  };
}

export function createBioMapRangeSelection(args: {
  blockId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return {
    ref: { blockId: args.blockId, kind: 'range', label: args.label },
    source: args.source,
    primaryRange: args.primaryRange ? copyRange(args.primaryRange) : null,
    focusedRanges: nonEmptyRanges(args.focusedRanges),
  };
}

export function createBioMapFeatureSelection(args: {
  blockId: string;
  featureId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return {
    ref: { blockId: args.blockId, kind: 'feature', id: args.featureId, label: args.label },
    source: args.source,
    primaryRange: args.primaryRange ? copyRange(args.primaryRange) : null,
    focusedRanges: nonEmptyRanges(args.focusedRanges),
  };
}

function createBioMapObjectRangeSelection(args: {
  blockId: string;
  kind: Extract<WorkbenchObjectKind, 'orf' | 'motif' | 'variant' | 'comment' | 'highlight' | 'scar' | 'digest' | 'design' | 'compare'>;
  objectId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return {
    ref: { blockId: args.blockId, kind: args.kind, id: args.objectId, label: args.label },
    source: args.source,
    primaryRange: args.primaryRange ? copyRange(args.primaryRange) : null,
    focusedRanges: nonEmptyRanges(args.focusedRanges),
  };
}

export function createBioMapHighlightSelection(args: {
  blockId: string;
  highlightId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return createBioMapObjectRangeSelection({
    blockId: args.blockId,
    kind: 'highlight',
    objectId: args.highlightId,
    source: args.source,
    primaryRange: args.primaryRange,
    focusedRanges: args.focusedRanges,
    label: args.label,
  });
}

export function createBioMapCommentSelection(args: {
  blockId: string;
  commentId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return createBioMapObjectRangeSelection({
    blockId: args.blockId,
    kind: 'comment',
    objectId: args.commentId,
    source: args.source,
    primaryRange: args.primaryRange,
    focusedRanges: args.focusedRanges,
    label: args.label,
  });
}

export function createBioMapScarSelection(args: {
  blockId: string;
  scarId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return createBioMapObjectRangeSelection({
    blockId: args.blockId,
    kind: 'scar',
    objectId: args.scarId,
    source: args.source,
    primaryRange: args.primaryRange,
    focusedRanges: args.focusedRanges,
    label: args.label,
  });
}

export function createBioMapOrfSelection(args: {
  blockId: string;
  orfId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return createBioMapObjectRangeSelection({
    blockId: args.blockId,
    kind: 'orf',
    objectId: args.orfId,
    source: args.source,
    primaryRange: args.primaryRange,
    focusedRanges: args.focusedRanges,
    label: args.label,
  });
}

export function createBioMapMotifSelection(args: {
  blockId: string;
  motifId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return createBioMapObjectRangeSelection({
    blockId: args.blockId,
    kind: 'motif',
    objectId: args.motifId,
    source: args.source,
    primaryRange: args.primaryRange,
    focusedRanges: args.focusedRanges,
    label: args.label,
  });
}

export function createBioMapVariantSelection(args: {
  blockId: string;
  variantId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return createBioMapObjectRangeSelection({
    blockId: args.blockId,
    kind: 'variant',
    objectId: args.variantId,
    source: args.source,
    primaryRange: args.primaryRange,
    focusedRanges: args.focusedRanges,
    label: args.label,
  });
}

export function createBioMapDigestSelection(args: {
  blockId: string;
  digestId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return createBioMapObjectRangeSelection({
    blockId: args.blockId,
    kind: 'digest',
    objectId: args.digestId,
    source: args.source,
    primaryRange: args.primaryRange,
    focusedRanges: args.focusedRanges,
    label: args.label,
  });
}

export function createBioMapDesignSelection(args: {
  blockId: string;
  designId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return createBioMapObjectRangeSelection({
    blockId: args.blockId,
    kind: 'design',
    objectId: args.designId,
    source: args.source,
    primaryRange: args.primaryRange,
    focusedRanges: args.focusedRanges,
    label: args.label,
  });
}

export function createBioMapCompareSelection(args: {
  blockId: string;
  compareId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  label?: string;
}): BioMapSelection {
  return createBioMapObjectRangeSelection({
    blockId: args.blockId,
    kind: 'compare',
    objectId: args.compareId,
    source: args.source,
    primaryRange: args.primaryRange,
    focusedRanges: args.focusedRanges,
    label: args.label,
  });
}

export function createBioMapRestrictionClusterSelection(args: {
  blockId: string;
  clusterId: string;
  tickIds: readonly string[];
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  positions?: readonly number[];
  label?: string;
}): BioMapSelection {
  return {
    ref: {
      blockId: args.blockId,
      kind: 'restriction-cluster',
      id: args.clusterId,
      tickIds: [...args.tickIds],
      positions: args.positions ? [...args.positions] : undefined,
      label: args.label,
    },
    source: args.source,
    primaryRange: args.primaryRange ? copyRange(args.primaryRange) : null,
    focusedRanges: nonEmptyRanges(args.focusedRanges),
  };
}

export function createBioMapRestrictionSiteSelection(args: {
  blockId: string;
  tickId: string;
  clusterId: string;
  source: BioMapSelectionSource;
  primaryRange: MapSpan | null;
  focusedRanges?: readonly MapSpan[] | null;
  position?: number;
  label?: string;
}): BioMapSelection {
  return {
    ref: {
      blockId: args.blockId,
      kind: 'restriction-site',
      id: args.tickId,
      clusterId: args.clusterId,
      tickIds: [args.tickId],
      positions: typeof args.position === 'number' ? [args.position] : undefined,
      label: args.label,
    },
    source: args.source,
    primaryRange: args.primaryRange ? copyRange(args.primaryRange) : null,
    focusedRanges: nonEmptyRanges(args.focusedRanges),
  };
}

export function restrictionClusterIdForBioMapSelection(
  selection: BioMapSelection | null,
  restrictions?: readonly Pick<MapRestrictionRender, 'clusterId' | 'tickIds'>[],
): string | null {
  if (!selection) return null;
  const direct = selection.ref.kind === 'restriction-cluster'
    ? selection.ref.id ?? null
    : selection.ref.kind === 'restriction-site'
      ? selection.ref.clusterId ?? null
      : null;
  if (!direct) return null;
  if (!restrictions || restrictions.some((restriction) => restriction.clusterId === direct)) return direct;

  const tickIds = selection.ref.tickIds;
  if (!tickIds || tickIds.length === 0) return direct;
  const selectedTicks = new Set(tickIds);
  const exact = restrictions.find((restriction) =>
    restriction.tickIds.length === selectedTicks.size
    && restriction.tickIds.every((tickId) => selectedTicks.has(tickId)),
  );
  if (exact) return exact.clusterId;
  const containing = restrictions.find((restriction) => tickIds.every((tickId) => restriction.tickIds.includes(tickId)));
  if (containing) return containing.clusterId;
  return null;
}
