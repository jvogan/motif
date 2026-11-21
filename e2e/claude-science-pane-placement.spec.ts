import { expect, test, type Page } from '@playwright/test';
import { openTool, openToolsDrawer, toolDetails } from './tool-panel-aliases';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL ?? '/motif.html';
test.use({ trace: 'retain-on-failure' });

type PaneDraftAuditEvent = {
  sequence: number;
  type: string;
  target: string;
  trusted: boolean;
  value?: string;
  open?: boolean;
  placement?: string;
};

type PaneDraftAuditResult = {
  events: PaneDraftAuditEvent[];
  paneRemovals: number;
  notesRemovals: number;
  editorRemovals: number;
  samePaneOwner: boolean;
  sameNotesOwner: boolean;
  sameEditorOwner: boolean;
};

async function openArtifact(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
}

// Below 900px the Records pane starts hidden, and from 1536px the Tools toggle
// pins the pane (below that it opens a drawer, which has no pop-out). This turns
// a pane on through its top-bar toggle when it is off.
async function showPane(page: Page, pane: string) {
  const toggle = page.locator(`[data-pane-toggle="${pane}"]`);
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

// Tools pops out only while it is pinned, which takes a viewport of 1536px or more.
const TOOLS_PLACEMENT_VIEWPORT = { width: 1600, height: 900 } as const;

async function installPaneDraftAudit(page: Page) {
  await page.evaluate(() => {
    type AuditState = {
      pane: Element;
      notes: Element;
      editor: Element;
      events: PaneDraftAuditEvent[];
      paneRemovals: number;
      notesRemovals: number;
      editorRemovals: number;
    };
    const auditWindow = window as Window & { __motifPaneDraftAudit?: AuditState };
    const pane = document.querySelector('[data-pane-key="tools"]');
    const notes = pane?.querySelector('details[data-rail-tool="notes"]');
    const editor = notes?.querySelector('.motif-cs-annotation-editor-drawer');
    if (!pane || !notes || !editor) throw new Error('Pane draft audit targets are unavailable.');
    const audit: AuditState = {
      pane,
      notes,
      editor,
      events: [],
      paneRemovals: 0,
      notesRemovals: 0,
      editorRemovals: 0,
    };
    auditWindow.__motifPaneDraftAudit = audit;
    let sequence = 0;
    const describeTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return 'unknown';
      if (target.closest('[data-pane-popout]')) return 'popout';
      if (target.closest('[data-pane-dock]')) return 'dock';
      if (target.closest('[data-testid="floating-pane-resize-tools"]')) return 'resize';
      if (target.closest('.motif-cs-pane-title')) return 'move';
      if (target.closest('.motif-cs-annotation-editor-drawer > summary')) return 'editor-summary';
      if (target.closest('details[data-rail-tool="notes"] > summary')) return 'notes-summary';
      if (target instanceof HTMLInputElement && target.labels?.[0]?.textContent?.includes('Title')) return 'title';
      if (target instanceof HTMLTextAreaElement) return 'body';
      return target.tagName.toLowerCase();
    };
    const record = (event: Event) => {
      const target = event.target;
      audit.events.push({
        sequence: ++sequence,
        type: event.type,
        target: describeTarget(target),
        trusted: event.isTrusted,
        ...((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) ? { value: target.value } : {}),
        ...(target instanceof HTMLDetailsElement ? { open: target.open } : {}),
        placement: pane.getAttribute('data-pane-placement') ?? undefined,
      });
    };
    for (const type of ['click', 'input', 'keydown', 'pointerdown']) {
      document.addEventListener(type, record, true);
    }
    editor.addEventListener('toggle', record, true);
    const removedWith = (nodes: NodeList, target: Element) => [...nodes].some((node) => (
      node === target || (node instanceof Element && node.contains(target))
    ));
    const observer = new MutationObserver((records) => {
      for (const mutation of records) {
        if (mutation.type === 'attributes') {
          audit.events.push({
            sequence: ++sequence,
            type: 'placement-ack',
            target: 'pane',
            trusted: false,
            placement: pane.getAttribute('data-pane-placement') ?? undefined,
          });
          continue;
        }
        if (removedWith(mutation.removedNodes, pane)) audit.paneRemovals += 1;
        if (removedWith(mutation.removedNodes, notes)) audit.notesRemovals += 1;
        if (removedWith(mutation.removedNodes, editor)) audit.editorRemovals += 1;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    observer.observe(pane, { attributes: true, attributeFilter: ['data-pane-placement'] });
  });
}

async function readPaneDraftAudit(page: Page): Promise<PaneDraftAuditResult> {
  return page.evaluate(() => {
    type AuditState = {
      pane: Element;
      notes: Element;
      editor: Element;
      events: PaneDraftAuditEvent[];
      paneRemovals: number;
      notesRemovals: number;
      editorRemovals: number;
    };
    const audit = (window as Window & { __motifPaneDraftAudit?: AuditState }).__motifPaneDraftAudit;
    if (!audit) throw new Error('Pane draft audit was not installed.');
    return {
      events: audit.events,
      paneRemovals: audit.paneRemovals,
      notesRemovals: audit.notesRemovals,
      editorRemovals: audit.editorRemovals,
      samePaneOwner: audit.pane === document.querySelector('[data-pane-key="tools"]'),
      sameNotesOwner: audit.notes === document.querySelector('[data-pane-key="tools"] details[data-rail-tool="notes"]'),
      sameEditorOwner: audit.editor === document.querySelector('[data-pane-key="tools"] details[data-rail-tool="notes"] .motif-cs-annotation-editor-drawer'),
    };
  });
}

test.describe('state-preserving pane placement', () => {
  test.describe.configure({ retries: 0 });

  test('Tools keeps its open workflow draft through pop out, move, resize, and dock', async ({ page }, testInfo) => {
    await openArtifact(page, TOOLS_PLACEMENT_VIEWPORT.width, TOOLS_PLACEMENT_VIEWPORT.height);
    await showPane(page, 'tools');

    const tools = page.locator('[data-pane-key="tools"]');
    const notes = tools.locator('details[data-rail-tool="notes"]');
    const noteCountBefore = await notes.locator('.motif-cs-analysis-row').count();
    await notes.locator(':scope > summary').click();
    await installPaneDraftAudit(page);
    await notes.locator('.motif-cs-annotation-editor-drawer > summary').click();
    const draftTitle = notes.getByLabel('Title');
    const draftBody = notes.locator('.motif-cs-annotation-editor-drawer textarea');
    await draftTitle.fill('Uncommitted pane draft');
    await draftBody.fill('This stays local while the same Tools subtree changes placement.');

    await tools.getByRole('button', { name: 'Pop out Tools pane' }).click();
    await expect(tools).toHaveAttribute('data-pane-placement', 'floating');
    await expect(notes).toHaveAttribute('open', '');
    if (await draftTitle.inputValue() !== 'Uncommitted pane draft') {
      await testInfo.attach('pane-draft-audit-at-loss', {
        body: JSON.stringify(await readPaneDraftAudit(page), null, 2),
        contentType: 'application/json',
      });
    }
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

    const resize = page.getByTestId('floating-pane-resize-tools');
    const resizeBox = await resize.boundingBox();
    expect(resizeBox).not.toBeNull();
    await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
    await page.mouse.down();
    // Tools pops out at its docked height, the full window, so the grip can
    // only shorten it.
    await page.mouse.move(resizeBox!.x + 76, resizeBox!.y - 60, { steps: 5 });
    await page.mouse.up();
    const resized = await tools.boundingBox();
    expect(resized).not.toBeNull();
    expect(resized!.width).toBeGreaterThan(moved!.width);
    expect(resized!.height).toBeLessThan(moved!.height);

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
    expect(await notes.locator('.motif-cs-analysis-row').count()).toBe(noteCountBefore);

    const audit = await readPaneDraftAudit(page);
    await testInfo.attach('pane-draft-audit', {
      body: JSON.stringify(audit, null, 2),
      contentType: 'application/json',
    });
    expect(audit).toMatchObject({
      paneRemovals: 0,
      notesRemovals: 0,
      editorRemovals: 0,
      samePaneOwner: true,
      sameNotesOwner: true,
      sameEditorOwner: true,
    });
    expect(audit.events.filter((event) => ['input', 'click', 'pointerdown'].includes(event.type)).every((event) => event.trusted)).toBe(true);
    expect(audit.events.some((event) => event.target === 'popout' && event.type === 'click')).toBe(true);
    expect(audit.events.some((event) => event.target === 'dock' && event.type === 'click')).toBe(true);
    expect(audit.events.filter((event) => event.type === 'placement-ack').map((event) => event.placement)).toEqual([
      'floating',
      'docked',
    ]);
  });

  test('floating resize grips remain the trusted hit target across viewport layouts', async ({ page }) => {
    const contentPanes = [
      { key: 'inventory', label: 'Library' },
      { key: 'map', label: 'Map' },
      { key: 'sequence', label: 'Sequence' },
    ] as const;
    const toolsPane = { key: 'tools', label: 'Tools' } as const;
    // Tools has no pop-out below 1536px, where it is a drawer, so its grip is
    // checked at a wide viewport and the content panes at the two narrow ones.
    const cases = [
      ...[{ width: 1440, height: 900 }, { width: 820, height: 900 }]
        .flatMap((viewport) => contentPanes.map((pane) => ({ viewport, pane }))),
      { viewport: TOOLS_PLACEMENT_VIEWPORT, pane: toolsPane },
    ];

    for (const { viewport, pane } of cases) {
      await openArtifact(page, viewport.width, viewport.height);
      await showPane(page, pane.key);

      const paneElement = page.locator(`[data-pane-key="${pane.key}"]`);
      const docked = (await paneElement.boundingBox())!;
      await paneElement.getByRole('button', { name: `Pop out ${pane.label} pane` }).click();
      const resize = page.getByTestId(`floating-pane-resize-${pane.key}`);
      await expect(resize).toBeVisible();
      const before = await paneElement.boundingBox();
      const resizeBox = await resize.boundingBox();
      expect(before).not.toBeNull();
      // Popping out never shrinks the pane much below its docked area.
      expect(before!.width * before!.height).toBeGreaterThanOrEqual(0.9 * docked.width * docked.height);
      expect(resizeBox).not.toBeNull();

      await page.evaluate(() => {
        window.addEventListener('pointerdown', (event) => {
          const target = event.target instanceof Element
            ? event.target.closest<HTMLElement>('.motif-cs-floating-pane-resize')
            : null;
          if (!target) return;
          const state = window as Window & { __motifFloatingGripTrusted?: boolean[] };
          (state.__motifFloatingGripTrusted ??= []).push(event.isTrusted);
        }, true);
      });
      await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
      expect(await page.evaluate(({ x, y }) => (
        document.elementFromPoint(x, y)?.closest('.motif-cs-floating-pane-resize')?.getAttribute('data-testid')
      ), { x: resizeBox!.x + resizeBox!.width / 2, y: resizeBox!.y + resizeBox!.height / 2 })).toBe(`floating-pane-resize-${pane.key}`);
      await page.mouse.down();
      // A pane pops out no smaller than it was docked, which can fill the
      // window, so the grip is dragged inward.
      await page.mouse.move(resizeBox!.x - 76, resizeBox!.y - 60, { steps: 5 });
      await page.mouse.up();
      const after = await paneElement.boundingBox();
      const trusted = await page.evaluate(() => (window as Window & { __motifFloatingGripTrusted?: boolean[] }).__motifFloatingGripTrusted ?? []);
      expect(trusted).toContain(true);
      expect(after).not.toBeNull();
      expect(after!.width < before!.width - 1 || after!.height < before!.height - 1).toBe(true);
    }

    await openArtifact(page, 390, 760);
    // At phone width the Tools list is a drawer that covers the page once open.
    await openToolsDrawer(page);
    const notes = toolDetails(page, 'notes');
    const summary = notes.locator(':scope > summary');
    const summaryBox = await summary.boundingBox();
    expect(summaryBox).not.toBeNull();
    expect(await page.evaluate(({ x, y }) => (
      document.elementFromPoint(x, y)?.closest('details[data-rail-tool="notes"] > summary') !== null
    ), { x: summaryBox!.x + summaryBox!.width / 2, y: summaryBox!.y + summaryBox!.height / 2 })).toBe(true);
    await summary.click();
    await expect(notes).toHaveAttribute('open', '');

    // Records starts hidden below 900px; the top-bar toggle brings it back.
    await showPane(page, 'inventory');
    const inventory = page.locator('[data-pane-key="inventory"]');
    await inventory.getByRole('button', { name: 'Pop out Library pane' }).click();
    await expect(page.getByTestId('floating-pane-resize-inventory')).toBeHidden();
    const sheet = await inventory.boundingBox();
    expect(sheet).not.toBeNull();
    expect(sheet!.x).toBeGreaterThanOrEqual(7);
    expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(383);
    expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(753);
  });

  test('Notes retains one controlled draft owner through repeated pointer and keyboard placement changes', async ({ page }, testInfo) => {
    await openArtifact(page, TOOLS_PLACEMENT_VIEWPORT.width, TOOLS_PLACEMENT_VIEWPORT.height);
    const tools = page.locator('[data-pane-key="tools"]');
    await showPane(page, 'tools');
    const notes = tools.locator('details[data-rail-tool="notes"]');
    const noteCountBefore = await notes.locator('.motif-cs-analysis-row').count();
    const notesSummary = notes.locator(':scope > summary');
    await notesSummary.click();
    await installPaneDraftAudit(page);
    await notes.locator('.motif-cs-annotation-editor-drawer > summary').click();
    const draftTitle = notes.getByLabel('Title');
    const draftBody = notes.locator('.motif-cs-annotation-editor-drawer textarea');
    const title = 'Repeated pane draft';
    const body = 'Six placement cycles keep this controlled draft with one mounted owner.';
    await draftTitle.fill(title);
    await draftBody.fill(body);

    for (let cycle = 0; cycle < 6; cycle += 1) {
      await tools.getByRole('button', { name: 'Pop out Tools pane' }).click();
      await expect(tools).toHaveAttribute('data-pane-placement', 'floating');
      await expect(draftTitle, `title lost while floating in cycle ${cycle + 1}`).toHaveValue(title);
      await expect(draftBody, `body lost while floating in cycle ${cycle + 1}`).toHaveValue(body);

      const head = tools.locator(':scope > .motif-cs-pane-title');
      await head.focus();
      await head.press(cycle % 2 === 0 ? 'Alt+ArrowRight' : 'Alt+ArrowLeft');
      const resize = page.getByTestId('floating-pane-resize-tools');
      await resize.focus();
      await resize.press(cycle % 2 === 0 ? 'ArrowDown' : 'ArrowUp');

      await notesSummary.click();
      await expect(notes).not.toHaveAttribute('open', '');
      await notesSummary.click();
      await expect(notes).toHaveAttribute('open', '');
      await expect(draftTitle, `title lost after Notes close/reopen in cycle ${cycle + 1}`).toHaveValue(title);
      await expect(draftBody, `body lost after Notes close/reopen in cycle ${cycle + 1}`).toHaveValue(body);

      if (cycle % 2 === 0) await tools.getByRole('button', { name: 'Dock Tools pane' }).click();
      else await page.keyboard.press('Escape');
      await expect(tools).toHaveAttribute('data-pane-placement', 'docked');
      await expect(draftTitle, `title lost while docked in cycle ${cycle + 1}`).toHaveValue(title);
      await expect(draftBody, `body lost while docked in cycle ${cycle + 1}`).toHaveValue(body);
    }

    expect(await notes.locator('.motif-cs-analysis-row').count()).toBe(noteCountBefore);
    const audit = await readPaneDraftAudit(page);
    await testInfo.attach('pane-draft-stress-audit', {
      body: JSON.stringify(audit, null, 2),
      contentType: 'application/json',
    });
    expect(audit).toMatchObject({
      paneRemovals: 0,
      notesRemovals: 0,
      editorRemovals: 0,
      samePaneOwner: true,
      sameNotesOwner: true,
      sameEditorOwner: true,
    });
    const placementEvents = audit.events.filter((event) => (
      ['popout', 'dock', 'move', 'resize'].includes(event.target)
      && ['click', 'keydown', 'pointerdown'].includes(event.type)
    ));
    expect(placementEvents.length).toBeGreaterThanOrEqual(24);
    expect(placementEvents.every((event) => event.trusted)).toBe(true);
    expect(audit.events.filter((event) => event.type === 'placement-ack').map((event) => event.placement)).toEqual(
      Array.from({ length: 6 }, () => ['floating', 'docked']).flat(),
    );
  });

  test('Escape docks a floating pane and the phone layout uses a bounded sheet', async ({ page }) => {
    await openArtifact(page, 390, 760);
    // Records starts hidden below 900px; the top-bar toggle brings it back.
    await showPane(page, 'inventory');
    const inventory = page.locator('[data-pane-key="inventory"]');
    await inventory.getByRole('button', { name: 'Pop out Library pane' }).click();
    await expect(inventory).toHaveAttribute('data-pane-placement', 'floating');

    const sheet = await inventory.boundingBox();
    expect(sheet).not.toBeNull();
    expect(sheet!.x).toBeGreaterThanOrEqual(7);
    expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(383);
    expect(sheet!.y).toBeGreaterThan(38);
    expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(753);
    await expect(page.getByTestId('floating-pane-resize-inventory')).toBeHidden();

    await inventory.getByRole('button', { name: 'Import records' }).click();
    const addEntry = inventory.locator('#motif-cs-add-entry');
    await expect(addEntry).toBeVisible();
    const addEntryBox = await addEntry.boundingBox();
    expect(addEntryBox).not.toBeNull();
    expect(addEntryBox!.x).toBeGreaterThanOrEqual(sheet!.x);
    expect(addEntryBox!.x + addEntryBox!.width).toBeLessThanOrEqual(sheet!.x + sheet!.width);

    // The open panel carries its own "Import records" button; the toggle that
    // opened it comes first.
    await inventory.getByRole('button', { name: 'Import records' }).first().click();
    await expect(addEntry).toBeHidden();
    await inventory.getByRole('button', { name: 'Dock Library pane' }).focus();
    await page.keyboard.press('Escape');
    await expect(inventory).toHaveAttribute('data-pane-placement', 'docked');
    await expect(inventory.getByRole('button', { name: 'Pop out Library pane' })).toBeFocused();
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
    // 768px and 1535px that frame WAS floored taller than its column could display —
    // 504px of frame in a 442px column at 1440x900, 141px scrolled away. The floor
    // is gone now; the frame sizes to its column. The
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
      // Re-derived, as the note above asked. The column DID overflow here, and the
      // precondition was what kept "the readout is visible" from being vacuous. The
      // frame now sizes to its column (`min-height: 0` with `flex: 1 1 0`), so the
      // overflow the readout could hide inside is gone — which is a stronger
      // guarantee than the one this test used to make, and the assertion to keep.
      // If the viewport-height floor ever comes back, this fails first.
      expect(geometry.columnHides, `column overflows again at ${width}x${height}`).toBe(0);
      expect(geometry.belowBy, `readout below the column's visible edge at ${width}x${height}`).toBeLessThan(0);
      expect(geometry.aboveBy, `readout above the column's visible edge at ${width}x${height}`).toBeLessThan(0);
    }
  });

  test('no width from 640px up leaves part of the circular map unreachable', async ({ page }) => {
    // The map frame used to be sized by a viewport-height clamp rather than by the
    // column that shows it, so it stood taller than the column and the bottom of the
    // ring lived below the fold. Two bands, two mechanisms, one symptom: above 768px
    // the frame was 560px in a 496px column, and between 640 and 767 it was 522px in
    // a column that could show 392px. The 640-767 band was the worse of the two,
    // because there NO scroll position showed the whole map.
    //
    // The instrument is a scroll SWEEP, not a rest measurement: a label below the fold
    // at rest is a nuisance, but a label hidden at every scroll position of every
    // scrollable ancestor is unreachable, and only the sweep tells those apart.
    for (const width of [640, 660, 700, 767, 768, 900, 1100, 1280, 1440]) {
      // The map draws unique cutters by default, which leaves fewer labels
      // (16 at 640px) than a dense map of every cutter. Both are swept: the
      // default is what a user sees, every cutter is the worst case.
      for (const sites of ['unique', 'all'] as const) {
        await openArtifact(page, width, 900);
        await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
        if (sites === 'all') await page.getByRole('combobox', { name: 'Restriction sites' }).selectOption('all');

        const reach = await page.evaluate(async () => {
          const svg = document.querySelector('.motif-cs-map-frame svg.motif-plasmid-map')!;
          const column = document.querySelector('.motif-cs-map-column')!;
          const main = document.querySelector('.motif-cs-main')!;
          const strip = document.querySelector('.motif-cs-map-dock-strip');
          const labels = () => [...svg.querySelectorAll(
            '.motif-pm-restriction-label, .motif-pm-feature-label, .motif-pm-coord-label',
          )];
          const hidden = () => {
            const box = column.getBoundingClientRect();
            const floor = strip ? Math.min(box.bottom, strip.getBoundingClientRect().top) : box.bottom;
            return labels().filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.bottom > floor + 0.5 || rect.top < box.top - 0.5;
            }).length;
          };
          const columnRange = column.scrollHeight - column.clientHeight;
          const mainRange = main.scrollHeight - main.clientHeight;
          let best = Infinity;
          for (let i = 0; i <= 8; i += 1) {
            for (let j = 0; j <= 8; j += 1) {
              column.scrollTop = Math.round((columnRange * i) / 8);
              main.scrollTop = Math.round((mainRange * j) / 8);
              await new Promise((settle) => requestAnimationFrame(() => settle(null)));
              best = Math.min(best, hidden());
            }
          }
          column.scrollTop = 0;
          main.scrollTop = 0;
          await new Promise((settle) => requestAnimationFrame(() => settle(null)));
          return {
            placed: labels().length,
            atRest: hidden(),
            best,
            columnRange,
            miniature: svg.getAttribute('data-miniature') === 'true',
          };
        });

        // Guards the guard: a map with no labels would pass everything below. The
        // miniature a short frame draws (880x355 at 900px) names fewer things and no
        // ruler numbers: 10 labels there with unique cutters, 9 with every cutter.
        const floor = reach.miniature ? 8 : sites === 'all' ? 20 : 10;
        expect(reach.placed, `no map labels to measure at ${width}px (${sites} sites)`).toBeGreaterThan(floor);
        expect(reach.best, `map labels unreachable at any scroll position at ${width}px (${sites} sites)`).toBe(0);
        // The frame fits, so there is nothing to scroll to in the first place.
        expect(reach.atRest, `map labels below the fold on load at ${width}px (${sites} sites)`).toBe(0);
        expect(reach.columnRange, `the map column overflows again at ${width}px (${sites} sites)`).toBe(0);
      }
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
      // This used to require overflow, on the grounds that a sticky footer is inert
      // without it. The frame now sizes to its column, so every size in this loop
      // behaves like the 1920x1080 control at the end: nothing is below the fold
      // because nothing is scrolled away. The footer's `bottom` is now belt and
      // braces rather than the thing keeping these heads reachable, and this
      // assertion is what proves it.
      expect(result.columnHides, `column overflows again at ${width}x${height}`).toBe(0);
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

  test('opening a map dock panel leaves the map it controls on screen', async ({ page }) => {
    // The open panel used to be sized to its content with nothing to stop it, so it
    // took the whole column: with Map Visibility open the ring measured 0px at every
    // width up to 1536 and 82px at 1920x1080; with Digest Preview open, 0-5px up to
    // 1535. Now the circular frame keeps half the column and the panel scrolls.
    const measure = () => page.evaluate(() => {
      const column = document.querySelector('.motif-cs-map-column')!;
      const columnBox = column.getBoundingClientRect();
      const ring = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
      const visibleRing = Math.max(0, Math.min(ring.bottom, columnBox.top + column.clientHeight) - Math.max(ring.top, columnBox.top));
      const heads = [...document.querySelectorAll<HTMLElement>('.motif-cs-map-dock-strip > details > summary')].map((summary) => {
        const box = summary.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + 30, box.top + box.height / 2);
        return !!hit && summary.contains(hit);
      });
      // The ring's bounding box is a hair wider than it is tall (454.5 by 454.3 at
      // 1920x1080), so its width and its visible height round apart by a pixel with
      // nothing clipped. The overlap above is vertical; compare it with the height.
      return { ring: Math.round(ring.height), visibleRing: Math.round(visibleRing), heads, columnHides: column.scrollHeight - column.clientHeight };
    });

    for (const [width, height] of [[1024, 768], [1280, 720], [1440, 900], [1920, 1080]] as const) {
      for (const index of [0, 1]) {
        await openArtifact(page, width, height);
        const closed = await measure();
        const panel = page.locator('.motif-cs-map-dock-strip > details').nth(index);
        await panel.locator(':scope > summary').click();
        await expect(panel).toHaveAttribute('open', '');
        const open = await measure();
        const label = `${index === 0 ? 'Map Visibility' : 'Digest Preview'} open at ${width}x${height}`;
        expect(open.visibleRing, label).toBeGreaterThanOrEqual(Math.round(closed.ring * 0.45));
        expect(open.visibleRing, label).toBe(open.ring);
        expect(open.heads, `${label}: both dock heads reachable`).toEqual([true, true]);
        expect(open.columnHides, `${label}: the column itself scrolls`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('the annotations list reaches every feature in all four Tools placements', async ({ page }) => {
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
    // Every placement is exercised: checking one of them says nothing about the
    // others. Below 1536px the unpinned Tools are a
    // drawer; from 1536px they are a rail popover, which can be pinned into a
    // docked column or popped out into a floating pane.
    await openArtifact(page, 1440, 980);

    const list = page.locator('.motif-cs-feature-annotation-list');
    const openPanel = async () => {
      await openTool(page, 'annotations');
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
    await reachable('Tools drawer');

    await openArtifact(page, TOOLS_PLACEMENT_VIEWPORT.width, 980);
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

  test('a side panel opens with the map whole and the sequence in view, and 1040px gives 40 bases a line', async ({ page }) => {
    // At 700x860 the map frame takes half the window less 95px and the sequence the
    // rest, so at least three whole lines of sequence are in view; the status line shares the
    // Sites and Digest row.
    // At 1040x860 the Sequence is wide enough for 40 bases a line (with the Records
    // list it would be 330px, 25 bases a line, beside a 328px ring).
    const read = () => page.evaluate(() => {
      const viewHeight = window.innerHeight;
      const scroller = document.querySelector('.motif-cs-sequence')!.getBoundingClientRect();
      const lines = [...document.querySelectorAll<HTMLElement>('.motif-cs-sequence .motif-cs-seq-bases[data-line-start]')];
      const whole = lines.filter((line) => {
        const box = line.getBoundingClientRect();
        return box.top >= Math.max(scroller.top, 0) - 1 && box.bottom <= Math.min(scroller.bottom, viewHeight) + 1;
      }).length;
      const frame = document.querySelector('.motif-cs-map-frame')!.getBoundingClientRect();
      const ring = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
      const labels = [...document.querySelectorAll<SVGTextElement>('.motif-cs-map-frame .motif-pm-feature-label, .motif-cs-map-frame .motif-pm-restriction-label')]
        .filter((label) => {
          const box = label.getBoundingClientRect();
          return box.width > 0 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1 && box.left >= frame.left - 1 && box.right <= frame.right + 1;
        });
      const status = document.querySelector('.motif-cs-map-selection-line')?.getBoundingClientRect() ?? null;
      const heads = [...document.querySelectorAll('.motif-cs-map-dock-strip > details > summary')].map((head) => head.getBoundingClientRect());
      return {
        whole,
        basesPerLine: Number(lines[0]?.dataset.lineLen ?? 0),
        ring: Math.round(Math.max(ring.width, ring.height)),
        labels: labels.length,
        sideways: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
        statusTop: status ? Math.round(status.top + status.height / 2) : null,
        statusBottom: status ? Math.round(status.bottom) : null,
        frameBottom: Math.round(frame.bottom),
        headTops: heads.map((head) => Math.round(head.top)),
        headBottoms: heads.map((head) => Math.round(head.bottom)),
        miniature: document.querySelector('.motif-cs-map-frame svg.motif-plasmid-map')?.getAttribute('data-miniature') === 'true',
        recordsShown: Boolean(document.querySelector('[data-pane-key="inventory"]')?.getBoundingClientRect().width),
      };
    });

    await openArtifact(page, 700, 860);
    await expect(page.locator('.motif-cs-map-frame .motif-pm-backbone')).toBeVisible();
    await expect.poll(async () => (await read()).whole).toBeGreaterThanOrEqual(3);
    let geometry = await read();
    expect(geometry.ring).toBeGreaterThanOrEqual(240);
    // All 11 map labels a 377px ring draws are drawn at this smaller ring (one, "BspQI,
    // SapI", reads "BspQI +1" at every frame under 400px).
    expect(geometry.labels).toBeGreaterThanOrEqual(11);
    expect(geometry.sideways).toBeLessThanOrEqual(0);
    // One row under the drawing: the status line sits beside the Sites and Digest
    // heads, below the frame, not in a row of its own.
    expect(geometry.headTops).toHaveLength(2);
    expect(geometry.statusBottom!).toBeLessThanOrEqual(geometry.headBottoms[0] + 1);
    expect(geometry.statusTop!).toBeGreaterThan(geometry.headTops[0]);
    expect(geometry.statusTop!).toBeGreaterThan(geometry.frameBottom);

    // A short side panel keeps three lines and a 200px ring. Its 680x298 frame draws
    // the miniature, which names fewer things (small-ring-miniature.test.ts): eight here.
    await openArtifact(page, 700, 700);
    await expect(page.locator('.motif-cs-map-frame .motif-pm-backbone')).toBeVisible();
    await expect.poll(async () => (await read()).whole).toBeGreaterThanOrEqual(3);
    geometry = await read();
    expect(geometry.ring).toBeGreaterThanOrEqual(200);
    expect(geometry.miniature).toBe(true);
    expect(geometry.labels).toBeGreaterThanOrEqual(8);

    await openArtifact(page, 1040, 860);
    await expect(page.locator('.motif-cs-map-frame .motif-pm-backbone')).toBeVisible();
    await expect.poll(async () => (await read()).basesPerLine).toBeGreaterThanOrEqual(40);
    geometry = await read();
    // 85% of the 328px ring the 40:60 split gives beside an open Records list.
    expect(geometry.ring).toBeGreaterThanOrEqual(279);
    expect(geometry.labels).toBeGreaterThanOrEqual(11);
    expect(geometry.recordsShown).toBe(false);
    // The list is one press away, and opening it gives the side-by-side arrangement.
    await showPane(page, 'inventory');
    await expect.poll(async () => (await read()).recordsShown).toBe(true);
  });
});

test.describe('Collapse chevrons follow the way the panes stand', () => {
  // Below 900px the panes stand one above another, and each Collapse chevron
  // points up or down along the stack, not sideways.
  const chevrons = (page: Page) => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>('[data-pane-key]')]
      .filter((pane) => pane.getBoundingClientRect().width > 0)
      .map((pane) => {
        const icon = pane.querySelector(':scope > .motif-cs-pane-title .motif-cs-pane-collapse svg, :scope > .motif-cs-title-row .motif-cs-pane-collapse svg');
        return [pane.dataset.paneKey, icon ? [...icon.classList].find((name) => name.startsWith('lucide-chevron-')) ?? null : null];
      })
      .filter(([, icon]) => icon !== null),
  ));

  for (const { width, height, expected } of [
    { width: 400, height: 700, expected: { inventory: 'lucide-chevron-up', map: 'lucide-chevron-up', sequence: 'lucide-chevron-down' } },
    { width: 700, height: 860, expected: { inventory: 'lucide-chevron-up', map: 'lucide-chevron-up', sequence: 'lucide-chevron-down' } },
    // Two rows: Records beside Sequence, Map under both.
    { width: 1000, height: 1000, expected: { inventory: 'lucide-chevron-left', map: 'lucide-chevron-down', sequence: 'lucide-chevron-up' } },
    // Side by side keeps its sideways chevrons.
    { width: 1440, height: 900, expected: { inventory: 'lucide-chevron-left', map: 'lucide-chevron-right', sequence: 'lucide-chevron-left' } },
  ]) {
    test(`at ${width}x${height} each Collapse chevron points to the edge its pane gives up`, async ({ page }) => {
      await openArtifact(page, width, height);
      await showPane(page, 'inventory');
      await expect.poll(() => chevrons(page)).toEqual(expected);
      // Map and Sequence alone in one column: the upper points up, the lower down.
      if (width < 900) {
        await page.locator('[data-pane-toggle="inventory"]').click();
        await expect.poll(() => chevrons(page)).toEqual({ map: 'lucide-chevron-up', sequence: 'lucide-chevron-down' });
      }
    });
  }
});
