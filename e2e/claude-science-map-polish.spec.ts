import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

if (process.env.MOTIF_SINGLE_PROCESS_BROWSER === '1') {
  test.use({
    launchOptions: {
      args: ['--single-process', '--no-zygote'],
    },
  });
}

async function openArtifact(page: Page, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  const record = page.locator('.motif-cs-record-tab').filter({ hasText: 'pUC19' }).first();
  if ((await record.getAttribute('data-active')) !== 'true') await record.click();
  await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
}

test.describe('circular map polish', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('uses the system palette in forced-colors mode', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openArtifact(page);

    const colors = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const featureBodies = [...document.querySelectorAll<SVGPathElement>('.motif-pm-feature-body')];
      return {
        canvas: body.backgroundColor,
        canvasText: body.color,
        fills: [...new Set(featureBodies.map((feature) => getComputedStyle(feature).fill))],
        strokes: [...new Set(featureBodies.map((feature) => getComputedStyle(feature).stroke))],
        dashPatterns: [...new Set(featureBodies.map((feature) => getComputedStyle(feature).strokeDasharray))],
      };
    });

    expect(colors.fills).toEqual([colors.canvas]);
    expect(colors.strokes).toEqual([colors.canvasText]);
    expect(colors.dashPatterns.length).toBeGreaterThan(1);
  });
});
