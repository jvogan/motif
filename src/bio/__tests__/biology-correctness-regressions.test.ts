import { describe, expect, it } from 'vitest';
import { predictPrimerDimer } from '../primer-thermodynamics';
import { simulatePCR } from '../pcr';
import { reverseComplement, reverseComplementFeatures } from '../reverse-complement';
import { parseGenBank } from '../genbank-parser';
import { gibsonAssemble } from '../gibson-assembly';
import { findORFs } from '../orf-detection';
import { domesticateGoldenGateFeature } from '../golden-gate';

function seededDna(length: number, seed: number, alphabet = 'ACGT'): string {
  let state = seed >>> 0;
  return Array.from({ length }, () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return alphabet[(state >>> 16) % alphabet.length];
  }).join('');
}

function genBankRecord(locusLine: string, sequence: string, featureLines: string[] = []): string {
  const lines = [locusLine];
  if (featureLines.length > 0) lines.push('FEATURES             Location/Qualifiers', ...featureLines);
  lines.push('ORIGIN');
  for (let i = 0; i < sequence.length; i += 60) {
    lines.push(`${String(i + 1).padStart(9)} ${sequence.slice(i, i + 60)}`);
  }
  lines.push('//');
  return lines.join('\n');
}

describe('primer-dimer offset coverage', () => {
  it('finds the 3′–3′ dimer when the first primer is the longer one', () => {
    const longer = 'TTTTTTTTTTTTTTTTTTGCGCC';
    const shorter = 'AAGGCGC';
    const forward = predictPrimerDimer(longer, shorter);
    const swapped = predictPrimerDimer(shorter, longer);
    expect(swapped.deltaG).toBeLessThan(0);
    expect(forward.deltaG).toBe(swapped.deltaG);
    expect(forward.pairLength).toBe(5);
    expect(forward.pairLength).toBe(swapped.pairLength);
    expect(forward.threePrimeParticipation).toBe('both');
    expect(forward.threePrimeParticipation).toBe(swapped.threePrimeParticipation);
  });

  it('reports the same ΔG in both argument orders for unequal-length primers', () => {
    const pairs: Array<[string, string]> = [
      ['ACGTGCTAGCTAGGCTAGCATGC', 'GCATGCAAT'],
      ['GGGCCCAAATTTGGGCCCAAAGCGC', 'GCGCTTTG'],
      [seededDna(24, 11), seededDna(12, 29)],
      [seededDna(30, 5), seededDna(18, 73)],
      [seededDna(9, 101), seededDna(27, 202)],
    ];
    for (const [a, b] of pairs) {
      const ab = predictPrimerDimer(a, b);
      const ba = predictPrimerDimer(b, a);
      expect(ab.deltaG, `${a}|${b}`).toBe(ba.deltaG);
      expect(ab.pairLength, `${a}|${b}`).toBe(ba.pairLength);
    }
  });
});

describe('PCR primer ordering on a linear template', () => {
  const template = seededDna(300, 0x1234);

  it('rejects a reverse primer whose binding starts upstream of the forward binding', () => {
    const forward = template.slice(200, 220);
    const reverse = reverseComplement(template.slice(195, 215));
    expect(simulatePCR(template, forward, reverse, [], 'linear')).toBeNull();
  });

  it('still amplifies overlapping primers that are correctly ordered', () => {
    const forward = template.slice(100, 120);
    const reverse = reverseComplement(template.slice(110, 130));
    const result = simulatePCR(template, forward, reverse, [], 'linear');
    expect(result?.productLength).toBe(30);
    expect(result?.product).toBe(template.slice(100, 130));
    expect(result?.diagnostics).toContainEqual(expect.objectContaining({ code: 'overlapping_binding_regions' }));
  });
});

describe('long CDS translation qualifiers', () => {
  it('keeps feature mapping available for a CDS with a 5,000 aa translation', () => {
    const length = 15_003;
    const sequence = seededDna(length, 7, 'acgt');
    const translation = `M${'A'.repeat(4_999)}`;
    const qualifier = `/translation="${translation}"`;
    const featureLines = [`     CDS             1..${length}`, '                     /label="long"'];
    for (let i = 0; i < qualifier.length; i += 58) {
      featureLines.push(`                     ${qualifier.slice(i, i + 58)}`);
    }
    const [record] = parseGenBank(genBankRecord(
      `LOCUS       long   ${length} bp    DNA     linear   SYN 01-JAN-2020`,
      sequence,
      featureLines,
    ));
    expect(record.features).toHaveLength(1);
    expect(record.features[0].metadata.translation).toBe(translation);
    const reversed = reverseComplementFeatures(record.features, length);
    expect(reversed).toHaveLength(1);
    expect(reversed[0].metadata.translation).toBe(translation);
  });
});

