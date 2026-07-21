import { describe, it, expect } from 'vitest';
import { packLanes } from '../geometry/lanes';
import {
  toRestrictionTick,
  clusterRestrictionTicks,
  buildRestrictionClusters,
} from '../geometry/restrictions';
import type { RestrictionSite } from '../../bio/types';

const site = (
  enzyme: string,
  position: number,
  cutPosition: number,
  recognitionSequence: string,
  strand?: 1 | -1,
): RestrictionSite => ({
  enzyme,
  position,
  cutPosition,
  recognitionSequence,
  overhang: 'blunt',
  ...(strand ? { strand } : {}),
});

describe('lanes: packLanes', () => {
  it('puts non-overlapping features on the same lane', () => {
    const p = packLanes([
      { id: 'a', spans: [{ start: 0, end: 10 }] },
      { id: 'b', spans: [{ start: 20, end: 30 }] },
    ]);
    expect(p.laneCount).toBe(1);
    expect(p.laneById.get('a')).toBe(0);
    expect(p.laneById.get('b')).toBe(0);
  });

  it('pushes an overlapping feature to the next lane', () => {
    const p = packLanes([
      { id: 'a', spans: [{ start: 0, end: 20 }] },
      { id: 'b', spans: [{ start: 10, end: 30 }] },
    ]);
    expect(p.laneCount).toBe(2);
    expect(p.laneById.get('a')).toBe(0);
    expect(p.laneById.get('b')).toBe(1);
  });

  it('reuses lane 0 when a later feature clears the earlier one (A,C disjoint)', () => {
    // A[0,20] overlaps B[10,40]; C[25,45] overlaps B but not A -> C rejoins lane 0.
    const p = packLanes([
      { id: 'a', spans: [{ start: 0, end: 20 }] },
      { id: 'b', spans: [{ start: 10, end: 40 }] },
      { id: 'c', spans: [{ start: 25, end: 45 }] },
    ]);
    expect(p.laneById.get('a')).toBe(0);
    expect(p.laneById.get('b')).toBe(1);
    expect(p.laneById.get('c')).toBe(0);
    expect(p.laneCount).toBe(2);
  });

  it('treats a wrap feature (two spans) as occupying both regions', () => {
    // wrap feature occupies 90..100 and 0..10; a feature at 0..5 must conflict.
    const p = packLanes([
      { id: 'wrap', spans: [{ start: 90, end: 100 }, { start: 0, end: 10 }] },
      { id: 'head', spans: [{ start: 0, end: 5 }] },
    ]);
    // Longer parent/wrap spans win lane 0; the overlapping head lands on lane 1.
    expect(p.laneById.get('wrap')).toBe(0);
    expect(p.laneById.get('head')).toBe(1);
    expect(p.laneById.get('wrap')).not.toBe(p.laneById.get('head'));
  });

  it('skips items with no drawable spans', () => {
    const p = packLanes([
      { id: 'empty', spans: [] },
      { id: 'real', spans: [{ start: 0, end: 10 }] },
    ]);
    expect(p.laneById.has('empty')).toBe(false);
    expect(p.laneById.get('real')).toBe(0);
  });
});

describe('restrictions: toRestrictionTick', () => {
  it('classifies a cut inside the recognition window as NOT Type IIS', () => {
    const t = toRestrictionTick(site('EcoRI', 10, 11, 'GAATTC'));
    expect(t.isTypeIIS).toBe(false);
    expect(t.strand).toBe(1); // default forward when omitted
    expect(t.id).toBe('EcoRI@10');
  });
  it('classifies a downstream cut (Type IIS) correctly and keeps strand', () => {
    const t = toRestrictionTick(site('BsaI', 20, 27, 'GGTCTC', -1));
    expect(t.isTypeIIS).toBe(true); // 27 > 20+6
    expect(t.strand).toBe(-1);
  });
  it('classifies an upstream cut as Type IIS', () => {
    const t = toRestrictionTick(site('SapI', 30, 25, 'GCTCTTC'));
    expect(t.isTypeIIS).toBe(true); // 25 < 30
  });
  it('does not misclassify a circular origin-seam site as Type IIS (regression fix)', () => {
    // KpnI at pos 96 on a 100bp circle, cut bond stored modulo as 1 (raw 101, inside [96,102]).
    const t = toRestrictionTick(site('KpnI', 96, 1, 'GGTACC'), 100, true);
    expect(t.isTypeIIS).toBe(false);
  });
  it('still flags a genuine Type IIS downstream cut across the origin', () => {
    // delta = (5 - 96 + 100) % 100 = 9 > recogLen 6 -> Type IIS
    const t = toRestrictionTick(site('BsaI', 96, 5, 'GGTCTC'), 100, true);
    expect(t.isTypeIIS).toBe(true);
  });
});

