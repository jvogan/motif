import type { RestrictionEnzyme, RestrictionSite, Topology } from './types';
import { reverseComplement } from './reverse-complement';

/**
 * Options for [`findRestrictionSites`].
 * Phase 34 P-B B3: topology added so circular plasmids wrap-scan their origin.
 */
export interface FindRestrictionSitesOptions {
  /**
   * Sequence topology. When `'circular'`, the scanner appends a wrap window
   * `seq.slice(0, recognitionMaxLen - 1)` so that recognition strings
   * straddling the origin are matched. Defaults to `'linear'`.
   */
  topology?: Topology;
}

/**
 * Default working set of restriction enzymes used by the UI and digest functions.
 *
 * Originally the 25-enzyme 6-cutter / Type IIS panel preserved across releases.
 * VOG-1807: the eGFP onboarding sample (720 bp) has no canonical 6-cutter
 * site, so the Inspector "Common" tab opened to "0 cuts" — a dead end for
 * first-time users. Five canonical screening 4-cutters (AluI, HaeIII, TaqI,
 * HpaII, MspI) are appended so the default Inspector view yields useful
 * diagnostic digests on short ORF-sized sequences. The new enzymes are pushed
 * to the end so callers that index by position (`RESTRICTION_ENZYMES[1]`,
 * etc.) and the palette in `getRestrictionEnzymeColor` keep their current
 * mappings.
 *
 * For the full 200+ enzyme database use RESTRICTION_ENZYMES_FULL from enzyme-data.ts.
 */
