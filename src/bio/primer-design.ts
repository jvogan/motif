import type { Feature } from './types';
import { gcContent } from './gc-content';
import {
  calculateTm,
  DNA_NN_INITIATION,
  MAX_DIVALENT_CONCENTRATION_MILLIMOLAR,
  MAX_NA_CONCENTRATION_MILLIMOLAR,
  MAX_PRIMER_CONCENTRATION_NANOMOLAR,
  NN_PARAMS,
  type TmOptions,
} from './tm-calculator';
import { reverseComplement } from './reverse-complement';
import {
  predictHairpin,
  predictSelfDimer,
  predictPrimerDimer,
  DEFAULT_MAX_HAIRPIN_DG,
  DEFAULT_MAX_DIMER_DG,
  estimateHairpinWorkUnits,
  estimatePrimerDimerWorkUnits,
  MAX_HAIRPIN_WORK_UNITS,
  MAX_DIMER_WORK_UNITS,
  type PrimerThermodynamicsStatus,
  type DimerResult,
} from './primer-thermodynamics';
import { inspectNucleotideSequence, isCanonicalDna } from './nucleotide';

/** Named screening condition used by the visible primer workspace. Values are
 * explicit calculator inputs, not a claim about a proprietary reaction mix. */
export const DEFAULT_TM_OPTIONS: TmOptions = {
  method: 'nearest-neighbor',
  naConcentration: 50,
  mgConcentration: 1.5,
  dntpConcentration: 0.2,
  primerConcentration: 250,
  saltCorrection: 'owczarzy',
};

export const PRIMER_TM_MODEL = 'santalucia-1998-nearest-neighbor' as const;
export const PRIMER_TM_MODEL_BY_METHOD = {
  'nearest-neighbor': PRIMER_TM_MODEL,
  wallace: 'wallace-rule',
  'gc-adjusted': 'gc-adjusted',
} as const;
export type PrimerTmModel = typeof PRIMER_TM_MODEL_BY_METHOD[keyof typeof PRIMER_TM_MODEL_BY_METHOD];
export const PRIMER_TM_ENGINE = 'motif-tm-calculator' as const;
export const PRIMER_TM_ENGINE_VERSION = '1' as const;

export interface PrimerTmConditionPreset {
  id: string;
  name: string;
  description: string;
  options: TmOptions;
}

/**
 * Safe, named presets keep the chemistry visible while avoiding unsupported
 * vendor-specific buffer claims. dNTP concentration is total across the four
 * nucleotide species and is used to estimate free Mg2+.
 */
export const PRIMER_TM_CONDITION_PRESETS: readonly PrimerTmConditionPreset[] = [
  {
    id: 'standard-screening',
    name: 'Standard screening · total dNTP 0.2 mM',
    description: '50 mM Na+, 1.5 mM Mg2+, 0.2 mM total dNTP, 250 nM primer; SantaLucia NN + Owczarzy.',
    options: { ...DEFAULT_TM_OPTIONS },
  },
  {
    id: 'monovalent-screening',
    name: 'Monovalent salt screen · no Mg2+',
    description: '50 mM Na+, no Mg2+ or dNTP correction, 250 nM primer; SantaLucia NN + Owczarzy Na+.',
    options: {
      method: 'nearest-neighbor',
      naConcentration: 50,
      mgConcentration: 0,
      dntpConcentration: 0,
      primerConcentration: 250,
      saltCorrection: 'owczarzy',
    },
  },
] as const;
export const DEFAULT_PRIMER_TM_CONDITION_PRESET_ID = 'standard-screening' as const;
export const CUSTOM_PRIMER_TM_CONDITION_PRESET_ID = 'custom' as const;

export interface PrimerTmEvidence {
  schema: 'motif.primer.tm-evidence.v1';
  conditionPresetId: string;
  conditionPresetName: string;
  model: PrimerTmModel;
  engine: typeof PRIMER_TM_ENGINE;
  engineVersion: typeof PRIMER_TM_ENGINE_VERSION;
  options: {
    method: NonNullable<TmOptions['method']>;
    naConcentration: number;
    mgConcentration: number;
    /** Total concentration summed across dATP, dCTP, dGTP, and dTTP. */
    dntpConcentration: number;
    primerConcentration: number;
    saltCorrection: NonNullable<TmOptions['saltCorrection']>;
    selfComplementarity: 'auto' | 'enabled' | 'disabled';
  };
}

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
   * the named standard screening preset (50 mM Na, 1.5 mM Mg, 0.2 mM total
   * dNTP, 250 nM primer).
   * Passing `{}` or {mgConcentration: 0} reproduces legacy behavior.
   */
  tmOptions?: TmOptions;
  /** Stable named condition identity retained in design evidence. */
  tmConditionPresetId?: string;
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
  /**
   * Cross-primer dimer ΔG37 cutoff (kcal/mol). Pairs whose exact
   * cross-dimer evidence is MORE NEGATIVE than this value are rejected.
   * Default -5.0 (the same heuristic used for self-dimer screening). Pass
   * `null` to disable pair-level rejection while retaining evidence/ranking.
   */
  maxCrossDimerDeltaG?: number | null;
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
  secondaryStructureStatus?: PrimerThermodynamicsStatus;
  secondaryStructureWarnings?: string[];
  /**
   * Structures that need the 5′ tail to pass a cutoff. The annealing region
   * passed every structure check on its own, so these warn instead of
   * rejecting. Absent when the oligo has no tail or no such structure.
   */
  tailStructureWarnings?: PrimerTailStructureWarning[];
}

export interface PrimerPair {
  forward: PrimerCandidate;
  reverse: PrimerCandidate;
  productLength: number;
  tmDifference: number;
  /** Cross-primer interaction evidence retained for deterministic ranking. */
  crossDimer?: DimerResult;
  /** A forward × reverse cross-dimer that needs a 5′ tail to pass the cutoff. */
  tailStructureWarnings?: PrimerTailStructureWarning[];
}

export type PrimerTailStructureKind = 'hairpin' | 'self-dimer' | 'cross-dimer';

/**
 * A structure that forms only because of a 5′ tail. Restriction-site tails are
 * usually palindromes, so the site pairs with itself; that is reported here
 * rather than rejecting a primer whose annealing region is clean.
 */
export interface PrimerTailStructureWarning {
  kind: PrimerTailStructureKind;
  /** The oligo that folds, or `pair` for a forward × reverse cross-dimer. */
  oligo: 'forward' | 'reverse' | 'pair';
  /** Strongest ΔG37 of this kind on the full ordered oligo(s), kcal/mol. */
  deltaG: number;
  /** The cutoff the full oligo fails and the annealing region alone passes. */
  cutoff: number;
  /** `tail` when only tail bases pair; `tail-and-annealing` when tail bases pair with annealing-region bases. */
  involves: 'tail' | 'tail-and-annealing';
  /**
   * Strongest structure of this kind that pairs an extendable 3′ terminal base,
   * when it passes the cutoff; null when no such structure does. A value here
   * means the polymerase can extend the primer on itself or its partner.
   */
  threePrimeDeltaG: number | null;
  /** Tail bases that pair in the strongest structure, 5′→3′. */
  tailBases: string;
  /** Tail-preset recognition site inside those bases, when one is present. */
  site?: { name: string; sequence: string };
  message: string;
}

