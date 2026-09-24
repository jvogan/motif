import { describe, expect, it } from 'vitest';
import { buildCustomTranslationTable, NCBI_TRANSLATION_TABLES } from '../codon-tables';
import { expandIupacCodon, isDefiniteInitiatorCodon } from '../translate';
import type { CodonTable } from '../types';

const BASES = ['A', 'C', 'G', 'T'];
const CONCRETE = BASES.flatMap((a) => BASES.flatMap((b) => BASES.map((c) => `${a}${b}${c}`)));

// The answer before the concrete-codon shortcut: expand, then require every
// expansion to be an initiator. Written out here so the shortcut is checked
// against the path it replaced rather than against itself.
function expansionAnswer(codon: string, table: CodonTable): boolean {
  const expansions = expandIupacCodon(codon);
  return expansions.length > 0 && expansions.every((concrete) => table.starts.includes(concrete));
}

const tables: CodonTable[] = [
  ...Object.values(NCBI_TRANSLATION_TABLES),
  buildCustomTranslationTable({
    id: 1001,
    name: 'Custom',
    baseId: 11,
    reassignments: { TGA: 'W', AGG: '*' },
    extraStarts: ['aag'],
    removedStarts: ['GTG'],
  }),
];

const ambiguity = 'RYSWKMBDHVN';
const codons = [
  ...CONCRETE,
  ...CONCRETE.map((codon) => codon.toLowerCase()),
  ...CONCRETE.map((codon) => codon.replaceAll('T', 'U')),
  ...CONCRETE.map((codon) => codon.replaceAll('T', 'U').toLowerCase()),
  // Each ambiguity symbol in each position of the initiators the tables use.
  ...[...ambiguity].flatMap((symbol) => [`${symbol}TG`, `A${symbol}G`, `AT${symbol}`, `${symbol}TA`, `G${symbol}G`]),
  ...[...ambiguity.toLowerCase()].map((symbol) => `at${symbol}`),
  'NNN', 'ATH', 'ATN', 'HTG', 'YTG', 'DTG', 'AUH', 'nug',
  // Not codons at all.
  '', 'AT', 'ATGA', 'XYZ', 'A-G', 'A G', 'toString', 'constructor',
];

describe('definite initiator codons', () => {
  it('keys every shipped table by the 64 uppercase ACGT codons the shortcut relies on', () => {
    for (const table of tables) {
      expect(Object.keys(table.codons).sort(), table.name).toEqual([...CONCRETE].sort());
    }
  });

  it('answers every codon in every table exactly as the full expansion does', () => {
    let starts = 0;
    let nonStarts = 0;
    for (const table of tables) {
      for (const codon of codons) {
        const expected = expansionAnswer(codon, table);
        if (expected) starts += 1;
        else nonStarts += 1;
        expect(isDefiniteInitiatorCodon(codon, table), `${table.name} ${JSON.stringify(codon)}`).toBe(expected);
      }
    }
    // Both answers occur, so the comparison above is not all one value.
    expect(starts).toBeGreaterThan(500);
    expect(nonStarts).toBeGreaterThan(5_000);
  });
});
