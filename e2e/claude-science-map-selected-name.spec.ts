import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

if (process.env.MOTIF_SINGLE_PROCESS_BROWSER === '1') {
  test.use({
    launchOptions: {
      args: ['--single-process', '--no-zygote'],
    },
  });
}

// The ring names only a budget of features. Selecting one of the others must not draw
// its halo and wedge with no name anywhere on the map: on pUC19 the reverse primer sits
// unnamed beside a named forward primer. Its name shows beside it while it is
// selected, whole, over nothing else, and goes when the selection ends or moves to a
// named feature.
const PRIMER = 'M13/pUC reverse primer (-48)';
const CASES = [
  { width: 1440, height: 900 },
  { width: 660, height: 788 },
] as const;

async function openArtifact(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('map-selected-name-seeded')) return;
    window.localStorage.clear();
    window.sessionStorage.setItem('map-selected-name-seeded', '1');
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('pUC19');
  await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
}

function mapSvg(page: Page) {
  return page.locator('[data-pane-key="map"] svg.motif-plasmid-map');
}

async function selectFeature(page: Page, name: string) {
  const feature = mapSvg(page).locator(`.motif-pm-feature[aria-label^="${name} ·"]`);
  await expect(feature).toHaveCount(1);
  await feature.focus();
  await page.keyboard.press('Enter');
  await expect(feature).toHaveAttribute('aria-pressed', 'true');
}

async function clearSelection(page: Page) {
  // The centre title passes a click to the map's background, which clears it.
  const centre = await mapSvg(page).locator('.motif-pm-center text').first().boundingBox();
  await page.mouse.click(centre!.x + centre!.width / 2, centre!.y + centre!.height / 2);
  await expect(mapSvg(page).locator('.motif-pm-feature[aria-pressed="true"]')).toHaveCount(0);
}

/** Everything the callout may not cover, measured off the drawn map. */
async function calloutReport(page: Page, name: string) {
  return mapSvg(page).evaluate((svg, featureName) => {
    type Box = { x: number; y: number; width: number; height: number };
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const touches = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const callout = svg.querySelector('[data-selected-name]')!;
    const plate = box(callout.querySelector('rect')!);
    const text = callout.querySelector('text')!;
    const textBox = box(text);
    const svgBox = box(svg);
    const others = [...svg.querySelectorAll('.motif-pm-viewport :is(.motif-pm-feature-label, .motif-pm-restriction-label, .motif-pm-coord-label)')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => touches(plate, box(el)))
      .map((el) => el.textContent);
    const centre = [...svg.querySelectorAll('.motif-pm-center text')].some((el) => touches(plate, box(el)));
    const feature = [...svg.querySelectorAll('.motif-pm-feature')]
      .find((el) => el.getAttribute('aria-label')?.startsWith(`${featureName} ·`))!;
    let featurePointsInside = 0;
    for (const body of feature.querySelectorAll<SVGPathElement>('.motif-pm-feature-body')) {
      const m = body.getScreenCTM()!;
      const total = body.getTotalLength();
      for (let i = 0; i <= 400; i += 1) {
        const p = body.getPointAtLength((total * i) / 400);
        const x = m.a * p.x + m.c * p.y + m.e;
        const y = m.b * p.x + m.d * p.y + m.f;
        if (x > plate.x && x < plate.x + plate.width && y > plate.y && y < plate.y + plate.height) featurePointsInside += 1;
      }
    }
    return {
      label: callout.getAttribute('data-selected-name'),
      ariaHidden: callout.getAttribute('aria-hidden'),
      text: text.textContent,
      plate,
      fontPx: parseFloat(getComputedStyle(text).fontSize) * (text.getScreenCTM()?.a ?? 1),
      // The whole name lies on its plate and the plate inside the drawing and the window.
      textOnPlate: textBox.x >= plate.x - 0.5 && textBox.x + textBox.width <= plate.x + plate.width + 0.5,
      plateInDrawing: plate.x >= svgBox.x && plate.y >= svgBox.y
        && plate.x + plate.width <= svgBox.x + svgBox.width && plate.y + plate.height <= svgBox.y + svgBox.height,
      plateInWindow: plate.x >= 0 && plate.y >= 0 && plate.x + plate.width <= window.innerWidth && plate.y + plate.height <= window.innerHeight,
      others,
      centre,
      featurePointsInside,
    };
  }, name);
}

test.describe('the name of a selected feature the ring leaves unnamed', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const c of CASES) {
    test(`shows beside it, whole and clear, at ${c.width}x${c.height}`, async ({ page }) => {
      await openArtifact(page, c.width, c.height);
      const svg = mapSvg(page);
      // At rest the map carries no callout.
      await expect(svg.locator('[data-selected-name]')).toHaveCount(0);
      // The primer is one the ring leaves unnamed.
      await expect(svg.locator('.motif-pm-feature-label', { hasText: PRIMER })).toHaveCount(0);

      await selectFeature(page, PRIMER);
      await expect(svg.locator('[data-selected-name]')).toHaveCount(1);
      const report = await calloutReport(page, PRIMER);
      expect(report.label).toBe(PRIMER);
      expect(report.text).toBe(PRIMER);
      expect(report.ariaHidden).toBe('true');
      expect(report.fontPx).toBeGreaterThanOrEqual(11.9);
      expect(report.textOnPlate).toBe(true);
      expect(report.plateInDrawing).toBe(true);
      expect(report.plateInWindow).toBe(true);
      expect(report.others).toEqual([]);
      expect(report.centre).toBe(false);
      expect(report.featurePointsInside).toBe(0);

      // A named feature gets no callout, and selecting it removes the primer's.
      await selectFeature(page, 'AmpR');
      await expect(svg.locator('[data-selected-name]')).toHaveCount(0);

      await selectFeature(page, PRIMER);
      await expect(svg.locator('[data-selected-name]')).toHaveCount(1);
      await clearSelection(page);
      await expect(svg.locator('[data-selected-name]')).toHaveCount(0);
    });
  }

  test('the "+2 features" tooltip names the features the ring leaves unnamed', async ({ page }) => {
    await openArtifact(page, 1440, 900);
    const features = page.locator('[data-pane-key="map"] .motif-cs-map-overflow-button[data-kind="feature-labels"]');
    await expect(features).toHaveText('+2 features');
    await expect(features).toHaveAttribute(
      'title',
      `Not named on the map: MCS, ${PRIMER}. Click to list all features.`,
    );
  });
});
