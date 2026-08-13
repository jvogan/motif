import type { CodonTable, Feature, RestrictionEnzyme } from './types';
import { RESTRICTION_ENZYMES } from './restriction-sites';
import { reverseComplement } from './reverse-complement';
import { getAminoAcidToCodons, resolveTranslationTable } from './codon-tables';
import { featureLocationSegments } from './feature-location';
import { translateCompleteCds } from './translate';
import {
  materializeTranslationExceptions,
  type TranslationException,
  type TranslationExceptionDiagnostic,
  type TranslationExceptionReceipt,
} from './transl-except';
import {
  MAX_FEATURES_PER_COLLECTION,
  MAX_FEATURE_VALIDATION_WORK_UNITS,
  MAX_SUBRANGES_PER_FEATURE,
  validateFeatureCollection,
} from './feature-bounds';
import {
  aliasRemovedProductCoordinates,
  emptySourceToProductMap,
  mapFeaturesThroughSourceCoordinates,
  type SourceToProductCoordinateMap,
} from './assembly-feature-mapping';
import { inspectNucleotideSequence } from './nucleotide';

export interface GoldenGatePart {
  id?: string;
  name: string;
  sequence: string;
  features?: Feature[];
}

export type GoldenGateNormalizationDiagnosticCode =
  | 'invalid_input'
  | 'formatting_normalized'
  | 'formatting_with_features'
  | 'invalid_character'
  | 'ambiguous_base'
  | 'unsupported_enzyme'
  | 'input_limit'
  | 'site_limit';

export interface GoldenGateNormalizationDiagnostic {
  code: GoldenGateNormalizationDiagnosticCode;
  partName?: string;
  partId?: string;
  message: string;
  characters?: string[];
}

export interface GoldenGateNormalizationProvenance {
  engine: 'motif-golden-gate';
  engineVersion: '2';
  parts: Array<{
    name: string;
    id?: string;
    sourceLength: number;
    normalizedLength: number;
    formattingNormalized: boolean;
  }>;
}

export interface GoldenGateSiteScanResult {
  sequence: string;
  enzyme: string;
  sites: GoldenGateSite[];
  /** False when the result was stopped before all sites could be inspected. */
  complete: boolean;
  diagnostics: GoldenGateNormalizationDiagnostic[];
  provenance: GoldenGateNormalizationProvenance;
}

export interface GoldenGateSite {
  /** 0-indexed start of the recognition sequence in the sequence */
  position: number;
  enzyme: string;
  strand: 1 | -1;
  /** Position where the cut occurs */
  cutPosition: number;
  /** 4 bp overhang produced by this cut */
  overhang: string;
}

export interface FindGoldenGateSitesOptions {
  /**
   * Report recognition sites even when the Type IIS overhang window is outside
   * the provided sequence. Internal-site checks and CDS domestication care
   * about the recognition sequence itself, including near sequence boundaries.
   */
  includeOutOfBounds?: boolean;
}

export interface GoldenGatePartBoundary {
  valid: boolean;
  enzyme: string;
  leftOverhang: string | null;
  rightOverhang: string | null;
  rightOverhangComplement: string | null;
  insertStart: number | null;
  insertEnd: number | null;
  siteCount: number;
  internalSiteCount: number;
  errors: string[];
  normalizationDiagnostics?: GoldenGateNormalizationDiagnostic[];
  provenance?: GoldenGateNormalizationProvenance;
}

export interface GoldenGateResult {
  sequence: string;
  features: Feature[];
  parts: string[];
  partIds?: string[];
  overhangs: string[];
  enzyme: string;
  topology: 'linear' | 'circular';
  /** Explicit outcome so callers can distinguish an invalid input from a bounded search. */
  status: GoldenGateAssemblyStatus;
  success: boolean;
  errors: string[];
  warnings: string[];
  normalizationDiagnostics?: GoldenGateNormalizationDiagnostic[];
  provenance?: GoldenGateNormalizationProvenance;
  /**
   * Populated when a unique part-ordering exists but its endpoints do not
   * close to a circle. The caller can ligate a destination vector backbone
   * whose digestion exposes `left` (matching the tail) and `right` (matching
   * the head) to complete the assembly.
   */
  missingVectorOverhangs?: { left: string; right: string };
}

export type GoldenGateAssemblyStatus = 'ready' | 'ambiguous' | 'invalid_input' | 'work_limit';

export interface GoldenGateInputValidation {
  status: 'valid' | 'invalid_input' | 'work_limit';
  valid: boolean;
  errors: string[];
  totalLength: number;
  featureWorkUnits: number;
}

export interface OverhangValidation {
  valid: boolean;
  overhangs: string[];
  issues: Array<{
    type: 'duplicate' | 'palindromic' | 'near_identical' | 'open_chain' | 'preparation';
    overhangs: string[];
    description: string;
  }>;
  /** When the open-chain issue is reported, the overhangs a vector must expose. */
  missingVectorOverhangs?: { left: string; right: string };
  normalizationDiagnostics?: GoldenGateNormalizationDiagnostic[];
  provenance?: GoldenGateNormalizationProvenance;
}

const DEFAULT_ENZYME = 'BsaI';
// SapI and BspQI are isoschizomers (GCTCTTC, N1^NNN) yielding 3-nt 5' overhangs.
// They are used by systems such as Loop Assembly; GoldenBraid instead alternates
// BsaI and BsmBI/Esp3I with 4-nt overhangs. The shared assembly path supports both.
export const GOLDEN_GATE_ENZYME_NAMES = ['BsaI', 'BbsI', 'BsmBI', 'Esp3I', 'SapI', 'BspQI'] as const;
export type GoldenGateEnzymeName = typeof GOLDEN_GATE_ENZYME_NAMES[number];
// De-color sweep: part spans use the muted steel-blue feature hue; junctions
// use the muted clay/terracotta hue (matching --feature-terminator light).
const PRODUCT_PART_SPAN_COLOR = '#7E9BBF';
const PRODUCT_JUNCTION_COLOR = '#8F4842';
const GOLDEN_GATE_EXTRA_ENZYMES: RestrictionEnzyme[] = [
  { name: 'BsmBI', recognitionSequence: 'CGTCTC', cutOffset: 7, complementCutOffset: 11, overhang: '5prime' },
  { name: 'Esp3I', recognitionSequence: 'CGTCTC', cutOffset: 7, complementCutOffset: 11, overhang: '5prime' },
  // SapI / BspQI: GCTCTTC(1/4) — 7-bp recognition, top cut +1, bottom cut +4 → 3-nt overhang
  { name: 'SapI',  recognitionSequence: 'GCTCTTC', cutOffset: 8, complementCutOffset: 11, overhang: '5prime' },
  { name: 'BspQI', recognitionSequence: 'GCTCTTC', cutOffset: 8, complementCutOffset: 11, overhang: '5prime' },
];
const GOLDEN_GATE_ENZYME_NAME_SET = new Set(GOLDEN_GATE_ENZYME_NAMES.map((name) => name.toLowerCase()));

/** Hard limits for direct callers. The artifact adapter applies narrower limits. */
export const MAX_GOLDEN_GATE_PARTS = 64;
export const MAX_GOLDEN_GATE_PART_LENGTH = 500_000;
export const MAX_GOLDEN_GATE_TOTAL_INPUT_LENGTH = 1_000_000;
export const MAX_GOLDEN_GATE_FEATURES_PER_PART = MAX_FEATURES_PER_COLLECTION;
export const MAX_GOLDEN_GATE_SUBRANGES_PER_FEATURE = MAX_SUBRANGES_PER_FEATURE;
export const MAX_GOLDEN_GATE_FEATURE_WORK_UNITS = MAX_FEATURE_VALIDATION_WORK_UNITS;
export const MAX_GOLDEN_GATE_DETECTED_SITES = 10_000;
export const MAX_GOLDEN_GATE_TOTAL_DETECTED_SITES = 100_000;
export const MAX_GOLDEN_GATE_CHAIN_WORK_UNITS = 100_000;

function goldenGateIsPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

const INVALID_GOLDEN_GATE_ACCESSOR = Symbol('invalid-golden-gate-accessor');

function goldenGateOwnDataValue(record: Record<string, unknown>, key: string): unknown | typeof INVALID_GOLDEN_GATE_ACCESSOR {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return undefined;
    return 'value' in descriptor ? descriptor.value : INVALID_GOLDEN_GATE_ACCESSOR;
  } catch {
    return INVALID_GOLDEN_GATE_ACCESSOR;
  }
}

function goldenGateHasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function goldenGateBoundedText(value: unknown, label: string, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || goldenGateHasControlCharacters(value)) {
    return `${label} must be a non-empty string of at most ${maxLength} characters without control characters.`;
  }
  if (value.trim().length === 0) return `${label} must contain a non-whitespace name.`;
  return null;
}

interface GoldenGatePartSnapshot {
  part: GoldenGatePart | null;
  errors: string[];
}

/**
 * Snapshot a part using only own data properties.  The biological engines are
 * exported to JavaScript and agent callers, so a TypeScript cast is not an
 * adequate boundary: accessors and inherited values must never run while a
 * failed input is being converted into a receipt.
 */
function snapshotGoldenGatePart(value: unknown, index = 0): GoldenGatePartSnapshot {
  const label = `Golden Gate part ${index + 1}`;
  if (!goldenGateIsPlainObject(value)) {
    return { part: null, errors: [`${label} must be a plain object.`] };
  }
  const record = value as Record<string, unknown>;
  const name = goldenGateOwnDataValue(record, 'name');
  const id = goldenGateOwnDataValue(record, 'id');
  const sequence = goldenGateOwnDataValue(record, 'sequence');
  const features = goldenGateOwnDataValue(record, 'features');
  if ([name, id, sequence, features].some((field) => field === INVALID_GOLDEN_GATE_ACCESSOR)) {
    return { part: null, errors: [`${label} fields must be data properties, not accessors.`] };
  }
  const errors: string[] = [];
  const nameError = goldenGateBoundedText(name, `${label}.name`, 256);
  if (nameError) errors.push(nameError);
  if (id !== undefined) {
    const idError = goldenGateBoundedText(id, `${label}.id`, 256);
    if (idError) errors.push(idError);
  }
  if (typeof sequence !== 'string') {
    errors.push(`${label}.sequence must be a DNA string.`);
  } else {
    if (sequence.length === 0) errors.push(`${label}.sequence must not be empty.`);
    if (sequence.length > MAX_GOLDEN_GATE_PART_LENGTH) {
      errors.push(`${label}.sequence exceeds ${MAX_GOLDEN_GATE_PART_LENGTH.toLocaleString()} bp.`);
    }
  }
  if (features !== undefined && !Array.isArray(features)) {
    errors.push(`${label}.features must be an array when provided.`);
  }
  if (errors.length > 0 || typeof name !== 'string' || typeof sequence !== 'string') {
    return { part: null, errors };
  }
  return {
    part: {
      name,
      ...(typeof id === 'string' ? { id } : {}),
      sequence,
      ...(Array.isArray(features) ? { features: features as Feature[] } : {}),
    },
    errors: [],
  };
}

interface GoldenGatePartsArraySnapshot {
  values: unknown[];
  length: number;
  tooMany: boolean;
  error?: string;
}

/** Read only a bounded dense prefix of a caller-provided parts array. */
function snapshotGoldenGatePartsArray(value: unknown): GoldenGatePartsArraySnapshot {
  if (!Array.isArray(value)) return { values: [], length: 0, tooMany: false, error: 'Golden Gate parts must be an array.' };
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  } catch {
    return { values: [], length: 0, tooMany: false, error: 'Golden Gate parts length could not be inspected as data.' };
  }
  if (!lengthDescriptor || !('value' in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    return { values: [], length: 0, tooMany: false, error: 'Golden Gate parts length must be a bounded data value.' };
  }
  const length = lengthDescriptor.value as number;
  const tooMany = length > MAX_GOLDEN_GATE_PARTS;
  const values: unknown[] = [];
  for (let index = 0; index < Math.min(length, MAX_GOLDEN_GATE_PARTS); index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      return { values, length, tooMany, error: `Golden Gate part ${index + 1} could not be inspected as data.` };
    }
    if (!descriptor || !('value' in descriptor)) {
      return { values, length, tooMany, error: `Golden Gate part ${index + 1} must be an own data entry.` };
    }
    values.push(descriptor.value);
  }
  return { values, length, tooMany };
}

function boundedGoldenGateEnzymeLabel(value: unknown): string {
  if (typeof value !== 'string') return '<invalid enzyme value>';
  return value.length > 256 ? `${value.slice(0, 256)}…` : value;
}

/** Validate bounded Golden Gate inputs before sequence/site/feature work starts. */
export function validateGoldenGateParts(parts: unknown): GoldenGateInputValidation {
  const errors: string[] = [];
  let hardLimit = false;
  const snapshot = snapshotGoldenGatePartsArray(parts);
  if (snapshot.error) {
    return { status: 'invalid_input', valid: false, errors: [snapshot.error], totalLength: 0, featureWorkUnits: 0 };
  }
  if (snapshot.tooMany) {
    errors.push(`Golden Gate assembly supports at most ${MAX_GOLDEN_GATE_PARTS} parts.`);
    hardLimit = true;
  }
  let totalLength = 0;
  let featureWorkUnits = 0;
  const boundedParts = snapshot.values;
  for (const [index, rawPart] of boundedParts.entries()) {
    const snapshot = snapshotGoldenGatePart(rawPart, index);
    errors.push(...snapshot.errors);
    if (snapshot.errors.some((error) => /exceeds .*bp/u.test(error))) hardLimit = true;
    if (!snapshot.part) {
      continue;
    }
    const part = snapshot.part;
    const partLabel = `Golden Gate part ${index + 1}`;
    if (part.sequence.length === 0) errors.push(`${partLabel}.sequence must not be empty.`);
    if (part.sequence.length > MAX_GOLDEN_GATE_PART_LENGTH) {
      errors.push(`${partLabel}.sequence exceeds ${MAX_GOLDEN_GATE_PART_LENGTH.toLocaleString()} bp.`);
      hardLimit = true;
    }
    if (totalLength <= MAX_GOLDEN_GATE_TOTAL_INPUT_LENGTH - part.sequence.length) totalLength += part.sequence.length;
    else {
      totalLength = MAX_GOLDEN_GATE_TOTAL_INPUT_LENGTH + 1;
      errors.push(`Golden Gate assembly input exceeds ${MAX_GOLDEN_GATE_TOTAL_INPUT_LENGTH.toLocaleString()} bp in total.`);
      hardLimit = true;
    }
    if (part.features !== undefined) {
      const remainingFeatureWork = MAX_GOLDEN_GATE_FEATURE_WORK_UNITS - featureWorkUnits;
      if (remainingFeatureWork <= 0) {
        errors.push(`Golden Gate feature validation exceeds the ${MAX_GOLDEN_GATE_FEATURE_WORK_UNITS.toLocaleString()}-unit safety limit across all parts.`);
        hardLimit = true;
        break;
      }
      const validation = validateFeatureCollection(part.features, {
        label: `${partLabel}.features`,
        sequenceLength: part.sequence.length,
        maxFeatures: MAX_GOLDEN_GATE_FEATURES_PER_PART,
        maxSubrangesPerFeature: MAX_GOLDEN_GATE_SUBRANGES_PER_FEATURE,
        maxWorkUnits: remainingFeatureWork,
      });
      featureWorkUnits = Math.min(
        MAX_GOLDEN_GATE_FEATURE_WORK_UNITS + 1,
        featureWorkUnits + validation.featureWorkUnits,
      );
      errors.push(...validation.issues.map((issue) => issue.message));
      if (validation.issues.some((issue) => (
        issue.code === 'feature_limit'
        || issue.code === 'subrange_limit'
        || issue.code === 'metadata_limit'
        || issue.code === 'feature_work_limit'
      ))) {
        hardLimit = true;
      }
      if (featureWorkUnits > MAX_GOLDEN_GATE_FEATURE_WORK_UNITS) {
        errors.push(`Golden Gate feature validation exceeds the ${MAX_GOLDEN_GATE_FEATURE_WORK_UNITS.toLocaleString()}-unit safety limit across all parts.`);
        hardLimit = true;
        break;
      }
    }
  }
  if (snapshot.tooMany) totalLength = Math.max(totalLength, MAX_GOLDEN_GATE_TOTAL_INPUT_LENGTH + 1);
  const status = errors.length === 0 ? 'valid' : hardLimit ? 'work_limit' : 'invalid_input';
  return { status, valid: errors.length === 0, errors, totalLength, featureWorkUnits };
}

