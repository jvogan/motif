import type { Feature } from './types';
import { gcContent } from './gc-content';
import { calculateTm, type TmOptions } from './tm-calculator';
import { reverseComplement } from './reverse-complement';
import {
  predictHairpin,
  predictSelfDimer,
  predictPrimerDimer,
  DEFAULT_MAX_HAIRPIN_DG,
  DEFAULT_MAX_DIMER_DG,
  type DimerResult,
} from './primer-thermodynamics';
import { inspectNucleotideSequence } from './nucleotide';

/**
 * Realistic PCR buffer defaults. SantaLucia 1998 NN-Tm
 * computed at the legacy default 50 mM Na, 0 Mg, 0 dNTP undershoots
 * real-PCR Tm by 5-7 °C — a thermal cycler annealing temp set at the
 * dialog-displayed Tm will mis-anneal in the actual reaction. Common
 * standard PCR conditions:
 *   - 50 mM Na+ (KCl/NaCl combined, normalized to Na)
 *   - 1.5 mM Mg2+ (Taq, Q5, KOD, Phusion default)
 *   - 0.2 mM dNTPs (each dNTP at 0.05 mM × 4)
 *   - 250 nM primer
 */
export const DEFAULT_TM_OPTIONS: TmOptions = {
  method: 'nearest-neighbor',
  naConcentration: 50,
  mgConcentration: 1.5,
  dntpConcentration: 0.2,
  primerConcentration: 250,
  saltCorrection: 'owczarzy',
};

export interface PrimerDesignParams {
  targetStart: number;
  targetEnd: number;
  /** Binding-region length in nt; the core accepts 12–60 nt. */
  minLength?: number;
  /** Binding-region length in nt; the core accepts 12–60 nt. */
  maxLength?: number;
  targetTm?: number;
  tmTolerance?: number;
  /**
   * When false, Tm is used only for ranking context; candidates are not rejected
   * for being outside targetTm ± tmTolerance.
   */
  enforceTargetTm?: boolean;
  /** Maximum ranked primer pairs returned to UI/export callers. */
  maxPairs?: number;
  /**
   * Cap each direction's candidate pool before forward×reverse pairing.
   * Prevents very broad/flank scans from producing a huge cross-product while
   * still pairing the highest-ranked single-primer candidates first.
   */
  maxPairingCandidatesPerDirection?: number;
  minGC?: number;
  maxGC?: number;
  /** Optional 5′ tail; at most 250 nt and 500 nt including the binding region. */
  forwardTail?: string;
  /** Optional 5′ tail; at most 250 nt and 500 nt including the binding region. */
  reverseTail?: string;
  // Primer3-style 3' GC clamp — require at least one G/C in the
  // last 5 nt of the primer's 3' end. Default ON: prevents AAAA-tail
  // mispriming + slippage.
  requireGcClamp?: boolean;
  // Primer3-style flanking-region scan. Forward primers
  // may start anywhere in [targetStart - flankingWindow, targetStart];
  // reverse primers may end anywhere in [targetEnd, targetEnd + flankingWindow].
  // Default 50 nt — same window Primer3 uses out of the box. Pass 0 to fall
  // back to legacy anchor-only behavior.
  flankingWindow?: number;
  /**
   * Tm calculation buffer conditions. Defaults to
   * DEFAULT_TM_OPTIONS (50 mM Na, 1.5 mM Mg, 0.2 mM dNTP, 250 nM primer).
   * Passing `{}` or {mgConcentration: 0} reproduces legacy behavior.
   */
  tmOptions?: TmOptions;
  /**
   * Hairpin ΔG37 cutoff (kcal/mol). Candidates whose
   * predicted hairpin ΔG is MORE NEGATIVE than this value are rejected.
   * Default -3.0 (Primer3 standard). Pass `null` to disable.
   */
  maxHairpinDeltaG?: number | null;
  /**
   * Self-dimer ΔG37 cutoff (kcal/mol). Candidates whose
   * predicted self-dimer ΔG is MORE NEGATIVE than this value are rejected.
   * Default -5.0 (Primer3 standard). Pass `null` to disable.
   */
  maxSelfDimerDeltaG?: number | null;
}

export interface PrimerCandidate {
  sequence: string;       // binding region only
  fullSequence: string;   // tail + binding region
  tail: string;           // 5' tail (empty string if none)
  start: number;
  end: number;
  length: number;         // binding region length
  fullLength: number;     // total length including tail
  tm: number;             // Tm of binding region only
  gcPercent: number;      // GC% of binding region only
  direction: 'forward' | 'reverse';
  // Distance (nt) from the user's target anchor. 0 = primer
  // begins/ends at the anchor exactly; positive = primer sits outside the
  // target window (forward to the 5' side of targetStart, reverse to the
  // 3' side of targetEnd). Used to rank candidates and penalize drift.
  anchorDistance: number;
  /** Secondary-structure evidence evaluated on the full ordered oligo. */
  hairpinDeltaG?: number;
  selfDimerDeltaG?: number;
  secondaryStructureStatus?: 'exact' | 'ambiguous' | 'invalid';
  secondaryStructureWarnings?: string[];
}

export interface PrimerPair {
  forward: PrimerCandidate;
  reverse: PrimerCandidate;
  productLength: number;
  tmDifference: number;
  /** Cross-primer interaction evidence retained for deterministic ranking. */
  crossDimer?: DimerResult;
}

/**
 * Per-filter rejection counts.
 *
 * Tracks how many candidate positions × lengths fell out of consideration at
 * each filter step. Surfaced in the dialog when 0 candidates pass so the
 * scientist can see *why* their parameters yield nothing.
 */
