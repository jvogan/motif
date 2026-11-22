import { expect, test, type Locator, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// A selection in the sequence view is one flat tint whose edges sit on base cell edges. These checks
// measure the real layout, because the defects they guard (a second native-selection band, an overlay
// measured in a different unit from the glyphs) do not show up in the DOM or the stylesheet text.

const BASE_CHUNK = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
const SEQUENCE = BASE_CHUNK.repeat(4).slice(0, 360);
const ALIGNMENT_TOLERANCE_PX = 0.5;

const widths = [400, 700, 1040] as const;

type OverlayAudit = {
  line: number;
  strand: 'coding' | 'complement';
  dLeft: number;
  dRight: number;
  outside: number;
};

async function openRecord(page: Page, width: number, topology: 'linear' | 'circular' = 'linear') {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await page.evaluate(({ seq, recordTopology }) => window.motifRenderInventory([{
    id: 'selection-record',
    name: 'Selection record',
    molecule: 'dna',
    topology: recordTopology,
    seq,
    annotations: [
      { id: 'f-forward', name: 'forward CDS', type: 'cds', start: 3, end: 150, strand: 1, color: '#2f9e6f' },
      { id: 'f-reverse', name: 'reverse gene', type: 'gene', start: 170, end: 300, strand: -1, color: '#c9803d' },
      ...(recordTopology === 'circular' ? [{
        id: 'f-wrap',
        name: 'across origin',
        type: 'cds',
        start: 0,
        end: seq.length,
        strand: 1,
        color: '#3b6fd0',
        subRanges: [{ start: seq.length - 20, end: seq.length, strand: 1 }, { start: 0, end: 14, strand: 1 }],
      }] : []),
    ],
  }]), { seq: SEQUENCE, recordTopology: topology });
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
  const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
  if ((await tracks.getAttribute('data-active')) !== 'true') await tracks.click();
  await expect(page.locator('.motif-cs-feature-block').first()).toBeVisible();
}

async function cellWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const glyphs = document.querySelector('.motif-cs-seq-glyphs')!;
    const range = document.createRange();
    range.setStart(glyphs.firstChild!, 0);
    range.setEnd(glyphs.firstChild!, 1);
    return range.getBoundingClientRect().width;
  });
}

// Press inside base `fromCell` of line `fromLine` and release inside `toCell` of `toLine`.
// Cell positions are fractions: 0.7 presses past the middle of a base, which is where a native
// text selection snaps to the NEXT character edge and the app's own hit-test does not.
async function dragBetween(page: Page, fromLine: number, fromCell: number, toLine: number, toCell: number) {
  const rows = page.locator('.motif-cs-seq-bases');
  await rows.nth(fromLine).scrollIntoViewIfNeeded();
  const width = await cellWidth(page);
  const from = (await rows.nth(fromLine).boundingBox())!;
  const to = (await rows.nth(toLine).boundingBox())!;
  await page.mouse.move(from.x + width * fromCell, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + width * toCell, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.motif-cs-seq-hl').first()).toBeVisible();
}

// Compare every selection overlay with the real glyph cells it covers, row by row.
async function auditOverlays(page: Page): Promise<OverlayAudit[]> {
  return page.evaluate(() => {
    const rows: Array<{ line: number; strand: 'coding' | 'complement'; dLeft: number; dRight: number; outside: number }> = [];
    const cell = (node: Node, index: number) => {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      return range.getBoundingClientRect();
    };
    for (const bases of document.querySelectorAll<HTMLElement>('.motif-cs-seq-bases')) {
      const lineStart = Number(bases.dataset.lineStart);
      const overlays = bases.querySelectorAll<HTMLElement>(
        '.motif-cs-seq-hl:not(.motif-cs-seq-hl-motif):not(.motif-cs-seq-hl-restriction)',
      );
      for (const overlay of overlays) {
        const rect = overlay.getBoundingClientRect();
        const first = Math.round(parseFloat(overlay.style.left));
        const count = Math.round(parseFloat(overlay.style.width));
        for (const glyphs of bases.querySelectorAll('.motif-cs-seq-glyphs')) {
          const text = glyphs.firstChild;
          if (!text || text.nodeType !== Node.TEXT_NODE) continue;
          const firstCell = cell(text, first);
          const lastCell = cell(text, first + count - 1);
          const basesBox = bases.getBoundingClientRect();
          rows.push({
            line: lineStart,
            strand: glyphs.classList.contains('motif-cs-seq-complement') ? 'complement' : 'coding',
            dLeft: rect.left - firstCell.left,
            dRight: rect.right - lastCell.right,
            // The tint must stay inside the row of bases it highlights.
            outside: Math.max(0, basesBox.top - rect.top, rect.bottom - basesBox.bottom),
          });
        }
      }
    }
    return rows;
  });
}

function expectAligned(audit: OverlayAudit[], label: string) {
  expect(audit.length, `${label}: overlays measured`).toBeGreaterThan(0);
  for (const row of audit) {
    expect(Math.abs(row.dLeft), `${label}: line ${row.line} ${row.strand} left edge off by ${row.dLeft}px`).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
    expect(Math.abs(row.dRight), `${label}: line ${row.line} ${row.strand} right edge off by ${row.dRight}px`).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
    expect(row.outside, `${label}: line ${row.line} ${row.strand} tint leaves its row`).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
  }
}

async function decodePixels(page: Page, png: Buffer, points: Array<[number, number]>): Promise<Array<[number, number, number]>> {
  const decoder = await page.context().newPage();
  try {
    await decoder.setContent('<canvas id="c"></canvas>');
    return await decoder.evaluate(async ({ base64, at }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.getElementById('c') as HTMLCanvasElement;
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      return at.map(([x, y]) => {
        const data = context.getImageData(x, y, 1, 1).data;
        return [data[0], data[1], data[2]] as [number, number, number];
      });
    }, { base64: png.toString('base64'), at: points });
  } finally {
    await decoder.close();
  }
}

// The colour the overlay is meant to paint, rasterised so color-mix() resolves, over the sequence surface.
async function expectedTint(overlay: Locator): Promise<[number, number, number]> {
  return overlay.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const rasterise = (value: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = '#000000';
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2], data[3] / 255];
    };
    const surface = rasterise(getComputedStyle(element.closest('.motif-cs-sequence')!).backgroundColor);
    const tint = rasterise(getComputedStyle(element).backgroundColor);
    return [0, 1, 2].map((i) => Math.round(tint[i] * tint[3] + surface[i] * (1 - tint[3]))) as [number, number, number];
  });
}

