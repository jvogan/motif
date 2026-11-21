import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// A right-click in the Sequence pane opens the workbench's own menu for what is
// selected, the keyboard opens the same menu with Shift+F10 or the Menu key, and
// every item is an action the workbench already has. Real pointer and key input.

const MAC = process.platform === 'darwin';
const MOD = MAC ? 'Meta' : 'Control';

const BASE_CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
const SEQUENCE = BASE_CHUNK.repeat(4).slice(0, 360);
const PAIR: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
const reverseComplement = (bases: string) => [...bases].reverse().map((base) => PAIR[base]).join('');

async function openRecord(page: Page, width = 700, shape: { topology?: 'linear' | 'circular'; annotations?: unknown[] } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await page.evaluate(({ record }) => window.motifRenderInventory([record]), {
    record: {
      id: 'menu-record',
      name: 'Menu record',
      molecule: 'dna',
      topology: shape.topology ?? 'linear',
      seq: SEQUENCE,
      annotations: shape.annotations ?? [
        { id: 'f-primer', name: 'primer site', type: 'primer_bind', start: 40, end: 60, strand: 1, color: '#2f9e6f' },
      ],
    },
  });
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
  // Record whether the page cancelled each contextmenu event, after every handler ran.
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { __contextMenus: boolean[] }).__contextMenus = seen;
    window.addEventListener('contextmenu', (event) => {
      window.setTimeout(() => seen.push(event.defaultPrevented), 0);
    }, true);
  });
}

// The centre of base `index` (0-based) as drawn, measured from the glyph text itself.
async function basePoint(page: Page, index: number): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((target) => {
    const rows = [...document.querySelectorAll<HTMLElement>('#motif-cs-sequence-view .motif-cs-seq-bases')];
    const row = rows.find((candidate) => {
      const start = Number(candidate.dataset.lineStart);
      return target >= start && target < start + Number(candidate.dataset.lineLen);
    });
    const text = row?.querySelector('.motif-cs-seq-glyphs')?.firstChild;
    if (!row || !text) return null;
    const offset = target - Number(row.dataset.lineStart);
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, index);
  expect(point, `base ${index} is drawn`).not.toBeNull();
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.motif-cs-seq-bases') !== null, point!);
  expect(hit, `the pointer is over base ${index}`).toBe(true);
  return point!;
}

async function clickBase(page: Page, index: number, options: { shift?: boolean; button?: 'left' | 'right' } = {}) {
  const point = await basePoint(page, index);
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y, { button: options.button ?? 'left' });
  if (options.shift) await page.keyboard.up('Shift');
  return point;
}

async function selectRange(page: Page, first: number, last: number) {
  await clickBase(page, first);
  await clickBase(page, last, { shift: true });
}

async function showTracks(page: Page) {
  const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
  if ((await tracks.getAttribute('aria-pressed')) !== 'true') await tracks.click();
  await expect(page.locator('.motif-cs-feature-block').first()).toBeVisible();
}

// A screen point that hits the map feature with this id: walk its outline and keep
// the first point, nudged inwards, whose hit test lands inside the feature.
async function mapFeaturePoint(page: Page, featureId: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((id) => {
    const group = document.querySelector(`[data-map-interaction-surface] .motif-pm-feature[data-feature-id="${id}"]`);
    if (!group) return null;
    for (const path of group.querySelectorAll<SVGPathElement>('path')) {
      const length = path.getTotalLength();
      const matrix = path.getScreenCTM();
      if (!matrix || length === 0) continue;
      const outline = Array.from({ length: 40 }, (_, i) => {
        const p = path.getPointAtLength((length * (i + 1)) / 41);
        return { x: p.x * matrix.a + p.y * matrix.c + matrix.e, y: p.x * matrix.b + p.y * matrix.d + matrix.f };
      });
      for (let k = 0; k < outline.length; k++) {
        const across = outline[(k + outline.length / 2) % outline.length];
        for (const t of [0.5, 0.35, 0.2]) {
          const x = outline[k].x + (across.x - outline[k].x) * t;
          const y = outline[k].y + (across.y - outline[k].y) * t;
          if (group.contains(document.elementFromPoint(x, y))) return { x, y };
        }
      }
    }
    return null;
  }, featureId);
  expect(point, `a point on map feature ${featureId}`).not.toBeNull();
  return point!;
}

