/**
 * Portable, inert analysis results for the standalone Claude Science artifact.
 *
 * This module deliberately stores text and JSON only. It does not render or
 * execute supplied content, accept HTML/SVG media, generate ids/timestamps, or
 * mutate caller-owned arrays. UI and persistence integration can therefore use
 * the same normalizer at every boundary (agent API, import, restore, export).
 */

import type {
  ArtifactJsonObject,
  ArtifactJsonPrimitive,
  ArtifactJsonValue,
  ArtifactProvenance,
  ArtifactSequenceRange,
} from './claude-science-workspace-collections';
import { sha256HexSync } from './claude-science-sha256';

export const MAX_ARTIFACT_ANALYSIS_RESULTS = 1_000;
export const MAX_ARTIFACT_ANALYSIS_ASSETS = 2_000;
export const MAX_ARTIFACT_ANALYSIS_ASSET_BYTES = 2_097_152;
export const MAX_ARTIFACT_ANALYSIS_TOTAL_ASSET_BYTES = 16_777_216;
export const MAX_ARTIFACT_ANALYSIS_TEXT_CHARACTERS = 8_388_608;
export const MAX_ARTIFACT_ANALYSIS_STRUCTURED_NODES = 50_000;
export const MAX_ARTIFACT_ANALYSIS_DEPTH = 12;
export const MAX_ARTIFACT_ANALYSIS_ARRAY_ENTRIES = 10_000;
export const MAX_ARTIFACT_ANALYSIS_RECORD_IDS = 250;
export const MAX_ARTIFACT_ANALYSIS_DEPENDENCIES = 250;
export const MAX_ARTIFACT_ANALYSIS_ASSET_IDS = 250;
export const MAX_ARTIFACT_ANALYSIS_NAME_LENGTH = 256;
export const MAX_ARTIFACT_ANALYSIS_ID_LENGTH = 160;
export const MAX_ARTIFACT_ANALYSIS_SUMMARY_LENGTH = 16_384;
export const MAX_ARTIFACT_ANALYSIS_TABLE_COLUMNS = 256;
export const MAX_ARTIFACT_ANALYSIS_TABLE_ROWS = 10_000;

export const ARTIFACT_ANALYSIS_KINDS = [
  'primer_design',
  'pcr',
  'assembly_plan',
  'construct_verification',
  'blast_search',
  'structure_model',
  'report',
  'table',
] as const;

export const ARTIFACT_ANALYSIS_ASSET_MEDIA_TYPES = [
  'application/json',
  'chemical/x-cif',
  'chemical/x-mmcif',
  'chemical/x-pdb',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/tab-separated-values',
  'text/x-fasta',
] as const;

export type ArtifactAnalysisKind = typeof ARTIFACT_ANALYSIS_KINDS[number];
export type ArtifactAnalysisAssetMediaType = typeof ARTIFACT_ANALYSIS_ASSET_MEDIA_TYPES[number];
export type ArtifactAnalysisStatus = 'complete' | 'partial' | 'failed';

export type ArtifactAnalysisAsset = {
  id: string;
  name: string;
  mediaType: ArtifactAnalysisAssetMediaType;
  /** UTF-8 text. Consumers must treat it as inert data, never markup. */
  content: string;
  sha256?: string;
  createdAt: string;
  provenance: ArtifactProvenance;
};

export type ArtifactPrimer = {
  sequence: string;
  tmC: number;
  gcPercent: number;
  start?: number;
  end?: number;
  tail5?: string;
};

export type ArtifactPrimerPair = {
  id: string;
  forward: ArtifactPrimer;
  reverse: ArtifactPrimer;
  productLengthBp: number;
  score?: number;
  warnings?: string[];
};

export type ArtifactPrimerDesignData = {
  targetRecordId: string;
  targetRange?: ArtifactSequenceRange;
  pairs: ArtifactPrimerPair[];
  selectedPairId?: string;
};

export type ArtifactPcrProduct = {
  id: string;
  lengthBp: number;
  recordId?: string;
  templateRange?: ArtifactSequenceRange;
};

export type ArtifactPcrData = {
  templateRecordId: string;
  primerDesignResultId?: string;
  products: ArtifactPcrProduct[];
};

export type ArtifactAssemblyMethod = 'golden_gate' | 'golden_braid' | 'gibson' | 'ligation' | 'other';

export type ArtifactAssemblyJunction = {
  leftRecordId: string;
  rightRecordId: string;
  compatible: boolean;
  overhang?: string;
  note?: string;
};

export type ArtifactAssemblyPlanData = {
  method: ArtifactAssemblyMethod;
  orderedPartRecordIds: string[];
  destinationRecordId?: string;
  productRecordId?: string;
  standard?: string;
  enzyme?: string;
  junctions?: ArtifactAssemblyJunction[];
};

export type ArtifactConstructVerificationState = 'consistent' | 'needs_review' | 'inconsistent';

/**
 * Compact durable summary of a construct-verification run. Per-base depth and
 * alignment coordinate maps stay in the live viewer; an optional inert JSON
 * report asset can retain bounded read/variant detail without inflating every
 * result row or workspace parse.
 */
export type ArtifactConstructVerificationData = {
  referenceRecordId: string;
  readRecordIds: string[];
  state: ArtifactConstructVerificationState;
  referenceLength: number;
  coveredBases: number;
  coverageFraction: number;
  mappedReadCount: number;
  requiredRegionCount: number;
  passingRegionCount: number;
  observedVariantCount: number;
  expectedVariantCount: number;
  unexpectedVariantCount: number;
  missingExpectedVariantCount: number;
  reasonCodes: string[];
  verificationReportAssetId?: string;
};

export type ArtifactBlastHit = {
  accession: string;
  title: string;
  identityPercent: number;
  queryCoveragePercent: number;
  eValue: number;
  bitScore: number;
  queryStart?: number;
  queryEnd?: number;
  subjectStart?: number;
  subjectEnd?: number;
  alignmentAssetId?: string;
};

export type ArtifactBlastSearchData = {
  program: 'blastn' | 'blastp' | 'blastx' | 'tblastn' | 'tblastx';
  database: string;
  databaseVersion?: string;
  queryRecordId: string;
  hits: ArtifactBlastHit[];
};

export type ArtifactStructureChain = {
  id: string;
  recordId?: string;
  residueCount?: number;
};

export type ArtifactStructureModelData = {
  format: 'pdb' | 'mmcif';
  modelAssetId: string;
  method: string;
  chains: ArtifactStructureChain[];
  metrics?: ArtifactJsonObject;
};

export type ArtifactReportData = {
  format: 'plain' | 'markdown';
  body?: string;
  bodyAssetId?: string;
};

export type ArtifactTableColumn = {
  id: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'mixed';
};

export type ArtifactTableData = {
  columns: ArtifactTableColumn[];
  rows: ArtifactJsonPrimitive[][];
};

type ArtifactAnalysisDataByKind = {
  primer_design: ArtifactPrimerDesignData;
  pcr: ArtifactPcrData;
  assembly_plan: ArtifactAssemblyPlanData;
  construct_verification: ArtifactConstructVerificationData;
  blast_search: ArtifactBlastSearchData;
  structure_model: ArtifactStructureModelData;
  report: ArtifactReportData;
  table: ArtifactTableData;
};

type ArtifactAnalysisResultForKind<K extends ArtifactAnalysisKind> = {
  id: string;
  kind: K;
  name: string;
  status: ArtifactAnalysisStatus;
  summary?: string;
  inputRecordIds: string[];
  inputSha256s?: string[];
  dependsOnResultIds: string[];
  assetIds: string[];
  parameters: ArtifactJsonObject;
  data: ArtifactAnalysisDataByKind[K];
  createdAt: string;
  provenance: ArtifactProvenance;
};

export type ArtifactAnalysisResult = {
  [K in ArtifactAnalysisKind]: ArtifactAnalysisResultForKind<K>
}[ArtifactAnalysisKind];

export type ArtifactAnalysisWorkspace = {
  analysisResults: ArtifactAnalysisResult[];
  analysisAssets: ArtifactAnalysisAsset[];
};

export type ArtifactAnalysisWorkspaceFields = {
  analysisResults?: ArtifactAnalysisResult[];
  analysisAssets?: ArtifactAnalysisAsset[];
};

export type ArtifactAnalysisContext = {
  recordLengths?: ReadonlyMap<string, number>;
};

export type ArtifactAnalysisResultContext = ArtifactAnalysisContext & {
  /** Required when a result references one or more analysis assets. */
  analysisAssets?: unknown;
};

type Budget = {
  nodes: number;
  textCharacters: number;
  assetBytes: number;
};

const ANALYSIS_KIND_SET = new Set<ArtifactAnalysisKind>(ARTIFACT_ANALYSIS_KINDS);
const ASSET_MEDIA_TYPE_SET = new Set<ArtifactAnalysisAssetMediaType>(ARTIFACT_ANALYSIS_ASSET_MEDIA_TYPES);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STATUS_SET = new Set<ArtifactAnalysisStatus>(['complete', 'partial', 'failed']);
const ASSEMBLY_METHOD_SET = new Set<ArtifactAssemblyMethod>(['golden_gate', 'golden_braid', 'gibson', 'ligation', 'other']);
const BLAST_PROGRAM_SET = new Set<ArtifactBlastSearchData['program']>(['blastn', 'blastp', 'blastx', 'tblastn', 'tblastx']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${path}.${key} is not a recognized field.`);
  }
}

function consumeText(value: string, path: string, budget: Budget): void {
  budget.textCharacters += value.length;
  if (budget.textCharacters > MAX_ARTIFACT_ANALYSIS_TEXT_CHARACTERS) {
    throw new Error(`${path} makes analysis data exceed the text-character limit.`);
  }
}

function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
  budget: Budget,
  options: { trim?: boolean; allowBlank?: boolean } = {},
): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
  const normalized = options.trim === false ? value.replace(/\r\n?/g, '\n') : value.trim();
  if (!options.allowBlank && !normalized.trim()) throw new Error(`${path} must not be blank.`);
  if (normalized.length > maxLength) throw new Error(`${path} cannot exceed ${maxLength.toLocaleString()} characters.`);
  consumeText(normalized, path, budget);
  return normalized;
}

function normalizeId(value: unknown, path: string, budget: Budget): string {
  return boundedString(value, path, MAX_ARTIFACT_ANALYSIS_ID_LENGTH, budget);
}

function normalizeTimestamp(value: unknown, path: string, budget: Budget): string {
  const raw = boundedString(value, path, 64, budget);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || !Number.isFinite(Date.parse(raw))) {
    throw new Error(`${path} must be a valid ISO 8601 date-time.`);
  }
  return new Date(Date.parse(raw)).toISOString();
}

function finiteNumber(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
  if (options.integer && !Number.isInteger(value)) throw new Error(`${path} must be an integer.`);
  if (options.min !== undefined && value < options.min) throw new Error(`${path} must be at least ${options.min}.`);
  if (options.max !== undefined && value > options.max) throw new Error(`${path} must be no greater than ${options.max}.`);
  return value;
}

function normalizeRange(value: unknown, path: string, maxLength?: number): ArtifactSequenceRange {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['start', 'end'], path);
  const start = finiteNumber(value.start, `${path}.start`, { min: 0, integer: true });
  const end = finiteNumber(value.end, `${path}.end`, { min: 1, integer: true });
  if (end <= start) throw new Error(`${path}.end must be greater than start.`);
  if (maxLength !== undefined && end > maxLength) throw new Error(`${path} must fit within the ${maxLength}-residue record.`);
  return { start, end };
}

function normalizeStringArray(
  value: unknown,
  path: string,
  maxEntries: number,
  budget: Budget,
  options: { required?: boolean; deduplicate?: boolean } = {},
): string[] {
  if (value === undefined && !options.required) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > maxEntries) throw new Error(`${path} cannot contain more than ${maxEntries.toLocaleString()} entries.`);
  const normalized = value.map((item, index) => normalizeId(item, `${path}[${index}]`, budget));
  const result = options.deduplicate ? Array.from(new Set(normalized)) : normalized;
  if (options.deduplicate && result.length !== normalized.length) throw new Error(`${path} cannot contain duplicate ids.`);
  return result;
}

function normalizeJsonValue(
  value: unknown,
  path: string,
  budget: Budget,
  ancestors: WeakSet<object>,
  depth: number,
): ArtifactJsonValue {
  budget.nodes += 1;
  if (budget.nodes > MAX_ARTIFACT_ANALYSIS_STRUCTURED_NODES) throw new Error(`${path} exceeds the structured-data node limit.`);
  if (depth > MAX_ARTIFACT_ANALYSIS_DEPTH) throw new Error(`${path} exceeds the maximum structured-data depth.`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return boundedString(value, path, 16_384, budget, { trim: false, allowBlank: true });
  if (typeof value === 'number') return finiteNumber(value, path);
  if (typeof value !== 'object' || value === null) throw new Error(`${path} must contain JSON-compatible data only.`);
  if (ancestors.has(value)) throw new Error(`${path} must not contain circular references.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARTIFACT_ANALYSIS_ARRAY_ENTRIES) throw new Error(`${path} contains too many entries.`);
      return value.map((item, index) => normalizeJsonValue(item, `${path}[${index}]`, budget, ancestors, depth + 1));
    }
    if (!isPlainObject(value)) throw new Error(`${path} must contain plain JSON objects only.`);
    const entries = Object.entries(value);
    if (entries.length > MAX_ARTIFACT_ANALYSIS_ARRAY_ENTRIES) throw new Error(`${path} contains too many properties.`);
    const normalized: ArtifactJsonObject = {};
    for (const [key, item] of entries) {
      if (!key || key.length > 256 || UNSAFE_KEYS.has(key)) throw new Error(`${path}.${key} is not an allowed object key.`);
      consumeText(key, `${path}.${key}`, budget);
      normalized[key] = normalizeJsonValue(item, `${path}.${key}`, budget, ancestors, depth + 1);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function normalizeJsonObject(value: unknown, path: string, budget: Budget): ArtifactJsonObject {
  if (!isPlainObject(value)) throw new Error(`${path} must be a plain JSON object.`);
  return normalizeJsonValue(value, path, budget, new WeakSet<object>(), 0) as ArtifactJsonObject;
}

function normalizeProvenance(value: unknown, path: string, budget: Budget): ArtifactProvenance {
  if (!isPlainObject(value)) throw new Error(`${path} is required and must be an object.`);
  assertKnownKeys(value, ['source', 'operation', 'actor', 'engine', 'engineVersion', 'parentIds', 'metadata'], path);
  const text = (field: string): string | undefined => value[field] === undefined
    ? undefined
    : boundedString(value[field], `${path}.${field}`, 256, budget);
  const source = boundedString(value.source, `${path}.source`, 256, budget);
  const operation = text('operation');
  const actor = text('actor');
  const engine = text('engine');
  const engineVersion = text('engineVersion');
  const parentIds = value.parentIds === undefined
    ? undefined
    : normalizeStringArray(value.parentIds, `${path}.parentIds`, MAX_ARTIFACT_ANALYSIS_DEPENDENCIES, budget, { deduplicate: true });
  const metadata = value.metadata === undefined ? undefined : normalizeJsonObject(value.metadata, `${path}.metadata`, budget);
  return {
    source,
    ...(operation === undefined ? {} : { operation }),
    ...(actor === undefined ? {} : { actor }),
    ...(engine === undefined ? {} : { engine }),
    ...(engineVersion === undefined ? {} : { engineVersion }),
    ...(parentIds === undefined ? {} : { parentIds }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function normalizeSha256(value: unknown, path: string, budget: Budget): string {
  const sha256 = boundedString(value, path, 64, budget).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${path} must be a 64-character SHA-256 value.`);
  return sha256;
}

function normalizeAsset(value: unknown, index: number, budget: Budget): ArtifactAnalysisAsset {
  const path = `analysisAssets[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['id', 'name', 'mediaType', 'content', 'sha256', 'createdAt', 'provenance'], path);
  const id = normalizeId(value.id, `${path}.id`, budget);
  const name = boundedString(value.name, `${path}.name`, MAX_ARTIFACT_ANALYSIS_NAME_LENGTH, budget);
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error(`${path}.name cannot contain path separators or NUL.`);
  }
  if (typeof value.mediaType !== 'string') throw new Error(`${path}.mediaType must be a string.`);
  const mediaType = value.mediaType.trim().toLowerCase() as ArtifactAnalysisAssetMediaType;
  if (!ASSET_MEDIA_TYPE_SET.has(mediaType)) {
    throw new Error(`${path}.mediaType is not an allowed inert text/JSON media type; HTML, SVG, and binary assets are forbidden.`);
  }
  const content = boundedString(value.content, `${path}.content`, MAX_ARTIFACT_ANALYSIS_ASSET_BYTES, budget, {
    trim: false,
    allowBlank: true,
  });
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes > MAX_ARTIFACT_ANALYSIS_ASSET_BYTES) {
    throw new Error(`${path}.content cannot exceed ${MAX_ARTIFACT_ANALYSIS_ASSET_BYTES.toLocaleString()} UTF-8 bytes.`);
  }
  budget.assetBytes += bytes;
  if (budget.assetBytes > MAX_ARTIFACT_ANALYSIS_TOTAL_ASSET_BYTES) {
    throw new Error(`analysisAssets cannot exceed ${MAX_ARTIFACT_ANALYSIS_TOTAL_ASSET_BYTES.toLocaleString()} UTF-8 bytes in total.`);
  }
  if (mediaType === 'application/json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`${path}.content must be valid JSON for application/json.`);
    }
    normalizeJsonValue(parsed, `${path}.content JSON`, budget, new WeakSet<object>(), 0);
  }
  const sha256 = value.sha256 === undefined ? undefined : normalizeSha256(value.sha256, `${path}.sha256`, budget);
  if (sha256 !== undefined && sha256 !== sha256HexSync(content)) {
    throw new Error(`${path}.sha256 must match the exact UTF-8 content.`);
  }
  return {
    id,
    name,
    mediaType,
    content,
    ...(sha256 === undefined ? {} : { sha256 }),
    createdAt: normalizeTimestamp(value.createdAt, `${path}.createdAt`, budget),
    provenance: normalizeProvenance(value.provenance, `${path}.provenance`, budget),
  };
}

function normalizePrimer(value: unknown, path: string, budget: Budget): ArtifactPrimer {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['sequence', 'tmC', 'gcPercent', 'start', 'end', 'tail5'], path);
  const sequence = boundedString(value.sequence, `${path}.sequence`, 1_000, budget).toUpperCase();
  if (!/^[ACGTUNRYKMSWBDHV-]+$/.test(sequence)) throw new Error(`${path}.sequence must contain IUPAC nucleotide symbols only.`);
  const start = value.start === undefined ? undefined : finiteNumber(value.start, `${path}.start`, { min: 0, integer: true });
  const end = value.end === undefined ? undefined : finiteNumber(value.end, `${path}.end`, { min: 1, integer: true });
  if ((start === undefined) !== (end === undefined)) throw new Error(`${path}.start and end must be supplied together.`);
  if (start !== undefined && end !== undefined && end <= start) throw new Error(`${path}.end must be greater than start.`);
  const tail5 = value.tail5 === undefined
    ? undefined
    : boundedString(value.tail5, `${path}.tail5`, 500, budget).toUpperCase();
  if (tail5 !== undefined && !/^[ACGTUNRYKMSWBDHV-]+$/.test(tail5)) throw new Error(`${path}.tail5 must contain IUPAC nucleotide symbols only.`);
  return {
    sequence,
    tmC: finiteNumber(value.tmC, `${path}.tmC`, { min: -100, max: 200 }),
    gcPercent: finiteNumber(value.gcPercent, `${path}.gcPercent`, { min: 0, max: 100 }),
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
    ...(tail5 === undefined ? {} : { tail5 }),
  };
}

