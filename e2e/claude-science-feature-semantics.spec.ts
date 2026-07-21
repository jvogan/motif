import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

async function openAnnotationsEditor(page: Page, featureName?: string) {
  const annotations = page.locator('details[data-rail-tool="annotations"]');
  if ((await annotations.getAttribute('open')) === null) await annotations.locator(':scope > summary').click();
  const drawer = annotations.locator('.motif-cs-annotation-editor-drawer');
  if (featureName) {
    await annotations.locator('.motif-cs-feature-annotation-list > .motif-cs-row').filter({ hasText: featureName }).click();
  } else if ((await drawer.getAttribute('open')) === null) {
    await drawer.locator(':scope > summary').click();
  }
  await expect(drawer).toHaveAttribute('open', '');
  return annotations;
}

test.describe('Claude Science multipart feature semantics', () => {
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
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();
    await expect(page.locator('details[data-rail-tool="annotations"]')).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    expect(pageDiagnostics.get(page) ?? []).toEqual([]);
  });

  test('uses joined pieces for inspection, translation, editing, extraction, and export', async ({ page }) => {
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'joined-record',
      name: 'Joined record',
      molecule: 'dna',
      topology: 'linear',
      seq: 'ATGCCCGGGCCATTTAAA',
      annotations: [{
        id: 'joined-cds',
        name: 'joined CDS',
        type: 'cds',
        start: 0,
        end: 12,
        strand: 1,
        color: '#888888',
        subRanges: [
          { start: 0, end: 3, strand: 1 },
          { start: 9, end: 12, strand: 1 },
        ],
      }],
    }]));

    const detail = page.getByRole('button', { name: 'Detail' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();

    const featureBlocks = page.locator('.motif-cs-feature-block').filter({ hasText: 'joined CDS' });
    await expect(featureBlocks).toHaveCount(2);
    await featureBlocks.first().click();
    await expect(page.locator('.motif-cs-seq-hl')).toHaveCount(2);
    await expect(page.locator('.motif-cs-selection-bar')).toContainText('6 bp');

    const inspector = page.locator('details[data-rail-tool="inspector"]');
    if ((await inspector.getAttribute('open')) === null) await inspector.locator(':scope > summary').click();
    await expect(inspector).toContainText('1-3 + 10-12');
    await expect(inspector).toContainText('6 bp');
    await expect(inspector).toContainText('GC 50.0%');
    await expect.poll(() => page.evaluate(() => window.motifDescribe?.())).toMatchObject({
      data: {
        features: [{
          location: 'join(1..3,10..12)',
          length: 6,
          subRanges: [
            { start: 0, end: 3, strand: 1 },
            { start: 9, end: 12, strand: 1 },
          ],
        }],
        selection: { length: 6, sequence: 'ATGCCA', gcPercent: 50 },
      },
    });
    await expect.poll(() => page.evaluate(() => window.motifDescribe?.()?.text ?? '')).toContain('join(1..3,10..12) · 6 bp');

    const translation = page.locator('details[data-rail-tool="translation"]');
    if ((await translation.getAttribute('open')) === null) await translation.locator(':scope > summary').click();
    await expect(translation.locator('.motif-cs-protein-readout')).toHaveText('MP');
    await expect(translation).toContainText('stitched in biological order');
    await expect(translation.getByRole('button', { name: 'Add AA track' })).toBeDisabled();

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    if ((await exportPanel.getAttribute('open')) === null) await exportPanel.locator(':scope > summary').click();
    const exportFormat = exportPanel.locator('select[name="export-format"]');
    const exportPreview = exportPanel.getByLabel('Selected export preview');

    await exportFormat.selectOption('record-genbank');
    await expect(exportPreview).toHaveValue(/join\(1\.\.3,10\.\.12\)/);
    await exportFormat.selectOption('record-gff3');
    await expect(exportPreview).toHaveValue(/joined-record\tMotif\tcds\t1\t3/);
    await expect(exportPreview).toHaveValue(/joined-record\tMotif\tcds\t10\t12/);
    await exportFormat.selectOption('features-csv');
    await expect(exportPreview).toHaveValue(/,6,"join\(1\.\.3,10\.\.12\)",2/);

    const annotations = await openAnnotationsEditor(page, 'joined CDS');
    await expect(annotations.getByLabel('Start')).toBeDisabled();
    await expect(annotations.getByLabel('End')).toBeDisabled();
    await expect(annotations).toContainText('Multipart location');
    await annotations.locator('input[name="feature-name"]').fill('renamed joined CDS');
    await annotations.getByRole('button', { name: 'Update', exact: true }).first().click();
    expect(await page.evaluate(() => window.motifGetInventory()[0].annotations?.[0].subRanges)).toEqual([
      { start: 0, end: 3, strand: 1 },
      { start: 9, end: 12, strand: 1 },
    ]);

    const countBefore = await page.evaluate(() => window.motifGetInventory().length);
    await annotations.getByRole('button', { name: 'New record' }).click();
    expect(await page.evaluate(() => window.motifGetInventory().length)).toBe(countBefore + 1);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('renamed joined CDS');
    await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord?.()?.seq)).toBe('ATGCCA');
  });

  test('honors imported codon_start when translating a joined CDS', async ({ page }) => {
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'frame-record',
      name: 'Frame record',
      molecule: 'dna',
      topology: 'linear',
      seq: 'ATGCCCGGGCCATTTAAA',
      annotations: [{
        id: 'frame-cds',
        name: 'frame two CDS',
        type: 'cds',
        start: 0,
        end: 12,
        strand: 1,
        color: '#888888',
        metadata: { codon_start: '2' },
        subRanges: [
          { start: 0, end: 3, strand: 1 },
          { start: 9, end: 12, strand: 1 },
        ],
      }],
    }]));

    const detail = page.getByRole('button', { name: 'Detail' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
    await page.locator('.motif-cs-feature-block').filter({ hasText: 'frame two CDS' }).first().click();

    const translation = page.locator('details[data-rail-tool="translation"]');
    if ((await translation.getAttribute('open')) === null) await translation.locator(':scope > summary').click();
    await expect(translation.locator('.motif-cs-protein-readout')).toHaveText('C');
    await expect(translation.getByRole('button', { name: '+2', exact: true })).toHaveAttribute('aria-pressed', 'true');

    const annotations = await openAnnotationsEditor(page, 'frame two CDS');
    await annotations.getByRole('button', { name: 'New protein' }).click();
    await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord?.()?.seq)).toBe('C');
  });

  test('keeps order locations visible but blocks implicit extraction and translation', async ({ page }) => {
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'ordered-record',
      name: 'Ordered record',
      molecule: 'dna',
      topology: 'linear',
      seq: 'ATGCCCGGGCCATTTAAA',
      annotations: [{
        id: 'ordered-cds',
        name: 'ordered CDS',
        type: 'cds',
        start: 0,
        end: 12,
        strand: 1,
        color: '#888888',
        metadata: { motifLocationOperator: 'order' },
        subRanges: [
          { start: 0, end: 3, strand: 1 },
          { start: 9, end: 12, strand: 1 },
        ],
      }],
    }]));

    const detail = page.getByRole('button', { name: 'Detail' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
    await page.locator('.motif-cs-feature-block').filter({ hasText: 'ordered CDS' }).first().click();
    await expect.poll(() => page.evaluate(() => window.motifDescribe?.()?.data.selection ?? null)).toBeNull();
    await expect(page.getByRole('group', { name: 'Selection actions' }).getByRole('button', { name: 'New rev comp record' })).toBeDisabled();

    const translation = page.locator('details[data-rail-tool="translation"]');
    if ((await translation.getAttribute('open')) === null) await translation.locator(':scope > summary').click();
    await expect(translation).toContainText('does not assert one materializable sequence');
    await expect(translation.getByRole('button', { name: 'New protein' })).toBeDisabled();

    const annotations = await openAnnotationsEditor(page, 'ordered CDS');
    await expect(annotations.getByRole('button', { name: 'New record' })).toBeDisabled();
    await expect(annotations.getByRole('button', { name: 'New protein' })).toHaveCount(0);

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    if ((await exportPanel.getAttribute('open')) === null) await exportPanel.locator(':scope > summary').click();
    const selectionActions = exportPanel.locator('.motif-cs-export-row').filter({ hasText: 'Selection' });
    await expect(selectionActions.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: 'Complement', exact: true })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: 'Copy rev comp' })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: 'New rev comp' })).toBeDisabled();
    await expect(exportPanel).toContainText('does not assert that the pieces form one materializable sequence');
    await exportPanel.locator('select[name="export-format"]').selectOption('record-genbank');
    await expect(exportPanel.getByLabel('Selected export preview')).toHaveValue(/order\(1\.\.3,10\.\.12\)/);
  });

  test('quarantines a legacy unmarked reverse multipart location', async ({ page }) => {
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'ambiguous-record',
      name: 'Legacy reverse record',
      molecule: 'dna',
      topology: 'linear',
      seq: 'ATGCCCGGGCCATTTAAA',
      annotations: [{
        id: 'ambiguous-cds',
        name: 'legacy reverse CDS',
        type: 'cds',
        start: 0,
        end: 12,
        strand: -1,
        color: '#888888',
        subRanges: [
          { start: 9, end: 12, strand: -1 },
          { start: 0, end: 3, strand: -1 },
        ],
      }],
    }]));

    const detail = page.getByRole('button', { name: 'Detail' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
    await page.locator('.motif-cs-feature-block').filter({ hasText: 'legacy reverse CDS' }).first().click();
    await expect.poll(() => page.evaluate(() => window.motifDescribe?.()?.data.features?.[0])).toMatchObject({
      locationOrder: 'ambiguous-unmarked',
      materializable: false,
    });
    await expect.poll(() => page.evaluate(() => window.motifDescribe?.()?.data.selection ?? null)).toBeNull();

    const inspector = page.locator('details[data-rail-tool="inspector"]');
    if ((await inspector.getAttribute('open')) === null) await inspector.locator(':scope > summary').click();
    await expect(inspector).toContainText('Segment order is ambiguous');

    const translation = page.locator('details[data-rail-tool="translation"]');
    if ((await translation.getAttribute('open')) === null) await translation.locator(':scope > summary').click();
    await expect(translation).toContainText('ambiguous segment order');
    await expect(translation.getByRole('button', { name: 'New protein' })).toBeDisabled();

    const annotations = await openAnnotationsEditor(page, 'legacy reverse CDS');
    await expect(annotations).toContainText('no reliable segment-order marker');
    await expect(annotations.getByRole('button', { name: 'New record' })).toBeDisabled();

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    if ((await exportPanel.getAttribute('open')) === null) await exportPanel.locator(':scope > summary').click();
    await expect(exportPanel.getByRole('button', { name: 'Complement', exact: true })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: 'Copy rev comp' })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: 'New rev comp' })).toBeDisabled();
    await expect(exportPanel).toContainText('Basic GenBank and GFF3 label it non-materializable');
    await exportPanel.locator('select[name="export-format"]').selectOption('record-genbank');
    await expect(exportPanel.getByLabel('Selected export preview')).toHaveValue(/complement\(order\(1\.\.3,10\.\.12\)\)/);
    await exportPanel.locator('select[name="export-format"]').selectOption('record-gff3');
    await expect(exportPanel.getByLabel('Selected export preview')).toHaveValue(/motif_location_operator=ambiguous/);
  });

  test('stores reverse origin-wrap annotations in biological order', async ({ page }) => {
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'circular-record',
      name: 'Circular record',
      molecule: 'dna',
      topology: 'circular',
      seq: 'ATGCCCGGGCCATTTAAA',
    }]));

    const detail = page.getByRole('button', { name: 'Detail' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
    const annotations = await openAnnotationsEditor(page);
    await annotations.locator('input[name="feature-name"]').fill('reverse wrap');
    await annotations.locator('select[name="feature-strand"]').selectOption('-1');
    await annotations.locator('input[name="feature-start"]').fill('16');
    await annotations.locator('input[name="feature-end"]').fill('3');
    await annotations.getByRole('button', { name: 'Add', exact: true }).click();

    await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord?.()?.annotations?.[0].subRanges)).toEqual([
      { start: 0, end: 3, strand: -1 },
      { start: 15, end: 18, strand: -1 },
    ]);
    await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord?.()?.annotations?.[0].metadata)).toMatchObject({
      motifSubRangeOrder: 'biological',
    });
    const featureBlocks = page.locator('.motif-cs-feature-block').filter({ hasText: 'reverse wrap' });
    await expect(featureBlocks).toHaveCount(2);
    await featureBlocks.first().click();
    await expect.poll(() => page.evaluate(() => window.motifDescribe?.()?.data.selection ?? null)).toMatchObject({
      length: 6,
      sequence: 'CATTTT',
    });

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    if ((await exportPanel.getAttribute('open')) === null) await exportPanel.locator(':scope > summary').click();
    await exportPanel.locator('select[name="export-format"]').selectOption('record-genbank');
    await expect(exportPanel.getByLabel('Selected export preview')).toHaveValue(/complement\(join\(16\.\.18,1\.\.3\)\)/);
  });
});
