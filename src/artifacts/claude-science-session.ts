import type { RestrictionEnzyme } from '../bio/types';
import type { RestrictionEnzymeSourceId } from '../bio/restriction-presets';
import { VALID_NCBI_TABLE_IDS } from '../bio/codon-tables';

export const LARGE_SEQUENCE_DETAIL_THRESHOLD = 50_000;
/**
 * Database JSON is pretty-printed on export. A legal workspace containing the
 * full four-million-entry Sanger trace budget can therefore exceed the former
 * 32 MiB text ceiling even though the underlying AB1 files were individually
 * bounded. Keep restore parsing bounded, but leave enough room for that
 * supported workspace plus JSON indentation and record metadata.
 */
export const MAX_ARTIFACT_DATABASE_JSON_CHARACTERS = 128 * 1024 * 1024;
export const MOTIF_INVENTORY_SCHEMA_V1 = 'motif.claude-science.inventory.v1';
export const MOTIF_INVENTORY_SCHEMA = 'motif.claude-science.inventory.v2';
export const MAX_CUSTOM_ENZYMES = 100;
export const MAX_HIDDEN_ENZYMES_PER_RECORD = 512;
export const MAX_TRANSLATION_LAYERS_PER_RECORD = 200;
export const MAX_TRANSLATION_LAYER_TEXT_LENGTH = 160;
export const MAX_MOTIF_LENGTH = 256;
export const MAX_CUSTOM_ENZYME_NAME_LENGTH = 64;
export const MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH = 64;
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

const MOTIF_INVENTORY_SCHEMA_PREFIX = 'motif.claude-science.inventory.';
const SUPPORTED_MOTIF_INVENTORY_SCHEMAS = new Set([
  MOTIF_INVENTORY_SCHEMA_V1,
  MOTIF_INVENTORY_SCHEMA,
]);
const MAX_ARTIFACT_SCHEMA_LENGTH = 160;

export function assertArtifactJsonCharacterCount(characterCount: number): void {
  if (!Number.isSafeInteger(characterCount) || characterCount < 0) {
    throw new Error('Artifact JSON character count must be a non-negative safe integer.');
  }
  if (characterCount <= MAX_ARTIFACT_DATABASE_JSON_CHARACTERS) return;
  const maximumMiB = MAX_ARTIFACT_DATABASE_JSON_CHARACTERS / (1024 * 1024);
  throw new Error(
    `Artifact JSON exceeds the artifact maximum of ${maximumMiB.toLocaleString()} MiB. `
    + 'Split the inventory into smaller workspace backups.',
  );
}

function parseArtifactJsonObject(text: string): Record<string, unknown> | null {
  if (typeof text !== 'string') throw new Error('Artifact JSON input must be text.');
  assertArtifactJsonCharacterCount(text.length);
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    throw new Error(`Artifact JSON could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return isObject(parsed) ? parsed : null;
}

function validateArtifactDatabaseSchema(database: Record<string, unknown>): void {
  const { schema } = database;
  if (schema === undefined) return;
  if (typeof schema !== 'string' || !schema.trim() || schema !== schema.trim()
    || schema.length > MAX_ARTIFACT_SCHEMA_LENGTH) {
    throw new Error(`Database JSON schema must be a non-empty string no longer than ${MAX_ARTIFACT_SCHEMA_LENGTH} characters.`);
  }
  if (schema.startsWith(MOTIF_INVENTORY_SCHEMA_PREFIX)
    && !SUPPORTED_MOTIF_INVENTORY_SCHEMAS.has(schema)) {
    throw new Error(
      `Database JSON uses unsupported Motif inventory schema ${JSON.stringify(schema)}; `
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

export function parseArtifactDatabaseJson(text: string): Record<string, unknown> | null {
  const parsed = parseArtifactJsonObject(text);
  if (!parsed) return null;
  const hasRecords = Object.prototype.hasOwnProperty.call(parsed, 'records');
  const hasKnownInventorySchema = typeof parsed.schema === 'string'
    && parsed.schema.startsWith(MOTIF_INVENTORY_SCHEMA_PREFIX);
  if (!hasRecords && !hasKnownInventorySchema) return null;
  validateArtifactDatabaseSchema(parsed);
  if (!Array.isArray(parsed.records)) {
    throw new Error('Database JSON must contain a records array.');
  }
  return parsed;
}

/**
 * Recognize the bare object emitted by the active-record "Record JSON" export.
 * Validation and normalization intentionally remain with the existing Add
 * Entry record path; this helper only distinguishes a single record from a
 * complete workspace restore without interpreting arbitrary JSON as sequence
 * text.
 */
export function parseArtifactRecordJson(text: string): Record<string, unknown> | null {
  const parsed = parseArtifactJsonObject(text);
  if (!parsed || Object.prototype.hasOwnProperty.call(parsed, 'records')) return null;
  const hasSequence = typeof parsed.seq === 'string' || typeof parsed.sequence === 'string';
  return hasSequence ? parsed : null;
}

function normalizeCustomEnzymes(value: unknown): RestrictionEnzyme[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('artifactState.customEnzymes must be an array.');
  if (value.length > MAX_CUSTOM_ENZYMES) {
    throw new Error(`artifactState.customEnzymes cannot contain more than ${MAX_CUSTOM_ENZYMES} entries.`);
  }

  const byName = new Map<string, RestrictionEnzyme>();
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
    byName.set(name.toLowerCase(), { name, recognitionSequence, cutOffset, complementCutOffset, overhang: raw.overhang });
  });
  return Array.from(byName.values());
}

function normalizeTranslationLayers(
  value: unknown,
  recordLengths: ReadonlyMap<string, number>,
): Record<string, PortableTranslationTrack[]> {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error('artifactState.translationLayersByRecord must be an object.');
  const result: Record<string, PortableTranslationTrack[]> = {};

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
      if (start < 0 || end <= start || end > sequenceLength) {
        throw new Error(`${path} must use a valid 0-based [start,end) range within ${sequenceLength} residues.`);
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
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
  const result: Record<string, string[]> = {};
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
  const result: Record<string, RestrictionEnzymeSourceId[]> = {};
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
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
  const result: Record<string, boolean> = {};
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
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error('artifactState.motifsByRecord must be an object.');
  const result: Record<string, string> = {};
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

export function normalizeArtifactDurableState(
  value: unknown,
  recordLengths: ReadonlyMap<string, number>,
): ArtifactDurableState {
  if (value === undefined) {
    return {
      customEnzymes: [],
      translationLayersByRecord: {},
      enzymeSourcesByRecord: {},
      hiddenEnzymesByRecord: {},
      hiddenFeatureTranslationsByRecord: {},
      restrictionLabelsByRecord: {},
      motifsByRecord: {},
    };
  }
  if (!isObject(value)) throw new Error('artifactState must be an object.');
  return {
    customEnzymes: normalizeCustomEnzymes(value.customEnzymes),
    translationLayersByRecord: normalizeTranslationLayers(value.translationLayersByRecord, recordLengths),
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
