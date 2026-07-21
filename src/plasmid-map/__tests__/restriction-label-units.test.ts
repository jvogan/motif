/**
 * A crowded restriction cluster shows the reader TWO numbers about itself: the "+N"
 * tail on the drawn label, and a count in the hover tooltip. They are in different
 * units — "+N" counts enzyme NAMES that did not fit, the tooltip counts SITES — and
 * the map used to print them side by side with nothing to say so ("Nt.BstNBI +38"
 * against "50 sites"). These tests pin the reconciliation: the tooltip must name the
 * enzyme count with its unit, that count must equal shown-names + N, and it must equal
 * the length of the very name list the same tooltip prints.
 */
import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import type { MapInput, MapRestrictionRender } from '../types';
import type { RestrictionSite } from '../../bio/types';

function site(
  enzyme: string,
  position: number,
  cutPosition: number,
  recognitionSequence: string,
): RestrictionSite {
  return { enzyme, position, cutPosition, recognitionSequence, overhang: 'blunt' };
}

/**
 * One tight cluster, 6 distinct enzymes across 8 cut sites — two enzymes cut twice, so
 * the enzyme count and the site count are DIFFERENT NUMBERS. That gap is the whole
 * point: with 6 enzymes at 6 sites either count would satisfy the assertions below and
 * the test would pass for the wrong reason. Every cut falls inside its own recognition
 * window so no enzyme is promoted to the label lead as Type IIS, and the lead name is
 * short enough that the linear axis keeps its "+N" tail instead of ellipsising it away.
 */
const CLUSTER_SITES: RestrictionSite[] = [
  site('AatII', 1000, 1004, 'GACGTC'),
  site('BspQI', 1004, 1010, 'GCTCTTC'),
  site('HincII', 1008, 1011, 'GTYRAC'),
  site('Eco53kI', 1012, 1015, 'GAGCTC'),
  site('BsiHKAI', 1016, 1021, 'GWGCWC'),
  site('AflIII', 1020, 1021, 'ACRYGT'),
  site('AatII', 1024, 1028, 'GACGTC'),
  site('HincII', 1028, 1031, 'GTYRAC'),
];
const DISTINCT_ENZYMES = 6;
const CLUSTER_CUT_SITES = 8;

function input(over: Partial<MapInput> = {}): MapInput {
  return {
    mode: 'circular',
    name: 'unit-mismatch fixture',
    length: 6000,
    topology: 'circular',
    sequenceType: 'dna',
    features: [],
    restrictionSites: CLUSTER_SITES,
    width: 700,
    height: 700,
    ...over,
  };
}

/** The one cluster that swallowed every fixture site. */
function crowdedCluster(renders: readonly MapRestrictionRender[]): MapRestrictionRender {
  const found = renders.find((r) => r.tickIds.length === CLUSTER_CUT_SITES);
  expect(found, 'fixture must collapse into a single cluster').toBeDefined();
  return found!;
}

describe('restriction cluster label and tooltip agree on what they are counting', () => {
  it('names the enzyme count so the label "+N" reconciles against it', () => {
    const cluster = crowdedCluster(computeMapLayout(input()).restrictions);

    expect(cluster.label?.text).toBeTruthy();
    const [, shown, tail] = /^(.+?) \+(\d+)$/.exec(cluster.label!.text) ?? [];
    expect(shown, `label should have been truncated: ${cluster.label!.text}`).toBeTruthy();

    const shownNames = shown.split(', ');
    const hidden = Number(tail);
    // The reader's arithmetic: names on screen + the "+N" tail.
    expect(shownNames.length + hidden).toBe(DISTINCT_ENZYMES);

    // ...and that is the number the tooltip must state, in enzymes, next to the sites.
    expect(cluster.title).toContain(` · ${DISTINCT_ENZYMES} enzymes · ${CLUSTER_CUT_SITES} sites`);

    // The fixture is only meaningful because the two counts differ.
    expect(DISTINCT_ENZYMES).not.toBe(CLUSTER_CUT_SITES);
  });

  it('makes the stated enzyme count equal the name list the same tooltip prints', () => {
    const cluster = crowdedCluster(computeMapLayout(input()).restrictions);
    const [names, stated] = (cluster.title ?? '').split(' · ');

    expect(names.split(', ')).toHaveLength(DISTINCT_ENZYMES);
    expect(stated).toBe(`${DISTINCT_ENZYMES} enzymes`);
  });

  it('keeps the same reconciliation on the linear axis, where only one name is shown', () => {
    const cluster = crowdedCluster(
      computeMapLayout(input({ mode: 'linear', topology: 'linear', width: 900, height: 420 })).restrictions,
    );

    const [, shown, tail] = /^(.+?) \+(\d+)$/.exec(cluster.label?.text ?? '') ?? [];
    expect(shown, `linear label should have been truncated: ${cluster.label?.text}`).toBeTruthy();
    expect(shown.split(', ').length + Number(tail)).toBe(DISTINCT_ENZYMES);
    expect(cluster.title).toContain(` · ${DISTINCT_ENZYMES} enzymes · ${CLUSTER_CUT_SITES} sites`);
  });

  it('leaves a cluster that enumerates its cuts alone — there is no bare count to confuse', () => {
    const layout = computeMapLayout(
      input({
        restrictionSites: [
          site('EcoRI', 400, 401, 'GAATTC'),
          site('SacI', 406, 411, 'GAGCTC'),
        ],
      }),
    );
    const pair = layout.restrictions.find((r) => r.tickIds.length === 2);

    expect(pair?.title).toBe('EcoRI, SacI · cut 402, 412');
    expect(pair?.title).not.toContain('enzymes');
  });

  it('says "1 enzyme" when one enzyme cuts a cluster repeatedly', () => {
    const layout = computeMapLayout(
      input({
        restrictionSites: [
          site('AluI', 400, 402, 'AGCT'),
          site('AluI', 408, 410, 'AGCT'),
          site('AluI', 416, 418, 'AGCT'),
          site('AluI', 424, 426, 'AGCT'),
        ],
      }),
    );
    const cluster = layout.restrictions.find((r) => r.tickIds.length === 4);

    expect(cluster?.title).toBe('AluI · 1 enzyme · 4 sites');
  });
});