test.describe('Sequence selection layer', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');
  test.use({ deviceScaleFactor: 2 });

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

  for (const width of widths) {
    test(`aligns a dragged range, with tracks on and off and the complement shown, at ${width}px`, async ({ page }) => {
      await openRecord(page, width);
      // 0.7 into the first base: a native text selection would start one base inside.
      await dragBetween(page, 0, 0.7, 0, 20.6);
      expectAligned(await auditOverlays(page), `${width}px, tracks on`);

      await page.getByRole('button', { name: 'Complement strand' }).click();
      await dragBetween(page, 0, 0.7, 1, 11.6);
      const withComplement = await auditOverlays(page);
      expect(withComplement.some((row) => row.strand === 'complement'), 'complement row measured').toBe(true);
      expectAligned(withComplement, `${width}px, complement shown, across two lines`);

      await page.getByRole('button', { name: 'Show tracks' }).first().click();
      await expect(page.locator('.motif-cs-feature-block')).toHaveCount(0);
      await dragBetween(page, 0, 3.7, 2, 8.6);
      expectAligned(await auditOverlays(page), `${width}px, tracks off, across three lines`);
    });

    test(`aligns a selected feature and a selection across the circular origin at ${width}px`, async ({ page }) => {
      await openRecord(page, width, 'circular');
      await page.locator('.motif-cs-feature-block').filter({ hasText: 'forward CDS' }).first().click();
      expectAligned(await auditOverlays(page), `${width}px, selected feature`);

      await page.locator('.motif-cs-feature-block').filter({ hasText: 'across origin' }).first().click();
      const wrapped = await auditOverlays(page);
      expect(new Set(wrapped.map((row) => row.line)).size, 'the selection reaches both the last and the first line').toBeGreaterThan(1);
      expectAligned(wrapped, `${width}px, selection across the origin`);
    });
  }

  test('paints a selection once: the overlay tint is the only thing on the bases', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value: string) => { (window as unknown as { __copied?: string }).__copied = value; } },
      });
    });
    await openRecord(page, 700);
    await dragBetween(page, 0, 0.7, 0, 36.6);
    // The drag owns the selection, so the browser starts none: there is no second, native
    // band under the overlay. Copy still works, because Cmd/Ctrl+C copies the app's own range.
    expect(await page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBe(0);
    await page.keyboard.press('Control+C');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied?.length ?? 0)).toBeGreaterThan(10);
    // The copy notice can overlap the first line's bases while it shows. Measure once it
    // has gone.
    await expect(page.locator('.motif-cs-workbench-notice')).toHaveCount(0, { timeout: 10_000 });
    // Only the overlay paints. A pixel inside the tint, above the letters, is the tint
    // colour itself; a native highlight over it would darken it.
    const overlay = page.locator('.motif-cs-seq-hl:not(.motif-cs-seq-hl-motif):not(.motif-cs-seq-hl-restriction)').first();
    const box = (await overlay.boundingBox())!;
    const width = await cellWidth(page);
    const dpr = 2;
    const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
    const png = await page.screenshot({ clip });
    const points: Array<[number, number]> = [0, 3, 9, 17, 25, 33, 36].map((cell) => [
      Math.round(width * (cell + 0.5) * dpr),
      Math.round(1.5 * dpr),
    ]);
    const tint = await expectedTint(overlay);
    for (const pixel of await decodePixels(page, png, points)) {
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(pixel[channel] - tint[channel]), `pixel ${pixel} against the tint ${tint}`).toBeLessThanOrEqual(2);
      }
    }
  });

  test('only repaints on select, deselect and hover: nothing inside the sequence view moves', async ({ page }) => {
    await openRecord(page, 700);
    const targets = '.motif-cs-seq-block, .motif-cs-seq-bases, .motif-cs-seq-glyphs, .motif-cs-seq-index, .motif-cs-feature-block, .motif-cs-restriction-label, .motif-cs-seq-aa, .motif-cs-aa-row-label';
    // Positions inside the sequence's own scrolling content, so a shift of the whole pane or a
    // scroll does not count against the view.
    const layout = () => page.evaluate((selector) => {
      const container = document.querySelector<HTMLElement>('.motif-cs-sequence')!;
      const origin = container.getBoundingClientRect();
      return [...container.querySelectorAll<HTMLElement>(selector)].slice(0, 400).map((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.left - origin.left, rect.top - origin.top + container.scrollTop, rect.width, rect.height];
      });
    }, targets);
    const expectUnchanged = async (before: number[][], label: string) => {
      const after = await layout();
      expect(after.length, `${label}: same elements`).toBe(before.length);
      before.forEach((rect, index) => {
        rect.forEach((value, axis) => {
          expect(Math.abs(after[index][axis] - value), `${label}: element ${index} axis ${axis}`).toBeLessThanOrEqual(0.5);
        });
      });
    };

    const resting = await layout();
    await dragBetween(page, 0, 0.7, 1, 20.6);
    await expectUnchanged(resting, 'after a drag');
    await page.keyboard.press('Escape');
    await expectUnchanged(resting, 'after Escape');
    await page.locator('.motif-cs-feature-block').first().click();
    await expectUnchanged(resting, 'after selecting a feature');
    await page.keyboard.press('Escape');
    await page.locator('.motif-cs-feature-block').nth(1).hover();
    await expectUnchanged(resting, 'while hovering a feature bar');
    const residue = page.locator('.motif-cs-seq-aa').first();
    if (await residue.count()) {
      await residue.hover();
      await expectUnchanged(resting, 'while hovering a residue');
    }
    await page.locator('.motif-cs-restriction-label').first().hover();
    await expectUnchanged(resting, 'while hovering a restriction label');
    await page.locator('.motif-cs-restriction-label').first().click();
    await expect(page.locator('.motif-cs-restriction-label[data-selected="true"]')).toHaveCount(1);
    await expectUnchanged(resting, 'after selecting a restriction label');
  });

  test('lets only the caret animate on the sequence view', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openRecord(page, 700);
    await dragBetween(page, 0, 0.7, 1, 20.6);
    await page.locator('.motif-cs-feature-block').first().hover();
    await page.locator('.motif-cs-seq-bases').first().click({ position: { x: 40, y: 8 } });
    const endless = await page.evaluate(() => document.getAnimations()
      .filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
        return Boolean(target?.closest('.motif-cs-sequence')) && animation.effect?.getComputedTiming().iterations === Infinity;
      })
      .map((animation) => ((animation.effect as KeyframeEffect).target as Element).className));
    expect(endless.every((name) => String(name).includes('motif-cs-seq-caret'))).toBe(true);
  });
});

// Selecting amino acids in a translation selects the bases they code for. A press selects one
// codon; a drag, Shift+click or Shift+arrows select a run of residues; the run and its bases
// carry the same flat tint, and both status lines state the base range.
const CHUNK_FOR_ORIGIN = BASE_CHUNK.repeat(2).slice(0, 180);
const FORWARD = '.motif-cs-seq-aa[data-aa-track-id="feat:aa-forward"]';
const REVERSE = '.motif-cs-seq-aa[data-aa-track-id="feat:aa-reverse"]';
const SELECTED = '.motif-cs-seq-aa[data-selected="true"]';

// Records what the app writes to the clipboard.
async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { (window as unknown as { __copied?: string }).__copied = value; } },
    });
  });
}

function copied(page: Page) {
  return page.evaluate(() => (window as unknown as { __copied?: string }).__copied);
}

