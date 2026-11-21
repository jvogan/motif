import { expect, test, type Page } from '@playwright/test';

/**
 * Which restriction sites are drawn has one home at a time. While the map is on
 * screen it is the Sites menu in the map header; while the map pane is hidden, the
 * Sequence pane still draws the sites, so the Tools list's Restriction sites entry
 * carries the same menu. The two are never on screen together, and a choice made
 * in one is what the other shows.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

async function openArtifact(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  const pUC19 = page.locator('.motif-cs-record-tab').filter({ hasText: 'pUC19' }).first();
  if ((await pUC19.getAttribute('data-active')) !== 'true') await pUC19.click();
  // Pin the Tools pane, so the Restriction sites entry opens in place.
  const toggle = page.locator('[data-pane-toggle="tools"]');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(page.locator('.motif-cs-main')).toHaveAttribute('data-tools-pinned', 'true');
  // The Sequence pane draws cut-site names in its detail view.
  const detail = page.getByRole('button', { name: 'Show tracks' }).first();
  if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
}

test.describe('the Sites menu in the Tools list', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('appears only while the map pane is hidden and agrees with the map header', async ({ page }) => {
    await openArtifact(page);
    const tool = page.locator('details[data-rail-tool="restriction-sites"]');
    const chip = tool.locator(':scope > summary .motif-cs-chip');
    const menus = page.getByRole('combobox', { name: 'Restriction sites', exact: true });
    const toolMenu = tool.getByRole('combobox', { name: 'Restriction sites', exact: true });
    const sequenceNames = page.locator('.motif-cs-sequence .motif-cs-restriction-label');

    // Map on screen: the header holds the menu, the Tools entry does not.
    await tool.locator(':scope > summary').click();
    await expect(tool).toHaveAttribute('open', '');
    await expect(menus).toHaveCount(1);
    await expect(toolMenu).toHaveCount(0);
    const total = Number((await chip.textContent())!.split('/')[1]);
    expect(total).toBeGreaterThan(0);

    // Map hidden: the Tools entry holds the one menu, on the default Unique.
    await page.getByRole('button', { name: 'Collapse map pane' }).click();
    await expect(page.locator('.motif-cs-main')).toHaveAttribute('data-map-hidden', 'true');
    if (!(await tool.evaluate((details: HTMLDetailsElement) => details.open))) await tool.locator(':scope > summary').click();
    await expect(menus).toHaveCount(1);
    await expect(toolMenu).toHaveValue('unique');
    expect((await toolMenu.boundingBox())!.height).toBe(28);
    const unique = Number((await chip.textContent())!.split('/')[0]);
    expect(unique).toBeLessThan(total);
    const uniqueNames = await sequenceNames.count();

    await toolMenu.selectOption('all');
    await expect(chip).toHaveText(`${total}/${total}`);
    await expect.poll(() => sequenceNames.count()).toBeGreaterThan(uniqueNames);

    await toolMenu.selectOption('none');
    await expect(chip).toHaveText(`0/${total}`);
    await expect(sequenceNames).toHaveCount(0);

    await toolMenu.selectOption('all');
    await expect(chip).toHaveText(`${total}/${total}`);

    // Map back: the header menu says what was picked, and the Tools entry lets go.
    await page.locator('[data-pane-toggle="map"]').click();
    await expect(page.locator('.motif-cs-main')).not.toHaveAttribute('data-map-hidden', 'true');
    await expect(menus).toHaveCount(1);
    await expect(toolMenu).toHaveCount(0);
    await expect(menus).toHaveValue('all');
  });
});
