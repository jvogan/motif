import type { CodonTable, CodonUsage } from './types';

/** Standard genetic code (NCBI translation table 1) */
export const STANDARD_CODE: CodonTable = {
  id: 1,
  name: 'Standard',
  codons: {
    TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
    CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
    ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
    GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
    TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
    CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
    ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
    GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
    TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
    CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
    AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
    GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
    TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
    CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
    AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
    GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
  },
  // NCBI Table 1 lists only ATG as an initiator. CTG/TTG are Leucine codons
  // here; they are alternative starts in Table 11 (Bacterial/Plastid) only.
  // See https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi?mode=t#SG1.
  starts: ['ATG'],
  stops: ['TAA', 'TAG', 'TGA'],
};

/**
 * Phase 35 P0-A1: NCBI translation tables (2, 5, 11, 13, 22). Prior to this
 * change Motif exposed only table 1; mitochondrial sequences mistranslated
 * silently because the standard code treats UGA as a stop while the
 * mitochondrial codes use it for Trp. See:
 * https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi
 */

/** NCBI translation table 2 — Vertebrate Mitochondrial. */
export const VERTEBRATE_MITO_CODE: CodonTable = {
  id: 2,
  name: 'Vertebrate Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'W',
    ATA: 'M',
    AGA: '*',
    AGG: '*',
  },
  starts: ['ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  stops: ['TAA', 'TAG', 'AGA', 'AGG'],
};

/** NCBI translation table 5 — Invertebrate Mitochondrial. */
export const INVERTEBRATE_MITO_CODE: CodonTable = {
  id: 5,
  name: 'Invertebrate Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'W',
    ATA: 'M',
    AGA: 'S',
    AGG: 'S',
  },
  starts: ['ATT', 'ATC', 'ATA', 'ATG', 'GTG', 'TTG'],
  stops: ['TAA', 'TAG'],
};

/** NCBI translation table 11 — Bacterial / Archaeal / Plant Plastid. */
export const BACTERIAL_CODE: CodonTable = {
  id: 11,
  name: 'Bacterial, Archaeal and Plant Plastid',
  codons: { ...STANDARD_CODE.codons },
  starts: ['ATG', 'GTG', 'TTG', 'ATT', 'CTG', 'ATC', 'ATA'],
  stops: ['TAA', 'TAG', 'TGA'],
};

/** NCBI translation table 13 — Ascidian Mitochondrial. */
export const ASCIDIAN_MITO_CODE: CodonTable = {
  id: 13,
  name: 'Ascidian Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'W',
    ATA: 'M',
    AGA: 'G',
    AGG: 'G',
  },
  starts: ['ATG', 'GTG', 'TTG', 'ATA'],
  stops: ['TAA', 'TAG'],
};

/** NCBI translation table 22 — Scenedesmus obliquus Mitochondrial. */
export const SCENEDESMUS_MITO_CODE: CodonTable = {
  id: 22,
  name: 'Scenedesmus obliquus Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TCA: '*',
    TAG: 'L',
  },
  starts: ['ATG'],
  stops: ['TAA', 'TCA', 'TGA'],
};

/**
 * Remaining unambiguous NCBI translation tables. Generated from the
 * authoritative NCBI ncbieaa/sncbieaa strings (the generator was validated to
 * reproduce tables 1/2/5/11/13/22 above exactly before emitting these). Each is
 * expressed as a delta from STANDARD_CODE.
 *   https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi?mode=c
 * NCBI tables 27 (Karyorelict), 28 (Condylostoma) and 31 (Blastocrithidia) are
 * intentionally omitted: they contain codons that are simultaneously sense AND
 * stop (context-dependent), which a single-valued codon→amino-acid map cannot
 * represent honestly.
 */

/** NCBI translation table 3 — Yeast Mitochondrial. */
export const YEAST_MITO_CODE: CodonTable = {
  id: 3,
  name: 'Yeast Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'W', CTT: 'T', CTC: 'T', CTA: 'T', CTG: 'T', ATA: 'M',
  },
  starts: ['ATA', 'ATG', 'GTG'],
  stops: ['TAA', 'TAG'],
};

/** NCBI translation table 4 — Mold, Protozoan, Coelenterate Mitochondrial / Mycoplasma. */
export const MOLD_PROTOZOAN_MITO_CODE: CodonTable = {
  id: 4,
  name: 'Mold, Protozoan, Coelenterate Mitochondrial / Mycoplasma',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'W',
  },
  starts: ['TTA', 'TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  stops: ['TAA', 'TAG'],
};

