import type {
  RestrictionCleavageMode,
  RestrictionCleavageStatus,
  RestrictionEnzyme,
  RestrictionMethylationState,
  RestrictionMethylationTarget,
  RestrictionMethylationEvidence,
  RestrictionSite,
  Topology,
} from './types';
import { reverseComplement } from './reverse-complement';

/**
 * Options for [`findRestrictionSites`].
 * Phase 34 P-B B3: topology added so circular plasmids wrap-scan their origin.
 */
export interface FindRestrictionSitesOptions {
  /**
   * Sequence topology. When `'circular'`, the scanner appends a wrap window
   * `seq.slice(0, recognitionMaxLen - 1)` so that recognition strings
   * straddling the origin are matched. Defaults to `'linear'`.
   */
  topology?: Topology;
  /** Explicit molecular-state assumption for methylation-sensitive enzymes. */
  methylation?: RestrictionMethylationState | Partial<Record<RestrictionMethylationTarget, RestrictionMethylationState>>;
  /** Singular alias for integrations that carry one global state. */
  methylationState?: RestrictionMethylationState;
  /** Alias accepted by workflow callers that keep assumptions plural. */
  methylationAssumptions?: RestrictionMethylationState | Partial<Record<RestrictionMethylationTarget, RestrictionMethylationState>>;
}

export type RestrictionIssueCode =
  | 'invalid_sequence'
  | 'invalid_recognition_sequence'
  | 'insufficient_flanking_bases'
  | 'methylation_unknown'
  | 'methylation_unmethylated'
  | 'methylation_context_unknown'
  | 'invalid_geometry'
  | 'unknown_enzyme';

export interface RestrictionScanIssue {
  code: RestrictionIssueCode;
  message: string;
  enzyme?: string;
  position?: number;
  topCutPosition?: number | null;
  bottomCutPosition?: number | null;
  required?: string;
  observed?: string;
  evidence?: RestrictionMethylationEvidence;
}

/** The physical coordinates of both strand cleavages for one recognition site. */
export interface RestrictionCleavageGeometry {
  mode: RestrictionCleavageMode;
  topCutPosition: number | null;
  bottomCutPosition: number | null;
  /** Legacy digest boundary: top nick for double-strand/top-nick sites. */
  cutPosition: number;
  overhangStart: number;
  overhangEnd: number;
  overhangLength: number;
  valid: boolean;
  /** Canonical enzyme identities sharing this physical cut, when digested as a set. */
  enzymes?: string[];
}

export interface RestrictionScanResult {
  sequence: string;
  topology: Topology;
  sites: RestrictionSite[];
  issues: RestrictionScanIssue[];
}

export class RestrictionInputError extends Error {
  readonly code: 'invalid_sequence' | 'invalid_recognition_sequence';

  constructor(code: 'invalid_sequence' | 'invalid_recognition_sequence', message: string) {
    super(message);
    this.name = 'RestrictionInputError';
    this.code = code;
  }
}

const IUPAC_BASES: Readonly<Record<string, ReadonlySet<string>>> = {
  A: new Set(['A']),
  C: new Set(['C']),
  G: new Set(['G']),
  T: new Set(['T']),
  R: new Set(['A', 'G']),
  Y: new Set(['C', 'T']),
  S: new Set(['G', 'C']),
  W: new Set(['A', 'T']),
  K: new Set(['G', 'T']),
  M: new Set(['A', 'C']),
  B: new Set(['C', 'G', 'T']),
  D: new Set(['A', 'G', 'T']),
  H: new Set(['A', 'C', 'T']),
  V: new Set(['A', 'C', 'G']),
  N: new Set(['A', 'C', 'G', 'T']),
};

const IUPAC_SYMBOLS = new Set(Object.keys(IUPAC_BASES));