function goldenGateResultPartNames(parts: unknown): string[] {
  const snapshot = snapshotGoldenGatePartsArray(parts);
  if (snapshot.error) return [];
  const names: string[] = [];
  for (let index = 0; index < snapshot.values.length; index += 1) {
    const part = snapshotGoldenGatePart(snapshot.values[index], index);
    names.push(part.part?.name ?? `part-${index + 1}`);
  }
  if (snapshot.tooMany) names.push(`… ${snapshot.length - MAX_GOLDEN_GATE_PARTS} additional part(s) omitted`);
  return names;
}

/**
 * Type IIS enzymes can produce different overhang lengths (4 bp for BsaI-family,
 * 3 bp for SapI/BspQI). Derive the length from the gap between the top-strand
 * and bottom-strand cuts so callers don't have to special-case each enzyme.
 */
function overhangLengthFor(enz: RestrictionEnzyme): number {
  return enz.complementCutOffset - enz.cutOffset;
}

function hasOverhangWindow(seq: string, start: number, overhangLength: number): boolean {
  return Number.isInteger(start) && start >= 0 && start + overhangLength <= seq.length;
}

function validateFlankCutGeometry(
  seq: string,
  leftCut: number,
  rightCutStart: number,
  overhangLength: number,
): string[] {
  const errors: string[] = [];
  if (!hasOverhangWindow(seq, leftCut, overhangLength) || !hasOverhangWindow(seq, rightCutStart, overhangLength)) {
    errors.push('Type IIS cut geometry falls outside sequence bounds');
  }
  if (rightCutStart < leftCut + overhangLength) {
    errors.push('Type IIS flanks are too close or overlapping');
  }
  return errors;
}

function unsupportedEnzymeError(enzymeName: string): string {
  return `Unsupported Golden Gate enzyme "${boundedGoldenGateEnzymeLabel(enzymeName)}". Supported enzymes: ${GOLDEN_GATE_ENZYME_NAMES.join(', ')}.`;
}

/**
 * Look up a supported Golden Gate Type IIS enzyme by name.
 */
function getEnzyme(enzymeName: string): RestrictionEnzyme | null {
  if (typeof enzymeName !== 'string') return null;
  const normalized = enzymeName.trim().toLowerCase();
  if (!GOLDEN_GATE_ENZYME_NAME_SET.has(normalized)) return null;
  return (
    RESTRICTION_ENZYMES.find((e) => e.name.toLowerCase() === normalized) ??
    GOLDEN_GATE_EXTRA_ENZYMES.find((e) => e.name.toLowerCase() === normalized) ??
    null
  );
}

/** Public lookup used by typed cloning adapters and validation clients. */
export function getGoldenGateEnzyme(enzymeName: string): RestrictionEnzyme | null {
  return getEnzyme(enzymeName);
}

function normalizeGoldenGatePart(value: unknown): {
  part: GoldenGatePart | null;
  diagnostics: GoldenGateNormalizationDiagnostic[];
  provenance: NonNullable<GoldenGateNormalizationProvenance['parts']>[number];
} {
  const snapshot = snapshotGoldenGatePart(value);
  const part = snapshot.part;
  if (!part) {
    return {
      part: null,
      diagnostics: [{
        code: 'invalid_input',
        message: snapshot.errors.join(' ') || 'Golden Gate part could not be read as bounded data.',
      }],
      provenance: {
        name: 'invalid-part',
        sourceLength: 0,
        normalizedLength: 0,
        formattingNormalized: false,
      },
    };
  }
  const inspected = inspectNucleotideSequence(part.sequence);
  const diagnostics: GoldenGateNormalizationDiagnostic[] = [];
  const sourceLength = part.sequence.length;
  const sourceWithoutWhitespace = part.sequence.replace(/\s+/g, '').toUpperCase();
  const invalidRna = sourceWithoutWhitespace.includes('U');
  if (inspected.invalidCharacters.length > 0 || invalidRna) {
    const invalidCharacters = [...new Set([
      ...inspected.invalidCharacters,
      ...(invalidRna ? ['U'] : []),
    ])];
    diagnostics.push({
      code: 'invalid_character',
      partName: part.name,
      ...(part.id ? { partId: part.id } : {}),
      characters: invalidCharacters,
      message: `Part "${part.name}" contains invalid DNA nucleotide characters: ${invalidCharacters.join(', ')}.`,
    });
  } else if (inspected.ambiguous) {
    diagnostics.push({
      code: 'ambiguous_base',
      partName: part.name,
      ...(part.id ? { partId: part.id } : {}),
      message: `Part "${part.name}" contains IUPAC ambiguity symbols; Golden Gate boundaries require canonical A/C/G/T bases.`,
    });
  }
  const formattingNormalized = inspected.sequence !== part.sequence;
  const whitespaceNormalized = part.sequence.replace(/\s+/g, '').length !== part.sequence.length;
  if (whitespaceNormalized && part.features !== undefined) {
    diagnostics.push({
      code: 'formatting_with_features',
      partName: part.name,
      ...(part.id ? { partId: part.id } : {}),
      message: `Part "${part.name}" contains features and formatting whitespace changes; reject normalization to preserve feature coordinates.`,
    });
  } else if (formattingNormalized && diagnostics.length === 0) {
    diagnostics.push({
      code: 'formatting_normalized',
      partName: part.name,
      ...(part.id ? { partId: part.id } : {}),
      message: `Part "${part.name}" was normalized by removing formatting whitespace and uppercasing bases before boundary analysis.`,
    });
  }
  return {
    part: diagnostics.some((diagnostic) => diagnostic.code !== 'formatting_normalized')
      ? null
      : { ...part, sequence: inspected.sequence },
    diagnostics,
    provenance: {
      name: part.name,
      ...(part.id ? { id: part.id } : {}),
      sourceLength,
      normalizedLength: inspected.sequence.length,
      formattingNormalized,
    },
  };
}

function normalizationProvenance(
  parts: readonly NonNullable<ReturnType<typeof normalizeGoldenGatePart>['part']>[],
  entries: GoldenGateNormalizationProvenance['parts'],
): GoldenGateNormalizationProvenance {
  return {
    engine: 'motif-golden-gate',
    engineVersion: '2',
    parts: entries.length > 0
      ? entries
      : parts.map((part) => ({
        name: part.name,
        ...(part.id ? { id: part.id } : {}),
        sourceLength: part.sequence.length,
        normalizedLength: part.sequence.length,
        formattingNormalized: false,
      })),
  };
}

function normalizationProvenanceForParts(
  entries: GoldenGateNormalizationProvenance['parts'],
): GoldenGateNormalizationProvenance {
  return normalizationProvenance([], entries);
}

/**
 * Find Type IIS recognition sites in a sequence and compute the overhangs
 * they would produce after digestion. Overhang length is per-enzyme (4 bp for
 * BsaI/BbsI/BsmBI/Esp3I, 3 bp for SapI/BspQI).
 *
 * For a sense-strand site the overhang is the bases immediately downstream of
 * the cut point (i.e. the 5' overhang on the downstream fragment).
 * For an antisense site (recognition sequence on the complement strand) the
 * enzyme reads the complement in the 5'→3' direction and cuts upstream,
 * producing an overhang that is the reverse complement of the sense-strand bases.
 */
interface GoldenGateSiteScanDetails {
  sites: GoldenGateSite[];
  complete: boolean;
}

function findGoldenGateSitesInNormalizedSequence(
  upper: string,
  enz: RestrictionEnzyme,
  options: FindGoldenGateSitesOptions = {},
): GoldenGateSiteScanDetails {
  const recog = enz.recognitionSequence.toUpperCase();
  const recogRC = reverseComplement(recog).toUpperCase();
  const overhangLength = overhangLengthFor(enz);
  const includeOutOfBounds = options.includeOutOfBounds === true;
  const sites: GoldenGateSite[] = [];
  let complete = true;
  const appendSite = (site: GoldenGateSite): boolean => {
    if (sites.length >= MAX_GOLDEN_GATE_DETECTED_SITES) {
      complete = false;
      return false;
    }
    sites.push(site);
    return true;
  };

  // Sense strand sites
  let idx = upper.indexOf(recog);
  while (idx !== -1) {
    // cutOffset is relative to the start of the recognition sequence on sense strand
    const cutPos = idx + enz.cutOffset;
    const hasWindow = hasOverhangWindow(upper, cutPos, overhangLength);
    if (hasWindow || includeOutOfBounds) {
      const overhangSeq = hasWindow ? upper.slice(cutPos, cutPos + overhangLength) : '';
      if (!appendSite({
        position: idx,
        enzyme: enz.name,
        strand: 1,
        cutPosition: cutPos,
        overhang: overhangSeq,
      })) break;
    }
    idx = upper.indexOf(recog, idx + 1);
  }

  // Antisense strand sites (recognition sequence appears as its RC on the sense strand)
  if (recogRC !== recog) {
    let ridx = upper.indexOf(recogRC);
    while (ridx !== -1) {
      // On the antisense strand the enzyme reads 5'→3' in the reverse direction.
      // complementCutOffset is the distance from the END of the recognition sequence
      // to the cut point on the sense strand (NEB convention).
      // Position on sense strand: end of RC recognition site minus complementCutOffset
      const recogEnd = ridx + recogRC.length;
      const cutPos = recogEnd - enz.complementCutOffset;
      // The overhang is upstream of the cut on the sense strand (downstream on antisense)
      const hasWindow = hasOverhangWindow(upper, cutPos, overhangLength);
      if (hasWindow || includeOutOfBounds) {
        const overhangSense = hasWindow ? upper.slice(cutPos, cutPos + overhangLength) : '';
        const overhangSeq = hasWindow ? reverseComplement(overhangSense) : '';
        if (!appendSite({
          position: ridx,
          enzyme: enz.name,
          strand: -1,
          cutPosition: cutPos,
          overhang: overhangSeq,
        })) break;
      }
      ridx = upper.indexOf(recogRC, ridx + 1);
    }
  }

  sites.sort((a, b) => a.position - b.position);
  return { sites, complete };
}

/**
 * Strict, typed Golden Gate scan boundary. Formatting whitespace and case are
 * normalized with provenance; ambiguity, invalid characters, and unsupported
 * enzyme identities fail closed with machine-readable diagnostics.
 */
export function scanGoldenGateSites(
  seq: string,
  enzyme = DEFAULT_ENZYME,
  options: FindGoldenGateSitesOptions = {},
): GoldenGateSiteScanResult {
  if (typeof seq !== 'string') {
    return {
      sequence: '',
      enzyme: boundedGoldenGateEnzymeLabel(enzyme),
      sites: [],
      complete: false,
      diagnostics: [{ code: 'input_limit', message: 'Golden Gate sequence must be a string.' }],
      provenance: normalizationProvenance([], [{ name: 'sequence', sourceLength: 0, normalizedLength: 0, formattingNormalized: false }]),
    };
  }
  if (seq.length > MAX_GOLDEN_GATE_PART_LENGTH) {
    return {
      sequence: '',
      enzyme: boundedGoldenGateEnzymeLabel(enzyme),
      sites: [],
      complete: false,
      diagnostics: [{
        code: 'input_limit',
        message: `Golden Gate sequence exceeds ${MAX_GOLDEN_GATE_PART_LENGTH.toLocaleString()} bp.`,
      }],
      provenance: normalizationProvenance([], [{ name: 'sequence', sourceLength: seq.length, normalizedLength: 0, formattingNormalized: false }]),
    };
  }
  const normalized = normalizeGoldenGatePart({ name: 'sequence', sequence: seq });
  const provenance = normalizationProvenance([], [normalized.provenance]);
  const enz = getEnzyme(enzyme);
  if (!enz) {
    return {
      sequence: normalized.part?.sequence ?? seq.replace(/\s+/g, '').toUpperCase(),
      enzyme: boundedGoldenGateEnzymeLabel(enzyme),
      sites: [],
      complete: false,
      diagnostics: [
        ...normalized.diagnostics,
        {
          code: 'unsupported_enzyme',
          message: `Unsupported Golden Gate enzyme: ${boundedGoldenGateEnzymeLabel(enzyme)}`,
        },
      ],
      provenance,
    };
  }
  if (!normalized.part) {
    return {
      sequence: seq.replace(/\s+/g, '').toUpperCase(),
      enzyme: enz.name,
      sites: [],
      complete: false,
      diagnostics: normalized.diagnostics,
      provenance,
    };
  }
  const scanned = findGoldenGateSitesInNormalizedSequence(normalized.part.sequence, enz, options);
  return {
    sequence: normalized.part.sequence,
    enzyme: enz.name,
    sites: scanned.sites,
    complete: scanned.complete,
    diagnostics: scanned.complete
      ? normalized.diagnostics
      : [
        ...normalized.diagnostics,
        {
          code: 'site_limit' as const,
          message: `Golden Gate site scan stopped after ${MAX_GOLDEN_GATE_DETECTED_SITES.toLocaleString()} detected sites.`,
        },
      ],
    provenance,
  };
}

/**
 * Compatibility projection for callers that need only sites. Invalid or
 * ambiguous input returns no sites; use `scanGoldenGateSites` for diagnostics.
 */
export function findGoldenGateSites(
  seq: string,
  enzyme = DEFAULT_ENZYME,
  options: FindGoldenGateSitesOptions = {},
): GoldenGateSite[] {
  const result = scanGoldenGateSites(seq, enzyme, options);
  return result.complete ? result.sites : [];
}

/**
 * Count the number of positions where two equal-length strings differ.
 */
function hammingDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) d++;
  }
  return d;
}

function sourceMapForInsert(
  sourceLength: number,
  insertStart: number,
  insertLength: number,
): SourceToProductCoordinateMap {
  const map = emptySourceToProductMap(sourceLength, insertLength);
  for (let source = 0; source < insertLength; source++) map.sourceToProduct[insertStart + source] = source;
  return map;
}

function fillFirstInsertMap(map: SourceToProductCoordinateMap): void {
  for (let source = 0; source < map.sourceLength; source++) map.sourceToProduct[source] = source;
}

function fillNextInsertMap(
  map: SourceToProductCoordinateMap,
  productOffset: number,
  overlapLength: number,
): void {
  for (let source = 0; source < map.sourceLength; source++) {
    map.sourceToProduct[source] = source < overlapLength
      ? productOffset - overlapLength + source
      : productOffset + source - overlapLength;
  }
}

