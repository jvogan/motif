import type { Feature } from './types';

/** Hard limits shared by derived-record engines that propagate annotations. */
export const MAX_FEATURES_PER_COLLECTION = 10_000;
export const MAX_SUBRANGES_PER_FEATURE = 10_000;
export const MAX_FEATURE_VALIDATION_WORK_UNITS = 1_000_000;
export const MAX_FEATURE_METADATA_DEPTH = 4;
export const MAX_FEATURE_METADATA_KEYS = 256;
export const MAX_FEATURE_METADATA_STRING_LENGTH = 4_096;
export const MAX_FEATURE_METADATA_BYTES = 65_536;
export const MAX_FEATURE_VALIDATION_ISSUES = 64;

export type FeatureValidationIssueCode =
  | 'invalid_feature_collection'
  | 'feature_limit'
  | 'invalid_feature'
  | 'subrange_limit'
  | 'invalid_subrange'
  | 'metadata_limit'
  | 'feature_work_limit';

export interface FeatureValidationIssue {
  code: FeatureValidationIssueCode;
  message: string;
  featureIndex?: number;
  subrangeIndex?: number;
}

export interface FeatureValidationOptions {
  /** Prefix used in diagnostics; it is data, not executable content. */
  label?: string;
  /** Source-record length used to check coordinates. */
  sequenceLength?: number;
  /** Permit a feature envelope that wraps the origin of a circular record. */
  allowCircularWrap?: boolean;
  /** Per-call ceilings may narrow, but never raise, the hard limits above. */
  maxFeatures?: number;
  maxSubrangesPerFeature?: number;
  maxWorkUnits?: number;
  maxMetadataDepth?: number;
  maxMetadataKeys?: number;
  maxMetadataBytes?: number;
}

export interface FeatureValidationResult {
  valid: boolean;
  issues: FeatureValidationIssue[];
  featureCount: number;
  inspectedFeatureCount: number;
  featureWorkUnits: number;
  complete: boolean;
}

export class FeatureCollectionInputError extends Error {
  readonly code = 'invalid_feature_collection' as const;
  readonly validation: FeatureValidationResult;

  constructor(validation: FeatureValidationResult) {
    super(validation.issues.map((issue) => issue.message).join(' '));
    this.name = 'FeatureCollectionInputError';
    this.validation = validation;
  }
}

const INVALID_ACCESSOR = Symbol('invalid-feature-accessor');
const textEncoder = new TextEncoder();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown | typeof INVALID_ACCESSOR {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return undefined;
    return 'value' in descriptor ? descriptor.value : INVALID_ACCESSOR;
  } catch {
    return INVALID_ACCESSOR;
  }
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function boundedLimit(value: number | undefined, fallback: number, hardMaximum: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 1
    ? Math.min(value as number, hardMaximum)
    : fallback;
}

function boundedString(value: unknown, maximum: number): boolean {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !hasControlCharacters(value)
    && value.trim().length > 0;
}

interface MetadataValidation {
  issues: string[];
  units: number;
  bytes: number;
  complete: boolean;
}

