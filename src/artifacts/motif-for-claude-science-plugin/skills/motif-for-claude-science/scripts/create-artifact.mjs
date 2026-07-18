#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_ARTIFACT_ANALYSIS_ASSETS,
  MAX_ARTIFACT_ANALYSIS_ASSET_BYTES,
  MAX_ARTIFACT_ANALYSIS_RESULTS,
  MAX_ARTIFACT_ANALYSIS_TOTAL_ASSET_BYTES,
  normalizeArtifactAnalysisWorkspace,
} from './analysis-validator.mjs';
import { normalizeArtifactWorkspaceEnvelope } from './workspace-validator.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const skillDirectory = resolve(dirname(scriptPath), '..');
const bundledArtifactPath = resolve(
  skillDirectory,
  'resources',
  'motif-artifact.html',
);
export const MAX_RECORD_LENGTH = 250_000;
export const MAX_RECORDS = 100;
export const MAX_FEATURES_PER_RECORD = 2_000;
export const MAX_SUBRANGES_PER_FEATURE = 2_000;
export const MAX_SITES_PER_RECORD = 2_048;
export const MAX_HITS_PER_SITE = 10_000;
export const MAX_TOTAL_HITS_PER_RECORD = 50_000;
export const MAX_TAGS_PER_RECORD = 100;
export const MAX_SHORT_TEXT_LENGTH = 1_024;
export const MAX_DESCRIPTION_LENGTH = 16_384;
export const MAX_TAG_LENGTH = 256;
export const MAX_OVERHANG_LENGTH = 64;
export const MAX_RAW_SEQUENCE_CHARACTERS = 1_000_000;
export const MAX_METADATA_JSON_DEPTH = 16;
export const MAX_METADATA_JSON_NODES = 10_000;
export const MAX_METADATA_JSON_BYTES = 1_048_576;
export const MAX_PAYLOAD_JSON_NODES = 250_000;
export const MAX_PAYLOAD_JSON_BYTES = 33_554_432;
export const MAX_ALIGNMENTS = 50;
export const MAX_ALIGNMENT_ROWS = 100;
export const MAX_ALIGNMENT_COLUMNS = 50_000;
export const MAX_ALIGNMENT_CELLS = 2_000_000;
export const MAX_TOTAL_ALIGNMENT_CELLS = 4_000_000;
export const MAX_ALIGNMENT_TEXT_CHARACTERS = 2_250_000;
export const MAX_ANALYSIS_RESULTS = MAX_ARTIFACT_ANALYSIS_RESULTS;
export const MAX_ANALYSIS_ASSETS = MAX_ARTIFACT_ANALYSIS_ASSETS;
export const MAX_ANALYSIS_ASSET_BYTES = MAX_ARTIFACT_ANALYSIS_ASSET_BYTES;
export const MAX_TOTAL_ANALYSIS_ASSET_BYTES = MAX_ARTIFACT_ANALYSIS_TOTAL_ASSET_BYTES;
export const MAX_SANGER_BASE_CALLS = 100_000;
export const MAX_SANGER_TRACE_SAMPLES_PER_CHANNEL = 500_000;
export const MAX_SANGER_TRACE_SAMPLES_PER_RECORD = 2_000_000;
export const MAX_SANGER_TRACE_SAMPLES_PER_WORKSPACE = 4_000_000;
export const MAX_SANGER_WARNINGS = 100;
export const MAX_SANGER_WARNING_LENGTH = 1_024;
const SANGER_TRACE_SCHEMA = 'motif.sanger-trace.v1';
const SANGER_BASES = ['A', 'C', 'G', 'T'];
const SANGER_CHANNEL_TAGS = new Set(['DATA9', 'DATA10', 'DATA11', 'DATA12']);
const FEATURE_TYPES = new Set([
  'orf', 'gene', 'cds', 'promoter', 'terminator', 'rbs', 'origin', 'resistance',
  'restriction_site', 'primer_bind', 'misc_feature', 'mrna', 'rrna', 'trna', 'ncrna',
  'regulatory', 'repeat_region', 'sig_peptide', 'mat_peptide', 'transit_peptide',
  'intron', 'exon', 'polya_signal', 'enhancer', 'custom',
]);
const SAFE_FEATURE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\)|[a-z]+)$/i;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ALIGNMENT_MODES = new Set(['browser', 'local-command', 'imported']);
const SUPPORTED_INVENTORY_SCHEMAS = new Set([
  'motif.claude-science.inventory.v1',
  'motif.claude-science.inventory.v2',
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const METADATA_JSON_LIMITS = {
  maxDepth: MAX_METADATA_JSON_DEPTH,
  maxNodes: MAX_METADATA_JSON_NODES,
  maxBytes: MAX_METADATA_JSON_BYTES,
  maxStringLength: MAX_DESCRIPTION_LENGTH,
};
const PAYLOAD_JSON_LIMITS = {
  maxDepth: MAX_METADATA_JSON_DEPTH + 5,
  maxNodes: MAX_PAYLOAD_JSON_NODES,
  maxBytes: MAX_PAYLOAD_JSON_BYTES,
};

function jsonEncodedByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function validateJsonValue(value, path, limits = METADATA_JSON_LIMITS, seen = new WeakSet(), depth = 0, budget = { nodes: 0, bytes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > limits.maxNodes) throw new Error(`${path} exceeds the maximum of ${limits.maxNodes.toLocaleString()} JSON nodes`);
  if (depth > limits.maxDepth) throw new Error(`${path} exceeds the maximum supported nesting depth of ${limits.maxDepth}`);
  if (value === null) {
    budget.bytes += 4;
  } else if (typeof value === 'string') {
    if (limits.maxStringLength !== undefined && value.length > limits.maxStringLength) {
      throw new Error(`${path} exceeds the maximum string length of ${limits.maxStringLength.toLocaleString()} characters`);
    }
    budget.bytes += jsonEncodedByteLength(value);
  } else if (typeof value === 'boolean') {
    budget.bytes += value ? 4 : 5;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must not contain NaN or Infinity`);
    budget.bytes += String(value).length;
  } else {
    if (typeof value !== 'object') throw new Error(`${path} must contain JSON-compatible values only`);
    if (seen.has(value)) throw new Error(`${path} must not contain circular references`);
    if (!Array.isArray(value) && !isPlainObject(value)) throw new Error(`${path} must contain plain JSON objects only`);
    seen.add(value);
    budget.bytes += 2;
    let entryCount = 0;
    for (const [key, item] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
      if (!Array.isArray(value)) {
        if (UNSAFE_OBJECT_KEYS.has(String(key))) throw new Error(`${path}.${String(key)} is not an allowed object key`);
        if (String(key).length > MAX_SHORT_TEXT_LENGTH) {
          throw new Error(`${path} contains an object key longer than ${MAX_SHORT_TEXT_LENGTH.toLocaleString()} characters`);
        }
        budget.bytes += jsonEncodedByteLength(String(key)) + 1;
      }
      if (entryCount > 0) budget.bytes += 1;
      entryCount += 1;
      validateJsonValue(item, `${path}.${String(key)}`, limits, seen, depth + 1, budget);
    }
    seen.delete(value);
  }
  if (budget.bytes > limits.maxBytes) {
    throw new Error(`${path} exceeds the maximum serialized size of ${Math.floor(limits.maxBytes / 1_048_576).toLocaleString()} MiB`);
  }
}

function validateOptionalString(object, field, path, maxLength = MAX_SHORT_TEXT_LENGTH) {
  if (object[field] !== undefined && typeof object[field] !== 'string') {
    throw new Error(`${path}.${field} must be a string when provided`);
  }
  if (typeof object[field] === 'string' && object[field].length > maxLength) {
    throw new Error(`${path}.${field} cannot exceed ${maxLength.toLocaleString()} characters`);
  }
}

function normalizedRecordType(value, sequence) {
  if (['dna', 'rna', 'protein', 'misc', 'unknown', 'mixed'].includes(value)) return value;
  const normalized = typeof sequence === 'string' ? sequence.toUpperCase().replace(/[^A-Z*]/g, '') : '';
  if (normalized.includes('*')) return 'protein';
  if (/^[ACGTUNRYSWKMBDHV]+$/.test(normalized)) {
    return normalized.includes('U') && !normalized.includes('T') ? 'rna' : 'dna';
  }
  return 'protein';
}

function validateRecordOverhangs(record, path, recordType) {
  for (const field of ['overhang5', 'overhang3']) {
    const value = record[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error(`${path}.${field} must be a DNA string when provided`);
    if (value.length > MAX_OVERHANG_LENGTH) {
      throw new Error(`${path}.${field} cannot exceed ${MAX_OVERHANG_LENGTH.toLocaleString()} bases`);
    }
    if (!/^[ACGTRYSWKMBDHVN]*$/.test(value.toUpperCase().replace(/\s+/g, ''))) {
      throw new Error(`${path}.${field} must contain DNA IUPAC bases only`);
    }
    if (recordType !== 'dna') throw new Error(`${path}.${field} is valid on DNA records only`);
  }
  for (const [sequenceField, typeField] of [
    ['overhang5', 'overhang5Type'],
    ['overhang3', 'overhang3Type'],
  ]) {
    const type = record[typeField];
    if (type === undefined) continue;
    if (!['blunt', '5prime', '3prime'].includes(type)) {
      throw new Error(`${path}.${typeField} must be blunt, 5prime, or 3prime`);
    }
    if (recordType !== 'dna') throw new Error(`${path}.${typeField} is valid on DNA records only`);
    const sequence = record[sequenceField];
    if (typeof sequence !== 'string') {
      throw new Error(`${path}.${typeField} requires a matching ${sequenceField} string`);
    }
    const compact = sequence.replace(/\s+/g, '');
    if (type === 'blunt' && compact.length > 0) {
      throw new Error(`${path}.${typeField} cannot be blunt when ${sequenceField} contains a sticky sequence`);
    }
    if (type !== 'blunt' && compact.length === 0) {
      throw new Error(`${path}.${typeField} must be blunt when ${sequenceField} is empty`);
    }
  }
}

function validateFeature(feature, path, sequenceLength) {
  if (!isPlainObject(feature)) throw new Error(`${path} must be a plain object`);
  for (const field of ['id', 'name', 'type', 'color']) validateOptionalString(feature, field, path);
  if (feature.type !== undefined && !FEATURE_TYPES.has(feature.type.trim().toLowerCase())) {
    throw new Error(`${path}.type is not a supported feature type`);
  }
  if (feature.color !== undefined && (feature.color.length > 80 || !SAFE_FEATURE_COLOR.test(feature.color.trim()))) {
    throw new Error(`${path}.color must be a simple CSS color value`);
  }
  if (!Number.isFinite(feature.start) || !Number.isFinite(feature.end)) {
    throw new Error(`${path} must have finite start and end numbers`);
  }
  if (feature.start < 0 || feature.end <= feature.start || feature.end > sequenceLength) {
    throw new Error(`${path} coordinates must satisfy 0 <= start < end <= ${sequenceLength}`);
  }
  if (feature.strand !== undefined && ![-1, 0, 1].includes(feature.strand)) {
    throw new Error(`${path}.strand must be -1, 0, or 1`);
  }
  if (feature.direction !== undefined && !['forward', 'reverse', 'none', -1, 0, 1].includes(feature.direction)) {
    throw new Error(`${path}.direction must be forward, reverse, none, -1, 0, or 1`);
  }
  if (feature.metadata !== undefined) {
    if (!isPlainObject(feature.metadata)) throw new Error(`${path}.metadata must be a plain JSON object`);
    validateJsonValue(feature.metadata, `${path}.metadata`);
  }
  if (feature.subRanges !== undefined) {
    if (!Array.isArray(feature.subRanges)) throw new Error(`${path}.subRanges must be an array`);
    if (feature.subRanges.length > MAX_SUBRANGES_PER_FEATURE) {
      throw new Error(`${path}.subRanges cannot contain more than ${MAX_SUBRANGES_PER_FEATURE.toLocaleString()} entries`);
    }
    feature.subRanges.forEach((subRange, subRangeIndex) => {
      const subRangePath = `${path}.subRanges[${subRangeIndex}]`;
      if (!isPlainObject(subRange) || !Number.isFinite(subRange.start) || !Number.isFinite(subRange.end)) {
        throw new Error(`${subRangePath} must be an object with finite start and end numbers`);
      }
      if (subRange.start < 0 || subRange.end <= subRange.start || subRange.end > sequenceLength) {
        throw new Error(`${subRangePath} coordinates must satisfy 0 <= start < end <= ${sequenceLength}`);
      }
      if (subRange.strand !== undefined && ![-1, 0, 1].includes(subRange.strand)) {
        throw new Error(`${subRangePath}.strand must be -1, 0, or 1`);
      }
    });
  }
}

function validateSites(sites, path) {
  if (!Array.isArray(sites)) throw new Error(`${path} must be an array of site objects`);
  if (sites.length > MAX_SITES_PER_RECORD) {
    throw new Error(`${path} cannot contain more than ${MAX_SITES_PER_RECORD.toLocaleString()} entries`);
  }
  let totalHits = 0;
  sites.forEach((site, siteIndex) => {
    const sitePath = `${path}[${siteIndex}]`;
    if (!isPlainObject(site)) throw new Error(`${sitePath} must be a plain object`);
    for (const field of ['enzyme', 'motif']) validateOptionalString(site, field, sitePath);
    if (site.count !== undefined && (!Number.isInteger(site.count) || site.count < 0)) {
      throw new Error(`${sitePath}.count must be a non-negative integer`);
    }
    if (site.indexBase !== undefined && ![0, 1].includes(site.indexBase)) {
      throw new Error(`${sitePath}.indexBase must be 0 or 1`);
    }
    if (site.overhang !== undefined && !['blunt', '5prime', '3prime'].includes(site.overhang)) {
      throw new Error(`${sitePath}.overhang must be blunt, 5prime, or 3prime`);
    }
    if (site.hits !== undefined) {
      if (!Array.isArray(site.hits)) throw new Error(`${sitePath}.hits must be an array`);
      if (site.hits.length > MAX_HITS_PER_SITE) {
        throw new Error(`${sitePath}.hits cannot contain more than ${MAX_HITS_PER_SITE.toLocaleString()} entries`);
      }
      totalHits += site.hits.length;
      site.hits.forEach((hit, hitIndex) => {
        const hitPath = `${sitePath}.hits[${hitIndex}]`;
        if (!isPlainObject(hit)) throw new Error(`${hitPath} must be a plain object`);
        if (!Number.isFinite(hit.position) || hit.position < 0) throw new Error(`${hitPath}.position must be a non-negative finite number`);
        if (hit.cutPosition !== undefined && (!Number.isFinite(hit.cutPosition) || hit.cutPosition < 0)) {
          throw new Error(`${hitPath}.cutPosition must be a non-negative finite number`);
        }
        if (hit.strand !== undefined && ![-1, 1].includes(hit.strand)) throw new Error(`${hitPath}.strand must be -1 or 1`);
        if (hit.indexBase !== undefined && ![0, 1].includes(hit.indexBase)) throw new Error(`${hitPath}.indexBase must be 0 or 1`);
      });
    }
  });
  if (totalHits > MAX_TOTAL_HITS_PER_RECORD) {
    throw new Error(`${path} cannot contain more than ${MAX_TOTAL_HITS_PER_RECORD.toLocaleString()} hits in total`);
  }
}

function validateBoundedIntegerArray(value, path, maxLength, minimum, maximum) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > maxLength) throw new Error(`${path} cannot contain more than ${maxLength.toLocaleString()} values`);
  value.forEach((entry, index) => {
    if (!Number.isInteger(entry) || entry < minimum || entry > maximum) {
      throw new Error(`${path}[${index}] must be an integer between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}`);
    }
  });
}

function validateSangerTrace(trace, path, recordSequence, recordType) {
  if (!isPlainObject(trace)) throw new Error(`${path} must be a plain object`);
  if (recordType !== 'dna' && recordType !== undefined) throw new Error(`${path} can only belong to a DNA record`);
  if (trace.schema !== SANGER_TRACE_SCHEMA || trace.version !== 1) {
    throw new Error(`${path} must use ${SANGER_TRACE_SCHEMA} version 1`);
  }
  if (typeof trace.baseCalls !== 'string' || typeof trace.sequence !== 'string') {
    throw new Error(`${path}.baseCalls and ${path}.sequence must be strings`);
  }
  const calls = trace.baseCalls.toUpperCase();
  const normalizedRecord = recordSequence.toUpperCase().replace(/[^A-Z]/g, '');
  if (!calls || calls.length > MAX_SANGER_BASE_CALLS || !/^[ACGTRYSWKMBDHVN]+$/.test(calls)) {
    throw new Error(`${path}.baseCalls must contain bounded IUPAC DNA calls`);
  }
  if (trace.sequence.toUpperCase() !== calls || normalizedRecord !== calls) {
    throw new Error(`${path} calls must exactly match the owning record sequence`);
  }
  validateBoundedIntegerArray(trace.qualityScores, `${path}.qualityScores`, MAX_SANGER_BASE_CALLS, 0, 255);
  validateBoundedIntegerArray(trace.peakPositions, `${path}.peakPositions`, MAX_SANGER_BASE_CALLS, 0, 2_147_483_647);
  if (!isPlainObject(trace.channels)) throw new Error(`${path}.channels must contain A, C, G, and T arrays`);
  let sampleEntries = 0;
  let sampleCount = 0;
  for (const base of SANGER_BASES) {
    validateBoundedIntegerArray(
      trace.channels[base],
      `${path}.channels.${base}`,
      MAX_SANGER_TRACE_SAMPLES_PER_CHANNEL,
      -32_768,
      32_767,
    );
    sampleEntries += trace.channels[base].length;
    sampleCount = Math.max(sampleCount, trace.channels[base].length);
  }
  if (sampleEntries > MAX_SANGER_TRACE_SAMPLES_PER_RECORD) {
    throw new Error(`${path}.channels cannot contain more than ${MAX_SANGER_TRACE_SAMPLES_PER_RECORD.toLocaleString()} sample entries`);
  }
  if (trace.sampleCount !== sampleCount) throw new Error(`${path}.sampleCount must equal the longest decoded channel`);
  if (trace.dyeOrder !== null && (typeof trace.dyeOrder !== 'string' || !/^[ACGT]{4}$/.test(trace.dyeOrder) || new Set(trace.dyeOrder).size !== 4)) {
    throw new Error(`${path}.dyeOrder must be an A/C/G/T permutation or null`);
  }
  if (trace.storedReverseComplement !== null && typeof trace.storedReverseComplement !== 'boolean') {
    throw new Error(`${path}.storedReverseComplement must be boolean or null`);
  }
  if (!Array.isArray(trace.warnings) || trace.warnings.length > MAX_SANGER_WARNINGS) {
    throw new Error(`${path}.warnings cannot contain more than ${MAX_SANGER_WARNINGS} entries`);
  }
  trace.warnings.forEach((warning, index) => {
    if (typeof warning !== 'string' || warning.length > MAX_SANGER_WARNING_LENGTH) {
      throw new Error(`${path}.warnings[${index}] must be a bounded string`);
    }
  });
  if (!isPlainObject(trace.metadata) || trace.metadata.format !== 'ABIF') {
    throw new Error(`${path}.metadata must describe an ABIF source`);
  }
  if (!Number.isInteger(trace.metadata.abifVersion) || trace.metadata.abifVersion < 0 || trace.metadata.abifVersion > 65_535) {
    throw new Error(`${path}.metadata.abifVersion must be a 16-bit non-negative integer`);
  }
  if (!['PBAS2', 'PBAS1'].includes(trace.metadata.baseCallsTag)) throw new Error(`${path}.metadata.baseCallsTag must be PBAS2 or PBAS1`);
  if (trace.metadata.qualityScoresTag !== null && !['PCON2', 'PCON1'].includes(trace.metadata.qualityScoresTag)) {
    throw new Error(`${path}.metadata.qualityScoresTag must be PCON2, PCON1, or null`);
  }
  if (trace.metadata.peakPositionsTag !== null && !['PLOC2', 'PLOC1'].includes(trace.metadata.peakPositionsTag)) {
    throw new Error(`${path}.metadata.peakPositionsTag must be PLOC2, PLOC1, or null`);
  }
  if (!isPlainObject(trace.metadata.channelTags)) throw new Error(`${path}.metadata.channelTags must be a plain object`);
  for (const base of SANGER_BASES) {
    const tag = trace.metadata.channelTags[base];
    if (tag !== undefined && !SANGER_CHANNEL_TAGS.has(tag)) throw new Error(`${path}.metadata.channelTags.${base} must be DATA9–DATA12`);
  }
  for (const field of ['sampleName', 'sampleWell', 'instrumentModel', 'dyeSetName', 'dataCollectionSoftwareVersion', 'basecallerVersion']) {
    if (trace.metadata[field] !== undefined && (typeof trace.metadata[field] !== 'string' || trace.metadata[field].length > 4_096)) {
      throw new Error(`${path}.metadata.${field} must be a string no longer than 4,096 characters`);
    }
  }
  return sampleEntries;
}

function usage() {
  return `Create a user-owned Motif HTML artifact from the plugin resource.

Usage:
  node create-artifact.mjs --out <html> [--payload <json|->] [--force]

Options:
  --out <html>       Required output path.
  --payload <json|-> Optional inventory/alignment payload file, or - for standard input.
  --force            Replace an existing output file.
  --help             Show this help.
`;
}

export function parseArgs(args) {
  const options = { outPath: null, payloadPath: null, force: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--out' || arg === '--payload') {
      const value = args[index + 1];
      if (!value || (value.startsWith('--') && value !== '-')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      if (arg === '--out') options.outPath = value;
      else options.payloadPath = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export function jsonForScriptTag(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function injectPayload(html, payload) {
  const pattern = /(<script type="application\/json" id="motif-artifact-data">)([\s\S]*?)(<\/script>)/;
  if (!pattern.test(html)) throw new Error('Bundled artifact is missing its inventory data marker');
  const payloadJson = jsonForScriptTag(payload);
  return html.replace(
    pattern,
    (_match, openTag, _existingPayload, closeTag) => `${openTag}${payloadJson}${closeTag}`,
  );
}

function looksLikeImplicitProteinSequence(rawSequence) {
  const trimmed = rawSequence.trim();
  if (!trimmed || /[a-z]/.test(trimmed)) return false;
  return !/[A-Z*][\t ]+[A-Z*]/.test(trimmed);
}

function isValidSequence(sequence, sequenceTypeHint) {
  if (typeof sequence !== 'string') return false;
  const normalized = sequence.toUpperCase().replace(/[^A-Z*]/g, '');
  const withoutStops = normalized.replace(/\*/g, '');
  if (!normalized) return false;
  if (sequenceTypeHint === 'dna') return /^[ACGTRYSWKMBDHVN]+$/.test(withoutStops);
  if (sequenceTypeHint === 'rna') return /^[ACGURYSWKMBDHVN]+$/.test(withoutStops);
  if (sequenceTypeHint === 'protein') return /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]+$/.test(normalized);
  if (normalized.includes('*')) return /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]+$/.test(normalized);
  if (/^[ACGTUNRYSWKMBDHV]+$/.test(withoutStops)) return true;
  return /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ]+$/.test(withoutStops)
    && looksLikeImplicitProteinSequence(sequence);
}

function normalizedSequenceLength(sequence, sequenceTypeHint) {
  if (typeof sequence !== 'string') return 0;
  const normalized = sequence.toUpperCase().replace(/[^A-Z*]/g, '');
  return sequenceTypeHint === 'dna' || sequenceTypeHint === 'rna'
    ? normalized.replace(/\*/g, '').length
    : normalized.length;
}

function normalizedRecordIdText(value) {
  if (typeof value !== 'string') return null;
  const normalized = Array.from(value).filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join('').trim();
  return normalized || null;
}

function uniqueRuntimeRecordId(base, usedIds) {
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
  throw new Error(`Payload record id ${base} has too many collisions`);
}

function payloadRecords(payload) {
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.vectors)) return payload.vectors;
  if (payload.record && typeof payload.record === 'object' && !Array.isArray(payload.record)) return [payload.record];
  if (typeof payload.seq === 'string' || typeof payload.sequence === 'string') return [payload];
  return [];
}

function omitTraceArraysForGenericJsonValidation(payload) {
  const stripRecord = (record) => {
    if (!isPlainObject(record) || record.sangerTrace === undefined) return record;
    return {
      ...record,
      sangerTrace: isPlainObject(record.sangerTrace)
        ? { schema: record.sangerTrace.schema, version: record.sangerTrace.version }
        : record.sangerTrace,
    };
  };
  const projected = { ...payload };
  const hasRecordContainer = ['records', 'entries', 'vectors', 'record'].some((field) => (
    Object.prototype.hasOwnProperty.call(projected, field)
  ));
  if (!hasRecordContainer
    && (typeof projected.seq === 'string' || typeof projected.sequence === 'string')) {
    return stripRecord(projected);
  }
  for (const field of ['records', 'entries', 'vectors']) {
    if (Array.isArray(projected[field])) projected[field] = projected[field].map(stripRecord);
  }
  if (projected.record !== undefined) projected.record = stripRecord(projected.record);
  return projected;
}

function alignmentId(value, fallback) {
  return (typeof value === 'string' && value.trim() ? value.trim() : fallback).replace(/\s+/g, '-');
}

function cleanAlignedSequence(value, path) {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  if (value.length > MAX_ALIGNMENT_TEXT_CHARACTERS) {
    throw new Error(`${path} cannot exceed ${MAX_ALIGNMENT_TEXT_CHARACTERS.toLocaleString()} raw characters`);
  }
  return value.toUpperCase().replace(/\./g, '-').replace(/\s+/g, '');
}

function hasUnsafeHeaderCharacter(value) {
  return Array.from(value).some((symbol) => {
    const code = symbol.charCodeAt(0);
    return symbol === '>' || code < 32 || code === 127 || code === 0x2028 || code === 0x2029;
  });
}

function validateAlignmentHeader(value, path) {
  if (hasUnsafeHeaderCharacter(value)) {
    throw new Error(`${path} cannot contain FASTA header markers, line breaks, or control characters`);
  }
}

function parseAlignedFasta(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must contain non-empty aligned FASTA`);
  if (value.length > MAX_ALIGNMENT_TEXT_CHARACTERS) {
    throw new Error(`${path} cannot exceed ${MAX_ALIGNMENT_TEXT_CHARACTERS.toLocaleString()} characters`);
  }
  const rows = [];
  let current = null;
  for (const rawLine of value.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('>')) {
      const name = line.slice(1).trim();
      if (!name) throw new Error(`${path} contains an empty FASTA header`);
      current = { name, aligned: '' };
      rows.push(current);
      if (rows.length > MAX_ALIGNMENT_ROWS) {
        throw new Error(`${path} cannot contain more than ${MAX_ALIGNMENT_ROWS.toLocaleString()} rows`);
      }
      continue;
    }
    if (!current) throw new Error(`${path} must begin with a >header line`);
    current.aligned += line;
    if (current.aligned.length > MAX_ALIGNMENT_COLUMNS) {
      throw new Error(`${path} cannot contain more than ${MAX_ALIGNMENT_COLUMNS.toLocaleString()} columns`);
    }
  }
  return rows;
}