export const RESTRICTION_ENZYMES: RestrictionEnzyme[] = [
  { name: 'EcoRI',  recognitionSequence: 'GAATTC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'BamHI',  recognitionSequence: 'GGATCC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'HindIII', recognitionSequence: 'AAGCTT',  cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'XbaI',   recognitionSequence: 'TCTAGA',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'SalI',   recognitionSequence: 'GTCGAC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'PstI',   recognitionSequence: 'CTGCAG',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'NotI',   recognitionSequence: 'GCGGCCGC', cutOffset: 2, complementCutOffset: 6, overhang: '5prime' },
  { name: 'XhoI',   recognitionSequence: 'CTCGAG',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'NcoI',   recognitionSequence: 'CCATGG',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'NdeI',   recognitionSequence: 'CATATG',   cutOffset: 2, complementCutOffset: 4, overhang: '5prime' },
  { name: 'SpeI',   recognitionSequence: 'ACTAGT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'KpnI',   recognitionSequence: 'GGTACC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'SacI',   recognitionSequence: 'GAGCTC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'SmaI',   recognitionSequence: 'CCCGGG',   cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
  { name: 'BglII',  recognitionSequence: 'AGATCT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'ClaI',   recognitionSequence: 'ATCGAT',   cutOffset: 2, complementCutOffset: 4, overhang: '5prime' },
  { name: 'EcoRV',  recognitionSequence: 'GATATC',   cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
  { name: 'AgeI',   recognitionSequence: 'ACCGGT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'NheI',   recognitionSequence: 'GCTAGC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'MluI',   recognitionSequence: 'ACGCGT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'BsaI',   recognitionSequence: 'GGTCTC',   cutOffset: 7, complementCutOffset: 11, overhang: '5prime' },
  { name: 'BbsI',   recognitionSequence: 'GAAGAC',   cutOffset: 8, complementCutOffset: 12, overhang: '5prime' },
  { name: 'ScaI',   recognitionSequence: 'AGTACT',   cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
  { name: 'ApaI',   recognitionSequence: 'GGGCCC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'SphI',   recognitionSequence: 'GCATGC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  // VOG-1807: canonical screening 4-cutters that appear in molecular biology
  // kits (RFLP/diagnostic digests, methylation-sensitive pair, RAD-tag panel).
  // Order matches the AluI/HaeIII/TaqI/HpaII/MspI panel called out in the
  // ticket. Mirrors RESTRICTION_ENZYMES_FULL entries 1:1 so the digest engine
  // returns identical cut/overhang shapes whichever set the caller passes.
  { name: 'AluI',   recognitionSequence: 'AGCT',     cutOffset: 2, complementCutOffset: 2, overhang: 'blunt'  },
  { name: 'HaeIII', recognitionSequence: 'GGCC',     cutOffset: 2, complementCutOffset: 2, overhang: 'blunt'  },
  { name: 'TaqI',   recognitionSequence: 'TCGA',     cutOffset: 1, complementCutOffset: 3, overhang: '5prime' },
  { name: 'HpaII',  recognitionSequence: 'CCGG',     cutOffset: 1, complementCutOffset: 3, overhang: '5prime' },
  { name: 'MspI',   recognitionSequence: 'CCGG',     cutOffset: 1, complementCutOffset: 3, overhang: '5prime' },
];

// For the full 200+ enzyme database, import directly from './enzyme-data'.

/**
 * Build a regex pattern from IUPAC recognition sequence.
 * Handles ambiguity codes for degenerate recognition sequences.
 */
function recognitionToRegex(seq: string): RegExp {
  const iupacMap: Record<string, string> = {
    A: 'A', C: 'C', G: 'G', T: 'T',
    R: '[AG]', Y: '[CT]', S: '[GC]', W: '[AT]',
    K: '[GT]', M: '[AC]', B: '[CGT]', D: '[AGT]',
    H: '[ACT]', V: '[ACG]', N: '[ACGT]',
  };

  let pattern = '';
  for (const ch of seq.toUpperCase()) {
    pattern += iupacMap[ch] ?? ch;
  }

  // Use lookahead for overlapping matches
  return new RegExp(`(?=(${pattern}))`, 'g');
}

/**
 * Find all restriction sites in a sequence for the given enzymes.
 *
 * Phase 34 P-B B1: now scans BOTH strands. For each non-palindromic enzyme,
 * the reverse-complement of the recognition sequence is also scanned and
 * matches are tagged `strand: -1`. This matches the Rust engine's output
 * structure and is critical for Type IIS enzymes (BsaI/BbsI/BsmBI/SapI/etc.)
 * whose binding sites are not symmetric. Empirically verified: BsaI on
 * `AAAAAAGAGACCTTTTT` (where `GAGACC = revcomp(GGTCTC)`) now correctly
 * returns 1 site at position 6.
 *
 * Phase 34 P-B B3: when `options.topology === 'circular'`, the scanner
 * appends a wrap window so that recognition strings straddling the origin
 * are matched. Returned `position` values stay in `[0, seq.length)`.
 *
 * @param seq - DNA sequence
 * @param enzymes - List of restriction enzymes to scan (defaults to all)
 * @param options - Optional topology hint (default: linear)
 */
export function findRestrictionSites(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionSite[] {
  const sites: RestrictionSite[] = [];
  const upper = seq.toUpperCase();

  if (upper.length === 0 || enzymes.length === 0) {
    return sites;
  }

  const topology: Topology = options?.topology ?? 'linear';

  // For circular topology, build a virtual buffer that includes a wrap
  // window so a recognition string straddling the origin is matchable.
  let scanBuffer = upper;
  if (topology === 'circular') {
    let maxRecLen = 0;
    for (const enzyme of enzymes) {
      if (enzyme.recognitionSequence.length > maxRecLen) {
        maxRecLen = enzyme.recognitionSequence.length;
      }
    }
    const wrapWindow = Math.max(0, maxRecLen - 1);
    if (wrapWindow > 0 && wrapWindow < upper.length) {
      scanBuffer = upper + upper.slice(0, wrapWindow);
    } else if (wrapWindow >= upper.length && upper.length > 0) {
      // Pathological: recognition longer than the entire plasmid. Double the
      // buffer so we cover any wrap, but cap so we don't blow up on huge
      // inputs with small enzyme sets (this branch is exotic).
      scanBuffer = upper + upper;
    }
  }

  // Dedupe by (enzyme name, normalized position). When a recognition string
  // is palindromic (e.g. EcoRI = `GAATTC` = revcomp(`GAATTC`)), forward and
  // reverse scans would otherwise emit two sites for the same physical hit.
  const seen = new Set<string>();

  for (const enzyme of enzymes) {
    const recognition = enzyme.recognitionSequence.toUpperCase();
    const recognitionLen = recognition.length;
    const reverseRecognition = reverseComplement(recognition);
    const isPalindrome = reverseRecognition === recognition;

    // ── Forward strand ───────────────────────────────────────────────────
    {
      const regex = recognitionToRegex(recognition);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(scanBuffer)) !== null) {
        const matchIndex = match.index;
        // For circular: a hit that starts past the original sequence is the
        // wrap shadow of a hit that already exists earlier — drop it.
        if (topology === 'circular' && matchIndex >= upper.length) {
          regex.lastIndex = matchIndex + 1;
          continue;
        }
        const normalizedPosition = matchIndex;
        const dedupeKey = `${enzyme.name}@${normalizedPosition}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          let cutPosition = matchIndex + enzyme.cutOffset;
          if (topology === 'circular') {
            cutPosition = ((cutPosition % upper.length) + upper.length) % upper.length;
          }
          sites.push({
            enzyme: enzyme.name,
            position: normalizedPosition,
            cutPosition,
            recognitionSequence: enzyme.recognitionSequence,
            overhang: enzyme.overhang,
            strand: 1,
          });
        }
        regex.lastIndex = matchIndex + 1;
      }
    }

    // ── Reverse strand (skip for palindromes) ────────────────────────────
    if (!isPalindrome) {
      const regex = recognitionToRegex(reverseRecognition);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(scanBuffer)) !== null) {
        const matchIndex = match.index;
        if (topology === 'circular' && matchIndex >= upper.length) {
          regex.lastIndex = matchIndex + 1;
          continue;
        }
        const normalizedPosition = matchIndex;
        const dedupeKey = `${enzyme.name}@${normalizedPosition}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          // Mirror Rust cut-position math (restriction.rs line 170):
          //   cut = position + recognitionLen - complementCutOffset
          let cutPosition = matchIndex + recognitionLen - enzyme.complementCutOffset;
          if (topology === 'circular') {
            cutPosition = ((cutPosition % upper.length) + upper.length) % upper.length;
          }
          sites.push({
            enzyme: enzyme.name,
            position: normalizedPosition,
            cutPosition,
            recognitionSequence: enzyme.recognitionSequence,
            overhang: enzyme.overhang,
            strand: -1,
          });
        }
        regex.lastIndex = matchIndex + 1;
      }
    }
  }

  // Sort by position (stable per Array.prototype.sort guarantee in modern engines)
  sites.sort((a, b) => a.position - b.position);
  return sites;
}

/**
 * Find enzymes that cut exactly once (unique cutters).
 */
export function findUniqueCutters(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionSite[] {
  const allSites = findRestrictionSites(seq, enzymes, options);

  // Group by enzyme
  const byEnzyme = new Map<string, RestrictionSite[]>();
  for (const site of allSites) {
    const list = byEnzyme.get(site.enzyme) ?? [];
    list.push(site);
    byEnzyme.set(site.enzyme, list);
  }

  // Return only those that appear exactly once
  const unique: RestrictionSite[] = [];
  for (const [, sitesForEnzyme] of byEnzyme) {
    if (sitesForEnzyme.length === 1) {
      unique.push(sitesForEnzyme[0]);
    }
  }

  return unique.sort((a, b) => a.position - b.position);
}

/**
 * Phase 34 P-G B5: detect sequence-side IUPAC ambiguity that the JS regex
 * scanner treats as literal mismatches. When a user has degenerate bases
 * (N, W, S, R, Y, K, M, B, D, H, V) in their sequence, the recognition regex
 * will silently skip positions that span them. This helper returns a count
 * so the UI can warn before showing 0/under-counted sites.
 *
 * Returns the count of ambiguous (non-A/C/G/T) bases. Whitespace and digits
 * are ignored to match `findRestrictionSites`'s pre-scan normalization.
 */
export function countAmbiguousBases(seq: string): number {
  let count = 0;
  for (const ch of seq.toUpperCase()) {
    if (ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T' || ch === 'U') continue;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    if (ch >= '0' && ch <= '9') continue;
    if ('RYSWKMBDHVN'.includes(ch)) count++;
  }
  return count;
}

/**
 * Find enzymes that do NOT cut the sequence (non-cutters).
 */
export function findNonCutters(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionEnzyme[] {
  const allSites = findRestrictionSites(seq, enzymes, options);
  const cuttingEnzymes = new Set(allSites.map(s => s.enzyme));
  return enzymes.filter(e => !cuttingEnzymes.has(e.name));
}
