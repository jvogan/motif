import { describe, expect, it } from 'vitest';

import { computeMapLayout } from '../layout';
import type { Feature } from '../../bio/types';

function feature(index: number, length: number): Feature {
  const width = 120;
  const start = (index * 173) % (length - width);
  return {
    id: `feature-${index}`,
    name: `feature-${index}`,
    type: 'cds',
    start,
    end: start + width,
    strand: index % 3 === 0 ? -1 : 1,
    color: '#2f9e44',
    metadata: {},
  };
}

describe('map label density', () => {
  it('changes visible/hidden label budgets on dense circular maps', () => {
    const length = 6000;
    const features = Array.from({ length: 36 }, (_, index) => feature(index, length));
    const base = {
      mode: 'circular' as const,
      name: 'Density budget',
      length,
      topology: 'circular' as const,
      sequenceType: 'dna' as const,
      features,
      restrictionSites: [],
      width: 520,
      height: 520,
    };

    const low = computeMapLayout({ ...base, display: { labelDensity: 'low' } });
    const high = computeMapLayout({ ...base, display: { labelDensity: 'high' } });

    expect(high.budgets.visibleLabelCount).toBeGreaterThan(low.budgets.visibleLabelCount);
    expect(high.budgets.hiddenLabelCount).toBeLessThan(low.budgets.hiddenLabelCount);
  });
});
