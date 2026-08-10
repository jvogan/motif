import type { NucleotideComposition } from './types';

/**
 * Count nucleotide composition of a DNA/RNA sequence.
 */
export function nucleotideComposition(seq: string): NucleotideComposition {
  const comp: NucleotideComposition = { A: 0, T: 0, U: 0, G: 0, C: 0, N: 0, other: 0 };
  const upper = seq.toUpperCase();

  for (const ch of upper) {
    switch (ch) {
      case 'A': comp.A++; break;
      case 'T': comp.T++; break;
      case 'U': comp.U = (comp.U ?? 0) + 1; break;
      case 'G': comp.G++; break;
      case 'C': comp.C++; break;
      case 'N': comp.N++; break;
      default: comp.other++; break;
    }
  }

  return comp;
}

/**
 * Calculate GC content as a fraction (0-1).
 */
export function gcContent(seq: string): number {
  const comp = nucleotideComposition(seq);
  return gcContentFromComposition(comp);
}

/**
 * Calculate GC content as a fraction (0-1) from a pre-computed
 * NucleotideComposition. Same math as `gcContent(seq)` but skips re-scanning
 * the sequence — used by callers that already memoize composition once and
 * derive multiple downstream metrics from it.
 */
export function gcContentFromComposition(comp: NucleotideComposition): number {
  const total = comp.A + comp.T + (comp.U ?? 0) + comp.G + comp.C;
  if (total === 0) return 0;
  return (comp.G + comp.C) / total;
}

/**
 * Calculate AT content as a fraction (0-1).
 */
export function atContent(seq: string): number {
  const comp = nucleotideComposition(seq);
  const total = comp.A + comp.T + (comp.U ?? 0) + comp.G + comp.C;
  if (total === 0) return 0;
  return (comp.A + comp.T + (comp.U ?? 0)) / total;
}

/**
 * Calculate GC content in a sliding window.
 * @param seq - DNA sequence
 * @param windowSize - Window size in bases (default 100)
 * @param step - Step size (default 1)
 * @returns Array of { position, gc } objects
 */
export function gcContentWindow(
  seq: string,
  windowSize = 100,
  step = 1,
): Array<{ position: number; gc: number }> {
  const results: Array<{ position: number; gc: number }> = [];
  const upper = seq.toUpperCase();

  if (!Number.isInteger(windowSize) || windowSize <= 0) {
    throw new Error('windowSize must be a positive integer.');
  }
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error('step must be a positive integer.');
  }

  if (upper.length < windowSize) {
    return [{ position: 0, gc: gcContent(upper) }];
  }

  const gcPrefix = new Uint32Array(upper.length + 1);
  const validPrefix = new Uint32Array(upper.length + 1);
  for (let i = 0; i < upper.length; i += 1) {
    const ch = upper.charCodeAt(i);
    const isGc = ch === 71 || ch === 67; // G or C
    const isValid = isGc || ch === 65 || ch === 84 || ch === 85; // A, T, U
    gcPrefix[i + 1] = gcPrefix[i] + (isGc ? 1 : 0);
    validPrefix[i + 1] = validPrefix[i] + (isValid ? 1 : 0);
  }

  for (let i = 0; i <= upper.length - windowSize; i += step) {
    const end = i + windowSize;
    const gc = gcPrefix[end] - gcPrefix[i];
    const valid = validPrefix[end] - validPrefix[i];
    results.push({ position: i, gc: valid > 0 ? gc / valid : 0 });
  }

  return results;
}

/**
 * Average and monoisotopic masses for deoxyribonucleotide monophosphates.
 * A phosphodiester chain is formed by removing one water molecule per bond;
 * this basis therefore supports both end chemistries without double-counting
 * polymerization loss. Values agree with the published nucleotide tables in
 * Thermo Fisher's DNA/RNA molecular-weight reference. See
 * https://www.thermofisher.com/us/en/home/references/
 * ambion-tech-support/rna-tools-and-calculators/dna-and-rna-molecular-weights-
 * and-conversions.html.
 */
const DNA_NMP_MASS_AVERAGE: Record<string, number> = {
  A: 331.2218,
  C: 307.1971,
  G: 347.2212,
  T: 322.2085,
};

