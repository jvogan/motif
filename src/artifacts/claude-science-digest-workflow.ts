import type { DigestFragment } from '../bio/restriction-digest';
import { VALID_NCBI_TABLE_IDS } from '../bio/codon-tables';
import { cloneCanonicalFeature, validateFeatureCollection } from '../bio/feature-bounds';
import {
  expandCircularFeatureLocation,
  remapFeatureLocation,
  type FeatureCoordinateMapSpan,
  type RemappedFeatureLocation,
} from '../bio/feature-location';
import type {
  Feature,
  RestrictionEnzyme,
  RestrictionMethylationAssumptions,
  SequenceType,
  Topology,
} from '../bio/types';
import {
  isActiveDoubleStrandRestrictionSite,
  MAX_RESTRICTION_ENZYMES,
  MAX_RESTRICTION_RESULT_SITES,
  normalizeRestrictionEnzymeNames,
  normalizeRestrictionEnzymes,
} from '../bio/restriction-sites';
import {
  buildDigestRecipe,
  type DigestRecipe,
} from './claude-science-digest-recipe';
import {
  MAX_ARTIFACT_ID_LENGTH,
  MAX_ARTIFACT_WORKFLOW_NAME_LENGTH,
  normalizeArtifactWorkflowResults,
  type ArtifactJsonObject,
  type ArtifactProvenance,
  type ArtifactWorkflowResult,
} from './claude-science-workspace-collections';

/** Matches the standalone artifact's per-record sequence ceiling. */
export const MAX_DIGEST_WORKFLOW_SEQUENCE_LENGTH = 250_000;
/** One source plus at most 99 derived records fits the artifact's 100-record workspace. */
export const MAX_DIGEST_WORKFLOW_FRAGMENTS = 99;
export const MAX_DIGEST_WORKFLOW_RECORDS = 100;
export const MAX_DIGEST_WORKFLOW_FEATURES_PER_RECORD = 2_000;
export const MAX_DIGEST_WORKFLOW_RECORD_NAME_LENGTH = 1_024;
const MAX_DIGEST_WORKFLOW_DESCRIPTION_LENGTH = 16_384;
const MAX_DIGEST_WORKFLOW_TAGS = 100;
const MAX_DIGEST_WORKFLOW_TAG_LENGTH = 256;

const MAX_METADATA_DEPTH = 12;
const MAX_METADATA_NODES = 10_000;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DNA_ALPHABET = /^[ACGTRYSWKMBDHVN]+$/i;
const OVERHANG_TYPES = new Set(['blunt', '5prime', '3prime']);
const METHYLATION_STATES = new Set(['unknown', 'methylated', 'unmethylated']);
const METHYLATION_TARGETS = new Set(['dam', 'dcm', 'cpg', 'custom']);
const INVALID_DATA_PROPERTY = Symbol('invalid-data-property');

export type DigestWorkflowErrorCode =
  | 'inactive-source'
  | 'invalid-source'
  | 'invalid-recipe'
  | 'incoherent-recipe'
  | 'resource-limit'
  | 'identity-count'
  | 'duplicate-id'
  | 'duplicate-name';

export class DigestWorkflowMaterializationError extends Error {
  readonly code: DigestWorkflowErrorCode;

  constructor(code: DigestWorkflowErrorCode, message: string) {
    super(message);
    this.name = 'DigestWorkflowMaterializationError';
    this.code = code;
  }
}

/**
 * Structural subset of the artifact's normalized active record. Keeping this
 * interface local avoids coupling a pure workflow helper to the React module's
 * private ArtifactVector type.
 */
export type DigestWorkflowSourceRecord = {
  id: string;
  name: string;
  sequence: string;
  type: SequenceType;
  topology: Topology;
  translationTableId?: number;
  active: boolean;
  features?: readonly Feature[];
  description?: string;
  organism?: string;
  source?: string;
  group?: string;
  tags?: readonly string[];
};

export type DigestFragmentRecordIdentity = {
  /** Caller-owned durable id. When omitted as a collection, ids derive from workflow.id. */
  id: string;
  /** Caller-owned display name. Omit to use the deterministic fragment name. */
  name?: string;
};

export type DigestWorkflowMetadata = {
  id: string;
  createdAt: string;
  name?: string;
  inputSha256?: string;
  source?: string;
  actor?: string;
  engine?: string;
  engineVersion?: string;
};

export type MaterializeDigestWorkflowInput = {
  sourceRecord: DigestWorkflowSourceRecord;
  recipe: DigestRecipe;
  /** Authoritative catalog used to reproduce and verify the submitted recipe. */
  enzymeCatalog: readonly RestrictionEnzyme[];
  workflow: DigestWorkflowMetadata;
  /**
   * Must contain one identity per materialized output. Uncut digests create no
   * derived record and therefore accept only an omitted or empty list.
   */
  outputIdentities?: readonly DigestFragmentRecordIdentity[];
  /** Used only when outputIdentities is omitted. Defaults to workflow.id. */
  outputIdPrefix?: string;
  /** Used by deterministic default names. Defaults to sourceRecord.name. */
  outputNamePrefix?: string;
  /** Optional collision index from the current workspace. */
  existingRecordIds?: readonly string[];
  /** Optional case-insensitive collision index from the current workspace. */
  existingRecordNames?: readonly string[];
  /** Serialized `source` field on each derived record. */
  derivedRecordSource?: string;
};

export type DigestDerivedRecordProvenance = ArtifactJsonObject & {
  parentRecordId: string;
  operation: 'restriction_digest';
  workflowResultId: string;
  fragmentIndex: number;
  fragmentCount: number;
  sourceTopology: Topology;
  startInOriginal: number;
  endInOriginal: number;
  wrapsOrigin: boolean;
  leftEnzyme: string | null;
  rightEnzyme: string | null;
  leftEnzymes?: string[];
  rightEnzymes?: string[];
  overhang5: string;
  overhang3: string;
  overhang5Type: 'blunt' | '5prime' | '3prime';
  overhang3Type: 'blunt' | '5prime' | '3prime';
  enzymes: string[];
  translationTableId?: number;
};

/** Compatible with the artifact's private ArtifactRecordInput contract. */
export type DigestDerivedRecordInput = {
  id: string;
  name: string;
  description: string;
  molecule: 'dna';
  topology: 'linear';
  translationTableId?: number;
  seq: string;
  length: number;
  /** Empty string is an explicit blunt end; omission is reserved for unknown geometry. */
  overhang5: string;
  overhang3: string;
  overhang5Type: 'blunt' | '5prime' | '3prime';
  overhang3Type: 'blunt' | '5prime' | '3prime';
  annotations: Feature[];
  organism?: string;
  source: string;
  group?: string;
  dateAdded: string;
  tags?: string[];
  active: true;
  provenance: DigestDerivedRecordProvenance;
};

export type MaterializedDigestWorkflow = {
  records: DigestDerivedRecordInput[];
  workflowResult: ArtifactWorkflowResult & { kind: 'digest' };
};

type JsonCloneBudget = { nodes: number };

function fail(code: DigestWorkflowErrorCode, message: string): never {
  throw new DigestWorkflowMaterializationError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownDataProperty(
  value: Record<string, unknown>,
  key: string,
): unknown | typeof INVALID_DATA_PROPERTY {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!('value' in descriptor)) return INVALID_DATA_PROPERTY;
    return descriptor.value;
  } catch {
    return INVALID_DATA_PROPERTY;
  }
}

