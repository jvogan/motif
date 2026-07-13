// ===== Core Bio Types =====
// Shared across all modules. This is the contract.

export type SequenceType = 'dna' | 'rna' | 'protein' | 'misc' | 'unknown' | 'mixed';
export type Topology = 'linear' | 'circular';
export type Strand = 1 | -1;
/**
 * A feature's strand: forward (1), reverse (-1), or DIRECTIONLESS (0). A
 * directionless feature is one with no orientation — a region/domain/linker
 * marker — and renders as a plain block with no arrowhead. `0` maps 1:1 onto
 * GFF3's strandless `.`. Scoped to features so the narrower `Strand` (1 | -1)
 * used by ORF/RestrictionSite/reading-frames stays exhaustive.
 */
export type FeatureStrand = Strand | 0;

export type FeatureType =
  | 'orf'
  | 'gene'
  | 'cds'
  | 'promoter'
  | 'terminator'
  | 'rbs'
  | 'origin'
  | 'resistance'
  | 'restriction_site'
  | 'primer_bind'
  | 'misc_feature'
  | 'mRNA' | 'rRNA' | 'tRNA' | 'ncRNA'
  | 'regulatory' | 'repeat_region'
  | 'sig_peptide' | 'mat_peptide' | 'transit_peptide'
  | 'intron' | 'exon' | 'polyA_signal' | 'enhancer'
  | 'custom';

export type ManipulationType =
  | 'reverse_complement'
  | 'reverse'
  | 'translate'
  | 'reverse_translate'
  | 'reverse_translate_rna'
  | 'codon_optimize'
  | 'mutate'
  | 'annotate'
  | 'auto_annotate'
  | 'restriction_digest'
  | 'ligate'
  | 'design_primers'
  | 'extract'
  | 'gibson_assembly'
  | 'golden_gate_assembly'
  | 'pcr_simulation'
  | 'vector_insert'
  | 'ncbi_fetch'
  | 'uniprot_fetch'
  | 'gel_simulation'
  | 'esm_generate'
  | 'esm_insert'
  | 'esm_mutate'
  | 'esm_score'
  | 'esm_scan';

export interface Sequence {
  id: string;
  raw: string;
  type: SequenceType;
  topology: Topology;
  length: number;
}

export interface Feature {
  id: string;
  name: string;
  type: FeatureType;
  start: number; // 0-indexed
  end: number;   // exclusive
  strand: FeatureStrand;
  subRanges?: Array<{ start: number; end: number; strand?: number }>;
  color: string;
  metadata: Record<string, unknown>;
}

export interface ORF {
  start: number;
  end: number;
  frame: 1 | 2 | 3;
  strand: Strand;
  length: number;
  aminoAcids: number;
  startCodon: string;
  stopCodon: string;
}

export interface RestrictionSite {
  enzyme: string;
  position: number;
  cutPosition: number;
  recognitionSequence: string;
  overhang: 'blunt' | '5prime' | '3prime';
  /**
   * Strand on which the recognition sequence was matched.
   * `1` (or undefined for forward) — recognition is on the forward (sense) strand.
   * `-1` — recognition is on the reverse (antisense) strand, i.e. the
   * reverse-complement of the recognition sequence appears at this `position`
   * on the forward strand. This is critical for Type IIS enzymes
   * (BsaI/BbsI/BsmBI/SapI etc.) which are non-palindromic.
   * Phase 34 P-B B1: added when JS scanner was extended to match Rust parity.
   */
  strand?: 1 | -1;
}

export interface RestrictionEnzyme {
  name: string;
  recognitionSequence: string;
  cutOffset: number;
  complementCutOffset: number;
  overhang: 'blunt' | '5prime' | '3prime';
}

export interface SequenceAnalysis {
  length: number;
  gcContent: number;
  atContent: number;
  molecularWeight: number;
  meltingTemp: number | null;
  orfs: ORF[];
  restrictionSites: RestrictionSite[];
  composition: NucleotideComposition;
}