async function openTranslatedRecord(page: Page, width = 700, extra: Array<Record<string, unknown>> = []) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await page.evaluate(({ seq, more }) => window.motifRenderInventory([{
    id: 'aa-record',
    name: 'Amino-acid record',
    molecule: 'dna',
    topology: 'linear',
    seq,
    annotations: [
      { id: 'aa-forward', name: 'forward CDS', type: 'cds', start: 3, end: 150, strand: 1, color: '#2f9e6f' },
      { id: 'aa-reverse', name: 'reverse CDS', type: 'cds', start: 170, end: 300, strand: -1, color: '#c9803d' },
      ...more,
    ],
  }]), { seq: SEQUENCE, more: extra });
  const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
  if ((await tracks.getAttribute('data-active')) !== 'true') await tracks.click();
  await expect(page.locator(FORWARD).first()).toBeVisible();
  await expect(page.locator(REVERSE).first()).toBeAttached();
}

async function readouts(page: Page) {
  return {
    bar: (await page.locator('.motif-cs-selection-name').textContent())?.trim(),
    map: (await page.locator('.motif-cs-map-selection-line').textContent())?.trim(),
  };
}

// The readout a run of residues should produce, from the codons the residues name.
async function expectedReadout(residues: Locator): Promise<string> {
  const codons = await residues.evaluateAll((nodes) => nodes.map((node) => {
    const [, first, last] = /codon (\d+)-(\d+)/.exec(node.getAttribute('aria-label') ?? '') ?? [];
    return [Number(first), Number(last)];
  }));
  const low = Math.min(...codons.map(([first]) => first));
  const high = Math.max(...codons.map(([, last]) => last));
  return `${low.toLocaleString()}–${high.toLocaleString()} · ${(high - low + 1).toLocaleString()} bp`;
}

async function dragResidues(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function sequenceLayout(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.motif-cs-sequence')!;
    const origin = container.getBoundingClientRect();
    const inside = [...container.querySelectorAll<HTMLElement>('.motif-cs-seq-block, .motif-cs-seq-bases, .motif-cs-seq-aa, .motif-cs-aa-row-label, .motif-cs-feature-block')]
      .slice(0, 600)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.left - origin.left, rect.top - origin.top + container.scrollTop, rect.width, rect.height];
      });
    const outside = [...document.querySelectorAll<HTMLElement>('.motif-cs-selection-actions button, .motif-cs-sequence, .motif-cs-map-selection-line')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.left, rect.top, rect.width, rect.height];
      });
    return { inside, outside, scrollTop: container.scrollTop };
  });
}

function expectSameLayout(before: Awaited<ReturnType<typeof sequenceLayout>>, after: Awaited<ReturnType<typeof sequenceLayout>>, label: string) {
  expect(after.scrollTop, `${label}: the sequence did not scroll`).toBe(before.scrollTop);
  for (const key of ['inside', 'outside'] as const) {
    expect(after[key].length, `${label}: same ${key} elements`).toBe(before[key].length);
    before[key].forEach((rect, index) => rect.forEach((value, axis) => {
      expect(Math.abs(after[key][index][axis] - value), `${label}: ${key} element ${index} axis ${axis}`).toBeLessThanOrEqual(0.5);
    }));
  }
}