describe('restrictions: clustering', () => {
  it('groups nearby ticks and separates distant ones', () => {
    const ticks = [
      toRestrictionTick(site('AfeI', 10, 13, 'AGCGCT')),
      toRestrictionTick(site('XbaI', 12, 13, 'TCTAGA')),
      toRestrictionTick(site('EcoRI', 100, 101, 'GAATTC')),
    ];
    const clusters = clusterRestrictionTicks(ticks, 1000, {
      minSepBp: 5,
      maxNamesPerCluster: 4,
      circular: false,
    });
    expect(clusters).toHaveLength(2);
    expect(clusters[0].enzymes).toEqual(['AfeI', 'XbaI']);
    expect(clusters[1].enzymes).toEqual(['EcoRI']);
  });

  it('dedupes an enzyme cutting multiple times in one cluster (name + overflow are distinct)', () => {
    const ticks = [
      toRestrictionTick(site('BsmBI', 50, 57, 'CGTCTC')), // cut 57 > window end 56 -> Type IIS
      toRestrictionTick(site('BsmBI', 51, 58, 'CGTCTC')), // SAME enzyme, a second cut in-cluster
      toRestrictionTick(site('BbsI', 52, 60, 'GAAGAC')), // downstream cut -> Type IIS
      toRestrictionTick(site('AfeI', 53, 56, 'AGCGCT')), // blunt cut inside -> not Type IIS
    ];
    const [cluster] = clusterRestrictionTicks(ticks, 1000, {
      minSepBp: 10,
      maxNamesPerCluster: 2,
      circular: false,
    });
    // The two BsmBI cuts collapse to ONE display name (was the "BsmBI,BsmBI" bug);
    // ticks[] still holds all four real cut sites so density + "+N more sites" stay put.
    expect(cluster.ticks).toHaveLength(4);
    expect(cluster.enzymes).toEqual(['BsmBI', 'BbsI', 'AfeI']); // 3 distinct, display order
    expect(cluster.shownEnzymes).toEqual(['BsmBI', 'BbsI']); // Type IIS first, distinct, capped at 2
    expect(cluster.overflow).toBe(1); // one DISTINCT enzyme (AfeI) unshown, NOT the extra BsmBI tick
    expect(cluster.hasTypeIIS).toBe(true); // BsmBI/BbsI cut downstream
  });

  it('orders the WHOLE enzyme list the way the label reads it, Type IIS first', () => {
    // The full list used to stay in position order while only the shown slice was
    // promoted, so a label reading "BbsI +3" sat over a tooltip opening "PstI, AluI".
    // On live pUC19 with every source on that hit 9 of 20 circular clusters and 6 of
    // 17 linear ones, with the clicked name as deep as 14th of 39. The list is ordered
    // once now and `shownEnzymes` is a slice of it, so "the label's names are the
    // tooltip's first names" holds by construction instead of by two functions
    // happening to agree.
    const ticks = [
      toRestrictionTick(site('PstI', 50, 51, 'CTGCAG')),
      toRestrictionTick(site('AluI', 51, 52, 'AGCT')),
      toRestrictionTick(site('BbsI', 52, 60, 'GAAGAC')), // downstream cut -> Type IIS
      toRestrictionTick(site('HaeIII', 53, 54, 'GGCC')),
    ];
    const [cluster] = clusterRestrictionTicks(ticks, 1000, {
      minSepBp: 10,
      maxNamesPerCluster: 2,
      circular: false,
    });

    expect(cluster.enzymes).toEqual(['BbsI', 'PstI', 'AluI', 'HaeIII']);
    expect(cluster.hasTypeIIS).toBe(true);
    expect(cluster.shownEnzymes).toEqual(['BbsI', 'PstI']);
    expect(cluster.overflow).toBe(2);
    // The property the label depends on, stated rather than implied.
    expect(cluster.enzymes.slice(0, cluster.shownEnzymes.length)).toEqual(cluster.shownEnzymes);
  });

  it('merges the circular origin seam', () => {
    const ticks = [
      toRestrictionTick(site('PstI', 2, 5, 'CTGCAG')),
      toRestrictionTick(site('SphI', 98, 99, 'GCATGC')),
    ];
    const clusters = clusterRestrictionTicks(ticks, 100, {
      minSepBp: 5,
      maxNamesPerCluster: 4,
      circular: true,
    });
    // wrapGap = 100 - 98 + 2 = 4 <= 5 -> one merged cluster
    expect(clusters).toHaveLength(1);
    expect([...clusters[0].enzymes].sort()).toEqual(['PstI', 'SphI']);
  });

  it('buildRestrictionClusters wires sites through in one call', () => {
    const { ticks, clusters } = buildRestrictionClusters(
      [site('EcoRI', 10, 11, 'GAATTC'), site('EcoRI', 500, 501, 'GAATTC')],
      1000,
      { minSepBp: 5, maxNamesPerCluster: 4, circular: true },
    );
    expect(ticks).toHaveLength(2);
    expect(clusters).toHaveLength(2);
  });
});
