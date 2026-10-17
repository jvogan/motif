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
});
