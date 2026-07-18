import { reverseComplement } from './reverse-complement';
import { gcContent } from './gc-content';
import { calculateTm } from './tm-calculator';
import { DEFAULT_TM_OPTIONS } from './primer-design';
import type { Feature, Topology } from './types';
import { remapFeatureLocation, type FeatureCoordinateMapSpan } from './feature-location';

/**
 * Primer Tm for the PCR engine, computed with the SAME nearest-neighbor model +
 * PCR-buffer conditions the PrimerDesignDialog uses (calculateTm /
 * DEFAULT_TM_OPTIONS). Previously this path used the simple Wallace
 * `meltingTemperature`, which diverged from the primer designer by up to ~9°C
 * for 14–60 nt primers — so a primer designed at one Tm read a different Tm in
 * PCR Simulate. Returns null for an empty/invalid binding sequence to preserve
 * the existing `number | null` contract. (QA2 W22, primer/PCR agent F1.)
 * NOTE: the whole-block Inspector/BlockStatsRow Tm intentionally stays on the
 * simpler Wallace estimate — it is a different, longer-sequence quantity.
 */
function primerBindingTm(seq: string): number | null {
  const result = calculateTm(seq, DEFAULT_TM_OPTIONS);
  return result.method === 'none' ? null : result.tm;
}

/** Minimum number of 3' bases that must match the template */
const MIN_BINDING = 10;

export interface PCRPrimerBinding {
  /** 0-indexed start position on template (forward strand coordinates) */
  bindStart: number;
  /** 0-indexed exclusive end position on template (forward strand coordinates) */
  bindEnd: number;
  /** The binding region sequence (5'→3' of primer, matches template strand for fwd, RC of template for rev) */
  bindingSequence: string;
  /** 5' tail that extends beyond the template (empty string if none) */
  tail: string;
  /** Melting temperature of the binding region only */
  tm: number | null;
  /** GC% of the binding region */
  gcPercent: number;
}

export interface PCRResult {
  /** Full product sequence including any primer tails */
  product: string;
  productLength: number;
  /** Template region between (and including) primer binding sites */
  templateProduct: string;
  forward: PCRPrimerBinding;
  reverse: PCRPrimerBinding;
  /** ΔTm between forward and reverse binding regions */
  tmDifference: number | null;
  /** GC% of the full product */
  gcPercent: number;
  /** Features from template that fall within the amplified region, offset to product coordinates */
  features: Feature[];
  /** True when a circular-template amplicon crosses coordinate 0. */
  wrapsOrigin: boolean;
}

/** Optional exact primer binding coordinates selected by a primer-design UI. */
export interface PCRBindingSelection {
  forward: { start: number; end: number };
  reverse: { start: number; end: number };
}

function propagateFeature(
  feature: Feature,
  sourceSpans: readonly FeatureCoordinateMapSpan[],
): Feature | null {
  const location = remapFeatureLocation(feature, sourceSpans);
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
    },
  };
}

/**
 * Find where a primer binds to a sequence strand.
 * Progressively trims from the 5' end to find the longest 3' suffix that
 * appears exactly in the template. Returns null if no match >= MIN_BINDING.
 *
 * @param template - The strand to search on (uppercase, ACGT only)
 * @param primer   - The primer sequence (uppercase, ACGT only)
 * @returns { pos, bindLength } where pos is the 0-indexed start in template
 */
function findPrimerOnStrand(
  template: string,
  primer: string,
  preferredStart?: number,
  preferredBindLength?: number,
): { pos: number; bindLength: number } | null {
  if (primer.length < MIN_BINDING) return null;

  if (preferredStart !== undefined || preferredBindLength !== undefined) {
    if (
      preferredStart === undefined
      || preferredBindLength === undefined
      || preferredBindLength < MIN_BINDING
      || preferredBindLength > primer.length
    ) return null;
    const binding = primer.slice(primer.length - preferredBindLength);
    return template.startsWith(binding, preferredStart)
      ? { pos: preferredStart, bindLength: preferredBindLength }
      : null;
  }

  // Try full primer first, then progressively remove from 5' end
  for (let trimmed = 0; trimmed <= primer.length - MIN_BINDING; trimmed++) {
    const binding = primer.slice(trimmed);
    const idx = template.indexOf(binding);
    if (idx !== -1) {
      return { pos: idx, bindLength: binding.length };
    }
  }

  return null;
}

