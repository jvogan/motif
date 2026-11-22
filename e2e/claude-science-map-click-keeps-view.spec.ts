import { expect, test, type Page } from '@playwright/test';

/**
 * A click on the map changes what is selected, never where things are. A selection
 * made in the sequence pane pans a zoomed map to its arc (see
 * claude-science-map-reveal-selection.spec.ts), but a click on a feature bar of a
 * zoomed map does not: in Line view at 2 zoom steps the map stays under the pointer,
 * and a double-click on the bar opens the feature's editor.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

const viewport = (page: Page) => page.evaluate(() => {
  const t = document.querySelector('.motif-pm-viewport')?.getAttribute('transform') ?? '';
  const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)\s*scale\(([-\d.e]+)\)/.exec(t);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 1];
});

/** A point that really hits a feature bar inside the visible frame, or null. */
const featurePoint = (page: Page, id?: string) => page.evaluate((wanted) => {
  const frame = document.querySelector('.motif-cs-map-frame')!.getBoundingClientRect();
  for (const g of document.querySelectorAll<SVGGElement>('g.motif-pm-feature[data-feature-id]')) {
    if (wanted && g.dataset.featureId !== wanted) continue;
    const body = g.querySelector('path.motif-pm-feature-body, path.motif-pm-feature-hit');
    if (!body) continue;
    const r = body.getBoundingClientRect();
    const hits: Array<[number, number]> = [];
    for (let i = 0; i <= 24; i += 1) {
      for (let j = 0; j <= 24; j += 1) {
        const x = r.x + (r.width * i) / 24;
        const y = r.y + (r.height * j) / 24;
        if (x < frame.left + 4 || y < frame.top + 4 || x > frame.right - 4 || y > frame.bottom - 4) continue;
        if (document.elementFromPoint(x, y)?.closest('g.motif-pm-feature') === g) hits.push([x, y]);
      }
    }
    if (hits.length > 4) {
      const [x, y] = hits[Math.floor(hits.length / 2)];
      return { x, y, id: g.dataset.featureId! };
    }
  }
  return null;
}, id);

test.describe('a click on a zoomed map keeps the view', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const size of [{ width: 1440, height: 900 }, { width: 700, height: 860 }]) {
    test(`a click and a Shift+click on a feature never pan the map at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      const zoomIn = page.getByRole('button', { name: 'Zoom in' });

      for (const view of ['Circle', 'Line'] as const) {
        await page.goto(artifactUrl!);
        await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
        if (view === 'Line') await page.getByRole('button', { name: 'Line', exact: true }).click();
        for (let step = 1; step <= 4; step += 1) {
          await zoomIn.click();
          if (view === 'Circle' && step < 4) continue;
          const point = await featurePoint(page);
          expect(point, `${view} at ${step} zoom steps shows a feature`).not.toBeNull();
          const before = await viewport(page);
          await page.mouse.click(point!.x, point!.y);
          await expect(page.locator('.motif-cs-map-selection-line')).not.toContainText('Click a feature');
          await page.waitForTimeout(300);
          expect(await viewport(page), `${view} at ${step} zoom steps: click`).toEqual(before);
          await page.keyboard.down('Shift');
          await page.mouse.click(point!.x + 2, point!.y);
          await page.keyboard.up('Shift');
          await page.waitForTimeout(300);
          expect(await viewport(page), `${view} at ${step} zoom steps: Shift+click`).toEqual(before);
          await page.keyboard.press('Escape');
        }
      }
    });
  }

  test('a double-click on a feature in a zoomed Line view opens its editor without panning', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 860 });
    await page.goto(artifactUrl!);
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    await zoomIn.click();
    await zoomIn.click();
    const point = await featurePoint(page, 'puc19-ampr');
    expect(point).not.toBeNull();
    const editor = page.locator('[data-testid="rail-popover-close"]:visible');
    await expect(editor).toHaveCount(0);
    const before = await viewport(page);
    await page.mouse.dblclick(point!.x, point!.y);
    await expect(editor).not.toHaveCount(0);
    expect(await viewport(page)).toEqual(before);
  });
});
