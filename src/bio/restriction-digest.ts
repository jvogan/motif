import type { Topology, Feature, RestrictionEnzyme } from './types';
import { findRestrictionSites } from './restriction-sites';
import { RESTRICTION_ENZYMES_FULL } from './enzyme-data';
import { reverseComplement } from './reverse-complement';
import { remapFeatureLocation, type FeatureCoordinateMapSpan } from './feature-location';

type RestrictionOverhangType = 'blunt' | '5prime' | '3prime';

interface FragmentEnd {
  overhang: string;
  type: RestrictionOverhangType;
}

const BLUNT_END: FragmentEnd = { overhang: '', type: 'blunt' };

function readSenseOverhang(seq: string, start: number, end: number, topology: Topology): string {
  const upper = seq.toUpperCase();
  if (end <= start || upper.length === 0) return '';

  if (topology === 'linear') {
    if (start < 0 || end > upper.length) return '';
    return upper.slice(start, end);
  }

  let overhang = '';
  for (let pos = start; pos < end; pos += 1) {
    const idx = ((pos % upper.length) + upper.length) % upper.length;
    overhang += upper[idx];
  }
  return overhang;
}

export interface DigestFragment {
  sequence: string;
  length: number;
  startInOriginal: number;
  endInOriginal: number;
  leftEnzyme: string | null;
  rightEnzyme: string | null;
  overhang5: string;
  overhang3: string;
  overhang5Type: RestrictionOverhangType;
  overhang3Type: RestrictionOverhangType;
  features: Feature[];
}

/**
 * Preview how many times each enzyme cuts a sequence.
 * Returns a map of enzyme name → cut count.
 */
export function digestPreview(
  seq: string,
  enzymeNames: string[],
  topology: Topology = 'linear',
): Map<string, number> {
  const enzymes = RESTRICTION_ENZYMES_FULL.filter(e => enzymeNames.includes(e.name));
  const sites = findRestrictionSites(seq, enzymes, { topology });

  const counts = new Map<string, number>();
  for (const name of enzymeNames) {
    counts.set(name, 0);
  }
  for (const site of sites) {
    counts.set(site.enzyme, (counts.get(site.enzyme) ?? 0) + 1);
  }
  return counts;
}

/**
 * Perform a restriction digest on a sequence.
 * @param seq - The DNA sequence to digest
 * @param enzymeNames - Names of enzymes to cut with
 * @param topology - 'linear' or 'circular'
 * @returns Array of fragments sorted by position
 */
