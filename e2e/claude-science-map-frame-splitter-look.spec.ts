import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The map frame's bottom splitter looks and behaves like the stacked pane
 * splitter beside it: the same hit height, cursor, grip at rest, hover and
 * focus look, and the same separator contract.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

const look = (handle: Locator) => handle.evaluate((element) => {
  const own = getComputedStyle(element);
  const grip = getComputedStyle(element, '::after');
  return {
    height: Math.round(element.getBoundingClientRect().height * 10) / 10,
    cursor: own.cursor,
    backgroundImage: own.backgroundImage,
    outline: own.outlineStyle,
    grip: [grip.top, grip.width, grip.height, grip.borderRadius, grip.backgroundColor].join(' '),
  };
});

async function separatorContract(handle: Locator) {
  await expect(handle).toHaveAttribute('role', 'separator');
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(handle).toHaveAttribute('tabindex', '0');
  await expect(handle).toHaveAttribute('aria-label', /\S/);
  for (const name of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow']) {
    await expect(handle).toHaveAttribute(name, /^\d+$/);
  }
}

async function open(page: Page) {
  // The stacked sequence splitter shows in the one-column layout.
  await page.setViewportSize({ width: 700, height: 860 });
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
}

test.describe('map frame splitter look', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('the map splitter matches the stacked pane splitter at rest, on hover and on focus', async ({ page }) => {
    await open(page);
    const map = page.locator('.motif-cs-map-frame-resize');
    const pane = page.locator('.motif-cs-stacked-resize-handle[data-pane="sequence"]');
    await expect(map).toBeVisible();
    await expect(pane).toBeVisible();
    await separatorContract(map);
    await separatorContract(pane);
    await expect(map).toHaveAttribute('aria-label', 'Resize map height');

    // At rest: same hit height, cursor and grip; the grip is visible.
    const mapRest = await look(map);
    const paneRest = await look(pane);
    expect(mapRest.height).toBe(9);
    expect(mapRest.height).toBe(paneRest.height);
    expect(mapRest.cursor).toBe('ns-resize');
    expect(mapRest.cursor).toBe(paneRest.cursor);
    expect(mapRest.grip).toBe(paneRest.grip);
    expect(mapRest.grip).not.toMatch(/rgba\(0, 0, 0, 0\)$/);
    // The splitter adds no height: the frame and the ring are as at first open.
    const frame = await page.locator('.motif-cs-map-frame').evaluate((element) => Math.round(element.getBoundingClientRect().height));
    expect(frame).toBe(430);

    // Hover: the grip turns accent.
    const box = (await map.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const mapHover = await look(map);
    expect(mapHover.grip).not.toBe(mapRest.grip);
    await page.mouse.move(5, 855);

    // Keyboard focus: the full-width accent line and the accent grip, the same on both.
    await page.keyboard.press('Shift');
    await map.focus();
    const mapFocus = await look(map);
    await pane.focus();
    const paneFocus = await look(pane);
    expect(mapFocus.backgroundImage).toBe(paneFocus.backgroundImage);
    expect(mapFocus.backgroundImage).toContain('linear-gradient');
    expect(mapFocus.grip).toBe(paneFocus.grip);
    expect(mapFocus.outline).toBe(paneFocus.outline);
    // The sibling lights its grip with one accent rule for hover, focus and drag.
    expect(mapHover.grip).toBe(paneFocus.grip);

    // The same keyboard steps: 24px, and 48px with Shift.
    const frameHeight = () => page.locator('.motif-cs-map-frame').evaluate((element) => Math.round(element.getBoundingClientRect().height));
    await map.focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(frameHeight).toBe(430 - 24);
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(frameHeight).toBe(430 - 72);
    await page.keyboard.press('ArrowDown');
    await expect.poll(frameHeight).toBe(430 - 48);
  });
});