export interface NucleotideComposition {
  A: number;
  T: number;
  U?: number;
  G: number;
  C: number;
  N: number;
  other: number;
}

export interface ProteinAnalysis {
  length: number;                         // residue count
  molecularWeight: number;                // daltons
  isoelectricPoint: number;              // predicted pI (1–14)
  instabilityIndex: number;              // Guruprasad 1990; >40 = unstable
  gravyScore: number;                    // grand average of hydropathicity
  extinctionCoefficient: number;         // M⁻¹ cm⁻¹ at 280 nm
  composition: Record<string, number>;   // residue → fractional frequency
}

export interface CodonTable {
  id: number;
  name: string;
  codons: Record<string, string>; // codon → amino acid
  starts: string[];
  stops: string[];
}

export interface CodonUsage {
  organism: string;
  frequencies: Record<string, Record<string, number>>; // amino acid → codon → frequency
}

export interface FastaRecord {
  header: string;
  description: string;
  sequence: string;
  /**
   * The full FASTA header line without the leading `>`.
   *
   * `header` remains the first whitespace-delimited token because GFF/UniProt
   * and accession-oriented flows use it as a stable sequence identifier.
   * Import UI can use `rawHeader` when the user-entered name is the full line
   * (for example `>test 1` vs `>test 2`).
   */
  rawHeader?: string;
  /**
   * Phase 35 P-I (P2-A22): when an aligned input contained `-` / `.` gap
   * characters, the parser silently degaps but reports the count here so a
   * caller can disclose the transformation. Only present when gaps existed.
   */
  gapsRemoved?: number;
}

// ===== Mutation Scars =====
export type MutationScarType = 'substitution' | 'insertion' | 'deletion';

export interface MutationScar {
  id: string;
  position: number;        // 0-indexed in current raw
  type: MutationScarType;
  original?: string;       // sub: old base; del: removed bases
  inserted?: string;       // ins: added bases
  createdAt: number;
}

// ── DNA/RNA base color palettes ──────────────────────────────────────────────
//
// Two palettes, one per theme, each meeting WCAG AA (≥4.5:1) against its
// respective background (#ffffff light, #0a0a0a dark).
// BASE_COLORS is kept as a backward-compatible alias for the dark palette.

/** DNA/RNA base colors for dark backgrounds (#0a0a0a) — WCAG AA ≥4.5:1 */
export const BASE_COLORS_DARK: Record<string, string> = {
  A: '#4ade80', // green  — 11.36:1 on #0a0a0a
  T: '#f87171', // red    —  7.16:1 on #0a0a0a
  U: '#f87171', // red (RNA) — 7.16:1 on #0a0a0a
  G: '#facc15', // yellow — 12.93:1 on #0a0a0a
  C: '#60a5fa', // blue   —  7.79:1 on #0a0a0a
  N: '#727988', // gray   —  4.53:1 on #0a0a0a (was #6b7280 = 4.10, adjusted)
};

/** DNA/RNA base colors for light backgrounds — WCAG AA ≥4.5:1.
 *
 * VOG-1991: the previous values (#198841/#ed0c0c/#8f7303/#0870f2) passed on
 * pure white at ~4.51-4.56:1 but composited at only ~4.18-4.22:1 against the
 * `--bg-secondary: #f5f5f5` workspace card surface — under the 4.5 normal-text
 * floor on every base. Darkened lightness only (Wong 2011 hue preserved) so
 * each base now clears AA on both #ffffff and #f5f5f5. Mirrors the
 * `[data-theme="light"]` `--base-*` tokens in src/index.css. */