/** NCBI translation table 6 — Ciliate, Dasycladacean and Hexamita Nuclear. */
export const CILIATE_NUCLEAR_CODE: CodonTable = {
  id: 6,
  name: 'Ciliate, Dasycladacean and Hexamita Nuclear',
  codons: {
    ...STANDARD_CODE.codons,
    TAA: 'Q', TAG: 'Q',
  },
  starts: ['ATG'],
  stops: ['TGA'],
};

/** NCBI translation table 9 — Echinoderm and Flatworm Mitochondrial. */
export const ECHINODERM_MITO_CODE: CodonTable = {
  id: 9,
  name: 'Echinoderm and Flatworm Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'W', AAA: 'N', AGA: 'S', AGG: 'S',
  },
  starts: ['ATG', 'GTG'],
  stops: ['TAA', 'TAG'],
};

/** NCBI translation table 10 — Euplotid Nuclear. */
export const EUPLOTID_NUCLEAR_CODE: CodonTable = {
  id: 10,
  name: 'Euplotid Nuclear',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'C',
  },
  starts: ['ATG'],
  stops: ['TAA', 'TAG'],
};

/** NCBI translation table 12 — Alternative Yeast Nuclear. */
export const ALT_YEAST_NUCLEAR_CODE: CodonTable = {
  id: 12,
  name: 'Alternative Yeast Nuclear',
  codons: {
    ...STANDARD_CODE.codons,
    CTG: 'S',
  },
  starts: ['CTG', 'ATG'],
  stops: ['TAA', 'TAG', 'TGA'],
};

/** NCBI translation table 14 — Alternative Flatworm Mitochondrial. */
export const ALT_FLATWORM_MITO_CODE: CodonTable = {
  id: 14,
  name: 'Alternative Flatworm Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TAA: 'Y', TGA: 'W', AAA: 'N', AGA: 'S', AGG: 'S',
  },
  starts: ['ATG'],
  stops: ['TAG'],
};

/** NCBI translation table 16 — Chlorophycean Mitochondrial. */
export const CHLOROPHYCEAN_MITO_CODE: CodonTable = {
  id: 16,
  name: 'Chlorophycean Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TAG: 'L',
  },
  starts: ['ATG'],
  stops: ['TAA', 'TGA'],
};

/** NCBI translation table 21 — Trematode Mitochondrial. */
export const TREMATODE_MITO_CODE: CodonTable = {
  id: 21,
  name: 'Trematode Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'W', ATA: 'M', AAA: 'N', AGA: 'S', AGG: 'S',
  },
  starts: ['ATG', 'GTG'],
  stops: ['TAA', 'TAG'],
};

/** NCBI translation table 23 — Thraustochytrium Mitochondrial. */
export const THRAUSTOCHYTRIUM_MITO_CODE: CodonTable = {
  id: 23,
  name: 'Thraustochytrium Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TTA: '*',
  },
  starts: ['ATT', 'ATG', 'GTG'],
  stops: ['TTA', 'TAA', 'TAG', 'TGA'],
};

/** NCBI translation table 24 — Rhabdopleuridae Mitochondrial. */
export const RHABDOPLEURIDAE_MITO_CODE: CodonTable = {
  id: 24,
  name: 'Rhabdopleuridae Mitochondrial',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'W', AGA: 'S', AGG: 'K',
  },
  starts: ['TTG', 'CTG', 'ATG', 'GTG'],
  stops: ['TAA', 'TAG'],
};

/** NCBI translation table 25 — Candidate Division SR1 and Gracilibacteria. */
export const GRACILIBACTERIA_CODE: CodonTable = {
  id: 25,
  name: 'Candidate Division SR1 and Gracilibacteria',
  codons: {
    ...STANDARD_CODE.codons,
    TGA: 'G',
  },
  starts: ['TTG', 'ATG', 'GTG'],
  stops: ['TAA', 'TAG'],
};

/** NCBI translation table 26 — Pachysolen tannophilus Nuclear. */
export const PACHYSOLEN_NUCLEAR_CODE: CodonTable = {
  id: 26,
  name: 'Pachysolen tannophilus Nuclear',
  codons: {
    ...STANDARD_CODE.codons,
    CTG: 'A',
  },
  starts: ['CTG', 'ATG'],
  stops: ['TAA', 'TAG', 'TGA'],
};

