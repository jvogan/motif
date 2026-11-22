import { expect, test, type Locator, type Page } from '@playwright/test';
import { selectRecord } from './record-selection';
import { openTool } from './tools-drawer';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// What is picked in one view is picked in every view: a record keeps its
// selection between visits, a new selection replaces the caret, a double- or
// triple-click selects, a gel band leads back to its fragment and the primer
// workspace's pair is marked on the sequence and the map. Every gesture here
// is real pointer or key input on the bundled pUC19 demo record.

const mapLine = (page: Page) => page.locator('.motif-cs-map-selection-line');
const sequenceLine = (page: Page) => page.locator('.motif-cs-selection-label');
const carets = (page: Page) => page.locator('.motif-cs-seq-caret');
const ribbon = (page: Page, name: string) => page.locator(`.motif-cs-feature-block[aria-label^="${name},"]`).first();

async function openDemo(page: Page, width = 700, height = 900) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
  const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
  if ((await tracks.getAttribute('data-active')) !== 'true') await tracks.click();
  await expect(ribbon(page, 'lacZ-alpha')).toBeVisible();
}

/** The centre of base `index` (0-based), measured on the glyph; scrolls its line into view first. */
async function basePoint(page: Page, index: number) {
  const row = page.locator('.motif-cs-seq-bases[data-line-start]');
  const rowIndex = await row.evaluateAll((rows, base) => rows.findIndex((candidate) => {
    const start = Number((candidate as HTMLElement).dataset.lineStart);
    return base >= start && base < start + Number((candidate as HTMLElement).dataset.lineLen);
  }), index);
  expect(rowIndex).toBeGreaterThanOrEqual(0);
  await row.nth(rowIndex).scrollIntoViewIfNeeded();
  return row.nth(rowIndex).evaluate((element, base) => {
    const glyphs = element.querySelector('.motif-cs-seq-glyphs')!.firstChild!;
    const range = document.createRange();
    const offset = base - Number((element as HTMLElement).dataset.lineStart);
    range.setStart(glyphs, offset);
    range.setEnd(glyphs, offset + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, index);
}

/**
 * The centre of `locator` once a press there reaches it; scrolls it into view first.
 * Sequence blocks are `content-visibility: auto`: a block scrolled in from far away
 * is drawn and hit-tested only once the browser finds it on screen, which can take
 * a frame or more. A press before then lands on the block itself, which reads it as
 * a caret on the nearest line, so the point is read again until the element is
 * what a press there would reach.
 */
async function centre(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  let point = { x: 0, y: 0 };
  await expect.poll(async () => {
    const reach = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, reached: hit !== null && element.contains(hit) };
    });
    point = { x: reach.x, y: reach.y };
    return reach.reached;
  }, { message: 'a press at the centre reaches the element' }).toBe(true);
  return point;
}

/** A real pointer click at the centre of `locator`. */
async function clickCentre(page: Page, locator: Locator) {
  const point = await centre(locator);
  await page.mouse.click(point.x, point.y);
}

/**
 * A point on the circular map's backbone that the map reads as base `bp` (1-based).
 * The map rounds a press to the nearest base boundary, so base `bp` (0-based offset
 * `bp - 1`) is read from half a base either side of angle `(bp - 1) / total`; the
 * point sits in the middle of that band. The drawn middle of the base, half a base
 * further on, is the boundary itself, where the reading flips on a rounding error.
 */
async function ringPoint(page: Page, bp: number, total: number) {
  await page.locator('.motif-cs-map-frame').scrollIntoViewIfNeeded();
  return page.evaluate(([base, length]) => {
    const ring = document.querySelector('.motif-pm-backbone')!.getBoundingClientRect();
    const angle = ((base - 1) / length) * 2 * Math.PI;
    return {
      x: ring.x + ring.width / 2 + (ring.width / 2) * Math.sin(angle),
      y: ring.y + ring.height / 2 - (ring.width / 2) * Math.cos(angle),
    };
  }, [bp, total] as const);
}

