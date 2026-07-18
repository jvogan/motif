import { reverseComplement } from './reverse-complement';
import type { Feature, FeatureStrand, SequenceType } from './types';

export type FeatureLocation = Pick<Feature, 'start' | 'end' | 'strand' | 'subRanges'> & {
  metadata?: Record<string, unknown>;
};

export type FeatureLocationSegment = {
  start: number;
  end: number;
  strand: FeatureStrand;
};

export type FeatureCoordinateMapSpan = {
  /** Inclusive start in the source sequence. */
  start: number;
  /** Exclusive end in the source sequence. */
  end: number;
  /** Coordinate in the destination sequence corresponding to `start`. */
  targetStart: number;
};

export type RemappedFeatureLocation = Pick<Feature, 'start' | 'end' | 'subRanges'>;

function effectiveStrand(value: unknown, fallback: FeatureStrand): FeatureStrand {
  return value === -1 || value === 0 || value === 1 ? value : fallback;
}

/**
 * Return the authoritative pieces of a feature in biological 5′→3′ order.
 *
 * `subRanges`, when present, are not merely drawing hints: they are the pieces
 * that form the feature product. Their stored order is therefore significant.
 * A range without its own strand inherits the feature strand for compatibility
 * with older JSON payloads.
 */
export function featureLocationSegments(feature: FeatureLocation): FeatureLocationSegment[] {
  const fallbackStrand = effectiveStrand(feature.strand, 1);
  if (feature.subRanges !== undefined) {
    return feature.subRanges.filter((range) => (
      Number.isFinite(range.start)
      && Number.isFinite(range.end)
      && range.end > range.start
    )).map((range) => ({
      start: range.start,
      end: range.end,
      strand: effectiveStrand(range.strand, fallbackStrand),
    }));
  }

  return feature.end > feature.start
    ? [{ start: feature.start, end: feature.end, strand: fallbackStrand }]
    : [];
}

/** Total annotated segment length, excluding gaps between pieces. */
export function featureLocationLength(feature: FeatureLocation): number {
  return featureLocationSegments(feature).reduce(
    (length, segment) => length + Math.max(0, segment.end - segment.start),
    0,
  );
}

/** Stable coordinate/orientation fingerprint for guarded location metadata. */
export function featureLocationCoordinateSignature(feature: FeatureLocation): string {
  return JSON.stringify(featureLocationSegments(feature).map((segment) => [
    segment.start,
    segment.end,
    segment.strand,
  ]));
}

/** True when the feature product is assembled from more than one stored piece. */
export function isMultipartFeature(feature: FeatureLocation): boolean {
  return featureLocationSegments(feature).length > 1;
}

/** INSDC `order(...)` preserves order but does not authorize concatenation. */
export function isOrderedFeatureLocation(feature: FeatureLocation): boolean {
  return featureLocationSegments(feature).length > 1
    && feature.metadata?.motifLocationOperator === 'order';
}

/** True when an older/unmarked reverse multipart array has no inferable order. */
export function isAmbiguousFeatureLocation(feature: FeatureLocation): boolean {
  return featureLocationSegments(feature).length > 1
    && feature.metadata?.motifSubRangeOrderAmbiguous === true;
}

export function isMaterializableFeatureLocation(feature: FeatureLocation): boolean {
  return !isOrderedFeatureLocation(feature) && !isAmbiguousFeatureLocation(feature);
}

/**
 * Materialize the biological feature product.
 *
 * Each piece is oriented independently and then concatenated in stored
 * biological order. This handles both `complement(join(...))` (normalized by
 * the parser to reversed, negative-strand pieces) and explicit mixed locations
 * such as `join(complement(...), ...)` without including intervening bases.
 */
export function extractFeatureSequence(
  sequence: string,
  feature: FeatureLocation,
  sequenceType?: SequenceType,
): string {
  if (!isMaterializableFeatureLocation(feature)) return '';
  const isNucleotide = sequenceType === 'dna' || sequenceType === 'rna';
  const isRna = sequenceType === 'rna';

  return featureLocationSegments(feature).map((segment) => {
    const part = sequence.slice(segment.start, segment.end);
    return isNucleotide && segment.strand === -1
      ? reverseComplement(part, isRna)
      : part;
  }).join('');
}

/**
 * Remap a complete feature through ordered source→destination spans.
 *
 * This is used when a digest/PCR product is assembled from one or more source
 * intervals. Every authoritative feature piece must fit wholly inside one map
 * span; otherwise the feature crosses a physical cut boundary and is omitted.
 * Stored biological piece order and strand metadata are preserved.
 */
export function remapFeatureLocation(
  feature: FeatureLocation,
  sourceSpans: readonly FeatureCoordinateMapSpan[],
): RemappedFeatureLocation | null {
  const hasStoredSubRanges = feature.subRanges !== undefined;
  const sourceSegments = hasStoredSubRanges
    ? feature.subRanges!
    : [{ start: feature.start, end: feature.end }];
  const mapped = sourceSegments.map((segment) => {
    const sourceSpan = sourceSpans.find((span) => (
      segment.start >= span.start && segment.end <= span.end
    ));
    if (!sourceSpan) return null;
    return {
      ...segment,
      start: sourceSpan.targetStart + segment.start - sourceSpan.start,
      end: sourceSpan.targetStart + segment.end - sourceSpan.start,
    };
  });

  if (mapped.some((segment) => segment === null)) return null;
  const mappedSegments = mapped.filter((segment): segment is NonNullable<typeof segment> => segment !== null);
  if (mappedSegments.length === 0) return null;

  return {
    start: Math.min(...mappedSegments.map((segment) => segment.start)),
    end: Math.max(...mappedSegments.map((segment) => segment.end)),
    ...(hasStoredSubRanges ? { subRanges: mappedSegments } : {}),
  };
}

function genBankRange(start: number, end: number): string {
  const start1 = start + 1;
  return start1 === end ? String(start1) : `${start1}..${end}`;
}

/**
 * Serialize a normalized feature location without collapsing multipart data.
 * All-negative biological segments are emitted in canonical
 * `complement(join(genomic-order...))` form; mixed-strand pieces retain their
 * explicit per-piece orientation inside `join(...)`.
 */
export function featureGenBankLocation(feature: FeatureLocation): string {
  const segments = featureLocationSegments(feature);
  if (segments.length === 0) {
    if (feature.subRanges !== undefined) {
      throw new Error('Cannot serialize a feature with an explicit empty location.');
    }
    return genBankRange(feature.start, feature.end);
  }

  if (segments.length === 1) {
    const segment = segments[0];
    const location = genBankRange(segment.start, segment.end);
    return segment.strand === -1 ? `complement(${location})` : location;
  }

  // An unmarked reverse multipart checkpoint can represent either legacy
  // GenBank text order or current biological order. Serializing it as join
  // would assert a product Motif cannot justify, so degrade safely to order.
  const operator = isOrderedFeatureLocation(feature) || isAmbiguousFeatureLocation(feature)
    ? 'order'
    : 'join';
  if (segments.every((segment) => segment.strand === -1)) {
    const genomicOrder = [...segments].reverse();
    return `complement(${operator}(${genomicOrder.map((segment) => genBankRange(segment.start, segment.end)).join(',')}))`;
  }

  const parts = segments.map((segment) => {
    const location = genBankRange(segment.start, segment.end);
    return segment.strand === -1 ? `complement(${location})` : location;
  });
  return `${operator}(${parts.join(',')})`;
}
