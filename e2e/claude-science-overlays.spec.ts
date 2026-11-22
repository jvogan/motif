import { expect, test, type Page } from '@playwright/test';

import { openTool } from './tools-drawer';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// Floating surfaces sit beside the work, not on it. A 420x680 Translation window
// floating over the work would cover 64% of the map ring's box at 1280x820 and hold
// 246px of empty protein box; at 700x860 it would cover 79% of the panel and every
// sequence line under it.

type Box = [number, number, number, number];

async function openDefault(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
}

async function pickFirstOrf(page: Page) {
  const rows = page.locator('.motif-cs-orf-select');
  if (!(await rows.first().isVisible())) {
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  }
  await rows.first().click();
  await expect(page.locator('.motif-cs-selection-name')).toContainText('bp');
  if (await page.locator('[data-tools-drawer="open"]').count()) {
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
  }
  await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(0);
}

async function openTranslation(page: Page) {
  await page.getByRole('button', { name: /Translations window/ }).click();
  await expect(page.locator('.motif-cs-window .motif-cs-protein-readout')).toBeVisible();
  // Two frames: the dock reserve and the sheet's scroll land after the window mounts.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** What the open window covers, in the same terms as the measurement above. */
async function coverage(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null): [number, number, number, number] | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    };
    const overlap = (a: number[] | null, b: number[] | null) => {
      if (!a || !b) return 0;
      const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
      const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
      return w > 0 && h > 0 ? Math.round(w * h) : 0;
    };
    const win = document.querySelector('.motif-cs-window')!;
    const windowBox = box(win)!;
    const ring = box(document.querySelector('[data-pane-key="map"] .motif-pm-backbone'));
    const view = document.querySelector('.motif-cs-sequence')!.getBoundingClientRect();
    const main = document.querySelector('.motif-cs-main')!.getBoundingClientRect();
    // Whole line blocks (gutter, bases, track rows) of the first five lines in view.
    const blocks = [...document.querySelectorAll('.motif-cs-sequence .motif-cs-seq-block')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > view.top + 1 && r.top < Math.min(view.bottom, window.innerHeight) - 1;
      })
      .slice(0, 5)
      .map((el) => box(el)!);
    const readout = win.querySelector('.motif-cs-protein-readout')!;
    const readoutBox = readout.getBoundingClientRect();
    let last = readoutBox.top;
    for (const residue of readout.querySelectorAll('*')) {
      const r = residue.getBoundingClientRect();
      if (r.height > 0 && r.bottom > last) last = r.bottom;
    }
    // Lines whose bases sit wholly between the workspace top and the window top.
    const linesAbove = [...document.querySelectorAll('.motif-cs-sequence .motif-cs-seq-bases[data-line-start]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= Math.max(main.top, view.top) && r.bottom <= Math.min(windowBox[1], view.bottom);
      }).length;
    return {
      window: windowBox,
      viewport: [window.innerWidth, window.innerHeight],
      docked: win.hasAttribute('data-docked'),
      mainRight: Math.round(main.right),
      ring: overlap(windowBox, ring),
      ringBox: ring,
      lines: blocks.reduce((sum, block) => sum + overlap(windowBox, block), 0),
      lineCount: blocks.length,
      emptyReadout: Math.round(readoutBox.bottom - last - parseFloat(getComputedStyle(readout).paddingBottom)),
      linesAbove,
    };
  });
}

