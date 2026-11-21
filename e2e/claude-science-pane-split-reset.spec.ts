import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// The Records | Sequence and Sequence | Map separators drag 1:1, Home and End
// take the separator's value to its limits, and a double-click puts both panes
// back at the widths they open at.

async function openFresh(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
}

const paneWidths = (page: Page) => page.evaluate(() => Object.fromEntries(
  ['inventory', 'sequence', 'map'].map((key) => {
    const pane = document.querySelector(`[data-pane-key="${key}"]`);
    return [key, pane ? Math.round(pane.getBoundingClientRect().width * 10) / 10 : null];
  }),
));

for (const [width, height] of [[1440, 900], [1280, 820]] as const) {
  for (const name of ['Resize library pane', 'Resize sequence and map panes']) {
    test(`${name} at ${width}x${height}: steps, goes to its limits and resets on double-click`, async ({ page }) => {
      test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');
      await openFresh(page, width, height);
      const handle = page.getByRole('separator', { name });
      await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
      await expect(handle).toHaveCSS('cursor', 'col-resize');
      const opened = await paneWidths(page);
      const openedValue = await handle.getAttribute('aria-valuenow');

      // Dragging still tracks the pointer.
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2, { steps: 3 });
      await page.mouse.up();
      expect((await handle.boundingBox())!.x - box.x).toBeCloseTo(-20, 0);

      // Arrow keys step; Home and End go to the limits the separator reports.
      await handle.focus();
      const before = Number(await handle.getAttribute('aria-valuenow'));
      await page.keyboard.press('ArrowRight');
      expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
      await page.keyboard.press('Home');
      await expect(handle).toHaveAttribute('aria-valuenow', (await handle.getAttribute('aria-valuemin'))!);
      await page.keyboard.press('End');
      await expect(handle).toHaveAttribute('aria-valuenow', (await handle.getAttribute('aria-valuemax'))!);
      expect(Number(await handle.getAttribute('aria-valuemax'))).toBeGreaterThan(Number(await handle.getAttribute('aria-valuemin')));

      // A double-click restores the split the workspace opened with.
      const end = (await handle.boundingBox())!;
      await page.mouse.dblclick(end.x + end.width / 2, end.y + end.height / 2);
      await expect.poll(() => paneWidths(page)).toEqual(opened);
      await expect(handle).toHaveAttribute('aria-valuenow', openedValue!);
    });
  }
}
