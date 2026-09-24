import { expect, type Page } from '@playwright/test';

/**
 * Selects a record by its exact name through whichever record control is on
 * screen: its tab while the record tab strip shows (Inventory hidden or
 * floating), or its Inventory row while the strip is hidden beside a docked
 * Inventory. Resolves once the record is active.
 */
export async function selectRecord(page: Page, name: string): Promise<void> {
  const title = JSON.stringify(name);
  const tab = page.locator(`.motif-cs-record-tab[title=${title}]`);
  const row = page.locator(`.motif-cs-inventory-record-row:has(> .motif-cs-row-main > span[title=${title}])`);
  await (await tab.isVisible() ? tab : row).click();
  await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toHaveAttribute('title', name);
}
