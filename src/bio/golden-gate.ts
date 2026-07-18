import type { Feature, RestrictionEnzyme } from './types';
import { RESTRICTION_ENZYMES } from './restriction-sites';
import { reverseComplement } from './reverse-complement';

export interface GoldenGatePart {
  id?: string;
  name: string;
  sequence: string;
  features?: Feature[];
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
    type: 'duplicate' | 'palindromic' | 'near_identical' | 'open_chain';
    overhangs: string[];
    description: string;
  }>;
  /** When the open-chain issue is reported, the overhangs a vector must expose. */
  missingVectorOverhangs?: { left: string; right: string };
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
  const normalized = enzymeName.trim().toLowerCase();
  if (!GOLDEN_GATE_ENZYME_NAME_SET.has(normalized)) return null;
  return (
    RESTRICTION_ENZYMES.find((e) => e.name.toLowerCase() === normalized) ??
    GOLDEN_GATE_EXTRA_ENZYMES.find((e) => e.name.toLowerCase() === normalized) ??
    null
  );
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
export function findGoldenGateSites(
  seq: string,
  enzyme = DEFAULT_ENZYME,
  options: FindGoldenGateSitesOptions = {},
): GoldenGateSite[] {
  const enz = getEnzyme(enzyme);
  if (!enz) return [];
  const upper = seq.toUpperCase();
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
 * Count the number of positions where two equal-length strings differ.
 */
function hammingDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) d++;
  }
  return d;
}

/**
 * Keep the portions of a feature that fall inside one source span and place
 * them in product coordinates. Multipart locations are authoritative: their
 * stored biological order is preserved, empty pieces are removed, and the
 * aggregate bounds are rebuilt from the surviving pieces.
 */