function boundedArrayLength(
  value: unknown,
  label: string,
  maximum: number,
  code: DigestWorkflowErrorCode = 'invalid-recipe',
): number {
  if (!Array.isArray(value)) fail(code, `${label} must be an array.`);
  let length: number;
  try {
    length = value.length;
  } catch {
    fail(code, `${label} could not be inspected safely.`);
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    fail(code, `${label} has an invalid length.`);
  }
  if (length > maximum) {
    fail('resource-limit', `${label} cannot exceed ${maximum.toLocaleString()} entries.`);
  }
  return length;
}

function boundedDenseArray(
  value: unknown,
  label: string,
  maximum: number,
  code: DigestWorkflowErrorCode = 'invalid-recipe',
): unknown[] {
  const length = boundedArrayLength(value, label, maximum, code);
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      fail(code, `${label}[${index}] could not be inspected safely.`);
    }
    if (!descriptor || !('value' in descriptor)) {
      fail(code, `${label} must be dense and contain only direct data entries.`);
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function boundedStringArray(
  value: unknown,
  label: string,
  maximum: number,
  maximumStringLength: number,
  code: DigestWorkflowErrorCode,
): string[] {
  return boundedDenseArray(value, label, maximum, code).map((entry, index) => {
    if (typeof entry !== 'string') fail(code, `${label} entry ${index + 1} must be a string.`);
    if (entry.length > maximumStringLength) {
      fail(
        'resource-limit',
        `${label} entry ${index + 1} cannot exceed ${maximumStringLength.toLocaleString()} characters.`,
      );
    }
    return entry;
  });
}

function snapshotOutputIdentities(value: unknown): DigestFragmentRecordIdentity[] | undefined {
  if (value === undefined) return undefined;
  return boundedDenseArray(
    value,
    'Digest output identities',
    MAX_DIGEST_WORKFLOW_FRAGMENTS,
  ).map((entry, index) => {
    if (!isPlainObject(entry)) {
      fail('invalid-recipe', `Digest output identity ${index + 1} must be a plain object.`);
    }
    const id = ownDataProperty(entry, 'id');
    const name = ownDataProperty(entry, 'name');
    if (id === INVALID_DATA_PROPERTY || name === INVALID_DATA_PROPERTY) {
      fail('invalid-recipe', `Digest output identity ${index + 1} must contain direct data.`);
    }
    return {
      ...(id === undefined ? {} : { id: id as string }),
      ...(name === undefined ? {} : { name: name as string }),
    } as DigestFragmentRecordIdentity;
  });
}

function snapshotDigestWorkflowMetadata(value: unknown): DigestWorkflowMetadata {
  if (!isPlainObject(value)) fail('invalid-recipe', 'Digest workflow metadata must be a plain object.');
  const read = (key: string, required: boolean): unknown => {
    const property = ownDataProperty(value, key);
    if (property === INVALID_DATA_PROPERTY) {
      fail('invalid-recipe', `Digest workflow.${key} must be a direct data property.`);
    }
    if (required && property === undefined) {
      fail('invalid-recipe', `Digest workflow.${key} is required.`);
    }
    return property;
  };
  const id = boundedText(read('id', true), 'Digest workflow id', MAX_ARTIFACT_ID_LENGTH, 'invalid-recipe');
  const createdAt = boundedText(read('createdAt', true), 'Digest workflow createdAt', 256, 'invalid-recipe');
  const inputSha256 = read('inputSha256', false);
  const name = read('name', false);
  const source = read('source', false);
  const actor = read('actor', false);
  const engine = read('engine', false);
  const engineVersion = read('engineVersion', false);
  return {
    id,
    createdAt,
    ...(inputSha256 === undefined ? {} : { inputSha256: inputSha256 as string }),
    ...(name === undefined ? {} : { name: name as string }),
    ...(source === undefined ? {} : { source: source as string }),
    ...(actor === undefined ? {} : { actor: actor as string }),
    ...(engine === undefined ? {} : { engine: engine as string }),
    ...(engineVersion === undefined ? {} : { engineVersion: engineVersion as string }),
  };
}

function snapshotDigestWorkflowSourceRecord(value: unknown): DigestWorkflowSourceRecord {
  if (!isPlainObject(value)) fail('invalid-source', 'Digest source record must be a plain object.');
  const read = (key: string, required: boolean): unknown => {
    const property = ownDataProperty(value, key);
    if (property === INVALID_DATA_PROPERTY) {
      fail('invalid-source', `Digest source record.${key} must be a direct data property.`);
    }
    if (required && property === undefined) {
      fail('invalid-source', `Digest source record.${key} is required.`);
    }
    return property;
  };
  const id = read('id', true);
  const name = read('name', true);
  const sequence = read('sequence', true);
  const type = read('type', true);
  const topology = read('topology', true);
  const active = read('active', true);
  const translationTableId = read('translationTableId', false);
  const features = read('features', false);
  const description = read('description', false);
  const organism = read('organism', false);
  const source = read('source', false);
  const group = read('group', false);
  const tags = read('tags', false);
  if (typeof active !== 'boolean') {
    fail('invalid-source', 'Digest source record.active must be a boolean.');
  }
  if (translationTableId !== undefined && (
    !Number.isSafeInteger(translationTableId)
    || !VALID_NCBI_TABLE_IDS.includes(translationTableId as number)
  )) {
    fail('invalid-source', 'Digest source record.translationTableId must be a supported NCBI genetic-code id.');
  }
  const optionalText = (candidate: unknown, key: string, maximum: number): string | undefined => {
    if (candidate === undefined) return undefined;
    if (typeof candidate !== 'string') {
      fail('invalid-source', `Digest source record.${key} must be a string.`);
    }
    if (candidate.length > maximum) {
      fail('resource-limit', `Digest source record.${key} cannot exceed ${maximum.toLocaleString()} characters.`);
    }
    return candidate;
  };
  const normalizedDescription = optionalText(description, 'description', MAX_DIGEST_WORKFLOW_DESCRIPTION_LENGTH);
  const normalizedOrganism = optionalText(organism, 'organism', MAX_DIGEST_WORKFLOW_RECORD_NAME_LENGTH);
  const normalizedSource = optionalText(source, 'source', MAX_DIGEST_WORKFLOW_RECORD_NAME_LENGTH);
  const normalizedGroup = optionalText(group, 'group', MAX_DIGEST_WORKFLOW_RECORD_NAME_LENGTH);
  return {
    id: id as string,
    name: name as string,
    sequence: sequence as string,
    type: type as 'dna',
    topology: topology as Topology,
    active,
    ...(translationTableId === undefined ? {} : { translationTableId: translationTableId as number }),
    ...(features === undefined ? {} : { features: features as readonly Feature[] }),
    ...(normalizedDescription === undefined ? {} : { description: normalizedDescription }),
    ...(normalizedOrganism === undefined ? {} : { organism: normalizedOrganism }),
    ...(normalizedSource === undefined ? {} : { source: normalizedSource }),
    ...(normalizedGroup === undefined ? {} : { group: normalizedGroup }),
    ...(tags === undefined ? {} : { tags: tags as readonly string[] }),
  };
}

function snapshotMaterializeDigestWorkflowInput(value: unknown): MaterializeDigestWorkflowInput {
  if (!isPlainObject(value)) {
    fail('invalid-recipe', 'Digest workflow input must be a plain object.');
  }
  const read = (key: string, required: boolean): unknown => {
    const property = ownDataProperty(value, key);
    if (property === INVALID_DATA_PROPERTY) {
      fail('invalid-recipe', `Digest workflow input.${key} must be a direct data property.`);
    }
    if (required && property === undefined) {
      fail('invalid-recipe', `Digest workflow input.${key} is required.`);
    }
    return property;
  };
  const sourceRecord = read('sourceRecord', true);
  const recipe = read('recipe', true);
  const enzymeCatalog = read('enzymeCatalog', true);
  const workflow = read('workflow', true);
  const outputIdentities = read('outputIdentities', false);
  const outputIdPrefix = read('outputIdPrefix', false);
  const outputNamePrefix = read('outputNamePrefix', false);
  const existingRecordIds = read('existingRecordIds', false);
  const existingRecordNames = read('existingRecordNames', false);
  const derivedRecordSource = read('derivedRecordSource', false);

  return {
    sourceRecord: snapshotDigestWorkflowSourceRecord(sourceRecord),
    recipe: recipe as DigestRecipe,
    enzymeCatalog: enzymeCatalog as readonly RestrictionEnzyme[],
    workflow: snapshotDigestWorkflowMetadata(workflow),
    ...(outputIdentities === undefined ? {} : { outputIdentities: snapshotOutputIdentities(outputIdentities) }),
    ...(outputIdPrefix === undefined ? {} : { outputIdPrefix: outputIdPrefix as string }),
    ...(outputNamePrefix === undefined ? {} : { outputNamePrefix: outputNamePrefix as string }),
    ...(existingRecordIds === undefined ? {} : { existingRecordIds: existingRecordIds as readonly string[] }),
    ...(existingRecordNames === undefined ? {} : { existingRecordNames: existingRecordNames as readonly string[] }),
    ...(derivedRecordSource === undefined ? {} : { derivedRecordSource: derivedRecordSource as string }),
  };
}

function normalizeMethylationAssumptions(value: unknown): RestrictionMethylationAssumptions | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (!METHYLATION_STATES.has(value)) {
      fail('invalid-recipe', 'Digest methylation assumptions contain an invalid state.');
    }
    return value as RestrictionMethylationAssumptions;
  }
  if (!isPlainObject(value)) {
    fail('invalid-recipe', 'Digest methylation assumptions must be a state or a plain target-state object.');
  }
  const entries: Array<{ key: string; descriptor: PropertyDescriptor }> = [];
  try {
    for (const key in value) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) continue;
      if (entries.length >= METHYLATION_TARGETS.size) {
        fail('invalid-recipe', 'Digest methylation assumptions contain too many targets.');
      }
      entries.push({ key, descriptor });
    }
  } catch (error) {
    if (error instanceof DigestWorkflowMaterializationError) throw error;
    fail('invalid-recipe', 'Digest methylation assumptions could not be inspected safely.');
  }
  const normalized: Partial<Record<'dam' | 'dcm' | 'cpg' | 'custom', 'unknown' | 'methylated' | 'unmethylated'>> = {};
  for (const { key, descriptor } of entries) {
    if (!METHYLATION_TARGETS.has(key)) {
      fail('invalid-recipe', `Digest methylation assumptions contain unknown target "${key}".`);
    }
    if (!('value' in descriptor) || typeof descriptor.value !== 'string' || !METHYLATION_STATES.has(descriptor.value)) {
      fail('invalid-recipe', `Digest methylation target "${key}" has an invalid state.`);
    }
    normalized[key as keyof typeof normalized] = descriptor.value as 'unknown' | 'methylated' | 'unmethylated';
  }
  return normalized;
}

