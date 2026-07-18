import type { DigestFragment } from '../bio/restriction-digest';
import {
  remapFeatureLocation,
  type FeatureCoordinateMapSpan,
  type RemappedFeatureLocation,
} from '../bio/feature-location';
import type { Feature, SequenceType, Topology } from '../bio/types';
import type { DigestRecipe } from './claude-science-digest-recipe';
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

const MAX_METADATA_DEPTH = 12;
const MAX_METADATA_NODES = 10_000;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DNA_ALPHABET = /^[ACGTRYSWKMBDHVN]+$/i;
const OVERHANG_TYPES = new Set(['blunt', '5prime', '3prime']);

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
  /** Caller-owned display name. Omit for the deterministic Benchling-style default. */
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
  overhang5: string;
  overhang3: string;
  overhang5Type: 'blunt' | '5prime' | '3prime';
  overhang3Type: 'blunt' | '5prime' | '3prime';
  enzymes: string[];
};

/** Compatible with the artifact's private ArtifactRecordInput contract. */
export type DigestDerivedRecordInput = {
  id: string;
  name: string;
  description: string;
  molecule: 'dna';
  topology: 'linear';
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
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
  for (const [side, enzyme] of [['left', fragment.leftEnzyme], ['right', fragment.rightEnzyme]] as const) {
    if (enzyme !== null && !enzymeNames.has(enzyme)) {
      fail('incoherent-recipe', `Digest fragment ${index + 1} has an unknown ${side} enzyme "${enzyme}".`);
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
  if (recipe.fragments.length > MAX_DIGEST_WORKFLOW_FRAGMENTS) {
    fail(
      'resource-limit',
      `Digest produces ${recipe.fragments.length.toLocaleString()} fragments; the workflow limit is ${MAX_DIGEST_WORKFLOW_FRAGMENTS.toLocaleString()}.`,
    );
  }

  const distinctCuts = new Set(recipe.sites.map((site) => site.cutPosition));
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
  return {
    ...feature,
    ...location,
    // restrictionDigest historically allocates feature ids with crypto.
    // Re-keying within each new record makes this materializer deterministic.
    id: `digest-feature-${index + 1}`,
    metadata: {
      ...(metadata as Record<string, unknown>),
      sourceRecordId,
      sourceFeatureId: feature.id,
      generatedBy: 'restriction_digest',
    },
    ...(location.subRanges === undefined
      ? {}
      : { subRanges: location.subRanges.map((range) => ({ ...range })) }),
  };
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
    if (!Number.isInteger(feature.start) || !Number.isInteger(feature.end)
      || feature.start < 0 || feature.end <= feature.start || feature.end > source.sequence.length) {
      fail('invalid-source', `Source feature ${index + 1} falls outside the source DNA.`);
    }
    feature.subRanges?.forEach((range, rangeIndex) => {
      if (!Number.isInteger(range.start) || !Number.isInteger(range.end)
        || range.start < feature.start || range.end <= range.start || range.end > feature.end) {
        fail(
          'invalid-source',
          `Source feature ${index + 1} sub-range ${rangeIndex + 1} must fit within its feature.`,
        );
      }
    });
    const location = remapFeatureLocation(feature, sourceSpans);
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
  const enzymeLabel = [fragment.leftEnzyme, fragment.rightEnzyme]
    .filter((value): value is string => Boolean(value))
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
  const usedIds = new Set([input.sourceRecord.id, ...(input.existingRecordIds ?? [])]);
  const usedNames = new Set(
    [input.sourceRecord.name, ...(input.existingRecordNames ?? [])]
      .map((name) => name.trim().toLocaleLowerCase()),
  );
  const existingIds = new Set([input.sourceRecord.id, ...(input.existingRecordIds ?? [])]);
  if (existingIds.size + outputFragments.length > MAX_DIGEST_WORKFLOW_RECORDS) {
    fail(
      'resource-limit',
      `Digest outputs would exceed the ${MAX_DIGEST_WORKFLOW_RECORDS}-record workspace limit.`,
    );
  }

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
  input: MaterializeDigestWorkflowInput,
): MaterializedDigestWorkflow {
  validateSourceRecord(input.sourceRecord);
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
      overhang5: fragment.overhang5,
      overhang3: fragment.overhang3,
      overhang5Type: fragment.overhang5Type,
      overhang3Type: fragment.overhang3Type,
      enzymes: [...enzymeNames],
    };
    return {
      id: identity.id,
      name: identity.name,
      description: input.recipe.outcome === 'linearized'
        ? `${input.sourceRecord.name} linearized by ${enzymeNames.join(', ')} with Motif.`
        : `Restriction digest fragment ${index + 1} of ${input.sourceRecord.name}, generated with ${enzymeNames.join(', ')} in Motif.`,
      molecule: 'dna',
      topology: 'linear',
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
    enzymeGeometry: input.recipe.enzymes.map((entry) => ({
      name: entry.name,
      type: entry.type,
      cutCount: entry.cutCount,
      recognitionSequence: entry.enzyme.recognitionSequence,
      cutOffset: entry.enzyme.cutOffset,
      complementCutOffset: entry.enzyme.complementCutOffset,
      overhang: entry.enzyme.overhang,
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