export interface PrimerRejectionCounts {
  /** Failed GC% range (gc < minGC || gc > maxGC) */
  gc: number;
  /** Failed Tm range (|tm - targetTm| > tmTolerance) */
  tm: number;
  /** Length exceeded available sequence (e.g. target near 5' end of input) */
  length: number;
  /** Failed 3' GC clamp (no G/C in last 5 nt) */
  clamp: number;
  /** Calculator returned no result (sequence had non-canonical bases) */
  invalid: number;
  /**
   * Predicted hairpin ΔG below threshold (too stable).
   * Optional for backward-compat with consumers that construct this shape
   * directly without specifying the new fields.
   */
  hairpin?: number;
  /**
   * Predicted self-dimer ΔG below threshold (too stable).
   * Optional for backward-compat (see above).
   */
  dimer?: number;
}

/**
 * Secondary rejection counts — how many candidates that were
 * rejected by the PRIMARY filter (e.g. gc) ALSO would have failed a later
 * filter (tm, clamp). Without these counts the diagnostic message implies the
 * only problem is the primary filter, but users widening one constraint find
 * the next filter just as restrictive. Counts are computed independently of
 * the short-circuit `continue` ordering.
 */
export interface PrimerSecondaryRejectionCounts {
  /** Of candidates rejected by gc, how many also failed tm? */
  gcAlsoFailedTm: number;
  /** Of candidates rejected by gc, how many also failed clamp? */
  gcAlsoFailedClamp: number;
  /** Of candidates rejected by tm, how many also failed clamp? */
  tmAlsoFailedClamp: number;
  /** Of candidates rejected by gc, how many also failed both tm AND clamp? */
  gcAlsoFailedTmAndClamp: number;
}

/** Result shape returned by the diagnostics variants. */
export interface PrimerDesignResult {
  candidates: PrimerCandidate[];
  rejections: PrimerRejectionCounts;
  /** Per-rejection multi-criteria attribution counts. */
  secondaryRejections?: PrimerSecondaryRejectionCounts;
  /** Input/tail integrity warnings that prevented exact candidate evaluation. */
  warnings?: string[];
}

export interface PrimerPairRejections extends PrimerRejectionCounts {
  /** Forward + reverse passed individually but failed pair Tm difference filter */
  tmDiff: number;
  /** Forward + reverse passed individually but product length was zero or negative */
  productLength: number;
}

export interface PrimerPairResult {
  pairs: PrimerPair[];
  rejections: PrimerPairRejections;
  /** Diagnostics from the underlying forward/reverse scans, in case 0 pairs */
  forwardRejections: PrimerRejectionCounts;
  reverseRejections: PrimerRejectionCounts;
  /** Secondary (multi-criteria) rejection counts. */
  forwardSecondary?: PrimerSecondaryRejectionCounts;
  reverseSecondary?: PrimerSecondaryRejectionCounts;
  forwardCount: number;
  reverseCount: number;
  /** Input/tail integrity warnings carried from both directional scans. */
  warnings?: string[];
}

const DEFAULT_MIN_LENGTH = 18;
const DEFAULT_MAX_LENGTH = 28;
const DEFAULT_TARGET_TM = 60;
const DEFAULT_TM_TOLERANCE = 3;
const DEFAULT_MIN_GC = 0.30;
const DEFAULT_MAX_GC = 0.70;
const DEFAULT_REQUIRE_GC_CLAMP = true;
const DEFAULT_FLANKING_WINDOW = 50;
export const MAX_PRIMER_TAIL_LENGTH = 250;
export const MAX_PRIMER_OLIGO_LENGTH = 500;
export const MIN_PRIMER_BINDING_LENGTH = 12;
export const MAX_PRIMER_BINDING_LENGTH = 60;
export const MAX_PRIMER_FLANKING_WINDOW = 250;
const MAX_TM_DIFF_PAIR = 5;
const MAX_PAIRS_RETURNED = 10;
const MAX_PAIRING_CANDIDATES_PER_DIRECTION = 240;
// Distance penalty weight — each nt away from the anchor adds this
// many degrees of "virtual Tm error" in the sort. A primer 30 nt off-anchor
// with a perfect Tm ranks below an on-anchor primer with ΔTm = 1.5 °C.
// Empirical: 0.05 chosen so that 50 nt of drift ≈ 2.5 °C virtual Tm
// penalty — roughly matches Primer3's POSITION_PENALTY default behavior.
const ANCHOR_DISTANCE_PENALTY = 0.05;

// 3' GC clamp filter. Returns true if the last 5 nt
// of the primer contain at least one G or C (Primer3 standard).
function has3PrimeGcClamp(primer: string): boolean {
  const tail = primer.slice(-5);
  return /[GCgc]/.test(tail);
}

function emptyRejections(): Required<PrimerRejectionCounts> {
  return { gc: 0, tm: 0, length: 0, clamp: 0, invalid: 0, hairpin: 0, dimer: 0 };
}

// Secondary rejection counter — populated by the design loops
// to capture multi-criteria failure attribution (e.g. "rejected by gc, also
// would have failed tm").
function emptySecondaryRejections(): PrimerSecondaryRejectionCounts {
  return { gcAlsoFailedTm: 0, gcAlsoFailedClamp: 0, tmAlsoFailedClamp: 0, gcAlsoFailedTmAndClamp: 0 };
}

/**
 * Score a candidate for sorting — closer to anchor and closer to target Tm wins.
 * Combines Tm distance + anchor distance penalty into a single rank.
 */
function rankScore(c: PrimerCandidate, targetTm: number): number {
  return Math.abs(c.tm - targetTm) + c.anchorDistance * ANCHOR_DISTANCE_PENALTY;
}

function boundedPositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value ?? NaN)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value as number)));
}

