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
    await setupDna(page);
    const scroll = page.locator('.motif-cs-msa-matrix-scroll');
    const spot = await center(page, 1, 10);
    await page.mouse.move(spot.x, spot.y);
    // A dominantly-horizontal gesture scrolls the columns.
    await page.mouse.wheel(180, 6);
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const afterHorizontal = await scroll.evaluate((el) => el.scrollLeft);
    const body = page.locator('.motif-cs-window-body');
    const bodyBefore = await body.evaluate((el) => el.scrollTop);
    // A near-vertical gesture (tiny deltaX) must not change horizontal scroll —
    // its vertical delta is honoured instead of being swallowed as horizontal.
    await page.mouse.wheel(6, 160);
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(afterHorizontal);
    // ...and the vertical delta actually scrolled (the matrix has no vertical
    // overflow here, so it delegates to the scrollable window body).
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(bodyBefore);
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
});
