import { describe, expect, it } from 'vitest';
import { visibleCutterNames } from '../claude-science-visible-cutters';

describe('visible cutter names', () => {
  it('lists each enzyme once, in the order its first site appears along the map', () => {
    const sites = [
      { enzyme: 'BamHI', position: 50 },
      { enzyme: 'AatII', position: 100 },
      { enzyme: 'BamHI', position: 10 },
      { enzyme: 'XhoI', position: 50 },
      { enzyme: 'EcoRI', position: 50 },
    ];
    expect(visibleCutterNames(sites)).toEqual(['BamHI', 'EcoRI', 'XhoI', 'AatII']);
    expect(visibleCutterNames([])).toEqual([]);
  });
});
