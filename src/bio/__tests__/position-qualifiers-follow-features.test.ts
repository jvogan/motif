import { describe, expect, it } from 'vitest';
import { extractFeatureSequence } from '../feature-location';
import { parseGenBank } from '../genbank-parser';
import { applyDeletion, applyInsertion, applyReplacement, applySubstitution } from '../mutate';
import { simulatePCR } from '../pcr';
import { restrictionDigest } from '../restriction-digest';
import { reverseComplement, reverseComplementFeatures } from '../reverse-complement';
import {
  describeDroppedTranslationExceptions,
  droppedTranslationExceptions,
  materializeTranslationExceptions,
  qualifierMapForFeatureSequence,
  qualifierMapForSpans,
  remapPositionQualifiers,
} from '../transl-except';
import type { Feature } from '../types';

// ATG GCA TGA AAA TAA: the TGA is read as Sec, so the protein is MAUK*.
const CDS = 'ATGGCATGAAAATAA';

function secFeature(start: number, strand: 1 | -1, position: string, subRanges?: Feature['subRanges']): Feature {
  return {
    id: 'sec',
    name: 'selenoprotein',
    type: 'cds',
    start,
    end: start + CDS.length,
    strand,
    color: '#888888',
    metadata: {
      transl_except: `(pos:${position},aa:Sec)`,
      motifQualifiers: [{ key: 'transl_except', value: `(pos:${position},aa:Sec)` }],
    },
    ...(subRanges ? { subRanges } : {}),
  };
}

function protein(sequence: string, feature: Feature | undefined): string | null {
  if (!feature) return null;
  const result = materializeTranslationExceptions({ sequence, feature, qualifier: feature.metadata.transl_except });
  return result.ok ? result.materializedProtein : result.diagnostics.map((diagnostic) => diagnostic.code).join(',');
}

const listed = (feature: Feature | undefined) => (feature?.metadata.motifQualifiers as Array<{ value: unknown }> | undefined)
  ?.map((entry) => entry.value);

// A 40 bp record whose CDS starts at base 10: its Sec codon is 1-based 17..19.
const record = `GCTAGCTTAG${CDS}CCTACGTAGGATCCT`;

