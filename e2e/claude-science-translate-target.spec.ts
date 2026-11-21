import { expect, test, type Locator, type Page } from '@playwright/test';
import { openTranslationFromTools } from './tools-drawer';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// What a pick translates to. An ORF row or a find match carries its own strand, so the
// Translation window, both status lines and Create read the protein the pick names.

// A 21-residue ORF, ATG to TGA: MKRISTTITTTITITTGNGAG*.
const ORF = 'ATGAAACGCATTAGCACCACCATTACCACCACCATCACCATTACCACAGGTAACGGTGCGGGCTGA';
const ORF_PROTEIN = 'MKRISTTITTTITITTGNGAG*';
// Stops in every frame of both strands and no start codon, so the only ORFs are the ones placed.
const FILLER = 'TAAT';

function reverseComplement(value: string): string {
  const pair: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
  return value.split('').reverse().map((base) => pair[base]).join('');
}

async function openRecords(page: Page, records: Array<Record<string, unknown>>, width = 700) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await page.evaluate((value) => window.motifRenderInventory(value), records);
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
}

async function readouts(page: Page) {
  return {
    bar: (await page.locator('.motif-cs-selection-name').textContent())?.trim(),
    map: (await page.locator('.motif-cs-map-selection-line').textContent())?.trim(),
  };
}

async function openAnalysis(page: Page) {
  const rows = page.locator('.motif-cs-orf-select');
  if (await rows.first().isVisible()) return;
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(rows.first()).toBeVisible();
}

