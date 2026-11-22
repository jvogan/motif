import { expect, test, type Page } from '@playwright/test';
import { openExportPanel } from './export-panel';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// The keyboard in the Sequence pane behaves like a desktop editor's: typing goes where the caret
// blinks, Cmd/Ctrl+A selects the sequence, cut works, a selected feature is a starting point, line
// and record keys move the caret, Space does nothing, Replace mode marks the base it replaces, and
// adding a feature by keyboard ends back in the sequence. Every check here uses real key presses
// and real pointer input.

const MAC = process.platform === 'darwin';
const MOD = MAC ? 'Meta' : 'Control';
const KEYS = MAC
  ? {
    lineStart: 'Meta+ArrowLeft',
    lineEnd: 'Meta+ArrowRight',
    recordStart: ['Meta+ArrowUp', 'Meta+Home'],
    recordEnd: ['Meta+ArrowDown', 'Meta+End'],
    groupPrev: 'Alt+ArrowLeft',
    groupNext: 'Alt+ArrowRight',
    unusedScroll: ['Control+ArrowDown', 'Alt+ArrowDown', 'Alt+PageDown', 'Meta+PageDown'],
  }
  : {
    lineStart: 'Home',
    lineEnd: 'End',
    recordStart: ['Control+Home'],
    recordEnd: ['Control+End'],
    groupPrev: 'Control+ArrowLeft',
    groupNext: 'Control+ArrowRight',
    unusedScroll: ['Control+ArrowDown', 'Alt+ArrowDown', 'Control+PageDown'],
  };

const BASE_CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
const SEQUENCE = BASE_CHUNK.repeat(4).slice(0, 360);
const LONG_SEQUENCE = BASE_CHUNK.repeat(60).slice(0, 6000);
const PROTEIN = 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFF';

type RecordOptions = {
  seq?: string;
  molecule?: 'dna' | 'protein';
  topology?: 'linear' | 'circular';
  width?: number;
  tracks?: boolean;
};

async function openRecord(page: Page, options: RecordOptions = {}) {
  const seq = options.seq ?? SEQUENCE;
  await page.setViewportSize({ width: options.width ?? 700, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await page.evaluate(({ record }) => window.motifRenderInventory([record]), {
    record: {
      id: 'keys-record',
      name: 'Keys record',
      molecule: options.molecule ?? 'dna',
      topology: options.topology ?? 'linear',
      seq,
      annotations: options.molecule === 'protein' ? [] : [
        { id: 'f-primer', name: 'primer site', type: 'primer_bind', start: 40, end: 60, strand: 1, color: '#2f9e6f' },
      ],
    },
  });
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
  if (options.tracks) {
    const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await tracks.getAttribute('aria-pressed')) !== 'true') await tracks.click();
    await expect(page.locator('.motif-cs-feature-block').first()).toBeVisible();
  }
}

function view(page: Page) {
  return page.locator('#motif-cs-sequence-view');
}

async function basesPerLine(page: Page): Promise<number> {
  return Number(await page.locator('.motif-cs-seq-bases').first().getAttribute('data-line-len'));
}

// The centre of base `index` (0-based) as drawn, measured from the glyph text itself.
async function basePoint(page: Page, index: number): Promise<{ x: number; y: number; left: number; width: number; top: number; bottom: number }> {
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
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, left: rect.left, width: rect.width, top: rect.top, bottom: rect.bottom };
  }, index);
  expect(point, `base ${index} is drawn`).not.toBeNull();
  return point!;
}

async function clickBase(page: Page, index: number, shift = false) {
  const point = await basePoint(page, index);
  // Show that the pointer is over the bases row, not over a control drawn above it.
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.motif-cs-seq-bases') !== null, point);
  expect(hit, `the pointer is over base ${index}`).toBe(true);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y);
  if (shift) await page.keyboard.up('Shift');
}

type Readout = { caret: string | null; label: string | null; seq: string; active: string; scroll: number[] };

async function readout(page: Page): Promise<Readout> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const column = document.querySelector<HTMLElement>('.motif-cs-sequence-column');
    return {
      caret: document.querySelector('.motif-cs-edit-hint')?.textContent ?? null,
      label: document.querySelector('.motif-cs-selection-name')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      seq: window.motifGetInventory()[0]?.seq ?? '',
      active: active?.id || active?.getAttribute('aria-label') || active?.textContent?.trim().slice(0, 30) || active?.tagName || '',
      scroll: [document.getElementById('motif-cs-sequence-view')?.scrollTop ?? 0, column?.scrollTop ?? 0, window.scrollY],
    };
  });
}

const otherBase = (base: string) => (base === 'G' ? 'C' : 'G');

async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

// A spot with no control under it: focus leaves the sequence for the page body.
async function clickOutsideSequence(page: Page) {
  await page.locator('.motif-cs-sequence-meta').first().click();
  await expect(view(page)).not.toBeFocused();
}