/** Evidence-review code for a tail structure that pairs an extendable 3′ end. */
export const PRIMER_TAIL_STRUCTURE_3_PRIME_REVIEW_CODE = 'tail-structure-3-prime';

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
  /** Candidate could not receive an exact secondary-structure evaluation. */
  workLimit?: number;
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
  /** Directional candidate-pool completeness receipt. */
  pool: PrimerPoolReceipt;
  /** Per-rejection multi-criteria attribution counts. */
  secondaryRejections?: PrimerSecondaryRejectionCounts;
  /** Input/tail integrity warnings that prevented exact candidate evaluation. */
  warnings?: string[];
}

export interface PrimerPoolReceipt {
  direction: 'forward' | 'reverse';
  /**
   * Number of passing candidates generated by the directional scan. Candidates
   * with a tail-structure warning rank after every clean candidate, so they are
   * counted only when clean pairs could not fill the ranking and they were paired.
   */
  enumeratedCount: number;
  /** Number retained for the caller's next stage. */
  retainedCount: number;
  /** Passing candidates intentionally omitted from the retained pool. */
  omittedCount: number;
  /** Retention cap, or null when no cap was applied. */
  limit: number | null;
  /** True only when omittedCount is proven non-zero. */
  truncated: boolean;
  /** False whenever the retained pool is not the complete passing pool. */
  exhaustive: boolean;
}

export interface PrimerPairRejections extends PrimerRejectionCounts {
  /** Forward + reverse passed individually but failed pair Tm difference filter */
  tmDiff: number;
  /** Forward + reverse passed individually but product length was zero or negative */
  productLength: number;
  /** Forward + reverse pair was rejected for a cross-dimer below threshold. */
  crossDimer?: number;
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
  /** Receipts for the directional pools actually used for pairing. */
  forwardPool: PrimerPoolReceipt;
  reversePool: PrimerPoolReceipt;
  /** Alias grouped for receipt-oriented consumers. */
  poolReceipts: { forward: PrimerPoolReceipt; reverse: PrimerPoolReceipt };
  /** Exact model, engine, version, and conditions used for candidate Tm. */
  tmEvidence?: PrimerTmEvidence;
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
/** Aggregate ceiling for one directional candidate scan's exact structure work. */
export const MAX_PRIMER_DESIGN_STRUCTURE_WORK_UNITS = 10_000_000;
/** Aggregate ceiling for forward×reverse pair cross-dimer evaluation. */
export const MAX_PRIMER_PAIR_CROSS_DIMER_WORK_UNITS = 10_000_000;
/** Pair combinations above the ordinary default are explicitly bounded. */
export const MAX_PRIMER_PAIR_COMBINATIONS = 250_000;
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
  return { gc: 0, tm: 0, length: 0, clamp: 0, invalid: 0, hairpin: 0, dimer: 0, workLimit: 0 };
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
  tmEvidence: PrimerTmEvidence;
  maxHairpinDeltaG: number | null | undefined;
  maxSelfDimerDeltaG: number | null | undefined;
  maxCrossDimerDeltaG: number | null | undefined;
  warnings: string[];
};

function emptyPoolReceipt(direction: 'forward' | 'reverse'): PrimerPoolReceipt {
  return {
    direction,
    enumeratedCount: 0,
    retainedCount: 0,
    omittedCount: 0,
    limit: null,
    truncated: false,
    exhaustive: true,
  };
}

function completePoolReceipt(
  direction: 'forward' | 'reverse',
  count: number,
): PrimerPoolReceipt {
  return {
    direction,
    enumeratedCount: count,
    retainedCount: count,
    omittedCount: 0,
    limit: null,
    truncated: false,
    exhaustive: true,
  };
}

function retainedPoolReceipt(
  pool: PrimerPoolReceipt,
  limit: number,
): PrimerPoolReceipt {
  const retainedCount = Math.min(pool.enumeratedCount, limit);
  const omittedCount = Math.max(0, pool.enumeratedCount - retainedCount);
  return {
    ...pool,
    retainedCount,
    omittedCount,
    limit,
    truncated: omittedCount > 0,
    exhaustive: omittedCount === 0 && pool.exhaustive,
  };
}

function invalidPrimerDesignResult(message: string, direction: 'forward' | 'reverse'): PrimerDesignResult {
  return {
    candidates: [],
    rejections: { ...emptyRejections(), invalid: 1 },
    pool: emptyPoolReceipt(direction),
    secondaryRejections: emptySecondaryRejections(),
    warnings: [message],
  };
}

const TM_OPTION_KEYS = [
  'method',
  'naConcentration',
  'mgConcentration',
  'dntpConcentration',
  'primerConcentration',
  'saltCorrection',
  'selfComplementary',
] as const;
type TmOptionKey = typeof TM_OPTION_KEYS[number];

function normalizedTmOptions(options: TmOptions | undefined): TmOptions | null {
  // An omitted value selects the visible workspace's named screening preset.
  // An explicitly supplied object retains the calculator's historical
  // per-field defaults, so API callers passing `{}` or `{mgConcentration: 0}`
  // do not silently change chemistry assumptions.
  const supplied: Partial<TmOptions> = {};
  if (options !== undefined) {
    try {
      if (options === null || typeof options !== 'object' || Array.isArray(options)) return null;
      const prototype = Object.getPrototypeOf(options);
      if (prototype !== Object.prototype && prototype !== null) return null;
      // Probe only the fixed supported fields. Caller-owned keys are ignored so
      // a large or hostile object cannot force key enumeration or persistence.
      for (const key of TM_OPTION_KEYS) {
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        if (!descriptor) continue;
        if (!Object.hasOwn(descriptor, 'value')) return null;
        (supplied as Record<TmOptionKey, unknown>)[key] = descriptor.value;
      }
    } catch {
      // Revoked proxies, throwing proxy traps, and other malformed runtime
      // values are invalid inputs; do not let them escape as exceptions.
      return null;
    }
  }
  const candidate = options === undefined
    ? { ...DEFAULT_TM_OPTIONS }
    : {
        method: 'nearest-neighbor' as const,
        naConcentration: 50,
        mgConcentration: 0,
        dntpConcentration: 0,
        primerConcentration: 250,
        saltCorrection: 'owczarzy' as const,
        ...supplied,
      };
  if (
    (candidate.method !== 'nearest-neighbor' && candidate.method !== 'wallace' && candidate.method !== 'gc-adjusted')
    || (candidate.saltCorrection !== 'owczarzy' && candidate.saltCorrection !== 'santalucia' && candidate.saltCorrection !== 'wetmur')
    || typeof candidate.naConcentration !== 'number'
    || !Number.isFinite(candidate.naConcentration)
    || candidate.naConcentration <= 0
    || candidate.naConcentration > MAX_NA_CONCENTRATION_MILLIMOLAR
    || typeof candidate.mgConcentration !== 'number'
    || !Number.isFinite(candidate.mgConcentration)
    || candidate.mgConcentration < 0
    || candidate.mgConcentration > MAX_DIVALENT_CONCENTRATION_MILLIMOLAR
    || typeof candidate.dntpConcentration !== 'number'
    || !Number.isFinite(candidate.dntpConcentration)
    || candidate.dntpConcentration < 0
    || candidate.dntpConcentration > MAX_DIVALENT_CONCENTRATION_MILLIMOLAR
    || typeof candidate.primerConcentration !== 'number'
    || !Number.isFinite(candidate.primerConcentration)
    || candidate.primerConcentration <= 0
    || candidate.primerConcentration > MAX_PRIMER_CONCENTRATION_NANOMOLAR
    || (candidate.selfComplementary !== undefined && typeof candidate.selfComplementary !== 'boolean')
  ) return null;
  return candidate;
}

