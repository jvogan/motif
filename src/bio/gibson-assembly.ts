import type { Feature } from './types';
import { calculateTm, type TmOptions } from './tm-calculator';
import {
  aliasRemovedProductCoordinates,
  emptySourceToProductMap,
  mapFeaturesThroughSourceCoordinates,
  type SourceToProductCoordinateMap,
} from './assembly-feature-mapping';
import { IUPAC_BASE_EXPANSIONS } from './translate';
import { validateFeatureCollection } from './feature-bounds';

export interface GibsonFragment {
  name: string;
  sequence: string;
  features?: Feature[];
}

/** Maximum length for a user-facing fragment or feature name. */
export const MAX_GIBSON_NAME_LENGTH = 256;
/** Maximum number of annotations accepted on one Gibson fragment. */
export const MAX_GIBSON_FEATURES_PER_FRAGMENT = 10_000;
/** Maximum number of authoritative pieces accepted on one annotation. */
export const MAX_GIBSON_SUBRANGES_PER_FEATURE = 10_000;
/** Maximum annotation units inspected during one input validation pass. */
export const MAX_GIBSON_FEATURE_WORK_UNITS = 1_000_000;
export const MAX_GIBSON_METADATA_DEPTH = 4;
export const MAX_GIBSON_METADATA_KEYS = 256;
export const MAX_GIBSON_METADATA_STRING_LENGTH = 4_096;
export const MAX_GIBSON_METADATA_BYTES = 65_536;

export type GibsonInputValidationStatus = 'valid' | 'invalid_input';

export interface GibsonInputValidation {
  status: GibsonInputValidationStatus;
  valid: boolean;
  errors: string[];
  totalLength: number;
  featureWorkUnits: number;
}

export class GibsonInputError extends Error {
  readonly code = 'invalid_input' as const;
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = 'GibsonInputError';
    this.issues = issues;
  }
}

export interface Overlap {
  sequence: string;
  length: number;
  tm: number;
  /** Conditions and model used for the screening Tm (not a reaction claim). */
  tmEvidence: GibsonOverlapTmEvidence;
  /** Position within seq1 where the overlap starts (= seq1.length - overlap.length) */
  position1: number;
  /** Position within seq2 where the overlap ends (= overlap.length) */
  position2: number;
}

export interface GibsonOverlapTmEvidence {
  method: 'nearest-neighbor' | 'wallace';
  saltCorrection: 'owczarzy' | 'none';
  naConcentrationMolar: number;
  mgConcentrationMolar: number;
  dntpConcentrationMolar: number;
  strandConcentrationMolar: number;
  assumption: string;
}

export type OverlapSearchReason = 'none' | 'exact' | 'multiple_exact' | 'ambiguous_symbols' | 'invalid_input';

/** Complete overlap evidence, including alternatives that the legacy helper hid. */
export interface OverlapSearchResult {
  candidates: Overlap[];
  maximalCandidates: Overlap[];
  selected: Overlap | null;
  /** True only when one maximal exact overlap is supported by the inputs. */
  unique: boolean;
  /** True when IUPAC ambiguity or multiple exact lengths require review. */
  ambiguous: boolean;
  reason: OverlapSearchReason;
}

interface GibsonResultBase {
  sequence: string;
  features: Feature[];
  overlaps: Overlap[];
  errors: string[];
  warnings: string[];
  /** One entry per tested junction, including the circular closing seam. */
  overlapSearches?: OverlapSearchResult[];
}

export interface GibsonSuccessResult extends GibsonResultBase {
  topology: 'linear' | 'circular';
  success: true;
}

export interface GibsonFailureResult extends GibsonResultBase {
  /** Null when the caller did not supply a valid physical topology. */
  topology: 'linear' | 'circular' | null;
  success: false;
  /** Bounded diagnostic spelling retained only for an invalid topology input. */
  requestedTopology?: string;
}

export type GibsonResult = GibsonSuccessResult | GibsonFailureResult;

const DEFAULT_MIN_OVERLAP = 15;
const DEFAULT_MAX_OVERLAP = 60;
export const MIN_GIBSON_OVERLAP = 8;
export const MAX_GIBSON_OVERLAP = 200;
export const MAX_GIBSON_FRAGMENTS = 64;
export const MAX_GIBSON_FRAGMENT_LENGTH = 500_000;
export const MAX_GIBSON_TOTAL_INPUT_LENGTH = 1_000_000;
export const MAX_GIBSON_WORK_UNITS = 2_000_000;
const IDEAL_OVERLAP_TM = 50; // °C minimum recommended Tm
const GIBSON_TM_OPTIONS: TmOptions = {
  method: 'nearest-neighbor',
  // Gibson mixes differ by formulation; these bounded conditions are an
  // explicit screening convention, not a claim about any particular reagent.
  naConcentration: 50,
  mgConcentration: 0,
  dntpConcentration: 0,
  primerConcentration: 250,
  saltCorrection: 'owczarzy',
};
const GIBSON_TM_EVIDENCE: GibsonOverlapTmEvidence = {
  method: 'nearest-neighbor',
  saltCorrection: 'owczarzy',
  naConcentrationMolar: 50e-3,
  mgConcentrationMolar: 0,
  dntpConcentrationMolar: 0,
  strandConcentrationMolar: 250e-9,
  assumption: 'Screening-only 50 mM Na+, no explicitly modelled Mg2+/dNTPs, and 250 nM strand concentration; verify against the actual assembly mix.',
};

