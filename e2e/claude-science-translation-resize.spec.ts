import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// The Translation window docked under the sequence changes its height through
// a separator on its top edge, drawn like the stacked pane separator. It
// follows the pointer 1:1 between a floor that keeps one preview line and clips
// nothing and a ceiling that keeps three whole rows of bases above it. Left alone
// it opens at 247px (167px at 700x860).

async function openDocked(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  // Cleared once per test, so a reload keeps what the test stored.
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('translation-resize-seeded')) return;
    window.localStorage.clear();
    window.sessionStorage.setItem('translation-resize-seeded', '1');
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
  await page.getByRole('button', { name: /Translations window/ }).click();
  await expect(page.locator('.motif-cs-window[data-in-flow]')).toBeVisible();
}

const windowBox = (page: Page) => page.locator('.motif-cs-window[data-in-flow]').evaluate((node) => {
  const rect = node.getBoundingClientRect();
  return { top: rect.top, height: rect.height, bottom: rect.bottom };
});
const windowHeight = async (page: Page) => (await windowBox(page)).height;
const mainScroll = (page: Page) => page.locator('.motif-cs-main').evaluate((node) => node.scrollTop);
// Rows of bases wholly inside the sequence scroller and the viewport.
const rowsShown = (page: Page) => page.evaluate(() => {
  const lines = [...document.querySelectorAll('.motif-cs-sequence-panel .motif-cs-seq-bases[data-line-start]')];
  let scroller = lines[0]?.parentElement ?? null;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  const frame = scroller!.getBoundingClientRect();
  return lines.filter((line) => {
    const rect = line.getBoundingClientRect();
    return rect.top >= frame.top - 0.5 && rect.bottom <= frame.bottom + 0.5 && rect.bottom <= window.innerHeight;
  }).length;
});

// 247: its controls row is 28px.
for (const [width, height, opened] of [[1440, 900, 247], [1280, 820, 247]] as const) {
  test.describe(`docked Translation window height at ${width}x${height}`, () => {
    test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

    test('drags 1:1, steps, stops at its limits, keeps its height and resets', async ({ page }) => {
      await openDocked(page, width, height);
      const handle = page.getByRole('separator', { name: 'Resize Translation window' });
      await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
      await expect(handle).toHaveCSS('cursor', 'ns-resize');
      // Untouched, it opens at its default height, and the separator sits in the
      // gap above it.
      const start = await windowBox(page);
      expect(start.height).toBe(opened);
      const box = (await handle.boundingBox())!;
      expect(box.height).toBe(8);
      expect(box.y + box.height).toBeCloseTo(start.top, 1);
      await expect(handle).toHaveAttribute('aria-valuenow', String(opened));
      const min = Number(await handle.getAttribute('aria-valuemin'));
      const max = Number(await handle.getAttribute('aria-valuemax'));
      expect(min).toBeLessThan(opened - 15);
      expect(max).toBeGreaterThanOrEqual(opened);

      // Down 15px and back up 5px: the edge and the window follow 1:1.
      const x = box.x + Math.min(120, box.width / 3);
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 15, { steps: 3 });
      expect(await windowHeight(page)).toBe(opened - 15);
      expect((await handle.boundingBox())!.y).toBeCloseTo(box.y + 15, 0);
      await page.mouse.move(x, y + 10, { steps: 2 });
      expect(await windowHeight(page)).toBe(opened - 10);
      await page.mouse.up();
      expect((await windowBox(page)).bottom).toBeCloseTo(start.bottom, 1);
      expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
      expect(await page.evaluate(() => document.body.dataset.motifCsTranslationResizing ?? null)).toBeNull();

      // Past either limit it stops there and the workspace never scrolls.
      let at = (await handle.boundingBox())!;
      await page.mouse.move(x, at.y + 4);
      await page.mouse.down();
      await page.mouse.move(x, 4, { steps: 6 });
      await page.mouse.up();
      expect(await windowHeight(page)).toBe(max);
      expect(await mainScroll(page)).toBe(0);
      expect(await rowsShown(page)).toBeGreaterThanOrEqual(3);
      expect((await windowBox(page)).bottom).toBeCloseTo(start.bottom, 1);
      at = (await handle.boundingBox())!;
      await page.mouse.move(x, at.y + 4);
      await page.mouse.down();
      await page.mouse.move(x, height - 4, { steps: 6 });
      await page.mouse.up();
      expect(await windowHeight(page)).toBe(min);
      // The title, the controls and the actions stay whole at the floor.
      const clipped = await page.locator('.motif-cs-window[data-in-flow] .motif-cs-window-body')
        .evaluate((node) => node.scrollHeight - node.clientHeight);
      expect(clipped).toBeLessThanOrEqual(1);

      await handle.focus();
      await page.keyboard.press('End');
      expect(await windowHeight(page)).toBe(max);
      await page.keyboard.press('ArrowDown');
      expect(await windowHeight(page)).toBe(Math.max(min, max - 24));
      await page.keyboard.press('Home');
      expect(await windowHeight(page)).toBe(min);
      await page.keyboard.press('ArrowUp');
      expect(await windowHeight(page)).toBe(Math.min(max, min + 24));
      await page.keyboard.press('Home');

      // Ten quick grabs, alternately 5px up and 5px down, each answer.
      at = (await handle.boundingBox())!;
      await page.mouse.move(x, at.y + 4);
      await page.mouse.down();
      await page.mouse.move(x, at.y - 6, { steps: 2 });
      await page.mouse.up();
      for (let cycle = 0; cycle < 10; cycle += 1) {
        const before = await windowHeight(page);
        const grab = (await handle.boundingBox())!;
        const delta = cycle % 2 ? 5 : -5;
        await page.mouse.move(x, grab.y + 4);
        await page.mouse.down();
        await page.mouse.move(x, grab.y + 4 + delta);
        await page.mouse.up();
        expect(await windowHeight(page)).toBe(before - delta);
      }

      const kept = await windowHeight(page);
      expect(kept).not.toBe(opened);
      await page.reload();
      await page.getByRole('button', { name: /Translations window/ }).click();
      await expect(page.locator('.motif-cs-window[data-in-flow]')).toBeVisible();
      expect(await windowHeight(page)).toBe(kept);

      const again = (await handle.boundingBox())!;
      await page.mouse.dblclick(x, again.y + 4);
      expect(await windowHeight(page)).toBe(opened);
      await expect(handle).toHaveAttribute('aria-valuenow', String(opened));
    });
  });
}

// At 700x860 the window opens at 167px with under 48px between its floor and its
// ceiling, less travel than a splitter needs to be offered, so the separator is not
// offered and a drag where it would be changes nothing.
test.describe('docked Translation window height at 700x860', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  test('opens at 167px and offers no separator with under 48px of travel', async ({ page }) => {
    await openDocked(page, 700, 860);
    const handle = page.locator('.motif-cs-translation-resize-handle');
    expect(await windowHeight(page)).toBe(167);
    const min = Number(await handle.getAttribute('aria-valuemin'));
    const max = Number(await handle.getAttribute('aria-valuemax'));
    expect(max - min).toBeLessThan(48);
    await expect(handle).toHaveAttribute('aria-disabled', 'true');
    await expect(handle).toHaveAttribute('tabindex', '-1');
    expect(await handle.evaluate((element) => [getComputedStyle(element, '::after').display, getComputedStyle(element).pointerEvents]))
      .toEqual(['none', 'none']);
    // The window keeps the height it opened at.
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y - 56, { steps: 6 });
    await page.mouse.up();
    expect(await windowHeight(page)).toBe(167);
  });
});