function sameTmOptions(left: TmOptions, right: TmOptions): boolean {
  return left.method === right.method
    && left.naConcentration === right.naConcentration
    && left.mgConcentration === right.mgConcentration
    && left.dntpConcentration === right.dntpConcentration
    && left.primerConcentration === right.primerConcentration
    && left.saltCorrection === right.saltCorrection
    && left.selfComplementary === right.selfComplementary;
}

function tmEvidenceFor(
  options: TmOptions,
  requestedPresetId: string | undefined,
): PrimerTmEvidence {
  const preset = PRIMER_TM_CONDITION_PRESETS.find((entry) => entry.id === requestedPresetId)
    ?? PRIMER_TM_CONDITION_PRESETS.find((entry) => entry.id === DEFAULT_PRIMER_TM_CONDITION_PRESET_ID)!;
  const customRequested = requestedPresetId === CUSTOM_PRIMER_TM_CONDITION_PRESET_ID;
  const optionsMatchPreset = !customRequested && sameTmOptions(preset.options, options);
  const conditionPresetId = optionsMatchPreset ? preset.id : CUSTOM_PRIMER_TM_CONDITION_PRESET_ID;
  const conditionPresetName = optionsMatchPreset ? preset.name : 'Custom bounded Tm conditions';
  return {
    schema: 'motif.primer.tm-evidence.v1',
    conditionPresetId,
    conditionPresetName,
    model: PRIMER_TM_MODEL_BY_METHOD[options.method ?? 'nearest-neighbor'],
    engine: PRIMER_TM_ENGINE,
    engineVersion: PRIMER_TM_ENGINE_VERSION,
    options: {
      method: options.method ?? 'nearest-neighbor',
      naConcentration: options.naConcentration ?? 50,
      mgConcentration: options.mgConcentration ?? 0,
      dntpConcentration: options.dntpConcentration ?? 0,
      primerConcentration: options.primerConcentration ?? 250,
      saltCorrection: options.saltCorrection ?? 'owczarzy',
      selfComplementarity: options.selfComplementary === undefined
        ? 'auto'
        : options.selfComplementary ? 'enabled' : 'disabled',
    },
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
  const maxCrossDimerDeltaG = raw.maxCrossDimerDeltaG === undefined
    ? DEFAULT_MAX_DIMER_DG
    : raw.maxCrossDimerDeltaG === null
      ? null
      : typeof raw.maxCrossDimerDeltaG === 'number'
        && Number.isFinite(raw.maxCrossDimerDeltaG)
        ? raw.maxCrossDimerDeltaG
        : Number.NaN;
  const tmOptions = normalizedTmOptions(raw.tmOptions);
  const tmConditionPresetId = raw.tmConditionPresetId;
  const validTmConditionPresetId = tmConditionPresetId === undefined
    || (
      typeof tmConditionPresetId === 'string'
      && tmConditionPresetId.length > 0
      && tmConditionPresetId.length <= 64
      && /^[a-z0-9][a-z0-9-]*$/u.test(tmConditionPresetId)
      && (tmConditionPresetId === CUSTOM_PRIMER_TM_CONDITION_PRESET_ID || PRIMER_TM_CONDITION_PRESETS.some((preset) => preset.id === tmConditionPresetId))
    );
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
    || tmOptions === null
    || !validTmConditionPresetId
    || Number.isNaN(maxHairpinDeltaG as number)
    || Number.isNaN(maxSelfDimerDeltaG as number)
    || Number.isNaN(maxCrossDimerDeltaG as number)
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
    tmOptions,
    tmEvidence: tmEvidenceFor(tmOptions, tmConditionPresetId),
    maxHairpinDeltaG,
    maxSelfDimerDeltaG,
    maxCrossDimerDeltaG,
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
 * `pairRankScore` without its cross-dimer term, summed in the same order. The
 * cross-dimer term is never negative, so this bounds the score from below.
 */
function pairRankLowerBound(
  forward: PrimerCandidate,
  reverse: PrimerCandidate,
  tmDifference: number,
  targetTm: number,
  enforceTargetTm: boolean,
): number {
  const tmPairPenalty = tmDifference * 2;
  const targetPenalty = enforceTargetTm
    ? (Math.abs(forward.tm - targetTm) + Math.abs(reverse.tm - targetTm)) / 2
    : 0;
  const anchorPenalty = (forward.anchorDistance + reverse.anchorDistance) * ANCHOR_DISTANCE_PENALTY;
  const gcBalancePenalty = (Math.abs(forward.gcPercent - 50) + Math.abs(reverse.gcPercent - 50)) * 0.01;
  return tmPairPenalty + targetPenalty + anchorPenalty + gcBalancePenalty;
}

type StructureWorkBudget = {
  remaining: number;
};

type SecondaryStructureEvaluation = {
  accept: boolean;
  rejection: 'hairpin' | 'dimer' | 'work-limit' | null;
  hairpinDeltaG?: number;
  selfDimerDeltaG?: number;
  status: PrimerThermodynamicsStatus;
  warnings: string[];
};

function structureWarning(warning: string | undefined, warnings: string[]): void {
  if (warning && !warnings.includes(warning)) warnings.push(warning);
}

/**
 * Evaluate one full ordered oligo while spending from the directional design
 * budget. Work-limit results are rejected from the candidate pool so an
 * unscored oligo is never presented as an exact structure pass.
 */
function evaluateSecondaryStructure(
  fullPrimerSeq: string,
  maxHairpinDeltaG: number | null | undefined,
  maxSelfDimerDeltaG: number | null | undefined,
  budget: StructureWorkBudget,
): SecondaryStructureEvaluation {
  let status: PrimerThermodynamicsStatus = 'exact';
  const warnings: string[] = [];
  let hairpinDeltaG: number | undefined;
  let selfDimerDeltaG: number | undefined;

  if (maxHairpinDeltaG != null && Number.isFinite(maxHairpinDeltaG)) {
    const estimatedWork = estimateHairpinWorkUnits(fullPrimerSeq.length);
    const hp = predictHairpin(fullPrimerSeq, {
      maxWorkUnits: Math.min(budget.remaining, MAX_HAIRPIN_WORK_UNITS),
    });
    if (hp.status === 'work-limit') {
      structureWarning(hp.warning, warnings);
      return { accept: false, rejection: 'work-limit', status: hp.status, warnings };
    }
    if (hp.status === 'exact') budget.remaining = Math.max(0, budget.remaining - estimatedWork);
    hairpinDeltaG = hp.deltaG;
    status = hp.status;
    structureWarning(hp.warning, warnings);
    if (hp.deltaG < maxHairpinDeltaG) {
      return { accept: false, rejection: 'hairpin', hairpinDeltaG, status, warnings };
    }
  }

  if (maxSelfDimerDeltaG != null && Number.isFinite(maxSelfDimerDeltaG)) {
    const estimatedWork = estimatePrimerDimerWorkUnits(fullPrimerSeq.length, fullPrimerSeq.length);
    const dimer = predictSelfDimer(fullPrimerSeq, {
      maxWorkUnits: Math.min(budget.remaining, MAX_DIMER_WORK_UNITS),
    });
    if (dimer.status === 'work-limit') {
      structureWarning(dimer.warning, warnings);
      return {
        accept: false,
        rejection: 'work-limit',
        hairpinDeltaG,
        selfDimerDeltaG: dimer.deltaG,
        status: dimer.status,
        warnings,
      };
    }
    if (dimer.status === 'exact') budget.remaining = Math.max(0, budget.remaining - estimatedWork);
    selfDimerDeltaG = dimer.deltaG;
    if (dimer.status === 'invalid' || (dimer.status === 'ambiguous' && status === 'exact')) {
      status = dimer.status;
    }
    structureWarning(dimer.warning, warnings);
    if (dimer.deltaG < maxSelfDimerDeltaG) {
      return { accept: false, rejection: 'dimer', hairpinDeltaG, selfDimerDeltaG, status, warnings };
    }
  }

  return { accept: true, rejection: null, hairpinDeltaG, selfDimerDeltaG, status, warnings };
}

// ─── Tail structure: veto on the annealing region, warn on the tail ─────────
//
// A restriction-site tail is almost always a palindrome (CTCGAG, GAATTC…), so
// an ordered oligo carrying one pairs with itself however clean its annealing
// region is. Screening the whole oligo against the hairpin and self-dimer
// cutoffs therefore rejected nearly every tailed design: 18 of 29 shipped tail
// presets and 9 of 10 common directional pairs returned no pair on the lacZ-alpha
// of the synthetic pUC19 once bundled. The cutoffs now veto only structure the annealing region forms by
// itself. Structure that needs the tail becomes a warning on the candidate,
// ranked after every clean candidate, and a tail structure that pairs an
// extendable 3′ end is flagged for review, since that is the case where the
// polymerase can copy the primer onto itself or its partner.

type TailStructureCutoffs = {
  hairpin: number | null | undefined;
  selfDimer: number | null | undefined;
  crossDimer: number | null | undefined;
};

const DEFAULT_TAIL_STRUCTURE_CUTOFFS: TailStructureCutoffs = {
  hairpin: DEFAULT_MAX_HAIRPIN_DG,
  selfDimer: DEFAULT_MAX_DIMER_DG,
  crossDimer: DEFAULT_MAX_DIMER_DG,
};

const TAIL_STRUCTURE_WORK_LIMIT_WARNING = `Tail-structure evidence is bounded at ${MAX_PRIMER_DESIGN_STRUCTURE_WORK_UNITS.toLocaleString()} work units per scan; candidates past the bound were not ranked.`;

const WATSON_CRICK: Readonly<Record<string, string>> = { A: 'T', C: 'G', G: 'C', T: 'A' };

function basesPair(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && WATSON_CRICK[left] === right;
}

type NnPrefix = { deltaH: Float64Array; deltaS: Float64Array };

/** Nearest-neighbour prefix sums, so any stem's ΔG costs O(1). */
function nnPrefix(sequence: string): NnPrefix {
  const deltaH = new Float64Array(sequence.length);
  const deltaS = new Float64Array(sequence.length);
  for (let index = 0; index < sequence.length - 1; index += 1) {
    const params = NN_PARAMS[sequence[index] + sequence[index + 1]];
    deltaH[index + 1] = deltaH[index] + (params ? params.dH * 1000 : 0);
    deltaS[index + 1] = deltaS[index] + (params ? params.dS : 0);
  }
  return { deltaH, deltaS };
}

/** ΔG37 of `sequence[start, start + length)` as a duplex stem, on the same basis as the structure predictors. */
function stemDeltaG(sequence: string, prefix: NnPrefix, start: number, length: number): number {
  const end = start + length - 1;
  const first = /[AT]/.test(sequence[start]) ? DNA_NN_INITIATION.terminalAT : DNA_NN_INITIATION.terminalGC;
  const last = /[AT]/.test(sequence[end]) ? DNA_NN_INITIATION.terminalAT : DNA_NN_INITIATION.terminalGC;
  const deltaH = (first.dH + last.dH) * 1000 + prefix.deltaH[end] - prefix.deltaH[start];
  const deltaS = first.dS + last.dS + prefix.deltaS[end] - prefix.deltaS[start];
  return Math.round((deltaH / 1000 - (310.15 * deltaS) / 1000) * 100) / 100;
}

function activeCutoff(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

/** Strongest hairpin whose 3′ arm ends at the oligo's terminal base (self-priming). */
function strongestThreePrimeHairpin(sequence: string): number | null {
  const n = sequence.length;
  const prefix = nnPrefix(sequence);
  let best: number | null = null;
  for (let left = 0; left + 9 <= n; left += 1) {
    let run = 0;
    while (left + run < n - 1 - run && basesPair(sequence[left + run], sequence[n - 1 - run])) run += 1;
    const limit = Math.min(run, Math.floor((n - left - 3) / 2));
    for (let stem = 3; stem <= limit; stem += 1) {
      const deltaG = stemDeltaG(sequence, prefix, left, stem);
      if (best === null || deltaG < best) best = deltaG;
    }
  }
  return best;
}

/** Strongest duplex in which `x`'s 3′ terminal base pairs with `y`, antiparallel. */
function strongestThreePrimeDuplex(x: string, y: string): number | null {
  const prefix = nnPrefix(x);
  let best: number | null = null;
  for (let start = 0; start < y.length; start += 1) {
    let run = 0;
    while (run < x.length && start + run < y.length && basesPair(x[x.length - 1 - run], y[start + run])) run += 1;
    if (run < 3) continue;
    const deltaG = stemDeltaG(x, prefix, x.length - run, run);
    if (best === null || deltaG < best) best = deltaG;
  }
  return best;
}

type DuplexRun = { deltaG: number; xStart: number; yStart: number; length: number };

/** Strongest maximal antiparallel run between `x` and `y`, with its positions. */
function strongestDuplexRun(x: string, y: string): DuplexRun | null {
  const prefix = nnPrefix(x);
  let best: DuplexRun | null = null;
  for (let i = 0; i < x.length; i += 1) {
    for (let j = 0; j < y.length; j += 1) {
      if (!basesPair(x[i], y[j]) || basesPair(x[i - 1], y[j + 1])) continue;
      let length = 1;
      while (basesPair(x[i + length], y[j - length])) length += 1;
      if (length < 3) continue;
      const deltaG = stemDeltaG(x, prefix, i, length);
      if (!best || deltaG < best.deltaG) best = { deltaG, xStart: i, yStart: j - length + 1, length };
    }
  }
  return best;
}

/** Positions of the strongest hairpin's arms, matched to `predictHairpin`'s result. */
function hairpinArmPositions(sequence: string, stem: number, loop: number, deltaG: number): number[] | null {
  const prefix = nnPrefix(sequence);
  for (let left = 0; left + 2 * stem + loop <= sequence.length; left += 1) {
    const rightEnd = left + 2 * stem + loop;
    let paired = true;
    for (let offset = 0; offset < stem && paired; offset += 1) {
      paired = basesPair(sequence[left + offset], sequence[rightEnd - 1 - offset]);
    }
    if (!paired || stemDeltaG(sequence, prefix, left, stem) !== deltaG) continue;
    return [
      ...Array.from({ length: stem }, (_, offset) => left + offset),
      ...Array.from({ length: stem }, (_, offset) => rightEnd - stem + offset),
    ];
  }
  return null;
}

function enzymeLabel(presetName: string): string {
  return presetName.replace(/\s*\(.*\)$/u, '').replace(/-.*$/u, '');
}

/** The tail-preset recognition site that overlaps the paired tail bases most. */
function tailSite(tail: string, pairedStart: number, pairedEnd: number): { name: string; sequence: string } | undefined {
  let best: { name: string; sequence: string; overlap: number } | undefined;
  for (const preset of ENZYME_TAIL_PRESETS) {
    const site = preset.enzyme.toUpperCase();
    for (let at = tail.indexOf(site); at >= 0; at = tail.indexOf(site, at + 1)) {
      const overlap = Math.min(pairedEnd, at + site.length) - Math.max(pairedStart, at);
      if (overlap > 0 && (!best || overlap > best.overlap || (overlap === best.overlap && site.length > best.sequence.length))) {
        best = { name: enzymeLabel(preset.name), sequence: site, overlap };
      }
    }
  }
  return best ? { name: best.name, sequence: best.sequence } : undefined;
}

function formatDeltaG(value: number): string {
  return `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}`;
}

function tailStructureWarning(input: {
  kind: PrimerTailStructureKind;
  oligo: PrimerTailStructureWarning['oligo'];
  deltaG: number;
  cutoff: number;
  tail: string;
  /** Paired tail positions, in tail coordinates. */
  pairedTailPositions: readonly number[];
  pairsAnnealingBases: boolean;
  threePrimeDeltaG: number | null;
}): PrimerTailStructureWarning {
  const pairedStart = input.pairedTailPositions.length > 0 ? Math.min(...input.pairedTailPositions) : 0;
  const pairedEnd = input.pairedTailPositions.length > 0 ? Math.max(...input.pairedTailPositions) + 1 : 0;
  const tailBases = input.tail.slice(pairedStart, pairedEnd);
  const site = tailSite(input.tail, pairedStart, pairedEnd);
  const involves = input.pairsAnnealingBases ? 'tail-and-annealing' : 'tail';
  const owner = input.oligo === 'forward' ? 'Forward' : input.oligo === 'reverse' ? 'Reverse' : 'Forward and reverse';
  const subject = site ? `the ${site.name} site ${site.sequence} pairs` : `tail bases ${tailBases} pair`;
  const where = involves === 'tail'
    ? `${subject} within the 5′ tail`
    : `${subject} with the annealing region`;
  const threePrime = input.threePrimeDeltaG === null
    ? ' The 3′ end is not involved.'
    : ` The 3′ end pairs in this structure (${formatDeltaG(input.threePrimeDeltaG)} kcal/mol) and can extend; review before ordering.`;
  return {
    kind: input.kind,
    oligo: input.oligo,
    deltaG: input.deltaG,
    cutoff: input.cutoff,
    involves,
    threePrimeDeltaG: input.threePrimeDeltaG,
    tailBases,
    ...(site ? { site } : {}),
    message: `${owner} ${input.kind} ${formatDeltaG(input.deltaG)} kcal/mol (cutoff ${formatDeltaG(input.cutoff)}): ${where}.${threePrime}`,
  };
}

type OligoTailEvidence = {
  hairpinDeltaG?: number;
  selfDimerDeltaG?: number;
  warnings: PrimerTailStructureWarning[];
};

function tailEvidenceWorkUnits(length: number): number {
  return estimateHairpinWorkUnits(length) * 2 + estimatePrimerDimerWorkUnits(length, length) * 2;
}

/**
 * Hairpin and self-dimer warnings for one tailed oligo. Returns null when the
 * evidence would exceed the remaining budget, so the caller can refuse to rank
 * an oligo whose tail structure was never evaluated.
 */
function oligoTailStructureEvidence(
  tail: string,
  annealing: string,
  oligo: 'forward' | 'reverse',
  cutoffs: TailStructureCutoffs,
  budget?: StructureWorkBudget,
): OligoTailEvidence | null {
  const full = tail + annealing;
  if (tail.length === 0 || !isCanonicalDna(full)) return { warnings: [] };
  if (budget) {
    const work = tailEvidenceWorkUnits(full.length);
    if (work > budget.remaining) return null;
    budget.remaining -= work;
  }
  const warnings: PrimerTailStructureWarning[] = [];
  let hairpinDeltaG: number | undefined;
  let selfDimerDeltaG: number | undefined;

  if (activeCutoff(cutoffs.hairpin)) {
    const hairpin = predictHairpin(full);
    hairpinDeltaG = hairpin.status === 'exact' ? hairpin.deltaG : undefined;
    if (hairpin.status === 'exact' && hairpin.deltaG < cutoffs.hairpin && predictHairpin(annealing).deltaG >= cutoffs.hairpin) {
      const positions = hairpinArmPositions(full, hairpin.stemLength, hairpin.loopSize, hairpin.deltaG) ?? [];
      const threePrime = strongestThreePrimeHairpin(full);
      warnings.push(tailStructureWarning({
        kind: 'hairpin',
        oligo,
        deltaG: hairpin.deltaG,
        cutoff: cutoffs.hairpin,
        tail,
        pairedTailPositions: positions.filter((position) => position < tail.length),
        pairsAnnealingBases: positions.some((position) => position >= tail.length),
        threePrimeDeltaG: threePrime !== null && threePrime < cutoffs.hairpin ? threePrime : null,
      }));
    }
  }

  if (activeCutoff(cutoffs.selfDimer)) {
    const dimer = predictSelfDimer(full);
    selfDimerDeltaG = dimer.status === 'exact' ? dimer.deltaG : undefined;
    if (dimer.status === 'exact' && dimer.deltaG < cutoffs.selfDimer && predictSelfDimer(annealing).deltaG >= cutoffs.selfDimer) {
      const run = strongestDuplexRun(full, full);
      const positions = run
        ? [
            ...Array.from({ length: run.length }, (_, offset) => run.xStart + offset),
            ...Array.from({ length: run.length }, (_, offset) => run.yStart + offset),
          ]
        : [];
      const threePrime = strongestThreePrimeDuplex(full, full);
      warnings.push(tailStructureWarning({
        kind: 'self-dimer',
        oligo,
        deltaG: dimer.deltaG,
        cutoff: cutoffs.selfDimer,
        tail,
        pairedTailPositions: positions.filter((position) => position < tail.length),
        pairsAnnealingBases: positions.some((position) => position >= tail.length),
        threePrimeDeltaG: threePrime !== null && threePrime < cutoffs.selfDimer ? threePrime : null,
      }));
    }
  }

  return { hairpinDeltaG, selfDimerDeltaG, warnings };
}

type TailedOligo = { sequence: string; tail: string };

/**
 * The cross-dimer warning for a pair whose full oligos pair below the cutoff
 * while their annealing regions do not. Null when there is no such structure.
 */
function crossDimerTailWarning(
  forward: TailedOligo,
  reverse: TailedOligo,
  cutoff: number | null | undefined,
  /** The full-oligo cross-dimer when the caller already has it. */
  fullCrossDimer?: DimerResult,
): PrimerTailStructureWarning | null {
  if (!activeCutoff(cutoff) || (forward.tail.length === 0 && reverse.tail.length === 0)) return null;
  const forwardFull = forward.tail + forward.sequence;
  const reverseFull = reverse.tail + reverse.sequence;
  if (!isCanonicalDna(forwardFull) || !isCanonicalDna(reverseFull)) return null;
  const full = fullCrossDimer ?? predictPrimerDimer(forwardFull, reverseFull);
  if (full.status !== 'exact' || full.deltaG >= cutoff) return null;
  if (predictPrimerDimer(forward.sequence, reverse.sequence).deltaG < cutoff) return null;
  const run = strongestDuplexRun(forwardFull, reverseFull);
  const forwardPositions = run ? Array.from({ length: run.length }, (_, offset) => run.xStart + offset) : [];
  const reversePositions = run ? Array.from({ length: run.length }, (_, offset) => run.yStart + offset) : [];
  const forwardTailPositions = forwardPositions.filter((position) => position < forward.tail.length);
  const reverseTailPositions = reversePositions.filter((position) => position < reverse.tail.length);
  const namedFromForward = forwardTailPositions.length >= reverseTailPositions.length;
  const threePrimeCandidates = [
    strongestThreePrimeDuplex(forwardFull, reverseFull),
    strongestThreePrimeDuplex(reverseFull, forwardFull),
  ].filter((value): value is number => value !== null);
  const threePrime = threePrimeCandidates.length > 0 ? Math.min(...threePrimeCandidates) : null;
  return tailStructureWarning({
    kind: 'cross-dimer',
    oligo: 'pair',
    deltaG: full.deltaG,
    cutoff,
    tail: namedFromForward ? forward.tail : reverse.tail,
    pairedTailPositions: namedFromForward ? forwardTailPositions : reverseTailPositions,
    pairsAnnealingBases: forwardPositions.some((position) => position >= forward.tail.length)
      || reversePositions.some((position) => position >= reverse.tail.length),
    threePrimeDeltaG: threePrime !== null && threePrime < cutoff ? threePrime : null,
  });
}

/**
 * Recompute every tail-structure warning for a pair from its sequences alone,
 * with the default cutoffs. The workspace and PCR materialization call this so
 * both derive the same evidence-review codes from the same oligos.
 */
export function computePrimerPairTailStructureWarnings(pair: {
  forward: TailedOligo;
  reverse: TailedOligo;
}): PrimerTailStructureWarning[] {
  const forward = oligoTailStructureEvidence(pair.forward.tail.toUpperCase(), pair.forward.sequence.toUpperCase(), 'forward', DEFAULT_TAIL_STRUCTURE_CUTOFFS);
  const reverse = oligoTailStructureEvidence(pair.reverse.tail.toUpperCase(), pair.reverse.sequence.toUpperCase(), 'reverse', DEFAULT_TAIL_STRUCTURE_CUTOFFS);
  const cross = crossDimerTailWarning(
    { sequence: pair.forward.sequence.toUpperCase(), tail: pair.forward.tail.toUpperCase() },
    { sequence: pair.reverse.sequence.toUpperCase(), tail: pair.reverse.tail.toUpperCase() },
    DEFAULT_TAIL_STRUCTURE_CUTOFFS.crossDimer,
  );
  return [...(forward?.warnings ?? []), ...(reverse?.warnings ?? []), ...(cross ? [cross] : [])];
}

/** The warnings the design engine attached to a ranked pair, without recomputing. */
export function primerPairTailStructureWarnings(pair: PrimerPair): PrimerTailStructureWarning[] {
  return [
    ...(pair.forward.tailStructureWarnings ?? []),
    ...(pair.reverse.tailStructureWarnings ?? []),
    ...(pair.tailStructureWarnings ?? []),
  ];
}

/** Evidence-review codes a set of tail warnings requires: only 3′-end pairing needs one. */
export function primerTailStructureReviewCodes(warnings: readonly PrimerTailStructureWarning[]): string[] {
  return warnings.some((warning) => warning.threePrimeDeltaG !== null)
    ? [PRIMER_TAIL_STRUCTURE_3_PRIME_REVIEW_CODE]
    : [];
}

/** 0 = clean, 1 = tail warning, 2 = tail warning that pairs an extendable 3′ end. */
function tailStructureTier(warnings: readonly PrimerTailStructureWarning[] | undefined): number {
  if (!warnings || warnings.length === 0) return 0;
  return warnings.some((warning) => warning.threePrimeDeltaG !== null) ? 2 : 1;
}

function pairTailStructureTier(pair: PrimerPair): number {
  return Math.max(
    tailStructureTier(pair.forward.tailStructureWarnings),
    tailStructureTier(pair.reverse.tailStructureWarnings),
    tailStructureTier(pair.tailStructureWarnings),
  );
}

/**
 * Rank penalty for tail structures: 0.1 per kcal/mol past the cutoff, the
 * weight the cross-dimer term uses. Zero for a clean candidate or pair.
 */
function tailStructurePenalty(warnings: readonly PrimerTailStructureWarning[] | undefined): number {
  let penalty = 0;
  for (const warning of warnings ?? []) penalty += Math.max(0, warning.cutoff - warning.deltaG) * 0.1;
  return penalty;
}

function pairTailStructurePenalty(pair: PrimerPair): number {
  return tailStructurePenalty(pair.forward.tailStructureWarnings)
    + tailStructurePenalty(pair.reverse.tailStructureWarnings)
    + tailStructurePenalty(pair.tailStructureWarnings);
}

type ScreenedStructure = SecondaryStructureEvaluation & {
  tailStructureWarnings?: PrimerTailStructureWarning[];
};

/**
 * Screen one candidate. The full ordered oligo is evaluated first, exactly as
 * before, so an untailed oligo and a tailed oligo that passes are unchanged,
 * and so is the main budget they spend. Only when a tailed oligo fails a
 * structure cutoff is the annealing region judged alone, on a separate budget.
 */
function screenCandidateStructure(
  annealing: string,
  tail: string,
  oligo: 'forward' | 'reverse',
  maxHairpinDeltaG: number | null | undefined,
  maxSelfDimerDeltaG: number | null | undefined,
  budget: StructureWorkBudget,
  tailBudget: StructureWorkBudget,
): ScreenedStructure {
  const full = evaluateSecondaryStructure(tail + annealing, maxHairpinDeltaG, maxSelfDimerDeltaG, budget);
  if (full.accept || tail.length === 0 || full.rejection === 'work-limit') return full;
  const annealingOnly = evaluateSecondaryStructure(annealing, maxHairpinDeltaG, maxSelfDimerDeltaG, tailBudget);
  if (!annealingOnly.accept) return annealingOnly;
  const evidence = oligoTailStructureEvidence(tail, annealing, oligo, {
    hairpin: maxHairpinDeltaG,
    selfDimer: maxSelfDimerDeltaG,
    crossDimer: null,
  }, tailBudget);
  if (!evidence) {
    return { accept: false, rejection: 'work-limit', status: 'work-limit', warnings: [TAIL_STRUCTURE_WORK_LIMIT_WARNING] };
  }
  // A failure with no attributable tail structure keeps the old verdict, so a
  // candidate is never admitted as clean when the full oligo failed.
  if (evidence.warnings.length === 0) return full;
  return {
    accept: true,
    rejection: null,
    hairpinDeltaG: evidence.hairpinDeltaG,
    selfDimerDeltaG: evidence.selfDimerDeltaG,
    status: annealingOnly.status,
    warnings: annealingOnly.warnings,
    ...(evidence.warnings.length > 0 ? { tailStructureWarnings: evidence.warnings } : {}),
  };
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
  if (typeof seq !== 'string') return invalidPrimerDesignResult('Primer template must be a nucleotide string.', 'forward');
  const inspectedSequence = inspectNucleotideSequence(seq);
  const upper = inspectedSequence.sequence;
  const normalized = normalizePrimerDesignParams(upper.length, params, 'forward');
  if (!normalized) {
    const tail = normalizedOligo((params as PrimerDesignParams | null | undefined)?.forwardTail);
    return invalidPrimerDesignResult(tail.warning ?? 'Primer design parameters must use finite bounded values.', 'forward');
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
  const structureBudget: StructureWorkBudget = { remaining: MAX_PRIMER_DESIGN_STRUCTURE_WORK_UNITS };
  // Annealing-only rechecks and tail evidence spend from their own budget so the
  // main budget, and every candidate it admits, is exactly what it was before.
  const tailBudget: StructureWorkBudget = { remaining: MAX_PRIMER_DESIGN_STRUCTURE_WORK_UNITS };

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

      const fullPrimerSeq = tail + primerSeq;
      const secondary = screenCandidateStructure(
        primerSeq,
        tail,
        'forward',
        maxHairpinDeltaG,
        maxSelfDimerDeltaG,
        structureBudget,
        tailBudget,
      );
      if (!secondary.accept) {
        if (secondary.rejection === 'hairpin') rejections.hairpin++;
        else if (secondary.rejection === 'dimer') rejections.dimer++;
        else if (secondary.rejection === 'work-limit') {
          rejections.workLimit = (rejections.workLimit ?? 0) + 1;
          for (const warning of secondary.warnings) if (!warnings.includes(warning)) warnings.push(warning);
        }
        continue;
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
        hairpinDeltaG: secondary.hairpinDeltaG,
        selfDimerDeltaG: secondary.selfDimerDeltaG,
        secondaryStructureStatus: secondary.status,
        ...(secondary.warnings.length > 0 ? { secondaryStructureWarnings: secondary.warnings } : {}),
        ...(secondary.tailStructureWarnings ? { tailStructureWarnings: secondary.tailStructureWarnings } : {}),
      });
    }
  }

  // Clean candidates keep their old order and always rank ahead of tailed
  // candidates that carry a structure warning.
  candidates.sort((a, b) => (
    tailStructureTier(a.tailStructureWarnings) - tailStructureTier(b.tailStructureWarnings)
    || (rankScore(a, targetTm) + tailStructurePenalty(a.tailStructureWarnings))
      - (rankScore(b, targetTm) + tailStructurePenalty(b.tailStructureWarnings))
  ));
  return {
    candidates,
    rejections,
    pool: completePoolReceipt('forward', candidates.length),
    secondaryRejections,
    warnings,
  };
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
  if (typeof seq !== 'string') return invalidPrimerDesignResult('Primer template must be a nucleotide string.', 'reverse');
  const inspectedSequence = inspectNucleotideSequence(seq);
  const upper = inspectedSequence.sequence;
  const normalized = normalizePrimerDesignParams(upper.length, params, 'reverse');
  if (!normalized) {
    const tail = normalizedOligo((params as PrimerDesignParams | null | undefined)?.reverseTail);
    return invalidPrimerDesignResult(tail.warning ?? 'Primer design parameters must use finite bounded values.', 'reverse');
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
  const structureBudget: StructureWorkBudget = { remaining: MAX_PRIMER_DESIGN_STRUCTURE_WORK_UNITS };
  // Annealing-only rechecks and tail evidence spend from their own budget so the
  // main budget, and every candidate it admits, is exactly what it was before.
  const tailBudget: StructureWorkBudget = { remaining: MAX_PRIMER_DESIGN_STRUCTURE_WORK_UNITS };

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

      const fullPrimerSeq = tail + primerSeq;
      const secondary = screenCandidateStructure(
        primerSeq,
        tail,
        'reverse',
        maxHairpinDeltaG,
        maxSelfDimerDeltaG,
        structureBudget,
        tailBudget,
      );
      if (!secondary.accept) {
        if (secondary.rejection === 'hairpin') rejections.hairpin++;
        else if (secondary.rejection === 'dimer') rejections.dimer++;
        else if (secondary.rejection === 'work-limit') {
          rejections.workLimit = (rejections.workLimit ?? 0) + 1;
          for (const warning of secondary.warnings) if (!warnings.includes(warning)) warnings.push(warning);
        }
        continue;
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
        hairpinDeltaG: secondary.hairpinDeltaG,
        selfDimerDeltaG: secondary.selfDimerDeltaG,
        secondaryStructureStatus: secondary.status,
        ...(secondary.warnings.length > 0 ? { secondaryStructureWarnings: secondary.warnings } : {}),
        ...(secondary.tailStructureWarnings ? { tailStructureWarnings: secondary.tailStructureWarnings } : {}),
      });
    }
  }

  // Clean candidates keep their old order and always rank ahead of tailed
  // candidates that carry a structure warning.
  candidates.sort((a, b) => (
    tailStructureTier(a.tailStructureWarnings) - tailStructureTier(b.tailStructureWarnings)
    || (rankScore(a, targetTm) + tailStructurePenalty(a.tailStructureWarnings))
      - (rankScore(b, targetTm) + tailStructurePenalty(b.tailStructureWarnings))
  ));
  return {
    candidates,
    rejections,
    pool: completePoolReceipt('reverse', candidates.length),
    secondaryRejections,
    warnings,
  };
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
  const maxCrossDimerDeltaG = normalizedPairParams === null
    ? DEFAULT_MAX_DIMER_DG
    : normalizedPairParams.maxCrossDimerDeltaG === undefined
      ? DEFAULT_MAX_DIMER_DG
      : normalizedPairParams.maxCrossDimerDeltaG;
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
    workLimit: (forwardResult.rejections.workLimit ?? 0) + (reverseResult.rejections.workLimit ?? 0),
    tmDiff: 0,
    productLength: 0,
    crossDimer: 0,
  };

  let pairCombinations = 0;
  let pairEnumerationLimited = false;
  let crossDimerWorkRemaining = MAX_PRIMER_PAIR_CROSS_DIMER_WORK_UNITS;
  let crossDimerWorkLimited = false;
  // Tail cross-dimer rechecks spend from their own budget; see the scans.
  const tailBudget: StructureWorkBudget = { remaining: MAX_PRIMER_PAIR_CROSS_DIMER_WORK_UNITS };
  let tailBudgetLimited = false;
  let pairedWarnedCandidates = false;

  // Cross-dimer screening for one combination that already passed the Tm and
  // product checks. Returns the pair, or null when the pair is rejected.
  const screenPair = (fwd: PrimerCandidate, rev: PrimerCandidate, tmDiff: number, productLength: number): PrimerPair | null => {
    const estimatedDimerWork = estimatePrimerDimerWorkUnits(fwd.fullSequence.length, rev.fullSequence.length);
    const crossDimer = predictPrimerDimer(fwd.fullSequence, rev.fullSequence, {
      maxWorkUnits: Math.min(crossDimerWorkRemaining, MAX_DIMER_WORK_UNITS),
    });
    if (crossDimer.status === 'exact') {
      crossDimerWorkRemaining = Math.max(0, crossDimerWorkRemaining - estimatedDimerWork);
    } else if (crossDimer.status === 'work-limit') {
      crossDimerWorkLimited = true;
      rejections.workLimit = (rejections.workLimit ?? 0) + 1;
    }

    let crossTailWarning: PrimerTailStructureWarning | null = null;
    if (crossDimer.status === 'exact'
      && maxCrossDimerDeltaG !== null
      && crossDimer.deltaG < maxCrossDimerDeltaG) {
      // With a tail, the cutoff vetoes only what the annealing regions form.
      if (fwd.tail || rev.tail) {
        const work = estimatePrimerDimerWorkUnits(fwd.fullSequence.length, rev.fullSequence.length) * 4;
        if (work > tailBudget.remaining) {
          tailBudgetLimited = true;
        } else {
          tailBudget.remaining -= work;
          crossTailWarning = crossDimerTailWarning(fwd, rev, maxCrossDimerDeltaG, crossDimer);
        }
      }
      if (!crossTailWarning) {
        rejections.crossDimer = (rejections.crossDimer ?? 0) + 1;
        return null;
      }
    }
    if (crossDimer.status === 'work-limit' && maxCrossDimerDeltaG !== null) {
      return null;
    }

    return {
      forward: fwd,
      reverse: rev,
      productLength,
      tmDifference: tmDiff,
      crossDimer,
      ...(crossTailWarning ? { tailStructureWarnings: [crossTailWarning] } : {}),
    };
  };

  // Phase 0 pairs clean candidates with clean candidates, in the old order and
  // on the old budget, so it reproduces the old result exactly.
  pairing: for (const fwd of forwardsForPairing) {
    if (fwd.tailStructureWarnings) continue;
    for (const rev of reversesForPairing) {
      if (rev.tailStructureWarnings) continue;
      pairCombinations++;
      if (pairCombinations > MAX_PRIMER_PAIR_COMBINATIONS) {
        pairEnumerationLimited = true;
        break pairing;
      }
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

      const pair = screenPair(fwd, rev, tmDiff, productLength);
      if (pair) pairs.push(pair);
    }
  }

  // Phase 1 adds pairs that use a tail-warned candidate, only when clean pairs
  // cannot fill the ranking; every such pair ranks after every clean pair. It
  // is a branch and bound over the same order a full enumeration would sort
  // into: a pair's cross-dimer term only adds to its rank score, so once the
  // next combination's score without that term cannot beat the last pair the
  // ranking still needs, no later combination can either.
  // A clean pair's tail penalty is 0, so its key is exactly its old score.
  const rankKey = (pair: PrimerPair) => pairRankScore(pair, targetTm, enforceTargetTm) + pairTailStructurePenalty(pair);
  const byRank = (a: PrimerPair, b: PrimerPair) => (
    pairTailStructureTier(a) - pairTailStructureTier(b)
    || rankKey(a) - rankKey(b)
    || a.productLength - b.productLength
  );
  const cleanPairs = pairs.filter((pair) => pairTailStructureTier(pair) === 0).length;
  const hasWarnedCandidates = forwardsForPairing.some((candidate) => candidate.tailStructureWarnings)
    || reversesForPairing.some((candidate) => candidate.tailStructureWarnings);
  if (cleanPairs < maxPairs && hasWarnedCandidates && !pairEnumerationLimited) {
    pairedWarnedCandidates = true;
    type Combination = { fwd: PrimerCandidate; rev: PrimerCandidate; tmDiff: number; productLength: number; tier: number; bound: number };
    const combinations: Combination[] = [];
    warned: for (const fwd of forwardsForPairing) {
      for (const rev of reversesForPairing) {
        if (!fwd.tailStructureWarnings && !rev.tailStructureWarnings) continue;
        pairCombinations++;
        if (pairCombinations > MAX_PRIMER_PAIR_COMBINATIONS) {
          pairEnumerationLimited = true;
          break warned;
        }
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
        combinations.push({
          fwd,
          rev,
          tmDiff,
          productLength,
          tier: Math.max(tailStructureTier(fwd.tailStructureWarnings), tailStructureTier(rev.tailStructureWarnings)),
          bound: pairRankLowerBound(fwd, rev, tmDiff, targetTm, enforceTargetTm)
            + tailStructurePenalty(fwd.tailStructureWarnings)
            + tailStructurePenalty(rev.tailStructureWarnings),
        });
      }
    }
    combinations.sort((a, b) => a.tier - b.tier || a.bound - b.bound || a.productLength - b.productLength);
    const needed = maxPairs - cleanPairs;
    const leaders = pairs.filter((pair) => pairTailStructureTier(pair) > 0).sort(byRank).slice(0, needed);
    for (const combination of combinations) {
      if (leaders.length >= needed) {
        const last = leaders[needed - 1];
        const lastTier = pairTailStructureTier(last);
        // The margin keeps rounding in the bound from ever skipping a tie.
        if (combination.tier > lastTier
          || (combination.tier === lastTier && combination.bound > rankKey(last) + 1e-9)) break;
      }
      const pair = screenPair(combination.fwd, combination.rev, combination.tmDiff, combination.productLength);
      if (!pair) continue;
      pairs.push(pair);
      leaders.push(pair);
      leaders.sort(byRank);
      leaders.length = Math.min(leaders.length, needed);
    }
  }

  // Prefer balanced, high-quality pairs: low forward/reverse ΔTm first, then
  // closeness to target Tm when the target filter is enabled, then anchor
  // proximity, GC balance, and product length as the final deterministic tie.
  // Every clean pair ranks ahead of any pair with a tail-structure warning.
  pairs.sort(byRank);

  // When clean pairs fill the ranking, warned candidates could not enter it, so
  // the receipts describe the clean pools the ranking was drawn from.
  const poolFor = (result: PrimerDesignResult, direction: 'forward' | 'reverse') => retainedPoolReceipt(
    pairedWarnedCandidates
      ? result.pool
      : completePoolReceipt(direction, result.candidates.filter((candidate) => !candidate.tailStructureWarnings).length),
    pairingLimit,
  );
  const forwardPool = poolFor(forwardResult, 'forward');
  const reversePool = poolFor(reverseResult, 'reverse');

  const warnings = [...new Set([
    ...(forwardResult.warnings ?? []),
    ...(reverseResult.warnings ?? []),
    ...(forwardPool.truncated
      ? [`Forward primer pool retained ${forwardPool.retainedCount.toLocaleString()} of ${forwardPool.enumeratedCount.toLocaleString()} passing candidates for pairing; the directional pool is not exhaustive.`]
      : []),
    ...(reversePool.truncated
      ? [`Reverse primer pool retained ${reversePool.retainedCount.toLocaleString()} of ${reversePool.enumeratedCount.toLocaleString()} passing candidates for pairing; the directional pool is not exhaustive.`]
      : []),
    ...(crossDimerWorkLimited
      ? [`Cross-dimer scoring was bounded at ${MAX_PRIMER_PAIR_CROSS_DIMER_WORK_UNITS.toLocaleString()} work units; affected pairs are marked for review.`]
      : []),
    ...(pairEnumerationLimited
      ? [`Primer pair enumeration was bounded at ${MAX_PRIMER_PAIR_COMBINATIONS.toLocaleString()} combinations; the returned ranking is not exhaustive.`]
      : []),
    ...(tailBudgetLimited ? [TAIL_STRUCTURE_WORK_LIMIT_WARNING] : []),
  ])];

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
    forwardPool,
    reversePool,
    poolReceipts: { forward: forwardPool, reverse: reversePool },
    tmEvidence: normalizedPairParams?.tmEvidence,
    warnings,
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
