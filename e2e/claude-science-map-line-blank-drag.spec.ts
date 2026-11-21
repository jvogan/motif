import { expect, test, type Page } from '@playwright/test';

/**
 * Line view, real mouse and keyboard input: a plain left drag on blank canvas,
 * well away from the axis, selects a range by x, as a drag inside the ring does,
 * and never moves the view. With the hand toggle on, with Space held or with the
 * middle button, the same drag pans and keeps the selection.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const DRAG = 80;

async function openLine(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  const tools = page.getByRole('group', { name: 'Map view controls' });
  await tools.getByRole('button', { name: 'Line', exact: true }).click();
  await expect(page.locator('.motif-cs-map-frame[data-map-mode="linear"]')).toBeVisible();
  return tools;
}

/** A point on the drawing's empty background at least 60px from the axis, with room for the drag. */
async function blankPoint(page: Page) {
  const point = await page.evaluate((drag) => {
    const frame = document.querySelector('.motif-cs-map-frame .motif-pm-container')!.getBoundingClientRect();
    const axis = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
    const axisY = axis.top + axis.height / 2;
    for (let y = frame.bottom - 8; y > frame.top + 8; y -= 6) {
      if (Math.abs(y - axisY) < 60) continue;
      for (let x = frame.left + frame.width * 0.3; x < frame.left + frame.width * 0.7; x += 12) {
        const hit = document.elementFromPoint(x, y);
        const hitEnd = document.elementFromPoint(x + drag, y);
        if (hit?.matches('.motif-pm-bg') && hitEnd?.matches('.motif-pm-bg')) return { x, y, axisY };
      }
    }
    return null;
  }, DRAG);
  expect(point, 'blank canvas away from the axis').not.toBeNull();
  return point!;
}

async function readMap(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.motif-cs-map-frame')!;
    const box = frame.querySelector('.motif-pm-backbone')!.getBoundingClientRect();
    return {
      x: box.left,
      y: box.top,
      selection: [...frame.querySelectorAll('.motif-pm-selection')].map((path) => path.getAttribute('d')).join('|'),
      status: document.querySelector('.motif-cs-map-selection-line')?.textContent ?? '',
    };
  });
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, button: 'left' | 'middle' = 'left') {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from.x + (dx * step) / 10, from.y);
  await page.mouse.up({ button });
  // The click suppression after a drag lasts 120 ms.
  await page.waitForTimeout(160);
}

test.describe('Line view blank-canvas drag', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('a plain drag on blank canvas selects a range at Fit and zoomed; the hand, Space and the middle button pan', async ({ page }) => {
    const tools = await openLine(page);
    const frame = page.locator('.motif-cs-map-frame');
    const readout = /^[\d,]+–[\d,]+ · [\d,]+ bp/;

    // Fit: blank canvas below the rows selects.
    let p = await blankPoint(page);
    await page.mouse.move(p.x, p.y);
    await expect(frame).toHaveAttribute('data-map-pointer-action', 'range');
    let before = await readMap(page);
    await drag(page, p, DRAG);
    let after = await readMap(page);
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    expect(after.selection).not.toBe('');
    expect(after.status).toMatch(readout);

    // Zoomed two steps: still selects, still never pans.
    await tools.getByRole('button', { name: 'Zoom in' }).click();
    await tools.getByRole('button', { name: 'Zoom in' }).click();
    p = await blankPoint(page);
    before = await readMap(page);
    await drag(page, p, -DRAG);
    after = await readMap(page);
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    expect(after.selection).not.toBe('');
    expect(after.selection).not.toBe(before.selection);
    expect(after.status).toMatch(readout);
    const kept = after.selection;

    // Middle button: pans by the drag and keeps the selection.
    p = await blankPoint(page);
    before = await readMap(page);
    await drag(page, p, DRAG, 'middle');
    after = await readMap(page);
    expect(Math.abs(after.x - before.x - DRAG)).toBeLessThanOrEqual(2);
    expect(after.selection.length).toBeGreaterThan(0);

    // Space held: a primary drag pans.
    p = await blankPoint(page);
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down('Space');
    before = await readMap(page);
    await drag(page, p, -DRAG);
    after = await readMap(page);
    await page.keyboard.up('Space');
    expect(Math.abs(after.x - before.x + DRAG)).toBeLessThanOrEqual(2);

    // The hand toggle: a primary drag pans.
    const hand = tools.getByRole('button', { name: 'Pan by dragging' });
    await hand.click();
    await expect(hand).toHaveAttribute('aria-pressed', 'true');
    p = await blankPoint(page);
    before = await readMap(page);
    await drag(page, p, DRAG);
    after = await readMap(page);
    expect(Math.abs(after.x - before.x - DRAG)).toBeLessThanOrEqual(2);
    // None of the three pans changed what was selected.
    expect(after.selection.split('|').length).toBe(kept.split('|').length);

    // Hand off again: the plain drag selects and the view stays.
    await hand.click();
    await expect(hand).toHaveAttribute('aria-pressed', 'false');
    p = await blankPoint(page);
    before = await readMap(page);
    await drag(page, p, DRAG * 1.5);
    after = await readMap(page);
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.selection).not.toBe(before.selection);
  });
});