const DNA_NMP_MASS_MONOISOTOPIC: Record<string, number> = {
  A: 331.06817,
  C: 307.056936,
  G: 347.063084,
  T: 322.056602,
};

const DNA_AMBIGUOUS_BASES: Record<string, string> = {
  R: 'AG',
  Y: 'CT',
  S: 'GC',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
};

export type DnaMolecularWeightMode = 'average' | 'monoisotopic';
export type DnaEndChemistry = 'hydroxyl' | 'phosphate';
export type DnaTopology = 'linear' | 'circular';
export type DnaAmbiguityPolicy = 'reject' | 'average';

export interface DnaMolecularWeightOptions {
  /** Average (default) or isotope-resolved mass. */
  mode?: DnaMolecularWeightMode;
  /** 5′ terminal chemistry; default preserves the restriction-fragment UI convention. */
  fivePrime?: DnaEndChemistry;
  /** 3′ terminal chemistry; default is a free hydroxyl. */
  threePrime?: DnaEndChemistry;
  /** Linear chain (default) or a covalently closed circular strand. */
  topology?: DnaTopology;
  /** Reject IUPAC ambiguity by default, or average supported expansions. */
  ambiguity?: DnaAmbiguityPolicy;
}

export interface DnaMolecularWeightResult {
  mass: number | null;
  status: 'exact' | 'ambiguous' | 'invalid';
  sequence: string;
  message?: string;
}

/**
 * Safe defaults for the sequence UI: average mass, linear strand, a 5′
 * monophosphate (as left by many restriction enzymes), and a 3′ hydroxyl.
 * Callers ordering synthetic primers should select `fivePrime: 'hydroxyl'`.
 */
export const DNA_MOLECULAR_WEIGHT_UI_DEFAULTS: Required<Omit<DnaMolecularWeightOptions, 'ambiguity'>> & {
  ambiguity: DnaAmbiguityPolicy;
} = {
  mode: 'average',
  fivePrime: 'phosphate',
  threePrime: 'hydroxyl',
  topology: 'linear',
  ambiguity: 'reject',
};

const PHOSPHATE_DELTA_AVERAGE = 79.9663;
const PHOSPHATE_DELTA_MONOISOTOPIC = 79.966331;
const WATER_AVERAGE = 18.0153;
const WATER_MONOISOTOPIC = 18.010565;

function roundedMass(mass: number): number {
  return Math.round(mass * 100) / 100;
}

/**
 * Return a qualified mass result. Ambiguous bases are never silently treated
 * as a generic N: use `ambiguity: 'average'` to request the mean of their
 * supported IUPAC expansions.
 */
