import { expect, test, type Page } from '@playwright/test';

/**
 * Zoomed Line view: Line zoom scales the rows with the axis, so rows leave the
 * frame. Every edge of the drawing must still come fully into the frame, with
 * at least 8px to spare, by the wheel and by a middle-button drag. At Fit no
 * map element is cut by a frame edge.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

const slack = (page: Page) => page.evaluate(() => {
  const frame = document.querySelector('.motif-cs-map-frame')!;
  const f = frame.getBoundingClientRect();
  const items = [...frame.querySelectorAll('g.motif-pm-feature, text')]
    .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const cut = items.filter((r) => (r.top < f.top - 0.5 && r.bottom > f.top) || (r.bottom > f.bottom + 0.5 && r.top < f.bottom)
    || (r.left < f.left - 0.5 && r.right > f.left) || (r.right > f.right + 0.5 && r.left < f.right)).length;
  return {
    top: Math.min(...items.map((r) => r.top)) - f.top,
    bottom: f.bottom - Math.max(...items.map((r) => r.bottom)),
    left: Math.min(...items.map((r) => r.left)) - f.left,
    right: f.right - Math.max(...items.map((r) => r.right)),
    cut,
    cx: f.left + f.width / 2,
    cy: f.top + f.height / 2,
  };
});

test.describe('zoomed Line view reach', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('every edge of the drawing comes into the frame at zoom steps 2 to 4', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(artifactUrl!);
    const tools = page.getByRole('group', { name: 'Map view controls' });
    await tools.getByRole('button', { name: 'Line', exact: true }).click();
    await expect(page.locator('.motif-cs-map-frame[data-map-mode="linear"]')).toBeVisible();
    await expect.poll(async () => (await slack(page)).cut).toBe(0);

    for (let step = 1; step <= 4; step += 1) {
      await tools.getByRole('button', { name: 'Zoom in' }).click();
      if (step < 2) continue;
      const rest = await slack(page);
      await page.mouse.move(rest.cx, rest.cy);
      for (const [side, dx, dy] of [['bottom', 0, 400], ['top', 0, -400], ['right', 400, 0], ['left', -400, 0]] as const) {
        for (let i = 0; i < 12; i += 1) await page.mouse.wheel(dx, dy);
        await expect.poll(async () => (await slack(page))[side], { message: `wheel, zoom step ${step}, ${side}` }).toBeGreaterThanOrEqual(8);
      }
    }

    // A middle-button drag reaches the lowest row too.
    for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, -400);
    const { cx, cy } = await slack(page);
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.move(cx, cy + 120);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(cx, cy - 120, { steps: 6 });
      await page.mouse.up({ button: 'middle' });
    }
    await expect.poll(async () => (await slack(page)).bottom).toBeGreaterThanOrEqual(8);
  });
});