export function restrictionDigest(
  seq: string,
  enzymeNames: string[],
  topology: Topology = 'linear',
  features?: Feature[],
  enzymeCatalog: readonly RestrictionEnzyme[] = RESTRICTION_ENZYMES_FULL,
): DigestFragment[] {
  /** Keep only complete feature products and remap every authoritative piece. */
  function sliceFeaturesThroughSpans(sourceSpans: readonly FeatureCoordinateMapSpan[]): Feature[] {
    if (!features || features.length === 0) return [];
    return features.flatMap((feature) => {
      const location = remapFeatureLocation(feature, sourceSpans);
      return location ? [{
        ...feature,
        ...location,
        id: crypto.randomUUID(),
      }] : [];
    });
  }

  /** Filter parent features that fall entirely within [fragStart, fragEnd) and offset them. */
  function sliceFeatures(fragStart: number, fragEnd: number): Feature[] {
    return sliceFeaturesThroughSpans([{
      start: fragStart,
      end: fragEnd,
      targetStart: 0,
    }]);
  }

  /**
   * Wrap-aware feature slicer for a CIRCULAR fragment that straddles the origin:
   * the fragment sequence is the tail `[tailStart, seq.length)` followed by the
   * head `[0, headEnd)`. Multipart features can span both pieces as long as no
   * individual authoritative segment crosses a physical cut boundary.
   */
  function sliceFeaturesWrap(tailStart: number, headEnd: number): Feature[] {
    const tailLen = seq.length - tailStart;
    return sliceFeaturesThroughSpans([
      { start: tailStart, end: seq.length, targetStart: 0 },
      { start: 0, end: headEnd, targetStart: tailLen },
    ]);
  }

  const requestedNames = new Set(enzymeNames.map((name) => name.toLowerCase()));
  const enzymes = enzymeCatalog.filter((enzyme) => requestedNames.has(enzyme.name.toLowerCase()));
  const enzymeByName = new Map(enzymes.map((enzyme) => [enzyme.name, enzyme]));
  // Phase 34 P-B B1/B3: pass topology so circular plasmids wrap-scan and
  // both strands are searched for Type IIS (BsaI/BbsI/etc.) enzymes.
  const sites = findRestrictionSites(seq, enzymes, { topology });

  type Cut = { position: number; sitePosition: number; enzyme: string; strand: number };

  function cutEnds(cut: Cut): { left: FragmentEnd; right: FragmentEnd } {
    const enzyme = enzymeByName.get(cut.enzyme);
    if (!enzyme || enzyme.overhang === 'blunt' || enzyme.cutOffset === enzyme.complementCutOffset) {
      return { left: BLUNT_END, right: BLUNT_END };
    }

    // The two strand nicks straddle a single-stranded overhang of width `gap`.
    // Locate the LEFT (lower-index) nick so the window is always
    // [leftCut, leftCut + gap). For a forward-strand site the nicks sit at
    // sitePosition + cutOffset / + complementCutOffset. For a reverse-strand
    // (minus) site the geometry mirrors about the recognition sequence, so the
    // nicks sit at sitePosition + recognitionLen - {cutOffset, complementCutOffset}.
    // (Phase R10 D1: the old code used sitePosition + min/max UNCONDITIONALLY,
    // which read the window from the WRONG side of a minus-strand, non-palindromic
    // Type IIS site — e.g. a minus BsaI site whose fragment physically begins
    // `CCCC…` reported overhang `TTTT`, silently corrupting Golden Gate / Type IIS
    // junction-compatibility prediction. Palindromic enzymes only ever match the
    // forward scan, so they were and remain unaffected; the forward-strand window
    // is byte-identical to before — min(a,b)…min(a,b)+gap.)
    const recognitionLen = enzyme.recognitionSequence.length;
    const gap = Math.abs(enzyme.cutOffset - enzyme.complementCutOffset);
    const leftCut = cut.strand === -1
      ? cut.sitePosition + recognitionLen - Math.max(enzyme.cutOffset, enzyme.complementCutOffset)
      : cut.sitePosition + Math.min(enzyme.cutOffset, enzyme.complementCutOffset);
    const senseOverhang = readSenseOverhang(seq, leftCut, leftCut + gap, topology);
    if (senseOverhang.length === 0) {
      return { left: BLUNT_END, right: BLUNT_END };
    }

    const stickyOverhang = enzyme.overhang === '3prime'
      ? reverseComplement(senseOverhang)
      : senseOverhang;

    // `.left` is consumed as a fragment's `overhang5` (the fragment on the
    // DOWNSTREAM side of this cut, whose 5' end this is); `.right` as the
    // upstream fragment's `overhang3`. The single-stranded 5' protrusion belongs
    // to the downstream fragment and equals the sense-strand bases it physically
    // begins with — so `overhang5` must be `stickyOverhang` itself, and the
    // upstream `overhang3` the complementary strand. (QA2 W19, cloning-bio agent
    // F1: these were reverse-complemented, swapping the two ends. Invisible for
    // palindromic overhangs — rc(palindrome) === palindrome — so it only mislabe-
    // led non-palindromic / Type IIS enzymes, e.g. BsaI's downstream overhang5
    // read as rc(CAGT)=ACTG instead of CAGT. Product sequences were never
    // affected; only the recorded/displayed/exported overhang string was.)
    return {
      left: { overhang: stickyOverhang, type: enzyme.overhang },
      right: { overhang: reverseComplement(stickyOverhang), type: enzyme.overhang },
    };
  }

  if (sites.length === 0) {
    // No cuts — return the whole sequence as one fragment
    return [{
      sequence: seq,
      length: seq.length,
      startInOriginal: 0,
      endInOriginal: seq.length,
      leftEnzyme: null,
      rightEnzyme: null,
      overhang5: BLUNT_END.overhang,
      overhang3: BLUNT_END.overhang,
      overhang5Type: BLUNT_END.type,
      overhang3Type: BLUNT_END.type,
      features: sliceFeatures(0, seq.length),
    }];
  }

  // Get sorted cut positions with enzyme info
  const cuts = sites.map(s => ({
    position: s.cutPosition,
    sitePosition: s.position,
    enzyme: s.enzyme,
    // Undefined strand (legacy/forward-only sites) is treated as the forward
    // strand, preserving the prior geometry; only strand === -1 mirrors.
    strand: s.strand ?? 1,
  }));

  // Deduplicate cut positions (multiple enzymes cutting at same position)
  const uniqueCuts: typeof cuts = [];
  const seenPositions = new Set<number>();
  for (const cut of cuts) {
    if (!seenPositions.has(cut.position)) {
      seenPositions.add(cut.position);
      uniqueCuts.push(cut);
    }
  }
  uniqueCuts.sort((a, b) => a.position - b.position);

  const fragments: DigestFragment[] = [];

  if (topology === 'linear') {
    // Linear: N cuts → N+1 fragments
    for (let i = 0; i <= uniqueCuts.length; i++) {
      const start = i === 0 ? 0 : uniqueCuts[i - 1].position;
      const end = i === uniqueCuts.length ? seq.length : uniqueCuts[i].position;
      const leftEnzyme = i === 0 ? null : uniqueCuts[i - 1].enzyme;
      const rightEnzyme = i === uniqueCuts.length ? null : uniqueCuts[i].enzyme;
      const leftEnd = i === 0 ? BLUNT_END : cutEnds(uniqueCuts[i - 1]).left;
      const rightEnd = i === uniqueCuts.length ? BLUNT_END : cutEnds(uniqueCuts[i]).right;

      if (end > start) {
        fragments.push({
          sequence: seq.slice(start, end),
          length: end - start,
          startInOriginal: start,
          endInOriginal: end,
          leftEnzyme,
          rightEnzyme,
          overhang5: leftEnd.overhang,
          overhang3: rightEnd.overhang,
          overhang5Type: leftEnd.type,
          overhang3Type: rightEnd.type,
          features: sliceFeatures(start, end),
        });
      }
    }
  } else {
    // Circular: N cuts → N fragments (wraps around origin)
    for (let i = 0; i < uniqueCuts.length; i++) {
      const start = uniqueCuts[i].position;
      const nextIdx = (i + 1) % uniqueCuts.length;
      const end = uniqueCuts[nextIdx].position;
      const leftEnzyme = uniqueCuts[i].enzyme;
      const rightEnzyme = uniqueCuts[nextIdx].enzyme;
      const leftEnd = cutEnds(uniqueCuts[i]).left;
      const rightEnd = cutEnds(uniqueCuts[nextIdx]).right;

      let fragSeq: string;
      let fragLength: number;

      if (end > start) {
        fragSeq = seq.slice(start, end);
        fragLength = end - start;
      } else {
        // Wraps around origin
        fragSeq = seq.slice(start) + seq.slice(0, end);
        fragLength = (seq.length - start) + end;
      }

      if (fragLength > 0) {
        fragments.push({
          sequence: fragSeq,
          length: fragLength,
          startInOriginal: start,
          endInOriginal: end > start ? end : end + seq.length,
          leftEnzyme,
          rightEnzyme,
          overhang5: leftEnd.overhang,
          overhang3: rightEnd.overhang,
          overhang5Type: leftEnd.type,
          overhang3Type: rightEnd.type,
          features: end > start ? sliceFeatures(start, end) : sliceFeaturesWrap(start, end),
        });
      }
    }
  }

  return fragments;
}