function finalProductMapForAssembly(length: number, removedLength: number): SourceToProductCoordinateMap {
  const productLength = length - removedLength;
  return {
    sourceLength: length,
    productLength,
    sourceToProduct: Array.from({ length }, (_, source) => (
      source < productLength ? source : source - productLength
    )),
  };
}

function createProductFeature(
  name: string,
  type: Feature['type'],
  start: number,
  end: number,
  color: string,
  metadata: Record<string, unknown>,
  subRanges?: Feature['subRanges'],
): Feature | null {
  if (end <= start) return null;
  return {
    id: crypto.randomUUID(),
    name,
    type,
    start,
    end,
    strand: 1,
    color,
    metadata,
    ...(subRanges && subRanges.length > 0 ? { subRanges } : {}),
  };
}

function createPartSpanFeature(
  part: Pick<DigestedAssemblyPart, 'id' | 'name' | 'oh5' | 'rightOverhang'>,
  partIndex: number,
  start: number,
  end: number,
): Feature | null {
  return createProductFeature(
    `${part.name} span`,
    'misc_feature',
    start,
    end,
    PRODUCT_PART_SPAN_COLOR,
    {
      source: 'golden_gate_assembly',
      kind: 'part_span',
      ...(part.id ? { partId: part.id } : {}),
      partName: part.name,
      partIndex,
      leftOverhang: part.oh5,
      rightOverhang: part.rightOverhang,
    },
  );
}

function createJunctionFeature(
  leftPartName: string,
  rightPartName: string,
  overhang: string,
  start: number,
  end: number,
  options: { circular?: boolean; sequenceLength?: number; overhangLength?: number } = {},
): Feature | null {
  const overhangLength = options.overhangLength ?? overhang.length;
  const circularRanges = options.circular && options.sequenceLength !== undefined
    ? [
      { start, end, strand: 1 },
      { start: 0, end: Math.min(overhangLength, options.sequenceLength), strand: 1 },
    ]
      .filter((range) => range.end > range.start)
      .filter((range, index, ranges) => ranges.findIndex((candidate) => (
        candidate.start === range.start && candidate.end === range.end
      )) === index)
    : [];
  const subRanges = circularRanges.length > 1 ? circularRanges : undefined;
  const featureStart = subRanges
    ? Math.min(...subRanges.map((range) => range.start))
    : start;
  const featureEnd = subRanges
    ? Math.max(...subRanges.map((range) => range.end))
    : end;

  return createProductFeature(
    `Junction ${leftPartName} -> ${rightPartName} (${overhang})`,
    'restriction_site',
    featureStart,
    featureEnd,
    PRODUCT_JUNCTION_COLOR,
    {
      source: 'golden_gate_assembly',
      kind: 'junction_overhang',
      leftPartName,
      rightPartName,
      overhang,
      circular: options.circular === true,
    },
    subRanges,
  );
}

interface DigestedAssemblyPart {
  id?: string;
  name: string;
  insert: string;
  oh5: string;
  oh3: string;
  rightOverhang: string;
  features: Feature[];
  insertStart: number;
}

interface DigestPartsResult {
  digested: DigestedAssemblyPart[];
  errors: string[];
  normalizationDiagnostics: GoldenGateNormalizationDiagnostic[];
  provenanceParts: GoldenGateNormalizationProvenance['parts'];
}

/**
 * Digest each input part with the given Type IIS enzyme and return the
 * released insert with its 5' (oh5) and 3' (oh3raw / rightOverhang)
 * overhangs. Parts that lack flanking sites, contain internal sites, or
 * have unusable cut geometry produce errors and are excluded from the
 * digest list.
 */
function digestGoldenGateParts(
  parts: GoldenGatePart[],
  enz: RestrictionEnzyme,
): DigestPartsResult {
  const errors: string[] = [];
  const digested: DigestedAssemblyPart[] = [];
  const normalizationDiagnostics: GoldenGateNormalizationDiagnostic[] = [];
  const provenanceParts: GoldenGateNormalizationProvenance['parts'] = [];
  const recog = enz.recognitionSequence.toUpperCase();
  const recogRC = reverseComplement(recog).toUpperCase();
  const overhangLength = overhangLengthFor(enz);
  let detectedSiteCount = 0;

  for (const part of parts) {
    const normalized = normalizeGoldenGatePart(part);
    const partLabel = normalized.provenance.name;
    normalizationDiagnostics.push(...normalized.diagnostics);
    provenanceParts.push(normalized.provenance);
    if (!normalized.part) {
      errors.push(`Part "${partLabel}": Golden Gate input must be canonical A/C/G/T after normalization.`);
      continue;
    }
    const normalizedPart = normalized.part;
    const upper = normalizedPart.sequence;
    const featureValidation = validateFeatureCollection(normalizedPart.features, {
      label: `Golden Gate part "${partLabel}" features`,
      sequenceLength: upper.length,
    });
    if (!featureValidation.valid) {
      errors.push(...featureValidation.issues.map((issue) => issue.message));
      continue;
    }
    const senseIdx = upper.indexOf(recog);
    const antiIdx = senseIdx !== -1 ? upper.indexOf(recogRC, senseIdx + recog.length) : -1;
    const scanned = scanGoldenGateSites(normalizedPart.sequence, enz.name, { includeOutOfBounds: true });
    if (!scanned.complete) {
      errors.push(`Part "${partLabel}": ${scanned.diagnostics.find((diagnostic) => diagnostic.code === 'site_limit')?.message ?? 'Golden Gate site scan exceeded its safety limit.'}`);
      continue;
    }
    detectedSiteCount += scanned.sites.length;
    if (detectedSiteCount > MAX_GOLDEN_GATE_TOTAL_DETECTED_SITES) {
      errors.push(`Golden Gate assembly detected more than ${MAX_GOLDEN_GATE_TOTAL_DETECTED_SITES.toLocaleString()} total Type IIS sites.`);
      break;
    }

    if (senseIdx === -1 || antiIdx === -1 || senseIdx >= antiIdx) {
      const foundSites = scanned.sites;
      const foundSummary = foundSites.length > 0
        ? `found ${foundSites.length} site${foundSites.length !== 1 ? 's' : ''}, but not a valid sense/antisense flank pair`
        : 'found none';
      errors.push(
        `Part "${partLabel}": missing flanking ${enz.name} sites (${foundSummary}; need a sense site before the antisense site)`,
      );
      continue;
    }

    const internalSites = selectInternalGoldenGateSites(scanned.sites);
    if (internalSites.length > 0) {
      errors.push(
        `Part "${partLabel}": contains ${internalSites.length} internal ${enz.name} site${internalSites.length !== 1 ? 's' : ''}`,
      );
      continue;
    }

    const leftCut = senseIdx + enz.cutOffset;
    const rightCutStart = antiIdx + recogRC.length - enz.complementCutOffset;
    const geometryErrors = validateFlankCutGeometry(upper, leftCut, rightCutStart, overhangLength);
    if (geometryErrors.length > 0) {
      errors.push(`Part "${partLabel}": ${geometryErrors.join('; ')}`);
      continue;
    }

    const oh5 = upper.slice(leftCut, leftCut + overhangLength);
    const rightOverhang = upper.slice(rightCutStart, rightCutStart + overhangLength);
    const oh3 = reverseComplement(rightOverhang);
    const insert = upper.slice(leftCut, rightCutStart + overhangLength);

    if (oh5.length < overhangLength || oh3.length < overhangLength) {
      errors.push(`Part "${partLabel}": could not extract ${overhangLength} bp overhangs`);
      continue;
    }

    // Map features from the full source part into the released insert. Bases
    // outside the digest window are genuinely absent and therefore, and only
    // therefore, mark a surviving feature partial.
    const insertLength = insert.length;
    const insertMap = sourceMapForInsert(normalizedPart.sequence.length, leftCut, insertLength);
    const featureMapping = mapFeaturesThroughSourceCoordinates(normalizedPart.features, insertMap);
    if (featureMapping.status !== 'ready') {
      errors.push(`Part "${partLabel}": ${featureMapping.issues.map((issue) => issue.message).join(' ')}`);
      continue;
    }
    const shiftedFeatures = featureMapping.features;

    digested.push({ id: normalizedPart.id, name: normalizedPart.name, insert, oh5, oh3, rightOverhang, features: shiftedFeatures, insertStart: leftCut });
  }

  return { digested, errors, normalizationDiagnostics, provenanceParts };
}

export type GoldenGateChainReason =
  | 'unique'
  | 'no-chain'
  | 'ambiguous-multiple-chains'
  | 'ambiguous-self-ligation'
  | 'work-limit';

interface GoldenGateChainAnalysis {
  ordered: DigestedAssemblyPart[] | null;
  closes: boolean;
  topology: 'linear' | 'circular';
  reason: GoldenGateChainReason;
  /** Vector overhangs needed to close a unique open chain. */
  missingVectorOverhangs?: { left: string; right: string };
  /** Overhangs implicated when the assembly is genuinely ambiguous. */
  ambiguousOverhangs?: string[];
}

/** Safety cap on completed chains retained during enumeration. */
const MAX_GOLDEN_GATE_CHAINS = 64;

/**
 * Enumerate every Eulerian-style ordering of the digested parts where each
 * adjacent pair shares a 4 bp overhang, then collapse rotation-equivalent
 * circular orderings to detect whether the assembly is unambiguous.
 *
 * - 0 chains found → no path through every part (mismatch).
 * - >1 distinct chain (after rotation canonicalization) → real ambiguity.
 * - Exactly 1 unique chain whose endpoints fail to close → suggest a
 *   destination vector backbone with the missing overhangs.
 * - Exactly 1 unique chain that closes → success.
 *
 * Special case: every part is self-symmetric (`oh5 === rightOverhang`) AND
 * shares the same overhang value. This is the textbook "ambiguous fusion
 * site" case (e.g., two CAGT/CAGT parts) where in-tube ligation produces
 * self-ligated monomers and multimers; reject as ambiguous even though the
 * sequence-level circle is unique.
 */
function analyzeGoldenGateChain(digested: DigestedAssemblyPart[]): GoldenGateChainAnalysis {
  const n = digested.length;
  if (n === 0) {
    return { ordered: null, closes: false, topology: 'linear', reason: 'no-chain' };
  }

  const validChains: number[][] = [];
  let workUnits = 0;

  for (let startIdx = 0; startIdx < n; startIdx++) {
    const path: number[] = [startIdx];
    const visited = new Set<number>([startIdx]);

    // Explicit stack: a hostile set of compatible parts cannot exhaust the
    // JavaScript call stack, and every candidate edge consumes bounded work.
    const stack: Array<{ current: number; nextIndex: number }> = [{ current: startIdx, nextIndex: 0 }];
    while (stack.length > 0) {
      if (validChains.length >= MAX_GOLDEN_GATE_CHAINS || workUnits >= MAX_GOLDEN_GATE_CHAIN_WORK_UNITS) {
        return {
          ordered: null,
          closes: false,
          topology: 'linear',
          reason: 'work-limit',
        };
      }
      const frame = stack[stack.length - 1];
      if (path.length === n) {
        validChains.push([...path]);
        stack.pop();
        const removed = path.pop();
        if (removed !== undefined) visited.delete(removed);
        continue;
      }
      if (frame.nextIndex >= n) {
        stack.pop();
        const removed = path.pop();
        if (removed !== undefined) visited.delete(removed);
        continue;
      }
      const candidateIndex = frame.nextIndex;
      frame.nextIndex += 1;
      workUnits += 1;
      if (visited.has(candidateIndex)) continue;
      if (digested[candidateIndex].oh5 !== digested[frame.current].rightOverhang) continue;
      visited.add(candidateIndex);
      path.push(candidateIndex);
      stack.push({ current: candidateIndex, nextIndex: 0 });
    }
  }

  if (validChains.length === 0) {
    return { ordered: null, closes: false, topology: 'linear', reason: 'no-chain' };
  }

  const canonicalMap = new Map<string, number[]>();
  for (const chain of validChains) {
    const last = digested[chain[chain.length - 1]];
    const first = digested[chain[0]];
    const isCircular = last.rightOverhang === first.oh5;
    let key: string;
    if (isCircular) {
      let minIdx = 0;
      for (let index = 1; index < chain.length; index += 1) {
        if (chain[index] < chain[minIdx]) minIdx = index;
      }
      const rotated = [...chain.slice(minIdx), ...chain.slice(0, minIdx)];
      key = 'C:' + rotated.join('-');
    } else {
      key = 'L:' + chain.join('-');
    }
    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, chain);
    }
  }

  const canonicalChains = [...canonicalMap.values()];

  if (canonicalChains.length > 1) {
    return {
      ordered: null,
      closes: false,
      topology: 'linear',
      reason: 'ambiguous-multiple-chains',
      ambiguousOverhangs: findDuplicateOverhangs(digested),
    };
  }

  const ordered = canonicalChains[0].map((i) => digested[i]);
  const last = ordered[ordered.length - 1];
  const first = ordered[0];
  const isCircular = last.rightOverhang === first.oh5;

  if (isCircular) {
    const sentinel = first.oh5;
    const allSelfSymmetricSame = ordered.every(
      (p) => p.oh5 === p.rightOverhang && p.oh5 === sentinel,
    );
    if (allSelfSymmetricSame) {
      return {
        ordered: null,
        closes: false,
        topology: 'linear',
        reason: 'ambiguous-self-ligation',
        ambiguousOverhangs: [sentinel],
      };
    }
  }

  return {
    ordered,
    closes: isCircular,
    topology: isCircular ? 'circular' : 'linear',
    reason: 'unique',
    ...(isCircular ? {} : {
      missingVectorOverhangs: {
        left: last.rightOverhang,
        right: first.oh5,
      },
    }),
  };
}

function findDuplicateOverhangs(digested: DigestedAssemblyPart[]): string[] {
  const oh5Counts = new Map<string, number>();
  const oh3Counts = new Map<string, number>();
  for (const p of digested) {
    oh5Counts.set(p.oh5, (oh5Counts.get(p.oh5) ?? 0) + 1);
    oh3Counts.set(p.rightOverhang, (oh3Counts.get(p.rightOverhang) ?? 0) + 1);
  }
  const dup = new Set<string>();
  for (const [oh, count] of oh5Counts) if (count > 1) dup.add(oh);
  for (const [oh, count] of oh3Counts) if (count > 1) dup.add(oh);
  return [...dup];
}

/**
 * Return the internal Golden Gate sites in a sequence.
 *
 * A valid part typically has one flanking sense site and one flanking antisense
 * site. Any additional sites between those flanks are treated as internal and
 * should block assembly. If the sequence does not look like a flanked part yet,
 * fall back to reporting all detected sites so the caller can surface the issue.
 */
function findInternalGoldenGateSites(
  seq: string,
  enzyme = DEFAULT_ENZYME,
): GoldenGateSite[] {
  return selectInternalGoldenGateSites(findGoldenGateSites(seq, enzyme, { includeOutOfBounds: true }));
}

function selectInternalGoldenGateSites(sites: GoldenGateSite[]): GoldenGateSite[] {
  const senseSites = sites.filter((site) => site.strand === 1);
  const antisenseSites = sites.filter((site) => site.strand === -1);

  if (senseSites.length === 0 || antisenseSites.length === 0) {
    return sites;
  }

  const leftFlank = senseSites[0];
  const rightFlank = antisenseSites[antisenseSites.length - 1];
  if (leftFlank.position >= rightFlank.position) {
    return sites;
  }

  return sites.filter(
    (site) =>
      !(site.position === leftFlank.position && site.strand === leftFlank.strand) &&
      !(site.position === rightFlank.position && site.strand === rightFlank.strand),
  );
}