/** NCBI translation table 29 — Mesodinium Nuclear. */
export const MESODINIUM_NUCLEAR_CODE: CodonTable = {
  id: 29,
  name: 'Mesodinium Nuclear',
  codons: {
    ...STANDARD_CODE.codons,
    TAA: 'Y', TAG: 'Y',
  },
  starts: ['ATG'],
  stops: ['TGA'],
};

/** NCBI translation table 30 — Peritrich Nuclear. */
export const PERITRICH_NUCLEAR_CODE: CodonTable = {
  id: 30,
  name: 'Peritrich Nuclear',
  codons: {
    ...STANDARD_CODE.codons,
    TAA: 'E', TAG: 'E',
  },
  starts: ['ATG'],
  stops: ['TGA'],
};

/** NCBI translation table 33 — Cephalodiscidae Mitochondrial UAA-Tyr. */
export const CEPHALODISCIDAE_MITO_CODE: CodonTable = {
  id: 33,
  name: 'Cephalodiscidae Mitochondrial UAA-Tyr',
  codons: {
    ...STANDARD_CODE.codons,
    TAA: 'Y', TGA: 'W', AGA: 'S', AGG: 'K',
  },
  starts: ['TTG', 'CTG', 'ATG', 'GTG'],
  stops: ['TAG'],
};

/** Registry of supported NCBI translation tables, keyed by id. */
export const NCBI_TRANSLATION_TABLES: Record<number, CodonTable> = {
  1: STANDARD_CODE,
  2: VERTEBRATE_MITO_CODE,
  3: YEAST_MITO_CODE,
  4: MOLD_PROTOZOAN_MITO_CODE,
  5: INVERTEBRATE_MITO_CODE,
  6: CILIATE_NUCLEAR_CODE,
  9: ECHINODERM_MITO_CODE,
  10: EUPLOTID_NUCLEAR_CODE,
  11: BACTERIAL_CODE,
  12: ALT_YEAST_NUCLEAR_CODE,
  13: ASCIDIAN_MITO_CODE,
  14: ALT_FLATWORM_MITO_CODE,
  16: CHLOROPHYCEAN_MITO_CODE,
  21: TREMATODE_MITO_CODE,
  22: SCENEDESMUS_MITO_CODE,
  23: THRAUSTOCHYTRIUM_MITO_CODE,
  24: RHABDOPLEURIDAE_MITO_CODE,
  25: GRACILIBACTERIA_CODE,
  26: PACHYSOLEN_NUCLEAR_CODE,
  29: MESODINIUM_NUCLEAR_CODE,
  30: PERITRICH_NUCLEAR_CODE,
  33: CEPHALODISCIDAE_MITO_CODE,
};

/**
 * Get a translation table by id; falls back to Standard if unknown. Resolves
 * built-in NCBI tables (1–33) and registered custom tables (ids ≥
 * CUSTOM_TRANSLATION_ID_BASE) alike. (customTranslationRegistry is defined lower
 * in the file; this function only reads it at call time, long after load.)
 */
export function getTranslationTable(id: number | undefined | null): CodonTable {
  if (id == null) return STANDARD_CODE;
  return NCBI_TRANSLATION_TABLES[id] ?? customTranslationRegistry.get(id) ?? STANDARD_CODE;
}

/**
 * Every NCBI translation-table id Motif ships, derived from the registry so
 * validators never drift from the data (single source of truth — adding a table
 * above automatically makes it selectable everywhere).
 */
export const VALID_NCBI_TABLE_IDS: ReadonlyArray<number> =
  Object.keys(NCBI_TRANSLATION_TABLES).map(Number);

/** True if `id` resolves to a shipped NCBI table OR a registered custom table. */
export function isValidTranslationTableId(id: number | null | undefined): boolean {
  if (id == null) return false;
  return Object.prototype.hasOwnProperty.call(NCBI_TRANSLATION_TABLES, id)
    || customTranslationRegistry.has(id);
}

/** List of supported translation tables for UI selectors. */
export function listTranslationTables(): Array<{ id: number; name: string }> {
  return Object.values(NCBI_TRANSLATION_TABLES).map((t) => ({ id: t.id, name: t.name }));
}