/**
 * The other way a cluster can mislead: the drawn label leads with a Type IIS enzyme,
 * but the tooltip used to enumerate names in POSITION order. So "Nt.BstNBI +38" opened
 * a tooltip reading "HindIII, AluI, ..." and the name you clicked sat 14th of 39. On
 * live pUC19 with every source on that was 9 of 20 circular clusters, 6 of 17 linear.
 */
describe('a cluster tooltip opens on the name its own label leads with', () => {
  // BsmBI cuts downstream of its recognition window -> Type IIS -> promoted to the
  // label lead, and it is deliberately NOT first by position, so the two orders differ.
  const MIXED: RestrictionSite[] = [
    site('AluI', 1000, 1002, 'AGCT'),
    site('BsmBI', 1004, 1015, 'CGTCTC'),
    site('MseI', 1008, 1009, 'TTAA'),
  ];

  it('leads the tooltip with the same enzyme the label leads with', () => {
    const cluster = computeMapLayout(input({ restrictionSites: MIXED }))
      .restrictions.find((r) => r.tickIds.length === 3);

    expect(cluster?.label?.text).toMatch(/^BsmBI/);
    expect(cluster?.title).toMatch(/^BsmBI/);
    // Position order — what the tooltip printed before.
    expect(cluster?.title).not.toMatch(/^AluI/);
  });

  it('keeps every shown name a prefix of the tooltip list', () => {
    // What "reading the tooltip top to bottom finds the name you clicked" reduces to.
    const cluster = computeMapLayout(input({ restrictionSites: CLUSTER_SITES }))
      .restrictions.find((r) => r.tickIds.length === CLUSTER_CUT_SITES);
    const shown = (cluster?.label?.text ?? '').split(' +')[0].split(', ');
    const listed = (cluster?.title ?? '').split(' · ', 1)[0].split(', ');

    expect(shown.length).toBeGreaterThan(0);
    expect(listed.slice(0, shown.length)).toEqual(shown);
  });

  it('moves the cut list with the names, so the pairing still tells the truth', () => {
    // The short form prints two same-length lists and a reader pairs them off. Ordering
    // the names for display while leaving the cuts in position order would keep every
    // number correct on its own and make the tooltip as a whole state something false.
    // AluI cuts at bond 1002 (printed 1003), BsmBI at 1015 (printed 1016).
    const cluster = computeMapLayout(input({
      restrictionSites: [site('AluI', 1000, 1002, 'AGCT'), site('BsmBI', 1004, 1015, 'CGTCTC')],
    })).restrictions.find((r) => r.tickIds.length === 2);

    expect(cluster?.title).toBe('BsmBI, AluI · cut 1016, 1003');
  });

  it("groups a twice-cutting enzyme's cuts under its own name", () => {
    // Strictly better than the position-ordered list, which interleaved them.
    // AluI cuts at 1002 and 1020 (printed 1003, 1021); BsmBI at 1015 (printed 1016).
    const cluster = computeMapLayout(input({
      restrictionSites: [
        site('AluI', 1000, 1002, 'AGCT'),
        site('BsmBI', 1004, 1015, 'CGTCTC'),
        site('AluI', 1018, 1020, 'AGCT'),
      ],
    })).restrictions.find((r) => r.tickIds.length === 3);

    expect(cluster?.title).toBe('BsmBI, AluI · cut 1016, 1003, 1021');
  });

  it('leaves the name segment free of the separator the renderer splits on', () => {
    // SequenceMapView builds the accessible name with title.split(' · ', 1)[0]. A
    // reorder that put a ' · ' inside the list would truncate every accessible name.
    for (const restriction of computeMapLayout(input()).restrictions) {
      const [names, ...rest] = (restriction.title ?? '').split(' · ');
      expect(names).not.toContain(' · ');
      expect(rest.length).toBeGreaterThan(0);
    }
  });
});