export type NormalizedPrimerDesignParams = {
  targetStart: number;
  targetEnd: number;
  minLength: number;
  maxLength: number;
  targetTm: number;
  tmTolerance: number;
  enforceTargetTm: boolean;
  minGC: number;
  maxGC: number;
  tail: string;
  requireGcClamp: boolean;
  flankingWindow: number;
  tmOptions: TmOptions;
  maxHairpinDeltaG: number | null | undefined;
  maxSelfDimerDeltaG: number | null | undefined;
  warnings: string[];
};

function invalidPrimerDesignResult(message: string): PrimerDesignResult {
  return {
    candidates: [],
    rejections: { ...emptyRejections(), invalid: 1 },
    secondaryRejections: emptySecondaryRejections(),
    warnings: [message],
  };
}

function normalizedOligo(value: unknown): { sequence: string; warning?: string; invalid: boolean } {
  if (value !== undefined && typeof value !== 'string') {
    return { sequence: '', invalid: true, warning: 'Oligo input must be a nucleotide string.' };
  }
  const inspected = inspectNucleotideSequence(value ?? '');
  if (inspected.invalidCharacters.length > 0) {
    return {
      sequence: inspected.sequence,
      invalid: true,
      warning: `Oligo input contains invalid nucleotide characters: ${inspected.invalidCharacters.join(', ')}.`,
    };
  }
  if (inspected.sequence.length > MAX_PRIMER_TAIL_LENGTH) {
    return {
      sequence: inspected.sequence,
      invalid: true,
      warning: `Oligo tail cannot exceed ${MAX_PRIMER_TAIL_LENGTH.toLocaleString()} nt.`,
    };
  }
  return inspected.ambiguous
    ? {
        sequence: inspected.sequence,
        invalid: false,
        warning: 'Oligo tail contains IUPAC ambiguity symbols; secondary-structure diagnostics require review.',
      }
    : { sequence: inspected.sequence, invalid: false };
}

function finiteIntegerOption(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value)) return null;
  return value < minimum || value > maximum ? null : value;
}

function finiteNumberOption(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < minimum || value > maximum ? null : value;
}

/**
 * Normalize every numeric primer-design control and tail through one bounded
 * path. Exported design entry points use this before scanning so malformed
 * UI/agent values cannot turn a finite request into an unbounded loop.
 */
export function normalizePrimerDesignParams(
  sequenceLength: number,
  params: PrimerDesignParams,
  direction: 'forward' | 'reverse',
): NormalizedPrimerDesignParams | null {
  if (!Number.isSafeInteger(sequenceLength) || sequenceLength < 0) return null;
  const raw = params as Partial<PrimerDesignParams> | null | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const targetStart = raw.targetStart === undefined
    ? null
    : finiteIntegerOption(raw.targetStart, 0, 0, sequenceLength);
  const targetEnd = raw.targetEnd === undefined
    ? null
    : finiteIntegerOption(raw.targetEnd, sequenceLength, 0, sequenceLength);
  const minLength = finiteIntegerOption(raw.minLength, DEFAULT_MIN_LENGTH, MIN_PRIMER_BINDING_LENGTH, MAX_PRIMER_BINDING_LENGTH);
  const requestedMaxLength = finiteIntegerOption(raw.maxLength, DEFAULT_MAX_LENGTH, MIN_PRIMER_BINDING_LENGTH, MAX_PRIMER_BINDING_LENGTH);
  const targetTm = finiteNumberOption(raw.targetTm, DEFAULT_TARGET_TM, 0, 200);
  const tmTolerance = finiteNumberOption(raw.tmTolerance, DEFAULT_TM_TOLERANCE, 0, 100);
  const minGC = finiteNumberOption(raw.minGC, DEFAULT_MIN_GC, 0, 1);
  const maxGC = finiteNumberOption(raw.maxGC, DEFAULT_MAX_GC, 0, 1);
  const flankingWindow = finiteIntegerOption(raw.flankingWindow, DEFAULT_FLANKING_WINDOW, 0, MAX_PRIMER_FLANKING_WINDOW);
  const maxHairpinDeltaG = raw.maxHairpinDeltaG === undefined
    ? DEFAULT_MAX_HAIRPIN_DG
    : raw.maxHairpinDeltaG === null
      ? null
      : typeof raw.maxHairpinDeltaG === 'number'
        && Number.isFinite(raw.maxHairpinDeltaG)
        ? raw.maxHairpinDeltaG
        : Number.NaN;
  const maxSelfDimerDeltaG = raw.maxSelfDimerDeltaG === undefined
    ? DEFAULT_MAX_DIMER_DG
    : raw.maxSelfDimerDeltaG === null
      ? null
      : typeof raw.maxSelfDimerDeltaG === 'number'
        && Number.isFinite(raw.maxSelfDimerDeltaG)
        ? raw.maxSelfDimerDeltaG
        : Number.NaN;
  if (
    targetStart === null
    || targetEnd === null
    || minLength === null
    || requestedMaxLength === null
    || targetTm === null
    || tmTolerance === null
    || minGC === null
    || maxGC === null
    || flankingWindow === null
    || Number.isNaN(maxHairpinDeltaG as number)
    || Number.isNaN(maxSelfDimerDeltaG as number)
    || targetStart >= targetEnd
    || minLength > requestedMaxLength
    || minGC > maxGC
    || (raw.enforceTargetTm !== undefined && typeof raw.enforceTargetTm !== 'boolean')
    || (raw.requireGcClamp !== undefined && typeof raw.requireGcClamp !== 'boolean')
  ) return null;

  const normalizedTail = normalizedOligo(direction === 'forward' ? raw.forwardTail : raw.reverseTail);
  if (normalizedTail.invalid) return null;
  const maxLength = Math.min(requestedMaxLength, MAX_PRIMER_OLIGO_LENGTH - normalizedTail.sequence.length);
  if (maxLength < 1) return null;
  return {
    targetStart,
    targetEnd,
    minLength,
    maxLength,
    targetTm,
    tmTolerance,
    enforceTargetTm: typeof raw.enforceTargetTm === 'boolean' ? raw.enforceTargetTm : true,
    minGC,
    maxGC,
    tail: normalizedTail.sequence,
    requireGcClamp: typeof raw.requireGcClamp === 'boolean' ? raw.requireGcClamp : DEFAULT_REQUIRE_GC_CLAMP,
    flankingWindow,
    tmOptions: raw.tmOptions ?? DEFAULT_TM_OPTIONS,
    maxHairpinDeltaG,
    maxSelfDimerDeltaG,
    warnings: normalizedTail.warning ? [normalizedTail.warning] : [],
  };
}

