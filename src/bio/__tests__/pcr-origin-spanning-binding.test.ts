import { describe, expect, it } from 'vitest';
import {
  estimatePCRBindingScanWorkUnits,
  findPrimerBindings,
  findPrimerBindingsWithDiagnostics,
  simulatePCR,
  simulatePCRWithDiagnostics,
} from '../pcr';
import { reverseComplement } from '../reverse-complement';
import type { Feature } from '../types';

// 60 bp template in which every 8-mer occurs once across both strands,
// including the windows that read across the circular origin. Exact
// full-length primers therefore have exactly one site per strand.
const TEMPLATE = 'GCGCCCTCCTGAAGTGCGTGGACACTCGCTATGAATCTCTGATTTACCCACTCTGCCAAA';
const L = TEMPLATE.length;

// Forward site [55, 10): last 5 bases followed by the first 10 bases.
const ORIGIN_FORWARD = 'CCAAAGCGCCCTCCT';
// Reverse primer for forward-strand site [30, 45).
const DOWNSTREAM_REVERSE = 'AAATCAGAGATTCAT';
// Forward primer for site [20, 35).
const UPSTREAM_FORWARD = 'GACACTCGCTATGAA';
// Reverse primer for forward-strand site [52, 7), which crosses the origin.
const ORIGIN_REVERSE = 'AGGGCGCTTTGGCAG';

function feature(id: string, start: number, end: number, strand: 1 | -1 = 1): Feature {
  return {
    id,
    name: id,
    type: 'misc_feature',
    start,
    end,
    strand,
    color: '#000000',
    metadata: {},
  };
}

