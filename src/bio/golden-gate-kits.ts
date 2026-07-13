import type { GoldenGateEnzymeName } from './golden-gate';

/**
 * Catalog of common Golden Gate / MoClo kits with their canonical Type IIS
 * enzyme and the published set of fusion-site overhangs each kit defines.
 *
 * VOG-1790: Users with an existing pile of L0 parts can pick a kit here and
 * the dialog will sanity-check that loaded parts use overhangs the kit
 * actually recognizes. Mismatches are surfaced as warning chips — not
 * blockers — because users often have custom parts that extend the standard
 * set.
 *
 * Fusion-site sets are intentionally conservative — only overhangs from the
 * primary publication are included. Newer "extended" sets vary between
 * implementations, so each kit cites the paper that defined the sites listed
 * here and downstream code should not silently widen the set.
 */
export interface GoldenGateKit {
  /** Stable string id used in URLs, tests, and metadata. */
  id: string;
  /** Short display name shown in the dropdown. */
  name: string;
  /** One-line tooltip / description. */
  description: string;
  /** Primary Type IIS enzyme this kit uses for the standard assembly level. */
  enzyme: GoldenGateEnzymeName;
  /**
   * Optional secondary enzyme used in the kit's alternating assembly cycle
   * (for example SapI in Loop Assembly or BsmBI in GoldenBraid). The active
   * workflow still has to select the enzyme appropriate to its direction.
   */
  upperLevelEnzyme?: GoldenGateEnzymeName;
  /**
   * Length of the fusion-site overhang in base pairs. BsaI/BbsI/BsmBI/Esp3I
   * produce 4-nt overhangs; SapI/BspQI produce 3-nt overhangs.
   */
  fusionSiteLength: 3 | 4;
  /**
   * Canonical set of fusion-site overhangs (uppercase ACGT). Loaded parts
   * whose digested overhangs fall outside this set are flagged.
   */
  fusionSites: readonly string[];
  /**
   * Optional ordered "transcription unit" prototype — the typical 5'→3' chain
   * of fusion sites for a single TU in this kit. Displayed in the sidebar so
   * users can see "PROM (GGAG) → CDS (AATG) → TER (GCTT) → vector (CGCT)".
   */
  prototype?: readonly { role: string; left: string; right: string }[];
  /** Bibliographic citation for the kit's defining paper. */
  citation: string;
  /** URL (DOI or publisher page) for the citation. */
  citationUrl: string;
}

const MOCLO_PLANT: GoldenGateKit = {
  id: 'moclo-plant',
  name: 'MoClo Plant',
  description: 'Plant MoClo Tool Kit (Engler/Marillonnet) — BsaI L0 fusion sites.',
  enzyme: 'BsaI',
  fusionSiteLength: 4,
  fusionSites: ['GGAG', 'TACT', 'CCAT', 'AATG', 'AGGT', 'GCTT', 'CGCT', 'TGCC'],
  prototype: [
    { role: 'Promoter', left: 'GGAG', right: 'AATG' },
    { role: 'CDS', left: 'AATG', right: 'GCTT' },
    { role: 'Terminator', left: 'GCTT', right: 'CGCT' },
  ],
  citation: 'Engler C, Youles M, Gruetzner R, et al. (2014). A Golden Gate modular cloning toolbox for plants. ACS Synth Biol 3(11):839–43.',
  citationUrl: 'https://doi.org/10.1021/sb4001504',
};

const MOCLO_YEAST_TOOLKIT: GoldenGateKit = {
  id: 'moclo-ytk',
  name: 'MoClo Yeast Toolkit (YTK)',
  description: 'Yeast Tool Kit (Lee/Dueber) — BsmBI standard with 8-position transcription units.',
  enzyme: 'BsmBI',
  fusionSiteLength: 4,
  fusionSites: ['CCCT', 'AACG', 'TATG', 'ATCC', 'TGGC', 'GCTG', 'TACA', 'GCTT', 'CCGA', 'CAAT'],
  prototype: [
    { role: '5′ assembly connector', left: 'CCCT', right: 'AACG' },
    { role: 'Promoter', left: 'AACG', right: 'TATG' },
    { role: 'CDS', left: 'TATG', right: 'ATCC' },
    { role: 'Terminator', left: 'ATCC', right: 'TGGC' },
    { role: '3′ assembly connector', left: 'TGGC', right: 'GCTG' },
  ],
  citation: 'Lee ME, DeLoache WC, Cervantes B, Dueber JE (2015). A Highly Characterized Yeast Toolkit for Modular, Multipart Assembly. ACS Synth Biol 4(9):975–86.',
  citationUrl: 'https://doi.org/10.1021/sb500366v',
};

