import { basename } from 'node:path';

import { parseFasta } from '../../src/bio/fasta-parser.js';
import { parseGenBank } from '../../src/bio/genbank-parser.js';
import type { Feature, SequenceType, Topology } from '../../src/bio/types.js';
import { normalizeArtifactAnalysisWorkspace } from '../../src/artifacts/claude-science-analysis-results.js';
import { normalizeArtifactAlignments } from '../../src/artifacts/claude-science-msa.js';
import {
  ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES,
  artifactSangerTraceSampleEntries,
  normalizeArtifactSangerTrace,
} from '../../src/artifacts/claude-science-sanger.js';
import { normalizeArtifactWorkspaceEnvelope } from '../../src/artifacts/claude-science-workspace-envelope.js';

import {
  MOTIF_WORKBENCH_RESULT_SCHEMA,
  motifWorkbenchResultSchema,
  type MotifWorkbenchPayload,
  type MotifWorkbenchResult,
} from './contracts.js';

export const MOTIF_MCP_LIMITS = Object.freeze({
  maxContentBytes: 4 * 1024 * 1024,
  maxPayloadBytes: 32 * 1024 * 1024,
  maxJsonDepth: 21,
  maxJsonNodes: 250_000,
  maxMetadataJsonDepth: 16,
  maxMetadataJsonNodes: 10_000,
  maxMetadataJsonBytes: 1_048_576,
  maxRecords: 100,
  maxRecordResidues: 250_000,
  maxTotalResidues: 25_000_000,
  maxFeaturesPerRecord: 2_000,
  maxSubRangesPerFeature: 2_000,
  maxSitesPerRecord: 2_048,
  maxHitsPerSite: 10_000,
  maxTotalHitsPerRecord: 50_000,
  maxOverhangLength: 64,
  maxTextLength: 16_384,
  maxShortTextLength: 1_024,
});

const SUPPORTED_INVENTORY_SCHEMAS = new Set([
  'motif.claude-science.inventory.v1',
  'motif.claude-science.inventory.v2',
]);
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SEQUENCE_TYPES = new Set<SequenceType>(['dna', 'rna', 'protein', 'misc', 'unknown', 'mixed']);
const NUCLEOTIDE_ALPHABET = /^[ACGTUNRYSWKMBDHV]+$/u;
const DNA_ALPHABET = /^[ACGTNRYSWKMBDHV]+$/u;
const RNA_ALPHABET = /^[ACGUNRYSWKMBDHV]+$/u;
const PROTEIN_ALPHABET = /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]+$/u;
const SAFE_FEATURE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\)|[a-z]+)$/iu;

type JsonBudget = { nodes: number };
type RecordLike = Record<string, unknown>;

export type MotifWorkbenchInput = {
  payload?: unknown;
  content?: string;
  filename?: string;
  title?: string;
  molecule?: 'dna' | 'rna' | 'protein';
  topology?: Topology;
};

function isPlainObject(value: unknown): value is RecordLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function validateJsonValue(
  value: unknown,
  path: string,
  budget: JsonBudget,
  seen: WeakSet<object>,
  depth = 0,
): void {
  budget.nodes += 1;
  if (budget.nodes > MOTIF_MCP_LIMITS.maxJsonNodes) {
    throw new Error(`Payload cannot contain more than ${MOTIF_MCP_LIMITS.maxJsonNodes.toLocaleString()} JSON nodes.`);
  }
  if (depth > MOTIF_MCP_LIMITS.maxJsonDepth) {
    throw new Error(`Payload cannot exceed ${MOTIF_MCP_LIMITS.maxJsonDepth} levels of JSON nesting.`);
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (value.length > MOTIF_MCP_LIMITS.maxPayloadBytes) {
      throw new Error(`${path} is too large.`);
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must not contain NaN or Infinity.`);
    return;
  }
  if (typeof value !== 'object') throw new Error(`${path} must contain JSON-compatible values only.`);
  if (seen.has(value)) throw new Error(`${path} must not contain circular references.`);
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new Error(`${path} must contain plain JSON objects only.`);
  }

  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`, budget, seen, depth + 1));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) throw new Error(`${path}.${key} is not an allowed object key.`);
      if (key.length > MOTIF_MCP_LIMITS.maxShortTextLength) throw new Error(`${path} contains an oversized object key.`);
      validateJsonValue(entry, `${path}.${key}`, budget, seen, depth + 1);
    }
  }
  seen.delete(value);
}

function boundedOptionalText(value: unknown, path: string, maximum: number): void {
  if (value === undefined) return;
  if (typeof value !== 'string') throw new Error(`${path} must be a string when provided.`);
  if (value.length > maximum) throw new Error(`${path} cannot exceed ${maximum.toLocaleString()} characters.`);
}