export function calculateDnaMolecularWeight(
  seq: string,
  options: DnaMolecularWeightOptions = {},
): DnaMolecularWeightResult {
  const normalized = seq.toUpperCase().replace(/[ \t\r\n]/g, '').replace(/U/g, 'T');
  const mode = options.mode ?? DNA_MOLECULAR_WEIGHT_UI_DEFAULTS.mode;
  const fivePrime = options.fivePrime ?? DNA_MOLECULAR_WEIGHT_UI_DEFAULTS.fivePrime;
  const threePrime = options.threePrime ?? DNA_MOLECULAR_WEIGHT_UI_DEFAULTS.threePrime;
  const topology = options.topology ?? DNA_MOLECULAR_WEIGHT_UI_DEFAULTS.topology;
  const ambiguity = options.ambiguity ?? DNA_MOLECULAR_WEIGHT_UI_DEFAULTS.ambiguity;
  if (!['average', 'monoisotopic'].includes(mode)) {
    return { mass: null, status: 'invalid', sequence: normalized, message: `Unsupported DNA mass mode: ${String(mode)}.` };
  }
  if (!['hydroxyl', 'phosphate'].includes(fivePrime) || !['hydroxyl', 'phosphate'].includes(threePrime)) {
    return { mass: null, status: 'invalid', sequence: normalized, message: 'DNA terminal chemistry must be hydroxyl or phosphate.' };
  }
  if (topology !== 'linear' && topology !== 'circular') {
    return { mass: null, status: 'invalid', sequence: normalized, message: 'DNA topology must be linear or circular.' };
  }
  if (ambiguity !== 'reject' && ambiguity !== 'average') {
    return { mass: null, status: 'invalid', sequence: normalized, message: 'DNA ambiguity policy must be reject or average.' };
  }
  const table = mode === 'monoisotopic' ? DNA_NMP_MASS_MONOISOTOPIC : DNA_NMP_MASS_AVERAGE;
  const water = mode === 'monoisotopic' ? WATER_MONOISOTOPIC : WATER_AVERAGE;
  const phosphateDelta = mode === 'monoisotopic' ? PHOSPHATE_DELTA_MONOISOTOPIC : PHOSPHATE_DELTA_AVERAGE;
  const values: number[] = [];
  let hasAmbiguity = false;
  for (const ch of normalized) {
    if (table[ch] !== undefined) {
      values.push(table[ch]);
      continue;
    }
    const expansion = DNA_AMBIGUOUS_BASES[ch];
    if (!expansion) {
      return { mass: null, status: 'invalid', sequence: normalized, message: `Unsupported DNA base: ${ch}.` };
    }
    hasAmbiguity = true;
    if (ambiguity === 'reject') {
      return {
        mass: null,
        status: 'ambiguous',
        sequence: normalized,
        message: `DNA mass was not evaluated exactly because the sequence contains IUPAC ambiguity symbol ${ch}.`,
      };
    }
    values.push([...expansion].reduce((sum, base) => sum + table[base], 0) / expansion.length);
  }

  if (values.length === 0) {
    return { mass: 0, status: 'exact', sequence: normalized };
  }

  let mass = values.reduce((sum, value) => sum + value, 0);
  if (topology === 'circular') {
    // A closed strand has one phosphodiester bond per nucleotide and no end
    // groups. End-chemistry options are intentionally ignored in this state.
    mass -= values.length * water;
  } else {
    mass -= (values.length - 1) * water;
    // The monophosphate basis describes 5′-phosphate / 3′-hydroxyl ends.
    if (fivePrime === 'hydroxyl') mass -= phosphateDelta;
    if (threePrime === 'phosphate') mass += phosphateDelta;
  }
  return {
    mass: roundedMass(mass),
    status: hasAmbiguity ? 'ambiguous' : 'exact',
    sequence: normalized,
    ...(hasAmbiguity ? { message: 'Mass is an average over the supported IUPAC expansions; it is not an exact molecular composition.' } : {}),
  };
}

/**
 * Estimate the mass of a single-stranded DNA molecule in Daltons. The default
 * is the documented UI convention in `DNA_MOLECULAR_WEIGHT_UI_DEFAULTS`.
 * Ambiguous inputs throw unless callers explicitly request `ambiguity:'average'`.
 */
export function molecularWeight(
  seq: string,
  options: DnaMolecularWeightOptions = {},
): number {
  const result = calculateDnaMolecularWeight(seq, options);
  if (result.mass === null || (result.status === 'ambiguous' && options.ambiguity !== 'average')) {
    throw new RangeError(result.message ?? 'DNA molecular weight could not be evaluated exactly.');
  }
  return result.mass;
}

/**
 * Estimate melting temperature (Tm) of a DNA oligo.
 * - For sequences <= 20 bp: Wallace rule Tm = 2*(A+T) + 4*(G+C)
 * - For longer sequences: basic salt-adjusted formula
 *   Tm = 64.9 + 41*(G+C - 16.4) / (A+T+G+C)
 */
// ── AA residue masses ────────────────────────────────────────────────────────
//
// The table is split into average and monoisotopic residue masses because the
// earlier documentation called monoisotopic values "Average molecular weights".
// Sum-of-20 residues
// was 2394.12 Da versus ExPASy's 2395.65 Da (average) and 2394.05 Da
// (monoisotopic). We now ship BOTH tables and let callers choose. Default
// is `'average'` to match ExPASy ProtParam — the canonical reference.
//
// Sources:
//   - Average:     ExPASy ProtParam / UniProt help (residue mass = aa
//                  amino acid mass − H2O). https://www.uniprot.org/help/extinction_coefficient
//   - Monoisotopic: NIST atomic mass tables + same residue rule.
//
// Sums of the 20 residue masses below (no water — residue masses, not chain MW):
//   Average:      2377.737 Da  (+H2O 18.015  = 2395.752 for a 1-of-each 20-mer)
//   Monoisotopic: 2376.114 Da  (+H2O 18.0106 = 2394.125)
// Earlier summary values (2395.652 / 2394.057) conflated the +water chain MW
// with residue sums and were slightly off. The residue tables are correct;
// this distinction affects documentation only.