function pairRankScore(pair: PrimerPair, targetTm: number, enforceTargetTm: boolean): number {
  const tmPairPenalty = pair.tmDifference * 2;
  const targetPenalty = enforceTargetTm
    ? (Math.abs(pair.forward.tm - targetTm) + Math.abs(pair.reverse.tm - targetTm)) / 2
    : 0;
  const anchorPenalty = (pair.forward.anchorDistance + pair.reverse.anchorDistance) * ANCHOR_DISTANCE_PENALTY;
  const gcBalancePenalty = (Math.abs(pair.forward.gcPercent - 50) + Math.abs(pair.reverse.gcPercent - 50)) * 0.01;
  const crossDimer = pair.crossDimer ?? predictPrimerDimer(pair.forward.fullSequence, pair.reverse.fullSequence);
  const crossDimerPenalty = crossDimer.status === 'exact'
    ? Math.max(0, -crossDimer.deltaG) * 0.1
      + (crossDimer.threePrimeOverlap.primer1 + crossDimer.threePrimeOverlap.primer2) * 0.75
    : 0;
  return tmPairPenalty + targetPenalty + anchorPenalty + gcBalancePenalty + crossDimerPenalty;
}

/**
 * Primer3-style flanking-region scan for forward primers.
 *
 * Forward primers may start anywhere in [targetStart - flank, targetStart] —
 * the product MUST still cover targetStart (which is the user's region of
 * interest). For each candidate start position × every length in
 * [minLength, maxLength], we apply the filter chain (length-fits, GC, Tm,
 * 3' clamp, valid base set) and record per-filter rejection counts.
 *
 * Candidates are sorted by `rankScore` (Tm distance + anchor distance penalty)
 * so the top result is the on-anchor primer with the best Tm match.
 */
export function designForwardPrimerWithDiagnostics(
  seq: string,
  params: PrimerDesignParams,
): PrimerDesignResult {
  if (typeof seq !== 'string') return invalidPrimerDesignResult('Primer template must be a nucleotide string.');
  const inspectedSequence = inspectNucleotideSequence(seq);
  const upper = inspectedSequence.sequence;
  const normalized = normalizePrimerDesignParams(upper.length, params, 'forward');
  if (!normalized) {
    const tail = normalizedOligo((params as PrimerDesignParams | null | undefined)?.forwardTail);
    return invalidPrimerDesignResult(tail.warning ?? 'Primer design parameters must use finite bounded values.');
  }
  const {
    targetStart,
    minLength,
    maxLength,
    targetTm,
    tmTolerance,
    enforceTargetTm,
    minGC,
    maxGC,
    tail,
    requireGcClamp,
    flankingWindow,
    tmOptions,
    maxHairpinDeltaG,
    maxSelfDimerDeltaG,
    warnings: normalizedWarnings,
  } = normalized;
  const candidates: PrimerCandidate[] = [];
  const rejections = emptyRejections();
  const secondaryRejections = emptySecondaryRejections();
  const warnings = [
    ...(inspectedSequence.invalidCharacters.length > 0
      ? [`Template contains invalid nucleotide characters: ${inspectedSequence.invalidCharacters.join(', ')}.`]
      : []),
    ...normalizedWarnings,
  ];

  // Scan a window of start positions to the 5' side of targetStart.
  // The product MUST cover targetStart, so start positions can range from
  // max(0, targetStart - flankingWindow) up to and including targetStart.
  const startMin = Math.max(0, targetStart - Math.max(0, flankingWindow));
  const startMax = targetStart;

  for (let start = startMin; start <= startMax; start++) {
    const anchorDistance = targetStart - start;
    for (let len = minLength; len <= maxLength; len++) {
      // Length filter: primer must fit inside the template AND must extend
      // far enough to actually reach targetStart (otherwise the product
      // wouldn't cover the user's region of interest).
      if (start + len > upper.length) {
        rejections.length++;
        continue;
      }
      if (start + len < targetStart) {
        // Primer ends before reaching the anchor — useless for the product.
        rejections.length++;
        continue;
      }

      const primerSeq = upper.slice(start, start + len);
      const gc = gcContent(primerSeq);
      const tmResult = calculateTm(primerSeq, tmOptions);
      if (tmResult.status !== 'exact') {
        rejections.invalid++;
        continue;
      }
      const tm = tmResult.tm;

      // Evaluate ALL three filters before counting so that
      // multi-criteria failures are attributed correctly. The primary count
      // still goes to the first failing filter (short-circuit-compatible),
      // but secondaryRejections capture the "would also have failed X" stats.
      const failsGc = gc < minGC || gc > maxGC;
      const failsTm = enforceTargetTm && Math.abs(tm - targetTm) > tmTolerance;
      const failsClamp = requireGcClamp && !has3PrimeGcClamp(primerSeq);

      if (failsGc) {
        rejections.gc++;
        if (failsTm && failsClamp) secondaryRejections.gcAlsoFailedTmAndClamp++;
        if (failsTm) secondaryRejections.gcAlsoFailedTm++;
        if (failsClamp) secondaryRejections.gcAlsoFailedClamp++;
        continue;
      }
      if (failsTm) {
        rejections.tm++;
        if (failsClamp) secondaryRejections.tmAlsoFailedClamp++;
        continue;
      }
      if (failsClamp) {
        rejections.clamp++;
        continue;
      }

      // Hairpin + self-dimer ΔG filters.
      const fullPrimerSeq = tail + primerSeq;
      let hairpinDeltaG: number | undefined;
      let selfDimerDeltaG: number | undefined;
      let secondaryStructureStatus: PrimerCandidate['secondaryStructureStatus'] = 'exact';
      const secondaryStructureWarnings: string[] = [];
      if (maxHairpinDeltaG != null && Number.isFinite(maxHairpinDeltaG)) {
        const hp = predictHairpin(fullPrimerSeq);
        hairpinDeltaG = hp.deltaG;
        secondaryStructureStatus = hp.status;
        if (hp.warning) secondaryStructureWarnings.push(hp.warning);
        if (hp.deltaG < maxHairpinDeltaG) {
          rejections.hairpin++;
          continue;
        }
      }
      if (maxSelfDimerDeltaG != null && Number.isFinite(maxSelfDimerDeltaG)) {
        const dimer = predictSelfDimer(fullPrimerSeq);
        selfDimerDeltaG = dimer.deltaG;
        if (dimer.status === 'invalid' || (dimer.status === 'ambiguous' && secondaryStructureStatus === 'exact')) {
          secondaryStructureStatus = dimer.status;
        }
        if (dimer.warning) secondaryStructureWarnings.push(dimer.warning);
        if (dimer.deltaG < maxSelfDimerDeltaG) {
          rejections.dimer++;
          continue;
        }
      }

      candidates.push({
        sequence: primerSeq,
        fullSequence: fullPrimerSeq,
        tail,
        start,
        end: start + len,
        length: len,
        fullLength: tail.length + len,
        tm,
        gcPercent: gc * 100,
        direction: 'forward',
        anchorDistance,
        hairpinDeltaG,
        selfDimerDeltaG,
        secondaryStructureStatus,
        ...(secondaryStructureWarnings.length > 0 ? { secondaryStructureWarnings } : {}),
      });
    }
  }

  candidates.sort((a, b) => rankScore(a, targetTm) - rankScore(b, targetTm));
  return { candidates, rejections, secondaryRejections, warnings };
}

