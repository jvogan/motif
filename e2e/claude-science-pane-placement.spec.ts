import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL ?? '/motif.html';

async function openArtifact(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl);
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

    await tools.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => tools.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const scrolledTools = await tools.boundingBox();
    const scrolledResize = await resize.boundingBox();
    expect(scrolledTools).not.toBeNull();
    expect(scrolledResize).not.toBeNull();
    expect(Math.abs((scrolledResize!.x + scrolledResize!.width) - (scrolledTools!.x + scrolledTools!.width))).toBeLessThan(2);
    expect(Math.abs((scrolledResize!.y + scrolledResize!.height) - (scrolledTools!.y + scrolledTools!.height))).toBeLessThan(2);
    expect(await page.evaluate(({ x, y }) => (
      document.elementFromPoint(x, y)?.closest('.motif-cs-floating-pane-resize') !== null
    ), { x: scrolledTools!.x + scrolledTools!.width - 5, y: scrolledTools!.y + scrolledTools!.height - 5 })).toBe(true);

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

  test('visibility controls keep one content pane docked while other panes float', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    const map = page.locator('[data-pane-key="map"]');
    await map.getByRole('button', { name: 'Pop out Map pane' }).click();
    await page.locator('[data-pane-toggle="inventory"]').click();

    const sequenceToggle = page.locator('[data-pane-toggle="sequence"]');
    await expect(sequenceToggle).toBeDisabled();
    await expect(sequenceToggle).toHaveAttribute('title', 'Keep one content pane docked in the workspace');
    const sequenceCollapse = page.locator('[data-pane-key="sequence"]').getByRole('button', { name: /Sequence pane cannot be collapsed/ });
    await expect(sequenceCollapse).toBeDisabled();
    await expect(sequenceCollapse).toHaveAttribute('title', 'Keep one content pane docked in the workspace');
    await expect(page.locator('.motif-cs-main')).toHaveAttribute('data-content-pane-count', '1');
  });

  test('the circular map keeps its status readout inside the part of the column it shows', async ({ page }) => {
    // Regression: the readout hung off the map frame's BOTTOM edge, and between
    // 768px and 1535px that frame is floored taller than its column can display —
    // 504px of frame in a 442px column at 1440x900, 141px scrolled away. The
    // readout was inside that 141px at every size in the band, at rest and zoomed
    // alike, because the clip is static rather than a zoom artefact. It was
    // reachable by scrolling the map pane, which nothing invites.
    //
    // Measured against the column's clip rect, NOT with a hit test: the readout
    // computes `pointer-events: none`, so elementFromPoint at its own centre
    // returns the map container beneath it at every size — including the sizes
    // where nothing is wrong, which is what makes that instrument useless here.
    for (const [width, height] of [[1440, 900], [1280, 900], [1024, 768]] as const) {
      await openArtifact(page, width, height);

      // The readout only exists once something has zoomed or selected — it renders
      // from a string that is empty at rest. Zoom, then assert it is really there,
      // so an absent element can never read as "not below the fold".
      const zoomIn = page.locator('button[aria-label="Zoom in"]').first();
      for (let step = 0; step < 4; step += 1) await zoomIn.click();
      const hint = page.locator('.motif-cs-map-hint');
      await expect(hint, `no readout to measure at ${width}x${height}`).toBeVisible();

      const geometry = await page.evaluate(() => {
        const node = document.querySelector('.motif-cs-map-hint')!;
        const column = document.querySelector('.motif-cs-map-column')!;
        const box = node.getBoundingClientRect();
        const columnBox = column.getBoundingClientRect();
        return {
          belowBy: Math.round(box.bottom - (columnBox.top + column.clientHeight)),
          aboveBy: Math.round(columnBox.top - box.top),
          columnHides: Math.round(column.scrollHeight - column.clientHeight),
          mode: document.querySelector('[data-map-mode]')?.getAttribute('data-map-mode'),
        };
      });

      expect(geometry.mode, 'this test is about the circular map').toBe('circular');
      // The precondition that makes the assertion meaningful: the column really is
      // clipping something here. If it ever stops overflowing, the readout being
      // visible proves nothing and this test should be re-derived rather than
      // quietly kept.
      expect(geometry.columnHides, `column stopped overflowing at ${width}x${height}`).toBeGreaterThan(0);
      expect(geometry.belowBy, `readout below the column's visible edge at ${width}x${height}`).toBeLessThan(0);
      expect(geometry.aboveBy, `readout above the column's visible edge at ${width}x${height}`).toBeLessThan(0);
    }
  });

  test('the map dock heads stay on screen as a column footer wherever the column scrolls', async ({ page }) => {
    // The end of the map workflow — Map Visibility and Digest Preview — sat below the
    // fold at every desktop size under 1536: measured 138px past the column's visible
    // edge at 900x700, 133 at 1024x768, 131 at 1280x900 and 1440x900, 85 at 1440x1200.
    // Reachable by scrolling the map pane, which nothing invites.
    //
    // REFUTED on the way, recorded so it is not retried: reviving the dead
    // `.motif-cs-map-column { max-width: min(900px, 62vw) }` does NOT fix this. Applying
    // it narrows the column from 1377px to 878px at 1440x900 and moves the fold by
    // exactly 0px, because the frame's height comes from `min-height: clamp(410px, 56vh,
    // 620px)` — a pure viewport-height expression that column width never enters. The
    // discriminating pair is 1280x900 against 1440x900: 160px of column width apart,
    // frame height identical at 504px.
    const heads = async () => page.evaluate(() => {
      const column = document.querySelector('.motif-cs-map-column')!;
      const columnBox = column.getBoundingClientRect();
      const visibleBottom = columnBox.top + column.clientHeight;
      const named = (text: string) => [...document.querySelectorAll('summary.motif-cs-panel-head')]
        .find((node) => node.textContent!.trim().startsWith(text));
      const belowBy = (node?: Element) => (node ? Math.round(node.getBoundingClientRect().bottom - visibleBottom) : null);
      const strip = document.querySelector('.motif-cs-map-dock-strip')!;
      const stripBox = strip.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(stripBox.left + 30), Math.round(stripBox.top + stripBox.height / 2));
      const readout = document.querySelector('.motif-cs-map-hint');
      const readoutBox = readout?.getBoundingClientRect();
      return {
        columnHides: Math.round(column.scrollHeight - column.clientHeight),
        mapVisibility: belowBy(named('Map Visibility')),
        digestPreview: belowBy(named('Digest Preview')),
        // These heads are buttons, so unlike the readout a hit test IS the right
        // instrument — it is what decides whether a press reaches them.
        pressReachesStrip: !!hit && strip.contains(hit),
        overlapsReadout: !!readoutBox && !(stripBox.bottom < readoutBox.top || stripBox.top > readoutBox.bottom),
      };
    });

    for (const [width, height] of [[900, 700], [1280, 900], [1440, 900]] as const) {
      await openArtifact(page, width, height);
      const zoomIn = page.locator('button[aria-label="Zoom in"]').first();
      for (let step = 0; step < 4; step += 1) await zoomIn.click();

      const result = await heads();
      // Precondition: without overflow a sticky footer is inert, and this would pass on
      // a column that simply fits.
      expect(result.columnHides, `column does not overflow at ${width}x${height}`).toBeGreaterThan(0);
      expect(result.mapVisibility, `Map Visibility below the fold at ${width}x${height}`).toBeLessThanOrEqual(0);
      expect(result.digestPreview, `Digest Preview below the fold at ${width}x${height}`).toBeLessThanOrEqual(0);
      expect(result.pressReachesStrip, `a press at the dock strip does not reach it at ${width}x${height}`).toBe(true);
      expect(result.overlapsReadout, `the footer covers the map readout at ${width}x${height}`).toBe(false);
    }

    // Where the column already fits, the footer must change nothing: `bottom` only
    // engages while an ancestor scrolls, so this is the no-overflow control.
    await openArtifact(page, 1920, 1080);
    const settled = await heads();
    expect(settled.columnHides, 'expected no overflow at 1920x1080').toBe(0);
    expect(settled.mapVisibility).toBeLessThan(0);
    expect(settled.digestPreview).toBeLessThan(0);
  });

  test('the annotations list reaches every feature in all three Tools placements', async ({ page }) => {
    // Regression, and a SCOPING one rather than a plain miss. `max-height: min(24vh,
    // 190px)` resolves to a flat 190px at every viewport height above 792px. It was
    // fixed once, but as an addition under
    // `.motif-cs-inspector[data-tools-pinned="false"]` — so the unpinned rail popover
    // came right while the pinned docked column and the floated Tools pane kept the
    // whole defect, and nothing looked wrong because a fix was on record. Measured in
    // the pinned state: clientHeight 189 against scrollHeight 288, 3 of 8 rows
    // unreachable, identically at 900, 980, 1080 and 1400 tall — constant across
    // viewport height, which is the signature of the constant winning.
    //
    // All three placements are exercised, because the bug was exactly that one of
    // them was checked and the other two were not.
    await openArtifact(page, 1440, 980);

    const annotations = page.locator('details[data-rail-tool="annotations"]');
    const list = page.locator('.motif-cs-feature-annotation-list');
    const openPanel = async () => {
      if ((await annotations.getAttribute('open')) === null) {
        await annotations.locator(':scope > summary').click();
      }
      await expect(list).toBeVisible();
    };

    const reachable = async (label: string) => {
      const result = await page.evaluate(() => {
        const node = document.querySelector('.motif-cs-feature-annotation-list')!;
        const rows = [...node.querySelectorAll('.motif-cs-row')];
        const box = node.getBoundingClientRect();
        // A row scrolled out of a scroller still has a real rect, so geometry alone
        // proves nothing — intersect with the list's own client box.
        const visible = rows.filter((row) => {
          const rowBox = row.getBoundingClientRect();
          return rowBox.top >= box.top - 1 && rowBox.bottom <= box.top + node.clientHeight + 1;
        }).length;
        return { rows: rows.length, visible, hidden: node.scrollHeight - node.clientHeight };
      });
      // Precondition: a list short enough to fit under a 190px cap would pass this
      // whether or not the cap was ever removed.
      expect(result.rows, `${label}: too few features for this to test anything`).toBeGreaterThan(6);
      expect(result.hidden, `${label}: the list still clips its own content`).toBe(0);
      expect(result.visible, `${label}: rows unreachable inside the list`).toBe(result.rows);
    };

    await openPanel();
    await reachable('unpinned rail popover');

    await page.locator('[data-pane-toggle="tools"]').click();
    await expect(page.locator('.motif-cs-inspector')).toHaveAttribute('data-tools-pinned', 'true');
    await openPanel();
    await reachable('pinned docked column');

    await page.locator('[data-pane-key="tools"]').getByRole('button', { name: 'Pop out Tools pane' }).click();
    await expect(page.locator('[data-pane-key="tools"]')).toHaveAttribute('data-pane-placement', 'floating');
    await openPanel();
    await reachable('floated Tools pane');
  });
});
