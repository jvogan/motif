import type { RestrictionEnzyme } from '../bio/types';
import type { RestrictionEnzymeSourceId } from '../bio/restriction-presets';
import { VALID_NCBI_TABLE_IDS } from '../bio/codon-tables';
import { ABI_IMPORT_LIMITS } from '../bio/abi-import';
import { ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES } from './claude-science-sanger';
import { MAX_MOTIF_PRELOAD_BYTES } from './motif-preload-limits';

export const LARGE_SEQUENCE_DETAIL_THRESHOLD = 50_000;
/**
 * Workspace JSON is pretty-printed on export. A legal workspace containing the
 * full four-million-entry Sanger trace budget can therefore exceed the former
 * 32 MiB text ceiling even though the underlying AB1 files were individually
 * bounded. Keep restore parsing bounded, but leave enough room for that
 * supported workspace plus JSON indentation and record metadata.
 */
export const MAX_ARTIFACT_DATABASE_JSON_CHARACTERS = 128 * 1024 * 1024;
export const MAX_ARTIFACT_JSON_NODES = 250_000;
export const MAX_ARTIFACT_JSON_NESTING = 22;
export const MAX_ARTIFACT_JSON_BYTES = MAX_MOTIF_PRELOAD_BYTES;
export const MAX_ARTIFACT_RECORDS = 100;
export const MOTIF_INVENTORY_SCHEMA_V1 = 'motif.claude-science.inventory.v1';
export const MOTIF_INVENTORY_SCHEMA = 'motif.claude-science.inventory.v2';
export const MAX_CUSTOM_ENZYMES = 100;
export const MAX_HIDDEN_ENZYMES_PER_RECORD = 512;
export const MAX_TRANSLATION_LAYERS_PER_RECORD = 200;
export const MAX_TRANSLATION_LAYER_TEXT_LENGTH = 160;
export const MAX_MOTIF_LENGTH = 256;
export const MAX_CUSTOM_ENZYME_NAME_LENGTH = 64;
export const MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH = 64;
export const MAX_CUSTOM_ENZYME_EVIDENCE_TEXT_LENGTH = 2_048;
export const MAX_HIDDEN_FEATURE_TRANSLATIONS_PER_RECORD = 2_000;
const VALID_SOURCE_IDS = new Set<RestrictionEnzymeSourceId>([
  'common',
  'all',
  'favorites',
  'golden-gate-type-iis',
  'common-mcs',
  'classic-6-cutter',
  'diagnostic-screening',
]);
const VALID_TRANSLATION_TABLE_IDS = new Set<number>(VALID_NCBI_TABLE_IDS);

export type PortableTranslationTrack = {
  id: string;
  label: string;
  start: number;
  end: number;
  strand: 1 | -1;
  frame: 0 | 1 | 2;
  translationTableId: number;
  source: 'layer';
  color?: string;
  needsReview?: boolean;
  completeCds?: boolean;
  featureId?: string;
};

export type ArtifactDurableState = {
  customEnzymes: RestrictionEnzyme[];
  translationLayersByRecord: Record<string, PortableTranslationTrack[]>;
  enzymeSourcesByRecord: Record<string, RestrictionEnzymeSourceId[]>;
  hiddenEnzymesByRecord: Record<string, string[]>;
  hiddenFeatureTranslationsByRecord: Record<string, string[]>;
  restrictionLabelsByRecord: Record<string, boolean>;
  motifsByRecord: Record<string, string>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Record-keyed checkpoint maps must preserve every legal record id, including
 * names such as `__proto__`. A normal object assignment treats that key as a
 * prototype setter and silently drops the durable value. Null-prototype maps
 * remain JSON-compatible while making every record id an ordinary data key.
 */
export function createRecordMap<T>(
  source?: Readonly<Record<string, T>>,
  changes?: Readonly<Record<string, NoInfer<T>>>,
): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, source, changes);
}