test.describe('The Translation window sits beside the work', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  // Docked at the right the window would take the Sequence from 470 to 333px (45 to 25
  // bases a line) and the ring from 551 to 351px; floating over the Map it would cover 169,600px2
  // of the Map pane at 1280x820 and 1440x900. From 900px it sits in the flow at the foot of
  // the Sequence column, so only the sequence's height pays: widths, wrap, ring and map names
  // stay as they are with it shut, it covers none of the Map, and the picked ORF stays in view.
  const workbench = (page: Page) => page.evaluate(() => {
    const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    const overlap = (a: DOMRect | null, b: DOMRect | null) => {
      if (!a || !b) return 0;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return w > 0 && h > 0 ? Math.round(w * h) : 0;
    };
    const win = r(document.querySelector('.motif-cs-window'));
    const column = r(document.querySelector('[data-pane-key="sequence"]'))!;
    const panel = r(document.querySelector('[data-pane-key="sequence"] > .motif-cs-sequence-panel'))!;
    const map = r(document.querySelector('[data-pane-key="map"]'))!;
    const seq = document.querySelector('.motif-cs-sequence')!;
    const view = seq.getBoundingClientRect();
    // Base lines wholly inside the scroller and the viewport, with nothing drawn over them.
    const shown = [...seq.querySelectorAll<HTMLElement>('.motif-cs-seq-bases[data-line-start]')].filter((line) => {
      const box = line.getBoundingClientRect();
      if (box.top < Math.max(view.top, 0) - 1 || box.bottom > Math.min(view.bottom, window.innerHeight) + 1) return false;
      return [0.15, 0.5, 0.85].every((f) => seq.contains(document.elementFromPoint(box.left + Math.min(30, box.width / 2), box.top + box.height * f)));
    });
    const picked = shown.filter((line) => line.closest('.motif-cs-seq-block')?.querySelector('.motif-cs-seq-hl:not(.motif-cs-seq-hl-restriction)'));
    const cut = [...document.querySelectorAll('[data-pane-key="map"] svg text')]
      .filter((t) => t.getBoundingClientRect().width > 1 && /…/.test(t.textContent ?? '')).length;
    return {
      sequenceWidth: column.width,
      basesPerLine: Number(document.querySelector('.motif-cs-sequence .motif-cs-seq-bases[data-line-start]')!.getAttribute('data-line-len')),
      ringWidth: r(document.querySelector('[data-pane-key="map"] .motif-pm-backbone'))!.width,
      cutNames: cut,
      mainRight: Math.round(r(document.querySelector('.motif-cs-main'))!.right),
      rows: shown.length,
      pickedRows: picked.length,
      overMap: overlap(win, map),
      window: win ? { left: win.left, right: win.right, top: win.top, bottom: win.bottom, height: win.height } : null,
      column: { left: panel.left, right: panel.right, bottom: column.bottom },
      sequenceBottom: view.bottom,
      docked: document.querySelector('.motif-cs-window')?.hasAttribute('data-docked') ?? false,
      inFlow: document.querySelector('.motif-cs-window')?.hasAttribute('data-in-flow') ?? false,
    };
  });

  for (const [width, height, rows] of [[1280, 820, 4], [1440, 900, 5]] as const) {
    test(`at ${width}x${height} it sits at the foot of the Sequence column and covers none of the Map`, async ({ page }) => {
      await openDefault(page, width, height);
      await pickFirstOrf(page);
      const before = await workbench(page);
      await openTranslation(page);
      const after = await workbench(page);
      expect(after.inFlow).toBe(true);
      expect(after.docked).toBe(false);
      // It pushes nothing sideways: the panes keep their width, their wrap, their ring and their names.
      expect(after.mainRight).toBe(width);
      expect(after.sequenceWidth).toBe(before.sequenceWidth);
      expect(after.basesPerLine).toBe(before.basesPerLine);
      expect(after.ringWidth).toBe(before.ringWidth);
      expect(after.cutNames).toBe(before.cutNames);
      expect(after.overMap, 'window over the Map pane').toBe(0);
      // Under the sequence, as wide as the sequence panel, at the column's foot (inside its
      // 10px padding), and at most 300px tall.
      expect(after.window!.top).toBeGreaterThanOrEqual(after.sequenceBottom - 1);
      expect(Math.abs(after.window!.left - after.column.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.window!.right - after.column.right)).toBeLessThanOrEqual(1);
      expect(after.column.bottom - after.window!.bottom).toBeGreaterThanOrEqual(0);
      expect(after.column.bottom - after.window!.bottom).toBeLessThanOrEqual(11);
      expect(after.window!.height).toBeLessThanOrEqual(300);
      // The sequence keeps whole rows above it, the picked ORF among them.
      expect(after.rows).toBeGreaterThanOrEqual(rows);
      expect(after.pickedRows).toBeGreaterThanOrEqual(1);

      // Collapsed, it gives the rows back; it never moves the panes.
      await page.locator('.motif-cs-window').getByRole('button', { name: 'Collapse Translation' }).click();
      await expect.poll(async () => (await workbench(page)).rows).toBeGreaterThan(after.rows);
      expect((await workbench(page)).mainRight).toBe(width);
    });
  }

  // The window does not read as a form (a scope chip such as "2484-2486 (3)" after a residue
  // click, a labelled genetic-code field with a paragraph under it, the strand and frame,
  // three buttons, then the preview). It is one title row with the scope, one row of controls,
  // the preview (which scrolls inside the window), one row of actions, and a picked residue
  // reads out with its bases as its own line.
  for (const [width, height, rows] of [[1280, 820, 4], [1440, 900, 5]] as const) {
    test(`at ${width}x${height} it reads as a title, a row of controls, the preview and a row of actions`, async ({ page }) => {
      await openDefault(page, width, height);
      await pickFirstOrf(page);
      await openTranslation(page);
      const win = page.locator('.motif-cs-window');
      await expect(win.locator('.motif-cs-window-head')).toContainText('Translation');
      await expect(win.getByTestId('translation-scope')).toHaveText('AmpR · 286 aa');
      const layout = await win.evaluate((el) => {
        // Rows of drawn children, by their vertical centres (a 28px field centres on a 32px group).
        const lines = (box: Element) => new Set([...box.children]
          .filter((child) => child.getBoundingClientRect().width > 1)
          .map((child) => { const r = child.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2 / 4); })).size;
        const head = el.querySelector('.motif-cs-window-head')!;
        const controls = el.querySelector('.motif-cs-translate-controls')!;
        const actions = el.querySelector('.motif-cs-translate-actions')!;
        const readout = el.querySelector<HTMLElement>('.motif-cs-protein-readout')!;
        const body = el.querySelector('.motif-cs-window-body')!;
        const select = controls.querySelector('select')!;
        const note = document.getElementById(select.getAttribute('aria-describedby') ?? '');
        const shownNotes = [...el.querySelectorAll('.motif-cs-form-note, .motif-cs-translate-frame-note')]
          .filter((n) => n.getBoundingClientRect().width > 1 && n.getBoundingClientRect().height > 1);
        return {
          headHeight: head.getBoundingClientRect().height,
          controlLines: lines(controls),
          controlGroups: [...controls.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label')),
          selectLabel: select.getAttribute('aria-label'),
          actionLines: lines(actions),
          actions: [...actions.querySelectorAll('button')].map((b) => b.textContent),
          note: note ? { text: note.textContent ?? '', width: note.getBoundingClientRect().width } : null,
          shownNotes: shownNotes.length,
          readoutScrolls: /auto|scroll/.test(getComputedStyle(readout).overflowY) && readout.scrollHeight > readout.clientHeight + 4,
          bodyOverflow: body.scrollHeight - body.clientHeight,
          readoutInside: readout.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom,
        };
      });
      expect(layout.headHeight).toBeLessThanOrEqual(40);
      expect(layout.controlLines, 'controls on one row').toBe(1);
      expect(layout.controlGroups).toEqual(['Strand', 'Reading frame']);
      expect(layout.selectLabel).toBe('Genetic code');
      expect(layout.actionLines, 'actions on one row').toBe(1);
      expect(layout.actions).toEqual(['Copy protein', 'Pin translation', 'Create protein']);
      // The genetic-code note is still read out with the field, but drawn nowhere.
      expect(layout.note?.text).toMatch(/\S/);
      expect(layout.note?.width).toBeLessThanOrEqual(1);
      expect(layout.shownNotes).toBe(0);
      // The preview scrolls inside the window; the window itself does not.
      expect(layout.readoutScrolls).toBe(true);
      expect(layout.bodyOverflow).toBeLessThanOrEqual(1);
      expect(layout.readoutInside).toBe(true);

      // A residue near the start, then one far down the preview: each reads out with its
      // bases, the selection is its codon, and the codon's row is in view above the window.
      // Until a residue is picked the readout line names the bases the preview reads.
      const readout = page.getByTestId('translation-residue-readout');
      await expect(readout).toHaveText('1,626–2,486 · 861 bp');
      for (const index of [11, 200]) {
        const cell = win.locator('.motif-cs-protein-aa').nth(index);
        await cell.evaluate((node) => {
          const box = node.closest('.motif-cs-protein-readout')!;
          box.scrollTop += node.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2;
        });
        const label = (await cell.getAttribute('aria-label'))!;
        const [, aa, from, to] = /^(.), codon (\d+)-(\d+)$/.exec(label)!;
        await cell.click();
        await expect(readout).toHaveText(new RegExp(`^Picked ${aa === '*' ? '\\*' : aa}${index + 1} · [ACGT]{3} · ${Number(from).toLocaleString('en-US')}–${Number(to).toLocaleString('en-US')}$`));
        await expect(page.locator('.motif-cs-selection-name')).toContainText('3 bp');
        await expect.poll(async () => (await workbench(page)).pickedRows, `codon row of residue ${index + 1} in view`).toBeGreaterThanOrEqual(1);
        const seen = await workbench(page);
        expect(seen.rows).toBeGreaterThanOrEqual(rows);
        expect(seen.overMap).toBe(0);
        // The title still names the protein the preview shows.
        await expect(win.getByTestId('translation-scope')).toHaveText('AmpR · 286 aa');
      }
    });
  }

  // Opened from the Tools drawer, the floating window lands in the Sequence column, not against
  // the pushed Map (x 792 at 1440x900), and stays clear of the picked ORF's marker when the
  // drawer shuts.
  for (const [width, height] of [[1280, 820], [1440, 900]] as const) {
    test(`at ${width}x${height}, opened with the drawer open, it lands in the Sequence column clear of the picked marker`, async ({ page }) => {
      await openDefault(page, width, height);
      await page.getByRole('button', { name: 'Tools', exact: true }).click();
      await page.getByRole('button', { name: 'Analysis', exact: true }).click();
      await page.locator('.motif-cs-orf-select').first().click();
      await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
      await openTranslation(page);
      await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(0);
      const seen = await page.evaluate(() => {
        const win = document.querySelector('.motif-cs-window')!.getBoundingClientRect();
        const column = document.querySelector('[data-pane-key="sequence"] > .motif-cs-sequence-panel')!.getBoundingClientRect();
        const map = document.querySelector('[data-pane-key="map"]')!.getBoundingClientRect();
        const marker = document.querySelector('[data-pane-key="map"] .motif-pm-selection')?.getBoundingClientRect() ?? null;
        const w = marker ? Math.min(win.right, marker.right) - Math.max(win.left, marker.left) : 0;
        const h = marker ? Math.min(win.bottom, marker.bottom) - Math.max(win.top, marker.top) : 0;
        return { left: win.left, right: win.right, columnLeft: column.left, columnRight: column.right, mapLeft: map.left, marker: Boolean(marker), overlap: w > 0 && h > 0 ? Math.round(w * h) : 0 };
      });
      expect(seen.marker, 'the map draws the picked ORF').toBe(true);
      expect(Math.abs(seen.columnRight - seen.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(seen.columnLeft - seen.left)).toBeLessThanOrEqual(1);
      expect(seen.right).toBeLessThanOrEqual(seen.mapLeft);
      expect(seen.overlap, 'window over the picked marker').toBe(0);
    });
  }

  // At 700x860 the window sits in the flow (below); 1px shorter it is the sheet.
  test('below 900px, in a panel under 860px tall, it is a bottom sheet with the picked lines still in view above it', async ({ page }) => {
    await openDefault(page, 700, 859);
    await pickFirstOrf(page);
    // As many whole lines as the Sequence pane shows with nothing open over it.
    const shown = await page.evaluate(() => {
      const view = document.querySelector('.motif-cs-sequence')!.getBoundingClientRect();
      const bottom = Math.min(view.bottom, window.innerHeight);
      return [...document.querySelectorAll('.motif-cs-sequence .motif-cs-seq-bases[data-line-start]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= view.top && r.bottom <= bottom;
        }).length;
    });
    expect(shown).toBeGreaterThanOrEqual(1);
    await openTranslation(page);
    await expect.poll(async () => (await coverage(page)).linesAbove).toBeGreaterThanOrEqual(shown);
    const seen = await coverage(page);
    const [, top, , tall] = seen.window as Box;
    expect(tall).toBeLessThanOrEqual(Math.ceil(859 * 0.45) + 1);
    expect(859 - (top + tall)).toBeLessThanOrEqual(8);
    expect(seen.lines, 'sheet over the lines left in view').toBe(0);
  });

  // From 600px wide in a panel 860px or taller the window sits in the flow at the foot of the
  // Sequence column, at most 240px tall, and the map frame gives up the height: a
  // ring of at least 180px with the picked ORF's arc on it and no name under 12px, two whole
  // lines of bases (the picked codon's among them after a residue click), and the workspace
  // does not scroll.
  test('at 700x860 it sits in the flow under two lines of bases and the Map keeps a ring with the picked arc', async ({ page }) => {
    await openDefault(page, 700, 860);
    await pickFirstOrf(page);
    await openTranslation(page);
    const map = () => page.evaluate(() => {
      const main = document.querySelector('.motif-cs-main')!;
      const top = Math.max(main.getBoundingClientRect().top, 0);
      const bottom = Math.min(main.getBoundingClientRect().bottom, window.innerHeight);
      const inView = (r: DOMRect) => r.width > 2 && r.height > 2 && r.top >= top - 1 && r.bottom <= bottom + 1;
      const pane = document.querySelector('[data-pane-key="map"]')!;
      const ring = pane.querySelector('.motif-pm-backbone')?.getBoundingClientRect();
      const arcs = [...pane.querySelectorAll('.motif-pm-selection-layer *')].map((el) => el.getBoundingClientRect());
      let smallest = Infinity;
      for (const text of pane.querySelectorAll<SVGTextElement>('svg text')) {
        if (text.getBoundingClientRect().width < 1) continue;
        const m = text.getScreenCTM();
        smallest = Math.min(smallest, parseFloat(getComputedStyle(text).fontSize) * (m ? Math.hypot(m.a, m.b) : 1));
      }
      const win = document.querySelector('.motif-cs-window')!;
      return {
        sheet: win.hasAttribute('data-sheet'),
        ring: ring ? ring.width : 0,
        ringInView: !!ring && inView(ring),
        arcInView: arcs.some(inView),
        smallest,
        scrollTop: main.scrollTop,
        overflow: main.scrollHeight - main.clientHeight,
        pageOverflow: document.scrollingElement!.scrollHeight - window.innerHeight,
      };
    });
    const seen = await workbench(page);
    const drawn = await map();
    expect(seen.inFlow).toBe(true);
    expect(drawn.sheet).toBe(false);
    expect(seen.window!.height).toBeLessThanOrEqual(240);
    expect(seen.overMap, 'window over the Map pane').toBe(0);
    expect(drawn.ring).toBeGreaterThanOrEqual(180);
    expect(drawn.ringInView, 'whole ring in view').toBe(true);
    expect(drawn.arcInView, 'picked arc in view').toBe(true);
    expect(drawn.smallest).toBeGreaterThanOrEqual(12);
    expect(drawn.scrollTop).toBe(0);
    expect(drawn.overflow, 'workspace overflow').toBeLessThanOrEqual(0);
    expect(drawn.pageOverflow, 'page overflow').toBeLessThanOrEqual(0);
    expect(seen.rows).toBeGreaterThanOrEqual(2);
    expect(seen.pickedRows).toBeGreaterThanOrEqual(1);

    const win = page.locator('.motif-cs-window');
    const cell = win.locator('.motif-cs-protein-aa').nth(11);
    await cell.evaluate((node) => {
      const box = node.closest('.motif-cs-protein-readout')!;
      box.scrollTop += node.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2;
    });
    await cell.click();
    await expect(page.getByTestId('translation-residue-readout')).toHaveText(/^Picked P12 · [ACGT]{3} · /);
    await expect(page.locator('.motif-cs-selection-name')).toContainText('3 bp');
    await expect.poll(async () => (await workbench(page)).pickedRows, 'codon row in view').toBeGreaterThanOrEqual(1);
    const after = await workbench(page);
    expect(after.rows).toBeGreaterThanOrEqual(2);
    expect(after.window!.height).toBeLessThanOrEqual(240);
    const drawnAfter = await map();
    expect(drawnAfter.arcInView, 'picked codon on the ring').toBe(true);
    expect(drawnAfter.scrollTop).toBe(0);
    expect(drawnAfter.overflow).toBeLessThanOrEqual(0);
  });
});