interface GoldenGatePartBoundaryInput {
  valid: true;
  name: string;
  sequence: string;
}

interface InvalidGoldenGatePartBoundaryInput {
  valid: false;
  errors: string[];
}

function goldenGatePartBoundaryInput(value: unknown): GoldenGatePartBoundaryInput | InvalidGoldenGatePartBoundaryInput {
  if (!goldenGateIsPlainObject(value)) {
    return { valid: false, errors: ['Golden Gate part must be a plain object.'] };
  }
  const part = value as Record<string, unknown>;
  const name = goldenGateOwnDataValue(part, 'name');
  const sequence = goldenGateOwnDataValue(part, 'sequence');
  if (name === INVALID_GOLDEN_GATE_ACCESSOR || sequence === INVALID_GOLDEN_GATE_ACCESSOR) {
    return { valid: false, errors: ['Golden Gate part name and sequence must be data properties, not accessors.'] };
  }
  if (typeof name !== 'string' || name.length === 0 || name.length > 256 || goldenGateHasControlCharacters(name)) {
    return { valid: false, errors: ['Golden Gate part name must be a bounded string without control characters.'] };
  }
  if (typeof sequence !== 'string') {
    return { valid: false, errors: [`Part "${boundedGoldenGateEnzymeLabel(name)}" sequence must be a DNA string.`] };
  }
  if (sequence.length === 0) {
    return { valid: false, errors: [`Part "${boundedGoldenGateEnzymeLabel(name)}" sequence must not be empty.`] };
  }
  if (sequence.length > MAX_GOLDEN_GATE_PART_LENGTH) {
    return {
      valid: false,
      errors: [`Part "${boundedGoldenGateEnzymeLabel(name)}" sequence exceeds ${MAX_GOLDEN_GATE_PART_LENGTH.toLocaleString()} bp.`],
    };
  }
  return { valid: true, name, sequence };
}

export function getGoldenGatePartBoundary(
  part: Pick<GoldenGatePart, 'name' | 'sequence'>,
  enzyme = DEFAULT_ENZYME,
): GoldenGatePartBoundary {
  // This is an exported boundary helper and is also called by agent-facing
  // adapters. Check the runtime shape and sequence length before any
  // normalization, uppercasing, or diagnostic construction can copy a large
  // caller-controlled value.
  const input = goldenGatePartBoundaryInput(part);
  if (!input.valid) {
    return {
      valid: false,
      enzyme: boundedGoldenGateEnzymeLabel(enzyme),
      leftOverhang: null,
      rightOverhang: null,
      rightOverhangComplement: null,
      insertStart: null,
      insertEnd: null,
      siteCount: 0,
      internalSiteCount: 0,
      errors: input.errors,
    };
  }
  const enz = getEnzyme(enzyme);
  if (!enz) {
    return {
      valid: false,
      enzyme: boundedGoldenGateEnzymeLabel(enzyme),
      leftOverhang: null,
      rightOverhang: null,
      rightOverhangComplement: null,
      insertStart: null,
      insertEnd: null,
      siteCount: 0,
      internalSiteCount: 0,
      errors: [unsupportedEnzymeError(enzyme)],
    };
  }
  const normalized = normalizeGoldenGatePart({ name: input.name, sequence: input.sequence });
  const normalizationDiagnostics = normalized.diagnostics;
  const provenance = normalizationProvenance([], [normalized.provenance]);
  if (!normalized.part) {
    return {
      valid: false,
      enzyme: enz.name,
      leftOverhang: null,
      rightOverhang: null,
      rightOverhangComplement: null,
      insertStart: null,
      insertEnd: null,
      siteCount: 0,
      internalSiteCount: 0,
      errors: [`Part "${input.name}" must contain only canonical A/C/G/T bases.`],
      normalizationDiagnostics,
      provenance,
    };
  }
  const upper = normalized.part.sequence;
  const recog = enz.recognitionSequence.toUpperCase();
  const recogRC = reverseComplement(recog).toUpperCase();
  const overhangLength = overhangLengthFor(enz);
  const scanned = scanGoldenGateSites(upper, enzyme, { includeOutOfBounds: true });
  const sites = scanned.sites;
  const errors: string[] = [];
  if (!scanned.complete) {
    errors.push(scanned.diagnostics.find((diagnostic) => diagnostic.code === 'site_limit')?.message ?? 'Golden Gate site scan exceeded its safety limit.');
  }

  const senseIdx = upper.indexOf(recog);
  const antiIdx = senseIdx !== -1 ? upper.indexOf(recogRC, senseIdx + recog.length) : -1;

  if (senseIdx === -1 || antiIdx === -1 || senseIdx >= antiIdx) {
    errors.push(`Missing valid ${enz.name} sense/antisense flanks`);
    return {
      valid: false,
      enzyme: enz.name,
      leftOverhang: null,
      rightOverhang: null,
      rightOverhangComplement: null,
      insertStart: null,
      insertEnd: null,
      siteCount: sites.length,
      internalSiteCount: sites.length,
      errors,
      normalizationDiagnostics,
      provenance,
    };
  }

  const internalSites = selectInternalGoldenGateSites(sites);
  if (internalSites.length > 0) {
    errors.push(`${internalSites.length} internal ${enz.name} site${internalSites.length === 1 ? '' : 's'}`);
  }

  const leftCut = senseIdx + enz.cutOffset;
  const rightCutStart = antiIdx + recogRC.length - enz.complementCutOffset;
  errors.push(...validateFlankCutGeometry(upper, leftCut, rightCutStart, overhangLength));

  const leftOverhang = hasOverhangWindow(upper, leftCut, overhangLength)
    ? upper.slice(leftCut, leftCut + overhangLength)
    : '';
  const rightOverhangSense = hasOverhangWindow(upper, rightCutStart, overhangLength)
    ? upper.slice(rightCutStart, rightCutStart + overhangLength)
    : '';
  const rightOverhangComplement = reverseComplement(rightOverhangSense);
  const rightOverhang = reverseComplement(rightOverhangComplement).toUpperCase();

  if (leftOverhang.length < overhangLength || rightOverhang.length < overhangLength) {
    errors.push(`Could not extract ${overhangLength} bp overhangs`);
  }

  return {
    valid: errors.length === 0,
    enzyme: enz.name,
    leftOverhang: leftOverhang.length === overhangLength ? leftOverhang : null,
    rightOverhang: rightOverhang.length === overhangLength ? rightOverhang : null,
    rightOverhangComplement: rightOverhangComplement.length === overhangLength ? rightOverhangComplement : null,
    insertStart: leftCut,
    insertEnd: rightCutStart + overhangLength,
    siteCount: sites.length,
    internalSiteCount: internalSites.length,
    errors,
    normalizationDiagnostics,
    provenance,
  };
}

function describeMissingVectorOverhangs(missing: { left: string; right: string }): string {
  return `Add a destination vector with overhangs ${missing.left} (5'-facing) and ${missing.right} (3'-facing) to close the loop`;
}

function partIdsForInput(parts: unknown): string[] | undefined {
  const arraySnapshot = snapshotGoldenGatePartsArray(parts);
  if (arraySnapshot.error) return undefined;
  const snapshots = arraySnapshot.values.map((part, index) => snapshotGoldenGatePart(part, index).part);
  return snapshots.some((part) => typeof part?.id === 'string' && part.id.length > 0)
    ? snapshots.map((part, index) => part?.id ?? `${part?.name ?? `part-${index + 1}`}#${index + 1}`)
    : undefined;
}

function partIdsForDigested(parts: readonly DigestedAssemblyPart[]): string[] | undefined {
  return parts.some((part) => typeof part.id === 'string' && part.id.length > 0)
    ? parts.map((part, index) => part.id ?? `${part.name}#${index + 1}`)
    : undefined;
}

/**
 * Validate the set of 4 bp overhangs produced by Golden Gate digestion of
 * the given parts. Walks the chain of compatible overhangs to distinguish:
 *
 * - Duplicated overhangs that are resolved by a unique chain ordering
 *   (legitimate when a destination vector closes the loop, e.g. MoClo L0
 *   vector-facing overhangs AATG/GCTT) — surfaced as an `open_chain` issue
 *   with the exact overhangs a vector backbone must expose.
 * - Genuinely ambiguous duplicates (multiple non-rotation-equivalent
 *   chains, or every part sharing one self-symmetric overhang) — surfaced
 *   as `duplicate` issues.
 * - Palindromic overhangs (self-ligation risk).
 * - Near-identical overhangs (1-bp Hamming distance — ligation infidelity).
 *
 * Parts that lack properly flanking enzyme sites are skipped (the assembler
 * itself will report the missing-site error).
 */
