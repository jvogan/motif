import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One control row, one control height.
 *
 * The toolbar and the view row set their height on the flex item, and three of
 * those items are wrappers around the control that actually draws the border: a
 * <label> around a <select>, a <details> around a <summary>, and the Find <form>
 * around a field and two step buttons. A height on the wrapper leaves the
 * painted box at its own intrinsic size, so the rows rendered at 30px, 28px and
 * 26px at once — measured tops 174/175/176 and bottoms 202/203/204 across the
 * view row's six boxes, unchanged from 1100x650 to 1920x1080.
 *
 * These guards read the stylesheet, so they hold wherever the declaration moves.
 * The markup assertions come first: they fail if a row gains a wrapper the
 * levelling rule does not name, which is how the defect got in.
 */

const here = dirname(fileURLToPath(import.meta.url));
const overlayCss = readFileSync(resolve(here, '..', 'claude-science-msa.css'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const viewer = readFileSync(resolve(here, '..', 'ClaudeScienceMsaViewer.tsx'), 'utf8');

const ROW_HEIGHT_PX = 30;

type Rule = { selectors: string[]; body: string };

function rules(css: string): Rule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = match[1].trim();
    if (prelude.startsWith('@')) continue;
    out.push({ selectors: prelude.split(',').map((one) => one.trim()), body: match[2] });
  }
  return out;
}

/** A control inside a row, as opposed to the row itself or a screen-reader span. */
const CONTROL_TAIL = /(select|summary|input|\.motif-cs-mini-button|\.motif-cs-segmented)$/;

/** Every explicit height a rule declares for a control inside one of these rows. */
function declaredHeights(rowClass: string): { selector: string; value: string }[] {
  const found: { selector: string; value: string }[] = [];
  for (const rule of rules(overlayCss)) {
    for (const selector of rule.selectors) {
      const at = selector.indexOf(rowClass);
      if (at === -1) continue;
      const tail = selector.slice(at + rowClass.length);
      if (!tail.trim() || !CONTROL_TAIL.test(selector)) continue;
      for (const declaration of rule.body.matchAll(/(^|;)\s*(?:min-height|height)\s*:\s*([^;]+)/g)) {
        found.push({ selector, value: declaration[2].trim() });
      }
    }
  }
  return found;
}

describe('Claude Science MSA control rows', () => {
  it.each([
    ['.motif-cs-msa-toolbar'],
    ['.motif-cs-msa-view-controls'],
  ])('declares a single control height for %s', (rowClass) => {
    const heights = declaredHeights(rowClass);
    expect(heights.length, `${rowClass} declares no control height`).toBeGreaterThan(0);
    const values = [...new Set(heights.map((entry) => entry.value))];
    expect(
      values,
      `${rowClass} paints controls at ${values.join(', ')}; a row with more than one box height staggers every edge in it`,
    ).toEqual([`${ROW_HEIGHT_PX}px`]);
  });

  it('levels the control inside every wrapper the two rows hold', () => {
    // The wrappers, read off the markup so a new one cannot arrive unnoticed.
    expect(viewer).toContain('className="motif-cs-msa-alignment-picker"');
    expect(viewer).toContain('className="motif-cs-msa-reference-picker"');
    expect(viewer).toContain('className="motif-cs-msa-search"');
    expect(viewer).toMatch(/className="motif-cs-msa-(goto|view|export)-menu"/);

    const levelled = rules(overlayCss)
      .filter((rule) => /(^|;)\s*min-height\s*:\s*30px/.test(rule.body))
      .flatMap((rule) => rule.selectors);

    for (const selector of [
      '.motif-cs-msa-toolbar > label > select',
      '.motif-cs-msa-toolbar > details > summary',
      '.motif-cs-msa-view-controls > label > select',
      '.motif-cs-msa-view-controls > .motif-cs-msa-search > .motif-cs-msa-search-input',
      '.motif-cs-msa-view-controls > .motif-cs-msa-search > .motif-cs-mini-button',
    ]) {
      expect(
        levelled.some((one) => one.endsWith(selector)),
        `nothing levels ${selector}; that control keeps its own height and breaks the row`,
      ).toBe(true);
    }
  });

  it('keeps the provenance trigger square at the row height', () => {
    const summary = rules(overlayCss).find((rule) => rule.selectors.some((one) => (
      one.endsWith('.motif-cs-msa-provenance > summary')
    )));
    expect(summary, 'no rule sizes the provenance trigger').toBeDefined();
    expect(summary!.body).toMatch(new RegExp(`width\\s*:\\s*${ROW_HEIGHT_PX}px`));
    expect(summary!.body).toMatch(new RegExp(`min-height\\s*:\\s*${ROW_HEIGHT_PX}px`));
  });

  it('lets the match count take the search form\'s spare width', () => {
    const count = rules(overlayCss).filter((rule) => rule.selectors.some((one) => (
      one.endsWith('.motif-cs-msa-search-count') || one.endsWith('.motif-cs-msa-search-count:empty')
    )));
    expect(count.length, 'nothing sizes the match count').toBeGreaterThan(0);

    // The declaration the cascade lands on is the last one.
    const sized = count[count.length - 1].body;
    const flex = sized.match(/(^|;)\s*flex\s*:\s*(\d+)/);
    expect(flex, 'the match count declares no flex').not.toBeNull();
    expect(
      Number(flex![2]),
      'a match count that cannot grow leaves the form\'s spare width unusable: it clipped '
        + '"3 row name · 143 motif" at 97px while 111px of the same form stayed blank, and it '
        + 'stranded the step buttons 105px from the field',
    ).toBeGreaterThanOrEqual(1);
    expect(sized, 'a fixed width pins the slot back at its floor').not.toMatch(/(^|;)\s*width\s*:/);
    expect(sized, 'the floor is what holds the buttons still when the row is tight').toMatch(/min-width\s*:/);
    expect(sized, 'the narrow case still has to end in an ellipsis, not a cut glyph').toContain('text-overflow: ellipsis');
  });

  it('keeps the count between the field and the buttons it labels', () => {
    const form = viewer.slice(
      viewer.indexOf('data-testid="msa-search"'),
      viewer.indexOf('data-testid="msa-search-next"'),
    );
    expect(form).toContain('data-testid="msa-search-input"');
    expect(form.indexOf('data-testid="msa-search-input"'))
      .toBeLessThan(form.indexOf('data-testid="msa-search-count"'));
    expect(form.indexOf('data-testid="msa-search-count"'))
      .toBeLessThan(form.indexOf('data-testid="msa-search-prev"'));
  });

  it('sizes the status-bar stepper to the shared button height', () => {
    const base = artifactCss.match(/\n\.motif-cs-mini-button \{\n\s*min-height: (\d+)px;/);
    expect(base, 'mini-button lost its base height').not.toBeNull();
    const stepper = rules(overlayCss).find((rule) => rule.selectors.some((one) => (
      one.includes('.motif-cs-msa-statusbar')
      && one.includes('.motif-cs-msa-difference-nav')
      && one.endsWith('.motif-cs-mini-button')
    )));
    expect(stepper, 'nothing sizes the status-bar stepper').toBeDefined();
    expect(stepper!.body).toMatch(new RegExp(`width\\s*:\\s*${base![1]}px`));
    expect(stepper!.body).toMatch(new RegExp(`min-height\\s*:\\s*${base![1]}px`));
  });
});
