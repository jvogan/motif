import { expect, test, type Page } from '@playwright/test';

async function openArtifact(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/motif.html');
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
}

test.describe('state-preserving pane placement', () => {
  test('Tools keeps its open workflow draft through pop out, move, resize, and dock', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const toolsToggle = page.locator('[data-pane-toggle="tools"]');
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();

    const tools = page.locator('[data-pane-key="tools"]');
    const notes = tools.locator('details[data-rail-tool="notes"]');
    await notes.locator(':scope > summary').click();
    await notes.locator('.motif-cs-annotation-editor-drawer > summary').click();
    const draftTitle = notes.getByLabel('Title');
    const draftBody = notes.locator('.motif-cs-annotation-editor-drawer textarea');
    await draftTitle.fill('Uncommitted pane draft');
    await draftBody.fill('This stays local while the same Tools subtree changes placement.');

    await tools.getByRole('button', { name: 'Pop out Tools pane' }).click();
    await expect(tools).toHaveAttribute('data-pane-placement', 'floating');
    await expect(notes).toHaveAttribute('open', '');
    await expect(draftTitle).toHaveValue('Uncommitted pane draft');
    const before = await tools.boundingBox();
    expect(before).not.toBeNull();

    const head = tools.locator(':scope > .motif-cs-pane-title');
    const headBox = await head.boundingBox();
    expect(headBox).not.toBeNull();
    await page.mouse.move(headBox!.x + 70, headBox!.y + headBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(headBox!.x + 20, headBox!.y + 55, { steps: 5 });
    await page.mouse.up();
    const moved = await tools.boundingBox();
    expect(moved).not.toBeNull();
    expect(Math.abs(moved!.x - before!.x) + Math.abs(moved!.y - before!.y)).toBeGreaterThan(20);

    const resize = tools.getByTestId('floating-pane-resize-tools');
    const resizeBox = await resize.boundingBox();
    expect(resizeBox).not.toBeNull();
    await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox!.x + 76, resizeBox!.y + 60, { steps: 5 });
    await page.mouse.up();
    const resized = await tools.boundingBox();
    expect(resized).not.toBeNull();
    expect(resized!.width).toBeGreaterThan(moved!.width);
    expect(resized!.height).toBeGreaterThan(moved!.height);

    await tools.getByRole('button', { name: 'Dock Tools pane' }).click();
    await expect(tools).toHaveAttribute('data-pane-placement', 'docked');
    await expect(draftTitle).toHaveValue('Uncommitted pane draft');
    await expect(draftBody).toHaveValue('This stays local while the same Tools subtree changes placement.');
    await expect(tools.getByRole('button', { name: 'Pop out Tools pane' })).toBeFocused();
  });

  test('Escape docks a floating pane and the phone layout uses a bounded sheet', async ({ page }) => {
    await openArtifact(page, 390, 760);
    const inventory = page.locator('[data-pane-key="inventory"]');
    await inventory.getByRole('button', { name: 'Pop out Inventory pane' }).click();
    await expect(inventory).toHaveAttribute('data-pane-placement', 'floating');

    const sheet = await inventory.boundingBox();
    expect(sheet).not.toBeNull();
    expect(sheet!.x).toBeGreaterThanOrEqual(7);
    expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(383);
    expect(sheet!.y).toBeGreaterThan(38);
    expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(753);
    await expect(inventory.getByTestId('floating-pane-resize-inventory')).toBeHidden();

    await inventory.getByRole('button', { name: 'Add entry' }).click();
    const addEntry = inventory.locator('#motif-cs-add-entry');
    await expect(addEntry).toBeVisible();
    const addEntryBox = await addEntry.boundingBox();
    expect(addEntryBox).not.toBeNull();
    expect(addEntryBox!.x).toBeGreaterThanOrEqual(sheet!.x);
    expect(addEntryBox!.x + addEntryBox!.width).toBeLessThanOrEqual(sheet!.x + sheet!.width);

    await inventory.getByRole('button', { name: 'Add entry' }).click();
    await expect(addEntry).toBeHidden();
    await inventory.getByRole('button', { name: 'Dock Inventory pane' }).focus();
    await page.keyboard.press('Escape');
    await expect(inventory).toHaveAttribute('data-pane-placement', 'docked');
    await expect(inventory.getByRole('button', { name: 'Pop out Inventory pane' })).toBeFocused();
  });
});
