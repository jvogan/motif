import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../enzyme-data';
import { ENZYME_TAIL_PRESETS } from '../primer-design';
import { calculateRestrictionCleavageGeometry } from '../restriction-sites';

describe('primer enzyme-tail geometry', () => {
  it.each([
    ['BsaI-ATG (Golden Gate)', 'BsaI', 'AATG'],
    ['BsaI-stop (Golden Gate)', 'BsaI', 'GCTT'],
    ['BsmBI (Golden Gate)', 'BsmBI', 'AATG'],
    ['SapI (Golden Gate)', 'SapI', 'ATG'],
  ])('derives the declared insert overhang for %s', (presetName, enzymeName, expectedOverhang) => {
    const preset = ENZYME_TAIL_PRESETS.find(({ name }) => name === presetName);
    const enzyme = RESTRICTION_ENZYMES_FULL.find(({ name }) => name === enzymeName);
    expect(preset).toBeDefined();
    expect(enzyme).toBeDefined();
    if (!preset || !enzyme) throw new Error('Missing geometry fixture.');

    const recognitionStart = preset.tail.indexOf(enzyme.recognitionSequence);
    const geometry = calculateRestrictionCleavageGeometry(enzyme, 0);
    expect(geometry.valid).toBe(true);
    expect(geometry.overhangLength).toBe(expectedOverhang.length);
    expect(preset.tail.slice(
      recognitionStart + geometry.overhangStart,
      recognitionStart + geometry.overhangEnd,
    )).toBe(expectedOverhang);
  });

  it('describes the XhoI ligation overhang as TCGA', () => {
    expect(ENZYME_TAIL_PRESETS.find(({ name }) => name === 'XhoI')?.description).toMatch(/TCGA/);
  });
});
