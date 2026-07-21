import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Real-mouse interaction coverage for the MSA viewer: selection, hover readout,
// context menu, colour/shade schemes, histogram tracks, and layout across widths.
// The dedicated config sets MOTIF_MSA_E2E=1; the shared claude-science-*.spec.ts
// run leaves it unset and therefore never picks this suite up.
test.describe('Motif MSA viewer interactions', () => {
  test.skip(!process.env.MOTIF_MSA_E2E, 'Set MOTIF_MSA_E2E=1 and use e2e/playwright.msa.config.ts');

  const fatal: string[] = [];
  test.beforeEach(async ({ page }) => {
    fatal.length = 0;
    page.on('pageerror', (error) => fatal.push(`pageerror: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') fatal.push(`console.error: ${message.text()}`); });
  });
  test.afterEach(() => { expect(fatal).toEqual([]); });

  async function setup(page: Page, width = 1440, height = 980, alignmentLength = 120, rowCount = 5) {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
    await page.goto('/motif.html');
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await page.evaluate(({ requestedLength, requestedRows }) => {
      const AA = 'ACDEFGHIKLMNPQRSTVWY';
      const L = requestedLength;
      const base = Array.from({ length: L }, (_, i) => AA[(i * 7) % 20]);
      const names = Array.from({ length: requestedRows }, (_, row) => row === 0 ? 'ref' : `v${row}`);
      const fasta = names.map((name, row) => {
        const seq = base.slice();
        if (row > 0) for (let i = 0; i < L; i += 1) { if ((i * (row + 3)) % 5 === 0) seq[i] = AA[(i * (row + 1)) % 20]; }
        if (row === 2) for (let i = 40; i < 50; i += 1) seq[i] = '-';
        return `>${name}\n${seq.join('')}`;
      }).join('\n') + '\n';
      const api = (window as unknown as { motifAddAlignments?: (a: unknown) => number }).motifAddAlignments;
      if (!api) throw new Error('motifAddAlignments unavailable');
      api({ name: 'E2E protein panel', molecule: 'protein', alignedFasta: fasta });
    }, { requestedLength: alignmentLength, requestedRows: rowCount });
    // The launch button lives in the (collapsed) Tools rail; dispatch the click
    // directly since this spec exercises the viewer, not rail navigation.
    await page.getByTestId('msa-open-button').dispatchEvent('click');
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();
  }

  async function setupDna(page: Page, width = 1440, height = 980) {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
    await page.goto('/motif.html');
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await page.evaluate(() => {
      const base = 'ATGGCTTGGAAAGATTTCCACCCTGTACGTGAATCA'.repeat(4).slice(0, 120); // 120 nt, starts ATG
      const fasta = ['ref', 'v1', 'v2', 'v3'].map((name, row) => {
        const seq = base.split('');
        if (row > 0) for (let i = 0; i < seq.length; i += 1) { if ((i * (row + 3)) % 7 === 0) seq[i] = 'ACGT'[(i * (row + 1)) % 4]; }
        return `>${name}\n${seq.join('')}`;
      }).join('\n') + '\n';
      const api = (window as unknown as { motifAddAlignments?: (a: unknown) => number }).motifAddAlignments;
      if (!api) throw new Error('motifAddAlignments unavailable');
      api({ name: 'E2E DNA panel', molecule: 'dna', alignedFasta: fasta });
    });
    await page.getByTestId('msa-open-button').dispatchEvent('click');
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();
  }

  function cell(page: Page, rowIndex: number, column: number) {
    return page.locator(`.motif-cs-msa-matrix-row[data-msa-row-index="${rowIndex}"] .motif-cs-msa-symbol`).nth(column);
  }

  async function center(page: Page, rowIndex: number, column: number) {
    const box = await cell(page, rowIndex, column).boundingBox();
    if (!box) throw new Error(`cell ${rowIndex},${column} has no box`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async function selectedColumnRange(page: Page): Promise<{ start: number; end: number }> {
    const text = await page.getByTestId('msa-selection-readout').textContent();
    const match = text?.match(/cols\s+([\d,]+)–([\d,]+)/);
    if (!match) throw new Error(`selection range missing from readout: ${text ?? ''}`);
    return {
      start: Number(match[1].replaceAll(',', '')),
      end: Number(match[2].replaceAll(',', '')),
    };
  }

  function activeGridCell(page: Page) {
    return page.locator('[data-msa-grid-cell="true"][data-active-cell="true"]');
  }

  test('reference coordinates and strict ambiguity mode work through the saved-result UI', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.addInitScript(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
    await page.goto('/motif.html');
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await page.evaluate(() => {
      const api = (window as unknown as { motifAddAlignments?: (a: unknown) => number }).motifAddAlignments;
      if (!api) throw new Error('motifAddAlignments unavailable');
      api({
        id: 'reference-coordinate-e2e',
        name: 'Reference coordinate E2E',
        molecule: 'dna',
        referenceRowId: 'reference',
        referenceNumbering: { rowId: 'reference', firstResiduePosition: 100 },
        rows: [
          { id: 'reference', name: 'Reference', aligned: 'AC--GTACGTAC' },
          { id: 'read', name: 'Read', aligned: 'RCTTGTACGTAC' },
        ],
      });
    });
    await page.getByTestId('msa-open-button').dispatchEvent('click');
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();

    const referenceAxis = page.getByRole('row', { name: 'Reference positions for Reference' });
    await expect(referenceAxis).toBeVisible();
    await expect(referenceAxis.locator('[data-reference-coordinate="101B"]')).toBeVisible();
    const compatibleCell = page.locator('[data-msa-row-id="read"] [data-alignment-column="1"]');
    await expect(compatibleCell).toHaveAttribute('data-cell-outcome', 'ambiguous');
    await expect(compatibleCell).toHaveAttribute('aria-label', /reference position 100/);

    await page.getByTestId('msa-goto-menu-button').click();
    await page.getByTestId('msa-coordinate-system').selectOption('template');
    const coordinateInput = page.getByTestId('msa-coordinate-input');
    await expect(coordinateInput).toHaveAttribute('type', 'text');
    await coordinateInput.fill('101b');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(page.locator('[data-msa-row-id="reference"] [data-alignment-column="4"]')).toHaveAttribute('data-jump', 'true');

    await page.getByTestId('msa-view-menu-button').click();
    await expect(page.getByTestId('msa-reference-numbering-editor')).toContainText('On');
    await page.getByRole('checkbox', { name: 'Strict differences' }).check();
    await expect(compatibleCell).toHaveAttribute('data-cell-outcome', 'substitution');

    await page.getByTestId('msa-clear-reference-numbering').click();
    await expect(page.getByRole('row', { name: 'Template positions for Reference' })).toBeVisible();
    await expect(page.getByTestId('msa-reference-numbering-editor')).toContainText('Plain 1-based');
  });

  test('keyboard arrows move the active gridcell and announce its residue', async ({ page }) => {
    await setup(page);
    const initial = activeGridCell(page);
    await expect(initial).toHaveAttribute('data-alignment-column', '1');
    await initial.focus();
    await page.keyboard.press('ArrowRight');

    const moved = activeGridCell(page);
    await expect(moved).toBeFocused();
    await expect(moved).toHaveAttribute('data-alignment-column', '2');
    await expect(moved).toHaveAttribute('aria-label', 'Residue I, alignment column 2, row ref');
  });

  test('clicking a residue leaves the keyboard able to move from it', async ({ page }) => {
    await setup(page);
    // Deliberately no .focus() call anywhere in this test — that is the whole point.
    // Every other keyboard test here focuses the cell first, which is exactly why the
    // grid could ship with arrows dead after a click: the click left DOM focus on the
    // window container, keydown never reached the matrix, and getting back in by
    // keyboard took 30 tab stops.
    const target = page.locator('[data-msa-grid-cell="true"]').nth(120);
    const column = await target.getAttribute('data-alignment-column');
    await target.click();

    const clicked = activeGridCell(page);
    await expect(clicked).toBeFocused();
    await expect(clicked).toHaveAttribute('data-alignment-column', column!);

    await page.keyboard.press('ArrowRight');
    await expect(activeGridCell(page)).toHaveAttribute(
      'data-alignment-column',
      String(Number(column) + 1),
    );
  });

  test('Shift plus Arrow extends the keyboard selection from its anchor', async ({ page }) => {
    await setup(page);
    await activeGridCell(page).focus();
    await page.keyboard.press('Shift+ArrowRight');

    await expect(activeGridCell(page)).toHaveAttribute('data-alignment-column', '2');
    const readout = page.getByTestId('msa-selection-readout');
    await expect(readout).toContainText('cols 1–2');
    await expect(readout).toContainText('1 row');
  });

  test('Home End and Control Home navigate row and grid boundaries', async ({ page }) => {
    await setup(page);
    await activeGridCell(page).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await expect(activeGridCell(page)).toHaveAttribute('data-alignment-column', '120');
    await expect(activeGridCell(page).locator('xpath=..').locator('xpath=..')).toHaveAttribute('data-msa-row-index', '1');

    await page.keyboard.press('Home');
    await expect(activeGridCell(page)).toHaveAttribute('data-alignment-column', '1');
    await expect(activeGridCell(page).locator('xpath=..').locator('xpath=..')).toHaveAttribute('data-msa-row-index', '1');

    await page.keyboard.press('End');
    await page.keyboard.press('Control+Home');
    await expect(activeGridCell(page)).toBeFocused();
    await expect(activeGridCell(page)).toHaveAttribute('data-alignment-column', '1');
    await expect(activeGridCell(page).locator('xpath=..').locator('xpath=..')).toHaveAttribute('data-msa-row-index', '0');
  });

  test('Shift F10 opens selection actions at the active gridcell', async ({ page }) => {
    await setup(page);
    await activeGridCell(page).focus();
    await page.keyboard.press('Shift+F10');

    const menu = page.getByRole('menu', { name: 'Alignment selection actions' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Copy selection \(FASTA\)/ })).toBeVisible();
    await expect(page.getByTestId('msa-selection-readout')).toContainText('cols 1–1');
  });

  test('sequence search transfers focus to the matched gridcell', async ({ page }) => {
    await setup(page);
    const input = page.getByTestId('msa-search-input');
    await input.fill('AIRCK');
    await input.press('Enter');

    const active = activeGridCell(page);
    await expect(active).toBeFocused();
    await expect(active).toHaveAttribute('data-search-active', 'true');
    await expect(active).toHaveAttribute('aria-label', /Residue R, alignment column 3, row ref/);
  });

  test('drag selects a rectangular block and reports selection stats', async ({ page }) => {
    await setup(page);
    const start = await center(page, 0, 8);
    const end = await center(page, 3, 34);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('.motif-cs-msa-selection-band')).toBeVisible();
    const readout = page.getByTestId('msa-selection-readout');
    await expect(readout).toContainText('Selected');
    await expect(readout).toContainText(/cols \d+–\d+/);
    await expect(readout).toContainText('4 rows');
    // Rows 0..3 marked selected.
    await expect(page.locator('.motif-cs-msa-matrix-row[data-selected="true"]')).toHaveCount(4);

    // Escape clears the selection without closing the whole MSA window.
    await page.keyboard.press('Escape');
    await expect(page.locator('.motif-cs-msa-selection-band')).toHaveCount(0);
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();
  });

  test('Escape dismisses a covering tools panel before the window underneath', async ({ page }) => {
    // The window listens in capture on window and stops propagation, so without
    // an explicit guard it closed itself and left the panel covering the space.
    await setup(page);
    const panel = page.locator('.motif-cs-inspector details[name="motif-cs-tools"]').first();
    await panel.locator(':scope > summary').click();
    await expect(panel).toHaveAttribute('open', '');

    await page.keyboard.press('Escape');
    await expect(panel).not.toHaveAttribute('open', '');
    // The window — and the view state inside it — survives the first press.
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.motif-cs-window')).toHaveCount(0);
  });

  test('the position axes share one row until the template gains a gap', async ({ page }) => {
    // An ungapped template prints the same number as the alignment axis in every
    // column, so two rows carry one row of information.
    await setup(page);
    const rulerRows = page.locator('.motif-cs-msa-ruler-row');
    await expect(rulerRows).toHaveCount(1);
    await expect(rulerRows.locator('.motif-cs-msa-ruler-label')).toContainText('Alignment / template');

    // Turning the template axis off leaves the row, minus the template's name —
    // the View menu checkbox must never become a control with no visible effect.
    await page.getByTestId('msa-view-menu-button').click();
    await page.getByRole('checkbox', { name: /Template axis/i }).setChecked(false);
    await expect(rulerRows).toHaveCount(1);
    await expect(rulerRows.locator('.motif-cs-msa-ruler-label')).toHaveText('Alignment position');
    await page.getByRole('checkbox', { name: /Template axis/i }).setChecked(true);
    await expect(rulerRows.locator('.motif-cs-msa-ruler-label')).toContainText('Alignment / template');
  });

  test('a gapped template keeps its own position axis', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
    await page.goto('/motif.html');
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await page.evaluate(() => {
      const api = (window as unknown as { motifAddAlignments?: (a: unknown) => number }).motifAddAlignments;
      if (!api) throw new Error('motifAddAlignments unavailable');
      // The template's gap makes its coordinates diverge from the alignment's.
      api({
        name: 'Gapped template',
        molecule: 'protein',
        alignedFasta: '>ref\nACDE----FGHIKLMNPQRS\n>v1\nACDEWWWWFGHIKLMNPQRS\n>v2\nACDEWWWWFGHIKLMNPQRA\n',
      });
    });
    await page.getByTestId('msa-open-button').dispatchEvent('click');
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();

    await expect(page.locator('.motif-cs-msa-ruler-row')).toHaveCount(2);
    await expect(page.locator('.motif-cs-msa-template-ruler-row')).toBeVisible();
  });

  test('Escape still closes the window when Tools is docked beside it', async ({ page }) => {
    // Docked tools use the same markup as the rail popover but sit beside the
    // window rather than over it, and their own Escape handler is not registered.
    // Deferring to them there would leave Escape doing nothing at all.
    await setup(page);
    await page.locator('[data-pane-toggle="tools"]').click();
    await expect(page.locator('.motif-cs-inspector')).toHaveAttribute('data-tools-pinned', 'true');

    const docked = page.locator('.motif-cs-inspector details[name="motif-cs-tools"]').first();
    await docked.locator(':scope > summary').click();
    await expect(docked).toHaveAttribute('open', '');

    await page.keyboard.press('Escape');
    await expect(page.locator('.motif-cs-window')).toHaveCount(0);
  });

  test('grid drag past the right edge auto-scrolls into far columns', async ({ page }) => {
    await setup(page, 1000, 720);
    const scroll = page.locator('.motif-cs-msa-matrix-scroll');
    const scrollBox = await scroll.boundingBox();
    const start = await center(page, 1, 2);
    const initialVisibleText = await page.getByTestId('msa-horizontal-scroll').getAttribute('aria-valuetext');
    const initialVisibleEnd = Number(initialVisibleText?.match(/–(\d+) of/)?.[1] ?? 0);
    if (!scrollBox || initialVisibleEnd === 0) throw new Error('matrix scroll geometry missing');

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(scrollBox.x + scrollBox.width + 28, start.y);
    await page.waitForTimeout(450);
    expect(await scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await page.mouse.up();

    expect((await selectedColumnRange(page)).end).toBeGreaterThan(initialVisibleEnd);
  });

  test('grid pointerup past the edge resolves the final clamped cell', async ({ page }) => {
    await setup(page, 1000, 720);
    const scroll = page.locator('.motif-cs-msa-matrix-scroll');
    const scrollBox = await scroll.boundingBox();
    const start = await center(page, 1, 2);
    const lastMovedCell = await center(page, 1, 8);
    if (!scrollBox) throw new Error('matrix scroll geometry missing');

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(lastMovedCell.x, lastMovedCell.y);
    await scroll.dispatchEvent('pointerup', {
      bubbles: true,
      button: 0,
      clientX: scrollBox.x + scrollBox.width + 28,
      clientY: start.y,
      pointerId: 1,
      pointerType: 'mouse',
    });
    await page.mouse.up();

    const range = await selectedColumnRange(page);
    expect(range.start).toBe(3);
    expect(range.end).toBeGreaterThan(9);
  });

  test('clicking the alignment ruler selects a whole column', async ({ page }) => {
    await setup(page);
    const ruler = page.locator('.motif-cs-msa-ruler-window-clickable .motif-cs-msa-ruler-cell').nth(20);
    await ruler.click({ force: true });
    await expect(page.locator('.motif-cs-msa-selection-band')).toBeVisible();
    // Whole column = every row selected.
    await expect(page.locator('.motif-cs-msa-matrix-row[data-selected="true"]')).toHaveCount(5);
  });

  test('dragging across the ruler selects a full-height column range', async ({ page }) => {
    await setup(page);
    const cells = page.locator('.motif-cs-msa-ruler-window-clickable .motif-cs-msa-ruler-cell');
    const a = await cells.nth(6).boundingBox();
    const b = await cells.nth(28).boundingBox();
    if (!a || !b) throw new Error('ruler cells not found');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
    // A ruler drag selects a column range spanning every row.
    await expect(page.locator('.motif-cs-msa-matrix-row[data-selected="true"]')).toHaveCount(5);
    const readout = page.getByTestId('msa-selection-readout');
    await expect(readout).toContainText('5 rows');
    await expect(readout).toContainText(/cols \d+–\d+/);
  });

  test('hover shows a crosshair column and floating residue readout', async ({ page }) => {
    await setup(page);
    const spot = await center(page, 1, 18);
    await page.mouse.move(spot.x, spot.y);
    await expect(page.locator('.motif-cs-msa-hover-column')).toBeVisible();
    const readout = page.locator('.motif-cs-msa-hover-readout');
    await expect(readout).toBeVisible();
    await expect(readout).toContainText('col 19');
    await expect(page.locator('.motif-cs-msa-matrix-row[data-hover="true"]')).toHaveCount(1);
  });

  test('right-click opens the selection context menu', async ({ page }) => {
    await setup(page);
    const spot = await center(page, 0, 12);
    await page.mouse.click(spot.x, spot.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Alignment selection actions' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Copy selection \(FASTA\)/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Copy without gaps/ })).toBeVisible();
    // Escape closes it.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('context menu stays within the viewport when opened near the edge', async ({ page }) => {
    // A narrow window puts the sequence area's right edge close to the viewport
    // edge, so a raw-coordinate menu would overflow off-screen without clamping.
    await setupDna(page, 720, 620);
    const vp = page.viewportSize()!;
    const scrollBox = await page.locator('.motif-cs-msa-matrix-scroll').boundingBox();
    const rowBox = await page.locator('.motif-cs-msa-matrix-row').first().boundingBox();
    if (!scrollBox || !rowBox) throw new Error('matrix layout boxes missing');
    // Click just inside the sequence area's right edge, clear of the vertical
    // scrollbar (~18px), over the first row.
    const spot = { x: Math.min(scrollBox.x + scrollBox.width - 30, vp.width - 30), y: rowBox.y + rowBox.height / 2 };
    // Precondition: the anchor is within a menu-width of the right edge, so the
    // unclamped menu (min-width 200px) really would overflow the viewport.
    expect(spot.x).toBeGreaterThan(vp.width - 190);
    await page.mouse.click(spot.x, spot.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Alignment selection actions' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    if (!box) throw new Error('context menu has no box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
    // It flipped in from the right edge rather than anchoring at the click point.
    expect(box.x).toBeLessThan(spot.x);
    // Its own bounded overflow must remain usable; the captured window scroll
    // listener may dismiss anchored menus for outside scrolls, but not this one.
    await menu.evaluate((element) => element.dispatchEvent(new Event('scroll')));
    await expect(menu).toBeVisible();
  });

  test('context menu remains scrollable when constrained below its content height', async ({ page }) => {
    await setupDna(page, 720, 620);
    // Force the same bounded-overflow state as a very short/zoomed viewport
    // without making the alignment cell itself unhit-testable.
    await page.addStyleTag({ content: '.motif-cs-msa-context-menu { max-height: 96px !important; }' });
    const spot = await center(page, 0, 8);
    await page.mouse.click(spot.x, spot.y, { button: 'right' });

    const menu = page.getByRole('menu', { name: 'Alignment selection actions' });
    await expect(menu).toBeVisible();
    const overflow = await menu.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
    expect(overflow.clientHeight).toBeLessThanOrEqual(96);

    const lastAction = menu.getByRole('menuitem', { name: 'Clear selection' });
    await lastAction.scrollIntoViewIfNeeded();
    await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(lastAction).toBeVisible();
    await expect(menu).toBeVisible();
  });

  test('context menu dismisses when the matrix scrolls out from under it', async ({ page }) => {
    await setup(page);
    const spot = await center(page, 0, 12);
    await page.mouse.click(spot.x, spot.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Alignment selection actions' });
    await expect(menu).toBeVisible();
    // The menu is anchored to a cell's screen position; scrolling detaches it.
    await page.locator('.motif-cs-msa-matrix-scroll').evaluate((el) => { el.scrollLeft += 240; });
    await expect(menu).toHaveCount(0);
  });

  test('context menu dismisses on window resize', async ({ page }) => {
    await setup(page);
    const spot = await center(page, 0, 12);
    await page.mouse.click(spot.x, spot.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Alignment selection actions' });
    await expect(menu).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 760 });
    await expect(menu).toHaveCount(0);
  });

  test('a near-vertical wheel gesture is not hijacked into horizontal scroll', async ({ page }) => {
    // Enough rows that the matrix overflows vertically. The matrix sizes to its
    // panel and owns the vertical scroll, so the gesture is absorbed here rather
    // than delegated to a scrolling window body.
    await setup(page, 1440, 980, 120, 30);
    const scroll = page.locator('.motif-cs-msa-matrix-scroll');
    const spot = await center(page, 1, 10);
    await page.mouse.move(spot.x, spot.y);
    // A dominantly-horizontal gesture scrolls the columns.
    await page.mouse.wheel(180, 6);
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const afterHorizontal = await scroll.evaluate((el) => el.scrollLeft);
    const verticalBefore = await scroll.evaluate((el) => el.scrollTop);
    // A near-vertical gesture (tiny deltaX) must not change horizontal scroll —
    // its vertical delta is honoured instead of being swallowed as horizontal.
    await page.mouse.wheel(6, 160);
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(verticalBefore);
    expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(afterHorizontal);
  });

  test('vertical wheel input scrolls a tall matrix without shifting its columns', async ({ page }) => {
    await setup(page, 1440, 980, 120, 30);
    const scroll = page.locator('.motif-cs-msa-matrix-scroll');
    await expect.poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    const spot = await center(page, 1, 10);
    await page.mouse.move(spot.x, spot.y);
    const leftBefore = await scroll.evaluate((el) => el.scrollLeft);
    await page.mouse.wheel(4, 180);
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(leftBefore);
  });

  test('the hover readout clears when the matrix scrolls', async ({ page }) => {
    await setupDna(page);
    const spot = await center(page, 1, 10);
    await page.mouse.move(spot.x, spot.y);
    await expect(page.locator('.motif-cs-msa-hover-readout')).toBeVisible();
    // Scrolling moves the content out from under the fixed readout.
    await page.locator('.motif-cs-msa-matrix-scroll').evaluate((el) => { el.scrollLeft += 200; });
    await expect(page.locator('.motif-cs-msa-hover-readout')).toHaveCount(0);
  });

  test('conservation and occupancy histogram tracks render with bars', async ({ page }) => {
    await setup(page);
    // Conservation histogram is on by default; occupancy is opt-in.
    await expect(page.locator('.motif-cs-msa-hist-bar-conservation').first()).toBeVisible();
    await page.getByTestId('msa-view-menu-button').click();
    await page.getByRole('checkbox', { name: 'Occupancy' }).check();
    await expect(page.locator('.motif-cs-msa-hist-bar-occupancy').first()).toBeVisible();
  });

  test('colour scheme and mismatch shading apply to the matrix', async ({ page }) => {
    await setup(page);
    await page.getByTestId('msa-view-menu-button').click();
    await page.getByRole('checkbox', { name: 'Residue colors' }).check();
    await page.getByLabel('Colour scheme').selectOption('clustal');
    await page.getByLabel('Shade columns').selectOption('mismatch');
    const matrix = page.locator('.motif-cs-msa-matrix');
    await expect(matrix).toHaveAttribute('data-color-scheme', 'clustal');
    await expect(matrix).toHaveAttribute('data-shade', 'mismatch');
    await expect(page.locator('.motif-cs-msa-symbol[data-color-key^="cl-"]').first()).toBeVisible();
  });

  const rowIdAt = (page: Page, index: number) =>
    page.locator(`.motif-cs-msa-matrix-row[data-msa-row-index="${index}"]`).getAttribute('data-msa-row-id');
  const rowIds = (page: Page) =>
    page.locator('.motif-cs-msa-matrix-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-msa-row-id')));
  const gripForId = (page: Page, id: string) =>
    page.locator(`.motif-cs-msa-matrix-row[data-msa-row-id="${id}"] .motif-cs-msa-row-grip`);

  test('dragging a row grip reorders rows below the pinned template and offers a reset', async ({ page }) => {
    await setup(page);
    const templateId = await rowIdAt(page, 0);
    const movingId = await rowIdAt(page, 3);
    expect(movingId).not.toBe(templateId);
    // The template row has no reorder grip (it stays pinned).
    await expect(page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="0"] .motif-cs-msa-row-grip')).toHaveCount(0);

    const gripBox = await page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="3"] .motif-cs-msa-row-grip').boundingBox();
    const targetGrip = await page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="1"] .motif-cs-msa-row-grip').boundingBox();
    if (!gripBox || !targetGrip) throw new Error('row grips not found');

    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    // Drop into the top half of row 1 → insert before it (just below the template).
    await page.mouse.move(targetGrip.x + targetGrip.width / 2, targetGrip.y + 3, { steps: 12 });
    await expect(page.locator('.motif-cs-msa-matrix-row[data-drop-before="true"]')).toHaveCount(1);
    await page.mouse.up();

    // The template is still pinned at 0; the dragged row lands just below it.
    expect(await rowIdAt(page, 0)).toBe(templateId);
    expect(await rowIdAt(page, 1)).toBe(movingId);
    await expect(page.getByTestId('msa-order-note')).toBeVisible();
    await expect(page.getByTestId('msa-reorder-status')).toContainText('position 2 of 5');

    await page.getByTestId('msa-order-note').getByRole('button', { name: /reset order/i }).click();
    await expect(page.getByTestId('msa-order-note')).toHaveCount(0);
    expect(await rowIdAt(page, 0)).toBe(templateId);
  });

  test('row drag released off-grid cancels without reordering', async ({ page }) => {
    await setup(page);
    const before = await Promise.all(Array.from({ length: 5 }, (_, index) => rowIdAt(page, index)));
    const gripBox = await page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="3"] .motif-cs-msa-row-grip').boundingBox();
    const targetGrip = await page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="1"] .motif-cs-msa-row-grip').boundingBox();
    const scrollBox = await page.locator('.motif-cs-msa-matrix-scroll').boundingBox();
    if (!gripBox || !targetGrip || !scrollBox) throw new Error('row drag geometry missing');

    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetGrip.x + targetGrip.width / 2, targetGrip.y + 3, { steps: 8 });
    await expect(page.locator('.motif-cs-msa-matrix-row[data-drop-before="true"]')).toHaveCount(1);
    await page.mouse.move(targetGrip.x + targetGrip.width / 2, scrollBox.y + scrollBox.height + 36);
    await page.mouse.up();

    expect(await Promise.all(Array.from({ length: 5 }, (_, index) => rowIdAt(page, index)))).toEqual(before);
    await expect(page.locator('.motif-cs-msa-matrix-row[data-drop-before], .motif-cs-msa-matrix-row[data-drop-after]')).toHaveCount(0);
    await expect(page.getByTestId('msa-order-note')).toHaveCount(0);
  });

  test('resetting the row order clears a selection it would otherwise misalign', async ({ page }) => {
    await setup(page);
    // Establish a manual order so the reset affordance appears.
    const gripBox = await page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="3"] .motif-cs-msa-row-grip').boundingBox();
    const targetGrip = await page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="1"] .motif-cs-msa-row-grip').boundingBox();
    if (!gripBox || !targetGrip) throw new Error('row grips not found');
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetGrip.x + targetGrip.width / 2, targetGrip.y + 3, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByTestId('msa-order-note')).toBeVisible();
    // Select a block spanning several rows.
    const start = await center(page, 1, 6);
    const end = await center(page, 3, 22);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('msa-selection-readout')).toBeVisible();
    // Resetting re-indexes the rows; a stale index-based selection must not linger.
    await page.getByTestId('msa-order-note').getByRole('button', { name: /reset order/i }).click();
    await expect(page.getByTestId('msa-selection-readout')).toHaveCount(0);
    await expect(page.locator('.motif-cs-msa-selection-band')).toHaveCount(0);
  });

  test('dropping the first movable row on the pinned template is a true no-op', async ({ page }) => {
    await setup(page);
    const firstMovableId = await rowIdAt(page, 1);
    if (!firstMovableId) throw new Error('no movable row');

    // A no-op reorder must not clear unrelated selection state.
    const start = await center(page, 1, 6);
    const end = await center(page, 2, 12);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('msa-selection-readout')).toBeVisible();

    const grip = await gripForId(page, firstMovableId).boundingBox();
    const templateRow = await page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="0"]').boundingBox();
    if (!grip || !templateRow) throw new Error('reorder geometry missing');
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, templateRow.y + 3, { steps: 8 });
    await page.mouse.up();

    expect(await rowIdAt(page, 1)).toBe(firstMovableId);
    await expect(page.getByTestId('msa-order-note')).toHaveCount(0);
    await expect(page.getByTestId('msa-reorder-status')).toHaveText('');
    await expect(page.getByTestId('msa-selection-readout')).toBeVisible();
  });

  test('the overview navigates only on a primary-button press', async ({ page }) => {
    await setup(page);
    const box = await page.getByTestId('msa-overview').boundingBox();
    if (!box) throw new Error('overview not found');
    const scroll = page.locator('.motif-cs-msa-matrix-scroll');
    const target = { x: box.x + box.width * 0.8, y: box.y + box.height / 2 };
    expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(0);
    // A secondary-button press must not move the alignment. (The overview has no
    // app context menu, so nothing to dismiss — and a stray Escape would close
    // the host window.)
    await page.mouse.click(target.x, target.y, { button: 'right' });
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(0);
    // A primary-button press does navigate.
    await page.mouse.click(target.x, target.y, { button: 'left' });
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });

  test('arrow keys on a focused row grip reorder and announce the move', async ({ page }) => {
    await setup(page);
    const movingId = await rowIdAt(page, 1); // a non-template row
    if (!movingId) throw new Error('no row id');

    await gripForId(page, movingId).focus();
    await page.keyboard.press('ArrowDown');
    await gripForId(page, movingId).focus();
    await page.keyboard.press('ArrowDown');

    // The row that began at index 1 has stepped down to index 3.
    expect(await rowIdAt(page, 3)).toBe(movingId);
    await expect(page.getByTestId('msa-order-note')).toBeVisible();
    await expect(page.getByTestId('msa-reorder-status')).toContainText('position 4 of 5');
  });

  test('arrow up on the first movable row is a no-op, not a phantom move', async ({ page }) => {
    await setup(page);
    const firstMovableId = await rowIdAt(page, 1); // just below the pinned template
    if (!firstMovableId) throw new Error('no row id');

    await gripForId(page, firstMovableId).focus();
    await page.keyboard.press('ArrowUp');

    // It cannot move above the pinned template, so the order is unchanged and no
    // manual reorder is committed (previously it re-pinned and announced a move).
    expect(await rowIdAt(page, 1)).toBe(firstMovableId);
    await expect(page.getByTestId('msa-order-note')).toHaveCount(0);
  });

  test('changing the template after a manual reorder re-pins the new template to the top', async ({ page }) => {
    await setup(page);
    // Establish a manual order: step the first movable row down one slot.
    const movedId = await rowIdAt(page, 1);
    if (!movedId) throw new Error('no row id');
    await gripForId(page, movedId).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('msa-order-note')).toBeVisible();
    expect(await rowIdAt(page, 2)).toBe(movedId); // manual order is in effect
    const manualIds = await rowIds(page);

    // Promote a different, currently non-template row to be the template.
    const newTemplateId = manualIds[3];
    if (!newTemplateId || newTemplateId === movedId) throw new Error('unexpected row layout');
    await page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="3"] .motif-cs-msa-row-select').click();

    // Even with a manual order active, the new template is re-pinned to the top
    // and loses its grip — it is not left stranded at its old manual position.
    expect(await rowIdAt(page, 0)).toBe(newTemplateId);
    await expect(page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="0"] .motif-cs-msa-row-grip')).toHaveCount(0);
    expect(await rowIds(page)).toEqual([newTemplateId, ...manualIds.filter((id) => id !== newTemplateId)]);
    await expect(page.getByTestId('msa-order-note')).toBeVisible();
  });

  async function setZoomPercent(page: Page, percent: number) {
    await page.getByTestId('msa-zoom-range').evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, String(value));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, percent);
  }

  test('zoom slider compresses columns into a birdseye blocks view', async ({ page }) => {
    await setup(page);
    const matrix = page.locator('.motif-cs-msa-matrix');
    await expect(matrix).not.toHaveAttribute('data-blocks', 'true');

    await setZoomPercent(page, 25);
    await expect(page.getByTestId('msa-zoom-value')).toHaveText('25%');
    await expect(matrix).toHaveAttribute('data-blocks', 'true');
    await expect(page.getByTestId('msa-blocks-chip')).toBeVisible();
    // Letters are dropped in blocks view; cells read as coloured tiles.
    await expect(cell(page, 0, 0)).toHaveCSS('font-size', '0px');

    await page.getByTestId('msa-zoom-reset').click();
    await expect(page.getByTestId('msa-zoom-value')).toHaveText('100%');
    await expect(matrix).not.toHaveAttribute('data-blocks', 'true');
  });

  test('Fit compresses the zoom so a wide alignment spans the window', async ({ page }) => {
    await setup(page, 900, 860);
    // 120 columns overflow the compact window at 100%, so a pan lane shows.
    await expect(page.getByTestId('msa-horizontal-scroll-row')).toBeVisible();
    await page.getByTestId('msa-zoom-fit').click();
    const value = await page.getByTestId('msa-zoom-value').textContent();
    expect(Number((value ?? '').replace('%', ''))).toBeLessThan(100);
    await expect(page.getByTestId('msa-horizontal-scroll-row')).toHaveCount(0);
    // A non-default zoom exposes the 100% reset control.
    await expect(page.getByTestId('msa-zoom-reset')).toBeVisible();
  });

  test('panning to the end brings the final column fully into view', async ({ page }) => {
    // The scroller reserves a stable scrollbar gutter outside its content box.
    // Content sized to the columns alone stops with its right edge against the
    // OUTER edge, parking the last column underneath that reservation where no
    // amount of scrolling retrieves it. Measured against the CONTENT box — the
    // border box counts the gutter as visible and passes while the column is
    // hidden.
    await setup(page, 900, 860, 1000);
    const pan = page.getByTestId('msa-horizontal-scroll');
    await expect(pan).toBeVisible();
    const max = await pan.evaluate((element) => (element as HTMLInputElement).max);
    await pan.fill(max);

    // Scrolling is immediate, while the virtualized column window is deliberately
    // updated on the next animation frame. Wait for that render boundary before
    // measuring the final cell; the geometry assertions below remain exact.
    await expect(
      page.locator('.motif-cs-msa-matrix-row').first().locator('[data-alignment-column="1000"]'),
    ).toBeAttached();

    const tail = await page.evaluate((lastColumn) => {
      const scroller = document.querySelector('.motif-cs-msa-matrix-scroll');
      const cell = document.querySelector(`.motif-cs-msa-matrix-row [data-alignment-column="${lastColumn}"]`);
      const gutter = document.querySelector('.motif-cs-msa-sticky-label');
      if (!scroller || !cell || !gutter) return null;
      const box = scroller.getBoundingClientRect();
      const contentRight = box.left + scroller.clientLeft + scroller.clientWidth;
      const clipLeft = Math.max(box.left, gutter.getBoundingClientRect().right);
      const rect = cell.getBoundingClientRect();
      return {
        width: rect.width,
        visibleWidth: Math.max(0, Math.min(rect.right, contentRight) - Math.max(rect.left, clipLeft)),
        scrollLeft: scroller.scrollLeft,
      };
    }, 1000);

    if (!tail) {
      // This null has fired under machine load, and "matrix tail geometry
      // missing" names neither which of the three lookups came back empty nor
      // what the scroller had settled on — so the failure could only be re-run,
      // never read. Gathered on the failing path alone, so the passing path is
      // unchanged.
      const why = await page.evaluate(() => {
        const scroller = document.querySelector('.motif-cs-msa-matrix-scroll');
        const columns = [...document.querySelectorAll('.motif-cs-msa-matrix-row:first-of-type [data-alignment-column]')]
          .map((cell) => cell.getAttribute('data-alignment-column'));
        return [
          `scroller=${Boolean(scroller)}`,
          `stickyLabel=${Boolean(document.querySelector('.motif-cs-msa-sticky-label'))}`,
          `renderedColumns=${columns.length} (${columns[0] ?? 'none'}…${columns[columns.length - 1] ?? 'none'})`,
          `scrollLeft=${scroller?.scrollLeft ?? '?'} of ${scroller ? scroller.scrollWidth - scroller.clientWidth : '?'}`,
        ].join(' ');
      });
      throw new Error(`matrix tail geometry missing: ${why}`);
    }
    expect(tail.width).toBeGreaterThan(0);
    // Fully visible, not merely intersecting: the defect left 0 of 10.6px.
    expect(tail.visibleWidth).toBeGreaterThan(tail.width - 0.5);
    // The scroller reaches the range the pan control advertises, not 15px short.
    expect(tail.scrollLeft).toBeGreaterThan(Number(max) - 1);
  });

  test('very long alignments offer an honest minimum zoom instead of claiming to fit', async ({ page }) => {
    await setup(page, 900, 860, 1000);
    const control = page.getByTestId('msa-zoom-fit');
    await expect(control).toHaveText('Min zoom');
    await expect(control).toHaveAccessibleName('Use minimum column zoom');
    await control.click();
    await expect(page.getByTestId('msa-zoom-value')).toHaveText('20%');
    await expect(page.getByTestId('msa-horizontal-scroll-row')).toBeVisible();
  });

  test('translation track renders amino-acid cells for a DNA alignment and follows the reading frame', async ({ page }) => {
    await setupDna(page);
    // Off by default (and only offered for nucleotide alignments).
    await expect(page.locator('.motif-cs-msa-translation-row')).toHaveCount(0);

    await page.getByTestId('msa-view-menu-button').click();
    await page.getByRole('checkbox', { name: 'Translation (amino acids)' }).check();

    await expect(page.locator('.motif-cs-msa-translation-row')).toBeVisible();
    // The reference row starts with ATG → Met.
    await expect(page.locator('.motif-cs-msa-aa[data-aa="M"]').first()).toBeVisible();

    // Switching reading frame re-translates (frame +2 no longer starts at ATG).
    await page.getByLabel('Translation reading frame').selectOption('1');
    await expect(page.locator('.motif-cs-msa-translation-row')).toBeVisible();
    await expect(page.locator('.motif-cs-msa-aa').first()).toBeVisible();
  });

  test('sequence-logo track toggles on with residue stacks coloured by the active scheme', async ({ page }) => {
    await setupDna(page);
    // Opt-in: hidden until enabled.
    await expect(page.getByTestId('msa-logo-row')).toHaveCount(0);

    await page.getByTestId('msa-view-menu-button').click();
    await page.getByRole('checkbox', { name: 'Sequence logo' }).check();

    const row = page.getByTestId('msa-logo-row');
    await expect(row).toBeVisible();
    // Stacked residue blocks render, coloured by the default nucleotide scheme.
    await expect(row.locator('.motif-cs-msa-logo-block[data-color-key^="nt-"]').first()).toBeVisible();
    // Column 1 is fully conserved in the generated data (every row starts 'A'),
    // so its block carries that residue.
    await expect(row.locator('.motif-cs-msa-logo-block[data-residue="A"]').first()).toBeVisible();
    const accessibleColumn = row.getByRole('cell').first();
    await expect(accessibleColumn).toHaveAttribute('aria-colindex', '1');
    await expect(accessibleColumn).toHaveAttribute('aria-label', /Column 1.*A 100%/);
    const mixedColumn = row.locator('.motif-cs-msa-logo-col:has(.motif-cs-msa-logo-block:nth-child(2))').first();
    await expect(mixedColumn).toBeVisible();
    const mixedLayout = await mixedColumn.evaluate((column) => {
      const stack = column.querySelector<HTMLElement>('.motif-cs-msa-logo-stack');
      const blocks = Array.from(column.querySelectorAll<HTMLElement>('.motif-cs-msa-logo-block'));
      if (!stack) throw new Error('mixed logo column has no stack');
      const stackBox = stack.getBoundingClientRect();
      return {
        stack: { top: stackBox.top, bottom: stackBox.bottom, height: stackBox.height },
        blocks: blocks.map((block) => {
          const box = block.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, height: box.height, fontSize: getComputedStyle(block).fontSize };
        }),
      };
    });
    expect(mixedLayout.blocks.length).toBeGreaterThan(1);
    expect(Math.abs(mixedLayout.blocks.reduce((sum, block) => sum + block.height, 0) - mixedLayout.stack.height)).toBeLessThan(0.5);
    expect(mixedLayout.blocks.every((block) => (
      block.top >= mixedLayout.stack.top - 0.25 && block.bottom <= mixedLayout.stack.bottom + 0.25
    ))).toBe(true);
    expect(mixedLayout.blocks.some((block) => block.fontSize === '0px')).toBe(true);

    // Toggling off removes the track (the View menu stays open between clicks).
    await page.getByRole('checkbox', { name: 'Sequence logo' }).uncheck();
    await expect(page.getByTestId('msa-logo-row')).toHaveCount(0);
  });

  test('sequence-logo blocks stay coloured for residues the active scheme cannot map', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.addInitScript(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
    await page.goto('/motif.html');
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await page.evaluate(() => {
      // A fully-conserved column of 'X' — a valid residue the Taylor wheel has
      // no colour for, so it exercises the neutral-base fallback.
      const fasta = ['ref', 'v1', 'v2', 'v3'].map((n) => `>${n}\nACDEFGXHIKLM`).join('\n') + '\n';
      const api = (window as unknown as { motifAddAlignments?: (a: unknown) => number }).motifAddAlignments;
      if (!api) throw new Error('motifAddAlignments unavailable');
      api({ name: 'E2E X panel', molecule: 'protein', alignedFasta: fasta });
    });
    await page.getByTestId('msa-open-button').dispatchEvent('click');
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();

    await page.getByTestId('msa-view-menu-button').click();
    await page.getByRole('checkbox', { name: 'Sequence logo' }).check();
    await page.getByRole('checkbox', { name: 'Residue colors' }).check();
    await page.getByLabel('Colour scheme').selectOption('taylor');
    await setZoomPercent(page, 25);

    const block = page.locator('.motif-cs-msa-logo-block[data-residue="X"]').first();
    await expect(block).toBeVisible();
    // An occupied residue must never be fully transparent — in blocks mode that
    // would be indistinguishable from a gap, hiding real data.
    const bg = await block.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
    await expect(block).toHaveCSS('font-size', '0px');
  });

  test('sequence-logo rendering stays windowed and column-aligned after horizontal scrolling', async ({ page }) => {
    await setup(page, 1440, 980, 1000);
    await page.getByTestId('msa-view-menu-button').click();
    await page.getByRole('checkbox', { name: 'Sequence logo' }).check();
    const scroll = page.locator('.motif-cs-msa-matrix-scroll');
    await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });

    const logoColumns = page.locator('.motif-cs-msa-logo-col');
    await expect.poll(async () => Number(await logoColumns.first().getAttribute('data-alignment-column'))).toBeGreaterThan(1);
    expect(await logoColumns.count()).toBeLessThan(250);
    const firstLogoColumn = await logoColumns.first().getAttribute('data-alignment-column');
    const firstSequenceSymbol = page.locator('.motif-cs-msa-matrix-row[data-msa-row-index="0"] .motif-cs-msa-symbol').first();
    const firstSequenceColumn = await firstSequenceSymbol.getAttribute('data-alignment-column');
    expect(firstLogoColumn).toBe(firstSequenceColumn);
    const logoBox = await logoColumns.first().boundingBox();
    const sequenceBox = await firstSequenceSymbol.boundingBox();
    if (!logoBox || !sequenceBox) throw new Error('logo alignment boxes missing');
    expect(Math.abs(logoBox.x - sequenceBox.x)).toBeLessThan(0.25);
    expect(Math.abs(logoBox.width - sequenceBox.width)).toBeLessThan(0.25);
  });

  test('sequence search highlights motif matches and navigates them', async ({ page }) => {
    await setup(page);
    const input = page.getByTestId('msa-search-input');
    const count = page.getByTestId('msa-search-count');

    // The reference row begins with AIRCK (this motif repeats along the row).
    await input.fill('AIRCK');
    await expect(page.locator('.motif-cs-msa-symbol[data-search-match]').first()).toBeVisible();
    await expect(count).toContainText(/\d+/);

    // Enter focuses the first match; Next advances.
    await input.press('Enter');
    await expect(count).toContainText(/1 of \d+/);
    await expect(page.locator('.motif-cs-msa-symbol[data-search-active]').first()).toBeVisible();
    await page.getByTestId('msa-search-next').click();
    await expect(count).toContainText(/2 of \d+/);

    // Escape clears the query and all highlights (without touching selection).
    await input.press('Escape');
    await expect(count).not.toContainText('of');
    await expect(page.locator('.motif-cs-msa-symbol[data-search-match]')).toHaveCount(0);
  });

  test('Escape clears the search from outside the input and in Text mode without closing the window', async ({ page }) => {
    await setup(page);
    const input = page.getByTestId('msa-search-input');
    const count = page.getByTestId('msa-search-count');

    // Focus has left the input (moved onto the Next button). Escape must still
    // clear the query and must NOT close the host MSA window.
    await input.fill('AIRCK');
    await expect(count).toContainText(/\d+/);
    await page.getByTestId('msa-search-next').click();
    await page.keyboard.press('Escape');
    await expect(count).not.toContainText('of');
    await expect(page.locator('.motif-cs-msa-symbol[data-search-match]')).toHaveCount(0);
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();

    // A latent query while in Text mode: Escape clears it instead of closing the
    // whole window (the search form that used to carry the escape scope is
    // unmounted in Text mode, so the always-mounted workspace carries it now).
    await input.fill('AIRCK');
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(page.getByTestId('msa-text-view')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('msa-text-view')).toBeVisible();
    await page.getByRole('button', { name: 'Viewer', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(count).toHaveText('');
    await expect(page.locator('.motif-cs-msa-symbol[data-search-match]')).toHaveCount(0);
    await expect(page.getByTestId('msa-workspace')).not.toHaveAttribute('data-motif-cs-escape-scope');
  });

  test('layout holds and stays scrollable at a narrow width', async ({ page }) => {
    await setup(page, 700, 900);
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();
    await expect(page.locator('.motif-cs-msa-matrix-scroll')).toBeVisible();
    // Sticky row label remains rendered so the row identity is never lost.
    await expect(page.locator('.motif-cs-msa-sticky-label').first()).toBeVisible();
    // A drag-select still works in the compact layout.
    const start = await center(page, 0, 4);
    const end = await center(page, 2, 12);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('msa-selection-readout')).toContainText('Selected');
  });

  test('the zoom controls wrap within the frame at a narrow width', async ({ page }) => {
    await setupDna(page, 440, 760);
    // Blocks mode reveals the full control set (100% reset + Blocks chip).
    await page.getByTestId('msa-zoom-range').fill('35');
    await expect(page.getByTestId('msa-blocks-chip')).toBeVisible();
    const frame = await page.locator('.motif-cs-msa-matrix-frame').boundingBox();
    if (!frame) throw new Error('frame missing');
    for (const id of ['msa-zoom-range', 'msa-zoom-value', 'msa-zoom-fit', 'msa-zoom-reset', 'msa-blocks-chip']) {
      const b = await page.getByTestId(id).boundingBox();
      if (!b) throw new Error(`${id} missing`);
      // Every control stays inside the frame instead of being clipped by overflow.
      expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
    }
    // The crowded set wrapped onto a second line rather than overflowing.
    const row = await page.getByTestId('msa-zoom-row').boundingBox();
    expect(row!.height).toBeGreaterThan(40);
  });

  test('zoom and the visible-column readout share one status line', async ({ page }) => {
    await setup(page, 1280, 900, 400, 6);
    const zoom = await page.getByTestId('msa-zoom-row').boundingBox();
    const note = await page.locator('.motif-cs-msa-window-note').boundingBox();
    if (!zoom || !note) throw new Error('status line missing');
    // Same line: their vertical centres coincide, and the readout sits to the right.
    expect(Math.abs((zoom.y + zoom.height / 2) - (note.y + note.height / 2))).toBeLessThanOrEqual(2);
    expect(note.x).toBeGreaterThan(zoom.x + zoom.width - 1);
  });

  test('the export menu holds every export control and closes before the window', async ({ page }) => {
    await setup(page, 1280, 900);
    const trigger = page.getByTestId('msa-export-menu-button');
    const panel = page.getByTestId('msa-export-menu');
    await expect(trigger).toBeVisible();
    await expect(panel).toBeHidden();

    await trigger.click();
    await expect(panel).toBeVisible();
    for (const name of ['Copy', 'Download', 'Save PNG', 'Save SVG']) {
      await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(panel.getByRole('combobox', { name: 'Export', exact: true })).toBeVisible();
    await expect(page.getByTestId('msa-export-image-scope')).toBeVisible();

    // Escape dismisses the menu and returns focus to its trigger; the window
    // beneath must survive, and only a second Escape may close it.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();
    await expect(trigger).toBeFocused();
  });

  // Residue fills are the only <rect> elements the image renderers emit per cell;
  // the page background and the label gutter are emitted without x/y.
  const svgCellFills = (svg: string) => [...svg.matchAll(
    /<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" fill="([^"]+)"\/>/g,
  )].map((match) => match[1]);

  async function savedSvg(page: Page) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('msa-export-svg').click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('the SVG export produced no file — nothing below was measured');
    return readFileSync(path, 'utf8');
  }

  test('stepping back off the first difference returns to neutral instead of the far end', async ({ page }) => {
    // Regression: both ends wrapped by modular arithmetic with nothing said, so
    // three Prev presses from the start read "N of N" and threw the view to the
    // opposite end of the alignment — and Prev from the neutral state did it
    // before the user had gone anywhere. One round trip would not show this.
    await setup(page);
    const counter = page.locator('.motif-cs-msa-difference-nav span').first();
    const previous = page.getByLabel('Previous variable column').first();
    const next = page.getByLabel('Next variable column').first();
    const total = (await counter.textContent())?.match(/of\s+([\d,]+)/)?.[1];
    if (!total) throw new Error('no difference total on the counter — nothing below was measured');
    expect(Number(total.replaceAll(',', ''))).toBeGreaterThan(3);

    await expect(counter).toHaveText(`Difference — of ${total}`);
    await previous.click();
    await expect(counter).toHaveText(`Difference — of ${total}`);

    for (const step of [1, 2, 3]) {
      await next.click();
      await expect(counter).toHaveText(`Difference ${step} of ${total}`);
    }
    for (const step of [2, 1]) {
      await previous.click();
      await expect(counter).toHaveText(`Difference ${step} of ${total}`);
    }
    await previous.click();
    await expect(counter).toHaveText(`Difference — of ${total}`);
  });

  test('the search readout says what its number is before a match is stepped to', async ({ page }) => {
    // A bare "36" beside two step arrows reads as "match 36".
    await setup(page);
    const readout = page.getByTestId('msa-search-count');
    await page.getByTestId('msa-search-input').fill('AIR');
    await expect(readout).toHaveText(/^\d+ matches$/);
    await page.getByTestId('msa-search-input').press('Enter');
    await expect(readout).toHaveText(/^1 of \d+$/);
  });

  test('the exported image follows the residue-colour toggle, and stays legible without it', async ({ page }) => {
    // Regression: the export read only `colorScheme` and never `colorMode`, so
    // turning colours off changed nothing — and since the scheme select is
    // disabled while colours are off, the file was coloured by a setting the UI
    // was preventing the user from inspecting.
    await setup(page);
    await page.getByTestId('msa-view-menu-button').click();
    await page.getByLabel('Colour scheme').isDisabled();
    await page.keyboard.press('Escape');

    await page.getByTestId('msa-export-menu-button').click();
    await expect(page.getByTestId('msa-export-image-scope')).toBeVisible();
    const mono = svgCellFills(await savedSvg(page));
    await page.keyboard.press('Escape');

    await page.getByTestId('msa-view-menu-button').click();
    await page.getByRole('checkbox', { name: 'Residue colors' }).check();
    await page.getByLabel('Colour scheme').selectOption('taylor');
    await page.keyboard.press('Escape');
    await page.getByTestId('msa-export-menu-button').click();
    const coloured = svgCellFills(await savedSvg(page));
    await page.keyboard.press('Escape');

    // Colours on: every cell painted, in the scheme that was chosen. Taylor is
    // used rather than clustal because 'auto' resolves TO clustal for a protein,
    // so comparing those two compares a scheme with itself.
    expect(coloured.length).toBeGreaterThan(300);
    expect(new Set(coloured).size).toBeGreaterThan(9);
    // Colours off: no residue fills at all, and the letters are still there — the
    // image is monochrome, not empty.
    expect(mono.length).toBeLessThan(coloured.length / 10);
    expect(new Set(mono).size).toBeLessThanOrEqual(1);

    // The exception, and the reason this is not simply "skip the fills": once the
    // alignment is too wide to draw letters, colour is all that is left carrying
    // the sequence, so a monochrome whole-alignment export must still be painted.
    await setup(page, 1440, 980, 6000);
    await page.getByTestId('msa-export-menu-button').click();
    await page.getByTestId('msa-export-image-scope').selectOption('all');
    const dense = await savedSvg(page);
    const denseFills = svgCellFills(dense);
    // Precondition: this really is the letters-dropped regime. The document
    // always carries a title and axis ticks, so "no <text> at all" would be the
    // wrong test — what marks birdseye is text becoming negligible against cells.
    expect((dense.match(/<text /g) ?? []).length).toBeLessThan(denseFills.length / 10);
    expect(denseFills.length).toBeGreaterThan(1000);
  });

  test('resetting the alignment view keeps the export format and the pane you are in', async ({ page }) => {
    // Regression: the reset spread the whole defaults object, so a control called
    // "Reset alignment view" silently changed the chosen export format and threw
    // a user reading the Text pane back into the Viewer.
    await setup(page);
    await page.getByTestId('msa-export-menu-button').click();
    const format = page.getByTestId('msa-export-menu').locator('select').first();
    await format.selectOption('clustal');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    const pane = page.getByRole('button', { name: 'Text', exact: true });
    await expect(pane).toHaveAttribute('aria-pressed', 'true');

    // Move something the reset SHOULD restore, so this proves narrowing rather
    // than a reset that no longer does anything.
    await page.getByTestId('msa-view-menu-button').click();
    await page.getByRole('checkbox', { name: 'Residue colors' }).check();
    await page.getByRole('button', { name: 'Reset alignment view' }).click();

    await expect(page.getByRole('checkbox', { name: 'Residue colors' })).not.toBeChecked();
    await expect(pane).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.getByTestId('msa-export-menu-button').click();
    await expect(format).toHaveValue('clustal');
  });

  test('cycling reference numbering leaves one result per state, with stable names', async ({ page }) => {
    // Regression: "Use plain 1-based" forked instead of going back, and the name
    // it asked for was already suffixed, so the suffix concatenated. Three round
    // trips left seven results ending in "REVIEW 2 2 2 2 2 2". A single round trip
    // would not have shown either problem.
    await setup(page, 1440, 1100);
    await page.getByTestId('msa-view-menu-button').click();
    const savedResults = () => page.locator('.motif-cs-msa-alignment-picker select option').allTextContents();
    const numberingIsOn = () => page.getByTestId('msa-reference-numbering-editor').evaluate((el) => el.getAttribute('data-active') === 'true');

    expect(await savedResults()).toEqual(['E2E protein panel']);
    await page.getByTestId('msa-apply-reference-numbering').click();
    await expect.poll(numberingIsOn).toBe(true);
    const afterFirstApply = await savedResults();
    expect(afterFirstApply).toHaveLength(2);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.getByTestId('msa-clear-reference-numbering').click();
      await expect.poll(numberingIsOn).toBe(false);
      expect(await savedResults()).toEqual(afterFirstApply);

      await page.getByTestId('msa-apply-reference-numbering').click();
      await expect.poll(numberingIsOn).toBe(true);
      expect(await savedResults()).toEqual(afterFirstApply);
    }
    // No name may be a suffix pile-up, and no two may collide.
    for (const name of afterFirstApply) expect(name).not.toMatch(/\s\d+\s+\d+$/);
    expect(new Set(afterFirstApply).size).toBe(afterFirstApply.length);

    // A genuinely different numbering IS a new result, and it counts up from the
    // root rather than gluing another suffix on.
    await page.getByTestId('msa-reference-numbering-position').fill('250');
    await page.getByTestId('msa-apply-reference-numbering').click();
    await expect.poll(async () => (await savedResults()).length).toBe(3);
    const names = await savedResults();
    expect(names[2]).toBe(`${names[0]} 3`);
  });

  test('the view menu grows with the window instead of stopping at a constant', async ({ page }) => {
    // Regression: the cap was `min(430px, <window expression>)`. Every window
    // taller than 540px made min() pick the constant, so the menu showed 428px of
    // an 807px list at every window size — and dragging the window taller changed
    // nothing, leaving 852px of window unused beside 379px of hidden menu.
    await setup(page, 1440, 1300);
    await page.getByTestId('msa-view-menu-button').click();
    const panel = page.getByTestId('msa-view-menu');
    await expect(panel).toBeVisible();

    const read = () => panel.evaluate((el) => {
      const host = el.closest('.motif-cs-window');
      if (!host) throw new Error('the view menu is not inside a window — this measures nothing');
      const panelBox = el.getBoundingClientRect();
      const windowBox = host.getBoundingClientRect();
      if (panelBox.height <= 0) throw new Error('the view menu panel has no box — this measures nothing');
      return {
        windowHeight: Math.round(windowBox.height),
        visible: el.clientHeight,
        content: el.scrollHeight,
        hidden: el.scrollHeight - el.clientHeight,
        pastWindowBottom: Math.round(panelBox.bottom - windowBox.bottom),
        // Minus the panel's own two 1px borders; what is left is scrollbar.
        gutter: el.offsetWidth - el.clientWidth - 2,
      };
    });

    const handle = page.locator('.motif-cs-window-resize').first();
    await handle.focus();
    for (let step = 0; step < 40; step += 1) await handle.press('Shift+ArrowUp');
    const samples = [await read()];
    for (let batch = 0; batch < 4; batch += 1) {
      for (let step = 0; step < 10; step += 1) await handle.press('Shift+ArrowDown');
      samples.push(await read());
    }

    // The window really did grow each time; without this the heights below would
    // agree for the most boring possible reason.
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].windowHeight).toBeGreaterThan(samples[index - 1].windowHeight);
    }
    // The menu grew with it, and monotonically.
    expect(new Set(samples.map((sample) => sample.visible)).size).toBeGreaterThan(1);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].visible).toBeGreaterThanOrEqual(samples[index - 1].visible);
    }
    // Given room, it stops hiding anything at all.
    const tallest = samples[samples.length - 1];
    expect(tallest.hidden).toBe(0);
    expect(tallest.visible).toBe(tallest.content);
    // It never outgrows the window, which is overflow: hidden and would clip it.
    // The first sample is the 180px window floor, where the menu's own 120px floor
    // legitimately wins.
    for (const sample of samples.slice(1)) expect(sample.pastWindowBottom).toBeLessThanOrEqual(0);
    // And whatever is still hidden is signalled rather than left silent.
    for (const sample of samples) expect(sample.gutter).toBeGreaterThan(0);
  });

  test('toolbar menu panels stay inside the window at a narrow width', async ({ page }) => {
    // Regression: the panels were anchored to their own trigger and right-aligned
    // to it, so a panel wider than the gap to the left edge hung off-screen — at
    // this width the export panel began 106px past it, unreachable.
    await setup(page, 760, 820);
    for (const [triggerId, panelId] of [
      ['msa-export-menu-button', 'msa-export-menu'],
      ['msa-view-menu-button', 'msa-view-menu'],
      ['msa-goto-menu-button', 'msa-goto-menu'],
    ]) {
      await page.getByTestId(triggerId).click();
      const box = await page.getByTestId(panelId).boundingBox();
      if (!box) throw new Error(`${panelId} missing`);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(760);
      await page.keyboard.press('Escape');
    }
  });

  test('the window corner grip still takes the mouse at the smallest window size', async ({ page }) => {
    // Regression: the grip declared no z-index, so it only outranked content
    // stacking at auto. Narrow the window and the sticky toolbar wraps taller
    // than a short body, so it covers the bottom-right corner; at z-index 10 it
    // then painted over the grip and took the press itself. Mouse resizing died
    // completely at 280x180, with 82% of the body below the fold and no
    // scrollbar, so nothing but the keyboard could get the window back.
    await setup(page, 1440, 900);
    const grip = page.getByRole('button', { name: /^Resize .* window in 2 dimensions/ });
    const size = async () => page.evaluate(() => {
      const box = document.querySelector('.motif-cs-window')!.getBoundingClientRect();
      return { w: Math.round(box.width), h: Math.round(box.height) };
    });

    // Reach the minimum through the keyboard path, which never depended on paint
    // order — so the state under test is reached even when the grip is buried.
    await grip.focus();
    for (let step = 0; step < 200; step += 1) {
      const now = await size();
      if (now.w <= 280 && now.h <= 180) break;
      await page.keyboard.press(now.w > 280 ? 'ArrowLeft' : 'ArrowUp');
    }
    expect(await size()).toEqual({ w: 280, h: 180 });

    // The grip is window chrome: it has to be the element under its own centre.
    const centre = await page.evaluate(() => {
      const box = document.querySelector('.motif-cs-window-resize')!.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hit: hit ? `${hit.tagName}.${hit.className}` : 'none' };
    });
    expect(centre.hit).toBe('BUTTON.motif-cs-window-resize');

    // And a real mouse drag from there resizes. Pinned to the absolute size the
    // drag has to produce, so a partly working drag cannot pass either.
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(centre.x + step * 20, centre.y + step * 20);
    }
    await page.mouse.up();
    expect(await size()).toEqual({ w: 480, h: 380 });
  });

  test('"Reset display" restores a shrunken alignment window that reopening deliberately does not', async ({ page }) => {
    // Two behaviours that look like one bug and are not. Keeping a dragged size
    // across a close and reopen is correct — a size chosen by dragging a corner
    // is a choice, and closing a window is not a request to forget it. What was
    // missing is the way back: the seven floating tool windows keep their
    // geometry in state that "Reset display" never touched, so the button put
    // the panes right and left the window exactly as small as it found it.
    //
    // The half that is easy to get wrong is the OPEN window. `initial` is read
    // once, in a useState initialiser, so resetting the parent's rect alone
    // moves nothing on screen — measured, that leaves the window at 280x180
    // while silently fixing only the NEXT open, which is the one moment the
    // user is guaranteed not to be looking. Both states are asserted below.
    await setup(page, 1440, 900);
    const size = async () => page.evaluate(() => {
      const box = document.querySelector('.motif-cs-window')!.getBoundingClientRect();
      return { w: Math.round(box.width), h: Math.round(box.height) };
    });
    const reopen = async () => {
      await page.locator('.motif-cs-window-close').first().click();
      await expect(page.getByTestId('msa-alignment-view')).toBeHidden();
      await page.getByTestId('msa-open-button').dispatchEvent('click');
      await expect(page.getByTestId('msa-alignment-view')).toBeVisible();
    };

    // min(940, 1440 - 40) x min(820, 900 - 150). Pinned, so a change to either
    // cap has to come past this test rather than through it.
    const defaultSize = { w: 940, h: 750 };
    expect(await size()).toEqual(defaultSize);

    const grip = await page.evaluate(() => {
      const box = document.querySelector('.motif-cs-window-resize')!.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      await page.mouse.move(grip.x - step * 40, grip.y - step * 32, { steps: 2 });
    }
    await page.mouse.up();
    // The floor. Asserted rather than assumed: everything below is about
    // recovering from this state, so a drag that never reached it would leave
    // the rest of this test proving nothing.
    expect(await size()).toEqual({ w: 280, h: 180 });

    await reopen();
    expect(await size(), 'a deliberately chosen window size must survive a reopen').toEqual({ w: 280, h: 180 });

    const settings = page.locator('details[data-rail-tool="settings"]');
    await settings.locator(':scope > summary').click();
    await settings.getByRole('button', { name: 'Reset display' }).click();
    await expect.poll(size, { message: 'Reset display left the OPEN window at its floor' }).toEqual(defaultSize);

    await reopen();
    expect(await size(), 'the reset must clear the remembered size, not just the rendered one').toEqual(defaultSize);
  });

  test('Escape dismisses a toolbar menu opened a moment earlier instead of closing the window', async ({ page }) => {
    // Regression: the window deferred to an open menu by looking for a rendered
    // data-motif-cs-escape-scope attribute, but for a native <details> that
    // attribute only arrives with React's `toggle` handler — measured at ~52ms
    // after the browser had already opened the menu on screen. An Escape inside
    // that interval found no scope, so the window closed and took the alignment
    // with it. On a loaded machine the interval is far longer, which is how the
    // artifact suite hit this about one run in six while passing in isolation.
    //
    // Click and key both go through CDP, back to back: real trusted input, with
    // only the automation round trip removed — which is what a busy machine
    // removes as well.
    await page.addInitScript(() => {
      (window as unknown as { __escapeState?: unknown }).__escapeState = null;
      window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const host = document.querySelector<HTMLDetailsElement>('details.motif-cs-msa-export-menu');
        const shell = document.querySelector('.motif-cs-window');
        (window as unknown as { __escapeState?: unknown }).__escapeState = {
          isTrusted: event.isTrusted,
          menuOpen: host ? host.open : null,
          renderedScope: !!shell?.querySelector('[data-motif-cs-escape-scope="true"]'),
        };
      }, true);
    });
    await setup(page, 1280, 900);

    const client = await page.context().newCDPSession(page);
    const box = await page.getByTestId('msa-export-menu-button').boundingBox();
    if (!box) throw new Error('export menu trigger has no box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const mouse = (type: string, buttons: number) => client.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons });
    const key = (type: string) => client.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await Promise.all([mouse('mousePressed', 1), mouse('mouseReleased', 0), key('keyDown'), key('keyUp')]);
    await page.waitForTimeout(400);

    // The state under test has to have been reached: menu open on screen while
    // the rendered scope attribute is still absent. Without this the test would
    // keep passing if that interval ever closed, while checking nothing at all.
    type EscapeState = { isTrusted: boolean; menuOpen: boolean | null; renderedScope: boolean };
    const observed = await page.evaluate(() => (window as unknown as { __escapeState?: EscapeState | null }).__escapeState);
    expect(observed, 'no Escape reached the page').toBeTruthy();
    expect(observed!.isTrusted, 'the key must be real input, not a dispatched event').toBe(true);
    expect(observed!.menuOpen, 'the menu must be open when Escape lands').toBe(true);
    expect(observed!.renderedScope, 'the race window was never entered — this test no longer tests anything').toBe(false);

    // The window survives, and the key does what the user meant by it.
    await expect(page.getByTestId('msa-alignment-view')).toBeVisible();
    await expect(page.locator('details.motif-cs-msa-export-menu')).not.toHaveAttribute('open', /.*/);
  });
});