function normalizePrimerDesignData(value: unknown, path: string, budget: Budget, context: ArtifactAnalysisContext): ArtifactPrimerDesignData {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['targetRecordId', 'targetRange', 'pairs', 'selectedPairId'], path);
  const targetRecordId = normalizeId(value.targetRecordId, `${path}.targetRecordId`, budget);
  const targetLength = context.recordLengths?.get(targetRecordId);
  if (context.recordLengths && targetLength === undefined) throw new Error(`${path}.targetRecordId does not match a workspace record.`);
  const targetRange = value.targetRange === undefined ? undefined : normalizeRange(value.targetRange, `${path}.targetRange`, targetLength);
  if (!Array.isArray(value.pairs)) throw new Error(`${path}.pairs must be an array.`);
  if (value.pairs.length > 500) throw new Error(`${path}.pairs cannot contain more than 500 entries.`);
  const pairs = value.pairs.map((pair, index): ArtifactPrimerPair => {
    const pairPath = `${path}.pairs[${index}]`;
    if (!isPlainObject(pair)) throw new Error(`${pairPath} must be an object.`);
    assertKnownKeys(pair, ['id', 'forward', 'reverse', 'productLengthBp', 'score', 'warnings'], pairPath);
    const warnings = pair.warnings === undefined
      ? undefined
      : normalizeTextArray(pair.warnings, `${pairPath}.warnings`, 50, 1_024, budget);
    return {
      id: normalizeId(pair.id, `${pairPath}.id`, budget),
      forward: normalizePrimer(pair.forward, `${pairPath}.forward`, budget),
      reverse: normalizePrimer(pair.reverse, `${pairPath}.reverse`, budget),
      productLengthBp: finiteNumber(pair.productLengthBp, `${pairPath}.productLengthBp`, { min: 1, integer: true }),
      ...(pair.score === undefined ? {} : { score: finiteNumber(pair.score, `${pairPath}.score`) }),
      ...(warnings === undefined ? {} : { warnings }),
    };
  });
  assertUniqueIds(pairs, `${path}.pairs`);
  const selectedPairId = value.selectedPairId === undefined ? undefined : normalizeId(value.selectedPairId, `${path}.selectedPairId`, budget);
  if (selectedPairId !== undefined && !pairs.some((pair) => pair.id === selectedPairId)) {
    throw new Error(`${path}.selectedPairId does not match a primer pair.`);
  }
  return { targetRecordId, ...(targetRange === undefined ? {} : { targetRange }), pairs, ...(selectedPairId === undefined ? {} : { selectedPairId }) };
}

function normalizeTextArray(value: unknown, path: string, maxEntries: number, maxLength: number, budget: Budget): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > maxEntries) throw new Error(`${path} cannot contain more than ${maxEntries} entries.`);
  return value.map((item, index) => boundedString(item, `${path}[${index}]`, maxLength, budget));
}

function normalizePcrData(value: unknown, path: string, budget: Budget, context: ArtifactAnalysisContext): ArtifactPcrData {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['templateRecordId', 'primerDesignResultId', 'products'], path);
  const templateRecordId = normalizeId(value.templateRecordId, `${path}.templateRecordId`, budget);
  const templateLength = context.recordLengths?.get(templateRecordId);
  if (context.recordLengths && templateLength === undefined) throw new Error(`${path}.templateRecordId does not match a workspace record.`);
  const primerDesignResultId = value.primerDesignResultId === undefined ? undefined : normalizeId(value.primerDesignResultId, `${path}.primerDesignResultId`, budget);
  if (!Array.isArray(value.products)) throw new Error(`${path}.products must be an array.`);
  if (value.products.length > 500) throw new Error(`${path}.products cannot contain more than 500 entries.`);
  const products = value.products.map((product, index): ArtifactPcrProduct => {
    const productPath = `${path}.products[${index}]`;
    if (!isPlainObject(product)) throw new Error(`${productPath} must be an object.`);
    assertKnownKeys(product, ['id', 'lengthBp', 'recordId', 'templateRange'], productPath);
    const recordId = product.recordId === undefined ? undefined : normalizeId(product.recordId, `${productPath}.recordId`, budget);
    if (recordId !== undefined && context.recordLengths && !context.recordLengths.has(recordId)) {
      throw new Error(`${productPath}.recordId does not match a workspace record.`);
    }
    return {
      id: normalizeId(product.id, `${productPath}.id`, budget),
      lengthBp: finiteNumber(product.lengthBp, `${productPath}.lengthBp`, { min: 1, integer: true }),
      ...(recordId === undefined ? {} : { recordId }),
      ...(product.templateRange === undefined ? {} : { templateRange: normalizeRange(product.templateRange, `${productPath}.templateRange`, templateLength) }),
    };
  });
  assertUniqueIds(products, `${path}.products`);
  return { templateRecordId, ...(primerDesignResultId === undefined ? {} : { primerDesignResultId }), products };
}

function normalizeAssemblyData(value: unknown, path: string, budget: Budget): ArtifactAssemblyPlanData {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['method', 'orderedPartRecordIds', 'destinationRecordId', 'productRecordId', 'standard', 'enzyme', 'junctions'], path);
  if (!ASSEMBLY_METHOD_SET.has(value.method as ArtifactAssemblyMethod)) throw new Error(`${path}.method is not supported.`);
  const orderedPartRecordIds = normalizeStringArray(value.orderedPartRecordIds, `${path}.orderedPartRecordIds`, MAX_ARTIFACT_ANALYSIS_RECORD_IDS, budget, { required: true });
  if (orderedPartRecordIds.length === 0) throw new Error(`${path}.orderedPartRecordIds must contain at least one part.`);
  const optionalId = (field: 'destinationRecordId' | 'productRecordId'): string | undefined => value[field] === undefined
    ? undefined
    : normalizeId(value[field], `${path}.${field}`, budget);
  const optionalText = (field: 'standard' | 'enzyme'): string | undefined => value[field] === undefined
    ? undefined
    : boundedString(value[field], `${path}.${field}`, 256, budget);
  let junctions: ArtifactAssemblyJunction[] | undefined;
  if (value.junctions !== undefined) {
    if (!Array.isArray(value.junctions)) throw new Error(`${path}.junctions must be an array.`);
    if (value.junctions.length > MAX_ARTIFACT_ANALYSIS_RECORD_IDS) throw new Error(`${path}.junctions contains too many entries.`);
    junctions = value.junctions.map((junction, index) => {
      const junctionPath = `${path}.junctions[${index}]`;
      if (!isPlainObject(junction)) throw new Error(`${junctionPath} must be an object.`);
      assertKnownKeys(junction, ['leftRecordId', 'rightRecordId', 'compatible', 'overhang', 'note'], junctionPath);
      if (typeof junction.compatible !== 'boolean') throw new Error(`${junctionPath}.compatible must be a boolean.`);
      const overhang = junction.overhang === undefined ? undefined : boundedString(junction.overhang, `${junctionPath}.overhang`, 64, budget);
      const note = junction.note === undefined ? undefined : boundedString(junction.note, `${junctionPath}.note`, 1_024, budget);
      return {
        leftRecordId: normalizeId(junction.leftRecordId, `${junctionPath}.leftRecordId`, budget),
        rightRecordId: normalizeId(junction.rightRecordId, `${junctionPath}.rightRecordId`, budget),
        compatible: junction.compatible,
        ...(overhang === undefined ? {} : { overhang }),
        ...(note === undefined ? {} : { note }),
      };
    });
  }
  const destinationRecordId = optionalId('destinationRecordId');
  const productRecordId = optionalId('productRecordId');
  const standard = optionalText('standard');
  const enzyme = optionalText('enzyme');
  return {
    method: value.method as ArtifactAssemblyMethod,
    orderedPartRecordIds,
    ...(destinationRecordId === undefined ? {} : { destinationRecordId }),
    ...(productRecordId === undefined ? {} : { productRecordId }),
    ...(standard === undefined ? {} : { standard }),
    ...(enzyme === undefined ? {} : { enzyme }),
    ...(junctions === undefined ? {} : { junctions }),
  };
}

