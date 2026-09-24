import { describe, expect, it } from 'vitest';
import { featureTypeDisplay } from '../feature-type-display';
import { featureTypeLabel, parseFeatures } from '../genbank-parser';

// Kept keys, retired regulatory keys and a current regulatory feature, as a
// file writes them.
const table = [
  '     protein_bind    5..21',
  '                     /note="lac operator"',
  '     misc_binding    25..36',
  '                     /note="aptamer"',
  '     -35_signal      40..45',
  '                     /note="sigma70 -35 box"',
  '     -10_signal      63..68',
  '                     /note="sigma70 -10 box"',
  '     TATA_signal     70..76',
  '                     /note="TATA"',
  '     misc_signal     80..90',
  '                     /note="signal of unknown kind"',
  '     regulatory      95..115',
  '                     /regulatory_class="riboswitch"',
  '                     /note="TPP riboswitch"',
  '     regulatory      120..140',
  '                     /regulatory_class="promoter"',
].join('\n');

describe('featureTypeDisplay', () => {
  it('names a regulatory feature\'s class and leaves the export label bare', () => {
    const features = parseFeatures(table);
    expect(features.map(featureTypeDisplay)).toEqual([
      'protein_bind',
      'misc_binding',
      'regulatory (minus_35_signal)',
      'regulatory (minus_10_signal)',
      'regulatory (TATA_box)',
      'regulatory (other)',
      'regulatory (riboswitch)',
      // A promoter class reads as Motif's promoter type, which already says it.
      'promoter',
    ]);
    // GFF3, CSV and the reports read featureTypeLabel; it does not move.
    expect(features.map(featureTypeLabel)).toEqual([
      'protein_bind', 'misc_binding', 'regulatory', 'regulatory', 'regulatory', 'regulatory', 'regulatory', 'promoter',
    ]);
  });

  it('shows a class only when the feature has exactly one', () => {
    const regulatory = (metadata: Record<string, unknown>) => featureTypeDisplay({ type: 'regulatory', metadata });
    const qualifiers = (...values: string[]) => ({
      motifQualifiers: values.map((value) => ({ key: 'regulatory_class', value })),
    });
    expect(regulatory(qualifiers('silencer'))).toBe('regulatory (silencer)');
    expect(regulatory(qualifiers(' silencer '))).toBe('regulatory (silencer)');
    expect(regulatory(qualifiers('silencer', 'enhancer_blocking_element'))).toBe('regulatory');
    expect(regulatory(qualifiers(''))).toBe('regulatory');
    expect(regulatory({})).toBe('regulatory');
    expect(regulatory({ regulatory_class: 'riboswitch' })).toBe('regulatory (riboswitch)');
    expect(regulatory({ regulatory_class: true })).toBe('regulatory');
    // Another type carrying the qualifier keeps its plain label.
    expect(featureTypeDisplay({ type: 'misc_feature', metadata: qualifiers('silencer') })).toBe('misc_feature');
  });

  it('does not name a kept class that reads back as another type', () => {
    // Imported as a promoter and an RBS, then retyped to regulatory: Basic
    // GenBank writes "other" for these, so the screen does not name the class.
    const [promoter, rbs] = parseFeatures([
      '     regulatory      1..10',
      '                     /regulatory_class="promoter"',
      '     regulatory      11..16',
      '                     /regulatory_class="ribosome_binding_site"',
    ].join('\n'));
    expect([promoter.type, rbs.type]).toEqual(['promoter', 'rbs']);
    expect(featureTypeDisplay({ ...promoter, type: 'regulatory' })).toBe('regulatory');
    expect(featureTypeDisplay({ ...rbs, type: 'regulatory' })).toBe('regulatory');
    expect(featureTypeDisplay({ type: 'regulatory', metadata: { regulatory_class: 'terminator' } })).toBe('regulatory');
  });
});