function validateMetadata(
  value: unknown,
  path: string,
  options: Required<Pick<FeatureValidationOptions, 'maxMetadataDepth' | 'maxMetadataKeys' | 'maxMetadataBytes'>>,
): MetadataValidation {
  const issues: string[] = [];
  const seen = new WeakSet<object>();
  let units = 0;
  let bytes = 0;
  let complete = true;

  const addIssue = (message: string): void => {
    if (issues.length < MAX_FEATURE_VALIDATION_ISSUES) issues.push(message);
    complete = false;
  };

  const visit = (candidate: unknown, candidatePath: string, depth: number): void => {
    units += 1;
    if (units > options.maxMetadataKeys || bytes > options.maxMetadataBytes) {
      addIssue(`${candidatePath} exceeds the bounded metadata work or byte limit.`);
      return;
    }
    if (candidate === null || typeof candidate === 'boolean') {
      bytes += candidate === null ? 4 : 5;
      return;
    }
    if (typeof candidate === 'string') {
      if (candidate.length > MAX_FEATURE_METADATA_STRING_LENGTH || hasControlCharacters(candidate)) {
        addIssue(`${candidatePath} must be a bounded string without control characters.`);
        return;
      }
      bytes += textEncoder.encode(candidate).byteLength;
      return;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) addIssue(`${candidatePath} must be finite.`);
      bytes += 8;
      return;
    }
    if (typeof candidate !== 'object' || candidate === undefined) {
      addIssue(`${candidatePath} must contain only plain JSON-compatible values.`);
      return;
    }
    if (!isPlainRecord(candidate) && !Array.isArray(candidate)) {
      addIssue(`${candidatePath} must be a plain object or array.`);
      return;
    }
    if (seen.has(candidate)) {
      addIssue(`${candidatePath} must not contain cycles.`);
      return;
    }
    if (depth >= options.maxMetadataDepth) {
      addIssue(`${candidatePath} exceeds the ${options.maxMetadataDepth}-level metadata depth limit.`);
      return;
    }
    seen.add(candidate);
    let keys: string[];
    try {
      keys = Object.keys(candidate);
    } catch {
      addIssue(`${candidatePath} could not be inspected as bounded JSON data.`);
      seen.delete(candidate);
      return;
    }
    if (keys.length > options.maxMetadataKeys) {
      addIssue(`${candidatePath} exceeds the metadata item limit.`);
    }
    for (const key of keys.slice(0, options.maxMetadataKeys)) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      } catch {
        addIssue(`${candidatePath} contains an unreadable property.`);
        continue;
      }
      if (!descriptor || !('value' in descriptor)) {
        addIssue(`${candidatePath} contains an accessor property.`);
        continue;
      }
      if (key.length > MAX_FEATURE_METADATA_STRING_LENGTH || hasControlCharacters(key)) {
        addIssue(`${candidatePath} contains an overlong or control-character key.`);
        continue;
      }
      bytes += textEncoder.encode(key).byteLength;
      visit(descriptor.value, `${candidatePath}.${key}`, depth + 1);
      if (units > options.maxMetadataKeys || bytes > options.maxMetadataBytes) break;
    }
    seen.delete(candidate);
  };

  visit(value, path, 0);
  if (units > options.maxMetadataKeys || bytes > options.maxMetadataBytes) {
    complete = false;
    if (issues.length < MAX_FEATURE_VALIDATION_ISSUES) {
      issues.push(`${path} exceeds the ${options.maxMetadataBytes.toLocaleString()}-byte metadata limit.`);
    }
  }
  return { issues, units, bytes, complete };
}

function normalizeOptions(options: FeatureValidationOptions): Required<FeatureValidationOptions> {
  return {
    label: typeof options.label === 'string' && options.label.length > 0 ? options.label : 'Features',
    sequenceLength: Number.isSafeInteger(options.sequenceLength) && (options.sequenceLength as number) >= 0
      ? options.sequenceLength as number
      : -1,
    allowCircularWrap: options.allowCircularWrap === true,
    maxFeatures: boundedLimit(options.maxFeatures, MAX_FEATURES_PER_COLLECTION, MAX_FEATURES_PER_COLLECTION),
    maxSubrangesPerFeature: boundedLimit(options.maxSubrangesPerFeature, MAX_SUBRANGES_PER_FEATURE, MAX_SUBRANGES_PER_FEATURE),
    maxWorkUnits: boundedLimit(options.maxWorkUnits, MAX_FEATURE_VALIDATION_WORK_UNITS, MAX_FEATURE_VALIDATION_WORK_UNITS),
    maxMetadataDepth: boundedLimit(options.maxMetadataDepth, MAX_FEATURE_METADATA_DEPTH, MAX_FEATURE_METADATA_DEPTH),
    maxMetadataKeys: boundedLimit(options.maxMetadataKeys, MAX_FEATURE_METADATA_KEYS, MAX_FEATURE_METADATA_KEYS),
    maxMetadataBytes: boundedLimit(options.maxMetadataBytes, MAX_FEATURE_METADATA_BYTES, MAX_FEATURE_METADATA_BYTES),
  };
}