function validateMetadataJsonValue(
  value: unknown,
  path: string,
  seen = new WeakSet<object>(),
  depth = 0,
  budget = { nodes: 0, bytes: 0 },
): void {
  budget.nodes += 1;
  if (budget.nodes > MOTIF_MCP_LIMITS.maxMetadataJsonNodes) {
    throw new Error(`${path} exceeds the maximum of ${MOTIF_MCP_LIMITS.maxMetadataJsonNodes.toLocaleString()} JSON nodes.`);
  }
  if (depth > MOTIF_MCP_LIMITS.maxMetadataJsonDepth) {
    throw new Error(`${path} exceeds the maximum supported nesting depth of ${MOTIF_MCP_LIMITS.maxMetadataJsonDepth}.`);
  }
  if (value === null) {
    budget.bytes += 4;
  } else if (typeof value === 'string') {
    if (value.length > MOTIF_MCP_LIMITS.maxTextLength) {
      throw new Error(`${path} exceeds the maximum string length of ${MOTIF_MCP_LIMITS.maxTextLength.toLocaleString()} characters.`);
    }
    budget.bytes += utf8Bytes(JSON.stringify(value));
  } else if (typeof value === 'boolean') {
    budget.bytes += value ? 4 : 5;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must not contain NaN or Infinity.`);
    budget.bytes += String(value).length;
  } else {
    if (typeof value !== 'object') throw new Error(`${path} must contain JSON-compatible values only.`);
    if (seen.has(value)) throw new Error(`${path} must not contain circular references.`);
    if (!Array.isArray(value) && !isPlainObject(value)) throw new Error(`${path} must contain plain JSON objects only.`);
    seen.add(value);
    budget.bytes += 2;
    const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
    let entryCount = 0;
    for (const [key, entry] of entries) {
      if (!Array.isArray(value)) {
        if (UNSAFE_OBJECT_KEYS.has(String(key))) throw new Error(`${path}.${String(key)} is not an allowed object key.`);
        if (String(key).length > MOTIF_MCP_LIMITS.maxShortTextLength) {
          throw new Error(`${path} contains an oversized object key.`);
        }
        budget.bytes += utf8Bytes(JSON.stringify(String(key))) + 1;
      }
      if (entryCount > 0) budget.bytes += 1;
      entryCount += 1;
      validateMetadataJsonValue(entry, `${path}.${String(key)}`, seen, depth + 1, budget);
    }
    seen.delete(value);
  }
  if (budget.bytes > MOTIF_MCP_LIMITS.maxMetadataJsonBytes) {
    throw new Error(`${path} exceeds the maximum serialized size of 1 MiB.`);
  }
}

function normalizedRecordIdText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = Array.from(value).filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join('').trim();
  return normalized || null;
}

function uniqueRuntimeRecordId(base: string, usedIds: Set<string>): string {
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  for (let suffix = 2; suffix < 100_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Payload record id ${base} has too many collisions.`);
}

