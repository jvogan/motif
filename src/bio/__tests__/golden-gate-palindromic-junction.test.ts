import { describe, expect, it } from 'vitest';
import { buildSyntheticGoldenGateVector, goldenGateAssemble } from '../golden-gate';

describe('Golden Gate palindromic fusion junctions', () => {
  it('does not report an assembly with a palindromic junction as unambiguously ready', () => {
    const a = buildSyntheticGoldenGateVector('AATT', 'GCTA', { name: 'A', filler: 'AACCGGTTCA' });
    const b = buildSyntheticGoldenGateVector('GCTA', 'AATT', { name: 'B', filler: 'TTCCAAGGCA' });

    const result = goldenGateAssemble([a, b]);

    expect(result.status).toBe('ambiguous');
    expect(result.success).toBe(false);
    expect(result.sequence).toBe('');
    expect(result.warnings).toContain('Overhang AATT is palindromic — risk of self-ligation');
    expect(result.errors.join('\n')).toMatch(/AATT is palindromic.*either orientation/u);
    expect(result.parts).toEqual(['A', 'B']);
  });

  it('keeps a non-palindromic two-part circle ready', () => {
    const a = buildSyntheticGoldenGateVector('AATG', 'GCTA', { name: 'A', filler: 'AACCGGTTCA' });
    const b = buildSyntheticGoldenGateVector('GCTA', 'AATG', { name: 'B', filler: 'TTCCAAGGCA' });

    const result = goldenGateAssemble([a, b]);

    expect(result.status).toBe('ready');
    expect(result.success).toBe(true);
    expect(result.sequence.length).toBeGreaterThan(0);
  });
});
