import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// A protein_bind has no Motif type, so it reads as `custom`; an ncRNA without
// the /ncRNA_class INSDC makes mandatory gets the vocabulary's "other".
const fixture = [
  'LOCUS       KEYDEMO                   60 bp    DNA     linear   SYN 23-SEP-2026',
  'DEFINITION  Feature-key round trip.',
  'ACCESSION   KEYDEMO',
  'FEATURES             Location/Qualifiers',
  '     protein_bind    5..21',
  '                     /bound_moiety="lac repressor"',
  '                     /note="lac operator"',
  '     ncRNA           complement(30..50)',
  '                     /note="unclassed RNA"',
  'ORIGIN',
  '        1 aattgtgagc ggataacaat tgcatgcatg cagtcgacgt acgtacgtac gtcagtcagt',
  '//',
].join('\n');

test.describe('Basic GenBank feature keys', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  type Inventory = { id: string; name: string }[];
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

  async function importText(page: Page, name: string, text: string) {
    const before = (await inventory(page)).length;
    await page.getByRole('button', { name: 'Add entry' }).first().click();
    await page.getByLabel('Choose sequence or workspace files').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect.poll(async () => (await inventory(page)).length).toBe(before + 1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.motif-cs-inventory-record-row[aria-current="true"]')).toContainText('KEYDEMO');
  }

  async function exportAs(page: Page, label: string) {
    await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    const format = page.locator('select').filter({ has: page.locator('option', { hasText: 'Basic GenBank' }) }).first();
    await expect(format.locator('option', { hasText: label })).toHaveCount(1);
    await format.selectOption({ label });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const path = await (await download).path();
    await page.keyboard.press('Escape');
    return readFile(path!, 'utf8');
  }
  const exportGenBank = (page: Page) => exportAs(page, 'Active record - Basic GenBank');

  test('an imported key Motif has no type for is shown and written back as that key', async ({ page, browser }) => {
    await openFresh(page);
    await importText(page, 'keydemo.gb', fixture);
    await expect(page.locator('[title^="lac operator · "]').first()).toHaveAttribute('title', 'lac operator · protein_bind · 5-21 · Double-click to edit');

    const first = await exportGenBank(page);
    expect(first).toContain('     protein_bind    5..21\n                     /bound_moiety="lac repressor"');
    expect(first).toContain('     ncRNA           complement(30..50)\n                     /note="unclassed RNA"\n                     /ncRNA_class="other"');
    expect(first).not.toContain('/motif_type');

    const second = await browser.newPage();
    await openFresh(second);
    await importText(second, 'reimport.gb', first);
    const withoutLocus = (text: string) => text.split('\n').filter((line) => !/^(LOCUS|ACCESSION)/.test(line)).join('\n');
    expect(withoutLocus(await exportGenBank(second))).toBe(withoutLocus(first));
    await second.close();
  });

  // INSDC retired -10_signal, -35_signal, TATA_signal and misc_signal for
  // `regulatory` + /regulatory_class on 15-DEC-2014.
  const retiredFixture = [
    'LOCUS       KEYDEMO                  120 bp    DNA     linear   SYN 23-SEP-2026',
    'DEFINITION  Retired and kept feature keys.',
    'ACCESSION   KEYDEMO',
    'FEATURES             Location/Qualifiers',
    '     protein_bind    5..21',
    '                     /bound_moiety="lac repressor"',
    '                     /note="lac operator"',
    '     misc_binding    25..36',
    '                     /bound_moiety="theophylline"',
    '                     /note="aptamer"',
    '     -35_signal      40..45',
    '                     /note="minus 35 box"',
    '     -10_signal      63..68',
    '                     /note="minus 10 box"',
    '     TATA_signal     70..76',
    '                     /note="TATA"',
    '     misc_signal     80..90',
    '                     /note="unknown signal"',
    '     regulatory      95..115',
    '                     /regulatory_class="riboswitch"',
    '                     /note="TPP riboswitch"',
    'ORIGIN',
    '        1 gctaaagaca attacataac atacacgtca gcacgaaact tgttggccca gtgtgaatcg',
    '       61 cttaagggtt aagtaagtgt gatgcatacg cctttacttg ctgtgtccac cccatcggac',
    '//',
  ].join('\n');

  test('shows a kept key everywhere and reads a retired key as regulatory with its class', async ({ page, browser }) => {
    await openFresh(page);
    await importText(page, 'retired.gb', retiredFixture);

    // The map's feature buttons are named by the kept key or the current key,
    // and a regulatory feature by its class too.
    const mapLabels = await page.locator('.motif-pm-feature[data-feature-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    expect(mapLabels).toEqual([
      'lac operator · protein_bind · 5–21 →',
      'aptamer · misc_binding · 25–36 →',
      'minus 35 box · regulatory (minus_35_signal) · 40–45 →',
      'minus 10 box · regulatory (minus_10_signal) · 63–68 →',
      'TATA · regulatory (TATA_box) · 70–76 →',
      'unknown signal · regulatory (other) · 80–90 →',
      'TPP riboswitch · regulatory (riboswitch) · 95–115 →',
    ]);
    const minus10 = page.locator('.motif-cs-feature-block[title^="minus 10 box · "]').first();
    await expect(minus10).toHaveAttribute('title', 'minus 10 box · regulatory (minus_10_signal) · 63-68 · Double-click to edit');
    await minus10.click();
    await page.locator('[data-rail-tool="inspector"] summary').click();
    await expect(page.locator('.motif-cs-inspector-body strong', { hasText: 'minus 10 box' }).locator('xpath=following-sibling::span[1]'))
      .toHaveText('regulatory (minus_10_signal) · 63-68 · forward');
    await page.keyboard.press('Escape');

    // The copy summary and the loss report agree with what each file writes.
    const described = await page.evaluate(() => (window as unknown as {
      motifDescribe: () => { text: string; data: { exportLoss: { originalFeatureKeys: { key: string; exportedType: string | null }[] } } };
    }).motifDescribe());
    expect(described.text).toContain('Features (7): lac operator protein_bind 5..21 · 17 bp (+); aptamer misc_binding 25..36');
    expect(described.text).toContain('minus 10 box regulatory 63..68');
    expect(described.data.exportLoss.originalFeatureKeys.map(({ key, exportedType }) => `${key} ${exportedType}`)).toEqual([
      'protein_bind protein_bind', 'misc_binding misc_binding', '-35_signal regulatory', '-10_signal regulatory',
      'tata_signal regulatory', 'misc_signal regulatory', 'regulatory regulatory',
    ]);
    const gff3 = await exportAs(page, 'Active record - Basic GFF3 features');
    expect(gff3.split('\n').filter((line) => line.includes('\tMotif\t')).map((line) => line.split('\t')[2]))
      .toEqual(['protein_bind', 'misc_binding', 'regulatory', 'regulatory', 'regulatory', 'regulatory', 'regulatory']);

    const first = await exportGenBank(page);
    const blocks = first.slice(first.indexOf('FEATURES'), first.indexOf('\nORIGIN')).split(/\n(?= {5}\S)/).slice(1);
    expect(blocks.map((block) => [block.trim().split(/\s+/)[0], (block.match(/\/regulatory_class="[^"]*"/g) ?? []).join(' ')])).toEqual([
      ['protein_bind', ''],
      ['misc_binding', ''],
      ['regulatory', '/regulatory_class="minus_35_signal"'],
      ['regulatory', '/regulatory_class="minus_10_signal"'],
      ['regulatory', '/regulatory_class="TATA_box"'],
      ['regulatory', '/regulatory_class="other"'],
      ['regulatory', '/regulatory_class="riboswitch"'],
    ]);
    expect(blocks[5]).toContain('/note="misc_signal"\n                     /note="unknown signal"');
    expect(first).not.toContain('/motif_type');

    const second = await browser.newPage();
    await openFresh(second);
    await importText(second, 'reimport.gb', first);
    const withoutLocus = (text: string) => text.split('\n').filter((line) => !/^(LOCUS|ACCESSION)/.test(line)).join('\n');
    expect(withoutLocus(await exportGenBank(second))).toBe(withoutLocus(first));
    await second.close();

    // The editor's type menu reads the kept key; another type replaces it.
    const block = page.locator('.motif-cs-feature-block[title^="lac operator · "]').first();
    await block.dblclick();
    const typeMenu = page.locator('select[name="feature-type"]');
    await expect(typeMenu).toHaveValue('custom');
    await expect(typeMenu.locator('option:checked')).toHaveText('protein_bind');
    await expect(typeMenu.locator('option')).toHaveCount(13);
    await typeMenu.selectOption('promoter');
    await page.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(page.locator('.motif-cs-feature-block[title^="lac operator · "]').first()).toHaveAttribute('title', 'lac operator · promoter · 5-21 · Double-click to edit');
    const retyped = await exportGenBank(page);
    expect(retyped).toMatch(/\n {5}regulatory {6}5\.\.21\n(?: {21}\/.*\n)*? {21}\/regulatory_class="promoter"\n/);
    expect(retyped).not.toContain('protein_bind');
  });
});