type NormalizedOverlapRange = { minOverlap: number; maxOverlap: number };

const GIBSON_DNA_SYMBOLS = /^[ACGTRYSWKMBDHVN]*$/u;
const GIBSON_CANONICAL_DNA = /^[ACGT]*$/u;
const metadataTextEncoder = new TextEncoder();
const GIBSON_FEATURE_TYPES: ReadonlySet<Feature['type']> = new Set([
  'orf', 'gene', 'cds', 'promoter', 'terminator', 'rbs', 'origin', 'resistance',
  'restriction_site', 'primer_bind', 'misc_feature', 'mRNA', 'rRNA', 'tRNA',
  'ncRNA', 'regulatory', 'repeat_region', 'sig_peptide', 'mat_peptide',
  'transit_peptide', 'intron', 'exon', 'polyA_signal', 'enhancer', 'custom',
]);

function utf8ByteLength(value: string): number {
  return metadataTextEncoder.encode(value).byteLength;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function normalizeOverlapRange(
  minOverlap: unknown,
  maxOverlap: unknown,
): NormalizedOverlapRange | null {
  if (
    typeof minOverlap !== 'number'
    || typeof maxOverlap !== 'number'
    || !Number.isSafeInteger(minOverlap)
    || !Number.isSafeInteger(maxOverlap)
    || minOverlap < MIN_GIBSON_OVERLAP
    || maxOverlap > MAX_GIBSON_OVERLAP
    || minOverlap > maxOverlap
  ) return null;
  return { minOverlap, maxOverlap };
}

function invalidOverlapSearch(): OverlapSearchResult {
  return {
    candidates: [],
    maximalCandidates: [],
    selected: null,
    unique: false,
    ambiguous: false,
    reason: 'invalid_input',
  };
}

function boundedText(value: unknown, label: string, maxLength = MAX_GIBSON_NAME_LENGTH): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || hasControlCharacters(value)) {
    return `${label} must be a non-empty string of at most ${maxLength} characters without control characters.`;
  }
  if (value.trim().length === 0) return `${label} must contain a non-whitespace name.`;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

interface MetadataValidation {
  errors: string[];
  units: number;
  bytes: number;
}

function validateMetadata(value: unknown, path: string): MetadataValidation {
  const errors: string[] = [];
  const seen = new WeakSet<object>();
  let units = 0;
  let bytes = 0;
  const visit = (candidate: unknown, candidatePath: string, depth: number): void => {
    units += 1;
    if (units > MAX_GIBSON_METADATA_KEYS || bytes > MAX_GIBSON_METADATA_BYTES) return;
    if (candidate === null || typeof candidate === 'boolean') {
      bytes += candidate === null ? 4 : 5;
      return;
    }
    if (typeof candidate === 'string') {
      if (candidate.length > MAX_GIBSON_METADATA_STRING_LENGTH || hasControlCharacters(candidate)) {
        errors.push(`${candidatePath} must be a bounded string without control characters.`);
        return;
      }
      bytes += utf8ByteLength(candidate);
      return;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) errors.push(`${candidatePath} must be finite.`);
      bytes += 8;
      return;
    }
    if (typeof candidate !== 'object' || candidate === undefined) {
      errors.push(`${candidatePath} must contain only plain JSON-compatible values.`);
      return;
    }
    if (seen.has(candidate)) {
      errors.push(`${candidatePath} must not contain cycles.`);
      return;
    }
    seen.add(candidate);
    if (depth >= MAX_GIBSON_METADATA_DEPTH) {
      errors.push(`${candidatePath} exceeds the ${MAX_GIBSON_METADATA_DEPTH}-level metadata depth limit.`);
      return;
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_GIBSON_METADATA_KEYS) errors.push(`${candidatePath} exceeds the metadata item limit.`);
      for (const [index, item] of candidate.slice(0, MAX_GIBSON_METADATA_KEYS).entries()) visit(item, `${candidatePath}[${index}]`, depth + 1);
      return;
    }
    if (!isRecord(candidate)) {
      errors.push(`${candidatePath} must be a plain object.`);
      return;
    }
    const entries = Object.entries(candidate);
    if (entries.length > MAX_GIBSON_METADATA_KEYS) errors.push(`${candidatePath} exceeds the metadata key limit.`);
    for (const [key, item] of entries.slice(0, MAX_GIBSON_METADATA_KEYS)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        errors.push(`${candidatePath} contains a prohibited object key.`);
        continue;
      }
      if (key.length > MAX_GIBSON_METADATA_STRING_LENGTH || hasControlCharacters(key)) {
        errors.push(`${candidatePath} contains an overlong or control-character key.`);
        continue;
      }
      bytes += utf8ByteLength(key);
      visit(item, `${candidatePath}.${key}`, depth + 1);
    }
  };
  visit(value, path, 0);
  if (units > MAX_GIBSON_METADATA_KEYS) errors.push(`${path} exceeds the ${MAX_GIBSON_METADATA_KEYS}-node metadata work limit.`);
  if (bytes > MAX_GIBSON_METADATA_BYTES) errors.push(`${path} exceeds the ${MAX_GIBSON_METADATA_BYTES.toLocaleString()}-byte metadata limit.`);
  return { errors, units, bytes };
}