const MOCLO_MAMMALIAN: GoldenGateKit = {
  id: 'moclo-mammalian',
  name: 'MoClo Mammalian (MoClo-MAM)',
  description: 'Mammalian MoClo toolkit — BsaI with plant-compatible standard fusion sites.',
  enzyme: 'BsaI',
  fusionSiteLength: 4,
  fusionSites: ['GGAG', 'TACT', 'CCAT', 'AATG', 'GCAG', 'TTCG', 'GCTT', 'CGCT'],
  prototype: [
    { role: 'Promoter', left: 'GGAG', right: 'AATG' },
    { role: 'CDS / Tag', left: 'AATG', right: 'GCTT' },
    { role: 'Terminator', left: 'GCTT', right: 'CGCT' },
  ],
  citation: 'Martella A, Matjusaitis M, Auxillos J, Pollard SM, Cai Y (2017). EMMA: An Extensible Mammalian Modular Assembly Toolkit for the Rapid Design and Production of Diverse Expression Vectors. ACS Synth Biol 6(7):1380–92.',
  citationUrl: 'https://doi.org/10.1021/acssynbio.7b00016',
};

const EMMA: GoldenGateKit = {
  id: 'emma',
  name: 'EMMA (Mammalian)',
  description: 'Extensible Mammalian Modular Assembly — BsaI, 11 fusion sites.',
  enzyme: 'BsaI',
  fusionSiteLength: 4,
  fusionSites: ['GGAG', 'TACT', 'CCAT', 'AATG', 'AGGT', 'GCAG', 'TTCG', 'GCTT', 'CGCT', 'GGTA', 'ACTA'],
  prototype: [
    { role: 'Promoter / 5′UTR', left: 'GGAG', right: 'AATG' },
    { role: 'CDS', left: 'AATG', right: 'GCAG' },
    { role: 'Tag / fusion', left: 'GCAG', right: 'TTCG' },
    { role: 'Terminator', left: 'TTCG', right: 'CGCT' },
  ],
  citation: 'Martella A, Matjusaitis M, Auxillos J, Pollard SM, Cai Y (2017). EMMA: An Extensible Mammalian Modular Assembly Toolkit. ACS Synth Biol 6(7):1380–92.',
  citationUrl: 'https://doi.org/10.1021/acssynbio.7b00016',
};

const LOOP_ASSEMBLY: GoldenGateKit = {
  id: 'loop',
  name: 'Loop Assembly',
  description: 'Loop Assembly (Pollak et al.) — alternates BsaI (L0/even) and SapI (L1+/odd).',
  enzyme: 'BsaI',
  upperLevelEnzyme: 'SapI',
  fusionSiteLength: 4,
  fusionSites: ['GGAG', 'AATG', 'AGGT', 'GCTT', 'CGCT', 'TCAG', 'TTAC'],
  prototype: [
    { role: 'Promoter (L0 → L1)', left: 'GGAG', right: 'AATG' },
    { role: 'CDS (L0 → L1)', left: 'AATG', right: 'GCTT' },
    { role: 'Terminator (L0 → L1)', left: 'GCTT', right: 'CGCT' },
  ],
  citation: 'Pollak B, Cerda A, Delmans M, Álvarez-González S, et al. (2019). Loop Assembly: a simple and open system for recursive fabrication of DNA circuits. New Phytologist 222(1):628–40.',
  citationUrl: 'https://doi.org/10.1111/nph.15625',
};

const GOLDENBRAID_3: GoldenGateKit = {
  id: 'goldenbraid-3',
  name: 'GoldenBraid 3.0',
  description: 'GoldenBraid α/Ω assembly — alternates BsaI (Ω→α) and BsmBI/Esp3I (α→Ω), both with 4-nt overhangs.',
  enzyme: 'BsaI',
  upperLevelEnzyme: 'BsmBI',
  fusionSiteLength: 4,
  fusionSites: ['GGAG', 'TACT', 'CCAT', 'AATG', 'AGGT', 'TGAG', 'GCTT', 'CGCT', 'GATG'],
  prototype: [
    { role: 'Promoter', left: 'GGAG', right: 'GATG' },
    { role: 'CDS', left: 'GATG', right: 'TGAG' },
    { role: 'Terminator', left: 'TGAG', right: 'CGCT' },
  ],
  citation: 'Sarrion-Perdigones A, Vazquez-Vilar M, Palací J, et al. (2013). GoldenBraid 2.0: A Comprehensive DNA Assembly Framework for Plant Synthetic Biology. Plant Physiology 162(3):1618–31.',
  citationUrl: 'https://doi.org/10.1104/pp.113.217661',
};

