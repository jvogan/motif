import { expect, test, type Page } from '@playwright/test';
import { openToolsDrawer, openTranslationFromTools, toolHead, toolPanel, toolsDrawerState } from './tools-drawer';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// The Tools pane's Translation row opens the window the top-bar Translation
// button opens, in the same state, by click and by keyboard, not a second panel with
// the same controls under another layout; below 681px, where that
// button is not in the bar, the row is the way in. Without a DNA or RNA record it is
// disabled, as that button is.
async function openArtifact(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
}

async function windowState(page: Page) {
  const translation = page.getByRole('dialog', { name: 'Translation' });
  await expect(translation).toBeVisible();
  return {
    scope: await translation.getByTestId('translation-scope').textContent(),
    strand: await translation.getByRole('group', { name: 'Strand' }).locator('[aria-pressed="true"]').textContent(),
    frame: await translation.getByRole('group', { name: 'Reading frame' }).locator('[aria-pressed="true"]').textContent(),
    code: await translation.locator('select[name="translation-table"]').inputValue(),
    residues: await translation.locator('.motif-cs-protein-aa').count(),
  };
}

test.describe('the Tools pane Translation row', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const [width, height] of [[1600, 900], [1280, 820], [660, 788]] as const) {
    test(`opens the Translation window by click and by keyboard at ${width}x${height}`, async ({ page }) => {
      await openArtifact(page, width, height);
      const topBarButton = page.getByRole('button', { name: /^Translations window/ });
      const translation = page.getByRole('dialog', { name: 'Translation' });

      // The top-bar button, where the bar has it, sets what the row must match.
      let fromTopBar: Awaited<ReturnType<typeof windowState>> | null = null;
      if (await topBarButton.isVisible()) {
        await topBarButton.click();
        fromTopBar = await windowState(page);
        await topBarButton.click();
        await expect(translation).toHaveCount(0);
      }

      // Click: the window opens and the row opens no panel of its own.
      await openTranslationFromTools(page);
      const fromRow = await windowState(page);
      expect(fromRow.residues).toBeGreaterThan(0);
      if (fromTopBar) expect(fromRow).toEqual(fromTopBar);
      if (await topBarButton.isVisible()) await expect(topBarButton).toHaveAttribute('aria-pressed', 'true');
      await translation.getByRole('button', { name: 'Close Translation' }).click();
      await expect(translation).toHaveCount(0);

      // Keyboard: Enter, then Space, on the focused row.
      for (const key of ['Enter', ' ']) {
        await openToolsDrawer(page);
        const head = toolHead(page, 'translation');
        await head.focus();
        await expect(head).toBeFocused();
        await page.keyboard.press(key);
        expect(await windowState(page)).toEqual(fromRow);
        await expect(toolPanel(page, 'translation')).not.toHaveAttribute('open', '');
        await translation.getByRole('button', { name: 'Close Translation' }).click();
        await expect(translation).toHaveCount(0);
      }
    });
  }

  test('brings the open window forward instead of opening a second one', async ({ page }) => {
    await openArtifact(page, 1600, 900);
    const translation = await openTranslationFromTools(page);
    const head = toolHead(page, 'translation');
    await expect(head).toHaveAttribute('data-workspace-open', 'true');
    await head.click();
    await expect(page.getByRole('dialog', { name: 'Translation' })).toHaveCount(1);
    await expect(translation).toBeFocused();
    await expect(toolPanel(page, 'translation')).not.toHaveAttribute('open', '');
  });

  for (const [width, height] of [[1600, 900], [660, 788]] as const) {
    test(`is disabled with no record open at ${width}x${height}`, async ({ page }) => {
      await openArtifact(page, width, height);
      await page.evaluate(() => window.motifRenderInventory([]));
      await openToolsDrawer(page);
      const head = toolHead(page, 'translation');
      await expect(head).toHaveAttribute('aria-disabled', 'true');
      await expect(head).toHaveAttribute('title', 'Add a DNA or RNA record to enable translations');
      const look = await head.evaluate((element) => ({ opacity: getComputedStyle(element).opacity, cursor: getComputedStyle(element).cursor }));
      expect(look).toEqual({ opacity: '0.62', cursor: 'default' });
      // The test runner treats it as disabled and will not click it; a person still can.
      await head.click({ force: true });
      await head.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Translation' })).toHaveCount(0);
      await expect(toolPanel(page, 'translation')).not.toHaveAttribute('open', '');
      if (width >= 681) await expect(page.getByRole('button', { name: 'Translations unavailable; no active record' })).toBeDisabled();
      if ((await toolsDrawerState(page)) !== null) await expect(page.locator('#motif-cs-tools-pane')).toHaveAttribute('data-tools-drawer', 'open');
    });
  }
});