/** Remove display whitespace/numbering and normalize RNA U to DNA T. */
export function normalizeRestrictionSequence(seq: string): string {
  if (typeof seq !== 'string') {
    throw new RestrictionInputError('invalid_sequence', 'Restriction sequence must be a string.');
  }
  let normalized = '';
  for (const raw of seq.toUpperCase()) {
    if (/\s/.test(raw) || /[0-9]/.test(raw)) continue;
    const ch = raw === 'U' ? 'T' : raw;
    if (!IUPAC_SYMBOLS.has(ch)) {
      throw new RestrictionInputError(
        'invalid_sequence',
        `Restriction sequence contains unsupported symbol "${raw}". Use DNA/IUPAC symbols, whitespace, or numbering.`,
      );
    }
    normalized += ch;
  }
  return normalized;
}

/** Normalize and validate a custom enzyme recognition string. */
export function normalizeRestrictionRecognitionSequence(seq: string): string {
  if (typeof seq !== 'string') {
    throw new RestrictionInputError('invalid_recognition_sequence', 'Restriction recognition sequence must be a string.');
  }
  const normalized = seq.replace(/\s/g, '').toUpperCase().replaceAll('U', 'T');
  if (!normalized || [...normalized].some((ch) => !IUPAC_SYMBOLS.has(ch))) {
    throw new RestrictionInputError(
      'invalid_recognition_sequence',
      'Restriction recognition sequence must contain one or more IUPAC DNA symbols.',
    );
  }
  return normalized;
}

export function isValidRestrictionRecognitionSequence(seq: string): boolean {
  try {
    normalizeRestrictionRecognitionSequence(seq);
    return true;
  } catch {
    return false;
  }
}

function methylationStateFor(
  enzyme: RestrictionEnzyme,
  options: FindRestrictionSitesOptions | undefined,
): RestrictionMethylationState {
  const requirement = enzyme.methylationRequirement;
  if (!requirement) return 'methylated';
  const assumptions = options?.methylationAssumptions ?? options?.methylation ?? options?.methylationState;
  if (typeof assumptions === 'string') return assumptions;
  if (assumptions && assumptions[requirement.target] !== undefined) {
    return assumptions[requirement.target] as RestrictionMethylationState;
  }
  return 'unknown';
}

/** Compute explicit top/bottom nick coordinates before sequence-bound checks. */
export function calculateRestrictionCleavageGeometry(
  enzyme: RestrictionEnzyme,
  sitePosition: number,
  strand: 1 | -1 = 1,
): RestrictionCleavageGeometry {
  const recognitionLength = normalizeRestrictionRecognitionSequence(enzyme.recognitionSequence).length;
  const mode = enzyme.cleavageMode ?? 'double-strand';
  const forwardTop = strand === -1
    ? sitePosition + recognitionLength - enzyme.complementCutOffset
    : sitePosition + enzyme.cutOffset;
  const forwardBottom = strand === -1
    ? sitePosition + recognitionLength - enzyme.cutOffset
    : sitePosition + enzyme.complementCutOffset;
  const topCutPosition = mode === 'nick_bottom' ? null : forwardTop;
  const bottomCutPosition = mode === 'nick_top' ? null : forwardBottom;
  const positions = [topCutPosition, bottomCutPosition].filter((value): value is number => value !== null);
  const finite = positions.length > 0 && positions.every((value) => Number.isFinite(value));
  const cutPosition = positions[0] ?? Number.NaN;
  const overhangStart = finite ? Math.min(...positions) : Number.NaN;
  const overhangEnd = finite ? Math.max(...positions) : Number.NaN;
  const overhangLength = finite ? overhangEnd - overhangStart : Number.NaN;
  const valid = finite
    && Number.isInteger(overhangStart)
    && Number.isInteger(overhangEnd)
    && (mode === 'double-strand' || enzyme.overhang === 'blunt')
    && (mode !== 'double-strand' || (enzyme.overhang === 'blunt' ? overhangLength === 0 : overhangLength > 0));
  return {
    mode,
    topCutPosition,
    bottomCutPosition,
    cutPosition,
    overhangStart,
    overhangEnd,
    overhangLength,
    valid,
  };
}

