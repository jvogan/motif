import { isMaterializableFeatureLocation } from './feature-location';
import type { Feature } from './types';
import { validateFeatureCollection } from './feature-bounds';

/** Maximum dense source-map length accepted by this exported boundary. */
export const MAX_SOURCE_TO_PRODUCT_MAP_LENGTH = 1_000_000;
/** Maximum combined map-compression and feature-intersection work per batch. */
export const MAX_FEATURE_MAPPING_WORK_UNITS = 2_000_000;
/** Do not materialize a pathological map as an unbounded multipart feature. */
export const MAX_MAPPED_FEATURE_PIECES = 10_000;
/** Keep the compressed representation bounded for hostile, alternating maps. */
export const MAX_SOURCE_TO_PRODUCT_RUNS = 100_000;

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

interface SourceToProductRun {
  start: number;
  end: number;
  productStart: number | null;
}

export type FeatureMappingStatus = 'ready' | 'invalid_input' | 'work_limit';

export interface FeatureMappingIssue {
  code: 'invalid_map' | 'feature_input_limit' | 'map_work_limit' | 'mapped_piece_limit';
  message: string;
  featureIndex?: number;
}

export interface FeatureMappingResult {
  features: Feature[];
  status: FeatureMappingStatus;
  complete: boolean;
  mappedFeatureCount: number;
  skippedFeatureCount: number;
  /** Conservative work receipt including one scan of the coordinate map. */
  estimatedWorkUnits: number;
  maxWorkUnits: number;
  issues: FeatureMappingIssue[];
}

interface SourceToProductMapSnapshot {
  sourceLength: number;
  productLength: number;
  sourceToProduct: (number | null)[];
}

const INVALID_MAP_FIELD = Symbol('invalid-map-field');

function isBoundedMapLength(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= MAX_SOURCE_TO_PRODUCT_MAP_LENGTH;
}

function snapshotSourceToProductMap(
  map: SourceToProductCoordinateMap,
): { snapshot: SourceToProductMapSnapshot | null; issue: FeatureMappingIssue | null } {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    return {
      snapshot: null,
      issue: {
        code: 'invalid_map',
        message: 'Source coordinate map must be a plain data object.',
      },
    };
  }
  const readField = (key: 'sourceLength' | 'productLength' | 'sourceToProduct'): unknown | typeof INVALID_MAP_FIELD => {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(map, key);
    } catch {
      return INVALID_MAP_FIELD;
    }
    return descriptor && 'value' in descriptor ? descriptor.value : INVALID_MAP_FIELD;
  };
  const sourceLength = readField('sourceLength');
  const productLength = readField('productLength');
  const sourceToProduct = readField('sourceToProduct');
  if (sourceLength === INVALID_MAP_FIELD || !isBoundedMapLength(sourceLength)) {
    return {
      snapshot: null,
      issue: {
        code: 'invalid_map',
        message: `Source coordinate map length must be a safe integer from 0 to ${MAX_SOURCE_TO_PRODUCT_MAP_LENGTH.toLocaleString()}.`,
      },
    };
  }
  if (productLength === INVALID_MAP_FIELD || !isBoundedMapLength(productLength)) {
    return {
      snapshot: null,
      issue: {
        code: 'invalid_map',
        message: `Product coordinate map length must be a safe integer from 0 to ${MAX_SOURCE_TO_PRODUCT_MAP_LENGTH.toLocaleString()}.`,
      },
    };
  }
  let sourceArrayLength: unknown = INVALID_MAP_FIELD;
  if (sourceToProduct !== INVALID_MAP_FIELD && Array.isArray(sourceToProduct)) {
    let lengthDescriptor: PropertyDescriptor | undefined;
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(sourceToProduct, 'length');
    } catch {
      lengthDescriptor = undefined;
    }
    if (lengthDescriptor && 'value' in lengthDescriptor) sourceArrayLength = lengthDescriptor.value;
  }
  if (sourceToProduct === INVALID_MAP_FIELD
    || !Array.isArray(sourceToProduct)
    || sourceArrayLength !== sourceLength) {
    return {
      snapshot: null,
      issue: {
        code: 'invalid_map',
        message: 'Source coordinate map entries must be a dense array matching sourceLength.',
      },
    };
  }
  return {
    snapshot: {
      sourceLength: sourceLength as number,
      productLength: productLength as number,
      sourceToProduct,
    },
    issue: null,
  };
}