// The centre of base `base` (0-based) on screen, with its line scrolled into view.
async function basePoint(page: Page, base: number) {
  const point = await page.evaluate((target) => {
    const row = [...document.querySelectorAll<HTMLElement>('.motif-cs-seq-bases[data-line-start]')]
      .find((node) => target >= Number(node.dataset.lineStart) && target < Number(node.dataset.lineStart) + Number(node.dataset.lineLen));
    if (!row) return null;
    const bounds = row.getBoundingClientRect();
    const scroller = row.closest('.motif-cs-sequence')?.getBoundingClientRect();
    const top = Math.max(120, scroller?.top ?? 0);
    const bottom = Math.min(window.innerHeight, scroller?.bottom ?? window.innerHeight) - 40;
    if (bounds.top < top || bounds.bottom > bottom) row.scrollIntoView({ block: 'center' });
    const text = row.querySelector('.motif-cs-seq-glyphs')!.firstChild!;
    const range = document.createRange();
    const offset = target - Number(row.dataset.lineStart);
    range.setStart(text, offset);
    range.setEnd(text, offset + 1);
    const box = range.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, base);
  expect(point, `base ${base} is drawn`).not.toBeNull();
  return point!;
}

// Drags from base `from` to base `to` (0-based, both selected).
async function dragBases(page: Page, from: number, to: number) {
  // Placing the second end can scroll the first, so the first is measured again.
  await basePoint(page, from);
  const b = await basePoint(page, to);
  const a = await basePoint(page, from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

// The residues a track draws for the codons inside `from`..`to` (1-based, inclusive), in reading order.
async function drawnResidues(page: Page, trackId: string, from: number, to: number, strand: 1 | -1) {
  const codons = await page.locator(`.motif-cs-seq-aa[data-aa-track-id="${trackId}"]`).evaluateAll((nodes) => nodes.map((node) => {
    const [, first, last] = /codon (\d+)-(\d+)/.exec(node.getAttribute('aria-label') ?? '') ?? [];
    return { first: Number(first), last: Number(last), aa: node.textContent!.trim() };
  }));
  return codons
    .filter((codon) => codon.first >= from && codon.last <= to)
    .sort((a, b) => strand * (a.first - b.first))
    .map((codon) => codon.aa)
    .join('');
}

async function windowReading(page: Page) {
  const win = page.locator('.motif-cs-window');
  return {
    strand: (await win.getByRole('group', { name: 'Strand' }).locator('button[aria-pressed="true"]').textContent())?.trim(),
    frame: (await win.getByRole('group', { name: 'Reading frame' }).locator('button[aria-pressed="true"]').textContent())?.trim(),
    protein: (await win.locator('.motif-cs-protein-aa').allTextContents()).join(''),
    note: (await win.locator('.motif-cs-translate-frame-note').allTextContents()).join(''),
  };
}

test.describe('A pick that has a strand translates on that strand', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  const linear = FILLER.repeat(15) + ORF + FILLER.repeat(15) + reverseComplement(ORF) + FILLER.repeat(15);

  test('an ORF row reads its own strand from its start codon, in the window, both status lines and Create', async ({ page }) => {
    await openRecords(page, [{ id: 'orfs', name: 'ORFs', molecule: 'dna', topology: 'linear', seq: linear, annotations: [] }]);
    await page.getByRole('button', { name: /Translations window/ }).click();
    await openAnalysis(page);
    const rows = page.locator('.motif-cs-orf-select');

    // The reverse ORF: bases 187-252, read from 252 down.
    await rows.filter({ hasText: '187-252' }).click();
    await expect.poll(() => readouts(page)).toEqual({ bar: '187–252 · 66 bp · − strand', map: '187–252 · 66 bp · − strand' });
    await expect.poll(() => windowReading(page)).toEqual({ strand: 'Antisense', frame: '+1', protein: ORF_PROTEIN, note: '' });
    await page.locator('.motif-cs-window').getByRole('button', { name: 'Create protein' }).click();
    await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord()?.seq)).toBe(ORF_PROTEIN);
  });

  test('a forward ORF row reads from its start codon and says no strand, as a dragged range does', async ({ page }) => {
    await openRecords(page, [{ id: 'orfs', name: 'ORFs', molecule: 'dna', topology: 'linear', seq: linear, annotations: [] }]);
    await page.getByRole('button', { name: /Translations window/ }).click();
    await openAnalysis(page);
    await page.locator('.motif-cs-orf-select').filter({ hasText: '61-126' }).click();
    await expect.poll(() => readouts(page)).toEqual({ bar: '61–126 · 66 bp', map: '61–126 · 66 bp' });
    await expect.poll(() => windowReading(page)).toEqual({ strand: 'Sense', frame: '+1', protein: ORF_PROTEIN, note: '' });
  });

  test('a reverse find match reads its own strand, and a range dragged after it reads the top strand again', async ({ page }) => {
    await openRecords(page, [{ id: 'orfs', name: 'ORFs', molecule: 'dna', topology: 'linear', seq: linear, annotations: [] }]);
    await page.locator('.motif-cs-seq-bases').first().click();
    await page.keyboard.press('ControlOrMeta+f');
    await page.getByRole('searchbox', { name: 'Find in sequence' }).fill(ORF.slice(0, 12));
    await page.keyboard.press('Enter');
    await expect.poll(() => readouts(page)).toEqual({ bar: '61–72 · 12 bp', map: '61–72 · 12 bp' });
    await page.keyboard.press('Enter');
    await expect.poll(() => readouts(page)).toEqual({ bar: '241–252 · 12 bp · − strand', map: '241–252 · 12 bp · − strand' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Translations window/ }).click();
    await expect.poll(() => windowReading(page)).toEqual({ strand: 'Antisense', frame: '+1', protein: 'MKRI', note: '' });

    // Shift+click extends the match as a plain range, which reads the top strand. The window
    // closes first so that it cannot cover the base.
    await page.getByRole('button', { name: /Translations window/ }).click();
    const extended = await basePoint(page, 270);
    await page.keyboard.down('Shift');
    await page.mouse.click(extended.x, extended.y);
    await page.keyboard.up('Shift');
    await expect.poll(() => readouts(page)).toEqual({ bar: '241–271 · 31 bp', map: '241–271 · 31 bp' });
    await page.getByRole('button', { name: /Translations window/ }).click();
    await expect.poll(async () => (await windowReading(page)).strand).toBe('Sense');
  });

  for (const strand of [1, -1] as const) {
    test(`an ORF across the origin of a circular record reads its protein (${strand === 1 ? 'forward' : 'reverse'})`, async ({ page }) => {
      const forward = ORF.slice(30) + FILLER.repeat(30) + ORF.slice(0, 30);
      const seq = strand === 1 ? forward : reverseComplement(forward);
      await openRecords(page, [{ id: 'ring', name: 'Ring', molecule: 'dna', topology: 'circular', seq, annotations: [] }]);
      await page.getByRole('button', { name: /Translations window/ }).click();
      await openAnalysis(page);
      await page.locator('.motif-cs-orf-select').filter({ hasText: '21 aa' }).click();
      const expected = strand === 1 ? '157–36 · 66 bp · across the origin' : '151–30 · 66 bp · across the origin · − strand';
      await expect.poll(() => readouts(page)).toEqual({ bar: expected, map: expected });
      await expect.poll(() => windowReading(page)).toEqual({ strand: strand === 1 ? 'Sense' : 'Antisense', frame: '+1', protein: ORF_PROTEIN, note: '' });
      // At 700x900 the window sits in the flow at the foot of the Sequence column, under the
      // Tools drawer like the rest of the work, so the drawer shuts before its button is pressed.
      if (await page.locator('[data-tools-drawer="open"]').count()) {
        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(0);
      }
      await page.locator('.motif-cs-window').getByRole('button', { name: 'Create protein' }).click();
      await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord()?.seq)).toBe(ORF_PROTEIN);
    });
  }
});