export const RECORD_KEYED_ARTIFACT_STATE_FIELDS = [
  'translationLayersByRecord',
  'enzymeSourcesByRecord',
  'hiddenEnzymesByRecord',
  'hiddenFeatureTranslationsByRecord',
  'restrictionLabelsByRecord',
  'motifsByRecord',
] as const;

const MOTIF_INVENTORY_SCHEMA_PREFIX = 'motif.claude-science.inventory.';
const SUPPORTED_MOTIF_INVENTORY_SCHEMAS = new Set([
  MOTIF_INVENTORY_SCHEMA_V1,
  MOTIF_INVENTORY_SCHEMA,
]);
const MAX_ARTIFACT_SCHEMA_LENGTH = 160;

export class ArtifactJsonLimitError extends Error {
  readonly code = 'MOTIF_INPUT_LIMIT_EXCEEDED';
  readonly details = { mutated: false };
}

export function assertArtifactJsonCharacterCount(characterCount: number): void {
  if (!Number.isSafeInteger(characterCount) || characterCount < 0) {
    throw new Error('Artifact JSON character count must be a non-negative safe integer.');
  }
  if (characterCount <= MAX_ARTIFACT_DATABASE_JSON_CHARACTERS) return;
  const maximumMiB = MAX_ARTIFACT_DATABASE_JSON_CHARACTERS / (1024 * 1024);
  throw new ArtifactJsonLimitError(
    `Artifact JSON exceeds the artifact maximum of ${maximumMiB.toLocaleString()} MiB. `
    + 'Split the library into smaller workspace backups.',
  );
}

type JsonContainer = 'root' | 'records' | 'record' | 'trace' | 'channels' | 'samples' | 'calls' | 'other';
type JsonFrame = {
  container: JsonContainer;
  expectsKey: boolean;
  object: boolean;
  key?: string;
  numericEntries: number;
};

function classifyJsonContainer(parent: JsonFrame | undefined, object: boolean): JsonContainer {
  if (!parent) return 'root';
  const { container, key } = parent;
  if (container === 'root' && !object && (key === 'records' || key === 'entries' || key === 'vectors')) return 'records';
  if (object && (container === 'records' || (container === 'root' && key === 'record'))) return 'record';
  if (object && (container === 'record' || container === 'root') && key === 'sangerTrace') return 'trace';
  if (container === 'trace' && object && key === 'channels') return 'channels';
  if (container === 'trace' && !object && (key === 'qualityScores' || key === 'peakPositions')) return 'calls';
  if (container === 'channels' && !object && (key === 'A' || key === 'C' || key === 'G' || key === 'T')) return 'samples';
  return 'other';
}