function normalizeConstructVerificationData(
  value: unknown,
  path: string,
  budget: Budget,
  context: ArtifactAnalysisContext,
): ArtifactConstructVerificationData {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, [
    'referenceRecordId',
    'readRecordIds',
    'state',
    'referenceLength',
    'coveredBases',
    'coverageFraction',
    'mappedReadCount',
    'requiredRegionCount',
    'passingRegionCount',
    'observedVariantCount',
    'expectedVariantCount',
    'unexpectedVariantCount',
    'missingExpectedVariantCount',
    'reasonCodes',
    'verificationReportAssetId',
  ], path);
  const referenceRecordId = normalizeId(value.referenceRecordId, `${path}.referenceRecordId`, budget);
  const readRecordIds = normalizeStringArray(
    value.readRecordIds,
    `${path}.readRecordIds`,
    MAX_ARTIFACT_ANALYSIS_RECORD_IDS - 1,
    budget,
    { required: true, deduplicate: true },
  );
  if (readRecordIds.length === 0) throw new Error(`${path}.readRecordIds must contain at least one sequencing read.`);
  if (readRecordIds.includes(referenceRecordId)) throw new Error(`${path}.readRecordIds cannot contain the reference record.`);
  if (context.recordLengths) {
    if (!context.recordLengths.has(referenceRecordId)) throw new Error(`${path}.referenceRecordId does not match a workspace record.`);
    readRecordIds.forEach((recordId, index) => {
      if (!context.recordLengths?.has(recordId)) throw new Error(`${path}.readRecordIds[${index}] does not match a workspace record.`);
    });
  }
  if (value.state !== 'consistent' && value.state !== 'needs_review' && value.state !== 'inconsistent') {
    throw new Error(`${path}.state must be "consistent", "needs_review", or "inconsistent".`);
  }
  const referenceLength = finiteNumber(value.referenceLength, `${path}.referenceLength`, { min: 1, integer: true });
  const coveredBases = finiteNumber(value.coveredBases, `${path}.coveredBases`, { min: 0, max: referenceLength, integer: true });
  const coverageFraction = finiteNumber(value.coverageFraction, `${path}.coverageFraction`, { min: 0, max: 1 });
  const expectedCoverageFraction = coveredBases / referenceLength;
  if (Math.abs(coverageFraction - expectedCoverageFraction) > 1e-6) {
    throw new Error(`${path}.coverageFraction must agree with coveredBases / referenceLength.`);
  }
  const mappedReadCount = finiteNumber(value.mappedReadCount, `${path}.mappedReadCount`, {
    min: 0,
    max: readRecordIds.length,
    integer: true,
  });
  const count = (field: 'requiredRegionCount' | 'passingRegionCount' | 'observedVariantCount' | 'expectedVariantCount' | 'unexpectedVariantCount' | 'missingExpectedVariantCount'): number => (
    finiteNumber(value[field], `${path}.${field}`, { min: 0, integer: true })
  );
  const requiredRegionCount = count('requiredRegionCount');
  const passingRegionCount = count('passingRegionCount');
  if (passingRegionCount > requiredRegionCount) {
    throw new Error(`${path}.passingRegionCount cannot exceed requiredRegionCount.`);
  }
  const observedVariantCount = count('observedVariantCount');
  const expectedVariantCount = count('expectedVariantCount');
  const unexpectedVariantCount = count('unexpectedVariantCount');
  const missingExpectedVariantCount = count('missingExpectedVariantCount');
  if (unexpectedVariantCount > observedVariantCount) {
    throw new Error(`${path}.unexpectedVariantCount cannot exceed observedVariantCount.`);
  }
  if (missingExpectedVariantCount > expectedVariantCount) {
    throw new Error(`${path}.missingExpectedVariantCount cannot exceed expectedVariantCount.`);
  }
  const reasonCodes = normalizeTextArray(value.reasonCodes, `${path}.reasonCodes`, 500, 128, budget);
  reasonCodes.forEach((code, index) => {
    if (!/^[a-z][a-z0-9_]*$/.test(code)) throw new Error(`${path}.reasonCodes[${index}] must be a stable lowercase code.`);
  });
  const verificationReportAssetId = value.verificationReportAssetId === undefined
    ? undefined
    : normalizeId(value.verificationReportAssetId, `${path}.verificationReportAssetId`, budget);
  return {
    referenceRecordId,
    readRecordIds,
    state: value.state,
    referenceLength,
    coveredBases,
    coverageFraction,
    mappedReadCount,
    requiredRegionCount,
    passingRegionCount,
    observedVariantCount,
    expectedVariantCount,
    unexpectedVariantCount,
    missingExpectedVariantCount,
    reasonCodes,
    ...(verificationReportAssetId === undefined ? {} : { verificationReportAssetId }),
  };
}

function normalizeBlastData(value: unknown, path: string, budget: Budget): ArtifactBlastSearchData {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['program', 'database', 'databaseVersion', 'queryRecordId', 'hits'], path);
  if (!BLAST_PROGRAM_SET.has(value.program as ArtifactBlastSearchData['program'])) throw new Error(`${path}.program is not supported.`);
  if (!Array.isArray(value.hits)) throw new Error(`${path}.hits must be an array.`);
  if (value.hits.length > MAX_ARTIFACT_ANALYSIS_ARRAY_ENTRIES) throw new Error(`${path}.hits contains too many entries.`);
  const hits = value.hits.map((hit, index): ArtifactBlastHit => {
    const hitPath = `${path}.hits[${index}]`;
    if (!isPlainObject(hit)) throw new Error(`${hitPath} must be an object.`);
    assertKnownKeys(hit, ['accession', 'title', 'identityPercent', 'queryCoveragePercent', 'eValue', 'bitScore', 'queryStart', 'queryEnd', 'subjectStart', 'subjectEnd', 'alignmentAssetId'], hitPath);
    const optionalPosition = (field: 'queryStart' | 'queryEnd' | 'subjectStart' | 'subjectEnd'): number | undefined => hit[field] === undefined
      ? undefined
      : finiteNumber(hit[field], `${hitPath}.${field}`, { min: 1, integer: true });
    const queryStart = optionalPosition('queryStart');
    const queryEnd = optionalPosition('queryEnd');
    const subjectStart = optionalPosition('subjectStart');
    const subjectEnd = optionalPosition('subjectEnd');
    if ((queryStart === undefined) !== (queryEnd === undefined)) throw new Error(`${hitPath}.queryStart and queryEnd must be supplied together.`);
    if ((subjectStart === undefined) !== (subjectEnd === undefined)) throw new Error(`${hitPath}.subjectStart and subjectEnd must be supplied together.`);
    const alignmentAssetId = hit.alignmentAssetId === undefined ? undefined : normalizeId(hit.alignmentAssetId, `${hitPath}.alignmentAssetId`, budget);
    return {
      accession: boundedString(hit.accession, `${hitPath}.accession`, 256, budget),
      title: boundedString(hit.title, `${hitPath}.title`, 2_048, budget),
      identityPercent: finiteNumber(hit.identityPercent, `${hitPath}.identityPercent`, { min: 0, max: 100 }),
      queryCoveragePercent: finiteNumber(hit.queryCoveragePercent, `${hitPath}.queryCoveragePercent`, { min: 0, max: 100 }),
      eValue: finiteNumber(hit.eValue, `${hitPath}.eValue`, { min: 0 }),
      bitScore: finiteNumber(hit.bitScore, `${hitPath}.bitScore`, { min: 0 }),
      ...(queryStart === undefined ? {} : { queryStart }),
      ...(queryEnd === undefined ? {} : { queryEnd }),
      ...(subjectStart === undefined ? {} : { subjectStart }),
      ...(subjectEnd === undefined ? {} : { subjectEnd }),
      ...(alignmentAssetId === undefined ? {} : { alignmentAssetId }),
    };
  });
  const databaseVersion = value.databaseVersion === undefined ? undefined : boundedString(value.databaseVersion, `${path}.databaseVersion`, 256, budget);
  return {
    program: value.program as ArtifactBlastSearchData['program'],
    database: boundedString(value.database, `${path}.database`, 256, budget),
    ...(databaseVersion === undefined ? {} : { databaseVersion }),
    queryRecordId: normalizeId(value.queryRecordId, `${path}.queryRecordId`, budget),
    hits,
  };
}

function normalizeStructureData(value: unknown, path: string, budget: Budget): ArtifactStructureModelData {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['format', 'modelAssetId', 'method', 'chains', 'metrics'], path);
  if (value.format !== 'pdb' && value.format !== 'mmcif') throw new Error(`${path}.format must be "pdb" or "mmcif".`);
  if (!Array.isArray(value.chains)) throw new Error(`${path}.chains must be an array.`);
  if (value.chains.length > 1_000) throw new Error(`${path}.chains cannot contain more than 1,000 entries.`);
  const chains = value.chains.map((chain, index): ArtifactStructureChain => {
    const chainPath = `${path}.chains[${index}]`;
    if (!isPlainObject(chain)) throw new Error(`${chainPath} must be an object.`);
    assertKnownKeys(chain, ['id', 'recordId', 'residueCount'], chainPath);
    return {
      id: normalizeId(chain.id, `${chainPath}.id`, budget),
      ...(chain.recordId === undefined ? {} : { recordId: normalizeId(chain.recordId, `${chainPath}.recordId`, budget) }),
      ...(chain.residueCount === undefined ? {} : { residueCount: finiteNumber(chain.residueCount, `${chainPath}.residueCount`, { min: 1, integer: true }) }),
    };
  });
  assertUniqueIds(chains, `${path}.chains`);
  return {
    format: value.format,
    modelAssetId: normalizeId(value.modelAssetId, `${path}.modelAssetId`, budget),
    method: boundedString(value.method, `${path}.method`, 256, budget),
    chains,
    ...(value.metrics === undefined ? {} : { metrics: normalizeJsonObject(value.metrics, `${path}.metrics`, budget) }),
  };
}

function normalizeReportData(value: unknown, path: string, budget: Budget): ArtifactReportData {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['format', 'body', 'bodyAssetId'], path);
  if (value.format !== 'plain' && value.format !== 'markdown') throw new Error(`${path}.format must be "plain" or "markdown".`);
  const body = value.body === undefined ? undefined : boundedString(value.body, `${path}.body`, 262_144, budget, { trim: false, allowBlank: true });
  const bodyAssetId = value.bodyAssetId === undefined ? undefined : normalizeId(value.bodyAssetId, `${path}.bodyAssetId`, budget);
  if (body === undefined && bodyAssetId === undefined) throw new Error(`${path} requires body or bodyAssetId.`);
  return { format: value.format, ...(body === undefined ? {} : { body }), ...(bodyAssetId === undefined ? {} : { bodyAssetId }) };
}

function normalizeTableData(value: unknown, path: string, budget: Budget): ArtifactTableData {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['columns', 'rows'], path);
  if (!Array.isArray(value.columns)) throw new Error(`${path}.columns must be an array.`);
  if (value.columns.length === 0 || value.columns.length > MAX_ARTIFACT_ANALYSIS_TABLE_COLUMNS) {
    throw new Error(`${path}.columns must contain 1–${MAX_ARTIFACT_ANALYSIS_TABLE_COLUMNS} entries.`);
  }
  const columns = value.columns.map((column, index): ArtifactTableColumn => {
    const columnPath = `${path}.columns[${index}]`;
    if (!isPlainObject(column)) throw new Error(`${columnPath} must be an object.`);
    assertKnownKeys(column, ['id', 'label', 'type'], columnPath);
    if (column.type !== 'string' && column.type !== 'number' && column.type !== 'boolean' && column.type !== 'mixed') {
      throw new Error(`${columnPath}.type is not supported.`);
    }
    return {
      id: normalizeId(column.id, `${columnPath}.id`, budget),
      label: boundedString(column.label, `${columnPath}.label`, 256, budget),
      type: column.type,
    };
  });
  assertUniqueIds(columns, `${path}.columns`);
  if (!Array.isArray(value.rows)) throw new Error(`${path}.rows must be an array.`);
  if (value.rows.length > MAX_ARTIFACT_ANALYSIS_TABLE_ROWS) throw new Error(`${path}.rows contains too many entries.`);
  const rows = value.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error(`${path}.rows[${rowIndex}] must align one-to-one with columns.`);
    return row.map((cell, cellIndex): ArtifactJsonPrimitive => {
      if (cell !== null && typeof cell !== 'string' && typeof cell !== 'number' && typeof cell !== 'boolean') {
        throw new Error(`${path}.rows[${rowIndex}][${cellIndex}] must be a JSON primitive.`);
      }
      return normalizeJsonValue(cell, `${path}.rows[${rowIndex}][${cellIndex}]`, budget, new WeakSet<object>(), 0) as ArtifactJsonPrimitive;
    });
  });
  return { columns, rows };
}

function normalizeData(kind: ArtifactAnalysisKind, value: unknown, path: string, budget: Budget, context: ArtifactAnalysisContext): ArtifactAnalysisResult['data'] {
  if (kind === 'primer_design') return normalizePrimerDesignData(value, path, budget, context);
  if (kind === 'pcr') return normalizePcrData(value, path, budget, context);
  if (kind === 'assembly_plan') return normalizeAssemblyData(value, path, budget);
  if (kind === 'construct_verification') return normalizeConstructVerificationData(value, path, budget, context);
  if (kind === 'blast_search') return normalizeBlastData(value, path, budget);
  if (kind === 'structure_model') return normalizeStructureData(value, path, budget);
  if (kind === 'report') return normalizeReportData(value, path, budget);
  return normalizeTableData(value, path, budget);
}

function normalizeResult(value: unknown, index: number, budget: Budget, context: ArtifactAnalysisContext): ArtifactAnalysisResult {
  const path = `analysisResults[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ['id', 'kind', 'name', 'status', 'summary', 'inputRecordIds', 'inputSha256s', 'dependsOnResultIds', 'assetIds', 'parameters', 'data', 'createdAt', 'provenance'], path);
  if (!ANALYSIS_KIND_SET.has(value.kind as ArtifactAnalysisKind)) throw new Error(`${path}.kind is not supported.`);
  if (!STATUS_SET.has(value.status as ArtifactAnalysisStatus)) throw new Error(`${path}.status must be "complete", "partial", or "failed".`);
  const kind = value.kind as ArtifactAnalysisKind;
  const inputRecordIds = normalizeStringArray(value.inputRecordIds, `${path}.inputRecordIds`, MAX_ARTIFACT_ANALYSIS_RECORD_IDS, budget, { required: true, deduplicate: true });
  const inputSha256s = value.inputSha256s === undefined
    ? undefined
    : (Array.isArray(value.inputSha256s)
      ? value.inputSha256s.map((sha, shaIndex) => normalizeSha256(sha, `${path}.inputSha256s[${shaIndex}]`, budget))
      : (() => { throw new Error(`${path}.inputSha256s must be an array.`); })());
  if (inputSha256s && inputSha256s.length !== inputRecordIds.length) throw new Error(`${path}.inputSha256s must align one-to-one with inputRecordIds.`);
  if (context.recordLengths) {
    inputRecordIds.forEach((recordId, recordIndex) => {
      if (!context.recordLengths?.has(recordId)) throw new Error(`${path}.inputRecordIds[${recordIndex}] does not match a workspace record.`);
    });
  }
  const dependsOnResultIds = normalizeStringArray(value.dependsOnResultIds, `${path}.dependsOnResultIds`, MAX_ARTIFACT_ANALYSIS_DEPENDENCIES, budget, { deduplicate: true });
  const assetIds = normalizeStringArray(value.assetIds, `${path}.assetIds`, MAX_ARTIFACT_ANALYSIS_ASSET_IDS, budget, { deduplicate: true });
  const summary = value.summary === undefined ? undefined : boundedString(value.summary, `${path}.summary`, MAX_ARTIFACT_ANALYSIS_SUMMARY_LENGTH, budget, { trim: false });
  const base = {
    id: normalizeId(value.id, `${path}.id`, budget),
    kind,
    name: boundedString(value.name, `${path}.name`, MAX_ARTIFACT_ANALYSIS_NAME_LENGTH, budget),
    status: value.status as ArtifactAnalysisStatus,
    ...(summary === undefined ? {} : { summary }),
    inputRecordIds,
    ...(inputSha256s === undefined ? {} : { inputSha256s }),
    dependsOnResultIds,
    assetIds,
    parameters: normalizeJsonObject(value.parameters ?? {}, `${path}.parameters`, budget),
    data: normalizeData(kind, value.data, `${path}.data`, budget, context),
    createdAt: normalizeTimestamp(value.createdAt, `${path}.createdAt`, budget),
    provenance: normalizeProvenance(value.provenance, `${path}.provenance`, budget),
  };
  return base as ArtifactAnalysisResult;
}

function assertUniqueIds(values: readonly { id: string }[], path: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${path} contains duplicate id "${value.id}".`);
    ids.add(value.id);
  }
}