function coordinateInLinearSequence(value: number | null, length: number): boolean {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= length);
}

function issueForSite(
  enzyme: RestrictionEnzyme,
  sitePosition: number,
  geometry: RestrictionCleavageGeometry,
  sequenceLength: number,
  topology: Topology,
  options: FindRestrictionSitesOptions | undefined,
): RestrictionScanIssue | null {
  if (!geometry.valid) {
    return {
      code: 'invalid_geometry',
      message: `Enzyme ${enzyme.name} has inconsistent ${geometry.mode} cleavage geometry.`,
      enzyme: enzyme.name,
      position: sitePosition,
      topCutPosition: geometry.topCutPosition,
      bottomCutPosition: geometry.bottomCutPosition,
    };
  }
  if (topology === 'linear' && (!coordinateInLinearSequence(geometry.topCutPosition, sequenceLength)
    || !coordinateInLinearSequence(geometry.bottomCutPosition, sequenceLength))) {
    return {
      code: 'insufficient_flanking_bases',
      message: `Enzyme ${enzyme.name} requires strand cleavage coordinates outside the linear sequence bounds.`,
      enzyme: enzyme.name,
      position: sitePosition,
      topCutPosition: geometry.topCutPosition,
      bottomCutPosition: geometry.bottomCutPosition,
      required: 'all strand cut coordinates within [0, sequence.length]',
    };
  }
  const requirement = enzyme.methylationRequirement;
  if (enzyme.methylationBehavior === 'context_dependent') {
    const assumptions = options?.methylationAssumptions ?? options?.methylation ?? options?.methylationState;
    const state = typeof assumptions === 'string'
      ? assumptions
      : assumptions?.cpg ?? 'unknown';
    if (state !== 'unmethylated') {
      return {
        code: 'methylation_context_unknown',
        message: `Enzyme ${enzyme.name} has context-dependent methylation behavior that Motif cannot resolve from a global state.`,
        enzyme: enzyme.name,
        position: sitePosition,
        observed: state,
        evidence: enzyme.methylationEvidence,
      };
    }
  }
  if (requirement) {
    const state = methylationStateFor(enzyme, options);
    if (state === 'unknown') {
      return {
        code: 'methylation_unknown',
        message: `Enzyme ${enzyme.name} requires ${requirement.target}=${requirement.state}, but the requested state is unknown.`,
        enzyme: enzyme.name,
        position: sitePosition,
        required: `${requirement.target}:${requirement.state}`,
        observed: state,
        evidence: requirement.evidence,
      };
    }
    if (state !== requirement.state) {
      return {
        code: 'methylation_unmethylated',
        message: `Enzyme ${enzyme.name} requires ${requirement.target}=${requirement.state}; requested state was ${state}.`,
        enzyme: enzyme.name,
        position: sitePosition,
        required: `${requirement.target}:${requirement.state}`,
        observed: state,
        evidence: requirement.evidence,
      };
    }
  }
  return null;
}

function concreteIupacMatch(buffer: string, start: number, recognition: string): boolean {
  if (start < 0 || start + recognition.length > buffer.length) return false;
  for (let offset = 0; offset < recognition.length; offset += 1) {
    const sequenceBase = buffer[start + offset];
    // A sequence ambiguity cannot prove a physical recognition site. It is
    // accepted by normalization and reported by countAmbiguousBases, but is
    // conservatively excluded from a cut assertion.
    if (!('ACGT'.includes(sequenceBase) && IUPAC_BASES[recognition[offset]].has(sequenceBase))) return false;
  }
  return true;
}

/**
 * Default working set of restriction enzymes used by the UI and digest functions.
 *
 * Originally the 25-enzyme 6-cutter / Type IIS panel preserved across releases.
 * VOG-1807: the eGFP onboarding sample (720 bp) has no canonical 6-cutter
 * site, so the Inspector "Common" tab opened to "0 cuts" — a dead end for
 * first-time users. Five canonical screening 4-cutters (AluI, HaeIII, TaqI,
 * HpaII, MspI) are appended so the default Inspector view yields useful
 * diagnostic digests on short ORF-sized sequences. The new enzymes are pushed
 * to the end so callers that index by position (`RESTRICTION_ENZYMES[1]`,
 * etc.) and the palette in `getRestrictionEnzymeColor` keep their current
 * mappings.
 *
 * For the full 200+ enzyme database use RESTRICTION_ENZYMES_FULL from enzyme-data.ts.
 */