test.describe('A base range inside one coding feature reads in its frame', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  const CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
  const seq = CHUNK.repeat(4).slice(0, 360);
  const annotations = [
    { id: 'forward', name: 'fwd', type: 'cds', start: 3, end: 150, strand: 1, color: '#2f9e6f' },
    { id: 'reverse', name: 'rev', type: 'cds', start: 170, end: 300, strand: -1, color: '#c9803d', metadata: { codon_start: 2 } },
    { id: 'overlap', name: 'ovl', type: 'cds', start: 100, end: 151, strand: 1, color: '#3b6fd0' },
  ];
  const toggleWindow = (page: Page) => page.getByRole('button', { name: /Translations window/ }).click();

  test('the window reads the residues drawn under the bases, says whose frame, and nothing below the header moves', async ({ page }) => {
    await openRecords(page, [{ id: 'cds', name: 'CDS record', molecule: 'dna', topology: 'linear', seq, annotations }], 1040);
    await toggleWindow(page);
    const win = page.locator('.motif-cs-window');
    const box = async (selector: string) => {
      const bounds = await win.locator(selector).first().boundingBox();
      return { top: bounds?.y, height: bounds?.height };
    };
    const header = await box('.motif-cs-window-head');
    const controls = await box('.motif-cs-translate-controls');
    await toggleWindow(page);

    // Inside the reverse CDS (/codon_start=2), not on a codon boundary at either end.
    await dragBases(page, 199, 230);
    await expect.poll(() => readouts(page)).toEqual({ bar: '200–231 · 32 bp', map: '200–231 · 32 bp' });
    const drawn = await drawnResidues(page, 'feat:reverse', 200, 231, -1);
    expect(drawn.length).toBe(10);
    await toggleWindow(page);
    await expect.poll(() => windowReading(page)).toMatchObject({ strand: 'Antisense', protein: drawn, note: 'Frame of rev, − strand' });
    expect(await box('.motif-cs-window-head')).toEqual(header);
    expect(await box('.motif-cs-translate-controls')).toEqual(controls);

    // Another strand reads the range itself, so the note goes; the header keeps its height.
    await win.getByRole('button', { name: 'Sense', exact: true }).click();
    await expect.poll(async () => (await windowReading(page)).note).toBe('');
    expect(await box('.motif-cs-window-head')).toEqual(header);
    await toggleWindow(page);

    // Inside the forward CDS only.
    await dragBases(page, 20, 40);
    await toggleWindow(page);
    await expect.poll(() => windowReading(page)).toMatchObject({
      strand: 'Sense', frame: '+2', protein: await drawnResidues(page, 'feat:forward', 21, 41, 1), note: 'Frame of fwd, + strand',
    });
    await toggleWindow(page);
  });

  test('a range in no coding feature, or in two, reads the top strand from its first base and adds no note', async ({ page }) => {
    await openRecords(page, [{ id: 'cds', name: 'CDS record', molecule: 'dna', topology: 'linear', seq, annotations }], 1040);
    for (const [from, to] of [[155, 165], [110, 130], [140, 180]]) {
      await dragBases(page, from, to);
      await expect.poll(() => readouts(page)).toEqual({ bar: `${from + 1}–${to + 1} · ${to - from + 1} bp`, map: `${from + 1}–${to + 1} · ${to - from + 1} bp` });
      await toggleWindow(page);
      await expect.poll(() => windowReading(page)).toMatchObject({ strand: 'Sense', frame: '+1', note: '' });
      await toggleWindow(page);
    }
  });
});

