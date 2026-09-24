import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// NCBI writes an mRNA in DNA letters, as every NM_ and XM_ record does.
const origin = 'atggctagca aaggagaaga acttttcact ggagttgtcc caattcttgt tgaattagat';
const mrnaFixture = (molecule: string, bases = origin) => [
  `LOCUS       NM_DEMO                   60 bp    ${molecule.padEnd(6, ' ')}  linear   PRI 23-MAR-2024`,
  'DEFINITION  Demo transcript.',
  'ACCESSION   NM_DEMO',
  'FEATURES             Location/Qualifiers',
  '     CDS             1..60',
  '                     /product="demo protein"',
  'ORIGIN',
  `        1 ${bases}`,
  '//',
].join('\n');

test.describe('GenBank mRNA LOCUS import', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  type Inventory = { name: string; molecule: string; seq: string; provenance?: Record<string, unknown> }[];
  const inventory = (page: Page) => page.evaluate(() => (window as unknown as { motifGetInventory: () => Inventory }).motifGetInventory());

  async function openFresh(page: Page) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
  }

  async function pickFile(page: Page, name: string, text: string) {
    await page.getByRole('button', { name: 'Add entry' }).first().click();
    await page.getByLabel('Choose sequence or workspace files').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  }

  async function exportGenBank(page: Page) {
    await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    const format = page.locator('select').filter({ has: page.locator('option', { hasText: 'Basic GenBank' }) }).first();
    await format.selectOption({ label: 'Active record - Basic GenBank' });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const path = await (await download).path();
    await page.keyboard.press('Escape');
    return readFile(path!, 'utf8');
  }

  test('imports an mRNA written in DNA letters as DNA, says so, and writes mRNA back', async ({ page, browser }) => {
    await openFresh(page);
    const before = (await inventory(page)).length;
    await pickFile(page, 'NM_DEMO.gb', mrnaFixture('mRNA'));
    await expect(page.locator('.motif-cs-workbench-notice')).toHaveText('Imported 1 record · NM_DEMO is mRNA written in DNA letters; imported as DNA');
    const records = await inventory(page);
    expect(records).toHaveLength(before + 1);
    expect(records.at(-1)).toMatchObject({ name: 'NM_DEMO', molecule: 'dna', seq: origin.replace(/ /g, '').toUpperCase() });
    await page.keyboard.press('Escape');

    const exported = await exportGenBank(page);
    // 1-based columns 48-53 hold the molecule, as NCBI writes them.
    expect(exported.split('\n')[0].slice(47, 53)).toBe('mRNA  ');
    expect(exported).toContain(`        1 ${origin}\n//`);

    const second = await browser.newPage();
    await openFresh(second);
    await pickFile(second, 'NM_DEMO-export.gb', exported);
    await expect(second.locator('.motif-cs-workbench-notice')).toContainText('NM_DEMO is mRNA written in DNA letters');
    await second.keyboard.press('Escape');
    const withoutDate = (text: string) => text.replace(/\d{2}-[A-Z]{3}-\d{4}/, '');
    expect(withoutDate(await exportGenBank(second))).toBe(withoutDate(exported));
    await second.close();

    // An RNA LOCUS whose bases use u is still an RNA record.
    const third = await browser.newPage();
    await openFresh(third);
    await pickFile(third, 'RNA_DEMO.gb', mrnaFixture('RNA', origin.replace(/t/g, 'u')));
    await expect(third.locator('.motif-cs-workbench-notice')).toHaveText('Imported 1 record');
    expect((await inventory(third)).at(-1)).toMatchObject({ molecule: 'rna', seq: origin.replace(/ /g, '').replace(/t/g, 'u').toUpperCase() });
    await third.close();
  });
});
