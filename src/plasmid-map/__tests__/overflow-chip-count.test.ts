/**
 * What the restriction overflow chip counts.
 *
 * The chip is the only sentence on the map about what the ring is withholding, and
 * for a long time it counted the wrong thing: sites under a cluster with NO label,
 * summed. A cluster label names only its first few enzymes and folds the rest into a
 * "+N" tail, so a cluster labelled "AatII, AflIII, BsiHKAI +9" was counted as fully
 * accounted for while nine of its enzymes went unnamed. Measured on pET-28a(+) in a
 * 780x890 map pane, the chip said 63 where 98 of the 149 ticks had no name a reader
 * could read off the map; on pUC19 at the same pane it said nothing at all while 38
 * of 77 were anonymous.
 *
 * Both tests below recount from the DRAWN label strings rather than from any
 * expression the chip shares, so they disagree whenever the chip and the ring stop
 * matching.
 */
import { describe, expect, it } from 'vitest';
import vectors from '../../../public/data/vectors.json';
import { computeMapLayout } from '../layout';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { resolveEnzymeUnion } from '../../bio/restriction-presets';
import { restrictionDensitySourcesForMap, restrictionSitesForInteractiveMap } from '../restriction-display';
import { approxTextWidth, CIRCULAR_LABEL_BOX_HEIGHT_PX } from '../geometry/labels';
import type { Feature, RestrictionSite } from '../../bio/types';
import type { MapInput, MapLayout } from '../types';

/** Sites whose enzyme no visible label states, read off the drawn text. */
function unnamedSitesFromDrawnLabels(layout: MapLayout): number {
  return layout.restrictions.reduce((count, restriction) => {
    // A tick id is `<enzyme>@<position>`, and no bundled enzyme name contains "@".
    const enzymes = restriction.tickIds.map((id) => id.slice(0, id.lastIndexOf('@')));
    if (!restriction.label) return count + enzymes.length;
    const shown = restriction.label.text.replace(/ \+\d+$/, '').split(', ').map((name) => name.trim());
    // An ellipsised name ("Hind…") counts as naming its enzyme: the label has
    // committed to it, and the chip credits it too.
    const exact = new Set(shown.filter((name) => !name.includes('…')));
    const stems = shown.filter((name) => name.includes('…')).map((name) => name.replace(/…$/, ''));
    return count + enzymes.filter(
      (enzyme) => !exact.has(enzyme) && !stems.some((stem) => enzyme.startsWith(stem)),
    ).length;
  }, 0);
}

/**
 * The chip prints one of two sentences — the full "N unnamed sites", or "N unnamed"
 * where the full one would paint over a neighbouring name. The count is in both,
 * because the count is the message; only the noun is ever spent.
 */
function chipCount(layout: MapLayout): number {
  const chip = layout.overflows?.find((overflow) => overflow.kind === 'restriction-labels');
  if (!chip) return 0;
  expect(chip.text, 'chip sentence').toMatch(
    new RegExp(`^${chip.unlabelled} unnamed( ${chip.unlabelled === 1 ? 'site' : 'sites'})?$`),
  );
  return chip.unlabelled;
}

function site(enzyme: string, position: number, recognitionSequence: string): RestrictionSite {
  return { enzyme, position, cutPosition: position + 1, recognitionSequence, overhang: 'blunt' };
}

/**
 * One tight 12-enzyme cluster on an otherwise quiet ring, plus two lone sites far from
 * it. The crowd is what makes this a real test: its label names at most 3 of the 12 and
 * prints "+9", so a chip that treats a labelled cluster as covered reports 0 for the
 * nine names it cannot see, while every site in the cluster still gets a tick.
 */
const CROWD = [
  'AatII', 'AflIII', 'BsiHKAI', 'Eco53kI', 'HincII', 'AhdI',
  'BstZ17I', 'DrdI', 'PshAI', 'XcmI', 'BciVI', 'BmgBI',
];
const crowdedInput = (width: number, height: number): MapInput => ({
  mode: 'circular',
  name: 'one crowded cluster',
  length: 6000,
  topology: 'circular',
  sequenceType: 'dna',
  features: [],
  restrictionSites: [
    ...CROWD.map((enzyme, i) => site(enzyme, 1000 + i * 4, 'GACGTC')),
    site('EcoRI', 3000, 'GAATTC'),
    site('BamHI', 4500, 'GGATCC'),
  ],
  width,
  height,
});

