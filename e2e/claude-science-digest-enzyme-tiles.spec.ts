import { expect, test, type Locator, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// A Digest enzyme tile looks like a button, so it is one: a click goes to its
// enzyme's site on the sequence and the map, the next click to the next site,
// and the tile says which site it is on without changing its size. Every
// gesture is real pointer or key input on the bundled pUC19 demo record.

async function openDigest(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
  const digest = page.locator('details', { has: page.locator('summary', { hasText: 'Digest' }) }).first();
  if ((await digest.getAttribute('open')) === null) await digest.locator(':scope > summary').click();
  await expect(tile(page, 'EcoRI')).toBeVisible();
  return digest;
}

const tile = (page: Page, enzyme: string) => page.locator('.motif-cs-digest-enzyme-chip').filter({ has: page.locator('strong', { hasText: new RegExp(`^${enzyme}$`) }) });
const mapLine = (page: Page) => page.locator('.motif-cs-map-selection-line');

async function clickCentre(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Every box a click on a tile must leave where it was. */
async function boxes(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('.motif-cs-digest-enzyme-chip, .motif-cs-digest-enzyme-chips, .motif-cs-map-frame, #motif-cs-sequence-view, .motif-cs-digest-outcome, .motif-cs-digest-fragment-list, [data-pane-key]')]
    .map((element) => { const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(','); }));
}

/** Whether the sequence row holding base `index` (0-based) is inside the sequence view. */
async function baseInView(page: Page, index: number) {
  return page.evaluate((base) => {
    const view = document.querySelector('#motif-cs-sequence-view')!.getBoundingClientRect();
    const row = [...document.querySelectorAll<HTMLElement>('.motif-cs-seq-bases[data-line-start]')].find((candidate) => {
      const start = Number(candidate.dataset.lineStart);
      return base >= start && base < start + Number(candidate.dataset.lineLen);
    });
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return rect.top >= view.top - 1 && rect.bottom <= Math.min(view.bottom, window.innerHeight) + 1;
  }, index);
}

test.describe('Digest enzyme tiles', () => {
  test('a tile selects its enzyme site on the map and sequence, and nothing moves', async ({ page }) => {
    await openDigest(page, 1440, 900);
    const ecoRI = tile(page, 'EcoRI');
    await expect(ecoRI).toHaveJSProperty('tagName', 'BUTTON');
    await expect(ecoRI).toHaveAccessibleName('EcoRI, 1 cut. Go to site 1 of 1');
    expect(await ecoRI.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    expect((await ecoRI.boundingBox())!.height).toBeGreaterThanOrEqual(28);

    const before = await boxes(page);
    const size = await ecoRI.boundingBox();
    await clickCentre(page, ecoRI);
    const cluster = page.locator('.motif-pm-restriction[data-cluster-id][aria-label^="EcoRI"]');
    await expect(cluster).toHaveAttribute('data-active', 'true');
    await expect(ecoRI).toHaveAttribute('aria-pressed', 'true');
    await expect(ecoRI).toHaveAccessibleName('EcoRI, site 1 of 1. Go to site 1 of 1');
    await expect(ecoRI.locator('.motif-cs-digest-enzyme-count > :not([hidden])')).toHaveText('1 of 1');
    await expect(mapLine(page)).toHaveText('EcoRI site · 396');
    await expect(page.locator('.motif-cs-selection-label')).toContainText('EcoRI site · 396');
    expect(await baseInView(page, 395)).toBe(true);
    expect(await boxes(page)).toEqual(before);
    expect(await ecoRI.boundingBox()).toEqual(size);
  });

  test('each click goes to the next site and wraps; Enter and Space do the same', async ({ page }) => {
    const digest = await openDigest(page, 700, 860);
    // PvuII cuts pUC19 twice: its CAGCTG sites start at bases 306 and 628. The map
    // does not draw PvuII, so the tile selects each site's bases as a range.
    await digest.getByLabel('Digest enzymes').fill('PvuII');
    const pvuII = tile(page, 'PvuII');
    await expect(pvuII).toHaveAccessibleName('PvuII, 2 cuts. Go to site 1 of 2');
    const size = await pvuII.boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(28);
    const before = await boxes(page);

    await clickCentre(page, pvuII);
    await expect(mapLine(page)).toContainText('306–311 · 6 bp');
    await expect(pvuII).toHaveAccessibleName('PvuII, site 1 of 2. Go to site 2 of 2');
    await expect(pvuII.locator('.motif-cs-digest-enzyme-count > :not([hidden])')).toHaveText('1 of 2');
    expect(await pvuII.boundingBox()).toEqual(size);

    await clickCentre(page, pvuII);
    await expect(mapLine(page)).toContainText('628–633 · 6 bp');
    await expect(pvuII.locator('.motif-cs-digest-enzyme-count > :not([hidden])')).toHaveText('2 of 2');
    await expect.poll(() => baseInView(page, 627)).toBe(true);
    expect(await pvuII.boundingBox()).toEqual(size);
    expect(await boxes(page)).toEqual(before);

    await clickCentre(page, pvuII);
    await expect(mapLine(page)).toContainText('306–311 · 6 bp');

    await pvuII.focus();
    await page.keyboard.press('Enter');
    await expect(mapLine(page)).toContainText('628–633 · 6 bp');
    await page.keyboard.press('Space');
    await expect(mapLine(page)).toContainText('306–311 · 6 bp');
    await expect(pvuII).toBeFocused();
    expect(await pvuII.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  });

  test('hover and press give the tile a fill', async ({ page }) => {
    await openDigest(page, 1440, 900);
    const ecoRI = tile(page, 'EcoRI');
    const fill = () => ecoRI.evaluate((element) => getComputedStyle(element).backgroundColor);
    const resting = await fill();
    const box = (await ecoRI.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(fill).not.toBe(resting);
    const hover = await fill();
    await page.mouse.down();
    await expect.poll(fill).not.toBe(hover);
    await page.mouse.up();
  });

  test('on a zoomed map a tile brings its site into view', async ({ page }) => {
    const digest = await openDigest(page, 1440, 900);
    // ScaI's one site is at 2,177 bp, on the left of the ring; zooming in about the
    // top of the ring leaves it outside the map's view.
    await digest.getByLabel('Digest enzymes').fill('ScaI');
    const zoomIn = page.getByRole('button', { name: 'Zoom in' }).first();
    for (let step = 0; step < 4; step += 1) await zoomIn.click();
    const frame = page.locator('.motif-cs-map-frame').first();
    const cluster = page.locator('.motif-pm-restriction[data-cluster-id][aria-label^="ScaI"]');
    const inFrame = async () => {
      const outer = (await frame.boundingBox())!;
      const tick = await cluster.locator('line').first().boundingBox();
      if (!tick) return false;
      const x = tick.x + tick.width / 2;
      const y = tick.y + tick.height / 2;
      return x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;
    };
    expect(await inFrame()).toBe(false);
    await clickCentre(page, tile(page, 'ScaI'));
    await expect(cluster).toHaveAttribute('data-active', 'true');
    await expect.poll(inFrame).toBe(true);
  });
});
