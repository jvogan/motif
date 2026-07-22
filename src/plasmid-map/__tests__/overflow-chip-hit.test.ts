/**
 * The overflow chip's pointer target.
 *
 * The chip carries the only sentence on the map that says what its count means, and
 * SVG text is hit-tested as its whole run box — so before this the target WAS the
 * glyph run: 39x6 CSS px circular, 81x11 linear, measured on live pUC19 at 1180x900.
 * `MapOverflowRender.hit` is a real rect sized from the chip's own estimated text
 * extent.
 *
 * Two properties here are load-bearing rather than cosmetic, and both are cheap to
 * break by "just making the target bigger":
 *
 *   - stacked chips are placed ONE label line apart, so a rect taller than a line
 *     covers the chip below and answers with the wrong tooltip;
 *   - the overflow layer paints after the features, so a rect that reached down into
 *     the feature lane under the linear chip would silently eat feature clicks.
 *
 * Numbers below are absolute on purpose. Writing them as `PAD * 2 + run` would let
 * them travel with whatever constant a future edit changes, and pass either way.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeMapLayout } from '../layout';
import type { MapLayout, MapOverflowRender } from '../types';
import type { Feature, RestrictionSite } from '../../bio/types';

const here = dirname(fileURLToPath(import.meta.url));
const mapCss = readFileSync(resolve(here, '..', '..', 'components', 'plasmid-map', 'plasmid-map.css'), 'utf8');
const artifactSource = readFileSync(resolve(here, '..', '..', 'artifacts', 'motif-artifact.tsx'), 'utf8');

/**
 * The chips' ink boxes as MEASURED in Chromium, in em of the chip's own font size:
 * how far the run box reaches above and below the baseline. This is the ruler
 * `OVERFLOW_HIT_CENTER_EM` in layout.ts was read off, and the one input to the rect's
 * vertical placement that no code there can see — SVG text is boxed by its font's
 * ascent and descent, and that module may not touch the DOM.
 */
const MEASURED_INK_ABOVE_BASELINE_EM = 0.9;
const MEASURED_INK_BELOW_BASELINE_EM = 0.25;

const sites: RestrictionSite[] = Array.from({ length: 40 }, (_, i) => ({
  enzyme: `Enzyme${i}`,
  position: 50 + i * 100,
  cutPosition: 51 + i * 100,
  recognitionSequence: 'GAATTC',
  overhang: 'blunt',
}));

// `color` and `metadata` are required on Feature, and they are supplied rather than
// cast away: this fixture's whole job is to make the layout emit real feature
// geometry for the hit rect to keep clear of, so a feature that is not a real
// Feature would be testing the wrong thing.
const features: Feature[] = Array.from({ length: 30 }, (_, i) => ({
  id: `f${i}`,
  name: `Feature ${i}`,
  type: 'cds',
  start: i * 120,
  end: i * 120 + 90,
  strand: 1 as const,
  color: '#8a8a8a',
  metadata: {},
}));

/** Dense enough that BOTH circular chips are emitted and therefore stack. */
function circularLayout() {
  return computeMapLayout({
    mode: 'circular',
    name: 'chip fixture',
    length: 4000,
    topology: 'circular',
    sequenceType: 'dna',
    features,
    restrictionSites: sites,
    width: 720,
    height: 720,
    display: { maxRestrictionLabels: 6, maxFeatureLabels: 5 },
  });
}

function linearLayout() {
  return computeMapLayout({
    mode: 'linear',
    name: 'chip fixture',
    length: 4000,
    topology: 'linear',
    sequenceType: 'dna',
    features: [],
    restrictionSites: sites,
    width: 1000,
    height: 420,
    display: { maxRestrictionLabels: 8 },
  });
}

/**
 * The only fixture on this file where the feature chip's TWO quantities are BOTH
 * non-zero, which is the only shape that can tell a split apart from a sum. 26
 * full-width features stack past the last row the compressed stack can fit (bodies
 * undrawn); 40 short ones are drawn and lose their labels to the row de-collider.
 */
function denseFeatureLinearLayout() {
  const stacked: Feature[] = Array.from({ length: 26 }, (_, i) => ({
    id: `stack-${i}`,
    name: `stack-${i}`,
    type: 'cds',
    start: 100,
    end: 5600,
    strand: (i % 2 === 0 ? 1 : -1) as 1 | -1,
    color: '#8a8a8a',
    metadata: {},
  }));
  const shorts: Feature[] = Array.from({ length: 40 }, (_, i) => ({
    id: `short-${i}`,
    name: `short-${i}`,
    type: 'cds',
    start: i * 140,
    end: i * 140 + 30,
    strand: 1 as const,
    color: '#8a8a8a',
    metadata: {},
  }));
  return computeMapLayout({
    mode: 'linear',
    name: 'dense feature fixture',
    length: 6000,
    topology: 'linear',
    sequenceType: 'dna',
    features: [...stacked, ...shorts],
    restrictionSites: [],
    width: 1000,
    height: 420,
  });
}