function featureValidationErrors(
  value: unknown,
  sequenceLength: number,
  fragmentLabel: string,
  featureIndex: number,
): { errors: string[]; workUnits: number } {
  const path = `${fragmentLabel}.features[${featureIndex}]`;
  if (!isRecord(value)) return { errors: [`${path} must be a plain feature object.`], workUnits: 1 };
  const feature = value as Partial<Feature> & { metadata?: unknown };
  const errors: string[] = [];
  const idError = boundedText(feature.id, `${path}.id`);
  if (idError) errors.push(idError);
  const nameError = boundedText(feature.name, `${path}.name`);
  if (nameError) errors.push(nameError);
  const typeError = boundedText(feature.type, `${path}.type`, 64);
  if (typeError) errors.push(typeError);
  else if (!GIBSON_FEATURE_TYPES.has(feature.type as Feature['type'])) {
    errors.push(`${path}.type must be one of the supported feature types.`);
  }
  if (typeof feature.color !== 'string' || feature.color.length > 128 || hasControlCharacters(feature.color)) {
    errors.push(`${path}.color must be a bounded string without control characters.`);
  }
  let metadataUnits = 0;
  if (!isRecord(feature.metadata)) errors.push(`${path}.metadata must be a plain object.`);
  else {
    const metadata = validateMetadata(feature.metadata, `${path}.metadata`);
    metadataUnits = metadata.units;
    errors.push(...metadata.errors);
  }
  const hasValidStrand = feature.strand === -1 || feature.strand === 0 || feature.strand === 1;
  if (!hasValidStrand) errors.push(`${path}.strand must be -1, 0, or 1.`);
  const validCoordinate = (coordinate: unknown): coordinate is number => (
    Number.isSafeInteger(coordinate) && (coordinate as number) >= 0 && (coordinate as number) <= sequenceLength
  );
  if (!validCoordinate(feature.start) || !validCoordinate(feature.end) || (feature.end as number) <= (feature.start as number)) {
    errors.push(`${path} must have safe integer coordinates with 0 <= start < end <= sequence length.`);
  }

  let workUnits = 1 + metadataUnits;
  if (feature.subRanges !== undefined) {
    if (!Array.isArray(feature.subRanges) || feature.subRanges.length === 0) {
      errors.push(`${path}.subRanges must be a non-empty array when present.`);
    } else if (feature.subRanges.length > MAX_GIBSON_SUBRANGES_PER_FEATURE) {
      errors.push(`${path}.subRanges exceeds the ${MAX_GIBSON_SUBRANGES_PER_FEATURE.toLocaleString()}-piece limit.`);
    } else {
      workUnits += feature.subRanges.length;
      for (const [rangeIndex, rawRange] of feature.subRanges.entries()) {
        const rangePath = `${path}.subRanges[${rangeIndex}]`;
        if (!isRecord(rawRange)) {
          errors.push(`${rangePath} must be an object.`);
          continue;
        }
        const range = rawRange as { start?: unknown; end?: unknown; strand?: unknown };
        if (!validCoordinate(range.start) || !validCoordinate(range.end) || (range.end as number) <= (range.start as number)) {
          errors.push(`${rangePath} must have safe integer coordinates with 0 <= start < end <= sequence length.`);
        } else if (validCoordinate(feature.start) && validCoordinate(feature.end)
          && ((range.start as number) < (feature.start as number) || (range.end as number) > (feature.end as number))) {
          errors.push(`${rangePath} must remain inside the feature envelope.`);
        }
        if (range.strand !== undefined && range.strand !== -1 && range.strand !== 0 && range.strand !== 1) {
          errors.push(`${rangePath}.strand must be -1, 0, or 1 when provided.`);
        }
      }
    }
  }
  return { errors, workUnits };
}

/**
 * Validate the complete Gibson input boundary before overlap work or feature
 * mapping starts. The overlap search can report IUPAC ambiguity separately,
 * but the materializing assembler requires canonical A/C/G/T input.
 */