/**
 * Primer3-style flanking-region scan for reverse primers.
 *
 * Reverse primers may end anywhere in [targetEnd, targetEnd + flank] — the
 * product MUST still cover targetEnd. Same filter chain + rejection
 * accounting as the forward path.
 */
export function designReversePrimerWithDiagnostics(
  seq: string,
  params: PrimerDesignParams,
): PrimerDesignResult {
  if (typeof seq !== 'string') return invalidPrimerDesignResult('Primer template must be a nucleotide string.');
  const inspectedSequence = inspectNucleotideSequence(seq);
  const upper = inspectedSequence.sequence;
  const normalized = normalizePrimerDesignParams(upper.length, params, 'reverse');
  if (!normalized) {
    const tail = normalizedOligo((params as PrimerDesignParams | null | undefined)?.reverseTail);
    return invalidPrimerDesignResult(tail.warning ?? 'Primer design parameters must use finite bounded values.');
  }
  const {
    targetEnd,
    minLength,
    maxLength,
    targetTm,
    tmTolerance,
    enforceTargetTm,
    minGC,
    maxGC,
    tail,
    requireGcClamp,
    flankingWindow,
    tmOptions,
    maxHairpinDeltaG,
    maxSelfDimerDeltaG,
    warnings: normalizedWarnings,
  } = normalized;
  const candidates: PrimerCandidate[] = [];
  const rejections = emptyRejections();
  const secondaryRejections = emptySecondaryRejections();
  const warnings = [
    ...(inspectedSequence.invalidCharacters.length > 0
      ? [`Template contains invalid nucleotide characters: ${inspectedSequence.invalidCharacters.join(', ')}.`]
      : []),
    ...normalizedWarnings,
  ];

  // Reverse primer's end coordinate ranges from targetEnd (on-anchor)
  // up to targetEnd + flankingWindow (clipped to sequence end).
  const endMin = targetEnd;
  const endMax = Math.min(upper.length, targetEnd + Math.max(0, flankingWindow));

  for (let end = endMin; end <= endMax; end++) {
    const anchorDistance = end - targetEnd;
    for (let len = minLength; len <= maxLength; len++) {
      const start = end - len;
      // Length filter: primer must fit AND must extend back far enough to
      // cover targetEnd (otherwise the product wouldn't reach the anchor).
      if (start < 0) {
        rejections.length++;
        continue;
      }
      if (start >= targetEnd) {
        // Primer is entirely past the target's 3' edge — wouldn't bind to
        // the anchor region. Wasted candidate.
        rejections.length++;
        continue;
      }

      const templateRegion = upper.slice(start, end);
      const primerSeq = reverseComplement(templateRegion);
      const gc = gcContent(primerSeq);
      const tmResult = calculateTm(primerSeq, tmOptions);
      if (tmResult.status !== 'exact') {
        rejections.invalid++;
        continue;
      }
      const tm = tmResult.tm;

      // Multi-criteria attribution (see forward variant).
      const failsGc = gc < minGC || gc > maxGC;
      const failsTm = enforceTargetTm && Math.abs(tm - targetTm) > tmTolerance;
      const failsClamp = requireGcClamp && !has3PrimeGcClamp(primerSeq);

      if (failsGc) {
        rejections.gc++;
        if (failsTm && failsClamp) secondaryRejections.gcAlsoFailedTmAndClamp++;
        if (failsTm) secondaryRejections.gcAlsoFailedTm++;
        if (failsClamp) secondaryRejections.gcAlsoFailedClamp++;
        continue;
      }
      if (failsTm) {
        rejections.tm++;
        if (failsClamp) secondaryRejections.tmAlsoFailedClamp++;
        continue;
      }
      if (failsClamp) {
        rejections.clamp++;
        continue;
      }

      // Hairpin + self-dimer ΔG filters.
      const fullPrimerSeq = tail + primerSeq;
      let hairpinDeltaG: number | undefined;
      let selfDimerDeltaG: number | undefined;
      let secondaryStructureStatus: PrimerCandidate['secondaryStructureStatus'] = 'exact';
      const secondaryStructureWarnings: string[] = [];
      if (maxHairpinDeltaG != null && Number.isFinite(maxHairpinDeltaG)) {
        const hp = predictHairpin(fullPrimerSeq);
        hairpinDeltaG = hp.deltaG;
        secondaryStructureStatus = hp.status;
        if (hp.warning) secondaryStructureWarnings.push(hp.warning);
        if (hp.deltaG < maxHairpinDeltaG) {
          rejections.hairpin++;
          continue;
        }
      }
      if (maxSelfDimerDeltaG != null && Number.isFinite(maxSelfDimerDeltaG)) {
        const dimer = predictSelfDimer(fullPrimerSeq);
        selfDimerDeltaG = dimer.deltaG;
        if (dimer.status === 'invalid' || (dimer.status === 'ambiguous' && secondaryStructureStatus === 'exact')) {
          secondaryStructureStatus = dimer.status;
        }
        if (dimer.warning) secondaryStructureWarnings.push(dimer.warning);
        if (dimer.deltaG < maxSelfDimerDeltaG) {
          rejections.dimer++;
          continue;
        }
      }

      candidates.push({
        sequence: primerSeq,
        fullSequence: fullPrimerSeq,
        tail,
        start,
        end,
        length: len,
        fullLength: tail.length + len,
        tm,
        gcPercent: gc * 100,
        direction: 'reverse',
        anchorDistance,
        hairpinDeltaG,
        selfDimerDeltaG,
        secondaryStructureStatus,
        ...(secondaryStructureWarnings.length > 0 ? { secondaryStructureWarnings } : {}),
      });
    }
  }

  candidates.sort((a, b) => rankScore(a, targetTm) - rankScore(b, targetTm));
  return { candidates, rejections, secondaryRejections, warnings };
}