/** Average residue masses, Daltons. Source: ExPASy ProtParam. */
const AA_MW_AVERAGE: Record<string, number> = {
  G:  57.052, A:  71.079, V:  99.133, L: 113.160, I: 113.160,
  P:  97.117, F: 147.177, W: 186.213, M: 131.199, S:  87.078,
  T: 101.105, C: 103.145, Y: 163.176, H: 137.141, D: 115.089,
  E: 129.116, N: 114.104, Q: 128.131, K: 128.174, R: 156.188,
};

/** Monoisotopic residue masses, Daltons. */
const AA_MW_MONOISOTOPIC: Record<string, number> = {
  G:  57.0215, A:  71.0371, V:  99.0684, L: 113.0841, I: 113.0841,
  P:  97.0528, F: 147.0684, W: 186.0793, M: 131.0405, S:  87.0320,
  T: 101.0477, C: 103.0092, Y: 163.0633, H: 137.0589, D: 115.0269,
  E: 129.0426, N: 114.0429, Q: 128.0586, K: 128.0949, R: 156.1011,
};

/** Fallback residue mass for unknown AAs. */
const AVG_AA_MW = 111.1;

/** Water mass — added once per chain (N-term H + C-term OH). */
const H2O_AVERAGE = 18.015;
const H2O_MONOISOTOPIC = 18.0106;

/**
 * Estimate molecular weight of a protein sequence in Daltons.
 *
 * The default previously used monoisotopic values labeled as "Average" — off
 * by ~0.07% systematically vs ExPASy ProtParam. The default
 * is now ExPASy-matching average mass. Pass `'monoisotopic'` for MALDI-TOF /
 * MS workflows that expect the lighter isotope chain.
 *
 * @param seq  protein sequence (case-insensitive; non-letter chars stripped)
 * @param mode 'average' (default, ExPASy ProtParam) or 'monoisotopic' (MS)
 */
export function proteinMolecularWeight(
  seq: string,
  mode: 'average' | 'monoisotopic' = 'average',
): number {
  const upper = seq.toUpperCase().replace(/[^A-Z]/g, ''); // strip stop codons, whitespace, and formatting
  if (upper.length === 0) return 0;
  const table = mode === 'monoisotopic' ? AA_MW_MONOISOTOPIC : AA_MW_AVERAGE;
  const water = mode === 'monoisotopic' ? H2O_MONOISOTOPIC : H2O_AVERAGE;
  let mw = water; // add water for the intact protein (N-term H + C-term OH)
  for (const ch of upper) {
    mw += table[ch] ?? AVG_AA_MW;
  }
  return Math.round(mw * 100) / 100;
}

/** Introspection helper for the AA mass tables. */
export function getAminoAcidMassTable(mode: 'average' | 'monoisotopic' = 'average'): Record<string, number> {
  return mode === 'monoisotopic' ? { ...AA_MW_MONOISOTOPIC } : { ...AA_MW_AVERAGE };
}

export function meltingTemperature(seq: string): number | null {
  const comp = nucleotideComposition(seq);
  return meltingTemperatureFromComposition(comp);
}

/**
 * Calculate Tm from a pre-computed NucleotideComposition. Identical formula
 * to `meltingTemperature(seq)` but skips re-scanning the sequence. Used by
 * callers that memoize composition once and derive several metrics from it.
 */
export function meltingTemperatureFromComposition(comp: NucleotideComposition): number | null {
  const total = comp.A + comp.T + (comp.U ?? 0) + comp.G + comp.C;
  if (total === 0) return null;

  if (total <= 20) {
    // Wallace rule (short oligos)
    return 2 * (comp.A + comp.T + (comp.U ?? 0)) + 4 * (comp.G + comp.C);
  }

  // Basic Tm formula for longer oligos
  return 64.9 + 41 * (comp.G + comp.C - 16.4) / total;
}