/** Build reverse map: amino acid → list of codons */
export function getAminoAcidToCodons(table: CodonTable = STANDARD_CODE): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [codon, aa] of Object.entries(table.codons)) {
    if (!map[aa]) map[aa] = [];
    map[aa].push(codon);
  }
  return map;
}

// Codon usage frequencies (fractions per amino acid, approximate)
// Source: Kazusa codon usage database

export const ECOLI_USAGE: CodonUsage = {
  organism: 'E. coli K12',
  frequencies: {
    F: { TTT: 0.58, TTC: 0.42 },
    L: { TTA: 0.11, TTG: 0.11, CTT: 0.10, CTC: 0.10, CTA: 0.04, CTG: 0.54 },
    I: { ATT: 0.49, ATC: 0.39, ATA: 0.07 },
    M: { ATG: 1.0 },
    V: { GTT: 0.28, GTC: 0.20, GTA: 0.17, GTG: 0.35 },
    S: { TCT: 0.17, TCC: 0.15, TCA: 0.12, TCG: 0.15, AGT: 0.16, AGC: 0.25 },
    P: { CCT: 0.18, CCC: 0.13, CCA: 0.20, CCG: 0.49 },
    T: { ACT: 0.19, ACC: 0.40, ACA: 0.13, ACG: 0.25 },
    A: { GCT: 0.18, GCC: 0.26, GCA: 0.21, GCG: 0.35 },
    Y: { TAT: 0.59, TAC: 0.41 },
    '*': { TAA: 0.61, TAG: 0.09, TGA: 0.30 },
    H: { CAT: 0.57, CAC: 0.43 },
    Q: { CAA: 0.34, CAG: 0.66 },
    N: { AAT: 0.49, AAC: 0.51 },
    K: { AAA: 0.74, AAG: 0.26 },
    D: { GAT: 0.63, GAC: 0.37 },
    E: { GAA: 0.68, GAG: 0.32 },
    C: { TGT: 0.46, TGC: 0.54 },
    W: { TGG: 1.0 },
    R: { CGT: 0.36, CGC: 0.36, CGA: 0.07, CGG: 0.11, AGA: 0.07, AGG: 0.04 },
    G: { GGT: 0.35, GGC: 0.37, GGA: 0.13, GGG: 0.15 },
  },
};

export const HUMAN_USAGE: CodonUsage = {
  organism: 'Homo sapiens',
  frequencies: {
    F: { TTT: 0.45, TTC: 0.55 },
    L: { TTA: 0.07, TTG: 0.13, CTT: 0.13, CTC: 0.20, CTA: 0.07, CTG: 0.40 },
    I: { ATT: 0.36, ATC: 0.48, ATA: 0.16 },
    M: { ATG: 1.0 },
    V: { GTT: 0.18, GTC: 0.24, GTA: 0.12, GTG: 0.46 },
    S: { TCT: 0.18, TCC: 0.22, TCA: 0.15, TCG: 0.06, AGT: 0.15, AGC: 0.24 },
    P: { CCT: 0.29, CCC: 0.33, CCA: 0.27, CCG: 0.11 },
    T: { ACT: 0.24, ACC: 0.36, ACA: 0.28, ACG: 0.12 },
    A: { GCT: 0.26, GCC: 0.40, GCA: 0.23, GCG: 0.11 },
    Y: { TAT: 0.43, TAC: 0.57 },
    '*': { TAA: 0.28, TAG: 0.20, TGA: 0.52 },
    H: { CAT: 0.41, CAC: 0.59 },
    Q: { CAA: 0.25, CAG: 0.75 },
    N: { AAT: 0.46, AAC: 0.54 },
    K: { AAA: 0.42, AAG: 0.58 },
    D: { GAT: 0.46, GAC: 0.54 },
    E: { GAA: 0.42, GAG: 0.58 },
    C: { TGT: 0.45, TGC: 0.55 },
    W: { TGG: 1.0 },
    R: { CGT: 0.08, CGC: 0.19, CGA: 0.11, CGG: 0.21, AGA: 0.20, AGG: 0.21 },
    G: { GGT: 0.16, GGC: 0.34, GGA: 0.25, GGG: 0.25 },
  },
};