/**
 * Recount a chip's two quantities from the layout's OWN drawn output.
 *
 * This is the point of the function. Reading them back off `text` or `title` only
 * proves the chip's arithmetic equals itself — the numbers it prints and the numbers
 * it carries come from one expression, so an assertion between them cannot fail on a
 * wrong number, only on a divergent one. Counting what the map actually drew is an
 * independent derivation, and is what a reader of these fields is entitled to.
 */
function recount(layout: MapLayout, kind: string): { hiddenBodies: number; unlabelled: number } {
  if (kind === 'restriction-labels') {
    return {
      // Every site keeps a density tick, so nothing restriction-side is undrawn.
      hiddenBodies: 0,
      unlabelled: layout.restrictions.reduce((n, r) => n + (r.label ? 0 : r.tickIds.length), 0),
    };
  }
  const arcless = layout.features.filter((f) => f.segmentPaths.length === 0);
  // An arc-less render with no hover title is the degenerate "feature has no drawable
  // span" case, which the chip deliberately does not report; the overflow rows are the
  // ones that carry a title. Asserted rather than assumed so this recount cannot
  // quietly start counting a different set than the chip does.
  expect(arcless.every((f) => Boolean(f.title))).toBe(true);
  return {
    hiddenBodies: arcless.length,
    unlabelled: layout.features.filter((f) => f.segmentPaths.length > 0 && !f.label).length,
  };
}

function printedNumber(chip: MapOverflowRender): number {
  const printed = Number((chip.text.match(/[\d,]+/) ?? ['NaN'])[0].replace(/,/g, ''));
  expect(printed, `chip "${chip.text}" prints a number`).not.toBeNaN();
  return printed;
}