// The in-flow window's preview shows whole lines: its box does not stop part-way
// into a line.
test.describe('The Translation preview shows whole lines', () => {
  for (const [width, height, cap] of [[1440, 900, 300], [1280, 820, 300], [700, 860, 240]] as const) {
    test(`at ${width}x${height} no line is cut at its bottom edge and it still scrolls`, async ({ page }) => {
      await openDefault(page, width, height);
      await pickFirstOrf(page);
      const overflow = () => page.evaluate(() => {
        const main = document.querySelector('.motif-cs-main')!;
        return main.scrollHeight - main.clientHeight;
      });
      const closed = await overflow();
      await openTranslation(page);
      const preview = await page.evaluate(() => {
        const win = document.querySelector<HTMLElement>('.motif-cs-window[data-in-flow]')!;
        const readout = win.querySelector<HTMLElement>('.motif-cs-protein-readout')!;
        const style = getComputedStyle(readout);
        const lineHeight = parseFloat(style.lineHeight);
        const lines = (readout.clientHeight - parseFloat(style.paddingTop)) / lineHeight;
        return {
          cutPx: Math.round(Math.abs(lines - Math.round(lines)) * lineHeight),
          lines: Math.round(lines),
          scrolls: readout.scrollHeight > readout.clientHeight + 1,
          windowHeight: win.getBoundingClientRect().height,
        };
      });
      expect(preview.cutPx).toBeLessThanOrEqual(1);
      expect(preview.lines).toBeGreaterThanOrEqual(2);
      expect(preview.scrolls).toBe(true);
      expect(preview.windowHeight).toBeLessThanOrEqual(cap);
      expect(await overflow()).toBeLessThanOrEqual(Math.max(0, closed));
    });
  }
});

