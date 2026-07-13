import { basename } from 'node:path';

import { parseFasta } from '../../src/bio/fasta-parser.js';
import { parseGenBank } from '../../src/bio/genbank-parser.js';
import type { Feature, SequenceType, Topology } from '../../src/bio/types.js';

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
  maxRecords: 100,
  maxRecordResidues: 250_000,
  maxTotalResidues: 25_000_000,
  maxFeaturesPerRecord: 2_000,
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

function cleanSequence(value: unknown, molecule: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a sequence string.`);
  if (value.length > 1_000_000) throw new Error(`${path} cannot exceed 1,000,000 formatted characters.`);
  const sequence = value.toUpperCase().replace(/[\s\d]+/gu, '');
  if (!sequence) throw new Error(`${path} must contain at least one residue.`);
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
  if (recordContainers.length === 0) {
    throw new Error('Motif payload must explicitly contain records, entries, vectors, or record.');
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
  if (!Number.isFinite(feature.start) || !Number.isFinite(feature.end)) {
    throw new Error(`${path} must have finite start and end coordinates.`);
  }
  const start = Number(feature.start);
  const end = Number(feature.end);
  if (start < 0 || end <= start || end > sequenceLength) {
    throw new Error(`${path} coordinates must satisfy 0 <= start < end <= ${sequenceLength}.`);
  }
  if (feature.strand !== undefined && ![-1, 0, 1].includes(Number(feature.strand))) {
    throw new Error(`${path}.strand must be -1, 0, or 1.`);
  }
  if (feature.direction !== undefined
    && !['forward', 'reverse', 'none', -1, 0, 1].includes(feature.direction as string | number)) {
    throw new Error(`${path}.direction is not supported.`);
  }
  if (feature.subRanges !== undefined) {
    if (!Array.isArray(feature.subRanges) || feature.subRanges.length > 2_000) {
      throw new Error(`${path}.subRanges must be an array with at most 2,000 entries.`);
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
}

function validateRecord(record: unknown, index: number): number {
  const path = `payload.records[${index}]`;
  if (!isPlainObject(record)) throw new Error(`${path} must be a plain object.`);
  const molecule = record.molecule ?? record.type;
  if (molecule !== undefined && (!SEQUENCE_TYPES.has(molecule as SequenceType))) {
    throw new Error(`${path}.molecule must be dna, rna, protein, misc, unknown, or mixed.`);
  }
  if (record.topology !== undefined && record.topology !== 'linear' && record.topology !== 'circular') {
    throw new Error(`${path}.topology must be linear or circular.`);
  }
  for (const field of ['active', 'default', 'truncated'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'boolean') {
      throw new Error(`${path}.${field} must be a boolean when provided.`);
    }
  }
  if (record.tags !== undefined) {
    if (!Array.isArray(record.tags) || record.tags.length > 100) {
      throw new Error(`${path}.tags must be an array with at most 100 entries.`);
    }
    record.tags.forEach((tag, tagIndex) => {
      boundedOptionalText(tag, `${path}.tags[${tagIndex}]`, 256);
    });
  }
  for (const field of ['id', 'name', 'organism', 'source', 'group', 'project', 'folder', 'collection'] as const) {
    boundedOptionalText(record[field], `${path}.${field}`, MOTIF_MCP_LIMITS.maxShortTextLength);
  }
  boundedOptionalText(record.description, `${path}.description`, MOTIF_MCP_LIMITS.maxTextLength);
  const sequence = cleanSequence(record.sequence ?? record.seq, molecule, `${path}.sequence`);
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
  return sequence.length;
}

function coercePayload(value: unknown): MotifWorkbenchPayload {
  if (Array.isArray(value)) return { records: value };
  if (!isPlainObject(value)) throw new Error('Motif payload must be a JSON object or an array of records.');
  if (typeof value.sequence === 'string' || typeof value.seq === 'string') return { records: [value] };
  return value;
}

function cloneJsonObject(value: MotifWorkbenchPayload): MotifWorkbenchPayload {
  return JSON.parse(JSON.stringify(value)) as MotifWorkbenchPayload;
}

export function validateMotifPayload(value: unknown): {
  payload: MotifWorkbenchPayload;
  recordCount: number;
  residueCount: number;
} {
  const payload = coercePayload(value);
  validateJsonValue(payload, 'payload', { nodes: 0 }, new WeakSet());
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
  let activeRecords = 0;
  const residueCount = records.reduce<number>((total, record, index) => {
    if (isPlainObject(record)) {
      if (record.active !== false) activeRecords += 1;
      if (typeof record.id === 'string' && record.id.trim()) {
        const id = record.id.trim();
        if (explicitIds.has(id)) throw new Error(`Payload records contain duplicate id ${id}.`);
        explicitIds.add(id);
      }
    }
    return total + validateRecord(record, index);
  }, 0);
  if (records.length > 0 && activeRecords === 0) {
    throw new Error('A non-empty Motif payload must contain at least one active record.');
  }
  if (residueCount > MOTIF_MCP_LIMITS.maxTotalResidues) {
    throw new Error(`Payload cannot contain more than ${MOTIF_MCP_LIMITS.maxTotalResidues.toLocaleString()} residues in total.`);
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
