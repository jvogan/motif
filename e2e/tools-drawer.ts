import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers for the Tools pane, which has three shapes:
 *
 * - below 1536px (unpinned, docked) it is a DRAWER: closed it is hidden, opened by
 *   the top-bar "Tools" button, and an open tool replaces the tool list under a
 *   "Back to tools" row;
 * - at 1536px and wider it is the 48px icon RAIL, whose heads are always visible
 *   and whose open tool is a popover;
 * - pinned open, or floating, its heads are visible without any opening step.
 *
 * `#motif-cs-tools-pane[data-tools-drawer]` is `open`, `closed`, or absent
 * (rail, pinned, floating), so each helper works in every shape and a spec does not
 * need to know which width it runs at.
 */

const toolsPaneSelector = '#motif-cs-tools-pane';

/** The `<details>` that holds one tool, by its `data-rail-tool` id (for example `cloning`). */
export function toolPanel(page: Page, tool: string): Locator {
  return page.locator(`details[data-rail-tool="${tool}"]`);
}

/** The tool's head: the row in the drawer list, or the icon in the rail. */
export function toolHead(page: Page, tool: string): Locator {
  return toolPanel(page, tool).locator(':scope > summary');
}

/** The top-bar button that opens and closes the Tools drawer. */
export function toolsDrawerButton(page: Page): Locator {
  return page.locator('[data-pane-toggle="tools"]');
}

/** `open` or `closed` when the Tools pane is a drawer, `null` in any other shape. */
export async function toolsDrawerState(page: Page): Promise<'open' | 'closed' | null> {
  const state = await page.locator(toolsPaneSelector).getAttribute('data-tools-drawer');
  return state === 'open' || state === 'closed' ? state : null;
}

/** Opens the drawer with the top-bar Tools button. Does nothing when it is not a drawer or is already open. */
export async function openToolsDrawer(page: Page): Promise<void> {
  if ((await toolsDrawerState(page)) !== 'closed') return;
  const button = toolsDrawerButton(page);
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(toolsPaneSelector)).toHaveAttribute('data-tools-drawer', 'open');
}

/** Closes the drawer. Does nothing when it is not a drawer or is already closed. */
export async function closeToolsDrawer(page: Page): Promise<void> {
  if ((await toolsDrawerState(page)) !== 'open') return;
  await closeOpenToolPanels(page);
  const button = toolsDrawerButton(page);
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(toolsPaneSelector)).toHaveAttribute('data-tools-drawer', 'closed');
}

/** Sends the open tool back to the tool list with its "Back to tools" control (or its close control outside the drawer). */
async function closeOpenToolPanels(page: Page): Promise<void> {
  const open = page.locator(`${toolsPaneSelector} details[data-rail-tool][open]`);
  if ((await open.count()) === 0) return;
  const close = open.first().locator('[data-testid="rail-popover-close"]').first();
  if (await close.isVisible()) await close.click();
  else await open.first().locator(':scope > summary').click();
  await expect(open).toHaveCount(0);
}

/**
 * Opens one tool and returns its panel. In the drawer this opens the drawer first and
 * sends any other open tool back to the list; in the rail it clicks the head. Idempotent:
 * an open tool stays open.
 */
export async function openTool(page: Page, tool: string): Promise<Locator> {
  const panel = toolPanel(page, tool);
  if ((await panel.getAttribute('open')) !== null && (await panel.isVisible())) return panel;
  await openToolsDrawer(page);
  if ((await toolsDrawerState(page)) === 'open') {
    const other = page.locator(`${toolsPaneSelector} details[data-rail-tool][open]`);
    if ((await other.count()) > 0 && (await other.first().getAttribute('data-rail-tool')) !== tool) {
      await closeOpenToolPanels(page);
    }
  }
  if ((await panel.getAttribute('open')) === null) await panel.locator(':scope > summary').click();
  await expect(panel).toHaveAttribute('open', '');
  return panel;
}

/**
 * Closes one tool. In the drawer that is "Back to tools" (the list returns); elsewhere it is
 * the tool's own close control. Does nothing when the tool is already closed.
 */
export async function closeTool(page: Page, tool: string): Promise<void> {
  const panel = toolPanel(page, tool);
  if ((await panel.getAttribute('open')) === null) return;
  const close = panel.locator('[data-testid="rail-popover-close"]').first();
  if (await close.isVisible()) await close.click();
  else await panel.locator(':scope > summary').click();
  await expect(panel).not.toHaveAttribute('open', '');
}

/**
 * Opens the Translation window from the Tools pane's Translation row, the way in where the
 * top bar has no Translation button (below 681px). The row has no panel of its
 * own: in the drawer it is chosen from the tool list (any other open tool goes back to the
 * list first), in the rail it is the T icon. Returns the window.
 */
export async function openTranslationFromTools(page: Page): Promise<Locator> {
  await openToolsDrawer(page);
  if ((await toolsDrawerState(page)) === 'open') await closeOpenToolPanels(page);
  const head = toolHead(page, 'translation');
  await expect(head).not.toHaveAttribute('aria-disabled', 'true');
  await head.click();
  const translation = page.getByRole('dialog', { name: 'Translation' });
  await expect(translation).toBeVisible();
  await expect(toolPanel(page, 'translation')).not.toHaveAttribute('open', '');
  return translation;
}