test.describe('A workflow window opens beside the Sequence, not over it', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  // Primer design opens clear of the Sequence, so the pair it has just chosen can be seen on
  // the bases.
  for (const [width, height] of [[1280, 820], [1440, 900], [700, 860]] as const) {
    test(`Primer design at ${width}x${height}`, async ({ page }) => {
      await openDefault(page, width, height);
      const primer = await openTool(page, 'primer-design');
      await primer.getByRole('button', { name: 'Open primer workspace' }).click();
      const workspace = page.locator('.motif-cs-window[aria-label="Primer design"]');
      await expect(workspace).toBeVisible();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const seen = await workspace.evaluate((win) => {
        const box = win.getBoundingClientRect();
        const cover = (selector: string) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const w = Math.min(box.right, r.right) - Math.max(box.left, r.left);
          const h = Math.min(box.bottom, r.bottom) - Math.max(box.top, r.top);
          return w > 0 && h > 0 ? Math.round((100 * w * h) / (r.width * r.height)) : 0;
        };
        return { box: [box.x, box.y, box.width, box.height], sequence: cover('.motif-cs-sequence'), workspace: cover('.motif-cs-main') };
      });
      expect(seen.sequence, 'share of the Sequence view under the window').toBe(0);
      expect(seen.workspace!, 'share of the workspace under the window').toBeLessThanOrEqual(50);
      if (width < 900) {
        expect(seen.box[3]).toBeLessThanOrEqual(Math.ceil(height * 0.45) + 1);
        expect(height - (seen.box[1] + seen.box[3])).toBeLessThanOrEqual(8);
      } else {
        expect(width - (seen.box[0] + seen.box[2])).toBe(16);
      }
    });
  }

  // Below 900px the sheet stops at 45% of the panel, under the top bar, and is told
  // apart from the work under it by the popover shadow plus a hairline top edge. In
  // forced colours the shadow does not draw, so the edge must be a system-colour border.
  for (const [width, height, forced] of [[700, 860, false], [500, 860, false], [700, 860, true], [500, 860, true]] as const) {
    test(`the ${width}x${height} sheet stops at 45% of the panel and separates from the work${forced ? ' in forced colours' : ''}`, async ({ page }) => {
      if (forced) await page.emulateMedia({ forcedColors: 'active' });
      await openDefault(page, width, height);
      const primer = await openTool(page, 'primer-design');
      await primer.getByRole('button', { name: 'Open primer workspace' }).click();
      const sheet = page.locator('.motif-cs-window[aria-label="Primer design"]');
      await expect(sheet).toBeVisible();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const seen = await sheet.evaluate((win) => {
        const box = win.getBoundingClientRect();
        const style = getComputedStyle(win);
        // The same declarations on a bare element give the token's and the system colour's computed values.
        const probe = document.createElement('div');
        probe.style.cssText = 'box-shadow: var(--elevation-popover); border-top: 1px solid var(--border-subtle); color: CanvasText;';
        win.parentElement!.appendChild(probe);
        const expected = getComputedStyle(probe);
        const token = { shadow: expected.boxShadow, hairline: expected.borderTopColor, canvasText: expected.color };
        probe.remove();
        const tools = document.querySelector('[data-pane-toggle="tools"]')!.getBoundingClientRect();
        const atTools = document.elementFromPoint(tools.left + tools.width / 2, tools.top + tools.height / 2);
        return {
          top: box.top,
          height: box.height,
          bottomGap: window.innerHeight - box.bottom,
          shadow: style.boxShadow,
          borderTop: Number.parseFloat(style.borderTopWidth),
          borderTopStyle: style.borderTopStyle,
          borderTopColor: style.borderTopColor,
          token,
          toolsBottom: tools.bottom,
          toolsReachable: Boolean(atTools?.closest('[data-pane-toggle="tools"]')),
        };
      });
      // A sheet that is not as tall as its content is exactly the cap: 45% of the viewport.
      expect(seen.height).toBeLessThanOrEqual(height * 0.45 + 0.5);
      expect(seen.height).toBeGreaterThanOrEqual(height * 0.45 - 2);
      expect(seen.bottomGap).toBeLessThanOrEqual(8);
      // The top bar and Tools stay above it and reachable.
      expect(seen.top).toBeGreaterThan(seen.toolsBottom);
      expect(seen.toolsReachable).toBe(true);
      expect(seen.borderTop).toBeGreaterThanOrEqual(1);
      expect(seen.borderTopStyle).toBe('solid');
      if (forced) {
        expect(seen.borderTopColor).toBe(seen.token.canvasText);
      } else {
        expect(seen.shadow).not.toBe('none');
        expect(seen.shadow).toBe(seen.token.shadow);
        expect(seen.borderTopColor).toBe(seen.token.hairline);
      }
    });
  }
});

