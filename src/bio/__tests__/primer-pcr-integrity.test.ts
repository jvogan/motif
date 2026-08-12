import { describe, expect, it, vi } from 'vitest';
import {
  estimatePCRBindingScanWorkUnits,
  findPrimerBindings,
  findPrimerBindingsWithDiagnostics,
  MAX_PCR_BINDING_SCAN_WORK_UNITS,
  MAX_PCR_OLIGO_LENGTH,
  MAX_PCR_PRODUCT_LENGTH,
  simulatePCR,
  simulatePCRWithDiagnostics,
} from '../pcr';
import {
  designPrimerPairWithDiagnostics,
  designForwardPrimerWithDiagnostics,
  DEFAULT_TM_OPTIONS,
  MAX_PRIMER_OLIGO_LENGTH,
  MAX_PRIMER_TAIL_LENGTH,
  normalizePrimerDesignParams,
} from '../primer-design';
import {
  MAX_PRIMER_STRUCTURE_SEQUENCE_LENGTH,
  predictHairpin,
  predictPrimerDimer,
  predictSelfDimer,
} from '../primer-thermodynamics';
import { calculateTm, duplexThermodynamics, saltCorrectedTm } from '../tm-calculator';
import { reverseComplement } from '../reverse-complement';
import type { Feature } from '../types';

const binding = 'ACGTTGCAAC';

function referenceHairpin(primer: string): {
  deltaG: number;
  stemLength: number;
  loopSize: number;
  structure: string;
} {
  let best = { deltaG: 0, stemLength: 0, loopSize: 0, structure: '' };
  for (let i = 0; i + 2 * 3 + 3 <= primer.length; i += 1) {
    for (let stemLength = 3; i + 2 * stemLength + 3 <= primer.length; stemLength += 1) {
      for (let loopSize = 3; i + 2 * stemLength + loopSize <= primer.length; loopSize += 1) {
        const left = primer.slice(i, i + stemLength);
        const rightStart = i + stemLength + loopSize;
        const right = primer.slice(rightStart, rightStart + stemLength);
        if (left !== reverseComplement(right)) continue;
        const deltaG = duplexThermodynamics(left).deltaG37 / 1000;
        if (deltaG < best.deltaG) {
          best = {
            deltaG: Math.round(deltaG * 100) / 100,
            stemLength,
            loopSize,
            structure: `5'-${left}-${'.'.repeat(loopSize)}-${right}-3'`,
          };
        }
      }
    }
  }
  return best;
}