test.describe('Selected bases tint the residues drawn over them', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  const CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
  const seq = CHUNK.repeat(4).slice(0, 360);
  const annotations = [
    { id: 'forward', name: 'fwd', type: 'cds', start: 3, end: 150, strand: 1, color: '#2f9e6f' },
    { id: 'reverse', name: 'rev', type: 'cds', start: 170, end: 300, strand: -1, color: '#c9803d', metadata: { codon_start: 2 } },
    { id: 'overlap', name: 'ovl', type: 'cds', start: 100, end: 151, strand: 1, color: '#3b6fd0' },
  ];

  // Per track, the codons (1-based "first-last") of tinted residues, and of residues with any base in from..to.
  async function tints(page: Page, from: number, to: number) {
    return page.locator('.motif-cs-seq-aa').evaluateAll((nodes, [low, high]) => {
      const result: Record<string, { tinted: string[]; touched: string[] }> = {};
      for (const node of nodes) {
        const track = node.getAttribute('data-aa-track-id')!;
        const [, first, last] = /codon (\d+)-(\d+)/.exec(node.getAttribute('aria-label') ?? '') ?? [];
        const codon = `${first}-${last}`;
        result[track] ??= { tinted: [], touched: [] };
        if (node.getAttribute('data-selected') === 'true') result[track].tinted.push(codon);
        if (Number(first) <= high && Number(last) >= low) result[track].touched.push(codon);
      }
      return result;
    }, [from, to]);
  }

  test('a base range tints every residue with a base in it, on both strands and in every row, and keeps its own bases', async ({ page }) => {
    await openRecords(page, [{ id: 'cds', name: 'CDS record', molecule: 'dna', topology: 'linear', seq, annotations }], 1040);
    await expect(page.locator('.motif-cs-seq-aa[data-selected="true"]')).toHaveCount(0);

    // Bases 21-41 of the forward CDS: the codons 22-24 .. 40-42, half of the last one inside.
    await dragBases(page, 20, 40);
    await expect.poll(() => readouts(page)).toEqual({ bar: '21–41 · 21 bp', map: '21–41 · 21 bp' });
    let seen = await tints(page, 21, 41);
    expect(seen['feat:forward'].touched).toEqual(['19-21', '22-24', '25-27', '28-30', '31-33', '34-36', '37-39', '40-42']);
    expect(seen['feat:forward'].tinted).toEqual(seen['feat:forward'].touched);
    expect(seen['feat:reverse'].tinted).toEqual([]);

    // Over the overlap of two forward CDSs in different frames: both rows tint.
    await dragBases(page, 110, 125);
    await expect.poll(() => readouts(page)).toEqual({ bar: '111–126 · 16 bp', map: '111–126 · 16 bp' });
    seen = await tints(page, 111, 126);
    for (const track of ['feat:forward', 'feat:overlap']) {
      expect(seen[track].touched.length, track).toBeGreaterThan(4);
      expect(seen[track].tinted, track).toEqual(seen[track].touched);
    }

    // The reverse CDS, whose codons start at its top-strand end: the edge codons are half inside.
    await dragBases(page, 200, 230);
    await expect.poll(() => readouts(page)).toEqual({ bar: '201–231 · 31 bp', map: '201–231 · 31 bp' });
    seen = await tints(page, 201, 231);
    expect(seen['feat:reverse'].touched).toEqual(expect.arrayContaining(['231-233', '201-203']));
    expect(seen['feat:reverse'].tinted).toEqual(seen['feat:reverse'].touched);
    expect(seen['feat:forward'].tinted).toEqual([]);

    // Cleared, nothing is tinted.
    await page.keyboard.press('Escape');
    await expect.poll(() => readouts(page)).toEqual({ bar: 'Drag to select a range', map: 'Click a feature, or drag to select a range' });
    await expect(page.locator('.motif-cs-seq-aa[data-selected="true"]')).toHaveCount(0);
  });
});