function validAlignmentAlphabet(sequence, molecule) {
  if (molecule === 'dna') return /^[ACGTRYSWKMBDHVN?\-]+$/.test(sequence);
  if (molecule === 'rna') return /^[ACGURYSWKMBDHVN?\-]+$/.test(sequence);
  return /^[A-Z*?\-]+$/.test(sequence);
}

function validateAlignmentEngine(engine, path) {
  if (engine === undefined) return;
  if (typeof engine === 'string') {
    if (!engine.trim()) throw new Error(`${path} must not be empty`);
    if (engine.length > MAX_SHORT_TEXT_LENGTH) {
      throw new Error(`${path} cannot exceed ${MAX_SHORT_TEXT_LENGTH.toLocaleString()} characters`);
    }
    return;
  }
  if (!isPlainObject(engine)) throw new Error(`${path} must be a string or a plain object`);
  for (const field of ['id', 'label', 'version']) validateOptionalString(engine, field, path);
  if (engine.mode !== undefined && !ALIGNMENT_MODES.has(engine.mode)) {
    throw new Error(`${path}.mode must be browser, local-command, or imported`);
  }
  if (engine.parameters !== undefined) {
    if (!Array.isArray(engine.parameters) || engine.parameters.some((parameter) => typeof parameter !== 'string')) {
      throw new Error(`${path}.parameters must be an array of strings`);
    }
    engine.parameters.forEach((parameter, parameterIndex) => {
      if (parameter.length > MAX_SHORT_TEXT_LENGTH) {
        throw new Error(`${path}.parameters[${parameterIndex}] cannot exceed ${MAX_SHORT_TEXT_LENGTH.toLocaleString()} characters`);
      }
    });
  }
  if (engine.usedFallback !== undefined && typeof engine.usedFallback !== 'boolean') {
    throw new Error(`${path}.usedFallback must be a boolean when provided`);
  }
}

