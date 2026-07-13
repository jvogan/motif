import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildAbiFixture } from './fidelity-fixtures';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const outputDir = path.resolve('output/playwright/resume-20260711-campaign');
const msaCampaignOutputDir = path.resolve('output/playwright/msa-campaign-2-fixed');

test.describe('Claude Science artifact campaign', () => {
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
  });

  test.afterEach(async ({ page }) => {
    expect(pageDiagnostics.get(page) ?? []).toEqual([]);
  });

  test.beforeAll(async () => {
    await mkdir(outputDir, { recursive: true });
    await mkdir(msaCampaignOutputDir, { recursive: true });
  });

  async function openArtifact(page: Page, width = 1440, height = 1000) {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    const pUC19 = page.locator('.motif-cs-record-tab').filter({ hasText: 'pUC19' }).first();
    if ((await pUC19.getAttribute('data-active')) !== 'true') await pUC19.click();
  }

  async function ensureDetailMode(page: Page) {
    const detail = page.getByRole('button', { name: 'Detail' }).first();
    if ((await detail.getAttribute('data-active')) !== 'true') await detail.click();
  }

  test('restriction detail marks and Hide/Show sites remain reversible', async ({ page }) => {
    await openArtifact(page);
    await ensureDetailMode(page);

    const restrictionLabels = page.locator('.motif-cs-restriction-label');
    await expect(restrictionLabels.first()).toBeVisible();
    const visibleBefore = await restrictionLabels.count();
    expect(visibleBefore).toBeGreaterThan(0);
    const restrictionNames = await restrictionLabels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    expect(restrictionNames.every((name) => name?.includes(' bp, cut'))).toBe(true);
    expect(new Set(restrictionNames).size).toBe(restrictionNames.length);
    const lacZSegments = page.locator('.motif-cs-feature-block').filter({ hasText: 'lacZ-alpha' });
    const lacZNames = await lacZSegments.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    expect(lacZNames.every((name) => name?.includes('segment'))).toBe(true);
    expect(new Set(lacZNames).size).toBe(lacZNames.length);
    await expect(page.locator('.motif-cs-seq-cut')).toHaveCount(0);

    const ordinaryLabel = page.locator('.motif-cs-restriction-label:not([data-type-iis="true"])').first();
    const ordinaryLabelBox = (await ordinaryLabel.boundingBox())!;
    expect(ordinaryLabelBox.width).toBeGreaterThanOrEqual(12);
    expect(ordinaryLabelBox.height).toBeGreaterThanOrEqual(12);
    await ordinaryLabel.hover();
    await expect(page.locator('.motif-cs-seq-cut')).not.toHaveCount(0);
    await page.mouse.move(2, 2);
    await expect(page.locator('.motif-cs-seq-cut')).toHaveCount(0);

    const mapVisibility = page.locator('details').filter({ hasText: 'Map visibility' }).first();
    if (!(await mapVisibility.getAttribute('open'))) await mapVisibility.locator('summary').click();

    await page.getByRole('button', { name: 'Hide sites' }).click();
    await expect(restrictionLabels).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show sites' })).toBeEnabled();

    await page.getByRole('button', { name: 'Show sites' }).click();
    await expect(restrictionLabels.first()).toBeVisible();
    await ordinaryLabel.click();
    await page.mouse.move(2, 2);
    await expect(page.locator('.motif-cs-seq-cut')).not.toHaveCount(0);
    await expect(page.locator('.motif-cs-seq-hl-restriction')).not.toHaveCount(0);

    await page.screenshot({ path: path.join(outputDir, 'restriction-detail-light.png'), fullPage: true });
  });

  test('Type IIS labels reveal the correct staggered cut bonds on hover and selection', async ({ page }) => {
    await openArtifact(page);
    await ensureDetailMode(page);

    const typeIISLabel = page.locator('.motif-cs-restriction-label[data-type-iis="true"]').filter({ hasText: /BsmBI|Esp3I/ }).first();
    await expect(typeIISLabel).toBeVisible();
    const position = Number(await typeIISLabel.getAttribute('data-site-position'));
    const recognitionLength = Number(await typeIISLabel.getAttribute('data-recognition-length'));
    const strand = Number(await typeIISLabel.getAttribute('data-site-strand'));

    await typeIISLabel.hover();
    const cutBonds = await page.locator('.motif-cs-seq-cut').evaluateAll((nodes) => (
      [...new Set(nodes.map((node) => Number((node as HTMLElement).dataset.cutBond)))].sort((a, b) => a - b)
    ));
    const expected = strand === -1
      ? [position + recognitionLength - 11, position + recognitionLength - 7]
      : [position + 7, position + 11];
    expect(cutBonds).toEqual(expected.sort((a, b) => a - b));
    expect(Math.abs(cutBonds[1] - cutBonds[0])).toBe(4);

    await typeIISLabel.click();
    await page.mouse.move(2, 2);
    await expect(page.locator('.motif-cs-seq-cut')).not.toHaveCount(0);
  });

  test('feature selection exposes immediate AA deletion without duplicating tracks', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    await ensureDetailMode(page);
    const feature = page.locator('.motif-cs-feature-block').filter({ hasText: 'lacZ-alpha' }).first();
    await feature.click();
    await expect(page.getByRole('button', { name: 'Del AA' })).toBeEnabled();

    await page.locator('.motif-cs-restriction-label').first().click();
    await expect(page.getByRole('button', { name: 'Add AA' })).toBeDisabled();

    await feature.click();
    await expect(page.getByRole('button', { name: 'Del AA' })).toBeEnabled();

    const tracksBefore = await page.locator('.motif-cs-aa-track').count();
    await page.getByRole('button', { name: 'Del AA' }).click();
    const tracksAfter = await page.locator('.motif-cs-aa-track').count();
    expect(tracksAfter).toBeLessThan(tracksBefore);
  });

  test('off-page map selections remain visible in bounded annotation lists', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'paged-annotations',
      name: 'Paged annotations',
      molecule: 'dna',
      topology: 'circular',
      seq: 'ATG'.repeat(2_000),
      annotations: Array.from({ length: 130 }, (_, index) => ({
        id: `feature-${index}`,
        name: `Feature ${index + 1}`,
        type: 'cds',
        start: index * 30,
        end: index * 30 + 24,
        strand: 1,
      })),
    }]));

    const offPageFeature = page.locator('.motif-pm-feature[data-feature-id="feature-125"]');
    const selectedFeatureName = (await offPageFeature.getAttribute('aria-label'))!.split(',')[0];
    // Dense circular features overlap at this scale; dispatch to the target node
    // so this regression isolates list paging rather than SVG hit ordering.
    await offPageFeature.dispatchEvent('click');
    const annotationsPanel = page.locator('details[data-rail-tool="annotations"]');
    if (!(await annotationsPanel.getAttribute('open'))) await annotationsPanel.locator(':scope > summary').click();

    const featureRows = annotationsPanel.locator('.motif-cs-feature-annotation-list > .motif-cs-row');
    const translationRows = annotationsPanel.locator('.motif-cs-translation-row-shell');
    expect(await featureRows.count()).toBe(121);
    expect(await translationRows.count()).toBe(121);
    await expect(featureRows.filter({ hasText: selectedFeatureName })).toHaveAttribute('data-active', 'true');
    await expect(translationRows.filter({ hasText: selectedFeatureName })).toHaveAttribute('data-active', 'true');
    await expect(annotationsPanel.getByRole('button', { name: /Show 10 more features/ })).toBeVisible();
    await expect(annotationsPanel.getByRole('button', { name: /Show 10 more translations/ })).toBeVisible();
  });

  test('long import errors wrap inside the Add Entry popover', async ({ page }) => {
    await openArtifact(page, 640, 700);
    await page.getByRole('button', { name: 'Add entry' }).click();
    const importPanel = page.locator('.motif-cs-import-panel[open]');
    await importPanel.getByLabel('Sequence import input').fill([
      'LOCUS       TRUNCATED       100 bp    DNA     linear   SYN 01-JAN-2026',
      'DEFINITION  Incomplete test record.',
      'ORIGIN',
      '        1 gaattc',
    ].join('\n'));
    await importPanel.getByRole('button', { name: 'Add / restore' }).click();
    const status = importPanel.locator('.motif-cs-import-status');
    await expect(status).toContainText(/truncated|complete|length/i);
    const geometry = await importPanel.evaluate((panel) => {
      const panelRect = panel.getBoundingClientRect();
      const statusElement = panel.querySelector<HTMLElement>('.motif-cs-import-status')!;
      const statusRect = statusElement.getBoundingClientRect();
      const statusStyle = getComputedStyle(statusElement);
      return {
        clientWidth: panel.clientWidth,
        scrollWidth: panel.scrollWidth,
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        statusLeft: statusRect.left,
        statusRight: statusRect.right,
        whiteSpace: statusStyle.whiteSpace,
      };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.statusLeft).toBeGreaterThanOrEqual(geometry.panelLeft - 1);
    expect(geometry.statusRight).toBeLessThanOrEqual(geometry.panelRight + 1);
    expect(geometry.whiteSpace).toBe('normal');
  });

  test('Add Entry rejects an invalid FASTA batch atomically and preserves the draft', async ({ page }) => {
    await openArtifact(page, 820, 700);
    const inventoryCountBefore = await page.evaluate(() => window.motifGetInventory().length);
    const longHeader = `>${'x'.repeat(1_100)}\nATGC\n>valid-second-record\nATGC`;

    await page.getByRole('button', { name: 'Add entry' }).click();
    const importPanel = page.locator('.motif-cs-import-panel[open]');
    const input = importPanel.getByLabel('Sequence import input');
    await input.fill(longHeader);
    await importPanel.getByRole('button', { name: 'Add / restore' }).click();

    await expect(importPanel).toHaveAttribute('open', '');
    await expect(input).toHaveValue(longHeader);
    await expect(importPanel.locator('.motif-cs-import-status')).toHaveText('0 records added');
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText(/resource limits|No records were added/i);
    expect(await page.evaluate(() => window.motifGetInventory().length)).toBe(inventoryCountBefore);
  });

  test('Add Entry accepts an ordinary valid FASTA record atomically', async ({ page }) => {
    await openArtifact(page, 820, 700);
    const inventoryCountBefore = await page.evaluate(() => window.motifGetInventory().length);

    await page.getByRole('button', { name: 'Add entry' }).click();
    const importPanel = page.locator('.motif-cs-import-panel');
    await importPanel.getByLabel('Sequence import input').fill(
      '>Wave3 Enzyme Probe\nAAAACCGGTCTCAAAATTTTCGTCTCGGGGAAAACCGAGACCAAAA',
    );
    await importPanel.getByRole('button', { name: 'Add / restore' }).click();

    await expect(importPanel).not.toHaveAttribute('open', '');
    expect(await page.evaluate(() => window.motifGetInventory().length)).toBe(inventoryCountBefore + 1);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('Wave3 Enzyme Probe');
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');
  });

  test('feature extraction and full or selected reverse complements create valid records', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    await ensureDetailMode(page);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();
    const inventoryCountBefore = await page.evaluate(() => window.motifGetInventory().length);
    const pUC19 = page.locator('.motif-cs-record-tab').filter({ hasText: 'pUC19' }).first();
    const feature = page.locator('.motif-cs-feature-block').filter({ hasText: 'lacZ-alpha' }).first();
    const annotationsPanel = page.locator('details[data-rail-tool="annotations"]');
    await expect(annotationsPanel).toHaveAttribute('open', '');
    const featureRow = annotationsPanel.locator('.motif-cs-feature-annotation-list > .motif-cs-row').filter({ hasText: 'lacZ-alpha' });

    await featureRow.click();
    await expect(annotationsPanel.locator('.motif-cs-annotation-editor-drawer')).toHaveAttribute('open', '');
    const featureStart = annotationsPanel.getByLabel('Start');
    const featureEnd = annotationsPanel.getByLabel('End');
    await featureStart.fill('600');
    await featureEnd.fill('500');
    await expect(featureStart).toHaveAttribute('aria-invalid', 'true');
    await expect(featureStart).toHaveAttribute('aria-describedby', 'motif-cs-feature-range-error');
    await expect(annotationsPanel.locator('#motif-cs-feature-range-error')).toBeVisible();
    await featureStart.fill('150');
    await featureEnd.fill('506');
    await annotationsPanel.getByRole('button', { name: 'New record' }).click();
    expect(await page.evaluate(() => window.motifGetInventory().length)).toBe(inventoryCountBefore + 1);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('lacZ-alpha');

    await pUC19.click();
    await page.getByRole('button', { name: 'Reverse complement', exact: true }).click();
    expect(await page.evaluate(() => window.motifGetInventory().length)).toBe(inventoryCountBefore + 2);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('reverse complement');

    await pUC19.click();
    await feature.click();
    await page.getByRole('button', { name: 'Reverse complement', exact: true }).click();
    expect(await page.evaluate(() => window.motifGetInventory().length)).toBe(inventoryCountBefore + 3);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('reverse complement');
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');
  });

  test('selection Feature opens a prefilled editor and mutates only after explicit Add', async ({ page }) => {
    await openArtifact(page, 1180, 860);
    const before = await page.evaluate(() => window.motifGetInventory?.()[0]?.annotations?.length ?? 0);
    const sequence = page.locator('.motif-cs-sequence');
    await sequence.focus();
    for (let index = 0; index < 9; index += 1) await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText('1-9 (9)');

    await page.locator('.motif-cs-selection-actions').getByRole('button', { name: '+ Feature' }).click();
    const annotations = page.locator('details[data-rail-tool="annotations"]');
    await expect(annotations).toHaveAttribute('open', '');
    await expect(annotations.locator('.motif-cs-annotation-editor-drawer')).toHaveAttribute('open', '');
    await expect(annotations.locator('input[name="feature-name"]')).toBeFocused();
    await expect(annotations.getByLabel('Start')).toHaveValue('1');
    await expect(annotations.getByLabel('End')).toHaveValue('9');
    expect(await page.evaluate(() => window.motifGetInventory?.()[0]?.annotations?.length ?? 0)).toBe(before);

    await annotations.locator('input[name="feature-name"]').fill('Explicit first-use feature');
    await annotations.getByRole('button', { name: 'Add', exact: true }).click();
    expect(await page.evaluate(() => window.motifGetInventory?.()[0]?.annotations?.length ?? 0)).toBe(before + 1);
    await expect(annotations).toContainText('Explicit first-use feature');
  });

  test('Entry Details deletes one record with confirmation and preserves the actual selected survivor', async ({ page }) => {
    await openArtifact(page, 820, 760);
    await page.evaluate(() => {
      window.motifRenderInventory?.([
        { id: 'keep-record', name: 'Keep record', molecule: 'dna', topology: 'linear', seq: 'AACCGGTT' },
        { id: 'delete-record', name: 'Mistaken duplicate', molecule: 'dna', topology: 'linear', seq: 'AACCGGTA' },
        { id: 'next-record', name: 'Next record', molecule: 'dna', topology: 'linear', seq: 'AACCGGTC' },
      ]);
      window.motifAddNotes?.({
        id: 'delete-record-note',
        title: 'Linked note',
        body: 'This note belongs to the mistaken duplicate.',
        format: 'plain',
        scope: 'record',
        recordId: 'delete-record',
        createdAt: '2026-07-12T20:00:00.000Z',
        updatedAt: '2026-07-12T20:00:00.000Z',
      });
    });
    await page.locator('.motif-cs-record-tab').filter({ hasText: 'Mistaken duplicate' }).click();
    expect(await page.evaluate(() => window.motifRemoveRecords?.('keep-record'))).toBe(1);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('Mistaken duplicate');

    const entry = page.locator('details[data-rail-tool="entry"]');
    await entry.locator(':scope > summary').click();
    await expect(entry).toContainText('Also removes linked notes, alignments, and saved results.');
    await entry.getByRole('button', { name: 'Delete entry Mistaken duplicate' }).click();
    await expect(entry.getByRole('button', { name: 'Confirm delete entry Mistaken duplicate' })).toBeVisible();
    expect(await page.evaluate(() => window.motifGetInventory?.().length)).toBe(2);

    await entry.getByRole('button', { name: 'Confirm delete entry Mistaken duplicate' }).click();
    expect(await page.evaluate(() => window.motifGetInventory?.().map((record) => record.name))).toEqual(['Next record']);
    expect(await page.evaluate(() => window.motifGetNotes?.().length)).toBe(0);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('Next record');
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toBeFocused();
  });

  test('deleting an entry forgets its edit and range state before the same id is imported again', async ({ page }) => {
    await openArtifact(page, 820, 760);
    await page.evaluate(() => window.motifRenderInventory?.([
      { id: 'reused-record', name: 'Original record', molecule: 'dna', topology: 'linear', seq: 'AAAAAAAA' },
    ]));

    const bases = page.locator('.motif-cs-seq-bases').first();
    await bases.click({ position: { x: 3, y: 10 } });
    await page.keyboard.press('C');
    await page.keyboard.press('Shift+End');
    expect(await page.evaluate(() => window.motifGetInventory?.()[0]?.seq)).toBe('CAAAAAAA');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.locator('.motif-cs-selection-name')).not.toHaveText('No range selected');

    const entry = page.locator('details[data-rail-tool="entry"]');
    await entry.locator(':scope > summary').click();
    await entry.getByRole('button', { name: 'Delete entry Original record' }).click();
    await entry.getByRole('button', { name: 'Confirm delete entry Original record' }).click();
    await expect.poll(() => page.evaluate(() => window.motifGetInventory?.().length)).toBe(0);

    expect(await page.evaluate(() => window.motifAddRecords?.({
      id: 'reused-record',
      name: 'Fresh import',
      molecule: 'dna',
      topology: 'linear',
      seq: 'CCCC',
    }))).toBe(1);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('Fresh import');
    expect(await page.evaluate(() => window.motifGetInventory?.()[0]?.seq)).toBe('CCCC');
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(page.locator('.motif-cs-selection-name')).toHaveText('No range selected');
  });

  test('custom recognition motifs use one coherent centered blunt cut', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'wave3-enzyme-probe',
      name: 'Wave3 Enzyme Probe',
      molecule: 'dna',
      topology: 'linear',
      seq: 'AAAACCGGTCTCAAAATTTTCGTCTCGGGGAAAACCGAGACCAAAA',
    }]));

    const mapVisibility = page.locator('details').filter({ hasText: 'Map visibility' }).first();
    if (!(await mapVisibility.getAttribute('open'))) await mapVisibility.locator(':scope > summary').click();
    const enzymeName = mapVisibility.getByLabel('Known or custom enzyme name');
    const enzymeRecognition = mapVisibility.getByLabel('Custom enzyme recognition sequence');
    await enzymeName.fill('Wave3I');
    await mapVisibility.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(enzymeName).toHaveAttribute('aria-invalid', 'true');
    await expect(enzymeRecognition).toHaveAttribute('aria-describedby', 'motif-cs-add-enzyme-status');
    await expect(mapVisibility.locator('#motif-cs-add-enzyme-status')).toContainText('recognition sequence');
    await enzymeRecognition.fill('TTTTCG');
    await mapVisibility.getByRole('button', { name: 'Add', exact: true }).click();

    const customSite = mapVisibility.locator('.motif-cs-restriction-site-row').filter({ hasText: 'Wave3I' });
    await expect(customSite).toHaveCount(1);
    await expect(customSite).toContainText('17 · cut 20 · blunt');
    await expect(customSite).toHaveAttribute('aria-pressed', 'false');
    await customSite.click();
    await expect(customSite).toHaveAttribute('aria-pressed', 'true');

    const digest = page.locator('details').filter({ hasText: 'Digest Preview' }).first();
    await digest.locator(':scope > summary').click();
    await digest.getByLabel('Digest enzymes').fill('Wave3I');
    const fragments = digest.locator('.motif-cs-analysis-row-button');
    await expect(fragments).toHaveCount(2);
    await expect(fragments.first()).toContainText('19 bp · 1-19');
    await expect(fragments.first()).toContainText('Blunt');
  });

  test('Map Visibility filters long restriction site and enzyme lists without changing visibility', async ({ page }) => {
    await openArtifact(page, 820, 760);
    const mapVisibility = page.locator('details').filter({ hasText: 'Map Visibility' }).first();
    await mapVisibility.locator(':scope > summary').click();
    const filter = mapVisibility.getByRole('searchbox', { name: 'Filter restriction sites and enzymes' });
    const visibleBefore = await mapVisibility.locator('.motif-cs-restriction-row input:checked').count();

    await filter.fill('EcoRI');
    const siteRows = mapVisibility.locator('.motif-cs-restriction-site-row');
    await expect(siteRows).toHaveCount(1);
    await expect(siteRows.first()).toContainText('EcoRI');
    await expect(mapVisibility.locator('.motif-cs-restriction-row')).toHaveCount(1);
    await expect(mapVisibility.locator('.motif-cs-restriction-row')).toContainText('EcoRI');

    await filter.fill('does-not-exist');
    await expect(mapVisibility).toContainText('No visible sites match this filter.');
    await expect(mapVisibility).toContainText('No enzymes match this filter.');
    await filter.fill('');
    expect(await mapVisibility.locator('.motif-cs-restriction-row input:checked').count()).toBe(visibleBefore);
  });

  test('digest recipes reject unknown enzymes and survive map-source changes', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const digest = page.locator('details').filter({ hasText: 'Digest Preview' }).first();
    await digest.locator(':scope > summary').click();
    const enzymeInput = digest.getByRole('combobox', { name: 'Digest enzymes' });

    await enzymeInput.fill('DefinitelyNotEnzyme');
    await expect(enzymeInput).toHaveAttribute('aria-invalid', 'true');
    await expect(digest.getByRole('alert')).toContainText('Unknown restriction enzyme');
    await expect(digest.getByRole('button', { name: 'Copy table' })).toBeDisabled();
    await expect(digest.locator('.motif-cs-analysis-row-button')).toHaveCount(0);

    await enzymeInput.fill('EcoRI');
    await expect(enzymeInput).toHaveAttribute('aria-invalid', 'false');
    await expect(digest.locator(':scope > summary')).toContainText('1 cut · linearized');
    await expect(digest.getByTestId('digest-save')).toHaveText('Save linearized copy');

    const mapVisibility = page.locator('details').filter({ hasText: 'Map Visibility' }).first();
    await mapVisibility.locator(':scope > summary').click();
    await mapVisibility.getByRole('button', { name: /Full list .*154 enz/ }).click();
    await digest.locator(':scope > summary').click();
    await expect(enzymeInput).toHaveValue('EcoRI');
    await expect(digest.locator(':scope > summary')).toContainText('1 cut · linearized');
  });

  test('digest drafts persist by record and uncut recipes do not show a fake fragment', async ({ page }) => {
    await openArtifact(page, 820, 760);
    const digest = page.locator('details').filter({ hasText: 'Digest Preview' }).first();
    await digest.locator(':scope > summary').click();
    const enzymeInput = digest.getByRole('combobox', { name: 'Digest enzymes' });
    await enzymeInput.fill('NdeI');
    await expect(digest.locator('.motif-cs-digest-scope')).toContainText('Whole record · pUC19');

    await page.getByRole('tab', { name: 'pBR322' }).click();
    if ((await digest.getAttribute('open')) === null) await digest.locator(':scope > summary').click();
    await enzymeInput.fill('BamHI');
    await page.getByRole('tab', { name: 'pUC19' }).click();
    if ((await digest.getAttribute('open')) === null) await digest.locator(':scope > summary').click();
    await expect(enzymeInput).toHaveValue('NdeI');

    await page.evaluate(() => window.motifRenderInventory?.([{
      id: 'uncut-source',
      name: 'Uncut source',
      molecule: 'dna',
      topology: 'linear',
      seq: 'AAAAAAAAAAAAAA',
    }]));
    if ((await digest.getAttribute('open')) === null) await digest.locator(':scope > summary').click();
    await enzymeInput.fill('EcoRI');
    await expect(digest).toContainText('No cut sites found.');
    await expect(digest.locator('.motif-cs-analysis-row-button')).toHaveCount(0);
    await expect(digest.getByTestId('digest-save')).toHaveText('Save result');
  });

  test('digest fragments save atomically with end chemistry and durable workflow history', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    await page.evaluate(() => window.motifRenderInventory?.([{
      id: 'digest-source',
      name: 'Digest source',
      molecule: 'dna',
      topology: 'linear',
      seq: 'AAAAGAATTCAAAA',
      active: true,
    }]));

    const digest = page.locator('details').filter({ hasText: 'Digest Preview' }).first();
    await digest.locator(':scope > summary').click();
    await digest.getByRole('combobox', { name: 'Digest enzymes' }).fill('EcoRI');
    await expect(digest.locator(':scope > summary')).toContainText('2 fragments');
    await digest.getByTestId('digest-save').click();
    await expect(digest.locator('.motif-cs-digest-save-status')).toContainText('Saved 2 fragments');
    await expect(digest.getByTestId('digest-save')).toBeDisabled();
    await expect(digest.getByTestId('digest-save')).toHaveText('Saved');

    const saved = await page.evaluate(() => ({
      records: window.motifGetInventory?.(),
      workflows: window.motifGetWorkflowResults?.(),
    }));
    expect(saved.records).toHaveLength(3);
    expect(saved.records?.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        topology: 'linear',
        overhang3: 'AATT',
        overhang3Type: '5prime',
        provenance: expect.objectContaining({ operation: 'restriction_digest' }),
      }),
      expect.objectContaining({
        topology: 'linear',
        overhang5: 'AATT',
        overhang5Type: '5prime',
        provenance: expect.objectContaining({ operation: 'restriction_digest' }),
      }),
    ]));
    expect(saved.workflows).toEqual([
      expect.objectContaining({
        kind: 'digest',
        inputRecordIds: ['digest-source'],
        outputRecordIds: expect.arrayContaining(saved.records!.slice(1).map((record) => record.id!)),
      }),
    ]);

    const history = page.locator('details[data-rail-tool="workflows"]');
    await history.locator(':scope > summary').click();
    await expect(history.getByTestId('workflow-result-list')).toContainText('EcoRI digest of Digest source');
    await history.getByRole('button', { name: 'Reveal output', exact: true }).click();

    const entry = page.locator('details[data-rail-tool="entry"]');
    await entry.locator(':scope > summary').click();
    await expect(entry.locator('.motif-cs-record-ends')).toContainText(/Left end|Right end/);
    await expect(entry.locator('.motif-cs-record-ends')).toContainText(/blunt|AATT/);

    await history.locator(':scope > summary').click();
    await history.getByRole('button', { name: /Remove EcoRI digest of Digest source/ }).click();
    await history.getByRole('button', { name: 'Remove result' }).click();
    expect(await page.evaluate(() => window.motifGetWorkflowResults?.().length)).toBe(0);
    expect(await page.evaluate(() => window.motifGetInventory?.().length)).toBe(3);
  });

  test('cloning campaign: Save & open gel persists once and produces a configurable saved gel result', async ({ page }) => {
    await openArtifact(page, 1440, 900);
    await page.evaluate(() => window.motifRenderInventory?.([
      {
        id: 'gel-digest-source',
        name: 'Gel digest source',
        molecule: 'dna',
        topology: 'linear',
        seq: 'AAAAGAATTCAAAA',
        active: true,
      },
      {
        id: 'gel-comparator',
        name: 'Linear comparator',
        molecule: 'dna',
        topology: 'linear',
        seq: 'ATGCGTACGTAGCTAGCTAGCTAA',
      },
    ]));

    const digest = page.locator('details').filter({ hasText: 'Digest Preview' }).first();
    await digest.locator(':scope > summary').click();
    await digest.getByRole('combobox', { name: 'Digest enzymes' }).fill('EcoRI');
    await expect(digest.locator(':scope > summary')).toContainText('2 fragments');
    await digest.getByTestId('digest-open-gel').click();

    const gelWorkspace = page.getByTestId('gel-workspace');
    const gelWindow = page.getByRole('dialog', { name: 'Gel Preview' });
    await expect(gelWindow).toBeVisible();
    await expect(gelWorkspace.getByTestId('gel-digest-sources').getByRole('checkbox')).toBeChecked();
    await expect(gelWorkspace).toContainText('1 of 12 lanes');
    await expect(gelWorkspace).toContainText('1 sample lane');

    const afterOpen = await page.evaluate(() => ({
      recordCount: window.motifGetInventory?.().length,
      workflows: window.motifGetWorkflowResults?.().map((result) => ({ id: result.id, kind: result.kind })),
    }));
    expect(afterOpen.recordCount).toBe(4);
    expect(afterOpen.workflows).toHaveLength(1);
    expect(afterOpen.workflows?.[0].kind).toBe('digest');
    await expect(page.locator('.motif-cs-workbench-notice:visible')).toHaveCount(0);

    const header = gelWindow.locator('.motif-cs-window-head');
    const beforeMove = (await header.boundingBox())!;
    await header.focus();
    await header.press('Alt+ArrowRight');
    const afterMove = (await header.boundingBox())!;
    expect(afterMove.x).toBeGreaterThanOrEqual(beforeMove.x + 9);

    await gelWindow.getByRole('button', { name: 'Collapse Gel Preview' }).click();
    await expect(gelWindow).toHaveAttribute('data-collapsed', 'true');
    await expect(gelWorkspace).toHaveCount(0);
    await gelWindow.getByRole('button', { name: 'Expand Gel Preview' }).click();
    await expect(gelWorkspace).toBeVisible();

    await gelWorkspace.getByTestId('gel-record-sources').getByRole('checkbox', { name: /Linear comparator/ }).check();
    await gelWorkspace.getByRole('radio', { name: '100 bp' }).check();
    await gelWorkspace.getByRole('slider', { name: 'Agarose percentage' }).fill('1.8');
    await gelWorkspace.getByRole('textbox', { name: 'Result name' }).fill('EcoRI comparison gel');
    await expect(gelWorkspace).toContainText('2 sample lanes');
    await expect(gelWorkspace.getByTestId('gel-plate')).toBeVisible();

    await gelWorkspace.getByTestId('gel-save-result').click();
    await expect(gelWorkspace.getByTestId('gel-save-result')).toBeDisabled();
    await expect(gelWorkspace.getByTestId('gel-save-result')).toHaveText('Saved');
    await expect(gelWorkspace.locator('.motif-cs-gel-status')).toHaveText('Gel result saved in Workflow Results.');
    await expect(page.getByText('Gel result saved in Workflow Results.', { exact: true })).toHaveCount(1);
    await expect(page.locator('.motif-cs-workbench-notice:visible')).toHaveCount(0);

    const afterSave = await page.evaluate(() => window.motifGetWorkflowResults?.().map((result) => ({
      kind: result.kind,
      name: result.name,
      inputRecordIds: result.inputRecordIds,
      inputSha256s: result.inputSha256s,
      parameters: result.parameters,
    })));
    expect(afterSave).toHaveLength(2);
    expect(afterSave?.map((result) => result.kind)).toEqual(['digest', 'gel']);
    expect(afterSave?.[1]).toMatchObject({
      kind: 'gel',
      name: 'EcoRI comparison gel',
      inputSha256s: [expect.stringMatching(/^[0-9a-f]{64}$/), expect.stringMatching(/^[0-9a-f]{64}$/)],
      parameters: expect.objectContaining({ ladderPreset: '100bp', agarosePercent: 1.8 }),
    });

    await gelWindow.getByRole('button', { name: 'Close Gel Preview' }).click();
    const history = page.locator('details[data-rail-tool="workflows"]');
    await history.locator(':scope > summary').click();
    await expect(history.getByTestId('workflow-result-list').locator('.motif-cs-workflow-row')).toHaveCount(2);
    await expect(history).toContainText('EcoRI digest of Gel digest source');
    await expect(history).toContainText('EcoRI comparison gel');
  });

  test('phone gel setup exposes an explicit jump to the below-fold preview', async ({ page }) => {
    await openArtifact(page, 390, 760);
    const digest = page.locator('details').filter({ hasText: 'Digest Preview' }).first();
    await digest.locator(':scope > summary').click();
    await digest.getByTestId('digest-open-gel').click();

    const gel = page.getByTestId('gel-workspace');
    const layout = gel.locator('.motif-cs-gel-workspace-layout');
    const preview = gel.locator('.motif-cs-gel-preview-column');
    const before = await Promise.all([layout.boundingBox(), preview.boundingBox()]);
    expect(before[0]).toBeTruthy();
    expect(before[1]!.y).toBeGreaterThanOrEqual(before[0]!.y + before[0]!.height);

    await gel.getByRole('button', { name: 'View preview ↓' }).click();
    await expect.poll(() => layout.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(preview).toBeFocused();
    const after = await Promise.all([layout.boundingBox(), preview.boundingBox()]);
    expect(after[1]!.y).toBeGreaterThanOrEqual(after[0]!.y - 1);
    expect(after[1]!.y).toBeLessThan(after[0]!.y + after[0]!.height);
  });

  test('digest saved state follows durable history across recipes, removal, and restore', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    await page.evaluate(() => window.motifRenderInventory?.([{
      id: 'durable-digest-source',
      name: 'Durable digest source',
      molecule: 'dna',
      topology: 'linear',
      seq: 'AAAAGAATTCAAAA',
      active: true,
    }]));

    const digest = page.locator('details').filter({ hasText: 'Digest Preview' }).first();
    await digest.locator(':scope > summary').click();
    const enzymes = digest.getByRole('combobox', { name: 'Digest enzymes' });
    const save = digest.getByTestId('digest-save');

    await enzymes.fill('EcoRI');
    await save.click();
    await expect(save).toBeDisabled();
    await expect(save).toHaveText('Saved');
    const ecoResultId = await page.evaluate(() => window.motifGetWorkflowResults?.()[0]?.id);

    await enzymes.fill('BamHI');
    await expect(save).toBeEnabled();
    await expect(save).toHaveText('Save result');
    await save.click();
    expect(await page.evaluate(() => window.motifGetWorkflowResults?.().length)).toBe(2);

    await enzymes.fill('EcoRI');
    await expect(save).toBeDisabled();
    await expect(save).toHaveText('Saved');
    const backup = await page.evaluate(() => {
      const workspace = window.motifGetWorkspace?.() as {
        workflowResults?: Array<{ inputSha256s?: string[] }>;
      } | undefined;
      workspace?.workflowResults?.forEach((result) => {
        if (result.inputSha256s) result.inputSha256s = result.inputSha256s.map((value) => value.toUpperCase());
      });
      return workspace;
    });

    await page.evaluate((resultId) => window.motifRemoveWorkflowResults?.(resultId as string), ecoResultId);
    await expect(save).toBeEnabled();
    await expect(save).toHaveText('Save 2 fragments');

    await page.evaluate((workspace) => window.motifReplaceWorkspace?.(workspace as never), backup);
    await expect(save).toBeDisabled();
    await expect(save).toHaveText('Saved');
    expect(await page.evaluate(() => window.motifGetWorkflowResults?.().length)).toBe(2);
  });

  test('cloning campaign: blocked plans stay honest and a valid BsaI product saves atomically once', async ({ page }) => {
    await openArtifact(page, 1440, 900);
    const cloning = page.locator('details[data-rail-tool="cloning"]');
    await cloning.locator(':scope > summary').click();
    await cloning.getByTestId('open-assembly-workspace').click();

    let assembly = page.getByTestId('assembly-workspace');
    let assemblyWindow = page.locator('.motif-cs-window').filter({ has: assembly });
    await expect(assemblyWindow).toBeVisible();
    await expect(assembly.getByTestId('assembly-plan-status')).toHaveAttribute('data-state', 'blocked');
    await expect(assembly.getByTestId('assembly-save-product')).toBeDisabled();
    await expect(assembly.getByTestId('assembly-save-result')).toHaveText('Save blocked result');

    await assemblyWindow.getByRole('button', { name: 'Maximize Cloning Workspace' }).click();
    await expect(assemblyWindow).toHaveAttribute('data-maximized', 'true');
    const maximized = (await assemblyWindow.boundingBox())!;
    expect(maximized.width).toBeGreaterThanOrEqual(1420);
    expect(maximized.height).toBeGreaterThanOrEqual(880);
    await assemblyWindow.getByRole('button', { name: 'Restore Cloning Workspace' }).click();
    await expect(assemblyWindow).not.toHaveAttribute('data-maximized', 'true');
    await assemblyWindow.getByRole('button', { name: 'Close Cloning Workspace' }).click();

    await page.evaluate(() => window.motifRenderInventory?.([
      {
        id: 'gg-promoter',
        name: 'Reporter promoter',
        molecule: 'dna',
        topology: 'linear',
        seq: 'GGTCTCNAAAACCCCGATGNGAGACC',
        active: true,
      },
      {
        id: 'gg-backbone',
        name: 'Reporter backbone',
        molecule: 'dna',
        topology: 'linear',
        seq: 'GGTCTCNGATGGGGGAAAANGAGACC',
      },
    ]));

    await cloning.locator(':scope > summary').click();
    await cloning.getByTestId('open-assembly-workspace').click();
    assembly = page.getByTestId('assembly-workspace');
    assemblyWindow = page.locator('.motif-cs-window').filter({ has: assembly });
    await expect(assemblyWindow).toBeVisible();
    await expect(assembly.getByLabel('Part 1')).toHaveValue('gg-promoter');
    await expect(assembly.getByLabel('Part 2')).toHaveValue('gg-backbone');
    await expect(assembly.getByTestId('assembly-plan-status')).toHaveAttribute('data-state', 'ready');
    await expect(assembly.getByTestId('assembly-save-product')).toBeEnabled();
    await assembly.getByRole('textbox', { name: 'Product name' }).fill('Reporter plasmid');
    await assembly.getByTestId('assembly-save-product').click();

    await expect(assembly.getByTestId('assembly-save-product')).toBeDisabled();
    await expect(assembly.getByTestId('assembly-save-product')).toHaveText('Saved');
    await expect(assembly.getByRole('status')).toContainText('saved with its workflow result');
    const saved = await page.evaluate(() => ({
      records: window.motifGetInventory?.(),
      workflows: window.motifGetWorkflowResults?.(),
    }));
    expect(saved.records).toHaveLength(3);
    expect(saved.workflows).toHaveLength(1);
    const product = saved.records?.find((record) => record.name === 'Reporter plasmid');
    expect(product).toMatchObject({
      molecule: 'dna',
      topology: 'circular',
      group: 'Assembly products',
      provenance: expect.objectContaining({ operation: 'golden_gate' }),
    });
    expect(saved.workflows?.[0]).toMatchObject({
      kind: 'golden_gate',
      inputRecordIds: ['gg-promoter', 'gg-backbone'],
      inputSha256s: [expect.stringMatching(/^[0-9a-f]{64}$/), expect.stringMatching(/^[0-9a-f]{64}$/)],
      outputRecordIds: [product?.id],
      result: expect.objectContaining({ status: 'ready' }),
    });

    await assembly.getByTestId('assembly-save-product').click({ force: true });
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => ({
      records: window.motifGetInventory?.().length,
      workflows: window.motifGetWorkflowResults?.().length,
    }))).toEqual({ records: 3, workflows: 1 });

    await assemblyWindow.getByRole('button', { name: 'Close Cloning Workspace' }).click();
    await page.evaluate(() => {
      const workspace = window.motifGetWorkspace?.() as {
        workflowResults?: Array<{ inputSha256s?: string[] }>;
      } | undefined;
      workspace?.workflowResults?.forEach((result) => {
        if (result.inputSha256s) result.inputSha256s = result.inputSha256s.map((value) => value.toUpperCase());
      });
      window.motifReplaceWorkspace?.(workspace as never);
    });
    await cloning.locator(':scope > summary').click();
    await cloning.getByTestId('open-assembly-workspace').click();
    assembly = page.getByTestId('assembly-workspace');
    assemblyWindow = page.locator('.motif-cs-window').filter({ has: assembly });
    await assembly.getByRole('textbox', { name: 'Product name' }).fill('Reporter plasmid');
    await assembly.getByTestId('assembly-save-product').click();
    await expect(assembly.getByRole('alert')).toContainText('already saved');
    expect(await page.evaluate(() => ({
      records: window.motifGetInventory?.().length,
      workflows: window.motifGetWorkflowResults?.().length,
    }))).toEqual({ records: 3, workflows: 1 });

    await page.evaluate(() => window.motifRenderInventory?.([{
      id: 'replacement-record',
      name: 'Replacement record',
      molecule: 'dna',
      topology: 'linear',
      seq: 'ATGC',
      active: true,
    }]));
    await expect(assemblyWindow).toHaveCount(0);
  });

  test('guided cloning design switches from GoldenBraid ordering to Gibson preparation and opens primer design', async ({ page }) => {
    await openArtifact(page, 1440, 900);
    await page.evaluate(() => window.motifRenderInventory?.([
      {
        id: 'gb-terminator',
        name: 'GB terminator',
        molecule: 'dna',
        topology: 'linear',
        seq: 'GGTCTCNTGAGTTTTTTTTCGCTNGAGACC',
        group: 'GoldenBraid parts',
        tags: ['terminator'],
        active: true,
      },
      {
        id: 'gb-promoter',
        name: 'GB promoter',
        molecule: 'dna',
        topology: 'linear',
        seq: 'GGTCTCNGGAGCCCCCCCCGATGNGAGACC',
        group: 'GoldenBraid parts',
        tags: ['promoter'],
      },
      {
        id: 'gb-cds',
        name: 'GB CDS',
        molecule: 'dna',
        topology: 'linear',
        seq: 'GGTCTCNGATGATGAAATTTTGAGNGAGACC',
        group: 'GoldenBraid parts',
        tags: ['cds'],
      },
      {
        id: 'gb-alpha-destination',
        name: 'GB alpha destination',
        molecule: 'dna',
        topology: 'linear',
        seq: 'GGTCTCNCGCTACTGACTGACTGGGAGNGAGACC',
        group: 'GoldenBraid vectors',
        tags: ['destination', 'alpha1'],
      },
    ]));

    const cloning = page.locator('details[data-rail-tool="cloning"]');
    await cloning.locator(':scope > summary').click();
    await cloning.getByTestId('open-cloning-design-workspace').click();

    const design = page.getByTestId('cloning-design-workspace');
    const designWindow = page.locator('.motif-cs-window').filter({ has: design });
    await expect(designWindow).toBeVisible();
    await expect(design.getByRole('tab', { name: /Golden Gate/ })).toHaveAttribute('aria-selected', 'true');
    await expect(design.getByLabel('Part 1')).toHaveValue('gb-terminator');

    await design.getByPlaceholder('Name, group, or tag…').fill('promoter');
    await expect(design.getByLabel('Record to add')).toHaveValue('gb-promoter');
    await design.getByPlaceholder('Name, group, or tag…').press('Enter');
    await expect(design.getByLabel('Part 2')).toHaveValue('gb-promoter');

    await design.getByPlaceholder('Name, group, or tag…').fill('cds');
    await expect(design.getByLabel('Record to add')).toHaveValue('gb-cds');
    await design.getByTestId('cloning-design-add-part').click();
    await design.getByLabel('Assembly route').selectOption('golden_braid_tu_alpha');
    await design.getByLabel('GoldenBraid destination vector').selectOption('gb-alpha-destination');

    await expect(design.getByLabel('Golden Gate profile')).toHaveCount(0);
    await expect(design.getByLabel('Type IIS enzyme')).toHaveCount(0);
    await expect(design.getByTestId('cloning-design-organization-help')).toContainText('Reaction: BsaI');
    await expect(design.getByText('GoldenBraid 3.0 Reference')).toBeVisible();
    await expect(design.getByRole('button', { name: 'Apply Suggested Order' })).toBeEnabled();
    await design.getByRole('button', { name: 'Move GB promoter up' }).click();
    await design.getByRole('textbox', { name: 'Design Name' }).fill('GoldenBraid lineage check');
    await design.getByRole('button', { name: 'Save Product' }).click();
    const savedLineage = await page.evaluate(() => {
      const product = window.motifGetInventory?.().find((record) => record.name === 'GoldenBraid lineage check');
      const result = window.motifGetAnalysisWorkspace?.().analysisResults.find((entry) => entry.name === 'GoldenBraid lineage check');
      return { product, result };
    });
    expect(savedLineage.product?.provenance).toMatchObject({
      parentRecordIds: ['gb-promoter', 'gb-cds', 'gb-terminator', 'gb-alpha-destination'],
      parentOrientations: ['forward', 'forward', 'forward', 'forward'],
      requestedRecordIds: ['gb-promoter', 'gb-terminator', 'gb-cds', 'gb-alpha-destination'],
      requestedOrientations: ['forward', 'forward', 'forward', 'forward'],
    });
    expect(savedLineage.result).toMatchObject({
      data: { orderedPartRecordIds: ['gb-promoter', 'gb-cds', 'gb-terminator', 'gb-alpha-destination'] },
      parameters: {
        requestedRecordIds: ['gb-promoter', 'gb-terminator', 'gb-cds', 'gb-alpha-destination'],
        requestedOrientations: ['forward', 'forward', 'forward', 'forward'],
        destinationRecordId: 'gb-alpha-destination',
        goldenBraidIdentityValidated: true,
      },
    });
    await design.getByRole('button', { name: 'Apply Suggested Order' }).click();
    await expect(design.getByLabel('Part 1')).toHaveValue('gb-promoter');
    await expect(design.getByLabel('Part 2')).toHaveValue('gb-cds');
    await expect(design.getByLabel('Part 3')).toHaveValue('gb-terminator');
    await expect(design.getByTestId('cloning-design-plan-status')).toHaveAttribute('data-state', 'ready');

    await design.getByRole('tab', { name: /Gibson/ }).click();
    await expect(design.getByRole('tab', { name: /Gibson/ })).toHaveAttribute('aria-selected', 'true');
    await expect(design.getByTestId('gibson-junction-lanes')).toBeVisible();
    await expect(design.getByTestId('cloning-design-plan-status')).toHaveAttribute('data-state', 'needs_preparation');
    await expect(design.getByText('Preparation Checklist')).toBeVisible();
    await design.getByRole('textbox', { name: 'Design Name' }).fill('Draft preserved through primer work');
    const primerHandoff = design.getByRole('button', { name: 'Open primer workspace' }).first();
    await primerHandoff.scrollIntoViewIfNeeded();
    await primerHandoff.click();

    await expect(designWindow).toHaveAttribute('data-inactive', 'true');
    await expect(designWindow).toHaveAttribute('aria-hidden', 'true');
    const primer = page.getByTestId('primer-workspace');
    const primerWindow = page.locator('.motif-cs-window').filter({ has: primer });
    await expect(primerWindow).toBeVisible();
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('GB CDS');
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText('The cloning draft remains open underneath.');
    await expect(primer.getByRole('button', { name: 'Cloning', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(primer.getByRole('note', { name: 'Cloning preparation context' })).toContainText('Add homology');
    await expect(primer.getByRole('navigation', { name: 'Primer design presets' })).toBeVisible();
    await expect(primer.getByLabel('Primer preparation worklist')).toContainText('Action 1 of 1');
    await expect(primer.getByLabel('Primer preparation worklist')).toContainText('0 complete · 1 remaining');
    await expect(primer.getByLabel('Target start')).toHaveValue('1');
    await expect(primer.getByLabel('Target end')).toHaveValue(String('GGTCTCNGATGATGAAATTTTGAGNGAGACC'.length));
    await expect(primer.getByRole('note', { name: 'Cloning preparation context' })).toContainText('forward in the assembly');
    await page.screenshot({ path: path.join(outputDir, 'cloning-primer-handoff-light.png') });
    await page.locator('select[name="artifact-theme"]').selectOption('claude-dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-dark');
    await page.screenshot({ path: path.join(outputDir, 'cloning-primer-handoff-claude-dark.png') });
    await primerWindow.getByRole('button', { name: 'Close Primer Design' }).click();
    await expect(primerWindow).toHaveCount(0);
    await expect(designWindow).not.toHaveAttribute('data-inactive');
    await expect(design.getByRole('textbox', { name: 'Design Name' })).toHaveValue('Draft preserved through primer work');
    await expect(design.getByLabel('Part 1')).toHaveValue('gb-promoter');
    await expect(design.getByRole('tab', { name: /Gibson/ })).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: path.join(outputDir, 'cloning-draft-restored-claude-dark.png') });
  });

  test('recursive GoldenBraid keeps complementary sources separate from its typed destination', async ({ page }) => {
    await openArtifact(page, 1280, 860);
    await page.evaluate(() => window.motifRenderInventory?.([
      {
        id: 'gb-alpha-one',
        name: 'Alpha module one',
        molecule: 'dna',
        topology: 'linear',
        seq: 'CGTCTCNAAAACCCCCCCCCCCCNGAGACG',
        group: 'GoldenBraid alpha modules',
        active: true,
      },
      {
        id: 'gb-alpha-two',
        name: 'Alpha module two',
        molecule: 'dna',
        topology: 'linear',
        seq: 'CGTCTCNCCCCGGGGGGGGGGGGNGAGACG',
        group: 'GoldenBraid alpha modules',
      },
      {
        id: 'gb-omega-vector',
        name: 'Omega destination vector',
        molecule: 'dna',
        topology: 'linear',
        seq: 'CGTCTCNGGGGTTTTTTTTTTTTAAAANGAGACG',
        group: 'GoldenBraid destination vectors',
      },
    ]));

    const cloning = page.locator('details[data-rail-tool="cloning"]');
    await cloning.locator(':scope > summary').click();
    await cloning.getByTestId('open-cloning-design-workspace').click();
    const design = page.getByTestId('cloning-design-workspace');

    await design.getByPlaceholder('Name, group, or tag…').fill('module two');
    await design.getByPlaceholder('Name, group, or tag…').press('Enter');
    await design.getByLabel('Assembly route').selectOption('golden_braid_alpha_omega');
    await expect(design.getByRole('heading', { name: 'Source Modules' })).toBeVisible();
    await expect(design.getByLabel('GoldenBraid source type for Alpha module one')).toHaveValue('1');
    await expect(design.getByLabel('GoldenBraid source type for Alpha module two')).toHaveValue('2');
    await design.getByLabel('GoldenBraid destination vector').selectOption('gb-omega-vector');
    await design.getByLabel('GoldenBraid destination type').selectOption('2R');

    await expect(design.getByTestId('cloning-design-organization-help')).toContainText('Reaction: BsmBI · Esp3I compatible');
    await expect(design.getByTestId('cloning-design-plan-status')).toHaveAttribute('data-state', 'ready');
    await expect(design.getByTestId('cloning-design-product-preview')).toContainText('Omega destination vector');
    await design.getByText('Advanced reaction settings').click();
    await design.getByLabel('GoldenBraid reaction enzyme').selectOption('Esp3I');
    await expect(design.getByTestId('cloning-design-organization-help')).toContainText('Reaction: Esp3I');
    await expect(design.getByTestId('cloning-design-plan-status')).toHaveAttribute('data-state', 'ready');

    await design.getByRole('textbox', { name: 'Design Name' }).fill('Alpha to omega stack');
    await design.getByRole('button', { name: 'Save Product' }).click();
    const saved = await page.evaluate(() => ({
      product: window.motifGetInventory?.().find((record) => record.name === 'Alpha to omega stack'),
      result: window.motifGetAnalysisWorkspace?.().analysisResults.find((entry) => entry.name === 'Alpha to omega stack'),
    }));
    expect(saved.product?.provenance?.parentRecordIds).toEqual(expect.arrayContaining([
      'gb-alpha-one',
      'gb-alpha-two',
      'gb-omega-vector',
    ]));
    expect(saved.result?.parameters).toMatchObject({
      goldenBraidDirection: 'alpha_to_omega',
      sourceLevel: 'alpha',
      destinationLevel: 'omega',
      destinationRecordId: 'gb-omega-vector',
      goldenBraidIdentityValidated: true,
      enzyme: 'Esp3I',
    });
    await page.screenshot({ path: path.join(outputDir, 'cloning-goldenbraid-alpha-omega-light.png') });
    await page.locator('select[name="artifact-theme"]').selectOption('claude-dark');
    await page.screenshot({ path: path.join(outputDir, 'cloning-goldenbraid-alpha-omega-dark.png') });
  });

  test('guided cloning design keeps review, naming, and save controls reachable without document overflow at phone width', async ({ page }) => {
    await openArtifact(page, 520, 720);
    await page.evaluate(() => window.motifRenderInventory?.([
      {
        id: 'narrow-left',
        name: 'Narrow left fragment',
        molecule: 'dna',
        topology: 'linear',
        seq: 'AAAACCCCGGGGTTTT',
        active: true,
      },
      {
        id: 'narrow-right',
        name: 'Narrow right fragment',
        molecule: 'dna',
        topology: 'linear',
        seq: 'TTTTGGGGCCCCAAAA',
      },
    ]));

    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();
    const cloning = page.locator('details[data-rail-tool="cloning"]');
    const cloningSummary = cloning.locator(':scope > summary');
    await cloningSummary.scrollIntoViewIfNeeded();
    if (!(await cloning.getAttribute('open'))) await cloningSummary.click();
    const launch = cloning.getByTestId('open-cloning-design-workspace');
    await launch.scrollIntoViewIfNeeded();
    await launch.click();

    const design = page.getByTestId('cloning-design-workspace');
    const designWindow = page.locator('.motif-cs-window').filter({ has: design });
    await expect(designWindow).toBeVisible();
    await design.getByPlaceholder('Name, group, or tag…').fill('right');
    await expect(design.getByLabel('Record to add')).toHaveValue('narrow-right');
    await design.getByPlaceholder('Name, group, or tag…').press('Enter');
    await design.getByRole('tab', { name: /Gibson/ }).click();

    const reviewHeading = design.getByText('Preparation Checklist');
    await reviewHeading.scrollIntoViewIfNeeded();
    await expect(reviewHeading).toBeVisible();
    const designName = design.getByRole('textbox', { name: 'Design Name' });
    await designName.scrollIntoViewIfNeeded();
    await expect(designName).toBeVisible();
    await designName.fill('Narrow Gibson plan');
    const savePlan = design.getByRole('button', { name: 'Save Plan' });
    await expect(savePlan).toBeVisible();
    await expect(savePlan).toBeEnabled();

    const geometry = await page.evaluate(() => {
      const windowPanel = [...document.querySelectorAll<HTMLElement>('.motif-cs-window')]
        .find((element) => element.querySelector('[data-testid="cloning-design-workspace"]'))!;
      const workspace = windowPanel.querySelector<HTMLElement>('[data-testid="cloning-design-workspace"]')!;
      const body = workspace.querySelector<HTMLElement>('.motif-cs-cloning-design-body')!;
      const save = [...workspace.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.trim() === 'Save Plan')!;
      const windowRect = windowPanel.getBoundingClientRect();
      const saveRect = save.getBoundingClientRect();
      return {
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        windowLeft: windowRect.left,
        windowRight: windowRect.right,
        windowTop: windowRect.top,
        windowBottom: windowRect.bottom,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        saveLeft: saveRect.left,
        saveRight: saveRect.right,
        saveTop: saveRect.top,
        saveBottom: saveRect.bottom,
      };
    });
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.windowLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.windowRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.windowTop).toBeGreaterThanOrEqual(0);
    expect(geometry.windowBottom).toBeLessThanOrEqual(720 + 1);
    expect(['auto', 'scroll']).toContain(geometry.bodyOverflowY);
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.bodyClientWidth + 1);
    expect(geometry.saveLeft).toBeGreaterThanOrEqual(geometry.windowLeft - 1);
    expect(geometry.saveRight).toBeLessThanOrEqual(geometry.windowRight + 1);
    expect(geometry.saveTop).toBeGreaterThanOrEqual(geometry.windowTop - 1);
    expect(geometry.saveBottom).toBeLessThanOrEqual(geometry.windowBottom + 1);

    await savePlan.click();
    await expect(design.getByRole('status')).toContainText('saved for review');
    await expect.poll(() => page.evaluate(() => window.motifGetAnalysisWorkspace?.().analysisResults.length)).toBe(1);
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText('Assembly plan saved in Results.');
  });

  test('restriction maps and digests do not silently convert RNA to DNA', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    await page.evaluate(() => window.motifRenderInventory([{
      id: 'rna-restriction-probe',
      name: 'RNA restriction probe',
      molecule: 'rna',
      topology: 'linear',
      seq: 'AAAAGAAUUCAAAA',
    }]));

    const mapVisibility = page.locator('details').filter({ hasText: 'Map Visibility' }).first();
    await mapVisibility.locator(':scope > summary').click();
    await expect(mapVisibility).toContainText('Restriction enzymes act on DNA; RNA is not converted implicitly.');
    await expect(mapVisibility.locator('.motif-cs-restriction-source')).toHaveCount(0);

    const digest = page.locator('details').filter({ hasText: 'Digest Preview' }).first();
    await digest.locator(':scope > summary').click();
    await expect(digest).toContainText('Restriction digest is available for DNA records only.');
    await expect(digest.getByRole('combobox', { name: 'Digest enzymes' })).toHaveCount(0);
  });

  test('explicitly disabling every restriction source remains sticky', async ({ page }) => {
    await openArtifact(page);
    const mapVisibility = page.locator('details').filter({ hasText: 'Map visibility' }).first();
    if (!(await mapVisibility.getAttribute('open'))) await mapVisibility.locator('summary').click();

    const activeSources = page.locator('.motif-cs-restriction-source[aria-pressed="true"]');
    while (await activeSources.count()) await activeSources.first().click();

    await expect(page.locator('.motif-cs-restriction-source[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show sites' })).toBeDisabled();
  });

  test('primer edits clear invalid results and recompute valid pairs immediately', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const primerPanel = page.locator('details[data-rail-tool="primer-design"]');
    await primerPanel.locator(':scope > summary').click();
    await primerPanel.getByTestId('open-primer-workspace').click();
    const workspace = page.getByTestId('primer-workspace');
    await expect(workspace.locator('.motif-cs-primer-pair-row').first()).toBeVisible();

    await workspace.getByLabel('Target start').fill('200');
    await workspace.getByLabel('Target end').fill('100');
    await expect(workspace.locator('.motif-cs-primer-pair-row')).toHaveCount(0);
    await expect(workspace.getByRole('alert')).toContainText('Use a non-wrapping target');
    await expect(workspace.getByRole('button', { name: 'Save design' })).toBeDisabled();

    await workspace.getByLabel('Target end').fill('300');
    await expect(workspace.getByRole('alert')).toHaveCount(0);
    await expect(workspace.locator('.motif-cs-primer-pair-row').first()).toBeVisible();
    await expect(workspace.getByRole('button', { name: 'Save design' })).toBeEnabled();
  });

  test('a Tools rail popover closes on outside pointer before Export is opened', async ({ page }) => {
    await openArtifact(page, 640, 700);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) === 'true') await toolsToggle.click();

    const primerPanel = page.locator('details[data-rail-tool="primer-design"]');
    await primerPanel.locator(':scope > summary').click();
    await expect(primerPanel).toHaveAttribute('open', '');
    await expect(primerPanel.locator('.motif-cs-tool-panel-body')).toBeVisible();

    await page.locator('.motif-cs-sidebar > .motif-cs-pane-title').click({ position: { x: 10, y: 10 } });
    await expect(primerPanel).not.toHaveAttribute('open', '');

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    const exportSummary = exportPanel.locator(':scope > summary');
    await exportSummary.scrollIntoViewIfNeeded();
    await exportSummary.click();
    await expect(exportPanel).toHaveAttribute('open', '');
  });

  test('runtime APIs reject destructive invalid input and expose fresh biology synchronously', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const result = await page.evaluate(() => {
      const api = window as unknown as {
        motifRenderInventory: (records: unknown[]) => void;
        motifAddRecords: (records: unknown) => number;
        motifGetInventory: () => Array<{ id: string }>;
        motifGetActiveRecord: () => { seq: string } | null;
        motifSetRestrictionSources: (sources: string[]) => unknown;
        motifDescribe: () => { text: string } | null;
      };
      const beforeIds = api.motifGetInventory().map((record) => record.id);
      let invalidCode: string | null = null;
      try {
        api.motifRenderInventory([{ id: 'valid', type: 'dna', sequence: 'GAATTC' }, { sequence: 'hello world' }]);
      } catch (error) {
        invalidCode = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
      }
      const afterIds = api.motifGetInventory().map((record) => record.id);
      const proteinCount = api.motifAddRecords({ id: 'extended-protein', type: 'protein', sequence: 'M U O J B X Z *' });
      const proteinSequence = api.motifGetActiveRecord()?.seq;
      const ecoCount = api.motifAddRecords({ id: 'fresh-eco', type: 'dna', topology: 'linear', sequence: 'TTTGAATTCAAA' });
      api.motifSetRestrictionSources(['common']);
      const description = api.motifDescribe()?.text ?? '';
      api.motifRenderInventory([]);
      const emptyCount = api.motifGetInventory().length;
      return { beforeIds, afterIds, invalidCode, proteinCount, proteinSequence, ecoCount, description, emptyCount };
    });

    expect(result.afterIds).toEqual(result.beforeIds);
    expect(result.invalidCode).toBe('MOTIF_INVALID_INVENTORY_REPLACEMENT');
    expect(result.proteinCount).toBe(1);
    expect(result.proteinSequence).toBe('MUOJBXZ*');
    expect(result.ecoCount).toBe(1);
    expect(result.description).toContain('EcoRI');
    expect(result.emptyCount).toBe(0);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
  });

  test('Database JSON restores transactionally from Add Entry and file drop', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const restoredDatabase = {
      schema: 'motif.claude-science.inventory.v1',
      inventory: { id: 'restored-session', title: 'Restored session', description: 'Round-trip fixture' },
      selectedRecordId: 'restored-record',
      defaultMotif: 'GAATTC',
      records: [{
        id: 'restored-record',
        name: 'Restored record',
        molecule: 'dna',
        topology: 'linear',
        seq: 'ATGGAATTCTAA',
        annotations: [{ id: 'cds-a', name: 'CDS A', type: 'cds', start: 0, end: 12, strand: 1 }],
      }],
      alignments: [{
        id: 'restored-alignment',
        name: 'Restored alignment',
        molecule: 'dna',
        referenceRowId: 'restored-row',
        rows: [
          { id: 'restored-row', name: 'Restored reference', aligned: 'ATGGAA-TTCTAA', sourceRecordId: 'restored-record' },
          { id: 'variant-row', name: 'Restored variant', aligned: 'ATGGAATTTCTAA' },
        ],
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command', parameters: ['--auto'] },
      }],
      notes: [{
        id: 'restored-note',
        title: 'Restore note',
        body: 'Review the EcoRI interval.',
        format: 'plain',
        scope: 'range',
        recordId: 'restored-record',
        range: { start: 3, end: 9 },
        createdAt: '2026-07-12T12:00:00.000Z',
        updatedAt: '2026-07-12T12:00:00.000Z',
      }],
      workflowResults: [{
        id: 'restored-digest',
        kind: 'digest',
        name: 'EcoRI digest',
        inputRecordIds: ['restored-record'],
        parameters: { enzymes: ['EcoRI'] },
        outputRecordIds: ['restored-record'],
        createdAt: '2026-07-12T12:05:00.000Z',
        provenance: { source: 'motif-artifact', operation: 'digest' },
      }],
      artifactState: {
        customEnzymes: [{
          name: 'RoundTripI',
          recognitionSequence: 'GAATTC',
          cutOffset: 1,
          complementCutOffset: 5,
          overhang: '5prime',
        }],
        translationLayersByRecord: {
          'restored-record': [{
            id: 'layer-a', label: 'Pinned region', start: 0, end: 6, strand: 1, frame: 0, source: 'layer', color: '#3399cc',
          }],
        },
        enzymeSourcesByRecord: { 'restored-record': ['common'] },
        hiddenEnzymesByRecord: {},
        hiddenFeatureTranslationsByRecord: { 'restored-record': ['feat:cds-a'] },
        restrictionLabelsByRecord: { 'restored-record': true },
        motifsByRecord: { 'restored-record': 'GAATTC' },
      },
    };

    await page.getByRole('button', { name: 'Add entry' }).click();
    const importPanel = page.locator('.motif-cs-import-panel[open]');
    await importPanel.getByLabel('Sequence import input').fill(JSON.stringify(restoredDatabase));
    await importPanel.getByRole('button', { name: 'Add / restore' }).click();
    const restoreDialog = page.getByRole('alertdialog', { name: 'Replace this workspace?' });
    await expect(restoreDialog).toBeVisible();
    await expect(restoreDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await restoreDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(restoreDialog).toBeHidden();
    await expect(page.locator('.motif-cs-add-entry-button')).toBeFocused();
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('pUC19');

    await page.getByRole('button', { name: 'Add entry' }).click();
    const reopenedImportPanel = page.locator('.motif-cs-import-panel[open]');
    await expect(reopenedImportPanel.getByLabel('Sequence import input')).toHaveValue(JSON.stringify(restoredDatabase));
    await reopenedImportPanel.getByRole('button', { name: 'Add / restore' }).click();
    await expect(restoreDialog).toBeVisible();
    await restoreDialog.getByRole('button', { name: 'Replace workspace' }).click();
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('Restored record');
    await expect(page.getByTestId('session-durability-status')).toHaveText('saved');
    await expect(page.locator('.motif-cs-dropzone-card')).toContainText('Database JSON restored · 1 record');
    await expect(page.locator('.motif-cs-dropzone')).toBeHidden({ timeout: 4_000 });
    expect(await page.evaluate(() => window.motifGetAlignments())).toHaveLength(1);

    await page.getByRole('button', { name: 'Add entry' }).click();
    const clearedImportPanel = page.locator('.motif-cs-import-panel[open]');
    await expect(clearedImportPanel.getByLabel('Sequence import input')).toHaveValue('');
    await expect(clearedImportPanel.locator('.motif-cs-import-status')).toHaveCount(0);
    await page.locator('.motif-cs-add-entry-button').click();

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    await exportPanel.locator(':scope > summary').click();
    await exportPanel.locator('select[name="export-format"]').selectOption('inventory-json');
    const roundTripped = JSON.parse(await exportPanel.getByLabel('Selected export preview').inputValue());
    expect(roundTripped.selectedRecordId).toBe('restored-record');
    expect(roundTripped.schema).toBe('motif.claude-science.inventory.v2');
    expect(roundTripped.artifactState).toEqual(restoredDatabase.artifactState);
    expect(roundTripped.alignments).toEqual(restoredDatabase.alignments);
    expect(roundTripped.notes).toEqual(restoredDatabase.notes);
    expect(roundTripped.workflowResults).toEqual(restoredDatabase.workflowResults);

    const droppedDatabase = {
      ...restoredDatabase,
      selectedRecordId: 'dropped-record',
      records: [{ id: 'dropped-record', name: 'Dropped restore', molecule: 'protein', topology: 'linear', seq: 'MPEPTIDE' }],
      alignments: [],
      notes: [],
      workflowResults: [],
      artifactState: {
        customEnzymes: [],
        translationLayersByRecord: {},
        enzymeSourcesByRecord: {},
        hiddenEnzymesByRecord: {},
        hiddenFeatureTranslationsByRecord: {},
        restrictionLabelsByRecord: {},
        motifsByRecord: {},
      },
    };
    await page.evaluate((database) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(database)], 'dropped-session.json', { type: 'application/json' }));
      document.querySelector('.motif-cs-shell')?.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    }, droppedDatabase);
    await expect(restoreDialog).toBeVisible();
    await expect(restoreDialog).toContainText('dropped-session.json');
    await restoreDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('Restored record');

    await page.evaluate((database) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(database)], 'dropped-session.json', { type: 'application/json' }));
      document.querySelector('.motif-cs-shell')?.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    }, droppedDatabase);
    await expect(restoreDialog).toBeVisible();
    await restoreDialog.getByRole('button', { name: 'Replace workspace' }).click();
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('Dropped restore');
    await expect(page.getByTestId('session-durability-status')).toHaveText('saved');
  });

  test('Notes create from a keyboard selection, reveal their range, and stay usable on phone layouts', async ({ page }) => {
    await openArtifact(page, 390, 780);
    const sequence = page.locator('.motif-cs-sequence');
    await sequence.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('.motif-cs-selection-name')).toHaveText('1-2 (2)');

    const notesPanel = page.locator('[data-rail-tool="notes"]');
    await notesPanel.locator(':scope > summary').click();
    await notesPanel.locator('.motif-cs-annotation-editor-drawer > summary').click();
    await expect(notesPanel.getByLabel('Scope')).toHaveValue('range');
    await notesPanel.getByLabel('Title').fill('Selected bases');
    await notesPanel.getByRole('textbox', { name: 'Note', exact: true }).fill('Keep this selected interval with the assembly plan.');
    await notesPanel.getByRole('button', { name: 'Markdown', exact: true }).click();
    await notesPanel.getByRole('button', { name: 'Add note', exact: true }).click();

    const saved = await page.evaluate(() => window.motifGetNotes?.()[0]);
    expect(saved).toMatchObject({
      title: 'Selected bases',
      format: 'markdown',
      scope: 'range',
      recordId: 'pUC19',
      range: { start: 0, end: 2 },
    });
    const noteRow = notesPanel.locator('[data-testid^="note-"]').filter({ hasText: 'Selected bases' });
    await noteRow.getByRole('button', { name: 'Reveal' }).click();
    await expect(page.locator('.motif-cs-selection-name')).toHaveText('1-2 (2)');

    const noteBody = await notesPanel.locator('.motif-cs-tool-panel-body').boundingBox();
    expect(noteBody).toBeTruthy();
    expect(noteBody!.x).toBeGreaterThanOrEqual(0);
    expect(noteBody!.x + noteBody!.width).toBeLessThanOrEqual(390);
    await expect(page.locator('[data-testid="artifact-runtime-error-shell"]')).toHaveCount(0);
  });

  test('Data & recovery backs up, validates restore files, clears safely, and directly round-trips motifGetWorkspace', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const timestamp = '2026-07-12T20:00:00.000Z';
    await page.evaluate((createdAt) => window.motifAddNotes?.({
      id: 'recovery-note',
      title: 'Recovery note',
      body: 'Keep this note with the complete workspace.',
      format: 'plain',
      scope: 'record',
      recordId: 'pUC19',
      createdAt,
      updatedAt: createdAt,
      provenance: { source: 'e2e' },
    }), timestamp);

    const snapshot = await page.evaluate(() => window.motifGetWorkspace?.());
    expect(snapshot).toMatchObject({
      schema: 'motif.claude-science.inventory.v2',
      records: expect.any(Array),
      notes: [expect.objectContaining({ id: 'recovery-note' })],
      artifactState: expect.any(Object),
    });
    expect(await page.evaluate((workspace) => window.motifReplaceWorkspace?.(workspace), snapshot)).toBe(13);
    const invalid = await page.evaluate(() => {
      try {
        window.motifAddNotes?.({
          id: 'invalid-note', body: 'Invalid owner', format: 'plain', scope: 'record', recordId: 'missing-record',
          createdAt: '2026-07-12T20:00:00.000Z', updatedAt: '2026-07-12T20:00:00.000Z',
        });
        return null;
      } catch (error) {
        return { code: (error as { code?: string }).code, count: window.motifGetNotes?.().length };
      }
    });
    expect(invalid).toEqual({ code: 'MOTIF_INVALID_WORKSPACE_INPUT', count: 1 });
    await expect(page.locator('[data-testid="artifact-runtime-error-shell"]')).toHaveCount(0);

    const settings = page.locator('[data-rail-tool="settings"]');
    await settings.locator(':scope > summary').click();
    const downloadPromise = page.waitForEvent('download');
    await settings.getByTestId('download-workspace-backup').click();
    expect((await downloadPromise).suggestedFilename()).toBe('motif-workspace-backup.json');
    await settings.getByTestId('restore-workspace-file').setInputFiles({
      name: 'workspace-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(snapshot)),
    });
    const restoreDialog = page.getByRole('alertdialog', { name: 'Replace this workspace?' });
    await expect(restoreDialog).toBeVisible();
    await restoreDialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => window.motifGetInventory?.().length)).toBe(13);
    await expect(settings).toHaveAttribute('open', '');
    await expect(settings.getByTestId('restore-workspace-backup')).toBeFocused();

    const themeBefore = await page.locator('html').getAttribute('data-theme');
    await settings.getByTestId('clear-workspace').click();
    await expect(settings.getByTestId('clear-workspace-cancel')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(settings.getByTestId('clear-workspace')).toBeFocused();
    expect(await page.evaluate(() => window.motifGetInventory?.().length)).toBe(13);

    await settings.getByTestId('clear-workspace').click();
    await settings.getByTestId('clear-workspace-confirm').click();
    expect(await page.evaluate(() => window.motifGetInventory?.().length)).toBe(0);
    expect(await page.locator('html').getAttribute('data-theme')).toBe(themeBefore);
    expect(await page.evaluate((workspace) => window.motifReplaceWorkspace?.(workspace), snapshot)).toBe(13);
    expect(await page.evaluate(() => window.motifGetNotes?.().length)).toBe(1);
  });

  test('durable edits warn before reload and full downloads checkpoint the session', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    await expect(page.getByTestId('session-durability-status')).toHaveText('session only');

    await page.evaluate(() => {
      (window as unknown as { motifAddRecords: (record: unknown) => number }).motifAddRecords({
        id: 'dirty-record', type: 'dna', topology: 'linear', sequence: 'GAATTC',
      });
    });
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');
    const warning = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      const dispatched = window.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented, dispatched };
    });
    expect(warning.defaultPrevented).toBe(true);
    expect(warning.dispatched).toBe(false);

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    await exportPanel.locator(':scope > summary').click();
    await exportPanel.locator('select[name="export-format"]').selectOption('inventory-json');
    const downloadPromise = page.waitForEvent('download');
    await exportPanel.getByRole('button', { name: 'Download' }).click();
    await downloadPromise;
    await expect(page.getByTestId('session-durability-status')).toHaveText('saved');
  });

  test('250k records keep sequence and translation DOM bounded and an empty inventory exports only real data', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const sequence = `${'ATGGCC'.repeat(41_666)}ATGC`;
    await page.evaluate((largeSequence) => {
      (window as unknown as { motifRenderInventory: (records: unknown[]) => void }).motifRenderInventory([{
        id: 'large-record', name: 'Large record', type: 'dna', topology: 'linear', sequence: largeSequence,
      }]);
    }, sequence);

    const densityView = page.getByTestId('large-sequence-viewer');
    await expect(densityView).toBeVisible();
    await expect(densityView.locator('textarea')).toHaveValue(sequence);
    await expect(page.getByRole('button', { name: 'Detail sequence view' })).toBeDisabled();
    expect(await page.locator('.motif-cs-sequence-panel *').count()).toBeLessThan(250);
    await expect(page.locator('.motif-cs-protein-aa')).toHaveCount(0);
    await expect(page.locator('.motif-cs-protein-readout')).toHaveCount(0);
    await expect(page.locator('.motif-cs-sequence-tools-panel')).not.toHaveAttribute('open', '');
    await expect(page.getByRole('dialog', { name: 'Translations' })).toHaveCount(0);

    const mapDensity = page.locator('.motif-pm-restriction-density');
    await expect(mapDensity).toHaveAttribute('data-binned', 'true');
    const densityMetrics = await mapDensity.evaluate((element) => {
      const ticks = Array.from(element.querySelectorAll<SVGLineElement>('.motif-pm-tick'));
      return {
        sourceCount: Number((element as SVGGElement).dataset.sourceCount),
        renderedCount: ticks.length,
        representedCount: ticks.reduce((sum, tick) => sum + Number(tick.dataset.siteCount), 0),
      };
    });
    expect(densityMetrics.sourceCount).toBeGreaterThan(512);
    expect(densityMetrics.renderedCount).toBeLessThanOrEqual(512);
    expect(densityMetrics.representedCount).toBe(densityMetrics.sourceCount);

    const inventoryRow = page.locator('.motif-cs-sidebar .motif-cs-row-compact').first();
    await expect(inventoryRow).toBeVisible();
    expect((await inventoryRow.boundingBox())!.height).toBeLessThanOrEqual(48);

    const domBeforeTranslation = await page.locator('*').count();
    await page.getByRole('button', { name: 'Translations window off' }).click();
    const translationDialog = page.getByRole('dialog', { name: 'Translations' });
    await expect(translationDialog).toBeVisible();
    await expect(translationDialog.locator('.motif-cs-protein-readout-dense')).toHaveCount(1);
    await expect(translationDialog.locator('[data-residue-index]')).toHaveCount(0);
    expect(await page.locator('*').count()).toBeLessThan(domBeforeTranslation + 120);
    await page.keyboard.press('Escape');
    await expect(translationDialog).toBeHidden();

    await page.evaluate(() => {
      (window as unknown as { motifRenderInventory: (records: unknown[]) => void }).motifRenderInventory([]);
    });
    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    await exportPanel.locator(':scope > summary').click();
    const format = exportPanel.locator('select[name="export-format"]');
    await expect(format).toHaveValue('inventory-json');
    const options = await format.locator('option').allTextContents();
    expect(options.some((label) => label.startsWith('Active record -'))).toBe(false);
    await expect(exportPanel.getByRole('button', { name: 'Sequence' })).toBeDisabled();
    const emptyDatabase = JSON.parse(await exportPanel.getByLabel('Selected export preview').inputValue());
    expect(emptyDatabase.records).toEqual([]);
  });

  test('desktop themes have no automatic WCAG A/AA violations', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();
    await expect(page.locator('details[data-rail-tool="annotations"]')).toHaveAttribute('open', '');
    for (const theme of ['light', 'dark', 'claude-light', 'claude-dark']) {
      await page.locator('select[name="artifact-theme"]').selectOption(theme);
      await page.waitForTimeout(180);
      const results = await new AxeBuilder({ page })
        .include('.motif-cs-shell')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(results.violations, `${theme} accessibility violations`).toEqual([]);
    }
  });

  test('appearance persists and resetting pane layout preserves the selected theme', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();

    await page.locator('select[name="artifact-theme"]').selectOption('claude-dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#2d2d2b');
    await page.reload();
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-dark');

    const settings = page.locator('details[data-rail-tool="settings"]');
    await settings.locator(':scope > summary').click();
    const claudeDark = settings.getByRole('radio', { name: /Claude Dark/ });
    await expect(claudeDark).toBeChecked();

    await claudeDark.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(settings.getByRole('radio', { name: /Claude Light/ })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-light');
    await page.keyboard.press('ArrowRight');
    await expect(claudeDark).toBeChecked();

    await settings.getByRole('button', { name: 'Reset display' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-dark');
    await expect.poll(async () => page.evaluate(() => {
      const raw = window.localStorage.getItem('motif.claude-science.workspace-layout.v1');
      return raw ? JSON.parse(raw).theme : null;
    })).toBe('claude-dark');
  });

  test('Settings identifies the active theme and resets panes without dismissing the workflow', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const inventoryToggle = page.locator('[data-pane-toggle="inventory"]');
    await inventoryToggle.click();
    await expect(inventoryToggle).toHaveAttribute('aria-pressed', 'false');
    await page.locator('select[name="artifact-theme"]').selectOption('claude-dark');

    const settings = page.locator('details[data-rail-tool="settings"]');
    const settingsSummary = settings.locator(':scope > summary');
    await settingsSummary.click();
    await expect(settings).toHaveAttribute('open', '');
    await expect.soft(settingsSummary.locator('.motif-cs-chip')).toHaveText('Claude Dark', { timeout: 1_000 });

    const reset = settings.getByRole('button', { name: 'Reset display' });
    await reset.focus();
    await reset.click();
    await expect.soft(settings).toHaveAttribute('open', '', { timeout: 1_000 });
    await expect.soft(reset).toBeFocused({ timeout: 1_000 });
    const resetStatus = settings.getByTestId('data-recovery-status');
    await expect.soft(resetStatus).toBeVisible({ timeout: 1_000 });
    await expect.soft(resetStatus).toHaveAttribute('role', 'status', { timeout: 1_000 });
    await expect.soft(resetStatus).toHaveAttribute('aria-live', 'polite', { timeout: 1_000 });
    await expect.soft(resetStatus).toContainText(/display preferences reset/i, { timeout: 1_000 });

    await expect(inventoryToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('select[name="artifact-theme"]')).toHaveValue('claude-dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-dark');
    await expect.soft(settingsSummary.locator('.motif-cs-chip')).toHaveText('Claude Dark', { timeout: 1_000 });
    await page.screenshot({ path: path.join(outputDir, 'settings-reset-keeps-theme-and-focus.png'), fullPage: true });
  });

  for (const settingsViewport of [
    { width: 1180, height: 900 },
    { width: 820, height: 760 },
    { width: 390, height: 760 },
  ]) {
    test(`settings remain legible and accessible at ${settingsViewport.width}px`, async ({ page }) => {
      test.setTimeout(60_000);
      await openArtifact(page, settingsViewport.width, settingsViewport.height);
      const settings = page.locator('details[data-rail-tool="settings"]');
      await settings.locator(':scope > summary').click();

      for (const theme of ['light', 'dark', 'claude-light', 'claude-dark'] as const) {
        await settings.locator(`label[data-theme-choice="${theme}"]`).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.waitForTimeout(180);
        // The desktop-theme audit above owns whole-workbench contrast. Keep this
        // cross-browser guard scoped to the Settings surface it is exercising.
        const results = await new AxeBuilder({ page })
          .include('details[data-rail-tool="settings"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(results.violations, `${theme} settings accessibility violations at ${settingsViewport.width}px`).toEqual([]);
        if (theme === 'claude-light' || theme === 'claude-dark') {
          await page.screenshot({
            path: path.join(outputDir, `settings-${theme}-${settingsViewport.width}x${settingsViewport.height}.png`),
            fullPage: true,
          });
        }
      }
    });
  }

  test('floating Translation window moves, resizes, and restores focus', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    const toggle = page.getByRole('button', { name: 'Translations window off' });
    await toggle.click();

    const dialog = page.getByRole('dialog', { name: 'Translations' });
    await expect(dialog).toBeVisible();
    const header = dialog.locator('.motif-cs-window-head');
    const resizeHandle = dialog.getByRole('button', { name: /Resize Translations window in 2 dimensions/ });
    const beforeMove = (await dialog.boundingBox())!;
    const headerBox = (await header.boundingBox())!;
    await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + headerBox.width / 2 - 90, headerBox.y + headerBox.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    const afterMove = (await dialog.boundingBox())!;
    expect(afterMove.x).toBeLessThan(beforeMove.x - 60);
    expect(afterMove.y).toBeLessThan(beforeMove.y - 40);

    const resizeBox = (await resizeHandle.boundingBox())!;
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 80, resizeBox.y + resizeBox.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    const afterResize = (await dialog.boundingBox())!;
    expect(afterResize.width).toBeGreaterThan(afterMove.width + 60);
    expect(afterResize.height).toBeGreaterThan(afterMove.height + 40);

    await header.focus();
    await page.keyboard.press('Alt+ArrowLeft');
    expect((await dialog.boundingBox())!.x).toBeLessThan(afterResize.x);
    await resizeHandle.focus();
    await page.keyboard.press('Shift+ArrowRight');
    expect((await dialog.boundingBox())!.width).toBeGreaterThan(afterResize.width + 15);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test('compact pinned workspace scrolls every pane and releases a hidden Map lane', async ({ page }) => {
    await openArtifact(page, 820, 620);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();

    const main = page.locator('.motif-cs-main');
    await expect(main).toHaveAttribute('data-tools-pinned', 'true');
    expect(await page.locator('.motif-cs-sidebar').evaluate((element) => getComputedStyle(element).overflow)).toBe('hidden');
    expect(await page.locator('.motif-cs-inventory-groups').evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
    for (const selector of ['.motif-cs-sequence-column', '.motif-cs-map-column', '.motif-cs-inspector']) {
      const overflow = await page.locator(selector).evaluate((element) => getComputedStyle(element).overflow);
      expect(['auto', 'scroll']).toContain(overflow);
    }
    await page.screenshot({ path: path.join(outputDir, 'compact-pinned-820x620.png'), fullPage: true });

    await page.locator('.motif-cs-pane-switcher .motif-cs-pane-toggle').filter({ hasText: 'Map' }).click();
    await expect(main).toHaveAttribute('data-map-hidden', 'true');
    const mainBox = await main.boundingBox();
    const sequenceBox = await page.locator('.motif-cs-sequence-column').boundingBox();
    const toolsBox = await page.locator('.motif-cs-inspector').boundingBox();
    expect(mainBox && sequenceBox && toolsBox).toBeTruthy();
    expect(sequenceBox!.x + sequenceBox!.width).toBeGreaterThan(toolsBox!.x - 12);
    await page.screenshot({ path: path.join(outputDir, 'compact-map-hidden-820x620.png'), fullPage: true });
  });

  test('selection actions stay in a stable scrollable dock at narrow pane widths', async ({ page }) => {
    await openArtifact(page, 680, 760);
    const actionDock = page.locator('.motif-cs-selection-actions');
    const styles = await actionDock.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { overflowX: computed.overflowX, flexWrap: computed.flexWrap };
    });
    expect(styles.overflowX).toBe('auto');
    expect(styles.flexWrap).toBe('nowrap');
  });

  test('phone layout bounds the circular map and keeps compact controls on one accessible row', async ({ page }) => {
    await openArtifact(page, 320, 568);

    const rootGeometry = await page.evaluate(() => ({
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));
    expect(rootGeometry.documentScrollWidth).toBeLessThanOrEqual(rootGeometry.documentClientWidth + 1);
    expect(rootGeometry.bodyScrollWidth).toBeLessThanOrEqual(rootGeometry.bodyClientWidth + 1);

    const mapFrame = (await page.locator('.motif-cs-map-frame[data-map-mode="circular"]').boundingBox())!;
    expect(mapFrame.height).toBeLessThanOrEqual(460);

    const toolbarGeometry = await page.locator('.motif-cs-edit-toolbar').evaluate((toolbar) => {
      const computed = getComputedStyle(toolbar);
      const groups = Array.from(toolbar.children, (child) => child.getBoundingClientRect());
      return {
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
        overflowX: computed.overflowX,
        flexWrap: computed.flexWrap,
        groupTops: groups.map((rect) => Math.round(rect.top)),
      };
    });
    expect(toolbarGeometry.overflowX).toBe('auto');
    expect(toolbarGeometry.flexWrap).toBe('nowrap');
    expect(Math.max(...toolbarGeometry.groupTops) - Math.min(...toolbarGeometry.groupTops)).toBeLessThanOrEqual(2);
    expect(
      toolbarGeometry.scrollWidth <= toolbarGeometry.clientWidth + 1 || toolbarGeometry.overflowX === 'auto',
    ).toBe(true);

    const actionGeometry = await page.locator('.motif-cs-selection-actions').evaluate((actions) => ({
      clientWidth: actions.clientWidth,
      scrollWidth: actions.scrollWidth,
      overflowX: getComputedStyle(actions).overflowX,
    }));
    expect(actionGeometry.overflowX).toBe('auto');
    expect(actionGeometry.scrollWidth <= actionGeometry.clientWidth + 1 || actionGeometry.overflowX === 'auto').toBe(true);

    await expect(page.getByRole('button', { name: 'Replace typing mode' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Insert typing mode' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Standard sequence view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Detail sequence view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Complement strand' })).toBeVisible();
  });

  test('phone Tools drawer stays anchored and returns cleanly to its rail', async ({ page }) => {
    await openArtifact(page, 390, 760);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();

    const drawer = page.locator('.motif-cs-inspector');
    const exportSummary = page.locator('.motif-cs-sequence-tools-panel > summary');
    await exportSummary.scrollIntoViewIfNeeded();
    const topbarBox = (await page.locator('.motif-cs-topbar').boundingBox())!;
    const drawerBox = (await drawer.boundingBox())!;
    expect(drawerBox.y).toBeCloseTo(topbarBox.y + topbarBox.height, 0);
    expect(drawerBox.y + drawerBox.height).toBeCloseTo(760, 0);

    const minimize = drawer.getByRole('button', { name: 'Minimize tools panel to rail' });
    await expect(minimize).toBeVisible();
    await minimize.click();
    await expect(toolsToggle).toHaveAttribute('aria-pressed', 'false');

    const railBox = (await drawer.boundingBox())!;
    expect(railBox.width).toBeCloseTo(48, 0);
    expect(railBox.y).toBeCloseTo(topbarBox.y + topbarBox.height, 0);
    const summaryBox = (await exportSummary.boundingBox())!;
    expect(await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit?.closest('.motif-cs-sequence-tools-panel > summary'));
    }, { x: summaryBox.x + summaryBox.width / 2, y: summaryBox.y + summaryBox.height / 2 })).toBe(true);
    await exportSummary.click();
    await expect(page.locator('.motif-cs-sequence-tools-panel')).toHaveAttribute('open', '');
  });

  test('683x384 preserves useful Sequence space and scrolls to the lower pane row', async ({ page }) => {
    await openArtifact(page, 683, 384);
    const main = page.locator('.motif-cs-main');
    const initial = await main.evaluate((element) => {
      const mainRect = element.getBoundingClientRect();
      const sequenceRect = element.querySelector<HTMLElement>('.motif-cs-sequence-column')!.getBoundingClientRect();
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
        visibleSequenceHeight: Math.max(0, Math.min(mainRect.bottom, sequenceRect.bottom) - Math.max(mainRect.top, sequenceRect.top)),
      };
    });
    expect(initial.overflowY).toBe('auto');
    expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
    expect(initial.visibleSequenceHeight).toBeGreaterThan(40);

    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const lowerRowVisibleHeight = await main.evaluate((element) => {
      const mainRect = element.getBoundingClientRect();
      const mapRect = element.querySelector<HTMLElement>('.motif-cs-map-column')!.getBoundingClientRect();
      return Math.max(0, Math.min(mainRect.bottom, mapRect.bottom) - Math.max(mainRect.top, mapRect.top));
    });
    expect(lowerRowVisibleHeight).toBeGreaterThan(40);
  });

  test('desktop Tools rail stays 48px when Sequence is hidden', async ({ page }) => {
    await openArtifact(page, 1536, 820);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) === 'true') await toolsToggle.click();
    await page.locator('[data-pane-toggle="sequence"]').click();

    await expect(page.locator('.motif-cs-main')).toHaveAttribute('data-sequence-hidden', 'true');
    await expect(page.locator('.motif-cs-sequence-column')).toHaveCount(0);
    expect(Math.round((await page.locator('.motif-cs-inspector').boundingBox())!.width)).toBe(48);
    await expect(toolsToggle.locator('.motif-cs-pane-state')).toHaveText('Rail');
    const mainWidth = await page.locator('.motif-cs-main').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(mainWidth.scrollWidth).toBeLessThanOrEqual(mainWidth.clientWidth + 2);
  });

  test('Shift+Arrow extends a sequence selection from the keyboard', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    const sequence = page.locator('.motif-cs-sequence');
    await sequence.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');

    await expect(page.locator('.motif-cs-selection-name')).toHaveText('1-2 (2)');
    await expect(page.locator('.motif-cs-selection-bar')).not.toHaveAttribute('data-empty', 'true');
    await expect(page.locator('.motif-cs-seq-hl').first()).toBeVisible();
    await expect(sequence).toBeFocused();
  });

  test('compact resize handles keep rendered geometry and ARIA in sync', async ({ page }) => {
    await openArtifact(page, 640, 500);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();

    const inventory = page.locator('.motif-cs-sidebar');
    const inventoryResize = page.getByRole('separator', { name: 'Resize inventory pane' });
    await expect(inventoryResize).toBeVisible();
    await expect(inventoryResize).toHaveAttribute('aria-valuemax', '280');
    const inventoryBefore = (await inventory.boundingBox())!;
    const inventoryHandle = (await inventoryResize.boundingBox())!;
    await page.mouse.move(inventoryHandle.x + inventoryHandle.width / 2, inventoryHandle.y + inventoryHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(inventoryHandle.x + inventoryHandle.width / 2 + 40, inventoryHandle.y + inventoryHandle.height / 2);
    await page.mouse.up();
    const inventoryAfterPointer = (await inventory.boundingBox())!;
    expect(inventoryAfterPointer.width).toBeGreaterThan(inventoryBefore.width + 30);
    await expect(inventoryResize).toHaveAttribute('aria-valuenow', String(Math.round(inventoryAfterPointer.width)));
    await inventoryResize.focus();
    await page.keyboard.press('Shift+ArrowRight');
    expect(Math.round((await inventory.boundingBox())!.width)).toBe(280);
    await expect(inventoryResize).toHaveAttribute('aria-valuenow', '280');

    const toolsResize = page.getByRole('separator', { name: 'Resize tools pane' });
    await expect(toolsResize).toBeVisible();
    await expect(toolsResize).toHaveAttribute('aria-valuemin', '240');
    await expect(toolsResize).toHaveAttribute('aria-valuemax', '320');
    const tools = page.locator('.motif-cs-inspector');
    const toolsBefore = (await tools.boundingBox())!;
    const toolsHandle = (await toolsResize.boundingBox())!;
    await page.mouse.move(toolsHandle.x + toolsHandle.width / 2, toolsHandle.y + toolsHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(toolsHandle.x + toolsHandle.width / 2 - 30, toolsHandle.y + toolsHandle.height / 2);
    await page.mouse.up();
    const toolsAfterPointer = (await tools.boundingBox())!;
    expect(toolsAfterPointer.width).toBeGreaterThan(toolsBefore.width + 20);
    await expect(toolsResize).toHaveAttribute('aria-valuenow', String(Math.round(toolsAfterPointer.width)));

    const sequence = page.locator('.motif-cs-sequence-column');
    const rowResize = page.getByRole('separator', { name: 'Resize stacked sequence pane' });
    await expect(rowResize).toBeVisible();
    const beforeHeight = Math.round((await sequence.boundingBox())!.height);
    await expect(rowResize).toHaveAttribute('aria-valuenow', String(beforeHeight));
    await rowResize.focus();
    await page.keyboard.press('ArrowUp');
    const afterHeight = Math.round((await sequence.boundingBox())!.height);
    expect(afterHeight).toBeLessThan(beforeHeight);
    await expect(rowResize).toHaveAttribute('aria-valuenow', String(afterHeight));

    const main = page.locator('.motif-cs-main');
    const dimensions = await main.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 2);
  });

  test('640px two-row layout exposes only the resize axes rendered on screen', async ({ page }) => {
    await openArtifact(page, 640, 700);

    await expect(page.getByRole('separator', { name: 'Resize stacked inventory pane' })).toBeHidden();
    const inventory = page.locator('.motif-cs-sidebar');
    const inventoryResize = page.getByRole('separator', { name: 'Resize inventory pane' });
    await expect(inventoryResize).toBeVisible();
    await expect(inventoryResize).toHaveAttribute('aria-orientation', 'vertical');
    await expect(inventoryResize).toHaveAttribute('title', /Left and Right Arrow/);
    const beforeWidth = Math.round((await inventory.boundingBox())!.width);
    await expect(inventoryResize).toHaveAttribute('aria-valuenow', String(beforeWidth));

    await inventoryResize.focus();
    await page.keyboard.press('ArrowRight');
    const afterWidth = Math.round((await inventory.boundingBox())!.width);
    expect(afterWidth).toBeGreaterThan(beforeWidth);
    await expect(inventoryResize).toHaveAttribute('aria-valuenow', String(afterWidth));

    const rowResize = page.getByRole('separator', { name: 'Resize stacked sequence pane' });
    await expect(rowResize).toBeVisible();
    await expect(rowResize).toHaveAttribute('aria-orientation', 'horizontal');
  });

  test('Tools rail preserves the intermediate two-row workspace and gives Map the released width', async ({ page }) => {
    for (const width of [700, 1024, 1180, 1400, 1535]) {
      await openArtifact(page, width, 820);
      const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
      if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();

      const inventory = page.locator('.motif-cs-sidebar');
      const sequence = page.locator('.motif-cs-sequence-column');
      const map = page.locator('.motif-cs-map-column');
      const tools = page.locator('.motif-cs-inspector');
      const pinned = {
        inventory: (await inventory.boundingBox())!,
        sequence: (await sequence.boundingBox())!,
        map: (await map.boundingBox())!,
        tools: (await tools.boundingBox())!,
      };
      expect(Math.abs(pinned.inventory.y - pinned.sequence.y)).toBeLessThanOrEqual(2);
      expect(pinned.map.y).toBeGreaterThan(pinned.sequence.y + pinned.sequence.height - 2);
      expect(Math.abs(pinned.map.y - pinned.tools.y)).toBeLessThanOrEqual(2);

      await toolsToggle.click();
      await expect(page.locator('.motif-cs-main')).not.toHaveAttribute('data-tools-pinned', 'true');
      const rail = {
        inventory: (await inventory.boundingBox())!,
        sequence: (await sequence.boundingBox())!,
        map: (await map.boundingBox())!,
        tools: (await tools.boundingBox())!,
      };
      expect(Math.abs(rail.inventory.y - pinned.inventory.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(rail.inventory.width - pinned.inventory.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(rail.sequence.y - pinned.sequence.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(rail.map.y - pinned.map.y)).toBeLessThanOrEqual(2);
      expect(rail.map.width).toBeGreaterThan(pinned.map.width + 150);
      expect(Math.round(rail.tools.width)).toBe(48);
      await expect(toolsToggle.locator('.motif-cs-pane-state')).toHaveText('Rail');
      await expect(page.getByRole('separator', { name: 'Resize stacked sequence pane' })).toBeVisible();

      if (width === 1180) {
        await page.screenshot({ path: path.join(outputDir, 'stable-tools-rail-1180x820.png'), fullPage: true });
      }

      await toolsToggle.click();
      await expect(page.locator('.motif-cs-main')).toHaveAttribute('data-tools-pinned', 'true');
      const reopened = {
        inventory: (await inventory.boundingBox())!,
        sequence: (await sequence.boundingBox())!,
        map: (await map.boundingBox())!,
        tools: (await tools.boundingBox())!,
      };
      expect(Math.abs(reopened.inventory.width - pinned.inventory.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(reopened.sequence.width - pinned.sequence.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(reopened.map.width - pinned.map.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(reopened.tools.width - pinned.tools.width)).toBeLessThanOrEqual(2);

    }
  });

  test('pane reorder affordances match responsive behavior and record tabs support arrows', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    const compactPaneControls = page.locator('.motif-cs-pane-switcher .motif-cs-pane-toggle');
    await expect(compactPaneControls.first()).toHaveAttribute('draggable', 'false');
    await expect(page.locator('.motif-cs-pane-switcher')).toHaveAttribute('aria-label', /stable workspace arrangement/);

    const activeTab = page.locator('.motif-cs-record-tab[data-active="true"]');
    await activeTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.motif-cs-record-tab').filter({ hasText: 'pBR322' }).first()).toHaveAttribute('data-active', 'true');
    await expect(page.locator('.motif-cs-record-tab').filter({ hasText: 'pBR322' }).first()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('.motif-cs-record-tab').first()).toBeFocused();

    await page.setViewportSize({ width: 1600, height: 820 });
    await expect(compactPaneControls.first()).toHaveAttribute('draggable', 'true');
    await expect(page.locator('.motif-cs-pane-switcher')).toHaveAttribute('aria-label', /Drag buttons to reorder/);

    const inventoryControl = compactPaneControls.filter({ hasText: 'Inventory' });
    const mapControl = compactPaneControls.filter({ hasText: 'Map' });
    const sequenceBeforeDrag = (await page.locator('.motif-cs-sequence-column').boundingBox())!;
    const inventoryBeforeDrag = (await page.locator('.motif-cs-sidebar').boundingBox())!;
    expect(inventoryBeforeDrag.x).toBeLessThan(sequenceBeforeDrag.x);
    await inventoryControl.dragTo(mapControl);
    const sequenceAfterDrag = (await page.locator('.motif-cs-sequence-column').boundingBox())!;
    const inventoryAfterDrag = (await page.locator('.motif-cs-sidebar').boundingBox())!;
    expect(inventoryAfterDrag.x).toBeGreaterThan(sequenceAfterDrag.x);
  });

  test('Alt+Shift+Arrow reorders panes at the 1536px desktop boundary', async ({ page }) => {
    await openArtifact(page, 1536, 820);
    const paneControls = page.locator('.motif-cs-pane-switcher .motif-cs-pane-toggle[data-pane-toggle]');
    const inventoryControl = page.locator('.motif-cs-pane-switcher .motif-cs-pane-toggle[data-pane-toggle="inventory"]');
    await expect(inventoryControl).toHaveAttribute('draggable', 'true');
    await inventoryControl.focus();

    await page.keyboard.press('Alt+Shift+ArrowRight');

    await expect(inventoryControl).toBeFocused();
    expect(await paneControls.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-pane-toggle')))).toEqual([
      'sequence',
      'inventory',
      'map',
      'tools',
    ]);
    const inventoryBox = (await page.locator('.motif-cs-sidebar').boundingBox())!;
    const sequenceBox = (await page.locator('.motif-cs-sequence-column').boundingBox())!;
    expect(inventoryBox.x).toBeGreaterThan(sequenceBox.x);
  });

  test('collapsing a pane restores focus and the last pane collapse is announced', async ({ page }) => {
    await openArtifact(page, 1536, 820);
    const inventoryToggle = page.locator('[data-pane-toggle="inventory"]');
    await page.getByRole('button', { name: 'Collapse inventory pane' }).click();
    await expect(inventoryToggle).toBeFocused();
    await expect(inventoryToggle).toHaveAttribute('aria-pressed', 'false');

    await page.locator('[data-pane-toggle="map"]').click();
    const lastPaneCollapse = page.getByRole('button', { name: /Sequence pane cannot be collapsed/ });
    await expect(lastPaneCollapse).toBeDisabled();
    await expect(lastPaneCollapse).toHaveAttribute('title', 'At least one content pane must stay visible');
  });

  test('empty inventory exposes a named region without dangling tab semantics', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => {
      (window as unknown as { motifRenderInventory: (records: unknown[]) => void }).motifRenderInventory([]);
    });

    const workspace = page.getByRole('region', { name: 'Sequence workspace; no records open' });
    await expect(workspace).toBeVisible();
    await expect(workspace).not.toHaveAttribute('aria-labelledby');
    await expect(page.locator('.motif-cs-record-tabs')).not.toHaveAttribute('role', 'tablist');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByText('No records yet', { exact: true })).toBeVisible();
    await expect(page.locator('.motif-cs-edit-toolbar')).toHaveCount(0);
    await expect(page.locator('.motif-cs-selection-bar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Translations unavailable; no active record' })).toBeDisabled();

    const results = await new AxeBuilder({ page })
      .include('.motif-cs-shell')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, 'empty-inventory accessibility violations').toEqual([]);
  });

  test('the roomy desktop bridge removes the 1599-to-1600 topology cliff', async ({ page }) => {
    type PaneRect = { x: number; y: number; width: number; height: number };
    const snapshots: Record<number, { inventory: PaneRect; sequence: PaneRect; map: PaneRect; tools: PaneRect }> = {};
    for (const width of [1535, 1536, 1599, 1600]) {
      await openArtifact(page, width, 820);
      const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
      if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();
      snapshots[width] = await page.evaluate(() => {
        const rect = (selector: string) => {
          const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        };
        return {
          inventory: rect('.motif-cs-sidebar'),
          sequence: rect('.motif-cs-sequence-column'),
          map: rect('.motif-cs-map-column'),
          tools: rect('.motif-cs-inspector'),
        };
      });
    }

    expect(snapshots[1535].map.y).toBeGreaterThan(snapshots[1535].sequence.y + snapshots[1535].sequence.height - 2);
    for (const width of [1536, 1599, 1600]) {
      expect(Math.abs(snapshots[width].inventory.y - snapshots[width].sequence.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(snapshots[width].sequence.y - snapshots[width].map.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(snapshots[width].map.y - snapshots[width].tools.y)).toBeLessThanOrEqual(2);
    }
    expect(Math.abs(snapshots[1599].map.y - snapshots[1600].map.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(snapshots[1599].map.height - snapshots[1600].map.height)).toBeLessThanOrEqual(2);
  });

  test('all nonempty pane combinations remain bounded with Tools expanded or railed', async ({ page }) => {
    test.setTimeout(60_000);
    const paneKeys = [
      { label: 'Inventory', selector: '.motif-cs-sidebar' },
      { label: 'Sequence', selector: '.motif-cs-sequence-column' },
      { label: 'Map', selector: '.motif-cs-map-column' },
    ] as const;

    for (const width of [640, 820, 1180, 1535, 1536, 1600]) {
      await openArtifact(page, width, 820);
      const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
      for (let mask = 1; mask < 8; mask += 1) {
        // Open desired panes before closing others so the at-least-one-visible
        // guard never blocks a legitimate transition between single-pane states.
        for (const shouldBeVisible of [true, false]) {
          for (let index = 0; index < paneKeys.length; index += 1) {
            if (Boolean(mask & (1 << index)) !== shouldBeVisible) continue;
            const control = page.locator('.motif-cs-pane-switcher .motif-cs-pane-toggle').filter({ hasText: paneKeys[index].label });
            const isVisible = (await control.getAttribute('aria-pressed')) === 'true';
            if (isVisible !== shouldBeVisible) await control.click();
          }
        }

        for (const toolsPinned of [true, false]) {
          const isPinned = (await toolsToggle.getAttribute('aria-pressed')) === 'true';
          if (isPinned !== toolsPinned) await toolsToggle.click();

          const geometry = await page.locator('.motif-cs-main').evaluate((main, selectors) => {
            const mainRect = main.getBoundingClientRect();
            const panes = selectors.map((selector) => {
              const element = main.querySelector<HTMLElement>(selector);
              if (!element || element.offsetParent === null) return null;
              const rect = element.getBoundingClientRect();
              return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
            }).filter((pane): pane is NonNullable<typeof pane> => pane !== null);
            return {
              main: { left: mainRect.left, right: mainRect.right, top: mainRect.top, bottom: mainRect.bottom },
              clientWidth: main.clientWidth,
              scrollWidth: main.scrollWidth,
              clientHeight: main.clientHeight,
              scrollHeight: main.scrollHeight,
              panes,
            };
          }, [...paneKeys.map((pane) => pane.selector), '.motif-cs-inspector']);

          expect(geometry.scrollWidth, `${width}px mask ${mask} tools ${toolsPinned ? 'open' : 'rail'}`).toBeLessThanOrEqual(geometry.clientWidth + 2);
          expect(geometry.scrollHeight, `${width}px mask ${mask} tools ${toolsPinned ? 'open' : 'rail'}`).toBeLessThanOrEqual(geometry.clientHeight + 2);
          for (const pane of geometry.panes) {
            expect(pane.width, `${pane.selector} width at ${width}px mask ${mask}`).toBeGreaterThan(40);
            expect(pane.height, `${pane.selector} height at ${width}px mask ${mask}`).toBeGreaterThan(40);
            expect(pane.left).toBeGreaterThanOrEqual(geometry.main.left - 2);
            expect(pane.right).toBeLessThanOrEqual(geometry.main.right + 2);
            expect(pane.top).toBeGreaterThanOrEqual(geometry.main.top - 2);
            expect(pane.bottom).toBeLessThanOrEqual(geometry.main.bottom + 2);
          }
          for (let first = 0; first < geometry.panes.length; first += 1) {
            for (let second = first + 1; second < geometry.panes.length; second += 1) {
              const a = geometry.panes[first];
              const b = geometry.panes[second];
              const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              expect(
                overlapWidth > 2 && overlapHeight > 2,
                `${a.selector} overlaps ${b.selector} by ${overlapWidth.toFixed(1)}×${overlapHeight.toFixed(1)} at ${width}px mask ${mask} tools ${toolsPinned ? 'open' : 'rail'}`,
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  for (const width of [640, 767]) {
    test(`Export & Copy remains pointer-clickable at ${width}px with Tools pinned or railed`, async ({ page }) => {
      for (const toolsPinned of [false, true]) {
        await openArtifact(page, width, 700);
        const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
        const isPinned = (await toolsToggle.getAttribute('aria-pressed')) === 'true';
        if (isPinned !== toolsPinned) await toolsToggle.click();

        const panel = page.locator('.motif-cs-sequence-tools-panel');
        const summary = panel.locator(':scope > summary');
        await summary.scrollIntoViewIfNeeded();
        await expect(summary).toBeVisible();
        const summaryBox = (await summary.boundingBox())!;
        const ownsHitTarget = await page.evaluate(({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit?.closest('.motif-cs-sequence-tools-panel > summary'));
        }, { x: summaryBox.x + summaryBox.width / 2, y: summaryBox.y + summaryBox.height / 2 });
        expect(ownsHitTarget, `${width}px Tools ${toolsPinned ? 'pinned' : 'rail'} summary hit target`).toBe(true);

        await summary.click();
        await expect(panel).toHaveAttribute('open', '');
        await summary.click();
        await expect(panel).not.toHaveAttribute('open', '');
      }
    });
  }

  for (const { width, toolsPinned } of [
    { width: 640, toolsPinned: true },
    { width: 640, toolsPinned: false },
    { width: 390, toolsPinned: false },
  ]) {
    test(`opening Export & Copy reveals pointer-reachable controls at ${width}px with Tools ${toolsPinned ? 'pinned' : 'railed'}`, async ({ page }) => {
      await openArtifact(page, width, width === 640 ? 700 : 760);
      const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
      const isPinned = (await toolsToggle.getAttribute('aria-pressed')) === 'true';
      if (isPinned !== toolsPinned) await toolsToggle.click();

      const column = page.locator('.motif-cs-sequence-column');
      const panel = page.locator('.motif-cs-sequence-tools-panel');
      const summary = panel.locator(':scope > summary');
      await summary.scrollIntoViewIfNeeded();
      const scrollBefore = await column.evaluate((element) => element.scrollTop);
      await summary.click();
      await expect(panel).toHaveAttribute('open', '');

      const summaryCopy = panel.getByRole('button', { name: 'Summary', exact: true });
      await expect(summaryCopy).toBeVisible();
      await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBeGreaterThan(scrollBefore);
      const copyBox = (await summaryCopy.boundingBox())!;
      expect(await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit?.closest('.motif-cs-export-body'));
      }, { x: copyBox.x + copyBox.width / 2, y: copyBox.y + copyBox.height / 2 })).toBe(true);
      await summaryCopy.click({ trial: true });

      const genbankCopy = panel.getByRole('button', { name: 'GenBank', exact: true });
      await expect(genbankCopy).toBeVisible();
      const genbankBox = (await genbankCopy.boundingBox())!;
      expect(await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit?.closest('button')?.textContent?.includes('GenBank'));
      }, { x: genbankBox.x + genbankBox.width / 2, y: genbankBox.y + genbankBox.height / 2 })).toBe(true);
      await genbankCopy.click({ trial: true });

      const compactExportGeometry = await panel.evaluate((element) => {
        const body = element.querySelector<HTMLElement>('.motif-cs-export-body')!;
        const column = element.closest<HTMLElement>('.motif-cs-sequence-column')!;
        const rows = [...element.querySelectorAll<HTMLElement>('.motif-cs-export-row')].map((row) => {
          const label = row.querySelector<HTMLElement>('.motif-cs-export-label')!.getBoundingClientRect();
          const actions = row.querySelector<HTMLElement>('.motif-cs-export-actions')!.getBoundingClientRect();
          return {
            clientHeight: row.clientHeight,
            scrollHeight: row.scrollHeight,
            separated: label.right <= actions.left + 1
              || actions.right <= label.left + 1
              || label.bottom <= actions.top + 1
              || actions.bottom <= label.top + 1,
          };
        });
        const buttons = [...element.querySelectorAll<HTMLButtonElement>('.motif-cs-export-row button')].map((button) => {
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return {
            name: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
            insideColumn: box.top >= column.getBoundingClientRect().top - 1
              && box.bottom <= column.getBoundingClientRect().bottom + 1,
            ownsCenter: hit === button || button.contains(hit),
          };
        });
        return {
          dataResized: element.getAttribute('data-resized'),
          bodyClientHeight: body.clientHeight,
          bodyScrollHeight: body.scrollHeight,
          rows,
          buttons,
        };
      });
      expect(compactExportGeometry.dataResized).toBeNull();
      expect(compactExportGeometry.bodyScrollHeight).toBeLessThanOrEqual(compactExportGeometry.bodyClientHeight + 1);
      expect(compactExportGeometry.rows.every((row) => row.scrollHeight <= row.clientHeight + 1)).toBe(true);
      expect(compactExportGeometry.rows.every((row) => row.separated)).toBe(true);
      expect(compactExportGeometry.buttons.map((button) => button.name)).toEqual([
        'Summary',
        'Sequence',
        'FASTA',
        'GenBank',
        'Complement',
        'Copy rev comp',
        'New rev comp',
      ]);
      expect(compactExportGeometry.buttons.every((button) => button.insideColumn && button.ownsCenter)).toBe(true);

      const quickCopyBox = (await panel.locator('.motif-cs-export-row').first().boundingBox())!;
      const nucleotideBox = (await panel.locator('.motif-cs-export-row').nth(1).boundingBox())!;
      expect(quickCopyBox.y + quickCopyBox.height).toBeLessThanOrEqual(nucleotideBox.y + 1);
      if (width === 640 && !toolsPinned) {
        await page.screenshot({ path: path.join(outputDir, 'export-controls-640x700-railed.png'), fullPage: true });
      }
      for (const action of ['Complement', 'Copy rev comp', 'New rev comp']) {
        const button = panel.getByRole('button', { name: action, exact: true });
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeVisible();
        await button.click({ trial: true });
      }

      const format = panel.locator('select[name="export-format"]');
      await format.scrollIntoViewIfNeeded();
      const formatBox = (await format.boundingBox())!;
      expect(await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit?.closest('select[name="export-format"]'));
      }, { x: formatBox.x + formatBox.width / 2, y: formatBox.y + formatBox.height / 2 })).toBe(true);
      await format.click({ trial: true });

      const preview = panel.getByLabel('Selected export preview');
      await preview.scrollIntoViewIfNeeded();
      const previewBox = (await preview.boundingBox())!;
      expect(await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit?.closest('textarea[aria-label="Selected export preview"]'));
      }, { x: previewBox.x + previewBox.width / 2, y: previewBox.y + Math.min(previewBox.height / 2, 12) })).toBe(true);
      await preview.click({ trial: true });
    });
  }

  test('an open Export panel switches cleanly between compact flow and wide resizing', async ({ page }) => {
    await openArtifact(page, 640, 700);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) === 'true') await toolsToggle.click();

    const panel = page.locator('.motif-cs-sequence-tools-panel');
    const summary = panel.locator(':scope > summary');
    await summary.scrollIntoViewIfNeeded();
    await summary.click();
    await expect(panel).not.toHaveAttribute('data-resized', 'true');
    await expect.poll(() => panel.locator('.motif-cs-export-body').evaluate((body) => body.scrollHeight - body.clientHeight)).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(panel).toHaveAttribute('data-resized', 'true');
    await expect(page.getByRole('separator', { name: 'Resize Export and Copy panel' })).toBeVisible();
    await expect.poll(() => panel.locator('.motif-cs-export-body').evaluate((body) => body.clientHeight)).toBeGreaterThan(180);

    await page.setViewportSize({ width: 1600, height: 360 });
    await expect(panel).toHaveAttribute('data-resized', 'true');
    await expect.poll(() => panel.locator('.motif-cs-export-body').evaluate((body) => body.scrollHeight - body.clientHeight)).toBeGreaterThan(20);
    await panel.locator('select[name="export-format"]').scrollIntoViewIfNeeded();
    await panel.locator('select[name="export-format"]').click({ trial: true });

    await page.setViewportSize({ width: 640, height: 700 });
    await expect(panel).not.toHaveAttribute('data-resized', 'true');
    await expect.poll(() => panel.locator('.motif-cs-export-body').evaluate((body) => body.scrollHeight - body.clientHeight)).toBeLessThanOrEqual(1);
    for (const action of ['Summary', 'Sequence', 'FASTA', 'GenBank', 'Complement', 'Copy rev comp', 'New rev comp']) {
      const button = panel.getByRole('button', { name: action, exact: true });
      const box = (await button.boundingBox())!;
      expect(await page.evaluate(({ x, y, name }) => {
        const hit = document.elementFromPoint(x, y);
        return hit?.closest('button')?.textContent?.trim() === name;
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2, name: action })).toBe(true);
    }
  });

  test('intermediate-height layout keeps Inventory resizable and Map stable when Tools collapses', async ({ page }) => {
    await openArtifact(page, 1180, 560);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();

    const inventory = page.locator('.motif-cs-sidebar');
    const sequence = page.locator('.motif-cs-sequence-column');
    const map = page.locator('.motif-cs-map-column');
    const tools = page.locator('.motif-cs-inspector');
    const inventoryResize = page.getByRole('separator', { name: 'Resize inventory pane' });
    const inventoryBefore = (await inventory.boundingBox())!;
    const inventoryHandle = (await inventoryResize.boundingBox())!;
    await page.mouse.move(inventoryHandle.x + inventoryHandle.width / 2, inventoryHandle.y + inventoryHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(inventoryHandle.x + inventoryHandle.width / 2 + 55, inventoryHandle.y + inventoryHandle.height / 2, { steps: 5 });
    await page.mouse.up();
    expect((await inventory.boundingBox())!.width).toBeGreaterThan(inventoryBefore.width + 35);

    const pinned = {
      inventory: (await inventory.boundingBox())!,
      sequence: (await sequence.boundingBox())!,
      map: (await map.boundingBox())!,
      tools: (await tools.boundingBox())!,
    };
    await toolsToggle.click();
    const rail = {
      inventory: (await inventory.boundingBox())!,
      sequence: (await sequence.boundingBox())!,
      map: (await map.boundingBox())!,
      tools: (await tools.boundingBox())!,
    };
    expect(Math.abs(rail.inventory.y - pinned.inventory.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(rail.sequence.y - pinned.sequence.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(rail.map.y - pinned.map.y)).toBeLessThanOrEqual(2);
    expect(rail.map.width).toBeGreaterThan(pinned.map.width + 150);
    expect(Math.round(rail.tools.width)).toBe(48);
    const mapFrame = (await page.locator('.motif-cs-map-frame').boundingBox())!;
    expect(mapFrame.height).toBeGreaterThanOrEqual(120);
    await expect(page.locator('.motif-cs-map-frame .motif-pm-backbone').first()).toBeVisible();
    await page.screenshot({ path: path.join(outputDir, 'stable-tools-rail-1180x560.png'), fullPage: true });
  });

  test('narrow Map-hidden layout keeps Sequence useful and Tools in a second row', async ({ page }) => {
    await openArtifact(page, 640, 500);
    const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
    if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();
    await page.locator('.motif-cs-pane-switcher .motif-cs-pane-toggle').filter({ hasText: 'Map' }).click();

    const mainBox = (await page.locator('.motif-cs-main').boundingBox())!;
    const sequenceBox = (await page.locator('.motif-cs-sequence-column').boundingBox())!;
    const toolsBox = (await page.locator('.motif-cs-inspector').boundingBox())!;
    expect(sequenceBox.width).toBeGreaterThan(380);
    expect(toolsBox.y).toBeGreaterThan(sequenceBox.y + sequenceBox.height - 2);
    expect(Math.round(toolsBox.width)).toBe(Math.round(mainBox.width));
    await expect(page.getByRole('separator', { name: 'Resize stacked sequence pane' })).toBeVisible();
  });

  test('short hybrid layout keeps the rail fixed and its row divider operable', async ({ page }) => {
    await openArtifact(page, 900, 360);
    const main = page.locator('.motif-cs-main');
    const rail = page.locator('.motif-cs-inspector');
    const mainBox = (await main.boundingBox())!;
    const railBox = (await rail.boundingBox())!;
    expect(Math.round(railBox.y)).toBe(Math.round(mainBox.y));
    expect(Math.round(railBox.height)).toBe(Math.round(mainBox.height));
    expect(await main.evaluate((element) => getComputedStyle(element).overflow)).toBe('hidden');

    const sequenceColumn = page.locator('.motif-cs-sequence-column');
    expect(await sequenceColumn.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
    expect(await page.locator('.motif-cs-sequence-panel').evaluate((element) => parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThanOrEqual(280);

    const mapColumn = (await page.locator('.motif-cs-map-column').boundingBox())!;
    const mapFrame = (await page.locator('.motif-cs-map-frame').boundingBox())!;
    expect(mapFrame.height).toBeGreaterThanOrEqual(120);
    expect(mapFrame.y).toBeGreaterThanOrEqual(mapColumn.y - 1);
    expect(mapFrame.y + mapFrame.height).toBeLessThanOrEqual(mapColumn.y + mapColumn.height + 1);
    await expect(page.locator('.motif-cs-map-frame .motif-pm-backbone').first()).toBeVisible();

    const rowResize = page.getByRole('separator', { name: 'Resize stacked sequence pane' });
    await expect(rowResize).toBeVisible();
    const beforeHeight = Math.round((await sequenceColumn.boundingBox())!.height);
    await expect(rowResize).toHaveAttribute('aria-valuenow', String(beforeHeight));
    await rowResize.focus();
    await page.keyboard.press('ArrowUp');
    expect(Math.round((await sequenceColumn.boundingBox())!.height)).toBeLessThan(beforeHeight);
  });

  test('very short compact workspaces scroll to the lower pane row', async ({ page }) => {
    await openArtifact(page, 900, 280);
    const main = page.locator('.motif-cs-main');
    const before = await main.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(before.overflowY).toBe('auto');
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const mainBox = (await main.boundingBox())!;
    const mapBox = (await page.locator('.motif-cs-map-column').boundingBox())!;
    expect(mapBox.y).toBeLessThan(mainBox.y + mainBox.height);
    expect(mapBox.y + mapBox.height).toBeLessThanOrEqual(mainBox.y + mainBox.height + 2);
  });

  test('map supports wheel pan, modifier-wheel zoom, and bidirectional drag selection', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    const mapFrame = page.locator('.motif-cs-map-frame');
    const viewport = page.locator('.motif-cs-map-frame .motif-pm-viewport');
    const svg = page.locator('.motif-cs-map-frame svg.motif-plasmid-map');
    const svgBox = await svg.boundingBox();
    expect(svgBox).toBeTruthy();
    const center = { x: svgBox!.x + svgBox!.width / 2, y: svgBox!.y + svgBox!.height / 2 };

    await svg.dispatchEvent('wheel', { deltaY: -220, clientX: center.x, clientY: center.y, ctrlKey: true });
    await expect(viewport).toHaveAttribute('transform', /scale\((?!1\))/);
    await expect(mapFrame.locator('.motif-cs-map-hint')).toContainText('%');

    await page.getByRole('button', { name: 'Reset map view' }).click();
    await expect(viewport).not.toHaveAttribute('transform', /scale/);
    await svg.dispatchEvent('wheel', { deltaY: 180, clientX: center.x, clientY: center.y });
    await expect(viewport).toHaveAttribute('transform', /translate/);

    await page.getByRole('button', { name: 'Reset map view' }).click();
    const radius = Math.min(svgBox!.width, svgBox!.height) * 0.28;
    await page.mouse.move(center.x, center.y - radius);
    await page.mouse.down();
    await page.mouse.move(center.x + radius, center.y, { steps: 8 });
    await page.mouse.up();
    const clockwise = await mapFrame.locator('.motif-cs-map-hint').textContent();
    expect(clockwise).toContain('range');

    await page.mouse.move(center.x, center.y - radius);
    await page.mouse.down();
    await page.mouse.move(center.x - radius, center.y, { steps: 8 });
    await page.mouse.up();
    const counterclockwise = await mapFrame.locator('.motif-cs-map-hint').textContent();
    expect(counterclockwise).toContain('range');
    expect(counterclockwise).not.toBe(clockwise);
  });

  test('narrow linear maps keep the range readout clear of zoom controls', async ({ page }) => {
    await openArtifact(page, 640, 700);
    await page.evaluate(() => window.motifRenderInventory?.([{
      id: 'linear-range-layout',
      name: 'Linear range layout',
      molecule: 'dna',
      topology: 'linear',
      sequence: 'ATGC'.repeat(200),
    }]));

    const mapFrame = page.locator('.motif-cs-map-frame[data-map-mode="linear"]');
    await mapFrame.scrollIntoViewIfNeeded();
    const svg = mapFrame.locator('svg.motif-plasmid-map');
    const svgBox = await svg.boundingBox();
    expect(svgBox).toBeTruthy();

    const y = svgBox!.y + svgBox!.height * 0.52;
    await page.mouse.move(svgBox!.x + svgBox!.width * 0.28, y);
    await page.mouse.down();
    await page.mouse.move(svgBox!.x + svgBox!.width * 0.55, y, { steps: 8 });
    await page.mouse.up();

    const hint = mapFrame.locator('.motif-cs-map-hint');
    await expect(hint).toContainText('range');
    const toolbarBox = (await mapFrame.locator('.motif-cs-map-toolbar').boundingBox())!;
    const hintBox = (await hint.boundingBox())!;
    expect(hintBox.x).toBeGreaterThanOrEqual(toolbarBox.x + toolbarBox.width + 8);
    expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(svgBox!.x + svgBox!.width - 8);
    await mapFrame.screenshot({ path: path.join(outputDir, 'linear-range-status-640x700.png') });
  });

  test('Alignment launcher stays readable, unobstructed, and keyboard-operable across pinned, rail, and phone layouts', async ({ page, browserName }) => {
    for (const viewport of [
      { width: 1180, height: 820 },
      { width: 640, height: 760 },
      { width: 390, height: 760 },
    ]) {
      await openArtifact(page, viewport.width, viewport.height);
      const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
      if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();

      const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
      const alignmentSummary = alignmentTool.locator(':scope > summary');
      await alignmentSummary.scrollIntoViewIfNeeded();
      if (!(await alignmentTool.getAttribute('open'))) await alignmentSummary.click();
      const launcher = alignmentTool.getByTestId('msa-open-button');
      await launcher.scrollIntoViewIfNeeded();
      await expect(launcher).toHaveAccessibleName('Open alignment workspace');

      const geometry = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('.motif-cs-alignment-tool-body')!;
        const intro = body.querySelector<HTMLElement>('.motif-cs-alignment-tool-intro')!;
        const launch = body.querySelector<HTMLElement>('[data-testid="msa-open-button"]')!;
        const boundary = body.querySelector<HTMLElement>('.motif-cs-alignment-boundary')!;
        const settings = document.querySelector<HTMLElement>('details[data-rail-tool="settings"] > summary')!;
        const bodyRect = body.getBoundingClientRect();
        const introRect = intro.getBoundingClientRect();
        const launchRect = launch.getBoundingClientRect();
        const boundaryRect = boundary.getBoundingClientRect();
        const settingsRect = settings.getBoundingClientRect();
        const hit = document.elementFromPoint(launchRect.left + launchRect.width / 2, launchRect.top + launchRect.height / 2);
        return {
          bodyClientWidth: body.clientWidth,
          bodyScrollWidth: body.scrollWidth,
          launcherClientWidth: launch.clientWidth,
          launcherScrollWidth: launch.scrollWidth,
          introBeforeLauncher: introRect.bottom <= launchRect.top + 1,
          launcherBeforeBoundary: launchRect.bottom <= boundaryRect.top + 1,
          boundaryBeforeSettings: boundaryRect.bottom <= settingsRect.top + 1,
          containedHorizontally: launchRect.left >= bodyRect.left - 1 && launchRect.right <= bodyRect.right + 1,
          launcherHit: Boolean(hit?.closest('[data-testid="msa-open-button"]')),
        };
      });
      expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.bodyClientWidth + 1);
      expect(geometry.launcherScrollWidth).toBeLessThanOrEqual(geometry.launcherClientWidth + 1);
      expect(geometry.introBeforeLauncher).toBe(true);
      expect(geometry.launcherBeforeBoundary).toBe(true);
      expect(geometry.boundaryBeforeSettings).toBe(true);
      expect(geometry.containedHorizontally).toBe(true);
      expect(geometry.launcherHit).toBe(true);
      await page.screenshot({ path: path.join(msaCampaignOutputDir, `alignment-launcher-${viewport.width}x${viewport.height}.png`) });
    }

    for (const viewport of [
      { width: 1180, height: 820 },
      { width: 640, height: 760 },
    ]) {
      await openArtifact(page, viewport.width, viewport.height);
      await page.locator('select[name="artifact-theme"]').evaluate((select) => {
        const themeSelect = select as HTMLSelectElement;
        themeSelect.value = 'claude-dark';
        themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-dark');
      const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
      if ((await toolsToggle.getAttribute('aria-pressed')) === 'true') await toolsToggle.click();

      const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
      const alignmentSummary = alignmentTool.locator(':scope > summary');
      await alignmentSummary.scrollIntoViewIfNeeded();
      await alignmentSummary.click();
      const body = alignmentTool.locator('.motif-cs-alignment-tool-body');
      const launcher = alignmentTool.getByTestId('msa-open-button');
      await expect(body).toBeVisible();
      await expect(launcher).toBeVisible();
      const railGeometry = await body.evaluate((element) => {
        const launch = element.querySelector<HTMLElement>('[data-testid="msa-open-button"]')!;
        const boundary = element.querySelector<HTMLElement>('.motif-cs-alignment-boundary')!;
        const launchRect = launch.getBoundingClientRect();
        const boundaryRect = boundary.getBoundingClientRect();
        return {
          bodyClientWidth: element.clientWidth,
          bodyScrollWidth: element.scrollWidth,
          launcherClientWidth: launch.clientWidth,
          launcherScrollWidth: launch.scrollWidth,
          separated: launchRect.bottom <= boundaryRect.top + 1,
        };
      });
      expect(railGeometry.bodyScrollWidth).toBeLessThanOrEqual(railGeometry.bodyClientWidth + 1);
      expect(railGeometry.launcherScrollWidth).toBeLessThanOrEqual(railGeometry.launcherClientWidth + 1);
      expect(railGeometry.separated).toBe(true);

      await alignmentSummary.focus();
      // WebKit follows the macOS full-keyboard-access preference and may skip
      // non-text controls on Tab, so focus the same controls directly there;
      // Enter activation and focus restoration are still exercised below.
      if (browserName === 'webkit') await alignmentTool.getByTestId('rail-popover-close').focus();
      else await page.keyboard.press('Tab');
      await expect(alignmentTool.getByTestId('rail-popover-close')).toBeFocused();
      if (browserName === 'webkit') await launcher.focus();
      else await page.keyboard.press('Tab');
      await expect(launcher).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('msa-workspace')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(alignmentSummary).toBeFocused();

      const settings = page.locator('details[data-rail-tool="settings"]');
      await settings.locator(':scope > summary').click();
      await expect(settings).toHaveAttribute('open', '');
      await page.screenshot({ path: path.join(msaCampaignOutputDir, `alignment-rail-dark-settings-${viewport.width}x${viewport.height}.png`) });
    }
  });

  test('MSA defaults stay within the active group and selected records stay pinned and controllable', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => {
      window.motifAddRecords([
        { id: 'campaign-a', name: 'Campaign2_variant_A', type: 'dna', topology: 'linear', sequence: 'ACGT'.repeat(60), group: 'MSA Campaign 2' },
        { id: 'campaign-b', name: 'Campaign2_variant_B_ins3', type: 'dna', topology: 'linear', sequence: `${'ACGT'.repeat(30)}AAA${'ACGT'.repeat(30)}`, group: 'MSA Campaign 2' },
        { id: 'campaign-c', name: 'Campaign2_variant_C_del3', type: 'dna', topology: 'linear', sequence: 'ACGT'.repeat(59), group: 'MSA Campaign 2' },
      ]);
    });

    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    const recordList = page.getByTestId('msa-record-list');
    const selectedOptions = recordList.locator('.motif-cs-msa-record-option[data-active="true"]');
    await expect(selectedOptions).toHaveCount(2);
    await expect(selectedOptions.nth(0)).toContainText('Campaign2_variant_A');
    await expect(selectedOptions.nth(1)).toContainText('Campaign2_variant_B_ins3');
    await expect(recordList.locator('.motif-cs-msa-record-option').filter({ hasText: 'pUC19' }).locator('input')).not.toBeChecked();

    await page.getByLabel('Filter records').fill('pUC19');
    await expect(recordList.locator('.motif-cs-msa-record-option').nth(0)).toContainText('Campaign2_variant_A');
    await expect(recordList.locator('.motif-cs-msa-record-option').nth(1)).toContainText('Campaign2_variant_B_ins3');
    await expect(recordList.locator('.motif-cs-msa-record-option').filter({ hasText: 'pUC19' })).toBeVisible();
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'selection-same-group-pinned.png') });
    await page.getByTestId('msa-selected-only').click();
    await expect(recordList.locator('.motif-cs-msa-record-option')).toHaveCount(2);
    await page.getByTestId('msa-clear-selection').click();
    await expect(recordList.locator('input:checked')).toHaveCount(0);
    await expect(page.getByTestId('msa-selected-only')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('msa-run-button')).toBeDisabled();
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'selection-same-group-and-clear.png') });
  });

  test('MSA accepts direct multi-file sequence drops, selects the new records, and keeps the shell importer out of the path', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    const workspace = page.getByTestId('msa-workspace');
    await expect(page.getByTestId('msa-record-dropzone')).toContainText('Drop sequence files');
    const beforeCount = await page.evaluate(() => window.motifGetInventory().length);

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['>drop_read_F\nAACCGGTTAACCGGTT'], 'drop-read-f.fasta', { type: 'text/plain' }));
      transfer.items.add(new File(['>drop_read_R\nAACCGGTTAACCGGTA'], 'drop-read-r.fasta', { type: 'text/plain' }));
      document.querySelector('[data-testid="msa-workspace"]')?.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    });
    await expect(page.getByTestId('msa-drop-overlay')).toContainText('Add and select sequence files');
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['>drop_read_F\nAACCGGTTAACCGGTT'], 'drop-read-f.fasta', { type: 'text/plain' }));
      transfer.items.add(new File(['>drop_read_R\nAACCGGTTAACCGGTA'], 'drop-read-r.fasta', { type: 'text/plain' }));
      document.querySelector('[data-testid="msa-workspace"]')?.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    });

    await expect.poll(() => page.evaluate(() => window.motifGetInventory().length)).toBe(beforeCount + 2);
    await expect(page.getByTestId('msa-drop-overlay')).toBeHidden();
    await expect(page.locator('.motif-cs-dropzone')).toBeHidden();
    await expect(page.getByTestId('msa-selected-only')).toHaveAttribute('aria-pressed', 'true');
    const selected = page.getByTestId('msa-record-list').locator('.motif-cs-msa-record-option[data-active="true"]');
    await expect(selected).toHaveCount(3);
    await expect(selected.nth(1)).toContainText('drop-read-f');
    await expect(selected.nth(2)).toContainText('drop-read-r');
    await expect(workspace.locator('.motif-cs-msa-intake-status')).toContainText('Imported 2 records');
    await expect(page.getByLabel('Choose sequence files for alignment')).toHaveAttribute('multiple', '');
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'direct-multifile-drop-selected.png') });

    await page.setViewportSize({ width: 390, height: 760 });
    const compactDropzone = page.getByTestId('msa-record-dropzone');
    await expect(compactDropzone).toBeVisible();
    expect(await compactDropzone.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
      await compactDropzone.evaluate((element) => element.clientWidth + 2),
    );
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'direct-multifile-drop-390x760.png') });
    await page.setViewportSize({ width: 1180, height: 820 });

    await page.getByTestId('msa-run-button').click();
    await expect(page.getByTestId('msa-stats-bar')).toContainText('3 rows');
  });

  test('direct AB1 intake selects the imported reads instead of an unrelated active record', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    const fixtureBytes = buildAbiFixture();
    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    const workspace = page.getByTestId('msa-workspace');
    const beforeCount = await page.evaluate(() => window.motifGetInventory().length);

    await workspace.getByLabel('Choose sequence files for alignment').setInputFiles([
      { name: 'plate-read-a.ab1', mimeType: 'application/octet-stream', buffer: Buffer.from(fixtureBytes) },
      { name: 'plate-read-b.ab1', mimeType: 'application/octet-stream', buffer: Buffer.from(fixtureBytes) },
    ]);

    await expect.poll(() => page.evaluate(() => window.motifGetInventory().length)).toBe(beforeCount + 2);
    const selected = workspace.getByTestId('msa-record-list').locator('.motif-cs-msa-record-option[data-active="true"]');
    await expect(selected).toHaveCount(2);
    await expect(selected.nth(0)).toContainText('plate-read-a');
    await expect(selected.nth(1)).toContainText('plate-read-b');
    expect((await selected.allTextContents()).join('\n')).not.toContain('pUC19');
    await expect(workspace.getByLabel('Initial template').locator('option:checked')).toHaveText('plate-read-a');
    await expect(workspace.getByTestId('msa-source-link-status')).toContainText('selected 2 imported AB1 reads');
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'direct-ab1-import-selection.png') });
  });

  test('MSA routes one aligned-file drop to a review step without flattening gaps into inventory records', async ({ page }) => {
    await openArtifact(page, 900, 560);
    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    await page.getByRole('button', { name: 'Aligned file' }).click();
    const beforeCount = await page.evaluate(() => window.motifGetInventory().length);

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['>aligned_a\nACGT--ACGT\n>aligned_b\nACGTTTACGT\n'], 'mafft-output.aln', { type: 'text/plain' }));
      document.querySelector('[data-testid="msa-workspace"]')?.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    });

    await expect(page.getByLabel('Aligned FASTA or CLUSTAL')).toHaveValue(/ACGT--ACGT/);
    await expect(page.locator('.motif-cs-msa-import-fields select').nth(1)).toHaveValue('mafft');
    await expect(page.getByTestId('msa-workspace').locator('.motif-cs-msa-intake-status')).toContainText('review the molecule and engine');
    expect(await page.evaluate(() => window.motifGetInventory().length)).toBe(beforeCount);
    await expect(page.getByLabel('Choose a pre-aligned sequence file')).toHaveAttribute('type', 'file');
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'direct-aligned-file-review.png') });
    await page.getByTestId('msa-import-button').click();
    await expect(page.getByTestId('msa-stats-bar')).toContainText('10 columns');
  });

  test('MSA identity and variable columns ignore uncovered Sanger flanks but keep covered mismatches', async ({ page }) => {
    await openArtifact(page, 900, 560);
    await page.evaluate(() => {
      window.motifAddAlignments({
        id: 'partial-read-coverage',
        name: 'Partial-read coverage',
        molecule: 'dna',
        referenceRowId: 'partial-template',
        rows: [
          { id: 'partial-template', name: 'Template', aligned: 'AAAAAAAAAAAA' },
          { id: 'partial-read-a', name: 'Read A', aligned: '---AAAAATA--' },
          { id: 'partial-read-b', name: 'Read B', aligned: '----AAAAAA--' },
        ],
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
      });
    });
    const stats = page.getByTestId('msa-stats-bar');
    await expect(stats).toContainText('92.9% avg to template');
    await expect(stats).toContainText('1 differences in overlap');
    await expect(page.getByRole('row', { name: /Read B; 0 mismatches; 6 ungapped bp; 100\.0 percent/ })).toBeVisible();
  });

  test('local Sanger preview uses the chosen template and auto-orients a reverse AB1 read', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => {
      const template = 'AACCGTTAACGATCGGATCCTAGGCTAATCG'.repeat(3);
      const complements: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
      const reverseCalls = Array.from(template).reverse().map((base) => complements[base]).join('');
      window.motifRenderInventory([
        { id: 'sanger-local-template', name: 'Chosen Sanger template', molecule: 'dna', topology: 'linear', group: 'Local Sanger', seq: template },
        {
          id: 'sanger-local-reverse',
          name: 'Read_reverse_primer',
          molecule: 'dna',
          topology: 'linear',
          group: 'Local Sanger',
          seq: reverseCalls,
          sangerTrace: {
            schema: 'motif.sanger-trace.v1',
            version: 1,
            baseCalls: reverseCalls,
            sequence: reverseCalls,
            qualityScores: [],
            peakPositions: [],
            channels: { A: [], C: [], G: [], T: [] },
            sampleCount: 0,
            dyeOrder: null,
            storedReverseComplement: false,
            warnings: ['Synthetic orientation-only E2E trace has no signal channels.'],
            metadata: {
              format: 'ABIF',
              abifVersion: 101,
              baseCallsTag: 'PBAS2',
              qualityScoresTag: null,
              peakPositionsTag: null,
              channelTags: {},
              sampleName: 'Read_reverse_primer',
            },
          },
        },
      ] as never);
    });

    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    const localOptions = page.locator('.motif-cs-msa-local-options');
    await expect(localOptions).toBeVisible();
    await expect(localOptions.locator('select')).toHaveValue('sanger-local-template');
    await expect(localOptions.getByRole('checkbox', { name: 'Auto-orient AB1 reads' })).toBeChecked();
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'local-sanger-source-options.png') });
    await page.getByTestId('msa-run-button').click();
    await expect(page.getByTestId('msa-stats-bar')).toContainText('100% conserved');
    await expect(page.locator('.motif-cs-msa-export-row')).toContainText('Auto-oriented 1 AB1 read');
    await page.getByRole('button', { name: 'Traces' }).click();
    const traceViewer = page.getByTestId('sanger-trace-viewer');
    await expect(traceViewer.locator('.motif-cs-sanger-toolbar .motif-cs-chip')).toHaveText('reverse');
    await expect(traceViewer.locator('canvas')).toHaveAttribute('aria-label', /aligned reverse to template Chosen Sanger template/);
    await expect(traceViewer.locator('.motif-cs-sanger-warnings')).toContainText('no signal channels');
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'local-sanger-auto-orient.png') });
  });

  test('MSA local workflow is explicit, virtualized, movable, resizable, and focus-safe', async ({ page }) => {
    await openArtifact(page, 1440, 1000);
    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    const alignmentSummary = alignmentTool.locator(':scope > summary');
    await alignmentSummary.click();
    await alignmentTool.getByTestId('msa-open-button').click();

    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    await expect(windowPanel).toBeVisible();
    await expect(page.getByTestId('msa-record-list').locator('input:checked')).toHaveCount(1);
    await page.getByTestId('msa-record-list').locator('input:not(:checked):not(:disabled)').first().check();
    await expect(page.getByTestId('msa-record-list').locator('input:checked')).toHaveCount(2);
    await expect(page.getByTestId('msa-run-button')).toBeEnabled();
    await page.getByTestId('msa-run-button').click();
    await expect(page.getByTestId('msa-stats-bar')).toBeVisible({ timeout: 15_000 });
    await expect(windowPanel.locator('.motif-cs-msa-toolbar .motif-cs-chip')).toHaveText('Motif local preview');

    const overview = page.getByTestId('msa-overview');
    const matrix = page.getByRole('region', { name: /Alignment matrix/ });
    await expect(overview).toBeVisible();
    await expect(page.getByTestId('msa-overview-viewport')).toBeVisible();
    await overview.focus();
    await page.keyboard.press('End');
    await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await page.keyboard.press('Home');
    await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBe(0);

    const originalSecondTemplate = windowPanel.getByRole('button', { name: /^Use .* as template$/ }).nth(1);
    const templateButtonName = await originalSecondTemplate.getAttribute('aria-label');
    const expectedTemplateId = await page.evaluate(() => window.motifGetAlignments()[0]?.rows[1]?.id);
    expect(templateButtonName).toBeTruthy();
    expect(expectedTemplateId).toBeTruthy();
    await originalSecondTemplate.click();
    const selectedTemplate = windowPanel.getByRole('button', { name: templateButtonName!, exact: true });
    await expect(selectedTemplate).toHaveAttribute('aria-pressed', 'true');
    await expect(windowPanel.locator('.motif-cs-msa-matrix-row').first().getByRole('button')).toHaveAttribute('aria-label', templateButtonName!);
    await expect(windowPanel.locator('.motif-cs-msa-matrix-row').first()).toContainText('Template');
    await expect(windowPanel.locator('.motif-cs-msa-matrix-row').first()).toContainText('Δ');
    await page.getByLabel('Sort').selectOption('mismatches');
    await expect(windowPanel.locator('.motif-cs-msa-matrix-row').first().getByRole('button')).toHaveAttribute('aria-label', templateButtonName!);

    const renderedSymbols = await page.locator('.motif-cs-msa-symbol').count();
    expect(renderedSymbols).toBeGreaterThan(0);
    expect(renderedSymbols).toBeLessThan(1_200);
    expect(await page.evaluate(() => window.motifGetAlignments().length)).toBe(1);
    expect(await page.evaluate(() => window.motifGetAlignments()[0]?.referenceRowId)).toBe(expectedTemplateId);
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');

    const beforeMove = (await windowPanel.boundingBox())!;
    const header = windowPanel.locator('.motif-cs-window-head');
    const headerBox = (await header.boundingBox())!;
    await page.mouse.move(headerBox.x + 240, headerBox.y + 14);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + 130, headerBox.y + 70, { steps: 6 });
    await page.mouse.up();
    const afterMove = (await windowPanel.boundingBox())!;
    expect(Math.abs(afterMove.x - beforeMove.x) + Math.abs(afterMove.y - beforeMove.y)).toBeGreaterThan(40);

    const resize = windowPanel.locator('.motif-cs-window-resize');
    const resizeBox = (await resize.boundingBox())!;
    await page.mouse.move(resizeBox.x + 8, resizeBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + 70, resizeBox.y + 44, { steps: 5 });
    await page.mouse.up();
    const afterResize = (await windowPanel.boundingBox())!;
    expect(afterResize.width).toBeGreaterThanOrEqual(afterMove.width);
    expect(afterResize.height).toBeGreaterThanOrEqual(afterMove.height);

    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'local-template-overview-and-stats.png') });

    await page.keyboard.press('Escape');
    await expect(windowPanel).toBeHidden();
    await expect(alignmentSummary).toBeFocused();
    if (!(await alignmentTool.getAttribute('open'))) await alignmentSummary.click();
    await alignmentTool.getByTestId('msa-open-button').click();
    await expect(windowPanel.getByRole('button', { name: templateButtonName!, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(windowPanel.locator('.motif-cs-window-head small')).toHaveText('1 in session');
    expect(await page.evaluate(() => window.motifGetAlignments()[0]?.referenceRowId)).toBe(expectedTemplateId);
    await page.keyboard.press('Escape');
    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    if (!(await exportPanel.getAttribute('open'))) await exportPanel.locator(':scope > summary').click();
    await exportPanel.locator('select[name="export-format"]').selectOption('inventory-json');
    const databaseExport = JSON.parse(await exportPanel.getByLabel('Selected export preview').inputValue());
    expect(databaseExport.alignments[0].referenceRowId).toBe(expectedTemplateId);
  });

  test('MSA maximize follows viewport changes and restores the remembered normal rectangle', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => window.motifAddAlignments({
      id: 'maximize-audit',
      name: 'Maximize audit',
      molecule: 'dna',
      referenceRowId: 'maximize-template',
      rows: [
        { id: 'maximize-template', name: 'Maximize template', aligned: 'ACGT'.repeat(40) },
        { id: 'maximize-variant', name: 'Maximize variant', aligned: `${'ACGT'.repeat(20)}TCGT${'ACGT'.repeat(19)}` },
      ],
      engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
    }));

    const dialog = page.getByRole('dialog', { name: 'Multiple Sequence Alignment' });
    await expect(dialog).toBeVisible();
    const normalRect = (await dialog.boundingBox())!;
    const maximize = dialog.getByRole('button', { name: 'Maximize Multiple Sequence Alignment' });
    await expect(maximize).toBeVisible();
    await maximize.click();
    const restore = dialog.getByRole('button', { name: 'Restore Multiple Sequence Alignment' });
    await expect(restore).toBeVisible();

    const maximizedAt1180 = (await dialog.boundingBox())!;
    expect(maximizedAt1180.x).toBeLessThanOrEqual(12);
    expect(maximizedAt1180.y).toBeLessThanOrEqual(12);
    expect(1180 - (maximizedAt1180.x + maximizedAt1180.width)).toBeLessThanOrEqual(12);
    expect(820 - (maximizedAt1180.y + maximizedAt1180.height)).toBeLessThanOrEqual(12);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(async () => {
      const box = (await dialog.boundingBox())!;
      return {
        left: Math.round(box.x),
        top: Math.round(box.y),
        rightGap: Math.round(1440 - box.x - box.width),
        bottomGap: Math.round(1000 - box.y - box.height),
      };
    }).toEqual({ left: 8, top: 8, rightGap: 8, bottomGap: 8 });

    await restore.click();
    await expect(maximize).toBeVisible();
    const restoredRect = (await dialog.boundingBox())!;
    expect(Math.abs(restoredRect.x - normalRect.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(restoredRect.y - normalRect.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(restoredRect.width - normalRect.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(restoredRect.height - normalRect.height)).toBeLessThanOrEqual(2);
  });

  test('MSA compact result toolbar stays visible and hit-testable while export is in view', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => {
      const template = 'ACGT'.repeat(150);
      window.motifAddAlignments({
        id: 'compact-toolbar-audit',
        name: 'Compact toolbar audit',
        molecule: 'dna',
        referenceRowId: 'compact-row-0',
        rows: Array.from({ length: 24 }, (_, index) => {
          const aligned = template.split('');
          if (index > 0) aligned[(index * 29) % aligned.length] = index % 2 ? 'T' : 'A';
          return { id: `compact-row-${index}`, name: `Compact row ${index + 1}`, aligned: aligned.join('') };
        }),
        engine: { id: 'muscle', label: 'MUSCLE', version: '5.3', mode: 'local-command' },
      });
    });
    await page.setViewportSize({ width: 390, height: 760 });

    const dialog = page.getByRole('dialog', { name: 'Multiple Sequence Alignment' });
    const settings = page.locator('details[data-rail-tool="settings"]');
    await settings.locator(':scope > summary').click();
    await expect(settings).toHaveAttribute('open', '');
    await settings.getByRole('button', { name: 'Close Settings' }).click();
    await expect(settings).not.toHaveAttribute('open', '');
    const body = dialog.locator('.motif-cs-window-body');
    const toolbar = dialog.getByTestId('msa-result-toolbar');
    const exportRow = dialog.locator('.motif-cs-msa-export-row');
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(exportRow).toBeVisible();
    await expect(toolbar).toBeVisible();

    const toolbarGeometry = await toolbar.evaluate((element) => {
      const bodyElement = element.closest<HTMLElement>('.motif-cs-window-body')!;
      const bodyRect = bodyElement.getBoundingClientRect();
      const toolbarRect = element.getBoundingClientRect();
      return {
        position: getComputedStyle(element).position,
        top: toolbarRect.top,
        bottom: toolbarRect.bottom,
        bodyTop: bodyRect.top,
        bodyBottom: bodyRect.bottom,
      };
    });
    expect(toolbarGeometry.position).toBe('sticky');
    expect(toolbarGeometry.top).toBeGreaterThanOrEqual(toolbarGeometry.bodyTop - 1);
    expect(toolbarGeometry.bottom).toBeLessThanOrEqual(toolbarGeometry.bodyBottom + 1);

    const textButton = toolbar.getByRole('button', { name: 'Text' });
    const hitTest = await textButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === button || button.contains(hit);
    });
    expect(hitTest).toBe(true);
    await textButton.click();
    await expect(textButton).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'msa-result-toolbar-sticky-390x760.png') });
    await toolbar.getByRole('button', { name: 'Viewer' }).click();
    await toolbar.getByTestId('msa-view-menu-button').click();
    const compactViewMenu = dialog.getByTestId('msa-view-menu');
    await expect(compactViewMenu).toBeVisible();
    const compactMenuBox = (await compactViewMenu.boundingBox())!;
    expect(compactMenuBox.x).toBeGreaterThanOrEqual(0);
    expect(compactMenuBox.x + compactMenuBox.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'msa-view-menu-sticky-390x760.png') });
  });

  test('MSA View menu persists visibility choices, resets them, and owns Escape before the window', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => window.motifAddAlignments({
      id: 'view-menu-audit',
      name: 'View menu audit',
      molecule: 'dna',
      referenceRowId: 'view-menu-template',
      rows: [
        { id: 'view-menu-template', name: 'View menu template', aligned: '--AC-GT--ACGT' },
        { id: 'view-menu-variant', name: 'View menu variant', aligned: 'TT-C-GTAAAC-T' },
        { id: 'view-menu-third', name: 'View menu third', aligned: 'TTAC-GTA-ACGT' },
      ],
      engine: { id: 'clustal-omega', label: 'Clustal Omega', version: '1.2.4', mode: 'local-command' },
    }));

    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    const alignmentSummary = alignmentTool.locator(':scope > summary');
    const dialog = page.getByRole('dialog', { name: 'Multiple Sequence Alignment' });
    const viewButton = dialog.getByTestId('msa-view-menu-button');
    await expect(viewButton).toHaveAttribute('aria-expanded', 'false');
    await viewButton.click();
    const viewMenu = dialog.getByTestId('msa-view-menu');
    await expect(viewMenu).toBeVisible();
    await expect(viewButton).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'msa-view-menu-1180x820.png') });

    for (const label of ['Overview', 'Alignment axis', 'Template axis', 'Row statistics', 'Conservation', 'Consensus']) {
      await viewMenu.getByRole('checkbox', { name: label }).uncheck();
      await expect(viewMenu).toBeVisible();
    }
    const residueColors = viewMenu.getByRole('checkbox', { name: 'Residue colors' });
    await residueColors.check();
    await expect(dialog.locator('.motif-cs-msa-overview-row')).toHaveCount(0);
    await expect(dialog.locator('.motif-cs-msa-ruler-row:not(.motif-cs-msa-template-ruler-row)')).toHaveCount(0);
    await expect(dialog.locator('.motif-cs-msa-template-ruler-row')).toHaveCount(0);
    await expect(dialog.locator('.motif-cs-msa-row-stat')).toHaveCount(0);
    await expect(dialog.locator('.motif-cs-msa-conservation-row')).toHaveCount(0);
    await expect(dialog.locator('.motif-cs-msa-consensus-row')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(viewMenu).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(viewButton).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(alignmentSummary).toBeFocused();
    if (!(await alignmentTool.getAttribute('open'))) await alignmentSummary.click();
    await alignmentTool.getByTestId('msa-open-button').click();

    await expect(dialog.locator('.motif-cs-msa-overview-row')).toHaveCount(0);
    await expect(dialog.locator('.motif-cs-msa-template-ruler-row')).toHaveCount(0);
    await viewButton.click();
    await viewMenu.getByRole('button', { name: 'Reset alignment view' }).click();
    const viewStatus = viewMenu.getByTestId('msa-view-menu-status');
    await expect(viewStatus).toHaveAttribute('role', 'status');
    await expect(viewStatus).toHaveAttribute('aria-live', 'polite');
    await expect(viewStatus).toContainText(/alignment view reset/i);
    await expect(viewMenu).toBeVisible();
    for (const label of ['Overview', 'Alignment axis', 'Template axis', 'Row statistics', 'Conservation', 'Consensus']) {
      await expect(viewMenu.getByRole('checkbox', { name: label })).toBeChecked();
    }
    await expect(residueColors).not.toBeChecked();
    await expect(dialog.locator('.motif-cs-msa-overview-row')).toBeVisible();
    await expect(dialog.locator('.motif-cs-msa-template-ruler-row')).toBeVisible();
    await expect(dialog.locator('.motif-cs-msa-row-stat').first()).toBeVisible();
    await expect(dialog.locator('.motif-cs-msa-conservation-row')).toBeVisible();
    await expect(dialog.locator('.motif-cs-msa-consensus-row')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewMenu).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(viewButton).toBeFocused();
  });

  test('MSA Edit inputs preserves setup and creates distinguishable, selectable results', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();

    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    const recordList = page.getByTestId('msa-record-list');
    await recordList.locator('input:not(:checked):not(:disabled)').first().check();
    await expect(recordList.locator('input:checked')).toHaveCount(2);
    const originalTemplate = await windowPanel.locator('.motif-cs-msa-local-options select').inputValue();
    await page.getByTestId('msa-run-button').click();
    await expect(page.getByTestId('msa-stats-bar')).toBeVisible({ timeout: 15_000 });

    const editInputs = page.getByTestId('msa-edit-inputs');
    const source = windowPanel.locator('.motif-cs-msa-source');
    await expect(editInputs).toHaveAttribute('aria-controls', 'motif-cs-msa-source-body');
    await expect(editInputs).not.toHaveAttribute('aria-expanded', /.+/);
    await editInputs.focus();
    await page.keyboard.press('Enter');
    await expect(source).toHaveAttribute('open', '');
    await expect(source.locator(':scope > summary')).toBeFocused();
    await expect(source).toContainText('Changes create a new alignment; the current result stays available in this session.');
    await expect(recordList.locator('input:checked')).toHaveCount(2);
    await expect(windowPanel.locator('.motif-cs-msa-local-options select')).toHaveValue(originalTemplate);
    await expect(page.getByTestId('msa-run-button')).toHaveText('Align as new result');
    await expect(page.getByTestId('msa-copy-input-fasta')).toBeVisible();
    const inputDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('msa-download-input-fasta').click();
    const inputDownload = await inputDownloadPromise;
    expect(inputDownload.suggestedFilename()).toMatch(/\.fasta$/);
    const inputDownloadPath = await inputDownload.path();
    expect(inputDownloadPath).toBeTruthy();
    const inputFasta = await readFile(inputDownloadPath!, 'utf8');
    expect(inputFasta).toMatch(/^>pUC19\n[ACGT]+/);
    expect(inputFasta).toContain('\n>pACYC184\n');
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'edit-inputs-preserves-setup.png') });

    await page.setViewportSize({ width: 390, height: 760 });
    const handoff = windowPanel.locator('.motif-cs-msa-external-handoff');
    await handoff.scrollIntoViewIfNeeded();
    await expect(handoff).toBeVisible();
    const compactGeometry = await windowPanel.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(compactGeometry.scrollWidth).toBeLessThanOrEqual(compactGeometry.clientWidth + 1);
    await expect(page.getByTestId('msa-copy-input-fasta')).toBeVisible();
    await expect(page.getByTestId('msa-download-input-fasta')).toBeVisible();
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'edit-inputs-external-handoff-390x760.png') });
    await page.setViewportSize({ width: 1180, height: 820 });

    await page.getByTestId('msa-run-button').click();
    await expect(windowPanel.locator('.motif-cs-window-head small')).toHaveText('2 in session');
    const saved = await page.evaluate(() => window.motifGetAlignments());
    expect(saved).toHaveLength(2);
    expect(saved[1].name).toBe(`${saved[0].name} 2`);
    expect(new Set(saved.map((alignment) => alignment.name)).size).toBe(2);

    const picker = windowPanel.locator('.motif-cs-msa-alignment-picker select');
    await expect(picker.locator('option')).toHaveCount(2);
    await picker.selectOption(saved[0].id!);
    await expect(picker).toHaveValue(saved[0].id!);
    await editInputs.click();
    await expect(source).toHaveAttribute('open', '');
    await expect(recordList.locator('input:checked')).toHaveCount(2);
  });

  test('MSA restores the active result and view preferences after close and reopen', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => window.motifAddAlignments([
      {
        id: 'view-state-first',
        name: 'First view-state result',
        molecule: 'dna',
        referenceRowId: 'first-template',
        rows: [
          { id: 'first-template', name: 'First template', aligned: 'ACGTACGT' },
          { id: 'first-variant', name: 'First variant', aligned: 'ACGTTCGT' },
        ],
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
      },
      {
        id: 'view-state-second',
        name: 'Second view-state result',
        molecule: 'dna',
        referenceRowId: 'second-template',
        rows: [
          { id: 'second-template', name: 'Second template', aligned: 'TTGCAAGT' },
          { id: 'second-variant', name: 'Second variant', aligned: 'TTG-AACT' },
        ],
        engine: { id: 'muscle', label: 'MUSCLE', version: '5.3', mode: 'local-command' },
      },
    ]));

    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    const alignmentSummary = alignmentTool.locator(':scope > summary');
    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    const picker = windowPanel.locator('.motif-cs-msa-alignment-picker select');
    await expect(windowPanel).toBeVisible();
    await picker.selectOption('view-state-second');
    await windowPanel.getByRole('button', { name: 'All letters' }).click();
    await windowPanel.getByLabel('Sort').selectOption('name');
    const viewButton = windowPanel.getByTestId('msa-view-menu-button');
    await viewButton.click();
    await windowPanel.getByTestId('msa-view-menu').getByRole('checkbox', { name: 'Residue colors' }).check();
    await windowPanel.getByRole('button', { name: 'Increase alignment font size' }).click();
    await windowPanel.getByRole('button', { name: 'Text' }).click();
    await windowPanel.locator('.motif-cs-msa-export-row select').selectOption('json');

    await page.keyboard.press('Escape');
    await expect(windowPanel).toBeHidden();
    await expect(alignmentSummary).toBeFocused();
    if (!(await alignmentTool.getAttribute('open'))) await alignmentSummary.click();
    await alignmentTool.getByTestId('msa-open-button').click();

    await expect(picker).toHaveValue('view-state-second');
    await expect(windowPanel.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true');
    await expect(windowPanel.locator('.motif-cs-msa-export-row select')).toHaveValue('json');
    await windowPanel.getByRole('button', { name: 'Viewer' }).click();
    await expect(windowPanel.getByRole('button', { name: 'All letters' })).toHaveAttribute('aria-pressed', 'true');
    await expect(windowPanel.getByLabel('Sort')).toHaveValue('name');
    await viewButton.click();
    await expect(windowPanel.getByTestId('msa-view-menu').getByRole('checkbox', { name: 'Residue colors' })).toBeChecked();
    await expect(windowPanel.locator('.motif-cs-msa-view-font-row > span')).toHaveText('Aa 12 px');
  });

  test('MSA picker disambiguates duplicate preloaded and runtime result names', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => {
      window.motifRenderInventory({
        inventory: { id: 'duplicate-picker-audit', title: 'Duplicate picker audit' },
        selectedRecordId: 'duplicate-source',
        records: [{ id: 'duplicate-source', name: 'Duplicate source', molecule: 'dna', topology: 'linear', seq: 'ACGTACGT' }],
        alignments: [{
          id: 'preloaded-duplicate',
          name: 'Variant comparison',
          molecule: 'dna',
          referenceRowId: 'preloaded-template',
          rows: [
            { id: 'preloaded-template', name: 'Preloaded template', aligned: 'ACGTACGT' },
            { id: 'preloaded-variant', name: 'Preloaded variant', aligned: 'ACGTTCGT' },
          ],
          engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
        }],
      } as never);
      window.motifAddAlignments({
        id: 'runtime-duplicate',
        name: 'Variant comparison',
        molecule: 'dna',
        referenceRowId: 'runtime-template',
        rows: [
          { id: 'runtime-template', name: 'Runtime template', aligned: 'TTGCAAGT' },
          { id: 'runtime-variant', name: 'Runtime variant', aligned: 'TTG-AACT' },
        ],
        engine: { id: 'muscle', label: 'MUSCLE', version: '5.3', mode: 'local-command' },
      });
    });

    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    const picker = windowPanel.locator('.motif-cs-msa-alignment-picker select');
    const optionLabels = await picker.locator('option').allTextContents();
    expect(optionLabels).toHaveLength(2);
    expect(optionLabels.every((label) => label.startsWith('Variant comparison'))).toBe(true);
    expect(new Set(optionLabels).size).toBe(optionLabels.length);

    const runtimeId = await page.evaluate(() => (
      window.motifGetAlignments().find((alignment) => alignment.engine.id === 'muscle')?.id
    ));
    expect(runtimeId).toBeTruthy();
    await picker.selectOption(runtimeId!);
    await expect(picker).toHaveValue(runtimeId!);
    await expect(windowPanel.locator('.motif-cs-msa-toolbar')).toContainText('MUSCLE 5.3');
  });

  test('MSA Edit inputs rehydrates linked records and clearly resets an unlinked result', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => window.motifRenderInventory({
      inventory: { id: 'source-link-audit', title: 'Source-link audit' },
      selectedRecordId: 'source-alpha',
      records: [
        { id: 'source-alpha', name: 'Source Alpha', molecule: 'dna', topology: 'linear', seq: 'ACGTACGT' },
        { id: 'source-beta', name: 'Source Beta', molecule: 'dna', topology: 'linear', seq: 'ACGTTCGT' },
        { id: 'source-gamma', name: 'Source Gamma', molecule: 'dna', topology: 'linear', seq: 'TTTTAAAA' },
      ],
      alignments: [
        {
          id: 'linked-result',
          name: 'Linked source result',
          molecule: 'dna',
          referenceRowId: 'linked-beta-row',
          rows: [
            { id: 'linked-alpha-row', name: 'Source Alpha', sourceRecordId: 'source-alpha', aligned: 'ACGTACGT' },
            { id: 'linked-beta-row', name: 'Source Beta', sourceRecordId: 'source-beta', aligned: 'ACGTTCGT' },
          ],
          engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
        },
        {
          id: 'unlinked-result',
          name: 'External unlinked result',
          molecule: 'dna',
          referenceRowId: 'external-template',
          rows: [
            { id: 'external-template', name: 'External template', aligned: 'GGGGCCCC' },
            { id: 'external-variant', name: 'External variant', aligned: 'GGGG-CCC' },
          ],
          engine: { id: 'clustal-omega', label: 'Clustal Omega', version: '1.2.4', mode: 'imported' },
        },
      ],
    } as never));

    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    const picker = windowPanel.locator('.motif-cs-msa-alignment-picker select');
    const recordList = windowPanel.getByTestId('msa-record-list');
    const recordOption = (name: string) => recordList.locator('.motif-cs-msa-record-option').filter({ hasText: name }).locator('input');

    await windowPanel.getByTestId('msa-edit-inputs').click();
    await expect(recordOption('Source Alpha')).toBeChecked();
    await expect(recordOption('Source Beta')).toBeChecked();
    await expect(recordOption('Source Gamma')).not.toBeChecked();
    await expect(windowPanel.locator('.motif-cs-msa-local-options select')).toHaveValue('source-beta');
    await expect(windowPanel.locator('.motif-cs-msa-source-fields input').first()).toHaveValue('Linked source result');

    await picker.selectOption('unlinked-result');
    await windowPanel.getByTestId('msa-edit-inputs').click();
    const sourceLinkStatus = windowPanel.getByTestId('msa-source-link-status');
    await expect(sourceLinkStatus).toBeVisible();
    await expect(sourceLinkStatus).toContainText(/not linked|unlinked|could not be linked/i);
    await expect(recordList.locator('input:checked')).toHaveCount(0);
    await expect(windowPanel.getByTestId('msa-run-button')).toBeDisabled();
  });

  test('MSA exposes fallback provenance and polite feedback for result and input copies', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as unknown as { __motifMsaClipboard?: string }).__motifMsaClipboard = value;
          },
        },
      });
    });
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => window.motifRenderInventory({
      inventory: { id: 'fallback-audit', title: 'Fallback provenance audit' },
      selectedRecordId: 'fallback-alpha',
      records: [
        { id: 'fallback-alpha', name: 'Fallback Alpha', molecule: 'dna', topology: 'linear', seq: 'ACGTACGT' },
        { id: 'fallback-beta', name: 'Fallback Beta', molecule: 'dna', topology: 'linear', seq: 'ACGTTCGT' },
      ],
      alignments: [{
        id: 'fallback-result',
        name: 'Requested MAFFT result',
        molecule: 'dna',
        referenceRowId: 'fallback-alpha-row',
        rows: [
          { id: 'fallback-alpha-row', name: 'Fallback Alpha', sourceRecordId: 'fallback-alpha', inputSha256: 'a'.repeat(64), aligned: 'ACGTACGT' },
          { id: 'fallback-beta-row', name: 'Fallback Beta', sourceRecordId: 'fallback-beta', inputSha256: 'b'.repeat(64), aligned: 'ACGTTCGT' },
        ],
        engine: {
          id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'browser', parameters: ['--auto'], usedFallback: true,
        },
        createdAt: '2026-07-12T16:30:00.000Z',
        outputSha256: 'c'.repeat(64),
        note: 'Requested through the agent runner; browser preview was used.',
      }],
    } as never));

    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    const provenance = windowPanel.getByTestId('msa-provenance');
    await expect(provenance).toBeVisible();
    await expect(provenance).toContainText(/MAFFT 7\.526/i);
    await expect(provenance).toContainText(/fallback/i);
    await expect(provenance).toContainText(/Motif local preview|browser preview/i);
    await expect(provenance).toContainText(/browser/i);
    await expect(provenance).toContainText('--auto');
    await expect(provenance).toContainText(/2026-07-12/);

    const copyStatus = windowPanel.getByTestId('msa-copy-status');
    await expect(copyStatus).toHaveAttribute('role', 'status');
    await expect(copyStatus).toHaveAttribute('aria-live', 'polite');
    await windowPanel.locator('.motif-cs-msa-export-row').getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(copyStatus).toBeVisible();
    await expect(copyStatus).toHaveText('Aligned FASTA copied');
    expect(await page.evaluate(() => (window as unknown as { __motifMsaClipboard?: string }).__motifMsaClipboard)).toContain('>Fallback Alpha');

    await windowPanel.getByTestId('msa-edit-inputs').click();
    await windowPanel.getByTestId('msa-copy-input-fasta').click();
    await expect(copyStatus).toBeVisible();
    await expect(copyStatus).toHaveText('Unaligned FASTA inputs copied');
    expect(await page.evaluate(() => (window as unknown as { __motifMsaClipboard?: string }).__motifMsaClipboard)).toMatch(/^>Fallback_Alpha\nACGTACGT/m);
  });

  test('MSA column lookup validates exact positions and the template axis skips gaps', async ({ page }) => {
    await openArtifact(page, 900, 620);
    await page.evaluate(() => {
      window.motifAddAlignments({
        id: 'coordinate-axis-audit',
        name: 'Coordinate axis audit',
        molecule: 'dna',
        referenceRowId: 'gapped-template',
        rows: [
          { id: 'gapped-template', name: 'Gapped_template', aligned: '--AC-GT--' },
          { id: 'alternate-template', name: 'Alternate_template', aligned: 'TT-C-GTAA' },
        ],
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
      });
    });

    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    const templateAxis = windowPanel.locator('.motif-cs-msa-template-ruler-row');
    await expect(templateAxis).toBeVisible();
    await expect(templateAxis.locator('.motif-cs-msa-template-ruler-label')).toContainText('Gapped_template');
    const templatePositions = await templateAxis.locator('.motif-cs-msa-ruler-cell').evaluateAll((cells) => (
      cells.map((cell) => cell.getAttribute('data-template-position'))
    ));
    expect(templatePositions).toEqual(['gap', 'gap', '1', '2', 'gap', '3', '4', 'gap', 'gap']);

    const columnInput = windowPanel.getByRole('spinbutton', { name: 'Go to alignment column' });
    await columnInput.fill('6');
    await columnInput.press('Enter');
    await expect(windowPanel.getByRole('status').filter({ hasText: 'Alignment column 6 shown.' })).toBeAttached();
    await expect(windowPanel.locator('.motif-cs-msa-matrix-row').first().locator('[data-jump="true"]')).toHaveAttribute('data-alignment-column', '6');

    await columnInput.fill('0');
    await windowPanel.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(columnInput).toHaveAttribute('aria-invalid', 'true');
    await expect(windowPanel.getByRole('alert')).toContainText('Enter a whole column from 1 to 9.');
    await expect(windowPanel.locator('.motif-cs-msa-matrix-row').first().locator('[data-jump="true"]')).toHaveAttribute('data-alignment-column', '6');

    await columnInput.fill('1.5');
    await columnInput.press('Enter');
    await expect(windowPanel.getByRole('alert')).toContainText('Enter a whole column from 1 to 9.');
    await columnInput.fill('9');
    await columnInput.press('Enter');
    await expect(windowPanel.getByRole('status').filter({ hasText: 'Alignment column 9 shown.' })).toBeAttached();
    await expect(windowPanel.locator('.motif-cs-msa-matrix-row').first().locator('[data-jump="true"]')).toHaveAttribute('data-alignment-column', '9');

    await windowPanel.locator('.motif-cs-msa-reference-picker select').selectOption('alternate-template');
    const alternatePositions = await templateAxis.locator('.motif-cs-msa-ruler-cell').evaluateAll((cells) => (
      cells.map((cell) => cell.getAttribute('data-template-position'))
    ));
    expect(alternatePositions).toEqual(['1', '2', 'gap', '3', 'gap', '4', '5', '6', '7']);
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'template-axis-and-column-lookup.png') });
  });

  test('MSA template-position lookup maps through gaps exactly and enforces ungapped bounds', async ({ page }) => {
    await openArtifact(page, 900, 620);
    await page.evaluate(() => window.motifAddAlignments({
      id: 'template-coordinate-lookup',
      name: 'Template coordinate lookup',
      molecule: 'dna',
      referenceRowId: 'lookup-template',
      rows: [
        { id: 'lookup-template', name: 'Lookup template', aligned: '--AC-GT--' },
        { id: 'lookup-variant', name: 'Lookup variant', aligned: 'TT-C-GTAA' },
      ],
      engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
    }));

    const dialog = page.getByRole('dialog', { name: 'Multiple Sequence Alignment' });
    const coordinateSystem = dialog.getByTestId('msa-coordinate-system');
    const coordinateInput = dialog.getByTestId('msa-coordinate-input');
    await expect(coordinateSystem).toBeVisible();
    await expect(coordinateInput).toBeVisible();
    await coordinateSystem.selectOption('template');
    await expect(coordinateInput).toHaveAttribute('max', '4');

    await coordinateInput.fill('3');
    await coordinateInput.press('Enter');
    await expect(dialog.getByRole('status').filter({ hasText: /template position 3.*alignment column 6/i })).toBeAttached();
    await expect(dialog.locator('.motif-cs-msa-matrix-row').first().locator('[data-jump="true"]')).toHaveAttribute('data-alignment-column', '6');

    await coordinateInput.fill('0');
    await coordinateInput.press('Enter');
    await expect(coordinateInput).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByRole('alert')).toContainText(/whole template position from 1 to 4/i);
    await expect(dialog.locator('.motif-cs-msa-matrix-row').first().locator('[data-jump="true"]')).toHaveAttribute('data-alignment-column', '6');

    await coordinateInput.fill('5');
    await dialog.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(/whole template position from 1 to 4/i);
    await coordinateInput.fill('4');
    await coordinateInput.press('Enter');
    await expect(dialog.getByRole('status').filter({ hasText: /template position 4.*alignment column 7/i })).toBeAttached();
    await expect(dialog.locator('.motif-cs-msa-matrix-row').first().locator('[data-jump="true"]')).toHaveAttribute('data-alignment-column', '7');

    await coordinateSystem.selectOption('alignment');
    await expect(coordinateInput).toHaveAttribute('max', '9');
    await coordinateInput.fill('9');
    await coordinateInput.press('Enter');
    await expect(dialog.getByRole('status').filter({ hasText: /alignment column 9 shown/i })).toBeAttached();
    await expect(dialog.locator('.motif-cs-msa-matrix-row').first().locator('[data-jump="true"]')).toHaveAttribute('data-alignment-column', '9');
  });

  test('MSA sequence pan rail is aligned, mouse-draggable, and cross-input navigable', async ({ page, browserName }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => {
      const template = 'ACGT'.repeat(737) + 'A';
      const variant = template.split('');
      for (let column = 113; column < variant.length; column += 379) {
        variant[column] = variant[column] === 'A' ? 'T' : 'A';
      }
      window.motifAddAlignments({
        id: 'pan-rail-audit',
        name: 'Pan rail audit',
        molecule: 'dna',
        referenceRowId: 'pan-template',
        rows: [
          { id: 'pan-template', name: 'Pan_template', aligned: template },
          { id: 'pan-variant', name: 'Pan_variant', aligned: variant.join('') },
        ],
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
      });
    });

    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    const matrix = page.getByRole('region', { name: /Alignment matrix, 2 rows by 2949 columns/ });
    const panRow = page.getByTestId('msa-horizontal-scroll-row');
    const pan = page.getByTestId('msa-horizontal-scroll');
    await expect(windowPanel).toBeVisible();
    await expect(pan).toBeVisible();

    for (const viewport of [
      { width: 390, height: 760 },
      { width: 820, height: 820 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await pan.focus();
      await page.keyboard.press('Home');
      await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBe(0);
      const geometry = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('[data-testid="msa-horizontal-scroll-row"]')!;
        const control = document.querySelector<HTMLInputElement>('[data-testid="msa-horizontal-scroll"]')!;
        const frame = document.querySelector<HTMLElement>('[data-testid="msa-alignment-view"]')!;
        const rowRect = row.getBoundingClientRect();
        const controlRect = control.getBoundingClientRect();
        const labelWidth = Number.parseFloat(getComputedStyle(frame).getPropertyValue('--motif-cs-msa-label-width'));
        const thumbWidth = Number.parseFloat(getComputedStyle(control).getPropertyValue('--motif-cs-msa-pan-thumb-width'));
        return {
          expectedSequenceX: rowRect.left + labelWidth,
          controlX: controlRect.left,
          controlHeight: controlRect.height,
          controlWidth: controlRect.width,
          thumbWidth,
        };
      });
      expect(Math.abs(geometry.controlX - geometry.expectedSequenceX)).toBeLessThanOrEqual(8);
      expect(geometry.controlHeight).toBeGreaterThanOrEqual(24);
      expect(geometry.controlWidth).toBeGreaterThan(100);
      expect(geometry.thumbWidth).toBeGreaterThanOrEqual(36);
    }

    const panBox = (await pan.boundingBox())!;
    await page.mouse.move(panBox.x + 12, panBox.y + panBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(panBox.x + panBox.width - 12, panBox.y + panBox.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBeGreaterThan(20_000);

    await pan.focus();
    await page.keyboard.press('Home');
    await matrix.focus();
    await page.keyboard.press('End');
    await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBeGreaterThan(20_000);
    await page.keyboard.press('Home');
    await page.keyboard.down('Shift');
    const matrixBox = (await matrix.boundingBox())!;
    await page.mouse.move(matrixBox.x + matrixBox.width * 0.75, matrixBox.y + matrixBox.height / 2);
    await page.mouse.wheel(0, 540);
    await page.keyboard.up('Shift');
    await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    const windowBody = windowPanel.locator('.motif-cs-window-body');
    await windowBody.evaluate((element) => { element.scrollTop = 0; });
    await page.mouse.wheel(0, 700);
    await expect.poll(() => windowBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(msaCampaignOutputDir, `msa-pan-rail-${browserName}-1440x900.png`) });
  });

  test('MSA aligned-FASTA import records honest provenance and rejects malformed replacement atomically', async ({ page }) => {
    await openArtifact(page, 900, 460);
    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    await page.getByRole('button', { name: 'Aligned file' }).click();
    await expect(page.locator('.motif-cs-msa-import-fields select').nth(1)).toHaveValue('imported');

    const input = page.getByLabel('Aligned FASTA or CLUSTAL');
    await input.fill('>sample A\nACGT--ACGT\n>sample B\nACGTTTACG');
    await page.getByTestId('msa-import-button').click();
    await expect(page.locator('.motif-cs-msa-error')).toContainText('same number of columns');
    expect(await page.evaluate(() => window.motifGetAlignments().length)).toBe(0);

    await input.fill('>sample A\nACGT--ACGT\n>sample B\nACGTTTACGT');
    await page.locator('.motif-cs-msa-import-fields select').nth(1).selectOption('clustal-omega');
    await page.locator('.motif-cs-msa-import-fields input').last().fill('1.2.4');
    await page.getByTestId('msa-import-button').click();
    await expect(page.getByTestId('msa-result-toolbar').getByText('Clustal Omega 1.2.4', { exact: true })).toBeVisible();
    await expect(page.getByTestId('msa-stats-bar')).toContainText('10 columns');

    const saved = await page.evaluate(() => window.motifGetAlignments());
    expect(saved).toHaveLength(1);
    expect(saved[0].engine).toMatchObject({ id: 'clustal-omega', label: 'Clustal Omega', version: '1.2.4', mode: 'local-command' });

    await page.getByRole('button', { name: 'Text' }).click();
    await page.locator('.motif-cs-msa-export-row select').selectOption('clustal');
    const exportedClustal = await page.getByLabel('CLUSTAL alignment text').inputValue();
    expect(exportedClustal).toMatch(/sample_A\s+ACGT--ACGT/);
    await page.locator('.motif-cs-msa-source > summary').click();
    await page.getByTestId('msa-workspace').getByRole('button', { name: 'Aligned file' }).click();
    await page.locator('.motif-cs-msa-import-fields input').first().fill('Round-tripped CLUSTAL');
    await page.locator('.motif-cs-msa-import-fields select').nth(1).selectOption('imported');
    await page.locator('.motif-cs-msa-import-fields input').last().fill('');
    await input.fill(exportedClustal);
    await page.getByTestId('msa-import-button').click();
    await expect(page.locator('.motif-cs-msa-toolbar .motif-cs-chip')).toHaveText('Imported alignment');
    const roundTripped = await page.evaluate(() => window.motifGetAlignments());
    expect(roundTripped).toHaveLength(2);
    expect(roundTripped[1].rows.map((row: { aligned: string }) => row.aligned)).toEqual(roundTripped[0].rows.map((row: { aligned: string }) => row.aligned));

    await page.getByRole('button', { name: 'Delete this alignment from the session' }).click();
    const deleteConfirmation = page.getByRole('group', { name: 'Confirm alignment deletion' });
    await expect(deleteConfirmation).toBeVisible();
    await expect(deleteConfirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
    expect(await page.evaluate(() => window.motifGetAlignments().length)).toBe(2);
    await deleteConfirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Delete this alignment from the session' })).toBeFocused();
    expect(await page.evaluate(() => window.motifGetAlignments().length)).toBe(2);
    await page.getByRole('button', { name: 'Delete this alignment from the session' }).click();
    await page.getByTestId('msa-confirm-delete').click();
    expect(await page.evaluate(() => window.motifGetAlignments().length)).toBe(1);
    await expect(page.locator('.motif-cs-msa-alignment-picker select')).toBeFocused();

    const invalidResult = await page.evaluate(() => {
      const before = window.motifGetAlignments().length;
      try {
        window.motifAddAlignments({
          name: 'bad', molecule: 'dna',
          rows: [{ name: 'one', aligned: 'ACGT' }, { name: 'two', aligned: 'ACG' }],
        });
        return { before, after: window.motifGetAlignments().length, code: 'none' };
      } catch (error) {
        return { before, after: window.motifGetAlignments().length, code: (error as { code?: string }).code };
      }
    });
    expect(invalidResult).toEqual({ before: 1, after: 1, code: 'MOTIF_INVALID_ALIGNMENT_INPUT' });
  });

  test('MSA imported viewer stays contained and accessible on a Claude Dark phone', async ({ page }) => {
    await openArtifact(page, 1180, 900);
    await page.locator('select[name="artifact-theme"]').selectOption('claude-dark');
    await page.evaluate(() => {
      const reference = 'ACGT'.repeat(30);
      const variantB = reference.split('');
      const variantC = reference.split('');
      variantB[17] = '-';
      variantB[61] = 'T';
      variantC[17] = '-';
      variantC[42] = 'A';
      window.motifAddAlignments({
        id: 'mafft-demo', name: 'Kinase homologs', molecule: 'dna', referenceRowId: 'reference',
        rows: [
          { id: 'reference', name: 'Campaign2_reference', aligned: reference },
          { id: 'variant-b', name: 'Campaign2_variant_B_ins3', aligned: variantB.join('') },
          { id: 'variant-c', name: 'Campaign2_variant_C_del3', aligned: variantC.join('') },
        ],
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command', parameters: ['--auto'] },
      });
    });
    await page.setViewportSize({ width: 390, height: 760 });
    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    await expect(windowPanel).toBeVisible();
    await expect(windowPanel.locator('.motif-cs-msa-source > summary .motif-cs-chip')).toHaveText('MAFFT');
    expect(await page.evaluate(() => window.motifGetAlignments()[0]?.engine.version)).toBe('7.526');
    await expect(windowPanel.locator('.motif-cs-msa-row-name-trailing')).toHaveText(['reference', 'ins3', 'del3']);

    const geometry = await windowPanel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);

    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'msa-claude-dark-viewer-390x760.png') });
    await page.getByRole('button', { name: 'Text' }).click();
    await expect(page.getByLabel('Aligned FASTA alignment text')).toHaveValue(/>Campaign2_reference/);
    await page.locator('.motif-cs-msa-export-row select').selectOption('clustal');
    await expect(page.getByLabel('CLUSTAL alignment text')).toHaveValue(/CLUSTAL W/);

    const accessibility = await new AxeBuilder({ page }).include('.motif-cs-window').analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'msa-claude-dark-390x760.png') });
  });

  test('MSA 100-row density preserves suffixes, semantics, and chained scrolling', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => {
      const reference = 'ACGT'.repeat(375);
      const rows = Array.from({ length: 100 }, (_, index) => {
        const aligned = reference.split('');
        if (index > 0) {
          const position = (index * 37) % aligned.length;
          aligned[position] = aligned[position] === 'A' ? 'T' : 'A';
        }
        return {
          id: `density-${index + 1}`,
          name: `Density DNA variant ${String(index + 1).padStart(3, '0')}`,
          aligned: aligned.join(''),
        };
      });
      window.motifAddAlignments({
        id: 'density-100',
        name: '100-row density audit',
        molecule: 'dna',
        referenceRowId: rows[0].id,
        rows,
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
      });
    });

    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    const matrix = page.getByRole('region', { name: /Alignment matrix, 100 rows by 1500 columns/ });
    const windowBody = windowPanel.locator('.motif-cs-window-body');
    await expect(windowPanel).toBeVisible();
    await expect(page.getByTestId('msa-stats-bar')).toContainText('100 rows');
    await expect(matrix).toHaveAttribute('aria-describedby', 'motif-cs-msa-matrix-help');

    const overview = page.getByTestId('msa-overview');
    const overviewBox = (await overview.boundingBox())!;
    await page.mouse.move(overviewBox.x + 3, overviewBox.y + overviewBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(overviewBox.x + overviewBox.width - 3, overviewBox.y + overviewBox.height / 2, { steps: 8 });
    await page.mouse.up();
    await overview.click({ position: { x: overviewBox.width - 3, y: overviewBox.height / 2 } });
    await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    const resizeBox = await windowPanel.locator('.motif-cs-window-resize').boundingBox();
    expect(resizeBox?.width).toBeGreaterThanOrEqual(24);
    expect(resizeBox?.height).toBeGreaterThanOrEqual(24);

    await page.setViewportSize({ width: 640, height: 700 });
    const trailingLabels = windowPanel.locator('.motif-cs-msa-row-name-trailing');
    await expect(trailingLabels.first()).toHaveText('001');
    await expect(trailingLabels.nth(99)).toHaveText('100');
    expect(await trailingLabels.first().evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);

    await matrix.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const reviewPosition = await matrix.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
    expect(reviewPosition.left).toBeGreaterThan(0);
    expect(reviewPosition.top).toBeGreaterThan(1_000);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByRole('button', { name: 'Viewer', exact: true }).click();
    await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBeGreaterThanOrEqual(reviewPosition.left - 2);
    await expect.poll(() => matrix.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(reviewPosition.top - 2);

    await windowBody.evaluate((element) => { element.scrollTop = 0; });
    const visibleMatrixPoint = await matrix.evaluate((element) => {
      const matrixRect = element.getBoundingClientRect();
      const bodyRect = element.closest('.motif-cs-window-body')!.getBoundingClientRect();
      return {
        x: matrixRect.left + matrixRect.width / 2,
        y: Math.min(matrixRect.bottom, bodyRect.bottom) - 12,
      };
    });
    await page.mouse.move(visibleMatrixPoint.x, visibleMatrixPoint.y);
    await page.mouse.wheel(0, 700);
    await expect.poll(() => windowBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const lastRowVisible = await windowPanel.locator('.motif-cs-msa-matrix-row').nth(99).evaluate((row) => {
      const rowRect = row.getBoundingClientRect();
      const viewportRect = row.closest('.motif-cs-msa-matrix-scroll')!.getBoundingClientRect();
      return rowRect.top >= viewportRect.top - 1 && rowRect.bottom <= viewportRect.bottom + 1;
    });
    expect(lastRowVisible).toBe(true);
    await expect(windowPanel.locator('.motif-cs-msa-export-row')).toBeInViewport();

    const accessibility = await new AxeBuilder({ page }).include('.motif-cs-window').analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'msa-density-100-row-fixed.png') });
  });

  test('MSA 50k-column overview stays bounded and navigates without column-sized DOM', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.evaluate(() => {
      const template = 'ACGT'.repeat(12_500);
      const variant = template.split('');
      for (let column = 2_500; column < variant.length; column += 5_000) {
        variant[column] = variant[column] === 'A' ? 'T' : 'A';
      }
      window.motifAddAlignments({
        id: 'fifty-thousand-columns',
        name: '50k-column audit',
        molecule: 'dna',
        referenceRowId: 'long-template',
        rows: [
          { id: 'long-template', name: 'Long_template', aligned: template },
          { id: 'long-variant', name: 'Long_variant', aligned: variant.join('') },
        ],
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
      });
    });

    const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    const matrix = page.getByRole('region', { name: /Alignment matrix, 2 rows by 50000 columns/ });
    await expect(windowPanel).toBeVisible();
    await expect(matrix).toBeVisible();
    await expect(page.getByTestId('msa-stats-bar')).toContainText('50,000 columns');
    expect(await windowPanel.locator('.motif-cs-msa-symbol').count()).toBeLessThan(800);
    await expect(page.getByTestId('msa-overview').locator('path')).toHaveCount(1);
    await page.getByTestId('msa-overview').focus();
    await page.keyboard.press('End');
    await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBeGreaterThan(400_000);
    await expect(windowPanel.locator('.motif-cs-msa-window-note')).toContainText('50,000');
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'msa-50k-columns.png') });
  });

  test('aligned AB1 reads expose interactive forward and reverse chromatograms', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.locator('select[name="artifact-theme"]').selectOption('claude-light');
    await page.evaluate(() => {
      const template = 'ACGTTGCA'.repeat(15);
      const mutate = (sequence: string, index: number, base: string) => `${sequence.slice(0, index)}${base}${sequence.slice(index + 1)}`;
      const forward = mutate(template, 20, template[20] === 'A' ? 'T' : 'A');
      const orientedReverse = mutate(template, 51, template[51] === 'C' ? 'G' : 'C');
      const complement: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
      const reverseCalls = Array.from(orientedReverse).reverse().map((base) => complement[base]).join('');
      const makeTrace = (calls: string, sampleName: string, storedReverseComplement: boolean) => {
        const peakPositions = Array.from(calls, (_base, index) => (index * 10) + 6);
        const sampleCount = calls.length * 10 + 12;
        const channels = Object.fromEntries(['A', 'C', 'G', 'T'].map((base) => [base, Array.from({ length: sampleCount }, () => 0)])) as Record<string, number[]>;
        Array.from(calls).forEach((base, index) => {
          const peak = peakPositions[index];
          for (let offset = -5; offset <= 5; offset += 1) {
            const sample = peak + offset;
            if (sample < 0 || sample >= sampleCount) continue;
            channels[base][sample] = Math.round(1_200 * Math.exp(-(offset * offset) / 7));
            for (const other of ['A', 'C', 'G', 'T']) {
              if (other !== base) channels[other][sample] += Math.round(80 * Math.exp(-(offset * offset) / 12));
            }
          }
        });
        return {
          schema: 'motif.sanger-trace.v1',
          version: 1,
          baseCalls: calls,
          sequence: calls,
          qualityScores: Array.from(calls, (_base, index) => 18 + (index % 28)),
          peakPositions,
          channels,
          sampleCount,
          dyeOrder: 'GATC',
          storedReverseComplement,
          warnings: [],
          metadata: {
            format: 'ABIF',
            abifVersion: 101,
            baseCallsTag: 'PBAS2',
            qualityScoresTag: 'PCON2',
            peakPositionsTag: 'PLOC2',
            channelTags: { A: 'DATA10', C: 'DATA12', G: 'DATA9', T: 'DATA11' },
            sampleName,
          },
        };
      };
      window.motifRenderInventory([
        { id: 'sanger-template', name: 'Sanger template', molecule: 'dna', topology: 'linear', group: 'Sanger review', seq: template },
        { id: 'read-forward', name: 'Read_forward_01', molecule: 'dna', topology: 'linear', group: 'Sanger review', seq: forward, sangerTrace: makeTrace(forward, 'Read_forward_01', false) },
        { id: 'read-reverse', name: 'Read_reverse_02', molecule: 'dna', topology: 'linear', group: 'Sanger review', seq: reverseCalls, sangerTrace: makeTrace(reverseCalls, 'Read_reverse_02', true) },
      ] as never);
      window.motifAddAlignments({
        id: 'sanger-review',
        name: 'Sanger sequencing review',
        molecule: 'dna',
        referenceRowId: 'template-row',
        rows: [
          { id: 'template-row', name: 'Sanger template', sourceRecordId: 'sanger-template', aligned: template },
          { id: 'forward-row', name: 'Read_forward_01', sourceRecordId: 'read-forward', aligned: forward },
          { id: 'reverse-row', name: 'Read_reverse_02', sourceRecordId: 'read-reverse', aligned: orientedReverse },
        ],
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command', usedFallback: false },
      });
    });

    const traceTab = page.getByRole('button', { name: 'Traces' });
    await expect(traceTab).toBeVisible();
    await traceTab.click();
    const traceViewer = page.getByTestId('sanger-trace-viewer');
    const canvases = traceViewer.locator('canvas');
    await expect(traceViewer).toBeVisible();
    await expect(traceViewer.getByRole('button', { name: 'Stacked', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvases).toHaveCount(2);
    await expect(canvases.first()).toBeVisible();
    await expect(traceViewer).toContainText('forward');
    await canvases.first().click({ position: { x: 250, y: 44 } });
    await expect(traceViewer.locator('.motif-cs-sanger-call-status')).toContainText('Alignment position');
    const stackScroll = page.getByTestId('sanger-trace-stack-scroll');
    const initialScrollLeft = await stackScroll.evaluate((element) => element.scrollLeft);
    await stackScroll.hover();
    await page.mouse.wheel(280, 0);
    await expect.poll(() => stackScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(initialScrollLeft);
    const position = traceViewer.getByRole('slider', { name: 'Alignment position' });
    await position.fill('80');
    await traceViewer.getByRole('button', { name: 'Zoom chromatogram in' }).click();
    await traceViewer.locator('.motif-cs-sanger-toolbar select').selectOption('reverse-row');
    await expect(traceViewer).toContainText('reverse');
    await expect(traceViewer.locator('.motif-cs-sanger-lane[data-active="true"]')).toContainText('Read_reverse_02');
    await traceViewer.getByRole('button', { name: 'Single', exact: true }).click();
    await expect(traceViewer.locator('canvas')).toHaveCount(1);
    await expect(traceViewer.locator('canvas')).toHaveAttribute('aria-label', /Read_reverse_02 chromatogram aligned reverse/);
    expect(await traceViewer.locator('canvas').evaluate((element: HTMLCanvasElement) => {
      const context = element.getContext('2d');
      if (!context) return false;
      return context.getImageData(0, 0, element.width, element.height).data.some((value, index) => index % 4 === 3 && value > 0);
    })).toBe(true);
    await traceViewer.getByRole('button', { name: 'Stacked', exact: true }).click();
    await expect(traceViewer.locator('canvas')).toHaveCount(2);

    await page.getByRole('button', { name: 'Viewer', exact: true }).click();
    await page.getByRole('button', { name: 'Traces', exact: true }).click();
    await expect(traceViewer.locator('.motif-cs-sanger-toolbar select')).toHaveValue('reverse-row');
    await expect(traceViewer.getByRole('slider', { name: 'Alignment position' })).toHaveValue('80');
    await expect(traceViewer.getByRole('button', { name: 'Stacked', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Previous variable column' }).click();

    const exported = await page.evaluate(() => window.motifGetInventory());
    expect((exported as Array<{ sangerTrace?: { channels?: { A?: number[] } } }>).filter((record) => record.sangerTrace).length).toBe(2);
    expect((exported as Array<{ sangerTrace?: { channels?: { A?: number[] } } }>)[1].sangerTrace?.channels?.A?.length).toBeGreaterThan(1_000);

    const accessibility = await new AxeBuilder({ page }).include('.motif-cs-window').analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'sanger-traces-claude-light.png') });

    await page.setViewportSize({ width: 390, height: 760 });
    await expect(traceViewer).toBeVisible();
    expect(await traceViewer.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(await traceViewer.evaluate((element) => element.clientWidth + 2));
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'sanger-traces-phone.png') });

    await page.setViewportSize({ width: 900, height: 760 });
    for (const theme of ['light', 'dark', 'claude-light', 'claude-dark'] as const) {
      await page.locator('select[name="artifact-theme"]').selectOption(theme);
      await page.waitForTimeout(80);
      await expect(traceViewer).toBeVisible();
      await page.screenshot({ path: path.join(msaCampaignOutputDir, `sanger-traces-${theme}.png`) });
    }
  });

  test('eight AB1 reads stay synchronized, virtualized, and reviewable at compact sizes', async ({ page }) => {
    await openArtifact(page, 1180, 820);
    await page.locator('select[name="artifact-theme"]').selectOption('claude-light');
    await page.evaluate(() => {
      const template = 'ACGTTGCA'.repeat(45);
      const complement: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
      const reverseComplement = (sequence: string) => Array.from(sequence).reverse().map((base) => complement[base]).join('');
      const mutate = (sequence: string, index: number, base: string) => `${sequence.slice(0, index)}${base}${sequence.slice(index + 1)}`;
      const makeTrace = (calls: string, sampleName: string, storedReverseComplement: boolean) => {
        const peakPositions = Array.from(calls, (_base, index) => (index * 9) + 6);
        const sampleCount = calls.length * 9 + 12;
        const channels = Object.fromEntries(['A', 'C', 'G', 'T'].map((base) => [base, Array.from({ length: sampleCount }, () => 0)])) as Record<string, number[]>;
        Array.from(calls).forEach((base, index) => {
          const peak = peakPositions[index];
          for (let offset = -4; offset <= 4; offset += 1) {
            const sample = peak + offset;
            if (sample < 0 || sample >= sampleCount) continue;
            channels[base][sample] = Math.round(1_100 * Math.exp(-(offset * offset) / 6));
            for (const other of ['A', 'C', 'G', 'T']) {
              if (other !== base) channels[other][sample] += Math.round(65 * Math.exp(-(offset * offset) / 10));
            }
          }
        });
        return {
          schema: 'motif.sanger-trace.v1',
          version: 1,
          baseCalls: calls,
          sequence: calls,
          qualityScores: Array.from(calls, (_base, index) => 16 + (index % 31)),
          peakPositions,
          channels,
          sampleCount,
          dyeOrder: 'GATC',
          storedReverseComplement,
          warnings: [],
          metadata: {
            format: 'ABIF',
            abifVersion: 101,
            baseCallsTag: 'PBAS2',
            qualityScoresTag: 'PCON2',
            peakPositionsTag: 'PLOC2',
            channelTags: { A: 'DATA10', C: 'DATA12', G: 'DATA9', T: 'DATA11' },
            sampleName,
          },
        };
      };
      const records: Array<Record<string, unknown>> = [
        { id: 'stack-template', name: 'Plate template', molecule: 'dna', topology: 'linear', group: 'Plate AB1', seq: template },
      ];
      const rows: Array<Record<string, unknown>> = [
        { id: 'stack-template-row', name: 'Plate template', sourceRecordId: 'stack-template', aligned: template },
      ];
      for (let index = 0; index < 8; index += 1) {
        const start = index * 24;
        const end = start + 160;
        let oriented = template.slice(start, end);
        oriented = mutate(oriented, 18 + index, oriented[18 + index] === 'A' ? 'T' : 'A');
        const reverse = index % 2 === 1;
        const calls = reverse ? reverseComplement(oriented) : oriented;
        const name = `${reverse ? 'REV' : 'FWD'}_PlateA_${String(index + 1).padStart(2, '0')}`;
        records.push({
          id: `stack-read-${index + 1}`,
          name,
          molecule: 'dna',
          topology: 'linear',
          group: 'Plate AB1',
          seq: calls,
          sangerTrace: makeTrace(calls, name, reverse),
        });
        rows.push({
          id: `stack-row-${index + 1}`,
          name,
          sourceRecordId: `stack-read-${index + 1}`,
          aligned: `${'-'.repeat(start)}${oriented}${'-'.repeat(template.length - end)}`,
        });
      }
      window.motifRenderInventory(records as never);
      window.motifAddAlignments({
        id: 'stacked-sanger-review',
        name: 'Eight-read Sanger review',
        molecule: 'dna',
        referenceRowId: 'stack-template-row',
        rows,
        engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command', usedFallback: false },
      });
    });

    await page.getByRole('button', { name: 'Traces', exact: true }).click();
    const traceViewer = page.getByTestId('sanger-trace-viewer');
    const stack = page.getByTestId('sanger-trace-stack-scroll');
    await expect(page.getByTestId('sanger-trace-lane')).toHaveCount(8);
    await expect(traceViewer.getByRole('button', { name: 'Stacked', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const initialCanvasCount = await traceViewer.locator('canvas').count();
    expect(initialCanvasCount).toBeGreaterThan(0);
    expect(initialCanvasCount).toBeLessThan(8);
    expect(await stack.evaluate((element) => element.scrollHeight)).toBeGreaterThan(await stack.evaluate((element) => element.clientHeight));

    const windowBody = page.locator('.motif-cs-window').filter({ has: traceViewer }).locator('.motif-cs-window-body');
    await traceViewer.locator('.motif-cs-sanger-toolbar select').selectOption('stack-row-8');
    await expect(traceViewer.locator('.motif-cs-sanger-lane[data-active="true"]')).toContainText('REV_PlateA_08');
    await expect.poll(() => stack.evaluate((element) => element.scrollTop)).toBeGreaterThan(1_000);
    await expect.poll(() => windowBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await windowBody.evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(() => windowBody.evaluate((element) => element.scrollTop)).toBe(0);
    await stack.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => windowBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await windowBody.evaluate((element) => { element.scrollTop = 0; });
    await traceViewer.getByRole('slider', { name: 'Alignment position' }).fill('300');
    await traceViewer.getByRole('button', { name: 'Zoom chromatogram in' }).click();
    const qualityToggle = traceViewer.getByRole('checkbox', { name: 'Quality' });
    await qualityToggle.uncheck();

    await page.getByRole('button', { name: 'Viewer', exact: true }).click();
    await page.getByRole('button', { name: 'Traces', exact: true }).click();
    await expect(traceViewer.locator('.motif-cs-sanger-toolbar select')).toHaveValue('stack-row-8');
    await expect(traceViewer.getByRole('slider', { name: 'Alignment position' })).toHaveValue('300');
    await expect(qualityToggle).not.toBeChecked();

    await traceViewer.getByRole('button', { name: 'Single', exact: true }).click();
    await expect(traceViewer.locator('canvas')).toHaveCount(1);
    await expect(traceViewer.locator('canvas')).toHaveAttribute('aria-label', /REV_PlateA_08 chromatogram aligned reverse/);
    await traceViewer.getByRole('button', { name: 'Stacked', exact: true }).click();

    const accessibility = await new AxeBuilder({ page }).include('.motif-cs-window').analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'sanger-stacked-eight-claude-light.png') });

    await page.setViewportSize({ width: 390, height: 760 });
    await expect(traceViewer).toBeVisible();
    expect(await traceViewer.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(await traceViewer.evaluate((element) => element.clientWidth + 2));
    await traceViewer.getByRole('button', { name: 'Single', exact: true }).click();
    await expect(traceViewer.locator('canvas')).toHaveCount(1);
    expect(await traceViewer.locator('canvas').evaluate((element: HTMLCanvasElement) => {
      const context = element.getContext('2d');
      if (!context) return false;
      return context.getImageData(0, 0, element.width, element.height).data.some((value, index) => index % 4 === 3 && value > 0);
    })).toBe(true);
    await traceViewer.getByRole('button', { name: 'Stacked', exact: true }).click();
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'sanger-stacked-eight-phone.png') });

    await page.setViewportSize({ width: 900, height: 760 });
    await page.locator('select[name="artifact-theme"]').selectOption('claude-dark');
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(msaCampaignOutputDir, 'sanger-stacked-eight-claude-dark.png') });
  });

  for (const theme of ['light', 'dark', 'claude-light', 'claude-dark'] as const) {
    test(`MSA viewer remains legible and accessible in ${theme}`, async ({ page }) => {
      await openArtifact(page, 1180, 760);
      await page.locator('select[name="artifact-theme"]').selectOption(theme);
      await page.setViewportSize({ width: 820, height: 760 });
      await page.evaluate(() => window.motifAddAlignments({
        id: 'theme-alignment',
        name: 'Theme alignment',
        molecule: 'protein',
        referenceRowId: 'alpha',
        rows: [
          { id: 'alpha', name: 'Alpha kinase', aligned: 'MKTAYIAKQRQISFVKSHFSRQDILDLWQ' },
          { id: 'beta', name: 'Beta kinase', aligned: 'MKTAYIAKQ-KISFVKSHFTRQDILDLWQ' },
          { id: 'gamma', name: 'Gamma kinase', aligned: 'MKTAYIAKQRQISFVKSHFSRQEILDLWQ' },
        ],
        engine: { id: 'muscle', label: 'MUSCLE', version: '5.3', mode: 'local-command' },
      }));
      const windowPanel = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
      await expect(windowPanel).toBeVisible();
      await page.getByTestId('msa-view-menu-button').click();
      await page.getByTestId('msa-view-menu').getByRole('checkbox', { name: 'Residue colors' }).check();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('msa-alignment-view')).toBeVisible();
      const accessibility = await new AxeBuilder({ page }).include('.motif-cs-window').analyze();
      expect(accessibility.violations).toEqual([]);
      const box = (await windowPanel.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(804);
      expect(box.height).toBeLessThanOrEqual(744);
      await page.screenshot({ path: path.join(outputDir, `msa-${theme}-820x760.png`) });
    });
  }

  for (const viewport of [
    { width: 640, height: 700 },
    { width: 767, height: 700 },
    { width: 1535, height: 700 },
    { width: 1536, height: 700 },
    { width: 1599, height: 700 },
    { width: 1600, height: 700 },
  ]) {
    test(`keeps pane geometry coherent at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await openArtifact(page, viewport.width, viewport.height);
      const toolsToggle = page.getByRole('button', { name: /Tools/ }).first();
      if ((await toolsToggle.getAttribute('aria-pressed')) !== 'true') await toolsToggle.click();
      const main = page.locator('.motif-cs-main');
      const dimensions = await main.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 2);
      expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 2);
      await page.screenshot({
        path: path.join(outputDir, `layout-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
      });
    });
  }

  test('keeps Motif visibly identified across Claude Science frame sizes', async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1100, height: 800 },
      { width: 640, height: 760 },
      { width: 480, height: 760 },
    ]) {
      await openArtifact(page, viewport.width, viewport.height);
      const topbar = page.getByRole('banner', { name: 'Motif for Claude Science workspace' });
      const brand = page.locator('.motif-cs-brand');
      await expect(topbar).toBeVisible();
      await expect(brand).toBeVisible();
      await expect(brand).toHaveAccessibleName('Motif for Claude Science');
      await expect(brand.locator('span')).toHaveText('Motif');

      const brandBox = (await brand.boundingBox())!;
      const topbarBox = (await topbar.boundingBox())!;
      expect(brandBox.x).toBeGreaterThanOrEqual(topbarBox.x);
      expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(topbarBox.x + topbarBox.width + 1);
      expect(brandBox.y).toBeGreaterThanOrEqual(topbarBox.y);
      expect(brandBox.y + brandBox.height).toBeLessThanOrEqual(topbarBox.y + topbarBox.height + 1);

      if (viewport.width > 1180) await expect(brand.locator('small')).toBeVisible();
      else await expect(brand.locator('small')).toBeHidden();

      await page.screenshot({
        path: path.join(outputDir, `motif-brand-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
      });
    }
  });

  for (const theme of ['light', 'dark', 'claude-light', 'claude-dark'] as const) {
    test(`renders the ${theme} appearance preset`, async ({ page }) => {
      await openArtifact(page, 1180, 900);
      await page.locator('select[name="artifact-theme"]').selectOption(theme);
      await page.waitForTimeout(180);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.screenshot({ path: path.join(outputDir, `theme-${theme}-1180x900.png`), fullPage: true });
    });
  }
});
