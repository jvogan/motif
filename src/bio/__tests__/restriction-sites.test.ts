import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import { reverseComplement } from '../reverse-complement';
import {
  RESTRICTION_ENZYMES,
  classifyRestrictionEnzymes,
  findNonCutters,
  findRestrictionSites,
  isActiveDoubleStrandRestrictionSite,
  MAX_RESTRICTION_ENZYMES,
  MAX_RESTRICTION_RESULT_BYTES,
  MAX_RESTRICTION_RESULT_SITES,
  RestrictionScanResultLimitError,
  normalizeRestrictionEnzymeNames,
  normalizeRestrictionEnzymes,
  scanRestrictionSites,
  restrictionSiteActivity,
} from '../restriction-sites';
import { digestPreviewDetailed, restrictionDigestDetailed } from '../restriction-digest';
import { resolveEnzymeUnion } from '../restriction-presets';
import type { RestrictionEnzyme } from '../types';

function enzyme(name: string) {
  const match = RESTRICTION_ENZYMES.find((candidate) => candidate.name === name);
  if (!match) throw new Error(`Missing restriction enzyme fixture: ${name}`);
  return match;
}

const iupacBases: Record<string, readonly string[]> = {
  A: ['A'], C: ['C'], G: ['G'], T: ['T'],
  R: ['A', 'G'], Y: ['C', 'T'], S: ['G', 'C'], W: ['A', 'T'],
  K: ['G', 'T'], M: ['A', 'C'], B: ['C', 'G', 'T'], D: ['A', 'G', 'T'],
  H: ['A', 'C', 'T'], V: ['A', 'C', 'G'], N: ['A', 'C', 'G', 'T'],
};

function materializeRecognitionSequence(recognitionSequence: string): string {
  return [...recognitionSequence.toUpperCase()]
    .map((base) => iupacBases[base]?.[0] ?? base)
    .join('');
}

function reverseOnlyRecognitionExample(recognitionSequence: string): string | null {
  const forward = recognitionSequence.toUpperCase();
  const reverse = reverseComplement(forward);
  if (reverse === forward) return null;
  const sequence = [...reverse].map((base) => iupacBases[base]?.[0] ?? base);
  for (let index = 0; index < reverse.length; index++) {
    const forwardChoices = new Set(iupacBases[forward[index]] ?? [forward[index]]);
    const reverseOnlyBase = (iupacBases[reverse[index]] ?? [reverse[index]])
      .find((base) => !forwardChoices.has(base));
    if (reverseOnlyBase) {
      sequence[index] = reverseOnlyBase;
      return sequence.join('');
    }
  }
  return null;
}

