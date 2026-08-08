import { describe, expect, it } from 'vitest';
import {
  buildSyntheticGoldenGateVector,
  GOLDEN_GATE_ENZYME_NAMES,
  getGoldenGatePartBoundary,
  validateGoldenGateOverhangs,
} from '../golden-gate';

const THREE_BASE_ENZYMES = new Set(['SapI', 'BspQI']);

describe('Golden Gate hardening', () => {
  it.each(GOLDEN_GATE_ENZYME_NAMES)('round-trips synthetic vector overhangs for %s', (enzyme) => {
    const overhangLength = THREE_BASE_ENZYMES.has(enzyme) ? 3 : 4;
    const left = 'ACGT'.slice(0, overhangLength);
    const right = 'TGCA'.slice(0, overhangLength);
    const vector = buildSyntheticGoldenGateVector(left, right, {
      enzyme,
      filler: 'ACTGACTGACTGACTGACTG',
    });
    const boundary = getGoldenGatePartBoundary(vector, enzyme);

    expect(boundary).toMatchObject({
      valid: true,
      leftOverhang: left,
      rightOverhang: right,
    });
  });

  it('rejects an empty part set', () => {
    const validation = validateGoldenGateOverhangs([], 'BsaI');

    expect(validation.valid).toBe(false);
    expect(validation.overhangs).toEqual([]);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'preparation',
        description: 'Golden Gate validation requires at least one part',
      }),
    ]));
  });

  it('retains digest errors and rejects a zero-analyzable part set', () => {
    const validation = validateGoldenGateOverhangs([
      { name: 'malformed', sequence: 'ACGT' },
    ], 'BsaI');

    expect(validation.valid).toBe(false);
    expect(validation.overhangs).toEqual([]);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'preparation',
        description: expect.stringContaining('Part "malformed": missing flanking BsaI sites'),
      }),
      expect.objectContaining({
        type: 'preparation',
        description: 'No analyzable Golden Gate parts were found',
      }),
    ]));
  });

  it('rejects a mixed valid and malformed part set while preserving the malformed error', () => {
    const valid = buildSyntheticGoldenGateVector('ACGT', 'TGCA', {
      enzyme: 'BsaI',
      filler: 'ACTGACTGACTGACTGACTG',
    });
    const validation = validateGoldenGateOverhangs([
      valid,
      { name: 'malformed', sequence: 'ACGT' },
    ], 'BsaI');

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'preparation',
        description: expect.stringContaining('Part "malformed": missing flanking BsaI sites'),
      }),
    ]));
  });
});
