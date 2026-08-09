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
  aliasRemovedProductCoordinates,
  emptySourceToProductMap,
  mapFeatureThroughSourceCoordinates,
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
  | 'formatting_normalized'
  | 'invalid_character'
  | 'ambiguous_base'
  | 'unsupported_enzyme';

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
  return `Unsupported Golden Gate enzyme "${enzymeName}". Supported enzymes: ${GOLDEN_GATE_ENZYME_NAMES.join(', ')}.`;
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

function normalizeGoldenGatePart(part: GoldenGatePart): {
  part: GoldenGatePart | null;
  diagnostics: GoldenGateNormalizationDiagnostic[];
  provenance: NonNullable<GoldenGateNormalizationProvenance['parts']>[number];
} {
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
  if (formattingNormalized && diagnostics.length === 0) {
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
function findGoldenGateSitesInNormalizedSequence(
  upper: string,
  enz: RestrictionEnzyme,
  options: FindGoldenGateSitesOptions = {},
): GoldenGateSite[] {
  const recog = enz.recognitionSequence.toUpperCase();
  const recogRC = reverseComplement(recog).toUpperCase();
  const overhangLength = overhangLengthFor(enz);
  const includeOutOfBounds = options.includeOutOfBounds === true;
  const sites: GoldenGateSite[] = [];

  // Sense strand sites
  let idx = upper.indexOf(recog);
  while (idx !== -1) {
    // cutOffset is relative to the start of the recognition sequence on sense strand
    const cutPos = idx + enz.cutOffset;
    const hasWindow = hasOverhangWindow(upper, cutPos, overhangLength);
    if (hasWindow || includeOutOfBounds) {
      const overhangSeq = hasWindow ? upper.slice(cutPos, cutPos + overhangLength) : '';
      sites.push({
        position: idx,
        enzyme: enz.name,
        strand: 1,
        cutPosition: cutPos,
        overhang: overhangSeq,
      });
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
        sites.push({
          position: ridx,
          enzyme: enz.name,
          strand: -1,
          cutPosition: cutPos,
          overhang: overhangSeq,
        });
      }
      ridx = upper.indexOf(recogRC, ridx + 1);
    }
  }

  sites.sort((a, b) => a.position - b.position);
  return sites;
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
  const normalized = normalizeGoldenGatePart({ name: 'sequence', sequence: seq });
  const provenance = normalizationProvenance([], [normalized.provenance]);
  const enz = getEnzyme(enzyme);
  if (!enz) {
    return {
      sequence: normalized.part?.sequence ?? seq.replace(/\s+/g, '').toUpperCase(),
      enzyme,
      sites: [],
      diagnostics: [
        ...normalized.diagnostics,
        {
          code: 'unsupported_enzyme',
          message: `Unsupported Golden Gate enzyme: ${enzyme}`,
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
      diagnostics: normalized.diagnostics,
      provenance,
    };
  }
  return {
    sequence: normalized.part.sequence,
    enzyme: enz.name,
    sites: findGoldenGateSitesInNormalizedSequence(normalized.part.sequence, enz, options),
    diagnostics: normalized.diagnostics,
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
  return scanGoldenGateSites(seq, enzyme, options).sites;
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

  for (const part of parts) {
    const normalized = normalizeGoldenGatePart(part);
    normalizationDiagnostics.push(...normalized.diagnostics);
    provenanceParts.push(normalized.provenance);
    if (!normalized.part) {
      errors.push(`Part "${part.name}": Golden Gate input must be canonical A/C/G/T after normalization.`);
      continue;
    }
    const normalizedPart = normalized.part;
    const upper = normalizedPart.sequence;
    const senseIdx = upper.indexOf(recog);
    const antiIdx = senseIdx !== -1 ? upper.indexOf(recogRC, senseIdx + recog.length) : -1;

    if (senseIdx === -1 || antiIdx === -1 || senseIdx >= antiIdx) {
      const foundSites = findGoldenGateSites(normalizedPart.sequence, enz.name);
      const foundSummary = foundSites.length > 0
        ? `found ${foundSites.length} site${foundSites.length !== 1 ? 's' : ''}, but not a valid sense/antisense flank pair`
        : 'found none';
      errors.push(
        `Part "${part.name}": missing flanking ${enz.name} sites (${foundSummary}; need a sense site before the antisense site)`,
      );
      continue;
    }

    const internalSites = findInternalGoldenGateSites(normalizedPart.sequence, enz.name);
    if (internalSites.length > 0) {
      errors.push(
        `Part "${part.name}": contains ${internalSites.length} internal ${enz.name} site${internalSites.length !== 1 ? 's' : ''}`,
      );
      continue;
    }

    const leftCut = senseIdx + enz.cutOffset;
    const rightCutStart = antiIdx + recogRC.length - enz.complementCutOffset;
    const geometryErrors = validateFlankCutGeometry(upper, leftCut, rightCutStart, overhangLength);
    if (geometryErrors.length > 0) {
      errors.push(`Part "${part.name}": ${geometryErrors.join('; ')}`);
      continue;
    }

    const oh5 = upper.slice(leftCut, leftCut + overhangLength);
    const rightOverhang = upper.slice(rightCutStart, rightCutStart + overhangLength);
    const oh3 = reverseComplement(rightOverhang);
    const insert = upper.slice(leftCut, rightCutStart + overhangLength);

    if (oh5.length < overhangLength || oh3.length < overhangLength) {
      errors.push(`Part "${part.name}": could not extract ${overhangLength} bp overhangs`);
      continue;
    }

    // Map features from the full source part into the released insert. Bases
    // outside the digest window are genuinely absent and therefore, and only
    // therefore, mark a surviving feature partial.
    const insertLength = insert.length;
    const insertMap = sourceMapForInsert(normalizedPart.sequence.length, leftCut, insertLength);
    const shiftedFeatures: Feature[] = [];
    for (const feat of normalizedPart.features ?? []) {
      const shifted = mapFeatureThroughSourceCoordinates(feat, insertMap);
      if (shifted) shiftedFeatures.push(shifted);
    }

    digested.push({ id: normalizedPart.id, name: normalizedPart.name, insert, oh5, oh3, rightOverhang, features: shiftedFeatures, insertStart: leftCut });
  }

  return { digested, errors, normalizationDiagnostics, provenanceParts };
}

export type GoldenGateChainReason =
  | 'unique'
  | 'no-chain'
  | 'ambiguous-multiple-chains'
  | 'ambiguous-self-ligation';

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

/** Safety cap on chain enumeration — Golden Gate assemblies are typically <10 parts. */
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
  let bailedOnLimit = false;

  for (let startIdx = 0; startIdx < n; startIdx++) {
    if (bailedOnLimit) break;
    const path: number[] = [startIdx];
    const visited = new Set<number>([startIdx]);

    const dfs = (curr: number): void => {
      if (validChains.length >= MAX_GOLDEN_GATE_CHAINS) {
        bailedOnLimit = true;
        return;
      }
      if (path.length === n) {
        validChains.push([...path]);
        return;
      }
      const currRight = digested[curr].rightOverhang;
      for (let i = 0; i < n; i++) {
        if (bailedOnLimit) return;
        if (visited.has(i)) continue;
        if (digested[i].oh5 === currRight) {
          visited.add(i);
          path.push(i);
          dfs(i);
          path.pop();
          visited.delete(i);
        }
      }
    };
    dfs(startIdx);
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
      const minIdx = chain.indexOf(Math.min(...chain));
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

  if (canonicalChains.length > 1 || bailedOnLimit) {
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

export function getGoldenGatePartBoundary(
  part: Pick<GoldenGatePart, 'name' | 'sequence'>,
  enzyme = DEFAULT_ENZYME,
): GoldenGatePartBoundary {
  const enz = getEnzyme(enzyme);
  if (!enz) {
    return {
      valid: false,
      enzyme,
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
  const normalized = normalizeGoldenGatePart({ name: part.name, sequence: part.sequence });
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
      errors: [`Part "${part.name}" must contain only canonical A/C/G/T bases.`],
      normalizationDiagnostics,
      provenance,
    };
  }
  const upper = normalized.part.sequence;
  const recog = enz.recognitionSequence.toUpperCase();
  const recogRC = reverseComplement(recog).toUpperCase();
  const overhangLength = overhangLengthFor(enz);
  const sites = findGoldenGateSites(upper, enzyme, { includeOutOfBounds: true });
  const errors: string[] = [];

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

function partIdsForInput(parts: readonly GoldenGatePart[]): string[] | undefined {
  return parts.some((part) => typeof part.id === 'string' && part.id.length > 0)
    ? parts.map((part, index) => part.id ?? `${part.name}#${index + 1}`)
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

  const {
    digested,
    errors: digestErrors,
    normalizationDiagnostics,
    provenanceParts,
  } = digestGoldenGateParts(parts, enz);
  for (const error of digestErrors) {
    issues.push({
      type: 'preparation',
      overhangs: [],
      description: error,
    });
  }

  if (parts.length === 0) {
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
    if (analysis.reason === 'ambiguous-multiple-chains' || analysis.reason === 'ambiguous-self-ligation') {
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
  const inputPartIds = partIdsForInput(parts);
  const enz = getEnzyme(enzyme);
  if (!enz) {
    return {
      sequence: '',
      features: [],
      parts: parts.map((part) => part.name),
      ...(inputPartIds ? { partIds: inputPartIds } : {}),
      overhangs: [],
      enzyme,
      topology: 'linear',
      success: false,
      errors: [unsupportedEnzymeError(enzyme)],
      warnings: [],
    };
  }

  if (parts.length < 2) {
    return {
      sequence: '',
      features: [],
      parts: [],
      ...(inputPartIds ? { partIds: inputPartIds } : {}),
      overhangs: [],
      enzyme: enz.name,
      topology: 'linear',
      success: false,
      errors: ['Golden Gate Assembly requires at least 2 parts'],
      warnings: [],
    };
  }

  // Pre-validate palindromic and near-identical overhangs (informational warnings).
  // Ambiguity / open-chain handling is delegated to the chain analyzer below
  // so the assembler can return structured `missingVectorOverhangs` to the UI.
  const validation = validateGoldenGateOverhangs(parts, enzyme);
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
  } = digestGoldenGateParts(parts, enz);
  const normalizationProvenance = normalizationProvenanceForParts(provenanceParts);
  errors.push(...digestErrors);

  if (errors.length > 0) {
    return { sequence: '', features: [], parts: parts.map((p) => p.name), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
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
    return { sequence: '', features: [], parts: parts.map((p) => p.name), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
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
    return { sequence: '', features: [], parts: parts.map((p) => p.name), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  if (analysis.reason === 'no-chain' || !analysis.ordered) {
    errors.push(
      'Could not form a complete assembly chain — check that overhangs are unique and form a linear (or circular) order',
    );
    return { sequence: '', features: [], parts: parts.map((p) => p.name), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
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
    return { sequence: '', features: [], parts: ordered.map((p) => p.name), ...(orderedPartIds ? { partIds: orderedPartIds } : {}), overhangs, enzyme: enz.name, topology: 'linear', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  const last = ordered[ordered.length - 1];
  const first = ordered[0];
  const closingOverhang = last.rightOverhang;
  if (closingOverhang !== first.oh5) {
    errors.push(
      `Assembly chain is open: "${last.name}" 3' overhang ${last.rightOverhang} does not close to "${first.name}" 5' overhang ${first.oh5}`,
    );
    return { sequence: '', features: [], parts: ordered.map((p) => p.name), ...(orderedPartIds ? { partIds: orderedPartIds } : {}), overhangs, enzyme: enz.name, topology: 'linear', success: false, errors, warnings, normalizationDiagnostics, provenance: normalizationProvenance };
  }

  const preClosureLength = sequence.length;
  const productLength = Math.max(0, sequence.length - overhangLength);
  const circularSequence = sequence.slice(0, productLength);
  aliasRemovedProductCoordinates(insertMaps, productLength, preClosureLength);
  const finalProductMap = finalProductMapForAssembly(preClosureLength, overhangLength);
  const circularFeatures = ordered.flatMap((part, index) => part.features.flatMap((feature) => {
    const mapped = mapFeatureThroughSourceCoordinates(feature, insertMaps[index]);
    return mapped ? [mapped] : [];
  }));
  const circularProductFeatures = productFeatures.flatMap((feature) => {
    const mapped = mapFeatureThroughSourceCoordinates(feature, finalProductMap);
    return mapped ? [mapped] : [];
  });
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

  // Verify the synthetic part has no internal Type IIS sites that would
  // sabotage the assembly. If the filler accidentally contains one, the
  // caller can pass a different `filler` string.
  const internalSites = findInternalGoldenGateSites(sequence, enz.name);
  if (internalSites.length > 0) {
    throw new Error(
      `Synthetic vector filler contains ${internalSites.length} internal ${enz.name} site${internalSites.length === 1 ? '' : 's'}; supply a site-free filler via options.filler`,
    );
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
): GoldenGateDomesticationSite[] {
  const sites: GoldenGateDomesticationSite[] = [];
  for (const enzyme of enzymes) {
    const recognition = enzyme.recognitionSequence.toUpperCase();
    for (const site of findGoldenGateSites(coding, enzyme.name, { includeOutOfBounds: true })) {
      sites.push({
        kind: 'enzyme',
        enzyme: enzyme.name,
        motif: site.strand === 1 ? recognition : reverseComplement(recognition).toUpperCase(),
        position: site.position,
        featurePosition: site.position,
        strand: site.strand,
      });
    }
  }
  for (const motif of explicitMotifs) {
    const reverse = reverseComplement(motif).toUpperCase();
    const motifs: Array<readonly [string, 1 | -1]> = reverse === motif
      ? [[motif, 1]]
      : [[motif, 1], [reverse, -1]];
    for (const [orientedMotif, strand] of motifs) {
      let position = coding.indexOf(orientedMotif);
      while (position !== -1) {
        sites.push({ kind: 'site', motif: orientedMotif, position, featurePosition: position, strand });
        position = coding.indexOf(orientedMotif, position + 1);
      }
    }
  }
  return sites.sort((left, right) => left.featurePosition - right.featurePosition || left.motif.localeCompare(right.motif));
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
): GoldenGateDomesticationSite[] {
  return segments.flatMap((segment) => scanDomesticationSites(
    oriented.slice(segment.featureStart, segment.featureStart + segment.coordinates.length),
    enzymes,
    explicitMotifs,
  ).map((site) => ({
    ...site,
    featurePosition: site.featurePosition + segment.featureStart,
  })));
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
  const source = options.sequence.toUpperCase();
  const location = sourceCoordinatesForFeature(source.length, options.feature);
  const failures = [...location.failures];
  const authoritativeBaseCount = location.coordinates.length;
  const emptyResult = (extra: Partial<DomesticateGoldenGateFeatureResult> = {}): DomesticateGoldenGateFeatureResult => ({
    sequence: source,
    mutations: [],
    authoritativeScope: 'feature',
    authoritativeBaseCount,
    translatedBaseRange: null,
    complete: false,
    remainingSites: [],
    introducedSites: [],
    failures,
    sourceProtein: null,
    productProtein: null,
    proteinIdentity: false,
    ...extra,
  });
  if (failures.length > 0 || location.coordinates.length === 0) return emptyResult();

  const codonStart = Number(options.codonStart);
  if (!Number.isInteger(codonStart) || codonStart < 1 || codonStart > 3) {
    failures.push(domesticationFailure('invalid_codon_start', 'codon_start must be exactly 1, 2, or 3.'));
    return emptyResult();
  }
  const tableId = options.translationTableId == null ? options.translationTableId : Number(options.translationTableId);
  const tableResolution = resolveTranslationTable(tableId);
  if (!tableResolution.supported) {
    failures.push(domesticationFailure('unsupported_translation_table', tableResolution.message));
    return emptyResult();
  }
  const table: CodonTable = tableResolution.table;
  const frame = codonStart - 1;
  const oriented = location.coordinates.map((coordinate, index) => (
    location.strands[index] === -1 ? reverseComplement(source[coordinate]).toUpperCase() : source[coordinate]
  )).join('');
  const coding = oriented.slice(frame);
  const translatedBaseRange = { start: frame, end: oriented.length };
  if (coding.length === 0 || coding.length % 3 !== 0) {
    failures.push(domesticationFailure('invalid_cds_frame', 'CDS sequence after codon_start must contain complete codons.'));
    return emptyResult({ translatedBaseRange });
  }
  let sourceProtein: string;
  let translationReceipt: TranslationExceptionReceipt | undefined;
  let translationExceptions: TranslationException[] = [];
  try {
    sourceProtein = translateCompleteCds(coding, 0, table);
  } catch (error) {
    failures.push(domesticationFailure('untranslatable_cds', error instanceof Error ? error.message : 'CDS could not be translated.'));
    return emptyResult({ translatedBaseRange });
  }

  const rawTranslationException = options.feature.metadata?.transl_except
    ?? options.feature.metadata?.translExcept;
  if (rawTranslationException !== undefined) {
    const materialized = materializeTranslationExceptions({
      sequence: source,
      feature: options.feature,
      qualifier: rawTranslationException,
      codonStart,
      translationTableId: table.id,
    });
    if (!materialized.ok) {
      failures.push(...materialized.diagnostics.map((entry) => domesticationFailure(
        'invalid_translation_exception',
        entry.message,
        { diagnostics: [entry] },
      )));
      return emptyResult({
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

  const proteinForOrientedSequence = (orientedSequence: string): string => {
    const translated = translateCompleteCds(orientedSequence.slice(frame), 0, table);
    if (translationExceptions.length === 0) return translated;
    return translationExceptions.reduce((protein, exception) => (
      exception.codonIndex < 0 || exception.codonIndex >= protein.length
        ? protein
        : `${protein.slice(0, exception.codonIndex)}${exception.residue}${protein.slice(exception.codonIndex + 1)}`
    ), translated);
  };

  const selectedEnzymes: RestrictionEnzyme[] = [];
  for (const rawName of options.forbiddenEnzymes ?? []) {
    const name = String(rawName);
    const enzyme = typeof rawName === 'string' ? getEnzyme(rawName) : null;
    if (!enzyme) {
      failures.push(domesticationFailure('invalid_forbidden_enzyme', unsupportedEnzymeError(name), { enzyme: name }));
    } else if (!selectedEnzymes.some((entry) => entry.name.toLowerCase() === enzyme.name.toLowerCase())) {
      selectedEnzymes.push(enzyme);
    }
  }
  const selectedMotifs: string[] = [];
  for (const rawMotif of options.forbiddenSites ?? []) {
    const motif = String(rawMotif).toUpperCase();
    if (!/^[ACGT]+$/.test(motif)) {
      failures.push(domesticationFailure(
        'invalid_forbidden_site',
        `Forbidden site "${rawMotif}" must contain only A/C/G/T.`,
        { motif: String(rawMotif) },
      ));
    } else if (!selectedMotifs.includes(motif)) {
      selectedMotifs.push(motif);
    }
  }
  if (failures.length > 0) {
    return emptyResult({
      sourceProtein,
      productProtein: sourceProtein,
      proteinIdentity: true,
      translatedBaseRange,
    });
  }

  const initialSites = scanDomesticationSitesBySegments(
    oriented,
    location.segments,
    selectedEnzymes,
    selectedMotifs,
  );
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

  for (let pass = 0; pass < 100; pass += 1) {
    const sites = scanDomesticationSitesBySegments(
      workingOriented,
      location.segments,
      selectedEnzymes,
      selectedMotifs,
    );
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
          if (candidateCodon === originalCodon) continue;
          const candidateOriented = `${workingOriented.slice(0, codonOffset)}${candidateCodon}${workingOriented.slice(codonOffset + 3)}`;
          if (proteinForOrientedSequence(candidateOriented) !== sourceProtein) continue;
          const candidateSites = scanDomesticationSitesBySegments(
            candidateOriented,
            location.segments,
            selectedEnzymes,
            selectedMotifs,
          );
          if (candidateSites.some((candidate) => domesticationSiteKey(candidate) === domesticationSiteKey(site))) continue;
          replacement = candidateCodon;
          replacementOffset = codonOffset;
          break;
        }
        if (replacement !== null) break;
      }
      if (replacement === null || replacementOffset === null) continue;
      workingOriented = `${workingOriented.slice(0, replacementOffset)}${replacement}${workingOriented.slice(replacementOffset + 3)}`;
      recordCodonMutation(replacementOffset, replacement);
      changed = true;
    }
    if (!changed) break;
  }

  const mutations = [...mutationByPosition.values()].sort((left, right) => left.position - right.position);
  const productChars = source.split('');
  for (const mutation of mutations) productChars[mutation.position] = mutation.replacement;
  const productSequence = productChars.join('');
  const finalSitesOriented = scanDomesticationSitesBySegments(
    workingOriented,
    location.segments,
    selectedEnzymes,
    selectedMotifs,
  );
  const initialSiteKeys = new Set(initialSites.map(domesticationSiteKey));
  const remainingSites = mapDomesticationSites(finalSitesOriented, location.coordinates);
  const introducedSites = mapDomesticationSites(
    finalSitesOriented.filter((site) => !initialSiteKeys.has(domesticationSiteKey(site))),
    location.coordinates,
  );
  for (const site of remainingSites) {
    const whollyWithinTranslatedCds = site.featurePosition >= translatedBaseRange.start
      && site.featurePosition + site.motif.length <= translatedBaseRange.end;
    failures.push(domesticationFailure(
      'no_synonymous_change',
      whollyWithinTranslatedCds
        ? `No synonymous codon substitution could remove the forbidden site at source coordinate ${site.position}.`
        : `Forbidden site at source coordinate ${site.position} overlaps authoritative feature sequence outside the translated CDS and cannot be changed safely.`,
      { position: site.position, enzyme: site.enzyme, motif: site.motif },
    ));
    if (!whollyWithinTranslatedCds) {
      failures.push(domesticationFailure(
        'unmodifiable_authoritative_site',
        `Forbidden site at source coordinate ${site.position} remains in authoritative feature sequence outside the translated CDS.`,
        { position: site.position, enzyme: site.enzyme, motif: site.motif },
      ));
    }
    failures.push(domesticationFailure(
      'remaining_forbidden_site',
      `Forbidden ${site.enzyme ?? 'sequence'} site remains at source coordinate ${site.position}.`,
      { position: site.position, enzyme: site.enzyme, motif: site.motif },
    ));
  }
  for (const site of introducedSites) {
    failures.push(domesticationFailure(
      'introduced_forbidden_site',
      `Domestication introduced a forbidden site at source coordinate ${site.position}.`,
      { position: site.position, enzyme: site.enzyme, motif: site.motif },
    ));
  }
  let productProtein: string | null = null;
  try {
    productProtein = proteinForOrientedSequence(workingOriented);
  } catch {
    failures.push(domesticationFailure('untranslatable_cds', 'Domesticated CDS could not be translated.'));
  }
  const proteinIdentity = productProtein !== null && productProtein === sourceProtein;
  if (!proteinIdentity) failures.push(domesticationFailure('protein_identity_mismatch', 'Domesticated product protein differs from the source protein.'));
  return {
    sequence: productSequence,
    mutations,
    authoritativeScope: 'feature',
    authoritativeBaseCount,
    translatedBaseRange,
    complete: failures.length === 0 && remainingSites.length === 0 && introducedSites.length === 0 && proteinIdentity,
    remainingSites,
    introducedSites,
    failures,
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
