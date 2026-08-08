import { describe, expect, it } from 'vitest';
import {
  buildSyntheticGoldenGateVector,
  findGoldenGateSites,
  GOLDEN_GATE_ENZYME_NAMES,
  getGoldenGatePartBoundary,
  scanGoldenGateSites,
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
    expect(vector.sequence).toMatch(/^[ACGT]+$/);
    const boundary = getGoldenGatePartBoundary(vector, enzyme);

    expect(boundary).toMatchObject({
      valid: true,
      leftOverhang: left,
      rightOverhang: right,
    });
    expect(boundary.provenance?.parts).toContainEqual(expect.objectContaining({
      name: vector.name,
      formattingNormalized: false,
    }));
  });

  it('normalizes formatting with provenance but rejects ambiguous bases', () => {
    const vector = buildSyntheticGoldenGateVector('ACGT', 'TGCA', {
      enzyme: 'BsaI',
      filler: 'ACTGACTGACTGACTGACTG',
    });
    const formatted = validateGoldenGateOverhangs([
      { name: 'formatted', sequence: ` \n${vector.sequence.toLowerCase()}\t` },
    ], 'BsaI');

    expect(formatted.normalizationDiagnostics).toContainEqual(expect.objectContaining({
      code: 'formatting_normalized',
      partName: 'formatted',
    }));
    expect(formatted.provenance?.parts).toContainEqual(expect.objectContaining({
      name: 'formatted',
      formattingNormalized: true,
      normalizedLength: vector.sequence.length,
    }));

    const ambiguous = getGoldenGatePartBoundary({
      name: 'ambiguous',
      sequence: `${vector.sequence.slice(0, 8)}N${vector.sequence.slice(9)}`,
    }, 'BsaI');
    expect(ambiguous.valid).toBe(false);
    expect(ambiguous.normalizationDiagnostics).toContainEqual(expect.objectContaining({
      code: 'ambiguous_base',
      partName: 'ambiguous',
    }));
    expect(ambiguous.errors.join(' ')).toMatch(/canonical/i);

    const rna = getGoldenGatePartBoundary({
      name: 'rna',
      sequence: `${vector.sequence.slice(0, 8)}U${vector.sequence.slice(9)}`,
    }, 'BsaI');
    expect(rna.valid).toBe(false);
    expect(rna.normalizationDiagnostics).toContainEqual(expect.objectContaining({
      code: 'invalid_character',
      characters: ['U'],
    }));
  });

  it('exposes strict direct-scan diagnostics instead of silently missing malformed input', () => {
    const formatted = scanGoldenGateSites('  ggtctc aaaaa  ', 'BsaI');
    expect(formatted.sequence).toBe('GGTCTCAAAAA');
    expect(formatted.sites).toHaveLength(1);
    expect(formatted.diagnostics).toContainEqual(expect.objectContaining({
      code: 'formatting_normalized',
    }));

    const ambiguous = scanGoldenGateSites('GGTCTCNAAAA', 'BsaI');
    expect(ambiguous.sites).toEqual([]);
    expect(ambiguous.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ambiguous_base',
    }));
    expect(findGoldenGateSites('GGTCTC?AAAA', 'BsaI')).toEqual([]);

    const unsupported = scanGoldenGateSites('GGTCTCAAAAA', 'not-an-enzyme');
    expect(unsupported.sites).toEqual([]);
    expect(unsupported.diagnostics).toContainEqual(expect.objectContaining({
      code: 'unsupported_enzyme',
    }));
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