test.describe('From 1280px the Tools drawer pushes the panes', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  async function drawerLayout(page: Page) {
    return page.evaluate(() => {
      const box = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width } : null;
      };
      return {
        drawer: box('.motif-cs-inspector[data-tools-drawer="open"]'),
        main: box('.motif-cs-main')!,
        map: box('[data-pane-key="map"]')!,
        svg: box('[data-pane-key="map"] svg.motif-plasmid-map')!,
        ring: box('[data-pane-key="map"] .motif-pm-backbone')!,
        sequence: box('[data-pane-key="sequence"]')!,
        line: box('.motif-cs-sequence .motif-cs-seq-bases[data-line-start]')!,
        window: box('.motif-cs-window'),
      };
    });
  }

  // A 320px drawer pushes the panes at 1440x900 and 1280x820 rather than covering 44% and 51% of the map,
  // so the map reflows.
  for (const [width, height] of [[1280, 820], [1440, 900]] as const) {
    test(`at ${width}x${height} the Sequence and the Map narrow beside it and stay whole`, async ({ page }) => {
      await openDefault(page, width, height);
      await page.getByRole('button', { name: 'Tools', exact: true }).click();
      await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
      await expect.poll(async () => (await drawerLayout(page)).main.right).toBeLessThanOrEqual(width - 320);
      const seen = await drawerLayout(page);
      const drawer = seen.drawer!;
      expect(seen.svg.right, 'the map drawing ends where the drawer starts').toBeLessThanOrEqual(drawer.left);
      expect(seen.map.right).toBeLessThanOrEqual(drawer.left);
      // The ring is drawn whole inside its drawing, and every line of bases inside its pane.
      expect(seen.ring.left).toBeGreaterThanOrEqual(seen.svg.left);
      expect(seen.ring.right).toBeLessThanOrEqual(seen.svg.right);
      expect(seen.ring.width).toBeGreaterThan(240);
      expect(seen.line.right).toBeLessThanOrEqual(seen.sequence.right);
    });
  }

  // The drawer rewraps the Sequence around its middle line. Open or shut, the first visible
  // line stays.
  for (const [width, height] of [[1440, 900], [1280, 820]] as const) {
    for (const scroll of [0, 700]) {
      test(`at ${width}x${height} opening and shutting it keeps the Sequence's first visible line (scrolled ${scroll}px)`, async ({ page }) => {
        await openDefault(page, width, height);
        const firstLine = () => page.evaluate(() => {
          const sequence = document.querySelector<HTMLElement>('.motif-cs-sequence')!;
          const scroller = [sequence, ...sequence.querySelectorAll<HTMLElement>('*')]
            .find((el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))!;
          const top = scroller.getBoundingClientRect().top;
          const row = [...document.querySelectorAll<HTMLElement>('.motif-cs-sequence .motif-cs-seq-bases[data-line-start]')]
            .find((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= top - 1; })!;
          return { base: Number(row.dataset.lineStart), length: Number(row.dataset.lineLen) };
        });
        if (scroll) {
          await page.evaluate((dy) => {
            const sequence = document.querySelector<HTMLElement>('.motif-cs-sequence')!;
            const scroller = [sequence, ...sequence.querySelectorAll<HTMLElement>('*')]
              .find((el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))!;
            scroller.scrollTop = dy;
          }, scroll);
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        }
        const before = await firstLine();
        if (scroll) expect(before.base).toBeGreaterThan(0);
        const tools = page.getByRole('button', { name: 'Tools', exact: true });
        await tools.click();
        await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
        await expect.poll(async () => (await firstLine()).length).not.toBe(before.length);
        await page.waitForTimeout(150);
        const opened = await firstLine();
        await tools.click();
        await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(0);
        await expect.poll(async () => (await firstLine()).length).toBe(before.length);
        await page.waitForTimeout(150);
        const shut = await firstLine();
        if (scroll === 0) {
          expect(opened.base).toBe(0);
          expect(shut.base).toBe(0);
        } else {
          expect(Math.abs(opened.base - before.base)).toBeLessThanOrEqual(Math.max(before.length, opened.length));
          // Each shut returns to the line read before the drawer opened, with no drift from cycle to cycle.
          expect(shut.base).toBe(before.base);
          for (let cycle = 0; cycle < 4; cycle += 1) {
            await tools.click();
            await expect.poll(async () => (await firstLine()).length).not.toBe(before.length);
            await page.waitForTimeout(150);
            await tools.click();
            await expect.poll(async () => (await firstLine()).length).toBe(before.length);
            await page.waitForTimeout(150);
            expect((await firstLine()).base, `cycle ${cycle + 2}`).toBe(before.base);
          }
          // A scroll by hand while the drawer is open is kept: the shut anchors on what is in view then.
          await tools.click();
          await expect.poll(async () => (await firstLine()).length).not.toBe(before.length);
          await page.evaluate(() => {
            const sequence = document.querySelector<HTMLElement>('.motif-cs-sequence')!;
            const scroller = [sequence, ...sequence.querySelectorAll<HTMLElement>('*')]
              .find((el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))!;
            scroller.scrollTop += 600;
          });
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          const scrolled = await firstLine();
          expect(scrolled.base).toBeGreaterThan(before.base + before.length);
          await tools.click();
          await expect.poll(async () => (await firstLine()).length).toBe(before.length);
          await page.waitForTimeout(150);
          // The line held from before is not restored; read from the pushed wrap, it may land
          // up to two lines from the hand-scrolled base.
          const afterHand = await firstLine();
          expect(afterHand.base).toBeGreaterThan(before.base + before.length);
          expect(Math.abs(afterHand.base - scrolled.base)).toBeLessThanOrEqual(2 * before.length);
        }
      });
    }
  }

  test('below 1280px it still opens over the workspace', async ({ page }) => {
    await openDefault(page, 1100, 820);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
    expect((await drawerLayout(page)).main.right).toBe(1100);
  });

  test('a press beside the pushed drawer lands where it was aimed, then the drawer shuts', async ({ page }) => {
    await openDefault(page, 1440, 900);
    // The map's own controls move when the drawer shuts and the map widens, so a drawer
    // shut on the press would move the Line segment out from under the pointer.
    const line = page.getByRole('group', { name: 'Map shape' }).getByRole('button', { name: 'Line', exact: true });
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
    await expect(line).toHaveAttribute('aria-pressed', 'false');
    await line.click();
    await expect(line).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(0);
  });

  for (const [width, height] of [[1440, 900], [1280, 820]] as const) {
    test(`at ${width}x${height} a drag beside the pushed drawer leaves it open, so the range just drawn can be grabbed again at once`, async ({ page }) => {
      await openDefault(page, width, height);
      const shape = page.getByRole('group', { name: 'Map shape' });
      await shape.getByRole('button', { name: 'Line', exact: true }).click();
      await page.getByRole('button', { name: 'Tools', exact: true }).click();
      await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
      const backbone = page.locator('.motif-cs-map-frame .motif-pm-backbone');
      const band = page.locator('.motif-cs-map-frame .motif-pm-selection');
      await page.waitForTimeout(400);
      // The precondition: the drawer is pushing the panes, not covering them.
      expect((await drawerLayout(page)).main.right).toBeLessThanOrEqual(width - 300);
      const before = (await backbone.boundingBox())!;
      const y = before.y + before.height / 2;
      const from = before.x + before.width * 0.15;
      const to = before.x + before.width * 0.55;
      await page.mouse.move(from, y);
      await page.mouse.down();
      for (let step = 1; step <= 10; step += 1) await page.mouse.move(from + (to - from) * step / 10, y);
      await page.mouse.up();
      // Grab the range again within a tenth of a second. Shutting the drawer on that
      // release would widen the map under the pointer, and this press would land on
      // the Sequence.
      await page.waitForTimeout(60);
      await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
      const after = (await backbone.boundingBox())!;
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
      const press = from + 10;
      const release = before.x + before.width * 0.3;
      await page.mouse.move(press, y);
      await page.mouse.down();
      for (let step = 1; step <= 10; step += 1) await page.mouse.move(press + (release - press) * step / 10, y);
      await page.mouse.up();
      const drawn = (await band.boundingBox())!;
      expect(Math.abs(drawn.x - press)).toBeLessThanOrEqual(6);
      expect(Math.abs(drawn.x + drawn.width - release)).toBeLessThanOrEqual(6);
      // A plain click beside the drawer still shuts it.
      await shape.getByRole('button', { name: 'Circle', exact: true }).click();
      await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(0);
    });
  }

  test('a cancelled press beside the pushed drawer leaves it open, and a later release inside it does not shut it', async ({ page }) => {
    await openDefault(page, 1440, 900);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
    // A touch the browser takes for a scroll ends in pointercancel, never pointerup.
    await page.evaluate(() => {
      const outside = document.querySelector('.motif-cs-main')!;
      outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true }));
      window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true }));
    });
    await page.waitForTimeout(50);
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
    // A press and release inside the drawer is not a press outside it.
    await page.evaluate(() => {
      const inside = document.querySelector('.motif-cs-inspector[data-tools-drawer="open"]')!;
      inside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerId: 8, pointerType: 'mouse', isPrimary: true }));
      inside.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 8, pointerType: 'mouse', isPrimary: true }));
    });
    await page.waitForTimeout(50);
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
  });

  test('with the Translation window open too, neither covers the other', async ({ page }) => {
    await openDefault(page, 1280, 820);
    await openTranslation(page);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(1);
    await expect.poll(async () => (await drawerLayout(page)).window!.right).toBeLessThanOrEqual(1280 - 320);
    const seen = await drawerLayout(page);
    expect(seen.window!.left).toBeGreaterThanOrEqual(0);
    // The window is still on top of the panes, and the drawer leaves it alone.
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.motif-cs-window') !== null, [seen.window!.left + 20, seen.window!.top + 20]);
    expect(hit).toBe(true);
  });
});