test.describe('The Translation window is as tall as its protein, up to a cap', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  const CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
  // About 900 residues read as one whole-record translation.
  const seq = CHUNK.repeat(27).slice(0, 2700);

  // Under 681px the top bar has no Translations toggle; the Translation tool's row opens the window.
  async function toggleTranslationWindow(page: Page) {
    const toggle = page.getByRole('button', { name: /Translations window/ });
    if (await toggle.isVisible()) {
      await toggle.click();
      return;
    }
    const win = page.locator('.motif-cs-window');
    if (await win.count()) {
      await win.getByRole('button', { name: /Close/ }).first().click();
      return;
    }
    await openTranslationFromTools(page);
  }

  // Offsets are from the window's own top edge: below 900px the window is a bottom
  // sheet, so its top edge is where its content height puts it.
  async function layout(page: Page) {
    return page.locator('.motif-cs-window').evaluate((win) => {
      const box = win.getBoundingClientRect();
      const top = (selector: string) => Math.round(win.querySelector(selector)!.getBoundingClientRect().top - box.top);
      const body = win.querySelector<HTMLElement>('.motif-cs-window-body')!;
      const readout = win.querySelector<HTMLElement>('.motif-cs-protein-readout')!;
      const bodyBox = body.getBoundingClientRect();
      const readoutBox = readout.getBoundingClientRect();
      return {
        header: top('.motif-cs-window-head'),
        controls: top('.motif-cs-translate-controls'),
        actions: top('.motif-cs-translate-actions'),
        readout: [Math.round(readoutBox.top - box.top), Math.round(readoutBox.height)],
        // Space left in the body under the readout and the action row that follows it: the
        // body's own bottom padding.
        below: Math.round(bodyBox.bottom - Math.max(readoutBox.bottom, win.querySelector('.motif-cs-translate-actions')!.getBoundingClientRect().bottom)),
        // The action row sits right under the readout.
        readoutToActions: Math.round(win.querySelector('.motif-cs-translate-actions')!.getBoundingClientRect().top - readoutBox.bottom),
        bodyScrolls: body.scrollHeight > body.clientHeight + 1,
        readoutScrolls: readout.scrollHeight > readout.clientHeight + 1,
        scrollbar: readout.offsetWidth - readout.clientWidth - 2,
        residues: win.querySelectorAll('.motif-cs-protein-aa').length,
        inFlow: win.hasAttribute('data-in-flow'),
        frame: { top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height), viewport: window.innerHeight },
      };
    });
  }

  for (const width of [400, 700, 1040]) {
    test(`at ${width}px a long protein fills the window to its cap and scrolls itself, a short one shrinks the window, and nothing above the readout moves`, async ({ page }) => {
      await openRecords(page, [{ id: 'long', name: 'Long record', molecule: 'dna', topology: 'linear', seq, annotations: [] }], width);
      await toggleTranslationWindow(page);
      const whole = await layout(page);
      expect(whole.residues).toBe(900);
      expect(whole.below, 'the readout and its action row reach the bottom of the window body').toBeLessThanOrEqual(16);
      expect(whole.readoutToActions).toBeGreaterThanOrEqual(0);
      expect(whole.readoutToActions).toBeLessThanOrEqual(12);
      if (width < 900) {
        // A bottom sheet no taller than 45% of the panel, on the panel's bottom edge.
        expect(whole.frame.height).toBeLessThanOrEqual(Math.ceil(whole.frame.viewport * 0.45) + 1);
        expect(whole.frame.viewport - whole.frame.bottom).toBeLessThanOrEqual(8);
      } else {
        // From 900px it sits in the flow at the foot of the Sequence column, at most 300px tall.
        expect(whole.inFlow).toBe(true);
        expect(whole.frame.height).toBeLessThanOrEqual(300);
        expect(whole.frame.viewport - whole.frame.bottom).toBeLessThanOrEqual(12);
      }
      expect(whole.bodyScrolls, 'the window body itself does not scroll').toBe(false);
      if (width > 900) {
        expect(whole.readoutScrolls, 'a long protein scrolls inside the readout').toBe(true);
      } else if (width > 600) {
        // The 700px sheet holds the whole 900-residue protein within its cap.
        expect(whole.readoutScrolls, 'the whole protein shows in the sheet').toBe(false);
        expect(whole.frame.height).toBeLessThanOrEqual(Math.ceil(whole.frame.viewport * 0.45) + 1);
      }
      expect(whole.scrollbar, 'the readout keeps room for its scrollbar').toBeGreaterThan(0);

      await toggleTranslationWindow(page);
      // At 400px the Tools sheet that opened the window is still up over the sequence.
      if (await page.locator('[data-tools-drawer="open"]').count()) await page.keyboard.press('Escape');
      await expect(page.locator('[data-tools-drawer="open"]')).toHaveCount(0);
      // Within the first line at every width, so the drag never scrolls the page.
      await dragBases(page, 17, 31);
      await expect.poll(() => readouts(page)).toEqual({ bar: '18–32 · 15 bp', map: '18–32 · 15 bp' });
      await toggleTranslationWindow(page);
      const selection = await layout(page);
      // The record's proposed ORF draws a track over these bases, so they read in its frame.
      expect(selection.residues).toBe(4);
      if (width < 900) {
        // Four residues need less room than 900: the sheet is as tall as its content.
        expect(selection.frame.height).toBeLessThan(whole.frame.height);
        expect(selection.readout[1]).toBeLessThan(whole.readout[1]);
        // The anchored edge stays put: the bottom for a sheet.
        expect(selection.frame.bottom).toBe(whole.frame.bottom);
      } else {
        // In the flow the window keeps one height, so the sequence above it never jumps
        // between a selection and the whole record.
        expect(selection.frame.top).toBe(whole.frame.top);
        expect(selection.frame.height).toBe(whole.frame.height);
      }
      // And nothing above the readout moves inside the window; the action row follows the
      // readout's foot, the same distance under it.
      const still = (value: typeof whole) => ({ ...value, residues: 0, readoutScrolls: false, readout: value.readout[0], actions: value.actions - value.readout[0] - value.readout[1], frame: null });
      expect(still(selection)).toEqual(still(whole));
    });
  }
});