export function validateGibsonFragments(fragments: unknown): GibsonInputValidation {
  const errors: string[] = [];
  if (!Array.isArray(fragments)) {
    return { status: 'invalid_input', valid: false, errors: ['Gibson assembly fragments must be an array.'], totalLength: 0, featureWorkUnits: 0 };
  }
  if (fragments.length > MAX_GIBSON_FRAGMENTS) {
    errors.push(`Gibson assembly supports at most ${MAX_GIBSON_FRAGMENTS} fragments.`);
  }
  let totalLength = 0;
  let featureWorkUnits = 0;
  const boundedFragments = fragments.slice(0, MAX_GIBSON_FRAGMENTS);
  for (const [index, rawFragment] of boundedFragments.entries()) {
    const fragmentLabel = `Gibson fragment ${index + 1}`;
    if (!isRecord(rawFragment)) {
      errors.push(`${fragmentLabel} must be an object.`);
      continue;
    }
    const fragment = rawFragment as Partial<GibsonFragment>;
    const nameError = boundedText(fragment.name, `${fragmentLabel}.name`);
    if (nameError) errors.push(nameError);
    if (typeof fragment.sequence !== 'string') {
      errors.push(`${fragmentLabel}.sequence must be a DNA string.`);
      continue;
    }
    if (fragment.sequence.length === 0) errors.push(`${fragmentLabel}.sequence must not be empty.`);
    if (fragment.sequence.length > MAX_GIBSON_FRAGMENT_LENGTH) {
      errors.push(`${fragmentLabel}.sequence exceeds ${MAX_GIBSON_FRAGMENT_LENGTH.toLocaleString()} bp.`);
    }
    if (!GIBSON_DNA_SYMBOLS.test(fragment.sequence.toUpperCase())) {
      errors.push(`${fragmentLabel}.sequence contains symbols outside the DNA/IUPAC alphabet.`);
    }
    if (totalLength <= MAX_GIBSON_TOTAL_INPUT_LENGTH - fragment.sequence.length) totalLength += fragment.sequence.length;
    else {
      totalLength = MAX_GIBSON_TOTAL_INPUT_LENGTH + 1;
      errors.push(`Gibson assembly input exceeds ${MAX_GIBSON_TOTAL_INPUT_LENGTH.toLocaleString()} bp in total.`);
    }
    if (fragment.features !== undefined) {
      if (!Array.isArray(fragment.features)) {
        errors.push(`${fragmentLabel}.features must be an array when provided.`);
      } else {
        const validation = validateFeatureCollection(fragment.features, {
          label: `${fragmentLabel}.features`,
          sequenceLength: fragment.sequence.length,
        });
        if (!validation.valid) {
          featureWorkUnits += validation.featureWorkUnits;
          errors.push(...validation.issues.map((issue) => issue.message));
        } else if (fragment.features.length > MAX_GIBSON_FEATURES_PER_FRAGMENT) {
          errors.push(`${fragmentLabel}.features exceeds the ${MAX_GIBSON_FEATURES_PER_FRAGMENT.toLocaleString()}-feature limit.`);
        } else {
          featureWorkUnits += fragment.features.length;
          for (const [featureIndex, rawFeature] of fragment.features.entries()) {
            const featureValidation = featureValidationErrors(rawFeature, fragment.sequence.length, fragmentLabel, featureIndex);
            featureWorkUnits += featureValidation.workUnits;
            errors.push(...featureValidation.errors);
            if (featureWorkUnits > MAX_GIBSON_FEATURE_WORK_UNITS) {
              errors.push(`Gibson feature validation exceeds the ${MAX_GIBSON_FEATURE_WORK_UNITS.toLocaleString()}-unit safety limit.`);
              break;
            }
          }
        }
      }
    }
  }
  if (fragments.length > MAX_GIBSON_FRAGMENTS) {
    totalLength = Math.max(totalLength, MAX_GIBSON_TOTAL_INPUT_LENGTH + 1);
  }
  return {
    status: errors.length === 0 ? 'valid' : 'invalid_input',
    valid: errors.length === 0,
    errors,
    totalLength,
    featureWorkUnits,
  };
}

function validGibsonDnaSequence(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_GIBSON_FRAGMENT_LENGTH && GIBSON_DNA_SYMBOLS.test(value.toUpperCase());
}

function validTopology(value: unknown): value is 'linear' | 'circular' {
  return value === 'linear' || value === 'circular';
}

function gibsonInputErrorResult(
  topology: 'linear' | 'circular' | null,
  errors: string[],
  warnings: string[] = [],
  requestedTopology?: string,
): GibsonResult {
  return {
    sequence: '',
    features: [],
    overlaps: [],
    topology,
    success: false,
    errors,
    warnings,
    overlapSearches: [],
    ...(requestedTopology === undefined ? {} : { requestedTopology }),
  };
}

function fillFirstFragmentMap(map: SourceToProductCoordinateMap): void {
  for (let source = 0; source < map.sourceLength; source++) map.sourceToProduct[source] = source;
}

