import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import { restrictionDigestDetailed } from '../restriction-digest';
import { findRestrictionSites } from '../restriction-sites';
import { RESTRICTION_ORACLE_FIXTURES } from './restriction-oracle-fixtures';

describe('first-party restriction behavior oracles', () => {
  it('keeps independent provenance and license metadata on every fixture', () => {
    expect(RESTRICTION_ORACLE_FIXTURES.length).toBeGreaterThan(4);
    for (const fixture of RESTRICTION_ORACLE_FIXTURES) {
      expect(fixture.sourceUrl).toMatch(/^https:\/\/www\.neb\.com\//u);
      expect(fixture.sourceAccessed).toBe('2026-08-08');
      expect(fixture.sourceLicense).toMatch(/NEB Terms of Use/u);
      expect(fixture.sourceLicense).toMatch(/terms-of-use/u);
      expect(fixture.fixtureLicense).toBe('MIT');
      expect(fixture.assayConditions).toMatch(/1 µg/u);
      expect(fixture.assayConditions).toMatch(/hour/u);
      expect(fixture.assayConditions).toMatch(/°C/u);
      expect(fixture.assayConditions).toMatch(/50 µl/u);
      expect(fixture.assayConditions).toMatch(/1X/u);
      expect(fixture.caveats.length).toBeGreaterThan(20);
    }
  });

  it('matches the implementation against source-backed facts rather than its own catalog', () => {
    for (const fixture of RESTRICTION_ORACLE_FIXTURES) {
      const enzyme = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === fixture.name);
      expect(enzyme, fixture.name).toBeDefined();
      if (!enzyme) continue;
      expect(enzyme.recognitionSequence).toBe(fixture.recognitionSequence);
      expect(enzyme.cleavageMode ?? 'double-strand').toBe(fixture.cleavageMode);
      expect(enzyme.overhang).toBe(fixture.overhang);
      if (fixture.cutOffsets) expect([enzyme.cutOffset, enzyme.complementCutOffset]).toEqual(fixture.cutOffsets);
      if (fixture.methylationTarget) {
        expect(enzyme.methylationRequirement?.target).toBe(fixture.methylationTarget);
        expect(enzyme.methylationRequirement?.state).toBe(fixture.methylationState);
      }
      if (fixture.methylationBehavior) expect(enzyme.methylationBehavior).toBe(fixture.methylationBehavior);
    }
  });

  it('covers each requested geometry family with independent first-party fixtures', () => {
    const names = new Set(RESTRICTION_ORACLE_FIXTURES.map((fixture) => fixture.name));
    for (const name of ['BbsI', 'BsmBI', 'SapI', 'Nb.BbvCI', 'Nt.BbvCI', 'Nt.BstNBI', 'DpnII', 'MboI', 'HpaII', 'MspI', 'HhaI', 'SmaI', 'EcoRV', 'PstI']) {
      expect(names.has(name), name).toBe(true);
    }
    expect(RESTRICTION_ORACLE_FIXTURES.filter((fixture) => fixture.cleavageMode === 'nick_top')).not.toHaveLength(0);
    expect(RESTRICTION_ORACLE_FIXTURES.filter((fixture) => fixture.cleavageMode === 'nick_bottom')).not.toHaveLength(0);
    expect(RESTRICTION_ORACLE_FIXTURES.filter((fixture) => fixture.overhang === 'blunt')).not.toHaveLength(0);
    expect(RESTRICTION_ORACLE_FIXTURES.filter((fixture) => fixture.overhang === '5prime')).not.toHaveLength(0);
    expect(RESTRICTION_ORACLE_FIXTURES.filter((fixture) => fixture.overhang === '3prime')).not.toHaveLength(0);
    expect(RESTRICTION_ORACLE_FIXTURES.filter((fixture) => fixture.methylationTarget !== undefined)).not.toHaveLength(0);
    expect(RESTRICTION_ORACLE_FIXTURES.filter((fixture) => fixture.methylationBehavior === 'context_dependent')).toHaveLength(1);
  });

  it('independently verifies EcoRI, Type IIS, methylation, and nick continuity', () => {
    expect(findRestrictionSites('AAAA GAATTC AAAA'.replaceAll(' ', ''), [RESTRICTION_ENZYMES_FULL.find((e) => e.name === 'EcoRI')!])).toHaveLength(1);
    const typeIis = restrictionDigestDetailed('AAAAAAGGTCTCAAAAA', ['BsaI']);
    expect(typeIis.issues).toEqual([]);
    expect(typeIis.fragments.reduce((sum, fragment) => sum + fragment.length, 0)).toBe(17);
    const unknownDpn = restrictionDigestDetailed('AAAAGATCAAAA', ['DpnI']);
    const methylatedDpn = restrictionDigestDetailed('AAAAGATCAAAA', ['DpnI'], 'linear', undefined, undefined, {
      methylationAssumptions: { dam: 'methylated' },
    });
    expect(unknownDpn.issues).toContainEqual(expect.objectContaining({ code: 'methylation_unknown' }));
    expect(methylatedDpn.cutCount).toBe(1);
    const nick = restrictionDigestDetailed('AAAAACCTCAGCAAAAA', ['Nb.BbvCI']);
    expect(nick.cuts).toEqual([]);
    expect(nick.fragments).toHaveLength(1);
    expect(nick.fragments[0]?.sequence).toBe('AAAAACCTCAGCAAAAA');

    for (const [enzyme, sequence] of [
      ['BbsI', 'AAAAAAGAAGACCCCCCCAAAA'],
      ['BsmBI', 'AAAAAACGTCTCCCCCCAAAA'],
      ['SapI', 'AAAAAAGCTCTTCCCCCCAAAA'],
    ] as const) {
      const result = restrictionDigestDetailed(sequence, [enzyme]);
      expect(result.issues, enzyme).toEqual([]);
      expect(result.cutCount, enzyme).toBe(1);
    }
    const reverseNick = restrictionDigestDetailed('AAAAACCTCAGCAAAAA', ['Nt.BbvCI']);
    expect(reverseNick.issues).toEqual([]);
    expect(reverseNick.cuts).toEqual([]);
  });
});
