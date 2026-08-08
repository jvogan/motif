import { isMaterializableFeatureLocation } from './feature-location';
import type { Feature } from './types';

/**
 * An explicit source-coordinate → product-coordinate map for one assembled
 * source sequence. `null` means that the source base was genuinely omitted;
 * aliases are represented by pointing multiple source bases at retained
 * product coordinates rather than clipping the feature that covers them.
 */
export interface SourceToProductCoordinateMap {
  sourceLength: number;
  productLength: number;
  sourceToProduct: (number | null)[];
}

interface MappedPiece {
  start: number;
  end: number;
}

function mappedPiecesForRange(
  start: number,
  end: number,
  map: SourceToProductCoordinateMap,
): { pieces: MappedPiece[]; partial: boolean } {
  const boundedStart = Math.max(0, Math.min(map.sourceLength, Math.trunc(start)));
  const boundedEnd = Math.max(boundedStart, Math.min(map.sourceLength, Math.trunc(end)));
  const partial = boundedStart !== start || boundedEnd !== end;
  const pieces: MappedPiece[] = [];
  let current: MappedPiece | null = null;
  let previousSource = -1;
  let previousProduct = -1;

  for (let source = boundedStart; source < boundedEnd; source++) {
    const product = map.sourceToProduct[source] ?? null;
    if (product === null || product < 0 || product >= map.productLength) {
      if (current) pieces.push(current);
      current = null;
      previousSource = -1;
      previousProduct = -1;
      continue;
    }
    if (current && source === previousSource + 1 && product === previousProduct + 1) {
      current.end = product + 1;
    } else {
      if (current) pieces.push(current);
      current = { start: product, end: product + 1 };
    }
    previousSource = source;
    previousProduct = product;
  }
  if (current) pieces.push(current);

  const mappedBaseCount = pieces.reduce((count, piece) => count + piece.end - piece.start, 0);
  return {
    pieces,
    partial: partial || mappedBaseCount < boundedEnd - boundedStart,
  };
}

/**
 * Map a feature through an assembly map while preserving its identity and
 * metadata. Existing multipart ranges stay in biological order. A contiguous
 * source range that crosses an assembly seam becomes multipart; reverse
 * ranges reverse their mapped pieces so the stored order remains biological.
 */
export function mapFeatureThroughSourceCoordinates(
  feature: Feature,
  map: SourceToProductCoordinateMap,
): Feature | null {
  // Imported quarantines and non-materializable multipart locations may carry
  // a bounded placeholder range for display. A source-to-product map must not
  // promote that placeholder into a derived record annotation.
  if (!isMaterializableFeatureLocation(feature)) return null;
  const hasSubRanges = feature.subRanges !== undefined;
  const sourceRanges = hasSubRanges
    ? feature.subRanges!
    : [{ start: feature.start, end: feature.end, strand: feature.strand }];
  if (sourceRanges.length === 0) return null;

  const mappedRanges: Array<{ start: number; end: number; strand?: number }> = [];
  let partial = false;
  for (const range of sourceRanges) {
    const mapped = mappedPiecesForRange(range.start, range.end, map);
    partial ||= mapped.partial;
    const biologicalPieces = range.strand === -1 ? [...mapped.pieces].reverse() : mapped.pieces;
    for (const piece of biologicalPieces) {
      mappedRanges.push({ ...range, start: piece.start, end: piece.end });
    }
  }
  if (mappedRanges.length === 0) return null;

  const { subRanges: _subRanges, ...featureWithoutSubRanges } = feature;
  return {
    ...featureWithoutSubRanges,
    start: Math.min(...mappedRanges.map((range) => range.start)),
    end: Math.max(...mappedRanges.map((range) => range.end)),
    metadata: partial ? { ...feature.metadata, partial: true } : feature.metadata,
    ...(hasSubRanges || mappedRanges.length > 1 ? { subRanges: mappedRanges } : {}),
  };
}

/** Create a null-filled map whose entries can be populated by an assembler. */
export function emptySourceToProductMap(sourceLength: number, productLength: number): SourceToProductCoordinateMap {
  return {
    sourceLength,
    productLength,
    sourceToProduct: Array.from({ length: sourceLength }, () => null),
  };
}

/**
 * Alias coordinates in a removed duplicate suffix to the retained product
 * head. This also handles unusual assemblies where the closing overlap is
 * longer than the final fragment's newly appended body and the removed suffix
 * reaches into an earlier source's canonical copy.
 */
export function aliasRemovedProductCoordinates(
  maps: SourceToProductCoordinateMap[],
  retainedLength: number,
  preClosureLength: number,
): void {
  for (const map of maps) {
    for (let source = 0; source < map.sourceToProduct.length; source++) {
      const product = map.sourceToProduct[source];
      if (product !== null && product >= retainedLength && product < preClosureLength) {
        map.sourceToProduct[source] = product - retainedLength;
      }
    }
    map.productLength = retainedLength;
  }
}