test.describe('Amino-acid selection', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');
  test.use({ deviceScaleFactor: 2 });

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

  test('a plain click still selects one codon, and the residue takes the selection tint', async ({ page }) => {
    await openTranslatedRecord(page);
    const lysine = page.locator(FORWARD).nth(2);
    await expect(lysine).toHaveText('K');
    await lysine.click();
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–12 · 3 bp', map: '10–12 · 3 bp' });
    await expect(page.locator(SELECTED)).toHaveCount(1);
    await expect(lysine).toHaveAttribute('data-selected', 'true');
    // The residue sits on one band in the bases' tint, exactly as wide as the residue.
    await expect(page.locator('.motif-cs-aa-hl')).toHaveCount(1);
    const band = await page.evaluate(() => {
      const hl = document.querySelector<HTMLElement>('.motif-cs-aa-hl')!;
      const residue = document.querySelector('.motif-cs-seq-aa[data-selected="true"]')!.getBoundingClientRect();
      const rect = hl.getBoundingClientRect();
      return {
        tint: getComputedStyle(hl).backgroundColor,
        baseTint: getComputedStyle(document.querySelector('.motif-cs-seq-hl')!).backgroundColor,
        dLeft: rect.left - residue.left,
        dRight: rect.right - residue.right,
      };
    });
    expect(band.tint).toBe(band.baseTint);
    expect(Math.abs(band.dLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(band.dRight)).toBeLessThanOrEqual(0.5);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

    // The row label still selects the whole translation for copy, and its feature. The
    // feature's bases are selected, so every residue drawn over them takes the tint.
    const label = page.locator('.motif-cs-seq-aa-row').filter({ has: page.locator(FORWARD) }).first().locator('.motif-cs-aa-row-label');
    await label.click();
    await expect(label).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(SELECTED)).toHaveCount(await page.locator(FORWARD).count());
    await expect(page.locator(`${REVERSE}[data-selected="true"]`)).toHaveCount(0);
    expect((await readouts(page)).bar).toMatch(/^forward CDS · /);
  });

  test('a drag within a line selects every codon from the pressed residue to the one under the pointer', async ({ page }) => {
    await stubClipboard(page);
    await openTranslatedRecord(page);
    const before = await sequenceLayout(page);
    await dragResidues(page, page.locator(FORWARD).nth(2), page.locator(FORWARD).nth(8));
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–30 · 21 bp', map: '10–30 · 21 bp' });
    await expect(page.locator(SELECTED)).toHaveCount(7);
    await expect(page.locator(SELECTED)).toHaveText(['K', 'G', 'E', 'E', 'L', 'F', 'T']);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? ''), 'no native text selection').toBe('');
    // One block: one band under the residues, spanning exactly the bases' tint.
    await expect(page.locator('.motif-cs-aa-hl')).toHaveCount(1);
    const edges = await page.evaluate(() => {
      const residues = document.querySelector('.motif-cs-aa-hl')!.getBoundingClientRect();
      const bases = document.querySelector('.motif-cs-seq-hl')!.getBoundingClientRect();
      return { left: residues.left - bases.left, right: residues.right - bases.right };
    });
    expect(Math.abs(edges.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(edges.right)).toBeLessThanOrEqual(0.5);
    expectSameLayout(before, await sequenceLayout(page), 'after the drag');
    // Copy and Add feature act on the bases, as they do after a base drag.
    await expect(page.getByRole('button', { name: 'Add feature' })).toBeEnabled();
    await page.keyboard.press('Control+C');
    await expect.poll(() => copied(page)).toBe(SEQUENCE.slice(9, 30));
    // The Translation window then reads the dragged bases.
    await page.getByRole('button', { name: /Translations window/ }).click();
    await expect(page.getByRole('dialog', { name: 'Translation' }).getByTestId('translation-residue-readout')).toContainText('10–30 · 21 bp');
  });

  test('a run is one band with no seam where two residues meet', async ({ page }) => {
    // At 700px the second line's residues sit on fractional pixels; the tint is one band under
    // them, so no white hairline shows between residues there.
    await openTranslatedRecord(page);
    const blocks = await page.locator(FORWARD).evaluateAll((nodes) => nodes.map((node) => (
      [...document.querySelectorAll('.motif-cs-seq-block')].indexOf(node.closest('.motif-cs-seq-block')!)
    )));
    const from = blocks.findIndex((block) => block > blocks[0]);
    const to = blocks.lastIndexOf(blocks[from]);
    await dragResidues(page, page.locator(FORWARD).nth(from), page.locator(FORWARD).nth(to));
    await expect(page.locator(SELECTED)).toHaveCount(to - from + 1);
    await page.mouse.move(2, 2);
    // A codon across a line end is drawn on both lines, so an end residue tints its piece on
    // the neighbouring line too; on the run's own line the tint is one band.
    const band = page.locator('.motif-cs-seq-block').nth(blocks[from]).locator('.motif-cs-aa-hl');
    await expect(band).toHaveCount(1);
    const box = (await band.boundingBox())!;
    const png = await page.screenshot({ clip: box });
    // Above the letters, both device pixels at every boundary between two residues are the tint.
    const edges = await page.locator(FORWARD).evaluateAll((nodes, [first, last]) => nodes
      .slice(first + 1, last + 1).map((node) => node.getBoundingClientRect().left), [from, to]);
    expect(edges).toHaveLength(to - from);
    const boundaries = edges.map((left) => Math.round((left - box.x) * 2))
      .flatMap((x) => [[x - 1, 2], [x, 2]] as Array<[number, number]>);
    const tint = await expectedTint(band);
    for (const pixel of await decodePixels(page, png, boundaries)) {
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(pixel[channel] - tint[channel]), `pixel ${pixel} against the tint ${tint}`).toBeLessThanOrEqual(2);
      }
    }
  });

  test('a drag across lines continues on the same track on the next line', async ({ page }) => {
    await openTranslatedRecord(page);
    const blocks = await page.locator(FORWARD).evaluateAll((nodes) => nodes.map((node) => (
      [...document.querySelectorAll('.motif-cs-seq-block')].indexOf(node.closest('.motif-cs-seq-block')!)
    )));
    const firstLine = blocks[0];
    const nextLineStart = blocks.findIndex((block) => block > firstLine);
    expect(nextLineStart).toBeGreaterThan(3);
    const from = 3;
    const to = nextLineStart + 2;
    await dragResidues(page, page.locator(FORWARD).nth(from), page.locator(FORWARD).nth(to));
    const run = page.locator(FORWARD).filter({ has: page.locator('xpath=self::*[@data-selected="true"]') });
    await expect(run).toHaveCount(to - from + 1);
    const expected = await expectedReadout(run);
    await expect.poll(() => readouts(page)).toEqual({ bar: expected, map: expected });
    const lines = await run.evaluateAll((nodes) => new Set(nodes.map((node) => node.closest('.motif-cs-seq-block'))).size);
    expect(lines, 'the run is drawn on both lines').toBe(2);
    await expect(page.locator('.motif-cs-seq-hl')).toHaveCount(2);
  });

  test('Shift+click extends from the residue last clicked, with no native text selection', async ({ page }) => {
    await openTranslatedRecord(page);
    const before = await sequenceLayout(page);
    await page.locator(FORWARD).nth(2).click();
    await page.locator(FORWARD).nth(8).click({ modifiers: ['Shift'] });
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–30 · 21 bp', map: '10–30 · 21 bp' });
    await expect(page.locator(SELECTED)).toHaveCount(7);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    // Shift+click back inside the run shrinks it from the same anchor.
    await page.locator(FORWARD).nth(5).click({ modifiers: ['Shift'] });
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–21 · 12 bp', map: '10–21 · 12 bp' });
    expectSameLayout(before, await sequenceLayout(page), 'after Shift+click');
    // With no anchor on the other track, Shift+click there acts as a plain click.
    const reverse = page.locator(REVERSE).nth(4);
    await reverse.scrollIntoViewIfNeeded();
    await reverse.click({ modifiers: ['Shift'] });
    await expect(page.locator(SELECTED)).toHaveCount(1);
    await expect(reverse).toHaveAttribute('data-selected', 'true');
  });

  test('Shift+arrows grow and shrink the run from the anchor; plain arrows only move focus', async ({ page }) => {
    await openTranslatedRecord(page);
    await page.locator(FORWARD).nth(2).click();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–18 · 9 bp', map: '10–18 · 9 bp' });
    await expect(page.locator(SELECTED)).toHaveText(['K', 'G', 'E']);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–15 · 6 bp', map: '10–15 · 6 bp' });
    // Past the anchor the run grows the other way.
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => readouts(page)).toEqual({ bar: '7–12 · 6 bp', map: '7–12 · 6 bp' });
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => readouts(page)).toEqual({ bar: '7–12 · 6 bp', map: '7–12 · 6 bp' });
    await expect(page.locator(FORWARD).nth(2)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–12 · 3 bp', map: '10–12 · 3 bp' });
    await page.keyboard.press('Home');
    await expect(page.locator(FORWARD).first()).toBeFocused();
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–12 · 3 bp', map: '10–12 · 3 bp' });
  });

  test('a reverse-strand track selects the bases of its residues, and Shift+ArrowRight grows to the right', async ({ page }) => {
    await openTranslatedRecord(page);
    const reverse = page.locator(REVERSE);
    await dragResidues(page, reverse.nth(6), reverse.nth(2));
    const run = page.locator(`${REVERSE}[data-selected="true"]`);
    await expect(run).toHaveCount(5);
    const expected = await expectedReadout(run);
    await expect.poll(() => readouts(page)).toEqual({ bar: expected, map: expected });

    await reverse.nth(4).click();
    const pressedStart = Number(await reverse.nth(4).getAttribute('data-codon-start'));
    await page.keyboard.press('Shift+ArrowRight');
    const starts = (await run.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-codon-start'))))).sort((a, b) => a - b);
    expect(starts).toEqual([pressedStart, pressedStart + 3]);
    const grown = await expectedReadout(run);
    await expect.poll(() => readouts(page)).toEqual({ bar: grown, map: grown });
  });

  test('Escape and a click on a base clear the run and its bases', async ({ page }) => {
    await openTranslatedRecord(page);
    await dragResidues(page, page.locator(FORWARD).nth(2), page.locator(FORWARD).nth(8));
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–30 · 21 bp', map: '10–30 · 21 bp' });
    await page.keyboard.press('Escape');
    await expect(page.locator(SELECTED)).toHaveCount(0);
    await expect(page.locator('.motif-cs-seq-hl')).toHaveCount(0);
    await expect.poll(() => readouts(page)).toEqual({ bar: 'Drag to select a range', map: 'Click a feature, or drag to select a range' });

    await dragResidues(page, page.locator(FORWARD).nth(2), page.locator(FORWARD).nth(8));
    await expect(page.locator(SELECTED)).toHaveCount(7);
    await page.locator('.motif-cs-seq-bases').nth(1).click({ position: { x: 30, y: 8 } });
    await expect(page.locator(SELECTED)).toHaveCount(0);
  });

  test('a run across the origin of a circular record selects one range across the origin', async ({ page }) => {
    // The amino-acid track here is a translation pinned from a range dragged across the
    // origin on the map.
    await page.setViewportSize({ width: 1040, height: 1000 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    const seq = CHUNK_FOR_ORIGIN;
    await page.evaluate((value) => window.motifRenderInventory([{ id: 'ring', name: 'Ring', molecule: 'dna', topology: 'circular', seq: value, annotations: [] }]), seq);
    await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
    const ring = (await page.locator('.motif-cs-map-frame path.motif-pm-backbone').first().boundingBox())!;
    const at = (degrees: number) => ({
      x: ring.x + ring.width / 2 + (ring.width / 2) * Math.sin((degrees * Math.PI) / 180),
      y: ring.y + ring.height / 2 - (ring.height / 2) * Math.cos((degrees * Math.PI) / 180),
    });
    await page.mouse.move(at(-40).x, at(-40).y);
    await page.mouse.down();
    for (let degrees = -36; degrees <= 40; degrees += 4) await page.mouse.move(at(degrees).x, at(degrees).y);
    await page.mouse.up();
    await expect(page.locator('.motif-cs-map-selection-line')).toHaveText(/across the origin$/);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('menuitem', { name: /Pin translation/ }).click();
    const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await tracks.getAttribute('data-active')) !== 'true') await tracks.click();
    await page.keyboard.press('Escape');

    const layer = '.motif-cs-seq-aa[data-aa-track-id^="layer:"]';
    // The track reads from the end of the record round to its start: the residues in reading
    // order are the ones drawn on the last lines, then the ones on the first lines.
    const starts = (await page.locator(layer).evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-codon-start')))))
      .sort((a, b) => a - b);
    const reading = [...starts.filter((start) => start >= seq.length / 2), ...starts.filter((start) => start < seq.length / 2)];
    // The codon split by the origin is drawn on the last line, at the record's last base or the one before.
    const across = reading.findIndex((start) => start >= seq.length - 2);
    expect(across).toBeGreaterThan(1);
    const tail = { index: across - 2, start: reading[across - 2] };
    const head = { index: across + 3, start: reading[across + 3] };
    expect(head.start).toBeLessThan(12);

    const residue = (start: number) => page.locator(`${layer}[data-codon-start="${start}"]`);
    await residue(tail.start).scrollIntoViewIfNeeded();
    await residue(tail.start).click();
    await residue(head.start).scrollIntoViewIfNeeded();
    await residue(head.start).click({ modifiers: ['Shift'] });
    const run = page.locator(`${layer}[data-selected="true"]`);
    const count = head.index - tail.index + 1;
    await expect(run).toHaveCount(count);
    const expected = `${tail.start + 1}–${head.start + 3} · ${count * 3} bp · across the origin`;
    await expect.poll(() => readouts(page)).toEqual({ bar: expected, map: expected });
    // The bases are tinted on the last line and on the first.
    const lines = await page.locator('.motif-cs-seq-hl').evaluateAll((nodes) => nodes.map((node) => node.closest('.motif-cs-seq-bases')?.getAttribute('data-line-start')));
    expect(new Set(lines).size).toBe(2);
    expect(lines).toContain('0');
  });

  test('the Translation window selects runs the same way and keeps its residues while the run is selected', async ({ page }) => {
    await stubClipboard(page);
    await openTranslatedRecord(page, 1040);
    await page.getByRole('button', { name: /Translations window/ }).click();
    const cells = page.locator('.motif-cs-window .motif-cs-protein-aa');
    await expect(cells).toHaveCount(120);
    const tinted = page.locator('.motif-cs-window .motif-cs-protein-aa[data-selected="true"]');

    await dragResidues(page, cells.nth(3), cells.nth(9));
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–30 · 21 bp', map: '10–30 · 21 bp' });
    await expect(cells, 'the window keeps every residue under the drag').toHaveCount(120);
    await expect(tinted).toHaveText(['K', 'G', 'E', 'E', 'L', 'F', 'T']);
    await expect(page.locator('.motif-cs-seq-hl').first()).toBeVisible();
    // The readout line names the selection (its residues and bases); the tinted residues are
    // it and the rest are context, which the title bar still names.
    await expect(page.locator('.motif-cs-window').getByTestId('translation-residue-readout')).toHaveText('Picked K4–T10 · 7 aa · 10–30');
    await expect(page.locator('.motif-cs-window').getByTestId('translation-scope')).toHaveText('Whole sequence · 120 aa');
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    // Copy protein copies the selection, not the residues kept around it.
    await page.locator('.motif-cs-window').getByRole('button', { name: 'Copy protein' }).click();
    await expect.poll(() => copied(page)).toBe('KGEELFT');

    await cells.nth(12).click({ modifiers: ['Shift'] });
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–39 · 30 bp', map: '10–39 · 30 bp' });
    await expect(tinted).toHaveCount(10);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–42 · 33 bp', map: '10–42 · 33 bp' });
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–36 · 27 bp', map: '10–36 · 27 bp' });
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

    // A plain click selects one codon and the window still shows every residue.
    await cells.nth(20).click();
    await expect.poll(() => readouts(page)).toEqual({ bar: '61–63 · 3 bp', map: '61–63 · 3 bp' });
    await expect(cells).toHaveCount(120);
    await expect(tinted).toHaveCount(1);

    // A new strand reads the selection itself: the kept residues give way to its own reading.
    await dragResidues(page, cells.nth(3), cells.nth(9));
    await expect(tinted).toHaveCount(7);
    await page.locator('.motif-cs-window').getByRole('button', { name: 'Antisense', exact: true }).click();
    await expect(cells).toHaveCount(7);
    await expect(tinted).toHaveCount(0);
    await page.locator('.motif-cs-window').getByRole('button', { name: 'Sense', exact: true }).click();
    await expect(cells).toHaveText(['K', 'G', 'E', 'E', 'L', 'F', 'T']);

    // Back to the whole record, then a selection inside the window again.
    await page.keyboard.press('Escape');
    await expect(cells).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Translations window/ }).click();
    await expect(cells).toHaveCount(120);
    await cells.nth(20).click();
    await expect(tinted).toHaveCount(1);

    // Right after that in-window selection, a run selected on a track in the Sequence pane: the
    // window drops its kept residues and shows exactly the new ones. (The window covers part of
    // the track at this width, so the run is grown from the keyboard.)
    await page.locator(FORWARD).nth(2).click();
    for (let step = 0; step < 6; step += 1) await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => readouts(page)).toEqual({ bar: '10–30 · 21 bp', map: '10–30 · 21 bp' });
    await expect(cells).toHaveText(['K', 'G', 'E', 'E', 'L', 'F', 'T']);

    // One Escape closes one thing: the window first, then the run. Reopened, the window reads
    // the whole record again.
    await page.keyboard.press('Escape');
    await expect(cells).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator(SELECTED)).toHaveCount(0);
    await expect.poll(() => readouts(page)).toEqual({ bar: 'Drag to select a range', map: 'Click a feature, or drag to select a range' });
    await page.getByRole('button', { name: /Translations window/ }).click();
    await expect(cells).toHaveCount(120);
    await expect(tinted).toHaveCount(0);
  });

  test('a run selected in frame +2 of the Translation window shows the frame its target reads', async ({ page }) => {
    // Frame +2 of the record puts K on bases 11-13. The run's target starts on its own first
    // base, so the target reads in +1, and the pressed frame button says so.
    await openTranslatedRecord(page, 1040);
    await page.getByRole('button', { name: /Translations window/ }).click();
    const win = page.locator('.motif-cs-window');
    const cells = win.locator('.motif-cs-protein-aa');
    const tinted = win.locator('.motif-cs-protein-aa[data-selected="true"]');
    const frame = win.getByRole('group', { name: 'Reading frame' });
    await frame.getByRole('button', { name: '+2', exact: true }).click();
    await expect(cells.nth(3)).toHaveText('K');
    await dragResidues(page, cells.nth(3), cells.nth(9));
    await expect.poll(() => readouts(page)).toEqual({ bar: '11–31 · 21 bp', map: '11–31 · 21 bp' });
    await expect(tinted).toHaveText(['K', 'E', 'K', 'N', 'F', 'S', 'L']);
    await expect(frame.locator('button[aria-pressed="true"]')).toHaveText('+1');
    // A click on the pressed frame reads the run in the frame it already reads: the same letters.
    await frame.getByRole('button', { name: '+1', exact: true }).click();
    await expect(cells).toHaveText(['K', 'E', 'K', 'N', 'F', 'S', 'L']);
  });

  test('Create protein in the Translation window makes a record of the selected residues only', async ({ page }) => {
    await openTranslatedRecord(page, 1040);
    await page.getByRole('button', { name: /Translations window/ }).click();
    const cells = page.locator('.motif-cs-window .motif-cs-protein-aa');
    await expect(cells).toHaveCount(120);
    await dragResidues(page, cells.nth(3), cells.nth(9));
    await expect(page.locator('.motif-cs-window .motif-cs-protein-aa[data-selected="true"]')).toHaveCount(7);
    await page.locator('.motif-cs-window').getByRole('button', { name: 'Create protein' }).click();
    await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord()?.seq)).toBe('KGEELFT');
  });

  test('selected residues and the residues the window keeps are view state: no workspace change and no unsaved-changes guard', async ({ page }) => {
    // The first-open workspace is saved state ("session only"); a rendered record would not be.
    await page.setViewportSize({ width: 1040, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    const status = page.getByTestId('session-durability-status');
    await expect(status).toHaveText('session only');
    const guardArmed = () => page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(await guardArmed(), 'no guard before any selection').toBe(false);
    // The snapshot's export time changes on every call; everything else must not.
    const savedWorkspace = () => page.evaluate(() => JSON.stringify({ ...window.motifGetWorkspace?.(), exportedAt: undefined }));
    const workspace = await savedWorkspace();

    const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await tracks.getAttribute('data-active')) !== 'true') await tracks.click();
    const trackId = await page.locator('.motif-cs-seq-aa[data-aa-track-id]').first().getAttribute('data-aa-track-id');
    const track = page.locator(`.motif-cs-seq-aa[data-aa-track-id="${trackId}"]`);
    await dragResidues(page, track.nth(1), track.nth(5));
    await expect.poll(() => page.locator(SELECTED).count(), { message: 'a run is selected on the track' }).toBeGreaterThan(1);
    await page.getByRole('button', { name: /Translations window/ }).click();
    const cells = page.locator('.motif-cs-window .motif-cs-protein-aa');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Translations window/ }).click();
    await expect(cells.nth(14)).toBeVisible();
    await dragResidues(page, cells.nth(3), cells.nth(9));
    await cells.nth(14).click({ modifiers: ['Shift'] });
    await expect(page.locator('.motif-cs-window .motif-cs-protein-aa[data-selected="true"]')).toHaveCount(12);

    // The fingerprint settles after a change, so give a wrongly armed guard time to show.
    await page.waitForTimeout(500);
    await expect(status).toHaveText('session only');
    expect(await savedWorkspace(), 'the saved workspace is unchanged').toBe(workspace);
    expect(await guardArmed(), 'the unsaved-changes guard stays off').toBe(false);
  });

  test('the Translation window shows the selected residues as the track draws them', async ({ page }) => {
    // Under code 11 a CDS that starts with GTG draws M; the codon read alone is V.
    await stubClipboard(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'gtg-record',
      name: 'GTG start',
      molecule: 'dna',
      topology: 'linear',
      seq: `CCGTGGCTAAAGGAGAAGAACTTTTCACTTAA${'C'.repeat(33)}`,
      annotations: [{ id: 'gtg', name: 'GTG CDS', type: 'cds', start: 2, end: 32, strand: 1, color: '#2f9e6f', metadata: { transl_table: 11 } }],
    }]));
    const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await tracks.getAttribute('data-active')) !== 'true') await tracks.click();
    const residues = page.locator('.motif-cs-seq-aa[data-aa-track-id="feat:gtg"]');
    await expect(residues.first()).toHaveText('M');
    await page.getByRole('button', { name: /Translations window/ }).click();
    const cells = page.locator('.motif-cs-window .motif-cs-protein-aa');
    await residues.first().click();
    await expect(cells).toHaveText(['M']);
    await residues.nth(2).click({ modifiers: ['Shift'] });
    await expect(cells).toHaveText(['M', 'A', 'K']);
    await page.locator('.motif-cs-window').getByRole('button', { name: 'Copy protein' }).click();
    await expect.poll(() => copied(page)).toBe('MAK');
    // Read on the other strand, the selection is translated again.
    await page.locator('.motif-cs-window').getByRole('button', { name: 'Antisense', exact: true }).click();
    await expect(cells).not.toHaveText(['M', 'A', 'K']);
  });

  test('a code change in the Translation window reads the selected residues under the new code', async ({ page }) => {
    // The track draws GTG GCT AAA as MAK under code 11. Under code 1 the three codons read
    // alone are V A K; back under code 11 they are the track's letters again.
    await stubClipboard(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'gtg-record',
      name: 'GTG start',
      molecule: 'dna',
      topology: 'linear',
      seq: `CCGTGGCTAAAGGAGAAGAACTTTTCACTTAA${'C'.repeat(33)}`,
      annotations: [{ id: 'gtg', name: 'GTG CDS', type: 'cds', start: 2, end: 32, strand: 1, color: '#2f9e6f', metadata: { transl_table: 11 } }],
    }]));
    const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await tracks.getAttribute('data-active')) !== 'true') await tracks.click();
    const residues = page.locator('.motif-cs-seq-aa[data-aa-track-id="feat:gtg"]');
    await expect(residues.first()).toHaveText('M');
    await page.getByRole('button', { name: /Translations window/ }).click();
    const cells = page.locator('.motif-cs-window .motif-cs-protein-aa');
    const code = page.locator('.motif-cs-window').getByLabel('Genetic code');
    await residues.first().click();
    await residues.nth(2).click({ modifiers: ['Shift'] });
    await expect(cells).toHaveText(['M', 'A', 'K']);
    await code.selectOption('1');
    await expect(cells).toHaveText(['V', 'A', 'K']);
    await page.locator('.motif-cs-window').getByRole('button', { name: 'Copy protein' }).click();
    await expect.poll(() => copied(page)).toBe('VAK');
    await code.selectOption('11');
    await expect(cells).toHaveText(['M', 'A', 'K']);
  });

  test('a selected selenocysteine stays U in the Translation window', async ({ page }) => {
    // ATG GCC TGA AAA GGG TAA from base 2, its TGA read as Sec: the track draws U; read alone it is "*".
    await stubClipboard(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'sec-record',
      name: 'Selenoprotein',
      molecule: 'dna',
      topology: 'linear',
      seq: 'CATGGCCTGAAAAGGGTAACCCCCC',
      annotations: [{ id: 'sec', name: 'Sec CDS', type: 'cds', start: 1, end: 19, strand: 1, color: '#2f9e6f', metadata: { transl_except: '(pos:8..10,aa:Sec)' } }],
    }]));
    const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await tracks.getAttribute('data-active')) !== 'true') await tracks.click();
    const residues = page.locator('.motif-cs-seq-aa[data-aa-track-id="feat:sec"]');
    await expect(residues.nth(2)).toHaveText('U');
    await page.getByRole('button', { name: /Translations window/ }).click();
    const cells = page.locator('.motif-cs-window .motif-cs-protein-aa');
    await residues.nth(2).click();
    await expect(cells).toHaveText(['U']);
    await residues.nth(1).click();
    await residues.nth(3).click({ modifiers: ['Shift'] });
    await expect(cells).toHaveText(['A', 'U', 'K']);
    await page.locator('.motif-cs-window').getByRole('button', { name: 'Copy protein' }).click();
    await expect.poll(() => copied(page)).toBe('AUK');
  });

  test('residue text on the selection tint clears 4.5:1 in light and dark themes', async ({ page }) => {
    // A CDS from base 1 starts with M, which draws green when it is not selected.
    await openTranslatedRecord(page, 700, [{ id: 'aa-start', name: 'start CDS', type: 'cds', start: 0, end: 60, strand: 1, color: '#3b6fd0' }]);
    const start = page.locator('.motif-cs-seq-aa[data-aa-track-id="feat:aa-start"][data-start="true"]').first();
    await start.click();
    await page.keyboard.press('Shift+ArrowRight');
    // The run's two residues, and the forward CDS's residue over bases 4-6 of the run.
    await expect(page.locator(SELECTED)).toHaveCount(3);
    await expect(page.locator('.motif-cs-seq-aa[data-aa-track-id="feat:aa-start"][data-selected="true"]')).toHaveCount(2);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(async (name) => {
        document.documentElement.dataset.theme = name;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
      }, theme);
      const ratios = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const rasterize = (value: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const linear = (channel: number) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (pixel: number[]) => 0.2126 * linear(pixel[0]) + 0.7152 * linear(pixel[1]) + 0.0722 * linear(pixel[2]);
        return [...document.querySelectorAll<HTMLElement>('.motif-cs-seq-aa[data-selected="true"]')].map((node) => {
          // The residue's own background is clear; the band behind it carries the tint.
          const band = node.parentElement!.querySelector('.motif-cs-aa-hl')!;
          const background = rasterize(getComputedStyle(band).backgroundColor);
          const ink = rasterize(getComputedStyle(node).color);
          const a = luminance(ink);
          const b = luminance(background);
          return { text: node.textContent, opaque: background[3] === 255, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        });
      });
      process.stdout.write(`${theme} selected residue contrast ${JSON.stringify(ratios)}\n`);
      for (const ratio of ratios) {
        expect(ratio.opaque, `${theme} ${ratio.text}: the tint is opaque`).toBe(true);
        expect(ratio.ratio, `${theme} ${ratio.text}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

// A copy receipt names what was copied, and a feature's name can be long. The
// receipt beside Export must not grow to 352px (at 400x700 that pushes Export and
// collapse out of the pane, and at 1280x820 it squeezes the record's name to
// 0px), and a floating receipt must not cover a line of bases.
test.describe('Copy receipt with a long feature name', () => {
  const longName = 'a_very_long_feature_name_for_the_receipt_test_xyz';
  const chunk = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
  for (const [width, height] of [[400, 700], [700, 860], [1280, 820], [1440, 900]] as const) {
    test(`keeps Export, collapse and the record name in the pane and covers no base at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (value: string) => { (window as unknown as { __copied?: string }).__copied = value; } },
        });
      });
      await page.goto(artifactUrl!);
      await expect(page.locator('.motif-cs-shell')).toBeVisible();
      await page.evaluate((record) => window.motifRenderInventory([record]), {
        id: 'receipt-record', name: 'Rec', molecule: 'dna', topology: 'linear', seq: chunk.repeat(30).slice(0, 3000),
        annotations: [{ id: 'f1', name: longName, type: 'cds', start: 10, end: 90, strand: 1 }],
      });
      await page.locator('[data-pane-key="sequence"] .motif-cs-feature-block').first().click();
      await page.locator('#motif-cs-sequence-view').focus();
      await page.keyboard.press('Control+C');
      const status = page.getByTestId('session-durability-status');
      await expect(status).toContainText(longName);
      await expect(status).toHaveAttribute('title', `${longName} copied`);
      await expect(status).toHaveAttribute('aria-label', `${longName} copied`);
      const notice = page.locator('.motif-cs-workbench-notice');
      await expect(notice).toContainText(longName);
      const geometry = await page.evaluate(() => {
        const pane = document.querySelector('[data-pane-key="sequence"]')!.getBoundingClientRect();
        const row = document.querySelector('[data-pane-key="sequence"] .motif-cs-sequence-title')!;
        const box = (selector: string) => row.querySelector(selector)!.getBoundingClientRect();
        const bar = document.querySelector('[data-pane-key="sequence"] .motif-cs-selection-bar')!.getBoundingClientRect();
        const n = document.querySelector('.motif-cs-workbench-notice')!.getBoundingClientRect();
        return {
          pane: { left: pane.left, right: pane.right },
          status: box('.motif-cs-export-status').width,
          exportButton: box('[aria-controls="motif-cs-export-panel"]'),
          collapse: box('.motif-cs-pane-collapse'),
          name: box('h1').width,
          bar: { top: bar.top, bottom: bar.bottom },
          notice: { top: n.top, bottom: n.bottom },
        };
      });
      for (const control of [geometry.exportButton, geometry.collapse]) {
        expect(control.left).toBeGreaterThanOrEqual(geometry.pane.left);
        expect(control.right).toBeLessThanOrEqual(geometry.pane.right);
      }
      expect(geometry.status, 'the receipt stops at about 24ch').toBeLessThanOrEqual(200);
      expect(geometry.name, 'the record name keeps its room').toBeGreaterThanOrEqual(25);
      // The receipt sits inside the status line, so no base line is under it.
      expect(geometry.notice.top).toBeGreaterThanOrEqual(geometry.bar.top);
      expect(geometry.notice.bottom).toBeLessThanOrEqual(geometry.bar.bottom);
    });
  }
});

