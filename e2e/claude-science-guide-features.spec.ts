import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

type InventoryFeature = { name: string; type: string; start: number; end: number; strand: number; metadata?: { note?: string } };

const rc = (value: string) => value.split('').reverse().map((base) => ({ A: 'T', T: 'A', G: 'C', C: 'G' }[base] ?? base)).join('');

async function guideFeatures(page: Page): Promise<InventoryFeature[]> {
  return page.evaluate(() => (window.motifGetInventory().find((record) => record.name === 'pUC19')?.annotations ?? [])
    .filter((feature) => /guide/.test(String(feature.name))) as unknown as InventoryFeature[]);
}

test.describe('Claude Science guide RNA features', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  const pageDiagnostics = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const diagnostics: string[] = [];
    pageDiagnostics.set(page, diagnostics);
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        diagnostics.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    expect(pageDiagnostics.get(page) ?? []).toEqual([]);
  });

  test('adds a forward and a reverse guide as features on their own strands, once each, with undo', async ({ page }) => {
    const seq = (await page.evaluate(() => window.motifGetInventory().find((record) => record.name === 'pUC19')?.seq ?? '')).toUpperCase();
    expect(seq.length).toBe(2686);
    const panel = page.locator('details[data-rail-tool="guide"]');
    await panel.locator(':scope > summary').click();
    const rows = panel.locator('.motif-cs-guide-row');
    await expect(rows).toHaveCount(30);
    const forwardRow = rows.filter({ has: page.locator('.motif-cs-guide-strand[data-strand="1"]') }).first();
    const reverseRow = rows.filter({ has: page.locator('.motif-cs-guide-strand[data-strand="-1"]') }).first();
    const read = async (row: typeof forwardRow) => ({
      position: Number(await row.locator('.motif-cs-guide-pos').textContent()),
      text: (await row.locator('.motif-cs-guide-spacer').textContent()) ?? '',
    });
    const forward = await read(forwardRow);
    const reverse = await read(reverseRow);
    const forwardStart = forward.position - 1;
    const reverseStart = reverse.position - 1;
    // Truth from the record's own bases: a forward guide is the top strand; a
    // reverse guide is the reverse complement of its forward window.
    expect(forward.text).toBe(seq.slice(forwardStart, forwardStart + 23));
    expect(reverse.text).toBe(rc(seq.slice(reverseStart - 3, reverseStart + 20)));

    await forwardRow.getByRole('button', { name: 'Add', exact: true }).click();
    const reverseAdd = reverseRow.getByRole('button', { name: 'Add', exact: true });
    await reverseAdd.focus();
    await page.keyboard.press('Enter');
    await expect(forwardRow.getByRole('button', { name: 'Added' })).toHaveAttribute('aria-disabled', 'true');
    await expect(reverseRow.getByRole('button', { name: 'Added' })).toBeFocused();
    // Adding selects the new feature; the list stays on the whole record.
    await expect(rows).toHaveCount(30);
    await expect(panel.locator('.motif-cs-guide-scope')).toContainText('Whole record');

    const added = await guideFeatures(page);
    expect(added.map(({ type, start, end, strand }) => ({ type, start, end, strand }))).toEqual([
      { type: 'misc_feature', start: forwardStart, end: forwardStart + 20, strand: 1 },
      { type: 'misc_feature', start: reverseStart, end: reverseStart + 20, strand: -1 },
    ]);
    expect(added[1].metadata?.note).toBe(`SpCas9 guide; spacer ${rc(seq.slice(reverseStart, reverseStart + 20))}; PAM ${rc(seq.slice(reverseStart - 3, reverseStart))}`);

    await forwardRow.getByRole('button', { name: 'Added' }).click({ force: true });
    expect(await guideFeatures(page)).toHaveLength(2);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(reverseRow.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
    expect((await guideFeatures(page)).map((feature) => feature.strand)).toEqual([1]);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(reverseRow.getByRole('button', { name: 'Added' })).toBeVisible();
    expect(await guideFeatures(page)).toHaveLength(2);
  });
});