export function validateGoldenGateOverhangs(
  parts: GoldenGatePart[],
  enzyme = DEFAULT_ENZYME,
): OverhangValidation {
  const issues: OverhangValidation['issues'] = [];
  const enz = getEnzyme(enzyme);
  if (!enz) {
    return { valid: false, overhangs: [], issues };
  }
  const inputValidation = validateGoldenGateParts(parts);
  if (!inputValidation.valid) {
    for (const error of inputValidation.errors) {
      issues.push({ type: 'preparation', overhangs: [], description: error });
    }
    return { valid: false, overhangs: [], issues };
  }
  const partsSnapshot = snapshotGoldenGatePartsArray(parts);
  if (partsSnapshot.error) {
    issues.push({ type: 'preparation', overhangs: [], description: partsSnapshot.error });
    return { valid: false, overhangs: [], issues };
  }
  const safeParts = partsSnapshot.values as GoldenGatePart[];

  const {
    digested,
    errors: digestErrors,
    normalizationDiagnostics,
    provenanceParts,
  } = digestGoldenGateParts(safeParts, enz);
  for (const error of digestErrors) {
    issues.push({
      type: 'preparation',
      overhangs: [],
      description: error,
    });
  }

  if (partsSnapshot.length === 0) {
    issues.push({
      type: 'preparation',
      overhangs: [],
      description: 'Golden Gate validation requires at least one part',
    });
  } else if (digested.length === 0) {
    issues.push({
      type: 'preparation',
      overhangs: [],
      description: 'No analyzable Golden Gate parts were found',
    });
  }
  const leftOverhangs = digested.map((d) => d.oh5);
  const rightOverhangs = digested.map((d) => d.rightOverhang);
  const unique = [...new Set([...leftOverhangs, ...rightOverhangs])];

  let missingVectorOverhangs: OverhangValidation['missingVectorOverhangs'];

  if (digested.length >= 2) {
    const analysis = analyzeGoldenGateChain(digested);
    if (analysis.reason === 'work-limit') {
      issues.push({
        type: 'preparation',
        overhangs: [],
        description: `Golden Gate chain enumeration exceeded the ${MAX_GOLDEN_GATE_CHAIN_WORK_UNITS.toLocaleString()}-unit safety limit.`,
      });
    } else if (analysis.reason === 'ambiguous-multiple-chains' || analysis.reason === 'ambiguous-self-ligation') {
      const ambiguous = analysis.ambiguousOverhangs ?? [];
      for (const oh of ambiguous) {
        issues.push({
          type: 'duplicate',
          overhangs: [oh],
          description: `Overhang ${oh} appears in multiple chain positions — ambiguous ligation order`,
        });
      }
      if (ambiguous.length === 0) {
        issues.push({
          type: 'duplicate',
          overhangs: [],
          description: 'Parts can be ordered in multiple ways — ambiguous ligation order',
        });
      }
    } else if (analysis.reason === 'unique' && !analysis.closes && analysis.missingVectorOverhangs) {
      missingVectorOverhangs = analysis.missingVectorOverhangs;
      issues.push({
        type: 'open_chain',
        overhangs: [analysis.missingVectorOverhangs.left, analysis.missingVectorOverhangs.right],
        description: describeMissingVectorOverhangs(analysis.missingVectorOverhangs),
      });
    }
  }

  for (const oh of unique) {
    if (oh === reverseComplement(oh).toUpperCase()) {
      issues.push({
        type: 'palindromic',
        overhangs: [oh],
        description: `Overhang ${oh} is palindromic — risk of self-ligation`,
      });
    }
  }

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      if (hammingDistance(unique[i], unique[j]) === 1) {
        issues.push({
          type: 'near_identical',
          overhangs: [unique[i], unique[j]],
          description: `Overhangs ${unique[i]} and ${unique[j]} differ by only 1 bp — ligation infidelity risk`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    overhangs: unique,
    issues,
    normalizationDiagnostics,
    provenance: normalizationProvenance([], provenanceParts),
    ...(missingVectorOverhangs ? { missingVectorOverhangs } : {}),
  };
}

/**
 * Simulate Golden Gate Assembly.
 *
 * Each part is expected to have the enzyme recognition site flanking the insert:
 *   5' ... [enzyme site] [overhang] [insert] [overhang] [enzyme RC] ... 3'
 *
 * The overhang length is enzyme-specific: 4 bp for BsaI/BbsI/BsmBI/Esp3I,
 * 3 bp for SapI/BspQI. After digestion the insert is released with its
 * characteristic overhangs and parts are assembled by matching complements.
 */
export function goldenGateAssemble(
  parts: GoldenGatePart[],
  enzyme = DEFAULT_ENZYME,
): GoldenGateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const partsSnapshot = snapshotGoldenGatePartsArray(parts);
  const inputPartIds = partIdsForInput(parts);
  const enz = getEnzyme(enzyme);
  if (!enz) {
    return {
      sequence: '',
      features: [],
      parts: goldenGateResultPartNames(parts),
      ...(inputPartIds ? { partIds: inputPartIds } : {}),
      overhangs: [],
      enzyme: boundedGoldenGateEnzymeLabel(enzyme),
      topology: 'linear',
      status: 'invalid_input',
      success: false,
      errors: [unsupportedEnzymeError(enzyme)],
      warnings: [],
    };
  }

  const inputValidation = validateGoldenGateParts(parts);
  if (!inputValidation.valid) {
    return {
      sequence: '',
      features: [],
      parts: goldenGateResultPartNames(parts),
      ...(inputPartIds ? { partIds: inputPartIds } : {}),
      overhangs: [],
      enzyme: enz.name,
      topology: 'linear',
      status: inputValidation.status === 'work_limit' ? 'work_limit' : 'invalid_input',
      success: false,
      errors: inputValidation.errors,
      warnings: [],
    };
  }

  if (partsSnapshot.error || partsSnapshot.length < 2) {
    return {
      sequence: '',
      features: [],
      parts: [],
      ...(inputPartIds ? { partIds: inputPartIds } : {}),
      overhangs: [],
      enzyme: enz.name,
      topology: 'linear',
      status: 'invalid_input',
      success: false,
      errors: ['Golden Gate Assembly requires at least 2 parts'],
      warnings: [],
    };
  }

  // Pre-validate palindromic and near-identical overhangs (informational warnings).
  // Ambiguity / open-chain handling is delegated to the chain analyzer below
  // so the assembler can return structured `missingVectorOverhangs` to the UI.
  const safeParts = partsSnapshot.values as GoldenGatePart[];
  const validation = validateGoldenGateOverhangs(safeParts, enzyme);
  for (const issue of validation.issues) {
    if (issue.type === 'palindromic' || issue.type === 'near_identical') {
      warnings.push(issue.description);
    }
  }

  // --- Step 1: Digest each part to extract the insert with its overhangs ---
  const {
    digested,
    errors: digestErrors,
    normalizationDiagnostics,
    provenanceParts,
  } = digestGoldenGateParts(safeParts, enz);
  const normalizationProvenance = normalizationProvenanceForParts(provenanceParts);
  errors.push(...digestErrors);

  if (errors.length > 0) {
    const status: GoldenGateAssemblyStatus = errors.some((message) => /safety limit|exceeds .*limit|exceeded its safety|detected more than .* total/u.test(message))
      ? 'work_limit'
      : 'invalid_input';
    return { sequence: '', features: [], parts: goldenGateResultPartNames(parts), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', status, success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  // --- Step 2: Resolve the unique part ordering via chain analysis ---
  const analysis = analyzeGoldenGateChain(digested);

  if (analysis.reason === 'ambiguous-self-ligation') {
    const oh = analysis.ambiguousOverhangs?.[0] ?? '';
    errors.push(
      oh
        ? `Overhang ${oh} appears at every junction — ambiguous ligation order (every part can self-ligate or swap with another).`
        : 'Parts can be self-ligated or reordered — ambiguous ligation order.',
    );
    return { sequence: '', features: [], parts: goldenGateResultPartNames(parts), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', status: 'ambiguous', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  if (analysis.reason === 'work-limit') {
    errors.push(`Golden Gate chain enumeration exceeded the ${MAX_GOLDEN_GATE_CHAIN_WORK_UNITS.toLocaleString()}-unit safety limit.`);
    return { sequence: '', features: [], parts: goldenGateResultPartNames(parts), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', status: 'work_limit', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  if (analysis.reason === 'ambiguous-multiple-chains') {
    const ambiguous = analysis.ambiguousOverhangs ?? [];
    if (ambiguous.length > 0) {
      for (const oh of ambiguous) {
        errors.push(
          `Overhang ${oh} appears in multiple chain positions — ambiguous ligation order`,
        );
      }
    } else {
      errors.push(
        'Could not form a complete assembly chain — parts can be ordered in multiple ways.',
      );
    }
    return { sequence: '', features: [], parts: goldenGateResultPartNames(parts), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', status: 'ambiguous', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  if (analysis.reason === 'no-chain' || !analysis.ordered) {
    errors.push(
      'Could not form a complete assembly chain — check that overhangs are unique and form a linear (or circular) order',
    );
    return { sequence: '', features: [], parts: goldenGateResultPartNames(parts), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', status: 'invalid_input', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  const ordered = analysis.ordered;
  const orderedPartIds = partIdsForDigested(ordered);
  if (!analysis.closes && analysis.missingVectorOverhangs) {
    const missing = analysis.missingVectorOverhangs;
    errors.push(
      `Assembly chain is open: ${describeMissingVectorOverhangs(missing)}. ` +
      `Tail "${ordered[ordered.length - 1].name}" exposes ${missing.left}; ` +
      `head "${ordered[0].name}" exposes ${missing.right}.`,
    );
    return {
      sequence: '',
      features: [],
      parts: ordered.map((p) => p.name),
      ...(orderedPartIds ? { partIds: orderedPartIds } : {}),
      overhangs: ordered.map((p) => p.oh5),
      enzyme: enz.name,
      topology: 'linear',
      status: 'invalid_input',
      success: false,
      errors,
      warnings,
      normalizationDiagnostics,
      provenance: normalizationProvenance,
      missingVectorOverhangs: missing,
    };
  }

  // --- Step 3: Assemble by ligating inserts, joining at matching overhangs ---
  // Each insert starts with oh5 and ends with the complement of oh3.
  // Adjacent inserts share one overhang sequence so trim the duplicate. Keep
  // an explicit map for every insert so features in the retained-equivalent
  // overlap resolve to the existing product bases instead of disappearing.
  const overhangLength = overhangLengthFor(enz);
  let sequence = ordered[0].insert;
  const insertMaps = ordered.map((part) => emptySourceToProductMap(part.insert.length, 0));
  fillFirstInsertMap(insertMaps[0]);
  const productFeatures: Feature[] = [];
  const firstPartSpan = createPartSpanFeature(ordered[0], 0, 0, sequence.length);
  if (firstPartSpan) productFeatures.push(firstPartSpan);
  const overhangs: string[] = [ordered[0].oh5];

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];

    // Verify compatibility: the previous right boundary is the next left boundary.
    if (prev.rightOverhang !== curr.oh5) {
      errors.push(
        `Overhang mismatch between "${prev.name}" (3' oh: ${prev.rightOverhang}) and "${curr.name}" (5' oh: ${curr.oh5})`,
      );
    }

    // The overhang at the junction is already present at the 3' end of prev.insert
    // (which is the overhangLength bases before the cut, i.e. the last overhangLength
    // bases of the insert).  The next insert starts with those same bases (oh5).
    // Scarless joining: trim the oh5 of curr.insert (already represented by end of sequence).
    const trimmedInsert = curr.insert.slice(overhangLength);
    const offset = sequence.length;
    fillNextInsertMap(insertMaps[i], offset, overhangLength);
    const junctionStart = Math.max(0, offset - overhangLength);
    const junctionFeature = createJunctionFeature(prev.name, curr.name, curr.oh5, junctionStart, offset, { overhangLength });
    if (junctionFeature) productFeatures.push(junctionFeature);

    sequence += trimmedInsert;
    overhangs.push(curr.oh5);

    const partSpan = createPartSpanFeature(curr, i, offset, sequence.length);
    if (partSpan) productFeatures.push(partSpan);
  }

  if (errors.length > 0) {
    return { sequence: '', features: [], parts: ordered.map((p) => p.name), ...(orderedPartIds ? { partIds: orderedPartIds } : {}), overhangs, enzyme: enz.name, topology: 'linear', status: 'invalid_input', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  const last = ordered[ordered.length - 1];
  const first = ordered[0];
  const closingOverhang = last.rightOverhang;
  if (closingOverhang !== first.oh5) {
    errors.push(
      `Assembly chain is open: "${last.name}" 3' overhang ${last.rightOverhang} does not close to "${first.name}" 5' overhang ${first.oh5}`,
    );
    return { sequence: '', features: [], parts: ordered.map((p) => p.name), ...(orderedPartIds ? { partIds: orderedPartIds } : {}), overhangs, enzyme: enz.name, topology: 'linear', status: 'invalid_input', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  const preClosureLength = sequence.length;
  const productLength = Math.max(0, sequence.length - overhangLength);
  const circularSequence = sequence.slice(0, productLength);
  aliasRemovedProductCoordinates(insertMaps, productLength, preClosureLength);
  const finalProductMap = finalProductMapForAssembly(preClosureLength, overhangLength);
  const circularFeatures: Feature[] = [];
  for (const [index, part] of ordered.entries()) {
    const mapping = mapFeaturesThroughSourceCoordinates(part.features, insertMaps[index]);
    if (mapping.status !== 'ready') {
      return {
        sequence: '',
        features: [],
        parts: ordered.map((p) => p.name),
        ...(orderedPartIds ? { partIds: orderedPartIds } : {}),
        overhangs,
        enzyme: enz.name,
        topology: 'linear',
        status: 'work_limit',
        success: false,
        errors: mapping.issues.map((issue) => issue.message),
        warnings,
        normalizationDiagnostics,
        provenance: normalizationProvenance,
      };
    }
    circularFeatures.push(...mapping.features);
  }
  const productMapping = mapFeaturesThroughSourceCoordinates(productFeatures, finalProductMap);
  if (productMapping.status !== 'ready') {
    return {
      sequence: '',
      features: [],
      parts: ordered.map((p) => p.name),
      ...(orderedPartIds ? { partIds: orderedPartIds } : {}),
      overhangs,
      enzyme: enz.name,
      topology: 'linear',
      status: 'work_limit',
      success: false,
      errors: productMapping.issues.map((issue) => issue.message),
      warnings,
      normalizationDiagnostics,
      provenance: normalizationProvenance,
    };
  }
  const circularProductFeatures = productMapping.features;
  const finalJunction = createJunctionFeature(
    last.name,
    first.name,
    first.oh5,
    Math.max(0, circularSequence.length - overhangLength),
    circularSequence.length,
    { circular: true, sequenceLength: circularSequence.length, overhangLength },
  );
  if (finalJunction) circularProductFeatures.push(finalJunction);

  return {
    sequence: circularSequence,
    features: [...circularFeatures, ...circularProductFeatures],
    parts: ordered.map((p) => p.name),
    ...(orderedPartIds ? { partIds: orderedPartIds } : {}),
    overhangs,
    enzyme: enz.name,
    topology: 'circular',
    status: 'ready',
    success: true,
    errors: [],
    warnings,
    normalizationDiagnostics,
    provenance: normalizationProvenance,
  };
}

/**
 * Check for internal enzyme recognition sites within a sequence that would
 * interfere with Golden Gate cloning (i.e., sites not at the designed ends).
 */
export function checkInternalSites(
  seq: string,
  enzyme = DEFAULT_ENZYME,
): Array<{ position: number; strand: 1 | -1 }> {
  return findInternalGoldenGateSites(seq, enzyme).map(({ position, strand }) => ({ position, strand }));
}

const DEFAULT_VECTOR_FILLER_LENGTH = 50;
export const MAX_SYNTHETIC_VECTOR_FILLER_LENGTH = 100_000;
// A neutral filler that avoids encoding any restriction recognition sequence,
// any 4-mer that could collide with common MoClo overhangs, and any homopolymer
// long enough to cause assembly artifacts. Generated as ACTG repeats which
// cycle through every base, then verified site-free for BsaI/BbsI/BsmBI/Esp3I/SapI/BspQI.
const VECTOR_FILLER_TEMPLATE = 'ACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTGACTG';

/**
 * Build a synthetic destination vector backbone "part" with inward-cutting
 * Type IIS flanks. After digestion, the released vector fragment exposes
 * `leftOverhang` (matching the assembly chain's tail) on its 5' side and
 * `rightOverhang` (matching the assembly chain's head) on its 3' side, so
 * adding it to the parts list closes the loop.
 *
 * The filler region is neutral synthetic sequence containing no Type IIS
 * sites. Tools that need a specific vector backbone (cloning vector with ori,
 * marker, etc.) should supply their own GenBank part instead.
 */
export function buildSyntheticGoldenGateVector(
  leftOverhang: string,
  rightOverhang: string,
  options: {
    enzyme?: string;
    fillerLength?: number;
    filler?: string;
    name?: string;
  } = {},
): GoldenGatePart {
  const enzymeName = options.enzyme ?? DEFAULT_ENZYME;
  const enz = getEnzyme(enzymeName);
  if (!enz) {
    throw new Error(unsupportedEnzymeError(enzymeName));
  }

  const left = leftOverhang.toUpperCase();
  const right = rightOverhang.toUpperCase();
  const overhangLength = overhangLengthFor(enz);
  if (left.length !== overhangLength || right.length !== overhangLength) {
    throw new Error(`Vector overhangs must be exactly ${overhangLength} bp`);
  }
  if (!/^[ACGT]+$/.test(left) || !/^[ACGT]+$/.test(right)) {
    throw new Error('Vector overhangs must contain only A/C/G/T');
  }

  const fillerLen = options.filler === undefined
    ? options.fillerLength ?? DEFAULT_VECTOR_FILLER_LENGTH
    : options.fillerLength ?? options.filler.length;
  if (!Number.isInteger(fillerLen) || fillerLen < 0 || fillerLen > MAX_SYNTHETIC_VECTOR_FILLER_LENGTH) {
    throw new Error(`fillerLength must be an integer between 0 and ${MAX_SYNTHETIC_VECTOR_FILLER_LENGTH.toLocaleString()}.`);
  }
  let filler = options.filler?.toUpperCase() ?? VECTOR_FILLER_TEMPLATE.slice(0, fillerLen);
  if (options.filler !== undefined && !/^[ACGT]*$/.test(filler)) {
    throw new Error('Synthetic vector filler must contain only A/C/G/T.');
  }
  if (options.filler !== undefined && filler.length !== fillerLen) {
    throw new Error('fillerLength must match the supplied filler length.');
  }
  if (!options.filler && filler.length < fillerLen) {
    // Extend filler by tiling the template if a longer filler was requested.
    while (filler.length < fillerLen) {
      filler += VECTOR_FILLER_TEMPLATE.slice(0, Math.min(VECTOR_FILLER_TEMPLATE.length, fillerLen - filler.length));
    }
    filler = filler.slice(0, fillerLen);
  }

  const recog = enz.recognitionSequence.toUpperCase();
  const recogRC = reverseComplement(recog).toUpperCase();
  const leftSpacerLength = enz.cutOffset - recog.length;
  // The antisense cut is measured from the right edge of the recognition
  // sequence. Leave the requested overhang between the spacer and that site,
  // so the vector exposes the same geometry on both flanks.
  const rightSpacerLength = enz.complementCutOffset - recog.length - overhangLength;
  if (
    !Number.isInteger(leftSpacerLength)
    || !Number.isInteger(rightSpacerLength)
    || leftSpacerLength < 0
    || rightSpacerLength < 0
  ) {
    throw new Error(`Unsupported ${enz.name} synthetic-vector cut geometry`);
  }
  // Materialize every otherwise unspecified cut spacer with canonical bases.
  // Ambiguous `N` spacers make the synthetic vector impossible to hash or
  // rescreen deterministically. `A` is the stable canonical choice; the full
  // construct is rescanned below before it is returned.
  const leftSpacer = 'A'.repeat(leftSpacerLength);
  const rightSpacer = 'A'.repeat(rightSpacerLength);
  const padding = 'AAAA';
  // Layout: padding + sense site + left spacer + left overhang + filler
  //       + right overhang + right spacer + antisense site + padding.
  const sequence = `${padding}${recog}${leftSpacer}${left}${filler}${right}${rightSpacer}${recogRC}${padding}`;

  if (!/^[ACGT]+$/.test(sequence)) {
    throw new Error('Synthetic Golden Gate vector must be canonical A/C/G/T after spacer materialization.');
  }

  // Verify the complete synthetic construct against every supported Type IIS
  // enzyme. A compatibility array API can return an empty array for a capped
  // scan, so use the detailed scan and fail closed on `complete: false`.
  // Isoschizomer aliases (BsmBI/Esp3I and SapI/BspQI) are allowed to report
  // the two deliberately selected flank sites, but no other site is allowed.
  const intendedFlanks = [
    { position: padding.length, strand: 1 as const },
    {
      position: padding.length + recog.length + leftSpacerLength + left.length + filler.length + right.length + rightSpacerLength,
      strand: -1 as const,
    },
  ];
  const sameGoldenGateGeometry = (candidate: RestrictionEnzyme, selected: RestrictionEnzyme): boolean => (
    candidate.recognitionSequence.toUpperCase() === selected.recognitionSequence.toUpperCase()
    && candidate.cutOffset === selected.cutOffset
    && candidate.complementCutOffset === selected.complementCutOffset
    && candidate.overhang === selected.overhang
  );
  for (const supportedName of GOLDEN_GATE_ENZYME_NAMES) {
    const supported = getEnzyme(supportedName);
    if (!supported) continue;
    const scan = scanGoldenGateSites(sequence, supported.name, { includeOutOfBounds: true });
    if (!scan.complete) {
      throw new Error(`Synthetic vector site verification for ${supported.name} exceeded its bounded scan limit.`);
    }
    const unexpected = scan.sites.filter((site) => (
      !sameGoldenGateGeometry(supported, enz)
      || !intendedFlanks.some((flank) => flank.position === site.position && flank.strand === site.strand)
    ));
    if (unexpected.length > 0) {
      const positions = unexpected.slice(0, 8).map((site) => `${site.position} (${site.strand === 1 ? 'forward' : 'reverse'})`).join(', ');
      throw new Error(
        `Synthetic vector filler contains ${unexpected.length} unexpected ${supported.name} site${unexpected.length === 1 ? '' : 's'} at ${positions}; supply a site-free filler via options.filler`,
      );
    }
  }

  return {
    name: options.name ?? `Vector backbone (${left}/${right})`,
    sequence,
  };
}

export interface GoldenGateDomesticationSite {
  kind: 'enzyme' | 'site';
  enzyme?: string;
  motif: string;
  /** Lower coordinate in the supplied source sequence (0-based). */
  position: number;
  /** Coordinate in the oriented authoritative feature sequence (0-based). */
  featurePosition: number;
  strand: 1 | -1;
}

export type GoldenGateDomesticationFailureCode =
  | 'invalid_input'
  | 'input_limit'
  | 'feature_limit'
  | 'work_limit'
  | 'site_scan_limit'
  | 'failure_limit'
  | 'invalid_cds_location'
  | 'invalid_codon_start'
  | 'unsupported_translation_table'
  | 'invalid_cds_frame'
  | 'untranslatable_cds'
  | 'invalid_forbidden_enzyme'
  | 'invalid_forbidden_site'
  | 'no_synonymous_change'
  | 'unmodifiable_authoritative_site'
  | 'remaining_forbidden_site'
  | 'introduced_forbidden_site'
  | 'protein_identity_mismatch'
  | 'invalid_translation_exception';

export interface GoldenGateDomesticationFailure {
  code: GoldenGateDomesticationFailureCode;
  message: string;
  position?: number;
  enzyme?: string;
  motif?: string;
  diagnostics?: TranslationExceptionDiagnostic[];
}

/** Hard limits for the feature-aware domestication API. */
export const MAX_GOLDEN_GATE_DOMESTICATION_ENZYMES = 64;
export const MAX_GOLDEN_GATE_DOMESTICATION_SITES = MAX_GOLDEN_GATE_DETECTED_SITES;
export const MAX_GOLDEN_GATE_DOMESTICATION_MOTIF_LENGTH = 64;
export const MAX_GOLDEN_GATE_DOMESTICATION_FAILURES = 128;
export const MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS = 100_000_000;
export const MAX_GOLDEN_GATE_DOMESTICATION_PASSES = 100;

/** A feature location is authoritative only when every stored segment is valid. */
export type GoldenGateCdsFeature = Pick<Feature, 'start' | 'end' | 'strand' | 'subRanges'> & {
  type?: Feature['type'];
  metadata?: Feature['metadata'];
};

export interface DomesticateGoldenGateFeatureOptions {
  /** Complete source record; bases outside `feature` are structural context and are preserved. */
  sequence: string;
  /** Every base in this location, including codon_start-excluded bases, is authoritative. */
  feature: GoldenGateCdsFeature;
  /** INSDC codon_start semantics: 1, 2, or 3. */
  codonStart: number | string;
  /** Omitted/null means the registry's standard code; explicit unsupported ids fail closed. */
  translationTableId?: number | null;
  forbiddenEnzymes?: readonly string[];
  forbiddenSites?: readonly string[];
}

export interface DomesticateGoldenGateFeatureResult {
  sequence: string;
  mutations: Array<{ position: number; original: string; replacement: string }>;
  /** The complete feature location is the scan/guarantee scope. */
  authoritativeScope: 'feature';
  authoritativeBaseCount: number;
  /** Range in the oriented feature sequence translated for protein identity. */
  translatedBaseRange: { start: number; end: number } | null;
  complete: boolean;
  remainingSites: GoldenGateDomesticationSite[];
  introducedSites: GoldenGateDomesticationSite[];
  failures: GoldenGateDomesticationFailure[];
  sourceProtein: string | null;
  productProtein: string | null;
  proteinIdentity: boolean;
  /** Translation-exception receipt used for the protein-identity guarantee. */
  translationReceipt?: TranslationExceptionReceipt;
}

function domesticationFailure(
  code: GoldenGateDomesticationFailureCode,
  message: string,
  details: Partial<GoldenGateDomesticationFailure> = {},
): GoldenGateDomesticationFailure {
  return { code, message, ...details };
}

function domesticationSiteKey(site: GoldenGateDomesticationSite): string {
  return [site.kind, site.enzyme ?? '', site.motif, site.position, site.featurePosition, site.strand].join('|');
}

interface DomesticationFeatureSegment {
  /** Offset of this contiguous source segment in the oriented feature. */
  featureStart: number;
  coordinates: number[];
  strands: Array<1 | -1>;
}

interface DomesticationFeatureLocation {
  coordinates: number[];
  strands: Array<1 | -1>;
  segments: DomesticationFeatureSegment[];
  failures: GoldenGateDomesticationFailure[];
}

interface DomesticationFeatureValidation {
  feature: GoldenGateCdsFeature | null;
  failures: GoldenGateDomesticationFailure[];
}

interface DomesticationSiteScanResult {
  sites: GoldenGateDomesticationSite[];
  complete: boolean;
  omittedSitesAtLeast: number;
  workUnits: number;
  limitReason: 'site_limit' | 'work_limit' | null;
}

function domesticationFailureCodeForFeatureIssue(
  code: string,
): GoldenGateDomesticationFailureCode {
  if (code === 'feature_limit' || code === 'subrange_limit' || code === 'metadata_limit') return 'feature_limit';
  if (code === 'feature_work_limit') return 'work_limit';
  return 'invalid_cds_location';
}

/**
 * Validate the minimal CDS shape used by domestication through the shared
 * feature boundary. The public Feature type contains display-only fields that
 * are intentionally optional on this focused API, so bounded defaults are
 * supplied only for validation and never returned to callers.
 */
function validateDomesticationFeature(
  value: unknown,
  sequenceLength: number,
): DomesticationFeatureValidation {
  const failures: GoldenGateDomesticationFailure[] = [];
  if (!goldenGateIsPlainObject(value)) {
    return {
      feature: null,
      failures: [domesticationFailure('invalid_cds_location', 'Domestication requires a plain CDS feature object.')],
    };
  }
  const record = value as Record<string, unknown>;
  const start = goldenGateOwnDataValue(record, 'start');
  const end = goldenGateOwnDataValue(record, 'end');
  const strand = goldenGateOwnDataValue(record, 'strand');
  const type = goldenGateOwnDataValue(record, 'type');
  const metadata = goldenGateOwnDataValue(record, 'metadata');
  const subRanges = goldenGateOwnDataValue(record, 'subRanges');
  if ([start, end, strand, type, metadata, subRanges].some((field) => field === INVALID_GOLDEN_GATE_ACCESSOR)) {
    return {
      feature: null,
      failures: [domesticationFailure('invalid_cds_location', 'CDS feature fields must be data properties, not accessors.')],
    };
  }

  const feature = {
    start,
    end,
    strand,
    ...(type !== undefined ? { type } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(subRanges !== undefined ? { subRanges } : {}),
  } as GoldenGateCdsFeature;
  const validationFeature = {
    id: 'domestication-feature',
    name: 'domestication-feature',
    type: 'cds',
    start,
    end,
    strand,
    color: '#000000',
    metadata: metadata === undefined ? {} : metadata,
    ...(subRanges !== undefined ? { subRanges } : {}),
  } as Feature;
  const validation = validateFeatureCollection([validationFeature], {
    label: 'Golden Gate domestication feature',
    sequenceLength,
    maxFeatures: 1,
    maxSubrangesPerFeature: MAX_SUBRANGES_PER_FEATURE,
    maxWorkUnits: MAX_FEATURE_VALIDATION_WORK_UNITS,
  });
  for (const issue of validation.issues) {
    failures.push(domesticationFailure(
      domesticationFailureCodeForFeatureIssue(issue.code),
      issue.message,
    ));
  }
  return { feature: validation.valid ? feature : null, failures };
}

function sourceCoordinatesForFeature(
  sequenceLength: number,
  feature: GoldenGateCdsFeature,
): DomesticationFeatureLocation {
  const failures: GoldenGateDomesticationFailure[] = [];
  if (feature.type !== undefined && feature.type !== 'cds') {
    failures.push(domesticationFailure('invalid_cds_location', 'Domestication requires a CDS feature location.'));
    return { coordinates: [], strands: [], segments: [], failures };
  }
  if (feature.strand !== 1 && feature.strand !== -1) {
    failures.push(domesticationFailure(
      'invalid_cds_location',
      'CDS feature strand must be explicitly +1 or -1.',
    ));
  }
  if (feature.subRanges !== undefined) {
    for (const range of feature.subRanges) {
      if (
        !Number.isInteger(range.start)
        || !Number.isInteger(range.end)
        || range.start < 0
        || range.end > sequenceLength
        || range.end <= range.start
        || (range.strand !== undefined && range.strand !== 1 && range.strand !== -1)
      ) {
        failures.push(domesticationFailure(
          'invalid_cds_location',
          'Every CDS subRange must have bounded integer coordinates and either an inherited or explicit +1/-1 strand.',
        ));
      }
    }
  }
  if (failures.length > 0) return { coordinates: [], strands: [], segments: [], failures };

  const segments = featureLocationSegments(feature);
  if (segments.length === 0) {
    failures.push(domesticationFailure('invalid_cds_location', 'CDS location must contain at least one non-empty segment.'));
    return { coordinates: [], strands: [], segments: [], failures };
  }

  const coordinates: number[] = [];
  const strands: Array<1 | -1> = [];
  const segmentSpans: DomesticationFeatureSegment[] = [];
  const seen = new Set<number>();
  let featureStart = 0;
  for (const segment of segments) {
    if (
      !Number.isInteger(segment.start)
      || !Number.isInteger(segment.end)
      || segment.start < 0
      || segment.end > sequenceLength
      || segment.end <= segment.start
      || (segment.strand !== 1 && segment.strand !== -1)
    ) {
      failures.push(domesticationFailure(
        'invalid_cds_location',
        'Every CDS segment must have bounded integer coordinates and an explicit +1 or -1 strand.',
      ));
      continue;
    }
    const segmentCoordinates = segment.strand === 1
      ? Array.from({ length: segment.end - segment.start }, (_, offset) => segment.start + offset)
      : Array.from({ length: segment.end - segment.start }, (_, offset) => segment.end - 1 - offset);
    const segmentSpan: DomesticationFeatureSegment = {
      featureStart,
      coordinates: segmentCoordinates,
      strands: segmentCoordinates.map(() => segment.strand as 1 | -1),
    };
    featureStart += segmentCoordinates.length;
    for (const coordinate of segmentCoordinates) {
      if (seen.has(coordinate)) {
        failures.push(domesticationFailure(
          'invalid_cds_location',
          `CDS segments overlap at source coordinate ${coordinate}.`,
          { position: coordinate },
        ));
      } else {
        seen.add(coordinate);
        coordinates.push(coordinate);
        strands.push(segment.strand);
      }
    }
    if (segmentCoordinates.every((coordinate) => seen.has(coordinate))) segmentSpans.push(segmentSpan);
  }
  return { coordinates, strands, segments: segmentSpans, failures };
}

function scanDomesticationSites(
  coding: string,
  enzymes: readonly RestrictionEnzyme[],
  explicitMotifs: readonly string[],
  maxWorkUnits = MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS,
): DomesticationSiteScanResult {
  const sites: GoldenGateDomesticationSite[] = [];
  let complete = true;
  let omittedSitesAtLeast = 0;
  let workUnits = 0;
  let limitReason: DomesticationSiteScanResult['limitReason'] = null;
  const workLimit = Math.max(0, maxWorkUnits);
  const markSiteLimit = (): void => {
    complete = false;
    limitReason = 'site_limit';
    omittedSitesAtLeast += 1;
  };
  const appendSite = (site: GoldenGateDomesticationSite): boolean => {
    if (sites.length >= MAX_GOLDEN_GATE_DOMESTICATION_SITES) {
      markSiteLimit();
      return false;
    }
    sites.push(site);
    return true;
  };
  const charge = (units: number): boolean => {
    if (!Number.isSafeInteger(units) || units < 0 || units > workLimit - workUnits) {
      complete = false;
      limitReason = 'work_limit';
      omittedSitesAtLeast += 1;
      return false;
    }
    workUnits += units;
    return true;
  };

  for (const enzyme of enzymes) {
    if (!charge(coding.length)) break;
    const recognition = enzyme.recognitionSequence.toUpperCase();
    // The compatibility array API intentionally returns no sites for a
    // partial scan. Domestication must retain the detailed completion bit so
    // a capped scan can never be interpreted as site-free.
    const scan = scanGoldenGateSites(coding, enzyme.name, { includeOutOfBounds: true });
    if (!scan.complete) {
      complete = false;
      limitReason = 'site_limit';
      omittedSitesAtLeast += Math.max(1, MAX_GOLDEN_GATE_DETECTED_SITES - scan.sites.length);
    }
    if (!charge(scan.sites.length)) break;
    for (const site of scan.sites) {
      if (!appendSite({
        kind: 'enzyme',
        enzyme: enzyme.name,
        motif: site.strand === 1 ? recognition : reverseComplement(recognition).toUpperCase(),
        position: site.position,
        featurePosition: site.position,
        strand: site.strand,
      })) break;
    }
    // If this enzyme filled the result cap exactly, keep scanning subsequent
    // enzymes and motifs as probes.  A full cap is exhaustive only after all
    // remaining scan dimensions have been inspected.
    if (!complete) break;
  }
  if (complete) {
    for (const motif of explicitMotifs) {
      const reverse = reverseComplement(motif).toUpperCase();
      const motifs: Array<readonly [string, 1 | -1]> = reverse === motif
        ? [[motif, 1]]
        : [[motif, 1], [reverse, -1]];
      for (const [orientedMotif, strand] of motifs) {
        if (!charge(coding.length)) break;
        let position = coding.indexOf(orientedMotif);
        while (position !== -1) {
          if (!charge(1)) break;
          if (!appendSite({ kind: 'site', motif: orientedMotif, position, featurePosition: position, strand })) break;
          position = coding.indexOf(orientedMotif, position + 1);
        }
        if (!complete) break;
      }
      if (!complete) break;
    }
  }
  sites.sort((left, right) => left.featurePosition - right.featurePosition || left.motif.localeCompare(right.motif));
  return { sites, complete, omittedSitesAtLeast, workUnits, limitReason };
}

/**
 * Scan only contiguous authoritative source pieces. Concatenating multipart
 * pieces before scanning would invent restriction sites across genomic gaps.
 * Translation still uses the concatenated biological product, but physical
 * recognition remains segment-local.
 */
function scanDomesticationSitesBySegments(
  oriented: string,
  segments: readonly DomesticationFeatureSegment[],
  enzymes: readonly RestrictionEnzyme[],
  explicitMotifs: readonly string[],
  maxWorkUnits = MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS,
): DomesticationSiteScanResult {
  const sites: GoldenGateDomesticationSite[] = [];
  let complete = true;
  let omittedSitesAtLeast = 0;
  let workUnits = 0;
  let limitReason: DomesticationSiteScanResult['limitReason'] = null;
  for (const segment of segments) {
    const remainingWork = maxWorkUnits - workUnits;
    if (remainingWork <= 0) {
      complete = false;
      limitReason = 'work_limit';
      omittedSitesAtLeast += 1;
      break;
    }
    const segmentResult = scanDomesticationSites(
      oriented.slice(segment.featureStart, segment.featureStart + segment.coordinates.length),
      enzymes,
      explicitMotifs,
      remainingWork,
    );
    workUnits += segmentResult.workUnits;
    if (!segmentResult.complete) complete = false;
    if (segmentResult.limitReason !== null) limitReason = segmentResult.limitReason;
    omittedSitesAtLeast += segmentResult.omittedSitesAtLeast;
    const remainingSites = MAX_GOLDEN_GATE_DOMESTICATION_SITES - sites.length;
    if (remainingSites <= 0 && segmentResult.sites.length > 0) {
      // The cap was reached in an earlier segment.  Any site in a later
      // segment proves that the retained cap was not exhaustive.
      complete = false;
      limitReason = 'site_limit';
      omittedSitesAtLeast += segmentResult.sites.length;
    }
    for (const site of segmentResult.sites) {
      if (sites.length >= MAX_GOLDEN_GATE_DOMESTICATION_SITES) {
        complete = false;
        limitReason = 'site_limit';
        omittedSitesAtLeast += 1;
        break;
      }
      sites.push({ ...site, featurePosition: site.featurePosition + segment.featureStart });
    }
    if (!segmentResult.complete || !complete) break;
  }
  sites.sort((left, right) => left.featurePosition - right.featurePosition || left.motif.localeCompare(right.motif));
  return { sites, complete, omittedSitesAtLeast, workUnits, limitReason };
}

function mapDomesticationSites(
  sites: readonly GoldenGateDomesticationSite[],
  coordinates: readonly number[],
): GoldenGateDomesticationSite[] {
  return sites.flatMap((site) => {
    const covered = coordinates.slice(site.featurePosition, site.featurePosition + site.motif.length);
    if (covered.length !== site.motif.length) return [];
    const sourcePosition = Math.min(...covered);
    const sourceStrand = covered.length < 2 || covered[covered.length - 1] > covered[0] ? 1 : -1;
    return [{ ...site, position: sourcePosition, strand: sourceStrand as 1 | -1 }];
  });
}

function emptyDomesticationResult(
  sequence: string,
  failures: readonly GoldenGateDomesticationFailure[],
  authoritativeBaseCount = 0,
  extra: Partial<DomesticateGoldenGateFeatureResult> = {},
): DomesticateGoldenGateFeatureResult {
  return {
    sequence,
    mutations: [],
    authoritativeScope: 'feature',
    authoritativeBaseCount,
    translatedBaseRange: null,
    complete: false,
    remainingSites: [],
    introducedSites: [],
    failures: [...failures],
    sourceProtein: null,
    productProtein: null,
    proteinIdentity: false,
    ...extra,
  };
}

/**
 * Domesticate an authoritative CDS without editing sequence outside its
 * feature location.
 *
 * The complete feature location is the guarantee scope, including bases
 * excluded by `codon_start` and every stored multipart piece. Gaps between
 * multipart pieces and sequence outside the feature are not in scope and are
 * preserved byte-for-byte. Restriction recognition is segment-local so a site
 * is never invented across a multipart gap. Codon synonyms come exclusively
 * from `codon-tables.ts`; the selected table is used for both source and
 * product translation identity checks.
 */
export function domesticateGoldenGateFeature(
  options: DomesticateGoldenGateFeatureOptions,
): DomesticateGoldenGateFeatureResult {
  const invalidInput = (code: GoldenGateDomesticationFailureCode, message: string): DomesticateGoldenGateFeatureResult => (
    emptyDomesticationResult('', [domesticationFailure(code, message)])
  );
  if (!goldenGateIsPlainObject(options)) {
    return invalidInput('invalid_input', 'Domestication options must be a plain object.');
  }
  const optionRecord = options as unknown as Record<string, unknown>;
  const rawSequence = goldenGateOwnDataValue(optionRecord, 'sequence');
  if (rawSequence === INVALID_GOLDEN_GATE_ACCESSOR) {
    return invalidInput('invalid_input', 'Domestication sequence must be a data property, not an accessor.');
  }
  if (typeof rawSequence !== 'string') {
    return invalidInput('invalid_input', 'Domestication sequence must be a string.');
  }
  if (rawSequence.length === 0) {
    return invalidInput('invalid_input', 'Domestication sequence must not be empty.');
  }
  if (rawSequence.length > MAX_GOLDEN_GATE_PART_LENGTH) {
    return invalidInput('input_limit', `Domestication sequence exceeds ${MAX_GOLDEN_GATE_PART_LENGTH.toLocaleString()} bp.`);
  }
  const source = rawSequence.toUpperCase();

  const rawFeature = goldenGateOwnDataValue(optionRecord, 'feature');
  const featureValidation = validateDomesticationFeature(rawFeature, source.length);
  let failureOverflow = false;
  // Reserve one slot for a deterministic truncation receipt. This keeps
  // malformed agent input from turning diagnostics into an unbounded output.
  const failures: GoldenGateDomesticationFailure[] = [];
  const addFailure = (failure: GoldenGateDomesticationFailure): void => {
    if (failures.length < MAX_GOLDEN_GATE_DOMESTICATION_FAILURES - 1) failures.push(failure);
    else failureOverflow = true;
  };
  for (const failure of featureValidation.failures) addFailure(failure);
  const finalizedFailures = (): GoldenGateDomesticationFailure[] => {
    const output = [...failures];
    if (failureOverflow) {
      output.push(domesticationFailure(
        'failure_limit',
        `Domestication diagnostics were truncated after ${MAX_GOLDEN_GATE_DOMESTICATION_FAILURES - 1} entries.`,
      ));
    }
    return output;
  };
  const emptyResult = (extra: Partial<DomesticateGoldenGateFeatureResult> = {}): DomesticateGoldenGateFeatureResult => (
    emptyDomesticationResult(source, finalizedFailures(), 0, extra)
  );
  if (!featureValidation.feature || featureValidation.failures.length > 0) return emptyResult();

  const location = sourceCoordinatesForFeature(source.length, featureValidation.feature);
  for (const failure of location.failures) addFailure(failure);
  const authoritativeBaseCount = location.coordinates.length;
  const emptyLocatedResult = (extra: Partial<DomesticateGoldenGateFeatureResult> = {}): DomesticateGoldenGateFeatureResult => (
    emptyDomesticationResult(source, finalizedFailures(), authoritativeBaseCount, extra)
  );
  if (location.failures.length > 0 || location.coordinates.length === 0) return emptyLocatedResult();

  const rawCodonStart = goldenGateOwnDataValue(optionRecord, 'codonStart');
  let codonStart: number;
  try {
    codonStart = Number(rawCodonStart);
  } catch {
    codonStart = Number.NaN;
  }
  if (!Number.isInteger(codonStart) || codonStart < 1 || codonStart > 3) {
    addFailure(domesticationFailure('invalid_codon_start', 'codon_start must be exactly 1, 2, or 3.'));
    return emptyLocatedResult();
  }
  const rawTranslationTableId = goldenGateOwnDataValue(optionRecord, 'translationTableId');
  let tableId: number | null | undefined;
  try {
    tableId = rawTranslationTableId == null ? rawTranslationTableId as null | undefined : Number(rawTranslationTableId);
  } catch {
    tableId = Number.NaN;
  }
  const tableResolution = resolveTranslationTable(tableId);
  if (!tableResolution.supported) {
    addFailure(domesticationFailure('unsupported_translation_table', tableResolution.message));
    return emptyLocatedResult();
  }
  const table: CodonTable = tableResolution.table;
  const frame = codonStart - 1;
  const oriented = location.coordinates.map((coordinate, index) => (
    location.strands[index] === -1 ? reverseComplement(source[coordinate]).toUpperCase() : source[coordinate]
  )).join('');
  const coding = oriented.slice(frame);
  const translatedBaseRange = { start: frame, end: oriented.length };
  if (coding.length === 0 || coding.length % 3 !== 0) {
    addFailure(domesticationFailure('invalid_cds_frame', 'CDS sequence after codon_start must contain complete codons.'));
    return emptyLocatedResult({ translatedBaseRange });
  }
  let domesticationWorkUnits = 0;
  let domesticationWorkLimitReached = false;
  const chargeDomesticationWork = (units: number): boolean => {
    if (!Number.isSafeInteger(units) || units < 0 || units > MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS - domesticationWorkUnits) {
      domesticationWorkLimitReached = true;
      return false;
    }
    domesticationWorkUnits += units;
    return true;
  };
  let sourceProtein: string;
  let translationReceipt: TranslationExceptionReceipt | undefined;
  let translationExceptions: TranslationException[] = [];
  if (!chargeDomesticationWork(Math.max(1, Math.ceil(coding.length / 3)))) {
    addFailure(domesticationFailure('work_limit', `Domestication translation exceeded the ${MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS.toLocaleString()}-unit safety limit.`));
    return emptyLocatedResult({ translatedBaseRange });
  }
  try {
    sourceProtein = translateCompleteCds(coding, 0, table);
  } catch (error) {
    addFailure(domesticationFailure('untranslatable_cds', error instanceof Error ? error.message : 'CDS could not be translated.'));
    return emptyLocatedResult({ translatedBaseRange });
  }

  const feature = featureValidation.feature;
  const rawTranslationException = feature.metadata?.transl_except
    ?? feature.metadata?.translExcept;
  if (rawTranslationException !== undefined) {
    if (!chargeDomesticationWork(Math.max(1, location.coordinates.length))) {
      addFailure(domesticationFailure('work_limit', `Domestication translation-exception processing exceeded the ${MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS.toLocaleString()}-unit safety limit.`));
      return emptyLocatedResult({ translatedBaseRange, sourceProtein, productProtein: null, proteinIdentity: false });
    }
    const materialized = materializeTranslationExceptions({
      sequence: source,
      feature,
      qualifier: rawTranslationException,
      codonStart,
      translationTableId: table.id,
    });
    if (!materialized.ok) {
      for (const entry of materialized.diagnostics) addFailure(domesticationFailure(
        'invalid_translation_exception',
        entry.message,
        { diagnostics: [entry] },
      ));
      return emptyLocatedResult({
        translatedBaseRange,
        sourceProtein,
        productProtein: null,
        proteinIdentity: false,
      });
    }
    translationReceipt = materialized.receipt;
    translationExceptions = materialized.exceptions;
    sourceProtein = materialized.materializedProtein;
  }

  const proteinForOrientedSequence = (orientedSequence: string): string | null => {
    if (!chargeDomesticationWork(Math.max(1, Math.ceil(orientedSequence.slice(frame).length / 3)))) return null;
    let translated: string;
    try {
      translated = translateCompleteCds(orientedSequence.slice(frame), 0, table);
    } catch {
      return null;
    }
    if (translationExceptions.length === 0) return translated;
    return translationExceptions.reduce((protein, exception) => (
      exception.codonIndex < 0 || exception.codonIndex >= protein.length
        ? protein
        : `${protein.slice(0, exception.codonIndex)}${exception.residue}${protein.slice(exception.codonIndex + 1)}`
    ), translated);
  };

  const rawForbiddenEnzymes = goldenGateOwnDataValue(optionRecord, 'forbiddenEnzymes');
  const rawForbiddenSites = goldenGateOwnDataValue(optionRecord, 'forbiddenSites');
  const validateBoundedOptionArray = (
    value: unknown,
    label: string,
    maxLength: number,
  ): readonly unknown[] | null => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      addFailure(domesticationFailure('invalid_input', `${label} must be an array when provided.`));
      return null;
    }
    let length: number;
    try {
      length = value.length;
    } catch {
      addFailure(domesticationFailure('invalid_input', `${label} could not be inspected as an array.`));
      return null;
    }
    if (length > maxLength) {
      addFailure(domesticationFailure('input_limit', `${label} accepts at most ${maxLength} entries.`));
      return null;
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      } catch {
        addFailure(domesticationFailure('invalid_input', `${label} contains an unreadable entry.`));
        return null;
      }
      if (!descriptor || !('value' in descriptor)) {
        addFailure(domesticationFailure('invalid_input', `${label} must contain only data entries without holes or accessors.`));
        return null;
      }
      snapshot.push(descriptor.value);
    }
    return snapshot;
  };
  const enzymeValues = validateBoundedOptionArray(rawForbiddenEnzymes, 'forbiddenEnzymes', MAX_GOLDEN_GATE_DOMESTICATION_ENZYMES);
  const siteValues = validateBoundedOptionArray(rawForbiddenSites, 'forbiddenSites', MAX_GOLDEN_GATE_DOMESTICATION_ENZYMES);
  if (enzymeValues === null || siteValues === null) {
    return emptyLocatedResult({
      sourceProtein,
      productProtein: sourceProtein,
      proteinIdentity: true,
      translatedBaseRange,
    });
  }
  const selectedEnzymes: RestrictionEnzyme[] = [];
  for (const rawName of enzymeValues) {
    if (typeof rawName !== 'string' || rawName.length === 0 || rawName.length > 256 || goldenGateHasControlCharacters(rawName)) {
      addFailure(domesticationFailure('invalid_forbidden_enzyme', 'Forbidden enzyme names must be bounded strings without control characters.', {
        enzyme: typeof rawName === 'string' ? boundedGoldenGateEnzymeLabel(rawName) : '<invalid enzyme value>',
      }));
      continue;
    }
    const name = rawName.trim();
    const enzyme = getEnzyme(name);
    if (!enzyme) {
      addFailure(domesticationFailure('invalid_forbidden_enzyme', unsupportedEnzymeError(name), { enzyme: boundedGoldenGateEnzymeLabel(name) }));
    } else if (!selectedEnzymes.some((entry) => entry.name.toLowerCase() === enzyme.name.toLowerCase())) {
      selectedEnzymes.push(enzyme);
    }
  }
  const selectedMotifs: string[] = [];
  for (const rawMotif of siteValues) {
    if (typeof rawMotif !== 'string' || rawMotif.length === 0 || rawMotif.length > MAX_GOLDEN_GATE_DOMESTICATION_MOTIF_LENGTH || goldenGateHasControlCharacters(rawMotif)) {
      addFailure(domesticationFailure(
        'invalid_forbidden_site',
        `Forbidden sites must be non-empty strings of at most ${MAX_GOLDEN_GATE_DOMESTICATION_MOTIF_LENGTH} bases without control characters.`,
        { motif: typeof rawMotif === 'string' ? boundedGoldenGateEnzymeLabel(rawMotif) : '<invalid site value>' },
      ));
      continue;
    }
    const motif = rawMotif.toUpperCase();
    if (!/^[ACGT]+$/.test(motif)) {
      addFailure(domesticationFailure(
        'invalid_forbidden_site',
        `Forbidden site "${boundedGoldenGateEnzymeLabel(rawMotif)}" must contain only A/C/G/T.`,
        { motif: boundedGoldenGateEnzymeLabel(rawMotif) },
      ));
    } else if (!selectedMotifs.includes(motif)) {
      selectedMotifs.push(motif);
    }
  }
  if (failures.length > 0 || failureOverflow) {
    return emptyLocatedResult({
      sourceProtein,
      productProtein: sourceProtein,
      proteinIdentity: true,
      translatedBaseRange,
    });
  }

  const scanSegments = (sequence: string): DomesticationSiteScanResult => {
    const remaining = MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS - domesticationWorkUnits;
    const result = scanDomesticationSitesBySegments(
      sequence,
      location.segments,
      selectedEnzymes,
      selectedMotifs,
      remaining,
    );
    domesticationWorkUnits += result.workUnits;
    return result;
  };
  let reportedSiteScanLimit = false;
  let reportedWorkLimit = false;
  const addScanFailure = (scan: DomesticationSiteScanResult): void => {
    if (scan.complete) return;
    const code = scan.limitReason === 'work_limit' ? 'work_limit' : 'site_scan_limit';
    if (code === 'work_limit' && reportedWorkLimit) return;
    if (code === 'site_scan_limit' && reportedSiteScanLimit) return;
    if (code === 'work_limit') reportedWorkLimit = true;
    else reportedSiteScanLimit = true;
    addFailure(domesticationFailure(
      code,
      code === 'work_limit'
        ? `Domestication site scanning exceeded the ${MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS.toLocaleString()}-unit safety limit.`
        : `Domestication site scanning was capped after ${MAX_GOLDEN_GATE_DOMESTICATION_SITES.toLocaleString()} sites; at least ${Math.max(1, scan.omittedSitesAtLeast)} additional site${scan.omittedSitesAtLeast === 1 ? '' : 's'} may be present.`,
    ));
  };

  const initialScan = scanSegments(oriented);
  addScanFailure(initialScan);
  const initialSites = initialScan.sites;
  if (!initialScan.complete) {
    return emptyLocatedResult({
      sourceProtein,
      productProtein: sourceProtein,
      proteinIdentity: true,
      translatedBaseRange,
      remainingSites: mapDomesticationSites(initialSites, location.coordinates),
    });
  }

  let workingOriented = oriented;
  const mutationByPosition = new Map<number, { position: number; original: string; replacement: string }>();
  const aminoAcidToCodons = getAminoAcidToCodons(table);

  const codonOffsetsForSite = (site: GoldenGateDomesticationSite): number[] => {
    // A recognition site that touches codon_start-excluded sequence is not
    // safely editable through a synonymous CDS substitution. Even if changing
    // a later coding base would happen to erase the motif, that would silently
    // turn a mixed structural/coding site into a different feature contract.
    if (
      site.featurePosition < frame
      || site.featurePosition + site.motif.length > oriented.length
    ) return [];
    const offsets = new Set<number>();
    for (let offset = 0; offset < site.motif.length; offset += 1) {
      const featurePosition = site.featurePosition + offset;
      if (featurePosition < frame || featurePosition >= oriented.length) continue;
      const codonOffset = frame + Math.floor((featurePosition - frame) / 3) * 3;
      if (codonOffset >= frame && codonOffset + 3 <= oriented.length) offsets.add(codonOffset);
    }
    return [...offsets].sort((left, right) => left - right);
  };

  const recordCodonMutation = (codonOffset: number, replacement: string): void => {
    for (let offset = 0; offset < 3; offset += 1) {
      const featurePosition = codonOffset + offset;
      const sourcePosition = location.coordinates[featurePosition];
      const productBase = location.strands[featurePosition] === -1
        ? reverseComplement(replacement[offset]).toUpperCase()
        : replacement[offset];
      const originalBase = source[sourcePosition];
      if (originalBase === productBase) mutationByPosition.delete(sourcePosition);
      else mutationByPosition.set(sourcePosition, {
        position: sourcePosition,
        original: originalBase,
        replacement: productBase,
      });
    }
  };

  let scanIncomplete = false;
  for (let pass = 0; pass < MAX_GOLDEN_GATE_DOMESTICATION_PASSES; pass += 1) {
    const scan = scanSegments(workingOriented);
    addScanFailure(scan);
    if (!scan.complete) {
      scanIncomplete = true;
      break;
    }
    const sites = scan.sites;
    if (sites.length === 0) break;
    let changed = false;
    for (const site of sites) {
      let replacement: string | null = null;
      let replacementOffset: number | null = null;
      for (const codonOffset of codonOffsetsForSite(site)) {
        const originalCodon = workingOriented.slice(codonOffset, codonOffset + 3);
        const aminoAcid = table.codons[originalCodon];
        const alternatives = aminoAcid ? aminoAcidToCodons[aminoAcid] ?? [] : [];
        for (const candidateCodon of alternatives) {
          if (!chargeDomesticationWork(1)) {
            addFailure(domesticationFailure('work_limit', `Domestication codon search exceeded the ${MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS.toLocaleString()}-unit safety limit.`));
            scanIncomplete = true;
            break;
          }
          if (candidateCodon === originalCodon) continue;
          const candidateOriented = `${workingOriented.slice(0, codonOffset)}${candidateCodon}${workingOriented.slice(codonOffset + 3)}`;
          const candidateProtein = proteinForOrientedSequence(candidateOriented);
          if (candidateProtein === null) {
            if (domesticationWorkLimitReached) {
              addFailure(domesticationFailure('work_limit', `Domestication translation exceeded the ${MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS.toLocaleString()}-unit safety limit.`));
              scanIncomplete = true;
              break;
            }
            continue;
          }
          if (candidateProtein !== sourceProtein) continue;
          const candidateScan = scanSegments(candidateOriented);
          addScanFailure(candidateScan);
          if (!candidateScan.complete) {
            scanIncomplete = true;
            break;
          }
          if (candidateScan.sites.some((candidate) => domesticationSiteKey(candidate) === domesticationSiteKey(site))) continue;
          replacement = candidateCodon;
          replacementOffset = codonOffset;
          break;
        }
        if (scanIncomplete || replacement !== null) break;
      }
      if (scanIncomplete) break;
      if (replacement === null || replacementOffset === null) continue;
      workingOriented = `${workingOriented.slice(0, replacementOffset)}${replacement}${workingOriented.slice(replacementOffset + 3)}`;
      recordCodonMutation(replacementOffset, replacement);
      changed = true;
    }
    if (scanIncomplete || !changed) break;
  }

  const mutations = [...mutationByPosition.values()].sort((left, right) => left.position - right.position);
  const productChars = source.split('');
  for (const mutation of mutations) productChars[mutation.position] = mutation.replacement;
  const productSequence = productChars.join('');
  const finalScan: DomesticationSiteScanResult = domesticationWorkUnits >= MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS
    ? {
      sites: [],
      complete: false,
      omittedSitesAtLeast: 1,
      workUnits: 0,
      limitReason: 'work_limit',
    }
    : scanSegments(workingOriented);
  addScanFailure(finalScan);
  const finalSitesOriented = finalScan.sites;
  const initialSiteKeys = new Set(initialSites.map(domesticationSiteKey));
  const remainingSites = mapDomesticationSites(finalSitesOriented, location.coordinates);
  const introducedSites = mapDomesticationSites(
    finalSitesOriented.filter((site) => !initialSiteKeys.has(domesticationSiteKey(site))),
    location.coordinates,
  );
  for (const site of remainingSites) {
    const whollyWithinTranslatedCds = site.featurePosition >= translatedBaseRange.start
      && site.featurePosition + site.motif.length <= translatedBaseRange.end;
    addFailure(domesticationFailure(
      'no_synonymous_change',
      whollyWithinTranslatedCds
        ? `No synonymous codon substitution could remove the forbidden site at source coordinate ${site.position}.`
        : `Forbidden site at source coordinate ${site.position} overlaps authoritative feature sequence outside the translated CDS and cannot be changed safely.`,
      { position: site.position, enzyme: site.enzyme, motif: site.motif },
    ));
    if (!whollyWithinTranslatedCds) {
      addFailure(domesticationFailure(
        'unmodifiable_authoritative_site',
        `Forbidden site at source coordinate ${site.position} remains in authoritative feature sequence outside the translated CDS.`,
        { position: site.position, enzyme: site.enzyme, motif: site.motif },
      ));
    }
    addFailure(domesticationFailure(
      'remaining_forbidden_site',
      `Forbidden ${site.enzyme ?? 'sequence'} site remains at source coordinate ${site.position}.`,
      { position: site.position, enzyme: site.enzyme, motif: site.motif },
    ));
  }
  for (const site of introducedSites) {
    addFailure(domesticationFailure(
      'introduced_forbidden_site',
      `Domestication introduced a forbidden site at source coordinate ${site.position}.`,
      { position: site.position, enzyme: site.enzyme, motif: site.motif },
    ));
  }
  let productProtein: string | null = null;
  try {
    productProtein = proteinForOrientedSequence(workingOriented);
    if (productProtein === null && domesticationWorkLimitReached) {
      addFailure(domesticationFailure('work_limit', `Domestication translation exceeded the ${MAX_GOLDEN_GATE_DOMESTICATION_WORK_UNITS.toLocaleString()}-unit safety limit.`));
    }
  } catch {
    addFailure(domesticationFailure('untranslatable_cds', 'Domesticated CDS could not be translated.'));
  }
  const proteinIdentity = productProtein !== null && productProtein === sourceProtein;
  if (!proteinIdentity) addFailure(domesticationFailure('protein_identity_mismatch', 'Domesticated product protein differs from the source protein.'));
  const finalFailures = finalizedFailures();
  return {
    sequence: productSequence,
    mutations,
    authoritativeScope: 'feature',
    authoritativeBaseCount,
    translatedBaseRange,
    complete: !scanIncomplete && finalScan.complete && finalFailures.length === 0 && remainingSites.length === 0 && introducedSites.length === 0 && proteinIdentity,
    remainingSites,
    introducedSites,
    failures: finalFailures,
    sourceProtein,
    productProtein,
    proteinIdentity,
    ...(translationReceipt ? { translationReceipt } : {}),
  };
}

export interface LegacyDomesticateOptions {
  /** Authoritative CDS location; no implicit whole-sequence assumption. */
  feature: GoldenGateCdsFeature;
  /** Explicit INSDC codon_start value. */
  codonStart: number | string;
  /** Explicit NCBI genetic-code id. */
  translationTableId: number | null;
}

/**
 * The deliberately narrow shape retained for integrations that still need the
 * pre-feature-aware domestication payload.  Callers should migrate to
 * `domesticate()` or, preferably, `domesticateGoldenGateFeature()` so typed
 * failures and protein identity receipts cannot be discarded.
 */
export interface GoldenGateLegacyDomesticationProjection {
  sequence: string;
  mutations: Array<{ position: number; original: string; replacement: string }>;
  /** Explicit migration warning carried with every deprecated projection. */
  warning: string;
  deprecated: true;
}

export const GOLDEN_GATE_LEGACY_PROJECTION_WARNING =
  'Deprecated Golden Gate domestication projection: complete/failure/site/protein receipt fields are omitted; use domesticate() or domesticateGoldenGateFeature().';

export class GoldenGateLegacyDomesticationError extends Error {
  readonly code = 'legacy_domestication_requires_authoritative_context' as const;

  constructor() {
    super('domesticate() requires explicit feature, codonStart, and translationTableId; use domesticateGoldenGateFeature() directly for the typed result, or domesticateLegacyProjection() only for the deprecated narrow payload.');
    this.name = 'GoldenGateLegacyDomesticationError';
  }
}

/**
 * Compatibility wrapper retained only for callers that can provide explicit
 * CDS context. The former implicit whole-sequence/standard-code/frame-1
 * assumptions are intentionally rejected.
 */
export function domesticate(
  seq: string,
  enzyme = DEFAULT_ENZYME,
  options?: LegacyDomesticateOptions,
): DomesticateGoldenGateFeatureResult {
  if (!options) throw new GoldenGateLegacyDomesticationError();
  return domesticateGoldenGateFeature({
    sequence: seq,
    feature: options.feature,
    codonStart: options.codonStart,
    translationTableId: options.translationTableId,
    forbiddenEnzymes: [enzyme],
  });
}

/**
 * @deprecated Use `domesticate()` (typed feature result) or
 * `domesticateGoldenGateFeature()`. This named adapter is the only supported
 * way to request the historical `{ sequence, mutations }` projection, and it
 * carries a warning so a lossy compatibility boundary is visible in receipts.
 */
export function domesticateLegacyProjection(
  seq: string,
  enzyme = DEFAULT_ENZYME,
  options?: LegacyDomesticateOptions,
): GoldenGateLegacyDomesticationProjection {
  const result = domesticate(seq, enzyme, options);
  return {
    sequence: result.sequence,
    mutations: result.mutations,
    warning: GOLDEN_GATE_LEGACY_PROJECTION_WARNING,
    deprecated: true,
  };
}

/**
 * @deprecated Use `domesticateGoldenGateFeature()` with an explicit feature,
 * frame, and translation table. This compatibility adapter is contained behind
 * the same authoritative context requirement as `domesticate()`.
 *
 * Domesticate ONLY the internal insert of a flanked Type IIS part, preserving
 * the structural flanking recognition sites the assembly depends on.
 *
 * `domesticate()` removes every recognition site it finds, including the
 * flanking GGTCTC/GAGACC (BsaI) handles — so running it over a whole flanked
 * part strips the flanks and makes the part un-assemblable ("missing flanking
 * sites"), even when the part has zero INTERNAL sites. This helper uses
 * `getGoldenGatePartBoundary` to mutate only the insert window and splice it
 * back between the untouched flanks. When the part has no detectable flanks
 * (e.g. a bare CDS being prepared as a part) it falls back to whole-sequence
 * domestication. Mutation positions are reported in full-part coordinates.
 */
export function domesticatePartInternals(
  seq: string,
  enzyme = DEFAULT_ENZYME,
  options?: LegacyDomesticateOptions,
): GoldenGateLegacyDomesticationProjection {
  if (!options) throw new GoldenGateLegacyDomesticationError();
  if (typeof seq !== 'string') throw new GoldenGateLegacyDomesticationError();
  const inspected = inspectNucleotideSequence(seq);
  if (inspected.sequence !== seq) {
    throw new Error('domesticatePartInternals requires an unformatted, uppercase DNA sequence so feature coordinates cannot shift during flank extraction.');
  }
  const boundary = getGoldenGatePartBoundary({ name: 'part', sequence: seq }, enzyme);
  if (
    boundary.insertStart != null &&
    boundary.insertEnd != null &&
    boundary.insertEnd > boundary.insertStart
  ) {
    const insertStart = boundary.insertStart;
    const insert = seq.toUpperCase().slice(insertStart, boundary.insertEnd);
    const cleaned = domesticateGoldenGateFeature({
      sequence: insert,
      feature: options.feature,
      codonStart: options.codonStart,
      translationTableId: options.translationTableId,
      forbiddenEnzymes: [enzyme],
    });
    return {
      sequence: seq.toUpperCase().slice(0, insertStart) + cleaned.sequence + seq.toUpperCase().slice(boundary.insertEnd),
      mutations: cleaned.mutations.map((m) => ({ ...m, position: m.position + insertStart })),
      warning: GOLDEN_GATE_LEGACY_PROJECTION_WARNING,
      deprecated: true,
    };
  }
  const cleaned = domesticateGoldenGateFeature({
    sequence: seq.toUpperCase(),
    feature: options.feature,
    codonStart: options.codonStart,
    translationTableId: options.translationTableId,
    forbiddenEnzymes: [enzyme],
  });
  return {
    sequence: cleaned.sequence,
    mutations: cleaned.mutations,
    warning: GOLDEN_GATE_LEGACY_PROJECTION_WARNING,
    deprecated: true,
  };
}