test.describe('The Import popover drops from its button', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  // It opens at its button, not at a fixed place apart from it: 4px under the button with the
  // button's left edge, or its right edge where the left would leave the viewport, 8px inside
  // it. Being as wide as the Records pane, at 1280 and 1440 it reaches 65px into the
  // Sequence while open.
  for (const [width, height, edge] of [[1440, 900, 'left'], [1280, 820, 'left'], [700, 860, 'right'], [400, 700, 'clamped']] as const) {
    test(`at ${width}x${height} it opens 4px under its button, ${edge} edge on the button's`, async ({ page }) => {
      await openDefault(page, width, height);
      const button = page.locator('[aria-controls="motif-cs-add-entry"]:visible');
      await button.click();
      const panel = page.locator('#motif-cs-add-entry[open]');
      await expect(panel).toBeVisible();
      const b = (await button.boundingBox())!;
      const seen = await panel.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return { right: r.right, bottom: r.bottom, left: r.left, top: r.top, sideways: node.scrollWidth - node.clientWidth };
      });
      expect(seen.top - (b.y + b.height)).toBeCloseTo(4, 0);
      if (edge === 'left') expect(Math.abs(seen.left - b.x)).toBeLessThanOrEqual(0.5);
      if (edge === 'right') expect(Math.abs(seen.right - (b.x + b.width))).toBeLessThanOrEqual(0.5);
      if (edge === 'clamped') expect(seen.left).toBeCloseTo(8, 0);
      expect(seen.left).toBeGreaterThanOrEqual(8 - 0.5);
      expect(seen.right).toBeLessThanOrEqual(width - 8 + 0.5);
      expect(seen.bottom).toBeLessThanOrEqual(height);
      expect(seen.sideways, 'nothing in it runs off its right edge').toBeLessThanOrEqual(1);
      // Every field still takes typing.
      await panel.getByPlaceholder('Optional name').fill('Typed name');
      await expect(panel.getByPlaceholder('Optional name')).toHaveValue('Typed name');
      // Escape closes it and puts focus back on the button.
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(button).toBeFocused();
      // So does a click on blank workspace outside it.
      await button.click();
      await expect(panel).toBeVisible();
      const blank = await page.evaluate(() => {
        const p = document.querySelector('#motif-cs-add-entry')!.getBoundingClientRect();
        for (let y = innerHeight - 4; y > 0; y -= 9) for (let x = innerWidth - 4; x > 0; x -= 13) {
          if (x >= p.left - 2 && x <= p.right + 2 && y >= p.top - 2 && y <= p.bottom + 2) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit && !hit.closest('button, a, input, select, textarea, summary, svg, [tabindex], [contenteditable]')) return [x, y];
        }
        return null;
      });
      expect(blank).not.toBeNull();
      await page.mouse.click(blank![0], blank![1]);
      await expect(panel).toHaveCount(0);
      await expect(button).toBeFocused();
    });
  }
});