// The status line is drawn at the pane's foot, but its actions follow the
// toolbar in the Tab order. After the bases they would be about 27 stops away
// with six features: the view, every feature block and the residue stop.
test.describe('Status line Tab order', () => {
  for (const [width, height] of [[1280, 820], [700, 860]] as const) {
    test(`reaches Copy within two Tab stops of the toolbar and draws the line below the bases at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      await expect(page.locator('.motif-cs-shell')).toBeVisible();
      const chunk = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGG';
      await page.evaluate((record) => window.motifRenderInventory([record]), {
        id: 'tab-record', name: 'Tab record', molecule: 'dna', topology: 'linear', seq: chunk.repeat(30).slice(0, 3000),
        annotations: Array.from({ length: 6 }, (_, index) => ({
          id: `f${index}`, name: `feature ${index + 1}`, type: 'cds', start: 20 + index * 60, end: 60 + index * 60, strand: 1 as const,
        })),
      });
      await page.locator('[data-pane-key="sequence"] .motif-cs-feature-block').first().click();
      const toolbarButtons = page.locator('[data-pane-key="sequence"] .motif-cs-edit-toolbar button:not([disabled])');
      await toolbarButtons.last().focus();
      const reached: string[] = [];
      for (let stop = 0; stop < 2; stop += 1) {
        await page.keyboard.press('Tab');
        reached.push(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim()));
      }
      // The Copy button holds its "Copied" word unseen beside "Copy".
      expect(reached.findIndex((text) => text.startsWith('Copy')), `Copy is one of the two stops after the toolbar: ${reached.join(' | ')}`).toBeGreaterThanOrEqual(0);
      const geometry = await page.evaluate(() => {
        const pane = document.querySelector('[data-pane-key="sequence"]')!;
        const bar = pane.querySelector('.motif-cs-selection-bar')!.getBoundingClientRect();
        const view = pane.querySelector('.motif-cs-sequence')!.getBoundingClientRect();
        return { barTop: bar.top, viewTop: view.top };
      });
      expect(geometry.barTop, 'the status line is drawn under the bases').toBeGreaterThan(geometry.viewTop);
    });
  }
});

// A switch is never drawn without its word. Where the words do not fit, each
// of the two toolbar switches is an icon toggle button: no track, and "on"
// drawn differently from "off".
test.describe('Toolbar switches without room for their words', () => {
  for (const [width, height] of [[1280, 820], [400, 700]] as const) {
    test(`draws no bare switch track and tells on from off at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();
      const read = () => page.evaluate(() => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none';
        };
        return [...document.querySelectorAll<HTMLElement>('[data-pane-key="sequence"] .motif-cs-display-switch')].map((button) => {
          const cs = getComputedStyle(button);
          return {
            name: button.getAttribute('aria-label'),
            pressed: button.getAttribute('aria-pressed'),
            track: [...button.querySelectorAll('.motif-cs-switch-track')].some(visible),
            label: [...button.querySelectorAll('.motif-cs-toolbar-label')].some(visible),
            look: `${cs.backgroundColor}|${cs.borderColor}|${cs.color}|${cs.boxShadow}`,
            width: button.getBoundingClientRect().width,
          };
        });
      });
      const before = await read();
      expect(before.map((entry) => entry.name).sort()).toEqual(['Complement strand', 'Show tracks']);
      // With the words gone, no two buttons in the toolbar wear the same icon.
      const icons = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-pane-key="sequence"] .motif-cs-edit-toolbar button')]
        .flatMap((button) => [...button.querySelectorAll('svg')]
          .filter((svg) => svg.getBoundingClientRect().width > 2 && getComputedStyle(svg).display !== 'none')
          .map((svg) => (svg.getAttribute('class') ?? '').split(/\s+/).find((name) => name.startsWith('lucide-') && name !== 'lucide') ?? '')));
      expect(icons.length, 'the toolbar draws its icons').toBeGreaterThanOrEqual(4);
      expect(new Set(icons).size, `toolbar icons ${icons.join(', ')}`).toBe(icons.length);
      for (const entry of before) {
        expect(entry.track && !entry.label, `${entry.name}: a switch track with no word beside it`).toBe(false);
      }
      for (const name of ['Show tracks', 'Complement strand']) {
        const was = before.find((entry) => entry.name === name)!;
        await page.getByRole('button', { name, exact: true }).click();
        const now = (await read()).find((entry) => entry.name === name)!;
        expect(now.pressed).not.toBe(was.pressed);
        expect(now.look, `${name}: on and off are drawn differently`).not.toBe(was.look);
        expect(now.track && !now.label).toBe(false);
        expect(now.width, `${name}: the toggle keeps its size`).toBe(was.width);
      }
    });
  }
});

