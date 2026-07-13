/**
 * Primer thermodynamics — hairpin + dimer ΔG prediction.
 *
 * Phase 35 P0-A4: prior to this module, primer-design returned candidates
 * that could form strong self/hetero-duplexes silently. A perfectly matched
 * inverse-complement primer pair (e.g. F=CGCTCGGTACG + R=CGTACCGAGCG)
 * passes GC / Tm / clamp filters and ranks at the top — but in PCR forms a
 * dominant primer-dimer band that swamps the real product.
 *
 * This module provides:
 *   - `predictHairpin(primer, opts)`   — best self-complementary stem-loop ΔG
 *   - `predictPrimerDimer(p1, p2, opts) — best inter-primer / self-dimer ΔG
 *
 * Both functions use SantaLucia 1998 nearest-neighbor ΔG tables (already
 * present in `tm-calculator.ts`) — they're approximate first-order ΔG
 * estimates suitable for filtering candidates, NOT a substitute for UNAFold
 * or RNAfold. The thresholds:
 *
 *   Hairpin ΔG < -3 kcal/mol  → reject (Primer3 default)
 *   Dimer    ΔG < -5 kcal/mol  → reject (Primer3 default)
 *
 * are widely-published heuristic cutoffs. Tighter values (e.g. -2 / -3)
 * produce overly-strict screening; looser values (-8 / -10) miss real
 * problems.
 */

import { NN_PARAMS } from './tm-calculator';
import { reverseComplement } from './reverse-complement';

/** Defaults — Primer3-compatible rejection thresholds. */
export const DEFAULT_MAX_HAIRPIN_DG = -3.0;
export const DEFAULT_MAX_DIMER_DG = -5.0;
const T37 = 310.15; // Kelvin

/** Initiation parameters per terminal base-pair, SantaLucia 1998. */
const INIT_H = 0.1;   // kcal/mol
const INIT_S = -2.8;  // cal/mol·K

export interface HairpinResult {
  /** Best (most negative) ΔG37 found across all stem-loop alignments, kcal/mol. */
  deltaG: number;
  /** Length of the basepaired stem of the best hairpin. */
  stemLength: number;
  /** Number of unpaired bases in the loop. */
  loopSize: number;
  /** ASCII rendering of the hairpin structure. */
  structure: string;
}

export interface DimerResult {
  /** Best (most negative) ΔG37 found across all duplex alignments, kcal/mol. */
  deltaG: number;
  /** Length of the basepaired duplex. */
  pairLength: number;
  /** Offset of primer2 relative to primer1 (negative shifts primer2 left). */
  offset: number;
  /** ASCII rendering of the duplex alignment. */
  structure: string;
}

/** Compute ΔG37 (kcal/mol) for a Watson-Crick duplex from its 5′→3′ top strand. */
function nnDeltaG(topStrand: string): number {
  const upper = topStrand.toUpperCase();
  if (upper.length < 2) return 0;
  // 2 terminal initiations (assumed AT for simplicity — Primer3 also approximates).
  // ΔH in kcal/mol; ΔS accumulated in cal/mol·K then converted at the ΔG step.
  let dH = 2 * INIT_H;
  let dS_cal = 2 * INIT_S;
  for (let i = 0; i < upper.length - 1; i++) {
    const dinuc = upper[i] + upper[i + 1];
    const params = NN_PARAMS[dinuc];
    if (!params) {
      // Unknown dinucleotide — degenerate base; skip.
      continue;
    }
    dH += params.dH;        // kcal/mol
    dS_cal += params.dS;    // cal/mol·K
  }
  // ΔG(T) = ΔH − T·ΔS  (kcal/mol); ΔS in kcal/mol·K = dS_cal / 1000.
  return dH - (T37 * dS_cal) / 1000;
}

/**
 * Predict the most stable hairpin for a primer.
 *
 * Method: scan every contiguous internal stem-loop fold where bases
 * [i .. i+stemLen-1] (5′ arm) Watson-Crick pair with bases reversed from
 * the 3′ arm, separated by a loop of ≥3 unpaired bases. ΔG of the resulting
 * duplex stem is estimated from the SantaLucia nearest-neighbor table.
 *
 * Returns the most-negative ΔG found. A primer with no stem of length ≥3
 * returns ΔG = 0 (no hairpin penalty).
 */
