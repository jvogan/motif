import { expect, test, type Page } from '@playwright/test';

/**
 * A selection on the circular map keeps every ruler label that showed before it: a
 * feature click or a range drag at 1280x820 in dark removes none. "500" and "2500" do
 * not show at Fit even before a selection, so this pins only that a selection removes
 * none that do.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

const rulerLabels = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.motif-cs-map-frame .motif-pm-coord-label')]
  .filter((el) => {
    const style = getComputedStyle(el);
    return el.getBoundingClientRect().width > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
  })
  .map((el) => el.textContent ?? ''));

test.describe('ruler labels after a map selection', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('a feature pick and a range drag keep every ruler label at 1280x820 in dark', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem('ruler-seeded')) return;
      window.localStorage.clear();
      window.localStorage.setItem('motif.workspace-layout.v1', JSON.stringify({ theme: 'dark' }));
      window.sessionStorage.setItem('ruler-seeded', '1');
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
    const before = await rulerLabels(page);
    expect(before.length).toBeGreaterThanOrEqual(4);

    // A feature picked from the keyboard, as Enter on a focused map item does.
    const feature = page.locator('.motif-cs-map-frame .motif-pm-feature[aria-label^="AmpR ·"]').first();
    await feature.focus();
    await page.keyboard.press('Enter');
    await expect(feature).toHaveAttribute('aria-pressed', 'true');
    expect(await rulerLabels(page)).toEqual(expect.arrayContaining(before));

    // A range dragged along the ring.
    await page.keyboard.press('Escape');
    const ring = await page.evaluate(() => {
      const r = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
    });
    const at = (deg: number) => ({ x: ring.cx + ring.r * Math.sin((deg * Math.PI) / 180), y: ring.cy - ring.r * Math.cos((deg * Math.PI) / 180) });
    const start = at(20);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let deg = 24; deg <= 120; deg += 4) await page.mouse.move(at(deg).x, at(deg).y);
    await page.mouse.up();
    await expect(page.locator('.motif-cs-map-frame .motif-pm-selection').first()).toBeAttached();
    expect(await rulerLabels(page)).toEqual(expect.arrayContaining(before));
  });
});
