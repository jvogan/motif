import { expect, test, type Page } from '@playwright/test';

/**
 * The map frame's height is set by hand with a splitter on its bottom edge. Each
 * map mode keeps its own height; the layout's own height is the default at first
 * open.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

const read = (page: Page) => page.evaluate(() => {
  const frame = document.querySelector('.motif-cs-map-frame')!.getBoundingClientRect();
  const ring = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
  return {
    frame: Math.round(frame.height),
    ring: Math.round(ring.width),
    mainScroll: document.querySelector('.motif-cs-main')!.scrollTop,
    pageScroll: document.scrollingElement!.scrollTop,
  };
});

async function drag(page: Page, dy: number) {
  const box = (await page.locator('.motif-cs-map-frame-resize').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  expect(await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.className, [x, y])).toBe('motif-cs-map-frame-resize');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy / 2, { steps: 4 });
  await page.mouse.move(x, y + dy, { steps: 4 });
  await page.mouse.up();
}

/** Where the frame's centre falls on the molecule, in units of the ring's radius or half the axis. */
const centre = (page: Page) => page.evaluate(() => {
  const frame = document.querySelector('.motif-cs-map-frame')!.getBoundingClientRect();
  const b = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
  const unit = b.width / 2;
  return {
    x: (frame.left + frame.width / 2 - (b.left + unit)) / unit,
    y: (frame.top + frame.height / 2 - (b.top + b.height / 2)) / unit,
    unit,
  };
});

test.describe('map frame height', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const mode of ['Circle', 'Line'] as const) {
    test(`${mode} view: a zoomed view keeps its centre as the frame is resized, and ten quick grabs all hold`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(artifactUrl!);
      const tools = page.getByRole('group', { name: 'Map view controls' });
      if (mode === 'Line') await tools.getByRole('button', { name: 'Line', exact: true }).click();
      await expect(page.locator(`.motif-cs-map-frame[data-map-mode="${mode === 'Line' ? 'linear' : 'circular'}"]`)).toBeVisible();
      await tools.getByRole('button', { name: 'Zoom in' }).click();
      await tools.getByRole('button', { name: 'Zoom in' }).click();
      // Off the middle, so a drift has something to show.
      const frame = (await page.locator('.motif-cs-map-frame').boundingBox())!;
      await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await page.mouse.wheel(120, 90);
      await page.waitForTimeout(200);
      const start = await centre(page);
      for (const dy of [-80, 40, -60]) {
        await drag(page, dy);
        await page.waitForTimeout(100);
        const now = await centre(page);
        // Within 2px of the molecule point it started on, at the drawing's new size.
        expect(Math.abs(now.x - start.x) * now.unit).toBeLessThanOrEqual(2);
        expect(Math.abs(now.y - start.y) * now.unit).toBeLessThanOrEqual(2);
      }

      // Ten grabs, each pressed the moment the last one was released.
      for (let grab = 0; grab < 10; grab += 1) {
        const before = (await read(page)).frame;
        await drag(page, -6);
        expect((await read(page)).frame).toBe(before - 6);
      }
    });
  }

  test('Line view: drag, keys, double-click, per-mode memory and reload at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
    expect(await read(page)).toMatchObject({ frame: 748, ring: 551 });
    const tools = page.getByRole('group', { name: 'Map view controls' });
    await tools.getByRole('button', { name: 'Line', exact: true }).click();
    await expect(page.locator('.motif-cs-map-frame[data-map-mode="linear"]')).toBeVisible();
    const separator = page.getByRole('separator', { name: 'Resize map height' });
    await expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
    await expect(separator).toHaveAttribute('aria-valuemin', '160');
    await expect.poll(async () => (await read(page)).frame).toBe(352);
    await expect(separator).toHaveAttribute('aria-valuenow', '352');
    expect(await separator.evaluate((el) => getComputedStyle(el).cursor)).toBe('ns-resize');
    expect(Math.round((await separator.boundingBox())!.height)).toBeGreaterThanOrEqual(8);

    await drag(page, 120);
    await expect.poll(async () => (await read(page)).frame).toBe(472);
    await drag(page, -80);
    await expect.poll(async () => (await read(page)).frame).toBe(392);
    expect(await read(page)).toMatchObject({ mainScroll: 0, pageScroll: 0 });

    await separator.focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await read(page)).frame).toBe(368);
    await page.keyboard.press('Home');
    await expect.poll(async () => (await read(page)).frame).toBe(160);
    await page.keyboard.press('End');
    const max = Number(await separator.getAttribute('aria-valuemax'));
    expect(max).toBeGreaterThan(472);
    await expect.poll(async () => (await read(page)).frame).toBe(max);
    expect(await read(page)).toMatchObject({ mainScroll: 0, pageScroll: 0 });
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await read(page)).frame).toBe(max - 24);

    // Circle keeps its own height; Line's comes back, and survives a reload.
    await tools.getByRole('button', { name: 'Circle', exact: true }).click();
    await expect.poll(async () => (await read(page)).ring).toBe(551);
    expect((await read(page)).frame).toBe(748);
    await tools.getByRole('button', { name: 'Line', exact: true }).click();
    await expect.poll(async () => (await read(page)).frame).toBe(max - 24);
    await page.reload();
    await tools.getByRole('button', { name: 'Line', exact: true }).click();
    await expect.poll(async () => (await read(page)).frame).toBe(max - 24);

    const box = (await separator.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(async () => (await read(page)).frame).toBe(352);
  });

  test('Circle view: the ring re-fits a shorter frame and the default stays reachable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
    await drag(page, 120);
    expect(await read(page)).toMatchObject({ frame: 748, ring: 551, mainScroll: 0 });
    await drag(page, -80);
    await expect.poll(async () => (await read(page)).frame).toBe(668);
    expect((await read(page)).ring).toBeLessThan(551);

    await page.setViewportSize({ width: 700, height: 860 });
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
    await expect.poll(async () => (await read(page)).ring).toBe(377);
    const start = (await read(page)).frame;
    await drag(page, -80);
    await expect.poll(async () => (await read(page)).frame).toBe(start - 80);
    expect((await read(page)).ring).toBeLessThan(377);
    await drag(page, 80);
    await expect.poll(async () => (await read(page)).frame).toBe(start);
    expect(await read(page)).toMatchObject({ ring: 377, mainScroll: 0, pageScroll: 0 });
  });
});
