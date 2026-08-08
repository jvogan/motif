import { reverseComplement } from './reverse-complement';
import { gcContent } from './gc-content';
import { calculateTm } from './tm-calculator';
import { DEFAULT_TM_OPTIONS } from './primer-design';
import type { Feature, Topology } from './types';
import { remapFeatureLocation, type FeatureCoordinateMapSpan } from './feature-location';
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
const MAX_PRODUCT_LENGTH = 50_000;
const DEFAULT_MAX_BINDING_CANDIDATES = 10_000;
const DEFAULT_MAX_COMPETING_PRODUCTS = 100;
const MAX_PRODUCT_COMBINATIONS = 100_000;

export type PCRBindingStatus = 'exact' | 'ambiguous' | 'mismatch';

export interface PCRSimulationOptions {
  /** Minimum consecutive compatible bases at the primer's 3′ end. */
  minMatched3PrimeLength?: number;
  /** Maximum non-compatible positions permitted outside that 3′ run. */
  maxMismatches?: number;
  /** Safety cap for enumerated sites per primer. */
  maxBindingCandidates?: number;
  /** Number of competing product descriptions retained in the result. */
  maxCompetingProducts?: number;
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
  /** Other valid products/sites found under the selected policy. */
  competingProducts: PCRCompetingProduct[];
  /** Search/policy evidence retained with the result. */
  policy: {
    minMatched3PrimeLength: number;
    maxMismatches: number;
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
} | null {
  const minMatched3PrimeLength = options?.minMatched3PrimeLength ?? DEFAULT_MIN_MATCHED_3_PRIME_LENGTH;
  const maxMismatches = options?.maxMismatches ?? DEFAULT_MAX_PRIMER_MISMATCHES;
  const maxBindingCandidates = options?.maxBindingCandidates ?? DEFAULT_MAX_BINDING_CANDIDATES;
  const maxCompetingProducts = options?.maxCompetingProducts ?? DEFAULT_MAX_COMPETING_PRODUCTS;
  if (
    !Number.isInteger(minMatched3PrimeLength)
    || minMatched3PrimeLength < 1
    || minMatched3PrimeLength > 10_000
    || !Number.isInteger(maxMismatches)
    || maxMismatches < 0
    || maxMismatches > 10_000
    || !Number.isInteger(maxBindingCandidates)
    || maxBindingCandidates < 1
    || maxBindingCandidates > 100_000
    || !Number.isInteger(maxCompetingProducts)
    || maxCompetingProducts < 0
    || maxCompetingProducts > 10_000
  ) return null;
  return { minMatched3PrimeLength, maxMismatches, maxBindingCandidates, maxCompetingProducts };
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
): PCRSearchCandidate | null {
  if (bindingLength < minMatched3PrimeLength || position < 0 || position + bindingLength > template.length) return null;
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
  };
}

/**
 * Enumerate all compatible binding sites for one primer on one strand.
 * Results retain every coordinate/length alternative instead of returning the
 * first substring match and silently treating it as the intended site.
 */