describe('circular assembly closing junctions', () => {
  it('annotates the Gibson closing overlap once at the product origin', () => {
    const leftOverlap = 'GATTACAGATTACAGAT';
    const closingOverlap = 'CCGGTTAACCGGTTAAC';
    const result = gibsonAssemble([
      { name: 'A', sequence: `${closingOverlap}${'A'.repeat(20)}${leftOverlap}`, features: [] },
      { name: 'B', sequence: `${leftOverlap}${'T'.repeat(20)}${closingOverlap}`, features: [] },
    ], 15, 60, 'circular');
    expect(result.success).toBe(true);
    const closing = result.features.find((feature) => feature.metadata.closing === true);
    expect(closing).toBeDefined();
    const overlapSequence = closing?.metadata.overlapSequence as string;
    expect(overlapSequence).toBe(closingOverlap);
    expect(closing?.subRanges).toBeUndefined();
    expect((closing?.end ?? 0) - (closing?.start ?? 0)).toBe(overlapSequence.length);
    expect(result.sequence.slice(closing?.start, closing?.end)).toBe(overlapSequence);
  });
});

describe('ORF frame labels in circular scans', () => {
  it('labels a reverse-strand ORF with the same frame in linear and circular mode', () => {
    const sequence = reverseComplement(`CCCCC${'ATGAAAAAAAAATAA'}${'C'.repeat(80)}`);
    expect(sequence.length % 3).not.toBe(0);
    const summarize = (topology: 'linear' | 'circular') => findORFs(sequence, 3, undefined, { topology })
      .filter((orf) => orf.strand === -1)
      .map(({ start, end, frame }) => ({ start, end, frame }));
    const linear = summarize('linear');
    expect(linear).toHaveLength(1);
    expect(summarize('circular')).toEqual(linear);
  });

  it('labels a forward-strand ORF with the same frame in linear and circular mode', () => {
    const sequence = `CCCCC${'ATGAAAAAAAAATAA'}${'C'.repeat(80)}`;
    const summarize = (topology: 'linear' | 'circular') => findORFs(sequence, 3, undefined, { topology })
      .filter((orf) => orf.strand === 1)
      .map(({ start, end, frame }) => ({ start, end, frame }));
    const linear = summarize('linear');
    expect(linear).toEqual([{ start: 5, end: 20, frame: 3 }]);
    expect(summarize('circular')).toEqual(linear);
  });
});

describe('Golden Gate domestication site strand', () => {
  it('keeps an antisense motif on the reverse strand inside a forward CDS', () => {
    const sequence = 'GAGACCAAAGCTAAATAAATAA';
    const result = domesticateGoldenGateFeature({
      sequence,
      feature: { start: 0, end: sequence.length, strand: 1, type: 'cds' },
      codonStart: 2,
      forbiddenEnzymes: ['BsaI'],
    });
    const site = result.remainingSites.find(({ motif }) => motif === 'GAGACC');
    expect(site).toMatchObject({ position: 0, strand: -1 });

    const senseSequence = sequence.replace('GAGACC', 'GGTCTC');
    const sense = domesticateGoldenGateFeature({
      sequence: senseSequence,
      feature: { start: 0, end: senseSequence.length, strand: 1, type: 'cds' },
      codonStart: 2,
      forbiddenEnzymes: ['BsaI'],
    });
    expect(sense.remainingSites.find(({ motif }) => motif === 'GGTCTC')).toMatchObject({ position: 0, strand: 1 });
  });
});

describe('GenBank LOCUS topology', () => {
  const sequence = 'ACGTACGTACGTACGTACGT';

  it('does not read topology from the locus name', () => {
    const [named] = parseGenBank(genBankRecord(
      'LOCUS       pX-circular            20 bp    DNA     linear   SYN 01-JAN-2020',
      sequence,
    ));
    expect(named.name).toBe('pX-circular');
    expect(named.topology).toBe('linear');

    const [unitless] = parseGenBank(genBankRecord('LOCUS       pX-circular  20  DNA', sequence));
    expect(unitless.topology).toBe('linear');

    const [reversedName] = parseGenBank(genBankRecord(
      'LOCUS       pX-linear              20 bp    DNA     circular SYN 01-JAN-2020',
      sequence,
    ));
    expect(reversedName.topology).toBe('circular');
  });

  it('reads topology from the standard LOCUS layout, with or without a unit', () => {
    const [standard] = parseGenBank(genBankRecord(
      'LOCUS       pUC19                  20 bp    DNA     circular SYN 01-JAN-2020',
      sequence,
    ));
    expect(standard.topology).toBe('circular');
    expect(standard.length).toBe(20);

    const [unitless] = parseGenBank(genBankRecord('LOCUS       pUC19  20  DNA  circular', sequence));
    expect(unitless.topology).toBe('circular');

    const [crlf] = parseGenBank(genBankRecord(
      'LOCUS       pUC19                  20 bp    ds-DNA  circular SYN 01-JAN-2020',
      sequence,
    ).replace(/\n/g, '\r\n'));
    expect(crlf.topology).toBe('circular');
  });
});
