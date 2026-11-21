import { expect, test, type Page } from '@playwright/test';

/**
 * Double-click on the empty map background zooms in one step (the Zoom in control's
 * 1.25x) about the pointer. Double-click on a feature still
 * opens its editor.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

const ring = (page: Page) => page.evaluate(() => {
  const r = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width };
});

test.describe('double-click on the map', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('the empty background zooms in one step about the pointer; a feature opens its editor', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
    const before = await ring(page);
    expect(Math.round(before.w)).toBe(551);

    // A point inside the ring that really hits the empty background.
    const point = await page.evaluate(({ cx, cy, w }) => {
      for (let f = 0.3; f < 0.9; f += 0.05) {
        const p = { x: cx - (w / 2) * f * 0.7, y: cy + (w / 2) * f * 0.7 };
        if (document.elementFromPoint(p.x, p.y)?.classList.contains('motif-pm-bg')) return p;
      }
      throw new Error('no empty background inside the ring');
    }, before);
    await page.mouse.dblclick(point.x, point.y);
    await expect.poll(async () => Math.round((await ring(page)).w)).toBe(Math.round(before.w * 1.25));
    // The base under the pointer stays under it: the centre moves away from it by 1.25x.
    const after = await ring(page);
    expect(after.cx - point.x).toBeCloseTo((before.cx - point.x) * 1.25, 0);
    expect(after.cy - point.y).toBeCloseTo((before.cy - point.y) * 1.25, 0);

    // A feature: its editor opens.
    const hit = await page.evaluate(() => {
      for (const feature of document.querySelectorAll('.motif-cs-map-frame .motif-pm-feature[data-feature-id]')) {
        for (const path of feature.querySelectorAll('path')) {
          const total = path.getTotalLength();
          const ctm = path.getScreenCTM()!;
          for (let f = 0.1; f < 1; f += 0.1) {
            const q = path.getPointAtLength(total * f);
            const p = new DOMPoint(q.x, q.y).matrixTransform(ctm);
            if (p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight && document.elementFromPoint(p.x, p.y)?.closest('.motif-pm-feature') === feature) return { x: p.x, y: p.y };
          }
        }
      }
      throw new Error('no feature in view');
    });
    await page.mouse.dblclick(hit.x, hit.y);
    await expect(page.locator('details[data-rail-tool="annotations"]')).toHaveAttribute('open', '');
    await expect(page.locator('details[data-rail-tool="annotations"] input[name="feature-name"]')).toBeVisible();
  });
});
