import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { selectRecord } from './record-selection';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const outputDir = path.resolve('output/playwright/pcr-materialization');

test.describe('Claude Science PCR materialization', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test.beforeAll(async () => {
    await mkdir(outputDir, { recursive: true });
  });

  test('keeps simulation result-only and creates one exact provenance-linked amplicon', async ({ page }) => {
    const diagnostics: string[] = [];
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        diagnostics.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();

    const sourceBefore = await page.evaluate(() => {
      const active = window.motifGetActiveRecord?.();
      return {
        id: active?.id,
        sequence: active?.seq,
        count: window.motifGetInventory?.().length,
      };
    });
    expect(sourceBefore.id).toBeTruthy();

    const primerPanel = page.locator('details[data-rail-tool="primer-design"]');
    await primerPanel.locator(':scope > summary').click();
    await primerPanel.getByTestId('open-primer-workspace').click();
    const workspace = page.getByTestId('primer-workspace');
    await expect(workspace.locator('.motif-cs-primer-pair-row').first()).toBeVisible();
    const simulate = workspace.getByRole('button', { name: 'Simulate PCR' });
    const create = workspace.getByRole('button', { name: 'Create amplicon record' });
    await expect(simulate).toBeEnabled();
    await expect(create).toBeEnabled();

    await simulate.click();
    await expect(page.locator('.motif-cs-workbench-notice')).toContainText('No sequence record was created');
    const afterSimulation = await page.evaluate(() => ({
      count: window.motifGetInventory?.().length,
      simulations: window.motifGetAnalysisWorkspace?.().analysisResults.filter((result) => (
        result.kind === 'pcr' && result.provenance.operation === 'pcr_simulation'
      )),
    }));
    expect(afterSimulation.count).toBe(sourceBefore.count);
    expect(afterSimulation.simulations).toHaveLength(1);
    expect(afterSimulation.simulations?.[0]).toMatchObject({
      parameters: { topology: expect.any(String) },
      provenance: { metadata: { recordCreated: false } },
    });
    expect(afterSimulation.simulations?.[0]?.kind === 'pcr'
      ? afterSimulation.simulations[0].data.products?.[0]
      : null).not.toHaveProperty('recordId');

    await create.click();
    await expect(workspace).toHaveCount(0);
    const materialized = await page.evaluate((sourceId) => {
      const inventory = window.motifGetInventory?.() ?? [];
      const source = inventory.find((record) => record.id === sourceId);
      const active = window.motifGetActiveRecord?.();
      const result = window.motifGetAnalysisWorkspace?.().analysisResults.find((candidate) => (
        candidate.kind === 'pcr' && candidate.provenance.operation === 'pcr_materialization'
      ));
      return { inventory, source, active, result };
    }, sourceBefore.id);
    expect(materialized.inventory).toHaveLength((sourceBefore.count ?? 0) + 1);
    expect(materialized.source?.seq).toBe(sourceBefore.sequence);
    expect(materialized.active).toMatchObject({
      molecule: 'dna',
      topology: 'linear',
      provenance: {
        operation: 'pcr_materialization',
        parentRecordId: sourceBefore.id,
        templateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        productSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(materialized.result).toMatchObject({
      kind: 'pcr',
      status: 'complete',
      inputRecordIds: [sourceBefore.id],
      parameters: { topology: expect.any(String) },
      data: {
        templateRecordId: sourceBefore.id,
        products: [{ recordId: materialized.active?.id, lengthBp: materialized.active?.seq?.length }],
      },
    });

    const resultsPanel = page.locator('details[data-rail-tool="analysis-results"]');
    await resultsPanel.locator(':scope > summary').click();
    const materializedRow = resultsPanel.locator(`[data-testid="analysis-result-${materialized.result?.id}"]`);
    await expect(materializedRow).toContainText('PCR');
    await expect(materializedRow.locator('.motif-cs-agent-result-heading [data-freshness="fresh"]')).toBeVisible();
    await page.screenshot({ path: path.join(outputDir, 'materialized-result-light.png'), fullPage: true });

    await page.locator('select[name="artifact-theme"]').selectOption('claude-dark');
    await page.setViewportSize({ width: 760, height: 900 });
    await expect(materializedRow).toBeVisible();
    expect(await resultsPanel.locator('.motif-cs-agent-results').evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
    await page.screenshot({ path: path.join(outputDir, 'materialized-result-compact-dark.png'), fullPage: true });
    expect(diagnostics).toEqual([]);
  });

  test('the selected pair states the tailed amplicon length that Create amplicon record makes', async ({ page }) => {
    // The evidence heading read "373 bp amplicon" for a pair with two 8-nt
    // tails, and the amplicon record it created was 389 bp.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    const countBefore = await page.evaluate(() => window.motifGetInventory?.().length ?? 0);

    const primerPanel = page.locator('details[data-rail-tool="primer-design"]');
    await primerPanel.locator(':scope > summary').click();
    await primerPanel.getByTestId('open-primer-workspace').click();
    const workspace = page.getByTestId('primer-workspace');
    await expect(workspace.locator('.motif-cs-primer-pair-row').first()).toBeVisible();
    await workspace.getByText('Advanced constraints').click();
    await workspace.getByLabel('Forward 5′ tail').fill('GCGAATTC');
    await workspace.getByLabel('Reverse 5′ tail').fill('GCAAGCTT');

    const heading = workspace.locator('.motif-cs-primer-evidence-heading > span');
    await expect(heading).toHaveText(/^[\d,]+ bp amplicon with tails$/);
    const stated = Number((await heading.textContent())!.replace(/[^\d]/g, ''));

    await workspace.getByRole('button', { name: 'Create amplicon record' }).click();
    await expect.poll(() => page.evaluate(() => window.motifGetInventory?.().length ?? 0)).toBe(countBefore + 1);
    const created = await page.evaluate(() => {
      const records = window.motifGetInventory?.() ?? [];
      return records[records.length - 1].seq;
    });
    expect(created.length).toBe(stated);
    expect(created.startsWith('GCGAATTC')).toBe(true);
    expect(created.endsWith('AAGCTTGC')).toBe(true);
  });

  test('uses the pair\'s amplicon, not its template, as the cloning design\'s first part', async ({ page }) => {
    const diagnostics: string[] = [];
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    const source = await page.evaluate(() => ({
      id: window.motifGetActiveRecord?.()?.id,
      name: window.motifGetActiveRecord?.()?.name,
      count: window.motifGetInventory?.().length ?? 0,
    }));

    const useInCloning = async () => {
      const primerPanel = page.locator('details[data-rail-tool="primer-design"]');
      if (!(await primerPanel.evaluate((element) => (element as HTMLDetailsElement).open))) {
        await primerPanel.locator(':scope > summary').click();
      }
      await primerPanel.getByTestId('open-primer-workspace').click();
      const workspace = page.getByTestId('primer-workspace');
      await expect(workspace.locator('.motif-cs-primer-pair-row').first()).toBeVisible();
      await workspace.getByRole('button', { name: 'Use in cloning' }).click();
      await expect(workspace).toHaveCount(0);
      const design = page.getByTestId('cloning-design-workspace');
      await expect(design).toBeVisible();
      return (await design.getByTestId('cloning-design-part-1').getByRole('combobox', { name: 'Part 1' })
        .evaluate((select) => (select as HTMLSelectElement).selectedOptions[0]?.textContent ?? ''));
    };

    const firstPart = await useInCloning();
    const afterFirst = await page.evaluate(() => ({
      count: window.motifGetInventory?.().length ?? 0,
      active: window.motifGetActiveRecord?.(),
    }));
    expect(afterFirst.count).toBe(source.count + 1);
    expect(afterFirst.active?.provenance).toMatchObject({ operation: 'pcr_materialization', parentRecordId: source.id });
    expect(firstPart).toContain(afterFirst.active?.name ?? '<missing>');
    expect(firstPart).not.toBe(source.name);

    // A second press on the same pair reuses the amplicon through the same
    // duplicate guard as "Create amplicon record".
    await selectRecord(page, source.name!);
    const secondPart = await useInCloning();
    expect(await page.evaluate(() => window.motifGetInventory?.().length ?? 0)).toBe(source.count + 1);
    expect(secondPart).toBe(firstPart);
    expect(diagnostics).toEqual([]);
  });
});