/**
 * Simulate a PCR amplification.
 *
 * The forward primer is searched on the forward strand; the reverse primer is
 * searched on the reverse-complement strand (converted back to template coords).
 * Primer tails (5' extensions not matching the template) are incorporated into
 * the product sequence exactly as in a real PCR reaction.
 *
 * On a circular template a product may wrap across the origin (position 0):
 * the forward primer binds near the 3' end and the reverse primer near the 5'
 * start, so the amplicon runs off the end, over the origin, and back. Pass
 * `topology: 'circular'` to allow that; the default is 'linear' (origin-flanking
 * primers on a linear template return null, as a real reaction would).
 *
 * @param template       - Template DNA sequence (any case, non-ACGT stripped)
 * @param forwardPrimer  - Forward primer sequence 5'→3' (any case, non-ACGT stripped)
 * @param reversePrimer  - Reverse primer sequence 5'→3' (any case, non-ACGT stripped)
 * @param features       - Optional template features to propagate into the product
 * @param topology       - Template topology; 'circular' enables origin-wrapping products
 * @param selectedBinding - Optional exact forward-strand coordinates selected by primer design
 * @returns PCRResult or null if no product would be amplified
 */
export function simulatePCR(
  template: string,
  forwardPrimer: string,
  reversePrimer: string,
  features?: Feature[],
  topology: Topology = 'linear',
  selectedBinding?: PCRBindingSelection,
): PCRResult | null {
  const tmpl = template.toUpperCase().replace(/[^ACGT]/g, '');
  const fwd = forwardPrimer.toUpperCase().replace(/[^ACGT]/g, '');
  const rev = reversePrimer.toUpperCase().replace(/[^ACGT]/g, '');

  if (fwd.length < MIN_BINDING || rev.length < MIN_BINDING) return null;
  if (tmpl.length === 0) return null;
  if (selectedBinding) {
    const validRange = ({ start, end }: { start: number; end: number }) => (
      Number.isInteger(start)
      && Number.isInteger(end)
      && start >= 0
      && end > start
      && end <= tmpl.length
    );
    if (!validRange(selectedBinding.forward) || !validRange(selectedBinding.reverse)) return null;
  }

  // ── Forward primer ──────────────────────────────────────────────
  const fwdMatch = findPrimerOnStrand(
    tmpl,
    fwd,
    selectedBinding?.forward.start,
    selectedBinding ? selectedBinding.forward.end - selectedBinding.forward.start : undefined,
  );
  if (!fwdMatch) return null;
  if (selectedBinding && fwdMatch.pos + fwdMatch.bindLength !== selectedBinding.forward.end) return null;

  const fwdTailLen = fwd.length - fwdMatch.bindLength;
  const fwdTail = fwd.slice(0, fwdTailLen);
  const fwdBindingSeq = fwd.slice(fwdTailLen); // = tmpl.slice(fwdMatch.pos, fwdMatch.pos + fwdMatch.bindLength)

  // ── Reverse primer (searches RC strand) ─────────────────────────
  const rcTmpl = reverseComplement(tmpl);
  const N = tmpl.length;
  const selectedReverseRcStart = selectedBinding
    ? N - selectedBinding.reverse.end
    : undefined;
  const revMatch = findPrimerOnStrand(
    rcTmpl,
    rev,
    selectedReverseRcStart,
    selectedBinding ? selectedBinding.reverse.end - selectedBinding.reverse.start : undefined,
  );
  if (!revMatch) return null;

  // Convert RC strand coordinates → template coordinates
  // RC position [pos, pos+len) → template [N-pos-len, N-pos)
  const revBindEnd = N - revMatch.pos;          // exclusive end on template
  const revBindStart = N - revMatch.pos - revMatch.bindLength; // inclusive start on template
  if (selectedBinding && (
    revBindStart !== selectedBinding.reverse.start
    || revBindEnd !== selectedBinding.reverse.end
  )) return null;

  const revTailLen = rev.length - revMatch.bindLength;
  const revTail = rev.slice(0, revTailLen);
  const revBindingSeq = rev.slice(revTailLen);

  // ── Orientation check ───────────────────────────────────────────
  // Forward primer start must be upstream of reverse primer end. When the
  // reverse end is at/behind the forward start the linear orientation fails —
  // on a CIRCULAR template that is not "no product" but an amplicon that wraps
  // across the origin (position 0); on a linear template it is genuinely null.
  const wraps = revBindEnd <= fwdMatch.pos;
  if (wraps && topology !== 'circular') return null;

  // ── Build product ───────────────────────────────────────────────
  // Product = [fwd tail] + template[fwdStart..revEnd] + RC([rev tail]).
  // For a circular wrap the template region runs off the 3' end, over the
  // origin, and back to revBindEnd — equivalent to slicing a doubled template
  // (tmpl + tmpl). The wrapped span is (N - fwdMatch.pos) + revBindEnd, which
  // is always <= N: you can never amplify more than the whole plasmid once.
  const templateProduct = wraps
    ? tmpl.slice(fwdMatch.pos) + tmpl.slice(0, revBindEnd)
    : tmpl.slice(fwdMatch.pos, revBindEnd);

  // Product must not be absurdly long (safety cap at 50 kb)
  if (templateProduct.length > 50_000) return null;

  const revTailRC = revTail.length > 0 ? reverseComplement(revTail) : '';
  const product = fwdTail + templateProduct + revTailRC;

  // ── Tm and GC stats ─────────────────────────────────────────────
  const fwdTm = primerBindingTm(fwdBindingSeq);
  const revTm = primerBindingTm(revBindingSeq);
  const tmDifference =
    fwdTm !== null && revTm !== null ? Math.abs(fwdTm - revTm) : null;

  // ── Feature propagation ──────────────────────────────────────────
  // Features within the amplified template region are carried over, offset
  // into product coordinates by the forward tail length and template start.
  const productFeatures: Feature[] = [];
  if (features && features.length > 0) {
    const sourceSpans: FeatureCoordinateMapSpan[] = !wraps
      ? [{ start: fwdMatch.pos, end: revBindEnd, targetStart: fwdTailLen }]
      : [
          { start: fwdMatch.pos, end: N, targetStart: fwdTailLen },
          { start: 0, end: revBindEnd, targetStart: fwdTailLen + (N - fwdMatch.pos) },
        ];
    for (const feature of features) {
      const propagated = propagateFeature(feature, sourceSpans);
      if (propagated) productFeatures.push(propagated);
    }
  }

  return {
    product,
    productLength: product.length,
    templateProduct,
    forward: {
      bindStart: fwdMatch.pos,
      bindEnd: fwdMatch.pos + fwdMatch.bindLength,
      bindingSequence: fwdBindingSeq,
      tail: fwdTail,
      tm: fwdTm,
      gcPercent: gcContent(fwdBindingSeq) * 100,
    },
    // Binding coords stay in the ORIGINAL [0, N) template space. For a circular
    // wrap revBindEnd is numerically <= the forward bindStart (the reverse site
    // sits past the origin) — that ordering is correct, not a bug.
    reverse: {
      bindStart: revBindStart,
      bindEnd: revBindEnd,
      bindingSequence: revBindingSeq,
      tail: revTail,
      tm: revTm,
      gcPercent: gcContent(revBindingSeq) * 100,
    },
    tmDifference,
    gcPercent: gcContent(product) * 100,
    features: productFeatures,
    wrapsOrigin: wraps,
  };
}
