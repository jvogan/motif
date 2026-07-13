import type { RestrictionEnzyme } from './types';

/**
 * Expanded restriction enzyme database (200+ enzymes).
 *
 * Cut offset conventions (0-indexed from the start of the recognition sequence):
 *   cutOffset             — position of the sense-strand nick (after this base)
 *   complementCutOffset   — position of the antisense-strand nick (after this base)
 *
 * Examples:
 *   EcoRI  GAATTC  cutOffset=1, complementCutOffset=5  → 5′-overhang AATT
 *   SmaI   CCCGGG  cutOffset=3, complementCutOffset=3  → blunt
 *   PstI   CTGCAG  cutOffset=5, complementCutOffset=1  → 3′-overhang ACGT (TGCA on sense)
 *
 * For Type IIS enzymes the nick falls outside the recognition sequence:
 *   BsaI   GGTCTC(1/5)  → cutOffset=7, complementCutOffset=11
 */
export const RESTRICTION_ENZYMES_FULL: RestrictionEnzyme[] = [
  // ── 4-cutters ───────────────────────────────────────────────────────────────
  // AluI: AGCT — blunt cutter, cuts between AG and CT
  { name: 'AluI',    recognitionSequence: 'AGCT',   cutOffset: 2, complementCutOffset: 2,  overhang: 'blunt'  },
  // DpnI: GATC — blunt cutter (requires methylation on both strands in vivo, but cut position is between GA and TC)
  { name: 'DpnI',    recognitionSequence: 'GATC',   cutOffset: 2, complementCutOffset: 2,  overhang: 'blunt'  },
  // HaeIII: GGCC — blunt, cuts GG|CC
  { name: 'HaeIII',  recognitionSequence: 'GGCC',   cutOffset: 2, complementCutOffset: 2,  overhang: 'blunt'  },
  // HhaI: GCGC — cuts GCG|C leaving a 2-nt 3′ overhang; cutOffset=3, compCutOffset=1 (QA2 W27: was 1/3, fragment boundary off by 2)
  { name: 'HhaI',    recognitionSequence: 'GCGC',   cutOffset: 3, complementCutOffset: 1,  overhang: '3prime' },
  // HpaII: CCGG — 5′ CG overhang; cuts C|CGG → cutOffset=1, compCutOffset=3
  { name: 'HpaII',   recognitionSequence: 'CCGG',   cutOffset: 1, complementCutOffset: 3,  overhang: '5prime' },
  // MboI: GATC — 5′ GATC overhang (isoschizomer of Sau3AI); cuts before G → cutOffset=0
  { name: 'MboI',    recognitionSequence: 'GATC',   cutOffset: 0, complementCutOffset: 4,  overhang: '5prime' },
  // MseI: TTAA — 5′ TA overhang; cuts T|TAA → cutOffset=1, compCutOffset=3
  { name: 'MseI',    recognitionSequence: 'TTAA',   cutOffset: 1, complementCutOffset: 3,  overhang: '5prime' },
  // MspI: CCGG — 5′ CG overhang (isoschizomer of HpaII); cuts C|CGG
  { name: 'MspI',    recognitionSequence: 'CCGG',   cutOffset: 1, complementCutOffset: 3,  overhang: '5prime' },
  // RsaI: GTAC — blunt; cuts GT|AC
  { name: 'RsaI',    recognitionSequence: 'GTAC',   cutOffset: 2, complementCutOffset: 2,  overhang: 'blunt'  },
  // Sau3AI: GATC — 5′ GATC overhang; cuts before G → cutOffset=0
  { name: 'Sau3AI',  recognitionSequence: 'GATC',   cutOffset: 0, complementCutOffset: 4,  overhang: '5prime' },
  // TaqI: TCGA — 5′ CG overhang; cuts T|CGA → cutOffset=1, compCutOffset=3
  { name: 'TaqI',    recognitionSequence: 'TCGA',   cutOffset: 1, complementCutOffset: 3,  overhang: '5prime' },
  // Tsp509I: AATT — 5′ overhang
  { name: 'Tsp509I', recognitionSequence: 'AATT',   cutOffset: 0, complementCutOffset: 4,  overhang: '5prime' },
  // CfoI: GCGC — isoschizomer of HhaI (GCG|C, 2-nt 3′ overhang); cutOffset=3, compCutOffset=1 (QA2 W27)
  { name: 'CfoI',    recognitionSequence: 'GCGC',   cutOffset: 3, complementCutOffset: 1,  overhang: '3prime' },
  // Csp6I: GTAC — isoschizomer of RsaI
  { name: 'Csp6I',   recognitionSequence: 'GTAC',   cutOffset: 1, complementCutOffset: 3,  overhang: '5prime' },

  // ── 6-cutters (common, already in restriction-sites.ts) ─────────────────────
  { name: 'EcoRI',   recognitionSequence: 'GAATTC',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  { name: 'BamHI',   recognitionSequence: 'GGATCC',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  { name: 'HindIII', recognitionSequence: 'AAGCTT',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  { name: 'XbaI',    recognitionSequence: 'TCTAGA',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  { name: 'SalI',    recognitionSequence: 'GTCGAC',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // PstI: CTGCAG — cuts CTGCA|G → 3′ overhang ACGT; cutOffset=5, compCutOffset=1
  { name: 'PstI',    recognitionSequence: 'CTGCAG',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  { name: 'XhoI',    recognitionSequence: 'CTCGAG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  { name: 'NcoI',    recognitionSequence: 'CCATGG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // NdeI: CATATG — cuts CA|TATG → 5′ TA overhang
  { name: 'NdeI',    recognitionSequence: 'CATATG',  cutOffset: 2, complementCutOffset: 4,  overhang: '5prime' },
  { name: 'SpeI',    recognitionSequence: 'ACTAGT',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // KpnI: GGTACC — cuts GGTAC|C → 3′ overhang GTAC; cutOffset=5, compCutOffset=1
  { name: 'KpnI',    recognitionSequence: 'GGTACC',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // SacI: GAGCTC — cuts GAGCT|C → 3′ overhang AGCT; cutOffset=5, compCutOffset=1
  { name: 'SacI',    recognitionSequence: 'GAGCTC',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // SmaI: CCCGGG — cuts CCC|GGG → blunt
  { name: 'SmaI',    recognitionSequence: 'CCCGGG',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  { name: 'BglII',   recognitionSequence: 'AGATCT',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // ClaI: ATCGAT — cuts AT|CGAT → 5′ CG overhang
  { name: 'ClaI',    recognitionSequence: 'ATCGAT',  cutOffset: 2, complementCutOffset: 4,  overhang: '5prime' },
  // EcoRV: GATATC — blunt
  { name: 'EcoRV',   recognitionSequence: 'GATATC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  { name: 'AgeI',    recognitionSequence: 'ACCGGT',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  { name: 'NheI',    recognitionSequence: 'GCTAGC',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  { name: 'MluI',    recognitionSequence: 'ACGCGT',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  { name: 'ScaI',    recognitionSequence: 'AGTACT',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // ApaI: GGGCCC — cuts GGGCC|C → 3′ overhang GGCC (same as ApaI complement)
  { name: 'ApaI',    recognitionSequence: 'GGGCCC',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // SphI: GCATGC — cuts GCATG|C → 3′ overhang CATG
  { name: 'SphI',    recognitionSequence: 'GCATGC',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // NotI: GCGGCCGC — cuts GC|GGCCGC → 5′ GGCC overhang
  { name: 'NotI',    recognitionSequence: 'GCGGCCGC', cutOffset: 2, complementCutOffset: 6, overhang: '5prime' },

  // ── 6-cutters (expanded per task spec) ──────────────────────────────────────
  // AatII: GACGTC — cuts GACGT|C → 3′ overhang ACGT
  { name: 'AatII',   recognitionSequence: 'GACGTC',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // AccI: GTMKAC — cuts GT|MKAC → 5′ MKAC overhang (degenerate); cutOffset=2, compCutOffset=4
  { name: 'AccI',    recognitionSequence: 'GTMKAC',  cutOffset: 2, complementCutOffset: 4,  overhang: '5prime' },
  // AflII: CTTAAG — cuts C|TTAAG → 5′ TTAA overhang
  { name: 'AflII',   recognitionSequence: 'CTTAAG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // ApaLI: GTGCAC — cuts G|TGCAC → 5′ TGCA overhang
  { name: 'ApaLI',   recognitionSequence: 'GTGCAC',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // AscI: GGCGCGCC — cuts GG|CGCGCC → 5′ CGCG overhang
  { name: 'AscI',    recognitionSequence: 'GGCGCGCC', cutOffset: 2, complementCutOffset: 6, overhang: '5prime' },
  // AseI: ATTAAT — cuts AT|TAAT → 5′ TA overhang
  { name: 'AseI',    recognitionSequence: 'ATTAAT',  cutOffset: 2, complementCutOffset: 4,  overhang: '5prime' },
  // AvrII: CCTAGG — cuts C|CTAGG → 5′ CTAG overhang
  { name: 'AvrII',   recognitionSequence: 'CCTAGG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BclI: TGATCA — cuts T|GATCA → 5′ GATC overhang
  { name: 'BclI',    recognitionSequence: 'TGATCA',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BlpI: GCTNAGC — cuts GC|TNAGC → 5′ TNA overhang (degenerate); cut after pos 2
  { name: 'BlpI',    recognitionSequence: 'GCTNAGC', cutOffset: 2, complementCutOffset: 5,  overhang: '5prime' },
  // BmtI: GCTAGC — NheI neoschizomer that cuts GCTAG^C → 1-nt 3′ overhang C (NEB R0658); 5/1 3prime (QA2 W28: was 1/5 5prime = NheI's cut)
  { name: 'BmtI',    recognitionSequence: 'GCTAGC',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // BsiWI: CGTACG — cuts C|GTACG → 5′ GTAC overhang
  { name: 'BsiWI',   recognitionSequence: 'CGTACG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BspEI: TCCGGA — cuts T|CCGGA → 5′ CCGG overhang
  { name: 'BspEI',   recognitionSequence: 'TCCGGA',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BspHI: TCATGA — cuts T|CATGA → 5′ CATG overhang (compatible with NcoI)
  { name: 'BspHI',   recognitionSequence: 'TCATGA',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BsrGI: TGTACA — cuts T|GTACA → 5′ GTAC overhang
  { name: 'BsrGI',   recognitionSequence: 'TGTACA',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BstBI: TTCGAA — cuts TT|CGAA → 5′ CG overhang
  { name: 'BstBI',   recognitionSequence: 'TTCGAA',  cutOffset: 2, complementCutOffset: 4,  overhang: '5prime' },
  // BstEII: GGTNACC — cuts G|GTNACC → 5′ GTNAC overhang; cut at pos 1
  { name: 'BstEII',  recognitionSequence: 'GGTNACC', cutOffset: 1, complementCutOffset: 6,  overhang: '5prime' },
  // BstXI: CCANNNNNNTGG — cuts CCANNNNN^NTGG → 4-nt 3′ overhang (NEB R0113); 8/4 3prime (QA2 W28: was 2/10 5prime)
  { name: 'BstXI',   recognitionSequence: 'CCANNNNNNTGG', cutOffset: 8, complementCutOffset: 4, overhang: '3prime' },
  // DraI: TTTAAA — blunt; cuts TTT|AAA
  { name: 'DraI',    recognitionSequence: 'TTTAAA',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // EagI: CGGCCG — cuts C|GGCCG → 5′ GGCC overhang (neoschizomer of NotI)
  { name: 'EagI',    recognitionSequence: 'CGGCCG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // FseI: GGCCGGCC — cuts GGCCGG|CC → 3′ overhang GGCC
  { name: 'FseI',    recognitionSequence: 'GGCCGGCC', cutOffset: 6, complementCutOffset: 2, overhang: '3prime' },
  // FspI: TGCGCA — blunt; cuts TGC|GCA
  { name: 'FspI',    recognitionSequence: 'TGCGCA',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // HincII: GTYRAC — blunt; cuts GTY|RAC (degenerate)
  { name: 'HincII',  recognitionSequence: 'GTYRAC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // HpaI: GTTAAC — blunt; cuts GTT|AAC
  { name: 'HpaI',    recognitionSequence: 'GTTAAC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // KasI: GGCGCC — cuts G|GCGCC → 5′ GCGC overhang
  { name: 'KasI',    recognitionSequence: 'GGCGCC',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // MfeI: CAATTG — cuts C|AATTG → 5′ AATT overhang (compatible with EcoRI)
  { name: 'MfeI',    recognitionSequence: 'CAATTG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // NarI: GGCGCC — cuts GG|CGCC → 5′ CG overhang
  { name: 'NarI',    recognitionSequence: 'GGCGCC',  cutOffset: 2, complementCutOffset: 4,  overhang: '5prime' },
  // NgoMIV: GCCGGC — cuts G|CCGGC → 5′ CCGG overhang
  { name: 'NgoMIV',  recognitionSequence: 'GCCGGC',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // NruI: TCGCGA — blunt; cuts TCG|CGA
  { name: 'NruI',    recognitionSequence: 'TCGCGA',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // NsiI: ATGCAT — cuts ATGCA|T → 3′ overhang TGCA (compatible with PstI)
  { name: 'NsiI',    recognitionSequence: 'ATGCAT',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // PacI: TTAATTAA — cuts TTAAT|TAA → 3′ overhang TAAT; cut at pos 5, comp at pos 3
  { name: 'PacI',    recognitionSequence: 'TTAATTAA', cutOffset: 5, complementCutOffset: 3, overhang: '3prime' },
  // PciI: ACATGT — cuts A|CATGT → 5′ CATG overhang (compatible with NcoI)
  { name: 'PciI',    recognitionSequence: 'ACATGT',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // PmeI: GTTTAAAC — blunt; cuts GTTT|AAAC
  { name: 'PmeI',    recognitionSequence: 'GTTTAAAC', cutOffset: 4, complementCutOffset: 4, overhang: 'blunt'  },
  // PmlI: CACGTG — blunt; cuts CAC|GTG
  { name: 'PmlI',    recognitionSequence: 'CACGTG',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // PpuMI: RGGWCCY — cuts RG^GWCCY → 3-nt 5′ overhang GWC (NEB R0506); 2/5 (QA2 W28: was 1/6, cut after lone R)
  { name: 'PpuMI',   recognitionSequence: 'RGGWCCY', cutOffset: 2, complementCutOffset: 5,  overhang: '5prime' },
  // PsiI: TTATAA — blunt; cuts TTT|AAA (cuts midpoint: TTT→ no, TTAT|AA)
  // Actually PsiI cuts TTA|TAA → blunt
  { name: 'PsiI',    recognitionSequence: 'TTATAA',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // PvuI: CGATCG — cuts CGAT|CG → 2-nt 3′ overhang AT (NEB R0150); cutOffset=4, compCutOffset=2 (QA2 W27: was 5/1)
  { name: 'PvuI',    recognitionSequence: 'CGATCG',  cutOffset: 4, complementCutOffset: 2,  overhang: '3prime' },
  // PvuII: CAGCTG — blunt; cuts CAG|CTG
  { name: 'PvuII',   recognitionSequence: 'CAGCTG',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // SacII: CCGCGG — cuts CC|GCGG → 3′ overhang GC (actually cuts CC|GCGG on sense, GC on antisense)
  // SacII: sense CC|GCGG, antisense GC|CGGG → produces 3′ GC overhang
  { name: 'SacII',   recognitionSequence: 'CCGCGG',  cutOffset: 4, complementCutOffset: 2,  overhang: '3prime' },
  // SbfI: CCTGCAGG — cuts CCTGCA|GG → 3′ overhang TGCA (compatible with PstI)
  { name: 'SbfI',    recognitionSequence: 'CCTGCAGG', cutOffset: 6, complementCutOffset: 2, overhang: '3prime' },
  // SfoI: GGCGCC — blunt; cuts GGC|GCC
  { name: 'SfoI',    recognitionSequence: 'GGCGCC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // SgrAI: CRCCGGYG — cuts CR^CCGGYG → 4-nt 5′ overhang CCGG (NEB R0603); 2/6 (QA2 W28: was 1/7, cut after lone C)
  { name: 'SgrAI',   recognitionSequence: 'CRCCGGYG', cutOffset: 2, complementCutOffset: 6, overhang: '5prime' },
  // SnaBI: TACGTA — blunt; cuts TAC|GTA
  { name: 'SnaBI',   recognitionSequence: 'TACGTA',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // SrfI: GCCCGGGC — blunt; cuts GCCC|GGGC
  { name: 'SrfI',    recognitionSequence: 'GCCCGGGC', cutOffset: 4, complementCutOffset: 4, overhang: 'blunt'  },
  // StuI: AGGCCT — blunt; cuts AGG|CCT
  { name: 'StuI',    recognitionSequence: 'AGGCCT',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // SwaI: ATTTAAAT — blunt; cuts ATTT|AAAT
  { name: 'SwaI',    recognitionSequence: 'ATTTAAAT', cutOffset: 4, complementCutOffset: 4, overhang: 'blunt'  },
  // XmaI: CCCGGG — cuts C|CCGGG → 5′ CCGG overhang (neoschizomer of SmaI)
  { name: 'XmaI',    recognitionSequence: 'CCCGGG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },

  // ── Additional common 6-cutters ─────────────────────────────────────────────
  // BspDI: ATCGAT — isoschizomer of ClaI
  { name: 'BspDI',   recognitionSequence: 'ATCGAT',  cutOffset: 2, complementCutOffset: 4,  overhang: '5prime' },
  // BspMII: TCCGGA — isoschizomer of BspEI
  { name: 'BspMII',  recognitionSequence: 'TCCGGA',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BstYI: RGATCY — cuts R|GATCY → 5′ GATC overhang; compatible with BamHI/BglII
  { name: 'BstYI',   recognitionSequence: 'RGATCY',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // Cfr10I: RCCGGY — cuts R|CCGGY → 5′ CCGG overhang
  { name: 'Cfr10I',  recognitionSequence: 'RCCGGY',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // DraIII: CACNNNGTG — cuts CACNN|NGTG → 3′ overhang
  { name: 'DraIII',  recognitionSequence: 'CACNNNGTG', cutOffset: 6, complementCutOffset: 3, overhang: '3prime' },
  // AlwNI: CAGNNNCTG — interrupted palindrome with a 3-N spacer, identical cut
  // geometry to DraIII: cuts CAGNNN|CTG / G|TCNNNCAC → 3-nt 3′ recessed overhang
  // (REBASE). Mirrors DraIII's 6/3 offsets. (R18 #53a: was missing entirely.)
  { name: 'AlwNI',   recognitionSequence: 'CAGNNNCTG', cutOffset: 6, complementCutOffset: 3, overhang: '3prime' },
  // EcoO109I: RGGNCCY — cuts RG^GNCCY → 3-nt 5′ overhang GNC (NEB R0503); 2/5 (QA2 W28: was 1/6, cut after lone R)
  { name: 'EcoO109I',recognitionSequence: 'RGGNCCY', cutOffset: 2, complementCutOffset: 5,  overhang: '5prime' },
  // HpaI: already added above
  // MscI: TGGCCA — blunt; cuts TGG|CCA
  { name: 'MscI',    recognitionSequence: 'TGGCCA',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // NaeI: GCCGGC — blunt; cuts GCC|GGC
  { name: 'NaeI',    recognitionSequence: 'GCCGGC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // NcoI: already added
  // NheI: already added
  // NsiI: already added
  // PaeR7I: CTCGAG — isoschizomer of XhoI
  { name: 'PaeR7I',  recognitionSequence: 'CTCGAG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // PciI: already added
  // SacI: already added
  // SfiI: GGCCNNNNNGGCC — cuts GGCCN|NNNNGGCC → 3′ overhang
  { name: 'SfiI',    recognitionSequence: 'GGCCNNNNNGGCC', cutOffset: 8, complementCutOffset: 5, overhang: '3prime' },
  // SgrDI: CGTCGACG — cuts CGTCG|ACG → overlap
  // Note: SgrDI recognition is CGTCGACG, cuts CG|TCGACG? No — SgrDI = CG|TCGAC(2/3) → 5′ TC overhang
  { name: 'SgrDI',   recognitionSequence: 'CGTCGACG', cutOffset: 2, complementCutOffset: 6, overhang: '5prime' },
  // SphI: already added
  // SrfI: already added
  // StuI: already added
  // SwaI: already added
  // SstI (SacI isoschizomer): GAGCTC
  { name: 'SstI',    recognitionSequence: 'GAGCTC',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // SstII (SacII isoschizomer): CCGCGG
  { name: 'SstII',   recognitionSequence: 'CCGCGG',  cutOffset: 4, complementCutOffset: 2,  overhang: '3prime' },
  // XhoII: RGATCY — isoschizomer of BstYI; cuts R|GATCY
  { name: 'XhoII',   recognitionSequence: 'RGATCY',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // XmaIII: CGGCCG — isoschizomer of EagI; cuts C|GGCCG
  { name: 'XmaIII',  recognitionSequence: 'CGGCCG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },

  // ── 8-cutters ───────────────────────────────────────────────────────────────
  // AsiSI: GCGATCGC — cuts GCGAT|CGC → 3′ overhang GATCG → actually
  // AsiSI: GCGAT|CGC(sense), GCG|ATCGC(antisense) → 3′ overhang, but actually it generates
  // a 2-base 3′ overhang AT. Let me be precise: cuts after pos 5 sense, pos 3 antisense.
  { name: 'AsiSI',   recognitionSequence: 'GCGATCGC', cutOffset: 5, complementCutOffset: 3, overhang: '3prime' },
  // CspCI: recognition is CAANNNNNGTGG (Type IIS-like but technically Type II)
  // SbfI: already added
  // Sse8387I: CCTGCAGG — isoschizomer of SbfI
  { name: 'Sse8387I',recognitionSequence: 'CCTGCAGG', cutOffset: 6, complementCutOffset: 2, overhang: '3prime' },
  // Sse8647I: AGGWCCT — cuts AG^GWCCT → 3-nt 5′ overhang GWC (REBASE caret AG^GWCCT); 2/5 (QA2 W28: was 3/4)
  { name: 'Sse8647I',recognitionSequence: 'AGGWCCT', cutOffset: 2, complementCutOffset: 5,  overhang: '5prime' },

  // ── Type IIS enzymes ─────────────────────────────────────────────────────────
  // Convention: for ENZYME(N₁/N₂) downstream the cut is:
  //   cutOffset = len(recognition) + 1 + N₁  (after the spacer N₁ bases)
  //   complementCutOffset = len(recognition) + 1 + N₂
  //
  // BsaI: GGTCTC(1/5) — recognition 6 bp, cuts 1 nt downstream on sense, 5 nt on antisense
  //   cutOffset = 6+1+1 = 8? No — standard notation: the enzyme cuts 1 nt 3′ of last bp on sense.
  //   Using the offset-from-recognition-start convention:
  //     sense cut after position 6+1 = position 7 (0-indexed: after index 6)
  //     antisense cut after position 6+5 = position 11
  { name: 'BsaI',    recognitionSequence: 'GGTCTC',  cutOffset: 7,  complementCutOffset: 11, overhang: '5prime' },
  // BbsI (BpiI): GAAGAC(2/6)
  //   cutOffset = 6+1+2 = 9? Standard: cuts 2 nt downstream on sense → position 6+2=8, antisense 6+6=12
  { name: 'BbsI',    recognitionSequence: 'GAAGAC',  cutOffset: 8,  complementCutOffset: 12, overhang: '5prime' },
  // BsmBI (Esp3I): CGTCTC(1/5) — isoschizomer of BsaI (different recognition)
  { name: 'BsmBI',   recognitionSequence: 'CGTCTC',  cutOffset: 7,  complementCutOffset: 11, overhang: '5prime' },
  // Esp3I: CGTCTC(1/5) — isoschizomer of BsmBI
  { name: 'Esp3I',   recognitionSequence: 'CGTCTC',  cutOffset: 7,  complementCutOffset: 11, overhang: '5prime' },
  // SapI: GCTCTTC(1/4)
  //   cutOffset = 7+1 = 8, complementCutOffset = 7+4 = 11
  { name: 'SapI',    recognitionSequence: 'GCTCTTC', cutOffset: 8,  complementCutOffset: 11, overhang: '5prime' },
  // BtgZI: GCGATG(10/14) — recognition 6 bp, 4-nt 5′ extension (NEB R0703)
  //   cutOffset = 6+10 = 16, complementCutOffset = 6+14 = 20 (QA2 W27: was 2/10 = 8/16)
  { name: 'BtgZI',   recognitionSequence: 'GCGATG',  cutOffset: 16,  complementCutOffset: 20, overhang: '5prime' },
  // BpiI (alternative name for BbsI/isoschizomer): GAAGAC(2/6)
  { name: 'BpiI',    recognitionSequence: 'GAAGAC',  cutOffset: 8,  complementCutOffset: 12, overhang: '5prime' },
  // BsaXI: GCAGNN(9/12) — complex Type IIS; recognition 8 bp (actually NNNNNNNTCNNNNNNN)
  // Skip BsaXI — too complex for standard model
  // LguI (SapI isoschizomer): GCTCTTC(1/4)
  { name: 'LguI',    recognitionSequence: 'GCTCTTC', cutOffset: 8,  complementCutOffset: 11, overhang: '5prime' },
  // BtgZI: already added
  // BsmFI: GGGAC(10/14)
  //   recognition 5 bp; cutOffset = 5+10=15, compCutOffset = 5+14=19
  { name: 'BsmFI',   recognitionSequence: 'GGGAC',   cutOffset: 15, complementCutOffset: 19, overhang: '5prime' },
  // BspQI (SapI isoschizomer): GCTCTTC(1/4)
  { name: 'BspQI',   recognitionSequence: 'GCTCTTC', cutOffset: 8,  complementCutOffset: 11, overhang: '5prime' },

  // ── Nicking enzymes ──────────────────────────────────────────────────────────
  // These enzymes nick only one strand. We encode the sense-strand nick as cutOffset.
  // Nb.BbvCI nicks the sense strand of CCTCAGC at +2 downstream → cutOffset = 7+2 = 9
  // Note: complementCutOffset is not applicable for nicking enzymes; we set it to cutOffset.
  { name: 'Nb.BbvCI',  recognitionSequence: 'CCTCAGC', cutOffset: 9,  complementCutOffset: 9,  overhang: 'blunt' },
  // Nt.BbvCI nicks the antisense strand of CCTCAGC
  { name: 'Nt.BbvCI',  recognitionSequence: 'CCTCAGC', cutOffset: 2,  complementCutOffset: 2,  overhang: 'blunt' },
  // Nt.BstNBI: GAGTC — nicks sense strand +4 downstream → cutOffset = 5+4 = 9
  { name: 'Nt.BstNBI', recognitionSequence: 'GAGTC',   cutOffset: 9,  complementCutOffset: 9,  overhang: 'blunt' },

  // ── Miscellaneous useful enzymes ─────────────────────────────────────────────
  // BseYI: CCCAGC(−5/−1) — upstream cutter (cuts 5 nt upstream on sense)
  // Represented as negative offset; skip complex upstream cutters for now.
  // AclI: AACGTT — cuts AA|CGTT → 5′ CG overhang
  { name: 'AclI',    recognitionSequence: 'AACGTT',  cutOffset: 2, complementCutOffset: 4,  overhang: '5prime' },
  // AflIII: ACRYGT — cuts A|CRYGT → 5′ CRYGТ overhang
  { name: 'AflIII',  recognitionSequence: 'ACRYGT',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // AhdI: GACNNNNNGTC — cuts GACNNN|NNGTC → 1-nt 3′ overhang (NEB R0584); cutOffset=6, compCutOffset=5 (QA2 W27: was mislabeled blunt)
  { name: 'AhdI',    recognitionSequence: 'GACNNNNNGTC', cutOffset: 6, complementCutOffset: 5, overhang: '3prime' },
  // BaeGI: GKGCMC — cuts G|KGCMC → 5′ KGCM overhang
  // AleI: CACNNNNGTG — cuts CAC|NNNNGTG → blunt
  { name: 'AleI',    recognitionSequence: 'CACNNNNGTG', cutOffset: 5, complementCutOffset: 5, overhang: 'blunt' },
  // BaeI: (10/15)ACNNNNGTAYYC(12/7) — complex; skip
  // BglI: GCCNNNNNGGC — cuts GCCNN|NNNGGC → 3′ overhang; actually blunt? BglI leaves 3-nt 3′ overhang
  // BglI: cuts after pos 7 on sense, pos 4 on antisense → 3′ overhang NNN
  { name: 'BglI',    recognitionSequence: 'GCCNNNNNGGC', cutOffset: 7, complementCutOffset: 4, overhang: '3prime' },
  // BsaBI: GATNNNNATC — cuts GATNN|NNATC → blunt
  { name: 'BsaBI',   recognitionSequence: 'GATNNNNATC', cutOffset: 5, complementCutOffset: 5, overhang: 'blunt' },
  // BsiEI: CGRY|CG → 3′ overhang
  { name: 'BsiEI',   recognitionSequence: 'CGRYCG',  cutOffset: 4, complementCutOffset: 2,  overhang: '3prime' },
  // BsiHKAI: GWGCWC — cuts GWGCW^C → 4-nt 3′ overhang WGCW (SphI/HgiAI family); 5/1 3prime (QA2 W28: was 1/5 5prime)
  { name: 'BsiHKAI', recognitionSequence: 'GWGCWC',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // BsoBI: CYCGRG — cuts C|YCGRG → 5′ YCGR overhang (like XhoI family)
  { name: 'BsoBI',   recognitionSequence: 'CYCGRG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BspHI: already added
  // BsrFαI: RCCGGY — cuts R|CCGGY → 5′ CCGG overhang
  { name: 'BsrFI',   recognitionSequence: 'RCCGGY',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BstAPI: GCANNNNNTGC — cuts GCANNNN^NTGC → 3-nt 3′ overhang (NEB R0654); cutOffset 7 (QA2 W28: was 6, off by one)
  { name: 'BstAPI',  recognitionSequence: 'GCANNNNNTGC', cutOffset: 7, complementCutOffset: 4, overhang: '3prime' },
  // BstZ17I: GTATAC — blunt; cuts GTA|TAC
  { name: 'BstZ17I', recognitionSequence: 'GTATAC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // BtgI: CCRYGG — cuts C|CRYGG → 5′ CRYG overhang
  { name: 'BtgI',    recognitionSequence: 'CCRYGG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // DrdI: GACNNNNNNGTC — cuts GACNNNN|NNGTC → 3-nt 3′ overhang (NEB R0530); cutOffset=7, compCutOffset=4 (QA2 W27: was 7/5 blunt)
  { name: 'DrdI',    recognitionSequence: 'GACNNNNNNGTC', cutOffset: 7, complementCutOffset: 4, overhang: '3prime' },
  // EarI: CTCTTC(1/4) — isoschizomer of SapI
  { name: 'EarI',    recognitionSequence: 'CTCTTC',  cutOffset: 7,  complementCutOffset: 10, overhang: '5prime' },
  // EcoNI: CCCNN|NNNNNNGGGG → 5prime overhang; actually CCCNN(6/5)NNNNNNNGGGG — skip complex form
  // EspI: GCTNAGC — isoschizomer of BlpI
  { name: 'EspI',    recognitionSequence: 'GCTNAGC', cutOffset: 2, complementCutOffset: 5,  overhang: '5prime' },
  // HincII: already added
  // MlsI: TGGCCA — isoschizomer of MscI (blunt)
  { name: 'MlsI',    recognitionSequence: 'TGGCCA',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // MluCI: AATT — 5′ overhang (isoschizomer of Tsp509I)
  { name: 'MluCI',   recognitionSequence: 'AATT',    cutOffset: 0, complementCutOffset: 4,  overhang: '5prime' },
  // NspI: RCATGY — cuts RCATG^Y → 4-nt 3′ overhang CATG (NEB R0602; SphI family); 5/1 3prime (QA2 W28: was 1/5 5prime — the old comment's hedge guessed wrong)
  { name: 'NspI',    recognitionSequence: 'RCATGY',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // SfeI: CTRYAG — cuts C|TRYAG → 5′ TRYA overhang
  { name: 'SfeI',    recognitionSequence: 'CTRYAG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // StuI: already added
  // TaiI: ACGT — blunt? Actually TaiI cuts ACG|T? Let me use: cuts A|CGT → 5′ CGT
  // Actually TaiI: ACGT — cuts between A and CGT? Not well characterized; skip.
  // XcmI: CCANNNNNNNNNTGG — cuts CCA(9/12)NNNNNNTGG → 3′ overhang
  { name: 'XcmI',    recognitionSequence: 'CCANNNNNNNNNTGG', cutOffset: 12, complementCutOffset: 9, overhang: '3prime' },
  // ZraI: GACGTC — BLUNT neoschizomer of AatII; cuts GAC^GTC (NEB R0659); 3/3 blunt (QA2 W28: was 5/1 3prime = AatII's cut — losing the blunt-cutter point)
  { name: 'ZraI',    recognitionSequence: 'GACGTC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt' },

  // ── Additional frequently used enzymes ───────────────────────────────────────
  // AvaI: CYCGRG — isoschizomer of BsoBI; cuts C|YCGRG
  { name: 'AvaI',    recognitionSequence: 'CYCGRG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // AvaII: GGWCC — cuts G|GWCC → 5′ GWCC overhang (5-cutter)
  { name: 'AvaII',   recognitionSequence: 'GGWCC',   cutOffset: 1, complementCutOffset: 4,  overhang: '5prime' },
  // BalI: TGGCCA — isoschizomer of MscI (blunt)
  { name: 'BalI',    recognitionSequence: 'TGGCCA',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // BclI: already added
  // BcuI: ACTAGT — isoschizomer of SpeI
  { name: 'BcuI',    recognitionSequence: 'ACTAGT',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BmgBI: CACGTC — cuts CAC|GTC → blunt? Actually CACGTC → blunt: cuts after pos 3
  { name: 'BmgBI',   recognitionSequence: 'CACGTC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // BsrBI: CCGCTC(3/3) — cuts CCG|CTC → blunt
  { name: 'BsrBI',   recognitionSequence: 'CCGCTC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // BssSI: CACGAG — cuts C|ACGAG → 5′ ACGA overhang? Actually BssSI recognition is CACGAG and leaves 4-nt 5′ overhang
  { name: 'BssSI',   recognitionSequence: 'CACGAG',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // BssHII: GCGCGC — cuts G|CGCGC → 5′ CGCG overhang
  { name: 'BssHII',  recognitionSequence: 'GCGCGC',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // CsiI: cuts ACCGGT (isoschizomer of AgeI)
  { name: 'CsiI',    recognitionSequence: 'ACCGGT',  cutOffset: 1, complementCutOffset: 5,  overhang: '5prime' },
  // Eco53kI: GAGCTC — isoschizomer of SacI (blunt actually? No, Eco53kI cuts GAG|CTC = blunt)
  { name: 'Eco53kI', recognitionSequence: 'GAGCTC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // EcoT22I: ATGCAT — isoschizomer of NsiI
  { name: 'EcoT22I', recognitionSequence: 'ATGCAT',  cutOffset: 5, complementCutOffset: 1,  overhang: '3prime' },
  // HindII: GTYRAC — isoschizomer of HincII (blunt)
  { name: 'HindII',  recognitionSequence: 'GTYRAC',  cutOffset: 3, complementCutOffset: 3,  overhang: 'blunt'  },
  // MboII: GAAGA(8/7) — Type IIS, single-base 3′ extension (NEB R0148); offsets 13/12 imply 3prime (QA2 W28: label was 5prime, wrong strand for this non-palindromic overhang)
  { name: 'MboII',   recognitionSequence: 'GAAGA',   cutOffset: 13, complementCutOffset: 12, overhang: '3prime' },
  // MfeI: already added
  // MluI: already added
  // MscI: already added
  // PaeR7I: already added
  // Sse8387I: already added
  // StuI: already added
  // TasI: AATT — isoschizomer of MluCI
  { name: 'TasI',    recognitionSequence: 'AATT',    cutOffset: 0, complementCutOffset: 4,  overhang: '5prime' },
  // TfiI: GAWTC — cuts G|AWTC → 5′ AWTC overhang? Actually TfiI: cuts G|AWTC
  { name: 'TfiI',    recognitionSequence: 'GAWTC',   cutOffset: 1, complementCutOffset: 4,  overhang: '5prime' },
  // TseI: GCWGC — cuts G|CWGC → 5′ CWGC overhang? Actually TseI cuts G|CWGC but let's use:
  { name: 'TseI',    recognitionSequence: 'GCWGC',   cutOffset: 1, complementCutOffset: 4,  overhang: '5prime' },
  // Tth111I: GACNNNGTC — cuts GACN^NNGTC → single-base 5′ overhang (NEB R0185; odd central spacer → 5′, unlike AhdI/DrdI 3′); 4/5 5prime (QA2 W28: was 5/4 3prime, swapped+inverted)
  { name: 'Tth111I', recognitionSequence: 'GACNNNGTC', cutOffset: 4, complementCutOffset: 5, overhang: '5prime' },
];

// Export the count so callers can sanity-check
export const ENZYME_COUNT = RESTRICTION_ENZYMES_FULL.length;