/**
 * Backward-compatible wrapper: returns only the candidates array.
 *
 * Existing consumers (CLI, tests) keep this shape. New diagnostic display
 * uses `designForwardPrimerWithDiagnostics` for the rejection counts.
 */
export function designForwardPrimer(
  seq: string,
  params: PrimerDesignParams,
): PrimerCandidate[] {
  return designForwardPrimerWithDiagnostics(seq, params).candidates;
}

/**
 * Backward-compatible wrapper: returns only the candidates array.
 */
export function designReversePrimer(
  seq: string,
  params: PrimerDesignParams,
): PrimerCandidate[] {
  return designReversePrimerWithDiagnostics(seq, params).candidates;
}

/**
 * Pair design with diagnostics.
 *
 * Runs both flanking scans, then pairs forward × reverse and applies pair-
 * level filters (Tm difference, product length). Surfaces per-filter
 * rejection counts so the dialog can explain "0 pairs found".
 *
 * Sort: pair tmDifference asc, then anchor distance sum asc — favoring
 * on-anchor primers when Tm matches are equally good.
 */
export function designPrimerPairWithDiagnostics(
  seq: string,
  params: PrimerDesignParams,
): PrimerPairResult {
  const forwardResult = designForwardPrimerWithDiagnostics(seq, params);
  const reverseResult = designReversePrimerWithDiagnostics(seq, params);
  const forwards = forwardResult.candidates;
  const reverses = reverseResult.candidates;
  const sequenceLength = typeof seq === 'string' ? seq.length : 0;
  const normalizedPairParams = normalizePrimerDesignParams(sequenceLength, params, 'forward');
  const targetTm = normalizedPairParams?.targetTm ?? DEFAULT_TARGET_TM;
  const enforceTargetTm = normalizedPairParams?.enforceTargetTm ?? true;
  const maxPairs = boundedPositiveInteger(params?.maxPairs, MAX_PAIRS_RETURNED, 100);
  const pairingLimit = boundedPositiveInteger(
    params?.maxPairingCandidatesPerDirection,
    MAX_PAIRING_CANDIDATES_PER_DIRECTION,
    2000,
  );
  const forwardsForPairing = forwards.slice(0, pairingLimit);
  const reversesForPairing = reverses.slice(0, pairingLimit);

  const pairs: PrimerPair[] = [];
  // Aggregate rejections — for the dialog we summarize at the pair level.
  const rejections: PrimerPairRejections = {
    gc: forwardResult.rejections.gc + reverseResult.rejections.gc,
    tm: forwardResult.rejections.tm + reverseResult.rejections.tm,
    length: forwardResult.rejections.length + reverseResult.rejections.length,
    clamp: forwardResult.rejections.clamp + reverseResult.rejections.clamp,
    invalid: forwardResult.rejections.invalid + reverseResult.rejections.invalid,
    hairpin: (forwardResult.rejections.hairpin ?? 0) + (reverseResult.rejections.hairpin ?? 0),
    dimer: (forwardResult.rejections.dimer ?? 0) + (reverseResult.rejections.dimer ?? 0),
    tmDiff: 0,
    productLength: 0,
  };

  for (const fwd of forwardsForPairing) {
    for (const rev of reversesForPairing) {
      const tmDiff = Math.abs(fwd.tm - rev.tm);
      if (tmDiff > MAX_TM_DIFF_PAIR) {
        rejections.tmDiff++;
        continue;
      }

      const productLength = rev.end - fwd.start;
      if (productLength <= 0) {
        rejections.productLength++;
        continue;
      }

      pairs.push({
        forward: fwd,
        reverse: rev,
        productLength,
        tmDifference: tmDiff,
        crossDimer: predictPrimerDimer(fwd.fullSequence, rev.fullSequence),
      });
    }
  }

  // Prefer balanced, high-quality pairs: low forward/reverse ΔTm first, then
  // closeness to target Tm when the target filter is enabled, then anchor
  // proximity, GC balance, and product length as the final deterministic tie.
  pairs.sort((a, b) =>
    pairRankScore(a, targetTm, enforceTargetTm) - pairRankScore(b, targetTm, enforceTargetTm)
    || a.productLength - b.productLength,
  );

  return {
    pairs: pairs.slice(0, maxPairs),
    rejections,
    forwardRejections: forwardResult.rejections,
    reverseRejections: reverseResult.rejections,
    // Pass secondary attribution counts through.
    forwardSecondary: forwardResult.secondaryRejections,
    reverseSecondary: reverseResult.secondaryRejections,
    forwardCount: forwards.length,
    reverseCount: reverses.length,
    warnings: [...new Set([
      ...(forwardResult.warnings ?? []),
      ...(reverseResult.warnings ?? []),
    ])],
  };
}