function fillNextFragmentMap(
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

function productCoordinateMap(
  length: number,
  closingOverlapLength: number,
): SourceToProductCoordinateMap {
  const productLength = length - closingOverlapLength;
  const sourceToProduct = Array.from({ length }, (_, source) => (
    source < productLength ? source : source - productLength
  ));
  return { sourceLength: length, productLength, sourceToProduct };
}

function closingJunctionFeature(
  leftName: string,
  rightName: string,
  overlap: Overlap,
  productLength: number,
): Feature | null {
  if (overlap.length <= 0 || productLength <= 0) return null;
  const seamLength = Math.min(overlap.length, productLength);
  return {
    id: crypto.randomUUID(),
    name: `Junction: ${leftName}×${rightName} (${overlap.length} bp, closing)`,
    type: 'misc_feature',
    start: 0,
    end: productLength,
    strand: 1,
    color: '#8F4842',
    metadata: {
      source: 'gibson_assembly',
      overlapLength: overlap.length,
      overlapTm: overlap.tm,
      overlapSequence: overlap.sequence,
      closing: true,
    },
    subRanges: [
      { start: productLength - seamLength, end: productLength, strand: 1 },
      { start: 0, end: seamLength, strand: 1 },
    ],
  };
}

/**
 * Find overlap between the 3' end of seq1 and the 5' end of seq2.
 * Scans from maxOverlap down to minOverlap for an exact match.
 */
export function findOverlap(
  seq1: string,
  seq2: string,
  minOverlap = DEFAULT_MIN_OVERLAP,
  maxOverlap = DEFAULT_MAX_OVERLAP,
): Overlap | null {
  return analyzeOverlap(seq1, seq2, minOverlap, maxOverlap).selected;
}

function isUnambiguousDna(value: string): boolean {
  return /^[ACGT]+$/.test(value);
}

function iupacCompatible(left: string, right: string): boolean {
  const leftBases = IUPAC_BASE_EXPANSIONS[left];
  const rightBases = IUPAC_BASE_EXPANSIONS[right];
  if (!leftBases || !rightBases) return false;
  return leftBases.some((base) => rightBases.includes(base));
}

function makeOverlap(sequence: string, seq1Length: number): Overlap {
  const tmResult = calculateTm(sequence, GIBSON_TM_OPTIONS);
  const tmMethod: GibsonOverlapTmEvidence['method'] = tmResult.method.startsWith('nearest-neighbor')
    ? 'nearest-neighbor'
    : 'wallace';
  return {
    sequence,
    length: sequence.length,
    tm: tmResult.status === 'exact' ? tmResult.tm : 0,
    tmEvidence: {
      ...GIBSON_TM_EVIDENCE,
      method: tmMethod,
      saltCorrection: tmMethod === 'nearest-neighbor' ? 'owczarzy' : 'none',
    },
    position1: seq1Length - sequence.length,
    position2: sequence.length,
  };
}

/**
 * Enumerate every exact tail/head length in the requested range. Ambiguous
 * IUPAC symbols are reported as a separate state and never treated as exact
 * homology; callers can choose to enumerate concrete expansions explicitly.
 */
export function analyzeOverlap(
  seq1: string,
  seq2: string,
  minOverlap = DEFAULT_MIN_OVERLAP,
  maxOverlap = DEFAULT_MAX_OVERLAP,
): OverlapSearchResult {
  const range = normalizeOverlapRange(minOverlap, maxOverlap);
  if (
    !range
    || typeof seq1 !== 'string'
    || typeof seq2 !== 'string'
    || seq1.length > MAX_GIBSON_FRAGMENT_LENGTH
    || seq2.length > MAX_GIBSON_FRAGMENT_LENGTH
    || !validGibsonDnaSequence(seq1)
    || !validGibsonDnaSequence(seq2)
  ) return invalidOverlapSearch();
  const upper1 = seq1.toUpperCase();
  const upper2 = seq2.toUpperCase();
  const effectiveMax = Math.min(range.maxOverlap, upper1.length, upper2.length);
  const candidates: Overlap[] = [];
  let plausibleAmbiguous = false;
  for (let length = effectiveMax; length >= range.minOverlap; length -= 1) {
    const tail = upper1.slice(upper1.length - length);
    const head = upper2.slice(0, length);
    if (tail === head && isUnambiguousDna(tail)) {
      candidates.push(makeOverlap(tail, upper1.length));
      continue;
    }
    if (tail.length === head.length && tail.length > 0 && [...tail].every((base, index) => {
      return iupacCompatible(base, head[index]);
    }) && (!isUnambiguousDna(tail) || !isUnambiguousDna(head))) {
      plausibleAmbiguous = true;
    }
  }
  const maxLength = candidates[0]?.length ?? 0;
  const maximalCandidates = candidates.filter((candidate) => candidate.length === maxLength);
  const selected = maximalCandidates[0] ?? null;
  if (candidates.length > 0) {
    return {
      candidates,
      maximalCandidates,
      selected,
      unique: maximalCandidates.length === 1 && candidates.length === 1,
      ambiguous: maximalCandidates.length !== 1 || candidates.length !== 1,
      reason: candidates.length === 1 ? 'exact' : 'multiple_exact',
    };
  }
  return {
    candidates: [],
    maximalCandidates: [],
    selected: null,
    unique: false,
    ambiguous: plausibleAmbiguous,
    reason: plausibleAmbiguous ? 'ambiguous_symbols' : 'none',
  };
}

/**
 * Simulate Gibson Assembly — join fragments via their overlapping homology regions.
 * For circular assembly the last fragment's 3' end must overlap the first fragment's 5' end.
 */
export function gibsonAssemble(
  fragments: GibsonFragment[],
  minOverlap = DEFAULT_MIN_OVERLAP,
  maxOverlap = DEFAULT_MAX_OVERLAP,
  topology: unknown = 'linear',
): GibsonResult {
  const range = normalizeOverlapRange(minOverlap, maxOverlap);
  const safeTopology = topology === 'circular' ? 'circular' : 'linear';
  const errors: string[] = [];
  const warnings: string[] = [];
  const overlaps: Overlap[] = [];
  const overlapSearches: OverlapSearchResult[] = [];

  if (!range) {
    return {
      sequence: '',
      features: [],
      overlaps,
      topology: safeTopology,
      success: false,
      errors: [`Gibson overlap bounds must be safe integers from ${MIN_GIBSON_OVERLAP} to ${MAX_GIBSON_OVERLAP} bp with minimum no larger than maximum.`],
      warnings,
      overlapSearches,
    };
  }
  if (!validTopology(topology)) {
    const requestedTopology = typeof topology === 'string'
      ? topology.slice(0, 128)
      : typeof topology;
    return gibsonInputErrorResult(
      null,
      ['Gibson topology must be exactly "linear" or "circular".'],
      warnings,
      requestedTopology,
    );
  }
  const inputValidation = validateGibsonFragments(fragments);
  if (!inputValidation.valid) {
    return gibsonInputErrorResult(safeTopology, inputValidation.errors, warnings);
  }
  const totalInputLength = inputValidation.totalLength;
  const workUnits = totalInputLength
    + inputValidation.featureWorkUnits
    + (fragments.length + (safeTopology === 'circular' ? 1 : 0)) * range.maxOverlap;
  if (workUnits > MAX_GIBSON_WORK_UNITS) {
    return {
      sequence: '',
      features: [],
      overlaps,
      topology: safeTopology,
      success: false,
      errors: [`Gibson assembly input work exceeds the ${MAX_GIBSON_WORK_UNITS.toLocaleString()}-unit safety limit.`],
      warnings,
      overlapSearches,
    };
  }
  minOverlap = range.minOverlap;
  maxOverlap = range.maxOverlap;

  if (fragments.length < 2) {
    return {
      sequence: '',
      features: [],
      overlaps: [],
      topology: safeTopology,
      success: false,
      errors: ['Gibson Assembly requires at least 2 fragments'],
      warnings: [],
      overlapSearches,
    };
  }

  const sequenceCounts = new Map<string, number>();
  for (const fragment of fragments) {
    const normalized = fragment.sequence.toUpperCase();
    sequenceCounts.set(normalized, (sequenceCounts.get(normalized) ?? 0) + 1);
  }
  if (fragments.some((fragment) => !GIBSON_CANONICAL_DNA.test(fragment.sequence.toUpperCase()))) {
    errors.push('Gibson assembly requires canonical A/C/G/T fragment sequences; IUPAC ambiguity cannot be materialized as an exact product.');
  }
  for (const count of sequenceCounts.values()) {
    if (count > 1) {
      warnings.push(`${count} Gibson fragments have identical sequences — duplicate fragments can assemble ambiguously.`);
      break;
    }
  }

  // Find overlaps between each consecutive pair (linear assembly)
  for (let i = 0; i < fragments.length - 1; i++) {
    const a = fragments[i];
    const b = fragments[i + 1];
    const search = analyzeOverlap(a.sequence, b.sequence, minOverlap, maxOverlap);
    overlapSearches.push(search);
    const ov = search.selected;
    if (ov === null) {
      errors.push(
        search.reason === 'ambiguous_symbols'
          ? `Overlap between fragment "${a.name}" and "${b.name}" contains IUPAC ambiguity symbols; exact homology cannot be certified.`
          : `No overlap found between fragment "${a.name}" and "${b.name}" (need ${minOverlap}–${maxOverlap} bp exact match)`,
      );
      warnings.push(`No overlap detected for "${a.name}" → "${b.name}". Add ${minOverlap}–${maxOverlap} bp homology arms before assembly.`);
      overlaps.push({
        sequence: '',
        length: 0,
        tm: 0,
        tmEvidence: { ...GIBSON_TM_EVIDENCE, saltCorrection: 'none' },
        position1: a.sequence.length,
        position2: 0,
      });
    } else {
      if (!search.unique) {
        warnings.push(`Overlap "${a.name}" → "${b.name}" has alternate exact lengths (${search.candidates.map((candidate) => candidate.length).join(', ')} bp); the longest is selected.`);
      }
      if (ov.tm < IDEAL_OVERLAP_TM) {
        warnings.push(
          `Overlap "${a.name}" → "${b.name}" has low Tm (${ov.tm.toFixed(1)} °C; recommended ≥ ${IDEAL_OVERLAP_TM} °C).`,
        );
      }
      overlaps.push(ov);
    }
  }

  // Circular: the last fragment's 3' end must overlap the first fragment's 5'
  // end. Detect that closing seam now — before the duplicate/low-Tm checks, so
  // they evaluate it too — and make a MISSING seam a hard error rather than a
  // silently-linear product with the closing overlap duplicated at both ends.
  // The seam must be checked explicitly: otherwise a cyclic fragment set can
  // become a linear product carrying the closing overlap twice.
  let closingOverlap: Overlap | null = null;
  if (safeTopology === 'circular' && fragments.length >= 2) {
    const last = fragments[fragments.length - 1];
    const first = fragments[0];
    const closingSearch = analyzeOverlap(last.sequence, first.sequence, minOverlap, maxOverlap);
    overlapSearches.push(closingSearch);
    closingOverlap = closingSearch.selected;
    if (closingOverlap === null) {
      errors.push(
        closingSearch.reason === 'ambiguous_symbols'
          ? `Closing overlap between fragment "${last.name}" and "${first.name}" contains IUPAC ambiguity symbols; exact homology cannot be certified.`
          : `No closing overlap found between fragment "${last.name}" and "${first.name}" — required for circular assembly (need ${minOverlap}–${maxOverlap} bp exact match)`,
      );
      warnings.push(
        `No closing overlap for circular assembly ("${last.name}" → "${first.name}"). Add ${minOverlap}–${maxOverlap} bp homology between the last and first fragments, or assemble as linear.`,
      );
    } else {
      if (!closingSearch.unique) {
        warnings.push(`Closing overlap "${last.name}" → "${first.name}" has alternate exact lengths (${closingSearch.candidates.map((candidate) => candidate.length).join(', ')} bp); the longest is selected.`);
      }
      if (closingOverlap.tm < IDEAL_OVERLAP_TM) {
        warnings.push(
          `Closing overlap "${last.name}" → "${first.name}" has low Tm (${closingOverlap.tm.toFixed(1)} °C; recommended ≥ ${IDEAL_OVERLAP_TM} °C).`,
        );
      }
      overlaps.push(closingOverlap);
    }
  }

  const overlapCounts = new Map<string, number>();
  for (const overlap of overlaps) {
    if (overlap.sequence.length === 0) continue;
    overlapCounts.set(overlap.sequence, (overlapCounts.get(overlap.sequence) ?? 0) + 1);
  }
  for (const [sequence, count] of overlapCounts) {
    if (count > 1) {
      warnings.push(
        `Overlap ${sequence.slice(0, 20)}${sequence.length > 20 ? '...' : ''} is reused at ${count} junctions — duplicate overlaps can misassemble.`,
      );
    }
  }

  if (errors.length > 0) {
    return { sequence: '', features: [], overlaps, topology: safeTopology, success: false, errors, warnings, overlapSearches };
  }

  // Assemble: start with the first fragment, then append each fragment after
  // its already-present overlap. The per-fragment maps explicitly alias every
  // deduplicated overlap to the retained product copy.
  let sequence = fragments[0].sequence.toUpperCase();
  const sourceMaps = fragments.map((fragment) => emptySourceToProductMap(fragment.sequence.length, 0));
  fillFirstFragmentMap(sourceMaps[0]);
  const junctions: Feature[] = [];

  for (let i = 1; i < fragments.length; i++) {
    const overlap = overlaps[i - 1];
    const frag = fragments[i];
    // The overlap region is already present at the end of the accumulated sequence;
    // skip it from the start of the next fragment
    const trimmed = frag.sequence.slice(overlap.length).toUpperCase();

    const offset = sequence.length;
    fillNextFragmentMap(sourceMaps[i], offset, overlap.length);

    // Junction feature: the overlap region as it sits at the end of the
    // current accumulated sequence (before we append the trimmed portion).
    const junctionStart = sequence.length - overlap.length;
    const junctionEnd = sequence.length;
    junctions.push({
      id: crypto.randomUUID(),
      name: `Junction: ${fragments[i - 1].name}×${frag.name} (${overlap.length} bp)`,
      type: 'misc_feature',
      start: junctionStart,
      end: junctionEnd,
      strand: 1,
      color: '#8F4842', // de-color sweep: muted clay junction hue (distinct from gray misc_feature)
      metadata: {
        source: 'gibson_assembly',
        overlapLength: overlap.length,
        overlapTm: overlap.tm,
        overlapSequence: overlap.sequence,
      },
    });

    sequence += trimmed;
  }

  // Close the circle: the closing overlap currently sits at BOTH the start
  // (head of fragment 0) and the end (tail of the last fragment) of the linear
  // accumulator. Trim the trailing copy so the overlap appears exactly once,
  // and annotate the seam (which physically sits at [0, len) on the product).
  const preClosureLength = sequence.length;
  let productLength = preClosureLength;
  if (safeTopology === 'circular' && closingOverlap && closingOverlap.length > 0) {
    productLength = Math.max(0, sequence.length - closingOverlap.length);
    if (productLength === 0) {
      return {
        sequence: '',
        features: [],
        overlaps,
        topology: safeTopology,
        success: false,
        errors: ['Circular Gibson assembly closing overlap consumes the entire assembled product; at least one non-overlap base is required.'],
        warnings,
        overlapSearches,
      };
    }
    sequence = sequence.slice(0, productLength);
  }

  aliasRemovedProductCoordinates(sourceMaps, productLength, preClosureLength);
  const finalProductMap = productCoordinateMap(preClosureLength, preClosureLength - productLength);
  const sourceFeatures: Feature[] = [];
  for (const [index, fragment] of fragments.entries()) {
    const mapping = mapFeaturesThroughSourceCoordinates(fragment.features, sourceMaps[index]);
    if (mapping.status !== 'ready') {
      return {
        sequence: '',
        features: [],
        overlaps,
        topology: safeTopology,
        success: false,
        errors: mapping.issues.map((issue) => issue.message),
        warnings,
        overlapSearches,
      };
    }
    sourceFeatures.push(...mapping.features);
  }
  const productMapping = mapFeaturesThroughSourceCoordinates(junctions, finalProductMap);
  if (productMapping.status !== 'ready') {
    return {
      sequence: '',
      features: [],
      overlaps,
      topology: safeTopology,
      success: false,
      errors: productMapping.issues.map((issue) => issue.message),
      warnings,
      overlapSearches,
    };
  }
  const productFeatures = productMapping.features;
  const closingJunction = safeTopology === 'circular' && closingOverlap
    ? closingJunctionFeature(
      fragments[fragments.length - 1].name,
      fragments[0].name,
      closingOverlap,
      productLength,
    )
    : null;
  if (closingJunction) productFeatures.push(closingJunction);

  return {
    sequence,
    features: [...sourceFeatures, ...productFeatures],
    overlaps,
    topology: safeTopology,
    success: true,
    errors: [],
    warnings,
    overlapSearches,
  };
}

/**
 * Validate all overlaps in a set of fragments.
 * Checks Tm, length, and uniqueness between consecutive pairs. The
 * minOverlap/maxOverlap thresholds default to the Gibson defaults but are
 * forwarded by callers (e.g. the CLI's --min-overlap/--max-overlap) so that
 * validation matches the assembly the user actually requested.
 */
export interface OverlapValidationEntry {
  pair: string;
  overlap: Overlap | null;
  valid: boolean;
  issues: string[];
}

export interface OverlapValidationResult {
  /** `invalid_input` distinguishes malformed inputs from a valid empty result. */
  status: 'valid' | 'invalid_input';
  valid: boolean;
  results: OverlapValidationEntry[];
  issues: string[];
}

export function validateOverlapsWithDiagnostics(
  fragments: GibsonFragment[],
  minOverlap = DEFAULT_MIN_OVERLAP,
  maxOverlap = DEFAULT_MAX_OVERLAP,
): OverlapValidationResult {
  const range = normalizeOverlapRange(minOverlap, maxOverlap);
  if (!range) {
    return {
      status: 'invalid_input',
      valid: false,
      results: [],
      issues: [`Gibson overlap bounds must be safe integers from ${MIN_GIBSON_OVERLAP} to ${MAX_GIBSON_OVERLAP} bp with minimum no larger than maximum.`],
    };
  }
  const inputValidation = validateGibsonFragments(fragments);
  if (!inputValidation.valid) {
    return {
      status: 'invalid_input',
      valid: false,
      results: [],
      issues: inputValidation.errors,
    };
  }
  const results: OverlapValidationEntry[] = [];

  for (let i = 0; i < fragments.length - 1; i++) {
    const a = fragments[i];
    const b = fragments[i + 1];
    const search = analyzeOverlap(a.sequence, b.sequence, minOverlap, maxOverlap);
    const overlap = search.selected;
    const issues: string[] = [];

    if (overlap === null) {
      issues.push(search.reason === 'ambiguous_symbols'
        ? 'Overlap contains IUPAC ambiguity symbols and is not certified as exact homology.'
        : `No overlap found (need ${minOverlap}–${maxOverlap} bp exact match)`);
    } else {
      if (!search.unique) issues.push(`Alternate exact overlaps found: ${search.candidates.map((candidate) => `${candidate.length} bp`).join(', ')}.`);
      if (overlap.length < minOverlap) {
        issues.push(`Overlap too short: ${overlap.length} bp (minimum ${minOverlap} bp)`);
      }
      if (overlap.tm < IDEAL_OVERLAP_TM) {
        issues.push(`Overlap Tm too low: ${overlap.tm.toFixed(1)} °C (recommended ≥ ${IDEAL_OVERLAP_TM} °C)`);
      }
    }

    results.push({
      pair: `${a.name} → ${b.name}`,
      overlap,
      valid: issues.length === 0,
      issues,
    });
  }

  const issues = results.flatMap((result) => result.issues.map((issue) => `${result.pair}: ${issue}`));
  return {
    status: 'valid',
    valid: results.every((result) => result.valid),
    results,
    issues,
  };
}

/** @deprecated Use `validateOverlapsWithDiagnostics()` for invalid-input status. */
export function validateOverlaps(
  fragments: GibsonFragment[],
  minOverlap = DEFAULT_MIN_OVERLAP,
  maxOverlap = DEFAULT_MAX_OVERLAP,
): OverlapValidationEntry[] {
  const detailed = validateOverlapsWithDiagnostics(fragments, minOverlap, maxOverlap);
  if (detailed.status === 'invalid_input') {
    throw new GibsonInputError('Gibson overlap validation received invalid input.', detailed.issues);
  }
  return detailed.results;
}

/** @deprecated Alias retained for callers that used the explicit legacy name. */
export const validateOverlapsLegacy = validateOverlaps;

/** Descriptive alias for integrations that prefer an explicit detailed name. */
export const validateOverlapsDetailed = validateOverlapsWithDiagnostics;