describe('PCR binding sites that cross a circular origin', () => {
  it('fixture primers are the template windows they claim to be', () => {
    expect(ORIGIN_FORWARD).toBe(TEMPLATE.slice(55) + TEMPLATE.slice(0, 10));
    expect(DOWNSTREAM_REVERSE).toBe(reverseComplement(TEMPLATE.slice(30, 45)));
    expect(UPSTREAM_FORWARD).toBe(TEMPLATE.slice(20, 35));
    expect(ORIGIN_REVERSE).toBe(reverseComplement(TEMPLATE.slice(52) + TEMPLATE.slice(0, 7)));
  });

  it('reports an origin-crossing forward site once, only on a circular scan', () => {
    const linear = findPrimerBindingsWithDiagnostics(TEMPLATE, ORIGIN_FORWARD);
    expect(linear.candidates).toEqual([]);
    expect(findPrimerBindings(TEMPLATE, ORIGIN_FORWARD, undefined, 'linear')).toEqual([]);

    const circular = findPrimerBindingsWithDiagnostics(TEMPLATE, ORIGIN_FORWARD, undefined, 'circular');
    expect(circular.complete).toBe(true);
    expect(circular.candidates).toStrictEqual([{
      bindStart: 55,
      bindEnd: 10,
      bindingSequence: ORIGIN_FORWARD,
      tail: '',
      mismatchCount: 0,
      matched3PrimeLength: 15,
      status: 'exact',
      tailSource: 'none',
      spansOrigin: true,
    }]);
  });

  it('amplifies from a forward primer that crosses the origin', () => {
    const circular = simulatePCR(TEMPLATE, ORIGIN_FORWARD, DOWNSTREAM_REVERSE, undefined, 'circular');
    expect(circular).not.toBeNull();
    expect(circular?.forward).toMatchObject({ bindStart: 55, bindEnd: 10, spansOrigin: true, tail: '' });
    expect(circular?.reverse).toMatchObject({ bindStart: 30, bindEnd: 45 });
    expect('spansOrigin' in (circular?.reverse ?? {})).toBe(false);
    expect(circular?.wrapsOrigin).toBe(true);
    expect(circular?.product).toBe('CCAAAGCGCCCTCCTGAAGTGCGTGGACACTCGCTATGAATCTCTGATTT');
    expect(circular?.templateProduct).toBe(circular?.product);
    expect(circular?.productLength).toBe(50);
    expect(circular?.status).toBe('exact');
    expect(circular?.competingProducts).toEqual([]);
    expect(circular?.materializable).toBe(true);

    expect(simulatePCR(TEMPLATE, ORIGIN_FORWARD, DOWNSTREAM_REVERSE, undefined, 'linear')).toBeNull();
    expect(simulatePCR(TEMPLATE, ORIGIN_FORWARD, DOWNSTREAM_REVERSE)).toBeNull();
  });

  it('amplifies to a reverse primer that crosses the origin', () => {
    const circular = simulatePCR(TEMPLATE, UPSTREAM_FORWARD, ORIGIN_REVERSE, undefined, 'circular');
    expect(circular?.forward).toMatchObject({ bindStart: 20, bindEnd: 35 });
    expect(circular?.reverse).toMatchObject({
      bindStart: 52,
      bindEnd: 7,
      spansOrigin: true,
      bindingSequence: ORIGIN_REVERSE,
    });
    expect(circular?.wrapsOrigin).toBe(true);
    expect(circular?.product).toBe('GACACTCGCTATGAATCTCTGATTTACCCACTCTGCCAAAGCGCCCT');
    expect(circular?.productLength).toBe(47);
    expect(circular?.status).toBe('exact');

    expect(simulatePCR(TEMPLATE, UPSTREAM_FORWARD, ORIGIN_REVERSE, undefined, 'linear')).toBeNull();
  });

  it('keeps the reverse-binding wrap rule exact when both overlapping primers cross the origin', () => {
    const forward = TEMPLATE.slice(52) + TEMPLATE.slice(0, 7);
    const reverse = reverseComplement(TEMPLATE.slice(55) + TEMPLATE.slice(0, 10));
    const result = simulatePCR(TEMPLATE, forward, reverse, undefined, 'circular');
    expect(result?.forward).toMatchObject({ bindStart: 52, bindEnd: 7, spansOrigin: true });
    expect(result?.reverse).toMatchObject({ bindStart: 55, bindEnd: 10, spansOrigin: true });
    expect(result?.wrapsOrigin).toBe(true);
    // Consumers detect a wrapped amplicon by comparing these two coordinates.
    expect(result!.reverse.bindEnd <= result!.forward.bindStart).toBe(true);
    expect(result?.product).toBe('CTGCCAAAGCGCCCTCCT');
    expect(result?.productLength).toBe(18);
    expect(result?.diagnostics.map((diagnostic) => diagnostic.code)).toContain('overlapping_binding_regions');
    expect(result?.materializable).toBe(true);
  });

  it('writes a permitted mismatch in the wrapped part of a primer at its normalized coordinate', () => {
    const mutated = 'CCAAATCGCCCTCCT';
    const result = simulatePCR(TEMPLATE, mutated, DOWNSTREAM_REVERSE, undefined, 'circular', undefined, {
      maxMismatches: 1,
      minMatched3PrimeLength: 8,
    });
    expect(result?.forward).toMatchObject({ bindStart: 55, bindEnd: 10, mismatchCount: 1, status: 'mismatch' });
    expect(result?.wrapsOrigin).toBe(true);
    expect(result?.product).toBe('CCAAATCGCCCTCCTGAAGTGCGTGGACACTCGCTATGAATCTCTGATTT');
    expect(result?.provenance.bindingEdits).toEqual([{
      productOffset: 5,
      templatePosition: 0,
      original: 'G',
      replacement: 'T',
      primer: 'forward',
    }]);
  });

  it('accepts a selected forward binding with a tail that crosses the origin', () => {
    const selection = { forward: { start: 55, end: 10 }, reverse: { start: 30, end: 45 } };
    const result = simulatePCR(
      TEMPLATE,
      `GGATCC${ORIGIN_FORWARD}`,
      `AAGCTT${DOWNSTREAM_REVERSE}`,
      undefined,
      'circular',
      selection,
    );
    expect(result?.forward).toMatchObject({
      bindStart: 55,
      bindEnd: 10,
      spansOrigin: true,
      tail: 'GGATCC',
      tailSource: 'explicit-selection',
    });
    expect(result?.reverse).toMatchObject({ bindStart: 30, bindEnd: 45, tail: 'AAGCTT' });
    expect(result?.wrapsOrigin).toBe(true);
    expect(result?.product).toBe('GGATCCCCAAAGCGCCCTCCTGAAGTGCGTGGACACTCGCTATGAATCTCTGATTTAAGCTT');
    expect(result?.materializable).toBe(true);

    // The same origin-crossing selection is not a valid range on a linear template.
    expect(simulatePCR(
      TEMPLATE,
      `GGATCC${ORIGIN_FORWARD}`,
      `AAGCTT${DOWNSTREAM_REVERSE}`,
      undefined,
      'linear',
      selection,
    )).toBeNull();
  });

  it('accepts a selected reverse binding that crosses the origin', () => {
    const result = simulatePCR(
      TEMPLATE,
      UPSTREAM_FORWARD,
      `AAGCTT${ORIGIN_REVERSE}`,
      undefined,
      'circular',
      { forward: { start: 20, end: 35 }, reverse: { start: 52, end: 7 } },
    );
    expect(result?.reverse).toMatchObject({
      bindStart: 52,
      bindEnd: 7,
      spansOrigin: true,
      tail: 'AAGCTT',
      tailSource: 'explicit-selection',
    });
    expect(result?.product).toBe('GACACTCGCTATGAATCTCTGATTTACCCACTCTGCCAAAGCGCCCTAAGCTT');
  });

  it('rejects a selected binding that does not match the template window', () => {
    expect(simulatePCR(
      TEMPLATE,
      ORIGIN_FORWARD,
      DOWNSTREAM_REVERSE,
      undefined,
      'circular',
      { forward: { start: 54, end: 9 }, reverse: { start: 30, end: 45 } },
    )).toBeNull();
    // A zero-length or full-circle selection is not a binding range.
    expect(simulatePCR(
      TEMPLATE,
      ORIGIN_FORWARD,
      DOWNSTREAM_REVERSE,
      undefined,
      'circular',
      { forward: { start: 55, end: 55 }, reverse: { start: 30, end: 45 } },
    )).toBeNull();
  });

  it('maps template features into a product whose forward primer crosses the origin', () => {
    const features = [
      feature('origin-feature', 56, 12),
      feature('after-origin', 2, 8, -1),
      feature('outside-product', 46, 54),
    ];
    const outcome = simulatePCRWithDiagnostics(
      TEMPLATE,
      ORIGIN_FORWARD,
      DOWNSTREAM_REVERSE,
      features,
      'circular',
    );
    const result = outcome.result;
    expect(result).not.toBeNull();
    const bySource = new Map(result!.features.map((mapped) => [mapped.metadata.pcrSourceFeatureId, mapped]));
    expect(bySource.has('outside-product')).toBe(false);
    expect(bySource.get('origin-feature')).toMatchObject({
      start: 1,
      end: 17,
      subRanges: [
        { start: 1, end: 5 },
        { start: 5, end: 17 },
      ],
      metadata: { pcrSourceSplitAtOrigin: true, pcrSourceStart: 56, pcrSourceEnd: 12 },
    });
    expect(bySource.get('after-origin')).toMatchObject({ start: 7, end: 13, strand: -1 });
    const after = bySource.get('after-origin')!;
    expect(result!.product.slice(after.start, after.end)).toBe(TEMPLATE.slice(2, 8));
  });

  it('charges every origin-crossing window to the scan budget', () => {
    const linearWork = estimatePCRBindingScanWorkUnits(L, ORIGIN_FORWARD.length);
    const circularWork = estimatePCRBindingScanWorkUnits(L, ORIGIN_FORWARD.length, { topology: 'circular' });
    expect(linearWork).toBe((L - 15 + 1) * 15 * 2);
    expect(circularWork).toBe(L * 15 * 2);

    const complete = findPrimerBindingsWithDiagnostics(TEMPLATE, ORIGIN_FORWARD, undefined, 'circular');
    expect(complete.workUnits).toBe(circularWork);

    const capped = findPrimerBindingsWithDiagnostics(
      TEMPLATE,
      ORIGIN_FORWARD,
      { maxBindingScanWorkUnits: linearWork },
      'circular',
    );
    expect(capped.complete).toBe(false);
    expect(capped.candidates).toEqual([]);
    expect(capped.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['binding_scan_work_limit']);
    expect(capped.workUnits).toBe(linearWork);

    const linear = findPrimerBindingsWithDiagnostics(TEMPLATE, UPSTREAM_FORWARD, { maxBindingScanWorkUnits: linearWork });
    expect(linear.complete).toBe(true);
    expect(linear.workUnits).toBe(linearWork);
  });

  it('never reads more than one turn of a template shorter than the primer', () => {
    const short = 'ACGTTGCAAC';
    const primer = short.slice(4) + short + short.slice(0, 2);
    expect(findPrimerBindingsWithDiagnostics(short, primer, { minMatched3PrimeLength: 10 }, 'circular').candidates).toEqual([]);
    // A binding exactly one template long is only evaluated as the whole linear text.
    expect(findPrimerBindingsWithDiagnostics(short, short.slice(3) + short.slice(0, 3), undefined, 'circular').candidates)
      .toEqual([]);
    expect(findPrimerBindingsWithDiagnostics(short, short, undefined, 'circular').candidates)
      .toMatchObject([{ bindStart: 0, bindEnd: 10 }]);
  });

  it('matches a rotation-based reference enumeration without double-reporting', () => {
    let seed = 0x2f6b;
    const next = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    const policy = { minMatched3PrimeLength: 4, maxMismatches: 1, allowImplicitTails: true };
    const key = (candidate: { bindStart: number; bindEnd: number; mismatchCount: number; bindingSequence: string }) => (
      `${candidate.bindStart}:${candidate.bindEnd}:${candidate.mismatchCount}:${candidate.bindingSequence.length}`
    );
    for (let trial = 0; trial < 60; trial += 1) {
      const length = 8 + next(20);
      const template = Array.from({ length }, () => 'AC'[next(2)]).join('');
      const primerLength = 5 + next(4);
      const primer = Array.from({ length: primerLength }, () => 'AC'[next(2)]).join('');

      const expected = new Set<string>();
      const doubled = template + template;
      for (let bindingLength = primerLength; bindingLength >= policy.minMatched3PrimeLength; bindingLength -= 1) {
        if (bindingLength > length) continue;
        const suffix = primer.slice(primerLength - bindingLength);
        const starts = bindingLength < length ? length : 1;
        for (let start = 0; start < starts; start += 1) {
          const window = doubled.slice(start, start + bindingLength);
          let mismatches = 0;
          for (let index = 0; index < bindingLength; index += 1) if (window[index] !== suffix[index]) mismatches += 1;
          let run = 0;
          for (let index = bindingLength - 1; index >= 0 && window[index] === suffix[index]; index -= 1) run += 1;
          if (run < policy.minMatched3PrimeLength || mismatches > policy.maxMismatches) continue;
          const end = start + bindingLength > length ? start + bindingLength - length : start + bindingLength;
          expected.add(`${start}:${end}:${mismatches}:${bindingLength}`);
        }
      }

      const circular = findPrimerBindingsWithDiagnostics(template, primer, policy, 'circular');
      expect(circular.complete).toBe(true);
      const keys = circular.candidates.map(key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(keys)).toEqual(expected);
      expect(circular.workUnits).toBe(estimatePCRBindingScanWorkUnits(length, primerLength, {
        ...policy,
        topology: 'circular',
      }));
      for (const candidate of circular.candidates) {
        expect(candidate.spansOrigin === true).toBe(candidate.bindEnd < candidate.bindStart);
      }

      const linear = findPrimerBindingsWithDiagnostics(template, primer, policy);
      expect(linear.candidates).toEqual(circular.candidates.filter((candidate) => candidate.spansOrigin !== true));
    }
  });

  it('leaves a representative linear result unchanged', () => {
    const forward = TEMPLATE.slice(5, 20);
    const reverse = reverseComplement(TEMPLATE.slice(40, 55));
    const result = simulatePCR(TEMPLATE, forward, reverse, [feature('inside', 10, 30)]);
    expect(result).not.toBeNull();
    expect(result!.forward).toStrictEqual({
      bindStart: 5,
      bindEnd: 20,
      bindingSequence: forward,
      tail: '',
      mismatchCount: 0,
      matched3PrimeLength: 15,
      status: 'exact',
      tailSource: 'none',
      tm: result!.forward.tm,
      gcPercent: result!.forward.gcPercent,
      candidateCount: 1,
    });
    expect(result!.reverse).toStrictEqual({
      bindStart: 40,
      bindEnd: 55,
      bindingSequence: reverse,
      tail: '',
      mismatchCount: 0,
      matched3PrimeLength: 15,
      status: 'exact',
      tailSource: 'none',
      tm: result!.reverse.tm,
      gcPercent: result!.reverse.gcPercent,
      candidateCount: 1,
    });
    expect(result!.product).toBe(TEMPLATE.slice(5, 55));
    expect(result!.productLength).toBe(50);
    expect(result!.wrapsOrigin).toBe(false);
    expect(result!.status).toBe('exact');
    expect(result!.competingProducts).toEqual([]);
    expect(result!.features).toHaveLength(1);
    expect(result!.features[0]).toMatchObject({ start: 5, end: 25 });

    // A circular template whose sites do not cross the origin yields the same product.
    const circular = simulatePCR(TEMPLATE, forward, reverse, [feature('inside', 10, 30)], 'circular');
    expect(circular?.product).toBe(result!.product);
    expect(circular?.forward).toStrictEqual(result!.forward);
    expect(circular?.reverse).toStrictEqual(result!.reverse);
    expect(circular?.wrapsOrigin).toBe(false);
  });
});
