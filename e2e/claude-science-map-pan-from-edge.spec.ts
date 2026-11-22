import { expect, test, type Page } from '@playwright/test';

/**
 * The hand pans (middle button, Space held, the hand toggle) pan from anywhere in the
 * Line frame at any pointer speed. A pan begun in the blank strip under the line, above
 * the frame's resize grip, keeps panning when its first move is large. A plain drag
 * there selects and never pans.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

const viewport = (page: Page) => page.evaluate(() => {
  const t = document.querySelector('.motif-pm-viewport')?.getAttribute('transform') ?? '';
  const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)\s*scale\(([-\d.e]+)\)/.exec(t);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 1];
});

const openZoomedLine = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(artifactUrl!);
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  await zoomIn.click();
  await zoomIn.click();
  return (await page.locator('.motif-cs-map-frame .motif-pm-container').boundingBox())!;
};

/** Ten starts along the strip at the surface's foot, each dragged 120 px down and across. */
const starts = (box: { x: number; y: number; width: number; height: number }) => Array.from({ length: 10 }, (_, i) => ({
  x: box.x + 60 + ((box.width - 120) * i) / 9,
  y: box.y + box.height - 8 - (i % 5) * 9,
  dir: i % 2 ? -1 : 1,
}));

test.describe('a hand pan starts anywhere in the Line frame', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const how of ['middle', 'space', 'hand'] as const) {
    test(`a ${how} pan from the blank strip pans at 2 to 40 px per event`, async ({ page }) => {
      const box = await openZoomedLine(page);
      if (how === 'hand') await page.getByRole('button', { name: 'Pan by dragging' }).click();
      for (const speed of [2, 17, 40]) {
        for (const { x, y, dir } of starts(box)) {
          const before = await viewport(page);
          await page.mouse.move(x, y);
          if (how === 'middle') await page.mouse.down({ button: 'middle' });
          else {
            if (how === 'space') await page.keyboard.down('Space');
            await page.mouse.down();
          }
          await page.mouse.move(x + dir * 96, y + 72, { steps: Math.round(120 / speed) });
          if (how === 'middle') await page.mouse.up({ button: 'middle' });
          else {
            await page.mouse.up();
            if (how === 'space') await page.keyboard.up('Space');
          }
          const after = await viewport(page);
          expect(Math.hypot(after[0] - before[0], after[1] - before[1]), `${how} at ${speed} px per event from ${Math.round(x)},${Math.round(y)}`).toBeGreaterThan(5);
        }
      }
    });
  }

  test('a plain drag from the blank strip selects and does not pan', async ({ page }) => {
    const box = await openZoomedLine(page);
    for (const { x, y, dir } of starts(box).slice(0, 4)) {
      const before = await viewport(page);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dir * 96, y + 72, { steps: 3 });
      await page.mouse.up();
      await expect(page.locator('.motif-cs-map-selection-line')).toContainText('bp');
      expect(await viewport(page)).toEqual(before);
      await page.keyboard.press('Escape');
    }
  });
});