export const YEAST_USAGE: CodonUsage = {
  organism: 'Saccharomyces cerevisiae',
  frequencies: {
    F: { TTT: 0.59, TTC: 0.41 },
    L: { TTA: 0.28, TTG: 0.29, CTT: 0.13, CTC: 0.06, CTA: 0.14, CTG: 0.10 },
    I: { ATT: 0.46, ATC: 0.26, ATA: 0.27 },
    M: { ATG: 1.0 },
    V: { GTT: 0.39, GTC: 0.21, GTA: 0.21, GTG: 0.19 },
    S: { TCT: 0.26, TCC: 0.16, TCA: 0.21, TCG: 0.10, AGT: 0.16, AGC: 0.11 },
    P: { CCT: 0.31, CCC: 0.15, CCA: 0.42, CCG: 0.12 },
    T: { ACT: 0.35, ACC: 0.22, ACA: 0.30, ACG: 0.13 },
    A: { GCT: 0.38, GCC: 0.22, GCA: 0.29, GCG: 0.11 },
    Y: { TAT: 0.56, TAC: 0.44 },
    '*': { TAA: 0.47, TAG: 0.23, TGA: 0.30 },
    H: { CAT: 0.64, CAC: 0.36 },
    Q: { CAA: 0.69, CAG: 0.31 },
    N: { AAT: 0.59, AAC: 0.41 },
    K: { AAA: 0.58, AAG: 0.42 },
    D: { GAT: 0.65, GAC: 0.35 },
    E: { GAA: 0.70, GAG: 0.30 },
    C: { TGT: 0.63, TGC: 0.37 },
    W: { TGG: 1.0 },
    R: { CGT: 0.15, CGC: 0.06, CGA: 0.07, CGG: 0.04, AGA: 0.48, AGG: 0.21 },
    G: { GGT: 0.47, GGC: 0.19, GGA: 0.22, GGG: 0.12 },
  },
};

/**
 * Phase 35 P-I (P1-A11): expand codon usage to cover major non-E.coli/non-human
 * expression hosts. Sources: Kazusa codon usage database (Pichia/Sf9/CHO/B.subtilis).
 * Together with the existing three tables (E. coli, human, yeast), these
 * cover ~95% of customer expression workflows.
 */

export const PICHIA_USAGE: CodonUsage = {
  organism: 'Pichia pastoris',
  frequencies: {
    F: { TTT: 0.55, TTC: 0.45 },
    L: { TTA: 0.13, TTG: 0.33, CTT: 0.17, CTC: 0.08, CTA: 0.11, CTG: 0.18 },
    I: { ATT: 0.51, ATC: 0.30, ATA: 0.19 },
    M: { ATG: 1.0 },
    V: { GTT: 0.40, GTC: 0.23, GTA: 0.16, GTG: 0.21 },
    S: { TCT: 0.27, TCC: 0.20, TCA: 0.16, TCG: 0.10, AGT: 0.14, AGC: 0.13 },
    P: { CCT: 0.36, CCC: 0.15, CCA: 0.37, CCG: 0.12 },
    T: { ACT: 0.39, ACC: 0.25, ACA: 0.21, ACG: 0.15 },
    A: { GCT: 0.45, GCC: 0.25, GCA: 0.20, GCG: 0.10 },
    Y: { TAT: 0.46, TAC: 0.54 },
    '*': { TAA: 0.51, TAG: 0.16, TGA: 0.33 },
    H: { CAT: 0.55, CAC: 0.45 },
    Q: { CAA: 0.62, CAG: 0.38 },
    N: { AAT: 0.51, AAC: 0.49 },
    K: { AAA: 0.46, AAG: 0.54 },
    D: { GAT: 0.65, GAC: 0.35 },
    E: { GAA: 0.59, GAG: 0.41 },
    C: { TGT: 0.59, TGC: 0.41 },
    W: { TGG: 1.0 },
    R: { CGT: 0.16, CGC: 0.05, CGA: 0.11, CGG: 0.05, AGA: 0.48, AGG: 0.15 },
    G: { GGT: 0.43, GGC: 0.19, GGA: 0.23, GGG: 0.15 },
  },
};

