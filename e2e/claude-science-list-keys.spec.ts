import { expect, test, type Page } from '@playwright/test';
import { toolHead, toolsDrawerButton, toolsDrawerState } from './tools-drawer';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

async function open(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await page.waitForFunction(() => typeof window.motifReplaceWorkspace === 'function');
  await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();
}

const activeLabel = (page: Page) => page.evaluate(() => {
  const element = document.activeElement as HTMLElement | null;
  return (element?.getAttribute('aria-label') || element?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
});

/** The names of the visible tool heads, top to bottom. */
const visibleHeadNames = (page: Page) => page.evaluate(() => (
  [...document.querySelectorAll<HTMLElement>('.motif-cs-inspector summary.motif-cs-panel-head')]
    .filter((head) => head.checkVisibility())
    .map((head) => (head.getAttribute('aria-label') || head.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40))
));

test.describe('arrow keys in the tool list and the Export popover', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  for (const width of [700, 1600]) {
    test(`Up, Down, Home and End move through the tool list at ${width}px`, async ({ page }) => {
      await open(page, width);
      if (width < 1536) {
        await toolsDrawerButton(page).click();
        await expect.poll(() => toolsDrawerState(page)).toBe('open');
      }
      const names = await visibleHeadNames(page);
      expect(names.length, 'the tool list has rows to move through').toBeGreaterThan(8);

      await toolHead(page, 'annotations').focus();
      const start = names.findIndex((name) => name.startsWith('Annotations'));
      expect(start).toBeGreaterThanOrEqual(0);

      await page.keyboard.press('ArrowDown');
      expect(await activeLabel(page)).toBe(names[start + 1]);
      await page.keyboard.press('ArrowUp');
      expect(await activeLabel(page)).toBe(names[start]);
      await page.keyboard.press('End');
      expect(await activeLabel(page)).toBe(names[names.length - 1]);
      await page.keyboard.press('ArrowDown');
      expect(await activeLabel(page), 'Down from the last row wraps to the first').toBe(names[0]);
      await page.keyboard.press('ArrowUp');
      expect(await activeLabel(page), 'Up from the first row wraps to the last').toBe(names[names.length - 1]);
      await page.keyboard.press('Home');
      expect(await activeLabel(page)).toBe(names[0]);
    });
  }

  test('Enter opens the focused tool and Escape closes the drawer back onto the Tools button', async ({ page }) => {
    await open(page, 700);
    await toolsDrawerButton(page).click();
    await toolHead(page, 'annotations').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    // Down from Annotations reaches Notes, and Enter opens that one.
    await expect(page.locator('.motif-cs-inspector details[data-rail-tool="notes"][open]')).toHaveCount(1);
    await expect(page.locator('.motif-cs-inspector details[name="motif-cs-tools"][open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect.poll(() => toolsDrawerState(page)).toBe('closed');
    await expect(toolsDrawerButton(page)).toBeFocused();
  });

  test('arrows, Home and End step through the Export popover; Enter presses a button; Escape returns to Export', async ({ page }) => {
    await open(page, 700);
    const exportButton = page.locator('.motif-cs-title-row').getByRole('button', { name: 'Export', exact: true });
    await exportButton.click();
    const popover = page.getByRole('region', { name: 'Export' });
    await expect(popover).toBeVisible();

    const buttons = await popover.evaluate((root) => (
      [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].map((button) => (button.getAttribute('aria-label') || button.textContent || '').trim())
    ));
    expect(buttons.length, 'the popover has several enabled buttons').toBeGreaterThan(5);

    await page.keyboard.press('Home');
    expect(await activeLabel(page)).toBe(buttons[0]);
    await page.keyboard.press('ArrowDown');
    expect(await activeLabel(page)).toBe(buttons[1]);
    await page.keyboard.press('ArrowDown');
    expect(await activeLabel(page)).toBe(buttons[2]);
    await page.keyboard.press('ArrowUp');
    expect(await activeLabel(page)).toBe(buttons[1]);
    await page.keyboard.press('End');
    expect(await activeLabel(page)).toBe(buttons[buttons.length - 1]);
    await page.keyboard.press('ArrowDown');
    expect(await activeLabel(page), 'Down from the last button wraps to the first').toBe(buttons[0]);

    // The Format select keeps its own arrow keys: Down stays with the select (the browser may
    // change its value or open its list) instead of moving focus to the next button.
    const format = popover.locator('select[name="export-format"]');
    await format.focus();
    await page.keyboard.press('ArrowDown');
    await expect(format).toBeFocused();

    // Enter presses the focused button: Close export shuts the popover and returns to Export.
    await popover.getByRole('button', { name: 'Close export' }).focus();
    await page.keyboard.press('Enter');
    await expect(popover).toHaveCount(0);
    await expect(exportButton).toBeFocused();

    // Escape does the same from anywhere inside it.
    await exportButton.click();
    await expect(popover).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(exportButton).toBeFocused();
  });

  for (const width of [700, 1440]) {
    test(`Down and Enter in the Records filter reach the list, and Up from the first row or Escape go back at ${width}px`, async ({ page }) => {
      await open(page, width);
      // Below 900px the Records pane starts hidden.
      const toggle = page.locator('[data-pane-toggle="inventory"]');
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      const filter = page.getByRole('textbox', { name: 'Filter records' });
      const rows = page.locator('.motif-cs-inventory-record-row');
      const openRow = page.locator('.motif-cs-inventory-record-row[aria-current="true"]');
      const openName = () => openRow.locator('span[title]').first().getAttribute('title');
      const startName = await openName();
      expect(startName, 'a record is open').toBeTruthy();

      // Down lands on the open record's row without changing which record is open.
      await filter.focus();
      await page.keyboard.press('ArrowDown');
      await expect(openRow).toBeFocused();
      expect(await openName()).toBe(startName);
      // Escape goes back to the filter, and the open record stays.
      await page.keyboard.press('Escape');
      await expect(filter).toBeFocused();
      expect(await openName()).toBe(startName);

      // With the open record filtered out, Enter lands on the first row left; Enter there opens it.
      await filter.fill('pET-28');
      await expect(openRow).toHaveCount(0);
      const firstName = await rows.first().locator('span[title]').first().getAttribute('title');
      await page.keyboard.press('Enter');
      await expect(rows.first()).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(rows.first()).toHaveAttribute('aria-current', 'true');
      expect(await openName()).toBe(firstName);
      // Down steps (and opens); Up from the first row returns to the filter.
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(1)).toBeFocused();
      await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
      await page.keyboard.press('Home');
      await expect(rows.first()).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(filter).toBeFocused();
      await expect(filter).toHaveValue('pET-28');
      // The filter's tooltip names the keys.
      await expect(filter).toHaveAttribute('title', /Down arrow or Enter/);
    });
  }

  test('Escape in the Records filter clears the typed text and keeps the keyboard in the field and the selection', async ({ page }) => {
    await open(page, 1440);
    const toggle = page.locator('[data-pane-toggle="inventory"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    const filter = page.getByRole('textbox', { name: 'Filter records' });
    const rows = page.locator('.motif-cs-inventory-record-row');
    const all = await rows.count();
    // A selection in the sequence that a page-level Escape would clear.
    await page.locator('#motif-cs-sequence-view').focus();
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+a`);
    const name = page.locator('.motif-cs-selection-name');
    await expect(name).toHaveText(/^1–/);
    const selected = await name.textContent();
    const box = (await filter.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.type('pET');
    await expect.poll(() => rows.count()).toBeLessThan(all);
    await page.keyboard.press('Escape');
    await expect(filter, 'Escape cleared the filter').toHaveValue('');
    await expect(filter, 'the keyboard stays in the filter').toBeFocused();
    await expect.poll(() => rows.count(), 'every record is listed again').toBe(all);
    await expect(name, 'the clearing Escape left the sequence selection alone').toHaveText(selected!);
    // Typing again filters again from the same field.
    await page.keyboard.type('pUC');
    await expect(filter).toHaveValue('pUC');
  });

  test('Find bar tooltips name Enter, Cmd/Ctrl+G, F3 and Escape', async ({ page }) => {
    await open(page, 700);
    await page.keyboard.press('Control+f');
    const search = page.getByRole('searchbox', { name: 'Find in sequence' });
    await expect(search).toBeFocused();
    // Two or more matches: with one the arrows are off and say "Only one match".
    await search.fill('GCGC');
    await expect(page.getByRole('button', { name: 'Next match' })).toHaveAttribute('title', /Enter, Cmd\/Ctrl\+G or F3/);
    await expect(page.getByRole('button', { name: 'Previous match' })).toHaveAttribute('title', /Shift\+Enter or Shift\+Cmd\/Ctrl\+G/);
    await expect(page.locator('.motif-cs-find-done')).toHaveAttribute('title', /Escape/);
  });
});