export function artifactAnalysisResultRecordIds(result: ArtifactAnalysisResult): string[] {
  const ids = [...result.inputRecordIds];
  if (result.kind === 'primer_design') ids.push(result.data.targetRecordId);
  if (result.kind === 'pcr') {
    ids.push(result.data.templateRecordId);
    result.data.products.forEach((product) => { if (product.recordId) ids.push(product.recordId); });
  }
  if (result.kind === 'assembly_plan') {
    ids.push(...result.data.orderedPartRecordIds);
    if (result.data.destinationRecordId) ids.push(result.data.destinationRecordId);
    if (result.data.productRecordId) ids.push(result.data.productRecordId);
    result.data.junctions?.forEach((junction) => ids.push(junction.leftRecordId, junction.rightRecordId));
  }
  if (result.kind === 'construct_verification') {
    ids.push(result.data.referenceRecordId, ...result.data.readRecordIds);
  }
  if (result.kind === 'blast_search') ids.push(result.data.queryRecordId);
  if (result.kind === 'structure_model') result.data.chains.forEach((chain) => { if (chain.recordId) ids.push(chain.recordId); });
  return Array.from(new Set(ids));
}

function resultAssetIds(result: ArtifactAnalysisResult): string[] {
  const ids = [...result.assetIds];
  if (result.kind === 'blast_search') result.data.hits.forEach((hit) => { if (hit.alignmentAssetId) ids.push(hit.alignmentAssetId); });
  if (result.kind === 'structure_model') ids.push(result.data.modelAssetId);
  if (result.kind === 'construct_verification' && result.data.verificationReportAssetId) {
    ids.push(result.data.verificationReportAssetId);
  }
  if (result.kind === 'report' && result.data.bodyAssetId) ids.push(result.data.bodyAssetId);
  return Array.from(new Set(ids));
}

function resultDependencyIds(result: ArtifactAnalysisResult): string[] {
  const ids = [...result.dependsOnResultIds];
  if (result.kind === 'pcr' && result.data.primerDesignResultId) ids.push(result.data.primerDesignResultId);
  return Array.from(new Set(ids));
}

type ConstructVerificationAnalysisResult = Extract<ArtifactAnalysisResult, { kind: 'construct_verification' }>;

const CONSTRUCT_VERIFICATION_REPORT_SCHEMA = 'motif.construct-verification-report.v1';
const STABLE_REASON_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
const CONSTRUCT_REPORT_READ_STATUS_SET = new Set([
  'mapped',
  'trimmed_read_too_short',
  'unmapped',
  'ambiguous_mapping',
  'low_mapping_identity',
  'excessive_indel',
]);
const CONSTRUCT_REPORT_REGION_STATUS_SET = new Set(['covered', 'uncovered', 'low_depth', 'missing_strand']);
const CONSTRUCT_REPORT_VARIANT_TYPE_SET = new Set(['substitution', 'insertion', 'deletion']);
const CONSTRUCT_REPORT_EXPECTED_VARIANT_STATUS_SET = new Set([
  'observed',
  'low_confidence',
  'not_observed',
  'not_covered',
]);
const CONSTRUCT_REPORT_THRESHOLD_KEYS = [
  'trimQuality',
  'trimWindow',
  'minTrimmedReadLength',
  'minMappingIdentity',
  'minMappingMargin',
  'maxIndelFraction',
  'minCoverageFraction',
  'minDepth',
  'requireBothStrands',
  'minConsensusFraction',
  'minVariantQuality',
  'minVariantFraction',
] as const;
const CONSTRUCT_REPORT_LIMITS = {
  maxReferenceLength: 50_000,
  maxReads: 96,
  maxReadLength: 5_000,
  maxRequiredRegions: 128,
  maxRequiredRegionBases: 500_000,
  maxExpectedVariants: 256,
  maxObservedVariants: 2_000,
  maxIndelLength: 24,
  maxWorkUnits: 25_000_000,
} as const;
const CONSTRUCT_REPORT_REASON_LIMIT = 256;
const CONSTRUCT_REPORT_SUPPORTING_READ_LIMIT = 8;
const CONSTRUCT_REPORT_OBSERVED_VARIANT_LIMIT = 192;
const CONSTRUCT_REPORT_IUPAC_CONSENSUS_PATTERN = /^[ACGTN]*$/;
const CONSTRUCT_REPORT_CANONICAL_DNA_PATTERN = /^[ACGT]*$/;

function reportObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function reportArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function reportString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a nonempty string.`);
  return value;
}

function reportSha256(value: unknown, path: string): string {
  const sha256 = reportString(value, path).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${path} must be a 64-character SHA-256 value.`);
  return sha256;
}

function reportInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${path} must be a non-negative integer.`);
  return value as number;
}

function reportSignedInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value)) throw new Error(`${path} must be an integer.`);
  return value as number;
}

function reportFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
  return value;
}

function reportBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  return value;
}

function reportIntegerBetween(value: unknown, path: string, minimum: number, maximum: number): number {
  const integer = reportInteger(value, path);
  if (integer < minimum || integer > maximum) {
    throw new Error(`${path} must be an integer from ${minimum.toLocaleString()} through ${maximum.toLocaleString()}.`);
  }
  return integer;
}

function reportNumberBetween(value: unknown, path: string, minimum: number, maximum: number): number {
  const number = reportFiniteNumber(value, path);
  if (number < minimum || number > maximum) {
    throw new Error(`${path} must be from ${minimum} through ${maximum}.`);
  }
  return number;
}

function reportNullableNumber(
  value: unknown,
  path: string,
  minimum?: number,
  maximum?: number,
): number | null {
  if (value === null) return null;
  const number = reportFiniteNumber(value, path);
  if (minimum !== undefined && number < minimum) throw new Error(`${path} must be at least ${minimum}.`);
  if (maximum !== undefined && number > maximum) throw new Error(`${path} must be no greater than ${maximum}.`);
  return number;
}

function reportIdentityText(value: unknown, path: string, maximumLength: number): string {
  const text = reportString(value, path);
  if (text.trim() !== text || text.length > maximumLength) {
    throw new Error(`${path} must contain 1–${maximumLength.toLocaleString()} unpadded characters.`);
  }
  return text;
}

function reportOptionalIdentityText(
  value: unknown,
  path: string,
  maximumLength: number,
): string | undefined {
  return value === undefined ? undefined : reportIdentityText(value, path, maximumLength);
}

function reportNumbersAgree(actual: number, expected: number): boolean {
  return Object.is(actual, expected) || Math.abs(actual - expected) <= 1e-12;
}

function assertReportNumber(
  result: ConstructVerificationAnalysisResult,
  field: string,
  actual: number,
  expected: number,
): void {
  if (!reportNumbersAgree(actual, expected)) reportMismatch(result, field);
}

function reportMismatch(result: ConstructVerificationAnalysisResult, field: string): never {
  throw new Error(`Analysis result "${result.id}" verification report ${field} must match the saved result.`);
}

function assertReportValue(
  result: ConstructVerificationAnalysisResult,
  field: string,
  actual: unknown,
  expected: unknown,
): void {
  if (!Object.is(actual, expected)) reportMismatch(result, field);
}

function assertReportArray(
  result: ConstructVerificationAnalysisResult,
  field: string,
  actual: readonly unknown[],
  expected: readonly unknown[],
): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    reportMismatch(result, field);
  }
}

function assertReportThresholds(
  result: ConstructVerificationAnalysisResult,
  reportThresholds: Record<string, unknown>,
): void {
  const savedThresholds = result.parameters.thresholds;
  if (!isPlainObject(savedThresholds)) reportMismatch(result, 'thresholds');
  const reportKeys = Object.keys(reportThresholds).sort();
  const savedKeys = Object.keys(savedThresholds).sort();
  const expectedKeys = [...CONSTRUCT_REPORT_THRESHOLD_KEYS].sort();
  assertReportArray(result, 'thresholds schema', reportKeys, expectedKeys);
  assertReportArray(result, 'thresholds keys', reportKeys, savedKeys);
  reportKeys.forEach((key) => {
    const reportValue = reportThresholds[key];
    const savedValue = savedThresholds[key];
    if (
      (typeof reportValue !== 'number' && typeof reportValue !== 'boolean')
      || !Object.is(reportValue, savedValue)
    ) {
      reportMismatch(result, `thresholds.${key}`);
    }
  });
  reportIntegerBetween(reportThresholds.trimQuality, 'verification report thresholds.trimQuality', 0, 255);
  reportIntegerBetween(reportThresholds.trimWindow, 'verification report thresholds.trimWindow', 1, 100);
  reportIntegerBetween(
    reportThresholds.minTrimmedReadLength,
    'verification report thresholds.minTrimmedReadLength',
    1,
    CONSTRUCT_REPORT_LIMITS.maxReadLength,
  );
  reportNumberBetween(reportThresholds.minMappingIdentity, 'verification report thresholds.minMappingIdentity', 0, 1);
  reportNumberBetween(reportThresholds.minMappingMargin, 'verification report thresholds.minMappingMargin', 0, 1);
  reportNumberBetween(reportThresholds.maxIndelFraction, 'verification report thresholds.maxIndelFraction', 0, 1);
  reportNumberBetween(reportThresholds.minCoverageFraction, 'verification report thresholds.minCoverageFraction', 0, 1);
  reportIntegerBetween(reportThresholds.minDepth, 'verification report thresholds.minDepth', 1, CONSTRUCT_REPORT_LIMITS.maxReads);
  reportBoolean(reportThresholds.requireBothStrands, 'verification report thresholds.requireBothStrands');
  reportNumberBetween(reportThresholds.minConsensusFraction, 'verification report thresholds.minConsensusFraction', 0, 1);
  reportNumberBetween(reportThresholds.minVariantQuality, 'verification report thresholds.minVariantQuality', 0, 255);
  reportNumberBetween(reportThresholds.minVariantFraction, 'verification report thresholds.minVariantFraction', 0, 1);
}

type ConstructReportRead = {
  id: string;
  sha256: string;
  status: string;
  mapped: boolean;
  qualityProvided: boolean;
};

function validateConstructReportMapping(
  value: unknown,
  path: string,
  topology: 'linear' | 'circular',
  referenceLength: number,
  trimmedLength: number,
  status: string,
  thresholds: Record<string, unknown>,
): void {
  const mapping = reportObject(value, path);
  assertKnownKeys(mapping, [
    'orientation',
    'referenceStart',
    'referenceEnd',
    'wraps',
    'referenceSpan',
    'score',
    'secondBestScore',
    'mappingMargin',
    'identity',
    'alignedLength',
    'matches',
    'substitutions',
    'insertions',
    'deletions',
    'indelFraction',
  ], path);
  if (mapping.orientation !== 'forward' && mapping.orientation !== 'reverse') {
    throw new Error(`${path}.orientation must be forward or reverse.`);
  }
  const referenceStart = reportIntegerBetween(mapping.referenceStart, `${path}.referenceStart`, 0, referenceLength - 1);
  const referenceEnd = reportIntegerBetween(mapping.referenceEnd, `${path}.referenceEnd`, 0, referenceLength);
  const wraps = reportBoolean(mapping.wraps, `${path}.wraps`);
  const referenceSpan = reportIntegerBetween(
    mapping.referenceSpan,
    `${path}.referenceSpan`,
    1,
    CONSTRUCT_REPORT_LIMITS.maxReadLength + (CONSTRUCT_REPORT_LIMITS.maxIndelLength * CONSTRUCT_REPORT_LIMITS.maxReadLength),
  );
  const score = reportSignedInteger(mapping.score, `${path}.score`);
  const secondBestScore = mapping.secondBestScore === null
    ? null
    : reportSignedInteger(mapping.secondBestScore, `${path}.secondBestScore`);
  const mappingMargin = reportNullableNumber(mapping.mappingMargin, `${path}.mappingMargin`, 0);
  if ((secondBestScore === null) !== (mappingMargin === null)) {
    throw new Error(`${path}.secondBestScore and mappingMargin must either both be null or both be numbers.`);
  }
  if (secondBestScore !== null) {
    if (secondBestScore > score) throw new Error(`${path}.secondBestScore cannot exceed score.`);
    const expectedMargin = (score - secondBestScore) / Math.max(1, 3 * trimmedLength);
    if (!reportNumbersAgree(mappingMargin as number, expectedMargin)) {
      throw new Error(`${path}.mappingMargin must agree with score, secondBestScore, and trimmedLength.`);
    }
  }
  const alignedLength = reportIntegerBetween(
    mapping.alignedLength,
    `${path}.alignedLength`,
    1,
    trimmedLength + (CONSTRUCT_REPORT_LIMITS.maxIndelLength * CONSTRUCT_REPORT_LIMITS.maxReadLength),
  );
  const matches = reportIntegerBetween(mapping.matches, `${path}.matches`, 0, alignedLength);
  const substitutions = reportIntegerBetween(mapping.substitutions, `${path}.substitutions`, 0, alignedLength);
  const insertions = reportIntegerBetween(mapping.insertions, `${path}.insertions`, 0, alignedLength);
  const deletions = reportIntegerBetween(mapping.deletions, `${path}.deletions`, 0, alignedLength);
  if (matches + substitutions + insertions + deletions !== alignedLength) {
    throw new Error(`${path}.alignedLength must equal matches + substitutions + insertions + deletions.`);
  }
  if (matches + substitutions + insertions !== trimmedLength) {
    throw new Error(`${path} operation counts must consume exactly trimmedLength read calls.`);
  }
  if (matches + substitutions + deletions !== referenceSpan) {
    throw new Error(`${path}.referenceSpan must equal matches + substitutions + deletions.`);
  }
  const identity = reportNumberBetween(mapping.identity, `${path}.identity`, 0, 1);
  const indelFraction = reportNumberBetween(mapping.indelFraction, `${path}.indelFraction`, 0, 1);
  if (!reportNumbersAgree(identity, matches / alignedLength)) {
    throw new Error(`${path}.identity must equal matches / alignedLength.`);
  }
  if (!reportNumbersAgree(indelFraction, (insertions + deletions) / alignedLength)) {
    throw new Error(`${path}.indelFraction must agree with the insertion and deletion counts.`);
  }
  const minimumIdentity = reportFiniteNumber(
    thresholds.minMappingIdentity,
    'verification report thresholds.minMappingIdentity',
  );
  const maximumIndelFraction = reportFiniteNumber(
    thresholds.maxIndelFraction,
    'verification report thresholds.maxIndelFraction',
  );
  const minimumMargin = reportFiniteNumber(
    thresholds.minMappingMargin,
    'verification report thresholds.minMappingMargin',
  );
  if (
    (status === 'low_mapping_identity') !== (identity < minimumIdentity)
    || ((status === 'mapped' || status === 'ambiguous_mapping') && indelFraction > maximumIndelFraction)
  ) {
    throw new Error(`${path} identity or indel evidence is inconsistent with status ${status}.`);
  }
  if (
    status === 'excessive_indel'
    && indelFraction <= maximumIndelFraction
    && insertions + deletions <= CONSTRUCT_REPORT_LIMITS.maxIndelLength
  ) {
    throw new Error(`${path} cannot support excessive_indel status.`);
  }
  if (status === 'mapped' && secondBestScore !== null) {
    if (secondBestScore >= score || (mappingMargin as number) < minimumMargin) {
      throw new Error(`${path} runner-up evidence is inconsistent with mapped status.`);
    }
  }
  if (
    status === 'ambiguous_mapping'
    && secondBestScore !== null
    && secondBestScore !== score
    && (mappingMargin as number) >= minimumMargin
  ) {
    throw new Error(`${path} runner-up evidence is inconsistent with ambiguous_mapping status.`);
  }
  if (topology === 'linear') {
    if (wraps || referenceEnd !== referenceStart + referenceSpan || referenceEnd > referenceLength) {
      throw new Error(`${path} linear coordinates must be nonwrapping and agree with referenceSpan.`);
    }
  } else {
    const expectedWraps = referenceStart + referenceSpan > referenceLength;
    const expectedEnd = expectedWraps
      ? (referenceStart + referenceSpan) % referenceLength
      : referenceStart + referenceSpan;
    if (wraps !== expectedWraps || referenceEnd !== expectedEnd) {
      throw new Error(`${path} circular coordinates must agree with wraps and referenceSpan.`);
    }
    if (status === 'mapped' && referenceSpan > referenceLength) {
      throw new Error(`${path} mapped reads cannot traverse a circular reference position more than once.`);
    }
  }
}

function validateConstructReportRead(
  value: unknown,
  index: number,
  topology: 'linear' | 'circular',
  referenceLength: number,
  thresholds: Record<string, unknown>,
): ConstructReportRead {
  const path = `verification report reads[${index}]`;
  const read = reportObject(value, path);
  assertKnownKeys(read, [
    'id',
    'name',
    'sha256',
    'rawLength',
    'qualityProvided',
    'meanQuality',
    'status',
    'trim',
    'mapping',
  ], path);
  const id = reportIdentityText(read.id, `${path}.id`, MAX_ARTIFACT_ANALYSIS_ID_LENGTH);
  reportOptionalIdentityText(read.name, `${path}.name`, MAX_ARTIFACT_ANALYSIS_NAME_LENGTH);
  const sha256 = reportSha256(read.sha256, `${path}.sha256`);
  const rawLength = reportIntegerBetween(read.rawLength, `${path}.rawLength`, 1, CONSTRUCT_REPORT_LIMITS.maxReadLength);
  const qualityProvided = reportBoolean(read.qualityProvided, `${path}.qualityProvided`);
  const meanQuality = reportNullableNumber(read.meanQuality, `${path}.meanQuality`, 0, 255);
  const status = reportString(read.status, `${path}.status`);
  if (!CONSTRUCT_REPORT_READ_STATUS_SET.has(status)) throw new Error(`${path}.status is not supported.`);

  const trim = reportObject(read.trim, `${path}.trim`);
  assertKnownKeys(trim, [
    'method',
    'rawStart',
    'rawEnd',
    'trimmedLength',
    'removedFromStart',
    'removedFromEnd',
  ], `${path}.trim`);
  if (trim.method !== 'quality_window' && trim.method !== 'none_missing_quality') {
    throw new Error(`${path}.trim.method is not supported.`);
  }
  const rawStart = reportIntegerBetween(trim.rawStart, `${path}.trim.rawStart`, 0, rawLength);
  const rawEnd = reportIntegerBetween(trim.rawEnd, `${path}.trim.rawEnd`, rawStart, rawLength);
  const trimmedLength = reportIntegerBetween(trim.trimmedLength, `${path}.trim.trimmedLength`, 0, rawLength);
  const removedFromStart = reportIntegerBetween(trim.removedFromStart, `${path}.trim.removedFromStart`, 0, rawLength);
  const removedFromEnd = reportIntegerBetween(trim.removedFromEnd, `${path}.trim.removedFromEnd`, 0, rawLength);
  if (
    trimmedLength !== rawEnd - rawStart
    || removedFromStart !== rawStart
    || removedFromEnd !== rawLength - rawEnd
  ) {
    throw new Error(`${path}.trim ranges and derived lengths are inconsistent.`);
  }
  if (trim.method === 'none_missing_quality') {
    if (qualityProvided || rawStart !== 0 || rawEnd !== rawLength || trimmedLength !== rawLength || meanQuality !== null) {
      throw new Error(`${path}.trim none_missing_quality must retain the full read and omit quality evidence.`);
    }
  } else if (!qualityProvided || (trimmedLength > 0 && meanQuality === null)) {
    throw new Error(`${path}.trim quality_window must agree with qualityProvided and meanQuality.`);
  }

  const minimumTrimmedLength = reportInteger(
    thresholds.minTrimmedReadLength,
    'verification report thresholds.minTrimmedReadLength',
  );
  if ((status === 'trimmed_read_too_short') !== (trimmedLength < minimumTrimmedLength)) {
    throw new Error(`${path}.trimmedLength is inconsistent with status ${status}.`);
  }

  const requiresMapping = status !== 'trimmed_read_too_short' && status !== 'unmapped';
  if (requiresMapping !== (read.mapping !== null)) {
    throw new Error(`${path}.mapping presence is inconsistent with status ${status}.`);
  }
  if (read.mapping !== null) {
    validateConstructReportMapping(
      read.mapping,
      `${path}.mapping`,
      topology,
      referenceLength,
      trimmedLength,
      status,
      thresholds,
    );
  }
  return { id, sha256, status, mapped: status === 'mapped', qualityProvided };
}

type ConstructReportRegion = {
  id: string;
  status: string;
  reasonCodes: readonly string[];
};

function validateConstructReportRegion(
  value: unknown,
  index: number,
  topology: 'linear' | 'circular',
  referenceLength: number,
  mappedReadCount: number,
): ConstructReportRegion {
  const path = `verification report coverage.requiredRegions[${index}]`;
  const region = reportObject(value, path);
  assertKnownKeys(region, [
    'id',
    'name',
    'start',
    'end',
    'wraps',
    'length',
    'minDepth',
    'requireBothStrands',
    'coveredBases',
    'basesMeetingMinDepth',
    'coveredFraction',
    'minimumDepth',
    'maximumDepth',
    'meanDepth',
    'forwardCoveredBases',
    'reverseCoveredBases',
    'bothStrandsCoveredBases',
    'status',
  ], path);
  const id = reportIdentityText(region.id, `${path}.id`, MAX_ARTIFACT_ANALYSIS_ID_LENGTH);
  reportOptionalIdentityText(region.name, `${path}.name`, MAX_ARTIFACT_ANALYSIS_NAME_LENGTH);
  const start = reportIntegerBetween(region.start, `${path}.start`, 0, referenceLength - 1);
  const end = reportIntegerBetween(region.end, `${path}.end`, 0, referenceLength);
  if (start === end) throw new Error(`${path} must span at least one reference base.`);
  const wraps = reportBoolean(region.wraps, `${path}.wraps`);
  const expectedWraps = start > end;
  if (wraps !== expectedWraps || (wraps && topology !== 'circular')) {
    throw new Error(`${path}.wraps is inconsistent with its topology and coordinates.`);
  }
  const expectedLength = wraps ? referenceLength - start + end : end - start;
  const length = reportIntegerBetween(region.length, `${path}.length`, 1, referenceLength);
  if (length !== expectedLength) throw new Error(`${path}.length must agree with its coordinates.`);
  const minDepth = reportIntegerBetween(
    region.minDepth,
    `${path}.minDepth`,
    1,
    CONSTRUCT_REPORT_LIMITS.maxReads,
  );
  const requireBothStrands = reportBoolean(region.requireBothStrands, `${path}.requireBothStrands`);
  const coveredBases = reportIntegerBetween(region.coveredBases, `${path}.coveredBases`, 0, length);
  const basesMeetingMinDepth = reportIntegerBetween(
    region.basesMeetingMinDepth,
    `${path}.basesMeetingMinDepth`,
    0,
    coveredBases,
  );
  const coveredFraction = reportNumberBetween(region.coveredFraction, `${path}.coveredFraction`, 0, 1);
  if (!reportNumbersAgree(coveredFraction, basesMeetingMinDepth / length)) {
    throw new Error(`${path}.coveredFraction must equal basesMeetingMinDepth / length.`);
  }
  const minimumDepth = reportIntegerBetween(region.minimumDepth, `${path}.minimumDepth`, 0, mappedReadCount);
  const maximumDepth = reportIntegerBetween(region.maximumDepth, `${path}.maximumDepth`, minimumDepth, mappedReadCount);
  const meanDepth = reportNumberBetween(region.meanDepth, `${path}.meanDepth`, minimumDepth, maximumDepth);
  if (length > 0 && (meanDepth < minimumDepth || meanDepth > maximumDepth)) {
    throw new Error(`${path}.meanDepth must lie between minimumDepth and maximumDepth.`);
  }
  if (
    (coveredBases === 0) !== (maximumDepth === 0)
    || (coveredBases === length) !== (minimumDepth > 0)
    || (basesMeetingMinDepth === 0) !== (maximumDepth < minDepth)
    || (basesMeetingMinDepth === length) !== (minimumDepth >= minDepth)
  ) {
    throw new Error(`${path} depth extrema, thresholds, and covered-base counts are inconsistent.`);
  }
  const forwardCoveredBases = reportIntegerBetween(
    region.forwardCoveredBases,
    `${path}.forwardCoveredBases`,
    0,
    coveredBases,
  );
  const reverseCoveredBases = reportIntegerBetween(
    region.reverseCoveredBases,
    `${path}.reverseCoveredBases`,
    0,
    coveredBases,
  );
  const bothStrandsCoveredBases = reportIntegerBetween(
    region.bothStrandsCoveredBases,
    `${path}.bothStrandsCoveredBases`,
    0,
    Math.min(forwardCoveredBases, reverseCoveredBases),
  );
  if (bothStrandsCoveredBases !== forwardCoveredBases + reverseCoveredBases - coveredBases) {
    throw new Error(`${path} strand coverage counts violate inclusion-exclusion.`);
  }
  const status = reportString(region.status, `${path}.status`);
  if (!CONSTRUCT_REPORT_REGION_STATUS_SET.has(status)) throw new Error(`${path}.status is not supported.`);
  const expectedStatus = coveredBases < length
    ? 'uncovered'
    : basesMeetingMinDepth < length
      ? 'low_depth'
      : requireBothStrands && bothStrandsCoveredBases < length
        ? 'missing_strand'
        : 'covered';
  if (status !== expectedStatus) throw new Error(`${path}.status is inconsistent with its coverage evidence.`);
  const reasonCodes: string[] = [];
  if (coveredBases < length) {
    reasonCodes.push('required_region_uncovered');
  } else if (basesMeetingMinDepth < length) {
    reasonCodes.push('required_region_low_depth');
  }
  if (requireBothStrands && coveredBases === length && bothStrandsCoveredBases < length) {
    reasonCodes.push('required_region_missing_strand');
  }
  return { id, status, reasonCodes };
}

type ConstructReportObservedVariant = {
  id: string;
  expectedVariantId?: string;
  confidence: 'high' | 'low';
  depth: number;
  alleleKey: string;
  signature: string;
  omittedSupportingReadIds: number;
};

type ConstructReportExpectedVariant = {
  id: string;
  status: 'observed' | 'low_confidence' | 'not_observed' | 'not_covered';
  observedVariantId?: string;
  depth: number;
  alleleKey: string;
  signature: string;
};

function validateConstructReportVariantAlleles(
  value: Record<string, unknown>,
  path: string,
  topology: 'linear' | 'circular',
  referenceLength: number,
): { type: 'substitution' | 'insertion' | 'deletion'; start: number; end: number; reference: string; alternate: string } {
  const type = reportString(value.type, `${path}.type`);
  if (!CONSTRUCT_REPORT_VARIANT_TYPE_SET.has(type)) throw new Error(`${path}.type is not supported.`);
  const maximumStart = type === 'insertion' && topology === 'linear' ? referenceLength : referenceLength - 1;
  const start = reportIntegerBetween(value.referenceStart, `${path}.referenceStart`, 0, maximumStart);
  const end = reportIntegerBetween(value.referenceEnd, `${path}.referenceEnd`, 0, referenceLength);
  if (typeof value.reference !== 'string' || typeof value.alternate !== 'string') {
    throw new Error(`${path}.reference and alternate must be strings.`);
  }
  const reference = value.reference;
  const alternate = value.alternate;
  if (!CONSTRUCT_REPORT_CANONICAL_DNA_PATTERN.test(reference) || !CONSTRUCT_REPORT_CANONICAL_DNA_PATTERN.test(alternate)) {
    throw new Error(`${path} alleles must contain canonical A/C/G/T bases only.`);
  }
  if (type === 'substitution') {
    if (end !== start + 1 || reference.length !== 1 || alternate.length !== 1 || reference === alternate) {
      throw new Error(`${path} substitution alleles and coordinates are inconsistent.`);
    }
  } else if (type === 'insertion') {
    if (
      end !== start
      || reference !== ''
      || alternate.length < 1
      || alternate.length > CONSTRUCT_REPORT_LIMITS.maxIndelLength
    ) {
      throw new Error(`${path} insertion alleles and coordinates are inconsistent.`);
    }
  } else if (
    end <= start
    || end - start > CONSTRUCT_REPORT_LIMITS.maxIndelLength
    || reference.length !== end - start
    || alternate !== ''
  ) {
    throw new Error(`${path} deletion alleles and coordinates are inconsistent.`);
  }
  return { type: type as 'substitution' | 'insertion' | 'deletion', start, end, reference, alternate };
}

function validateConstructReportObservedVariant(
  value: unknown,
  path: string,
  topology: 'linear' | 'circular',
  referenceLength: number,
  mappedReadCount: number,
  mappedReadIds: ReadonlySet<string>,
  qualityMappedReadIds: ReadonlySet<string>,
  thresholds: Record<string, unknown>,
): ConstructReportObservedVariant {
  const variant = reportObject(value, path);
  assertKnownKeys(variant, [
    'id',
    'type',
    'referenceStart',
    'referenceEnd',
    'reference',
    'alternate',
    'depth',
    'support',
    'supportWeight',
    'fraction',
    'meanQuality',
    'confidence',
    'supportingReadIds',
    'expectedVariantId',
    'omittedSupportingReadIds',
  ], path);
  const id = reportIdentityText(variant.id, `${path}.id`, MAX_ARTIFACT_ANALYSIS_ID_LENGTH);
  const alleles = validateConstructReportVariantAlleles(variant, path, topology, referenceLength);
  const depth = reportIntegerBetween(variant.depth, `${path}.depth`, 0, mappedReadCount);
  const support = reportIntegerBetween(variant.support, `${path}.support`, 0, depth);
  const supportWeight = reportNumberBetween(variant.supportWeight, `${path}.supportWeight`, 0, support * 256);
  const fraction = reportNumberBetween(variant.fraction, `${path}.fraction`, 0, 1);
  const meanQuality = reportNullableNumber(variant.meanQuality, `${path}.meanQuality`, 0, 255);
  if (variant.confidence !== 'high' && variant.confidence !== 'low') {
    throw new Error(`${path}.confidence must be high or low.`);
  }
  if (
    variant.confidence === 'high'
    && (
      meanQuality === null
      || meanQuality < reportFiniteNumber(thresholds.minVariantQuality, 'verification report thresholds.minVariantQuality')
      || fraction < reportFiniteNumber(thresholds.minVariantFraction, 'verification report thresholds.minVariantFraction')
    )
  ) {
    throw new Error(`${path}.confidence high is inconsistent with the saved variant thresholds.`);
  }
  const supportingReadIds = reportArray(variant.supportingReadIds, `${path}.supportingReadIds`).map((readId, index) => (
    reportIdentityText(readId, `${path}.supportingReadIds[${index}]`, MAX_ARTIFACT_ANALYSIS_ID_LENGTH)
  ));
  if (
    supportingReadIds.length > CONSTRUCT_REPORT_SUPPORTING_READ_LIMIT
    || new Set(supportingReadIds).size !== supportingReadIds.length
    || supportingReadIds.some((readId) => !mappedReadIds.has(readId))
  ) {
    throw new Error(`${path}.supportingReadIds must be unique mapped reads within the compact-report limit.`);
  }
  const omittedSupportingReadIds = reportInteger(variant.omittedSupportingReadIds, `${path}.omittedSupportingReadIds`);
  if (supportingReadIds.length + omittedSupportingReadIds !== support) {
    throw new Error(`${path} included and omitted supporting read ids must equal support.`);
  }
  const canNameQualitySupport = supportingReadIds.some((readId) => qualityMappedReadIds.has(readId));
  const canOmitQualitySupport = omittedSupportingReadIds > 0
    && [...qualityMappedReadIds].some((readId) => !supportingReadIds.includes(readId));
  if (variant.confidence === 'high' && !canNameQualitySupport && !canOmitQualitySupport) {
    throw new Error(`${path}.confidence high requires possible quality-bearing mapped-read support.`);
  }
  const expectedVariantId = reportOptionalIdentityText(
    variant.expectedVariantId,
    `${path}.expectedVariantId`,
    MAX_ARTIFACT_ANALYSIS_ID_LENGTH,
  );
  const signature = JSON.stringify([
    id,
    alleles.type,
    alleles.start,
    alleles.end,
    alleles.reference,
    alleles.alternate,
    depth,
    support,
    supportWeight,
    fraction,
    meanQuality,
    variant.confidence,
    supportingReadIds,
    expectedVariantId ?? null,
    omittedSupportingReadIds,
  ]);
  return {
    id,
    ...(expectedVariantId === undefined ? {} : { expectedVariantId }),
    confidence: variant.confidence,
    depth,
    alleleKey: JSON.stringify(alleles),
    signature,
    omittedSupportingReadIds,
  };
}

function validateConstructReportExpectedVariant(
  value: unknown,
  path: string,
  topology: 'linear' | 'circular',
  referenceLength: number,
  qualityMappedReadCount: number,
): ConstructReportExpectedVariant {
  const variant = reportObject(value, path);
  assertKnownKeys(variant, [
    'id',
    'type',
    'referenceStart',
    'referenceEnd',
    'reference',
    'alternate',
    'status',
    'depth',
    'observedVariantId',
  ], path);
  const id = reportIdentityText(variant.id, `${path}.id`, MAX_ARTIFACT_ANALYSIS_ID_LENGTH);
  const alleles = validateConstructReportVariantAlleles(variant, path, topology, referenceLength);
  const status = reportString(variant.status, `${path}.status`);
  if (!CONSTRUCT_REPORT_EXPECTED_VARIANT_STATUS_SET.has(status)) throw new Error(`${path}.status is not supported.`);
  const depth = reportIntegerBetween(variant.depth, `${path}.depth`, 0, qualityMappedReadCount);
  const observedVariantId = reportOptionalIdentityText(
    variant.observedVariantId,
    `${path}.observedVariantId`,
    MAX_ARTIFACT_ANALYSIS_ID_LENGTH,
  );
  if ((status === 'observed' || status === 'low_confidence') !== (observedVariantId !== undefined)) {
    throw new Error(`${path}.observedVariantId presence is inconsistent with status ${status}.`);
  }
  if (
    (status === 'not_covered' && depth !== 0)
    || ((status === 'observed' || status === 'not_observed') && depth === 0)
  ) {
    throw new Error(`${path}.depth is inconsistent with status ${status}.`);
  }
  const signature = JSON.stringify([
    id,
    alleles.type,
    alleles.start,
    alleles.end,
    alleles.reference,
    alleles.alternate,
    status,
    depth,
    observedVariantId ?? null,
  ]);
  return {
    id,
    status: status as ConstructReportExpectedVariant['status'],
    ...(observedVariantId === undefined ? {} : { observedVariantId }),
    depth,
    alleleKey: JSON.stringify(alleles),
    signature,
  };
}

function validateConstructVerificationReport(
  result: ConstructVerificationAnalysisResult,
  asset: ArtifactAnalysisAsset,
): void {
  const path = `Analysis result "${result.id}" verification report`;
  if (result.status !== 'complete') throw new Error(`${path} requires a complete analysis result.`);
  if (asset.sha256 === undefined) throw new Error(`${path} asset requires a content SHA-256.`);
  if (asset.createdAt !== result.createdAt) throw new Error(`${path} asset and result timestamps must match.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(asset.content);
  } catch {
    throw new Error(`${path} must contain valid JSON.`);
  }
  const report = reportObject(parsed, path);
  assertKnownKeys(report, [
    'schema',
    'version',
    'state',
    'reasons',
    'reference',
    'thresholds',
    'reads',
    'coverage',
    'consensus',
    'variants',
    'provenance',
    'omitted',
  ], path);
  if (report.schema !== CONSTRUCT_VERIFICATION_REPORT_SCHEMA || report.version !== 1) {
    throw new Error(`${path} must use ${CONSTRUCT_VERIFICATION_REPORT_SCHEMA} version 1.`);
  }
  assertReportValue(result, 'state', report.state, result.data.state);

  if (!result.assetIds.includes(asset.id)) {
    throw new Error(`Analysis result "${result.id}" verification report asset must also appear in assetIds.`);
  }
  if (!result.inputSha256s || result.inputSha256s.length !== result.inputRecordIds.length) {
    throw new Error(`Analysis result "${result.id}" with a verification report requires ordered inputSha256s.`);
  }

  const reference = reportObject(report.reference, `${path}.reference`);
  assertKnownKeys(reference, ['id', 'name', 'length', 'topology', 'sha256'], `${path}.reference`);
  assertReportValue(
    result,
    'reference.id',
    reportIdentityText(reference.id, `${path}.reference.id`, MAX_ARTIFACT_ANALYSIS_ID_LENGTH),
    result.data.referenceRecordId,
  );
  reportOptionalIdentityText(reference.name, `${path}.reference.name`, MAX_ARTIFACT_ANALYSIS_NAME_LENGTH);
  const referenceLength = reportIntegerBetween(
    reference.length,
    `${path}.reference.length`,
    1,
    CONSTRUCT_REPORT_LIMITS.maxReferenceLength,
  );
  assertReportValue(result, 'reference.length', referenceLength, result.data.referenceLength);
  const topology = reportString(reference.topology, `${path}.reference.topology`);
  if (topology !== 'linear' && topology !== 'circular') throw new Error(`${path}.reference.topology is not supported.`);
  assertReportValue(result, 'reference.topology', topology, result.parameters.topology);
  const referenceSha256 = reportSha256(reference.sha256, `${path}.reference.sha256`);
  assertReportValue(result, 'reference.sha256', referenceSha256, result.inputSha256s[0]);

  const reportThresholds = reportObject(report.thresholds, `${path}.thresholds`);
  assertReportThresholds(result, reportThresholds);

  const reads = reportArray(report.reads, `${path}.reads`);
  const omitted = reportObject(report.omitted, `${path}.omitted`);
  assertKnownKeys(omitted, [
    'reasons',
    'reads',
    'requiredRegions',
    'observedVariants',
    'expectedVariants',
    'unexpectedVariants',
    'missingExpectedVariants',
    'supportingReadIds',
  ], `${path}.omitted`);
  if (reportInteger(omitted.reads, `${path}.omitted.reads`) !== 0) {
    throw new Error(`${path} cannot omit read identities.`);
  }
  if (reads.length !== result.data.readRecordIds.length) reportMismatch(result, 'reads length');
  const validatedReads = reads.map((value, index) => (
    validateConstructReportRead(
      value,
      index,
      topology as 'linear' | 'circular',
      referenceLength,
      reportThresholds,
    )
  ));
  const reportReadIds = validatedReads.map((read) => read.id);
  const reportReadSha256s = validatedReads.map((read) => read.sha256);
  const mappedReadCount = validatedReads.filter((read) => read.mapped).length;
  if (new Set(reportReadIds).size !== reportReadIds.length) throw new Error(`${path}.reads cannot contain duplicate ids.`);
  assertReportArray(result, 'reads[].id', reportReadIds, result.data.readRecordIds);
  assertReportArray(result, 'reads[].sha256', reportReadSha256s, result.inputSha256s.slice(1));
  assertReportValue(result, 'mapped read count', mappedReadCount, result.data.mappedReadCount);

  const provenance = reportObject(report.provenance, `${path}.provenance`);
  assertKnownKeys(provenance, [
    'engine',
    'engineVersion',
    'referenceSha256',
    'readSha256s',
    'requestSha256',
    'workUnits',
    'limits',
  ], `${path}.provenance`);
  const engine = reportString(provenance.engine, `${path}.provenance.engine`);
  const engineVersion = reportString(provenance.engineVersion, `${path}.provenance.engineVersion`);
  if (engine !== 'motif-construct-verification' || engineVersion !== '1') {
    throw new Error(`${path}.provenance must identify motif-construct-verification version 1.`);
  }
  assertReportValue(result, 'provenance.engine', engine, result.provenance.engine);
  assertReportValue(result, 'provenance.engineVersion', engineVersion, result.provenance.engineVersion);
  assertReportValue(result, 'provenance.referenceSha256', reportSha256(provenance.referenceSha256, `${path}.provenance.referenceSha256`), referenceSha256);
  const provenanceReadSha256s = reportArray(provenance.readSha256s, `${path}.provenance.readSha256s`)
    .map((sha256, index) => reportSha256(sha256, `${path}.provenance.readSha256s[${index}]`));
  assertReportArray(result, 'provenance.readSha256s', provenanceReadSha256s, reportReadSha256s);
  const requestSha256 = reportSha256(provenance.requestSha256, `${path}.provenance.requestSha256`);
  const savedRequestSha256 = reportSha256(result.parameters.requestSha256, `Analysis result "${result.id}" parameters.requestSha256`);
  assertReportValue(result, 'provenance.requestSha256', requestSha256, savedRequestSha256);
  const readEvidence = reportObject(
    result.parameters.readEvidence,
    `Analysis result "${result.id}" parameters.readEvidence`,
  );
  assertKnownKeys(readEvidence, ['schema', 'sha256s'], `Analysis result "${result.id}" parameters.readEvidence`);
  if (readEvidence.schema !== 'motif.construct-read-evidence.v1') {
    throw new Error(`Analysis result "${result.id}" parameters.readEvidence schema is not supported.`);
  }
  const readEvidenceSha256s = reportArray(
    readEvidence.sha256s,
    `Analysis result "${result.id}" parameters.readEvidence.sha256s`,
  ).map((sha256, index) => reportSha256(
    sha256,
    `Analysis result "${result.id}" parameters.readEvidence.sha256s[${index}]`,
  ));
  if (readEvidenceSha256s.length !== reportReadIds.length) {
    throw new Error(`Analysis result "${result.id}" parameters.readEvidence must align one-to-one with reads.`);
  }
  const workUnits = reportIntegerBetween(
    provenance.workUnits,
    `${path}.provenance.workUnits`,
    0,
    CONSTRUCT_REPORT_LIMITS.maxWorkUnits,
  );
  const provenanceLimits = reportObject(provenance.limits, `${path}.provenance.limits`);
  assertKnownKeys(provenanceLimits, Object.keys(CONSTRUCT_REPORT_LIMITS), `${path}.provenance.limits`);
  assertReportArray(
    result,
    'provenance.limits keys',
    Object.keys(provenanceLimits).sort(),
    Object.keys(CONSTRUCT_REPORT_LIMITS).sort(),
  );
  Object.entries(CONSTRUCT_REPORT_LIMITS).forEach(([key, expected]) => {
    assertReportValue(
      result,
      `provenance.limits.${key}`,
      reportInteger(provenanceLimits[key], `${path}.provenance.limits.${key}`),
      expected,
    );
  });

  const validateSavedProvenance = (saved: ArtifactProvenance, savedPath: string) => {
    if (
      saved.source !== 'motif-for-claude-science-artifact'
      || saved.operation !== 'construct_verification'
      || saved.actor !== 'user'
      || saved.engine !== engine
      || saved.engineVersion !== engineVersion
    ) {
      throw new Error(`${savedPath} must identify the Motif construct-verification engine and user action.`);
    }
    if (saved.parentIds === undefined) throw new Error(`${savedPath}.parentIds is required.`);
    assertReportArray(result, `${savedPath}.parentIds`, saved.parentIds, result.inputRecordIds);
    const metadata = reportObject(saved.metadata, `${savedPath}.metadata`);
    assertKnownKeys(metadata, ['requestSha256', 'workUnits'], `${savedPath}.metadata`);
    assertReportValue(
      result,
      `${savedPath}.metadata.requestSha256`,
      reportSha256(metadata.requestSha256, `${savedPath}.metadata.requestSha256`),
      requestSha256,
    );
    assertReportValue(
      result,
      `${savedPath}.metadata.workUnits`,
      reportIntegerBetween(metadata.workUnits, `${savedPath}.metadata.workUnits`, 0, CONSTRUCT_REPORT_LIMITS.maxWorkUnits),
      workUnits,
    );
  };
  validateSavedProvenance(result.provenance, `Analysis result "${result.id}" provenance`);
  validateSavedProvenance(asset.provenance, `Analysis asset "${asset.id}" provenance`);

  const consensus = reportObject(report.consensus, `${path}.consensus`);
  assertKnownKeys(consensus, ['sequence'], `${path}.consensus`);
  if (
    typeof consensus.sequence !== 'string'
    || !CONSTRUCT_REPORT_IUPAC_CONSENSUS_PATTERN.test(consensus.sequence)
    || consensus.sequence.length > referenceLength
      + (result.data.observedVariantCount * CONSTRUCT_REPORT_LIMITS.maxIndelLength)
  ) {
    throw new Error(`${path}.consensus.sequence must be bounded A/C/G/T/N evidence.`);
  }

  const coverage = reportObject(report.coverage, `${path}.coverage`);
  assertKnownKeys(coverage, [
    'coveredBasesAtAnyDepth',
    'basesMeetingMinDepth',
    'coverageFraction',
    'minimumDepth',
    'maximumDepth',
    'meanDepth',
    'requiredRegions',
  ], `${path}.coverage`);
  const coveredBasesAtAnyDepth = reportIntegerBetween(
    coverage.coveredBasesAtAnyDepth,
    `${path}.coverage.coveredBasesAtAnyDepth`,
    0,
    referenceLength,
  );
  const basesMeetingMinDepth = reportIntegerBetween(
    coverage.basesMeetingMinDepth,
    `${path}.coverage.basesMeetingMinDepth`,
    0,
    coveredBasesAtAnyDepth,
  );
  assertReportValue(
    result,
    'coverage.basesMeetingMinDepth',
    basesMeetingMinDepth,
    result.data.coveredBases,
  );
  const coverageFraction = reportNumberBetween(
    coverage.coverageFraction,
    `${path}.coverage.coverageFraction`,
    0,
    1,
  );
  assertReportNumber(result, 'coverage.coverageFraction', coverageFraction, result.data.coverageFraction);
  assertReportNumber(result, 'coverage.coverageFraction formula', coverageFraction, basesMeetingMinDepth / referenceLength);
  const minimumDepth = reportIntegerBetween(
    coverage.minimumDepth,
    `${path}.coverage.minimumDepth`,
    0,
    mappedReadCount,
  );
  const maximumDepth = reportIntegerBetween(
    coverage.maximumDepth,
    `${path}.coverage.maximumDepth`,
    minimumDepth,
    mappedReadCount,
  );
  reportNumberBetween(coverage.meanDepth, `${path}.coverage.meanDepth`, minimumDepth, maximumDepth);
  const globalMinDepth = reportInteger(
    reportThresholds.minDepth,
    `${path}.thresholds.minDepth`,
  );
  if (
    (coveredBasesAtAnyDepth === 0) !== (maximumDepth === 0)
    || (coveredBasesAtAnyDepth === referenceLength) !== (minimumDepth > 0)
    || (basesMeetingMinDepth === 0) !== (maximumDepth < globalMinDepth)
    || (basesMeetingMinDepth === referenceLength) !== (minimumDepth >= globalMinDepth)
  ) {
    throw new Error(`${path}.coverage depth extrema, thresholds, and covered-base counts are inconsistent.`);
  }
  const requiredRegions = reportArray(coverage.requiredRegions, `${path}.coverage.requiredRegions`);
  const omittedRequiredRegions = reportInteger(omitted.requiredRegions, `${path}.omitted.requiredRegions`);
  assertReportValue(result, 'required region count', requiredRegions.length + omittedRequiredRegions, result.data.requiredRegionCount);
  if (omittedRequiredRegions !== 0) throw new Error(`${path} cannot omit required-region acceptance states.`);
  if (requiredRegions.length > CONSTRUCT_REPORT_LIMITS.maxRequiredRegions) {
    throw new Error(`${path}.coverage.requiredRegions exceeds the v1 limit.`);
  }
  const validatedRegions = requiredRegions.map((value, index) => validateConstructReportRegion(
    value,
    index,
    topology as 'linear' | 'circular',
    referenceLength,
    mappedReadCount,
  ));
  if (new Set(validatedRegions.map((region) => region.id)).size !== validatedRegions.length) {
    throw new Error(`${path}.coverage.requiredRegions cannot contain duplicate ids.`);
  }
  const passingRegionCount = validatedRegions.filter((region) => region.status === 'covered').length;
  assertReportValue(result, 'passing region count', passingRegionCount, result.data.passingRegionCount);

  const variants = reportObject(report.variants, `${path}.variants`);
  assertKnownKeys(variants, ['observed', 'expected', 'unexpected', 'missingExpected'], `${path}.variants`);
  const observedValues = reportArray(variants.observed, `${path}.variants.observed`);
  const expectedValues = reportArray(variants.expected, `${path}.variants.expected`);
  const unexpectedValues = reportArray(variants.unexpected, `${path}.variants.unexpected`);
  const missingExpectedValues = reportArray(variants.missingExpected, `${path}.variants.missingExpected`);
  const omittedObservedVariants = reportInteger(omitted.observedVariants, `${path}.omitted.observedVariants`);
  const omittedUnexpectedVariants = reportInteger(omitted.unexpectedVariants, `${path}.omitted.unexpectedVariants`);
  const omittedExpectedVariants = reportInteger(omitted.expectedVariants, `${path}.omitted.expectedVariants`);
  const omittedMissingExpectedVariants = reportInteger(
    omitted.missingExpectedVariants,
    `${path}.omitted.missingExpectedVariants`,
  );
  const assertCompactCount = (
    field: string,
    displayed: number,
    omittedCount: number,
    total: number,
    displayLimit: number,
  ) => {
    assertReportValue(result, `variants.${field} displayed count`, displayed, Math.min(total, displayLimit));
    assertReportValue(result, `variants.${field} omitted count`, omittedCount, Math.max(0, total - displayLimit));
  };
  assertCompactCount(
    'observed',
    observedValues.length,
    omittedObservedVariants,
    result.data.observedVariantCount,
    CONSTRUCT_REPORT_OBSERVED_VARIANT_LIMIT,
  );
  assertCompactCount(
    'unexpected',
    unexpectedValues.length,
    omittedUnexpectedVariants,
    result.data.unexpectedVariantCount,
    CONSTRUCT_REPORT_OBSERVED_VARIANT_LIMIT,
  );
  assertCompactCount(
    'expected',
    expectedValues.length,
    omittedExpectedVariants,
    result.data.expectedVariantCount,
    CONSTRUCT_REPORT_LIMITS.maxExpectedVariants,
  );
  assertCompactCount(
    'missingExpected',
    missingExpectedValues.length,
    omittedMissingExpectedVariants,
    result.data.missingExpectedVariantCount,
    CONSTRUCT_REPORT_LIMITS.maxExpectedVariants,
  );
  if (
    observedValues.length > CONSTRUCT_REPORT_OBSERVED_VARIANT_LIMIT
    || unexpectedValues.length > CONSTRUCT_REPORT_OBSERVED_VARIANT_LIMIT
    || expectedValues.length > CONSTRUCT_REPORT_LIMITS.maxExpectedVariants
    || missingExpectedValues.length > CONSTRUCT_REPORT_LIMITS.maxExpectedVariants
  ) {
    throw new Error(`${path}.variants exceeds the v1 limits.`);
  }
  const knownReadIds = new Set(reportReadIds);
  const mappedReadIds = new Set(validatedReads.filter((read) => read.mapped).map((read) => read.id));
  const qualityMappedReadIds = new Set(validatedReads
    .filter((read) => read.mapped && read.qualityProvided)
    .map((read) => read.id));
  const observed = observedValues.map((value, index) => validateConstructReportObservedVariant(
    value,
    `${path}.variants.observed[${index}]`,
    topology as 'linear' | 'circular',
    referenceLength,
    mappedReadCount,
    mappedReadIds,
    qualityMappedReadIds,
    reportThresholds,
  ));
  const unexpected = unexpectedValues.map((value, index) => validateConstructReportObservedVariant(
    value,
    `${path}.variants.unexpected[${index}]`,
    topology as 'linear' | 'circular',
    referenceLength,
    mappedReadCount,
    mappedReadIds,
    qualityMappedReadIds,
    reportThresholds,
  ));
  const expected = expectedValues.map((value, index) => validateConstructReportExpectedVariant(
    value,
    `${path}.variants.expected[${index}]`,
    topology as 'linear' | 'circular',
    referenceLength,
    qualityMappedReadIds.size,
  ));
  const missingExpected = missingExpectedValues.map((value, index) => validateConstructReportExpectedVariant(
    value,
    `${path}.variants.missingExpected[${index}]`,
    topology as 'linear' | 'circular',
    referenceLength,
    qualityMappedReadIds.size,
  ));
  const assertUniqueVariantIds = (entries: readonly { id: string }[], field: string) => {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      throw new Error(`${path}.variants.${field} cannot contain duplicate ids.`);
    }
  };
  assertUniqueVariantIds(observed, 'observed');
  assertUniqueVariantIds(expected, 'expected');
  assertUniqueVariantIds(unexpected, 'unexpected');
  assertUniqueVariantIds(missingExpected, 'missingExpected');
  const observedById = new Map(observed.map((variant) => [variant.id, variant]));
  const expectedById = new Map(expected.map((variant) => [variant.id, variant]));
  observed.forEach((variant) => {
    if (variant.expectedVariantId === undefined) return;
    const linked = expectedById.get(variant.expectedVariantId);
    if (
      !linked
      || linked.observedVariantId !== variant.id
      || linked.alleleKey !== variant.alleleKey
      || linked.depth > variant.depth
    ) {
      throw new Error(`${path}.variants observed/expected cross-links are inconsistent.`);
    }
  });
  expected.forEach((variant) => {
    if (variant.observedVariantId === undefined) return;
    const linked = observedById.get(variant.observedVariantId);
    if (
      linked !== undefined
      && (
        linked.expectedVariantId !== variant.id
        || linked.alleleKey !== variant.alleleKey
        || variant.depth > linked.depth
        || (variant.status === 'observed' ? linked.confidence !== 'high' : linked.confidence !== 'low')
      )
    ) {
      throw new Error(`${path}.variants expected/observed cross-links are inconsistent.`);
    }
    if (linked === undefined && omittedObservedVariants === 0) {
      throw new Error(`${path}.variants expected/observed cross-links are inconsistent.`);
    }
  });
  const unexpectedById = new Map(unexpected.map((variant) => [variant.id, variant]));
  observed.filter((variant) => variant.expectedVariantId === undefined).forEach((variant) => {
    const matching = unexpectedById.get(variant.id);
    if (!matching || matching.signature !== variant.signature) {
      throw new Error(`${path}.variants.unexpected must retain every visible unexpected observed variant.`);
    }
  });
  unexpected.forEach((variant) => {
    if (variant.expectedVariantId !== undefined) {
      throw new Error(`${path}.variants.unexpected cannot contain an expected variant link.`);
    }
    const matching = observedById.get(variant.id);
    if (matching !== undefined && matching.signature !== variant.signature) {
      throw new Error(`${path}.variants.unexpected must exactly match observed evidence.`);
    }
    if (matching === undefined && omittedObservedVariants === 0) {
      throw new Error(`${path}.variants.unexpected references absent observed evidence.`);
    }
  });
  const expectedMissingSignatures = expected
    .filter((variant) => variant.status !== 'observed')
    .map((variant) => variant.signature);
  assertReportArray(
    result,
    'variants.missingExpected subset',
    missingExpected.map((variant) => variant.signature),
    expectedMissingSignatures,
  );
  const expectedSupportingOmissions = [...observed, ...unexpected]
    .reduce((total, variant) => total + variant.omittedSupportingReadIds, 0);
  const reportedSupportingOmissions = reportInteger(
    omitted.supportingReadIds,
    `${path}.omitted.supportingReadIds`,
  );
  if (
    (omittedObservedVariants === 0 && omittedUnexpectedVariants === 0
      && reportedSupportingOmissions !== expectedSupportingOmissions)
    || reportedSupportingOmissions < expectedSupportingOmissions
  ) {
    throw new Error(`${path}.omitted.supportingReadIds is inconsistent with compact variant evidence.`);
  }

  const requiredReasonCodes = new Set<string>();
  if (mappedReadCount === 0) requiredReasonCodes.add('no_usable_reads');
  validatedReads.forEach((read) => {
    if (!read.qualityProvided) requiredReasonCodes.add('missing_quality');
    if (read.status === 'trimmed_read_too_short') requiredReasonCodes.add('trimmed_read_too_short');
    else if (read.status === 'unmapped') requiredReasonCodes.add('unmapped_read');
    else if (read.status !== 'mapped') requiredReasonCodes.add(read.status);
  });
  if (
    coverageFraction
    < reportFiniteNumber(reportThresholds.minCoverageFraction, `${path}.thresholds.minCoverageFraction`)
  ) requiredReasonCodes.add('partial_reference_coverage');
  validatedRegions.forEach((region) => {
    region.reasonCodes.forEach((code) => requiredReasonCodes.add(code));
  });
  observed.forEach((variant) => {
    if (variant.confidence === 'low') requiredReasonCodes.add('low_confidence_variant');
  });
  const visibleHighConfidenceUnexpected = unexpected.some((variant) => variant.confidence === 'high');
  if (visibleHighConfidenceUnexpected) requiredReasonCodes.add('unexpected_variant');
  expected.forEach((variant) => {
    if (variant.status === 'not_covered') requiredReasonCodes.add('expected_variant_not_covered');
    else if (variant.status === 'not_observed') requiredReasonCodes.add('expected_variant_not_observed');
  });
  requiredReasonCodes.forEach((code) => {
    if (!result.data.reasonCodes.includes(code)) {
      throw new Error(`${path} is missing required reason code ${code}.`);
    }
  });
  const visibleInconsistency = visibleHighConfidenceUnexpected
    || expected.some((variant) => variant.status === 'not_observed');
  if (visibleInconsistency && result.data.state !== 'inconsistent') {
    throw new Error(`${path}.state must be inconsistent for visible contradictory variant evidence.`);
  }
  if (requiredReasonCodes.size > 0 && result.data.state === 'consistent') {
    throw new Error(`${path}.state cannot be consistent while review or inconsistent evidence is present.`);
  }

  const reasons = reportArray(report.reasons, `${path}.reasons`);
  if (reasons.length > CONSTRUCT_REPORT_REASON_LIMIT) throw new Error(`${path}.reasons exceeds the v1 limit.`);
  const reportReasonCodes: string[] = [];
  const seenReasonCodes = new Set<string>();
  let hasReviewReason = false;
  let hasInconsistentReason = false;
  const knownRegionIds = new Set(validatedRegions.map((region) => region.id));
  const knownVariantIds = new Set([...observed, ...expected].map((variant) => variant.id));
  reasons.forEach((value, index) => {
    const reason = reportObject(value, `${path}.reasons[${index}]`);
    assertKnownKeys(reason, ['code', 'severity', 'message', 'readId', 'regionId', 'variantId'], `${path}.reasons[${index}]`);
    const code = reportIdentityText(reason.code, `${path}.reasons[${index}].code`, 128);
    if (!STABLE_REASON_CODE_PATTERN.test(code)) throw new Error(`${path}.reasons[${index}].code is not stable.`);
    if (reason.severity !== 'review' && reason.severity !== 'inconsistent') {
      throw new Error(`${path}.reasons[${index}].severity is not supported.`);
    }
    if (reason.severity === 'review') hasReviewReason = true;
    else hasInconsistentReason = true;
    if (typeof reason.message !== 'string' || reason.message.length > 512) {
      throw new Error(`${path}.reasons[${index}].message must be a string no longer than 512 characters.`);
    }
    const readId = reportOptionalIdentityText(reason.readId, `${path}.reasons[${index}].readId`, MAX_ARTIFACT_ANALYSIS_ID_LENGTH);
    const regionId = reportOptionalIdentityText(reason.regionId, `${path}.reasons[${index}].regionId`, MAX_ARTIFACT_ANALYSIS_ID_LENGTH);
    const variantId = reportOptionalIdentityText(reason.variantId, `${path}.reasons[${index}].variantId`, MAX_ARTIFACT_ANALYSIS_ID_LENGTH);
    if (readId !== undefined && !knownReadIds.has(readId)) throw new Error(`${path}.reasons[${index}].readId is unknown.`);
    if (regionId !== undefined && !knownRegionIds.has(regionId)) throw new Error(`${path}.reasons[${index}].regionId is unknown.`);
    if (
      variantId !== undefined
      && !knownVariantIds.has(variantId)
      && omittedObservedVariants === 0
      && omittedUnexpectedVariants === 0
    ) throw new Error(`${path}.reasons[${index}].variantId is unknown.`);
    if (!seenReasonCodes.has(code)) {
      seenReasonCodes.add(code);
      reportReasonCodes.push(code);
    }
  });
  assertReportArray(result, 'reason code prefix', reportReasonCodes, result.data.reasonCodes.slice(0, reportReasonCodes.length));
  const omittedReasons = reportInteger(omitted.reasons, `${path}.omitted.reasons`);
  if (reasons.length < CONSTRUCT_REPORT_REASON_LIMIT && omittedReasons !== 0) {
    throw new Error(`${path}.omitted.reasons cannot be nonzero below the report limit.`);
  }
  if (omittedReasons === 0) {
    assertReportArray(result, 'reason codes', reportReasonCodes, result.data.reasonCodes);
  }
  if (
    (result.data.state === 'consistent' && (hasReviewReason || hasInconsistentReason || omittedReasons > 0))
    || (result.data.state === 'needs_review' && (hasInconsistentReason || (!hasReviewReason && omittedReasons === 0)))
    || (result.data.state === 'inconsistent' && !hasInconsistentReason && omittedReasons === 0)
  ) {
    throw new Error(`${path}.state is inconsistent with its reason severities.`);
  }
}

