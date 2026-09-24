import { describe, expect, it } from 'vitest';
import { extractFeatureSequence, featureLocationCoordinateSignature } from '../../bio/feature-location';
import vectors from '../../../public/data/vectors.json';
import { guideFeatureInput, normalizeRecord, parseImportedRecords, toGenBankLite } from '../motif-artifact';

// The truth here is cut from pUC19 by hand, not taken from the guide scanner:
// a forward guide reads the top strand, a reverse guide reads the reverse
// complement of its forward-coordinate window, and an SpCas9 PAM is the three
// bases 3' of the protospacer on the guide's own strand.
const pUC19 = (vectors as Array<{ name: string; sequence: string }>).find((vector) => vector.name === 'pUC19')!;
const seq = pUC19.sequence.toUpperCase();
const rc = (value: string) => value.split('').reverse().map((base) => ({ A: 'T', T: 'A', G: 'C', C: 'G' }[base])).join('');

const forward = { strand: 1 as const, start: 28, end: 48, spacer: seq.slice(28, 48), pam: seq.slice(48, 51) };
const reverse = { strand: -1 as const, start: 31, end: 51, spacer: rc(seq.slice(31, 51)), pam: rc(seq.slice(28, 31)) };
// Across the origin of the circle, on each strand.
const wrapForward = { strand: 1 as const, start: 2676, end: 2696, spacer: seq.slice(2676) + seq.slice(0, 10), pam: seq.slice(10, 13) };
const wrapReverse = { strand: -1 as const, start: 2680, end: 2700, spacer: rc(seq.slice(2680) + seq.slice(0, 14)), pam: rc(seq.slice(2677, 2680)) };

function recordWith(guides: ReadonlyArray<typeof forward | typeof reverse>) {
  return normalizeRecord({
    id: 'puc19-guides',
    name: 'pUC19',
    molecule: 'dna',
    topology: 'circular',
    seq,
    annotations: guides.map((guide) => guideFeatureInput(guide, 'SpCas9', seq.length, 'circular')),
  }, 0, false)!;
}

describe('a guide saved as a feature', () => {
  it('covers the protospacer on its own strand and leaves the PAM outside', () => {
    expect(forward.pam).toMatch(/^[ACGT]GG$/);
    expect(reverse.pam).toMatch(/^[ACGT]GG$/);
    const [fwd, rev] = recordWith([forward, reverse]).features;
    expect(fwd).toMatchObject({ type: 'misc_feature', start: 28, end: 48, strand: 1, name: 'SpCas9 guide 29 (+)' });
    expect(rev).toMatchObject({ type: 'misc_feature', start: 31, end: 51, strand: -1, name: 'SpCas9 guide 32 (-)' });
    expect(extractFeatureSequence(seq, fwd, 'dna')).toBe(forward.spacer);
    expect(extractFeatureSequence(seq, rev, 'dna')).toBe(reverse.spacer);
    expect(fwd.metadata.note).toBe(`SpCas9 guide; spacer ${forward.spacer}; PAM ${forward.pam}`);
    expect(rev.metadata.note).toBe(`SpCas9 guide; spacer ${reverse.spacer}; PAM ${reverse.pam}`);
  });

  it('splits at the origin of a circle and still reads the spacer on either strand', () => {
    const [fwd, rev] = recordWith([wrapForward, wrapReverse]).features;
    expect(fwd.subRanges).toEqual([{ start: 2676, end: 2686, strand: 1 }, { start: 0, end: 10, strand: 1 }]);
    expect(extractFeatureSequence(seq, fwd, 'dna')).toBe(wrapForward.spacer);
    expect(extractFeatureSequence(seq, rev, 'dna')).toBe(wrapReverse.spacer);
  });

  it('comes back from a Basic GenBank export with the same location, strand, name and note', () => {
    const record = recordWith([forward, reverse, wrapForward, wrapReverse]);
    const genbank = toGenBankLite(record, 'circular');
    expect(genbank).toContain('     misc_feature    29..48\n');
    expect(genbank).toContain('     misc_feature    complement(32..51)\n');
    const [input] = parseImportedRecords(genbank, '', 'auto', 'circular');
    const reimported = normalizeRecord(input, 0, false)!;
    const guides = reimported.features.filter((feature) => feature.name.startsWith('SpCas9 guide'));
    expect(guides.map((feature) => [feature.name, feature.metadata.note, featureLocationCoordinateSignature(feature)]))
      .toEqual(record.features.map((feature) => [feature.name, feature.metadata.note, featureLocationCoordinateSignature(feature)]));
  });
});
