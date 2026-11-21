import { expect, type Page } from '@playwright/test';
import { closeTool, openTool, toolsDrawerButton, toolsDrawerState } from './tools-drawer';

/** Opens or closes the Tools drawer from the keyboard, so a window over the top bar cannot block it. */
async function setToolsDrawer(page: Page, state: 'open' | 'closed'): Promise<void> {
  if ((await toolsDrawerState(page)) !== (state === 'open' ? 'closed' : 'open')) return;
  const button = toolsDrawerButton(page);
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#motif-cs-tools-pane')).toHaveAttribute('data-tools-drawer', state);
}

/**
 * Chooses Light or Dark explicitly in Settings > Appearance in the Tools pane (the top-bar
 * icon only flips to the other theme). What the Tools pane showed before is put back
 * afterwards (a closed drawer, or the tool that was open), so a spec can switch theme in
 * the middle of a workflow and carry on where it was. The drawer is opened and closed with
 * the keyboard on the top-bar Tools button, which a workspace window dragged over the top
 * bar does not block.
 */
export async function chooseTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const drawerBefore = await toolsDrawerState(page);
  const toolBefore = await page.evaluate(
    () => document.querySelector<HTMLElement>('details[data-rail-tool][open]')?.dataset.railTool ?? null,
  );
  await setToolsDrawer(page, 'open');
  const settings = await openTool(page, 'settings');
  const choice = settings.locator(`label[data-theme-choice="${theme}"]`);
  await choice.click();
  await expect(choice.locator('input[type="radio"][name="settings-theme"]')).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  if (toolBefore === 'settings') return;
  if (toolBefore) await openTool(page, toolBefore);
  else await closeTool(page, 'settings');
  if (drawerBefore === 'closed') await setToolsDrawer(page, 'closed');
}
