import { expect, test, type Page } from '@playwright/test';
import { selectRecord } from './record-selection';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

async function openArtifact(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();
}

test.describe('keyboard reach', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    test(`skip to sequence lands where the arrow keys move the caret at ${width}x${height}`, async ({ page }) => {
      await openArtifact(page, width, height);
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toHaveText('Skip to workspace');
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toHaveText('Skip to sequence');
      await page.keyboard.press('Enter');
      await expect(page.locator(':focus')).toHaveAttribute('id', 'motif-cs-sequence-view');
      await expect(page.locator(':focus')).toHaveAttribute('role', 'textbox');
      await expect(page.locator('#motif-cs-sequence-view')).toBeInViewport();

      await expect(page.locator('.motif-cs-seq-caret')).toHaveCount(0);
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.motif-cs-seq-caret')).toHaveCount(1);
    });
  }

  test('a small circular map gives its "+" tail a 24px target that opens the cluster list', async ({ page }) => {
    await openArtifact(page, 900, 680);
    await selectRecord(page, 'pBR322');
    await expect(page.locator('.motif-pm-restriction-more-hit').first()).toBeAttached();
    const press = await page.evaluate(() => {
      const rect = [...document.querySelectorAll('.motif-pm-restriction-more-hit')]
        .find((candidate) => candidate.closest('.motif-pm-restriction')?.querySelector('[data-label-more]')?.textContent === '+');
      if (!rect) return null;
      const group = rect.closest('.motif-pm-restriction')!;
      const box = rect.getBoundingClientRect();
      const tail = group.querySelector('[data-label-more]')!.getBoundingClientRect();
      // The corner farthest from the drawn tail, so the press misses the glyph.
      const x = Math.abs(box.left - tail.left) > Math.abs(box.right - tail.right) ? box.left + 1.5 : box.right - 1.5;
      const y = Math.abs(box.top - tail.top) > Math.abs(box.bottom - tail.bottom) ? box.top + 1.5 : box.bottom - 1.5;
      return { x, y, width: box.width, height: box.height, tailWidth: tail.width, label: group.querySelector('text')!.textContent };
    });
    expect(press, 'a bare "+" tail with a square on pBR322 at 900x680').not.toBeNull();
    if (!press) return;
    expect(press.label).toMatch(/ \+$/);
    expect(press.tailWidth).toBeLessThan(6);
    expect(press.width).toBeGreaterThanOrEqual(24);
    expect(press.height).toBeGreaterThanOrEqual(24);
    await page.mouse.click(press.x, press.y);
    await expect(page.locator('.motif-cs-map-enzyme-menu')).toBeVisible();
    expect(await page.locator('.motif-cs-map-enzyme-menu-item').count()).toBeGreaterThan(1);
  });

  test('skip to sequence is offered only while the pane shows a record', async ({ page }) => {
    await openArtifact(page);
    const link = page.locator('.motif-cs-skip-link', { hasText: 'Skip to sequence' });
    await expect(link).toHaveCount(1);
    await page.locator('[data-pane-toggle="sequence"]').click();
    await expect(page.locator('[data-pane-key="sequence"]')).toHaveCount(0);
    await expect(link).toHaveCount(0);
    await page.locator('[data-pane-toggle="sequence"]').click();
    await expect(link).toHaveCount(1);
    await page.evaluate(() => window.motifRemoveRecords(window.motifGetInventory().map((record) => record.id)));
    await expect(page.locator('.motif-cs-empty-sequence-state')).toBeVisible();
    await expect(link).toHaveCount(0);
  });
});