describe('restriction-site scanning', () => {
  it('anchors every catalog recognition sequence and sense-strand cut at its actual match', () => {
    for (const candidate of RESTRICTION_ENZYMES_FULL) {
      const sequence = materializeRecognitionSequence(candidate.recognitionSequence);
      const sites = findRestrictionSites(sequence, [candidate]);

      expect(sites, candidate.name).toContainEqual(expect.objectContaining({
        enzyme: candidate.name,
        position: 0,
        cutPosition: candidate.cutOffset,
        recognitionSequence: candidate.recognitionSequence,
        overhang: candidate.overhang,
        strand: 1,
        cleavageMode: candidate.cleavageMode ?? 'double-strand',
        topCutPosition: candidate.cleavageMode === 'nick_bottom' ? null : candidate.cutOffset,
        bottomCutPosition: candidate.cleavageMode === 'nick_top' ? null : candidate.complementCutOffset,
      }));
    }
  });

  it('anchors every non-palindromic catalog entry on the reverse strand with its mirrored cut', () => {
    let checked = 0;
    for (const candidate of RESTRICTION_ENZYMES_FULL) {
      const sequence = reverseOnlyRecognitionExample(candidate.recognitionSequence);
      if (!sequence) continue;
      checked += 1;
      const sites = findRestrictionSites(sequence, [candidate]);

      expect(sites, candidate.name).toContainEqual(expect.objectContaining({
        enzyme: candidate.name,
        position: 0,
        cutPosition: candidate.recognitionSequence.length - candidate.complementCutOffset,
        recognitionSequence: candidate.recognitionSequence,
        overhang: candidate.overhang,
        strand: -1,
        cleavageMode: candidate.cleavageMode ?? 'double-strand',
        topCutPosition: candidate.cleavageMode === 'nick_bottom'
          ? null
          : candidate.recognitionSequence.length - candidate.complementCutOffset,
        bottomCutPosition: candidate.cleavageMode === 'nick_top'
          ? null
          : candidate.recognitionSequence.length - candidate.cutOffset,
      }));
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('reports a non-palindromic reverse-strand Type IIS site with its mirrored cut', () => {
    const sites = findRestrictionSites('AAAAAAGAGACCTTTTT', [enzyme('BsaI')]);

    expect(sites).toEqual([expect.objectContaining({
      enzyme: 'BsaI',
      position: 6,
      cutPosition: 1,
      recognitionSequence: 'GGTCTC',
      overhang: '5prime',
      strand: -1,
      cleavageMode: 'double-strand',
      topCutPosition: 1,
      bottomCutPosition: 5,
      cleavageStatus: 'ok',
    })]);
  });

  it('retains distinct physical geometries when an asymmetric ambiguous site matches both strands', () => {
    const asymmetric: RestrictionEnzyme = {
      name: 'AsymmetricAmbiguous',
      recognitionSequence: 'RNNN',
      cutOffset: 1,
      complementCutOffset: 2,
      overhang: '5prime',
    };
    const sites = findRestrictionSites('ACCC', [asymmetric]);

    expect(sites).toHaveLength(2);
    expect(sites.map(({ strand, position, topCutPosition, bottomCutPosition }) => ({
      strand,
      position,
      topCutPosition,
      bottomCutPosition,
    }))).toEqual(expect.arrayContaining([
      { strand: 1, position: 0, topCutPosition: 1, bottomCutPosition: 2 },
      { strand: -1, position: 0, topCutPosition: 2, bottomCutPosition: 3 },
    ]));
  });

  it('merges strand matches only when their physical cut geometry is identical', () => {
    const symmetricGeometry: RestrictionEnzyme = {
      name: 'SymmetricGeometryAmbiguous',
      recognitionSequence: 'RNNN',
      cutOffset: 1,
      complementCutOffset: 3,
      overhang: '5prime',
    };
    const sites = findRestrictionSites('ACCC', [symmetricGeometry]);

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      strand: 1,
      topCutPosition: 1,
      bottomCutPosition: 3,
    });
  });

  it('finds and wraps a palindromic site that crosses a circular origin once', () => {
    const sequence = 'AATTCCCCCG';
    const ecoRI = enzyme('EcoRI');

    expect(findRestrictionSites(sequence, [ecoRI])).toEqual([]);
    expect(findRestrictionSites(sequence, [ecoRI], { topology: 'circular' })).toEqual([expect.objectContaining({
      enzyme: 'EcoRI',
      position: 9,
      cutPosition: 0,
      recognitionSequence: 'GAATTC',
      overhang: '5prime',
      strand: 1,
      cleavageMode: 'double-strand',
      topCutPosition: 0,
      bottomCutPosition: 4,
      cleavageStatus: 'ok',
    })]);
  });

  it('keeps physical safety fields enumerable across spreads and JSON round trips', () => {
    const [site] = findRestrictionSites('AAAAAGAATTCAAAA', [enzyme('EcoRI')]);
    expect(Object.keys(site)).toEqual(expect.arrayContaining([
      'cleavageMode',
      'topCutPosition',
      'bottomCutPosition',
      'cleavageStatus',
    ]));
    const spread = { ...site };
    const restored = JSON.parse(JSON.stringify(site)) as typeof site;
    expect(spread).toMatchObject({
      cleavageMode: 'double-strand',
      topCutPosition: 6,
      bottomCutPosition: 10,
      cleavageStatus: 'ok',
    });
    expect(restored).toMatchObject(spread);
    expect(isActiveDoubleStrandRestrictionSite(restored)).toBe(true);

    const legacy = { ...site };
    delete legacy.cleavageMode;
    delete legacy.topCutPosition;
    delete legacy.bottomCutPosition;
    delete legacy.cleavageStatus;
    expect(restrictionSiteActivity(legacy)).toBe('legacy-unsafe');
    expect(isActiveDoubleStrandRestrictionSite(legacy)).toBe(false);
  });

  it('resolves Common enzymes to full catalog methylation records', () => {
    const full = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === 'HpaII');
    const common = RESTRICTION_ENZYMES.find((candidate) => candidate.name === 'HpaII');
    const resolved = resolveEnzymeUnion(['common']).find((candidate) => candidate.name === 'HpaII');
    expect(full?.methylationRequirement).toMatchObject({ target: 'cpg', state: 'unmethylated' });
    expect(common).toBe(full);
    expect(resolved).toBe(full);
    expect(resolved?.methylationRequirement?.evidence?.source).toMatch(/^https:\/\/www\.neb\.com\//);
  });

  it('categorizes no-site, nick, conditional, and incomplete legacy outcomes', () => {
    const nick = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === 'Nb.BbvCI');
    const conditional = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === 'DpnI');
    if (!nick || !conditional) throw new Error('Missing activity-category fixture');
    const sequence = 'AAAAGATCAAAA';
    const [noSite] = classifyRestrictionEnzymes('AAAAAAAAAAAA', [conditional]);
    const [conditionalSite] = classifyRestrictionEnzymes(sequence, [conditional]);
    const [nickSite] = classifyRestrictionEnzymes(nick.recognitionSequence + 'AAAAAAAA', [nick]);
    expect(noSite.category).toBe('no-site');
    expect(conditionalSite.category).toBe('conditional');
    expect(nickSite.category).toBe('nick-only');
    expect(classifyRestrictionEnzymes(sequence, [conditional])[0].activeDoubleStrandSiteCount).toBe(0);
    expect(findNonCutters(sequence, [conditional, nick]).map((candidate) => candidate.name))
      .toEqual([conditional.name, nick.name]);
  });

  it('validates runtime topology, custom enzyme geometry, and scan work before matching', () => {
    const custom = {
      name: 'SignedOffset',
      recognitionSequence: 'AAAA',
      cutOffset: -1,
      complementCutOffset: 3,
      overhang: '5prime' as const,
    };
    expect(() => findRestrictionSites('AAAA', [custom], { topology: 'wrapped' as never })).toThrow(/linear.*circular/i);
    expect(scanRestrictionSites('AAAA', [custom]).issues).toContainEqual(expect.objectContaining({
      code: 'insufficient_flanking_bases',
    }));
    expect(() => findRestrictionSites('AAAA', [{ ...custom, name: 'bad\u0000name' }])).toThrow(/control/i);
    expect(() => findRestrictionSites('AAAA', Array.from({ length: MAX_RESTRICTION_ENZYMES + 1 }, (_, index) => ({
      ...custom,
      name: `E${index}`,
      cutOffset: 0,
      complementCutOffset: 0,
      recognitionSequence: 'A',
      overhang: 'blunt' as const,
    })))).toThrow(/at most/i);

    const longPatterns = Array.from({ length: 10 }, (_, index) => ({
      ...custom,
      name: `Long${index}`,
      recognitionSequence: `${'A'.repeat(63)}C`,
      cutOffset: 0,
      complementCutOffset: 64,
      overhang: 'blunt' as const,
    }));
    expect(() => findRestrictionSites('A'.repeat(1_000_000), longPatterns)).toThrow(/scan requires.*orientations|safety limit/i);
  });

  it('returns a typed incomplete receipt before site output can grow without bound', () => {
    const anyBase = (name: string): RestrictionEnzyme => ({
      name,
      recognitionSequence: 'N',
      cutOffset: 0,
      complementCutOffset: 0,
      overhang: 'blunt',
    });
    const sequence = 'A'.repeat(MAX_RESTRICTION_RESULT_SITES + 1);
    const detailed = scanRestrictionSites(sequence, [anyBase('Any-A'), anyBase('Any-B')]);

    expect(detailed.complete).toBe(false);
    expect(detailed.sites).toHaveLength(MAX_RESTRICTION_RESULT_SITES);
    expect(detailed.diagnostics[0]).toMatchObject({
      code: 'result_limit',
      retainedSites: MAX_RESTRICTION_RESULT_SITES,
      omittedSitesAtLeast: expect.any(Number),
    });
    expect(detailed.issues.at(-1)).toMatchObject({ code: 'result_limit' });
    expect(() => findRestrictionSites(sequence, [anyBase('Any-A'), anyBase('Any-B')]))
      .toThrow(RestrictionScanResultLimitError);
  });

  it('charges repeated methylation evidence using serialized UTF-8 bytes', () => {
    const evidenceText = `${'\u0800'.repeat(4_000)}"\\`;
    const evidence = {
      source: evidenceText,
      sourceLabel: evidenceText,
      conditions: evidenceText,
      limitation: evidenceText,
    };
    const methylationSensitive: RestrictionEnzyme = {
      name: 'EvidenceHeavyI',
      recognitionSequence: 'A',
      cutOffset: 0,
      complementCutOffset: 0,
      overhang: 'blunt',
      methylationRequirement: {
        target: 'custom',
        state: 'methylated',
        evidence,
      },
    };

    const detailed = scanRestrictionSites('A'.repeat(1_000), [methylationSensitive]);
    expect(detailed.complete).toBe(false);
    expect(detailed.sites.length).toBeLessThan(1_000);
    expect(detailed.issues[0]?.evidence).toEqual(evidence);
    expect(detailed.issues.at(-1)).toMatchObject({ code: 'result_limit' });
    expect(new TextEncoder().encode(JSON.stringify(detailed)).byteLength)
      .toBeLessThanOrEqual(MAX_RESTRICTION_RESULT_BYTES);
  });

  it('normalizes classifier identities and digest-preview count keys once', () => {
    const spaced = { ...enzyme('EcoRI'), name: ' EcoRI ' };
    const [receipt] = classifyRestrictionEnzymes('GAATTCAAAA', [spaced]);
    expect(receipt.enzyme.name).toBe('EcoRI');
    expect(receipt.category).toBe('active-double-strand');
    expect(receipt.activeDoubleStrandSiteCount).toBe(1);
    expect(findNonCutters('GAATTCAAAA', [spaced])).toEqual([]);

    const preview = digestPreviewDetailed('GAATTC', [' ecori ']);
    expect([...preview.counts.entries()]).toEqual([['EcoRI', 1]]);
  });

  it('projects findNonCutters from one bounded scan', () => {
    const encoderPrototype = TextEncoder.prototype;
    const originalEncode = encoderPrototype.encode;
    let encodeCalls = 0;
    encoderPrototype.encode = function instrumentedEncode(value?: string): ReturnType<TextEncoder['encode']> {
      encodeCalls += 1;
      return originalEncode.call(this, value) as ReturnType<TextEncoder['encode']>;
    };

    try {
      expect(findNonCutters('GAATTCAAAA', [enzyme('EcoRI')])).toEqual([]);
    } finally {
      encoderPrototype.encode = originalEncode;
    }

    // One initial result-envelope measurement and one retained-site
    // measurement are enough for this complete one-site scan. A second full
    // scan would repeat both measurements.
    expect(encodeCalls).toBe(2);
  });

  it('marks circular geometry that would traverse the source more than once', () => {
    const pathological: RestrictionEnzyme = {
      name: 'LongCircularGeometry',
      recognitionSequence: 'A',
      cutOffset: 0,
      complementCutOffset: 20,
      overhang: '5prime',
    };
    const detailed = scanRestrictionSites('A'.repeat(10), [pathological], { topology: 'circular' });
    expect(detailed.complete).toBe(true);
    expect(detailed.sites[0]).toMatchObject({ cleavageStatus: 'invalid_geometry' });
    expect(detailed.issues[0]).toMatchObject({ code: 'circular_geometry_exceeds_molecule' });
  });

  it('keeps invalid enzyme-name failure receipts bounded', () => {
    const requested = Array.from({ length: 200_000 }, (_, index) => `E${index}`);
    const result = restrictionDigestDetailed('AAAA', requested);
    expect(result.issues[0]?.code).toBe('invalid_enzyme_name');
    expect(result.requestedEnzymes).toHaveLength(MAX_RESTRICTION_ENZYMES);
    expect(result.requestedEnzymeCount).toBe(requested.length);
    expect(result.requestedEnzymesTruncated).toBe(true);
  });

  it('does not invoke rejected enzyme-name accessors while building failure receipts', () => {
    let accessorReads = 0;
    const requested: string[] = [];
    Object.defineProperty(requested, '0', {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'EcoRI';
      },
    });
    requested.length = 1;

    const result = restrictionDigestDetailed('GAATTC', requested);
    expect(result.issues[0]).toMatchObject({ code: 'invalid_enzyme_name' });
    expect(result.requestedEnzymes).toEqual(['<accessor>']);
    expect(accessorReads).toBe(0);
  });

  it('rejects sparse enzyme-name and catalog arrays before indexing them', () => {
    const sparseNames = new Array<string>(1);
    expect(() => normalizeRestrictionEnzymeNames(sparseNames)).toThrow(/sparse|missing/i);
    const nameDigest = restrictionDigestDetailed('GAATTC', sparseNames as never);
    expect(nameDigest.issues[0]).toMatchObject({ code: 'invalid_enzyme_name' });

    const sparseCatalog = [enzyme('EcoRI')] as RestrictionEnzyme[];
    sparseCatalog.length = 2;
    expect(() => normalizeRestrictionEnzymes(sparseCatalog)).toThrow(/sparse|missing/i);

    const digest = restrictionDigestDetailed(
      'GAATTC',
      ['EcoRI'],
      'linear',
      undefined,
      sparseCatalog,
    );
    expect(digest.fragments).toEqual([]);
    expect(digest.issues).toContainEqual(expect.objectContaining({ code: 'invalid_recognition_sequence' }));
  });

  it('rejects accessor-backed direct enzyme fields without invoking them', () => {
    const accessor = { ...enzyme('EcoRI') } as RestrictionEnzyme;
    Object.defineProperty(accessor, 'recognitionSequence', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error('accessor must not run');
      },
    });

    expect(() => normalizeRestrictionEnzymes([accessor])).toThrow(/direct data|accessor/i);
  });
});