function validateAlignment(alignment, index, remainingCells = MAX_ALIGNMENT_CELLS) {
  const path = `Payload alignment ${index + 1}`;
  if (!isPlainObject(alignment)) throw new Error(`${path} must be a plain object`);
  for (const field of ['id', 'name', 'referenceRowId', 'createdAt', 'outputSha256', 'note']) {
    validateOptionalString(alignment, field, path);
  }
  for (const field of ['molecule', 'type']) {
    if (alignment[field] !== undefined && !['dna', 'rna', 'protein'].includes(alignment[field])) {
      throw new Error(`${path}.${field} must be dna, rna, or protein`);
    }
  }
  if (alignment.molecule !== undefined && alignment.type !== undefined && alignment.molecule !== alignment.type) {
    throw new Error(`${path}.molecule and type must agree`);
  }
  if (alignment.molecule === undefined && alignment.type === undefined) {
    throw new Error(`${path}.molecule or type is required because aligned symbols alone cannot distinguish every nucleotide sequence from protein`);
  }
  if (typeof alignment.name === 'string') validateAlignmentHeader(alignment.name, `${path}.name`);
  if (alignment.rows !== undefined && !Array.isArray(alignment.rows)) {
    throw new Error(`${path}.rows must be an array`);
  }
  if (alignment.sequences !== undefined && !Array.isArray(alignment.sequences)) {
    throw new Error(`${path}.sequences must be an array`);
  }
  if (alignment.alignedFasta !== undefined && typeof alignment.alignedFasta !== 'string') {
    throw new Error(`${path}.alignedFasta must be a string`);
  }

  const rawRows = typeof alignment.alignedFasta === 'string'
    ? parseAlignedFasta(alignment.alignedFasta, `${path}.alignedFasta`)
    : Array.isArray(alignment.rows)
      ? alignment.rows
      : Array.isArray(alignment.sequences)
        ? alignment.sequences
        : [];
  if (rawRows.length < 2) throw new Error(`${path} must contain at least 2 aligned rows`);
  if (rawRows.length > MAX_ALIGNMENT_ROWS) {
    throw new Error(`${path} cannot contain more than ${MAX_ALIGNMENT_ROWS.toLocaleString()} rows`);
  }

  const seenRowIds = new Set();
  const seenRowNames = new Set();
  const rows = rawRows.map((row, rowIndex) => {
    const rowPath = `${path}.rows[${rowIndex}]`;
    if (!isPlainObject(row)) throw new Error(`${rowPath} must be a plain object`);
    for (const field of ['id', 'name', 'sourceRecordId', 'inputSha256']) {
      validateOptionalString(row, field, rowPath);
    }
    const id = alignmentId(row.id, `row-${rowIndex + 1}`);
    if (seenRowIds.has(id)) throw new Error(`${path} row ids must be unique; ${id} appears more than once`);
    seenRowIds.add(id);
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : `Sequence ${rowIndex + 1}`;
    validateAlignmentHeader(name, `${rowPath}.name`);
    const nameKey = name.toLocaleLowerCase();
    if (seenRowNames.has(nameKey)) throw new Error(`${path} row names must be unique; ${name} appears more than once`);
    seenRowNames.add(nameKey);
    const aligned = cleanAlignedSequence(row.aligned ?? row.sequence, `${rowPath}.aligned`);
    if (!aligned) throw new Error(`${rowPath}.aligned must not be empty`);
    if (!aligned.replace(/-/g, '')) throw new Error(`${rowPath}.aligned cannot contain gaps only`);
    if (aligned.length > MAX_ALIGNMENT_COLUMNS) {
      throw new Error(`${path} cannot contain more than ${MAX_ALIGNMENT_COLUMNS.toLocaleString()} columns`);
    }
    if (rawRows.length * aligned.length > Math.min(MAX_ALIGNMENT_CELLS, remainingCells)) {
      throw new Error(
        remainingCells < MAX_ALIGNMENT_CELLS
          ? `Payload alignments cannot contain more than ${MAX_TOTAL_ALIGNMENT_CELLS.toLocaleString()} row-columns in total`
          : `${path} cannot contain more than ${MAX_ALIGNMENT_CELLS.toLocaleString()} row-columns`,
      );
    }
    return aligned;
  });

  const columns = rows[0].length;
  if (columns > MAX_ALIGNMENT_COLUMNS) {
    throw new Error(`${path} cannot contain more than ${MAX_ALIGNMENT_COLUMNS.toLocaleString()} columns`);
  }
  if (rows.some((row) => row.length !== columns)) {
    throw new Error(`${path} rows must all have exactly the same aligned length`);
  }
  const cells = rows.length * columns;
  if (cells > MAX_ALIGNMENT_CELLS) {
    throw new Error(`${path} cannot contain more than ${MAX_ALIGNMENT_CELLS.toLocaleString()} row-columns`);
  }
  if (cells > remainingCells) {
    throw new Error(`Payload alignments cannot contain more than ${MAX_TOTAL_ALIGNMENT_CELLS.toLocaleString()} row-columns in total`);
  }
  const molecule = alignment.molecule ?? alignment.type;
  rows.forEach((row, rowIndex) => {
    if (!validAlignmentAlphabet(row, molecule)) {
      throw new Error(`${path}.rows[${rowIndex}].aligned contains symbols that are not valid for ${molecule.toUpperCase()}`);
    }
  });
  if (alignment.referenceRowId !== undefined && !seenRowIds.has(alignmentId(alignment.referenceRowId, ''))) {
    throw new Error(`${path}.referenceRowId must match one of the aligned row ids`);
  }
  validateAlignmentEngine(alignment.engine, `${path}.engine`);
  return { id: alignmentId(alignment.id, `alignment-${index + 1}`), cells };
}