export const SF9_USAGE: CodonUsage = {
  organism: 'Spodoptera frugiperda Sf9',
  frequencies: {
    F: { TTT: 0.39, TTC: 0.61 },
    L: { TTA: 0.06, TTG: 0.16, CTT: 0.15, CTC: 0.16, CTA: 0.08, CTG: 0.39 },
    I: { ATT: 0.35, ATC: 0.51, ATA: 0.14 },
    M: { ATG: 1.0 },
    V: { GTT: 0.19, GTC: 0.27, GTA: 0.10, GTG: 0.44 },
    S: { TCT: 0.16, TCC: 0.27, TCA: 0.10, TCG: 0.16, AGT: 0.10, AGC: 0.21 },
    P: { CCT: 0.27, CCC: 0.30, CCA: 0.24, CCG: 0.19 },
    T: { ACT: 0.21, ACC: 0.40, ACA: 0.19, ACG: 0.20 },
    A: { GCT: 0.26, GCC: 0.39, GCA: 0.20, GCG: 0.15 },
    Y: { TAT: 0.39, TAC: 0.61 },
    '*': { TAA: 0.39, TAG: 0.28, TGA: 0.33 },
    H: { CAT: 0.42, CAC: 0.58 },
    Q: { CAA: 0.37, CAG: 0.63 },
    N: { AAT: 0.40, AAC: 0.60 },
    K: { AAA: 0.30, AAG: 0.70 },
    D: { GAT: 0.42, GAC: 0.58 },
    E: { GAA: 0.34, GAG: 0.66 },
    C: { TGT: 0.36, TGC: 0.64 },
    W: { TGG: 1.0 },
    R: { CGT: 0.16, CGC: 0.26, CGA: 0.09, CGG: 0.18, AGA: 0.15, AGG: 0.16 },
    G: { GGT: 0.22, GGC: 0.32, GGA: 0.27, GGG: 0.19 },
  },
};

export const CHO_USAGE: CodonUsage = {
  organism: 'CHO (Cricetulus griseus)',
  frequencies: {
    F: { TTT: 0.43, TTC: 0.57 },
    L: { TTA: 0.06, TTG: 0.13, CTT: 0.13, CTC: 0.20, CTA: 0.07, CTG: 0.41 },
    I: { ATT: 0.34, ATC: 0.51, ATA: 0.15 },
    M: { ATG: 1.0 },
    V: { GTT: 0.17, GTC: 0.25, GTA: 0.11, GTG: 0.47 },
    S: { TCT: 0.19, TCC: 0.22, TCA: 0.14, TCG: 0.06, AGT: 0.14, AGC: 0.25 },
    P: { CCT: 0.31, CCC: 0.31, CCA: 0.27, CCG: 0.11 },
    T: { ACT: 0.24, ACC: 0.37, ACA: 0.27, ACG: 0.12 },
    A: { GCT: 0.28, GCC: 0.39, GCA: 0.22, GCG: 0.11 },
    Y: { TAT: 0.41, TAC: 0.59 },
    '*': { TAA: 0.27, TAG: 0.20, TGA: 0.53 },
    H: { CAT: 0.40, CAC: 0.60 },
    Q: { CAA: 0.24, CAG: 0.76 },
    N: { AAT: 0.43, AAC: 0.57 },
    K: { AAA: 0.39, AAG: 0.61 },
    D: { GAT: 0.45, GAC: 0.55 },
    E: { GAA: 0.39, GAG: 0.61 },
    C: { TGT: 0.43, TGC: 0.57 },
    W: { TGG: 1.0 },
    R: { CGT: 0.09, CGC: 0.20, CGA: 0.12, CGG: 0.22, AGA: 0.19, AGG: 0.18 },
    G: { GGT: 0.17, GGC: 0.34, GGA: 0.26, GGG: 0.23 },
  },
};