describe('/transl_except follows its CDS through every coordinate change', () => {
  it('starts from a record that reads Sec', () => {
    expect(protein(record, secFeature(10, 1, '17..19'))).toBe('MAUK*');
  });

  it('whole-record reverse complement mirrors the codon onto the minus strand', () => {
    const [flipped] = reverseComplementFeatures([secFeature(10, 1, '17..19')], record.length);
    expect([flipped.start, flipped.end, flipped.strand]).toEqual([15, 30, -1]);
    expect(flipped.metadata.transl_except).toBe('(pos:complement(22..24),aa:Sec)');
    expect(listed(flipped)).toEqual(['(pos:complement(22..24),aa:Sec)']);
    expect(protein(reverseComplement(record), flipped)).toBe('MAUK*');
    // And back again.
    const [restored] = reverseComplementFeatures([flipped], record.length);
    expect(restored.metadata.transl_except).toBe('(pos:17..19,aa:Sec)');
  });

  describe('sequence edits', () => {
    const features = [secFeature(10, 1, '17..19')];

    it('an insertion upstream moves the codon by the inserted length', () => {
      const edited = applyInsertion(record, [], features, 4, 'GGG');
      expect(edited.features[0].metadata.transl_except).toBe('(pos:20..22,aa:Sec)');
      expect(protein(edited.raw, edited.features[0])).toBe('MAUK*');
    });

    it('an insertion inside the codon drops the entry instead of guessing', () => {
      // Inserting after base 17 (1-based) splits the Sec codon's T|GA.
      const edited = applyInsertion(record, [], features, 16, 'C');
      expect(edited.features[0].metadata).toEqual({ motifQualifiers: [] });
    });

    it('an insertion downstream leaves the codon alone', () => {
      const edited = applyInsertion(record, [], features, 30, 'AAA');
      expect(edited.features[0].metadata.transl_except).toBe('(pos:17..19,aa:Sec)');
    });

    it('a deletion upstream moves the codon back; one through the codon drops it', () => {
      const upstream = applyDeletion(record, [], features, 2, 3);
      expect(upstream.features[0].metadata.transl_except).toBe('(pos:14..16,aa:Sec)');
      expect(protein(upstream.raw, upstream.features[0])).toBe('MAUK*');
      const through = applyDeletion(record, [], features, 17, 1);
      expect(through.features[0].metadata.transl_except).toBeUndefined();
    });

    it('a replacement shifts by its net length and drops a codon it rewrites', () => {
      const upstream = applyReplacement(record, [], features, 0, 2, 'TTTTT');
      expect(upstream.features[0].metadata.transl_except).toBe('(pos:20..22,aa:Sec)');
      expect(protein(upstream.raw, upstream.features[0])).toBe('MAUK*');
      const rewrite = applyReplacement(record, [], features, 16, 3, 'TGC');
      expect(rewrite.features[0].metadata.transl_except).toBeUndefined();
    });

    it('a substitution inside the codon makes another codon, so the Sec entry goes', () => {
      // TGA -> TGC turns the Sec codon into Cys; keeping the override would draw U for C.
      const changed = applySubstitution(record, [], features, 18, 'C');
      expect(changed.features[0].metadata.transl_except).toBeUndefined();
      expect(protein(changed.raw, { ...changed.features[0], metadata: { transl_except: '' } })).toBe('missing_qualifier');
      const elsewhere = applySubstitution(record, [], features, 3, 'C');
      expect(elsewhere.features[0].metadata.transl_except).toBe('(pos:17..19,aa:Sec)');
      const same = applySubstitution(record, [], features, 18, 'A');
      expect(same.features[0].metadata.transl_except).toBe('(pos:17..19,aa:Sec)');
    });

    it('an edit to the middle base of the codon drops the entry too', () => {
      // Base 18 is the G of TGA at 17..19; TGA -> TCA reads Ser, so a kept override would draw U for S.
      for (const edited of [applySubstitution(record, [], features, 17, 'C'), applyReplacement(record, [], features, 17, 1, 'C')]) {
        expect(edited.raw.slice(16, 19)).toBe('TCA');
        expect(edited.features[0].metadata).toEqual({ motifQualifiers: [] });
      }
      // The same codon on the minus strand: base 23 of the flipped record is its middle base.
      const minus = reverseComplement(record);
      const minusFeatures = [secFeature(15, -1, 'complement(22..24)')];
      expect(protein(minus, minusFeatures[0])).toBe('MAUK*');
      for (const edited of [applySubstitution(minus, [], minusFeatures, 22, 'G'), applyReplacement(minus, [], minusFeatures, 22, 1, 'G')]) {
        expect(reverseComplement(edited.raw.slice(21, 24))).toBe('TCA');
        expect(edited.features[0].metadata).toEqual({ motifQualifiers: [] });
      }
    });
  });

  it('a digest fragment carries the codon at its new offset', () => {
    const source = `CCCCGAATTCGG${CDS}GGATCCAA`;
    const cdsStart = source.indexOf(CDS);
    const fragments = restrictionDigest(source, ['EcoRI'], 'linear', [secFeature(cdsStart, 1, `${cdsStart + 7}..${cdsStart + 9}`)]);
    const fragment = fragments.find((entry) => entry.features.length > 0);
    const at = fragment!.sequence.indexOf(CDS);
    expect(at).toBeGreaterThan(-1);
    expect(fragment!.features[0].metadata.transl_except).toBe(`(pos:${at + 7}..${at + 9},aa:Sec)`);
    expect(protein(fragment!.sequence, fragment!.features[0])).toBe('MAUK*');
  });

  it('a PCR product carries the codon past its primer tail', () => {
    const forwardBinding = 'GACCTAGCATGCAGTCGATC';
    const reverseBinding = 'GGATCCTTAGCACGTGACTT';
    const template = `AAAAAAAAAA${forwardBinding}TTAG${CDS}CCAG${reverseBinding}CCCCCCCCCC`;
    const cdsStart = template.indexOf(CDS);
    const result = simulatePCR(
      template,
      `TTTT${forwardBinding}`,
      reverseComplement(reverseBinding),
      [secFeature(cdsStart, 1, `${cdsStart + 7}..${cdsStart + 9}`)],
      'linear',
      { forward: { start: 10, end: 30 }, reverse: { start: 53, end: 73 } },
    );
    const at = result!.product.indexOf(CDS);
    expect(result!.features[0].metadata.transl_except).toBe(`(pos:${at + 7}..${at + 9},aa:Sec)`);
    expect(protein(result!.product, result!.features[0])).toBe('MAUK*');
  });

  describe('a feature taken into its own record', () => {
    it('extracting a minus-strand CDS reads it forward with a plain pos:', () => {
      const minus = reverseComplement(record);
      const feature = secFeature(15, -1, 'complement(22..24)');
      expect(protein(minus, feature)).toBe('MAUK*');
      const extracted = extractFeatureSequence(minus, feature, 'dna');
      const moved = remapPositionQualifiers(feature.metadata, qualifierMapForFeatureSequence(feature));
      expect(moved.transl_except).toBe('(pos:7..9,aa:Sec)');
      expect(protein(extracted, { ...feature, start: 0, end: extracted.length, strand: 1, metadata: moved })).toBe('MAUK*');
    });

    it('extracting a split CDS joins its pieces in reading order', () => {
      // Exon 1 = ATGGCAT (bases 2..8), exon 2 = GAAAATAA (bases 12..19): the Sec codon spans the join.
      const split = `CC${CDS.slice(0, 7)}NNN${CDS.slice(7)}CC`;
      const feature = secFeature(2, 1, '8..8', [{ start: 2, end: 9 }, { start: 12, end: 20 }]);
      feature.end = 20;
      feature.metadata = { transl_except: '(pos:join(9,13..14),aa:Sec)' };
      const extracted = extractFeatureSequence(split, feature, 'dna');
      expect(extracted).toBe(CDS);
      // Once the pieces abut, the codon is one plain range again.
      const moved = remapPositionQualifiers(feature.metadata, qualifierMapForFeatureSequence(feature));
      expect(moved.transl_except).toBe('(pos:7..9,aa:Sec)');
      expect(protein(extracted, { ...feature, start: 0, end: extracted.length, subRanges: undefined, metadata: moved })).toBe('MAUK*');
    });

    it('reverse-complementing a selected forward CDS puts the codon on the minus strand', () => {
      const feature = secFeature(10, 1, '17..19');
      const product = reverseComplement(extractFeatureSequence(record, feature, 'dna'));
      const moved = remapPositionQualifiers(feature.metadata, qualifierMapForFeatureSequence(feature, true));
      expect(moved.transl_except).toBe('(pos:complement(7..9),aa:Sec)');
      expect(protein(product, { ...feature, start: 0, end: product.length, strand: -1, metadata: moved })).toBe('MAUK*');
    });

    it('a CDS with pieces on both strands has no single orientation, so its positions are dropped', () => {
      const feature = secFeature(10, 1, '17..19', [{ start: 10, end: 16, strand: 1 }, { start: 16, end: 25, strand: -1 }]);
      expect(remapPositionQualifiers(feature.metadata, qualifierMapForFeatureSequence(feature))).toEqual({ motifQualifiers: [] });
    });
  });
});

