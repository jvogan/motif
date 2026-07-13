// Generated from src/artifacts/claude-science-analysis-results.ts. Regenerate with the documented esbuild command; do not edit by hand.

// src/artifacts/claude-science-analysis-results.ts
var MAX_ARTIFACT_ANALYSIS_RESULTS = 1e3;
var MAX_ARTIFACT_ANALYSIS_ASSETS = 2e3;
var MAX_ARTIFACT_ANALYSIS_ASSET_BYTES = 2097152;
var MAX_ARTIFACT_ANALYSIS_TOTAL_ASSET_BYTES = 16777216;
var MAX_ARTIFACT_ANALYSIS_TEXT_CHARACTERS = 8388608;
var MAX_ARTIFACT_ANALYSIS_STRUCTURED_NODES = 5e4;
var MAX_ARTIFACT_ANALYSIS_DEPTH = 12;
var MAX_ARTIFACT_ANALYSIS_ARRAY_ENTRIES = 1e4;
var MAX_ARTIFACT_ANALYSIS_RECORD_IDS = 250;
var MAX_ARTIFACT_ANALYSIS_DEPENDENCIES = 250;
var MAX_ARTIFACT_ANALYSIS_ASSET_IDS = 250;
var MAX_ARTIFACT_ANALYSIS_NAME_LENGTH = 256;
var MAX_ARTIFACT_ANALYSIS_ID_LENGTH = 160;
var MAX_ARTIFACT_ANALYSIS_SUMMARY_LENGTH = 16384;
var MAX_ARTIFACT_ANALYSIS_TABLE_COLUMNS = 256;
var MAX_ARTIFACT_ANALYSIS_TABLE_ROWS = 1e4;
var ARTIFACT_ANALYSIS_KINDS = [
  "primer_design",
  "pcr",
  "assembly_plan",
  "blast_search",
  "structure_model",
  "report",
  "table"
];
var ARTIFACT_ANALYSIS_ASSET_MEDIA_TYPES = [
  "application/json",
  "chemical/x-cif",
  "chemical/x-mmcif",
  "chemical/x-pdb",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/x-fasta"
];
var ANALYSIS_KIND_SET = new Set(ARTIFACT_ANALYSIS_KINDS);
var ASSET_MEDIA_TYPE_SET = new Set(ARTIFACT_ANALYSIS_ASSET_MEDIA_TYPES);
var UNSAFE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var STATUS_SET = /* @__PURE__ */ new Set(["complete", "partial", "failed"]);
var ASSEMBLY_METHOD_SET = /* @__PURE__ */ new Set(["golden_gate", "golden_braid", "gibson", "ligation", "other"]);
var BLAST_PROGRAM_SET = /* @__PURE__ */ new Set(["blastn", "blastp", "blastx", "tblastn", "tblastx"]);
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function assertKnownKeys(value, allowed, path) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${path}.${key} is not a recognized field.`);
  }
}
function consumeText(value, path, budget) {
  budget.textCharacters += value.length;
  if (budget.textCharacters > MAX_ARTIFACT_ANALYSIS_TEXT_CHARACTERS) {
    throw new Error(`${path} makes analysis data exceed the text-character limit.`);
  }
}
function boundedString(value, path, maxLength, budget, options = {}) {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  const normalized = options.trim === false ? value.replace(/\r\n?/g, "\n") : value.trim();
  if (!options.allowBlank && !normalized.trim()) throw new Error(`${path} must not be blank.`);
  if (normalized.length > maxLength) throw new Error(`${path} cannot exceed ${maxLength.toLocaleString()} characters.`);
  consumeText(normalized, path, budget);
  return normalized;
}
function normalizeId(value, path, budget) {
  return boundedString(value, path, MAX_ARTIFACT_ANALYSIS_ID_LENGTH, budget);
}
function normalizeTimestamp(value, path, budget) {
  const raw = boundedString(value, path, 64, budget);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || !Number.isFinite(Date.parse(raw))) {
    throw new Error(`${path} must be a valid ISO 8601 date-time.`);
  }
  return new Date(Date.parse(raw)).toISOString();
}
function finiteNumber(value, path, options = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
  if (options.integer && !Number.isInteger(value)) throw new Error(`${path} must be an integer.`);
  if (options.min !== void 0 && value < options.min) throw new Error(`${path} must be at least ${options.min}.`);
  if (options.max !== void 0 && value > options.max) throw new Error(`${path} must be no greater than ${options.max}.`);
  return value;
}
function normalizeRange(value, path, maxLength) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["start", "end"], path);
  const start = finiteNumber(value.start, `${path}.start`, { min: 0, integer: true });
  const end = finiteNumber(value.end, `${path}.end`, { min: 1, integer: true });
  if (end <= start) throw new Error(`${path}.end must be greater than start.`);
  if (maxLength !== void 0 && end > maxLength) throw new Error(`${path} must fit within the ${maxLength}-residue record.`);
  return { start, end };
}
function normalizeStringArray(value, path, maxEntries, budget, options = {}) {
  if (value === void 0 && !options.required) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > maxEntries) throw new Error(`${path} cannot contain more than ${maxEntries.toLocaleString()} entries.`);
  const normalized = value.map((item, index) => normalizeId(item, `${path}[${index}]`, budget));
  const result = options.deduplicate ? Array.from(new Set(normalized)) : normalized;
  if (options.deduplicate && result.length !== normalized.length) throw new Error(`${path} cannot contain duplicate ids.`);
  return result;
}
function normalizeJsonValue(value, path, budget, ancestors, depth) {
  budget.nodes += 1;
  if (budget.nodes > MAX_ARTIFACT_ANALYSIS_STRUCTURED_NODES) throw new Error(`${path} exceeds the structured-data node limit.`);
  if (depth > MAX_ARTIFACT_ANALYSIS_DEPTH) throw new Error(`${path} exceeds the maximum structured-data depth.`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return boundedString(value, path, 16384, budget, { trim: false, allowBlank: true });
  if (typeof value === "number") return finiteNumber(value, path);
  if (typeof value !== "object" || value === null) throw new Error(`${path} must contain JSON-compatible data only.`);
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
    const normalized = {};
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
function normalizeJsonObject(value, path, budget) {
  if (!isPlainObject(value)) throw new Error(`${path} must be a plain JSON object.`);
  return normalizeJsonValue(value, path, budget, /* @__PURE__ */ new WeakSet(), 0);
}
function normalizeProvenance(value, path, budget) {
  if (!isPlainObject(value)) throw new Error(`${path} is required and must be an object.`);
  assertKnownKeys(value, ["source", "operation", "actor", "engine", "engineVersion", "parentIds", "metadata"], path);
  const text = (field) => value[field] === void 0 ? void 0 : boundedString(value[field], `${path}.${field}`, 256, budget);
  const source = boundedString(value.source, `${path}.source`, 256, budget);
  const operation = text("operation");
  const actor = text("actor");
  const engine = text("engine");
  const engineVersion = text("engineVersion");
  const parentIds = value.parentIds === void 0 ? void 0 : normalizeStringArray(value.parentIds, `${path}.parentIds`, MAX_ARTIFACT_ANALYSIS_DEPENDENCIES, budget, { deduplicate: true });
  const metadata = value.metadata === void 0 ? void 0 : normalizeJsonObject(value.metadata, `${path}.metadata`, budget);
  return {
    source,
    ...operation === void 0 ? {} : { operation },
    ...actor === void 0 ? {} : { actor },
    ...engine === void 0 ? {} : { engine },
    ...engineVersion === void 0 ? {} : { engineVersion },
    ...parentIds === void 0 ? {} : { parentIds },
    ...metadata === void 0 ? {} : { metadata }
  };
}
function normalizeSha256(value, path, budget) {
  const sha256 = boundedString(value, path, 64, budget).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${path} must be a 64-character SHA-256 value.`);
  return sha256;
}
function normalizeAsset(value, index, budget) {
  const path = `analysisAssets[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["id", "name", "mediaType", "content", "sha256", "createdAt", "provenance"], path);
  const id = normalizeId(value.id, `${path}.id`, budget);
  const name = boundedString(value.name, `${path}.name`, MAX_ARTIFACT_ANALYSIS_NAME_LENGTH, budget);
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error(`${path}.name cannot contain path separators or NUL.`);
  }
  if (typeof value.mediaType !== "string") throw new Error(`${path}.mediaType must be a string.`);
  const mediaType = value.mediaType.trim().toLowerCase();
  if (!ASSET_MEDIA_TYPE_SET.has(mediaType)) {
    throw new Error(`${path}.mediaType is not an allowed inert text/JSON media type; HTML, SVG, and binary assets are forbidden.`);
  }
  const content = boundedString(value.content, `${path}.content`, MAX_ARTIFACT_ANALYSIS_ASSET_BYTES, budget, {
    trim: false,
    allowBlank: true
  });
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes > MAX_ARTIFACT_ANALYSIS_ASSET_BYTES) {
    throw new Error(`${path}.content cannot exceed ${MAX_ARTIFACT_ANALYSIS_ASSET_BYTES.toLocaleString()} UTF-8 bytes.`);
  }
  budget.assetBytes += bytes;
  if (budget.assetBytes > MAX_ARTIFACT_ANALYSIS_TOTAL_ASSET_BYTES) {
    throw new Error(`analysisAssets cannot exceed ${MAX_ARTIFACT_ANALYSIS_TOTAL_ASSET_BYTES.toLocaleString()} UTF-8 bytes in total.`);
  }
  if (mediaType === "application/json") {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`${path}.content must be valid JSON for application/json.`);
    }
    normalizeJsonValue(parsed, `${path}.content JSON`, budget, /* @__PURE__ */ new WeakSet(), 0);
  }
  const sha256 = value.sha256 === void 0 ? void 0 : normalizeSha256(value.sha256, `${path}.sha256`, budget);
  return {
    id,
    name,
    mediaType,
    content,
    ...sha256 === void 0 ? {} : { sha256 },
    createdAt: normalizeTimestamp(value.createdAt, `${path}.createdAt`, budget),
    provenance: normalizeProvenance(value.provenance, `${path}.provenance`, budget)
  };
}
function normalizePrimer(value, path, budget) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["sequence", "tmC", "gcPercent", "start", "end", "tail5"], path);
  const sequence = boundedString(value.sequence, `${path}.sequence`, 1e3, budget).toUpperCase();
  if (!/^[ACGTUNRYKMSWBDHV-]+$/.test(sequence)) throw new Error(`${path}.sequence must contain IUPAC nucleotide symbols only.`);
  const start = value.start === void 0 ? void 0 : finiteNumber(value.start, `${path}.start`, { min: 0, integer: true });
  const end = value.end === void 0 ? void 0 : finiteNumber(value.end, `${path}.end`, { min: 1, integer: true });
  if (start === void 0 !== (end === void 0)) throw new Error(`${path}.start and end must be supplied together.`);
  if (start !== void 0 && end !== void 0 && end <= start) throw new Error(`${path}.end must be greater than start.`);
  const tail5 = value.tail5 === void 0 ? void 0 : boundedString(value.tail5, `${path}.tail5`, 500, budget).toUpperCase();
  if (tail5 !== void 0 && !/^[ACGTUNRYKMSWBDHV-]+$/.test(tail5)) throw new Error(`${path}.tail5 must contain IUPAC nucleotide symbols only.`);
  return {
    sequence,
    tmC: finiteNumber(value.tmC, `${path}.tmC`, { min: -100, max: 200 }),
    gcPercent: finiteNumber(value.gcPercent, `${path}.gcPercent`, { min: 0, max: 100 }),
    ...start === void 0 ? {} : { start },
    ...end === void 0 ? {} : { end },
    ...tail5 === void 0 ? {} : { tail5 }
  };
}
function normalizePrimerDesignData(value, path, budget, context) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["targetRecordId", "targetRange", "pairs", "selectedPairId"], path);
  const targetRecordId = normalizeId(value.targetRecordId, `${path}.targetRecordId`, budget);
  const targetLength = context.recordLengths?.get(targetRecordId);
  if (context.recordLengths && targetLength === void 0) throw new Error(`${path}.targetRecordId does not match a workspace record.`);
  const targetRange = value.targetRange === void 0 ? void 0 : normalizeRange(value.targetRange, `${path}.targetRange`, targetLength);
  if (!Array.isArray(value.pairs)) throw new Error(`${path}.pairs must be an array.`);
  if (value.pairs.length > 500) throw new Error(`${path}.pairs cannot contain more than 500 entries.`);
  const pairs = value.pairs.map((pair, index) => {
    const pairPath = `${path}.pairs[${index}]`;
    if (!isPlainObject(pair)) throw new Error(`${pairPath} must be an object.`);
    assertKnownKeys(pair, ["id", "forward", "reverse", "productLengthBp", "score", "warnings"], pairPath);
    const warnings = pair.warnings === void 0 ? void 0 : normalizeTextArray(pair.warnings, `${pairPath}.warnings`, 50, 1024, budget);
    return {
      id: normalizeId(pair.id, `${pairPath}.id`, budget),
      forward: normalizePrimer(pair.forward, `${pairPath}.forward`, budget),
      reverse: normalizePrimer(pair.reverse, `${pairPath}.reverse`, budget),
      productLengthBp: finiteNumber(pair.productLengthBp, `${pairPath}.productLengthBp`, { min: 1, integer: true }),
      ...pair.score === void 0 ? {} : { score: finiteNumber(pair.score, `${pairPath}.score`) },
      ...warnings === void 0 ? {} : { warnings }
    };
  });
  assertUniqueIds(pairs, `${path}.pairs`);
  const selectedPairId = value.selectedPairId === void 0 ? void 0 : normalizeId(value.selectedPairId, `${path}.selectedPairId`, budget);
  if (selectedPairId !== void 0 && !pairs.some((pair) => pair.id === selectedPairId)) {
    throw new Error(`${path}.selectedPairId does not match a primer pair.`);
  }
  return { targetRecordId, ...targetRange === void 0 ? {} : { targetRange }, pairs, ...selectedPairId === void 0 ? {} : { selectedPairId } };
}
function normalizeTextArray(value, path, maxEntries, maxLength, budget) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > maxEntries) throw new Error(`${path} cannot contain more than ${maxEntries} entries.`);
  return value.map((item, index) => boundedString(item, `${path}[${index}]`, maxLength, budget));
}
function normalizePcrData(value, path, budget, context) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["templateRecordId", "primerDesignResultId", "products"], path);
  const templateRecordId = normalizeId(value.templateRecordId, `${path}.templateRecordId`, budget);
  const templateLength = context.recordLengths?.get(templateRecordId);
  if (context.recordLengths && templateLength === void 0) throw new Error(`${path}.templateRecordId does not match a workspace record.`);
  const primerDesignResultId = value.primerDesignResultId === void 0 ? void 0 : normalizeId(value.primerDesignResultId, `${path}.primerDesignResultId`, budget);
  if (!Array.isArray(value.products)) throw new Error(`${path}.products must be an array.`);
  if (value.products.length > 500) throw new Error(`${path}.products cannot contain more than 500 entries.`);
  const products = value.products.map((product, index) => {
    const productPath = `${path}.products[${index}]`;
    if (!isPlainObject(product)) throw new Error(`${productPath} must be an object.`);
    assertKnownKeys(product, ["id", "lengthBp", "recordId", "templateRange"], productPath);
    const recordId = product.recordId === void 0 ? void 0 : normalizeId(product.recordId, `${productPath}.recordId`, budget);
    if (recordId !== void 0 && context.recordLengths && !context.recordLengths.has(recordId)) {
      throw new Error(`${productPath}.recordId does not match a workspace record.`);
    }
    return {
      id: normalizeId(product.id, `${productPath}.id`, budget),
      lengthBp: finiteNumber(product.lengthBp, `${productPath}.lengthBp`, { min: 1, integer: true }),
      ...recordId === void 0 ? {} : { recordId },
      ...product.templateRange === void 0 ? {} : { templateRange: normalizeRange(product.templateRange, `${productPath}.templateRange`, templateLength) }
    };
  });
  assertUniqueIds(products, `${path}.products`);
  return { templateRecordId, ...primerDesignResultId === void 0 ? {} : { primerDesignResultId }, products };
}
function normalizeAssemblyData(value, path, budget) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["method", "orderedPartRecordIds", "destinationRecordId", "productRecordId", "standard", "enzyme", "junctions"], path);
  if (!ASSEMBLY_METHOD_SET.has(value.method)) throw new Error(`${path}.method is not supported.`);
  const orderedPartRecordIds = normalizeStringArray(value.orderedPartRecordIds, `${path}.orderedPartRecordIds`, MAX_ARTIFACT_ANALYSIS_RECORD_IDS, budget, { required: true });
  if (orderedPartRecordIds.length === 0) throw new Error(`${path}.orderedPartRecordIds must contain at least one part.`);
  const optionalId = (field) => value[field] === void 0 ? void 0 : normalizeId(value[field], `${path}.${field}`, budget);
  const optionalText = (field) => value[field] === void 0 ? void 0 : boundedString(value[field], `${path}.${field}`, 256, budget);
  let junctions;
  if (value.junctions !== void 0) {
    if (!Array.isArray(value.junctions)) throw new Error(`${path}.junctions must be an array.`);
    if (value.junctions.length > MAX_ARTIFACT_ANALYSIS_RECORD_IDS) throw new Error(`${path}.junctions contains too many entries.`);
    junctions = value.junctions.map((junction, index) => {
      const junctionPath = `${path}.junctions[${index}]`;
      if (!isPlainObject(junction)) throw new Error(`${junctionPath} must be an object.`);
      assertKnownKeys(junction, ["leftRecordId", "rightRecordId", "compatible", "overhang", "note"], junctionPath);
      if (typeof junction.compatible !== "boolean") throw new Error(`${junctionPath}.compatible must be a boolean.`);
      const overhang = junction.overhang === void 0 ? void 0 : boundedString(junction.overhang, `${junctionPath}.overhang`, 64, budget);
      const note = junction.note === void 0 ? void 0 : boundedString(junction.note, `${junctionPath}.note`, 1024, budget);
      return {
        leftRecordId: normalizeId(junction.leftRecordId, `${junctionPath}.leftRecordId`, budget),
        rightRecordId: normalizeId(junction.rightRecordId, `${junctionPath}.rightRecordId`, budget),
        compatible: junction.compatible,
        ...overhang === void 0 ? {} : { overhang },
        ...note === void 0 ? {} : { note }
      };
    });
  }
  const destinationRecordId = optionalId("destinationRecordId");
  const productRecordId = optionalId("productRecordId");
  const standard = optionalText("standard");
  const enzyme = optionalText("enzyme");
  return {
    method: value.method,
    orderedPartRecordIds,
    ...destinationRecordId === void 0 ? {} : { destinationRecordId },
    ...productRecordId === void 0 ? {} : { productRecordId },
    ...standard === void 0 ? {} : { standard },
    ...enzyme === void 0 ? {} : { enzyme },
    ...junctions === void 0 ? {} : { junctions }
  };
}
function normalizeBlastData(value, path, budget) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["program", "database", "databaseVersion", "queryRecordId", "hits"], path);
  if (!BLAST_PROGRAM_SET.has(value.program)) throw new Error(`${path}.program is not supported.`);
  if (!Array.isArray(value.hits)) throw new Error(`${path}.hits must be an array.`);
  if (value.hits.length > MAX_ARTIFACT_ANALYSIS_ARRAY_ENTRIES) throw new Error(`${path}.hits contains too many entries.`);
  const hits = value.hits.map((hit, index) => {
    const hitPath = `${path}.hits[${index}]`;
    if (!isPlainObject(hit)) throw new Error(`${hitPath} must be an object.`);
    assertKnownKeys(hit, ["accession", "title", "identityPercent", "queryCoveragePercent", "eValue", "bitScore", "queryStart", "queryEnd", "subjectStart", "subjectEnd", "alignmentAssetId"], hitPath);
    const optionalPosition = (field) => hit[field] === void 0 ? void 0 : finiteNumber(hit[field], `${hitPath}.${field}`, { min: 1, integer: true });
    const queryStart = optionalPosition("queryStart");
    const queryEnd = optionalPosition("queryEnd");
    const subjectStart = optionalPosition("subjectStart");
    const subjectEnd = optionalPosition("subjectEnd");
    if (queryStart === void 0 !== (queryEnd === void 0)) throw new Error(`${hitPath}.queryStart and queryEnd must be supplied together.`);
    if (subjectStart === void 0 !== (subjectEnd === void 0)) throw new Error(`${hitPath}.subjectStart and subjectEnd must be supplied together.`);
    const alignmentAssetId = hit.alignmentAssetId === void 0 ? void 0 : normalizeId(hit.alignmentAssetId, `${hitPath}.alignmentAssetId`, budget);
    return {
      accession: boundedString(hit.accession, `${hitPath}.accession`, 256, budget),
      title: boundedString(hit.title, `${hitPath}.title`, 2048, budget),
      identityPercent: finiteNumber(hit.identityPercent, `${hitPath}.identityPercent`, { min: 0, max: 100 }),
      queryCoveragePercent: finiteNumber(hit.queryCoveragePercent, `${hitPath}.queryCoveragePercent`, { min: 0, max: 100 }),
      eValue: finiteNumber(hit.eValue, `${hitPath}.eValue`, { min: 0 }),
      bitScore: finiteNumber(hit.bitScore, `${hitPath}.bitScore`, { min: 0 }),
      ...queryStart === void 0 ? {} : { queryStart },
      ...queryEnd === void 0 ? {} : { queryEnd },
      ...subjectStart === void 0 ? {} : { subjectStart },
      ...subjectEnd === void 0 ? {} : { subjectEnd },
      ...alignmentAssetId === void 0 ? {} : { alignmentAssetId }
    };
  });
  const databaseVersion = value.databaseVersion === void 0 ? void 0 : boundedString(value.databaseVersion, `${path}.databaseVersion`, 256, budget);
  return {
    program: value.program,
    database: boundedString(value.database, `${path}.database`, 256, budget),
    ...databaseVersion === void 0 ? {} : { databaseVersion },
    queryRecordId: normalizeId(value.queryRecordId, `${path}.queryRecordId`, budget),
    hits
  };
}
function normalizeStructureData(value, path, budget) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["format", "modelAssetId", "method", "chains", "metrics"], path);
  if (value.format !== "pdb" && value.format !== "mmcif") throw new Error(`${path}.format must be "pdb" or "mmcif".`);
  if (!Array.isArray(value.chains)) throw new Error(`${path}.chains must be an array.`);
  if (value.chains.length > 1e3) throw new Error(`${path}.chains cannot contain more than 1,000 entries.`);
  const chains = value.chains.map((chain, index) => {
    const chainPath = `${path}.chains[${index}]`;
    if (!isPlainObject(chain)) throw new Error(`${chainPath} must be an object.`);
    assertKnownKeys(chain, ["id", "recordId", "residueCount"], chainPath);
    return {
      id: normalizeId(chain.id, `${chainPath}.id`, budget),
      ...chain.recordId === void 0 ? {} : { recordId: normalizeId(chain.recordId, `${chainPath}.recordId`, budget) },
      ...chain.residueCount === void 0 ? {} : { residueCount: finiteNumber(chain.residueCount, `${chainPath}.residueCount`, { min: 1, integer: true }) }
    };
  });
  assertUniqueIds(chains, `${path}.chains`);
  return {
    format: value.format,
    modelAssetId: normalizeId(value.modelAssetId, `${path}.modelAssetId`, budget),
    method: boundedString(value.method, `${path}.method`, 256, budget),
    chains,
    ...value.metrics === void 0 ? {} : { metrics: normalizeJsonObject(value.metrics, `${path}.metrics`, budget) }
  };
}
function normalizeReportData(value, path, budget) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["format", "body", "bodyAssetId"], path);
  if (value.format !== "plain" && value.format !== "markdown") throw new Error(`${path}.format must be "plain" or "markdown".`);
  const body = value.body === void 0 ? void 0 : boundedString(value.body, `${path}.body`, 262144, budget, { trim: false, allowBlank: true });
  const bodyAssetId = value.bodyAssetId === void 0 ? void 0 : normalizeId(value.bodyAssetId, `${path}.bodyAssetId`, budget);
  if (body === void 0 && bodyAssetId === void 0) throw new Error(`${path} requires body or bodyAssetId.`);
  return { format: value.format, ...body === void 0 ? {} : { body }, ...bodyAssetId === void 0 ? {} : { bodyAssetId } };
}
function normalizeTableData(value, path, budget) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["columns", "rows"], path);
  if (!Array.isArray(value.columns)) throw new Error(`${path}.columns must be an array.`);
  if (value.columns.length === 0 || value.columns.length > MAX_ARTIFACT_ANALYSIS_TABLE_COLUMNS) {
    throw new Error(`${path}.columns must contain 1\u2013${MAX_ARTIFACT_ANALYSIS_TABLE_COLUMNS} entries.`);
  }
  const columns = value.columns.map((column, index) => {
    const columnPath = `${path}.columns[${index}]`;
    if (!isPlainObject(column)) throw new Error(`${columnPath} must be an object.`);
    assertKnownKeys(column, ["id", "label", "type"], columnPath);
    if (column.type !== "string" && column.type !== "number" && column.type !== "boolean" && column.type !== "mixed") {
      throw new Error(`${columnPath}.type is not supported.`);
    }
    return {
      id: normalizeId(column.id, `${columnPath}.id`, budget),
      label: boundedString(column.label, `${columnPath}.label`, 256, budget),
      type: column.type
    };
  });
  assertUniqueIds(columns, `${path}.columns`);
  if (!Array.isArray(value.rows)) throw new Error(`${path}.rows must be an array.`);
  if (value.rows.length > MAX_ARTIFACT_ANALYSIS_TABLE_ROWS) throw new Error(`${path}.rows contains too many entries.`);
  const rows = value.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error(`${path}.rows[${rowIndex}] must align one-to-one with columns.`);
    return row.map((cell, cellIndex) => {
      if (cell !== null && typeof cell !== "string" && typeof cell !== "number" && typeof cell !== "boolean") {
        throw new Error(`${path}.rows[${rowIndex}][${cellIndex}] must be a JSON primitive.`);
      }
      return normalizeJsonValue(cell, `${path}.rows[${rowIndex}][${cellIndex}]`, budget, /* @__PURE__ */ new WeakSet(), 0);
    });
  });
  return { columns, rows };
}
function normalizeData(kind, value, path, budget, context) {
  if (kind === "primer_design") return normalizePrimerDesignData(value, path, budget, context);
  if (kind === "pcr") return normalizePcrData(value, path, budget, context);
  if (kind === "assembly_plan") return normalizeAssemblyData(value, path, budget);
  if (kind === "blast_search") return normalizeBlastData(value, path, budget);
  if (kind === "structure_model") return normalizeStructureData(value, path, budget);
  if (kind === "report") return normalizeReportData(value, path, budget);
  return normalizeTableData(value, path, budget);
}
function normalizeResult(value, index, budget, context) {
  const path = `analysisResults[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  assertKnownKeys(value, ["id", "kind", "name", "status", "summary", "inputRecordIds", "inputSha256s", "dependsOnResultIds", "assetIds", "parameters", "data", "createdAt", "provenance"], path);
  if (!ANALYSIS_KIND_SET.has(value.kind)) throw new Error(`${path}.kind is not supported.`);
  if (!STATUS_SET.has(value.status)) throw new Error(`${path}.status must be "complete", "partial", or "failed".`);
  const kind = value.kind;
  const inputRecordIds = normalizeStringArray(value.inputRecordIds, `${path}.inputRecordIds`, MAX_ARTIFACT_ANALYSIS_RECORD_IDS, budget, { required: true, deduplicate: true });
  const inputSha256s = value.inputSha256s === void 0 ? void 0 : Array.isArray(value.inputSha256s) ? value.inputSha256s.map((sha, shaIndex) => normalizeSha256(sha, `${path}.inputSha256s[${shaIndex}]`, budget)) : (() => {
    throw new Error(`${path}.inputSha256s must be an array.`);
  })();
  if (inputSha256s && inputSha256s.length !== inputRecordIds.length) throw new Error(`${path}.inputSha256s must align one-to-one with inputRecordIds.`);
  if (context.recordLengths) {
    inputRecordIds.forEach((recordId, recordIndex) => {
      if (!context.recordLengths?.has(recordId)) throw new Error(`${path}.inputRecordIds[${recordIndex}] does not match a workspace record.`);
    });
  }
  const dependsOnResultIds = normalizeStringArray(value.dependsOnResultIds, `${path}.dependsOnResultIds`, MAX_ARTIFACT_ANALYSIS_DEPENDENCIES, budget, { deduplicate: true });
  const assetIds = normalizeStringArray(value.assetIds, `${path}.assetIds`, MAX_ARTIFACT_ANALYSIS_ASSET_IDS, budget, { deduplicate: true });
  const summary = value.summary === void 0 ? void 0 : boundedString(value.summary, `${path}.summary`, MAX_ARTIFACT_ANALYSIS_SUMMARY_LENGTH, budget, { trim: false });
  const base = {
    id: normalizeId(value.id, `${path}.id`, budget),
    kind,
    name: boundedString(value.name, `${path}.name`, MAX_ARTIFACT_ANALYSIS_NAME_LENGTH, budget),
    status: value.status,
    ...summary === void 0 ? {} : { summary },
    inputRecordIds,
    ...inputSha256s === void 0 ? {} : { inputSha256s },
    dependsOnResultIds,
    assetIds,
    parameters: normalizeJsonObject(value.parameters ?? {}, `${path}.parameters`, budget),
    data: normalizeData(kind, value.data, `${path}.data`, budget, context),
    createdAt: normalizeTimestamp(value.createdAt, `${path}.createdAt`, budget),
    provenance: normalizeProvenance(value.provenance, `${path}.provenance`, budget)
  };
  return base;
}
function assertUniqueIds(values, path) {
  const ids = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${path} contains duplicate id "${value.id}".`);
    ids.add(value.id);
  }
}
function resultRecordIds(result) {
  const ids = [...result.inputRecordIds];
  if (result.kind === "primer_design") ids.push(result.data.targetRecordId);
  if (result.kind === "pcr") {
    ids.push(result.data.templateRecordId);
    result.data.products.forEach((product) => {
      if (product.recordId) ids.push(product.recordId);
    });
  }
  if (result.kind === "assembly_plan") {
    ids.push(...result.data.orderedPartRecordIds);
    if (result.data.destinationRecordId) ids.push(result.data.destinationRecordId);
    if (result.data.productRecordId) ids.push(result.data.productRecordId);
    result.data.junctions?.forEach((junction) => ids.push(junction.leftRecordId, junction.rightRecordId));
  }
  if (result.kind === "blast_search") ids.push(result.data.queryRecordId);
  if (result.kind === "structure_model") result.data.chains.forEach((chain) => {
    if (chain.recordId) ids.push(chain.recordId);
  });
  return Array.from(new Set(ids));
}
function resultAssetIds(result) {
  const ids = [...result.assetIds];
  if (result.kind === "blast_search") result.data.hits.forEach((hit) => {
    if (hit.alignmentAssetId) ids.push(hit.alignmentAssetId);
  });
  if (result.kind === "structure_model") ids.push(result.data.modelAssetId);
  if (result.kind === "report" && result.data.bodyAssetId) ids.push(result.data.bodyAssetId);
  return Array.from(new Set(ids));
}
function resultDependencyIds(result) {
  const ids = [...result.dependsOnResultIds];
  if (result.kind === "pcr" && result.data.primerDesignResultId) ids.push(result.data.primerDesignResultId);
  return Array.from(new Set(ids));
}
function validateDependencies(workspace, context) {
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
    if (result.kind === "structure_model") {
      const asset = workspace.analysisAssets.find((candidate) => candidate.id === result.data.modelAssetId);
      const allowed = result.data.format === "pdb" ? ["chemical/x-pdb", "text/plain"] : ["chemical/x-cif", "chemical/x-mmcif", "text/plain"];
      if (asset && !allowed.includes(asset.mediaType)) throw new Error(`Analysis result "${result.id}" model asset mediaType does not match ${result.data.format}.`);
    }
  }
  assertAcyclicResultDependencies(workspace.analysisResults);
}
function assertAcyclicResultDependencies(results) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Analysis result dependencies contain a cycle at "${id}".`);
    visiting.add(id);
    const result = byId.get(id);
    resultDependencyIds(result).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  results.forEach((result) => visit(result.id));
}
function normalizeArtifactAnalysisWorkspace(value, context = {}) {
  if (value === void 0 || value === null) return { analysisResults: [], analysisAssets: [] };
  if (!isPlainObject(value)) throw new Error("Analysis workspace must be an object.");
  assertKnownKeys(value, ["analysisResults", "analysisAssets"], "analysis workspace");
  const rawResults = value.analysisResults ?? [];
  const rawAssets = value.analysisAssets ?? [];
  if (!Array.isArray(rawResults)) throw new Error("analysisResults must be an array.");
  if (!Array.isArray(rawAssets)) throw new Error("analysisAssets must be an array.");
  if (rawResults.length > MAX_ARTIFACT_ANALYSIS_RESULTS) throw new Error(`analysisResults cannot contain more than ${MAX_ARTIFACT_ANALYSIS_RESULTS.toLocaleString()} entries.`);
  if (rawAssets.length > MAX_ARTIFACT_ANALYSIS_ASSETS) throw new Error(`analysisAssets cannot contain more than ${MAX_ARTIFACT_ANALYSIS_ASSETS.toLocaleString()} entries.`);
  const budget = { nodes: 0, textCharacters: 0, assetBytes: 0 };
  const workspace = {
    analysisResults: rawResults.map((result, index) => normalizeResult(result, index, budget, context)),
    analysisAssets: rawAssets.map((asset, index) => normalizeAsset(asset, index, budget))
  };
  assertUniqueIds(workspace.analysisResults, "analysisResults");
  assertUniqueIds(workspace.analysisAssets, "analysisAssets");
  validateDependencies(workspace, context);
  return workspace;
}
function cloneArtifactAnalysisWorkspace(value, context = {}) {
  return normalizeArtifactAnalysisWorkspace(value, context);
}
function serializeArtifactAnalysisWorkspace(value, context = {}) {
  const normalized = normalizeArtifactAnalysisWorkspace(value, context);
  return {
    ...normalized.analysisResults.length === 0 ? {} : { analysisResults: normalized.analysisResults },
    ...normalized.analysisAssets.length === 0 ? {} : { analysisAssets: normalized.analysisAssets }
  };
}
function appendArtifactAnalysisAsset(value, asset, context = {}) {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  return normalizeArtifactAnalysisWorkspace({ ...workspace, analysisAssets: [...workspace.analysisAssets, asset] }, context);
}
function appendArtifactAnalysisWorkspaceResult(value, result, context = {}) {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  return normalizeArtifactAnalysisWorkspace({ ...workspace, analysisResults: [...workspace.analysisResults, result] }, context);
}
function getArtifactAnalysisResultDependents(value, resultId) {
  const workspace = normalizeArtifactAnalysisWorkspace(value);
  if (!workspace.analysisResults.some((result) => result.id === resultId)) throw new Error(`Analysis result "${resultId}" does not exist.`);
  return workspace.analysisResults.filter((result) => resultDependencyIds(result).includes(resultId)).map((result) => result.id);
}
function getArtifactAnalysisAssetDependents(value, assetId) {
  const workspace = normalizeArtifactAnalysisWorkspace(value);
  if (!workspace.analysisAssets.some((asset) => asset.id === assetId)) throw new Error(`Analysis asset "${assetId}" does not exist.`);
  return workspace.analysisResults.filter((result) => resultAssetIds(result).includes(assetId)).map((result) => result.id);
}
function getArtifactAnalysisRecordDependents(value, recordId) {
  const workspace = normalizeArtifactAnalysisWorkspace(value);
  return workspace.analysisResults.filter((result) => resultRecordIds(result).includes(recordId)).map((result) => result.id);
}
function removeArtifactAnalysisWorkspaceResult(value, resultId, context = {}) {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  if (!workspace.analysisResults.some((result) => result.id === resultId)) throw new Error(`Analysis result "${resultId}" does not exist.`);
  const dependents = workspace.analysisResults.filter((result) => resultDependencyIds(result).includes(resultId));
  if (dependents.length > 0) throw new Error(`Analysis result "${resultId}" is required by ${dependents.map((result) => `"${result.id}"`).join(", ")}.`);
  return normalizeArtifactAnalysisWorkspace({ ...workspace, analysisResults: workspace.analysisResults.filter((result) => result.id !== resultId) }, context);
}
function normalizeArtifactAnalysisResults(value, context = {}) {
  const { analysisAssets = [], ...analysisContext } = context;
  return normalizeArtifactAnalysisWorkspace({ analysisResults: value ?? [], analysisAssets }, analysisContext).analysisResults;
}
function appendArtifactAnalysisResult(analysisResults, result, context = {}) {
  const { analysisAssets = [], ...analysisContext } = context;
  return normalizeArtifactAnalysisWorkspace({
    analysisResults: [...normalizeArtifactAnalysisResults(analysisResults, context), result],
    analysisAssets
  }, analysisContext).analysisResults;
}
function removeArtifactAnalysisResult(analysisResults, resultId, context = {}) {
  const { analysisAssets = [], ...analysisContext } = context;
  return removeArtifactAnalysisWorkspaceResult({
    analysisResults,
    analysisAssets
  }, resultId, analysisContext).analysisResults;
}
function getArtifactAnalysisResultsSnapshot(analysisResults, context = {}) {
  return normalizeArtifactAnalysisResults(analysisResults, context);
}
function removeArtifactAnalysisAsset(value, assetId, context = {}) {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  if (!workspace.analysisAssets.some((asset) => asset.id === assetId)) throw new Error(`Analysis asset "${assetId}" does not exist.`);
  const dependents = workspace.analysisResults.filter((result) => resultAssetIds(result).includes(assetId));
  if (dependents.length > 0) throw new Error(`Analysis asset "${assetId}" is required by ${dependents.map((result) => `"${result.id}"`).join(", ")}.`);
  return normalizeArtifactAnalysisWorkspace({ ...workspace, analysisAssets: workspace.analysisAssets.filter((asset) => asset.id !== assetId) }, context);
}
function collectResultCascade(results, initialIds) {
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
function removeArtifactAnalysisResultCascade(value, resultId, options = {}, context = {}) {
  const workspace = normalizeArtifactAnalysisWorkspace(value, context);
  if (!workspace.analysisResults.some((result) => result.id === resultId)) throw new Error(`Analysis result "${resultId}" does not exist.`);
  const removedIds = collectResultCascade(workspace.analysisResults, [resultId]);
  const keptResults = workspace.analysisResults.filter((result) => !removedIds.has(result.id));
  const removedAssetIds = new Set(workspace.analysisResults.filter((result) => removedIds.has(result.id)).flatMap(resultAssetIds));
  const keptAssetIds = new Set(keptResults.flatMap(resultAssetIds));
  const keptAssets = options.removeOrphanAssets ? workspace.analysisAssets.filter((asset) => !removedAssetIds.has(asset.id) || keptAssetIds.has(asset.id)) : workspace.analysisAssets;
  return normalizeArtifactAnalysisWorkspace({ analysisResults: keptResults, analysisAssets: keptAssets }, context);
}
function removeArtifactAnalysisResultsForRecord(value, recordId, options = {}) {
  const workspace = normalizeArtifactAnalysisWorkspace(value);
  const directIds = workspace.analysisResults.filter((result) => resultRecordIds(result).includes(recordId)).map((result) => result.id);
  if (directIds.length === 0) return workspace;
  const removedIds = collectResultCascade(workspace.analysisResults, directIds);
  const keptResults = workspace.analysisResults.filter((result) => !removedIds.has(result.id));
  const removedAssetIds = new Set(workspace.analysisResults.filter((result) => removedIds.has(result.id)).flatMap(resultAssetIds));
  const keptAssetIds = new Set(keptResults.flatMap(resultAssetIds));
  const keptAssets = options.removeOrphanAssets ? workspace.analysisAssets.filter((asset) => !removedAssetIds.has(asset.id) || keptAssetIds.has(asset.id)) : workspace.analysisAssets;
  return normalizeArtifactAnalysisWorkspace({ analysisResults: keptResults, analysisAssets: keptAssets });
}
export {
  ARTIFACT_ANALYSIS_ASSET_MEDIA_TYPES,
  ARTIFACT_ANALYSIS_KINDS,
  MAX_ARTIFACT_ANALYSIS_ARRAY_ENTRIES,
  MAX_ARTIFACT_ANALYSIS_ASSETS,
  MAX_ARTIFACT_ANALYSIS_ASSET_BYTES,
  MAX_ARTIFACT_ANALYSIS_ASSET_IDS,
  MAX_ARTIFACT_ANALYSIS_DEPENDENCIES,
  MAX_ARTIFACT_ANALYSIS_DEPTH,
  MAX_ARTIFACT_ANALYSIS_ID_LENGTH,
  MAX_ARTIFACT_ANALYSIS_NAME_LENGTH,
  MAX_ARTIFACT_ANALYSIS_RECORD_IDS,
  MAX_ARTIFACT_ANALYSIS_RESULTS,
  MAX_ARTIFACT_ANALYSIS_STRUCTURED_NODES,
  MAX_ARTIFACT_ANALYSIS_SUMMARY_LENGTH,
  MAX_ARTIFACT_ANALYSIS_TABLE_COLUMNS,
  MAX_ARTIFACT_ANALYSIS_TABLE_ROWS,
  MAX_ARTIFACT_ANALYSIS_TEXT_CHARACTERS,
  MAX_ARTIFACT_ANALYSIS_TOTAL_ASSET_BYTES,
  appendArtifactAnalysisAsset,
  appendArtifactAnalysisResult,
  appendArtifactAnalysisWorkspaceResult,
  cloneArtifactAnalysisWorkspace,
  getArtifactAnalysisAssetDependents,
  getArtifactAnalysisRecordDependents,
  getArtifactAnalysisResultDependents,
  getArtifactAnalysisResultsSnapshot,
  normalizeArtifactAnalysisResults,
  normalizeArtifactAnalysisWorkspace,
  removeArtifactAnalysisAsset,
  removeArtifactAnalysisResult,
  removeArtifactAnalysisResultCascade,
  removeArtifactAnalysisResultsForRecord,
  removeArtifactAnalysisWorkspaceResult,
  serializeArtifactAnalysisWorkspace
};
