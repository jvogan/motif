import { reverseComplement } from './reverse-complement';
import { gcContent } from './gc-content';
import { calculateTm } from './tm-calculator';
import { DEFAULT_TM_OPTIONS } from './primer-design';
import type { Feature, Topology } from './types';
import {
  expandCircularFeatureLocation,
  remapFeatureLocation,
  type FeatureCoordinateMapSpan,
} from './feature-location';
import {
  FeatureCollectionInputError,
  cloneCanonicalFeature,
  snapshotFeatureCollection,
  type FeatureValidationIssueCode,
} from './feature-bounds';
import {
  inspectNucleotideSequence,
  nucleotideSymbolsCanPair,
} from './nucleotide';

/** Primer Tm is evaluated on the binding region, never on a 5′ tail. */
function primerBindingTm(seq: string): number | null {
  const result = calculateTm(seq, DEFAULT_TM_OPTIONS);
  return result.status === 'exact' ? result.tm : null;
}

export const DEFAULT_MIN_MATCHED_3_PRIME_LENGTH = 10;
export const DEFAULT_MAX_PRIMER_MISMATCHES = 0;
export const PCR_ENGINE_VERSION = '2' as const;
export const MAX_PCR_OLIGO_LENGTH = 500;
export const MAX_PCR_TAIL_LENGTH = 250;
export const MAX_PCR_PRODUCT_LENGTH = 50_000;
/** Default exact-work ceiling for one automatic primer-site scan. */
export const MAX_PCR_BINDING_SCAN_WORK_UNITS = 5_000_000;
const DEFAULT_MAX_BINDING_CANDIDATES = 10_000;
const DEFAULT_MAX_COMPETING_PRODUCTS = 100;
const MAX_PRODUCT_COMBINATIONS = 100_000;

export type PCRBindingStatus = 'exact' | 'ambiguous' | 'mismatch';

export type PCRTailSource = 'none' | 'explicit-selection' | 'inferred';

export interface PCRBindingEdit {
  /** Offset in the final 5′→3′ product (including the forward tail). */
  productOffset: number;
  /** Coordinate in the original forward-strand template. */
  templatePosition: number;
  original: string;
  replacement: string;
  primer: 'forward' | 'reverse';
}

export type PCRDiagnosticCode =
  | 'implicit_tail'
  | 'primer_bases_overwrote_template'
  | 'overlapping_binding_regions'
  | 'conflicting_overlapping_binding_edits'
  | 'binding_scan_work_limit'
  | 'binding_candidate_limit'
  | 'feature_input_limit';

export interface PCRDiagnostic {
  code: PCRDiagnosticCode;
  message: string;
  primer?: 'forward' | 'reverse';
  positions?: number[];
  /** Work-accounting evidence for a bounded automatic scan. */
  workUnits?: number;
  maxWorkUnits?: number;
  featureIssueCode?: FeatureValidationIssueCode;
}

export interface PCRProductProvenance {
  engine: 'motif-pcr';
  engineVersion: typeof PCR_ENGINE_VERSION;
  /** Product bases are the template interval overlaid with primer bases. */
  productAssembly: 'template-plus-primer-binding';
  tailPolicy: 'explicit-only' | 'allow-implicit';
  implicitTails: { forward: boolean; reverse: boolean };
  bindingEdits: PCRBindingEdit[];
}

export interface PCRSimulationOptions {
  /** Minimum consecutive compatible bases at the primer's 3′ end. */
  minMatched3PrimeLength?: number;
  /** Maximum non-compatible positions permitted outside that 3′ run. */
  maxMismatches?: number;
  /** Safety cap for enumerated sites per primer. */
  maxBindingCandidates?: number;
  /** Number of competing product descriptions retained in the result. */
  maxCompetingProducts?: number;
  /** Optional caller-specific ceiling; never raises the module default. */
  maxBindingScanWorkUnits?: number;
  /** Permit an unmatched 5′ primer prefix to be inferred as a tail. */
  allowImplicitTails?: boolean;
}

export interface PCRBindingScanResult {
  candidates: PCRBindingCandidate[];
  diagnostics: PCRDiagnostic[];
  workUnits: number;
  /** True only when neither the work nor candidate cap stopped enumeration. */
  complete: boolean;
}

/** Detailed automatic-PCR outcome, including a typed scan-limit failure. */
export interface PCRSimulationOutcome {
  result: PCRResult | null;
  diagnostics: PCRDiagnostic[];
}

export interface PCRBindingCandidate {
  /** 0-indexed start position on the searched strand. */
  bindStart: number;
  /** 0-indexed exclusive end position on the searched strand. */
  bindEnd: number;
  /** Primer suffix used as the binding region, in primer 5′→3′ order. */
  bindingSequence: string;
  /** 5′ prefix treated as an explicit tail for this candidate. */
  tail: string;
  /** Number of primer/template positions that were not compatible. */
  mismatchCount: number;
  /** Consecutive compatible positions from the primer's 3′ end. */
  matched3PrimeLength: number;
  /** Exact/conditional/mismatch confidence for this candidate. */
  status: PCRBindingStatus;
  /** Whether the prefix was selected explicitly or inferred from a shorter suffix. */
  tailSource: PCRTailSource;
}

