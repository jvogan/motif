import { describe, expect, it } from 'vitest';
import { BACTERIAL_CODE, STANDARD_CODE } from '../codon-tables';
import { extractFeatureSequence } from '../feature-location';
import { gcContent, getAminoAcidMassTable, molecularWeight, nucleotideComposition, proteinMolecularWeight } from '../gc-content';
import { findORFs } from '../orf-detection';
import { estimatePCRBindingScanWorkUnits, findPrimerBindings, findPrimerBindingsWithDiagnostics, simulatePCR } from '../pcr';
import { restrictionDigestDetailed } from '../restriction-digest';
import { reverseComplement } from '../reverse-complement';
import { translate, translateCompleteCds } from '../translate';
import type { RestrictionEnzyme, Topology } from '../types';

describe('sequence analysis arithmetic', () => {
  it('translates a codon split across joined CDS pieces in biological order', () => {
    const forward = extractFeatureSequence('ATCCCCGAAATAA', {
      start: 0, end: 13, strand: 1, subRanges: [{ start: 0, end: 2 }, { start: 6, end: 13 }],
    }, 'dna');
    const reverse = extractFeatureSequence('TTATTTCCCCCAT', {
      start: 0, end: 13, strand: -1, subRanges: [{ start: 11, end: 13 }, { start: 0, end: 7 }],
    }, 'dna');
    expect(forward).toBe('ATGAAATAA');
    expect(reverse).toBe(forward);
    expect(translateCompleteCds(forward)).toBe('MK*');
    expect(translateCompleteCds(reverse)).toBe('MK*');
    expect(translate('GCNATNTART')).toBe('AX*');
  });

  it('keeps reverse circular ORFs in their origin-relative frames', () => {
    const sequence = 'GTTATTTCAT'; // Reverse complement is ATG AAA TAA C.
    const reverse = (topology: Topology) => findORFs(sequence, 2, STANDARD_CODE, { topology })
      .filter((orf) => orf.strand === -1);
    expect(reverse('linear')).toMatchObject([{ start: 1, end: 10, frame: 1, aminoAcids: 2, status: 'complete' }]);
    expect(reverse('circular')).toEqual(reverse('linear'));
    expect(findORFs('ATGTTATTTC', 2, STANDARD_CODE, { topology: 'circular' })
      .find((orf) => orf.strand === -1 && orf.status === 'complete'))
      .toMatchObject({ start: 3, end: 12, frame: 3, aminoAcids: 2 });
  });

  it('counts nested starts and complete codons at a linear boundary', () => {
    const sequence = 'CGTGATGTAAC';
    const frameTwo = (minAminoAcids: number) => findORFs(sequence, minAminoAcids, BACTERIAL_CODE)
      .filter((orf) => orf.strand === 1 && orf.frame === 2);
    expect(frameTwo(1)).toMatchObject([
      { start: 1, end: 10, aminoAcids: 2, startCodon: 'GTG' },
      { start: 4, end: 10, aminoAcids: 1, startCodon: 'ATG' },
    ]);
    expect(frameTwo(2)).toHaveLength(1);
    expect(findORFs('CCATGAAACC', 2)).toContainEqual(expect.objectContaining({
      start: 2, end: 8, frame: 3, aminoAcids: 2, status: 'partial', stopCodon: '',
    }));
  });

  it('reports the strand, frame, and stop for starts in each of the six reading frames', () => {
    for (const offset of [0, 1, 2]) {
      const sequence = 'C'.repeat(offset) + 'ATGGCCTAA';
      expect(findORFs(sequence, 2)).toContainEqual(expect.objectContaining({
        strand: 1, start: offset, end: sequence.length, frame: offset + 1, stopCodon: 'TAA', aminoAcids: 2,
      }));
      expect(findORFs(reverseComplement(sequence), 2)).toContainEqual(expect.objectContaining({
        strand: -1, start: 0, end: 9, frame: offset + 1, stopCodon: 'TAA', aminoAcids: 2,
      }));
    }
  });

  it('reports primers that bind across either side of the circular seam', () => {
    const template = 'GGTAGGTTCAAA';
    const policy = { minMatched3PrimeLength: 4 };
    const forward = simulatePCR(template, 'AAGG', 'CCTA', [], 'circular', undefined, policy);
    expect(forward).toMatchObject({
      product: 'AAGGTAGG', productLength: 8, wrapsOrigin: true,
      forward: { bindStart: 10, bindEnd: 2, spansOrigin: true, bindingSequence: 'AAGG', tm: 12, gcPercent: 50 },
      reverse: { bindStart: 2, bindEnd: 6, bindingSequence: 'CCTA', tm: 12, gcPercent: 50 },
    });
    const ranges = { forward: { start: 6, end: 10 }, reverse: { start: 10, end: 2 } };
    const reverse = simulatePCR(template, 'TTCA', 'CCTT', [], 'circular', undefined, policy);
    expect(reverse).toMatchObject({
      product: 'TTCAAAGG', productLength: 8, wrapsOrigin: true,
      forward: { bindStart: 6, bindEnd: 10, tm: 10, gcPercent: 25 },
      reverse: { bindStart: 10, bindEnd: 2, spansOrigin: true, tm: 12, gcPercent: 50 },
    });
    expect(simulatePCR(template, 'TTCA', 'CCTT', [], 'circular', ranges, policy)?.product).toBe('TTCAAAGG');
    expect(simulatePCR(template, 'TTCA', 'CCTT', [], 'linear', ranges, policy)).toBeNull();
    expect(simulatePCR(template, 'AATG', 'CCTA', [], 'circular', {
      forward: { start: 10, end: 2 }, reverse: { start: 2, end: 6 },
    }, { minMatched3PrimeLength: 1, maxMismatches: 1 })?.provenance.bindingEdits).toContainEqual({
      primer: 'forward', productOffset: 2, templatePosition: 0, original: 'G', replacement: 'T',
    });
    expect(findPrimerBindings(template, 'AAGG', policy, 'circular')).toMatchObject([
      { bindStart: 10, bindEnd: 2, spansOrigin: true },
    ]);
    expect(estimatePCRBindingScanWorkUnits(12, 4, policy, 'circular')).toBe(96);
    expect(findPrimerBindingsWithDiagnostics(template, 'AAGG', {
      ...policy, maxBindingScanWorkUnits: 88,
    }, 'circular')).toMatchObject({
      complete: false, workUnits: 88, diagnostics: [{ code: 'binding_scan_work_limit' }],
    });
  });

  it('rejects a product that clips either primer binding span', () => {
    expect(simulatePCR('ACGTCC', 'GTCC', 'ACGT', [], 'linear', {
      forward: { start: 2, end: 6 }, reverse: { start: 0, end: 4 },
    }, { minMatched3PrimeLength: 4 })).toBeNull();
  });

  it('rejects a reverse primer whose 3′ end lies upstream of the forward 5′ end', () => {
    // The reverse primer spans bases 0..8 and the forward primer sits inside it at
    // 2..6. A strand made from the forward primer starts at base 2, so the reverse
    // primer's 3′ end (base 0) has nothing to pair with. A check that only asked
    // for a non-empty span would report TCCAGT.
    const template = 'GATCCAGTAC';
    expect(simulatePCR(template, template.slice(2, 6), reverseComplement(template.slice(0, 8)), [], 'linear', {
      forward: { start: 2, end: 6 }, reverse: { start: 0, end: 8 },
    }, { minMatched3PrimeLength: 4 })).toBeNull();
  });

  it('keeps the whole-plasmid product of back-to-back primers, with and without a 5′ tail', () => {
    // Inverse PCR: the 5′ ends meet at base 12 and the primers point away from
    // each other, so the product is the whole 24-base circle opened at base 12.
    const template = 'ATGCGTACCTTGAGCAAGTCCGAT';
    const forward = template.slice(12, 20);
    const reverse = reverseComplement(template.slice(4, 12));
    const opened = template.slice(12) + template.slice(0, 12);
    const ranges = { forward: { start: 12, end: 20 }, reverse: { start: 4, end: 12 } };
    const policy = { minMatched3PrimeLength: 8 };
    expect(simulatePCR(template, forward, reverse, [], 'circular', undefined, policy))
      .toMatchObject({ product: opened, productLength: 24, wrapsOrigin: true });
    expect(simulatePCR(template, `GGATCC${forward}`, reverse, [], 'circular', ranges, policy))
      .toMatchObject({ product: `GGATCC${opened}`, productLength: 30, forward: { tail: 'GGATCC', bindStart: 12, bindEnd: 20 } });
  });

  it('counts both exact primer sites and their full lengths', () => {
    expect(findPrimerBindings('AACGTAACGT', 'ACGT', { minMatched3PrimeLength: 4 })).toMatchObject([
      { bindStart: 1, bindEnd: 5, mismatchCount: 0 }, { bindStart: 6, bindEnd: 10, mismatchCount: 0 },
    ]);
  });

  it('rejects sticky-end polarity that contradicts the strand offsets', () => {
    const cutter: RestrictionEnzyme = {
      name: 'Test cutter', recognitionSequence: 'CCGG', cutOffset: 1, complementCutOffset: 3, overhang: '3prime',
    };
    const result = restrictionDigestDetailed('AACCGGAA', [cutter.name], 'linear', undefined, [cutter]);
    expect(result.issues).toMatchObject([{ code: 'invalid_geometry', topCutPosition: 3, bottomCutPosition: 5 }]);
    expect(result.fragments).toEqual([]);
  });

  it('conserves lengths and end types for zero, one, and two cutters', () => {
    const sequence = 'AAGAATTCGGATATCAAA';
    const fragments = (enzymes: string[], topology: Topology, input = sequence) => {
      const result = restrictionDigestDetailed(input, enzymes, topology);
      expect(result.issues).toEqual([]);
      expect(result.fragments.reduce((total, { length }) => total + length, 0)).toBe(input.length);
      return result.fragments.map((f) => [f.length, f.overhang5Type, f.overhang5, f.overhang3Type, f.overhang3]);
    };
    expect(fragments([], 'linear')).toEqual([[18, 'blunt', '', 'blunt', '']]);
    expect(fragments([], 'circular')).toEqual([[18, 'blunt', '', 'blunt', '']]);
    expect(fragments(['EcoRI'], 'linear')).toEqual([[3, 'blunt', '', '5prime', 'AATT'], [15, '5prime', 'AATT', 'blunt', '']]);
    expect(fragments(['EcoRI'], 'circular')).toEqual([[18, '5prime', 'AATT', '5prime', 'AATT']]);
    expect(fragments(['EcoRI', 'EcoRV'], 'linear')).toEqual([
      [3, 'blunt', '', '5prime', 'AATT'], [9, '5prime', 'AATT', 'blunt', ''], [6, 'blunt', '', 'blunt', ''],
    ]);
    expect(fragments(['EcoRI', 'EcoRV'], 'circular', 'TTCGGATATCAAAAAGAA')).toEqual([
      [9, 'blunt', '', '5prime', 'AATT'], [9, '5prime', 'AATT', 'blunt', ''],
    ]);
    expect(fragments(['BsaI'], 'linear', 'AAGGTCTCAAGCTCCC')).toEqual([
      [9, 'blunt', '', '5prime', 'AGCT'], [7, '5prime', 'AGCT', 'blunt', ''],
    ]);
  });

  it('keeps overlapping recognition sites as distinct physical cuts', () => {
    // HaeIII sites overlap the central NaeI site but cut at different boundaries.
    const result = restrictionDigestDetailed('GGCCGGCC', ['HaeIII', 'NaeI']);
    expect(result.issues).toEqual([]);
    expect(result.cuts.map((cut) => cut.cutPosition).sort((a, b) => a - b)).toEqual([2, 4, 6]);
    expect(result.fragments.map((fragment) => fragment.length)).toEqual([2, 2, 2, 2]);
    expect(result.fragments.every((fragment) => fragment.overhang5Type === 'blunt' && fragment.overhang3Type === 'blunt')).toBe(true);
  });

  it('uses isotope-appropriate terminal phosphate mass', () => {
    // Average HPO3 = 79.9799 Da. Free dA is 331.2218 − 79.9799 = 251.2419 Da.
    expect(molecularWeight('A', { fivePrime: 'hydroxyl' })).toBe(251.24);
    expect(molecularWeight('A', { fivePrime: 'hydroxyl', mode: 'monoisotopic' })).toBe(251.10);
  });

  it('weighs selenocysteine and pyrrolysine as known residues', () => {
    // The table's existing residues use C 12.011, H 1.00794, N 14.00674,
    // O 15.9994 and S 32.066: glycine C2H3NO and cysteine C3H5NOS come out at
    // the 57.052 and 103.145 already listed. The same weights, with Se 78.96,
    // give the ExPASy FindMod averages for U (150.0388) and O (237.3018).
    const weight = { C: 12.011, H: 1.00794, N: 14.00674, O: 15.9994, S: 32.066, Se: 78.96 };
    const table = getAminoAcidMassTable();
    expect(table.G).toBeCloseTo(2 * weight.C + 3 * weight.H + weight.N + weight.O, 3);
    expect(table.C).toBeCloseTo(3 * weight.C + 5 * weight.H + weight.N + weight.O + weight.S, 3);
    expect(table.U).toBeCloseTo(3 * weight.C + 5 * weight.H + weight.N + weight.O + weight.Se, 3);
    expect(table.O).toBeCloseTo(12 * weight.C + 19 * weight.H + 3 * weight.N + 2 * weight.O, 3);
    // 150.039 + 237.302 + 18.015 water = 405.356 Da.
    expect(proteinMolecularWeight('UO*')).toBe(405.36);
    expect(proteinMolecularWeight('UO*', 'monoisotopic')).toBe(406.11);
  });

  it('counts nucleotide composition and ordinary protein mass', () => {
    expect(nucleotideComposition('ACGTN')).toEqual({ A: 1, C: 1, G: 1, T: 1, U: 0, N: 1, other: 0 });
    expect(nucleotideComposition('ACGUN')).toEqual({ A: 1, C: 1, G: 1, T: 0, U: 1, N: 1, other: 0 });
    expect(gcContent('ACGUN')).toBe(0.5);
    expect(proteinMolecularWeight('AG')).toBe(146.15);
  });
});