export const BSUBTILIS_USAGE: CodonUsage = {
  organism: 'Bacillus subtilis',
  frequencies: {
    F: { TTT: 0.69, TTC: 0.31 },
    L: { TTA: 0.18, TTG: 0.16, CTT: 0.22, CTC: 0.10, CTA: 0.04, CTG: 0.30 },
    I: { ATT: 0.49, ATC: 0.36, ATA: 0.15 },
    M: { ATG: 1.0 },
    V: { GTT: 0.27, GTC: 0.18, GTA: 0.20, GTG: 0.35 },
    S: { TCT: 0.13, TCC: 0.10, TCA: 0.15, TCG: 0.10, AGT: 0.10, AGC: 0.42 },
    P: { CCT: 0.27, CCC: 0.10, CCA: 0.20, CCG: 0.43 },
    T: { ACT: 0.20, ACC: 0.15, ACA: 0.40, ACG: 0.25 },
    A: { GCT: 0.27, GCC: 0.21, GCA: 0.27, GCG: 0.25 },
    Y: { TAT: 0.66, TAC: 0.34 },
    '*': { TAA: 0.61, TAG: 0.13, TGA: 0.26 },
    H: { CAT: 0.66, CAC: 0.34 },
    Q: { CAA: 0.51, CAG: 0.49 },
    N: { AAT: 0.41, AAC: 0.59 },
    K: { AAA: 0.71, AAG: 0.29 },
    D: { GAT: 0.62, GAC: 0.38 },
    E: { GAA: 0.69, GAG: 0.31 },
    C: { TGT: 0.46, TGC: 0.54 },
    W: { TGG: 1.0 },
    R: { CGT: 0.23, CGC: 0.20, CGA: 0.06, CGG: 0.08, AGA: 0.30, AGG: 0.13 },
    G: { GGT: 0.31, GGC: 0.30, GGA: 0.23, GGG: 0.16 },
  },
};

/** Built-in organism identifiers with a shipped usage table. */
export type CodonOrganism = 'ecoli' | 'human' | 'yeast' | 'pichia' | 'sf9' | 'cho' | 'bsubtilis';

/**
 * I11b: any codon-table identifier accepted by `getCodonUsage` — a built-in
 * `CodonOrganism` or a user table referenced as `custom:<id>`. Kept as a plain
 * `string` so it round-trips through localStorage and the settings backup
 * without a brittle literal union; unknown ids resolve to HUMAN_USAGE.
 */
export type CodonTableId = string;

/** A user-uploaded codon usage table (I11b). Persisted in the UI store. */
export interface CustomCodonTable {
  /** Stable id; referenced elsewhere as `custom:<id>`. */
  id: string;
  /** User-facing display name. */
  name: string;
  /** Parsed usage in the same shape as the built-in tables. */
  usage: CodonUsage;
}

// Custom tables registered from the UI store, keyed by their `custom:<id>`
// selector so `getCodonUsage` can resolve them without importing the store
// (which would create a bio -> store dependency cycle).
const customCodonUsageRegistry = new Map<string, CodonUsage>();

/**
 * Replace the set of custom codon tables visible to `getCodonUsage`. Called by
 * the UI store on hydrate and whenever a table is added or deleted, so the
 * registry always mirrors the persisted list.
 */
export function registerCustomCodonTables(tables: readonly CustomCodonTable[]): void {
  customCodonUsageRegistry.clear();
  for (const table of tables) {
    customCodonUsageRegistry.set(`custom:${table.id}`, table.usage);
  }
}

/** Get usage table by organism id (built-in or `custom:<id>`). */
export function getCodonUsage(organism: CodonTableId): CodonUsage {
  switch (organism) {
    case 'ecoli': return ECOLI_USAGE;
    case 'human': return HUMAN_USAGE;
    case 'yeast': return YEAST_USAGE;
    case 'pichia': return PICHIA_USAGE;
    case 'sf9': return SF9_USAGE;
    case 'cho': return CHO_USAGE;
    case 'bsubtilis': return BSUBTILIS_USAGE;
  }
  const custom = customCodonUsageRegistry.get(organism);
  if (custom) return custom;
  // Unknown id — e.g. a custom table that was deleted, or a backup imported on
  // a machine that never had it. Fall back to the human default rather than
  // throwing so codon-aware operations stay usable.
  return HUMAN_USAGE;
}

// ───────────────────── Custom (user-defined) translation tables ─────────────
//
// A custom genetic code is a delta on top of an NCBI base table: a set of codon
// reassignments plus optional start-codon tweaks. It is persisted in the UI
// store as a CustomTranslationTableSpec and registered into the bio layer so
// getTranslationTable / isValidTranslationTableId resolve it like any built-in.
//
// Custom tables get numeric ids ≥ CUSTOM_TRANSLATION_ID_BASE so they share the
// existing number-keyed registry, per-block overrides and persistence with the
// NCBI tables (1–33) without a string-id refactor.

export const CUSTOM_TRANSLATION_ID_BASE = 1000;

/** Amino-acid letters a reassignment may target (20 standard + '*' = stop). */
const CUSTOM_AA_ALPHABET = new Set('ACDEFGHIKLMNPQRSTVWY*'.split(''));
const CUSTOM_CODON_RE = /^[ACGT]{3}$/;