export interface PCRPrimerBinding {
  /** 0-indexed start position on the original forward-strand template. */
  bindStart: number;
  /** 0-indexed exclusive end position on the original forward-strand template. */
  bindEnd: number;
  bindingSequence: string;
  tail: string;
  mismatchCount?: number;
  matched3PrimeLength?: number;
  status?: PCRBindingStatus;
  tailSource?: PCRTailSource;
  /** Melting temperature of the binding region only. */
  tm: number | null;
  /** GC% of the binding region; ambiguity is retained in status. */
  gcPercent: number;
  /** How many candidate sites were considered on this strand. */
  candidateCount?: number;
}

export interface PCRCompetingProduct {
  forward: Pick<PCRBindingCandidate, 'bindStart' | 'bindEnd' | 'mismatchCount' | 'status'>;
  reverse: Pick<PCRBindingCandidate, 'bindStart' | 'bindEnd' | 'mismatchCount' | 'status'>;
  productLength: number;
  wrapsOrigin: boolean;
  status: PCRBindingStatus;
}

export interface PCRResult {
  /** Full product sequence including any primer tails. */
  product: string;
  productLength: number;
  /** Template region between (and including) primer binding sites. */
  templateProduct: string;
  forward: PCRPrimerBinding;
  reverse: PCRPrimerBinding;
  /** ΔTm between forward and reverse binding regions. */
  tmDifference: number | null;
  /** GC% of the full product. */
  gcPercent: number;
  /** Features from template that fall within the amplified region. */
  features: Feature[];
  /** True when a circular-template amplicon crosses coordinate 0. */
  wrapsOrigin: boolean;
  /** Exact, mismatch-limited, or ambiguity-limited simulation status. */
  status: PCRBindingStatus;
  /** Explicit caveats; an ambiguous result must not be presented as exact. */
  warnings: string[];
  /** Machine-readable caveats and product-overlay evidence. */
  diagnostics: PCRDiagnostic[];
  /** False when overlapping primer edits disagree and cannot be ordered safely. */
  materializable: boolean;
  /** Deterministic product construction and primer/template edit receipt. */
  provenance: PCRProductProvenance;
  /** Other valid products/sites found under the selected policy. */
  competingProducts: PCRCompetingProduct[];
  /** Search/policy evidence retained with the result. */
  policy: {
    minMatched3PrimeLength: number;
    maxMismatches: number;
    maxBindingScanWorkUnits: number;
    allowImplicitTails: boolean;
  };
}

/** Optional exact primer binding coordinates selected by a primer-design UI. */
export interface PCRBindingSelection {
  forward: { start: number; end: number };
  reverse: { start: number; end: number };
}

type PCRSearchCandidate = PCRBindingCandidate;
type NormalizedPCRPolicy = NonNullable<ReturnType<typeof normalizePolicy>>;

function normalizePolicy(options?: PCRSimulationOptions): {
  minMatched3PrimeLength: number;
  maxMismatches: number;
  maxBindingCandidates: number;
  maxCompetingProducts: number;
  maxBindingScanWorkUnits: number;
  allowImplicitTails: boolean;
} | null {
  const minMatched3PrimeLength = options?.minMatched3PrimeLength ?? DEFAULT_MIN_MATCHED_3_PRIME_LENGTH;
  const maxMismatches = options?.maxMismatches ?? DEFAULT_MAX_PRIMER_MISMATCHES;
  const maxBindingCandidates = options?.maxBindingCandidates ?? DEFAULT_MAX_BINDING_CANDIDATES;
  const maxCompetingProducts = options?.maxCompetingProducts ?? DEFAULT_MAX_COMPETING_PRODUCTS;
  const maxBindingScanWorkUnits = options?.maxBindingScanWorkUnits ?? MAX_PCR_BINDING_SCAN_WORK_UNITS;
  const allowImplicitTails = options?.allowImplicitTails ?? false;
  if (
    !Number.isInteger(minMatched3PrimeLength)
    || minMatched3PrimeLength < 1
    || minMatched3PrimeLength > MAX_PCR_OLIGO_LENGTH
    || !Number.isInteger(maxMismatches)
    || maxMismatches < 0
    || maxMismatches > 10_000
    || !Number.isInteger(maxBindingCandidates)
    || maxBindingCandidates < 1
    || maxBindingCandidates > 100_000
    || !Number.isInteger(maxCompetingProducts)
    || maxCompetingProducts < 0
    || maxCompetingProducts > 10_000
    || !Number.isSafeInteger(maxBindingScanWorkUnits)
    || maxBindingScanWorkUnits < 0
    || maxBindingScanWorkUnits > MAX_PCR_BINDING_SCAN_WORK_UNITS
    || typeof allowImplicitTails !== 'boolean'
  ) return null;
  return {
    minMatched3PrimeLength,
    maxMismatches,
    maxBindingCandidates,
    maxCompetingProducts,
    maxBindingScanWorkUnits,
    allowImplicitTails,
  };
}