/**
 * Compress the dense map into affine runs. Assembly maps are usually one or a
 * few runs (identity, overlap alias, and an optional closing seam), so this
 * turns mapping a long feature from a base-by-base walk into a run walk. The
 * dense scan is paid once per map batch, not once per feature.
 */
function buildSourceToProductRuns(
  map: SourceToProductCoordinateMap,
): { runs: SourceToProductRun[]; issue: FeatureMappingIssue | null } {
  const snapshotResult = snapshotSourceToProductMap(map);
  if (snapshotResult.issue || !snapshotResult.snapshot) return { runs: [], issue: snapshotResult.issue };
  const snapshot = snapshotResult.snapshot;
  const runs: SourceToProductRun[] = [];
  let current: SourceToProductRun | null = null;
  let previousProduct: number | null = null;
  for (let source = 0; source < snapshot.sourceLength; source += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(snapshot.sourceToProduct, String(source));
    } catch {
      descriptor = undefined;
    }
    if (!descriptor || !('value' in descriptor)) {
      return {
        runs: [],
        issue: {
          code: 'invalid_map',
          message: `Source coordinate map entry ${source} is missing; maps must be dense data arrays.`,
        },
      };
    }
    const rawProduct = descriptor.value;
    if (rawProduct !== null && (!Number.isSafeInteger(rawProduct) || rawProduct < 0 || rawProduct >= snapshot.productLength)) {
      return {
        runs: [],
        issue: {
          code: 'invalid_map',
          message: `Source coordinate map entry ${source} is outside the product bounds.`,
        },
      };
    }
    const product = rawProduct;
    const continues = current !== null
      && current.end === source
      && ((current.productStart === null && product === null)
        || (current.productStart !== null && product !== null && product === (previousProduct as number) + 1));
    if (continues) {
      current!.end = source + 1;
    } else {
      if (current) runs.push(current);
      if (runs.length >= MAX_SOURCE_TO_PRODUCT_RUNS) {
        return {
          runs: [],
          issue: {
            code: 'map_work_limit',
            message: `Source coordinate map exceeds the ${MAX_SOURCE_TO_PRODUCT_RUNS.toLocaleString()}-run compression limit.`,
          },
        };
      }
      current = { start: source, end: source + 1, productStart: product };
    }
    previousProduct = product;
  }
  if (current) runs.push(current);
  return { runs, issue: null };
}

function mappedPiecesForRange(
  start: number,
  end: number,
  runs: readonly SourceToProductRun[],
  sourceLength: number,
  workBudget: { units: number; max: number },
): { pieces: MappedPiece[]; partial: boolean; pieceLimit: boolean } {
  const boundedStart = Math.max(0, Math.min(sourceLength, Math.trunc(start)));
  const boundedEnd = Math.max(boundedStart, Math.min(sourceLength, Math.trunc(end)));
  const partial = boundedStart !== start || boundedEnd !== end;
  const pieces: MappedPiece[] = [];
  let partialResult = partial;
  let lower = 0;
  let upper = runs.length;
  while (lower < upper) {
    workBudget.units += 1;
    if (workBudget.units > workBudget.max) return { pieces, partial: true, pieceLimit: false };
    const middle = lower + Math.floor((upper - lower) / 2);
    if (runs[middle].end <= boundedStart) lower = middle + 1;
    else upper = middle;
  }
  let runIndex = lower;
  for (; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    if (run.start >= boundedEnd) break;
    workBudget.units += 1;
    if (workBudget.units > workBudget.max) return { pieces, partial: true, pieceLimit: false };
    const overlapStart = Math.max(boundedStart, run.start);
    const overlapEnd = Math.min(boundedEnd, run.end);
    if (overlapStart >= overlapEnd) continue;
    if (run.productStart === null) {
      partialResult = true;
      continue;
    }
    if (pieces.length >= MAX_MAPPED_FEATURE_PIECES) {
      return { pieces, partial: true, pieceLimit: true };
    }
    const productStart = run.productStart + (overlapStart - run.start);
    pieces.push({
      start: productStart,
      end: productStart + (overlapEnd - overlapStart),
    });
  }
  return { pieces, partial: partialResult, pieceLimit: false };
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
  const result = mapFeaturesThroughSourceCoordinates([feature], map);
  return result.status === 'ready' ? result.features[0] ?? null : null;
}