/**
 * Backward-compatible wrapper: returns only the pairs array.
 */
export function designPrimerPair(
  seq: string,
  params: PrimerDesignParams,
): PrimerPair[] {
  return designPrimerPairWithDiagnostics(seq, params).pairs;
}

/**
 * Convert a primer candidate into a Feature annotation.
 */
export function primerToFeature(primer: PrimerCandidate, name: string): Feature {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'primer_bind',
    start: primer.start,
    end: primer.end,
    strand: primer.direction === 'forward' ? 1 : -1,
    color: '#a78bfa', // purple
    metadata: {
      tm: primer.tm,
      gcPercent: primer.gcPercent,
      primerSequence: primer.sequence,
      fullSequence: primer.fullSequence,
      tail: primer.tail,
    },
  };
}

export interface EnzymeTailPreset {
  /** Enzyme name displayed to the user */
  name: string;
  /** Full 5′ tail including GC clamp + recognition sequence (ready to prepend to primer) */
  tail: string;
  /** Enzyme recognition sequence only (without GC clamp) */
  enzyme: string;
  /** Human-readable description / compatibility notes */
  description: string;
}

/**
 * Quick-pick enzyme tail presets.
 *
 * Format: GC clamp (2–4 nt) + recognition sequence.
 * The GC clamp ensures efficient enzyme binding at the end of a PCR product.
 * For enzymes that need to be at the end of a fragment, use a 4-nt GC clamp.
 * For internal use with blunt-end enzymes, a 2-nt clamp is sufficient.
 *
 * Standard 6-cutter presets (4-nt GC clamp + 6-nt recognition = 10 nt tail):
 *   tail = GCGC + recognition  (e.g., EcoRI → GCGCGAATTC)
 *
 * 8-cutter presets (2-nt clamp + 8-nt recognition = 10 nt tail):
 *   tail = GC + recognition
 *
 * Type IIS / Golden Gate (4-nt clamp + recognition + spacer overhang):
 *   tail encodes recognition site oriented to direct the cut into the insert.
 */