test.describe('Sequence keys and focus', () => {
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

  test('no key press is lost: after a pointer click on each toolbar control, the next base typed lands at the caret', async ({ page }) => {
    await openRecord(page);
    const caretIndex = async () => {
      const hint = (await readout(page)).caret;
      expect(hint, 'a caret is shown').toMatch(/^Caret [\d,]+$/);
      return Number(hint!.replace(/\D/g, '')) - 1;
    };
    const controls: Array<{ name: string; at: number; prepare?: () => Promise<void>; insert?: boolean }> = [
      // Typing mode is one button: from Replace it switches to Insert, and from
      // Insert back to Replace. Both clicks hand the keyboard back.
      { name: 'Typing mode: Replace. Switch to Insert', at: 10, insert: true },
      { name: 'Typing mode: Insert. Switch to Replace', at: 20, prepare: () => page.getByRole('button', { name: 'Typing mode: Replace. Switch to Insert', exact: true }).click() },
      { name: 'Show tracks', at: 30 },
      { name: 'Complement strand', at: 40 },
      // Undo and Redo put the caret back where that edit left it; typing goes there.
      { name: 'Undo', at: 50 },
      // Undo the edit just typed from the keyboard, so Redo has something to redo.
      { name: 'Redo', at: 70, prepare: () => page.keyboard.press(`${MOD}+z`) },
    ];
    for (const control of controls) {
      await clickBase(page, control.at);
      await control.prepare?.();
      const before = await readout(page);
      await page.getByRole('button', { name: control.name, exact: true }).first().click();
      const after = await readout(page);
      expect(after.active, `${control.name}: the keyboard is back in the sequence`).toBe('motif-cs-sequence-view');
      expect(after.scroll, `${control.name}: nothing scrolled`).toEqual(before.scroll);
      const at = await caretIndex();
      if (!control.name.startsWith('Undo') && !control.name.startsWith('Redo')) expect(at, `${control.name}: same caret`).toBe(control.at);
      const typed = otherBase(after.seq[at]);
      await page.keyboard.press(typed);
      const edited = (await readout(page)).seq;
      if (control.insert) {
        expect(edited, `${control.name}: the base was inserted at the caret`).toBe(after.seq.slice(0, at) + typed + after.seq.slice(at));
        await page.getByRole('button', { name: 'Typing mode: Insert. Switch to Replace', exact: true }).click();
        await expect(page.locator('button.motif-cs-edit-mode-toggle')).toHaveAttribute('data-mode', 'replace');
      } else {
        expect(edited, `${control.name}: the base at the caret was replaced`).toBe(after.seq.slice(0, at) + typed + after.seq.slice(at + 1));
      }
    }
    // Copy acts on a selection; the keyboard comes back with the selection intact.
    await clickBase(page, 100);
    await clickBase(page, 109, true);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/101–110/);
    const beforeCopy = await readout(page);
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(view(page)).toBeFocused();
    expect((await readout(page)).scroll).toEqual(beforeCopy.scroll);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/101–110/);
    expect(await clipboardText(page)).toBe(beforeCopy.seq.slice(100, 110));
    await page.keyboard.press('G');
    const replaced = (await readout(page)).seq;
    expect(replaced).toBe(beforeCopy.seq.slice(0, 100) + 'G' + beforeCopy.seq.slice(110));
  });

  test('Enter or Space on a focused toolbar control leaves the keyboard on that control', async ({ page }) => {
    await openRecord(page);
    await clickBase(page, 10);
    await expect(page.getByRole('button', { name: 'Typing mode: Replace. Switch to Insert', exact: true })).toHaveCount(1);
    const typingMode = page.locator('button.motif-cs-edit-mode-toggle');
    await typingMode.focus();
    await page.keyboard.press('Enter');
    await expect(typingMode).toHaveAttribute('data-mode', 'insert');
    await expect(typingMode).toHaveAccessibleName('Typing mode: Insert. Switch to Replace');
    await expect(typingMode).toBeFocused();
    const tracks = page.getByRole('button', { name: 'Show tracks', exact: true });
    const pressed = await tracks.getAttribute('aria-pressed');
    await tracks.focus();
    await page.keyboard.press('Space');
    await expect(tracks).not.toHaveAttribute('aria-pressed', pressed!);
    await expect(tracks).toBeFocused();
  });

  test('the caret blinks only while the sequence view has keyboard focus, and is steady and weaker otherwise', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openRecord(page);
    await clickBase(page, 12);
    const caret = page.locator('.motif-cs-seq-caret');
    const caretState = () => caret.evaluate((element) => ({
      running: element.getAnimations().filter((animation) => animation.playState === 'running').length,
      opacity: Number(getComputedStyle(element).opacity),
    }));
    await expect.poll(async () => (await caretState()).running).toBeGreaterThan(0);
    await clickOutsideSequence(page);
    const unfocused = await caretState();
    expect(unfocused.running, 'no blink without focus').toBe(0);
    expect(unfocused.opacity, 'weaker without focus').toBeLessThan(0.7);
    expect(unfocused.opacity, 'still drawn').toBeGreaterThan(0.2);
    await view(page).focus();
    await expect.poll(async () => (await caretState()).running).toBeGreaterThan(0);
  });

  test('closing a menu, the Tools drawer or the find bar returns the keyboard to the sequence when typing was there, otherwise to the control', async ({ page }) => {
    await openRecord(page);
    const create = page.getByRole('button', { name: 'Create', exact: true });
    const find = page.locator('.motif-cs-find-button');
    const tools = page.locator('[data-pane-toggle="tools"]');

    await clickBase(page, 10);
    await create.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(view(page)).toBeFocused();

    await clickBase(page, 10);
    await tools.click();
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(0);
    await expect(view(page)).toBeFocused();
    const typed = otherBase((await readout(page)).seq[10]);
    await page.keyboard.press(typed);
    expect((await readout(page)).seq[10]).toBe(typed);

    await clickBase(page, 30);
    await find.click();
    await expect(page.getByRole('search', { name: 'Find in sequence' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(view(page)).toBeFocused();

    await clickOutsideSequence(page);
    await create.click();
    await page.keyboard.press('Escape');
    await expect(create).toBeFocused();

    await clickOutsideSequence(page);
    await find.click();
    await page.keyboard.press('Escape');
    await expect(find).toBeFocused();

    await clickOutsideSequence(page);
    await tools.click();
    await page.keyboard.press('Escape');
    await expect(tools).toBeFocused();
  });

  test('closing the Translation window or the Export popover with Escape returns the keyboard to the sequence when typing was there', async ({ page }) => {
    await openRecord(page, { width: 1180 });
    await clickBase(page, 10);
    await page.getByRole('button', { name: 'Translations window off' }).click();
    const translation = page.getByRole('dialog', { name: 'Translation' });
    await expect(translation).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(translation).toHaveCount(0);
    await expect(view(page), 'back from the Translation window').toBeFocused();
    let typed = otherBase((await readout(page)).seq[10]);
    await page.keyboard.press(typed);
    expect((await readout(page)).seq[10]).toBe(typed);

    await clickBase(page, 20);
    const exportPanel = await openExportPanel(page);
    await page.keyboard.press('Escape');
    await expect(exportPanel).not.toHaveAttribute('open', '');
    await expect(view(page), 'back from the Export popover').toBeFocused();
    typed = otherBase((await readout(page)).seq[20]);
    await page.keyboard.press(typed);
    expect((await readout(page)).seq[20]).toBe(typed);
  });

  test('Cmd/Ctrl+A anywhere in the workbench selects the whole sequence, never the page, and Cmd/Ctrl+C copies the bases', async ({ page }) => {
    await openRecord(page, { tracks: true });
    const wholeRange = /^1–360 · 360 bp/;
    const starts: Array<[string, () => Promise<void>]> = [
      ['the page body', () => clickOutsideSequence(page)],
      ['a toolbar button', () => page.getByRole('button', { name: 'Complement strand', exact: true }).focus()],
      ['a selected feature bar', () => page.locator('.motif-cs-feature-block').filter({ hasText: 'primer site' }).first().click()],
    ];
    for (const [where, start] of starts) {
      await page.keyboard.press('Escape');
      await start();
      await page.keyboard.press(`${MOD}+a`);
      await expect(page.locator('.motif-cs-selection-name'), `from ${where}`).toHaveText(wholeRange);
      await expect(view(page), `from ${where}: the keyboard moves to the sequence`).toBeFocused();
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? ''), `from ${where}: no page text selected`).toBe('');
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.keyboard.press(`${MOD}+c`);
      await expect.poll(() => clipboardText(page), `from ${where}: the bases are copied`).toBe(SEQUENCE);
    }
  });

  test('Tab leaves the sequence view both ways, and keys typed in the find field stay in the field', async ({ page }) => {
    await openRecord(page);
    await clickBase(page, 10);
    const before = (await readout(page)).seq;
    await page.keyboard.press('Tab');
    await expect(view(page), 'Tab moves on').not.toBeFocused();
    await view(page).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(view(page), 'Shift+Tab moves back').not.toBeFocused();

    await view(page).focus();
    await page.keyboard.press(`${MOD}+f`);
    const field = page.getByRole('searchbox');
    await expect(field).toBeFocused();
    await page.keyboard.type('GGAG');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('T');
    await page.keyboard.press('End');
    await page.keyboard.press('Space');
    await page.keyboard.press('Home');
    await page.keyboard.press('Delete');
    await expect(field).toHaveValue('GTA ');
    await expect(field).toBeFocused();
    expect((await readout(page)).seq, 'nothing typed in the field reached the record').toBe(before);
  });

  test('Cmd/Ctrl+A in a text field keeps selecting the field', async ({ page }) => {
    await openRecord(page);
    await clickBase(page, 5);
    await page.locator('.motif-cs-find-button').click();
    const field = page.getByRole('searchbox');
    await field.fill('GGAG');
    await page.keyboard.press(`${MOD}+a`);
    await expect(field).toBeFocused();
    expect(await field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 4]);
    await expect(page.locator('.motif-cs-selection-name')).not.toHaveText(/^1–360 · 360 bp/);
  });

  test('Cmd/Ctrl+X cuts a range: the bases go to the clipboard and leave the record as one undoable edit', async ({ page }) => {
    await openRecord(page);
    await clickBase(page, 20);
    await clickBase(page, 29, true);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^21–30 · 10 bp/);
    await page.keyboard.press(`${MOD}+x`);
    await expect.poll(() => clipboardText(page)).toBe(SEQUENCE.slice(20, 30));
    expect((await readout(page)).seq).toBe(SEQUENCE.slice(0, 20) + SEQUENCE.slice(30));
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText('Deleted 10 bp (21–30)');
    await page.keyboard.press(`${MOD}+z`);
    expect((await readout(page)).seq).toBe(SEQUENCE);
  });

  test('in a read-only record Cmd/Ctrl+X copies only and says the record is read-only', async ({ page }) => {
    await openRecord(page, { seq: PROTEIN, molecule: 'protein' });
    await view(page).focus();
    for (let step = 0; step < 5; step += 1) await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^1–5 /);
    await page.keyboard.press(`${MOD}+x`);
    await expect.poll(() => clipboardText(page)).toBe(PROTEIN.slice(0, 5));
    expect((await readout(page)).seq).toBe(PROTEIN);
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText('read-only');
  });

  test('a selected feature is where Shift+click, Shift+arrows and arrows start', async ({ page }) => {
    await openRecord(page, { tracks: true });
    const primer = page.locator('.motif-cs-feature-block').filter({ hasText: 'primer site' }).first();
    const before = (await readout(page)).seq;

    await primer.click();
    await expect(page.locator('.motif-cs-selection-name')).toContainText('primer site');
    await clickBase(page, 79, true);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^41–80 · 40 bp/);

    await primer.click();
    await clickBase(page, 20, true);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^21–60 · 40 bp/);

    await primer.click();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^41–61 · 21 bp/);
    await expect(view(page)).toBeFocused();

    await primer.click();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^40–60 · 21 bp/);

    await primer.click();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText('Caret 41');
    await expect(view(page)).toBeFocused();

    await primer.click();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText('Caret 61');

    // Delete and Backspace on a selected feature remove nothing.
    await primer.click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    expect((await readout(page)).seq).toBe(before);
    await expect(page.locator('.motif-cs-selection-name')).toContainText('primer site');
  });

  test('a click or a double-click on a line\'s number selects that line; a drag from it still selects a range', async ({ page }) => {
    await openRecord(page);
    const line = await basesPerLine(page);
    const number = async () => {
      const box = (await page.locator('#motif-cs-sequence-view .motif-cs-seq-line > .motif-cs-seq-index').nth(1).boundingBox())!;
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('.motif-cs-seq-line > .motif-cs-seq-index') ?? false, point);
      expect(hit, 'the pointer is over the second line\'s number').toBe(true);
      return point;
    };
    const lineLabel = new RegExp(`^${line + 1}–${2 * line} · ${line} bp`);
    const name = page.locator('.motif-cs-selection-name');

    let point = await number();
    await page.mouse.click(point.x, point.y);
    await expect(name, 'a click on the number selects its line').toHaveText(lineLabel);
    await expect(view(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(name.filter({ hasText: lineLabel }), 'Escape cleared the line').toHaveCount(0);

    point = await number();
    await page.mouse.dblclick(point.x, point.y);
    await expect(name, 'a double-click on the number selects its line, not its first 10 bases').toHaveText(lineLabel);
    // Shift+Right grows the line selection from its start, as after a triple-click.
    await page.keyboard.press('Shift+ArrowRight');
    await expect(name).toHaveText(new RegExp(`^${line + 1}–${2 * line + 1} · `));
    await page.keyboard.press('Escape');

    point = await number();
    const target = await basePoint(page, 2 * line + 9);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    await expect(name, 'a drag from the number selects from the line\'s start').toHaveText(new RegExp(`^${line + 1}–${2 * line + 10} · `));
  });

  test('Home and End reach the line\'s start and end, and Shift extends to them', async ({ page }) => {
    await openRecord(page);
    const line = await basesPerLine(page);
    await clickBase(page, line + 5);
    await page.keyboard.press('Home');
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText(`Caret ${line + 1}`);
    // Replace mode: End marks the line's last base, the one the next letter replaces.
    await page.keyboard.press('End');
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText(`Caret ${2 * line}`);
    const caretRow = () => page.locator('.motif-cs-seq-caret').evaluate((element) => Number(element.closest<HTMLElement>('.motif-cs-seq-bases')?.dataset.lineStart));
    expect(await caretRow()).toBe(line);

    await clickBase(page, line + 5);
    await page.keyboard.press('Shift+Home');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(new RegExp(`^${line + 1}–${line + 5} · 5 bp`));
    await clickBase(page, line + 5);
    await page.keyboard.press('Shift+End');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(new RegExp(`^${line + 6}–${2 * line} · ${line - 5} bp`));
    await page.keyboard.press('Shift+End');
    await expect(page.locator('.motif-cs-selection-name'), 'a second Shift+End stays on the line').toHaveText(new RegExp(`^${line + 6}–${2 * line} · `));

    // Insert mode: End puts the bar after the line's last base, drawn on that line.
    await page.getByRole('button', { name: 'Typing mode: Replace. Switch to Insert', exact: true }).click();
    await expect(page.locator('button.motif-cs-edit-mode-toggle')).toHaveAttribute('data-mode', 'insert');
    await clickBase(page, line + 5);
    await page.keyboard.press('End');
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText(`Caret ${2 * line + 1}`);
    expect(await caretRow(), 'the bar is drawn at the end of the line End acted on').toBe(line);
    await page.keyboard.press('Home');
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText(`Caret ${line + 1}`);
  });

  test('Page Down and Page Up move the caret by the whole lines in view and scroll by the same distance, so the caret keeps its height; Shift extends', async ({ page }) => {
    await openRecord(page, { seq: LONG_SEQUENCE, tracks: true, width: 1440 });
    const line = await basesPerLine(page);
    // Whole lines in view, and the top of the row holding a base, from the scroller's top.
    const state = () => page.evaluate(() => {
      const scroller = document.getElementById('motif-cs-sequence-view')!;
      const frame = scroller.getBoundingClientRect();
      const whole = [...scroller.querySelectorAll<HTMLElement>('.motif-cs-seq-block')].filter((block) => {
        const box = block.getBoundingClientRect();
        return box.top >= frame.top - 0.5 && box.bottom <= frame.bottom + 0.5;
      }).length;
      return { whole, scrollTop: scroller.scrollTop, height: frame.height };
    });
    const rowTop = (base: number) => page.evaluate((target) => {
      const scroller = document.getElementById('motif-cs-sequence-view')!;
      const row = [...scroller.querySelectorAll<HTMLElement>('.motif-cs-seq-bases')].find((candidate) => {
        const start = Number(candidate.dataset.lineStart);
        return target >= start && target < start + Number(candidate.dataset.lineLen);
      })!;
      return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    }, base);
    const caretBase = async () => Number((await page.locator('.motif-cs-edit-hint').textContent())!.replace(/\D/g, '')) - 1;
    const settled = async () => {
      await expect.poll(async () => {
        const first = (await state()).scrollTop;
        await page.waitForTimeout(120);
        return first === (await state()).scrollTop;
      }).toBe(true);
    };

    // Start mid-record, on the third whole line in view.
    await page.locator('#motif-cs-sequence-view').evaluate((scroller) => { scroller.scrollTop = 2400; });
    await settled();
    const start = await page.evaluate(() => {
      const scroller = document.getElementById('motif-cs-sequence-view')!;
      const frame = scroller.getBoundingClientRect();
      const rows = [...scroller.querySelectorAll<HTMLElement>('.motif-cs-seq-bases')]
        .filter((row) => { const box = row.getBoundingClientRect(); return box.top >= frame.top && box.bottom <= frame.bottom; });
      return Number(rows[2]!.dataset.lineStart) + 5;
    });
    await clickBase(page, start);
    for (const key of ['PageDown', 'PageDown', 'PageUp', 'PageUp']) {
      const before = await state();
      const from = await caretBase();
      const top = await rowTop(from);
      await page.keyboard.press(key);
      const step = (key === 'PageDown' ? 1 : -1) * before.whole * line;
      await expect(page.locator('.motif-cs-edit-hint'), `${key} moves by the ${before.whole} whole lines in view`).toHaveText(`Caret ${(from + step + 1).toLocaleString('en-US')}`);
      await settled();
      const after = await state();
      expect(Math.abs(await rowTop(from + step) - top), `${key}: the caret keeps its height in the view`).toBeLessThanOrEqual(1);
      expect(Math.abs(after.scrollTop - before.scrollTop), `${key}: the view scrolls by most of its height`).toBeGreaterThan(before.height * 0.6);
    }

    // Shift+Page Down extends the selection by the same lines; its end keeps the caret's height.
    const before = await state();
    const from = await caretBase();
    const top = await rowTop(from);
    await page.keyboard.press('Shift+PageDown');
    const end = from + before.whole * line;
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(new RegExp(`^${(from + 1).toLocaleString('en-US')}–${end.toLocaleString('en-US')} · `));
    await settled();
    expect(Math.abs(await rowTop(end - 1) - top), 'Shift+Page Down: the selection\'s end keeps the caret\'s height').toBeLessThanOrEqual(1);
    // Shift+Page Up moves the same end back by the whole lines then in view.
    const focus = end - (await state()).whole * line;
    await page.keyboard.press('Shift+PageUp');
    const n = (value: number) => value.toLocaleString('en-US');
    if (focus === from) await expect(page.locator('.motif-cs-edit-hint')).toHaveText(`Caret ${n(from + 1)}`);
    else if (focus < from) await expect(page.locator('.motif-cs-selection-name')).toHaveText(new RegExp(`^${n(focus + 1)}–${n(from)} · `));
    else await expect(page.locator('.motif-cs-selection-name')).toHaveText(new RegExp(`^${n(from + 1)}–${n(focus)} · `));
  });

  test('line, record and 10-base keys move the caret, extend with Shift, and always show the caret', async ({ page }) => {
    await openRecord(page, { seq: LONG_SEQUENCE });
    const line = await basesPerLine(page);
    const caretInView = () => page.evaluate(() => {
      const caret = document.querySelector('.motif-cs-seq-caret');
      const scroller = document.getElementById('motif-cs-sequence-view')!;
      if (!caret) return false;
      const box = caret.getBoundingClientRect();
      const frame = scroller.getBoundingClientRect();
      return box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1;
    });

    await clickBase(page, 15);
    await page.keyboard.press(KEYS.lineEnd);
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText(`Caret ${line}`);
    await page.keyboard.press(KEYS.lineStart);
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText('Caret 1');

    for (const key of KEYS.recordEnd) {
      await clickBase(page, 15);
      await page.keyboard.press(key);
      await expect(page.locator('.motif-cs-edit-hint'), key).toHaveText('Caret 6,001');
      expect(await caretInView(), `${key}: the caret is in view`).toBe(true);
      await page.keyboard.press(KEYS.recordStart[0]);
      await expect(page.locator('.motif-cs-edit-hint')).toHaveText('Caret 1');
      expect(await caretInView(), 'the caret is in view at the record start').toBe(true);
    }
    for (const key of KEYS.recordStart) {
      await page.keyboard.press(KEYS.recordEnd[0]);
      await page.keyboard.press(key);
      await expect(page.locator('.motif-cs-edit-hint'), key).toHaveText('Caret 1');
    }

    await clickBase(page, 15);
    await page.keyboard.press(KEYS.groupNext);
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText('Caret 21');
    await page.keyboard.press(KEYS.groupNext);
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText('Caret 31');
    await page.keyboard.press(KEYS.groupPrev);
    await page.keyboard.press(KEYS.groupPrev);
    await expect(page.locator('.motif-cs-edit-hint')).toHaveText('Caret 11');
    await page.keyboard.press(`Shift+${KEYS.groupNext}`);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^11–20 · 10 bp/);

    await clickBase(page, 15);
    await page.keyboard.press(`Shift+${KEYS.recordEnd[0]}`);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^16–6,000 · 5,985 bp/);
    await page.keyboard.press(`Shift+${KEYS.recordStart[0]}`);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^1–15 · 15 bp/);
  });

  test('on a circular record Shift+Left past base 1 continues across the origin, as a map drag can', async ({ page }) => {
    await openRecord(page, { topology: 'circular' });
    await clickBase(page, 2);
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^359–2 · 4 bp · across the origin/);
    const lines = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#motif-cs-sequence-view .motif-cs-seq-hl:not(.motif-cs-seq-hl-restriction)')]
      .map((tint) => Number(tint.closest<HTMLElement>('.motif-cs-seq-bases')?.dataset.lineStart)));
    const line = await basesPerLine(page);
    expect(new Set(lines), 'the tint is on the first and the last line').toEqual(new Set([0, Math.floor(359 / line) * line]));
    await expect(page.locator('.motif-cs-map-frame .motif-pm-selection').first()).toBeVisible();
    // And back over the origin, one base at a time.
    for (let step = 0; step < 3; step += 1) await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^2–2 · 1 bp/);
  });

  test('Space and modified scroll keys the sequence does not use neither scroll nor edit it', async ({ page }) => {
    await openRecord(page, { seq: LONG_SEQUENCE });
    await clickBase(page, 15);
    const before = await readout(page);
    for (const key of ['Space', 'Shift+Space', ...KEYS.unusedScroll]) {
      await page.keyboard.press(key);
      // Keyboard scrolling is animated; give it time to show before reading.
      await page.waitForTimeout(300);
      const after = await readout(page);
      expect(after.scroll, `${key} did not scroll`).toEqual(before.scroll);
      expect(after.seq, `${key} did not edit`).toBe(before.seq);
      expect(after.caret, `${key} did not move the caret`).toBe(before.caret);
    }
  });

  test('Replace mode marks the base the next letter replaces; Insert mode keeps the bar between bases', async ({ page }) => {
    await openRecord(page);
    const glyphBox = () => page.locator('.motif-cs-seq-glyphs').first().boundingBox();
    const resting = await glyphBox();
    await clickBase(page, 10);
    const base = await basePoint(page, 10);
    const marker = page.locator('.motif-cs-seq-caret');
    await expect(marker).toHaveAttribute('data-mode', 'replace');
    const replaceBox = (await marker.boundingBox())!;
    expect(Math.abs(replaceBox.x - base.left), 'the mark starts at the base').toBeLessThanOrEqual(0.5);
    expect(Math.abs(replaceBox.width - base.width), 'the mark is one base wide').toBeLessThanOrEqual(0.5);
    expect(replaceBox.height).toBeLessThanOrEqual(3);
    // Under the letter, never across it.
    const inkBottom = await page.evaluate(() => {
      const glyphs = document.querySelector<HTMLElement>('.motif-cs-seq-glyphs')!;
      const style = getComputedStyle(glyphs);
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = context.measureText('ACGTN');
      const lineHeight = parseFloat(style.lineHeight);
      const content = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
      const baseline = glyphs.getBoundingClientRect().top + (lineHeight - content) / 2 + metrics.fontBoundingBoxAscent;
      return baseline + Math.max(0, metrics.actualBoundingBoxDescent);
    });
    expect(replaceBox.y, 'the mark sits below the letters').toBeGreaterThanOrEqual(inkBottom);
    const row = (await page.locator('.motif-cs-seq-glyphs').first().boundingBox())!;
    expect(replaceBox.y + replaceBox.height, 'the mark stays inside the row of bases').toBeLessThanOrEqual(row.y + row.height + 0.5);
    expect(await glyphBox(), 'no letter moved').toEqual(resting);

    await page.getByRole('button', { name: 'Typing mode: Replace. Switch to Insert', exact: true }).click();
    await expect(page.locator('button.motif-cs-edit-mode-toggle')).toHaveAttribute('data-mode', 'insert');
    await expect(marker).toHaveAttribute('data-mode', 'insert');
    const insertBox = (await marker.boundingBox())!;
    expect(insertBox.width).toBeLessThanOrEqual(2.5);
    expect(Math.abs(insertBox.x + insertBox.width / 2 - base.left), 'the bar sits between bases').toBeLessThanOrEqual(1);
    expect(await glyphBox(), 'no letter moved').toEqual(resting);

    // A range shows no caret at all.
    await clickBase(page, 12, true);
    await expect(marker).toHaveCount(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the Replace mark meets 3:1 against the row and the letter above it keeps 4.5:1 in ${theme}`, async ({ page }) => {
      await openRecord(page);
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await clickBase(page, 10);
      await expect(page.locator('.motif-cs-seq-caret')).toHaveAttribute('data-mode', 'replace');
      const contrast = await page.locator('.motif-cs-seq-caret').evaluate((caret) => {
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
        const row = rgb(getComputedStyle(caret.closest('.motif-cs-sequence')!).backgroundColor);
        const mark = rgb(getComputedStyle(caret).backgroundColor);
        const letter = rgb(getComputedStyle(caret.closest('.motif-cs-seq-bases')!.querySelector('.motif-cs-seq-glyphs')!).color);
        return { mark: ratio(mark, row), letter: ratio(letter, row), opacity: Number(getComputedStyle(caret).opacity) };
      });
      expect(contrast.opacity, 'the mark is drawn at full strength while the view has focus').toBe(1);
      expect(contrast.mark, `mark against the row in ${theme}`).toBeGreaterThanOrEqual(3);
      expect(contrast.letter, `letter against the row in ${theme}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('adding a feature by keyboard: the suggested name is selected, Enter saves and returns to the sequence, Cmd/Ctrl+Z undoes it', async ({ page }) => {
    await openRecord(page);
    await clickBase(page, 200);
    await clickBase(page, 259, true);
    await page.getByRole('button', { name: 'Add feature', exact: true }).click();
    const name = page.locator('input[name="feature-name"]').first();
    await expect(name).toBeFocused();
    const suggestion = await name.inputValue();
    expect(suggestion).toMatch(/_\d+$/);
    expect(await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, suggestion.length]);
    await page.keyboard.type('TagA');
    await expect(name).toHaveValue('TagA');
    await page.keyboard.press('Enter');
    await expect(view(page)).toBeFocused();
    const names = () => page.evaluate(() => (window.motifGetInventory()[0]?.annotations ?? []).map((feature) => String(feature.name)));
    await expect.poll(names).toContain('TagA');
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(names).not.toContain('TagA');
  });

  test('Escape in a new feature\'s name cancels it and returns the keyboard to the sequence', async ({ page }) => {
    await openRecord(page);
    await clickBase(page, 200);
    await clickBase(page, 259, true);
    await page.getByRole('button', { name: 'Add feature', exact: true }).click();
    const name = page.locator('input[name="feature-name"]').first();
    await expect(name).toBeFocused();
    await page.keyboard.type('Nope');
    await page.keyboard.press('Escape');
    await expect(view(page)).toBeFocused();
    const names = await page.evaluate(() => (window.motifGetInventory()[0]?.annotations ?? []).map((feature) => String(feature.name)));
    expect(names).not.toContain('Nope');
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(0);
  });

  test('Escape acts where the keyboard is: the find bar closes before the Translation window, and the selection clears last', async ({ page }) => {
    await openRecord(page, { width: 1180 });
    await clickBase(page, 20);
    await clickBase(page, 31, true);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^21–32 · 12 bp/);
    await page.getByRole('button', { name: 'Translations window off' }).click();
    const translation = page.getByRole('dialog', { name: 'Translation' });
    await expect(translation).toBeVisible();
    await view(page).focus();
    await page.keyboard.press(`${MOD}+f`);
    const findBar = page.getByRole('search', { name: 'Find in sequence' });
    const field = findBar.getByRole('searchbox');
    await expect(field).toBeFocused();
    await page.keyboard.type('GGAG');

    await page.keyboard.press('Escape');
    await expect(findBar, 'the first Escape closes the find bar').toHaveCount(0);
    await expect(translation, 'the Translation window stays open').toBeVisible();
    await expect(view(page), 'the keyboard is back in the sequence').toBeFocused();
    await expect(page.locator('.motif-cs-selection-name')).toHaveText(/^21–32 · 12 bp/);

    await page.keyboard.press('Escape');
    await expect(translation, 'the second Escape closes the window').toHaveCount(0);
    await expect(page.locator('.motif-cs-selection-name'), 'the selection stays').toHaveText(/^21–32 · 12 bp/);

    await page.keyboard.press('Escape');
    await expect(page.locator('.motif-cs-selection-name'), 'the third Escape clears the selection').not.toHaveText(/^21–32/);
  });

  test('with the keyboard in the Translation window, Escape closes the window and leaves the find bar open', async ({ page }) => {
    await openRecord(page, { width: 1180 });
    await clickBase(page, 20);
    await page.keyboard.press(`${MOD}+f`);
    const findBar = page.getByRole('search', { name: 'Find in sequence' });
    await expect(findBar.getByRole('searchbox')).toBeFocused();
    await page.getByRole('button', { name: 'Translations window off' }).click();
    const translation = page.getByRole('dialog', { name: 'Translation' });
    await expect(translation).toBeVisible();
    await translation.locator('.motif-cs-window-head').focus();
    await page.keyboard.press('Escape');
    await expect(translation).toHaveCount(0);
    await expect(findBar).toBeVisible();
  });

  test('Cmd/Ctrl+C copies the selected feature or range, not the invisible line a right-click selects in the bases', async ({ page }) => {
    await openRecord(page, { tracks: true });
    const primer = page.locator('.motif-cs-feature-block').filter({ hasText: 'primer site' }).first();
    // The right-click lands on a base inside the selection: one outside it
    // moves the caret there first, as a click does.
    const cases: Array<[string, () => Promise<void>, RegExp, string, number]> = [
      ['a selected feature', () => primer.click(), /primer site/, SEQUENCE.slice(40, 60), 50],
      ['a range', async () => { await clickBase(page, 100); await clickBase(page, 119, true); }, /^101–120 · 20 bp/, SEQUENCE.slice(100, 120), 110],
    ];
    for (const [what, select, label, bases, inside] of cases) {
      await page.keyboard.press('Escape');
      await select();
      await expect(page.locator('.motif-cs-selection-name')).toHaveText(label);
      const point = await basePoint(page, inside);
      await page.mouse.click(point.x, point.y, { button: 'right' });
      // macOS selects the word under a right-click, and a line of bases is one
      // word, but the menu the right-click opens takes focus and that selection
      // can go with it. Make the same selection the way a triple-click would.
      await page.evaluate(() => {
        const glyphs = [...document.querySelectorAll('#motif-cs-sequence-view .motif-cs-seq-glyphs')][1];
        window.getSelection()?.selectAllChildren(glyphs!);
      });
      const stray = await page.evaluate(() => window.getSelection()?.toString() ?? '');
      expect(stray.length, `${what}: the right-click left a native selection in the bases`).toBeGreaterThan(0);
      await expect(page.locator('.motif-cs-selection-name'), `${what}: the right-click kept the selection`).toHaveText(label);
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.keyboard.press(`${MOD}+c`);
      await expect.poll(() => clipboardText(page), `${what}: the bases of the selection are copied`).toBe(bases);
    }
  });

  test('when the clipboard API refuses, a copy by Cmd/Ctrl+C or the Copy button still leaves the keyboard in the sequence', async ({ page }) => {
    // The copy then goes through a hidden text field, which must not take focus
    // with it and leave the page body focused.
    await page.addInitScript(() => {
      if (navigator.clipboard) navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await openRecord(page);
    const name = page.locator('.motif-cs-selection-name');
    const notice = page.locator('.motif-cs-workbench-notice');
    for (const trigger of ['keys', 'button'] as const) {
      await clickBase(page, 10);
      for (let step = 0; step < 5; step += 1) await page.keyboard.press('Shift+ArrowRight');
      await expect(name).toHaveText(/^11–15 · 5 bp/);
      if (trigger === 'keys') await page.keyboard.press(`${MOD}+c`);
      else {
        const box = (await page.locator('.motif-cs-selection-actions button[title="Copy selection (Cmd/Ctrl+C)"]').boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      await expect(notice.filter({ hasText: 'Selection copied' }), `${trigger}: the fallback copy ran`).toHaveCount(1);
      await expect(view(page), `${trigger}: the keyboard is still in the sequence`).toBeFocused();
      await page.keyboard.press('Shift+ArrowRight');
      await expect(name, `${trigger}: the next Shift+Right extends the selection`).toHaveText(/^11–16 · 6 bp/);
      await page.keyboard.press('Escape');
    }
  });

  test('a text selection the user can see outside the sequence keeps its own Cmd/Ctrl+C', async ({ page }) => {
    await openRecord(page, { tracks: true });
    await page.locator('.motif-cs-feature-block').filter({ hasText: 'primer site' }).first().click();
    await page.locator('.motif-cs-sequence-meta').first().click({ clickCount: 3 });
    const chosen = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(chosen.trim().length, 'the triple-click selected the line of text').toBeGreaterThan(0);
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.keyboard.press(`${MOD}+c`);
    await expect.poll(() => clipboardText(page)).toBe(chosen);
  });

  test('a selected restriction site copies its bases with Cmd/Ctrl+C, the Copy button and Cmd/Ctrl+X, and stays a site', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    const pUC19 = page.locator('.motif-cs-record-tab').filter({ hasText: 'pUC19' }).first();
    if ((await pUC19.getAttribute('data-active')) !== 'true') await pUC19.click();
    const before = (await readout(page)).seq;
    expect(before.slice(395, 401), 'EcoRI sits at 396 in pUC19').toBe('GAATTC');
    const cluster = page.locator('.motif-cs-map-frame .motif-pm-restriction').filter({ has: page.locator('title', { hasText: 'HindIII' }) }).first();
    await cluster.locator('tspan[data-enzyme="EcoRI"]').click();
    const label = page.locator('.motif-cs-selection-name');
    await expect(label).toHaveText('EcoRI site · 396');

    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.keyboard.press(`${MOD}+c`);
    await expect.poll(() => clipboardText(page), 'Cmd/Ctrl+C').toBe('GAATTC');
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText('EcoRI site copied');

    const copy = page.getByRole('button', { name: 'Copy', exact: true });
    await expect(copy).toBeEnabled();
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await copy.click();
    await expect.poll(() => clipboardText(page), 'the Copy button').toBe('GAATTC');
    await expect(view(page), 'a pointer click on Copy hands the keyboard to the sequence').toBeFocused();
    await expect(label).toHaveText('EcoRI site · 396');

    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.keyboard.press(`${MOD}+x`);
    await expect.poll(() => clipboardText(page), 'Cmd/Ctrl+X').toBe('GAATTC');
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText('Nothing was removed');
    expect((await readout(page)).seq, 'cut removes nothing from a site').toBe(before);
    await expect(label).toHaveText('EcoRI site · 396');

    // Several sites have no one set of bases: Copy stays disabled and its title
    // says why, and Cmd/Ctrl+C leaves the clipboard alone.
    await cluster.locator('tspan:not([data-enzyme])').click();
    await page.getByRole('menuitem', { name: /^All 10 enzymes/ }).click();
    await expect(label).toHaveText('10 enzymes · 10 sites');
    await expect(copy).toBeDisabled();
    await expect(copy).toHaveAttribute('title', 'Select one site to copy its bases');
    await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
    await page.keyboard.press(`${MOD}+c`);
    expect(await clipboardText(page), 'Cmd/Ctrl+C copies nothing from several sites').toBe('unchanged');
  });

  test('after a pick on the map, Shift+click extends from it, and a range across the origin keeps crossing it', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    const pUC19 = page.locator('.motif-cs-record-tab').filter({ hasText: 'pUC19' }).first();
    if ((await pUC19.getAttribute('data-active')) !== 'true') await pUC19.click();
    const length = (await readout(page)).seq.length;
    const label = page.locator('.motif-cs-selection-name');
    const shiftClickBase = async (index: number) => {
      await page.evaluate((target) => {
        const rows = [...document.querySelectorAll<HTMLElement>('#motif-cs-sequence-view .motif-cs-seq-bases')];
        rows.find((row) => target >= Number(row.dataset.lineStart) && target < Number(row.dataset.lineStart) + Number(row.dataset.lineLen))
          ?.scrollIntoView({ block: 'center' });
      }, index);
      await clickBase(page, index, true);
    };

    // A feature picked on the map.
    const lacZ = page.locator('.motif-pm-feature[aria-label^="lacZ-alpha"]').first();
    const lacZPoint = await lacZ.locator('.motif-pm-feature-hit').evaluate((path) => {
      const hit = path as SVGPathElement;
      const point = hit.getPointAtLength(hit.getTotalLength() * 0.05).matrixTransform(hit.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(lacZPoint.x, lacZPoint.y);
    await expect(label).toContainText('lacZ-alpha · 146–469');
    await shiftClickBase(499);
    await expect(label).toHaveText(/^146–500 · 355 bp/);
    // With the keyboard moved to the sequence, Shift+arrows start from it too.
    await page.keyboard.press('Escape');
    await page.mouse.click(lacZPoint.x, lacZPoint.y);
    await expect(label).toContainText('lacZ-alpha · 146–469');
    await view(page).focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(label).toHaveText(/^146–470 · 325 bp/);

    // A range dragged on the map across the origin, then Shift+click.
    const ring = await page.locator('.motif-cs-map-frame .motif-pm-backbone').first().evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { cx: box.left + box.width / 2, cy: box.top + box.height / 2, r: box.width / 2 };
    });
    const onRing = (degrees: number) => ({
      x: ring.cx + ring.r * Math.sin((degrees * Math.PI) / 180),
      y: ring.cy - ring.r * Math.cos((degrees * Math.PI) / 180),
    });
    const dragAcrossOrigin = async () => {
      await page.keyboard.press('Escape');
      const from = onRing(-30);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let degrees = -28; degrees <= 14; degrees += 2) await page.mouse.move(onRing(degrees).x, onRing(degrees).y);
      await page.mouse.up();
      await expect(label).toHaveText(/ · across the origin$/);
      const [start] = ((await label.textContent()) ?? '').match(/^[\d,]+/)!;
      return Number(start.replace(/,/g, ''));
    };
    const readoutOf = (first: number, last: number, bases: number, across: boolean) =>
      `${first.toLocaleString('en-US')}–${last.toLocaleString('en-US')} · ${bases.toLocaleString('en-US')} bp${across ? ' · across the origin' : ''}`;

    let start = await dragAcrossOrigin();
    await shiftClickBase(499);
    await expect(label, 'past the end: on across the origin to the base').toHaveText(readoutOf(start, 500, length - start + 1 + 500, true));

    start = await dragAcrossOrigin();
    await shiftClickBase(49);
    await expect(label, 'inside, past the origin: still across it').toHaveText(readoutOf(start, 50, length - start + 1 + 50, true));

    start = await dragAcrossOrigin();
    await shiftClickBase(start - 64);
    await expect(label, 'just before the start: back to the base').toHaveText(readoutOf(start - 63, start - 1, 63, false));
  });
});
