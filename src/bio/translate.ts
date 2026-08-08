import type { CodonTable } from './types';
import { STANDARD_CODE } from './codon-tables';

/** IUPAC DNA/RNA symbols expanded to canonical DNA bases. */
export const IUPAC_BASE_EXPANSIONS: Readonly<Record<string, readonly string[]>> = {
  A: ['A'], C: ['C'], G: ['G'], T: ['T'], U: ['T'],
  R: ['A', 'G'], Y: ['C', 'T'], S: ['G', 'C'], W: ['A', 'T'],
  K: ['G', 'T'], M: ['A', 'C'], B: ['C', 'G', 'T'], D: ['A', 'G', 'T'],
  H: ['A', 'C', 'T'], V: ['A', 'C', 'G'], N: ['A', 'C', 'G', 'T'],
};

/**
 * Convert RNA to DNA (U → T) for codon lookup.
 */
function rnaToDna(seq: string): string {
  return seq.replace(/[Uu]/g, m => m === 'U' ? 'T' : 't');
}

/**
 * Normalize only sequence formatting whitespace and RNA uracil. Any gap,
 * punctuation, or other character is rejected because deleting it would shift
 * codon boundaries and change the translation.
 */
export function normalizeTranslationInput(seq: string): string {
  const withoutFormattingWhitespace = seq.replace(/\s+/g, '');
  const dna = rnaToDna(withoutFormattingWhitespace.toUpperCase());
  const invalid = new Set<string>();
  for (const base of dna) {
    if (!Object.prototype.hasOwnProperty.call(IUPAC_BASE_EXPANSIONS, base)) invalid.add(base);
  }
  if (invalid.size > 0) {
    throw new Error(`Invalid nucleotide character${invalid.size === 1 ? '' : 's'}: ${[...invalid].join(', ')}`);
  }
  return dna;
}

/** Expand one IUPAC codon into canonical DNA codons. */
export function expandIupacCodon(codon: string): string[] {
  const normalized = rnaToDna(codon.toUpperCase());
  if (normalized.length !== 3) return [];
  let expansions = [''];
  for (const base of normalized) {
    const choices = IUPAC_BASE_EXPANSIONS[base];
    if (!choices) return [];
    expansions = expansions.flatMap((prefix) => choices.map((choice) => `${prefix}${choice}`));
  }
  return expansions;
}

export interface IupacCodonResolution {
  codon: string;
  expansions: string[];
  residues: string[];
  residue: string | null;
  ambiguous: boolean;
}

/**
 * Resolve an IUPAC codon against a genetic code. A single residue is returned
 * when every concrete expansion agrees; divergent expansions remain explicit
 * as `null` so callers can render `X` and attach an ambiguity warning.
 */
export function resolveIupacCodon(codon: string, table: CodonTable = STANDARD_CODE): IupacCodonResolution {
  const normalized = rnaToDna(codon.toUpperCase());
  const expansions = expandIupacCodon(normalized);
  const expandedResidues = expansions.map((concreteCodon) => table.codons[concreteCodon]);
  const residues = [...new Set(expandedResidues
    .filter((residue): residue is string => residue !== undefined))];
  return {
    codon: normalized,
    expansions,
    residues,
    residue: expandedResidues.length === expansions.length && residues.length === 1 ? residues[0] : null,
    ambiguous: expansions.length > 1,
  };
}

/**
 * Return true only when every concrete expansion of an IUPAC codon is an
 * initiator in the selected table. This preserves a definite-start contract:
 * a codon such as ATH is a start in tables where ATA/ATC/ATT are all starts,
 * while ATN is not a definite standard-code start because its expansions also
 * include non-initiators.
 */
export function isDefiniteInitiatorCodon(codon: string, table: CodonTable = STANDARD_CODE): boolean {
  const expansions = expandIupacCodon(codon);
  return expansions.length > 0 && expansions.every((concreteCodon) => table.starts.includes(concreteCodon));
}

/**
 * Translate a DNA or RNA sequence to a protein string.
 * @param seq - DNA or RNA sequence
 * @param frame - Reading frame offset (0, 1, or 2)
 * @param table - Codon table to use (defaults to standard)
 * @param stopAtFirst - Stop at the first stop codon
 */
export function translate(
  seq: string,
  frame: 0 | 1 | 2 = 0,
  table: CodonTable = STANDARD_CODE,
  stopAtFirst = false,
): string {
  const dna = normalizeTranslationInput(seq);
  const protein: string[] = [];

  for (let i = frame; i + 2 < dna.length; i += 3) {
    const codon = dna.slice(i, i + 3);
    const aa = resolveIupacCodon(codon, table).residue ?? 'X';
    if (aa === '*' && stopAtFirst) {
      protein.push('*');
      break;
    } else {
      protein.push(aa);
    }
  }

  return protein.join('');
}

/**
 * Translate a complete coding sequence. NCBI genetic codes distinguish a
 * codon's ordinary residue from its initiator meaning: for example, GTG is
 * Val inside a bacterial CDS but Met when it is the first complete codon.
 * Arbitrary range/frame translation must continue to use {@link translate}.
 */
export function translateCompleteCds(
  seq: string,
  frame: 0 | 1 | 2 = 0,
  table: CodonTable = STANDARD_CODE,
  stopAtFirst = false,
): string {
  const protein = translate(seq, frame, table, stopAtFirst);
  if (!protein) return protein;
  const dna = normalizeTranslationInput(seq);
  const initiator = dna.slice(frame, frame + 3);
  return isDefiniteInitiatorCodon(initiator, table) ? `M${protein.slice(1)}` : protein;
}

/**
 * Translate in all 3 reading frames.
 */
export function translateAllFrames(
  seq: string,
  table: CodonTable = STANDARD_CODE,
): [string, string, string] {
  return [
    translate(seq, 0, table),
    translate(seq, 1, table),
    translate(seq, 2, table),
  ];
}

/**
 * Translate starting from the first initiator recognized by the selected
 * table. The historical name is retained for API compatibility; bacterial and
 * organellar tables can therefore start at GTG, TTG, or another alternative
 * initiator instead of silently searching only for ATG.
 */
export function translateFromFirstATG(
  seq: string,
  table: CodonTable = STANDARD_CODE,
): string | null {
  const dna = normalizeTranslationInput(seq);
  let startIndex = -1;
  for (let index = 0; index + 2 < dna.length; index += 1) {
    if (isDefiniteInitiatorCodon(dna.slice(index, index + 3), table)) {
      startIndex = index;
      break;
    }
  }
  if (startIndex === -1) return null;
  return translateCompleteCds(dna.slice(startIndex), 0, table, true);
}