export const RESTRICTION_ENZYMES: RestrictionEnzyme[] = [
  { name: 'EcoRI',  recognitionSequence: 'GAATTC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'BamHI',  recognitionSequence: 'GGATCC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'HindIII', recognitionSequence: 'AAGCTT',  cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'XbaI',   recognitionSequence: 'TCTAGA',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'SalI',   recognitionSequence: 'GTCGAC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'PstI',   recognitionSequence: 'CTGCAG',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'NotI',   recognitionSequence: 'GCGGCCGC', cutOffset: 2, complementCutOffset: 6, overhang: '5prime' },
  { name: 'XhoI',   recognitionSequence: 'CTCGAG',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'NcoI',   recognitionSequence: 'CCATGG',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'NdeI',   recognitionSequence: 'CATATG',   cutOffset: 2, complementCutOffset: 4, overhang: '5prime' },
  { name: 'SpeI',   recognitionSequence: 'ACTAGT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'KpnI',   recognitionSequence: 'GGTACC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'SacI',   recognitionSequence: 'GAGCTC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'SmaI',   recognitionSequence: 'CCCGGG',   cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
  { name: 'BglII',  recognitionSequence: 'AGATCT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'ClaI',   recognitionSequence: 'ATCGAT',   cutOffset: 2, complementCutOffset: 4, overhang: '5prime' },
  { name: 'EcoRV',  recognitionSequence: 'GATATC',   cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
  { name: 'AgeI',   recognitionSequence: 'ACCGGT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'NheI',   recognitionSequence: 'GCTAGC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'MluI',   recognitionSequence: 'ACGCGT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'BsaI',   recognitionSequence: 'GGTCTC',   cutOffset: 7, complementCutOffset: 11, overhang: '5prime' },
  { name: 'BbsI',   recognitionSequence: 'GAAGAC',   cutOffset: 8, complementCutOffset: 12, overhang: '5prime' },
  { name: 'ScaI',   recognitionSequence: 'AGTACT',   cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
  { name: 'ApaI',   recognitionSequence: 'GGGCCC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'SphI',   recognitionSequence: 'GCATGC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  // VOG-1807: canonical screening 4-cutters that appear in molecular biology
  // kits (RFLP/diagnostic digests, methylation-sensitive pair, RAD-tag panel).
  // Order matches the AluI/HaeIII/TaqI/HpaII/MspI panel called out in the
  // ticket. Mirrors RESTRICTION_ENZYMES_FULL entries 1:1 so the digest engine
  // returns identical cut/overhang shapes whichever set the caller passes.
  { name: 'AluI',   recognitionSequence: 'AGCT',     cutOffset: 2, complementCutOffset: 2, overhang: 'blunt'  },
  { name: 'HaeIII', recognitionSequence: 'GGCC',     cutOffset: 2, complementCutOffset: 2, overhang: 'blunt'  },
  { name: 'TaqI',   recognitionSequence: 'TCGA',     cutOffset: 1, complementCutOffset: 3, overhang: '5prime' },
  { name: 'HpaII',  recognitionSequence: 'CCGG',     cutOffset: 1, complementCutOffset: 3, overhang: '5prime' },
  { name: 'MspI',   recognitionSequence: 'CCGG',     cutOffset: 1, complementCutOffset: 3, overhang: '5prime' },
];

for (const enzyme of RESTRICTION_ENZYMES) {
  enzyme.cleavageMode ??= 'double-strand';
}

// For the full 200+ enzyme database, import directly from './enzyme-data'.

// Recognition is matched base-by-base rather than interpolated into a RegExp.
// This both handles IUPAC symbols explicitly and makes regex injection
// impossible for custom enzyme records.

/**
 * Find all restriction sites in a sequence for the given enzymes.
 *
 * Phase 34 P-B B1: now scans BOTH strands. For each non-palindromic enzyme,
 * the reverse-complement of the recognition sequence is also scanned and
 * matches are tagged `strand: -1`. This matches the Rust engine's output
 * structure and is critical for Type IIS enzymes (BsaI/BbsI/BsmBI/SapI/etc.)
 * whose binding sites are not symmetric. Empirically verified: BsaI on
 * `AAAAAAGAGACCTTTTT` (where `GAGACC = revcomp(GGTCTC)`) now correctly
 * returns 1 site at position 6.
 *
 * Phase 34 P-B B3: when `options.topology === 'circular'`, the scanner
 * appends a wrap window so that recognition strings straddling the origin
 * are matched. Returned `position` values stay in `[0, seq.length)`.
 *
 * @param seq - DNA sequence
 * @param enzymes - List of restriction enzymes to scan (defaults to all)
 * @param options - Optional topology hint (default: linear)
 */
export function findRestrictionSites(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionSite[] {
  return scanRestrictionSites(seq, enzymes, options).sites;
}

/** Descriptive alias for callers that need scanner issues as well as sites. */
export const findRestrictionSitesDetailed = scanRestrictionSites;

/**
 * Scan both strands while retaining physical cleavage geometry and structured
 * conditional outcomes. `findRestrictionSites` remains the compatibility
 * wrapper for callers that only need the site array.
 */
export function scanRestrictionSites(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionScanResult {
  const upper = normalizeRestrictionSequence(seq);
  const topology: Topology = options?.topology ?? 'linear';
  const sites: RestrictionSite[] = [];
  const issues: RestrictionScanIssue[] = [];
  if (upper.length === 0 || enzymes.length === 0) return { sequence: upper, topology, sites, issues };

  const normalizedEnzymes = enzymes.map((enzyme) => ({
    ...enzyme,
    recognitionSequence: normalizeRestrictionRecognitionSequence(enzyme.recognitionSequence),
  }));
  const maxRecLen = Math.max(...normalizedEnzymes.map((enzyme) => enzyme.recognitionSequence.length));
  const wrapWindow = topology === 'circular' ? Math.max(0, maxRecLen - 1) : 0;
  const scanBuffer = wrapWindow > 0
    ? upper + upper.repeat(Math.ceil(wrapWindow / upper.length)).slice(0, wrapWindow)
    : upper;
  const seen = new Set<string>();
  const modulo = (value: number): number => ((value % upper.length) + upper.length) % upper.length;

  const addSite = (enzyme: RestrictionEnzyme, index: number, strand: 1 | -1): void => {
    const recognition = normalizeRestrictionRecognitionSequence(enzyme.recognitionSequence);
    const geometry = calculateRestrictionCleavageGeometry(enzyme, index, strand);
    const circularGeometry = topology === 'circular'
      ? {
          ...geometry,
          topCutPosition: geometry.topCutPosition === null ? null : modulo(geometry.topCutPosition),
          bottomCutPosition: geometry.bottomCutPosition === null ? null : modulo(geometry.bottomCutPosition),
          cutPosition: modulo(geometry.cutPosition),
          overhangStart: modulo(geometry.overhangStart),
          overhangEnd: modulo(geometry.overhangEnd),
        }
      : geometry;
    const issue = issueForSite(enzyme, index, circularGeometry, upper.length, topology, options);
    const status: RestrictionCleavageStatus = issue?.code === 'insufficient_flanking_bases'
      ? 'insufficient_flanking_bases'
      : issue?.code === 'methylation_unknown'
        ? 'methylation_unknown'
        : issue?.code === 'methylation_unmethylated'
          ? 'methylation_unmethylated'
          : issue?.code === 'methylation_context_unknown'
            ? 'methylation_context_unknown'
          : issue?.code === 'invalid_geometry' ? 'invalid_geometry' : 'ok';
    if (issue) issues.push(issue);
    const dedupeKey = `${enzyme.name}@${index}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const site: RestrictionSite = {
      enzyme: enzyme.name,
      position: index,
      cutPosition: circularGeometry.cutPosition,
      recognitionSequence: recognition,
      overhang: enzyme.overhang,
      strand,
    };
    // Keep legacy object serialization/equality stable while exposing the new
    // physical fields to typed/browser callers.
    Object.defineProperties(site, {
      cleavageMode: { value: enzyme.cleavageMode ?? 'double-strand', enumerable: false },
      topCutPosition: { value: circularGeometry.topCutPosition, enumerable: false },
      bottomCutPosition: { value: circularGeometry.bottomCutPosition, enumerable: false },
      cleavageStatus: { value: status, enumerable: false },
    });
    sites.push(site);
  };

  for (const enzyme of normalizedEnzymes) {
    const recognition = enzyme.recognitionSequence;
    const reverseRecognition = reverseComplement(recognition);
    const isPalindrome = reverseRecognition === recognition;
    const patterns: Array<[string, 1 | -1]> = [[recognition, 1]];
    if (!isPalindrome) patterns.push([reverseRecognition, -1]);
    for (const [pattern, strand] of patterns) {
      for (let index = 0; index <= scanBuffer.length - pattern.length; index += 1) {
        if (topology === 'circular' && index >= upper.length) continue;
        if (concreteIupacMatch(scanBuffer, index, pattern)) addSite(enzyme, index, strand);
      }
    }
  }

  sites.sort((a, b) => a.position - b.position || a.enzyme.localeCompare(b.enzyme));
  return { sequence: upper, topology, sites, issues };
}

/**
 * Find enzymes that cut exactly once (unique cutters).
 */
export function findUniqueCutters(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionSite[] {
  const allSites = findRestrictionSites(seq, enzymes, options)
    .filter((site) => (
      (site.cleavageMode ?? 'double-strand') === 'double-strand'
      && (site.cleavageStatus ?? 'ok') === 'ok'
    ));

  // Group by enzyme
  const byEnzyme = new Map<string, RestrictionSite[]>();
  for (const site of allSites) {
    const list = byEnzyme.get(site.enzyme) ?? [];
    list.push(site);
    byEnzyme.set(site.enzyme, list);
  }

  // Return only those that appear exactly once
  const unique: RestrictionSite[] = [];
  for (const [, sitesForEnzyme] of byEnzyme) {
    if (sitesForEnzyme.length === 1) {
      unique.push(sitesForEnzyme[0]);
    }
  }

  return unique.sort((a, b) => a.position - b.position);
}

/**
 * Detect sequence-side IUPAC ambiguity. Ambiguous input is accepted by the
 * scanner but is conservatively excluded from a physical site assertion; this
 * helper lets the UI explain a possible under-count before showing results.
 *
 * Returns the count of ambiguous (non-A/C/G/T) bases. Whitespace and digits
 * are ignored to match `findRestrictionSites`'s pre-scan normalization.
 */
export function countAmbiguousBases(seq: string): number {
  let count = 0;
  for (const ch of seq.toUpperCase()) {
    if (ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T' || ch === 'U') continue;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    if (ch >= '0' && ch <= '9') continue;
    if ('RYSWKMBDHVN'.includes(ch)) count++;
  }
  return count;
}

/**
 * Find enzymes that do NOT cut the sequence (non-cutters).
 */
export function findNonCutters(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionEnzyme[] {
  const allSites = findRestrictionSites(seq, enzymes, options);
  const cuttingEnzymes = new Set(allSites
    .filter((site) => (
      (site.cleavageMode ?? 'double-strand') === 'double-strand'
      && (site.cleavageStatus ?? 'ok') === 'ok'
    ))
    .map((site) => site.enzyme));
  return enzymes.filter(e => !cuttingEnzymes.has(e.name));
}