export const BASE_COLORS_LIGHT: Record<string, string> = {
  A: '#147a39', // green  — 5.42:1 on #ffffff / 4.97:1 on #f5f5f5
  T: '#dc0a0a', // red    — 5.13:1 on #ffffff / 4.71:1 on #f5f5f5
  U: '#dc0a0a', // red (RNA) — 5.13:1 on #ffffff / 4.71:1 on #f5f5f5
  G: '#9a5d00', // amber  — 5.33:1 on #ffffff / 4.89:1 on #f5f5f5 (de-muddied olive→amber, AA-pinned)
  C: '#0764da', // blue   — 5.46:1 on #ffffff / 5.01:1 on #f5f5f5
  N: '#6b7280', // gray   — 4.83:1 on #ffffff
};

/** High-contrast dark mode: maximum saturation for accessibility */
export const BASE_COLORS_HC_DARK: Record<string, string> = {
  A: '#00ff55', T: '#ff3333', U: '#ff3333', G: '#ffdd00', C: '#4499ff', N: '#aaaacc',
};

/** High-contrast light mode: maximum contrast on white */
export const BASE_COLORS_HC_LIGHT: Record<string, string> = {
  A: '#006622', T: '#cc0000', U: '#cc0000', G: '#7a5900', C: '#003acc', N: '#555577',
};

/** @deprecated Use BASE_COLORS_DARK or BASE_COLORS_LIGHT. Kept for backward compatibility. */
export const BASE_COLORS: Record<string, string> = BASE_COLORS_DARK;

// ── Amino acid color palettes (Lesk/ClustalX hybrid — physicochemical classes) ─
//
// 5 classes: Hydrophobic | Polar uncharged | Positive charge | Negative charge | Special
// AA_COLORS      — dark-mode palette, all colors ≥4.5:1 on #0a0a0a
// AA_COLORS_LIGHT — light-mode palette, all colors ≥4.5:1 on #ffffff
//
// Phase 32 W2-C P0-2: class assignment now derives from `bio/aa-classes.ts`
// (single source of truth). Notable change vs. pre-Phase-32:
//   - C (cysteine) was polar/green → now special/gray (Benchling/IMGT consensus
//     — cysteine forms disulfide bridges; treated as structural, not polar)

/** Amino acid colors for dark backgrounds (#0a0a0a) — WCAG AA ≥4.5:1 */
export const AA_COLORS: Record<string, string> = {
  // Hydrophobic (9.22:1)
  A: '#f59e0b',
  V: '#f59e0b',
  I: '#f59e0b',
  L: '#f59e0b',
  M: '#f59e0b',
  F: '#f59e0b',
  W: '#f59e0b',
  // Polar uncharged (8.69:1)
  S: '#22c55e',
  T: '#22c55e',
  Y: '#22c55e',
  N: '#22c55e',
  Q: '#22c55e',
  // Positive charge (5.38:1)
  K: '#3b82f6',
  R: '#3b82f6',
  H: '#3b82f6',
  // Negative charge (5.39:1)
  D: '#f43f5e',
  E: '#f43f5e',
  // Special / structural (7.80:1)
  G: '#9ca3af',
  C: '#9ca3af',
  P: '#9ca3af',
  '*': '#9ca3af',
  X: '#9ca3af',
};

/** Amino acid colors for light backgrounds (#ffffff) — WCAG AA ≥4.5:1 */
export const AA_COLORS_LIGHT: Record<string, string> = {
  // Hydrophobic (5.02:1)
  A: '#b45309',
  V: '#b45309',
  I: '#b45309',
  L: '#b45309',
  M: '#b45309',
  F: '#b45309',
  W: '#b45309',
  // Polar uncharged (5.02:1)
  S: '#15803d',
  T: '#15803d',
  Y: '#15803d',
  N: '#15803d',
  Q: '#15803d',
  // Positive charge (6.70:1)
  K: '#1d4ed8',
  R: '#1d4ed8',
  H: '#1d4ed8',
  // Negative charge (6.29:1)
  D: '#be123c',
  E: '#be123c',
  // Special / structural (7.56:1)
  G: '#4b5563',
  C: '#4b5563',
  P: '#4b5563',
  '*': '#4b5563',
  X: '#4b5563',
};