async function switchAwayAndBack(page: Page) {
  await selectRecord(page, 'pBR322');
  await expect(mapLine(page)).toHaveText('Click a feature, or drag to select a range');
  await selectRecord(page, 'pUC19');
}

/**
 * Magenta pixels in the visible part of the sequence view; the spec paints any
 * native selection magenta. A clipped page screenshot never scrolls, so the
 * rows stay under the pointer between the presses of a double- or triple-click.
 */
async function nativeSelectionPixels(page: Page) {
  const clip = await page.locator('#motif-cs-sequence-view').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    return { x, y, width: Math.min(window.innerWidth, rect.right) - x, height: Math.min(window.innerHeight, rect.bottom) - y };
  });
  const shot = await page.screenshot({ clip });
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] > 230 && data[index + 1] < 40 && data[index + 2] > 230) count += 1;
    }
    return count;
  }, shot.toString('base64'));
}

/** The tinted bases as 1-based spans merged across lines, the map's selection bands and its other range overlays. */
async function tintAndBands(page: Page) {
  return page.evaluate(() => {
    const pieces: [number, number][] = [];
    document.querySelectorAll<HTMLElement>('.motif-cs-seq-bases[data-line-start]').forEach((row) => {
      const lineStart = Number(row.dataset.lineStart);
      row.querySelectorAll<HTMLElement>('.motif-cs-seq-hl').forEach((tint) => {
        const left = lineStart + parseFloat(tint.style.left);
        pieces.push([left, left + parseFloat(tint.style.width)]);
      });
    });
    pieces.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const piece of pieces) {
      const last = merged[merged.length - 1];
      if (last && piece[0] <= last[1]) last[1] = Math.max(last[1], piece[1]);
      else merged.push([...piece]);
    }
    return {
      tint: merged.map(([start, end]) => `${Math.round(start) + 1}–${Math.round(end)}`),
      selectionBands: document.querySelectorAll('.motif-pm-selection').length,
      overlays: [...document.querySelectorAll('.motif-pm-range-overlay')]
        .map((overlay) => overlay.getAttribute('data-overlay-variant') ?? ''),
    };
  });
}

async function primerMarks(page: Page) {
  return page.evaluate(() => {
    const covered: Record<string, number[]> = { forward: [], reverse: [] };
    let heads = 0;
    document.querySelectorAll<HTMLElement>('.motif-cs-seq-primer').forEach((mark) => {
      const lineStart = Number(mark.closest<HTMLElement>('.motif-cs-seq-bases')!.dataset.lineStart);
      const left = lineStart + parseFloat(mark.style.left);
      const width = parseFloat(mark.style.width);
      covered[mark.dataset.strand === '1' ? 'forward' : 'reverse'].push(left, left + width);
      if (mark.dataset.head) heads += 1;
    });
    const span = (values: number[]) => (values.length ? `${Math.min(...values) + 1}–${Math.max(...values)}` : '');
    const map = [...document.querySelectorAll('.motif-pm-range-overlay')]
      .map((overlay) => `${overlay.getAttribute('data-overlay-variant')} ${overlay.getAttribute('aria-label')}`);
    return { forward: span(covered.forward), reverse: span(covered.reverse), heads, map };
  });
}