function clipFeatureToSpan(
  feature: Feature,
  sourceStart: number,
  sourceEnd: number,
  destinationStart: number,
  rekey = false,
): Feature | null {
  if (sourceEnd <= sourceStart) return null;

  const hasSubRanges = feature.subRanges !== undefined;
  const sourceRanges = hasSubRanges
    ? feature.subRanges!
    : [{ start: feature.start, end: feature.end, strand: feature.strand }];
  const mappedRanges = sourceRanges.flatMap((range) => {
    const clippedStart = Math.max(range.start, sourceStart);
    const clippedEnd = Math.min(range.end, sourceEnd);
    if (clippedEnd <= clippedStart) return [];
    return [{
      ...range,
      start: destinationStart + clippedStart - sourceStart,
      end: destinationStart + clippedEnd - sourceStart,
    }];
  });
  if (mappedRanges.length === 0) return null;

  const { subRanges: _subRanges, ...featureWithoutSubRanges } = feature;
  return {
    ...featureWithoutSubRanges,
    ...(rekey ? { id: crypto.randomUUID() } : {}),
    start: Math.min(...mappedRanges.map((range) => range.start)),
    end: Math.max(...mappedRanges.map((range) => range.end)),
    ...(hasSubRanges ? { subRanges: mappedRanges } : {}),
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

function clampFeatureToLength(feature: Feature, length: number): Feature | null {
  return clipFeatureToSpan(feature, 0, length, 0);
}

function clampFeaturesToLength(features: Feature[], length: number): Feature[] {
  return features
    .map((feature) => clampFeatureToLength(feature, length))
    .filter((feature): feature is Feature => feature !== null);
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
  const recog = enz.recognitionSequence.toUpperCase();
  const recogRC = reverseComplement(recog).toUpperCase();
  const overhangLength = overhangLengthFor(enz);

  for (const part of parts) {
    const upper = part.sequence.toUpperCase();
    const senseIdx = upper.indexOf(recog);
    const antiIdx = senseIdx !== -1 ? upper.indexOf(recogRC, senseIdx + recog.length) : -1;

    if (senseIdx === -1 || antiIdx === -1 || senseIdx >= antiIdx) {
      const foundSites = findGoldenGateSites(part.sequence, enz.name);
      const foundSummary = foundSites.length > 0
        ? `found ${foundSites.length} site${foundSites.length !== 1 ? 's' : ''}, but not a valid sense/antisense flank pair`
        : 'found none';
      errors.push(
        `Part "${part.name}": missing flanking ${enz.name} sites (${foundSummary}; need a sense site before the antisense site)`,
      );
      continue;
    }

    const internalSites = findInternalGoldenGateSites(part.sequence, enz.name);
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

    // Shift features to be relative to the insert, clamping those that
    // partially overlap the overhang regions instead of dropping them.
    const insertLength = insert.length;
    const shiftedFeatures: Feature[] = [];
    for (const feat of part.features ?? []) {
      const shifted = clipFeatureToSpan(feat, leftCut, leftCut + insertLength, 0, true);
      if (shifted) shiftedFeatures.push(shifted);
    }

    digested.push({ id: part.id, name: part.name, insert, oh5, oh3, rightOverhang, features: shiftedFeatures, insertStart: leftCut });
  }

  return { digested, errors };
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
  const upper = part.sequence.toUpperCase();
  const recog = enz.recognitionSequence.toUpperCase();
  const recogRC = reverseComplement(recog).toUpperCase();
  const overhangLength = overhangLengthFor(enz);
  const sites = findGoldenGateSites(part.sequence, enzyme, { includeOutOfBounds: true });
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

  const { digested } = digestGoldenGateParts(parts, enz);
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
  const { digested, errors: digestErrors } = digestGoldenGateParts(parts, enz);
  errors.push(...digestErrors);

  if (errors.length > 0) {
    return { sequence: '', features: [], parts: parts.map((p) => p.name), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', success: false, errors, warnings };
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
    return { sequence: '', features: [], parts: parts.map((p) => p.name), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', success: false, errors, warnings };
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
    return { sequence: '', features: [], parts: parts.map((p) => p.name), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', success: false, errors, warnings };
  }

  if (analysis.reason === 'no-chain' || !analysis.ordered) {
    errors.push(
      'Could not form a complete assembly chain — check that overhangs are unique and form a linear (or circular) order',
    );
    return { sequence: '', features: [], parts: parts.map((p) => p.name), ...(inputPartIds ? { partIds: inputPartIds } : {}), overhangs: [], enzyme: enz.name, topology: 'linear', success: false, errors, warnings };
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
      missingVectorOverhangs: missing,
    };
  }

  // --- Step 3: Assemble by ligating inserts, joining at matching overhangs ---
  // Each insert starts with oh5 and ends with the complement of oh3.
  // Adjacent inserts share one overhang sequence so trim the duplicate.
  const overhangLength = overhangLengthFor(enz);
  let sequence = ordered[0].insert;
  const features: Feature[] = [...ordered[0].features];
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
    const junctionStart = Math.max(0, offset - overhangLength);
    const junctionFeature = createJunctionFeature(prev.name, curr.name, curr.oh5, junctionStart, offset, { overhangLength });
    if (junctionFeature) productFeatures.push(junctionFeature);

    sequence += trimmedInsert;
    overhangs.push(curr.oh5);

    const partSpan = createPartSpanFeature(curr, i, offset, sequence.length);
    if (partSpan) productFeatures.push(partSpan);

    for (const feat of curr.features) {
      const shifted = clipFeatureToSpan(feat, overhangLength, curr.insert.length, offset, true);
      if (shifted) features.push(shifted);
    }
  }

  if (errors.length > 0) {
    return { sequence: '', features: [], parts: ordered.map((p) => p.name), ...(orderedPartIds ? { partIds: orderedPartIds } : {}), overhangs, enzyme: enz.name, topology: 'linear', success: false, errors, warnings };
  }

  const last = ordered[ordered.length - 1];
  const first = ordered[0];
  const closingOverhang = last.rightOverhang;
  if (closingOverhang !== first.oh5) {
    errors.push(
      `Assembly chain is open: "${last.name}" 3' overhang ${last.rightOverhang} does not close to "${first.name}" 5' overhang ${first.oh5}`,
    );
    return { sequence: '', features: [], parts: ordered.map((p) => p.name), ...(orderedPartIds ? { partIds: orderedPartIds } : {}), overhangs, enzyme: enz.name, topology: 'linear', success: false, errors, warnings };
  }

  const circularSequence = sequence.slice(0, Math.max(0, sequence.length - overhangLength));
  const circularFeatures = clampFeaturesToLength(features, circularSequence.length);
  const circularProductFeatures = clampFeaturesToLength(productFeatures, circularSequence.length);
  const finalJunction = createJunctionFeature(
    last.name,
    first.name,
    first.oh5,
    0,
    Math.min(overhangLength, circularSequence.length),
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

  const fillerLen = Math.max(0, Math.floor(options.fillerLength ?? DEFAULT_VECTOR_FILLER_LENGTH));
  let filler = options.filler?.toUpperCase() ?? VECTOR_FILLER_TEMPLATE.slice(0, fillerLen);
  if (!options.filler && filler.length < fillerLen) {
    // Extend filler by tiling the template if a longer filler was requested.
    while (filler.length < fillerLen) {
      filler += VECTOR_FILLER_TEMPLATE.slice(0, Math.min(VECTOR_FILLER_TEMPLATE.length, fillerLen - filler.length));
    }
    filler = filler.slice(0, fillerLen);
  }

  // Layout: AAAA <sense site> N <leftOverhang> <filler> <rightOverhang> N <antisense site> AAAA
  // Mirrors the test buildGoldenGatePart helper so the same cut geometry applies.
  const recog = enz.recognitionSequence.toUpperCase();
  const recogRC = reverseComplement(recog).toUpperCase();
  const padding = 'AAAA';
  const sequence = `${padding}${recog}N${left}${filler}${right}N${recogRC}${padding}`;

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

// Standard genetic code for silent mutation lookup
const GENETIC_CODE: Record<string, string> = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
};

/** Build reverse mapping: amino acid → list of synonymous codons */
function buildSynonymousMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [codon, aa] of Object.entries(GENETIC_CODE)) {
    const list = map.get(aa) ?? [];
    list.push(codon);
    map.set(aa, list);
  }
  return map;
}

const SYNONYMOUS_CODONS = buildSynonymousMap();

/**
 * Domesticate a CDS by removing internal Type IIS restriction sites via
 * silent (synonymous) codon substitutions.
 *
 * Assumes seq is a valid CDS (multiple of 3, starts at codon 0).
 * Returns the mutated sequence and a list of positions changed.
 */
export function domesticate(
  seq: string,
  enzyme = DEFAULT_ENZYME,
): { sequence: string; mutations: Array<{ position: number; original: string; replacement: string }> } {
  const mutations: Array<{ position: number; original: string; replacement: string }> = [];
  let mutSeq = seq.toUpperCase();
  const enz = getEnzyme(enzyme);
  if (!enz) return { sequence: mutSeq, mutations };

  // Iterate until no internal sites remain (max 100 passes to avoid infinite loops)
  for (let pass = 0; pass < 100; pass++) {
    const sites = findGoldenGateSites(mutSeq, enzyme, { includeOutOfBounds: true });
    if (sites.length === 0) break;

    let changed = false;
    for (const site of sites) {
      // Find which codon(s) overlap this recognition site and try to mutate one
      const recog = enz.recognitionSequence;
      const siteEnd = site.position + recog.length;

      // Try each codon overlapping the site
      const firstCodon = Math.floor(site.position / 3);
      const lastCodon = Math.floor((siteEnd - 1) / 3);

      let mutated = false;
      for (let ci = firstCodon; ci <= lastCodon && !mutated; ci++) {
        const codonStart = ci * 3;
        if (codonStart + 3 > mutSeq.length) break;

        const originalCodon = mutSeq.slice(codonStart, codonStart + 3);
        const aa = GENETIC_CODE[originalCodon];
        if (!aa || aa === '*') continue; // don't mutate stop codons

        const synonyms = SYNONYMOUS_CODONS.get(aa) ?? [];
        for (const alt of synonyms) {
          if (alt === originalCodon) continue;
          // Test if swapping this codon removes the site
          const candidate = mutSeq.slice(0, codonStart) + alt + mutSeq.slice(codonStart + 3);
          const newSites = findGoldenGateSites(candidate, enzyme, { includeOutOfBounds: true });
          // Check the specific site is gone
          const siteGone = !newSites.some(
            (s) => s.position === site.position && s.strand === site.strand,
          );
          if (siteGone) {
            mutations.push({ position: codonStart, original: originalCodon, replacement: alt });
            mutSeq = candidate;
            mutated = true;
            changed = true;
            break;
          }
        }
      }

      if (!mutated) {
        // Could not remove this site silently — skip (non-CDS region or stop codon)
        break;
      }
    }

    if (!changed) break;
  }

  return { sequence: mutSeq, mutations };
}

/**
 * Domesticate ONLY the internal insert of a flanked Type IIS part, preserving
 * the structural flanking recognition sites the assembly depends on.
 *
 * R10 #4: `domesticate()` removes every recognition site it finds, including the
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
): { sequence: string; mutations: Array<{ position: number; original: string; replacement: string }> } {
  const boundary = getGoldenGatePartBoundary({ name: 'part', sequence: seq }, enzyme);
  if (
    boundary.insertStart != null &&
    boundary.insertEnd != null &&
    boundary.insertEnd > boundary.insertStart
  ) {
    const insertStart = boundary.insertStart;
    const insert = seq.slice(insertStart, boundary.insertEnd);
    const cleaned = domesticate(insert, enzyme);
    return {
      sequence: seq.slice(0, insertStart) + cleaned.sequence + seq.slice(boundary.insertEnd),
      mutations: cleaned.mutations.map((m) => ({ ...m, position: m.position + insertStart })),
    };
  }
  return domesticate(seq, enzyme);
}
