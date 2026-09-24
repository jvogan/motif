import { describe, expect, it } from 'vitest';
import { featureTypeMenuOptions } from '../motif-artifact';
import type { FeatureType } from '../../bio/types';

// Every FeatureType a GenBank import can produce.
const IMPORTED_TYPES: FeatureType[] = [
  'orf', 'gene', 'cds', 'promoter', 'terminator', 'rbs', 'origin', 'resistance', 'restriction_site', 'primer_bind',
  'misc_feature', 'mRNA', 'rRNA', 'tRNA', 'ncRNA', 'regulatory', 'repeat_region', 'sig_peptide', 'mat_peptide',
  'transit_peptide', 'intron', 'exon', 'polyA_signal', 'enhancer', 'custom',
];

describe('the Edit feature Type menu', () => {
  it('offers the thirteen new-feature types when nothing else is needed', () => {
    expect(featureTypeMenuOptions()).toHaveLength(13);
    expect(featureTypeMenuOptions(undefined, 'cds')).toEqual(featureTypeMenuOptions());
    expect(featureTypeMenuOptions()[0]).toBe('cds');
  });

  it.each(IMPORTED_TYPES)('includes an imported %s feature\'s own type', (type) => {
    expect(featureTypeMenuOptions(type, type)).toContain(type);
  });

  it('keeps the feature\'s type offered after another type is picked, before custom', () => {
    const options = featureTypeMenuOptions('ncRNA', 'gene');
    expect(options).toContain('ncRNA');
    expect(options.slice(-2)).toEqual(['ncRNA', 'custom']);
    expect(featureTypeMenuOptions('exon', 'mRNA').slice(-3)).toEqual(['exon', 'mRNA', 'custom']);
  });
});