/**
 * Map a feature collection through one assembly coordinate map. Callers that
 * have more than one feature should use this batch form so the dense map is
 * compressed once and shared across all features. A non-ready result is a
 * typed, bounded refusal; callers must not treat its feature list as an
 * exhaustive successful mapping.
 */
export function mapFeaturesThroughSourceCoordinates(
  features: readonly Feature[] | undefined,
  map: SourceToProductCoordinateMap,
  options: { maxWorkUnits?: number } = {},
): FeatureMappingResult {
  const maxWorkUnits = Number.isSafeInteger(options.maxWorkUnits)
    ? Math.min(Math.max(1, options.maxWorkUnits as number), MAX_FEATURE_MAPPING_WORK_UNITS)
    : MAX_FEATURE_MAPPING_WORK_UNITS;
  const featureList = features ?? [];
  const mapSnapshotResult = snapshotSourceToProductMap(map);
  if (mapSnapshotResult.issue || !mapSnapshotResult.snapshot) {
    return {
      features: [],
      status: 'invalid_input',
      complete: false,
      mappedFeatureCount: 0,
      skippedFeatureCount: featureList.length,
      estimatedWorkUnits: 0,
      maxWorkUnits,
      issues: [mapSnapshotResult.issue ?? {
        code: 'invalid_map',
        message: 'Source coordinate map could not be inspected as bounded data.',
      }],
    };
  }
  const mapSnapshot = mapSnapshotResult.snapshot;
  if (mapSnapshot.sourceLength > maxWorkUnits) {
    return {
      features: [],
      status: 'work_limit',
      complete: false,
      mappedFeatureCount: 0,
      skippedFeatureCount: featureList.length,
      estimatedWorkUnits: mapSnapshot.sourceLength,
      maxWorkUnits,
      issues: [{
        code: 'map_work_limit',
        message: `Source coordinate map compression requires ${mapSnapshot.sourceLength.toLocaleString()} units, above the ${maxWorkUnits.toLocaleString()}-unit feature mapping limit.`,
      }],
    };
  }
  const mapRunResult = buildSourceToProductRuns(mapSnapshot);
  if (mapRunResult.issue) {
    return {
      features: [],
      status: mapRunResult.issue.code === 'map_work_limit' ? 'work_limit' : 'invalid_input',
      complete: false,
      mappedFeatureCount: 0,
      skippedFeatureCount: featureList.length,
      estimatedWorkUnits: 0,
      maxWorkUnits,
      issues: [mapRunResult.issue],
    };
  }
  const mapWorkUnits = mapSnapshot.sourceLength;
  const validation = validateFeatureCollection(featureList, {
    label: 'Mapped features',
    sequenceLength: mapSnapshot.sourceLength,
    allowCircularWrap: true,
  });
  if (!validation.valid) {
    return {
      features: [],
      status: 'invalid_input',
      complete: false,
      mappedFeatureCount: 0,
      skippedFeatureCount: featureList.length,
      estimatedWorkUnits: mapWorkUnits,
      maxWorkUnits,
      issues: validation.issues.slice(0, 64).map((issue) => ({
        code: 'feature_input_limit' as const,
        message: issue.message,
        featureIndex: issue.featureIndex,
      })),
    };
  }

  // Keep this exported mapping boundary safe even when an engine forgets to
  // validate its collection before calling it directly.
  // Imported quarantines and non-materializable multipart locations may carry
  // a bounded placeholder range for display. A source-to-product map must not
  // promote that placeholder into a derived record annotation.
  const mappedFeatures: Feature[] = [];
  let workUnits = mapWorkUnits;
  let skippedFeatureCount = 0;
  const issues: FeatureMappingIssue[] = [];
  for (const [featureIndex, feature] of featureList.entries()) {
    if (!isMaterializableFeatureLocation(feature)) {
      skippedFeatureCount += 1;
      continue;
    }
    const hasSubRanges = feature.subRanges !== undefined;
    const sourceRanges = hasSubRanges
      ? feature.subRanges!
      : [{ start: feature.start, end: feature.end, strand: feature.strand }];
    if (sourceRanges.length === 0) {
      skippedFeatureCount += 1;
      continue;
    }

    const mappedRanges: Array<{ start: number; end: number; strand?: number }> = [];
    let partial = false;
    for (const range of sourceRanges) {
      const workBudget = { units: workUnits, max: maxWorkUnits };
      const mapped = mappedPiecesForRange(
        range.start,
        range.end,
        mapRunResult.runs,
        mapSnapshot.sourceLength,
        workBudget,
      );
      // The helper increments its budget while walking intersecting runs.
      // Account for the retained output pieces as a small additional term.
      workUnits = workBudget.units + mapped.pieces.length;
      partial ||= mapped.partial;
      if (mapped.pieceLimit) {
        issues.push({
          code: 'mapped_piece_limit',
          message: `Mapped feature ${featureIndex + 1} exceeds the ${MAX_MAPPED_FEATURE_PIECES.toLocaleString()}-piece output limit.`,
          featureIndex,
        });
        return {
          features: [],
          status: 'work_limit',
          complete: false,
          mappedFeatureCount: mappedFeatures.length,
          skippedFeatureCount,
          estimatedWorkUnits: workUnits,
          maxWorkUnits,
          issues,
        };
      }
      if (mappedRanges.length + mapped.pieces.length > MAX_MAPPED_FEATURE_PIECES) {
        issues.push({
          code: 'mapped_piece_limit',
          message: `Mapped feature ${featureIndex + 1} exceeds the ${MAX_MAPPED_FEATURE_PIECES.toLocaleString()}-piece output limit.`,
          featureIndex,
        });
        return {
          features: [],
          status: 'work_limit',
          complete: false,
          mappedFeatureCount: mappedFeatures.length,
          skippedFeatureCount,
          estimatedWorkUnits: workUnits,
          maxWorkUnits,
          issues,
        };
      }
      if (workUnits > maxWorkUnits) {
        issues.push({
          code: 'map_work_limit',
          message: `Feature mapping exceeded the ${maxWorkUnits.toLocaleString()}-unit safety limit.`,
          featureIndex,
        });
        return {
          features: [],
          status: 'work_limit',
          complete: false,
          mappedFeatureCount: mappedFeatures.length,
          skippedFeatureCount,
          estimatedWorkUnits: workUnits,
          maxWorkUnits,
          issues,
        };
      }
      const biologicalPieces = range.strand === -1 ? [...mapped.pieces].reverse() : mapped.pieces;
      for (const piece of biologicalPieces) {
        mappedRanges.push({ ...range, start: piece.start, end: piece.end });
      }
    }
    if (mappedRanges.length === 0) {
      skippedFeatureCount += 1;
      continue;
    }

    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const range of mappedRanges) {
      start = Math.min(start, range.start);
      end = Math.max(end, range.end);
    }

    const { subRanges: _subRanges, ...featureWithoutSubRanges } = feature;
    mappedFeatures.push({
      ...featureWithoutSubRanges,
      start,
      end,
      metadata: partial ? { ...feature.metadata, partial: true } : feature.metadata,
      ...(hasSubRanges || mappedRanges.length > 1 ? { subRanges: mappedRanges } : {}),
    });
  }
  return {
    features: mappedFeatures,
    status: 'ready',
    complete: true,
    mappedFeatureCount: mappedFeatures.length,
    skippedFeatureCount,
    estimatedWorkUnits: workUnits,
    maxWorkUnits,
    issues,
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
