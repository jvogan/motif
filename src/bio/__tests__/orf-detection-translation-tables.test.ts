import { describe, expect, it } from 'vitest';
import { getTranslationTable, STANDARD_CODE } from '../codon-tables';
import { findORFs } from '../orf-detection';
import type { CodonTable, ORF } from '../types';

function forwardOrfAtOrigin(sequence: string, table: CodonTable): ORF | undefined {
  return findORFs(sequence, 1, table).find((orf) => orf.strand === 1 && orf.start === 0);
}

describe('translation-table-aware ORF detection', () => {
  it('uses each table\'s alternative initiator set', () => {
    const sequence = 'GTGAAATAA';

    expect(forwardOrfAtOrigin(sequence, STANDARD_CODE)).toBeUndefined();
    expect(forwardOrfAtOrigin(sequence, getTranslationTable(11))).toMatchObject({
      start: 0,
      end: 9,
      aminoAcids: 2,
      startCodon: 'GTG',
      stopCodon: 'TAA',
    });
    expect(forwardOrfAtOrigin('TTGAAATAA', STANDARD_CODE)).toMatchObject({
      startCodon: 'TTG',
      stopCodon: 'TAA',
    });
  });

  it('recognizes a deterministic ambiguous initiator codon', () => {
    expect(forwardOrfAtOrigin('ATHAAATAA', getTranslationTable(2))).toMatchObject({
      start: 0,
      end: 9,
      startCodon: 'ATH',
      stopCodon: 'TAA',
    });
  });

  it('ends an ORF at a table-specific mitochondrial stop', () => {
    const sequence = 'ATGAAAAGATTTTAA';

    expect(forwardOrfAtOrigin(sequence, STANDARD_CODE)).toMatchObject({
      end: 15,
      aminoAcids: 4,
      stopCodon: 'TAA',
    });
    expect(forwardOrfAtOrigin(sequence, getTranslationTable(2))).toMatchObject({
      end: 9,
      aminoAcids: 2,
      stopCodon: 'AGA',
    });
  });

  it('does not treat a reassigned TAG codon as a stop', () => {
    const sequence = 'ATGAAATAGCCCTGA';

    expect(forwardOrfAtOrigin(sequence, STANDARD_CODE)).toMatchObject({
      end: 9,
      aminoAcids: 2,
      stopCodon: 'TAG',
    });
    expect(forwardOrfAtOrigin(sequence, getTranslationTable(15))).toMatchObject({
      end: 15,
      aminoAcids: 4,
      stopCodon: 'TGA',
    });
    expect(forwardOrfAtOrigin(sequence, getTranslationTable(32))).toMatchObject({
      end: 15,
      aminoAcids: 4,
      stopCodon: 'TGA',
    });
  });

  it('honors a table supplied through the options overload', () => {
    const sequence = 'ATGAAAAGATTTTAA';
    const orf = findORFs(sequence, 30, STANDARD_CODE, {
      minAminoAcids: 1,
      table: getTranslationTable(2),
    }).find((candidate) => candidate.strand === 1 && candidate.start === 0);

    expect(orf).toMatchObject({ end: 9, stopCodon: 'AGA' });
  });

  it('accepts every IUPAC DNA ambiguity symbol instead of treating it as protein input', () => {
    for (const symbol of 'ACGTRYSWKMBDHVN') {
      const orfs = findORFs(`ATG${symbol}AATGA`, 1, STANDARD_CODE);
      expect(orfs.some((orf) => orf.strand === 1 && orf.start === 0), symbol).toBe(true);
    }
  });

  it('reports partial circular ORFs without inventing a second revolution or stop', () => {
    const orfs = findORFs('ATGAAA', 1, STANDARD_CODE, { topology: 'circular' });
    const forward = orfs.find((orf) => orf.strand === 1 && orf.start === 0);

    expect(forward).toMatchObject({
      start: 0,
      end: 6,
      length: 6,
      stopCodon: '',
      status: 'partial',
    });
    expect(forward?.warnings).toContain('No in-frame stop codon within one complete circular revolution');
    expect(orfs.every((orf) => orf.end <= orf.start + 6)).toBe(true);
  });
});

