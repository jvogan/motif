/**
 * A linear cluster label is a summary: one enzyme name plus "+N" more. The count is the
 * only mark that says so, and it used to be the first thing sacrificed — when the pair
 * overran the width cap, the name was ellipsised and then returned ALONE, so a cluster
 * of fourteen enzymes rendered as a bare "Nt.BstNBI", indistinguishable from a lone cut
 * site. Truncation that hides itself states something false rather than something
 * incomplete.
 *
 * These tests pin both halves of the fix: the count always survives, and paying for it
 * never widens the label — because linear labels are placed by their ACTUAL width, so a
 * label that grows takes room from a neighbour and can push it off the map entirely.
 */
import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import { approxTextWidth } from '../geometry/labels';
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
 * Nt.BstNBI is the ONLY bundled enzyme whose name exceeds 8 characters, which is what
 * routes a label past the early return and into the width path where the count was
 * being dropped. Its cut sits outside the recognition window, so it is also Type IIS
 * and gets promoted to lead the label — the exact combination that shipped the defect.
 */
const LEAD = 'Nt.BstNBI';

function clusterOf(extraEnzymes: number, over = {}): MapInput {
  const sites: RestrictionSite[] = [site(LEAD, 1000, 1012, 'GAGTC')];
  for (let i = 0; i < extraEnzymes; i += 1) {
    sites.push(site(`Enz${i}`, 1004 + i * 3, 1006 + i * 3, 'GAATTC'));
  }
  return {
    mode: 'linear',
    name: 'linear count fixture',
    length: 6000,
    topology: 'linear',
    sequenceType: 'dna',
    features: [],
    restrictionSites: sites,
    width: 1000,
    height: 420,
    ...over,
  };
}

function leadCluster(renders: readonly MapRestrictionRender[], siteCount: number): MapRestrictionRender {
  const found = renders.find((r) => r.tickIds.length === siteCount);
  expect(found, 'fixture must collapse into a single cluster').toBeDefined();
  return found!;
}

describe('a linear cluster label never drops the count that says it is a summary', () => {
  it('keeps "+N" on a long lead name instead of returning the name alone', () => {
    const cluster = leadCluster(computeMapLayout(clusterOf(13)).restrictions, 14);
    const text = cluster.label?.text ?? '';

    expect(text).toMatch(/ \+13$/);
    // ...and the count still reconciles against the tooltip, as on the circular ring.
    expect(cluster.title).toContain(' · 14 enzymes · 14 sites');
    // The name may be shortened; it may not be the whole label.
    expect(text.startsWith('Nt.B')).toBe(true);
    expect(text).not.toBe(LEAD);
  });

  it('pays for the count out of the name, not out of a neighbouring label', () => {
    // The width of the summary must not exceed the width of the bare name it replaces:
    // anything wider is taken from the row, and a crowded row drops its lowest-priority
    // label to make space. A 6.2px growth here cost a real "AclI" label at 1920x1080.
    for (const extra of [1, 4, 9, 13, 38]) {
      const cluster = leadCluster(computeMapLayout(clusterOf(extra)).restrictions, extra + 1);
      const text = cluster.label?.text ?? '';
      expect(text, `+${extra} lost its count`).toMatch(new RegExp(` \\+${extra}$`));
      expect(
        approxTextWidth(text),
        `+${extra} label is wider than the bare name it replaces`,
      ).toBeLessThanOrEqual(approxTextWidth(LEAD));
    }
  });

  it('leaves a short lead name exactly as it was', () => {
    // 153 of the 154 bundled enzymes take the early return; it already kept the count,
    // so this fix must not have touched it.
    const layout = computeMapLayout(
      clusterOf(4, {
        restrictionSites: [
          site('EcoRI', 1000, 1001, 'GAATTC'),
          site('SacI', 1004, 1009, 'GAGCTC'),
          site('KpnI', 1008, 1013, 'GGTACC'),
          site('BamHI', 1012, 1013, 'GGATCC'),
          site('HindIII', 1016, 1017, 'AAGCTT'),
        ],
      }),
    );
    const cluster = leadCluster(layout.restrictions, 5);

    expect(cluster.label?.text).toBe('EcoRI +4');
  });

  it('keeps the lone-site label unadorned — there is nothing to disclose', () => {
    const layout = computeMapLayout(
      clusterOf(0, { restrictionSites: [site(LEAD, 1000, 1012, 'GAGTC')] }),
    );
    const cluster = leadCluster(layout.restrictions, 1);

    expect(cluster.label?.text).toBe(LEAD);
  });

  it('shortens a long custom enzyme name rather than dropping its count', () => {
    // Custom enzymes are user-named, so a name far longer than any bundled one is the
    // reachable way deep into this path — not a four-digit cluster.
    const long = 'MyVeryLongEnzymeNameX';
    const sites: RestrictionSite[] = [site(long, 1000, 1012, 'GAGTC')];
    for (let i = 0; i < 40; i += 1) sites.push(site(`Enz${i}`, 1004 + i, 1006 + i, 'GAATTC'));
    const cluster = leadCluster(
      computeMapLayout(clusterOf(0, { restrictionSites: sites })).restrictions,
      41,
    );
    const text = cluster.label?.text ?? '';

    expect(text).toBe('MyVer… +40');
    expect(approxTextWidth(text)).toBeLessThanOrEqual(64); // LINEAR_REC_LABEL_MAX_WIDTH_PX
  });

  it('documents what the stem floor does when it finally binds', () => {
    // Not a wish — a record. The floor is reachable only at ~1000 distinct enzymes in a
    // single cluster (the bundled set has 154 in total), and past it the label trades
    // away the no-wider invariant, then the cap itself, to keep a legible stem. Pinned
    // so a future change to either constant shows its consequences here, not on a map.
    const build = (n: number) => {
      const sites: RestrictionSite[] = [site(LEAD, 1000, 1012, 'GAGTC')];
      for (let i = 0; i < n; i += 1) {
        sites.push(site(`E${i}`, 1000 + (i % 100), 1002 + (i % 100), 'GAATTC'));
      }
      return (
        leadCluster(computeMapLayout(clusterOf(0, { restrictionSites: sites })).restrictions, n + 1)
          .label?.text ?? ''
      );
    };
    const nameWidth = approxTextWidth(LEAD);

    // 3 digits: floor exactly met, and still no wider than the name it replaces.
    expect(build(999)).toBe('Nt.… +999');
    expect(approxTextWidth('Nt.… +999')).toBeLessThanOrEqual(nameWidth);

    // 4 digits: the floor wins over the width budget — wider than the name, inside the cap.
    expect(build(1200)).toBe('Nt.… +1200');
    expect(approxTextWidth('Nt.… +1200')).toBeGreaterThan(nameWidth);
    expect(approxTextWidth('Nt.… +1200')).toBeLessThanOrEqual(64);

    // 5 digits: overruns the cap by 4.2px. Nothing clips — placement uses actual widths.
    expect(approxTextWidth(build(12000))).toBeCloseTo(68.2, 1);
  });
});