describe('the overflow chip counts sites the map does not name', () => {
  it('counts a site its cluster label leaves inside a "+N" tail', () => {
    const layout = computeMapLayout(crowdedInput(600, 600));
    const crowd = layout.restrictions.find((restriction) => restriction.tickIds.length === CROWD.length);

    // The premise: one label, 12 sites under it, and a "+N" tail on the text. Without
    // this the assertion below could pass on a map that simply drew no crowd.
    expect(crowd, 'the 12-site cluster').toBeDefined();
    expect(crowd!.label?.text, 'crowd label').toMatch(/ \+\d+$/);
    const named = crowd!.label!.text.replace(/ \+\d+$/, '').split(', ').length;
    expect(named).toBeLessThan(CROWD.length);

    // 9, not 0: three names are on the label and nine are behind its "+9".
    expect(chipCount(layout)).toBe(CROWD.length - named);
    expect(chipCount(layout)).toBe(unnamedSitesFromDrawnLabels(layout));
  });

  it('counts the same way on the linear axis, where a label names exactly one enzyme', () => {
    // compactLinearClusterText states ONE name and folds the rest into its "+N", so a
    // labelled linear cluster leaves every other site under it unnamed. The circular
    // and linear chips print the same sentence and must count the same quantity.
    const layout = computeMapLayout({
      ...crowdedInput(900, 420),
      mode: 'linear',
      topology: 'linear',
    });
    const crowd = layout.restrictions.find((restriction) => restriction.tickIds.length === CROWD.length);

    expect(crowd, 'the 12-site cluster').toBeDefined();
    expect(crowd!.label?.text, 'crowd label').toMatch(/ \+\d+$/);
    expect(crowd!.label!.text.replace(/ \+\d+$/, '').split(', ')).toHaveLength(1);

    // 11, not 0: one name is drawn and eleven are behind its "+11".
    expect(chipCount(layout)).toBe(CROWD.length - 1);
    expect(chipCount(layout)).toBe(unnamedSitesFromDrawnLabels(layout));
  });

  it('drops to zero only when every drawn label names every site under it', () => {
    // The two lone sites alone: each cluster is one site and its label is that site's
    // whole name, so there is nothing left for the chip to report and it is absent.
    const layout = computeMapLayout({
      ...crowdedInput(600, 600),
      restrictionSites: [site('EcoRI', 3000, 'GAATTC'), site('BamHI', 4500, 'GGATCC')],
    });

    expect(layout.restrictions.every((restriction) => restriction.label)).toBe(true);
    expect(unnamedSitesFromDrawnLabels(layout)).toBe(0);
    expect(layout.overflows?.some((overflow) => overflow.kind === 'restriction-labels') ?? false).toBe(false);
  });
});