function validateAlignments(payload) {
  if (payload.alignment !== undefined && !isPlainObject(payload.alignment)) {
    throw new Error('Payload.alignment must be a plain object');
  }
  if (payload.alignments !== undefined && !Array.isArray(payload.alignments)) {
    throw new Error('Payload.alignments must be an array');
  }
  if (payload.alignment !== undefined && payload.alignments !== undefined) {
    throw new Error('Payload must provide either alignment or alignments, not both');
  }
  const alignments = payload.alignments ?? (payload.alignment === undefined ? [] : [payload.alignment]);
  if (alignments.length > MAX_ALIGNMENTS) {
    throw new Error(`Payload cannot contain more than ${MAX_ALIGNMENTS.toLocaleString()} alignments`);
  }
  const ids = new Set();
  let totalCells = 0;
  alignments.forEach((alignment, index) => {
    const validated = validateAlignment(
      alignment,
      index,
      Math.min(MAX_ALIGNMENT_CELLS, MAX_TOTAL_ALIGNMENT_CELLS - totalCells),
    );
    if (ids.has(validated.id)) {
      throw new Error(`Payload alignment ids must be unique; ${validated.id} appears more than once`);
    }
    ids.add(validated.id);
    totalCells += validated.cells;
  });
}

function activeExplicitRecordLengths(payload) {
  const records = payloadRecords(payload);
  const recordLengths = new Map();
  const explicitIds = new Set();
  const usedIds = new Set();
  records.forEach((record, index) => {
    if (!isPlainObject(record)) return;
    const explicitId = normalizedRecordIdText(record.id);
    if (explicitId && explicitIds.has(explicitId)) throw new Error(`Payload records contain duplicate id ${explicitId}`);
    if (explicitId) explicitIds.add(explicitId);
    const id = uniqueRuntimeRecordId(
      explicitId ?? normalizedRecordIdText(record.name) ?? `record-${index + 1}`,
      usedIds,
    );
    if (record.active === false) return;
    recordLengths.set(id, normalizedSequenceLength(record.seq ?? record.sequence, record.molecule ?? record.type));
  });
  return recordLengths;
}

