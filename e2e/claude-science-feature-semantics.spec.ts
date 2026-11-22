import { expect, test, type Page } from '@playwright/test';
import { closeToolsDrawer, openTool, openToolsDrawer, toolDetails } from './tool-panel-aliases';
import { openExportPanel } from './export-panel';
import { openTranslationFromTools } from './tools-drawer';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

async function openAnnotationsEditor(page: Page, featureName?: string) {
  const annotations = await openTool(page, 'annotations');
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
    // Below 1536px the tools are a drawer: open it to see the list, then shut it
    // so each test reaches its tools the way a user does.
    await openToolsDrawer(page);
    await expect(toolDetails(page, 'annotations')).toBeVisible();
    await closeToolsDrawer(page);
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

    const detail = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();

    const featureBlocks = page.locator('.motif-cs-feature-block').filter({ hasText: 'joined CDS' });
    await expect(featureBlocks).toHaveCount(2);
    await featureBlocks.first().click();
    await expect(page.locator('.motif-cs-seq-hl')).toHaveCount(2);
    await expect(page.locator('.motif-cs-selection-bar')).toContainText('6 bp');

    const inspector = await openTool(page, 'inspector');
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

    const translation = await openTranslationFromTools(page);
    await expect(translation.locator('.motif-cs-protein-readout')).toHaveText('MP');
    await expect(translation).toContainText('Motif translated multipart feature segments in biological order.');
    await expect(translation.getByRole('button', { name: 'Pin translation' })).toBeDisabled();

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    await openExportPanel(page);
    const exportFormat = exportPanel.locator('select[name="export-format"]');
    const exportPreview = exportPanel.getByLabel('Export preview');

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
    await annotations.getByRole('button', { name: 'Save feature', exact: true }).first().click();
    expect(await page.evaluate(() => window.motifGetInventory()[0].annotations?.[0].subRanges)).toEqual([
      { start: 0, end: 3, strand: 1 },
      { start: 9, end: 12, strand: 1 },
    ]);

    const countBefore = await page.evaluate(() => window.motifGetInventory().length);
    await annotations.getByRole('button', { name: 'Extract feature' }).click();
    expect(await page.evaluate(() => window.motifGetInventory().length)).toBe(countBefore + 1);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('renamed joined CDS');
    await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord?.()?.seq)).toBe('ATGCCA');
  });

  test('describes raw sequence export receipts independently from FASTA', async ({ page }) => {
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'raw-receipt-record',
      name: 'Raw receipt record',
      molecule: 'dna',
      topology: 'linear',
      seq: 'ACGTACGT',
      annotations: [{
        id: 'raw-receipt-feature',
        name: 'annotation omitted by sequence text',
        type: 'misc_feature',
        start: 1,
        end: 5,
      }],
    }]));
    await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord?.()?.id)).toBe('raw-receipt-record');

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    await openExportPanel(page);
    const exportFormat = exportPanel.locator('select[name="export-format"]');
    const receipt = exportPanel.getByTestId('export-loss-receipt');

    await exportFormat.selectOption('record-sequence');
    await expect(receipt).toContainText('Sequence only.');
    await expect(receipt).not.toContainText('FASTA');

    await exportFormat.selectOption('record-fasta');
    await expect(receipt).toContainText('FASTA has limits.');
  });

  test('lists what a lossy export\'s preservation items are, under the count', async ({ page }) => {
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'loss-items-record',
      name: 'Loss items record',
      molecule: 'dna',
      topology: 'linear',
      seq: 'ACGTACGTACGTACGT',
      annotations: [{
        id: 'loss-items-promoter',
        name: 'Ptest',
        type: 'promoter',
        start: 1,
        end: 10,
        strand: 1,
        metadata: { motifOriginalFeatureKey: 'promoter', motifOriginalLocation: '2..10' },
      }],
    }]));
    await expect.poll(() => page.evaluate(() => window.motifGetActiveRecord?.()?.id)).toBe('loss-items-record');

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    await openExportPanel(page);
    await exportPanel.locator('select[name="export-format"]').selectOption('record-genbank');
    // One heading over the list. The receipt that counted the notes and pointed
    // at them leaves the screen and stays as the status assistive technology hears.
    await expect(exportPanel.getByRole('list', { name: 'Export limits' })).toBeVisible();
    await expect(exportPanel.getByTestId('export-loss-receipt')).toHaveClass(/motif-cs-visually-hidden/);
    await expect(exportPanel.getByTestId('export-loss-receipt')).toContainText('Review 2 export notes.');
    await expect(exportPanel.getByTestId('export-loss-items').locator('li')).toHaveText([
      '1 imported feature key: promoter → regulatory',
      '1 location kept as written: Ptest 2..10',
    ]);
    // A complete checkpoint loses nothing, so it lists nothing and the receipt shows.
    await exportPanel.locator('select[name="export-format"]').selectOption('inventory-json');
    await expect(exportPanel.getByTestId('export-loss-items')).toHaveCount(0);
    await expect(exportPanel.getByTestId('export-loss-receipt')).toHaveClass(/motif-cs-form-note/);
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

    const detail = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
    await page.locator('.motif-cs-feature-block').filter({ hasText: 'frame two CDS' }).first().click();

    const translation = await openTranslationFromTools(page);
    await expect(translation.locator('.motif-cs-protein-readout')).toHaveText('C');
    await expect(translation.getByRole('button', { name: '+2', exact: true })).toHaveAttribute('aria-pressed', 'true');

    const annotations = await openAnnotationsEditor(page, 'frame two CDS');
    await annotations.getByRole('button', { name: 'Create protein' }).click();
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

    const detail = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
    await page.locator('.motif-cs-feature-block').filter({ hasText: 'ordered CDS' }).first().click();
    await expect.poll(() => page.evaluate(() => window.motifDescribe?.()?.data.selection ?? null)).toBeNull();
    await page.getByRole('group', { name: 'Selection actions' }).getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'New reverse complement record' })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    const translation = await openTranslationFromTools(page);
    await expect(translation).toContainText('does not assert one materializable sequence');
    await expect(translation.getByRole('button', { name: 'Create protein' })).toBeDisabled();

    const annotations = await openAnnotationsEditor(page, 'ordered CDS');
    await expect(annotations.getByRole('button', { name: 'Extract feature' })).toBeDisabled();
    await expect(annotations.getByRole('button', { name: 'Create protein' })).toHaveCount(0);

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    await openExportPanel(page);
    const selectionActions = exportPanel.locator('.motif-cs-export-row').filter({ hasText: 'Selection' });
    await expect(selectionActions.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: 'Copy complement', exact: true })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: 'Copy reverse complement' })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: /^Create/ })).toHaveCount(0);
    await expect(page.locator('.motif-cs-selection-bar [role="menuitem"][aria-label="New reverse complement record"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(exportPanel).toContainText('does not assert that the pieces form one materializable sequence');
    await exportPanel.locator('select[name="export-format"]').selectOption('record-genbank');
    await expect(exportPanel.getByLabel('Export preview')).toHaveValue(/order\(1\.\.3,10\.\.12\)/);
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

    const detail = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
    await page.locator('.motif-cs-feature-block').filter({ hasText: 'legacy reverse CDS' }).first().click();
    await expect.poll(() => page.evaluate(() => window.motifDescribe?.()?.data.features?.[0])).toMatchObject({
      locationOrder: 'ambiguous-unmarked',
      materializable: false,
    });
    await expect.poll(() => page.evaluate(() => window.motifDescribe?.()?.data.selection ?? null)).toBeNull();

    const inspector = await openTool(page, 'inspector');
    await expect(inspector).toContainText('Segment order is ambiguous');

    const translation = await openTranslationFromTools(page);
    await expect(translation).toContainText('ambiguous segment order');
    await expect(translation.getByRole('button', { name: 'Create protein' })).toBeDisabled();

    const annotations = await openAnnotationsEditor(page, 'legacy reverse CDS');
    await expect(annotations).toContainText('no reliable segment-order marker');
    await expect(annotations.getByRole('button', { name: 'Extract feature' })).toBeDisabled();

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    await openExportPanel(page);
    await expect(exportPanel.getByRole('button', { name: 'Copy complement', exact: true })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: 'Copy reverse complement' })).toBeDisabled();
    await expect(exportPanel.getByRole('button', { name: /^Create/ })).toHaveCount(0);
    await expect(page.locator('.motif-cs-selection-bar [role="menuitem"][aria-label="New reverse complement record"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(exportPanel).toContainText('Basic GenBank and GFF3 label it non-materializable');
    await exportPanel.locator('select[name="export-format"]').selectOption('record-genbank');
    await expect(exportPanel.getByLabel('Export preview')).toHaveValue(/complement\(order\(1\.\.3,10\.\.12\)\)/);
    await exportPanel.locator('select[name="export-format"]').selectOption('record-gff3');
    await expect(exportPanel.getByLabel('Export preview')).toHaveValue(/motif_location_operator=ambiguous/);
  });

  test('stores reverse origin-wrap annotations in biological order', async ({ page }) => {
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'circular-record',
      name: 'Circular record',
      molecule: 'dna',
      topology: 'circular',
      seq: 'ATGCCCGGGCCATTTAAA',
    }]));

    const detail = page.getByRole('button', { name: 'Show tracks' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
    const annotations = await openAnnotationsEditor(page);
    await annotations.locator('input[name="feature-name"]').fill('reverse wrap');
    await annotations.locator('select[name="feature-strand"]').selectOption('-1');
    await annotations.locator('input[name="feature-start"]').fill('16');
    await annotations.locator('input[name="feature-end"]').fill('3');
    await annotations.locator('.motif-cs-feature-form').getByRole('button', { name: 'Add feature', exact: true }).click();

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
    await openExportPanel(page);
    await exportPanel.locator('select[name="export-format"]').selectOption('record-genbank');
    await expect(exportPanel.getByLabel('Export preview')).toHaveValue(/complement\(join\(16\.\.18,1\.\.3\)\)/);
  });
});