describe('primer, PCR, and Tm integrity', () => {
  it('keeps ambiguity and rejects gaps instead of deleting residues before Tm', () => {
    const ambiguous = calculateTm(' ATG NNN ');
    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.evaluatedSequence).toBe('ATGNNN');
    expect(ambiguous.method).toBe('none');

    const gapped = calculateTm('ATG-NNN');
    expect(gapped.status).toBe('invalid');
    expect(gapped.evaluatedSequence).toBe('ATG-NNN');
    expect(gapped.message).toMatch(/invalid/i);
  });

  it('fails closed on non-finite and non-physical Tm conditions', () => {
    expect(calculateTm('ACGTACGTACGTAC', { naConcentration: Number.NaN }).status).toBe('invalid');
    expect(calculateTm('ACGTACGTACGTAC', { naConcentration: 0 }).status).toBe('invalid');
    expect(calculateTm('ACGTACGTACGTAC', { primerConcentration: 0 }).status).toBe('invalid');
    expect(calculateTm('ACGTACGTACGTAC', { method: 'not-a-method' as never }).status).toBe('invalid');
    expect(() => saltCorrectedTm(330, 50, 0, 0.5, 20, 'owczarzy', {
      deltaH: -10_000,
      deltaS: Number.NaN,
      ctMolar: 250e-9,
    })).toThrow(/finite/i);
  });

  it('rejects empty and one-base inputs for nearest-neighbor duplex thermodynamics', () => {
    expect(() => duplexThermodynamics('')).toThrow(/at least two canonical bases/i);
    expect(() => duplexThermodynamics('A')).toThrow(/at least two canonical bases/i);
  });

  it('enumerates repeated binding sites and exposes a configurable mismatch policy', () => {
    const template = `${binding}GGGG${binding}`;
    const exactOnly = findPrimerBindings(template, `GGGG${binding}`, { minMatched3PrimeLength: 10 });
    expect(exactOnly.map((candidate) => candidate.bindStart)).toEqual([10]);
    const candidates = findPrimerBindings(template, `GGGG${binding}`, {
      minMatched3PrimeLength: 10,
      allowImplicitTails: true,
    });
    expect(candidates.map((candidate) => candidate.bindStart)).toEqual(expect.arrayContaining([0, 10, 14]));
    expect(candidates.length).toBeGreaterThan(2);
    expect(candidates.every((candidate) => candidate.status === 'exact')).toBe(true);

    const mismatchTemplate = `TCGTTGCAACGGGG`;
    expect(findPrimerBindings(mismatchTemplate, binding)).toEqual([]);
    const mismatch = findPrimerBindings(mismatchTemplate, binding, {
      minMatched3PrimeLength: 9,
      maxMismatches: 1,
    });
    expect(mismatch[0]).toMatchObject({
      bindStart: 0,
      mismatchCount: 1,
      matched3PrimeLength: 9,
      status: 'mismatch',
    });

    const conditionalMismatch = findPrimerBindings('TCGTTGCAACNN', 'NCGTTGCAAC', {
      minMatched3PrimeLength: 9,
      maxMismatches: 1,
    });
    expect(conditionalMismatch[0]?.status).toBe('ambiguous');
  });

  it('proves a binding cap is exhaustive when the final window supplies the cap', () => {
    const finalWindow = findPrimerBindingsWithDiagnostics(binding, binding, {
      minMatched3PrimeLength: binding.length,
      maxBindingCandidates: 1,
    });
    expect(finalWindow).toMatchObject({ complete: true, diagnostics: [] });
    expect(finalWindow.candidates).toHaveLength(1);
    expect(findPrimerBindings(binding, binding, {
      minMatched3PrimeLength: binding.length,
      maxBindingCandidates: 1,
    })).toHaveLength(1);

    const truncated = findPrimerBindingsWithDiagnostics(`${binding}GGGG${binding}`, binding, {
      minMatched3PrimeLength: binding.length,
      maxBindingCandidates: 1,
    });
    expect(truncated.complete).toBe(false);
    expect(truncated.diagnostics).toContainEqual(expect.objectContaining({ code: 'binding_candidate_limit' }));
    expect(findPrimerBindings(`${binding}GGGG${binding}`, binding, {
      minMatched3PrimeLength: binding.length,
      maxBindingCandidates: 1,
    })).toEqual([]);
  });

  it('bounds automatic binding work and keeps the legacy array API fail-closed', () => {
    const template = 'C'.repeat(100_000);
    const primer = 'A'.repeat(40);
    const estimate = estimatePCRBindingScanWorkUnits(template.length, primer.length);
    expect(estimate).toBeGreaterThan(MAX_PCR_BINDING_SCAN_WORK_UNITS);

    const detailed = findPrimerBindingsWithDiagnostics(template, primer);
    expect(detailed.complete).toBe(false);
    expect(detailed.workUnits).toBeLessThanOrEqual(MAX_PCR_BINDING_SCAN_WORK_UNITS);
    expect(detailed.candidates).toEqual([]);
    expect(detailed.diagnostics).toContainEqual(expect.objectContaining({
      code: 'binding_scan_work_limit',
      workUnits: detailed.workUnits,
      maxWorkUnits: MAX_PCR_BINDING_SCAN_WORK_UNITS,
    }));
    expect(findPrimerBindings(template, primer)).toEqual([]);
  });

  it('returns a typed zero-candidate scan limit instead of collapsing it to an ordinary miss', () => {
    const detailed = simulatePCRWithDiagnostics(
      'C'.repeat(2_000),
      'A'.repeat(40),
      'A'.repeat(40),
      [],
      'linear',
      undefined,
      { maxBindingScanWorkUnits: 100 },
    );
    expect(detailed.result).toBeNull();
    expect(detailed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'binding_scan_work_limit', primer: 'forward' }),
      expect.objectContaining({ code: 'binding_scan_work_limit', primer: 'reverse' }),
    ]));
    expect(simulatePCR(
      'C'.repeat(2_000),
      'A'.repeat(40),
      'A'.repeat(40),
      [],
      'linear',
      undefined,
      { maxBindingScanWorkUnits: 100 },
    )).toBeNull();
  });

  it('blocks materialization when a partial automatic scan happens to find a product', () => {
    const forward = binding;
    const reverse = reverseComplement(binding);
    const template = `${forward}${'G'.repeat(20)}${forward}`;
    const detailed = simulatePCRWithDiagnostics(
      template,
      forward,
      reverse,
      [],
      'linear',
      undefined,
      { maxBindingScanWorkUnits: forward.length * 2 * 2 },
    );
    expect(detailed.result).not.toBeNull();
    expect(detailed.result?.status).toBe('ambiguous');
    expect(detailed.result?.materializable).toBe(false);
    expect(detailed.result?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'binding_scan_work_limit',
    }));
  });

  it('preserves explicit tails, reports competing products, and preserves template IUPAC symbols', () => {
    const template = `${binding}NNNN${binding}TTTT${binding}`;
    const reverse = reverseComplement(binding);
    const result = simulatePCR(
      template,
      `GGTCTCN${binding}`,
      `GAGACCN${reverse}`,
      [],
      'linear',
      {
        forward: { start: 0, end: 10 },
        reverse: { start: 14, end: 24 },
      },
      { minMatched3PrimeLength: 10 },
    );

    expect(result).not.toBeNull();
    expect(result?.forward.tail).toBe('GGTCTCN');
    expect(result?.reverse.tail).toBe('GAGACCN');
    expect(result?.product).toContain('NNNN');
    expect(result?.status).toBe('ambiguous');
    expect(result?.competingProducts).toEqual([]);
    expect(result?.warnings.join(' ')).toMatch(/conditional/i);

    const competing = simulatePCR(
      `${binding}TTTT${binding}TTTT${binding}`,
      binding,
      reverse,
      [],
      'linear',
      undefined,
      { minMatched3PrimeLength: 10 },
    );
    expect(competing?.competingProducts.length).toBeGreaterThan(0);
    expect(competing?.status).toBe('ambiguous');
    expect(competing?.warnings.join(' ')).toMatch(/competing/i);
  });

  it('materializes permitted primer mismatches over the template interval with an edit receipt', () => {
    const reverseBinding = 'TTGCAACGTA';
    const template = `TCGTTGCAACGGGG${reverseBinding}`;
    const result = simulatePCR(
      template,
      binding,
      reverseComplement(reverseBinding),
      [],
      'linear',
      {
        forward: { start: 0, end: 10 },
        reverse: { start: 14, end: 24 },
      },
      { minMatched3PrimeLength: 9, maxMismatches: 1 },
    );

    expect(result).not.toBeNull();
    expect(result?.status).toBe('mismatch');
    expect(result?.templateProduct.slice(0, binding.length)).toBe('TCGTTGCAAC');
    expect(result?.product.slice(0, binding.length)).toBe(binding);
    expect(result?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'primer_bases_overwrote_template',
      positions: [0],
    }));
    expect(result?.provenance.bindingEdits).toContainEqual(expect.objectContaining({
      productOffset: 0,
      templatePosition: 0,
      original: 'T',
      replacement: 'A',
      primer: 'forward',
    }));
  });

  it('blocks conflicting overlapping primer edits while retaining agreeing overlaps', () => {
    const template = 'ACGT'.repeat(20);
    const reverseBinding = template.slice(5, 15);
    const reversePrimer = reverseComplement(reverseBinding);
    const forwardBinding = template.slice(0, 10);
    const mismatchedForward = `${forwardBinding.slice(0, 5)}A${forwardBinding.slice(6)}`;
    const conflicting = simulatePCR(
      template,
      mismatchedForward,
      reversePrimer,
      [],
      'linear',
      { forward: { start: 0, end: 10 }, reverse: { start: 5, end: 15 } },
      { minMatched3PrimeLength: 4, maxMismatches: 1 },
    );
    expect(conflicting?.materializable).toBe(false);
    expect(conflicting?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'conflicting_overlapping_binding_edits',
      positions: [5],
    }));

    const agreeing = simulatePCR(
      template,
      forwardBinding,
      reversePrimer,
      [],
      'linear',
      { forward: { start: 0, end: 10 }, reverse: { start: 5, end: 15 } },
    );
    expect(agreeing?.materializable).toBe(true);
    expect(agreeing?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'overlapping_binding_regions',
      positions: [5, 6, 7, 8, 9],
    }));
    expect(agreeing?.diagnostics.some(({ code }) => code === 'conflicting_overlapping_binding_edits')).toBe(false);
  });

  it('requires explicit selection or opt-in before inferring 5\u2032 tails', () => {
    const reverseBinding = 'TTGCAACGTA';
    const template = `${binding}GGGG${reverseBinding}`;
    const forwardWithTail = `GGGG${binding}`;
    const reversePrimer = reverseComplement(reverseBinding);

    expect(simulatePCR(template, forwardWithTail, reversePrimer)).toBeNull();

    const inferred = simulatePCR(
      template,
      forwardWithTail,
      reversePrimer,
      [],
      'linear',
      undefined,
      { allowImplicitTails: true },
    );
    expect(inferred).not.toBeNull();
    expect(inferred?.forward.tail).toBe('GGGG');
    expect(inferred?.forward.tailSource).toBe('inferred');
    expect(inferred?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'implicit_tail',
      primer: 'forward',
    }));
    expect(inferred?.provenance.implicitTails.forward).toBe(true);
    expect(inferred?.materializable).toBe(false);
  });

  it('bounds oligos, inferred tails, and the final tailed amplicon', () => {
    const oversizedPrimer = 'A'.repeat(MAX_PCR_OLIGO_LENGTH + 1);
    expect(findPrimerBindings('A'.repeat(MAX_PCR_OLIGO_LENGTH + 20), oversizedPrimer)).toEqual([]);

    const terminalBinding = 'ACGTTGCAAC';
    const template = terminalBinding
      + 'A'.repeat(MAX_PCR_PRODUCT_LENGTH - terminalBinding.length * 2)
      + reverseComplement(terminalBinding);
    const tail = 'A'.repeat(250);
    expect(simulatePCR(
      template,
      tail + terminalBinding,
      tail + terminalBinding,
      [],
      'linear',
      {
        forward: { start: 0, end: terminalBinding.length },
        reverse: { start: template.length - terminalBinding.length, end: template.length },
      },
    )).toBeNull();
  });

  it('does not fabricate a contiguous template from invalid characters', () => {
    expect(findPrimerBindings(`AAA-${binding}`, binding)).toEqual([]);
    expect(simulatePCR(`AAA-${binding}`, binding, reverseComplement(binding))).toBeNull();
  });

  it('keeps primer design tails exact and uses the full oligo for structure filters', () => {
    const sequence = 'ACGT'.repeat(40);
    const design = designForwardPrimerWithDiagnostics(sequence, {
      targetStart: 40,
      targetEnd: 60,
      minLength: 18,
      maxLength: 18,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 0,
      forwardTail: 'GGTCTCN',
    });
    expect(design.candidates.length).toBeGreaterThan(0);
    expect(design.candidates[0].tail).toBe('GGTCTCN');
    expect(design.candidates[0].fullSequence).toBe(`GGTCTCN${design.candidates[0].sequence}`);
    expect(design.candidates[0].secondaryStructureStatus).toBe('ambiguous');
    expect(design.warnings).toContain('Oligo tail contains IUPAC ambiguity symbols; secondary-structure diagnostics require review.');

    const invalidTail = designForwardPrimerWithDiagnostics(sequence, {
      targetStart: 40,
      targetEnd: 60,
      minLength: 18,
      maxLength: 18,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 0,
      forwardTail: 'GGT-CTC',
    });
    expect(invalidTail.candidates).toEqual([]);
    expect(invalidTail.warnings?.join(' ')).toMatch(/invalid nucleotide/i);
  });

  it('fails closed and caps full ordered oligos for adversarial design bounds', () => {
    const sequence = 'ACGT'.repeat(80);
    const invalid = designForwardPrimerWithDiagnostics(sequence, {
      targetStart: 40,
      targetEnd: 60,
      maxLength: Number.POSITIVE_INFINITY,
    });
    expect(invalid.candidates).toEqual([]);
    expect(invalid.warnings?.join(' ')).toMatch(/finite bounded/i);

    const oversizedTail = designForwardPrimerWithDiagnostics(sequence, {
      targetStart: 40,
      targetEnd: 60,
      minLength: 18,
      maxLength: 28,
      forwardTail: 'A'.repeat(MAX_PRIMER_TAIL_LENGTH + 1),
    });
    expect(oversizedTail.candidates).toEqual([]);
    expect(oversizedTail.warnings?.join(' ')).toMatch(/250/);

    const bounded = designForwardPrimerWithDiagnostics(sequence, {
      targetStart: 40,
      targetEnd: 60,
      minLength: 18,
      maxLength: 60,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 0,
      forwardTail: 'A'.repeat(MAX_PRIMER_TAIL_LENGTH),
      maxHairpinDeltaG: null,
      maxSelfDimerDeltaG: null,
    });
    expect(bounded.candidates.length).toBeGreaterThan(0);
    expect(bounded.candidates.every((candidate) => candidate.fullLength <= MAX_PRIMER_OLIGO_LENGTH)).toBe(true);

    for (const invalidParams of [
      { targetStart: Number.NaN, targetEnd: 60 },
      { targetStart: 60, targetEnd: 40 },
      { targetStart: 40, targetEnd: 40 },
      { targetStart: 40, targetEnd: 60, minLength: 11 },
      { targetStart: 40, targetEnd: 60, maxLength: 61 },
      { targetStart: 40, targetEnd: 60, minLength: 30, maxLength: 18 },
      { targetStart: 40, targetEnd: 60, minGC: Number.POSITIVE_INFINITY },
      { targetStart: 40, targetEnd: 60, flankingWindow: Number.NaN },
      { targetStart: 40, targetEnd: 60, maxHairpinDeltaG: Number.NaN },
      { targetStart: 40, targetEnd: 60, maxSelfDimerDeltaG: Number.POSITIVE_INFINITY },
      { targetStart: 40, targetEnd: 60, maxCrossDimerDeltaG: Number.NaN },
    ]) {
      expect(normalizePrimerDesignParams(sequence.length, invalidParams, 'forward')).toBeNull();
    }
  });

  it('keeps Tm evidence bounded, fieldwise, and explicit about custom conditions', () => {
    const sequenceLength = 160;
    expect(normalizePrimerDesignParams(sequenceLength, {
      targetStart: 20,
      targetEnd: 80,
      tmOptions: { ...DEFAULT_TM_OPTIONS, naConcentration: 1_001 },
    }, 'forward')).toBeNull();

    class TmOptionsClass {
      naConcentration = 50;
    }
    const getter = vi.fn(() => 50);
    const accessorOptions = Object.defineProperty({}, 'naConcentration', { enumerable: true, get: getter });
    const customPrototypeOptions = Object.create({ inherited: true });
    customPrototypeOptions.naConcentration = 50;
    for (const tmOptions of [
      null,
      'not-an-object',
      [],
      new Date(),
      new TmOptionsClass(),
      accessorOptions,
      customPrototypeOptions,
      { ...DEFAULT_TM_OPTIONS, unknownField: true },
    ]) {
      expect(normalizePrimerDesignParams(sequenceLength, {
        targetStart: 20,
        targetEnd: 80,
        tmOptions: tmOptions as never,
      }, 'forward')).toBeNull();
    }
    expect(getter).not.toHaveBeenCalled();
    expect(normalizePrimerDesignParams(sequenceLength, {
      targetStart: 20,
      targetEnd: 80,
      tmOptions: { ...DEFAULT_TM_OPTIONS, dntpConcentration: 101 },
    }, 'forward')).toBeNull();
    expect(normalizePrimerDesignParams(sequenceLength, {
      targetStart: 20,
      targetEnd: 80,
      tmOptions: { ...DEFAULT_TM_OPTIONS, selfComplementary: 'yes' as never },
    }, 'forward')).toBeNull();
    expect(normalizePrimerDesignParams(sequenceLength, {
      targetStart: 20,
      targetEnd: 80,
      tmConditionPresetId: 'unsupported-condition',
    }, 'forward')).toBeNull();

    const custom = normalizePrimerDesignParams(sequenceLength, {
      targetStart: 20,
      targetEnd: 80,
      tmConditionPresetId: 'custom',
      tmOptions: {
        ...DEFAULT_TM_OPTIONS,
        naConcentration: 75,
        mgConcentration: 2,
        dntpConcentration: 0.8,
        primerConcentration: 100,
        selfComplementary: false,
      },
    }, 'forward');
    expect(custom?.tmEvidence).toMatchObject({
      schema: 'motif.primer.tm-evidence.v1',
      conditionPresetId: 'custom',
      model: 'santalucia-1998-nearest-neighbor',
      engine: 'motif-tm-calculator',
      options: {
        naConcentration: 75,
        mgConcentration: 2,
        dntpConcentration: 0.8,
        primerConcentration: 100,
        selfComplementarity: 'disabled',
      },
    });
  });

  it('reports directional pool truncation instead of presenting capped pairing as exhaustive', () => {
    const result = designPrimerPairWithDiagnostics('ACGT'.repeat(80), {
      targetStart: 20,
      targetEnd: 80,
      minLength: 18,
      maxLength: 18,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 20,
      maxHairpinDeltaG: null,
      maxSelfDimerDeltaG: null,
      maxCrossDimerDeltaG: null,
      maxPairingCandidatesPerDirection: 1,
    });
    expect(result.forwardPool.limit).toBe(1);
    expect(result.reversePool.limit).toBe(1);
    expect(result.forwardPool.enumeratedCount).toBeGreaterThan(1);
    expect(result.reversePool.enumeratedCount).toBeGreaterThan(1);
    expect(result.forwardPool.truncated).toBe(true);
    expect(result.reversePool.truncated).toBe(true);
    expect(result.forwardPool.exhaustive).toBe(false);
    expect(result.reversePool.exhaustive).toBe(false);
    expect(result.warnings?.join(' ')).toMatch(/directional pool is not exhaustive/i);
  });

  it('marks full ordered oligos with ambiguous tails for secondary-structure review', () => {
    const hairpin = predictHairpin('GGTCTCNACGTACGTACGTACGT');
    const dimer = predictPrimerDimer('GGTCTCNACGTACGTACGTACGT', 'GAGACCNACGTACGTACGTACGT');
    expect(hairpin.status).toBe('ambiguous');
    expect(hairpin.evaluatedSequence).toContain('N');
    expect(dimer.status).toBe('ambiguous');
    expect(dimer.evaluatedSequence).toContain('|');
  });

  it('reports the strongest dimer run and its 3′-end participation', () => {
    const primer1 = 'GCGTACGGA';
    const primer2 = reverseComplement(primer1);
    const dimer = predictPrimerDimer(primer1, primer2);

    expect(dimer.status).toBe('exact');
    expect(dimer.pairLength).toBe(primer1.length);
    expect(dimer.threePrimeOverlap).toEqual({ primer1: 5, primer2: 5 });
    expect(dimer.threePrimeParticipation).toBe('both');
  });

  it('evaluates every contiguous dimer run instead of only the longest at an offset', () => {
    const primer1 = 'AAAAATTTGCGC';
    const alignedComplement = 'AAAAAGGGGCGC';
    const dimer = predictPrimerDimer(primer1, reverseComplement(alignedComplement));

    expect(dimer.structure).toContain('GCGC');
    expect(dimer.pairLength).toBe(4);
    expect(dimer.deltaG).toBeLessThan(0);
  });

  it('keeps the quadratic hairpin scan exact for ordinary oligos', () => {
    const sequences = [
      'GCGAAACGC',
      'ACGTACGTACGTACGT',
      'GATTACAGCGTACGATCGATCG',
      'CGCGTTTACGCGATATCGCG',
      'ATGCATGCATGCATGCATGCATGC',
    ];
    let state = 0x12345678;
    for (let sample = 0; sample < 20; sample += 1) {
      const length = 8 + (sample % 5) * 4;
      let sequence = '';
      for (let index = 0; index < length; index += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        sequence += 'ACGT'[state % 4];
      }
      sequences.push(sequence);
    }
    for (const sequence of sequences) {
      expect(predictHairpin(sequence)).toMatchObject(referenceHairpin(sequence));
    }
  });

  it('evaluates the maximum allowed direct oligo without cubic work', () => {
    const maxOligo = 'ACGT'.repeat(MAX_PRIMER_STRUCTURE_SEQUENCE_LENGTH / 4);
    expect(maxOligo).toHaveLength(MAX_PRIMER_STRUCTURE_SEQUENCE_LENGTH);
    expect(predictHairpin(maxOligo).status).toBe('exact');
    expect(predictPrimerDimer(maxOligo, maxOligo).status).toBe('exact');
    expect(predictSelfDimer(maxOligo).status).toBe('exact');
  });

  it('returns an explicit work-limit status for direct oversized oligos', () => {
    const oversized = 'ACGT'.repeat(Math.ceil((MAX_PRIMER_STRUCTURE_SEQUENCE_LENGTH + 1) / 4));
    expect(oversized.length).toBeGreaterThan(MAX_PRIMER_STRUCTURE_SEQUENCE_LENGTH);
    expect(predictHairpin(oversized).status).toBe('work-limit');
    expect(predictHairpin(oversized).warning).toMatch(/bounded/i);
    expect(predictPrimerDimer(oversized, 'ACGTACGT').status).toBe('work-limit');
    expect(predictSelfDimer(oversized).status).toBe('work-limit');
  });

  it('bounds candidate structure enumeration with a maximum tail', () => {
    const tail = `${'ACGT'.repeat(62)}AC`;
    const design = designForwardPrimerWithDiagnostics('ACGT'.repeat(350), {
      targetStart: 400,
      targetEnd: 500,
      minLength: 12,
      maxLength: 60,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 250,
      forwardTail: tail,
      maxHairpinDeltaG: -1000,
      maxSelfDimerDeltaG: -1000,
    });
    expect(design.rejections.workLimit).toBeGreaterThan(0);
    expect(design.warnings?.join(' ')).toMatch(/work units|bounded/i);
    expect(design.candidates.every((candidate) => candidate.secondaryStructureStatus !== 'work-limit')).toBe(true);
  });

  it('rejects every pair when the explicit cross-dimer cutoff is exceeded', () => {
    expect(normalizePrimerDesignParams(120, {
      targetStart: 20,
      targetEnd: 40,
    }, 'forward')?.maxCrossDimerDeltaG).toBe(-5);
    const result = designPrimerPairWithDiagnostics('ACGT'.repeat(30), {
      targetStart: 20,
      targetEnd: 40,
      minLength: 18,
      maxLength: 18,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 0,
      maxHairpinDeltaG: null,
      maxSelfDimerDeltaG: null,
      maxCrossDimerDeltaG: 0,
    });
    expect(result.forwardCount).toBeGreaterThan(0);
    expect(result.reverseCount).toBeGreaterThan(0);
    expect(result.pairs).toEqual([]);
    expect(result.rejections.crossDimer).toBeGreaterThan(0);

    const disabled = designPrimerPairWithDiagnostics('ACGT'.repeat(30), {
      targetStart: 20,
      targetEnd: 40,
      minLength: 18,
      maxLength: 18,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 0,
      maxHairpinDeltaG: null,
      maxSelfDimerDeltaG: null,
      maxCrossDimerDeltaG: null,
    });
    expect(disabled.pairs.length).toBeGreaterThan(0);
    expect(disabled.pairs[0].crossDimer?.status).toBe('exact');
  });

  it('splits a circular origin feature into product coordinates', () => {
    const template = `${binding}${'A'.repeat(20)}${binding}`;
    const reverse = reverseComplement(binding);
    const feature: Feature = {
      id: 'origin-feature',
      name: 'origin feature',
      type: 'cds',
      start: 35,
      end: 5,
      strand: 1,
      color: '#000000',
      metadata: {},
    };
    const result = simulatePCR(
      template,
      binding,
      reverse,
      [feature],
      'circular',
      {
        forward: { start: 30, end: 40 },
        reverse: { start: 0, end: 10 },
      },
    );
    expect(result?.wrapsOrigin).toBe(true);
    expect(result?.features[0]).toMatchObject({
      start: 5,
      end: 15,
      subRanges: [
        { start: 5, end: 10 },
        { start: 10, end: 15 },
      ],
      metadata: { pcrSourceSplitAtOrigin: true },
    });
  });
});