const GREENGATE: GoldenGateKit = {
  id: 'greengate',
  name: 'GreenGate',
  description: 'GreenGate (Lampropoulos et al.) — BsaI plant kit with 7 modules in a fixed order.',
  enzyme: 'BsaI',
  fusionSiteLength: 4,
  fusionSites: ['ACCT', 'AACA', 'AGGT', 'CTGA', 'GCAG', 'GCTT', 'GTGG'],
  prototype: [
    { role: 'Promoter (A→B)', left: 'ACCT', right: 'AACA' },
    { role: 'N-tag (B→C)', left: 'AACA', right: 'AGGT' },
    { role: 'CDS (C→D)', left: 'AGGT', right: 'CTGA' },
    { role: 'C-tag (D→E)', left: 'CTGA', right: 'GCAG' },
    { role: 'Terminator (E→F)', left: 'GCAG', right: 'GCTT' },
    { role: 'Resistance (F→G)', left: 'GCTT', right: 'GTGG' },
  ],
  citation: 'Lampropoulos A, Sutikovic Z, Wenzl C, Maegele I, Lohmann JU, Forner J (2013). GreenGate—a novel, versatile, and efficient cloning system for plant transgenesis. PLOS ONE 8(12):e83043.',
  citationUrl: 'https://doi.org/10.1371/journal.pone.0083043',
};

const MOCLO_CIDAR: GoldenGateKit = {
  id: 'moclo-cidar',
  name: 'MoClo-CIDAR',
  description: 'CIDAR MoClo (Iverson et al.) — BsaI bacterial-circuit standard parts (Promoter / RBS / CDS / Terminator).',
  enzyme: 'BsaI',
  fusionSiteLength: 4,
  fusionSites: ['GGAG', 'TACT', 'AATG', 'AGGT', 'GCTT', 'CGCT'],
  prototype: [
    { role: 'Promoter', left: 'GGAG', right: 'TACT' },
    { role: 'RBS', left: 'TACT', right: 'AATG' },
    { role: 'CDS', left: 'AATG', right: 'GCTT' },
    { role: 'Terminator', left: 'GCTT', right: 'CGCT' },
  ],
  citation: 'Iverson SV, Haddock TL, Beal J, Densmore DM (2016). CIDAR MoClo: Improved MoClo Assembly Standard and New E. coli Part Library Enable Rapid Combinatorial Design for Synthetic and Traditional Biology. ACS Synth Biol 5(1):99–103.',
  citationUrl: 'https://doi.org/10.1021/acssynbio.5b00124',
};

/**
 * Ordered list of supported kits. Add new kit definitions here — the dialog
 * dropdown and tests pick up the new entry automatically.
 */
export const GOLDEN_GATE_KITS: readonly GoldenGateKit[] = [
  MOCLO_PLANT,
  MOCLO_YEAST_TOOLKIT,
  GOLDENBRAID_3,
  EMMA,
  LOOP_ASSEMBLY,
  MOCLO_MAMMALIAN,
  GREENGATE,
  MOCLO_CIDAR,
];

const KIT_BY_ID = new Map<string, GoldenGateKit>(
  GOLDEN_GATE_KITS.map((kit) => [kit.id, kit]),
);

export function getGoldenGateKit(id: string | null | undefined): GoldenGateKit | null {
  if (!id) return null;
  return KIT_BY_ID.get(id) ?? null;
}

export type GoldenGateKitId = (typeof GOLDEN_GATE_KITS)[number]['id'];

export interface GoldenGateKitFusionCheck {
  /** Overhangs the part exposes (uppercase). */
  overhangs: readonly string[];
  /** Overhangs that match a fusion site in the kit. */
  matched: string[];
  /** Overhangs that do NOT match any fusion site in the kit. */
  unmatched: string[];
  /** True when the part exposes ≥1 overhang and ALL overhangs match the kit. */
  consistent: boolean;
}

/**
 * Compare a part's actual Type IIS overhangs against a kit's canonical fusion
 * sites. Returns the matched/unmatched split so the dialog can render a
 * warning chip per offending overhang rather than just a yes/no.
 */
export function checkPartAgainstKit(
  overhangs: readonly (string | null | undefined)[],
  kit: GoldenGateKit,
): GoldenGateKitFusionCheck {
  const fusionSet = new Set(kit.fusionSites.map((site) => site.toUpperCase()));
  const normalized: string[] = [];
  for (const value of overhangs) {
    if (!value) continue;
    const upper = value.trim().toUpperCase();
    if (upper.length === 0) continue;
    normalized.push(upper);
  }
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const overhang of normalized) {
    if (fusionSet.has(overhang)) {
      matched.push(overhang);
    } else {
      unmatched.push(overhang);
    }
  }
  return {
    overhangs: normalized,
    matched,
    unmatched,
    consistent: normalized.length > 0 && unmatched.length === 0,
  };
}