test.describe('A joined CDS draws its amino-acid row', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  const CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
  const seq = CHUNK.repeat(4).slice(0, 360);
  const annotations = [
    { id: 'j1', name: 'join1', type: 'cds', start: 0, end: 90, strand: 1, subRanges: [{ start: 0, end: 30, strand: 1 }, { start: 60, end: 90, strand: 1 }] },
    // Codon 11 is base 131 before the gap and 161-162 after it.
    { id: 'j2', name: 'split', type: 'cds', start: 100, end: 189, strand: 1, subRanges: [{ start: 100, end: 131, strand: 1 }, { start: 160, end: 189, strand: 1 }] },
    {
      id: 'j3', name: 'revj', type: 'cds', start: 200, end: 290, strand: -1,
      subRanges: [{ start: 260, end: 290, strand: -1 }, { start: 200, end: 230, strand: -1 }], metadata: { motifSubRangeOrder: 'biological' },
    },
  ];
  const row = (page: Page, trackId: string) => page.locator(`.motif-cs-seq-aa[data-aa-track-id="${trackId}"]`);
  const rowProtein = async (page: Page, trackId: string) => (await row(page, trackId).evaluateAll((nodes) => nodes
    .map((node) => [Number((node as HTMLElement).dataset.residueIndex), node.textContent!.trim()] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, aa]) => aa))).join('');

  test('each joined row reads what the Translation window reads for its feature, on both strands', async ({ page }) => {
    await openRecords(page, [{ id: 'join', name: 'Join', molecule: 'dna', topology: 'linear', seq, annotations }], 1040);
    await page.getByRole('button', { name: /Translations window/ }).click();
    const readout = page.locator('.motif-cs-window .motif-cs-protein-readout');
    for (const trackId of ['feat:j1', 'feat:j2', 'feat:j3']) {
      const drawn = await rowProtein(page, trackId);
      expect(drawn.length, trackId).toBe(20);
      await page.locator('.motif-cs-seq-aa-row').filter({ has: row(page, trackId) }).first().locator('.motif-cs-aa-row-label').click();
      await expect(readout, trackId).toHaveText(drawn);
    }
    expect(await rowProtein(page, 'feat:j1')).toBe('MASKGEELFTGDVNGHKFSV');
  });

  test('a codon split by the gap draws its letter over its own bases and selects, tints and translates as one residue', async ({ page }) => {
    await openRecords(page, [{ id: 'join', name: 'Join', molecule: 'dna', topology: 'linear', seq, annotations }], 1040);
    const split = row(page, 'feat:j2').and(page.locator('[data-residue-index="10"]'));
    const rest = page.locator('.motif-cs-seq-aa-cont[data-aa-track-id="feat:j2"][data-residue-index="10"]');
    await expect(split).toHaveAttribute('aria-label', 'L, codon 131, 161-162');
    await expect(rest).toHaveCount(1);
    // The letter covers bases 161-162, which hold the middle base, and the rest of the codon covers base 131.
    const columns = await page.evaluate(() => {
      const columnOf = (node: Element) => {
        const block = node.closest('.motif-cs-seq-block')!;
        const bases = block.querySelector<HTMLElement>('.motif-cs-seq-bases[data-line-start]')!;
        const text = bases.querySelector('.motif-cs-seq-glyphs')!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 1);
        const cell = range.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        const lineStart = Number(bases.dataset.lineStart);
        return [lineStart + Math.round((box.left - cell.left) / cell.width) + 1, lineStart + Math.round((box.right - cell.left) / cell.width)];
      };
      return {
        letter: columnOf(document.querySelector('.motif-cs-seq-aa[data-aa-track-id="feat:j2"][data-residue-index="10"]')!),
        rest: columnOf(document.querySelector('.motif-cs-seq-aa-cont[data-aa-track-id="feat:j2"][data-residue-index="10"]')!),
      };
    });
    expect(columns).toEqual({ letter: [161, 162], rest: [131, 131] });

    // Selecting only bases after the gap tints the residue, its piece before the gap included.
    await dragBases(page, 160, 161);
    await expect(split).toHaveAttribute('data-selected', 'true');
    await expect(rest).toHaveAttribute('data-selected', 'true');

    // Pressing the split residue selects its bases, gap included, and the window reads one residue.
    await split.click();
    await expect.poll(() => readouts(page)).toEqual({ bar: '131–162 · 32 bp', map: '131–162 · 32 bp' });
    await page.getByRole('button', { name: /Translations window/ }).click();
    await expect.poll(async () => (await windowReading(page)).protein).toBe('L');
    await page.getByRole('button', { name: /Translations window/ }).click();
    // A run across the gap reads only the codons' own bases.
    await row(page, 'feat:j2').and(page.locator('[data-residue-index="12"]')).click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: /Translations window/ }).click();
    await expect.poll(async () => (await windowReading(page)).protein).toBe('LVM');
    await expect(page.locator('.motif-cs-window').getByRole('button', { name: 'Pin translation' })).toBeDisabled();
  });

  for (const strand of [1, -1] as const) {
    test(`an ORF across the origin added with Add feature draws its row (${strand === 1 ? 'forward' : 'reverse'})`, async ({ page }) => {
      const forward = ORF.slice(30) + FILLER.repeat(30) + ORF.slice(0, 30);
      await openRecords(page, [{ id: 'ring', name: 'Ring', molecule: 'dna', topology: 'circular', seq: strand === 1 ? forward : reverseComplement(forward), annotations: [] }], 1040);
      await openAnalysis(page);
      await page.locator('.motif-cs-analysis-row').filter({ hasText: '21 aa' }).first().getByRole('button', { name: 'Add feature' }).click();
      await page.keyboard.press('Escape');
      await expect.poll(() => rowProtein(page, 'feat:feature-orf-1')).toBe(ORF_PROTEIN);
    });
  }

  for (const strand of [1, -1] as const) {
    test(`hovering either piece of a codon split by the origin tints both (${strand === 1 ? 'forward' : 'reverse'})`, async ({ page }) => {
      // One base more of the ORF before the origin, so its 11th codon has a base on each side.
      const forward = ORF.slice(31) + FILLER.repeat(30) + ORF.slice(0, 31);
      await openRecords(page, [{ id: 'ring', name: 'Ring', molecule: 'dna', topology: 'circular', seq: strand === 1 ? forward : reverseComplement(forward), annotations: [] }], 1040);
      await openAnalysis(page);
      await page.locator('.motif-cs-analysis-row').filter({ hasText: '21 aa' }).first().getByRole('button', { name: 'Add feature' }).click();
      await page.keyboard.press('Escape');
      await expect.poll(() => rowProtein(page, 'feat:feature-orf-1')).toBe(ORF_PROTEIN);
      // A click in the filler leaves the new feature's residues unselected, so hover shows.
      const filler = await basePoint(page, 100);
      await page.mouse.click(filler.x, filler.y);
      // Codon 11 (index 10) holds the ORF's bases 31 to 33, on both sides of the origin.
      const rest = page.locator('.motif-cs-seq-aa-cont[data-aa-track-id="feat:feature-orf-1"][data-residue-index="10"]');
      const letter = page.locator('.motif-cs-seq-aa[data-aa-track-id="feat:feature-orf-1"][data-residue-index="10"]');
      await expect(rest).toHaveCount(1);
      expect(await hoverTinted(letter)).toBe(false);
      await rest.hover();
      await expect.poll(() => hoverTinted(letter), 'the letter tints when its other piece is hovered').toBe(true);
      await letter.hover();
      await expect.poll(() => hoverTinted(rest), 'the other piece tints when the letter is hovered').toBe(true);
    });
  }
});