/** A user-defined genetic code, persisted (editable) in the UI store. */
export interface CustomTranslationTableSpec {
  /** Stable numeric id ≥ CUSTOM_TRANSLATION_ID_BASE. */
  id: number;
  /** User-facing name. */
  name: string;
  /** NCBI table id this code is derived from (its codons/starts are the base). */
  baseId: number;
  /** Codon → amino-acid ('*' = stop) overrides on top of the base. */
  reassignments: Record<string, string>;
  /** Start codons to add on top of the base set. */
  extraStarts: string[];
  /** Base start codons to remove. */
  removedStarts: string[];
}

export function isCustomTranslationTableId(id: number | null | undefined): boolean {
  return typeof id === 'number' && id >= CUSTOM_TRANSLATION_ID_BASE;
}

/**
 * Human-readable problems with a spec, for the editor to surface BEFORE saving.
 * Empty array → the spec is valid. (The builder itself is defensive and simply
 * skips anything invalid, so a bad spec can never produce a corrupt table.)
 */
export function validateCustomTranslationSpec(spec: CustomTranslationTableSpec): string[] {
  const errors: string[] = [];
  if (!spec.name.trim()) errors.push('Give the code a name.');
  if (!Object.prototype.hasOwnProperty.call(NCBI_TRANSLATION_TABLES, spec.baseId)) {
    errors.push('Pick a valid base table.');
  }
  for (const [rawCodon, rawAa] of Object.entries(spec.reassignments ?? {})) {
    const codon = rawCodon.toUpperCase();
    const aa = rawAa.toUpperCase();
    if (!CUSTOM_CODON_RE.test(codon)) errors.push(`"${rawCodon}" is not a codon (three of A/C/G/T).`);
    else if (!CUSTOM_AA_ALPHABET.has(aa)) errors.push(`"${rawAa}" is not an amino acid or stop (*).`);
  }
  return errors;
}

/**
 * Build a concrete CodonTable from a spec. Deterministic and total: invalid
 * reassignments/starts are skipped (never throws), stops are DERIVED from the
 * resulting codon map (so the stop list can't disagree with it), and a start
 * codon that became a stop is dropped (you can't initiate on a stop).
 */
export function buildCustomTranslationTable(spec: CustomTranslationTableSpec): CodonTable {
  const base = NCBI_TRANSLATION_TABLES[spec.baseId] ?? STANDARD_CODE;
  const codons: Record<string, string> = { ...base.codons };
  for (const [rawCodon, rawAa] of Object.entries(spec.reassignments ?? {})) {
    const codon = rawCodon.toUpperCase();
    const aa = rawAa.toUpperCase();
    if (CUSTOM_CODON_RE.test(codon) && CUSTOM_AA_ALPHABET.has(aa)) codons[codon] = aa;
  }
  const stops = Object.keys(codons).filter((c) => codons[c] === '*').sort();
  const removed = new Set((spec.removedStarts ?? []).map((s) => s.toUpperCase()));
  const startSet = new Set(base.starts.filter((s) => !removed.has(s)));
  for (const s of spec.extraStarts ?? []) {
    const codon = s.toUpperCase();
    if (CUSTOM_CODON_RE.test(codon)) startSet.add(codon);
  }
  // A codon that now codes a stop can't be an initiator.
  const starts = [...startSet].filter((c) => codons[c] !== '*');
  return { id: spec.id, name: spec.name.trim() || `Custom ${spec.id}`, codons, starts, stops };
}

// Registered from the UI store; keyed by numeric id. Built CodonTables so
// getTranslationTable can return them directly.
const customTranslationRegistry = new Map<number, CodonTable>();

/**
 * Replace the set of custom translation tables visible to getTranslationTable /
 * isValidTranslationTableId. Called by the UI store on hydrate and whenever a
 * custom code is added or removed, so the registry mirrors the persisted specs.
 */
export function registerCustomTranslationTables(specs: readonly CustomTranslationTableSpec[]): void {
  customTranslationRegistry.clear();
  for (const spec of specs) {
    if (isCustomTranslationTableId(spec.id)) {
      customTranslationRegistry.set(spec.id, buildCustomTranslationTable(spec));
    }
  }
}

/** Built custom translation tables currently registered (for UI selectors). */
export function listCustomTranslationTables(): CodonTable[] {
  return [...customTranslationRegistry.values()];
}