describe('a CDS with two /transl_except keeps both through every coordinate change', () => {
  // GG ATG TGA GCA TGA AAA TAA GG: CDS 3..20 with Sec at 6..8 and 12..14, so M U A U K.
  const [twoSec] = parseGenBank([
    'LOCUS       TwoSec                    22 bp    DNA     linear   UNK 23-SEP-2026',
    'FEATURES             Location/Qualifiers',
    '     CDS             3..20',
    '                     /transl_except=(pos:6..8,aa:Sec)',
    '                     /transl_except=(pos:12..14,aa:Sec)',
    'ORIGIN',
    '        1 ggatgtgagc atgaaaataa gg',
    '//',
  ].join('\n'));
  const raw = twoSec.sequence;
  const cds = twoSec.features[0];

  it('imports every exception, not the last one', () => {
    expect(cds.metadata.transl_except).toBe('(pos:6..8,aa:Sec),(pos:12..14,aa:Sec)');
    expect(listed(cds)).toEqual(['(pos:6..8,aa:Sec)', '(pos:12..14,aa:Sec)']);
    expect(protein(raw, cds)).toBe('MUAUK*');
  });

  it('an insertion upstream moves both codons', () => {
    const edited = applyInsertion(raw, [], [cds], 0, 'GGG');
    expect(edited.features[0].metadata.transl_except).toBe('(pos:9..11,aa:Sec),(pos:15..17,aa:Sec)');
    expect(listed(edited.features[0])).toEqual(['(pos:9..11,aa:Sec)', '(pos:15..17,aa:Sec)']);
    expect(protein(edited.raw, edited.features[0])).toBe('MUAUK*');
  });

  it('a substitution in one Sec codon drops that exception alone, with no stray separator', () => {
    const firstChanged = applySubstitution(raw, [], [cds], 7, 'C');
    expect(firstChanged.features[0].metadata.transl_except).toBe('(pos:12..14,aa:Sec)');
    expect(listed(firstChanged.features[0])).toEqual(['(pos:12..14,aa:Sec)']);
    expect(protein(firstChanged.raw, firstChanged.features[0])).toBe('MCAUK*');
    // The middle base of the first codon: TGA -> TCA.
    expect(applySubstitution(raw, [], [cds], 6, 'C').features[0].metadata.transl_except).toBe('(pos:12..14,aa:Sec)');
    const secondChanged = applySubstitution(raw, [], [cds], 13, 'C');
    expect(secondChanged.features[0].metadata.transl_except).toBe('(pos:6..8,aa:Sec)');
    expect(listed(secondChanged.features[0])).toEqual(['(pos:6..8,aa:Sec)']);
    expect(protein(secondChanged.raw, secondChanged.features[0])).toBe('MUACK*');
  });

  it('whole-record reverse complement mirrors both codons', () => {
    const [flipped] = reverseComplementFeatures([cds], raw.length);
    expect(flipped.metadata.transl_except).toBe('(pos:complement(15..17),aa:Sec),(pos:complement(9..11),aa:Sec)');
    expect(listed(flipped)).toEqual(['(pos:complement(15..17),aa:Sec)', '(pos:complement(9..11),aa:Sec)']);
    expect(protein(reverseComplement(raw), flipped)).toBe('MUAUK*');
  });

  it('extracting the CDS carries both codons into the new record', () => {
    const extracted = extractFeatureSequence(raw, cds, 'dna');
    const moved = remapPositionQualifiers(cds.metadata, qualifierMapForFeatureSequence(cds));
    expect(moved.transl_except).toBe('(pos:4..6,aa:Sec),(pos:10..12,aa:Sec)');
    expect(protein(extracted, { ...cds, start: 0, end: extracted.length, metadata: moved })).toBe('MUAUK*');
  });

  it('names the exceptions an edit dropped, and nothing when it dropped none', () => {
    const said = (edited: { features: Feature[] }, edit: { start: number; deletedLength: number; insertedLength: number }) => (
      describeDroppedTranslationExceptions(droppedTranslationExceptions([cds], edited.features, edit))
    );
    expect(said(applySubstitution(raw, [], [cds], 6, 'C'), { start: 6, deletedLength: 1, insertedLength: 1 }))
      .toBe('The Sec override at 6..8 was removed: the edit changed its codon.');
    expect(said(applyReplacement(raw, [], [cds], 12, 1, 'C'), { start: 12, deletedLength: 1, insertedLength: 1 }))
      .toBe('The Sec override at 12..14 was removed: the edit changed its codon.');
    // Bases 6..14 deleted: both codons go, and the CDS survives shortened.
    expect(said(applyDeletion(raw, [], [cds], 5, 9), { start: 5, deletedLength: 9, insertedLength: 0 }))
      .toBe('2 Sec overrides were removed: the edit changed their codons.');
    expect(said(applyInsertion(raw, [], [cds], 0, 'GGG'), { start: 1, deletedLength: 0, insertedLength: 3 })).toBeNull();
    // Retyping the same base keeps the codon, so nothing was removed.
    expect(said(applySubstitution(raw, [], [cds], 6, 'G'), { start: 6, deletedLength: 1, insertedLength: 1 })).toBeNull();
    // A CDS the edit deleted outright is not reported as losing its overrides.
    expect(said({ features: [] }, { start: 0, deletedLength: 22, insertedLength: 0 })).toBeNull();
    expect(describeDroppedTranslationExceptions([{ aminoAcid: 'Sec', location: '6..8' }, { aminoAcid: 'Pyl', location: '12..14' }]))
      .toBe('2 codon overrides were removed: the edit changed their codons.');
  });

  it('names an override a run of edits dropped where the run found it', () => {
    // GGG inserted ahead of the CDS moves the codons to 9..11 and 15..17; the
    // next edit then changes the middle base of the first one (0-based 9).
    const inserted = applyInsertion(raw, [], [cds], 0, 'GGG');
    const insert = { start: 1, deletedLength: 0, insertedLength: 3 };
    const changed = applySubstitution(inserted.raw, [], inserted.features, 9, 'C');
    const change = { start: 9, deletedLength: 1, insertedLength: 1 };
    expect(changed.features[0].metadata.transl_except).toBe('(pos:15..17,aa:Sec)');
    // One edit at a time names it after the insertion; the run names it before both.
    expect(droppedTranslationExceptions(inserted.features, changed.features, change)).toEqual([{ aminoAcid: 'Sec', location: '9..11' }]);
    expect(describeDroppedTranslationExceptions(droppedTranslationExceptions([cds], changed.features, [insert, change])))
      .toBe('The Sec override at 6..8 was removed: the edit changed its codon.');
    // Typing the old base back does not bring the override back, so it is still named.
    const retyped = applySubstitution(changed.raw, [], changed.features, 9, 'G');
    expect(retyped.raw.toUpperCase()).toBe(inserted.raw.toUpperCase());
    expect(droppedTranslationExceptions([cds], retyped.features, [insert, change, change])).toEqual([{ aminoAcid: 'Sec', location: '6..8' }]);
    // A run that never touches a codon names nothing.
    const upstream = applySubstitution(inserted.raw, [], inserted.features, 1, 'C');
    expect(droppedTranslationExceptions([cds], upstream.features, [insert, { start: 1, deletedLength: 1, insertedLength: 1 }])).toEqual([]);
  });

  it('a product that carries only one codon keeps only that exception', () => {
    // Bases 10..22 land at 1..13: the second codon moves to 3..5 and the first is not carried.
    const moved = remapPositionQualifiers(cds.metadata, qualifierMapForSpans([{ start: 9, end: 22, targetStart: 0 }]));
    expect(moved.transl_except).toBe('(pos:3..5,aa:Sec)');
    expect(listed({ ...cds, metadata: moved })).toEqual(['(pos:3..5,aa:Sec)']);
  });
});
