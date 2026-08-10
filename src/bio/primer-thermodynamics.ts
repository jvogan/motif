/**
 * Primer thermodynamics — hairpin + dimer ΔG prediction.
 *
 * Before this module, primer-design returned candidates
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

import { duplexThermodynamics } from './tm-calculator';
import { reverseComplement } from './reverse-complement';
import { inspectNucleotideSequence, isCanonicalDna } from './nucleotide';

/** Defaults — Primer3-compatible rejection thresholds. */
export const DEFAULT_MAX_HAIRPIN_DG = -3.0;
export const DEFAULT_MAX_DIMER_DG = -5.0;
const T37 = 310.15; // Kelvin

export interface HairpinResult {
  /** Best (most negative) ΔG37 found across all stem-loop alignments, kcal/mol. */
  deltaG: number;
  /** Length of the basepaired stem of the best hairpin. */
  stemLength: number;
  /** Number of unpaired bases in the loop. */
  loopSize: number;
  /** ASCII rendering of the hairpin structure. */
  structure: string;
  /** Exact sequence after formatting normalization; no bases are discarded. */
  evaluatedSequence: string;
  /** Ambiguity/invalid-input state for this heuristic diagnostic. */
  status: 'exact' | 'ambiguous' | 'invalid';
  warning?: string;
}

export interface DimerResult {
  /** Best (most negative) ΔG37 found across all duplex alignments, kcal/mol. */
  deltaG: number;
  /** Length of the basepaired duplex. */
  pairLength: number;
  /** Offset of primer2 relative to primer1 (negative shifts primer2 left). */
  offset: number;
  /** Number of paired bases touching each original primer's 3′ end. */
  threePrimeOverlap: { primer1: number; primer2: number };
  /** True when the strongest run reaches either extendable 3′ end. */
  threePrimeParticipation: 'none' | 'primer1' | 'primer2' | 'both';
  /** ASCII rendering of the duplex alignment. */
  structure: string;
  /** Exact sequence after formatting normalization; no bases are discarded. */
  evaluatedSequence: string;
  /** Ambiguity/invalid-input state for this heuristic diagnostic. */
  status: 'exact' | 'ambiguous' | 'invalid';
  warning?: string;
}

function inspectedThermoSequence(primer: string): {
  sequence: string;
  status: 'exact' | 'ambiguous' | 'invalid';
  warning?: string;
} {
  const inspected = inspectNucleotideSequence(primer);
  if (inspected.invalidCharacters.length > 0) {
    return {
      sequence: inspected.sequence,
      status: 'invalid',
      warning: `Secondary-structure diagnostics require nucleotide characters only; invalid input: ${inspected.invalidCharacters.join(', ')}.`,
    };
  }
  if (inspected.sequence.length === 0) {
    return {
      sequence: inspected.sequence,
      status: 'invalid',
      warning: 'Secondary-structure diagnostics require a non-empty oligo.',
    };
  }
  if (inspected.ambiguous) {
    return {
      sequence: inspected.sequence,
      status: 'ambiguous',
      warning: 'Secondary-structure diagnostics were not evaluated exactly because the oligo contains IUPAC ambiguity symbols.',
    };
  }
  return { sequence: inspected.sequence, status: 'exact' };
}