// A feature name that does not fit the amino-acid rows' gutter is hidden whole rather
// than shortened with an ellipsis; no gutter text may be cut. The row's button keeps
// the full name as its accessible name.
test.describe('Sequence gutter text', () => {
  for (const [width, height] of [[700, 860], [1280, 820], [1440, 900]] as const) {
    test(`cuts no gutter text at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();
      const rows = page.locator('[data-pane-key="sequence"] .motif-cs-aa-row-label');
      await expect(rows.first()).toBeAttached();
      await expect(rows.first()).toHaveAttribute('aria-label', /translation/);
      const cut = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-pane-key="sequence"] .motif-cs-seq-index, [data-pane-key="sequence"] .motif-cs-seq-index *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1 || !el.textContent?.trim()) return false;
          if (r.bottom < 0 || r.top > innerHeight) return false;
          return el.scrollWidth > el.clientWidth + 1;
        })
        .map((el) => el.textContent!.trim()));
      expect(cut).toEqual([]);
    });
  }

  // A name that fits the gutter whole is drawn there: pUC19's "AmpR" rows
  // (below the fold at first open, so the test scrolls to one). "lacZ-alpha"
  // does not fit, so its gutter text is hidden.
  for (const [width, height] of [[1440, 900], [400, 700]] as const) {
    test(`draws a name that fits the gutter whole and no other at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();
      const ampR = page.locator('[data-pane-key="sequence"] .motif-cs-aa-row-label[aria-label^="AmpR"]').first();
      await expect(ampR).toBeAttached();
      await ampR.evaluate((node) => node.scrollIntoView({ block: 'center' }));
      const drawn = await page.evaluate(() => {
        const view = document.querySelector('#motif-cs-sequence-view')!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>('[data-pane-key="sequence"] .motif-cs-aa-row-label')].map((label) => {
          const name = label.querySelector<HTMLElement>('.motif-cs-aa-row-name')!;
          const box = label.getBoundingClientRect();
          const r = name.getBoundingClientRect();
          return {
            label: label.getAttribute('aria-label')!.split(' · ')[0],
            inView: box.bottom > Math.max(view.top, 0) && box.top < Math.min(view.bottom, innerHeight),
            shown: r.width > 2 && r.height > 2 && getComputedStyle(name).clip === 'auto',
            text: name.textContent,
            whole: r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && name.scrollWidth <= name.clientWidth + 1,
          };
        });
      });
      const ampRows = drawn.filter((row) => row.label === 'AmpR' && row.inView);
      expect(ampRows.length).toBeGreaterThan(0);
      for (const row of ampRows) expect(row, 'AmpR is drawn whole in its gutter').toMatchObject({ shown: true, text: 'AmpR', whole: true });
      for (const row of drawn.filter((entry) => entry.label === 'lacZ-alpha')) expect(row.shown, 'lacZ-alpha draws no gutter text').toBe(false);
    });
  }
});