function cleanSequence(value: unknown, molecule: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a sequence string.`);
  if (value.length > 1_000_000) throw new Error(`${path} cannot exceed 1,000,000 formatted characters.`);
  const normalized = value.toUpperCase().replace(/[^A-Z*]/gu, '');
  const withoutStops = normalized.replace(/\*/gu, '');
  const looksLikeImplicitProtein = !/[a-z]/u.test(value.trim()) && !/[A-Z*][\t ]+[A-Z*]/u.test(value.trim());
  const sequence = molecule === 'dna'
    ? (DNA_ALPHABET.test(withoutStops) ? withoutStops : '')
    : molecule === 'rna'
      ? (RNA_ALPHABET.test(withoutStops) ? withoutStops : '')
      : molecule === 'protein'
        ? (PROTEIN_ALPHABET.test(normalized) ? normalized : '')
        : normalized.includes('*')
          ? (PROTEIN_ALPHABET.test(normalized) ? normalized : '')
          : NUCLEOTIDE_ALPHABET.test(withoutStops)
            ? withoutStops
            : PROTEIN_ALPHABET.test(withoutStops) && looksLikeImplicitProtein
              ? withoutStops
              : '';
  if (!sequence) throw new Error(`${path} must contain at least one valid residue.`);
  if (sequence.length > MOTIF_MCP_LIMITS.maxRecordResidues) {
    throw new Error(`${path} cannot exceed ${MOTIF_MCP_LIMITS.maxRecordResidues.toLocaleString()} residues.`);
  }
  const valid = molecule === 'dna'
    ? DNA_ALPHABET.test(sequence)
    : molecule === 'rna'
      ? RNA_ALPHABET.test(sequence)
      : molecule === 'protein'
        ? PROTEIN_ALPHABET.test(sequence)
        : NUCLEOTIDE_ALPHABET.test(sequence) || PROTEIN_ALPHABET.test(sequence);
  if (!valid) throw new Error(`${path} contains residues outside its declared molecule alphabet.`);
  return sequence;
}

function normalizedRecordType(value: unknown, sequence: string): SequenceType {
  if (SEQUENCE_TYPES.has(value as SequenceType)) return value as SequenceType;
  if (sequence.includes('*')) return 'protein';
  if (NUCLEOTIDE_ALPHABET.test(sequence)) return sequence.includes('U') && !sequence.includes('T') ? 'rna' : 'dna';
  return 'protein';
}

function validateRecordOverhangs(record: RecordLike, path: string, recordType: SequenceType): void {
  for (const field of ['overhang5', 'overhang3'] as const) {
    const value = record[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error(`${path}.${field} must be a DNA string when provided.`);
    if (value.length > MOTIF_MCP_LIMITS.maxOverhangLength) {
      throw new Error(`${path}.${field} cannot exceed ${MOTIF_MCP_LIMITS.maxOverhangLength} bases.`);
    }
    if (!/^[ACGTRYSWKMBDHVN]*$/u.test(value.toUpperCase().replace(/\s+/gu, ''))) {
      throw new Error(`${path}.${field} must contain DNA IUPAC bases only.`);
    }
    if (recordType !== 'dna') throw new Error(`${path}.${field} is valid on DNA records only.`);
  }
  for (const [sequenceField, typeField] of [
    ['overhang5', 'overhang5Type'],
    ['overhang3', 'overhang3Type'],
  ] as const) {
    const type = record[typeField];
    if (type === undefined) continue;
    if (type !== 'blunt' && type !== '5prime' && type !== '3prime') {
      throw new Error(`${path}.${typeField} must be blunt, 5prime, or 3prime.`);
    }
    if (recordType !== 'dna') throw new Error(`${path}.${typeField} is valid on DNA records only.`);
    const sequence = record[sequenceField];
    if (typeof sequence !== 'string') {
      throw new Error(`${path}.${typeField} requires a matching ${sequenceField} string.`);
    }
    const compact = sequence.replace(/\s+/gu, '');
    if (type === 'blunt' && compact.length > 0) {
      throw new Error(`${path}.${typeField} cannot be blunt when ${sequenceField} contains a sticky sequence.`);
    }
    if (type !== 'blunt' && compact.length === 0) {
      throw new Error(`${path}.${typeField} must be blunt when ${sequenceField} is empty.`);
    }
  }
}

function recordArray(payload: RecordLike): unknown[] {
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.vectors)) return payload.vectors;
  if (payload.record !== undefined) return [payload.record];
  return [];
}

function validatePayloadEnvelope(payload: RecordLike): void {
  for (const field of ['records', 'entries', 'vectors'] as const) {
    if (payload[field] !== undefined && !Array.isArray(payload[field])) {
      throw new Error(`payload.${field} must be an array when provided.`);
    }
  }
  if (payload.record !== undefined && !isPlainObject(payload.record)) {
    throw new Error('payload.record must be a plain object when provided.');
  }
  const recordContainers = ['records', 'entries', 'vectors', 'record']
    .filter(field => payload[field] !== undefined);
  const hasWorkspaceSidecar = ['alignment', 'alignments', 'notes', 'workflowResults', 'analysisResults', 'analysisAssets', 'artifactState']
    .some(field => payload[field] !== undefined);
  if (recordContainers.length === 0 && !hasWorkspaceSidecar) {
    throw new Error('Motif payload must contain records or a supported workspace sidecar.');
  }
  if (recordContainers.length > 1) {
    throw new Error(`Motif payload has ambiguous record containers: ${recordContainers.join(', ')}.`);
  }
  for (const field of ['schema', 'selectedRecordId', 'selectedName', 'defaultMotif', 'motif'] as const) {
    boundedOptionalText(payload[field], `payload.${field}`, MOTIF_MCP_LIMITS.maxShortTextLength);
  }
  if (payload.selectedIndex !== undefined && !Number.isInteger(payload.selectedIndex)) {
    throw new Error('payload.selectedIndex must be an integer when provided.');
  }
  if (payload.inventory !== undefined) {
    if (!isPlainObject(payload.inventory)) throw new Error('payload.inventory must be a plain object.');
    for (const field of ['id', 'title', 'updatedAt'] as const) {
      boundedOptionalText(payload.inventory[field], `payload.inventory.${field}`, MOTIF_MCP_LIMITS.maxShortTextLength);
    }
    boundedOptionalText(
      payload.inventory.description,
      'payload.inventory.description',
      MOTIF_MCP_LIMITS.maxTextLength,
    );
  }
}

function validateFeature(feature: unknown, path: string, sequenceLength: number): void {
  if (!isPlainObject(feature)) throw new Error(`${path} must be a plain object.`);
  for (const field of ['id', 'name', 'type', 'color'] as const) {
    boundedOptionalText(feature[field], `${path}.${field}`, MOTIF_MCP_LIMITS.maxShortTextLength);
  }
  if (typeof feature.color === 'string'
    && (feature.color.length > 80 || !SAFE_FEATURE_COLOR.test(feature.color.trim()))) {
    throw new Error(`${path}.color must be a simple CSS color value no longer than 80 characters.`);
  }
  if (!Number.isFinite(feature.start) || !Number.isFinite(feature.end)) {
    throw new Error(`${path} must have finite start and end coordinates.`);
  }
  const start = Number(feature.start);
  const end = Number(feature.end);
  if (start < 0 || end <= start || end > sequenceLength) {
    throw new Error(`${path} coordinates must satisfy 0 <= start < end <= ${sequenceLength}.`);
  }
  if (feature.strand !== undefined && ![-1, 0, 1].includes(feature.strand as number)) {
    throw new Error(`${path}.strand must be -1, 0, or 1.`);
  }
  if (feature.direction !== undefined
    && !['forward', 'reverse', 'none', -1, 0, 1].includes(feature.direction as string | number)) {
    throw new Error(`${path}.direction is not supported.`);
  }
  if (feature.metadata !== undefined) {
    if (!isPlainObject(feature.metadata)) throw new Error(`${path}.metadata must be a plain JSON object.`);
    validateMetadataJsonValue(feature.metadata, `${path}.metadata`);
  }
  if (feature.subRanges !== undefined) {
    if (!Array.isArray(feature.subRanges)
      || feature.subRanges.length > MOTIF_MCP_LIMITS.maxSubRangesPerFeature) {
      throw new Error(`${path}.subRanges must be an array with at most ${MOTIF_MCP_LIMITS.maxSubRangesPerFeature.toLocaleString()} entries.`);
    }
    feature.subRanges.forEach((range, index) => validateFeatureRange(range, `${path}.subRanges[${index}]`, sequenceLength));
  }
}

function validateFeatureRange(range: unknown, path: string, sequenceLength: number): void {
  if (!isPlainObject(range) || !Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    throw new Error(`${path} must have finite start and end coordinates.`);
  }
  const start = Number(range.start);
  const end = Number(range.end);
  if (start < 0 || end <= start || end > sequenceLength) {
    throw new Error(`${path} coordinates must satisfy 0 <= start < end <= ${sequenceLength}.`);
  }
  if (range.strand !== undefined && ![-1, 0, 1].includes(range.strand as number)) {
    throw new Error(`${path}.strand must be -1, 0, or 1.`);
  }
}

function validateSites(sites: unknown, path: string): void {
  if (!Array.isArray(sites)) throw new Error(`${path} must be an array of site objects.`);
  if (sites.length > MOTIF_MCP_LIMITS.maxSitesPerRecord) {
    throw new Error(`${path} cannot contain more than ${MOTIF_MCP_LIMITS.maxSitesPerRecord.toLocaleString()} entries.`);
  }
  let totalHits = 0;
  sites.forEach((site, siteIndex) => {
    const sitePath = `${path}[${siteIndex}]`;
    if (!isPlainObject(site)) throw new Error(`${sitePath} must be a plain object.`);
    for (const field of ['enzyme', 'motif'] as const) {
      boundedOptionalText(site[field], `${sitePath}.${field}`, MOTIF_MCP_LIMITS.maxShortTextLength);
    }
    if (site.count !== undefined && (!Number.isInteger(site.count) || Number(site.count) < 0)) {
      throw new Error(`${sitePath}.count must be a non-negative integer.`);
    }
    if (site.indexBase !== undefined && site.indexBase !== 0 && site.indexBase !== 1) {
      throw new Error(`${sitePath}.indexBase must be 0 or 1.`);
    }
    if (site.overhang !== undefined && site.overhang !== 'blunt' && site.overhang !== '5prime' && site.overhang !== '3prime') {
      throw new Error(`${sitePath}.overhang must be blunt, 5prime, or 3prime.`);
    }
    if (site.hits === undefined) return;
    if (!Array.isArray(site.hits)) throw new Error(`${sitePath}.hits must be an array.`);
    if (site.hits.length > MOTIF_MCP_LIMITS.maxHitsPerSite) {
      throw new Error(`${sitePath}.hits cannot contain more than ${MOTIF_MCP_LIMITS.maxHitsPerSite.toLocaleString()} entries.`);
    }
    totalHits += site.hits.length;
    site.hits.forEach((hit, hitIndex) => {
      const hitPath = `${sitePath}.hits[${hitIndex}]`;
      if (!isPlainObject(hit)) throw new Error(`${hitPath} must be a plain object.`);
      if (!Number.isFinite(hit.position) || Number(hit.position) < 0) {
        throw new Error(`${hitPath}.position must be a non-negative finite number.`);
      }
      if (hit.cutPosition !== undefined && (!Number.isFinite(hit.cutPosition) || Number(hit.cutPosition) < 0)) {
        throw new Error(`${hitPath}.cutPosition must be a non-negative finite number.`);
      }
      if (hit.strand !== undefined && hit.strand !== -1 && hit.strand !== 1) {
        throw new Error(`${hitPath}.strand must be -1 or 1.`);
      }
      if (hit.indexBase !== undefined && hit.indexBase !== 0 && hit.indexBase !== 1) {
        throw new Error(`${hitPath}.indexBase must be 0 or 1.`);
      }
    });
  });
  if (totalHits > MOTIF_MCP_LIMITS.maxTotalHitsPerRecord) {
    throw new Error(`${path} cannot contain more than ${MOTIF_MCP_LIMITS.maxTotalHitsPerRecord.toLocaleString()} hits in total.`);
  }
}

function validateRecord(record: unknown, index: number): { length: number; sangerTraceSamples: number } {
  const path = `payload.records[${index}]`;
  if (!isPlainObject(record)) throw new Error(`${path} must be a plain object.`);
  const molecule = record.molecule ?? record.type;
  for (const field of ['molecule', 'type'] as const) {
    if (record[field] !== undefined && !SEQUENCE_TYPES.has(record[field] as SequenceType)) {
      throw new Error(`${path}.${field} must be dna, rna, protein, misc, unknown, or mixed.`);
    }
  }
  if (record.topology !== undefined && record.topology !== 'linear' && record.topology !== 'circular') {
    throw new Error(`${path}.topology must be linear or circular.`);
  }
  for (const field of ['active', 'default', 'truncated'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'boolean') {
      throw new Error(`${path}.${field} must be a boolean when provided.`);
    }
  }
  if (record.truncated === true) {
    throw new Error(`${path} is marked as truncated; provide the complete record.`);
  }
  if (record.tags !== undefined) {
    if (!Array.isArray(record.tags) || record.tags.length > 100) {
      throw new Error(`${path}.tags must be an array with at most 100 entries.`);
    }
    record.tags.forEach((tag, tagIndex) => {
      boundedOptionalText(tag, `${path}.tags[${tagIndex}]`, 256);
    });
  }
  for (const field of ['id', 'name', 'organism', 'source', 'group', 'project', 'folder', 'collection', 'dateAdded'] as const) {
    boundedOptionalText(record[field], `${path}.${field}`, MOTIF_MCP_LIMITS.maxShortTextLength);
  }
  boundedOptionalText(record.description, `${path}.description`, MOTIF_MCP_LIMITS.maxTextLength);
  const sequence = cleanSequence(record.seq ?? record.sequence, molecule, `${path}.sequence`);
  const recordType = normalizedRecordType(molecule, sequence);
  validateRecordOverhangs(record, path, recordType);
  const features = [
    ...(Array.isArray(record.features) ? record.features : []),
    ...(Array.isArray(record.annotations) ? record.annotations : []),
  ];
  if (record.features !== undefined && !Array.isArray(record.features)) throw new Error(`${path}.features must be an array.`);
  if (record.annotations !== undefined && !Array.isArray(record.annotations)) throw new Error(`${path}.annotations must be an array.`);
  if (features.length > MOTIF_MCP_LIMITS.maxFeaturesPerRecord) {
    throw new Error(`${path} cannot contain more than ${MOTIF_MCP_LIMITS.maxFeaturesPerRecord.toLocaleString()} features.`);
  }
  features.forEach((feature, featureIndex) => validateFeature(feature, `${path}.features[${featureIndex}]`, sequence.length));
  if (record.sites !== undefined) validateSites(record.sites, `${path}.sites`);
  if (record.provenance !== undefined) {
    if (!isPlainObject(record.provenance)) throw new Error(`${path}.provenance must be a plain JSON object.`);
    validateMetadataJsonValue(record.provenance, `${path}.provenance`);
  }
  let sangerTraceSamples = 0;
  if (record.sangerTrace !== undefined) {
    if (recordType !== 'dna') throw new Error(`${path}.sangerTrace is only valid on DNA records.`);
    try {
      sangerTraceSamples = artifactSangerTraceSampleEntries(
        normalizeArtifactSangerTrace(record.sangerTrace, sequence),
      );
    } catch (error) {
      throw new Error(`${path}.sangerTrace is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { length: sequence.length, sangerTraceSamples };
}

