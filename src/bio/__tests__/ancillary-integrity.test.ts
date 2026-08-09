import { describe, expect, it } from 'vitest';
import {
  MAX_GEL_FRAGMENTS_PER_LANE,
  MAX_GEL_LABEL_LENGTH,
  MAX_GEL_SAMPLE_LANES,
  simulateGel,
} from '../gel-simulation';
import { molecularWeight } from '../gc-content';
import {
  makeSequenceHighlight,
  shiftSequenceHighlightsForRange,
  shiftSequenceHighlightsForInsertion,
} from '../sequence-highlights';
import {
  makeSequenceStyleRange,
  shiftSequenceFormattingForInsertion,
  shiftSequenceFormattingForRange,
} from '../sequence-formatting';
import { normalizeSequenceVariant, shiftSequenceVariants } from '../sequence-variants';

describe('ancillary bio helper integrity', () => {
  it('does not charge formatting whitespace as an unknown DNA residue', () => {
    expect(molecularWeight('A C\n')).toBe(molecularWeight('AC'));
  });

  it('bounds core gel labels and cardinality before rendering', () => {
    const result = simulateGel([{
      name: 'X'.repeat(MAX_GEL_LABEL_LENGTH),
      fragments: [1000],
    }], { width: 2, height: 1 });
    expect(result.ascii.length).toBeLessThan(100);
    expect(() => simulateGel([{
      name: 'X'.repeat(MAX_GEL_LABEL_LENGTH + 1),
      fragments: [1000],
    }])).toThrow(/name cannot exceed/i);
    expect(() => simulateGel(Array.from(
      { length: MAX_GEL_SAMPLE_LANES + 1 },
      (_value, index) => ({ name: `lane-${index}`, fragments: [1000] }),
    ))).toThrow(/lanes/i);
    expect(() => simulateGel([{
      name: 'sample',
      fragments: Array.from({ length: MAX_GEL_FRAGMENTS_PER_LANE + 1 }, () => 1000),
    }])).toThrow(/fragments cannot contain/i);
  });

  it('rejects fractional and negative variant coordinates instead of flooring them', () => {
    expect(normalizeSequenceVariant({ id: 'fractional', start: 1.5, end: 3, kind: 'substitution' })).toBeNull();
    expect(normalizeSequenceVariant({ id: 'negative', start: -1, end: 2, kind: 'deletion' })).toBeNull();
    expect(normalizeSequenceVariant({ id: 'valid', start: 1, end: 3, kind: 'substitution' })).toMatchObject({
      start: 1,
      end: 3,
    });
    expect(() => shiftSequenceVariants([], 1, 0.5)).toThrow(/delta.*safe integer/i);
  });

  it('keeps formatting and highlight coordinates integral across creation and edits', () => {
    expect(makeSequenceHighlight({ start: 1.5, end: 3.5 }, '#fff', 1)).toMatchObject({ start: 1, end: 3 });
    expect(makeSequenceStyleRange({ start: 1.5, end: 3.5 }, { bold: true })).toMatchObject({ start: 1, end: 3 });
    expect(() => shiftSequenceHighlightsForRange([], 1.5, 3)).toThrow(/safe integer/i);
    expect(() => shiftSequenceHighlightsForInsertion([], 1, 2.5)).toThrow(/delta.*safe integer/i);
    expect(() => shiftSequenceFormattingForRange(null, 1.5, 3)).toThrow(/safe integer/i);
    expect(() => shiftSequenceFormattingForInsertion(null, 1, 2.5)).toThrow(/delta.*safe integer/i);
  });
});
