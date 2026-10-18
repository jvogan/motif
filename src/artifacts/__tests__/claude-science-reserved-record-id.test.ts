import { describe, expect, it } from 'vitest';
import { normalizeRecord } from '../motif-artifact';

describe('record ids that name object prototype properties', () => {
  it.each(['__proto__', 'constructor', 'prototype'])('replaces %s with a generated id and keeps the name', (id) => {
    const record = normalizeRecord({ id, name: id, molecule: 'dna', seq: 'ATGCATGC' }, 4);
    expect(record?.id).toBe('record-5');
    expect(record?.name).toBe(id);
  });

  it('keeps an ordinary id unchanged', () => {
    const record = normalizeRecord({ id: 'plasmid-a', molecule: 'dna', seq: 'ATGCATGC' }, 0);
    expect(record?.id).toBe('plasmid-a');
  });

  it('renames a feature whose id names a prototype property', () => {
    const record = normalizeRecord({
      id: 'r', molecule: 'dna', seq: 'ATGCATGCATGC',
      features: [{ id: '__proto__', name: 'f', type: 'misc_feature', start: 0, end: 3, strand: 1 }],
    }, 0);
    expect(record?.features.map((feature) => feature.id)).toEqual(['__proto__-2']);
  });
});