/** Bound allocation before handing syntax validation and decoding to JSON.parse. */
function assertArtifactJsonStructure(text: string): void {
  const frames: JsonFrame[] = [];
  let nodes = 0;
  let sampleEntries = 0;
  let callEntries = 0;
  const countNode = () => {
    nodes += 1;
    if (nodes > MAX_ARTIFACT_JSON_NODES) {
      throw new ArtifactJsonLimitError(`Artifact JSON exceeds the maximum of ${MAX_ARTIFACT_JSON_NODES.toLocaleString()} JSON nodes.`);
    }
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const frame = frames[frames.length - 1];
    if (char === ' ' || char === '\r' || char === '\n' || char === '\t' || char === ':') continue;
    if (char === ',') {
      if (frame) {
        frame.expectsKey = frame.object;
        frame.key = undefined;
      }
      continue;
    }
    if (char === '}' || char === ']') {
      frames.pop();
      continue;
    }
    if (char === '{' || char === '[') {
      countNode();
      if (frames.length >= MAX_ARTIFACT_JSON_NESTING) {
        throw new ArtifactJsonLimitError(`Artifact JSON exceeds the maximum supported nesting depth of ${MAX_ARTIFACT_JSON_NESTING}.`);
      }
      const object = char === '{';
      frames.push({ container: classifyJsonContainer(frame, object), expectsKey: object, object, numericEntries: 0 });
      continue;
    }
    if (char === '"') {
      const start = index;
      while (++index < text.length && text[index] !== '"') {
        if (text[index] === '\\') index += 1;
      }
      if (frame?.expectsKey) {
        frame.expectsKey = false;
        // Only short keys can identify the known trace arrays. Escaped keys go
        // through the same decoder as the document, including Unicode escapes.
        if (frame.container !== 'other' && index - start < 96) {
          const rawKey = text.slice(start, index + 1);
          frame.key = rawKey.includes('\\') ? JSON.parse(rawKey) : rawKey.slice(1, -1);
        }
      } else countNode();
      continue;
    }
    const numeric = char === '-' || (char >= '0' && char <= '9');
    if (numeric && frame && (frame.container === 'samples' || frame.container === 'calls')) {
      frame.numericEntries += 1;
      const samples = frame.container === 'samples';
      if (samples) sampleEntries += 1;
      else callEntries += 1;
      if (frame.numericEntries > (samples ? ABI_IMPORT_LIMITS.maxTraceSamplesPerChannel : ABI_IMPORT_LIMITS.maxBaseCalls)
        || sampleEntries > ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES
        || callEntries > 2 * MAX_ARTIFACT_RECORDS * ABI_IMPORT_LIMITS.maxBaseCalls) {
        throw new ArtifactJsonLimitError('Artifact JSON exceeds the trace sample or base-call limit.');
      }
    } else countNode();
    // Skip primitive-token characters in one pass. JSON.parse checks syntax.
    while (index + 1 < text.length && /[a-zA-Z0-9.+-]/.test(text[index + 1])) index += 1;
  }
}

function parseArtifactJsonObject(text: string): Record<string, unknown> | null {
  if (typeof text !== 'string') throw new Error('Artifact JSON input must be text.');
  assertArtifactJsonCharacterCount(text.length);
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    assertArtifactJsonStructure(trimmed);
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    if (cause instanceof ArtifactJsonLimitError) throw cause;
    throw new Error('Artifact JSON could not be parsed.');
  }
  return isObject(parsed) ? parsed : null;
}

function validateArtifactDatabaseSchema(database: Record<string, unknown>): void {
  const { schema } = database;
  if (schema === undefined) return;
  if (typeof schema !== 'string' || !schema.trim() || schema !== schema.trim()
    || schema.length > MAX_ARTIFACT_SCHEMA_LENGTH) {
    throw new Error(`Workspace JSON schema must be a non-empty string no longer than ${MAX_ARTIFACT_SCHEMA_LENGTH} characters.`);
  }
  if (schema.startsWith(MOTIF_INVENTORY_SCHEMA_PREFIX)
    && !SUPPORTED_MOTIF_INVENTORY_SCHEMAS.has(schema)) {
    throw new Error(
      `Workspace JSON uses unsupported Motif inventory schema ${JSON.stringify(schema)}; `
      + `${Array.from(SUPPORTED_MOTIF_INVENTORY_SCHEMAS).join(' and ')} are supported.`,
    );
  }
}

