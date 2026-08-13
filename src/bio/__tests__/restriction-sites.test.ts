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
