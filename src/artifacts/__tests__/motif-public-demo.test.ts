import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGenBank } from '../../bio/genbank-parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('public Motif demo record', () => {
  it('keeps the documented synthetic identity and complete sequence', () => {
    const content = readFileSync(resolve(root, 'examples/motif-demo.gb'), 'utf8');
    const records = parseGenBank(content);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      name: 'MOTIFDEMO',
      length: 180,
      topology: 'linear',
      moleculeType: 'DNA',
      truncated: undefined,
    });
    expect(records[0].sequence).toHaveLength(180);
    expect(records[0].features.map((feature) => feature.name)).toEqual([
      'source',
      'demo_cds',
    ]);
  });
});