// Whether a residue piece shows the hover tint (its background is not transparent).
const hoverTinted = (piece: Locator) =>
  piece.evaluate((element) => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)');

test.describe('An amino-acid row ends where its line of bases ends', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  const CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
  const seq = CHUNK.repeat(4).slice(0, 360);
  // Two phases on each strand, so codons cross line ends at every line width.
  const annotations = [
    { id: 'f1', name: 'fwd1', type: 'cds', start: 0, end: 300, strand: 1 },
    { id: 'f2', name: 'fwd2', type: 'cds', start: 1, end: 301, strand: 1 },
    { id: 'r1', name: 'rev1', type: 'cds', start: 30, end: 330, strand: -1 },
    { id: 'r2', name: 'rev2', type: 'cds', start: 32, end: 332, strand: -1 },
  ];

  // At 400px the bases' gutter narrows to 38px; the rows must narrow with it.
  for (const width of [400, 1040, 1440]) {
    test(`no letter passes the line end, and a codon across it is drawn on both lines at ${width}px`, async ({ page }) => {
      await openRecords(page, [{ id: 'lines', name: 'Lines', molecule: 'dna', topology: 'linear', seq, annotations }], width);
      await expect(page.locator('.motif-cs-seq-aa[data-aa-track-id="feat:r2"]').first()).toBeAttached();
      const result = await page.evaluate(() => {
        const columnsOf = (node: Element) => {
          const bases = node.closest('.motif-cs-seq-block')!.querySelector<HTMLElement>('.motif-cs-seq-bases[data-line-start]')!;
          const text = bases.querySelector('.motif-cs-seq-glyphs')!.firstChild!;
          const length = Number(bases.dataset.lineLen);
          const cell = (offset: number) => {
            const range = document.createRange();
            range.setStart(text, offset);
            range.setEnd(text, offset + 1);
            return range.getBoundingClientRect();
          };
          const first = cell(0);
          const last = cell(length - 1);
          const box = node.getBoundingClientRect();
          const lineStart = Number(bases.dataset.lineStart);
          const from = Math.round((box.left - first.left) / first.width);
          const to = Math.round((box.right - first.left) / first.width);
          return { lineStart, past: box.right - last.right, bases: Array.from({ length: to - from }, (_, i) => lineStart + from + i + 1) };
        };
        let past = 0;
        let pieces = 0;
        const split: Record<string, Array<{ codon: number[]; letter: number[]; rest: number[]; lines: number }>> = {};
        for (const node of document.querySelectorAll('.motif-cs-seq-aa, .motif-cs-seq-aa-cont')) {
          pieces += 1;
          if (columnsOf(node).past > 0.5) past += 1;
        }
        for (const rest of document.querySelectorAll<HTMLElement>('.motif-cs-seq-aa-cont')) {
          const track = rest.dataset.aaTrackId!;
          const letter = document.querySelector(`.motif-cs-seq-aa[data-aa-track-id="${track}"][data-residue-index="${rest.dataset.residueIndex}"]`)!;
          const [, a, b] = /codon (\d+)-(\d+)/.exec(letter.getAttribute('aria-label')!)!.map(Number);
          const l = columnsOf(letter);
          const r = columnsOf(rest);
          (split[track] ??= []).push({ codon: [a, a + 1, b], letter: l.bases, rest: r.bases, lines: new Set([l.lineStart, r.lineStart]).size });
        }
        return { past, pieces, split };
      });
      expect(result.pieces).toBeGreaterThan(300);
      expect(result.past).toBe(0);
      for (const track of ['feat:f1', 'feat:f2', 'feat:r1', 'feat:r2']) {
        const codons = result.split[track] ?? [];
        expect(codons.length, track).toBeGreaterThan(0);
        for (const codon of codons) {
          // Its two pieces lie on two lines and cover its three bases; the letter covers the middle one.
          expect(codon.lines, track).toBe(2);
          expect([...codon.letter, ...codon.rest].sort((x, y) => x - y), track).toEqual(codon.codon);
          expect(codon.letter, track).toContain(codon.codon[1]);
        }
      }
    });
  }

  test('a codon across the line end selects and tints as one residue on either strand', async ({ page }) => {
    await openRecords(page, [{ id: 'lines', name: 'Lines', molecule: 'dna', topology: 'linear', seq, annotations }], 1040);
    for (const track of ['feat:f2', 'feat:r2']) {
      const rest = page.locator(`.motif-cs-seq-aa-cont[data-aa-track-id="${track}"]`).first();
      const index = await rest.getAttribute('data-residue-index');
      const letter = page.locator(`.motif-cs-seq-aa[data-aa-track-id="${track}"][data-residue-index="${index}"]`);
      const [, a, b] = /codon (\d+)-(\d+)/.exec((await letter.getAttribute('aria-label'))!)!;
      await rest.click();
      await expect.poll(() => readouts(page)).toEqual({ bar: `${a}–${b} · 3 bp`, map: `${a}–${b} · 3 bp` });
      await expect(letter).toHaveAttribute('data-selected', 'true');
      await expect(rest).toHaveAttribute('data-selected', 'true');
    }
  });

  test('hovering either piece of a codon across the line end tints both, on either strand', async ({ page }) => {
    // Hovering either piece tints the whole residue, so it reads as one.
    await openRecords(page, [{ id: 'lines', name: 'Lines', molecule: 'dna', topology: 'linear', seq, annotations }], 1040);
    for (const track of ['feat:f2', 'feat:r2']) {
      const rest = page.locator(`.motif-cs-seq-aa-cont[data-aa-track-id="${track}"]`).first();
      const index = await rest.getAttribute('data-residue-index');
      const letter = page.locator(`.motif-cs-seq-aa[data-aa-track-id="${track}"][data-residue-index="${index}"]`);
      const neighbour = page.locator(`.motif-cs-seq-aa[data-aa-track-id="${track}"][data-residue-index="${Number(index) + 2}"]`);
      expect(await hoverTinted(letter), track).toBe(false);
      await rest.hover();
      await expect.poll(() => hoverTinted(letter), `${track}: the letter tints when its other piece is hovered`).toBe(true);
      expect(await hoverTinted(rest), track).toBe(true);
      await letter.hover();
      await expect.poll(() => hoverTinted(rest), `${track}: the other piece tints when the letter is hovered`).toBe(true);
      // Moving on clears both pieces; another residue tints alone.
      await neighbour.hover();
      await expect.poll(() => hoverTinted(rest), `${track}: the other piece clears`).toBe(false);
      expect(await hoverTinted(letter), track).toBe(false);
      expect(await hoverTinted(neighbour), track).toBe(true);
    }
  });
});