function statusForBinding(
  primer: string,
  template: string,
  mismatchCount: number,
): PCRBindingStatus {
  const primerInspection = inspectNucleotideSequence(primer);
  const templateInspection = inspectNucleotideSequence(template);
  if (primerInspection.ambiguous || templateInspection.ambiguous) return 'ambiguous';
  if (mismatchCount > 0) return 'mismatch';
  return 'exact';
}

function bindingAt(
  template: string,
  primer: string,
  position: number,
  bindingLength: number,
  minMatched3PrimeLength: number,
  maxMismatches: number,
  allowImplicitTails: boolean,
): PCRSearchCandidate | null {
  if (
    bindingLength < minMatched3PrimeLength
    || bindingLength > primer.length
    || primer.length > MAX_PCR_OLIGO_LENGTH
    || primer.length - bindingLength > MAX_PCR_TAIL_LENGTH
    || position < 0
    || position + bindingLength > template.length
  ) return null;
  if (!allowImplicitTails && bindingLength !== primer.length) return null;
  const bindingSequence = primer.slice(primer.length - bindingLength);
  const templateSequence = template.slice(position, position + bindingLength);
  let mismatchCount = 0;
  let matched3PrimeLength = 0;
  for (let index = 0; index < bindingLength; index += 1) {
    if (!nucleotideSymbolsCanPair(bindingSequence[index], templateSequence[index])) mismatchCount += 1;
  }
  for (let index = bindingLength - 1; index >= 0; index -= 1) {
    if (!nucleotideSymbolsCanPair(bindingSequence[index], templateSequence[index])) break;
    matched3PrimeLength += 1;
  }
  if (matched3PrimeLength < minMatched3PrimeLength || mismatchCount > maxMismatches) return null;
  return {
    bindStart: position,
    bindEnd: position + bindingLength,
    bindingSequence,
    tail: primer.slice(0, primer.length - bindingLength),
    mismatchCount,
    matched3PrimeLength,
    status: statusForBinding(bindingSequence, templateSequence, mismatchCount),
    tailSource: bindingLength === primer.length ? 'none' : 'inferred',
  };
}

function boundedWorkUnits(value: number): number {
  if (!Number.isFinite(value) || value < 0) return Number.MAX_SAFE_INTEGER;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(value));
}

function bindingLengthFloor(
  primerLength: number,
  minMatched3PrimeLength: number,
  allowImplicitTails: boolean,
): number {
  return allowImplicitTails
    ? Math.max(minMatched3PrimeLength, primerLength - MAX_PCR_TAIL_LENGTH)
    : primerLength;
}

/**
 * Estimate the compatibility checks needed to exhaustively scan one primer.
 * Each candidate window is charged for the mismatch pass and the 3′-run pass
 * in `bindingAt`, so the estimate is a safe upper bound for the scan loop.
 */
export function estimatePCRBindingScanWorkUnits(
  templateLength: number,
  primerLength: number,
  options: Pick<PCRSimulationOptions, 'minMatched3PrimeLength' | 'allowImplicitTails'> = {},
): number {
  const minMatched3PrimeLength = options.minMatched3PrimeLength ?? DEFAULT_MIN_MATCHED_3_PRIME_LENGTH;
  const allowImplicitTails = options.allowImplicitTails ?? false;
  if (
    !Number.isSafeInteger(templateLength)
    || templateLength < 0
    || !Number.isSafeInteger(primerLength)
    || primerLength < 0
    || !Number.isInteger(minMatched3PrimeLength)
    || minMatched3PrimeLength < 1
    || minMatched3PrimeLength > MAX_PCR_OLIGO_LENGTH
    || typeof allowImplicitTails !== 'boolean'
    || primerLength < minMatched3PrimeLength
    || primerLength > MAX_PCR_OLIGO_LENGTH
  ) return Number.MAX_SAFE_INTEGER;

  const minimumBindingLength = bindingLengthFloor(
    primerLength,
    minMatched3PrimeLength,
    allowImplicitTails,
  );
  let workUnits = 0;
  for (let bindingLength = primerLength; bindingLength >= minimumBindingLength; bindingLength -= 1) {
    const windows = Math.max(0, templateLength - bindingLength + 1);
    workUnits = boundedWorkUnits(workUnits + windows * bindingLength * 2);
    if (workUnits === Number.MAX_SAFE_INTEGER) return workUnits;
  }
  return workUnits;
}

function bindingScanWorkLimitDiagnostic(
  workUnits: number,
  maxWorkUnits: number,
): PCRDiagnostic {
  return {
    code: 'binding_scan_work_limit',
    message: `Automatic PCR binding-site scanning stopped after ${workUnits.toLocaleString()} work units at the checked limit of ${maxWorkUnits.toLocaleString()}; binding-site evidence is incomplete.`,
    workUnits,
    maxWorkUnits,
  };
}