/** Compute ΔG37 (kcal/mol) for a Watson-Crick duplex from its 5′→3′ top strand. */
function nnDeltaG(topStrand: string): number {
  const upper = topStrand.toUpperCase();
  if (upper.length < 2) return 0;
  const { deltaH, deltaS } = duplexThermodynamics(upper);
  // ΔG(T) = ΔH − T·ΔS. The shared calculator applies the sequence-specific
  // terminal initiation terms used by duplex Tm, keeping hairpin/dimer scores
  // on the same thermodynamic basis.
  return deltaH / 1000 - (T37 * deltaS) / 1000;
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
  const inspected = inspectedThermoSequence(primer);
  const seq = inspected.sequence;
  const n = seq.length;
  let best: HairpinResult = {
    deltaG: 0,
    stemLength: 0,
    loopSize: 0,
    structure: '',
    evaluatedSequence: seq,
    status: inspected.status,
    ...(inspected.warning ? { warning: inspected.warning } : {}),
  };
  if (inspected.status !== 'exact' || !isCanonicalDna(seq) || n < 8) return best;

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
            evaluatedSequence: seq,
            status: 'exact',
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
  const inspectedA = inspectedThermoSequence(p1);
  const inspectedB = inspectedThermoSequence(p2);
  const a = inspectedA.sequence;
  const b = inspectedB.sequence;
  const status = inspectedA.status === 'invalid' || inspectedB.status === 'invalid'
    ? 'invalid'
    : inspectedA.status === 'ambiguous' || inspectedB.status === 'ambiguous'
      ? 'ambiguous'
      : 'exact';
  const warning = inspectedA.warning ?? inspectedB.warning;
  let best: DimerResult = {
    deltaG: 0,
    pairLength: 0,
    offset: 0,
    threePrimeOverlap: { primer1: 0, primer2: 0 },
    threePrimeParticipation: 'none',
    structure: '',
    evaluatedSequence: `${a}|${b}`,
    status,
    ...(warning ? { warning } : {}),
  };
  if (status !== 'exact' || !isCanonicalDna(a) || !isCanonicalDna(b) || a.length < 3 || b.length < 3) return best;

  // The dimer alignment is p1 (5′→3′ top) vs p2 reverse-complement aligned at offset.
  const b_rc = reverseComplement(b);

  // For each relative offset between [-len(b_rc)+1, len(a)-1], evaluate every
  // maximal contiguous Watson-Crick run. A shorter GC-rich run at one offset
  // can be more stable than a longer AT-rich run at the same offset.
  for (let offset = -(b_rc.length - 1); offset < a.length; offset++) {
    let runStart = -1;
    const evaluateRun = (start: number, length: number): void => {
      if (start < 0 || length < 3) return;
      const matched = a.slice(start, start + length);
      const deltaG = Math.round(nnDeltaG(matched) * 100) / 100;
      const matchedEnd = start + length;
      const bRunStart = start + offset;
      // Participation means the duplex reaches the actual terminal 3′ base;
      // the overlap count is capped at the five terminal bases for ranking.
      const primer1ThreePrime = matchedEnd === a.length ? Math.min(length, 5) : 0;
      const primer2ThreePrime = bRunStart === 0 ? Math.min(length, 5) : 0;
      const participation: DimerResult['threePrimeParticipation'] = primer1ThreePrime > 0 && primer2ThreePrime > 0
        ? 'both'
        : primer1ThreePrime > 0
          ? 'primer1'
          : primer2ThreePrime > 0
            ? 'primer2'
            : 'none';
      const terminalBases = primer1ThreePrime + primer2ThreePrime;
      const bestTerminalBases = best.threePrimeOverlap.primer1 + best.threePrimeOverlap.primer2;
      const shouldReplace = deltaG < best.deltaG
        || (deltaG === best.deltaG && (
          terminalBases > bestTerminalBases
          || (terminalBases === bestTerminalBases && length > best.pairLength)
        ));
      if (!shouldReplace) return;
      best = {
        deltaG,
        pairLength: length,
        offset,
        threePrimeOverlap: { primer1: primer1ThreePrime, primer2: primer2ThreePrime },
        threePrimeParticipation: participation,
        structure: `5'-${matched}-3' (${length} bp duplex, offset ${offset})`,
        evaluatedSequence: `${a}|${b}`,
        status: 'exact',
      };
    };
    for (let i = Math.max(0, -offset); i < Math.min(a.length, b_rc.length - offset); i++) {
      const ai = a[i];
      const bi = b_rc[i + offset];
      if (ai === bi) {
        if (runStart === -1) runStart = i;
      } else {
        evaluateRun(runStart, runStart === -1 ? 0 : i - runStart);
        runStart = -1;
      }
    }
    const runEnd = Math.min(a.length, b_rc.length - offset);
    evaluateRun(runStart, runStart === -1 ? 0 : runEnd - runStart);
  }
  return best;
}

/** Convenience: predict self-dimer for a single primer. */
export function predictSelfDimer(primer: string): DimerResult {
  return predictPrimerDimer(primer, primer);
}
