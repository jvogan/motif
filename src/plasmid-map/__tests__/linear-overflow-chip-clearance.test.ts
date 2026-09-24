/**
 * The linear "N unnamed sites" chip keeps clear of the restriction labels.
 *
 * The chip is drawn at the right end of the lower label row. The rows keep a strip
 * clear for it only when more clusters exist than fit, but a map where every cluster
 * fits can still have unnamed sites: a "PstI +3" label names one of four. On a 600 bp
 * linear record at 1440x900 the chip was measured painting over "TaqI" and "PstI +3".
 */
import { describe, expect, it } from 'vitest';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { resolveEnzymeUnion } from '../../bio/restriction-presets';
import { approxTextWidth } from '../geometry/labels';
import { computeMapLayout } from '../layout';
import { restrictionDensitySourcesForMap, restrictionSitesForInteractiveMap } from '../restriction-display';
import type { MapInput, MapLayout } from '../types';

// The 600 bp QA construct the collision was found on.
const SEQUENCE = [
  'gcgtggatgtgctagaatttacgcccttcctaaccgtctacttcgtgagagcgcccctca',
  'cagacccatcgtggagcggcctagtgaggctgcttcaggtatgggactctatccacgttt',
  'gtcacggggcgtgagagccgccacagtggttcccatctgaagcaaaatggcactcatcgt',
  'cgctcgggggcataacccgggcccgcttgctcaccttaccatctgttcgtctgggatgag',
  'ctgtgtaaattccttggatttaaaacccacgctcggatcggcaggtcatttaagtcctgc',
  'gggggccaatccaattgttgttggatcgctcagaatccatcgtttcagaatctgcaaggg',
  'accaaactacgcaaagcatacccccaatagtattctctaaacgcccggagtttccagcct',
  'ccttccctgtttaggccatcaataatctatcacacgcgggttcgagccatgttcggataa',
  'ccaccgtgatagaccaactgtctatcccttcgagcgacctaagttgtatagtagctgatc',
  'tgtgatttcaaactcgacggccccctgcagtcgacctttagcctttatagttgcctggga',
].join('').toUpperCase();

function linearLayout(width: number): MapLayout {
  const sites = findRestrictionSites(SEQUENCE, resolveEnzymeUnion(['common', 'golden-gate-type-iis']), { topology: 'linear' });
  const input: MapInput = {
    mode: 'linear',
    name: 'QATEST',
    length: SEQUENCE.length,
    topology: 'linear',
    sequenceType: 'dna',
    features: [],
    restrictionSites: restrictionSitesForInteractiveMap(sites),
    restrictionDensitySources: restrictionDensitySourcesForMap(sites, SEQUENCE.length),
    width,
    height: 360,
    fillAvailableHeight: true,
    display: {
      labelDensity: 'high',
      labelFontMode: 'proportional',
      maxFeatureLabels: 18,
      maxRestrictionLabels: 24,
      showFeatureLabels: true,
      showRestrictionLabels: true,
    },
  };
  return computeMapLayout(input);
}

/** Labels whose monospace text box meets the chip's: its hit rect less 8px of side padding, one 15px line tall. */
function labelsUnderChip(layout: MapLayout): string[] {
  const chip = layout.overflows?.find((overflow) => overflow.id === 'linear-restriction-overflow');
  if (!chip) return [];
  const middle = chip.hit.y + chip.hit.height / 2;
  const chipBox = { x0: chip.hit.x + 8, x1: chip.hit.x + chip.hit.width - 8, y0: middle - 7.5, y1: middle + 7.5 };
  return layout.restrictions.flatMap((restriction) => {
    const label = restriction.label;
    if (!label) return [];
    const width = approxTextWidth(label.text, 13, 'monospace');
    const x0 = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - width : label.x - width / 2;
    const box = { x0, x1: x0 + width, y0: label.y - 7.5, y1: label.y + 7.5 };
    const overlaps = Math.min(box.x1, chipBox.x1) - Math.max(box.x0, chipBox.x0) > 0
      && Math.min(box.y1, chipBox.y1) - Math.max(box.y0, chipBox.y0) > 0;
    return overlaps ? [label.text] : [];
  });
}

describe('the linear unnamed-sites chip', () => {
  it('is drawn on this record and covers no restriction label at any pane width', () => {
    let widthsWithChip = 0;
    const covered: string[] = [];
    for (let width = 480; width <= 1400; width += 10) {
      const layout = linearLayout(width);
      if (layout.overflows?.some((overflow) => overflow.id === 'linear-restriction-overflow')) widthsWithChip += 1;
      const under = labelsUnderChip(layout);
      if (under.length > 0) covered.push(`${width}: ${under.join(', ')}`);
    }
    // The premise: the record has unnamed sites at every width, so the chip is drawn.
    expect(widthsWithChip).toBe(93);
    expect(covered).toEqual([]);
  });
});