describe('ORF scan memoisation', () => {
  // A 2,578-base circular record, the size the workspace actually opens. The
  // scan doubles both strands for a circular topology and tests every codon in
  // six frames, so it is the most expensive pure function the artifact calls.
  const sequence = (() => {
    let out = 'ATG';
    // Deterministic pseudo-random bases: a fixed LCG, so the cost and the ORF
    // set are the same on every machine and every run.
    let seed = 20260831;
    while (out.length < 2578) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      // High bits only. An LCG's low bits cycle with a tiny period — `seed % 4`
      // here produced a repeating base pattern, and a periodic record has the
      // same ORF count at every minimum length, which quietly made the
      // cache-key assertions below unable to fail.
      out += 'ACGT'[(seed >>> 16) % 4];
    }
    return out;
  })();

  it('answers a repeated scan from cache instead of walking the record again', () => {
    const first = findORFs(sequence, 30, STANDARD_CODE, { topology: 'circular' });
    expect(first.length).toBeGreaterThan(0);

    const coldStart = performance.now();
    findORFs(`${sequence}A`, 30, STANDARD_CODE, { topology: 'circular' });
    const cold = performance.now() - coldStart;

    const warmStart = performance.now();
    const second = findORFs(sequence, 30, STANDARD_CODE, { topology: 'circular' });
    const warm = performance.now() - warmStart;

    expect(second).toEqual(first);
    // A hit is a map lookup and an array copy against a six-frame walk. The
    // margin is wide on purpose: this guards that the cache exists at all, not
    // a particular speed. Dragging a selection re-asked this same question on
    // every pointermove.
    expect(warm).toBeLessThan(cold / 10);
  });

  it('does not let a caller that sorts its result rewrite the cached answer', () => {
    const table = getTranslationTable(11);
    // A sequence nothing has scanned yet, so the first call below is the MISS
    // that fills the slot. Both the miss and the hit have to hand out copies:
    // the scan sorts its own array by length on the way out, and a caller that
    // sorts or truncates the array it was handed would otherwise be editing the
    // answer every later caller receives.
    const fresh = `${sequence}ATGAAATTTGGGCCCTAA`;
    const first = findORFs(fresh, 30, table, { topology: 'linear' });
    expect(first.length).toBeGreaterThan(1);
    const expected = first.map((orf) => ({ ...orf }));

    first.sort((a, b) => a.start - b.start);
    first.length = 1;
    const second = findORFs(fresh, 30, table, { topology: 'linear' });
    expect(second).toEqual(expected);

    second.reverse();
    expect(findORFs(fresh, 30, table, { topology: 'linear' })).toEqual(expected);
  });

  it('holds a whole shipped inventory without evicting the record you came from', () => {
    // The shipped artifact carries 13 vector records and the cache held 12, so
    // walking the tab strip evicted the entry the next tab was about to ask
    // for and every lap missed. Round-robin switching improved from 48.5ms to
    // only 42.5ms because of it, while a two-record alternation reached 27.0ms.
    const inventory = Array.from({ length: 13 }, (_, index) => `${sequence.slice(index * 3)}${'ACG'.repeat(index + 1)}`);
    const answers = inventory.map((seq) => findORFs(seq, 30, STANDARD_CODE, { topology: 'circular' }));

    const coldStart = performance.now();
    findORFs(`${sequence}TTTTTTTTT`, 30, STANDARD_CODE, { topology: 'circular' });
    const cold = performance.now() - coldStart;

    // A full lap: every record must still answer from cache after all 13 have
    // been scanned, which is exactly what a 12-entry cache could not do.
    const lapStart = performance.now();
    const secondLap = inventory.map((seq) => findORFs(seq, 30, STANDARD_CODE, { topology: 'circular' }));
    const lap = performance.now() - lapStart;

    expect(secondLap).toEqual(answers);
    expect(lap).toBeLessThan(cold);
  });

  it('survives a record that yields more ORFs than an argument list can hold', () => {
    // Found by the size-bound test above. The forward frames were appended with
    // `orfs.push(...found)`, which passes every ORF as an argument: a 2.4 Mb
    // record threw `RangeError: Maximum call stack size exceeded` before it
    // could return, so the scan failed on exactly the records it runs longest
    // on. This engine's argument list gives out between 100,000 and 125,000, so
    // the sequence has to be long enough to clear that: 140,000 minimal ORFs.
    const many = 'ATGTAA'.repeat(140_000);
    const found = findORFs(many, 1, STANDARD_CODE, { topology: 'linear' });
    expect(found.length).toBeGreaterThan(130_000);
  });

  it('returns but does not cache an oversized ORF result set', () => {
    const table: CodonTable = {
      ...STANDARD_CODE,
      id: 10_002,
      name: 'Oversized result cache fixture',
      codons: { ...STANDARD_CODE.codons },
      starts: ['ATG'],
      stops: ['TAA'],
    };
    const dense = 'ATGTAA'.repeat(26_000);
    const first = findORFs(dense, 1, table, { topology: 'linear' });
    expect(first.length).toBeGreaterThan(25_000);

    // A cached answer would survive this mutation. Recomputing to an empty
    // result proves the oversized array was not retained.
    table.starts = [];
    expect(findORFs(dense, 1, table, { topology: 'linear' })).toEqual([]);
  });

  it('bounds total cached ORF objects independently of sequence characters', () => {
    const table: CodonTable = {
      ...STANDARD_CODE,
      id: 10_003,
      name: 'Total result cache fixture',
      codons: { ...STANDARD_CODE.codons },
      starts: ['ATG'],
      stops: ['TAA'],
    };
    const records = Array.from({ length: 3 }, (_, index) => (
      `${'ATGTAA'.repeat(20_000)}${'TAA'.repeat(index)}`
    ));
    const answers = records.map((record) => findORFs(record, 1, table, { topology: 'linear' }));
    expect(answers.map((answer) => answer.length)).toEqual([20_000, 20_000, 20_000]);

    // Three entries fit under the character budget but exceed the 50k result
    // budget. The two newest remain cached; the oldest must be recomputed.
    table.starts = [];
    expect(findORFs(records[2], 1, table, { topology: 'linear' })).toEqual(answers[2]);
    expect(findORFs(records[1], 1, table, { topology: 'linear' })).toEqual(answers[1]);
    expect(findORFs(records[0], 1, table, { topology: 'linear' })).toEqual([]);
  });

  it('drops old scans rather than holding an unbounded amount of sequence', () => {
    // The count cap alone cannot bound memory: one 5 Mb record is a 5 Mb key.
    // A verification run confirmed the character bound never binds on a normal
    // inventory of thirteen plasmids, so this is the only exercise the branch
    // gets. What it has to guarantee is that eviction terminates and never
    // throws away the answer it was just asked for.
    // All stop codons, so the scan finds nothing; the point here is the
    // eviction arithmetic, not result construction. Use asymmetric entries so
    // their keys still cross the four-million-character bound without scanning
    // two multi-megabase records twice on slower compatibility runners.
    const evictionTable: CodonTable = {
      ...STANDARD_CODE,
      id: 10_001,
      name: 'Cache eviction fixture',
      codons: { ...STANDARD_CODE.codons },
      starts: [...STANDARD_CODE.starts],
      stops: [...STANDARD_CODE.stops],
    };
    const oldest = `ATGAAATAA${'TAA'.repeat(99_997)}`; // 300,000 characters
    const newest = 'TAA'.repeat(1_233_334); // 3,700,002 characters
    const first = findORFs(oldest, 1, evictionTable, { topology: 'linear' });
    const second = findORFs(newest, 1, evictionTable, { topology: 'linear' });
    expect(first.length).toBeGreaterThan(0);

    // Together these exceed the bound, so the first is evicted and the second
    // — the one just inserted — is kept. Changing the table's initiator set
    // makes a rescan observable without exposing cache internals: the retained
    // newest entry still answers exactly as cached, while the evicted oldest
    // entry is recomputed and no longer contains its original ORF.
    evictionTable.starts = [];
    expect(findORFs(newest, 1, evictionTable, { topology: 'linear' })).toEqual(second);
    expect(findORFs(oldest, 1, evictionTable, { topology: 'linear' })).toEqual([]);

    // And the cache still works for ordinary records afterwards.
    const small = findORFs(sequence, 30, STANDARD_CODE, { topology: 'linear' });
    expect(findORFs(sequence, 30, STANDARD_CODE, { topology: 'linear' })).toEqual(small);
  });

  it('keys the cache on every input that changes the answer', () => {
    const base = findORFs(sequence, 30, STANDARD_CODE, { topology: 'linear' });
    const circular = findORFs(sequence, 30, STANDARD_CODE, { topology: 'circular' });
    const permissive = findORFs(sequence, 1, STANDARD_CODE, { topology: 'linear' });
    const otherTable = findORFs(sequence, 30, getTranslationTable(2), { topology: 'linear' });

    // Each of the four inputs must reach a different cache slot, so each answer
    // has to differ from the one taken at the default settings. Ask the same
    // questions again: an unkeyed cache would hand back the first answer.
    expect(circular).not.toEqual(base);
    expect(permissive.length).toBeGreaterThan(base.length);
    expect(otherTable).not.toEqual(base);
    expect(findORFs(sequence, 30, STANDARD_CODE, { topology: 'linear' })).toEqual(base);
    expect(findORFs(sequence, 30, STANDARD_CODE, { topology: 'circular' })).toEqual(circular);
    expect(findORFs(sequence, 1, STANDARD_CODE, { topology: 'linear' })).toEqual(permissive);
    expect(findORFs(sequence, 30, getTranslationTable(2), { topology: 'linear' })).toEqual(otherTable);
  });
});