export function findPrimerBindings(
  template: string,
  primer: string,
  options?: PCRSimulationOptions,
): PCRBindingCandidate[] {
  const policy = normalizePolicy(options);
  if (!policy) return [];
  const templateInspection = inspectNucleotideSequence(template);
  const primerInspection = inspectNucleotideSequence(primer);
  if (templateInspection.invalidCharacters.length > 0 || primerInspection.invalidCharacters.length > 0) return [];
  const tmpl = templateInspection.sequence;
  const oligo = primerInspection.sequence;
  if (oligo.length < policy.minMatched3PrimeLength || tmpl.length === 0) return [];

  const candidates: PCRSearchCandidate[] = [];
  const seen = new Set<string>();
  const minBindingLength = Math.min(oligo.length, policy.minMatched3PrimeLength);
  // Prefer the full oligo when a safety cap is reached. Short suffixes are
  // still retained as explicit tail alternatives, but must not crowd out the
  // strongest/full-length binding evidence.
  for (let bindingLength = oligo.length; bindingLength >= minBindingLength; bindingLength -= 1) {
    for (let position = 0; position + bindingLength <= tmpl.length; position += 1) {
      const candidate = bindingAt(
        tmpl,
        oligo,
        position,
        bindingLength,
        policy.minMatched3PrimeLength,
        policy.maxMismatches,
      );
      if (!candidate) continue;
      const key = `${candidate.bindStart}:${candidate.bindEnd}:${candidate.mismatchCount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
      if (candidates.length >= policy.maxBindingCandidates) break;
    }
    if (candidates.length >= policy.maxBindingCandidates) break;
  }
  candidates.sort((left, right) => (
    right.bindingSequence.length - left.bindingSequence.length
    || left.mismatchCount - right.mismatchCount
    || right.matched3PrimeLength - left.matched3PrimeLength
    || left.bindStart - right.bindStart
  ));
  return candidates;
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
  );
  return candidate ? { ...candidate } : null;
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
  if (topology !== 'circular' || feature.subRanges !== undefined || feature.start <= feature.end) return feature;
  const strand = feature.strand;
  return {
    ...feature,
    start: 0,
    end: sequenceLength,
    subRanges: [
      { start: feature.start, end: sequenceLength, strand },
      { start: 0, end: feature.end, strand },
    ],
  };
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
  return {
    ...feature,
    id: crypto.randomUUID(),
    ...location,
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
  };
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
  return warnings;
}

/**
 * Simulate a PCR amplification while retaining all source coordinates and
 * surfacing competing sites. The legacy return shape is preserved; callers
 * must inspect `status`, `warnings`, and `competingProducts` before treating a
 * result as exact.
 */
export function simulatePCR(
  template: string,
  forwardPrimer: string,
  reversePrimer: string,
  features?: Feature[],
  topology: Topology = 'linear',
  selectedBinding?: PCRBindingSelection,
  options?: PCRSimulationOptions,
): PCRResult | null {
  const policy = normalizePolicy(options);
  if (!policy) return null;
  const templateInspection = inspectNucleotideSequence(template);
  const forwardInspection = inspectNucleotideSequence(forwardPrimer);
  const reverseInspection = inspectNucleotideSequence(reversePrimer);
  if (
    templateInspection.invalidCharacters.length > 0
    || forwardInspection.invalidCharacters.length > 0
    || reverseInspection.invalidCharacters.length > 0
  ) return null;
  const tmpl = templateInspection.sequence;
  const fwd = forwardInspection.sequence;
  const rev = reverseInspection.sequence;
  if (fwd.length < policy.minMatched3PrimeLength || rev.length < policy.minMatched3PrimeLength || tmpl.length === 0) return null;

  const validRange = (range: { start: number; end: number }) => (
    Number.isInteger(range.start)
    && Number.isInteger(range.end)
    && range.start >= 0
    && range.end > range.start
    && range.end <= tmpl.length
  );
  if (selectedBinding && (!validRange(selectedBinding.forward) || !validRange(selectedBinding.reverse))) return null;

  const rcTmpl = reverseComplement(tmpl);
  const forwardCandidates = selectedBinding
    ? [selectedBindingCandidate(tmpl, fwd, selectedBinding.forward, policy)].filter((candidate): candidate is PCRBindingCandidate => candidate !== null)
    : findPrimerBindings(tmpl, fwd, policy);
  const reverseRcCandidates = selectedBinding
    ? [selectedBindingCandidate(rcTmpl, rev, {
        start: tmpl.length - selectedBinding.reverse.end,
        end: tmpl.length - selectedBinding.reverse.start,
      }, policy)].filter((candidate): candidate is PCRBindingCandidate => candidate !== null)
    : findPrimerBindings(rcTmpl, rev, policy);
  if (forwardCandidates.length === 0 || reverseRcCandidates.length === 0) return null;

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
      if (templateProduct.length === 0 || templateProduct.length > MAX_PRODUCT_LENGTH) continue;
      const productInspection = inspectNucleotideSequence(templateProduct);
      const candidateStatus = bindingStatus(forward, reverse);
      products.push({
        forward,
        reverse,
        reverseRc,
        wrapsOrigin,
        templateProduct,
        productLength: templateProduct.length + forward.tail.length + reverse.tail.length,
        status: candidateStatus === 'exact' && productInspection.ambiguous ? 'ambiguous' : candidateStatus,
      });
    }
    if (productsTruncated) break;
  }
  if (products.length === 0) return null;
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
  const status: PCRBindingStatus = !selectedBinding && products.length > 1
    ? 'ambiguous'
    : bindingStatusForSelected;
  const warnings = productStatusWarnings(bindingStatusForSelected, selected.forward, selected.reverse);
  if (!selectedBinding && products.length > 1) {
    warnings.push(`${products.length} competing primer-binding product${products.length === 1 ? '' : 's'} satisfy the selected 3′-match policy; coordinates are reported instead of assuming the first site is intended.`);
  }
  if (!selectedBinding && forwardCandidates.length >= policy.maxBindingCandidates) {
    warnings.push(`Forward primer-site enumeration reached its cap of ${policy.maxBindingCandidates.toLocaleString()} candidates; the competing-product list may be incomplete.`);
  }
  if (!selectedBinding && reverseRcCandidates.length >= policy.maxBindingCandidates) {
    warnings.push(`Reverse primer-site enumeration reached its cap of ${policy.maxBindingCandidates.toLocaleString()} candidates; the competing-product list may be incomplete.`);
  }
  if (productsTruncated) warnings.push(`PCR product enumeration stopped at ${MAX_PRODUCT_COMBINATIONS.toLocaleString()} combinations; narrow the binding policy before treating the result as exhaustive.`);
  const fwdTail = selected.forward.tail;
  const revTailRC = selected.reverse.tail.length > 0 ? reverseComplement(selected.reverse.tail) : '';
  const product = fwdTail + selected.templateProduct + revTailRC;
  const sourceSpans: FeatureCoordinateMapSpan[] = selected.wrapsOrigin
    ? [
        { start: selected.forward.bindStart, end: tmpl.length, targetStart: fwdTail.length },
        { start: 0, end: selected.reverse.bindEnd, targetStart: fwdTail.length + (tmpl.length - selected.forward.bindStart) },
      ]
    : [{ start: selected.forward.bindStart, end: selected.reverse.bindEnd, targetStart: fwdTail.length }];
  const productFeatures = (features ?? [])
    .map((feature) => propagateFeature(feature, sourceSpans, tmpl.length, topology))
    .filter((feature): feature is Feature => feature !== null);
  const tmDifference = selectedForward.tm !== null && selectedReverse.tm !== null
    ? Math.abs(selectedForward.tm - selectedReverse.tm)
    : null;
  return {
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
    },
  };
}