describe('restriction site caching', () => {
  const randomSequence = (length: number, seed: number): string => {
    const bases = 'ACGT';
    let state = seed >>> 0;
    let out = '';
    for (let i = 0; i < length; i += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out += bases[(state >>> 16) & 3];
    }
    return out;
  };

  const timeScan = (
    seq: string,
    enzymes: RestrictionEnzyme[],
    options?: Parameters<typeof findRestrictionSites>[2],
  ): number => {
    const started = performance.now();
    findRestrictionSites(seq, enzymes, options);
    return performance.now() - started;
  };

  it('answers a repeat scan from the cache', () => {
    // Five independent pairs, comparing the fastest of each: a minimum is far
    // steadier than a mean when a garbage collection can land inside any one
    // sample. The real gap is two orders of magnitude, so the 3x floor is only
    // here to keep this from failing on a loaded machine.
    const misses: number[] = [];
    const hits: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const seq = randomSequence(20_000, 0x51ed + i);
      misses.push(timeScan(seq, RESTRICTION_ENZYMES, { topology: 'circular' }));
      hits.push(timeScan(seq, RESTRICTION_ENZYMES, { topology: 'circular' }));
    }
    expect(Math.min(...hits) * 3).toBeLessThan(Math.min(...misses));
  });

  it('bounds what it keeps, so a long session cannot leak', () => {
    const first = randomSequence(4_000, 0xb0d1);
    findRestrictionSites(first, RESTRICTION_ENZYMES);
    const whileWarm = timeScan(first, RESTRICTION_ENZYMES);
    // More distinct sequences than the cache holds, so the first is evicted.
    for (let i = 0; i < 40; i += 1) {
      findRestrictionSites(randomSequence(4_000, 0xe1c7 + i), RESTRICTION_ENZYMES);
    }
    expect(whileWarm * 3).toBeLessThan(timeScan(first, RESTRICTION_ENZYMES));
  });

  it('hands every caller its own sites', () => {
    const seq = randomSequence(3_000, 0xa11a5);
    const onMiss = findRestrictionSites(seq, RESTRICTION_ENZYMES);
    const firstHit = findRestrictionSites(seq, RESTRICTION_ENZYMES);
    const secondHit = findRestrictionSites(seq, RESTRICTION_ENZYMES);
    const expected = onMiss.map((site) => ({ ...site }));
    expect(onMiss.length).toBeGreaterThan(0);
    expect(firstHit).toEqual(onMiss);
    // Not one shared array, and not one shared set of site objects, between
    // the caller that filled the cache and the two that read it.
    expect(firstHit).not.toBe(onMiss);
    expect(secondHit).not.toBe(firstHit);
    expect(secondHit[0]).not.toBe(firstHit[0]);
    expect(firstHit[0]).not.toBe(onMiss[0]);

    // Reorder and edit what a hit handed back; the next caller must still get
    // the answer the scan produced.
    firstHit.sort((a, b) => b.position - a.position);
    firstHit[0].cutPosition = -999;
    firstHit.length = 1;
    // And do the same to what the miss handed back, which is the array the
    // cache is holding.
    onMiss.sort((a, b) => a.cutPosition - b.cutPosition);
    onMiss[0].enzyme = 'clobbered';
    onMiss.length = 2;
    expect(findRestrictionSites(seq, RESTRICTION_ENZYMES)).toEqual(expected);
  });

  it('separates two enzymes that share a name but not a cut', () => {
    // The enzyme list is user-editable, so a name is not an identity. A key
    // built from names alone would answer the second scan with the first
    // scan's cut positions, which in a cloning tool is a wrong answer rather
    // than a slow one.
    const seq = 'TTTTGAATTCTTTTGAATTCTTTT';
    const near: RestrictionEnzyme[] = [
      { name: 'FakeI', recognitionSequence: 'GAATTC', cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
    ];
    const far: RestrictionEnzyme[] = [
      { name: 'FakeI', recognitionSequence: 'GAATTC', cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
    ];
    expect(findRestrictionSites(seq, near).map((site) => site.cutPosition)).toEqual([5, 15]);
    expect(findRestrictionSites(seq, far).map((site) => site.cutPosition)).toEqual([7, 17]);
  });

  it('separates two scans that differ only in methylation state', () => {
    const seq = 'TTTTGATCTTTTGATCTTTT';
    const enzymes: RestrictionEnzyme[] = [
      {
        name: 'FakeDamI',
        recognitionSequence: 'GATC',
        cutOffset: 2,
        complementCutOffset: 2,
        overhang: 'blunt',
        methylationRequirement: { target: 'dam', state: 'unmethylated' },
      },
    ];
    const statuses = (options?: Parameters<typeof findRestrictionSites>[2]): (string | undefined)[] =>
      findRestrictionSites(seq, enzymes, options).map((site) => site.cleavageStatus);
    expect(statuses({ methylation: { dam: 'unmethylated' } })).toEqual(['ok', 'ok']);
    expect(statuses({ methylation: { dam: 'methylated' } })).toEqual([
      'methylation_unmethylated',
      'methylation_unmethylated',
    ]);
    expect(statuses()).toEqual(['methylation_unknown', 'methylation_unknown']);
  });

  it('separates two scans that differ only in topology', () => {
    // The site straddles the origin, so it exists on the circle and not on the
    // line. One cache entry shared between the two would invent or lose a cut.
    const seq = 'ATTCTTTTTTTTTTTTTTGA';
    const enzymes: RestrictionEnzyme[] = [
      { name: 'FakeI', recognitionSequence: 'GAATTC', cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
    ];
    expect(findRestrictionSites(seq, enzymes, { topology: 'circular' }).map((site) => site.position)).toEqual([18]);
    expect(findRestrictionSites(seq, enzymes, { topology: 'linear' })).toEqual([]);
  });
});