function coercePayload(value: unknown): MotifWorkbenchPayload {
  if (Array.isArray(value)) return { records: value };
  if (!isPlainObject(value)) throw new Error('Motif payload must be a JSON object or an array of records.');
  if (['records', 'entries', 'vectors', 'record'].some((field) => (
    Object.prototype.hasOwnProperty.call(value, field)
  ))) {
    return value;
  }
  if (typeof value.sequence === 'string' || typeof value.seq === 'string') {
    const payload: RecordLike = { ...value, records: [value] };
    // The nested record is authoritative after coercion. Keeping a second
    // top-level trace would make the browser count the same large arrays as
    // arbitrary payload metadata even though the typed record trace is valid.
    delete payload.sangerTrace;
    return payload;
  }
  return value;
}

function cloneJsonObject(value: MotifWorkbenchPayload): MotifWorkbenchPayload {
  return JSON.parse(JSON.stringify(value)) as MotifWorkbenchPayload;
}

function omitTraceArraysForGenericJsonValidation(
  payload: MotifWorkbenchPayload,
  stripTopLevelBareTrace: boolean,
): MotifWorkbenchPayload {
  const stripRecord = (record: unknown): unknown => {
    if (!isPlainObject(record) || record.sangerTrace === undefined) return record;
    return {
      ...record,
      sangerTrace: isPlainObject(record.sangerTrace)
        ? { schema: record.sangerTrace.schema, version: record.sangerTrace.version }
        : record.sangerTrace,
    };
  };
  const projected: MotifWorkbenchPayload = { ...payload };
  for (const field of ['records', 'entries', 'vectors'] as const) {
    if (Array.isArray(projected[field])) projected[field] = projected[field].map(stripRecord);
  }
  if (projected.record !== undefined) projected.record = stripRecord(projected.record);
  if (stripTopLevelBareTrace && projected.sangerTrace !== undefined) {
    projected.sangerTrace = isPlainObject(projected.sangerTrace)
      ? { schema: projected.sangerTrace.schema, version: projected.sangerTrace.version }
      : projected.sangerTrace;
  }
  return projected;
}