function validateDependencies(workspace: ArtifactAnalysisWorkspace, context: ArtifactAnalysisContext): void {
  const resultIds = new Set(workspace.analysisResults.map((result) => result.id));
  const assetIds = new Set(workspace.analysisAssets.map((asset) => asset.id));
  for (const result of workspace.analysisResults) {
    resultDependencyIds(result).forEach((dependencyId) => {
      if (dependencyId === result.id) throw new Error(`Analysis result "${result.id}" cannot depend on itself.`);
      if (!resultIds.has(dependencyId)) throw new Error(`Analysis result "${result.id}" depends on missing result "${dependencyId}".`);
    });
    resultAssetIds(result).forEach((assetId) => {
      if (!assetIds.has(assetId)) throw new Error(`Analysis result "${result.id}" references missing asset "${assetId}".`);
    });
    if (context.recordLengths) {
      artifactAnalysisResultRecordIds(result).forEach((recordId) => {
        if (!context.recordLengths?.has(recordId)) throw new Error(`Analysis result "${result.id}" references missing record "${recordId}".`);
      });
    }
    if (result.kind === 'construct_verification') {
      const expectedInputRecordIds = [result.data.referenceRecordId, ...result.data.readRecordIds];
      if (
        result.inputRecordIds.length !== expectedInputRecordIds.length
        || result.inputRecordIds.some((recordId, index) => recordId !== expectedInputRecordIds[index])
      ) {
        throw new Error(`Analysis result "${result.id}" inputRecordIds must list the construct reference first, followed by readRecordIds in saved order.`);
      }
      if (result.data.verificationReportAssetId) {
        const reportAsset = workspace.analysisAssets.find((candidate) => candidate.id === result.data.verificationReportAssetId);
        if (reportAsset && reportAsset.mediaType !== 'application/json') {
          throw new Error(`Analysis result "${result.id}" verification report asset must use application/json.`);
        }
        if (reportAsset) validateConstructVerificationReport(result, reportAsset);
      }
    }
    if (result.kind === 'structure_model') {
      const asset = workspace.analysisAssets.find((candidate) => candidate.id === result.data.modelAssetId);
      const allowed = result.data.format === 'pdb' ? ['chemical/x-pdb', 'text/plain'] : ['chemical/x-cif', 'chemical/x-mmcif', 'text/plain'];
      if (asset && !allowed.includes(asset.mediaType)) throw new Error(`Analysis result "${result.id}" model asset mediaType does not match ${result.data.format}.`);
    }
  }
  assertAcyclicResultDependencies(workspace.analysisResults);
}