function compactMapName(name: string): string {
  const compact = name
    .replace(/\bforward\b/gi, 'fwd')
    .replace(/\breverse\b/gi, 'rev')
    .replace(/\bpromoter\b/gi, 'prom.')
    .replace(/\bprimer\b/gi, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > 14 ? `${compact.slice(0, 13).trimEnd()}…` : compact;
}

function artifactLayout(recordName: string, width: number, height: number): MapLayout {
  const record = (vectors as unknown as Array<{ name: string; sequence: string; features: Feature[] }>)
    .find((candidate) => candidate.name === recordName)!;
  const sites = findRestrictionSites(
    record.sequence,
    resolveEnzymeUnion(['common', 'golden-gate-type-iis']),
    { topology: 'circular' },
  );
  return computeMapLayout({
    mode: 'circular',
    name: record.name,
    length: record.sequence.length,
    topology: 'circular',
    sequenceType: 'dna',
    features: record.features.map((feature) => ({
      ...feature,
      name: compactMapName(feature.name),
      metadata: feature.metadata ?? {},
    })) as Feature[],
    restrictionSites: restrictionSitesForInteractiveMap(sites),
    restrictionDensitySources: restrictionDensitySourcesForMap(sites, record.sequence.length),
    width,
    height,
    fillAvailableHeight: true,
    display: {
      labelDensity: 'high',
      labelFontMode: 'proportional',
      circularOutsideGutterScale: 0.28,
      maxFeatureLabels: 18,
      maxRestrictionLabels: 24,
      showFeatureLabels: true,
      showRestrictionLabels: true,
    },
  });
}

/**
 * How far the chip can jump UP as the pane grows.
 *
 * The old count moved in a way no reader could reason about: on a 1298px-wide pane
 * swept from 260 to 560px tall in 5px steps it ran 5, 10, 5, … 1, … 19, 7, 11, 8, 5,
 * 8 — a single 5px step took pUC19 from 1 to 19 and pET-28a(+) from 61 to 81, on maps
 * that were getting BIGGER. The cause is the same one the count itself had: the packer
 * trades many narrow labels for fewer wide ones, so "clusters without a label" swings
 * while the number of sites a reader can name barely moves. Recounting settles most of
 * it — the largest upward step falls from 18 to 4 on pUC19 and from 20 to 1 on
 * pET-28a(+), and the total up-and-down travel from 77 to 34 and 38.
 *
 * What is left is real: at 1298x500 the packer drops the "AluI, PstI" label a 1298x490
 * map keeps, and those are exactly the 4 sites the count rises by. The chip reports
 * that honestly; removing it is the label packer's problem, not the counter's.
 *
 * pET-28a(+)'s bounds moved from 2 and 45 to 3 and 48 when the re-pack pass gained its
 * second, wider angular attempt. Same cause as the pUC19 step above: at 1298x290 the
 * packer now drops the "HpaII +2" label a 1298x285 map keeps, and those are the 3 sites
 * the count rises by. Rescuing more labels makes each one carry more sites, so the chip
 * moves in bigger steps. It buys 83 labels and 153 named sites over the census in
 * circular-label-monotonicity.test.ts. Both bounds are pinned to the measured values,
 * so any further widening has to be re-measured rather than absorbed.
 */
describe('the chip moves with the map rather than with the packer', () => {
  it.each([
    { record: 'pUC19', maxRise: 4, maxTravel: 40 },
    { record: 'pET-28a(+)', maxRise: 3, maxTravel: 48 },
  ])('bounds how far $record\'s chip can jump up as the pane grows', ({ record, maxRise, maxTravel }) => {
    const counts: number[] = [];
    for (let height = 260; height <= 560; height += 5) {
      const layout = artifactLayout(record, 1298, height);
      expect(chipCount(layout), `${record} at 1298x${height}`).toBe(unnamedSitesFromDrawnLabels(layout));
      counts.push(chipCount(layout));
    }

    let rise = 0;
    let travel = 0;
    for (let i = 1; i < counts.length; i += 1) {
      rise = Math.max(rise, counts[i] - counts[i - 1]);
      travel += Math.abs(counts[i] - counts[i - 1]);
    }
    // Absolute, not relative to the old numbers: the point is the reader's experience,
    // and 18 or 20 is what "unreasonable" looked like here.
    expect(rise, `${record} largest upward step`).toBeLessThanOrEqual(maxRise);
    expect(travel, `${record} total travel`).toBeLessThanOrEqual(maxTravel);
    expect(counts[counts.length - 1], `${record} ends below where it started`)
      .toBeLessThan(counts[0]);
  });
});

type Box = { minX: number; maxX: number; minY: number; maxY: number };

/** A placed label's box, built the way the circular packer builds its obstacles. */
function labelBox(label: NonNullable<MapLayout['features'][number]['label']>, monospace: boolean): Box {
  const width = approxTextWidth(label.text, undefined, monospace ? 'monospace' : 'proportional');
  const x0 = label.anchor === 'start' ? 0 : label.anchor === 'end' ? -width : -width / 2;
  const x1 = label.anchor === 'start' ? width : label.anchor === 'end' ? 0 : width / 2;
  const h = CIRCULAR_LABEL_BOX_HEIGHT_PX;
  const [y0, y1] = label.baseline === 'middle' ? [-h / 2, h / 2]
    : label.baseline === 'hanging' ? [0, h]
      : label.baseline === 'auto' ? [-h, 0]
        : [-h * 0.8, h * 0.3];
  const radians = ((label.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [dx, dy] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const) {
    xs.push(label.x + dx * cos - dy * sin);
    ys.push(label.y + dx * sin + dy * cos);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * The chip is drawn blind — placed after every label, dodged by nothing — so the only
 * thing that keeps its glyphs off a feature or enzyme name is how long its sentence is.
 * The honest count made the sentence longer, and at a 1032x260 map pane on pETDuet-1
 * the full form painted its last "s" under the AmpR arc while pcDNA3.1(+) at 1212x314
 * reached 1.3 units into NeoR/KanR. Both are gone; this is what keeps them gone.
 */
describe('the chip keeps its sentence clear of the names around it', () => {
  // The map pane inside each viewport, read off the artifact's own frame in Chromium.
  const PANES = [
    { viewport: '1100x650', width: 1032, height: 260 },
    { viewport: '1280x720', width: 1212, height: 314 },
    { viewport: '1366x768', width: 1298, height: 362 },
    { viewport: '1440x900', width: 1372, height: 383 },
    { viewport: '1680x1050', width: 780, height: 894 },
    { viewport: '1920x1080', width: 956, height: 924 },
  ];
  const RECORDS = ['pUC19', 'pET-28a(+)', 'pETDuet-1', 'pBR322', 'pcDNA3.1(+)'];

  it.each(PANES)('keeps every $viewport chip off a drawn name', ({ width, height }) => {
    for (const record of RECORDS) {
      const layout = artifactLayout(record, width, height);
      const chip = layout.overflows?.find((overflow) => overflow.kind === 'restriction-labels');
      if (!chip) continue;
      const hit = { minX: chip.hit.x, maxX: chip.hit.x + chip.hit.width, minY: chip.hit.y, maxY: chip.hit.y + chip.hit.height };
      const names = [
        ...layout.features.flatMap((feature) => (feature.label ? [{ text: feature.label.text, box: labelBox(feature.label, false) }] : [])),
        ...layout.restrictions.flatMap((r) => (r.label ? [{ text: r.label.text, box: labelBox(r.label, true) }] : [])),
      ];
      for (const name of names) {
        const overlapX = Math.min(hit.maxX, name.box.maxX) - Math.max(hit.minX, name.box.minX);
        const overlapY = Math.min(hit.maxY, name.box.maxY) - Math.max(hit.minY, name.box.minY);
        expect(
          overlapX > 0 && overlapY > 0,
          `${record} ${width}x${height}: "${chip.text}" reaches "${name.text}"`,
        ).toBe(false);
      }
    }
  });

  it('spends the noun rather than the count when the sentence will not fit', () => {
    const shortened: string[] = [];
    for (const { width, height } of PANES) {
      for (const record of RECORDS) {
        const layout = artifactLayout(record, width, height);
        const chip = layout.overflows?.find((overflow) => overflow.kind === 'restriction-labels');
        if (!chip) continue;
        // Whichever sentence it picked, the number is in it and it is the right one.
        expect(chipCount(layout)).toBe(unnamedSitesFromDrawnLabels(layout));
        expect(chip.title).toMatch(/^\d+ of \d+ cut sites? /);
        if (!/ sites?$/.test(chip.text)) shortened.push(`${record} ${width}x${height} "${chip.text}"`);
      }
    }

    // 4 of the 30, all at the two shortest panes. Without this the clearance test
    // above could pass on a chip that never had to shorten anything.
    expect(shortened.length, `shortened: ${shortened.join(', ')}`).toBe(4);
    expect(shortened.every((entry) => entry.includes('1032x260') || entry.includes('1298x362') || entry.includes('1212x314'))).toBe(true);
  });
});
