import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// Below 900px the panes stand in one column and the separator under the
// Sequence pane sets its height. Its value is the drawn height, its floor is the
// height the pane opens at when that is under 280 (274 at 700x860), so the first
// drag does not jump to a 280 floor and a 20px drag moves the edge 20px; Home and
// End go to the ends of its range, a double-click restores the opening height,
// and left alone the pane opens at its natural height.

async function openFresh(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  // Cleared once per test, so a reload keeps what the test stored.
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('stacked-resize-seeded')) return;
    window.localStorage.clear();
    window.sessionStorage.setItem('stacked-resize-seeded', '1');
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
}

const paneHeight = (page: Page) => page.locator('.motif-cs-sequence-column').evaluate((node) => node.getBoundingClientRect().height);
const value = async (page: Page, name: string) => Number(await page.getByRole('separator', { name: 'Resize stacked sequence pane' }).getAttribute(name));

for (const [width, height, opened] of [[700, 860, 274], [660, 788, 274], [400, 700, 245]] as const) {
  test.describe(`stacked Sequence pane height at ${width}x${height}`, () => {
    test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

    test('drags 1:1, steps, goes to its limits, keeps its height and resets', async ({ page }) => {
      await openFresh(page, width, height);
      const handle = page.getByRole('separator', { name: 'Resize stacked sequence pane' });
      await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
      await expect(handle).toHaveCSS('cursor', 'ns-resize');
      // Untouched, the pane opens at its natural height, and the separator says so.
      expect(await paneHeight(page)).toBe(opened);
      await expect(handle).toHaveAttribute('aria-valuenow', String(opened));
      expect(await value(page, 'aria-valuemin')).toBeLessThanOrEqual(opened);

      // The edge follows the pointer, down and back up.
      await handle.scrollIntoViewIfNeeded();
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 30, { steps: 3 });
      expect((await handle.boundingBox())!.y - box.y).toBeCloseTo(30, 0);
      await page.mouse.move(x, y + 12, { steps: 3 });
      expect((await handle.boundingBox())!.y - box.y).toBeCloseTo(12, 0);
      await page.mouse.up();
      expect(Math.abs(await paneHeight(page) - (opened + 12))).toBeLessThanOrEqual(1);

      // A quick second grab takes hold every time. The pane is the last in a
      // scrolling column, so its edge sits at the foot of the view: start from
      // the floor with the edge in view and take hold near its top.
      await handle.focus();
      await page.keyboard.press('Home');
      await handle.scrollIntoViewIfNeeded();
      for (let grab = 0; grab < 10; grab += 1) {
        const before = (await handle.boundingBox())!;
        const step = grab % 2 ? -6 : 6;
        await page.mouse.move(before.x + before.width / 2, before.y + 2);
        await page.mouse.down();
        await page.mouse.move(before.x + before.width / 2, before.y + 2 + step);
        await page.mouse.up();
        expect(Math.abs((await handle.boundingBox())!.y - before.y - step)).toBeLessThanOrEqual(1);
      }

      // Arrow keys step; Home and End go to the limits.
      await handle.focus();
      const stepped = await paneHeight(page);
      await page.keyboard.press('ArrowDown');
      expect(await paneHeight(page)).toBeCloseTo(stepped + 24, 0);
      await page.keyboard.press('Home');
      const min = await value(page, 'aria-valuemin');
      await expect(handle).toHaveAttribute('aria-valuenow', String(min));
      expect(await paneHeight(page)).toBe(min);
      await page.keyboard.press('End');
      const max = await value(page, 'aria-valuemax');
      await expect(handle).toHaveAttribute('aria-valuenow', String(max));
      expect(await paneHeight(page)).toBe(max);

      // The height survives a reload.
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      const kept = await paneHeight(page);
      expect(kept).toBe(min + 48);
      await page.waitForTimeout(400);
      await page.reload();
      await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
      await expect.poll(() => paneHeight(page)).toBe(kept);

      // A double-click puts the pane back where it opened.
      await handle.scrollIntoViewIfNeeded();
      const end = (await handle.boundingBox())!;
      await page.mouse.dblclick(end.x + end.width / 2, end.y + end.height / 2);
      await expect.poll(() => paneHeight(page)).toBe(opened);
      await expect(handle).toHaveAttribute('aria-valuenow', String(opened));
    });
  });
}