function assertAcyclicResultDependencies(results: ArtifactAnalysisResult[]): void {
  const byId = new Map(results.map((result) => [result.id, result]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Analysis result dependencies contain a cycle at "${id}".`);
    visiting.add(id);
    const result = byId.get(id);
    resultDependencyIds(result as ArtifactAnalysisResult).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  results.forEach((result) => visit(result.id));
}

export function normalizeArtifactAnalysisWorkspace(
  value: unknown,
  context: ArtifactAnalysisContext = {},
): ArtifactAnalysisWorkspace {
  if (value === undefined || value === null) return { analysisResults: [], analysisAssets: [] };
  if (!isPlainObject(value)) throw new Error('Analysis workspace must be an object.');
  assertKnownKeys(value, ['analysisResults', 'analysisAssets'], 'analysis workspace');
  const rawResults = value.analysisResults ?? [];
  const rawAssets = value.analysisAssets ?? [];
  if (!Array.isArray(rawResults)) throw new Error('analysisResults must be an array.');
  if (!Array.isArray(rawAssets)) throw new Error('analysisAssets must be an array.');
  if (rawResults.length > MAX_ARTIFACT_ANALYSIS_RESULTS) throw new Error(`analysisResults cannot contain more than ${MAX_ARTIFACT_ANALYSIS_RESULTS.toLocaleString()} entries.`);
  if (rawAssets.length > MAX_ARTIFACT_ANALYSIS_ASSETS) throw new Error(`analysisAssets cannot contain more than ${MAX_ARTIFACT_ANALYSIS_ASSETS.toLocaleString()} entries.`);
  const budget: Budget = { nodes: 0, textCharacters: 0, assetBytes: 0 };
  const workspace: ArtifactAnalysisWorkspace = {
    analysisResults: rawResults.map((result, index) => normalizeResult(result, index, budget, context)),
    analysisAssets: rawAssets.map((asset, index) => normalizeAsset(asset, index, budget)),
  };
  assertUniqueIds(workspace.analysisResults, 'analysisResults');
  assertUniqueIds(workspace.analysisAssets, 'analysisAssets');
  validateDependencies(workspace, context);
  return workspace;
}

/** Defensive clone. Normalization is intentionally the cloning primitive. */
export function cloneArtifactAnalysisWorkspace(
  value: unknown,
  context: ArtifactAnalysisContext = {},
): ArtifactAnalysisWorkspace {
  return normalizeArtifactAnalysisWorkspace(value, context);
}

/** Empty fields are omitted so older database payloads stay byte-stable. */
export function serializeArtifactAnalysisWorkspace(
  value: unknown,
  context: ArtifactAnalysisContext = {},
): ArtifactAnalysisWorkspaceFields {
  const normalized = normalizeArtifactAnalysisWorkspace(value, context);
  return {
    ...(normalized.analysisResults.length === 0 ? {} : { analysisResults: normalized.analysisResults }),
    ...(normalized.analysisAssets.length === 0 ? {} : { analysisAssets: normalized.analysisAssets }),
  };
}

export function appendArtifactAnalysisAsset(
  value: unknown,
  asset: unknown,
  context: ArtifactAnalysisContext = {},
): ArtifactAnalysisWorkspace {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  return normalizeArtifactAnalysisWorkspace({ ...workspace, analysisAssets: [...workspace.analysisAssets, asset] }, context);
}

/** Workspace-shaped append for callers updating both portable collections. */
export function appendArtifactAnalysisWorkspaceResult(
  value: unknown,
  result: unknown,
  context: ArtifactAnalysisContext = {},
): ArtifactAnalysisWorkspace {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  return normalizeArtifactAnalysisWorkspace({ ...workspace, analysisResults: [...workspace.analysisResults, result] }, context);
}

export function getArtifactAnalysisResultDependents(value: unknown, resultId: string): string[] {
  const workspace = normalizeArtifactAnalysisWorkspace(value);
  if (!workspace.analysisResults.some((result) => result.id === resultId)) throw new Error(`Analysis result "${resultId}" does not exist.`);
  return workspace.analysisResults.filter((result) => resultDependencyIds(result).includes(resultId)).map((result) => result.id);
}

export function getArtifactAnalysisAssetDependents(value: unknown, assetId: string): string[] {
  const workspace = normalizeArtifactAnalysisWorkspace(value);
  if (!workspace.analysisAssets.some((asset) => asset.id === assetId)) throw new Error(`Analysis asset "${assetId}" does not exist.`);
  return workspace.analysisResults.filter((result) => resultAssetIds(result).includes(assetId)).map((result) => result.id);
}

export function getArtifactAnalysisRecordDependents(value: unknown, recordId: string): string[] {
  const workspace = normalizeArtifactAnalysisWorkspace(value);
  return workspace.analysisResults.filter((result) => artifactAnalysisResultRecordIds(result).includes(recordId)).map((result) => result.id);
}

/** Workspace-shaped removal that also validates asset dependencies. */
export function removeArtifactAnalysisWorkspaceResult(
  value: unknown,
  resultId: string,
  context: ArtifactAnalysisContext = {},
): ArtifactAnalysisWorkspace {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  if (!workspace.analysisResults.some((result) => result.id === resultId)) throw new Error(`Analysis result "${resultId}" does not exist.`);
  const dependents = workspace.analysisResults.filter((result) => resultDependencyIds(result).includes(resultId));
  if (dependents.length > 0) throw new Error(`Analysis result "${resultId}" is required by ${dependents.map((result) => `"${result.id}"`).join(', ')}.`);
  return normalizeArtifactAnalysisWorkspace({ ...workspace, analysisResults: workspace.analysisResults.filter((result) => result.id !== resultId) }, context);
}

/**
 * Familiar collection-shaped API used by the standalone artifact state.
 * Callers with asset-backed results pass `analysisAssets` in the context.
 */
export function normalizeArtifactAnalysisResults(
  value: unknown,
  context: ArtifactAnalysisResultContext = {},
): ArtifactAnalysisResult[] {
  const { analysisAssets = [], ...analysisContext } = context;
  return normalizeArtifactAnalysisWorkspace({ analysisResults: value ?? [], analysisAssets }, analysisContext).analysisResults;
}

/** Pure result append with full dependency validation and no source mutation. */
export function appendArtifactAnalysisResult(
  analysisResults: unknown,
  result: unknown,
  context: ArtifactAnalysisResultContext = {},
): ArtifactAnalysisResult[] {
  const { analysisAssets = [], ...analysisContext } = context;
  return normalizeArtifactAnalysisWorkspace({
    analysisResults: [...normalizeArtifactAnalysisResults(analysisResults, context), result],
    analysisAssets,
  }, analysisContext).analysisResults;
}

/** Pure result removal that refuses to strand downstream result dependencies. */
export function removeArtifactAnalysisResult(
  analysisResults: unknown,
  resultId: string,
  context: ArtifactAnalysisResultContext = {},
): ArtifactAnalysisResult[] {
  const { analysisAssets = [], ...analysisContext } = context;
  return removeArtifactAnalysisWorkspaceResult({
    analysisResults,
    analysisAssets,
  }, resultId, analysisContext).analysisResults;
}

/** Defensive result snapshot for page-global getter and export APIs. */
export function getArtifactAnalysisResultsSnapshot(
  analysisResults: unknown,
  context: ArtifactAnalysisResultContext = {},
): ArtifactAnalysisResult[] {
  return normalizeArtifactAnalysisResults(analysisResults, context);
}

export function removeArtifactAnalysisAsset(
  value: unknown,
  assetId: string,
  context: ArtifactAnalysisContext = {},
): ArtifactAnalysisWorkspace {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  if (!workspace.analysisAssets.some((asset) => asset.id === assetId)) throw new Error(`Analysis asset "${assetId}" does not exist.`);
  const dependents = workspace.analysisResults.filter((result) => resultAssetIds(result).includes(assetId));
  if (dependents.length > 0) throw new Error(`Analysis asset "${assetId}" is required by ${dependents.map((result) => `"${result.id}"`).join(', ')}.`);
  return normalizeArtifactAnalysisWorkspace({ ...workspace, analysisAssets: workspace.analysisAssets.filter((asset) => asset.id !== assetId) }, context);
}

function collectResultCascade(results: ArtifactAnalysisResult[], initialIds: Iterable<string>): Set<string> {
  const removed = new Set(initialIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const result of results) {
      if (!removed.has(result.id) && resultDependencyIds(result).some((id) => removed.has(id))) {
        removed.add(result.id);
        changed = true;
      }
    }
  }
  return removed;
}

/** Explicit destructive helper for UI flows that preview the returned cascade. */
export function removeArtifactAnalysisResultCascade(
  value: unknown,
  resultId: string,
  options: { removeOrphanAssets?: boolean } = {},
  context: ArtifactAnalysisContext = {},
): ArtifactAnalysisWorkspace {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  if (!workspace.analysisResults.some((result) => result.id === resultId)) throw new Error(`Analysis result "${resultId}" does not exist.`);
  const removedIds = collectResultCascade(workspace.analysisResults, [resultId]);
  const keptResults = workspace.analysisResults.filter((result) => !removedIds.has(result.id));
  const removedAssetIds = new Set(workspace.analysisResults.filter((result) => removedIds.has(result.id)).flatMap(resultAssetIds));
  const keptAssetIds = new Set(keptResults.flatMap(resultAssetIds));
  const keptAssets = options.removeOrphanAssets
    ? workspace.analysisAssets.filter((asset) => !removedAssetIds.has(asset.id) || keptAssetIds.has(asset.id))
    : workspace.analysisAssets;
  return normalizeArtifactAnalysisWorkspace({ analysisResults: keptResults, analysisAssets: keptAssets }, context);
}

/** Explicit destructive helper for record deletion and its downstream analyses. */
export function removeArtifactAnalysisResultsForRecord(
  value: unknown,
  recordId: string,
  options: { removeOrphanAssets?: boolean } = {},
): ArtifactAnalysisWorkspace {
  const workspace = normalizeArtifactAnalysisWorkspace(value);
  const directIds = workspace.analysisResults.filter((result) => artifactAnalysisResultRecordIds(result).includes(recordId)).map((result) => result.id);
  if (directIds.length === 0) return workspace;
  const removedIds = collectResultCascade(workspace.analysisResults, directIds);
  const keptResults = workspace.analysisResults.filter((result) => !removedIds.has(result.id));
  const removedAssetIds = new Set(workspace.analysisResults.filter((result) => removedIds.has(result.id)).flatMap(resultAssetIds));
  const keptAssetIds = new Set(keptResults.flatMap(resultAssetIds));
  const keptAssets = options.removeOrphanAssets
    ? workspace.analysisAssets.filter((asset) => !removedAssetIds.has(asset.id) || keptAssetIds.has(asset.id))
    : workspace.analysisAssets;
  return normalizeArtifactAnalysisWorkspace({ analysisResults: keptResults, analysisAssets: keptAssets });
}