export function validateMotifPayload(value: unknown): {
  payload: MotifWorkbenchPayload;
  recordCount: number;
  residueCount: number;
} {
  const isBareRecord = isPlainObject(value)
    && !['records', 'entries', 'vectors', 'record'].some((field) => (
      Object.prototype.hasOwnProperty.call(value, field)
    ))
    && (typeof value.seq === 'string' || typeof value.sequence === 'string');
  const payload = coercePayload(value);
  validateJsonValue(
    omitTraceArraysForGenericJsonValidation(payload, isBareRecord),
    'payload',
    { nodes: 0 },
    new WeakSet(),
  );
  validatePayloadEnvelope(payload);
  const serialized = JSON.stringify(payload);
  if (utf8Bytes(serialized) > MOTIF_MCP_LIMITS.maxPayloadBytes) {
    throw new Error(`Payload cannot exceed ${Math.floor(MOTIF_MCP_LIMITS.maxPayloadBytes / 1_048_576)} MiB.`);
  }
  if (typeof payload.schema === 'string'
    && payload.schema.startsWith('motif.claude-science.inventory.')
    && !SUPPORTED_INVENTORY_SCHEMAS.has(payload.schema)) {
    throw new Error(`Unsupported Motif inventory schema: ${payload.schema}.`);
  }
  const records = recordArray(payload);
  if (records.length > MOTIF_MCP_LIMITS.maxRecords) {
    throw new Error(`Payload cannot contain more than ${MOTIF_MCP_LIMITS.maxRecords} records.`);
  }
  const explicitIds = new Set<string>();
  const usedIds = new Set<string>();
  const recordLengths = new Map<string, number>();
  let activeRecords = 0;
  let totalSangerTraceSamples = 0;
  const residueCount = records.reduce<number>((total, record, index) => {
    const validatedRecord = validateRecord(record, index);
    const { length } = validatedRecord;
    totalSangerTraceSamples += validatedRecord.sangerTraceSamples;
    if (totalSangerTraceSamples > ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES) {
      throw new Error(
        `Payload chromatograms cannot contain more than ${ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES.toLocaleString()} channel sample entries in total.`,
      );
    }
    if (isPlainObject(record)) {
      if (record.active !== false) activeRecords += 1;
      const explicitId = normalizedRecordIdText(record.id);
      if (explicitId && explicitIds.has(explicitId)) throw new Error(`Payload records contain duplicate id ${explicitId}.`);
      if (explicitId) explicitIds.add(explicitId);
      const id = uniqueRuntimeRecordId(
        explicitId ?? normalizedRecordIdText(record.name) ?? `record-${index + 1}`,
        usedIds,
      );
      if (record.active !== false) recordLengths.set(id, length);
    }
    return total + length;
  }, 0);
  if (records.length > 0 && activeRecords === 0) {
    throw new Error('A non-empty Motif payload must contain at least one active record.');
  }
  if (residueCount > MOTIF_MCP_LIMITS.maxTotalResidues) {
    throw new Error(`Payload cannot contain more than ${MOTIF_MCP_LIMITS.maxTotalResidues.toLocaleString()} residues in total.`);
  }
  try {
    normalizeArtifactAlignments(payload.alignments ?? payload.alignment);
  } catch (error) {
    throw new Error(`Payload alignment workspace is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    normalizeArtifactWorkspaceEnvelope(payload, recordLengths);
  } catch (error) {
    throw new Error(`Payload workspace is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    normalizeArtifactAnalysisWorkspace({
      analysisResults: payload.analysisResults,
      analysisAssets: payload.analysisAssets,
    }, { recordLengths });
  } catch (error) {
    throw new Error(`Payload analysis workspace is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { payload: cloneJsonObject(payload), recordCount: records.length, residueCount };
}

function safeSourceName(filename: string | undefined): string | undefined {
  if (!filename?.trim()) return undefined;
  const cleaned = basename(filename.replace(/\0/gu, '')).trim().slice(0, 512);
  return cleaned || undefined;
}

function inferredMolecule(sequence: string, hint?: 'dna' | 'rna' | 'protein'): 'dna' | 'rna' | 'protein' {
  if (hint) return hint;
  const upper = sequence.toUpperCase();
  if (upper.includes('U') && !upper.includes('T') && RNA_ALPHABET.test(upper)) return 'rna';
  if (DNA_ALPHABET.test(upper)) return 'dna';
  return 'protein';
}

function moleculeHintFromInput(input: MotifWorkbenchInput): 'dna' | 'rna' | 'protein' | undefined {
  if (input.molecule) return input.molecule;
  const filename = input.filename?.toLowerCase() ?? '';
  if (/\.(?:faa|pep|protein)$/u.test(filename)) return 'protein';
  if (/\.(?:fna|ffn)$/u.test(filename)) return 'dna';
  return undefined;
}

function uniqueId(name: string, used: Set<string>): string {
  const root = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 72)
    || 'record';
  if (!used.has(root)) {
    used.add(root);
    return root;
  }
  for (let index = 2; index <= 10_000; index += 1) {
    const candidate = `${root}-${index}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error('Could not create a unique record identifier.');
}

function recordsFromFasta(content: string, input: MotifWorkbenchInput): RecordLike[] {
  const parsed = parseFasta(content);
  if (parsed.length === 0) throw new Error('No complete FASTA records were found.');
  const usedIds = new Set<string>();
  return parsed.map((record, index) => {
    const name = (record.rawHeader || record.header || `FASTA record ${index + 1}`).trim().slice(0, 1_024);
    const molecule = inferredMolecule(record.sequence, moleculeHintFromInput(input));
    return {
      id: uniqueId(name, usedIds),
      name,
      sequence: record.sequence.toUpperCase(),
      molecule,
      topology: input.topology ?? 'linear',
      ...(record.description ? { description: record.description.slice(0, MOTIF_MCP_LIMITS.maxTextLength) } : {}),
      source: 'FASTA opened in Motif for Claude Science',
      ...(record.gapsRemoved ? { provenance: { gapsRemoved: record.gapsRemoved } } : {}),
      active: true,
    };
  });
}

function serializableFeatures(features: Feature[]): Array<Record<string, unknown>> {
  return features.map(feature => ({
    id: feature.id,
    name: feature.name,
    type: feature.type,
    start: feature.start,
    end: feature.end,
    strand: feature.strand,
    color: feature.color,
    metadata: feature.metadata,
    ...(feature.subRanges ? { subRanges: feature.subRanges } : {}),
  }));
}

function recordsFromGenBank(content: string): RecordLike[] {
  const parsed = parseGenBank(content);
  if (parsed.length === 0) throw new Error('No complete GenBank records were found.');
  const proteinRecordHints = content
    .split(/^\s*\/\/\s*$/mu)
    .filter(block => /^\s*LOCUS\b/mu.test(block))
    .map(block => /^\s*LOCUS\b.*\b\d+\s+aa\b/imu.test(block));
  const usedIds = new Set<string>();
  return parsed.map((record, index) => {
    if (record.truncated || (record.length > 0 && record.length !== record.sequence.length)) {
      throw new Error(`GenBank record ${record.name || index + 1} is incomplete; include the full ORIGIN sequence.`);
    }
    const name = (record.name || record.accession || `GenBank record ${index + 1}`).slice(0, 1_024);
    const molecule = proteinRecordHints[index]
      ? 'protein'
      : record.moleculeType.toLowerCase().includes('rna')
      ? 'rna'
      : inferredMolecule(record.sequence);
    return {
      id: uniqueId(record.accession || record.version || name, usedIds),
      name,
      sequence: record.sequence.toUpperCase(),
      molecule,
      topology: record.topology,
      features: serializableFeatures(record.features),
      ...(record.definition ? { description: record.definition.slice(0, MOTIF_MCP_LIMITS.maxTextLength) } : {}),
      ...(record.organism ? { organism: record.organism.slice(0, 1_024) } : {}),
      source: record.source?.slice(0, 1_024) || 'GenBank opened in Motif for Claude Science',
      active: true,
    };
  });
}

function payloadFromContent(content: string, input: MotifWorkbenchInput): MotifWorkbenchPayload {
  if (utf8Bytes(content) > MOTIF_MCP_LIMITS.maxContentBytes) {
    throw new Error(`Artifact content cannot exceed ${Math.floor(MOTIF_MCP_LIMITS.maxContentBytes / 1_048_576)} MiB.`);
  }
  const text = content.trim();
  if (!text) throw new Error('Artifact content is empty.');
  const sourceName = safeSourceName(input.filename);
  const inventory = {
    title: input.title?.trim() || sourceName || 'Motif sequence inventory',
    description: sourceName
      ? `Opened from ${sourceName} in Motif for Claude Science.`
      : 'Opened in Motif for Claude Science.',
  };

  if (text.startsWith('{') || text.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('JSON artifact content is malformed.');
    }
    const validated = validateMotifPayload(parsed);
    return input.title
      ? { ...validated.payload, inventory: { ...(isPlainObject(validated.payload.inventory) ? validated.payload.inventory : {}), title: input.title } }
      : validated.payload;
  }
  const records = /^\s*LOCUS\s/mu.test(text)
    ? recordsFromGenBank(text)
    : text.includes('>')
      ? recordsFromFasta(text, input)
      : [{
        id: uniqueId(sourceName?.replace(/\.[^.]+$/u, '') || 'pasted-sequence', new Set()),
        name: sourceName?.replace(/\.[^.]+$/u, '') || 'Pasted sequence',
        sequence: text,
        molecule: moleculeHintFromInput(input),
        topology: input.topology ?? 'linear',
        source: sourceName ? `Raw sequence from ${sourceName}` : 'Raw sequence opened in Motif for Claude Science',
        active: true,
      }];
  return {
    schema: 'motif.claude-science.inventory.v2',
    inventory,
    records,
  };
}

export function prepareMotifWorkbench(input: MotifWorkbenchInput): MotifWorkbenchResult {
  if (input.payload !== undefined && input.content !== undefined) {
    throw new Error('Provide either payload or content, not both.');
  }
  const sourceName = safeSourceName(input.filename);
  if (input.payload === undefined && input.content === undefined) {
    return motifWorkbenchResultSchema.parse({
      schema: MOTIF_WORKBENCH_RESULT_SCHEMA,
      mode: 'sample',
      ...(sourceName ? { sourceName } : {}),
      recordCount: 0,
      residueCount: 0,
    });
  }
  const candidate = input.content !== undefined ? payloadFromContent(input.content, input) : input.payload;
  const validated = validateMotifPayload(candidate);
  const payload = input.title && input.content === undefined
    ? {
      ...validated.payload,
      inventory: {
        ...(isPlainObject(validated.payload.inventory) ? validated.payload.inventory : {}),
        title: input.title,
      },
    }
    : validated.payload;
  return motifWorkbenchResultSchema.parse({
    schema: MOTIF_WORKBENCH_RESULT_SCHEMA,
    mode: input.content === undefined ? 'payload' : 'artifact',
    ...(sourceName ? { sourceName } : {}),
    payload,
    recordCount: validated.recordCount,
    residueCount: validated.residueCount,
  });
}