/**
 * Validate a feature collection before any derived-record mapping work.
 * Invalid oversized collections are only inspected up to the hard collection
 * ceiling, and metadata traversal stops at bounded work/byte limits.
 */
export function validateFeatureCollection(
  features: unknown,
  options: FeatureValidationOptions = {},
): FeatureValidationResult {
  const normalized = normalizeOptions(options);
  const issues: FeatureValidationIssue[] = [];
  const addIssue = (issue: FeatureValidationIssue): void => {
    if (issues.length < MAX_FEATURE_VALIDATION_ISSUES) issues.push(issue);
  };
  if (features === undefined) {
    return {
      valid: true,
      issues,
      featureCount: 0,
      inspectedFeatureCount: 0,
      featureWorkUnits: 0,
      complete: true,
    };
  }
  if (!Array.isArray(features)) {
    addIssue({ code: 'invalid_feature_collection', message: `${normalized.label} must be an array when provided.` });
    return {
      valid: false,
      issues,
      featureCount: 0,
      inspectedFeatureCount: 0,
      featureWorkUnits: 0,
      complete: false,
    };
  }

  let featureCount: number;
  try {
    featureCount = features.length;
  } catch {
    addIssue({ code: 'invalid_feature_collection', message: `${normalized.label} could not be inspected as an array.` });
    return {
      valid: false,
      issues,
      featureCount: 0,
      inspectedFeatureCount: 0,
      featureWorkUnits: 0,
      complete: false,
    };
  }
  let complete = true;
  if (featureCount > normalized.maxFeatures) {
    addIssue({
      code: 'feature_limit',
      message: `${normalized.label} exceeds the ${normalized.maxFeatures.toLocaleString()}-feature limit.`,
    });
    return {
      valid: false,
      issues,
      featureCount,
      inspectedFeatureCount: 0,
      featureWorkUnits: 0,
      complete: false,
    };
  }

  let featureWorkUnits = 0;
  const boundedFeatures: unknown[] = [];
  const inspectedFeatureLimit = Math.min(featureCount, normalized.maxFeatures);
  for (let index = 0; index < inspectedFeatureLimit; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(features, String(index));
    } catch {
      descriptor = undefined;
    }
    boundedFeatures.push(descriptor && 'value' in descriptor ? descriptor.value : undefined);
  }
  let inspectedFeatureCount = 0;
  for (const [featureIndex, rawFeature] of boundedFeatures.entries()) {
    if (featureWorkUnits >= normalized.maxWorkUnits || issues.length >= MAX_FEATURE_VALIDATION_ISSUES) {
      complete = false;
      if (featureWorkUnits >= normalized.maxWorkUnits) {
        addIssue({ code: 'feature_work_limit', message: `${normalized.label} exceeds the ${normalized.maxWorkUnits.toLocaleString()}-unit validation limit.` });
      }
      break;
    }
    inspectedFeatureCount += 1;
    featureWorkUnits = Math.min(normalized.maxWorkUnits + 1, featureWorkUnits + 1);
    const path = `${normalized.label}[${featureIndex}]`;
    if (!isPlainRecord(rawFeature)) {
      addIssue({ code: 'invalid_feature', message: `${path} must be a plain feature object.`, featureIndex });
      continue;
    }

    const feature = rawFeature;
    let invalid = false;
    const id = ownDataValue(feature, 'id');
    const name = ownDataValue(feature, 'name');
    const type = ownDataValue(feature, 'type');
    const color = ownDataValue(feature, 'color');
    const strand = ownDataValue(feature, 'strand');
    const start = ownDataValue(feature, 'start');
    const end = ownDataValue(feature, 'end');
    const metadata = ownDataValue(feature, 'metadata');
    const subRanges = ownDataValue(feature, 'subRanges');
    if ([id, name, type, color, strand, start, end, metadata, subRanges].some((value) => value === INVALID_ACCESSOR)) {
      invalid = true;
      addIssue({ code: 'invalid_feature', message: `${path} must not contain accessor properties.`, featureIndex });
    }
    if (!boundedString(id, MAX_FEATURE_METADATA_STRING_LENGTH)) {
      invalid = true;
      addIssue({ code: 'invalid_feature', message: `${path}.id must be a bounded non-empty string.`, featureIndex });
    }
    if (!boundedString(name, MAX_FEATURE_METADATA_STRING_LENGTH)) {
      invalid = true;
      addIssue({ code: 'invalid_feature', message: `${path}.name must be a bounded non-empty string.`, featureIndex });
    }
    if (!boundedString(type, MAX_FEATURE_METADATA_STRING_LENGTH)) {
      invalid = true;
      addIssue({ code: 'invalid_feature', message: `${path}.type must be a bounded non-empty string.`, featureIndex });
    }
    if (typeof color !== 'string' || color.length > MAX_FEATURE_METADATA_STRING_LENGTH || hasControlCharacters(color)) {
      invalid = true;
      addIssue({ code: 'invalid_feature', message: `${path}.color must be a bounded string without control characters.`, featureIndex });
    }
    if (strand !== -1 && strand !== 0 && strand !== 1) {
      invalid = true;
      addIssue({ code: 'invalid_feature', message: `${path}.strand must be -1, 0, or 1.`, featureIndex });
    }
    const validCoordinate = (coordinate: unknown): coordinate is number => (
      Number.isSafeInteger(coordinate)
      && (coordinate as number) >= 0
      && (normalized.sequenceLength < 0 || (coordinate as number) <= normalized.sequenceLength)
    );
    const wraps = normalized.allowCircularWrap
      && validCoordinate(start)
      && validCoordinate(end)
      && (start as number) > (end as number);
    if (!validCoordinate(start) || !validCoordinate(end) || (start === end) || ((end as number) < (start as number) && !wraps)) {
      invalid = true;
      addIssue({ code: 'invalid_feature', message: `${path} must have safe integer coordinates within the source sequence.`, featureIndex });
    }

    if (!isPlainRecord(metadata)) {
      invalid = true;
      addIssue({ code: 'invalid_feature', message: `${path}.metadata must be a plain object.`, featureIndex });
    } else {
      const metadataResult = validateMetadata(metadata, `${path}.metadata`, normalized);
      featureWorkUnits = Math.min(normalized.maxWorkUnits + 1, featureWorkUnits + metadataResult.units);
      if (metadataResult.issues.length > 0) {
        invalid = true;
        complete &&= metadataResult.complete;
        for (const message of metadataResult.issues) addIssue({ code: 'metadata_limit', message, featureIndex });
      }
    }

    if (subRanges !== undefined) {
      let subrangeCount: number | null = null;
      if (Array.isArray(subRanges)) {
        try {
          subrangeCount = subRanges.length;
        } catch {
          subrangeCount = null;
        }
      }
      if (subrangeCount === null || subrangeCount === 0) {
        invalid = true;
        addIssue({ code: 'invalid_subrange', message: `${path}.subRanges must be a non-empty array when provided.`, featureIndex });
      } else if (subrangeCount > normalized.maxSubrangesPerFeature) {
        invalid = true;
        complete = false;
        addIssue({ code: 'subrange_limit', message: `${path}.subRanges exceeds the ${normalized.maxSubrangesPerFeature.toLocaleString()}-piece limit.`, featureIndex });
      } else {
        const boundedSubRanges = subRanges as unknown[];
        featureWorkUnits = Math.min(normalized.maxWorkUnits + 1, featureWorkUnits + subrangeCount);
        for (let subrangeIndex = 0; subrangeIndex < subrangeCount; subrangeIndex += 1) {
          let rawRange: unknown;
          try {
            const descriptor = Object.getOwnPropertyDescriptor(boundedSubRanges, String(subrangeIndex));
            rawRange = descriptor && 'value' in descriptor ? descriptor.value : undefined;
          } catch {
            rawRange = undefined;
          }
          const rangePath = `${path}.subRanges[${subrangeIndex}]`;
          if (!isPlainRecord(rawRange)) {
            invalid = true;
            addIssue({ code: 'invalid_subrange', message: `${rangePath} must be a plain object.`, featureIndex, subrangeIndex });
            continue;
          }
          const rangeStart = ownDataValue(rawRange, 'start');
          const rangeEnd = ownDataValue(rawRange, 'end');
          const rangeStrand = ownDataValue(rawRange, 'strand');
          if (rangeStart === INVALID_ACCESSOR || rangeEnd === INVALID_ACCESSOR || rangeStrand === INVALID_ACCESSOR) {
            invalid = true;
            addIssue({ code: 'invalid_subrange', message: `${rangePath} must not contain accessor properties.`, featureIndex, subrangeIndex });
            continue;
          }
          if (!validCoordinate(rangeStart) || !validCoordinate(rangeEnd) || (rangeEnd as number) <= (rangeStart as number)) {
            invalid = true;
            addIssue({ code: 'invalid_subrange', message: `${rangePath} must have safe, positive coordinates within the source sequence.`, featureIndex, subrangeIndex });
          } else if (validCoordinate(start) && validCoordinate(end)) {
            const rangeStartValue = rangeStart as number;
            const rangeEndValue = rangeEnd as number;
            const startValue = start as number;
            const endValue = end as number;
            const remainsInsideEnvelope = wraps
              ? normalized.sequenceLength >= 0
                && ((rangeStartValue >= startValue && rangeEndValue <= normalized.sequenceLength)
                  || (rangeStartValue >= 0 && rangeEndValue <= endValue))
              : rangeStartValue >= startValue && rangeEndValue <= endValue;
            if (!remainsInsideEnvelope) {
              invalid = true;
              addIssue({
                code: 'invalid_subrange',
                message: wraps
                  ? `${rangePath} must remain wholly inside the tail [${startValue}, ${normalized.sequenceLength}) or head [0, ${endValue}) of the wrapped feature envelope.`
                  : `${rangePath} must remain inside the feature envelope.`,
                featureIndex,
                subrangeIndex,
              });
            }
          }
          if (rangeStrand !== undefined && rangeStrand !== -1 && rangeStrand !== 0 && rangeStrand !== 1) {
            invalid = true;
            addIssue({ code: 'invalid_subrange', message: `${rangePath}.strand must be -1, 0, or 1 when provided.`, featureIndex, subrangeIndex });
          }
          if (featureWorkUnits >= normalized.maxWorkUnits || issues.length >= MAX_FEATURE_VALIDATION_ISSUES) {
            complete = false;
            if (featureWorkUnits >= normalized.maxWorkUnits) {
              addIssue({ code: 'feature_work_limit', message: `${normalized.label} exceeds the ${normalized.maxWorkUnits.toLocaleString()}-unit validation limit.`, featureIndex, subrangeIndex });
            }
            break;
          }
        }
      }
    }
    if (invalid) complete = false;
    if (featureWorkUnits > normalized.maxWorkUnits) {
      complete = false;
      addIssue({ code: 'feature_work_limit', message: `${normalized.label} exceeds the ${normalized.maxWorkUnits.toLocaleString()}-unit validation limit.`, featureIndex });
      break;
    }
  }

  const truncatedByIssueCap = issues.length >= MAX_FEATURE_VALIDATION_ISSUES;
  if (truncatedByIssueCap) complete = false;
  return {
    valid: issues.length === 0,
    issues,
    featureCount,
    inspectedFeatureCount,
    featureWorkUnits,
    complete,
  };
}

/** Throw a typed boundary error for agent-facing callers that require validity. */
export function assertFeatureCollection(
  features: unknown,
  options: FeatureValidationOptions = {},
): asserts features is Feature[] {
  const validation = validateFeatureCollection(features, options);
  if (!validation.valid) throw new FeatureCollectionInputError(validation);
}