export function predictHairpin(primer: string): HairpinResult {
  const seq = primer.toUpperCase().replace(/U/g, 'T').replace(/[^ATGC]/g, '');
  const n = seq.length;
  let best: HairpinResult = {
    deltaG: 0,
    stemLength: 0,
    loopSize: 0,
    structure: '',
  };
  if (n < 8) return best; // need stem ≥3 + loop ≥3 + stem ≥3 → ≥9 nt minimum (allow 8 with very short loop)

  const MIN_LOOP = 3;
  const MIN_STEM = 3;

  for (let i = 0; i + 2 * MIN_STEM + MIN_LOOP <= n; i++) {
    for (let stemLen = MIN_STEM; i + stemLen + MIN_LOOP + stemLen <= n; stemLen++) {
      for (let loopSize = MIN_LOOP; i + stemLen + loopSize + stemLen <= n; loopSize++) {
        const left = seq.slice(i, i + stemLen);
        const right = seq.slice(i + stemLen + loopSize, i + stemLen + loopSize + stemLen);
        const rightRevComp = reverseComplement(right);
        if (left !== rightRevComp) continue;
        // Compute ΔG of the stem (treat as a perfect duplex of length stemLen)
        const dG = nnDeltaG(left);
        if (dG < best.deltaG) {
          const dots = '.'.repeat(loopSize);
          best = {
            deltaG: Math.round(dG * 100) / 100,
            stemLength: stemLen,
            loopSize,
            structure: `5'-${left}-${dots}-${right}-3'`,
          };
        }
      }
    }
  }

  return best;
}

/**
 * Predict the most stable inter-primer (or self-) dimer between two primers.
 *
 * Method: enumerate every relative offset where primer1 5′→3′ overlaps the
 * reverse-complement of primer2 by ≥3 contiguous Watson-Crick base pairs;
 * compute the ΔG of the resulting duplex stretch. Return the most-negative
 * ΔG. Self-dimer: pass the same primer for both arguments.
 *
 * For the dimer to matter biologically, the duplex region SHOULD include the
 * 3′ end of at least one primer (because the polymerase extends from 3′
 * ends). We compute ΔG over the contiguous match — UI can additionally show
 * "3′-end overlap" as a flag.
 */
export function predictPrimerDimer(p1: string, p2: string): DimerResult {
  const a = p1.toUpperCase().replace(/U/g, 'T').replace(/[^ATGC]/g, '');
  const b = p2.toUpperCase().replace(/U/g, 'T').replace(/[^ATGC]/g, '');
  let best: DimerResult = {
    deltaG: 0,
    pairLength: 0,
    offset: 0,
    structure: '',
  };
  if (a.length < 3 || b.length < 3) return best;

  // The dimer alignment is p1 (5′→3′ top) vs p2 reverse-complement aligned at offset.
  const b_rc = reverseComplement(b);

  // For each relative offset between [-len(b_rc)+1, len(a)-1], find the
  // longest contiguous WC match.
  for (let offset = -(b_rc.length - 1); offset < a.length; offset++) {
    let runStart = -1;
    let runLen = 0;
    let bestRunLen = 0;
    let bestRunStart = -1;
    for (let i = Math.max(0, -offset); i < Math.min(a.length, b_rc.length - offset); i++) {
      const ai = a[i];
      const bi = b_rc[i + offset];
      if (ai === bi) {
        if (runLen === 0) runStart = i;
        runLen++;
        if (runLen > bestRunLen) {
          bestRunLen = runLen;
          bestRunStart = runStart;
        }
      } else {
        runLen = 0;
      }
    }
    if (bestRunLen >= 3 && bestRunStart >= 0) {
      const matched = a.slice(bestRunStart, bestRunStart + bestRunLen);
      const dG = nnDeltaG(matched);
      if (dG < best.deltaG) {
        best = {
          deltaG: Math.round(dG * 100) / 100,
          pairLength: bestRunLen,
          offset,
          structure: `5'-${matched}-3' (${bestRunLen} bp duplex, offset ${offset})`,
        };
      }
    }
  }
  return best;
}

/** Convenience: predict self-dimer for a single primer. */
export function predictSelfDimer(primer: string): DimerResult {
  return predictPrimerDimer(primer, primer);
}
