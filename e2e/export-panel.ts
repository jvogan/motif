import { expect, type Locator, type Page } from '@playwright/test';

/** The one Export control: the title-row button that opens the Export popover. */
export function exportTitleButton(page: Page): Locator {
  return page.locator('.motif-cs-sequence-title').getByRole('button', { name: 'Export', exact: true });
}

/** Opens the Export popover from the title-row button unless it is open already. */
export async function openExportPanel(page: Page): Promise<Locator> {
  const panel = page.locator('#motif-cs-export-panel');
  // An open <details> reports open as "", which is falsy, so test for null.
  if ((await panel.getAttribute('open')) === null) await exportTitleButton(page).click();
  await expect(panel).toHaveAttribute('open', '');
  return panel;
}