describe('overflow chip hit rect', () => {
  it('gives the circular chips a target sized from their own text', () => {
    const chips = circularLayout().overflows ?? [];
    const feature = chips.find((c) => c.kind === 'feature-labels');
    const restriction = chips.find((c) => c.kind === 'restriction-labels');

    expect(feature?.text).toBe('+25 more');
    expect(feature?.hit).toEqual({ x: 393.709, y: 415.12, width: 56.582, height: 14 });
    expect(restriction?.text).toBe('+34 more sites');
    expect(restriction?.hit).toEqual({ x: 378.491, y: 429.12, width: 87.018, height: 14 });

    // The longer string gets the wider rect — i.e. the size tracks the text and is
    // not one constant handed to both.
    expect(restriction!.hit.width).toBeGreaterThan(feature!.hit.width);
  });

  it('stacks the two circular targets edge to edge instead of overlapping', () => {
    // This is the whole reason the rect is one label line tall. Overlapping targets
    // would hand the upper chip's tooltip to a pointer aimed at the lower one, which
    // looks like it works and is wrong.
    const chips = circularLayout().overflows ?? [];
    expect(chips).toHaveLength(2);
    const [upper, lower] = [...chips].sort((a, b) => a.hit.y - b.hit.y);

    expect(upper.hit.y + upper.hit.height).toBe(429.12);
    expect(lower.hit.y).toBe(429.12);
    expect(lower.hit.y).toBeGreaterThanOrEqual(upper.hit.y + upper.hit.height);
  });

  it('keeps the linear target clear of the feature lane below it', () => {
    // The overflow layer paints after .motif-pm-features, so anything this rect
    // covers stops being clickable as a feature. The first feature row starts at
    // LINEAR_ROW_TOP = 82; the rect must end above it.
    const chip = (linearLayout().overflows ?? []).find((c) => c.kind === 'restriction-labels');

    expect(chip?.hit).toEqual({ x: 885.091, y: 60.8, width: 94.909, height: 14 });
    expect(chip!.hit.y + chip!.hit.height).toBe(74.8);
    expect(chip!.hit.y + chip!.hit.height).toBeLessThan(82);
  });

  it('anchors the rect on the side the text runs from', () => {
    // anchor 'end' draws the glyphs leftward from x, so a rect centred on x would sit
    // half off the map's right edge, where it can never be pointed at.
    const chip = (linearLayout().overflows ?? []).find((c) => c.kind === 'restriction-labels')!;
    expect(chip.anchor).toBe('end');
    expect(chip.x).toBe(972);
    // Right edge overhangs the text end by the horizontal pad only.
    expect(chip.hit.x + chip.hit.width).toBe(980);
    expect(chip.hit.x).toBeLessThan(chip.x);

    const circular = (circularLayout().overflows ?? []).find((c) => c.kind === 'feature-labels')!;
    expect(circular.anchor).toBe('middle');
    expect(circular.x).toBe(422);
    // Centred: the anchor sits at the rect's midpoint.
    expect(circular.hit.x + circular.hit.width / 2).toBe(422);
  });

  it('covers the text baseline it was derived from', () => {
    for (const chip of [...(circularLayout().overflows ?? []), ...(linearLayout().overflows ?? [])]) {
      expect(chip.hit.y).toBeLessThan(chip.y);
      expect(chip.hit.y + chip.hit.height).toBeGreaterThan(chip.y);
    }
  });

  it('carries numbers the drawn map can be counted back to', () => {
    // The map dock states one of these to keyboard users, who cannot open the chip's
    // <title> — no browser shows an SVG title on focus. So the fields are read by
    // something other than the chip, and the question they have to survive is not
    // "do you agree with the chip" (the chip is the same expression) but "are you
    // right". Both are recounted here from the layout's own drawn output.
    const layouts = [circularLayout(), linearLayout(), denseFeatureLinearLayout()];
    const seen = new Set<string>();

    for (const layout of layouts) {
      for (const chip of layout.overflows ?? []) {
        const expected = recount(layout, chip.kind);
        expect(chip.hiddenBodies, `${chip.id} hiddenBodies`).toBe(expected.hiddenBodies);
        expect(chip.unlabelled, `${chip.id} unlabelled`).toBe(expected.unlabelled);
        expect(chip.hiddenBodies + chip.unlabelled).toBeGreaterThan(0);
        seen.add(chip.kind);
      }
    }

    // Guard the guard: a recount that ran over no chips, or only over the easy chip
    // whose hiddenBodies is structurally 0, would pass while proving nothing.
    expect([...seen].sort()).toEqual(['feature-labels', 'restriction-labels']);
  });

  it('splits the feature chip into two quantities neither of which is its printed total', () => {
    // The trap this replaced: `count` held bodies + labels, one integer standing for
    // two unlike things, and the guard on it compared that sum to the chip's text —
    // which is the same sum. It agreed by construction and would have gone on
    // agreeing while a dock printed "32 features have no label" about a number that
    // was never that. The fixture below is chosen so BOTH parts are non-zero, i.e. so
    // no single field equals the total and a surfacing site is forced to say which
    // one it means.
    const layout = denseFeatureLinearLayout();
    const chip = (layout.overflows ?? []).find((c) => c.kind === 'feature-labels')!;

    expect(chip.hiddenBodies).toBe(25);
    expect(chip.unlabelled).toBe(7);
    expect(printedNumber(chip)).toBe(32);
    expect(chip.hiddenBodies).not.toBe(printedNumber(chip));
    expect(chip.unlabelled).not.toBe(printedNumber(chip));

    // The total is a count of DISTINCT features, not of events: a feature with no body
    // drawn has no label left to drop, so it must not also appear in `unlabelled`. It
    // did, once, and the chip printed "+57" for 32 affected features out of 66.
    expect(chip.hiddenBodies + chip.unlabelled).toBe(printedNumber(chip));
    expect(chip.hiddenBodies + chip.unlabelled).toBeLessThanOrEqual(layout.features.length);

    // Only the title can hold both, and it states them apart rather than added up.
    expect(chip.title).toContain('25 feature bodies hidden');
    expect(chip.title).toContain('7 feature labels dropped');
    expect(chip.title).not.toContain('32');
  });

  it('prints the sum in `text` and nowhere else offers it as one number', () => {
    const chips = [
      ...(circularLayout().overflows ?? []),
      ...(linearLayout().overflows ?? []),
      ...(denseFeatureLinearLayout().overflows ?? []),
    ];
    expect(chips.length).toBeGreaterThan(3);

    for (const chip of chips) {
      expect(printedNumber(chip), `chip "${chip.text}" text is its two parts`)
        .toBe(chip.hiddenBodies + chip.unlabelled);
      // A restriction chip draws every site's density tick, so its total is its
      // `unlabelled` and the dock can read that field without qualification.
      if (chip.kind === 'restriction-labels') {
        expect(chip.hiddenBodies).toBe(0);
        expect(chip.title).toContain(`${chip.unlabelled} restriction sites`);
      }
      // No third field quietly re-offering the total: the type is the guard, and this
      // fails loudly if one is added back.
      expect(Object.keys(chip).sort()).toEqual(
        ['anchor', 'hiddenBodies', 'hit', 'id', 'kind', 'text', 'title', 'unlabelled', 'x', 'y'],
      );
    }
  });

  it('is read by the Map Visibility dock as one named quantity, not a total', () => {
    // The dock is the reason these fields exist and the only place outside the map
    // that prints one. Everything above is about the layout; this is the half that
    // could still be wrong while the layout is right — the sentence it writes is true
    // of `unlabelled` alone, and of a sum only by the accident that the restriction
    // chip's other part is 0 today.
    const start = artifactSource.indexOf('const mapUnlabelledSiteCount');
    expect(start, 'dock readout not found in motif-artifact.tsx').toBeGreaterThan(-1);
    const read = artifactSource.slice(start, artifactSource.indexOf(';', start) + 1);

    expect(read).toContain("overflow.kind === 'restriction-labels'");
    expect(read).toContain('.unlabelled');
    expect(read).not.toMatch(/hiddenBodies|\+/);
    expect(artifactSource).toContain('{mapUnlabelledSiteCount.toLocaleString()} {mapRestrictionSitesOmitted > 0 ? \'selectable sites\' : \'sites\'} without labels on the map');
    expect(artifactSource).toContain('Density marks include all {visibleRestrictionSites.length.toLocaleString()} visible sites');
    expect(artifactSource).toContain('{interactiveMapRestrictionSites.length.toLocaleString()} evenly distributed sites can be selected from the map.');
  });

  it('sizes itself at the type size the stylesheet actually draws the chip at', () => {
    // layout.ts cannot measure the DOM, so it hard-codes the chip's font size. If the
    // stylesheet moves and this does not, every rect silently mis-sizes.
    const base = mapCss.slice(mapCss.indexOf('.motif-pm-overflow {'));
    expect(base.slice(0, base.indexOf('}'))).toMatch(/font-size:\s*10px;/);

    const circular = mapCss.slice(mapCss.indexOf(".motif-pm-container[data-map-mode='circular'] .motif-pm-overflow {"));
    expect(circular.slice(0, circular.indexOf('}'))).toMatch(/font-size:\s*9px;/);
  });

  it('stays centred on the ink box its vertical offset was measured from', () => {
    // OVERFLOW_HIT_CENTER_EM is the one number in the rect that is a reading off a
    // screen rather than a consequence of anything: SVG text is boxed by its font's
    // ascent and descent, and layout.ts places the rect's middle 0.32em above the
    // baseline because that is where the middle was measured. Nothing in the module
    // would notice if it stopped being true.
    //
    // So it is pinned against the measurement instead of being restated: rebuild the
    // measured ink box around each chip's own baseline and require the rect to sit
    // centred on it. Any drift in the offset lands entirely in the difference between
    // the two slacks, at twice the offset's own size, which holds it to ~±0.008em
    // without this test ever naming 0.32.
    const cases: { chip: MapOverflowRender; fontPx: number }[] = [
      { chip: (circularLayout().overflows ?? []).find((c) => c.kind === 'feature-labels')!, fontPx: 9 },
      { chip: (linearLayout().overflows ?? []).find((c) => c.kind === 'restriction-labels')!, fontPx: 10 },
    ];

    for (const { chip, fontPx } of cases) {
      const inkTop = chip.y - MEASURED_INK_ABOVE_BASELINE_EM * fontPx;
      const inkBottom = chip.y + MEASURED_INK_BELOW_BASELINE_EM * fontPx;
      const slackAbove = inkTop - chip.hit.y;
      const slackBelow = chip.hit.y + chip.hit.height - inkBottom;

      expect(Math.abs(slackAbove - slackBelow), `${chip.id} rect is off-centre on its glyphs`)
        .toBeLessThanOrEqual(0.25);
      // ...and it clears the measured glyphs by a whole CSS pixel top and bottom, which
      // is the margin that makes a font swap's tenths of an em a non-event rather than
      // an uncovered chip. Report it as a number so shrinking it is a visible choice.
      expect(Math.min(slackAbove, slackBelow), `${chip.id} rect barely clears its glyphs`)
        .toBeGreaterThanOrEqual(1);
    }
  });

  it('was measured on the font stack the stylesheet still asks for', () => {
    // The measurement above is only a measurement OF something: swap the family and
    // the ascent/descent move, the middle moves with them, and no assertion here or
    // in layout.ts would fail — the rect would just sit slightly high or low forever.
    // Pinning the declared stack makes that swap fail loudly instead, next to the
    // font-size guard that exists for the same reason.
    //
    // What this cannot see: the host's own `--font-ui`, which resolves at runtime and
    // wins over the fallbacks below. That is out of reach of a test that may not touch
    // the DOM, and the consequence there is sub-pixel — the rect is a full label line
    // tall, so tenths of an em never uncover the glyphs.
    const base = mapCss.slice(mapCss.indexOf('.motif-pm-overflow {'));
    expect(base.slice(0, base.indexOf('}'))).toContain(
      "font-family: var(--font-ui, var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif));",
    );
  });
});