function validateWorkspaceEnvelope(payload, recordLengths) {
  try {
    normalizeArtifactWorkspaceEnvelope(payload, recordLengths);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Payload workspace is invalid: ${detail}`);
  }
}

function validateAnalysisCollections(payload, recordLengths) {
  try {
    normalizeArtifactAnalysisWorkspace({
      analysisResults: payload.analysisResults ?? [],
      analysisAssets: payload.analysisAssets ?? [],
    }, { recordLengths });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Payload analysis workspace is invalid: ${detail}`);
  }
}

export function validatePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error('Payload must be a JSON object');
  }

  for (const field of ['records', 'entries', 'vectors']) {
    if (field in payload && !Array.isArray(payload[field])) {
      throw new Error(`Payload ${field} must be an array`);
    }
  }
  if ('record' in payload && (!payload.record || typeof payload.record !== 'object' || Array.isArray(payload.record))) {
    throw new Error('Payload record must be an object');
  }
  const recordContainers = ['records', 'entries', 'vectors', 'record'].filter((field) => field in payload);
  const isBareRecord = recordContainers.length === 0
    && (typeof payload.seq === 'string' || typeof payload.sequence === 'string');
  const hasWorkspaceSidecar = ['alignment', 'alignments', 'notes', 'workflowResults', 'analysisResults', 'analysisAssets', 'artifactState']
    .some((field) => field in payload);
  if (recordContainers.length === 0 && !isBareRecord && !hasWorkspaceSidecar) {
    throw new Error('Payload must contain records, a bare sequence record, or a supported workspace sidecar');
  }
  if (recordContainers.length > 1) {
    throw new Error(`Payload has ambiguous record containers: ${recordContainers.join(', ')}`);
  }
  for (const field of ['schema', 'selectedRecordId', 'selectedName', 'defaultMotif', 'motif']) {
    validateOptionalString(payload, field, 'Payload');
  }
  if (typeof payload.schema === 'string'
    && payload.schema.startsWith('motif.claude-science.inventory.')
    && !SUPPORTED_INVENTORY_SCHEMAS.has(payload.schema)) {
    throw new Error(`Unsupported Motif inventory schema: ${payload.schema}`);
  }
  if (payload.selectedIndex !== undefined && !Number.isInteger(payload.selectedIndex)) {
    throw new Error('Payload.selectedIndex must be an integer when provided');
  }
  if (payload.inventory !== undefined) {
    if (!isPlainObject(payload.inventory)) throw new Error('Payload.inventory must be a plain object');
    for (const field of ['id', 'title', 'description', 'updatedAt']) {
      validateOptionalString(
        payload.inventory,
        field,
        'Payload.inventory',
        field === 'description' ? MAX_DESCRIPTION_LENGTH : MAX_SHORT_TEXT_LENGTH,
      );
    }
  }

  const records = payloadRecords(payload);
  if (records.length > MAX_RECORDS) {
    throw new Error(`Payload cannot contain more than ${MAX_RECORDS.toLocaleString()} records`);
  }
  let totalSangerTraceSamples = 0;
  records.forEach((record, index) => {
    const recordPath = `Payload record ${index + 1}`;
    if (!isPlainObject(record)) {
      throw new Error(`Payload record ${index + 1} must be an object`);
    }
    if (record.truncated) {
      throw new Error(`Payload record ${index + 1} is marked as truncated; provide the complete record`);
    }
    const sequence = record.seq ?? record.sequence;
    const type = record.molecule ?? record.type;
    if (typeof sequence === 'string' && sequence.length > MAX_RAW_SEQUENCE_CHARACTERS) {
      throw new Error(`${recordPath}.sequence cannot exceed ${MAX_RAW_SEQUENCE_CHARACTERS.toLocaleString()} raw characters`);
    }
    if (!isValidSequence(sequence, type)) {
      throw new Error(`Payload record ${index + 1} does not contain a valid DNA, RNA, or sequence-like protein value`);
    }
    const length = normalizedSequenceLength(sequence, type);
    if (length > MAX_RECORD_LENGTH) {
      throw new Error(`${recordPath} contains ${length.toLocaleString()} residues; the artifact supports at most ${MAX_RECORD_LENGTH.toLocaleString()} per record`);
    }
    if (record.type !== undefined && !['dna', 'rna', 'protein', 'misc', 'unknown', 'mixed'].includes(record.type)) {
      throw new Error(`${recordPath}.type is not a supported sequence type`);
    }
    if (record.molecule !== undefined && !['dna', 'rna', 'protein', 'misc', 'unknown', 'mixed'].includes(record.molecule)) {
      throw new Error(`${recordPath}.molecule is not a supported sequence type`);
    }
    if (record.topology !== undefined && !['linear', 'circular'].includes(record.topology)) {
      throw new Error(`${recordPath}.topology must be linear or circular`);
    }
    validateRecordOverhangs(record, recordPath, normalizedRecordType(type, sequence));
    for (const field of ['id', 'name', 'description', 'organism', 'source', 'group', 'project', 'folder', 'collection', 'dateAdded']) {
      validateOptionalString(
        record,
        field,
        recordPath,
        field === 'description' ? MAX_DESCRIPTION_LENGTH : MAX_SHORT_TEXT_LENGTH,
      );
    }
    for (const field of ['active', 'default']) {
      if (record[field] !== undefined && typeof record[field] !== 'boolean') {
        throw new Error(`${recordPath}.${field} must be a boolean when provided`);
      }
    }
    if (record.tags !== undefined) {
      if (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== 'string')) {
        throw new Error(`${recordPath}.tags must be an array of strings`);
      }
      if (record.tags.length > MAX_TAGS_PER_RECORD) {
        throw new Error(`${recordPath}.tags cannot contain more than ${MAX_TAGS_PER_RECORD.toLocaleString()} entries`);
      }
      record.tags.forEach((tag, tagIndex) => {
        if (tag.length > MAX_TAG_LENGTH) {
          throw new Error(`${recordPath}.tags[${tagIndex}] cannot exceed ${MAX_TAG_LENGTH.toLocaleString()} characters`);
        }
      });
    }
    const featureCount = ['annotations', 'features'].reduce((count, field) => (
      count + (Array.isArray(record[field]) ? record[field].length : 0)
    ), 0);
    if (featureCount > MAX_FEATURES_PER_RECORD) {
      throw new Error(`${recordPath}.features cannot contain more than ${MAX_FEATURES_PER_RECORD.toLocaleString()} annotations and features in total`);
    }
    for (const field of ['annotations', 'features']) {
      if (record[field] === undefined) continue;
      if (!Array.isArray(record[field])) throw new Error(`${recordPath}.${field} must be an array of feature objects`);
      record[field].forEach((feature, featureIndex) => validateFeature(feature, `${recordPath}.${field}[${featureIndex}]`, length));
    }
    if (record.sites !== undefined) validateSites(record.sites, `${recordPath}.sites`);
    if (record.provenance !== undefined) {
      if (!isPlainObject(record.provenance)) throw new Error(`${recordPath}.provenance must be a plain JSON object`);
      validateJsonValue(record.provenance, `${recordPath}.provenance`);
    }
    if (record.sangerTrace !== undefined) {
      totalSangerTraceSamples += validateSangerTrace(
        record.sangerTrace,
        `${recordPath}.sangerTrace`,
        sequence,
        normalizedRecordType(type, sequence),
      );
      if (totalSangerTraceSamples > MAX_SANGER_TRACE_SAMPLES_PER_WORKSPACE) {
        throw new Error(`Payload chromatograms cannot contain more than ${MAX_SANGER_TRACE_SAMPLES_PER_WORKSPACE.toLocaleString()} channel sample entries in total`);
      }
    }
  });
  if (records.length > 0 && records.every((record) => record.active === false)) {
    throw new Error('A non-empty payload must contain at least one active record');
  }

  const recordLengths = activeExplicitRecordLengths(payload);
  validateAlignments(payload);
  validateWorkspaceEnvelope(payload, recordLengths);
  validateAnalysisCollections(payload, recordLengths);

  // Trace arrays have their own stricter cardinality/range validation above.
  // Exclude those already-bounded numeric leaves from the generic metadata node
  // budget so a normal multi-read Sanger plate is not rejected as arbitrary JSON.
  validateJsonValue(omitTraceArraysForGenericJsonValidation(payload), 'Payload', PAYLOAD_JSON_LIMITS);

  return payload;
}