export const ENZYME_TAIL_PRESETS: EnzymeTailPreset[] = [
  // ── Classic 6-cutters: standard cloning ─────────────────────────────────
  {
    name: 'EcoRI',
    tail: 'GCGCGAATTC',
    enzyme: 'GAATTC',
    description: '5′ AATT overhang. Classic cloning; compatible with MfeI.',
  },
  {
    name: 'BamHI',
    tail: 'GCGCGGATCC',
    enzyme: 'GGATCC',
    description: '5′ GATC overhang. Highly active; compatible with BglII, BclI, Sau3AI overhangs after ligation.',
  },
  {
    name: 'HindIII',
    tail: 'GCGCAAGCTT',
    enzyme: 'AAGCTT',
    description: '5′ AGCT overhang. Standard directional cloning partner with EcoRI.',
  },
  {
    name: 'NcoI',
    tail: 'GCGCCCATGG',
    enzyme: 'CCATGG',
    description: '5′ CATG overhang. Contains ATG start codon — ideal for N-terminal fusions without extra residues.',
  },
  {
    name: 'XhoI',
    tail: 'GCGCCTCGAG',
    enzyme: 'CTCGAG',
    description: '5′ TCGA overhang. Common C-terminal cloning into pET vectors; compatible with SalI overhang after ligation.',
  },
  {
    name: 'NdeI',
    tail: 'GCGCCATATG',
    enzyme: 'CATATG',
    description: '5′ TA overhang. Contains ATG start codon. Standard N-terminal site in pET vectors.',
  },
  {
    name: 'XbaI',
    tail: 'GCGCTCTAGA',
    enzyme: 'TCTAGA',
    description: '5′ CTAG overhang. Classic BioBrick prefix enzyme; compatible with SpeI overhang after ligation.',
  },
  {
    name: 'SpeI',
    tail: 'GCGCACTAGT',
    enzyme: 'ACTAGT',
    description: '5′ CTAG overhang. BioBrick suffix enzyme; overhangs compatible with XbaI (scar = TCTAGA).',
  },
  {
    name: 'SalI',
    tail: 'GCGCGTCGAC',
    enzyme: 'GTCGAC',
    description: '5′ TCGA overhang. Compatible with XhoI after ligation (hybrid site non-cuttable).',
  },
  {
    name: 'SacI',
    tail: 'GCGCGAGCTC',
    enzyme: 'GAGCTC',
    description: '3′ AGCT overhang. Used in MCS positions; pair with KpnI for directional cloning.',
  },
  {
    name: 'KpnI',
    tail: 'GCGCGGTACC',
    enzyme: 'GGTACC',
    description: '3′ GTAC overhang. Common MCS enzyme; use anti-sense primer tail GCGCGGTACC.',
  },
  {
    name: 'NheI',
    tail: 'GCGCGCTAGC',
    enzyme: 'GCTAGC',
    description: '5′ CTAG overhang. Compatible with XbaI and SpeI overhangs after ligation.',
  },
  {
    name: 'BglII',
    tail: 'GCGCAGATCT',
    enzyme: 'AGATCT',
    description: '5′ GATC overhang. Compatible with BamHI overhang after ligation (hybrid site non-cuttable).',
  },
  {
    name: 'PstI',
    tail: 'GCGCCTGCAG',
    enzyme: 'CTGCAG',
    description: '3′ ACGT (TGCA) overhang. Compatible with NsiI and SbfI overhangs after ligation.',
  },
  {
    name: 'AgeI',
    tail: 'GCGCACCGGT',
    enzyme: 'ACCGGT',
    description: '5′ CCGG overhang. Compatible with XmaI, SgrAI, BspEI overhangs.',
  },
  {
    name: 'MluI',
    tail: 'GCGCACGCGT',
    enzyme: 'ACGCGT',
    description: '5′ CGCG overhang. Rare 6-cutter; useful for unique site generation.',
  },
  {
    name: 'EcoRV',
    tail: 'GCGCGATATC',
    enzyme: 'GATATC',
    description: 'Blunt end. EcoRV is active and reliable; blunt ligation requires care.',
  },
  {
    name: 'SmaI',
    tail: 'GCGCCCCGGG',
    enzyme: 'CCCGGG',
    description: 'Blunt end (CCC|GGG). Thermosensitive (37 °C); use XmaI for 5′ overhang from same site.',
  },
  {
    name: 'ClaI',
    tail: 'GCGCATCGAT',
    enzyme: 'ATCGAT',
    description: '5′ CG overhang. Dam-methylation sensitive (ATCGAT → blocked when preceded by G).',
  },

  // ── 8-cutters: rare cutters for large inserts ────────────────────────────
  {
    name: 'NotI',
    tail: 'GCGGCGGCCGC',
    enzyme: 'GCGGCCGC',
    description: '5′ GGCC overhang. 8-cutter — cuts very rarely in genomic DNA. Essential for cosmid/BAC cloning.',
  },
  {
    name: 'PacI',
    tail: 'GCTTAATTAA',
    enzyme: 'TTAATTAA',
    description: '3′ TAAT overhang. 8-cutter; extremely rare in genomic DNA. Used in advanced cloning strategies.',
  },
  {
    name: 'AscI',
    tail: 'GCGGCGCGCC',
    enzyme: 'GGCGCGCC',
    description: '5′ CGCG overhang. 8-cutter; rare in most genomes. Often paired with PacI.',
  },
  {
    name: 'FseI',
    tail: 'GCGGCCGGCC',
    enzyme: 'GGCCGGCC',
    description: '3′ GGCC overhang. 8-cutter; rare cutter useful for genomic engineering.',
  },
  {
    name: 'SwaI',
    tail: 'GCATTTAAAT',
    enzyme: 'ATTTAAAT',
    description: 'Blunt end (ATTT|AAAT). 8-cutter; very AT-rich recognition.',
  },
  {
    name: 'PmeI',
    tail: 'GCGTTTAAAC',
    enzyme: 'GTTTAAAC',
    description: 'Blunt end (GTTT|AAAC). 8-cutter; rare in GC-rich genomes.',
  },

  // ── Golden Gate / Type IIS presets ──────────────────────────────────────
  // For Golden Gate, the tail must include the recognition site oriented
  // so that the enzyme cuts INTO the insert and away from the recognition site.
  // The 4-nt spacer between recognition site end and nick determines the overhang.
  //
  // BsaI recognition: GGTCTC — cuts 1 nt downstream on sense, 5 nt on antisense
  // To expose overhang AATG (ATG start codon context) on the insert:
  //   Forward tail: GCGCGGTCTCAAATG  (GCGC + GGTCTC + 1N spacer + AATG)
  //   The 1N spacer letter 'A' appears in GGTCTCA; enzyme cuts after the A exposing AATG.
  {
    name: 'BsaI-ATG (Golden Gate)',
    tail: 'GCGCGGTCTCAAATG',
    enzyme: 'GGTCTC',
    description: 'Golden Gate forward tail for BsaI; 4-nt overhang AATG includes ATG start context. Use with BsaI Golden Gate assembly.',
  },
  {
    name: 'BsaI-stop (Golden Gate)',
    tail: 'GCGCGGTCTCAGCTT',
    enzyme: 'GGTCTC',
    description: 'Golden Gate forward tail for BsaI; 4-nt overhang GCTT after stop codon. Pair with BsaI-ATG for seamless ORF assembly.',
  },
  {
    name: 'BsmBI (Golden Gate)',
    tail: 'GCGCCGTCTCAAATG',
    enzyme: 'CGTCTC',
    description: 'Golden Gate forward tail for BsmBI (isoschizomer of Esp3I); AATG overhang for ATG-start fusions.',
  },
  {
    name: 'SapI (Golden Gate)',
    tail: 'GCGCGCTCTTCAATG',
    enzyme: 'GCTCTTC',
    description: 'Golden Gate forward tail for SapI; 3-nt overhang ATG (SapI generates 3-nt overhangs). Used in CDS modular assembly.',
  },
];

// ── Legacy compatibility: retain the old shape as well ──────────────────────
// Components that import ENZYME_TAIL_PRESETS as Array<{name,tail}> still work
// because EnzymeTailPreset extends that shape.