function cloneJsonValue(value: unknown, path: string, depth: number, budget: JsonCloneBudget): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_METADATA_NODES) {
    fail('resource-limit', `Digest feature metadata exceeds ${MAX_METADATA_NODES.toLocaleString()} JSON nodes.`);
  }
  if (depth > MAX_METADATA_DEPTH) {
    fail('resource-limit', `Digest feature metadata exceeds ${MAX_METADATA_DEPTH} nested levels.`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid-source', `${path} must contain finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`, depth + 1, budget));
  }
  if (!isPlainObject(value)) fail('invalid-source', `${path} must contain JSON-safe data.`);
  const clone: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) fail('invalid-source', `${path}.${key} is not a safe metadata key.`);
    if (entry === undefined) continue;
    clone[key] = cloneJsonValue(entry, `${path}.${key}`, depth + 1, budget);
  }
  return clone;
}

function boundedText(
  value: unknown,
  label: string,
  maxLength: number,
  code: DigestWorkflowErrorCode = 'invalid-source',
): string {
  if (typeof value !== 'string') fail(code, `${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized) fail(code, `${label} must not be blank.`);
  if (normalized.length > maxLength) {
    fail(code, `${label} cannot exceed ${maxLength.toLocaleString()} characters.`);
  }
  return normalized;
}

function validateSourceRecord(record: DigestWorkflowSourceRecord): void {
  boundedText(record.id, 'Source record id', MAX_ARTIFACT_ID_LENGTH);
  boundedText(record.name, 'Source record name', MAX_DIGEST_WORKFLOW_RECORD_NAME_LENGTH);
  if (!record.active) fail('inactive-source', 'Restriction digest requires an active source record.');
  if (record.type !== 'dna') fail('invalid-source', 'Restriction digest can materialize DNA records only.');
  if (record.topology !== 'linear' && record.topology !== 'circular') {
    fail('invalid-source', 'Source topology must be linear or circular.');
  }
  if (typeof record.sequence !== 'string' || record.sequence.length === 0) {
    fail('invalid-source', 'Source DNA sequence must not be empty.');
  }
  if (record.sequence.length > MAX_DIGEST_WORKFLOW_SEQUENCE_LENGTH) {
    fail(
      'resource-limit',
      `Source DNA cannot exceed ${MAX_DIGEST_WORKFLOW_SEQUENCE_LENGTH.toLocaleString()} bases.`,
    );
  }
  if (!DNA_ALPHABET.test(record.sequence)) {
    fail('invalid-source', 'Source DNA contains characters outside the supported IUPAC alphabet.');
  }
}

function snapshotSourceFeatures(record: DigestWorkflowSourceRecord): Feature[] {
  const validation = validateFeatureCollection(record.features, {
    label: 'Digest workflow source features',
    sequenceLength: record.sequence.length,
    allowCircularWrap: record.topology === 'circular',
    maxFeatures: MAX_DIGEST_WORKFLOW_FEATURES_PER_RECORD,
  });
  if (!validation.valid) {
    const resourceLimited = validation.issues.some((issue) => (
      issue.code === 'feature_limit'
      || issue.code === 'subrange_limit'
      || issue.code === 'metadata_limit'
      || issue.code === 'feature_work_limit'
    ));
    fail(
      resourceLimited ? 'resource-limit' : 'invalid-source',
      validation.issues.map((issue) => issue.message).join(' '),
    );
  }

  const budget: JsonCloneBudget = { nodes: 0 };
  const features = record.features ?? [];
  const snapshot: Feature[] = [];
  for (let index = 0; index < features.length; index += 1) {
    const featureDescriptor = Object.getOwnPropertyDescriptor(features, String(index));
    if (!featureDescriptor || !('value' in featureDescriptor) || !isPlainObject(featureDescriptor.value)) {
      fail('invalid-source', `Digest workflow source feature ${index + 1} changed during validation.`);
    }
    const feature = featureDescriptor.value as unknown as Feature;
    const subRanges: Feature['subRanges'] = [];
    for (let rangeIndex = 0; rangeIndex < (feature.subRanges?.length ?? 0); rangeIndex += 1) {
      const rangeDescriptor = Object.getOwnPropertyDescriptor(feature.subRanges, String(rangeIndex));
      if (!rangeDescriptor || !('value' in rangeDescriptor) || !isPlainObject(rangeDescriptor.value)) {
        fail('invalid-source', `Digest workflow source feature ${index + 1} sub-range ${rangeIndex + 1} changed during validation.`);
      }
      const range = rangeDescriptor?.value as NonNullable<Feature['subRanges']>[number];
      subRanges.push({
        start: range.start,
        end: range.end,
        ...(range.strand === undefined ? {} : { strand: range.strand }),
      });
    }
    snapshot.push({
      id: feature.id,
      name: feature.name,
      type: feature.type,
      start: feature.start,
      end: feature.end,
      strand: feature.strand,
      color: feature.color,
      metadata: cloneJsonValue(
        feature.metadata,
        `sourceRecord.features[${index}].metadata`,
        0,
        budget,
      ) as Record<string, unknown>,
      ...(feature.subRanges === undefined ? {} : { subRanges }),
    });
  }
  return snapshot;
}

function sameStringArray(candidate: unknown, expected: readonly string[], label: string): boolean {
  const values = boundedDenseArray(candidate, label, MAX_RESTRICTION_ENZYMES);
  return values.length === expected.length
    && values.every((value, index) => value === expected[index]);
}

function fragmentMatches(
  candidate: unknown,
  expected: DigestFragment,
  index: number,
): boolean {
  if (!isPlainObject(candidate)) return false;
  const label = `Digest recipe fragment ${index + 1}`;
  const value = (key: string): unknown => ownDataProperty(candidate, key);
  const leftEnzymes = value('leftEnzymes');
  const rightEnzymes = value('rightEnzymes');
  if (leftEnzymes === INVALID_DATA_PROPERTY || rightEnzymes === INVALID_DATA_PROPERTY) return false;
  const expectedLeft = expected.leftEnzymes ?? [];
  const expectedRight = expected.rightEnzymes ?? [];
  const leftMatches = leftEnzymes === undefined
    ? expectedLeft.length === 0
    : sameStringArray(leftEnzymes, expectedLeft, `${label} left enzymes`);
  const rightMatches = rightEnzymes === undefined
    ? expectedRight.length === 0
    : sameStringArray(rightEnzymes, expectedRight, `${label} right enzymes`);
  return leftMatches
    && rightMatches
    && value('sequence') === expected.sequence
    && value('length') === expected.length
    && value('startInOriginal') === expected.startInOriginal
    && value('endInOriginal') === expected.endInOriginal
    && value('leftEnzyme') === expected.leftEnzyme
    && value('rightEnzyme') === expected.rightEnzyme
    && value('overhang5') === expected.overhang5
    && value('overhang3') === expected.overhang3
    && value('overhang5Type') === expected.overhang5Type
    && value('overhang3Type') === expected.overhang3Type;
}

/**
 * Treat a caller-provided recipe as an untrusted receipt. Only bounded enzyme
 * names and assumptions are read from it; authoritative definitions come from
 * the separately supplied catalog, and physical geometry is recomputed.
 */
function rebuildAndVerifyRecipe(
  source: DigestWorkflowSourceRecord,
  candidate: DigestRecipe,
  trustedCatalog: readonly RestrictionEnzyme[],
): DigestRecipe {
  if (!isPlainObject(candidate)) fail('invalid-recipe', 'Digest recipe must be a plain object.');
  if (ownDataProperty(candidate, 'isValid') !== true
    || ownDataProperty(candidate, 'sequenceType') !== source.type
    || ownDataProperty(candidate, 'topology') !== source.topology) {
    fail('invalid-recipe', 'Digest recipe validity, molecule type, or topology no longer matches the source record.');
  }
  const rawEntries = boundedDenseArray(
    ownDataProperty(candidate, 'enzymes'),
    'Digest recipe enzymes',
    MAX_RESTRICTION_ENZYMES,
  );
  if (rawEntries.length === 0) fail('invalid-recipe', 'Digest recipe must contain at least one enzyme.');
  const rawNames = rawEntries.map((entry, index) => {
    if (!isPlainObject(entry)) {
      fail('invalid-recipe', `Digest recipe enzyme ${index + 1} must be a plain object.`);
    }
    const name = ownDataProperty(entry, 'name');
    if (name === INVALID_DATA_PROPERTY || name === undefined) {
      fail('invalid-recipe', `Digest recipe enzyme ${index + 1} must contain a direct name.`);
    }
    return name;
  });

  let requestedNames;
  let enzymeCatalog;
  try {
    requestedNames = normalizeRestrictionEnzymeNames(rawNames);
    enzymeCatalog = normalizeRestrictionEnzymes(trustedCatalog);
  } catch (error) {
    fail('invalid-recipe', error instanceof Error ? error.message : 'Digest recipe enzyme inputs are invalid.');
  }
  const rawAssumptions = ownDataProperty(candidate, 'methylationAssumptions');
  if (rawAssumptions === INVALID_DATA_PROPERTY) {
    fail('invalid-recipe', 'Digest methylation assumptions must be direct data.');
  }
  const methylationAssumptions = normalizeMethylationAssumptions(rawAssumptions);
  const canonical = buildDigestRecipe({
    sequence: source.sequence,
    sequenceType: source.type,
    topology: source.topology,
    enzymeText: requestedNames.join(', '),
    enzymeCatalog,
    features: source.features,
    methylationAssumptions,
  });
  if (!canonical.isValid) {
    fail('invalid-recipe', 'Digest recipe could not be reproduced from the current source and bounded enzyme data.');
  }

  const suppliedFragments = boundedDenseArray(
    ownDataProperty(candidate, 'fragments'),
    'Digest recipe fragments',
    MAX_DIGEST_WORKFLOW_FRAGMENTS,
  );
  const suppliedSites = ownDataProperty(candidate, 'sites');
  if (!Array.isArray(suppliedSites)) fail('invalid-recipe', 'Digest recipe sites must be an array.');
  let suppliedSiteCount: number;
  try {
    suppliedSiteCount = suppliedSites.length;
  } catch {
    fail('invalid-recipe', 'Digest recipe sites could not be inspected safely.');
  }
  if (suppliedSiteCount > MAX_RESTRICTION_RESULT_SITES) {
    fail(
      'resource-limit',
      `Digest recipe sites cannot exceed ${MAX_RESTRICTION_RESULT_SITES.toLocaleString()} entries.`,
    );
  }

  const sameReceipt = ownDataProperty(candidate, 'isValid') === true
    && ownDataProperty(candidate, 'sequenceType') === canonical.sequenceType
    && ownDataProperty(candidate, 'topology') === canonical.topology
    && ownDataProperty(candidate, 'outcome') === canonical.outcome
    && ownDataProperty(candidate, 'cutCount') === canonical.cutCount
    && ownDataProperty(candidate, 'recognitionSiteCount') === canonical.recognitionSiteCount
    && suppliedSiteCount === canonical.sites.length
    && suppliedFragments.length === canonical.fragments.length
    && suppliedFragments.every((fragment, index) => fragmentMatches(fragment, canonical.fragments[index], index));
  if (!sameReceipt) {
    fail('incoherent-recipe', 'Digest recipe no longer matches a fresh bounded digest of the source record.');
  }
  return canonical;
}

function readCircularSequence(sequence: string, start: number, length: number): string {
  if (length === 0) return '';
  const normalizedStart = ((start % sequence.length) + sequence.length) % sequence.length;
  const firstLength = Math.min(length, sequence.length - normalizedStart);
  return sequence.slice(normalizedStart, normalizedStart + firstLength)
    + sequence.slice(0, length - firstLength);
}

function expectedFragmentSequence(
  source: DigestWorkflowSourceRecord,
  fragment: DigestFragment,
  index: number,
): string {
  if (!Number.isInteger(fragment.startInOriginal) || fragment.startInOriginal < 0) {
    fail('incoherent-recipe', `Digest fragment ${index + 1} has an invalid source start.`);
  }
  if (!Number.isInteger(fragment.endInOriginal) || fragment.endInOriginal <= fragment.startInOriginal) {
    fail('incoherent-recipe', `Digest fragment ${index + 1} has an invalid source end.`);
  }
  if (!Number.isInteger(fragment.length) || fragment.length <= 0) {
    fail('incoherent-recipe', `Digest fragment ${index + 1} must have a positive integer length.`);
  }
  if (fragment.length !== fragment.sequence.length) {
    fail('incoherent-recipe', `Digest fragment ${index + 1} length does not match its sequence.`);
  }
  if (source.topology === 'linear') {
    if (fragment.startInOriginal > source.sequence.length || fragment.endInOriginal > source.sequence.length) {
      fail('incoherent-recipe', `Linear digest fragment ${index + 1} falls outside the source DNA.`);
    }
    if (fragment.endInOriginal - fragment.startInOriginal !== fragment.length) {
      fail('incoherent-recipe', `Linear digest fragment ${index + 1} has inconsistent coordinates.`);
    }
    return source.sequence.slice(fragment.startInOriginal, fragment.endInOriginal);
  }

  if (fragment.startInOriginal >= source.sequence.length) {
    fail('incoherent-recipe', `Circular digest fragment ${index + 1} has an invalid source start.`);
  }
  if (fragment.endInOriginal !== fragment.startInOriginal + fragment.length) {
    fail('incoherent-recipe', `Circular digest fragment ${index + 1} has inconsistent wrap coordinates.`);
  }
  if (fragment.length > source.sequence.length) {
    fail('incoherent-recipe', `Circular digest fragment ${index + 1} exceeds the source molecule length.`);
  }
  return readCircularSequence(source.sequence, fragment.startInOriginal, fragment.length);
}

function validateFragmentEnds(fragment: DigestFragment, index: number, enzymeNames: ReadonlySet<string>): void {
  for (const [side, enzyme, enzymes] of [
    ['left', fragment.leftEnzyme, fragment.leftEnzymes],
    ['right', fragment.rightEnzyme, fragment.rightEnzymes],
  ] as const) {
    const identities = enzymes && enzymes.length > 0 ? enzymes : enzyme === null ? [] : [enzyme];
    for (const identity of identities) {
      if (!enzymeNames.has(identity)) {
        fail('incoherent-recipe', `Digest fragment ${index + 1} has an unknown ${side} enzyme "${identity}".`);
      }
    }
  }
  for (const [side, overhang, type] of [
    ['5′', fragment.overhang5, fragment.overhang5Type],
    ['3′', fragment.overhang3, fragment.overhang3Type],
  ] as const) {
    if (!OVERHANG_TYPES.has(type)) {
      fail('incoherent-recipe', `Digest fragment ${index + 1} has an invalid ${side} overhang type.`);
    }
    if (typeof overhang !== 'string' || (overhang && !DNA_ALPHABET.test(overhang))) {
      fail('incoherent-recipe', `Digest fragment ${index + 1} has an invalid ${side} overhang sequence.`);
    }
    if (type === 'blunt' && overhang !== '') {
      fail('incoherent-recipe', `Digest fragment ${index + 1} labels a non-empty ${side} overhang as blunt.`);
    }
    if (type !== 'blunt' && overhang.length === 0) {
      fail('incoherent-recipe', `Digest fragment ${index + 1} labels an empty ${side} overhang as sticky.`);
    }
  }
}

function validateRecipe(source: DigestWorkflowSourceRecord, recipe: DigestRecipe): void {
  if (!recipe.isValid || recipe.outcome === 'not-run') {
    fail('invalid-recipe', 'Digest workflow requires a validated recipe that has been run.');
  }
  if (recipe.sequenceType !== 'dna') fail('invalid-recipe', 'Digest recipe must target DNA.');
  if (recipe.topology !== source.topology) {
    fail('invalid-recipe', 'Digest recipe topology no longer matches the source record.');
  }
  if (recipe.issues.length > 0 || recipe.unresolvedNames.length > 0 || recipe.enzymes.length === 0) {
    fail('invalid-recipe', 'Digest recipe contains unresolved validation issues.');
  }
  if (recipe.featureMapping && !recipe.featureMapping.complete) {
    fail('resource-limit', 'Digest recipe annotation mapping exceeded its bounded work limit.');
  }
  if (recipe.fragments.length > MAX_DIGEST_WORKFLOW_FRAGMENTS) {
    fail(
      'resource-limit',
      `Digest produces ${recipe.fragments.length.toLocaleString()} fragments; the workflow limit is ${MAX_DIGEST_WORKFLOW_FRAGMENTS.toLocaleString()}.`,
    );
  }

  // Recognition sites that are nicks, methylation-conditional, or physically
  // out of bounds are not ordinary double-strand digest boundaries.
  const distinctCuts = new Set(recipe.sites
    .filter(isActiveDoubleStrandRestrictionSite)
    .map((site) => site.cutPosition));
  if (distinctCuts.size !== recipe.cutCount) {
    fail('incoherent-recipe', 'Digest recipe cut count does not match its distinct physical cut coordinates.');
  }
  if (recipe.outcome === 'uncut' && recipe.cutCount !== 0) {
    fail('incoherent-recipe', 'An uncut digest cannot contain physical cuts.');
  }
  if (recipe.outcome === 'linearized' && (source.topology !== 'circular' || recipe.cutCount !== 1)) {
    fail('incoherent-recipe', 'Only a one-cut circular digest can be labeled linearized.');
  }
  if (recipe.outcome === 'fragmented') {
    const minimumCuts = source.topology === 'circular' ? 2 : 1;
    if (recipe.cutCount < minimumCuts) {
      fail('incoherent-recipe', `A fragmented ${source.topology} digest requires at least ${minimumCuts} cut${minimumCuts === 1 ? '' : 's'}.`);
    }
  }
  if (recipe.fragments.length === 0) {
    fail('incoherent-recipe', 'A completed digest recipe must describe its physical molecule fragments.');
  }
  if (recipe.outcome === 'linearized' && recipe.fragments.length !== 1) {
    fail('incoherent-recipe', 'A linearized circular molecule must contain exactly one physical fragment.');
  }
  const expectedCount = source.topology === 'circular'
    ? Math.max(1, recipe.cutCount)
    : recipe.cutCount + 1;
  if (recipe.fragments.length !== expectedCount) {
    fail('incoherent-recipe', `Digest recipe expected ${expectedCount} physical fragment${expectedCount === 1 ? '' : 's'}.`);
  }

  const requestedEnzymes = new Set(recipe.enzymes.map((entry) => entry.name));
  let totalLength = 0;
  recipe.fragments.forEach((fragment, index) => {
    const expected = expectedFragmentSequence(source, fragment, index);
    if (fragment.sequence !== expected) {
      fail('incoherent-recipe', `Digest fragment ${index + 1} does not match the source DNA coordinates.`);
    }
    validateFragmentEnds(fragment, index, requestedEnzymes);
    totalLength += fragment.length;
  });
  if (totalLength !== source.sequence.length) {
    fail('incoherent-recipe', 'Digest fragment lengths do not conserve the source molecule length.');
  }
}

function cloneSourceFeature(
  feature: Feature,
  location: RemappedFeatureLocation,
  index: number,
  sourceRecordId: string,
  budget: JsonCloneBudget,
): Feature {
  const metadata = cloneJsonValue(feature.metadata, `sourceRecord.features[${index}].metadata`, 0, budget);
  return cloneCanonicalFeature(feature, {
    // restrictionDigest historically allocates feature ids with crypto.
    // Re-keying within each new record makes this materializer deterministic.
    id: `digest-feature-${index + 1}`,
    start: location.start,
    end: location.end,
    ...(location.subRanges === undefined ? { subRanges: undefined } : { subRanges: location.subRanges.map((range) => ({ ...range })) }),
    metadata: {
      ...(metadata as Record<string, unknown>),
      sourceRecordId,
      sourceFeatureId: feature.id,
      generatedBy: 'restriction_digest',
    },
  });
}

function sliceSourceFeatures(
  source: DigestWorkflowSourceRecord,
  fragment: DigestFragment,
): Feature[] {
  const sourceFeatures = source.features ?? [];
  if (sourceFeatures.length > MAX_DIGEST_WORKFLOW_FEATURES_PER_RECORD) {
    fail(
      'resource-limit',
      `Source DNA cannot contain more than ${MAX_DIGEST_WORKFLOW_FEATURES_PER_RECORD.toLocaleString()} features.`,
    );
  }
  const budget: JsonCloneBudget = { nodes: 0 };
  const cloned: Feature[] = [];
  const sourceSpans: FeatureCoordinateMapSpan[] = source.topology === 'linear'
    || fragment.endInOriginal <= source.sequence.length
    ? [{
        start: fragment.startInOriginal,
        end: fragment.endInOriginal,
        targetStart: 0,
      }]
    : [
        {
          start: fragment.startInOriginal,
          end: source.sequence.length,
          targetStart: 0,
        },
        {
          start: 0,
          end: fragment.endInOriginal - source.sequence.length,
          targetStart: source.sequence.length - fragment.startInOriginal,
        },
      ];
  sourceFeatures.forEach((feature, index) => {
    const sourceFeature = source.topology === 'circular'
      ? expandCircularFeatureLocation(feature, source.sequence.length)
      : feature;
    if (!Number.isInteger(sourceFeature.start) || !Number.isInteger(sourceFeature.end)
      || sourceFeature.start < 0 || sourceFeature.end < 0
      || sourceFeature.start > source.sequence.length || sourceFeature.end > source.sequence.length
      || sourceFeature.start === sourceFeature.end
      || (sourceFeature.end < sourceFeature.start && source.topology !== 'circular')) {
      fail('invalid-source', `Source feature ${index + 1} falls outside the source DNA.`);
    }
    sourceFeature.subRanges?.forEach((range, rangeIndex) => {
      const remainsInsideEnvelope = feature.subRanges !== undefined
        && source.topology === 'circular'
        && feature.start > feature.end
        ? (range.start >= feature.start && range.end <= source.sequence.length)
          || (range.start >= 0 && range.end <= feature.end)
        : range.start >= sourceFeature.start && range.end <= sourceFeature.end;
      if (!Number.isInteger(range.start) || !Number.isInteger(range.end)
        || range.end <= range.start || !remainsInsideEnvelope) {
        fail(
          'invalid-source',
          `Source feature ${index + 1} sub-range ${rangeIndex + 1} must fit within its feature.`,
        );
      }
    });
    const location = remapFeatureLocation(sourceFeature, sourceSpans);
    if (!location) return;
    cloned.push(cloneSourceFeature(
      feature,
      location,
      cloned.length,
      source.id,
      budget,
    ));
  });
  return cloned;
}

function defaultRecordName(
  prefix: string,
  fragment: DigestFragment,
  index: number,
  outcome: DigestRecipe['outcome'],
): string {
  const enzymeLabel = [
    ...(fragment.leftEnzymes && fragment.leftEnzymes.length > 0 ? fragment.leftEnzymes : fragment.leftEnzyme ? [fragment.leftEnzyme] : []),
    ...(fragment.rightEnzymes && fragment.rightEnzymes.length > 0 ? fragment.rightEnzymes : fragment.rightEnzyme ? [fragment.rightEnzyme] : []),
  ]
    .filter((value, valueIndex, values) => values.indexOf(value) === valueIndex)
    .join('–');
  if (outcome === 'linearized') {
    return `${prefix} · linearized${enzymeLabel ? ` (${enzymeLabel})` : ''}`;
  }
  return `Fragment ${index + 1}${enzymeLabel ? ` (${enzymeLabel})` : ''} of ${prefix}`;
}

function resolveOutputIdentities(
  input: MaterializeDigestWorkflowInput,
  outputFragments: readonly DigestFragment[],
): Array<{ id: string; name: string }> {
  const supplied = input.outputIdentities;
  if (supplied && supplied.length !== outputFragments.length) {
    fail(
      'identity-count',
      `Digest output identity count (${supplied.length}) must match the materialized fragment count (${outputFragments.length}).`,
    );
  }
  const idPrefix = boundedText(
    input.outputIdPrefix ?? input.workflow.id,
    'Digest output id prefix',
    MAX_ARTIFACT_ID_LENGTH - 16,
    'invalid-recipe',
  );
  const namePrefix = boundedText(
    input.outputNamePrefix ?? input.sourceRecord.name,
    'Digest output name prefix',
    MAX_DIGEST_WORKFLOW_RECORD_NAME_LENGTH,
    'invalid-recipe',
  );
  const existingIdLength = input.existingRecordIds === undefined
    ? 0
    : boundedArrayLength(input.existingRecordIds, 'Existing digest record ids', MAX_DIGEST_WORKFLOW_RECORDS);
  const existingNameLength = input.existingRecordNames === undefined
    ? 0
    : boundedArrayLength(input.existingRecordNames, 'Existing digest record names', MAX_DIGEST_WORKFLOW_RECORDS);
  const existingIds = input.existingRecordIds === undefined
    ? []
    : boundedDenseArray(
      input.existingRecordIds,
      'Existing digest record ids',
      MAX_DIGEST_WORKFLOW_RECORDS,
    ).map((value, index) => boundedText(
      value,
      `Existing digest record id ${index + 1}`,
      MAX_ARTIFACT_ID_LENGTH,
      'invalid-recipe',
    ));
  const existingNames = input.existingRecordNames === undefined
    ? []
    : boundedDenseArray(
      input.existingRecordNames,
      'Existing digest record names',
      MAX_DIGEST_WORKFLOW_RECORDS,
    ).map((value, index) => boundedText(
      value,
      `Existing digest record name ${index + 1}`,
      MAX_DIGEST_WORKFLOW_RECORD_NAME_LENGTH,
      'invalid-recipe',
    ));
  const sourceNameKey = input.sourceRecord.name.toLocaleLowerCase();
  const idInventoryCount = input.existingRecordIds === undefined
    ? 1
    : existingIdLength + (existingIds.includes(input.sourceRecord.id) ? 0 : 1);
  const nameInventoryCount = input.existingRecordNames === undefined
    ? 1
    : existingNameLength + (existingNames.some((name) => name.toLocaleLowerCase() === sourceNameKey) ? 0 : 1);
  if (Math.max(idInventoryCount, nameInventoryCount) + outputFragments.length > MAX_DIGEST_WORKFLOW_RECORDS) {
    fail(
      'resource-limit',
      `Digest outputs would exceed the ${MAX_DIGEST_WORKFLOW_RECORDS}-record workspace limit.`,
    );
  }
  const usedIds = new Set([input.sourceRecord.id, ...existingIds]);
  const usedNames = new Set(
    [input.sourceRecord.name, ...existingNames]
      .map((name) => name.toLocaleLowerCase()),
  );

  return outputFragments.map((fragment, index) => {
    const defaultIdSuffix = input.recipe.outcome === 'linearized' ? 'linearized' : `fragment-${index + 1}`;
    const id = boundedText(
      supplied?.[index]?.id ?? `${idPrefix}-${defaultIdSuffix}`,
      `Digest output ${index + 1} id`,
      MAX_ARTIFACT_ID_LENGTH,
      'invalid-recipe',
    );
    if (usedIds.has(id)) fail('duplicate-id', `Digest output id "${id}" already exists.`);
    usedIds.add(id);

    const name = boundedText(
      supplied?.[index]?.name
        ?? defaultRecordName(namePrefix, fragment, index, input.recipe.outcome),
      `Digest output ${index + 1} name`,
      MAX_DIGEST_WORKFLOW_RECORD_NAME_LENGTH,
      'invalid-recipe',
    );
    const nameKey = name.toLocaleLowerCase();
    if (usedNames.has(nameKey)) fail('duplicate-name', `Digest output name "${name}" already exists.`);
    usedNames.add(nameKey);
    return { id, name };
  });
}

function fragmentSummary(
  fragment: DigestFragment,
  index: number,
  sourceLength: number,
  outputRecordId: string | null,
): ArtifactJsonObject {
  return {
    index: index + 1,
    outputRecordId,
    length: fragment.length,
    startInOriginal: fragment.startInOriginal,
    endInOriginal: fragment.endInOriginal,
    wrapsOrigin: fragment.endInOriginal > sourceLength,
    leftEnzyme: fragment.leftEnzyme,
    rightEnzyme: fragment.rightEnzyme,
    leftEnzymes: fragment.leftEnzymes ? [...fragment.leftEnzymes] : [],
    rightEnzymes: fragment.rightEnzymes ? [...fragment.rightEnzymes] : [],
    overhang5: fragment.overhang5,
    overhang3: fragment.overhang3,
    overhang5Type: fragment.overhang5Type,
    overhang3Type: fragment.overhang3Type,
  };
}

function buildWorkflowProvenance(input: MaterializeDigestWorkflowInput): ArtifactProvenance {
  return {
    source: boundedText(
      input.workflow.source ?? 'motif-for-claude-science-artifact',
      'Workflow provenance source',
      256,
      'invalid-recipe',
    ),
    operation: 'restriction_digest',
    ...(input.workflow.actor === undefined
      ? {}
      : { actor: boundedText(input.workflow.actor, 'Workflow actor', 256, 'invalid-recipe') }),
    ...(input.workflow.engine === undefined
      ? { engine: 'motif-for-claude-science-artifact' }
      : { engine: boundedText(input.workflow.engine, 'Workflow engine', 256, 'invalid-recipe') }),
    ...(input.workflow.engineVersion === undefined
      ? {}
      : { engineVersion: boundedText(input.workflow.engineVersion, 'Workflow engine version', 256, 'invalid-recipe') }),
    parentIds: [input.sourceRecord.id],
  };
}

/**
 * Atomically materialize digest-derived record inputs and their portable
 * workflow-history entry. The function is pure: ids and time are caller input,
 * and every returned collection is a defensive copy.
 */
export function materializeDigestWorkflow(
  rawInput: MaterializeDigestWorkflowInput,
): MaterializedDigestWorkflow {
  const submittedInput = snapshotMaterializeDigestWorkflowInput(rawInput);
  validateSourceRecord(submittedInput.sourceRecord);
  const sourceTagsValue = ownDataProperty(
    submittedInput.sourceRecord as unknown as Record<string, unknown>,
    'tags',
  );
  if (sourceTagsValue === INVALID_DATA_PROPERTY) {
    fail('invalid-source', 'Source record tags must be direct data.');
  }
  const sourceTags = sourceTagsValue === undefined
    ? undefined
    : boundedStringArray(
      sourceTagsValue,
      'Source record tags',
      MAX_DIGEST_WORKFLOW_TAGS,
      MAX_DIGEST_WORKFLOW_TAG_LENGTH,
      'invalid-source',
    );
  const sourceFeatures = snapshotSourceFeatures(submittedInput.sourceRecord);
  const sourceRecord: DigestWorkflowSourceRecord = {
    id: submittedInput.sourceRecord.id,
    name: submittedInput.sourceRecord.name,
    sequence: submittedInput.sourceRecord.sequence,
    type: submittedInput.sourceRecord.type,
    topology: submittedInput.sourceRecord.topology,
    active: submittedInput.sourceRecord.active,
    features: sourceFeatures,
    ...(submittedInput.sourceRecord.translationTableId === undefined
      ? {}
      : { translationTableId: submittedInput.sourceRecord.translationTableId }),
    ...(submittedInput.sourceRecord.description === undefined ? {} : { description: submittedInput.sourceRecord.description }),
    ...(submittedInput.sourceRecord.organism === undefined ? {} : { organism: submittedInput.sourceRecord.organism }),
    ...(submittedInput.sourceRecord.source === undefined ? {} : { source: submittedInput.sourceRecord.source }),
    ...(submittedInput.sourceRecord.group === undefined ? {} : { group: submittedInput.sourceRecord.group }),
    ...(sourceTags === undefined ? {} : { tags: sourceTags }),
  };
  const recipe = rebuildAndVerifyRecipe(sourceRecord, submittedInput.recipe, submittedInput.enzymeCatalog);
  const input: MaterializeDigestWorkflowInput = {
    sourceRecord,
    recipe,
    enzymeCatalog: submittedInput.enzymeCatalog,
    workflow: submittedInput.workflow,
    ...(submittedInput.outputIdentities === undefined ? {} : { outputIdentities: submittedInput.outputIdentities }),
    ...(submittedInput.outputIdPrefix === undefined ? {} : { outputIdPrefix: submittedInput.outputIdPrefix }),
    ...(submittedInput.outputNamePrefix === undefined ? {} : { outputNamePrefix: submittedInput.outputNamePrefix }),
    ...(submittedInput.existingRecordIds === undefined ? {} : { existingRecordIds: submittedInput.existingRecordIds }),
    ...(submittedInput.existingRecordNames === undefined ? {} : { existingRecordNames: submittedInput.existingRecordNames }),
    ...(submittedInput.derivedRecordSource === undefined ? {} : { derivedRecordSource: submittedInput.derivedRecordSource }),
  };
  boundedText(input.workflow.id, 'Digest workflow id', MAX_ARTIFACT_ID_LENGTH, 'invalid-recipe');
  validateRecipe(input.sourceRecord, input.recipe);

  // An uncut reaction is still useful history, but the intact source is not a
  // derived fragment. This prevents a misleading duplicate child record.
  const outputFragments = input.recipe.outcome === 'uncut' ? [] : input.recipe.fragments;
  const identities = resolveOutputIdentities(input, outputFragments);
  const enzymeNames = input.recipe.enzymes.map((entry) => entry.name);
  const derivedRecordSource = boundedText(
    input.derivedRecordSource ?? 'Motif for Claude Science',
    'Derived record source',
    1_024,
    'invalid-recipe',
  );

  const records = outputFragments.map((fragment, index): DigestDerivedRecordInput => {
    const identity = identities[index];
    const wrapsOrigin = fragment.endInOriginal > input.sourceRecord.sequence.length;
    const provenance: DigestDerivedRecordProvenance = {
      parentRecordId: input.sourceRecord.id,
      operation: 'restriction_digest',
      workflowResultId: input.workflow.id,
      fragmentIndex: index + 1,
      fragmentCount: outputFragments.length,
      sourceTopology: input.sourceRecord.topology,
      startInOriginal: fragment.startInOriginal,
      endInOriginal: fragment.endInOriginal,
      wrapsOrigin,
      leftEnzyme: fragment.leftEnzyme,
      rightEnzyme: fragment.rightEnzyme,
      leftEnzymes: fragment.leftEnzymes ? [...fragment.leftEnzymes] : [],
      rightEnzymes: fragment.rightEnzymes ? [...fragment.rightEnzymes] : [],
      overhang5: fragment.overhang5,
      overhang3: fragment.overhang3,
      overhang5Type: fragment.overhang5Type,
      overhang3Type: fragment.overhang3Type,
      enzymes: [...enzymeNames],
      ...(input.sourceRecord.translationTableId === undefined
        ? {}
        : { translationTableId: input.sourceRecord.translationTableId }),
    };
    return {
      id: identity.id,
      name: identity.name,
      description: input.recipe.outcome === 'linearized'
        ? `${input.sourceRecord.name} linearized by ${enzymeNames.join(', ')} with Motif.`
        : `Restriction digest fragment ${index + 1} of ${input.sourceRecord.name}, generated with ${enzymeNames.join(', ')} in Motif.`,
      molecule: 'dna',
      topology: 'linear',
      ...(input.sourceRecord.translationTableId === undefined
        ? {}
        : { translationTableId: input.sourceRecord.translationTableId }),
      seq: fragment.sequence,
      length: fragment.length,
      overhang5: fragment.overhang5,
      overhang3: fragment.overhang3,
      overhang5Type: fragment.overhang5Type,
      overhang3Type: fragment.overhang3Type,
      annotations: sliceSourceFeatures(input.sourceRecord, fragment),
      ...(input.sourceRecord.organism === undefined ? {} : { organism: input.sourceRecord.organism }),
      source: derivedRecordSource,
      ...(input.sourceRecord.group === undefined ? {} : { group: input.sourceRecord.group }),
      dateAdded: input.workflow.createdAt,
      ...(input.sourceRecord.tags === undefined ? {} : { tags: [...input.sourceRecord.tags] }),
      active: true,
      provenance,
    };
  });

  const workflowName = boundedText(
    input.workflow.name ?? `${enzymeNames.join(' + ')} digest of ${input.sourceRecord.name}`,
    'Digest workflow name',
    MAX_ARTIFACT_WORKFLOW_NAME_LENGTH,
    'invalid-recipe',
  );
  const parameters: ArtifactJsonObject = {
    enzymes: [...enzymeNames],
    topology: input.sourceRecord.topology,
    cutCount: input.recipe.cutCount,
    recognitionSiteCount: input.recipe.recognitionSiteCount,
    outcome: input.recipe.outcome,
    ...(input.recipe.methylationAssumptions === undefined
      ? {}
      : { methylationAssumptions: input.recipe.methylationAssumptions }),
    enzymeGeometry: input.recipe.enzymes.map((entry): ArtifactJsonObject => ({
      name: entry.name,
      type: entry.type,
      cutCount: entry.cutCount,
      nickCount: entry.nickCount,
      recognitionSequence: entry.enzyme.recognitionSequence,
      cutOffset: entry.enzyme.cutOffset,
      complementCutOffset: entry.enzyme.complementCutOffset,
      overhang: entry.enzyme.overhang,
      ...(entry.methylationRequirement === undefined
        ? {}
        : {
            methylationRequirement: {
              target: entry.methylationRequirement.target,
              state: entry.methylationRequirement.state,
              ...(entry.methylationRequirement.evidence === undefined
                ? {}
                : {
                    evidence: {
                      source: entry.methylationRequirement.evidence.source,
                      sourceLabel: entry.methylationRequirement.evidence.sourceLabel,
                      conditions: entry.methylationRequirement.evidence.conditions,
                      ...(entry.methylationRequirement.evidence.limitation === undefined
                        ? {}
                        : { limitation: entry.methylationRequirement.evidence.limitation }),
                    },
                  }),
            },
          }),
      ...(entry.methylationBehavior === undefined
        ? {}
        : { methylationBehavior: entry.methylationBehavior }),
      ...(entry.methylationEvidence === undefined
        ? {}
        : {
            methylationEvidence: {
              source: entry.methylationEvidence.source,
              sourceLabel: entry.methylationEvidence.sourceLabel,
              conditions: entry.methylationEvidence.conditions,
              ...(entry.methylationEvidence.limitation === undefined
                ? {}
                : { limitation: entry.methylationEvidence.limitation }),
            },
          }),
    })),
  };
  const result: ArtifactJsonObject = {
    outcome: input.recipe.outcome,
    physicalFragmentCount: input.recipe.fragments.length,
    derivedRecordCount: records.length,
    fragments: input.recipe.fragments.map((fragment, index) => fragmentSummary(
      fragment,
      index,
      input.sourceRecord.sequence.length,
      records[index]?.id ?? null,
    )),
  };
  const rawWorkflowResult: ArtifactWorkflowResult = {
    id: input.workflow.id,
    kind: 'digest',
    name: workflowName,
    inputRecordIds: [input.sourceRecord.id],
    ...(input.workflow.inputSha256 === undefined ? {} : { inputSha256s: [input.workflow.inputSha256] }),
    parameters,
    outputRecordIds: records.map((record) => record.id),
    result,
    createdAt: input.workflow.createdAt,
    provenance: buildWorkflowProvenance(input),
  };
  const recordLengths = new Map<string, number>([
    [input.sourceRecord.id, input.sourceRecord.sequence.length],
    ...records.map((record): [string, number] => [record.id, record.length]),
  ]);
  const [workflowResult] = normalizeArtifactWorkflowResults([rawWorkflowResult], { recordLengths });

  return {
    records,
    workflowResult: workflowResult as ArtifactWorkflowResult & { kind: 'digest' },
  };
}