function requiredString(value: unknown, path: string, maxLength = MAX_TRANSLATION_LAYER_TEXT_LENGTH): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${path} must be a non-empty string no longer than ${maxLength} characters.`);
  }
  return value.trim();
}

function requiredInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value)) throw new Error(`${path} must be an integer.`);
  return Number(value);
}

function uniqueId(
  base: string,
  used: Set<string>,
  maxLength = MAX_TRANSLATION_LAYER_TEXT_LENGTH,
): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(0, maxLength - suffixText.length))}${suffixText}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export type ArtifactImportJson =
  | { kind: 'database' | 'record'; value: Record<string, unknown> }
  | { kind: 'unrecognized' };

export function parseArtifactImportJson(text: string): ArtifactImportJson {
  const parsed = parseArtifactJsonObject(text);
  if (!parsed) return { kind: 'unrecognized' };
  const hasRecords = Object.prototype.hasOwnProperty.call(parsed, 'records');
  const hasKnownInventorySchema = typeof parsed.schema === 'string'
    && parsed.schema.startsWith(MOTIF_INVENTORY_SCHEMA_PREFIX);
  if (hasRecords || hasKnownInventorySchema) {
    validateArtifactDatabaseSchema(parsed);
    if (!Array.isArray(parsed.records)) throw new Error('Workspace JSON must contain a records array.');
    return { kind: 'database', value: parsed };
  }
  const hasSequence = typeof parsed.seq === 'string' || typeof parsed.sequence === 'string';
  return hasSequence ? { kind: 'record', value: parsed } : { kind: 'unrecognized' };
}

export function parseArtifactDatabaseJson(text: string): Record<string, unknown> | null {
  const parsed = parseArtifactImportJson(text);
  return parsed.kind === 'database' ? parsed.value : null;
}

/**
 * Recognize the bare object emitted by the active-record "Record JSON" export.
 * Validation and normalization intentionally remain with the existing Add
 * Entry record path; this helper only distinguishes a single record from a
 * complete workspace restore without interpreting arbitrary JSON as sequence
 * text.
 */
export function parseArtifactRecordJson(text: string): Record<string, unknown> | null {
  const parsed = parseArtifactImportJson(text);
  return parsed.kind === 'record' ? parsed.value : null;
}

function normalizeMethylationEvidence(value: unknown, path: string): RestrictionEnzyme['methylationEvidence'] {
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
  return {
    source: requiredString(value.source, `${path}.source`, MAX_CUSTOM_ENZYME_EVIDENCE_TEXT_LENGTH),
    sourceLabel: requiredString(value.sourceLabel, `${path}.sourceLabel`, MAX_CUSTOM_ENZYME_EVIDENCE_TEXT_LENGTH),
    conditions: requiredString(value.conditions, `${path}.conditions`, MAX_CUSTOM_ENZYME_EVIDENCE_TEXT_LENGTH),
    ...(value.limitation === undefined
      ? {}
      : { limitation: requiredString(value.limitation, `${path}.limitation`, MAX_CUSTOM_ENZYME_EVIDENCE_TEXT_LENGTH) }),
  };
}

function normalizeMethylationRequirement(
  value: unknown,
  path: string,
): RestrictionEnzyme['methylationRequirement'] {
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
  const target = value.target === 'dam' || value.target === 'dcm' || value.target === 'cpg' || value.target === 'custom'
    ? value.target
    : null;
  if (target === null) throw new Error(`${path}.target must be dam, dcm, cpg, or custom.`);
  const state = value.state === 'methylated' || value.state === 'unmethylated'
    ? value.state
    : null;
  if (state === null) throw new Error(`${path}.state must be methylated or unmethylated.`);
  return {
    target,
    state,
    ...(value.evidence === undefined
      ? {}
      : { evidence: normalizeMethylationEvidence(value.evidence, `${path}.evidence`) }),
  };
}

function normalizeCustomEnzymes(value: unknown): RestrictionEnzyme[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('artifactState.customEnzymes must be an array.');
  if (value.length > MAX_CUSTOM_ENZYMES) {
    throw new Error(`artifactState.customEnzymes cannot contain more than ${MAX_CUSTOM_ENZYMES} entries.`);
  }

  const seenNames = new Map<string, { index: number; name: string }>();
  const normalizedEnzymes: RestrictionEnzyme[] = [];
  value.forEach((raw, index) => {
    const path = `artifactState.customEnzymes[${index}]`;
    if (!isObject(raw)) throw new Error(`${path} must be an object.`);
    const name = requiredString(raw.name, `${path}.name`, MAX_CUSTOM_ENZYME_NAME_LENGTH);
    const recognitionSequence = requiredString(
      raw.recognitionSequence,
      `${path}.recognitionSequence`,
      MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH,
    ).toUpperCase();
    if (!/^[ACGTRYSWKMBDHVN]+$/.test(recognitionSequence)) {
      throw new Error(`${path}.recognitionSequence must contain only IUPAC DNA symbols.`);
    }
    const cutOffset = requiredInteger(raw.cutOffset, `${path}.cutOffset`);
    const complementCutOffset = requiredInteger(raw.complementCutOffset, `${path}.complementCutOffset`);
    if (Math.abs(cutOffset) > 100 || Math.abs(complementCutOffset) > 100) {
      throw new Error(`${path} cut offsets must be between -100 and 100.`);
    }
    if (raw.overhang !== 'blunt' && raw.overhang !== '5prime' && raw.overhang !== '3prime') {
      throw new Error(`${path}.overhang must be "blunt", "5prime", or "3prime".`);
    }
    const nameKey = name.toLowerCase();
    const previous = seenNames.get(nameKey);
    if (previous) {
      const previousPath = `artifactState.customEnzymes[${previous.index}].name`;
      throw new Error(
        `${path}.name (${JSON.stringify(name)}) duplicates ${previousPath} `
        + `(${JSON.stringify(previous.name)}); custom-enzyme names are case-insensitive.`,
      );
    }
    seenNames.set(nameKey, { index, name });

    const cleavageMode = raw.cleavageMode === undefined
      ? undefined
      : raw.cleavageMode === 'double-strand' || raw.cleavageMode === 'nick_top' || raw.cleavageMode === 'nick_bottom'
        ? raw.cleavageMode
        : null;
    if (cleavageMode === null) {
      throw new Error(`${path}.cleavageMode must be double-strand, nick_top, or nick_bottom.`);
    }
    const methylationRequirement = raw.methylationRequirement === undefined
      ? undefined
      : normalizeMethylationRequirement(raw.methylationRequirement, `${path}.methylationRequirement`);
    const methylationBehavior = raw.methylationBehavior === undefined
      ? undefined
      : raw.methylationBehavior === 'context_dependent' ? raw.methylationBehavior : null;
    if (methylationBehavior === null) throw new Error(`${path}.methylationBehavior must be context_dependent.`);
    const methylationEvidence = raw.methylationEvidence === undefined
      ? undefined
      : normalizeMethylationEvidence(raw.methylationEvidence, `${path}.methylationEvidence`);

    const normalized: RestrictionEnzyme = {
      name,
      recognitionSequence,
      cutOffset,
      complementCutOffset,
      overhang: raw.overhang,
      ...(cleavageMode === undefined ? {} : { cleavageMode }),
      ...(methylationRequirement === undefined ? {} : { methylationRequirement }),
      ...(methylationBehavior === undefined ? {} : { methylationBehavior }),
      ...(methylationEvidence === undefined ? {} : { methylationEvidence }),
    };
    normalizedEnzymes.push(normalized);
  });
  return normalizedEnzymes;
}

function normalizeTranslationLayers(
  value: unknown,
  recordLengths: ReadonlyMap<string, number>,
  circularRecordIds: ReadonlySet<string>,
): Record<string, PortableTranslationTrack[]> {
  if (value === undefined) return createRecordMap();
  if (!isObject(value)) throw new Error('artifactState.translationLayersByRecord must be an object.');
  const result = createRecordMap<PortableTranslationTrack[]>();

  for (const [recordId, rawLayers] of Object.entries(value)) {
    const sequenceLength = recordLengths.get(recordId);
    if (sequenceLength === undefined) continue;
    if (!Array.isArray(rawLayers)) {
      throw new Error(`artifactState.translationLayersByRecord.${recordId} must be an array.`);
    }
    if (rawLayers.length > MAX_TRANSLATION_LAYERS_PER_RECORD) {
      throw new Error(`Record ${recordId} cannot restore more than ${MAX_TRANSLATION_LAYERS_PER_RECORD} translation layers.`);
    }
    const usedIds = new Set<string>();
    result[recordId] = rawLayers.map((raw, index) => {
      const path = `artifactState.translationLayersByRecord.${recordId}[${index}]`;
      if (!isObject(raw)) throw new Error(`${path} must be an object.`);
      const baseId = requiredString(raw.id, `${path}.id`);
      const label = requiredString(raw.label, `${path}.label`);
      const start = requiredInteger(raw.start, `${path}.start`);
      const end = requiredInteger(raw.end, `${path}.end`);
      // A layer pinned across the origin of a circular record ends past the
      // record length, as a range dragged across the origin does: it starts
      // inside the record and covers at most one full length. A linear record
      // has no origin to cross, so its layers end inside it.
      if (circularRecordIds.has(recordId)) {
        if (start < 0 || start >= sequenceLength || end <= start || end - start > sequenceLength) {
          throw new Error(`${path} must use a valid 0-based [start,end) range on the ${sequenceLength}-residue circular record: start below ${sequenceLength}, end after start, at most ${sequenceLength} residues in all; a layer across the origin ends past ${sequenceLength}.`);
        }
      } else if (start < 0 || end <= start || end > sequenceLength) {
        throw new Error(`${path} must use a valid 0-based [start,end) range within the ${sequenceLength} residues of the linear record.`);
      }
      const strand = raw.strand === -1 ? -1 : raw.strand === 1 ? 1 : null;
      if (strand === null) throw new Error(`${path}.strand must be 1 or -1.`);
      const frame = raw.frame === 0 || raw.frame === 1 || raw.frame === 2 ? raw.frame : null;
      if (frame === null) throw new Error(`${path}.frame must be 0, 1, or 2.`);
      const translationTableId = raw.translationTableId === undefined
        ? 1
        : requiredInteger(raw.translationTableId, `${path}.translationTableId`);
      if (!VALID_TRANSLATION_TABLE_IDS.has(translationTableId)) {
        throw new Error(`${path}.translationTableId must be a supported NCBI genetic-code id.`);
      }
      const color = raw.color === undefined ? undefined : requiredString(raw.color, `${path}.color`, 32);
      const featureId = raw.featureId === undefined ? undefined : requiredString(raw.featureId, `${path}.featureId`);
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`${path}.color must be a 6-digit hex color.`);
      if (raw.needsReview !== undefined && typeof raw.needsReview !== 'boolean') {
        throw new Error(`${path}.needsReview must be a boolean.`);
      }
      if (raw.completeCds !== undefined && typeof raw.completeCds !== 'boolean') {
        throw new Error(`${path}.completeCds must be a boolean.`);
      }
      return {
        id: uniqueId(baseId, usedIds),
        label,
        start,
        end,
        strand,
        frame,
        translationTableId,
        source: 'layer',
        color,
        ...(raw.needsReview ? { needsReview: true } : {}),
        ...(raw.completeCds ? { completeCds: true } : {}),
        ...(featureId ? { featureId } : {}),
      };
    });
  }
  return result;
}

function normalizeStringArraysByRecord(
  value: unknown,
  path: string,
  recordLengths: ReadonlyMap<string, number>,
  maxEntries?: number,
): Record<string, string[]> {
  if (value === undefined) return createRecordMap();
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
  const result = createRecordMap<string[]>();
  for (const [recordId, rawValues] of Object.entries(value)) {
    if (!recordLengths.has(recordId)) continue;
    if (!Array.isArray(rawValues) || rawValues.some((item) => typeof item !== 'string')) {
      throw new Error(`${path}.${recordId} must be a string array.`);
    }
    if (maxEntries !== undefined && rawValues.length > maxEntries) {
      throw new Error(`${path}.${recordId} cannot contain more than ${maxEntries} entries.`);
    }
    result[recordId] = Array.from(new Set(rawValues.map((item) => item.trim()).filter(Boolean)));
  }
  return result;
}

function normalizeRestrictionSources(
  value: unknown,
  recordLengths: ReadonlyMap<string, number>,
): Record<string, RestrictionEnzymeSourceId[]> {
  const raw = normalizeStringArraysByRecord(value, 'artifactState.enzymeSourcesByRecord', recordLengths);
  const result = createRecordMap<RestrictionEnzymeSourceId[]>();
  for (const [recordId, sources] of Object.entries(raw)) {
    const validated = sources.filter((source): source is RestrictionEnzymeSourceId => VALID_SOURCE_IDS.has(source as RestrictionEnzymeSourceId));
    if (validated.length !== sources.length) throw new Error(`artifactState.enzymeSourcesByRecord.${recordId} contains an unknown source.`);
    result[recordId] = validated;
  }
  return result;
}

function normalizeBooleanByRecord(
  value: unknown,
  path: string,
  recordLengths: ReadonlyMap<string, number>,
): Record<string, boolean> {
  if (value === undefined) return createRecordMap();
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
  const result = createRecordMap<boolean>();
  for (const [recordId, rawValue] of Object.entries(value)) {
    if (!recordLengths.has(recordId)) continue;
    if (typeof rawValue !== 'boolean') throw new Error(`${path}.${recordId} must be a boolean.`);
    result[recordId] = rawValue;
  }
  return result;
}

function normalizeMotifs(
  value: unknown,
  recordLengths: ReadonlyMap<string, number>,
): Record<string, string> {
  if (value === undefined) return createRecordMap();
  if (!isObject(value)) throw new Error('artifactState.motifsByRecord must be an object.');
  const result = createRecordMap<string>();
  for (const [recordId, rawValue] of Object.entries(value)) {
    if (!recordLengths.has(recordId)) continue;
    if (typeof rawValue !== 'string' || rawValue.length > MAX_MOTIF_LENGTH) {
      throw new Error(
        `artifactState.motifsByRecord.${recordId} must be a string no longer than ${MAX_MOTIF_LENGTH} characters.`,
      );
    }
    result[recordId] = rawValue;
  }
  return result;
}

/** The ids of the circular records, whose translation layers may cross the origin. */
export function circularRecordIdsOf(
  records: Iterable<{ readonly id: string; readonly topology?: unknown }>,
): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.topology === 'circular') ids.add(record.id);
  }
  return ids;
}

const NO_CIRCULAR_RECORDS: ReadonlySet<string> = new Set();

/**
 * Validates and clones the durable workbench state. `circularRecordIds`
 * names the circular records; every other record is read as linear, so a
 * caller that leaves it out gets the linear rule for every layer.
 */
export function normalizeArtifactDurableState(
  value: unknown,
  recordLengths: ReadonlyMap<string, number>,
  circularRecordIds: ReadonlySet<string> = NO_CIRCULAR_RECORDS,
): ArtifactDurableState {
  if (value === undefined) {
    return {
      customEnzymes: [],
      translationLayersByRecord: createRecordMap(),
      enzymeSourcesByRecord: createRecordMap(),
      hiddenEnzymesByRecord: createRecordMap(),
      hiddenFeatureTranslationsByRecord: createRecordMap(),
      restrictionLabelsByRecord: createRecordMap(),
      motifsByRecord: createRecordMap(),
    };
  }
  if (!isObject(value)) throw new Error('artifactState must be an object.');
  return {
    customEnzymes: normalizeCustomEnzymes(value.customEnzymes),
    translationLayersByRecord: normalizeTranslationLayers(value.translationLayersByRecord, recordLengths, circularRecordIds),
    enzymeSourcesByRecord: normalizeRestrictionSources(value.enzymeSourcesByRecord, recordLengths),
    hiddenEnzymesByRecord: normalizeStringArraysByRecord(
      value.hiddenEnzymesByRecord,
      'artifactState.hiddenEnzymesByRecord',
      recordLengths,
      MAX_HIDDEN_ENZYMES_PER_RECORD,
    ),
    hiddenFeatureTranslationsByRecord: normalizeStringArraysByRecord(
      value.hiddenFeatureTranslationsByRecord,
      'artifactState.hiddenFeatureTranslationsByRecord',
      recordLengths,
      MAX_HIDDEN_FEATURE_TRANSLATIONS_PER_RECORD,
    ),
    restrictionLabelsByRecord: normalizeBooleanByRecord(
      value.restrictionLabelsByRecord,
      'artifactState.restrictionLabelsByRecord',
      recordLengths,
    ),
    motifsByRecord: normalizeMotifs(value.motifsByRecord, recordLengths),
  };
}
