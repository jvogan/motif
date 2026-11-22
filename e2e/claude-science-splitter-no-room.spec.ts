import { expect, test, type Locator } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// A splitter with under 48px of travel is not offered. At 700x860 with an ORF
// picked in the Tools drawer, the docked Translation window has no room either
// way, so its separator is aria-disabled, shows no grip and takes no Tab stop.
// The map frame splitter beside it keeps both.
const grip = (handle: Locator) => handle.evaluate((element) => {
  const after = getComputedStyle(element, '::after');
  return { shown: after.display !== 'none' && after.content !== 'none', pointer: getComputedStyle(element).pointerEvents };
});

test.describe('a splitter with no room is not offered', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  test('the Translation separator drops its grip and Tab stop at 700x860; the map splitter keeps both', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 860 });
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const orf = page.locator('.motif-cs-orf-select').first();
    if (!(await orf.isVisible())) await page.getByRole('button', { name: 'Analysis', exact: true }).click();
    await orf.click();
    const toggle = page.getByRole('button', { name: /Translations window/ });
    if (!(await page.locator('.motif-cs-window[data-in-flow]').isVisible())) await toggle.click();
    await expect(page.locator('.motif-cs-window[data-in-flow]')).toBeVisible();

    const translation = page.locator('.motif-cs-translation-resize-handle');
    await expect.poll(async () => {
      const min = Number(await translation.getAttribute('aria-valuemin'));
      const max = Number(await translation.getAttribute('aria-valuemax'));
      return max - min;
    }).toBeLessThan(48);
    await expect(translation).toHaveAttribute('aria-disabled', 'true');
    await expect(translation).toHaveAttribute('tabindex', '-1');
    expect(await grip(translation)).toEqual({ shown: false, pointer: 'none' });

    const map = page.locator('.motif-cs-map-frame-resize');
    await expect(map).toHaveAttribute('tabindex', '0');
    await expect(map).not.toHaveAttribute('aria-disabled', 'true');
    expect(await grip(map)).toEqual({ shown: true, pointer: 'auto' });
  });
});
