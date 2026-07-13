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

function resultRecordIds(result: ArtifactAnalysisResult): string[] {
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
  if (result.kind === 'blast_search') ids.push(result.data.queryRecordId);
  if (result.kind === 'structure_model') result.data.chains.forEach((chain) => { if (chain.recordId) ids.push(chain.recordId); });
  return Array.from(new Set(ids));
}

function resultAssetIds(result: ArtifactAnalysisResult): string[] {
  const ids = [...result.assetIds];
  if (result.kind === 'blast_search') result.data.hits.forEach((hit) => { if (hit.alignmentAssetId) ids.push(hit.alignmentAssetId); });
  if (result.kind === 'structure_model') ids.push(result.data.modelAssetId);
  if (result.kind === 'report' && result.data.bodyAssetId) ids.push(result.data.bodyAssetId);
  return Array.from(new Set(ids));
}

function resultDependencyIds(result: ArtifactAnalysisResult): string[] {
  const ids = [...result.dependsOnResultIds];
  if (result.kind === 'pcr' && result.data.primerDesignResultId) ids.push(result.data.primerDesignResultId);
  return Array.from(new Set(ids));
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
      resultRecordIds(result).forEach((recordId) => {
        if (!context.recordLengths?.has(recordId)) throw new Error(`Analysis result "${result.id}" references missing record "${recordId}".`);
      });
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
  return workspace.analysisResults.filter((result) => resultRecordIds(result).includes(recordId)).map((result) => result.id);
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
  const directIds = workspace.analysisResults.filter((result) => resultRecordIds(result).includes(recordId)).map((result) => result.id);
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
