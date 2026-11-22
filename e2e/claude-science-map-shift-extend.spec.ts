import { expect, test, type Page } from '@playwright/test';

/**
 * Shift+click on the map extends the selection to the clicked base or feature, as it
 * does in a text editor, for a ring selection and for a feature one.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const mapLine = (page: Page) => page.locator('.motif-cs-map-selection-line');

const ringPoint = async (page: Page, deg: number) => {
  const ring = await page.evaluate(() => {
    const r = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
  });
  return { x: ring.cx + ring.r * Math.sin((deg * Math.PI) / 180), y: ring.cy - ring.r * Math.cos((deg * Math.PI) / 180) };
};

/** A client point that really hits feature `index`, found along its outline. */
const featurePoint = (page: Page, index: number) => page.evaluate((i) => {
  const feature = document.querySelectorAll('.motif-cs-map-frame .motif-pm-feature[data-feature-id]')[i]!;
  for (const path of feature.querySelectorAll('path')) {
    const total = path.getTotalLength();
    const ctm = path.getScreenCTM()!;
    for (let f = 0.1; f < 1; f += 0.1) {
      const p = new DOMPoint(path.getPointAtLength(total * f).x, path.getPointAtLength(total * f).y).matrixTransform(ctm);
      if (document.elementFromPoint(p.x, p.y)?.closest('.motif-pm-feature') === feature) return { x: p.x, y: p.y, label: feature.getAttribute('aria-label') ?? '' };
    }
  }
  throw new Error(`no hit point on feature ${i}`);
}, index);

const span = async (page: Page) => {
  const match = /([\d,]+)–([\d,]+) · ([\d,]+) bp/.exec((await mapLine(page).textContent()) ?? '');
  expect(match).not.toBeNull();
  return match!.slice(1).map((n) => Number(n.replace(/,/g, '')));
};

const shiftClick = async (page: Page, p: { x: number; y: number }) => {
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift');
};

test.describe('Shift+click extends the map selection', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('a ring position and a feature extend the selection; with none it is a plain click', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();

    // With no selection, Shift+click places one base, as a plain click does.
    await shiftClick(page, await ringPoint(page, 30));
    await expect(mapLine(page)).toContainText('· 1 bp');
    const [first] = await span(page);

    // Shift+click further round the ring grows the end of that base to it.
    await shiftClick(page, await ringPoint(page, 60));
    await expect(mapLine(page)).not.toContainText('· 1 bp');
    const [start, end, size] = await span(page);
    expect(start).toBe(first);
    expect(size).toBe(end - start + 1);
    expect(size).toBeGreaterThan(100);
    // The sequence pane follows.
    await expect(page.locator('.motif-cs-selection-label')).toContainText(`${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')}`);

    // A feature: a plain click selects it, Shift+click on another covers both.
    await page.keyboard.press('Escape');
    const a = await featurePoint(page, 0);
    const b = await featurePoint(page, 1);
    await page.mouse.click(a.x, a.y);
    await expect(mapLine(page)).toContainText(a.label.split(' · ')[0]!);
    const [aStart, aEnd] = await span(page);
    await shiftClick(page, b);
    await expect(mapLine(page)).not.toContainText(a.label.split(' · ')[0]!);
    const [eStart, eEnd] = await span(page);
    expect(eEnd - eStart).toBeGreaterThan(aEnd - aStart);
    expect(eStart <= aStart && eEnd >= aEnd).toBe(true);
  });
});
