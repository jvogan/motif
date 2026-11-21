import { expect, test, type Page } from '@playwright/test';

/**
 * A range selected in the sequence pane pans a zoomed map, zoom unchanged, so its arc
 * is in view. A map gesture, and a selection
 * whose arc already shows, leave the map where it is.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

/** The ring's box, and whether base `bp` on it is inside the visible map frame. */
const mapState = (page: Page, bp: number) => page.evaluate((b) => {
  const ring = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
  const frame = document.querySelector('.motif-cs-map-frame')!.getBoundingClientRect();
  const svg = document.querySelector('.motif-cs-map-frame svg.motif-plasmid-map')!.getBoundingClientRect();
  const a = (b / 2686) * 2 * Math.PI; // the bundled record's length
  const p = { x: ring.left + ring.width / 2 + (ring.width / 2) * Math.sin(a), y: ring.top + ring.height / 2 - (ring.height / 2) * Math.cos(a) };
  const [l, t, r, bt] = [Math.max(frame.left, svg.left), Math.max(frame.top, svg.top), Math.min(frame.right, svg.right), Math.min(frame.bottom, svg.bottom)];
  return { ring: [ring.left, ring.top, ring.width].map(Math.round), inView: p.x >= l && p.x <= r && p.y >= t && p.y <= bt, p };
}, bp);

/** Drag across the first ten bases of sequence row `line` (0-based). */
const selectInSequence = async (page: Page, line: number) => {
  const row = page.locator('.motif-cs-seq-bases[data-line-start]').nth(line);
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  return Number(await row.getAttribute('data-line-start'));
};

test.describe('a sequence selection shows on a zoomed map', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('the map pans to the arc only when it is out of view and did not come from the map', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
    await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();

    // At home the arc already shows: the map stays put.
    const home = await mapState(page, 0);
    const lineStart = await selectInSequence(page, 0);
    await expect(page.locator('.motif-cs-map-selection-line')).toContainText('bp');
    expect((await mapState(page, lineStart)).ring).toEqual(home.ring);

    // Zoomed in, then panned with the wheel until the top of the ring is out of view.
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 5; i += 1) await zoomIn.click();
    const box = (await page.locator('.motif-cs-map-frame').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8 && (await mapState(page, 50)).inView; i += 1) await page.mouse.wheel(0, 300);
    const zoomed = await mapState(page, 50);
    expect(zoomed.inView).toBe(false);
    const next = await selectInSequence(page, 1);
    await expect.poll(async () => (await mapState(page, next + 5)).inView).toBe(true);
    const panned = await mapState(page, next + 5);
    expect(panned.ring[2]).toBe(zoomed.ring[2]);

    // A click on the ring (a map selection) does not move the map.
    await page.mouse.click(panned.p.x, panned.p.y);
    await expect(page.locator('.motif-cs-map-selection-line')).toContainText('· 1 bp');
    expect((await mapState(page, next + 5)).ring).toEqual(panned.ring);
  });
});