test.describe('Linked selection', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  const pageErrors = new WeakMap<Page, string[]>();
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    pageErrors.set(page, errors);
    page.on('pageerror', (error) => errors.push(error.message));
  });
  test.afterEach(async ({ page }) => {
    expect(pageErrors.get(page) ?? []).toEqual([]);
  });

  test('a record keeps its selected feature, site, caret and range across a record switch', async ({ page }) => {
    await openDemo(page);
    const durability = page.getByTestId('session-durability-status');
    const statusBefore = await durability.textContent();

    await clickCentre(page, ribbon(page, 'lacZ-alpha'));
    await expect(mapLine(page)).toHaveText('lacZ-alpha · 146–469 · 324 bp · − strand');
    await switchAwayAndBack(page);
    await expect(mapLine(page)).toHaveText('lacZ-alpha · 146–469 · 324 bp · − strand');
    await expect(sequenceLine(page)).toContainText('lacZ-alpha · 146–469 · 324 bp');
    await expect(ribbon(page, 'lacZ-alpha')).toHaveAttribute('aria-pressed', 'true');

    const site = page.locator('.motif-cs-restriction-label[aria-label^="NdeI,"]').first();
    await clickCentre(page, site);
    await expect(mapLine(page)).toHaveText('NdeI site · 183');
    await switchAwayAndBack(page);
    await expect(mapLine(page)).toHaveText('NdeI site · 183');
    await expect(page.locator('.motif-cs-restriction-label[aria-label^="NdeI,"]').first()).toHaveAttribute('aria-pressed', 'true');

    const base = await basePoint(page, 40);
    await page.mouse.click(base.x, base.y);
    await expect(sequenceLine(page)).toContainText('Caret 41');
    await switchAwayAndBack(page);
    await expect(sequenceLine(page)).toContainText('Caret 41');
    await expect(carets(page)).toHaveCount(1);

    const from = await basePoint(page, 9);
    const to = await basePoint(page, 29);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await expect(mapLine(page)).toHaveText('10–30 · 21 bp');
    await switchAwayAndBack(page);
    await expect(mapLine(page)).toHaveText('10–30 · 21 bp');

    // View state only: the workspace does not count as changed.
    await expect(durability).toHaveText(statusBefore ?? '');
    await expect(durability).not.toHaveText('unsaved changes');
  });

  test('a map drag, a ring click or another selection replaces an earlier caret and amino-acid pick', async ({ page }) => {
    await openDemo(page);
    const total = 2686;
    const placeCaret = async () => {
      const base = await basePoint(page, 199);
      await page.mouse.click(base.x, base.y);
      await expect(carets(page)).toHaveCount(1);
    };

    await placeCaret();
    const start = await ringPoint(page, 500, total);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const bp of [550, 600, 650, 700]) {
      const point = await ringPoint(page, bp, total);
      await page.mouse.move(point.x, point.y, { steps: 3 });
    }
    await page.mouse.up();
    await expect(mapLine(page)).toHaveText('500–699 · 200 bp');
    await expect(carets(page)).toHaveCount(0);

    await placeCaret();
    const ring = await ringPoint(page, 1001, total);
    await page.mouse.click(ring.x, ring.y);
    await expect(mapLine(page)).toHaveText('1,001–1,001 · 1 bp');
    await expect(carets(page)).toHaveCount(0);

    // Amino acids picked for copy end when a map drag replaces their selection.
    const label = page.locator('.motif-cs-aa-row-label').first();
    await clickCentre(page, label);
    // The label picks the whole track: its row on every rendered line.
    await expect.poll(() => page.locator('.motif-cs-seq-aa-row[data-aa-track-selected]').count()).toBeGreaterThan(0);
    const again = await ringPoint(page, 1200, total);
    await page.mouse.move(again.x, again.y);
    await page.mouse.down();
    for (const bp of [1250, 1300]) {
      const point = await ringPoint(page, bp, total);
      await page.mouse.move(point.x, point.y, { steps: 3 });
    }
    await page.mouse.up();
    // A base is about a third of a pixel of arc here, so the ends may land one base either way.
    await expect(mapLine(page)).toHaveText(/^1,(199|200|201)–1,(298|299|300) · 100 bp$/);
    await expect(page.locator('.motif-cs-seq-aa-row[data-aa-track-selected]')).toHaveCount(0);
  });

  test('a Digest row, a find match, a map feature and a site each replace an earlier caret and amino-acid pick', async ({ page }) => {
    await openDemo(page, 1040);
    const pickedRows = page.locator('.motif-cs-seq-aa-row[data-aa-track-selected]');
    const placeCaret = async () => {
      // The middle of the second line stays clear of the Find bar at either edge.
      const second = page.locator('.motif-cs-seq-bases[data-line-start]').nth(1);
      const index = await second.evaluate((row) => Number((row as HTMLElement).dataset.lineStart) + Math.floor(Number((row as HTMLElement).dataset.lineLen) / 2));
      const base = await basePoint(page, index);
      await page.mouse.click(base.x, base.y);
      await expect(carets(page)).toHaveCount(1);
    };
    const pickAminoAcids = async () => {
      await clickCentre(page, page.locator('.motif-cs-aa-row-label').first());
      await expect.poll(() => pickedRows.count()).toBeGreaterThan(0);
    };
    const digest = page.locator('details', { has: page.locator('summary', { hasText: 'Digest' }) }).first();
    const ways: [string, () => Promise<void>, string][] = [
      ['Digest row', async () => {
        if ((await digest.getAttribute('open')) === null) await digest.locator(':scope > summary').click();
        await clickCentre(page, page.locator('.motif-cs-digest-fragment-list .motif-cs-analysis-row-button').filter({ hasText: 'Fragment 2' }));
      }, '418–447 · 30 bp'],
      ['find match', async () => {
        await page.keyboard.press('ControlOrMeta+f');
        await page.getByRole('searchbox', { name: 'Find in sequence' }).fill('GGATCC');
        await page.keyboard.press('Enter');
      }, '417–422 · 6 bp'],
      ['map feature', async () => {
        await page.locator('.motif-cs-map-frame').scrollIntoViewIfNeeded();
        // A point inside AmpR's arc: halfway between its outer and inner edges.
        const point = await page.evaluate(() => {
          const path = document.querySelector('.motif-pm-feature[aria-label^="AmpR · "] path') as SVGPathElement;
          const length = path.getTotalLength();
          const matrix = path.getScreenCTM()!;
          const at = (share: number) => {
            const local = path.getPointAtLength(length * share);
            return { x: matrix.a * local.x + matrix.c * local.y + matrix.e, y: matrix.b * local.x + matrix.d * local.y + matrix.f };
          };
          const [outer, inner] = [at(0.25), at(0.75)];
          return { x: (outer.x + inner.x) / 2, y: (outer.y + inner.y) / 2 };
        });
        await page.mouse.click(point.x, point.y);
      }, 'AmpR · 1,626–2,486 · 861 bp · − strand'],
      ['sequence site', async () => {
        await clickCentre(page, page.locator('.motif-cs-restriction-label[aria-label^="EcoRI,"]').first());
      }, 'EcoRI site · 396'],
    ];
    for (const [name, select, readout] of ways) {
      for (const [earlier, before] of [['a caret', placeCaret], ['an amino-acid pick', pickAminoAcids]] as const) {
        await before();
        await select();
        await expect(mapLine(page), `${name} after ${earlier}`).toHaveText(readout);
        await expect(carets(page), `${name} after ${earlier}: no caret`).toHaveCount(0);
        await expect(pickedRows, `${name} after ${earlier}: no amino-acid pick`).toHaveCount(0);
      }
    }
  });

  test('a double-click selects the smallest feature or a 10-base group, a triple-click the line, with no native selection', async ({ page }) => {
    await openDemo(page);
    // Paint any native selection magenta so it cannot hide behind the app's own tint.
    await page.addStyleTag({ content: '.motif-cs-sequence ::selection, .motif-cs-sequence::selection { background: rgb(255, 0, 255) !important; color: rgb(255, 0, 255) !important; }' });

    // A single click still places the caret at once.
    const plain = await basePoint(page, 19);
    await page.mouse.click(plain.x, plain.y);
    expect(await carets(page).count()).toBe(1);
    await expect(sequenceLine(page)).toContainText('Caret 20');

    await page.mouse.move(plain.x, plain.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.down({ clickCount: 2 });
    expect(await nativeSelectionPixels(page)).toBe(0);
    await page.mouse.up({ clickCount: 2 });
    await expect(mapLine(page)).toHaveText('11–20 · 10 bp');
    expect(await nativeSelectionPixels(page)).toBe(0);

    await page.mouse.down({ clickCount: 3 });
    expect(await nativeSelectionPixels(page)).toBe(0);
    await page.mouse.up({ clickCount: 3 });
    const lineLength = Number(await page.locator('.motif-cs-seq-bases[data-line-start="0"]').getAttribute('data-line-len'));
    await expect(mapLine(page)).toHaveText(`1–${lineLength} · ${lineLength} bp`);
    expect(await nativeSelectionPixels(page)).toBe(0);
    await expect(carets(page)).toHaveCount(0);

    const inFeature = await basePoint(page, 159);
    await page.mouse.dblclick(inFeature.x, inFeature.y);
    await expect(mapLine(page)).toHaveText('lacZ-alpha · 146–469 · 324 bp · − strand');
    await expect(ribbon(page, 'lacZ-alpha')).toHaveAttribute('aria-pressed', 'true');
    expect(await nativeSelectionPixels(page)).toBe(0);

    // Deep inside a feature whose first line is far above, the clicked base stays under the pointer.
    await page.keyboard.press('Escape');
    const deep = await basePoint(page, 340);
    const scroller = page.locator('#motif-cs-sequence-view');
    const scrollBefore = await scroller.evaluate((element) => element.scrollTop);
    const pageScrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.dblclick(deep.x, deep.y);
    await expect(mapLine(page)).toHaveText('lacZ-alpha · 146–469 · 324 bp · − strand');
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);

    // The instrument sees a real native selection, on the row just double-clicked.
    await page.evaluate((base) => {
      const row = [...document.querySelectorAll<HTMLElement>('.motif-cs-seq-bases[data-line-start]')].find((candidate) => {
        const start = Number(candidate.dataset.lineStart);
        return base >= start && base < start + Number(candidate.dataset.lineLen);
      })!;
      const range = document.createRange();
      range.selectNodeContents(row.querySelector('.motif-cs-seq-glyphs')!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    }, 340);
    expect(await nativeSelectionPixels(page)).toBeGreaterThan(100);
  });

  test('a gel band selects its fragment, by pointer or key, and nothing moves', async ({ page }) => {
    await openDemo(page);
    const digest = page.locator('details', { has: page.locator('summary', { hasText: 'Digest' }) }).first();
    await digest.locator(':scope > summary').click();
    await page.getByRole('button', { name: 'Save 3 fragments, open gel' }).click();
    const gel = page.getByTestId('gel-workspace');
    await expect(gel).toBeVisible();

    const band = gel.locator('.motif-cs-gel-band[aria-label$=": 2,635 bp."]');
    await expect(band).toHaveJSProperty('tagName', 'BUTTON');
    await expect(band).toHaveAttribute('aria-pressed', 'false');
    const ladder = gel.locator('.motif-cs-gel-band[aria-label*="ladder"]').first();
    await expect(ladder).toHaveAttribute('role', 'img');
    expect(await ladder.evaluate((element) => getComputedStyle(element).cursor)).not.toBe('pointer');

    const watched = '.motif-cs-window, .motif-cs-gel-plate, .motif-cs-gel-band, .motif-cs-gel-readout, .motif-cs-map-frame, #motif-cs-sequence-view, .motif-cs-selection-bar, .motif-cs-map-selection-line';
    const boxes = () => page.evaluate((selector) => [...document.querySelectorAll(selector)]
      .map((element) => { const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(','); }), watched);
    const before = await boxes();
    const target = await centre(band);
    await page.mouse.click(target.x, target.y);
    await expect(mapLine(page)).toHaveText('448–396 · 2,635 bp · across the origin');
    await expect(sequenceLine(page)).toContainText('448–396 · 2,635 bp');
    await expect(band).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.motif-cs-digest-fragment-list .motif-cs-analysis-row-button[aria-pressed="true"]')).toContainText('Fragment 3');
    expect(await boxes()).toEqual(before);

    await gel.locator('.motif-cs-gel-band[aria-label$=": 30 bp."]').focus();
    await page.keyboard.press('Enter');
    await expect(mapLine(page)).toHaveText('418–447 · 30 bp');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(mapLine(page)).toHaveText('397–417 · 21 bp');
    await expect(band).toHaveAttribute('aria-pressed', 'false');

    // The Digest list row selects the fragment and the band shows it.
    await page.locator('.motif-cs-digest-fragment-list .motif-cs-analysis-row-button').filter({ hasText: 'Fragment 3' }).click();
    await expect(band).toHaveAttribute('aria-pressed', 'true');
  });

  test('a gel band of several same-length fragments selects them in turn', async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await page.waitForFunction(() => typeof window.motifReplaceWorkspace === 'function');
    // EcoRI cuts after base 100 and base 400 of 500: fragments of 100, 300 and 100 bp.
    // Built from repeats; the filler has no G or T, so the only cut sites are the planted ones.
    const [A, C, G, T] = ['A', 'C', 'G', 'T'];
    const site = G + A + A + T + T + C;
    const sequence = (C + A).repeat(49) + C + site + (C + A).repeat(147) + site + (C + A).repeat(47) + C;
    await page.evaluate((seq) => window.motifReplaceWorkspace({
      schema: 'motif.claude-science.inventory.v2',
      records: [{ id: 'twin-fragments', name: 'Twin fragments', molecule: 'dna', topology: 'linear', seq, proposeAnnotations: false }],
      selectedRecordId: 'twin-fragments',
    }, { discardUnsavedChanges: true }), sequence);
    await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();

    const digest = page.locator('details', { has: page.locator('summary', { hasText: 'Digest' }) }).first();
    await digest.locator(':scope > summary').click();
    const enzymes = digest.getByLabel('Digest enzymes');
    await enzymes.fill('EcoRI');
    await digest.getByRole('button', { name: 'Save 3 fragments, open gel' }).click();
    const band = page.getByTestId('gel-workspace').locator('.motif-cs-gel-band[data-linked][aria-label*="2 co-migrating fragments"]');
    await expect(band).toHaveCount(1);
    const target = await centre(band);
    // Pointing at the band prints its long reading under the plate; the band stays under the pointer.
    const resting = await band.boundingBox();
    await page.mouse.move(target.x, target.y);
    await expect(page.getByTestId('gel-band-readout')).toContainText('2 co-migrating fragments');
    expect(await band.boundingBox()).toEqual(resting);
    await page.mouse.click(target.x, target.y);
    await expect(mapLine(page)).toHaveText('1–100 · 100 bp');
    await page.mouse.click(target.x, target.y);
    await expect(mapLine(page)).toHaveText('401–500 · 100 bp');
    await page.mouse.click(target.x, target.y);
    await expect(mapLine(page)).toHaveText('1–100 · 100 bp');
  });

  test('the primer workspace marks its pair on the sequence and the map without changing the selection', async ({ page }) => {
    await openDemo(page, 1040);
    await clickCentre(page, ribbon(page, 'lacZ-alpha'));
    await expect(mapLine(page)).toHaveText('lacZ-alpha · 146–469 · 324 bp · − strand');
    const heights = () => page.locator('.motif-cs-seq-block').evaluateAll((blocks) => blocks.map((block) => block.getBoundingClientRect().height));
    const heightsBefore = await heights();
    expect(await primerMarks(page)).toEqual({ forward: '', reverse: '', heads: 0, map: [] });

    const primer = await openTool(page, 'primer-design');
    await primer.getByRole('button', { name: 'Open primer workspace' }).click();
    const workspace = page.locator('.motif-cs-window[aria-label="Primer design"]');
    await expect(workspace).toBeVisible();
    await expect.poll(() => primerMarks(page)).toEqual({
      forward: '143–162',
      reverse: '453–473',
      heads: 2,
      map: ['primer-forward Forward primer 143–162', 'primer-reverse Reverse primer 453–473'],
    });
    await expect(mapLine(page)).toHaveText('lacZ-alpha · 146–469 · 324 bp · − strand');
    expect(await heights()).toEqual(heightsBefore);

    // A primer's name selects where it binds, read with its strand; the pair stays chosen.
    const primerName = (name: 'Forward' | 'Reverse') => workspace.getByRole('button', { name: new RegExp(`^${name} primer `) });
    await clickCentre(page, primerName('Forward'));
    await expect(mapLine(page)).toHaveText('Forward primer · 143–162 · 20 bp · + strand');
    await expect(sequenceLine(page)).toContainText('Forward primer · 143–162 · 20 bp · + strand');
    await expect(primerName('Forward')).toHaveAttribute('aria-pressed', 'true');
    await expect(workspace.locator('[data-pair-index="0"]')).toHaveAttribute('aria-selected', 'true');
    const picked = await tintAndBands(page);
    expect(picked.tint).toEqual(['143–162']);
    expect(picked.selectionBands).toBeGreaterThan(0);
    expect(picked.overlays).toEqual(['primer-forward', 'primer-reverse']);
    await clickCentre(page, primerName('Reverse'));
    await expect(mapLine(page)).toHaveText('Reverse primer · 453–473 · 21 bp · − strand');
    await expect(sequenceLine(page)).toContainText('Reverse primer · 453–473 · 21 bp · − strand');
    await expect(primerName('Forward')).toHaveAttribute('aria-pressed', 'false');
    await expect(primerName('Reverse')).toHaveAttribute('aria-pressed', 'true');
    expect((await tintAndBands(page)).tint).toEqual(['453–473']);
    await expect(carets(page)).toHaveCount(0);
    expect(await heights()).toEqual(heightsBefore);

    const second = workspace.locator('[data-pair-index="1"]');
    await clickCentre(page, second);
    await expect(mapLine(page)).toHaveText('146–480 · 335 bp');
    // The second pair's forward primer: the list stays on pair 2.
    await clickCentre(page, primerName('Forward'));
    await expect(mapLine(page)).toHaveText(/^Forward primer · 146–\d+ · \d+ bp · \+ strand$/);
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => {
      const marks = await primerMarks(page);
      return [marks.forward.split('–')[0], marks.reverse.split('–')[1]];
    }).toEqual(['146', '480']);
    expect(await heights()).toEqual(heightsBefore);

    await workspace.locator('button[aria-label^="Close"]').first().click();
    await expect(workspace).toHaveCount(0);
    expect(await primerMarks(page)).toEqual({ forward: '', reverse: '', heads: 0, map: [] });
  });

  // A guard: the primer workspace designs on a linear reading of the record, so
  // a primer across the origin reaches the workbench as a primer feature, and
  // picking one selects both pieces.
  test('a primer that binds across the origin of a circular record selects both ends', async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await page.waitForFunction(() => typeof window.motifReplaceWorkspace === 'function');
    // 200 bases built from an 8-base unit repeated 25 times.
    const [A, C, G, T] = ['A', 'C', 'G', 'T'];
    const sequence = (A + C + G + T + T + G + C + A).repeat(25);
    await page.evaluate((seq) => window.motifReplaceWorkspace({
      schema: 'motif.claude-science.inventory.v2',
      records: [{
        id: 'origin-primer',
        name: 'Origin primer',
        molecule: 'dna',
        topology: 'circular',
        seq,
        proposeAnnotations: false,
        // The inventory writes a site across the origin as a join of its two pieces.
        features: [{ id: 'p1', name: 'P1 forward', type: 'primer_bind', start: 0, end: 200, strand: 1, subRanges: [{ start: 185, end: 200 }, { start: 0, end: 15 }] }],
      }],
      selectedRecordId: 'origin-primer',
    }, { discardUnsavedChanges: true }), sequence);
    await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();
    const tracks = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await tracks.getAttribute('data-active')) !== 'true') await tracks.click();
    await clickCentre(page, ribbon(page, 'P1 forward'));
    await expect(mapLine(page)).toHaveText('P1 forward · 186–200 + 1–15 · 30 bp · + strand');
    await expect(sequenceLine(page)).toContainText('P1 forward · 186–200 + 1–15 · 30 bp');
    expect((await tintAndBands(page)).tint).toEqual(['1–15', '186–200']);
  });
});
