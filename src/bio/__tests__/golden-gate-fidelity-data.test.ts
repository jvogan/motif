import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GOLDEN_GATE_FIDELITY_RAW_DATASETS } from '../golden-gate-fidelity-data';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// Hashes of the decimal `row,column,count` text and overhang labels as they
// were first transcribed literally from the S1–S5 tables. The packed storage
// must expand to exactly this text.
describe('packed Golden Gate fidelity data', () => {
  it('expands every matrix to the exact decimal triples transcribed from the source tables', () => {
    expect(GOLDEN_GATE_FIDELITY_RAW_DATASETS.map((dataset) => [dataset.id, sha256(dataset.nonZeroCounts)])).toEqual([
      ['pryor-2020-bsai-hfv2', '143e008e609d03ce33eaec0531825818a14526c04cd078fce0112aad5b45e3ca'],
      ['pryor-2020-bsmbi-v2', '10cc9788f757f7cf222641c86edcad282d23156c996e461a80085fba3ba17c83'],
      ['pryor-2020-esp3i', '7e577aa33785d13b80d4b9bdde0449415a0d572b49be8bc00e7f5ba9ad4ded31'],
      ['pryor-2020-bbsi-hf', '8618007f28a1daaaa65e489ca673218b99fbe3cee42aa6f8610e3c848f1c6127'],
      ['pryor-2020-sapi', '62d962418716cd9735e3f494758c71329b85e106e2cf5730a10c5621aaa51e0e'],
    ]);
  });

  it('generates each overhang axis in the source tables’ A, C, G, T order', () => {
    expect(GOLDEN_GATE_FIDELITY_RAW_DATASETS.map((dataset) => sha256(dataset.overhangs.join(',')))).toEqual([
      ...Array.from({ length: 4 }, () => 'a6030363291860d517eb1fc3a0d1e8d08a5e8a48f8f341b8f361e80900082667'),
      'a0efacc1c02266fc2a29d5113c03c12a60616d8687b48101cbfa6df0953fb008',
    ]);
    expect(GOLDEN_GATE_FIDELITY_RAW_DATASETS[0].overhangs.slice(0, 3)).toEqual(['AAAA', 'AAAC', 'AAAG']);
    expect(GOLDEN_GATE_FIDELITY_RAW_DATASETS[4].overhangs.at(-1)).toBe('TTT');
  });

  it('exports the same raw datasets as the literal transcription', () => {
    expect(sha256(JSON.stringify(GOLDEN_GATE_FIDELITY_RAW_DATASETS)))
      .toBe('8c5978cef36fc311ffe3337ae365dd0cf0e1b1f2a43d2e6c5181bae7020723cf');
  });
});
