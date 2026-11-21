import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// What an edit says it did, and what its Undo takes back. Every check uses real key presses and
// real pointer input on a record loaded through the page's own inventory call.

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const BASE_CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
const SEQUENCE = BASE_CHUNK.repeat(30).slice(0, 3000);

type Annotation = { id: string; name: string; type: string; start: number; end: number; strand: 1 | -1 };

async function openRecord(
  page: Page,
  seq = SEQUENCE,
  molecule: 'dna' | 'rna' | 'protein' = 'dna',
  annotations: Annotation[] = [],
  topology: 'linear' | 'circular' = 'linear',
) {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await page.evaluate((record) => window.motifRenderInventory([record]), {
    id: 'edit-notice-record',
    name: 'Edit record',
    molecule,
    topology,
    seq,
    annotations,
  });
  await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();
}

// A paste as the browser delivers it to the sequence view.
async function pasteText(page: Page, text: string) {
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.querySelector('#motif-cs-sequence-view')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const sequenceOf = (page: Page) => page.evaluate(() => window.motifGetInventory()[0]?.seq ?? '');

// Bring base `index` (0-based) on screen, then click the centre of its glyph once it has stopped
// moving and the pointer there is over the bases row (the panes settle their widths after the
// record opens, and a scroll may still be running).
async function clickBase(page: Page, index: number) {
  let point: { x: number; y: number } | null = null;
  let previous = '';
  await expect.poll(async () => {
    point = await glyphCentre(page, index);
    if (!point) return false;
    const key = `${Math.round(point.x)},${Math.round(point.y)}`;
    const settled = key === previous;
    previous = key;
    return settled && page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.motif-cs-seq-bases') !== null, point);
  }, { message: `the pointer is over base ${index}`, intervals: [100] }).toBe(true);
  await page.mouse.click(point!.x, point!.y);
}

// The centre of base `index` as drawn. With `scroll`, a base the user cannot see is first
// scrolled to the middle of the view (test set-up, not the gesture under test).
async function glyphCentre(page: Page, index: number, scroll = true): Promise<{ x: number; y: number } | null> {
  return page.evaluate(({ target, scroll }) => {
    const rows = [...document.querySelectorAll<HTMLElement>('#motif-cs-sequence-view .motif-cs-seq-bases')];
    const row = rows.find((candidate) => target >= Number(candidate.dataset.lineStart)
      && target < Number(candidate.dataset.lineStart) + Number(candidate.dataset.lineLen));
    const text = row?.querySelector('.motif-cs-seq-glyphs')?.firstChild;
    if (!row || !text) return null;
    const centre = () => {
      const range = document.createRange();
      range.setStart(text, target - Number(row.dataset.lineStart));
      range.setEnd(text, target - Number(row.dataset.lineStart) + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const point = centre();
    if (!scroll || document.elementFromPoint(point.x, point.y)?.closest('.motif-cs-seq-bases') === row) return point;
    row.scrollIntoView({ block: 'center' });
    return centre();
  }, { target: index, scroll });
}

// Whether the user can see base `index`: the point at its glyph's centre is that base's row.
async function baseOnScreen(page: Page, index: number): Promise<boolean> {
  const point = await glyphCentre(page, index, false);
  if (!point) return false;
  return page.evaluate(({ x, y, target }) => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.motif-cs-seq-bases');
    return Boolean(row && target >= Number(row.dataset.lineStart) && target < Number(row.dataset.lineStart) + Number(row.dataset.lineLen));
  }, { ...point, target: index });
}

const otherBase = (base: string) => (base === 'G' ? 'C' : 'G');
const changedPositions = (from: string, to: string) => [...to].flatMap((base, index) => (base === from[index] ? [] : [index + 1]));

test.describe('edit notices', () => {
  test('two bases changed far apart get one notice each, and the notice Undo reverts only the last', async ({ page }) => {
    // Base 11 then base 2,000 must not merge into "Replaced 1,990 bp (11–2,000) with 1,990 bp."
    // with an Undo that reverts both bases, the first one off screen.
    await openRecord(page);
    const notice = page.locator('.motif-cs-workbench-notice');

    await clickBase(page, 10);
    await page.keyboard.type(otherBase(SEQUENCE[10]));
    await expect(notice).toContainText(`Changed base 11 from ${SEQUENCE[10]} to ${otherBase(SEQUENCE[10])}.`);

    await clickBase(page, 1999);
    await page.keyboard.type(otherBase(SEQUENCE[1999]));
    await expect.poll(async () => changedPositions(SEQUENCE, await sequenceOf(page))).toEqual([11, 2000]);
    await expect(notice).toContainText(`Changed base 2,000 from ${SEQUENCE[1999]} to ${otherBase(SEQUENCE[1999])}.`);
    await expect(notice).not.toContainText('1,990');

    await notice.getByRole('button', { name: 'Undo this edit' }).click();
    await expect.poll(async () => changedPositions(SEQUENCE, await sequenceOf(page)), 'the notice Undo leaves base 11 changed').toEqual([11]);

    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => sequenceOf(page), 'the next Cmd/Ctrl+Z reverts base 11').toBe(SEQUENCE);
  });

  test('an edit notice sits on the sequence pane\'s bottom edge, not in the middle of the window', async ({ page }) => {
    // The notice sits inside the pane, just above the status bar at the pane's bottom edge,
    // clear of the lines of bases being edited.
    await openRecord(page);
    const notice = page.locator('.motif-cs-workbench-notice');
    await clickBase(page, 10);
    await page.keyboard.type(otherBase(SEQUENCE[10]));
    await expect(notice).toContainText('Changed base 11');
    const geometry = await page.evaluate(() => {
      const box = document.querySelector('.motif-cs-workbench-notice')!.getBoundingClientRect();
      const pane = document.querySelector('[data-pane-key="sequence"]')!.getBoundingClientRect();
      const status = document.querySelector('.motif-cs-selection-bar')!.getBoundingClientRect();
      return {
        inPane: box.left >= pane.left && box.right <= pane.right,
        aboveStatus: box.bottom <= Math.min(status.top, innerHeight) + 1,
        nearStatus: Math.min(status.top, innerHeight) - box.bottom <= 16,
      };
    });
    expect(geometry).toEqual({ inPane: true, aboveStatus: true, nearStatus: true });
    // Its Undo is still the edit's Undo.
    await notice.getByRole('button', { name: 'Undo this edit' }).click();
    await expect.poll(() => sequenceOf(page)).toBe(SEQUENCE);
  });

  test('Undo and Redo show and select what they restore, and retire the edit notice', async ({ page }) => {
    // Undo and Redo bring the restored base into view and select it. After Cmd+Z the notice
    // is retired, so it never offers an Undo that answers "That edit is no longer in the undo history."
    await openRecord(page);
    const notice = page.locator('.motif-cs-workbench-notice');
    const hint = page.locator('.motif-cs-edit-hint');
    const label = page.locator('.motif-cs-selection-name');

    await clickBase(page, 10);
    await page.keyboard.type(otherBase(SEQUENCE[10]));
    await expect(notice.getByRole('button', { name: 'Undo this edit' })).toBeVisible();
    for (let step = 0; step < 8; step += 1) await page.keyboard.press('PageDown');
    await expect.poll(() => baseOnScreen(page, 10), 'Page Down moved base 11 out of view').toBe(false);

    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => sequenceOf(page)).toBe(SEQUENCE);
    await expect.poll(() => baseOnScreen(page, 10), 'Undo shows base 11').toBe(true);
    await expect(hint).toHaveText('Caret 11');
    await expect(notice).toHaveCount(0);

    for (let step = 0; step < 8; step += 1) await page.keyboard.press('PageDown');
    await expect.poll(() => baseOnScreen(page, 10)).toBe(false);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(async () => changedPositions(SEQUENCE, await sequenceOf(page))).toEqual([11]);
    await expect.poll(() => baseOnScreen(page, 10), 'Redo shows base 11').toBe(true);
    await expect(hint).toHaveText('Caret 12');

    // A replaced range comes back selected, and the notice that offered its Undo goes.
    await page.keyboard.press(`${MOD}+z`);
    await clickBase(page, 20);
    await page.keyboard.down('Shift');
    await clickBase(page, 25);
    await page.keyboard.up('Shift');
    await expect(label).toHaveText(/^21–26 · 6 bp/);
    await page.keyboard.type('T');
    await expect(notice).toContainText('Replaced 6 bp (21–26) with T.');
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => sequenceOf(page)).toBe(SEQUENCE);
    await expect(label).toHaveText(/^21–26 · 6 bp/);
    await expect(notice).toHaveCount(0);
  });

  test('a typed key outside the alphabet says so in the caret slot, and U typed into DNA is T', async ({ page }) => {
    // u, E, 5 and - typed into DNA each leave a note in the caret slot; t typed into RNA does the same.
    await openRecord(page);
    const slot = page.locator('.motif-cs-selection-label .motif-cs-edit-hint');
    await clickBase(page, 60);
    // + = - _ and 0 are the map's zoom keys: = zooms the map and is no refused base.
    const mapZoom = () => page.locator('.motif-cs-map-frame').first().evaluate((frame) => [...frame.querySelectorAll('[transform], svg[viewBox]')]
      .map((element) => `${element.getAttribute('transform') ?? ''}${element.getAttribute('viewBox') ?? ''}`).join(';'));
    const zoomBefore = await mapZoom();
    await page.keyboard.press('=');
    await expect.poll(mapZoom, '= zooms the map').not.toBe(zoomBefore);
    expect(await slot.textContent(), 'a zoom key says nothing about bases').toBe('Caret 61');
    for (const [key, note] of [['E', 'E is not a DNA base.'], ['5', '“5” is not a DNA base.'], ['.', '“.” is not a DNA base.']]) {
      await page.keyboard.press(key);
      await expect(slot).toHaveText(note);
      await expect(page.locator('.motif-cs-selection-label [role="status"]')).toHaveText(note);
    }
    expect(await sequenceOf(page), 'a refused key changes nothing').toBe(SEQUENCE);
    await page.keyboard.press('u');
    await expect.poll(async () => (await sequenceOf(page))[60]).toBe('T');
    await expect(slot).toHaveText('U read as T.');
    // The note goes as soon as the caret moves.
    await page.keyboard.press('ArrowRight');
    await expect(slot).toHaveText('Caret 63');

    await openRecord(page, SEQUENCE.replace(/T/g, 'U'), 'rna');
    await clickBase(page, 60);
    await page.keyboard.press('t');
    await expect.poll(async () => (await sequenceOf(page))[60]).toBe('U');
    await expect(slot).toHaveText('T read as U.');
  });

  test('deleting the bases of a feature says the feature went too', async ({ page }) => {
    // Deleting 350-380 removes the primer annotation from the map and the sequence, so the
    // notice says more than "Deleted 31 bp (350–380)."
    await openRecord(page, SEQUENCE, 'dna', [
      { id: 'f-primer', name: 'primer_1', type: 'primer_bind', start: 352, end: 375, strand: 1 },
      { id: 'f-long', name: 'long feature', type: 'misc_feature', start: 370, end: 600, strand: 1 },
    ]);
    const names = () => page.evaluate(() => (window.motifGetInventory()[0]?.annotations ?? []).map((feature) => feature.name));
    expect(await names()).toEqual(['primer_1', 'long feature']);
    await clickBase(page, 349);
    await page.keyboard.down('Shift');
    await clickBase(page, 379);
    await page.keyboard.up('Shift');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^350–380 · 31 bp/);
    await page.keyboard.press('Backspace');
    await expect.poll(names).toEqual(['long feature']);
    // The shortened feature is what the user deleted; only the one that went is named.
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText('Deleted 31 bp (350–380) and the feature primer_1.');
    await page.locator('.motif-cs-workbench-notice').getByRole('button', { name: 'Undo this edit' }).click();
    await expect.poll(names).toEqual(['primer_1', 'long feature']);
  });

  test('a number or a range typed into Find goes to that base on Enter and says so', async ({ page }) => {
    // Find goes to a base: "1500" reads "Base 1,500" and Enter goes there.
    await openRecord(page);
    await clickBase(page, 5);
    await page.keyboard.press(`${MOD}+f`);
    const field = page.getByRole('searchbox', { name: 'Find in sequence' });
    const status = page.locator('.motif-cs-find-count');
    await expect(field).toBeFocused();
    await field.fill('1500');
    await expect(status).toHaveText(/Base 1,500.*Enter goes there/);
    expect(await baseOnScreen(page, 1499)).toBe(false);
    await page.keyboard.press('Enter');
    await expect(status).toHaveText(/At base 1,500/);
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText('Caret 1,500');
    await expect.poll(() => baseOnScreen(page, 1499), 'Enter shows base 1,500').toBe(true);

    await field.fill('1,500..1,600');
    await page.keyboard.press('Enter');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^1,500–1,600 · 101 bp/);
    await expect(status).toHaveText(/Selected · 101 bp/);

    // A position past the end says so before Enter, and Enter changes nothing.
    await field.fill('5000');
    await expect(status).toHaveText(/Past the end.*Last base is 3,000/);
    await page.keyboard.press('Enter');
    await expect(status).toHaveText(/Past the end.*Last base is 3,000/);
    await expect(page.locator('.motif-cs-selection-name'), 'a refused go-to keeps the selection').toHaveText(/^1,500–1,600 · 101 bp/);
  });

  test('a range typed backwards into Find on a circular record selects across the origin', async ({ page }) => {
    // "2990..10" selects the 21 bases across the origin (not 10–2,990, which is 2,981 bp).
    await openRecord(page, SEQUENCE, 'dna', [], 'circular');
    await clickBase(page, 5);
    await page.keyboard.press(`${MOD}+f`);
    const field = page.getByRole('searchbox', { name: 'Find in sequence' });
    const status = page.locator('.motif-cs-find-count');
    await field.fill('2990..10');
    await expect(status).toHaveText(/2,990–10.*Enter selects it/);
    await page.keyboard.press('Enter');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^2,990–10 · 21 bp/);
    await expect(status).toHaveText(/2,990–10.*Selected · 21 bp/);
    // Forwards it is the ordinary range.
    await field.fill('10..2990');
    await page.keyboard.press('Enter');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^10–2,990 · 2,981 bp/);
  });

  test('a range typed backwards into Find on a linear record previews the range Enter selects', async ({ page }) => {
    // "1600..1500" previews "1,500–1,600", the range Enter selects, not "1,600–1,500".
    await openRecord(page);
    await clickBase(page, 5);
    await page.keyboard.press(`${MOD}+f`);
    const field = page.getByRole('searchbox', { name: 'Find in sequence' });
    const status = page.locator('.motif-cs-find-count');
    await field.fill('1600..1500');
    await expect(status).toHaveText(/^1,500–1,600.*Typed backwards$/);
    // The fixed-width status shows the whole line, not an ellipsis.
    for (const part of ['.motif-cs-find-count-main', '.motif-cs-find-count-detail']) {
      expect(await status.locator(part).evaluate((element) => element.scrollWidth <= element.clientWidth), part).toBe(true);
    }
    await page.keyboard.press('Enter');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^1,500–1,600 · 101 bp/);
    await expect(status).toHaveText(/1,500–1,600.*Selected · 101 bp/);
  });

  test('a read-only record says why typing does nothing, and a paste past the limit keeps Undo', async ({ page }) => {
    // Typing into a protein record says why nothing is typed; a paste that takes a record
    // past 50,000 bases makes it read-only and keeps the Undo and Redo buttons.
    await openRecord(page, 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFF', 'protein');
    const slot = page.locator('.motif-cs-selection-label .motif-cs-edit-hint');
    await page.locator('#motif-cs-sequence-view').focus();
    await page.keyboard.press('A');
    await expect(slot).toHaveText('Read-only: the editor changes DNA and RNA only.');

    await openRecord(page);
    await clickBase(page, 100);
    const big = BASE_CHUNK.repeat(480);
    await pasteText(page, big);
    await expect.poll(async () => (await sequenceOf(page)).length).toBe(SEQUENCE.length + big.length);
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText('The record is now over 50,000 bp, so it is read-only here. Undo takes this edit back.');
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    const largeView = page.getByTestId('large-sequence-viewer').locator('textarea');
    await largeView.focus();
    await page.keyboard.press('A');
    await expect(slot).toHaveText('Read-only above 50,000 bases: nothing was typed.');
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => sequenceOf(page), 'Cmd/Ctrl+Z in the large view takes the paste back').toBe(SEQUENCE);
  });
});