export function readAndValidatePayload(source) {
  try {
    if (Buffer.byteLength(source, 'utf8') > MAX_PAYLOAD_JSON_BYTES) {
      throw new Error('serialized input exceeds the artifact maximum of 32 MiB');
    }
    return validatePayload(JSON.parse(source));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid payload: ${detail}`);
  }
}

function readStdin() {
  return readFileSync(0, 'utf8');
}

export function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.outPath) throw new Error('--out is required');
  if (!existsSync(bundledArtifactPath)) {
    throw new Error(`Bundled artifact resource is missing: ${bundledArtifactPath}`);
  }

  const outPath = resolve(options.outPath);
  if (existsSync(outPath) && !options.force) {
    throw new Error(`Output already exists; pass --force to replace it: ${outPath}`);
  }

  let html = readFileSync(bundledArtifactPath, 'utf8');
  if (options.payloadPath) {
    const source = options.payloadPath === '-'
      ? readStdin()
      : readFileSync(resolve(options.payloadPath), 'utf8');
    const payload = readAndValidatePayload(source);
    html = injectPayload(html, payload);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const temporaryPath = `${outPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, html, { flag: 'wx' });
    if (options.force) rmSync(outPath, { force: true });
    renameSync(temporaryPath, outPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }

  const digest = createHash('sha256').update(html).digest('hex');
  console.log(`Wrote ${outPath}`);
  console.log(`SHA-256 ${digest}`);
}

function moduleIsMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(scriptPath);
  } catch {
    return false;
  }
}

const isMain = moduleIsMain();

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