test.describe('The records strip shows whole tabs and counts the rest', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  /** Tabs the strip shows in full, tabs it shows in part, and the "+N" count. */
  async function strip(page: Page) {
    return page.evaluate(() => {
      const nav = document.querySelector('.motif-cs-record-tabs')!;
      const box = nav.getBoundingClientRect();
      // A clip on the strip would also cut its scrollbar, so nothing clips it: the
      // strip's own box is what shows, and a hidden tab (opacity 0) shows nothing.
      const stripClip = getComputedStyle(nav).clipPath;
      const tabs = [...nav.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => {
        const r = tab.getBoundingClientRect();
        const hidden = Number(getComputedStyle(tab).opacity) === 0 || getComputedStyle(tab).visibility === 'hidden';
        const inStrip = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left));
        const shown = hidden ? 0 : inStrip;
        // A hidden tab must not take a press on what looks like blank strip.
        const x = (Math.max(r.left, box.left) + Math.min(r.right, box.right)) / 2;
        const pressable = hidden && inStrip > 1
          && document.elementFromPoint(x, r.top + r.height / 2)?.closest('[role="tab"]') === tab;
        return { name: tab.getAttribute('aria-label'), shown, width: r.width, focused: tab === document.activeElement, pressable };
      });
      const more = document.querySelector('.motif-cs-record-strip-more')?.textContent?.trim() ?? '';
      // Within a pixel, as the strip's own measure counts a tab in view.
      return {
        whole: tabs.filter((tab) => tab.shown >= tab.width - 1).map((tab) => tab.name),
        cut: tabs.filter((tab) => tab.shown > 1 && tab.shown < tab.width - 1).map((tab) => tab.name),
        focusedWhole: tabs.some((tab) => tab.focused && tab.shown >= tab.width - 1),
        total: tabs.length,
        more: Number(/^\+(\d+)/.exec(more)?.[1] ?? 0),
        stripClip,
        hiddenButPressable: tabs.filter((tab) => tab.pressable).map((tab) => tab.name),
      };
    });
  }

  // At each size the tabs that do not fit whole are hidden from the strip and counted in "+N".
  for (const [width, height] of [[700, 860], [400, 700]] as const) {
    test(`at ${width}x${height} no tab is cut and "+N" counts every tab not shown whole`, async ({ page }) => {
      await openDefault(page, width, height);
      const seen = await strip(page);
      expect(seen.cut).toEqual([]);
      expect(seen.stripClip).toBe('none');
      expect(seen.hiddenButPressable).toEqual([]);
      expect(seen.whole.length).toBeGreaterThan(0);
      expect(seen.more).toBe(seen.total - seen.whole.length);

      // The last tab is reached from the keyboard and then shown whole.
      await page.locator('.motif-cs-record-tab[data-active="true"]').focus();
      await page.keyboard.press('End');
      await expect.poll(async () => (await strip(page)).focusedWhole).toBe(true);
      expect((await strip(page)).cut).toEqual([]);
    });
  }
});