const menu = (page: Page) => page.getByRole('menu', { name: 'Sequence actions' });
const featureMenu = (page: Page) => page.getByRole('menu', { name: 'Feature actions' });
const label = (page: Page) => page.locator('.motif-cs-selection-name');
const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const focusedFeature = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-feature-id]')?.getAttribute('data-feature-id') ?? null);
const focusedItem = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-context-action') ?? null);
const contextMenusCancelled = (page: Page) => page.evaluate(() => (window as unknown as { __contextMenus: boolean[] }).__contextMenus);

test.describe('Sequence context menu', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const diagnostics = new WeakMap<Page, string[]>();
  test.beforeEach(({ page }) => {
    const seen: string[] = [];
    diagnostics.set(page, seen);
    page.on('pageerror', (error) => seen.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') seen.push(`console.error: ${message.text()}`);
    });
  });
  test.afterEach(({ page }) => {
    expect(diagnostics.get(page) ?? []).toEqual([]);
  });

  test('a right-click on a selected range opens the menu under the clicked row at the pointer; Escape closes it, keeps the range and returns focus to the sequence', async ({ page }) => {
    await openRecord(page);
    await selectRange(page, 100, 119);
    await expect(label(page)).toHaveText(/^101–120 · 20 bp/);
    const point = await clickBase(page, 110, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    expect(await contextMenusCancelled(page), 'the page handled the right-click').toEqual([true]);
    const box = (await menu(page).boundingBox())!;
    // It opens at the pointer's x and under the clicked row, so it covers none of the row.
    const row = await page.evaluate(({ y }) => {
      const line = [...document.querySelectorAll<HTMLElement>('#motif-cs-sequence-view .motif-cs-seq-line')]
        .map((element) => element.getBoundingClientRect())
        .find((rect) => rect.top <= y && rect.bottom >= y)!;
      return { top: line.top, bottom: line.bottom };
    }, point);
    expect(Math.abs(box.x - point.x), 'the menu opens at the pointer\'s x').toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - row.bottom), 'the menu opens under the clicked row').toBeLessThanOrEqual(1);
    await expect(menu(page).getByRole('menuitem')).toHaveText(['Copy' + (MAC ? '⌘C' : 'Ctrl+C'), 'Copy reverse complement', 'Translate', 'Add feature']);
    await expect(menu(page).getByRole('menuitem', { name: 'Copy', exact: true })).toHaveAttribute('aria-keyshortcuts', MAC ? 'Meta+C' : 'Control+C');
    await expect(label(page), 'the right-click kept the range').toHaveText(/^101–120 · 20 bp/);
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(label(page), 'Escape closed the menu, not the selection').toHaveText(/^101–120 · 20 bp/);
    await expect(page.locator('#motif-cs-sequence-view')).toBeFocused();
  });

  test('Copy and Copy reverse complement put the selected bases on the clipboard', async ({ page }) => {
    await openRecord(page);
    await selectRange(page, 100, 119);
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await clickBase(page, 105, { button: 'right' });
    await menu(page).getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await expect(menu(page)).toHaveCount(0);
    await expect.poll(() => clipboardText(page)).toBe(SEQUENCE.slice(100, 120));
    await expect(page.locator('#motif-cs-sequence-view'), 'an item hands focus back to the sequence').toBeFocused();
    await clickBase(page, 105, { button: 'right' });
    await menu(page).getByRole('menuitem', { name: 'Copy reverse complement' }).click();
    await expect.poll(() => clipboardText(page)).toBe(reverseComplement(SEQUENCE.slice(100, 120)));
    await expect(label(page)).toHaveText(/^101–120 · 20 bp/);
  });

  test('Copy keeps a reverse-strand feature in its own orientation and Copy reverse complement flips it; both take a range across the origin of a circular record', async ({ page }) => {
    await openRecord(page, 700, {
      topology: 'circular',
      annotations: [{ id: 'f-reverse', name: 'reverse site', type: 'misc_feature', start: 150, end: 170, strand: -1, color: '#9e2f6f' }],
    });
    await showTracks(page);
    const bar = page.locator('.motif-cs-feature-block').filter({ hasText: 'reverse site' }).first();
    const box = (await bar.boundingBox())!;
    const onBar = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.mouse.click(onBar.x, onBar.y, { button: 'right' });
    await featureMenu(page).getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await expect.poll(() => clipboardText(page), 'Copy takes the feature 5′ to 3′ on its own strand, as Cmd/Ctrl+C does').toBe(reverseComplement(SEQUENCE.slice(150, 170)));
    await page.mouse.click(onBar.x, onBar.y, { button: 'right' });
    await featureMenu(page).getByRole('menuitem', { name: 'Copy reverse complement' }).click();
    await expect.poll(() => clipboardText(page)).toBe(SEQUENCE.slice(150, 170));

    // Find selects a match that runs from the last six bases across the origin into the first six.
    const across = SEQUENCE.slice(-6) + SEQUENCE.slice(0, 6);
    await page.locator('#motif-cs-sequence-view').focus();
    await page.keyboard.press(`${MOD}+f`);
    await page.keyboard.type(across);
    await page.keyboard.press('Enter');
    await expect(label(page)).toContainText('across the origin');
    await clickBase(page, SEQUENCE.length - 3, { button: 'right' });
    await menu(page).getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await expect.poll(() => clipboardText(page)).toBe(across);
    await clickBase(page, SEQUENCE.length - 3, { button: 'right' });
    await menu(page).getByRole('menuitem', { name: 'Copy reverse complement' }).click();
    await expect.poll(() => clipboardText(page)).toBe(reverseComplement(across));
  });

  test('Shift+F10 and the Menu key open the menu from the keyboard; arrows, Home and End move, Enter runs the item', async ({ page }) => {
    await openRecord(page);
    await selectRange(page, 100, 119);
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    expect(await focusedItem(page)).toBe('copy');
    await page.keyboard.press('ArrowDown');
    expect(await focusedItem(page)).toBe('copy-reverse-complement');
    await page.keyboard.press('End');
    expect(await focusedItem(page)).toBe('add-feature');
    await page.keyboard.press('ArrowDown');
    expect(await focusedItem(page), 'ArrowDown on the last item wraps to the first').toBe('copy');
    await page.keyboard.press('ArrowUp');
    expect(await focusedItem(page), 'ArrowUp on the first item wraps to the last').toBe('add-feature');
    await page.keyboard.press('Home');
    expect(await focusedItem(page)).toBe('copy');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator('#motif-cs-sequence-view')).toBeFocused();
    await expect(label(page)).toHaveText(/^101–120 · 20 bp/);
    // The menu opens beside the selection, inside the sequence view.
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.keyboard.press('ContextMenu');
    await expect(menu(page)).toBeVisible();
    const [menuBox, viewBox] = [await menu(page).boundingBox(), await page.locator('#motif-cs-sequence-view').boundingBox()];
    expect(menuBox!.y).toBeGreaterThanOrEqual(viewBox!.y);
    expect(menuBox!.y).toBeLessThan(viewBox!.y + viewBox!.height);
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveCount(0);
    await expect.poll(() => clipboardText(page)).toBe(SEQUENCE.slice(100, 120));
    await expect(page.locator('#motif-cs-sequence-view')).toBeFocused();
  });

  test('a right-click on a base with nothing selected places the caret there; an item that cannot run says why and does nothing', async ({ page }) => {
    await openRecord(page);
    await clickBase(page, 30);
    await clickBase(page, 50, { button: 'right' });
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText('Caret 51');
    const copy = menu(page).getByRole('menuitem', { name: 'Copy', exact: true });
    await expect(copy).toHaveAttribute('aria-disabled', 'true');
    await expect(copy).toHaveAttribute('title', 'Select a range or feature to copy');
    await expect(menu(page).getByRole('menuitem', { name: 'Add feature' })).toHaveAttribute('title', 'Drag a range to add a feature');
    await expect(menu(page).getByRole('menuitem', { name: 'Translate' })).not.toHaveAttribute('aria-disabled', 'true');
    await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
    // A real press on the item: the locator's click refuses an aria-disabled target.
    const copyBox = (await copy.boundingBox())!;
    await page.mouse.click(copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2);
    await expect(menu(page), 'a disabled item leaves the menu open').toBeVisible();
    expect(await clipboardText(page)).toBe('unchanged');
  });

  test('a right-click on a base outside the selection moves the caret there first and the menu acts on that place; inside, the selection stays', async ({ page }) => {
    await openRecord(page);
    await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
    // A range: a right-click inside keeps it, one outside drops it for the caret.
    await selectRange(page, 100, 119);
    await clickBase(page, 105, { button: 'right' });
    await expect(label(page), 'inside the range the selection stays').toHaveText(/^101–120 · 20 bp/);
    await page.keyboard.press('Escape');
    await clickBase(page, 150, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    await expect(page.locator('.motif-cs-edit-hint'), 'the caret moved to the clicked base').toHaveText('Caret 151');
    await expect(page.locator('.motif-cs-selection-name').filter({ hasText: '101–120' }), 'the old range is gone').toHaveCount(0);
    const copy = menu(page).getByRole('menuitem', { name: 'Copy', exact: true });
    await expect(copy, 'the menu acts on the caret, not the old range').toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    expect(await clipboardText(page)).toBe('unchanged');
    // A feature: a right-click on one of its bases keeps it, one outside places the caret.
    await showTracks(page);
    const bar = page.locator('.motif-cs-feature-block').filter({ hasText: 'primer site' }).first();
    const barBox = (await bar.boundingBox())!;
    await page.mouse.click(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    await expect(label(page)).toContainText('primer site');
    await clickBase(page, 50, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    await expect(label(page), 'inside the feature the selection stays').toContainText('primer site');
    await page.keyboard.press('Escape');
    await clickBase(page, 200, { button: 'right' });
    await expect(page.locator('.motif-cs-edit-hint'), 'outside the feature the caret moved').toHaveText('Caret 201');
    await expect(page.locator('.motif-cs-selection-name').filter({ hasText: 'primer site' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The new place is what the menu copies once a range is made there.
    await selectRange(page, 200, 209);
    await clickBase(page, 204, { button: 'right' });
    await menu(page).getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await expect.poll(() => clipboardText(page)).toBe(SEQUENCE.slice(200, 210));
  });

  test('Translate opens the Translation window on the selection', async ({ page }) => {
    await openRecord(page);
    await selectRange(page, 100, 129);
    await clickBase(page, 110, { button: 'right' });
    await menu(page).getByRole('menuitem', { name: 'Translate' }).click();
    const translation = page.getByRole('dialog', { name: 'Translation' });
    await expect(translation).toBeVisible();
    await expect(translation).toContainText('101');
    await expect(label(page)).toHaveText(/^101–130 · 30 bp/);
  });

  test('Add feature opens the feature form on the selection', async ({ page }) => {
    await openRecord(page);
    await selectRange(page, 100, 129);
    await clickBase(page, 110, { button: 'right' });
    await menu(page).getByRole('menuitem', { name: 'Add feature' }).click();
    await expect(page.locator('input[name="feature-name"]').first()).toBeFocused();
  });

  test('a right-click on a map feature selects it and opens the feature menu at the pointer; Escape returns focus to the feature', async ({ page }) => {
    await openRecord(page);
    const point = await mapFeaturePoint(page, 'f-primer');
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(featureMenu(page)).toBeVisible();
    expect(await contextMenusCancelled(page), 'the page handled the right-click').toEqual([true]);
    await expect(label(page), 'the right-click selected the feature').toContainText('primer site');
    await expect(page.locator('.motif-pm-feature[data-selected]')).toHaveAttribute('data-feature-id', 'f-primer');
    const box = (await featureMenu(page).boundingBox())!;
    expect(Math.abs(box.x - point.x) <= 1 || Math.abs(box.x + box.width - point.x) <= 1, 'the menu opens at the pointer').toBe(true);
    await expect(featureMenu(page).getByRole('menuitem')).toHaveText(['Copy' + (MAC ? '⌘C' : 'Ctrl+C'), 'Copy reverse complement', 'Translate', 'Edit feature']);
    await page.keyboard.press('Escape');
    await expect(featureMenu(page)).toHaveCount(0);
    await expect(label(page)).toContainText('primer site');
    expect(await focusedFeature(page), 'focus returned to the map feature').toBe('f-primer');
  });

  test('a right-click on a feature bar selects the feature; Copy copies its bases and Edit feature opens its form', async ({ page }) => {
    await openRecord(page);
    await showTracks(page);
    await clickBase(page, 200);
    const bar = page.locator('.motif-cs-feature-block').filter({ hasText: 'primer site' }).first();
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(featureMenu(page)).toBeVisible();
    await expect(label(page)).toContainText('primer site');
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await featureMenu(page).getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await expect.poll(() => clipboardText(page)).toBe(SEQUENCE.slice(40, 60));
    await expect(bar, 'an item hands focus back to the feature bar').toBeFocused();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await featureMenu(page).getByRole('menuitem', { name: 'Edit feature' }).click();
    const name = page.locator('input[name="feature-name"]').first();
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('primer site');
  });

  test('Translate on a feature opens the Translation window on that feature', async ({ page }) => {
    await openRecord(page);
    await showTracks(page);
    const bar = page.locator('.motif-cs-feature-block').filter({ hasText: 'primer site' }).first();
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await featureMenu(page).getByRole('menuitem', { name: 'Translate' }).click();
    const translation = page.getByRole('dialog', { name: 'Translation' });
    await expect(translation).toBeVisible();
    await expect(translation).toContainText('primer site');
  });

  test('Shift+F10 on a focused feature bar or map feature selects it and opens the feature menu beside it', async ({ page }) => {
    await openRecord(page);
    await showTracks(page);
    const bar = page.locator('.motif-cs-feature-block').filter({ hasText: 'primer site' }).first();
    await bar.focus();
    await page.keyboard.press('Shift+F10');
    await expect(featureMenu(page)).toBeVisible();
    expect(await focusedItem(page)).toBe('copy');
    await expect(label(page)).toContainText('primer site');
    const [menuBox, barBox] = [await featureMenu(page).boundingBox(), await bar.boundingBox()];
    expect(Math.abs(menuBox!.y - (barBox!.y + barBox!.height)), 'the menu opens under the bar').toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(bar).toBeFocused();
    await page.keyboard.press('Escape');
    const mapFeature = page.locator('[data-map-interaction-surface] .motif-pm-feature[data-feature-id="f-primer"]');
    await mapFeature.focus();
    await page.keyboard.press('ContextMenu');
    await expect(featureMenu(page)).toBeVisible();
    await expect(label(page)).toContainText('primer site');
    await page.keyboard.press('Escape');
    await expect(featureMenu(page)).toHaveCount(0);
    expect(await focusedFeature(page)).toBe('f-primer');
  });

  test('a right-click in a text field closes the menu and keeps the browser menu there', async ({ page }) => {
    await openRecord(page);
    await clickBase(page, 30);
    await page.keyboard.press(`${MOD}+f`);
    const search = page.getByRole('search', { name: 'Find in sequence' }).getByRole('searchbox');
    await expect(search).toBeFocused();
    await selectRange(page, 100, 119);
    await clickBase(page, 110, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    const box = (await search.boundingBox())!;
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hit, 'the pointer is over the text field').toBe('INPUT');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator('.motif-cs-context-menu')).toHaveCount(0);
    expect(await contextMenusCancelled(page), 'the sequence right-click was handled, the text field one was not').toEqual([true, false]);
  });

  for (const width of [400, 700, 1040, 1440]) {
    test(`at ${width}px the menu opened at the last base of the lowest row stays inside the window and moves nothing else`, async ({ page }) => {
      await openRecord(page, width);
      // Rows whose last base the pointer can reach (nothing drawn over it).
      const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#motif-cs-sequence-view .motif-cs-seq-bases')]
        .filter((row) => {
          const text = row.querySelector('.motif-cs-seq-glyphs')?.firstChild;
          if (!text) return false;
          const range = document.createRange();
          range.setStart(text, Number(row.dataset.lineLen) - 1);
          range.setEnd(text, Number(row.dataset.lineLen));
          const rect = range.getBoundingClientRect();
          return rect.bottom < window.innerHeight && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('.motif-cs-seq-bases') === row;
        })
        .map((row) => ({ start: Number(row.dataset.lineStart), length: Number(row.dataset.lineLen) })));
      const low = rows[rows.length - 1];
      const last = low.start + low.length - 1;
      await clickBase(page, low.start);
      await clickBase(page, last, { shift: true });
      const before = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.motif-cs-shell *')]
        .filter((element) => !element.closest('.motif-cs-context-menu'))
        .map((element) => element.getBoundingClientRect())
        .map((rect) => [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(',')));
      const point = await clickBase(page, last, { button: 'right' });
      await expect(menu(page)).toBeVisible();
      const box = (await menu(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.y).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
      expect(box.y + box.height).toBeLessThanOrEqual(900 - 8);
      expect(box.x <= point.x && point.x <= box.x + box.width + 1, 'the menu stays beside the pointer').toBe(true);
      const after = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.motif-cs-shell *')]
        .filter((element) => !element.closest('.motif-cs-context-menu'))
        .map((element) => element.getBoundingClientRect())
        .map((rect) => [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(',')));
      expect(after, 'opening the menu moved or resized nothing in the workbench').toEqual(before);
    });
  }

  for (const width of [1440, 700]) {
    test(`the menu never covers the clicked row: under the top row, over the bottom row at ${width}x900`, async ({ page }) => {
      await openRecord(page, width);
      const rows = await page.evaluate(() => {
        const view = document.querySelector('#motif-cs-sequence-view')!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>('#motif-cs-sequence-view .motif-cs-seq-line')]
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.top >= Math.max(view.top, 0) && rect.bottom <= Math.min(view.bottom, window.innerHeight))
          .map((rect) => ({ x: rect.left + 120, y: rect.top + rect.height / 2, top: rect.top, bottom: rect.bottom }));
      });
      expect(rows.length).toBeGreaterThan(1);
      for (const [index, row] of [rows[0], rows[rows.length - 1]].entries()) {
        const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.motif-cs-seq-line') !== null, row);
        expect(hit, 'the pointer is over a sequence row').toBe(true);
        await page.mouse.click(row.x, row.y, { button: 'right' });
        await expect(menu(page)).toBeVisible();
        const box = (await menu(page).boundingBox())!;
        const covered = Math.max(0, Math.min(box.y + box.height, row.bottom) - Math.max(box.y, row.top));
        expect(covered, 'the menu covers none of the clicked row').toBeLessThanOrEqual(0.5);
        expect(Math.abs(box.x - row.x), 'at the pointer\'s x').toBeLessThanOrEqual(1);
        if (index === 0) expect(Math.abs(box.y - row.bottom), 'under the row').toBeLessThanOrEqual(1);
        expect(box.y).toBeGreaterThanOrEqual(8);
        expect(box.y + box.height).toBeLessThanOrEqual(900 - 8);
        await page.keyboard.press('Escape');
        await expect(menu(page)).toHaveCount(0);
      }
    });
  }

  test('an outside press, a wheel over the sequence and a window resize each close the menu; Tab returns focus to the sequence', async ({ page }) => {
    await openRecord(page);
    await selectRange(page, 100, 119);
    await clickBase(page, 110, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    await page.locator('.motif-cs-selection-name').click();
    await expect(menu(page), 'an outside press closes the menu').toHaveCount(0);
    const point = await clickBase(page, 110, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    await page.waitForTimeout(100);
    await page.mouse.move(point.x, point.y - 40);
    await page.mouse.wheel(0, 120);
    await expect(menu(page), 'a wheel over the sequence closes the menu').toHaveCount(0);
    // Let the wheel's scroll finish before the next right-click.
    await expect.poll(async () => {
      const first = await page.evaluate(() => document.getElementById('motif-cs-sequence-view')!.scrollTop);
      await page.waitForTimeout(150);
      return first === await page.evaluate(() => document.getElementById('motif-cs-sequence-view')!.scrollTop);
    }).toBe(true);
    const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#motif-cs-sequence-view .motif-cs-seq-bases')]
      .filter((row) => { const box = row.getBoundingClientRect(); return box.top > 0 && box.bottom < window.innerHeight; })
      .map((row) => ({ start: Number(row.dataset.lineStart), length: Number(row.dataset.lineLen) })));
    // A base of the range that is still on screen: a right-click outside the
    // range would move the caret there instead.
    const inRange = rows.find((row) => row.start + row.length > 100 && row.start < 120);
    expect(inRange, 'a row of the range is still on screen after the wheel').toBeTruthy();
    await clickBase(page, Math.max(100, inRange!.start), { button: 'right' });
    await expect(menu(page)).toBeVisible();
    await page.waitForTimeout(100);
    await page.setViewportSize({ width: 720, height: 900 });
    await expect(menu(page), 'a resize closes the menu').toHaveCount(0);
    await expect(page.locator('#motif-cs-sequence-view'), 'the menu had focus, so it went back to the sequence').toBeFocused();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator('#motif-cs-sequence-view')).toBeFocused();
    await expect(label(page)).toHaveText(/^101–120 · 20 bp/);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`in ${theme} the menu's labels, shortcut and the reason-bearing disabled items keep 4.5:1 and its edge 3:1`, async ({ page }) => {
      await openRecord(page);
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await clickBase(page, 30);
      await clickBase(page, 50, { button: 'right' });
      await expect(menu(page)).toBeVisible();
      const contrast = await menu(page).evaluate((list) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const rgb = (value: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = '#000000';
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          const data = context.getImageData(0, 0, 1, 1).data;
          return [data[0], data[1], data[2]];
        };
        const luminance = ([r, g, b]: number[]) => {
          const channel = (v: number) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };
        const ratio = (a: number[], b: number[]) => {
          const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const fill = rgb(getComputedStyle(list).backgroundColor);
        const colour = (selector: string) => rgb(getComputedStyle(list.querySelector(selector)!).color);
        return {
          enabled: ratio(colour('[role="menuitem"]:not([aria-disabled]) .motif-cs-action-menu-label'), fill),
          disabled: ratio(colour('[role="menuitem"][aria-disabled="true"] .motif-cs-action-menu-label'), fill),
          shortcut: ratio(colour('.motif-cs-context-menu-shortcut'), fill),
          edge: ratio(rgb(getComputedStyle(list).borderTopColor), rgb(getComputedStyle(document.body).backgroundColor)),
        };
      });
      expect(contrast.enabled).toBeGreaterThanOrEqual(4.5);
      expect(contrast.disabled).toBeGreaterThanOrEqual(4.5);
      expect(contrast.shortcut).toBeGreaterThanOrEqual(4.5);
      expect(contrast.edge).toBeGreaterThanOrEqual(3);
    });
  }
});
