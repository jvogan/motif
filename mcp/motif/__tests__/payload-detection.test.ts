import { describe, expect, it } from 'vitest';

import { prepareMotifWorkbench } from '../payload.js';

describe('Motif payload format detection', () => {
  it('stays linear on content made of many blank lines', () => {
    const content = `ACGT\n${'\n'.repeat(200_000)}x`;
    const startedAt = performance.now();
    try {
      prepareMotifWorkbench({ content });
    } catch {
      // Rejecting the malformed sequence is acceptable; only timing matters here.
    }
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it('still detects GenBank records with CRLF line endings and indented LOCUS lines', () => {
    const content = [
      '  LOCUS       tiny                       8 bp    DNA     linear   SYN 01-JAN-2000',
      'ORIGIN',
      '        1 acgtacgt',
      '//',
      '',
    ].join('\r\n');
    const result = prepareMotifWorkbench({ content });
    expect(JSON.stringify(result.payload)).toContain('"molecule":"dna"');
  });
  describe('raw sequence content without a molecule hint', () => {
    const recordsOf = (result: ReturnType<typeof prepareMotifWorkbench>) =>
      (result.payload as { records: Array<{ molecule: string; sequence: string }> }).records;

    it('infers DNA for a nucleotide-only sequence', () => {
      const result = prepareMotifWorkbench({ content: 'ATGCATGCATGCNN' });
      expect(recordsOf(result)[0]).toMatchObject({ molecule: 'dna', sequence: 'ATGCATGCATGCNN' });
    });

    it('infers DNA for a .seq filename with wrapped lines', () => {
      const result = prepareMotifWorkbench({ content: 'ATGCATGC\nATGCATGC\n', filename: 'insert.seq' });
      const [record] = recordsOf(result);
      expect(record?.molecule).toBe('dna');
      expect(record?.sequence.replace(/\s+/gu, '')).toBe('ATGCATGCATGCATGC');
    });

    it('infers RNA when only uracil is present', () => {
      expect(recordsOf(prepareMotifWorkbench({ content: 'AUGCUAUG' }))[0]?.molecule).toBe('rna');
    });

    it('infers protein for an amino-acid alphabet', () => {
      expect(recordsOf(prepareMotifWorkbench({ content: 'MKTAYIAKQRQISFVKSHFSRQ' }))[0]?.molecule).toBe('protein');
    });

    it('still honors an explicit molecule', () => {
      expect(recordsOf(prepareMotifWorkbench({ content: 'ACGT', molecule: 'protein' }))[0]?.molecule).toBe('protein');
    });

    it('rejects text that is not a sequence with a clear error', () => {
      expect(() => prepareMotifWorkbench({ content: 'hello world, this is prose.' }))
        .toThrow(/not a recognizable sequence/iu);
    });
  });
});