function bindingCandidateLimitDiagnostic(maxBindingCandidates: number): PCRDiagnostic {
  return {
    code: 'binding_candidate_limit',
    message: `Automatic PCR binding-site scanning retained ${maxBindingCandidates.toLocaleString()} candidates and stopped; binding-site evidence is incomplete.`,
  };
}

/**
 * Enumerate all compatible binding sites for one primer on one strand.
 * Results retain every coordinate/length alternative instead of returning the
 * first substring match and silently treating it as the intended site.
 */
export function findPrimerBindingsWithDiagnostics(
  template: string,
  primer: string,
  options?: PCRSimulationOptions,
): PCRBindingScanResult {
  const policy = normalizePolicy(options);
  if (!policy) return { candidates: [], diagnostics: [], workUnits: 0, complete: true };
  const templateInspection = inspectNucleotideSequence(template);
  const primerInspection = inspectNucleotideSequence(primer);
  if (templateInspection.invalidCharacters.length > 0 || primerInspection.invalidCharacters.length > 0) {
    return { candidates: [], diagnostics: [], workUnits: 0, complete: true };
  }
  if (primerInspection.sequence.length > MAX_PCR_OLIGO_LENGTH) {
    return { candidates: [], diagnostics: [], workUnits: 0, complete: true };
  }
  const tmpl = templateInspection.sequence;
  const oligo = primerInspection.sequence;
  if (oligo.length < policy.minMatched3PrimeLength || tmpl.length === 0) {
    return { candidates: [], diagnostics: [], workUnits: 0, complete: true };
  }

  const candidates: PCRSearchCandidate[] = [];
  const seen = new Set<string>();
  const minBindingLength = bindingLengthFloor(
    oligo.length,
    policy.minMatched3PrimeLength,
    policy.allowImplicitTails,
  );
  let workUnits = 0;
  let workLimitReached = false;
  let candidateLimitReached = false;
  let candidateCapReached = false;
  // Prefer the full oligo when a safety cap is reached. Short suffixes are
  // considered only after an explicit allowImplicitTails opt-in and must not
  // crowd out the strongest/full-length binding evidence.
  for (let bindingLength = oligo.length; bindingLength >= minBindingLength; bindingLength -= 1) {
    for (let position = 0; position + bindingLength <= tmpl.length; position += 1) {
      const workForWindow = bindingLength * 2;
      if (workUnits + workForWindow > policy.maxBindingScanWorkUnits) {
        workLimitReached = true;
        break;
      }
      workUnits += workForWindow;
      const candidate = bindingAt(
        tmpl,
        oligo,
        position,
        bindingLength,
        policy.minMatched3PrimeLength,
        policy.maxMismatches,
        policy.allowImplicitTails,
      );
      if (!candidate) continue;
      const key = `${candidate.bindStart}:${candidate.bindEnd}:${candidate.mismatchCount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (candidateCapReached) {
        // The first candidate beyond the retained cap proves that the scan
        // would have returned more evidence. A cap reached on the final
        // exhaustive window remains complete because no such candidate can
        // exist after the loop finishes.
        candidateLimitReached = true;
        break;
      }
      candidates.push(candidate);
      if (candidates.length >= policy.maxBindingCandidates) candidateCapReached = true;
    }
    if (workLimitReached || candidateLimitReached) break;
  }
  candidates.sort((left, right) => (
    right.bindingSequence.length - left.bindingSequence.length
    || left.mismatchCount - right.mismatchCount
    || right.matched3PrimeLength - left.matched3PrimeLength
    || left.bindStart - right.bindStart
  ));
  const diagnostics = [
    ...(workLimitReached ? [bindingScanWorkLimitDiagnostic(workUnits, policy.maxBindingScanWorkUnits)] : []),
    ...(candidateLimitReached ? [bindingCandidateLimitDiagnostic(policy.maxBindingCandidates)] : []),
  ];
  return { candidates, diagnostics, workUnits, complete: diagnostics.length === 0 };
}

export function findPrimerBindings(
  template: string,
  primer: string,
  options?: PCRSimulationOptions,
): PCRBindingCandidate[] {
  const scan = findPrimerBindingsWithDiagnostics(template, primer, options);
  // Preserve the historical array API without presenting a partial scan as
  // exhaustive evidence. Callers that need the typed limit diagnostic should
  // use `findPrimerBindingsWithDiagnostics`.
  return scan.complete ? scan.candidates : [];
}

function selectedBindingCandidate(
  template: string,
  primer: string,
  range: { start: number; end: number },
  policy: NormalizedPCRPolicy,
): PCRBindingCandidate | null {
  const templateInspection = inspectNucleotideSequence(template);
  const primerInspection = inspectNucleotideSequence(primer);
  if (templateInspection.invalidCharacters.length > 0 || primerInspection.invalidCharacters.length > 0) return null;
  const candidate = bindingAt(
    templateInspection.sequence,
    primerInspection.sequence,
    range.start,
    range.end - range.start,
    policy.minMatched3PrimeLength,
    policy.maxMismatches,
    true,
  );
  return candidate
    ? { ...candidate, tailSource: candidate.tail.length > 0 ? 'explicit-selection' : 'none' }
    : null;
}

function asReverseBinding(
  candidate: PCRBindingCandidate,
  templateLength: number,
  candidateCount: number,
): PCRPrimerBinding {
  const bindEnd = templateLength - candidate.bindStart;
  const bindStart = bindEnd - (candidate.bindEnd - candidate.bindStart);
  return {
    ...candidate,
    bindStart,
    bindEnd,
    tm: primerBindingTm(candidate.bindingSequence),
    gcPercent: gcContent(candidate.bindingSequence) * 100,
    candidateCount,
  };
}

function bindingStatus(forward: PCRBindingCandidate, reverse: PCRBindingCandidate): PCRBindingStatus {
  if (forward.status === 'ambiguous' || reverse.status === 'ambiguous') return 'ambiguous';
  if (forward.status === 'mismatch' || reverse.status === 'mismatch') return 'mismatch';
  return 'exact';
}

function featureForCircularSource(feature: Feature, sequenceLength: number, topology: Topology): Feature {
  return topology === 'circular'
    ? expandCircularFeatureLocation(feature, sequenceLength) as Feature
    : feature;
}

function propagateFeature(
  feature: Feature,
  sourceSpans: readonly FeatureCoordinateMapSpan[],
  sequenceLength: number,
  topology: Topology,
): Feature | null {
  const sourceFeature = featureForCircularSource(feature, sequenceLength, topology);
  const location = remapFeatureLocation(sourceFeature, sourceSpans);
  if (!location) return null;
  return cloneCanonicalFeature(feature, {
    id: crypto.randomUUID(),
    start: location.start,
    end: location.end,
    ...(location.subRanges === undefined ? { subRanges: undefined } : { subRanges: location.subRanges }),
    metadata: {
      ...feature.metadata,
      pcrSourceFeatureId: feature.id,
      pcrSourceStart: feature.start,
      pcrSourceEnd: feature.end,
      generatedBy: 'motif-pcr',
      ...(sourceFeature.subRanges && feature.subRanges === undefined
        ? { pcrSourceSplitAtOrigin: true }
        : {}),
    },
  });
}

function productStatusWarnings(
  status: PCRBindingStatus,
  forward: PCRBindingCandidate,
  reverse: PCRBindingCandidate,
): string[] {
  const warnings: string[] = [];
  if (status === 'ambiguous') warnings.push('IUPAC ambiguity occurs in the binding or amplified template region; this product is conditional, not an exact sequence claim.');
  const mismatchCount = forward.mismatchCount + reverse.mismatchCount;
  if (mismatchCount > 0) warnings.push(`Primer binding uses ${mismatchCount} permitted mismatch${mismatchCount === 1 ? '' : 'es'}; review the 3′-end policy before ordering.`);
  if (forward.tailSource === 'inferred' || reverse.tailSource === 'inferred') {
    warnings.push('A 5′ primer tail was inferred from a shorter binding suffix; select binding coordinates or provide an explicit tail before ordering.');
  }
  return warnings;
}

function materializeTemplateProduct(
  template: string,
  forward: PCRBindingCandidate,
  reverse: PCRBindingCandidate,
  wrapsOrigin: boolean,
  forwardTailLength: number,
): {
  templateProduct: string;
  bindingEdits: PCRBindingEdit[];
  overlappingBindingPositions: number[];
  conflictingBindingPositions: number[];
} {
  const originalProduct = wrapsOrigin
    ? template.slice(forward.bindStart) + template.slice(0, reverse.bindEnd)
    : template.slice(forward.bindStart, reverse.bindEnd);
  const segments = wrapsOrigin
    ? [
        { start: forward.bindStart, end: template.length, productStart: 0 },
        { start: 0, end: reverse.bindEnd, productStart: template.length - forward.bindStart },
      ]
    : [{ start: forward.bindStart, end: reverse.bindEnd, productStart: 0 }];
  const chars = originalProduct.split('');
  const bindingEdits: PCRBindingEdit[] = [];
  const touchedBy = new Map<number, { primer: 'forward' | 'reverse'; replacement: string }>();
  const overlappingBindingPositions: number[] = [];
  const conflictingBindingPositions: number[] = [];
  const apply = (
    templatePosition: number,
    replacement: string,
    primer: 'forward' | 'reverse',
  ): void => {
    const segment = segments.find((candidate) => (
      templatePosition >= candidate.start && templatePosition < candidate.end
    ));
    if (!segment) return;
    const productOffset = segment.productStart + templatePosition - segment.start;
    const previous = touchedBy.get(productOffset);
    if (previous && previous.primer !== primer && !overlappingBindingPositions.includes(templatePosition)) {
      overlappingBindingPositions.push(templatePosition);
    }
    if (previous && previous.primer !== primer && previous.replacement !== replacement) {
      conflictingBindingPositions.push(templatePosition);
      return;
    }
    touchedBy.set(productOffset, { primer, replacement });
    const original = chars[productOffset] ?? '';
    if (original !== replacement) {
      bindingEdits.push({
        productOffset: forwardTailLength + productOffset,
        templatePosition,
        original,
        replacement,
        primer,
      });
      chars[productOffset] = replacement;
    }
  };

  for (let offset = 0; offset < forward.bindingSequence.length; offset += 1) {
    apply(forward.bindStart + offset, forward.bindingSequence[offset], 'forward');
  }
  const reversePlus = reverseComplement(reverse.bindingSequence);
  for (let offset = 0; offset < reversePlus.length; offset += 1) {
    apply(reverse.bindStart + offset, reversePlus[offset], 'reverse');
  }
  return {
    templateProduct: chars.join(''),
    bindingEdits,
    overlappingBindingPositions,
    conflictingBindingPositions,
  };
}

/**
 * Simulate a PCR amplification while retaining all source coordinates and
 * surfacing competing sites. The legacy return shape is preserved; callers
 * must inspect `status`, `warnings`, and `competingProducts` before treating a
 * result as exact.
 */
function simulatePCRInternal(
  template: string,
  forwardPrimer: string,
  reversePrimer: string,
  features?: readonly Feature[],
  topology: Topology = 'linear',
  selectedBinding?: PCRBindingSelection,
  options?: PCRSimulationOptions,
): PCRSimulationOutcome {
  const policy = normalizePolicy(options);
  if (!policy) return { result: null, diagnostics: [] };
  const templateInspection = inspectNucleotideSequence(template);
  const forwardInspection = inspectNucleotideSequence(forwardPrimer);
  const reverseInspection = inspectNucleotideSequence(reversePrimer);
  if (
    templateInspection.invalidCharacters.length > 0
    || forwardInspection.invalidCharacters.length > 0
    || reverseInspection.invalidCharacters.length > 0
  ) return { result: null, diagnostics: [] };
  const tmpl = templateInspection.sequence;
  const fwd = forwardInspection.sequence;
  const rev = reverseInspection.sequence;
  let canonicalFeatures: Feature[];
  try {
    canonicalFeatures = snapshotFeatureCollection(features, {
      label: 'PCR features',
      sequenceLength: tmpl.length,
      allowCircularWrap: topology === 'circular',
    });
  } catch (error) {
    const validation = error instanceof FeatureCollectionInputError ? error.validation : null;
    return {
      result: null,
      diagnostics: validation?.issues.map((issue) => ({
        code: 'feature_input_limit' as const,
        featureIssueCode: issue.code,
        message: issue.message,
      })) ?? [{
        code: 'feature_input_limit' as const,
        message: 'PCR features could not be inspected as bounded data.',
      }],
    };
  }
  if (fwd.length > MAX_PCR_OLIGO_LENGTH || rev.length > MAX_PCR_OLIGO_LENGTH) return { result: null, diagnostics: [] };
  if (fwd.length < policy.minMatched3PrimeLength || rev.length < policy.minMatched3PrimeLength || tmpl.length === 0) return { result: null, diagnostics: [] };

  const validRange = (range: { start: number; end: number }) => (
    Number.isInteger(range.start)
    && Number.isInteger(range.end)
    && range.start >= 0
    && range.end > range.start
    && range.end <= tmpl.length
  );
  if (selectedBinding && (!validRange(selectedBinding.forward) || !validRange(selectedBinding.reverse))) return { result: null, diagnostics: [] };

  const rcTmpl = reverseComplement(tmpl);
  const forwardScan = selectedBinding
    ? {
        candidates: [selectedBindingCandidate(tmpl, fwd, selectedBinding.forward, policy)]
          .filter((candidate): candidate is PCRBindingCandidate => candidate !== null),
        diagnostics: [] as PCRDiagnostic[],
      }
    : findPrimerBindingsWithDiagnostics(tmpl, fwd, policy);
  const reverseScan = selectedBinding
    ? {
        candidates: [selectedBindingCandidate(rcTmpl, rev, {
        start: tmpl.length - selectedBinding.reverse.end,
        end: tmpl.length - selectedBinding.reverse.start,
        }, policy)].filter((candidate): candidate is PCRBindingCandidate => candidate !== null),
        diagnostics: [] as PCRDiagnostic[],
      }
    : findPrimerBindingsWithDiagnostics(rcTmpl, rev, policy);
  const forwardCandidates = forwardScan.candidates;
  const reverseRcCandidates = reverseScan.candidates;
  const bindingScanDiagnostics: PCRDiagnostic[] = [
    ...forwardScan.diagnostics.map((diagnostic) => ({ ...diagnostic, primer: 'forward' as const })),
    ...reverseScan.diagnostics.map((diagnostic) => ({ ...diagnostic, primer: 'reverse' as const })),
  ];
  if (forwardCandidates.length === 0 || reverseRcCandidates.length === 0) {
    return { result: null, diagnostics: bindingScanDiagnostics };
  }

  type ProductCandidate = {
    forward: PCRBindingCandidate;
    reverse: PCRBindingCandidate;
    reverseRc: PCRBindingCandidate;
    wrapsOrigin: boolean;
    templateProduct: string;
    productLength: number;
    status: PCRBindingStatus;
  };
  const products: ProductCandidate[] = [];
  let productsTruncated = false;
  for (const forward of forwardCandidates) {
    for (const reverseRc of reverseRcCandidates) {
      if (products.length >= MAX_PRODUCT_COMBINATIONS) {
        productsTruncated = true;
        break;
      }
      const reverse = {
        ...reverseRc,
        bindStart: tmpl.length - reverseRc.bindEnd,
        bindEnd: tmpl.length - reverseRc.bindStart,
      };
      const wrapsOrigin = reverse.bindEnd <= forward.bindStart;
      if (wrapsOrigin && topology !== 'circular') continue;
      const templateProduct = wrapsOrigin
        ? tmpl.slice(forward.bindStart) + tmpl.slice(0, reverse.bindEnd)
        : tmpl.slice(forward.bindStart, reverse.bindEnd);
      const productLength = templateProduct.length + forward.tail.length + reverse.tail.length;
      if (
        templateProduct.length === 0
        || forward.tail.length > MAX_PCR_TAIL_LENGTH
        || reverse.tail.length > MAX_PCR_TAIL_LENGTH
        || productLength > MAX_PCR_PRODUCT_LENGTH
      ) continue;
      const productInspection = inspectNucleotideSequence(templateProduct);
      const candidateStatus = bindingStatus(forward, reverse);
      products.push({
        forward,
        reverse,
        reverseRc,
        wrapsOrigin,
        templateProduct,
        productLength,
        status: candidateStatus === 'exact' && productInspection.ambiguous ? 'ambiguous' : candidateStatus,
      });
    }
    if (productsTruncated) break;
  }
  if (products.length === 0) return { result: null, diagnostics: bindingScanDiagnostics };
  products.sort((left, right) => (
    right.forward.bindingSequence.length + right.reverse.bindingSequence.length
      - left.forward.bindingSequence.length - left.reverse.bindingSequence.length
    || left.forward.mismatchCount + left.reverse.mismatchCount
      - right.forward.mismatchCount - right.reverse.mismatchCount
    || left.productLength - right.productLength
    || left.forward.bindStart - right.forward.bindStart
    || left.reverse.bindStart - right.reverse.bindStart
  ));
  const selected = products[0];
  const competing = selectedBinding ? [] : products.slice(1, 1 + policy.maxCompetingProducts);
  const selectedForward = {
    ...selected.forward,
    tm: primerBindingTm(selected.forward.bindingSequence),
    gcPercent: gcContent(selected.forward.bindingSequence) * 100,
    candidateCount: forwardCandidates.length,
  } satisfies PCRPrimerBinding;
  const selectedReverse = asReverseBinding(
    selected.reverseRc,
    tmpl.length,
    reverseRcCandidates.length,
  );
  const bindingStatusForSelected = selected.status;
  const status: PCRBindingStatus = !selectedBinding && (products.length > 1 || bindingScanDiagnostics.length > 0)
    ? 'ambiguous'
    : bindingStatusForSelected;
  const warnings = productStatusWarnings(bindingStatusForSelected, selected.forward, selected.reverse);
  if (!selectedBinding && products.length > 1) {
    warnings.push(`${products.length} competing primer-binding product${products.length === 1 ? '' : 's'} satisfy the selected 3′-match policy; coordinates are reported instead of assuming the first site is intended.`);
  }
  if (bindingScanDiagnostics.length > 0) {
    warnings.push(...bindingScanDiagnostics.map((diagnostic) => diagnostic.message));
  }
  if (!selectedBinding && bindingScanDiagnostics.some((diagnostic) => (
    diagnostic.primer === 'forward' && diagnostic.code === 'binding_candidate_limit'
  ))) {
    warnings.push(`Forward primer-site enumeration reached its cap of ${policy.maxBindingCandidates.toLocaleString()} candidates; the competing-product list may be incomplete.`);
  }
  if (!selectedBinding && bindingScanDiagnostics.some((diagnostic) => (
    diagnostic.primer === 'reverse' && diagnostic.code === 'binding_candidate_limit'
  ))) {
    warnings.push(`Reverse primer-site enumeration reached its cap of ${policy.maxBindingCandidates.toLocaleString()} candidates; the competing-product list may be incomplete.`);
  }
  if (productsTruncated) warnings.push(`PCR product enumeration stopped at ${MAX_PRODUCT_COMBINATIONS.toLocaleString()} combinations; narrow the binding policy before treating the result as exhaustive.`);
  const fwdTail = selected.forward.tail;
  const revTailRC = selected.reverse.tail.length > 0 ? reverseComplement(selected.reverse.tail) : '';
  const materialized = materializeTemplateProduct(
    tmpl,
    selected.forward,
    selected.reverse,
    selected.wrapsOrigin,
    fwdTail.length,
  );
  const diagnostics: PCRDiagnostic[] = [...bindingScanDiagnostics];
  const implicitForward = selected.forward.tailSource === 'inferred';
  const implicitReverse = selected.reverse.tailSource === 'inferred';
  if (implicitForward) diagnostics.push({
    code: 'implicit_tail',
    primer: 'forward',
    message: 'The forward 5′ tail was inferred from a shorter binding suffix; an explicit binding selection is required for safe materialization.',
  });
  if (implicitReverse) diagnostics.push({
    code: 'implicit_tail',
    primer: 'reverse',
    message: 'The reverse 5′ tail was inferred from a shorter binding suffix; an explicit binding selection is required for safe materialization.',
  });
  if (materialized.bindingEdits.length > 0) {
    diagnostics.push({
      code: 'primer_bases_overwrote_template',
      message: `${materialized.bindingEdits.length} product base${materialized.bindingEdits.length === 1 ? '' : 's'} came from permitted primer/template mismatches rather than the template interval.`,
      positions: materialized.bindingEdits.map((edit) => edit.templatePosition),
    });
  }
  if (materialized.overlappingBindingPositions.length > 0) {
    diagnostics.push({
      code: 'overlapping_binding_regions',
      message: 'Forward and reverse binding regions overlap; shared bases must agree before the amplicon can be ordered.',
      positions: materialized.overlappingBindingPositions,
    });
  }
  if (materialized.conflictingBindingPositions.length > 0) {
    diagnostics.push({
      code: 'conflicting_overlapping_binding_edits',
      message: 'Forward and reverse primer edits disagree at overlapping product coordinates; the amplicon is not safe to materialize.',
      positions: materialized.conflictingBindingPositions,
    });
  }
  const materializable = bindingScanDiagnostics.length === 0
    && !implicitForward
    && !implicitReverse
    && materialized.conflictingBindingPositions.length === 0;
  const product = fwdTail + materialized.templateProduct + revTailRC;
  const sourceSpans: FeatureCoordinateMapSpan[] = selected.wrapsOrigin
    ? [
        { start: selected.forward.bindStart, end: tmpl.length, targetStart: fwdTail.length },
        { start: 0, end: selected.reverse.bindEnd, targetStart: fwdTail.length + (tmpl.length - selected.forward.bindStart) },
      ]
    : [{ start: selected.forward.bindStart, end: selected.reverse.bindEnd, targetStart: fwdTail.length }];
  const productFeatures = canonicalFeatures
    .map((feature) => propagateFeature(feature, sourceSpans, tmpl.length, topology))
    .filter((feature): feature is Feature => feature !== null);
  const tmDifference = selectedForward.tm !== null && selectedReverse.tm !== null
    ? Math.abs(selectedForward.tm - selectedReverse.tm)
    : null;
  return {
    result: {
      product,
      productLength: product.length,
      templateProduct: selected.templateProduct,
      forward: selectedForward,
      reverse: selectedReverse,
      tmDifference,
      gcPercent: gcContent(product) * 100,
      features: productFeatures,
      wrapsOrigin: selected.wrapsOrigin,
      status,
      warnings,
      diagnostics,
      materializable,
      provenance: {
        engine: 'motif-pcr',
        engineVersion: PCR_ENGINE_VERSION,
        productAssembly: 'template-plus-primer-binding',
        tailPolicy: policy.allowImplicitTails ? 'allow-implicit' : 'explicit-only',
        implicitTails: { forward: implicitForward, reverse: implicitReverse },
        bindingEdits: materialized.bindingEdits,
      },
      competingProducts: competing.map((candidate) => ({
        forward: candidate.forward,
        reverse: candidate.reverse,
        productLength: candidate.productLength,
        wrapsOrigin: candidate.wrapsOrigin,
        status: candidate.status,
      })),
      policy: {
        minMatched3PrimeLength: policy.minMatched3PrimeLength,
        maxMismatches: policy.maxMismatches,
        maxBindingScanWorkUnits: policy.maxBindingScanWorkUnits,
        allowImplicitTails: policy.allowImplicitTails,
      },
    },
    diagnostics: bindingScanDiagnostics,
  };
}

export function simulatePCRWithDiagnostics(
  template: string,
  forwardPrimer: string,
  reversePrimer: string,
  features?: readonly Feature[],
  topology: Topology = 'linear',
  selectedBinding?: PCRBindingSelection,
  options?: PCRSimulationOptions,
): PCRSimulationOutcome {
  return simulatePCRInternal(
    template,
    forwardPrimer,
    reversePrimer,
    features,
    topology,
    selectedBinding,
    options,
  );
}

export function simulatePCR(
  template: string,
  forwardPrimer: string,
  reversePrimer: string,
  features?: readonly Feature[],
  topology: Topology = 'linear',
  selectedBinding?: PCRBindingSelection,
  options?: PCRSimulationOptions,
): PCRResult | null {
  return simulatePCRWithDiagnostics(
    template,
    forwardPrimer,
    reversePrimer,
    features,
    topology,
    selectedBinding,
    options,
  ).result;
}
