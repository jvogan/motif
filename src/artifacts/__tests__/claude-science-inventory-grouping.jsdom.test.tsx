// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryList, normalizeRecord, parseImportedRecords } from '../motif-artifact';

type InventoryRecords = Parameters<typeof InventoryList>[0]['records'];

const genBank = (name: string, source: string | null) => [
  `LOCUS       ${name}                  12 bp    DNA     linear   VRL 26-JUL-2016`,
  `DEFINITION  ${name} test record.`,
  ...(source ? [`SOURCE      ${source}`, `  ORGANISM  ${source}`] : []),
  'ORIGIN',
  '        1 acgtacgtac gt',
  '//',
].join('\n');

function imported(text: string): InventoryRecords[number] {
  const [input] = parseImportedRecords(text, '', 'auto', 'linear');
  return normalizeRecord(input, 0)!;
}

function groupOf(name: string): string | undefined {
  const group = [...document.querySelectorAll('.motif-cs-inventory-group')]
    .find((section) => [...section.querySelectorAll('.motif-cs-inventory-record-row span[title]')].some((span) => span.textContent === name));
  return group?.querySelector('.motif-cs-inventory-group-head span[title]')?.textContent ?? undefined;
}

afterEach(() => cleanup());

describe('inventory grouping of imported records', () => {
  it('lists an imported GenBank record under Imported whether or not it has a SOURCE line', () => {
    // A bundled vector carries no importer stamp.
    const bundled = normalizeRecord({ id: 'bundled', name: 'bundled', molecule: 'dna', topology: 'circular', seq: 'ACGTACGTACGT' }, 0)!;
    const records: InventoryRecords = [
      bundled,
      imported(genBank('WITHSOURCE', 'Human betaherpesvirus 5 (HHV-5)')),
      imported(genBank('NOSOURCE', null)),
      imported('>fasta one\nACGTACGTACGT'),
    ];
    render(<InventoryList records={records} selectedRecordId="bundled" onSelect={() => undefined} />);
    expect(groupOf('WITHSOURCE')).toBe('Imported');
    expect(groupOf('NOSOURCE')).toBe('Imported');
    expect(groupOf('fasta one')).toBe('Imported');
    expect(groupOf('bundled')).toBe('Vectors / DNA');
  });
});
