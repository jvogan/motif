import { describe, expect, it } from 'vitest';
import {
  BALANOPHORACEAE_PLASTID_CODE,
  BLEPHARISMA_MACRONUCLEAR_CODE,
  NCBI_TRANSLATION_TABLES,
  STANDARD_CODE,
  VALID_NCBI_TABLE_IDS,
  getTranslationTable,
  listTranslationTables,
} from '../codon-tables';

const NCBI_BASE_ORDER = ['T', 'C', 'A', 'G'];
const CANONICAL_DNA_CODONS = NCBI_BASE_ORDER.flatMap((first) =>
  NCBI_BASE_ORDER.flatMap((second) =>
    NCBI_BASE_ORDER.map((third) => `${first}${second}${third}`),
  ),
);

const SUPPORTED_NCBI_TABLE_IDS = [
  1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 26,
  29, 30, 32, 33,
];

function divergentCodons(table: typeof STANDARD_CODE): Record<string, string> {
  return Object.fromEntries(
    Object.entries(table.codons).filter(
      ([codon, aminoAcid]) => STANDARD_CODE.codons[codon] !== aminoAcid,
    ),
  );
}

describe('NCBI translation-table registry', () => {
  it('ships the complete representable table-id set in canonical order', () => {
    expect(VALID_NCBI_TABLE_IDS).toEqual(SUPPORTED_NCBI_TABLE_IDS);
    expect(Object.keys(NCBI_TRANSLATION_TABLES).map(Number)).toEqual(SUPPORTED_NCBI_TABLE_IDS);
    expect(listTranslationTables().map(({ id }) => id)).toEqual(SUPPORTED_NCBI_TABLE_IDS);
    expect(VALID_NCBI_TABLE_IDS.filter((id) => [27, 28, 31].includes(id))).toEqual([]);
  });

  it('matches the NCBI Table 1 alternative initiators', () => {
    expect(STANDARD_CODE.starts).toEqual(['TTG', 'CTG', 'ATG']);
    expect(STANDARD_CODE.codons).toMatchObject({ TTG: 'L', CTG: 'L', ATG: 'M' });
  });

  it('matches Blepharisma Macronuclear Table 15', () => {
    expect(getTranslationTable(15)).toBe(BLEPHARISMA_MACRONUCLEAR_CODE);
    expect(BLEPHARISMA_MACRONUCLEAR_CODE).toMatchObject({
      id: 15,
      name: 'Blepharisma Macronuclear',
      starts: ['ATG'],
      stops: ['TAA', 'TGA'],
    });
    expect(divergentCodons(BLEPHARISMA_MACRONUCLEAR_CODE)).toEqual({ TAG: 'Q' });
  });

  it('matches Balanophoraceae Plastid Table 32', () => {
    expect(getTranslationTable(32)).toBe(BALANOPHORACEAE_PLASTID_CODE);
    expect(BALANOPHORACEAE_PLASTID_CODE).toMatchObject({
      id: 32,
      name: 'Balanophoraceae Plastid',
      starts: ['TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
      stops: ['TAA', 'TGA'],
    });
    expect(divergentCodons(BALANOPHORACEAE_PLASTID_CODE)).toEqual({ TAG: 'W' });
  });

  it.each(Object.entries(NCBI_TRANSLATION_TABLES))(
    'keeps table %s internally coherent',
    (registryId, table) => {
      const codons = Object.keys(table.codons);
      const encodedStops = Object.entries(table.codons)
        .filter(([, aminoAcid]) => aminoAcid === '*')
        .map(([codon]) => codon);

      expect(table.id).toBe(Number(registryId));
      expect(codons).toHaveLength(64);
      expect(new Set(codons)).toEqual(new Set(CANONICAL_DNA_CODONS));
      expect(new Set(table.starts).size).toBe(table.starts.length);
      expect(table.starts.every((codon) => CANONICAL_DNA_CODONS.includes(codon))).toBe(true);
      expect(new Set(table.stops)).toEqual(new Set(encodedStops));
    },
  );
});
