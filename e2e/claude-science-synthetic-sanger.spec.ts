import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSyntheticSangerPlate } from './synthetic-abif';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const outputDirectory = path.resolve('output/playwright/synthetic-sanger-campaign');
const PLATE_SIZE = 12;
const PREVIEW_LIMIT = 10;

// Always-on counterpart of the real-data plate audit: the same MSA file-picker
// intake path, driven with generated ABIF files so it runs without fixtures.
test.describe('Claude Science synthetic Sanger plate', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  let plateDirectory = '';
  test.beforeEach(async () => {
    plateDirectory = await mkdtemp(path.join(tmpdir(), 'motif-synthetic-sanger-'));
  });
  test.afterEach(async () => {
    if (plateDirectory) await rm(plateDirectory, { recursive: true, force: true });
    plateDirectory = '';
  });

  test('directly imports and selects a synthetic AB1 plate from the MSA file picker', async ({ page, browserName }) => {
    await mkdir(outputDirectory, { recursive: true });
    const diagnostics: string[] = [];
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') diagnostics.push(`console.${message.type()}: ${message.text()}`);
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();

    const plate = buildSyntheticSangerPlate(PLATE_SIZE);
    expect(plate.length).toBeGreaterThan(PREVIEW_LIMIT);
    expect(plate.some((read) => read.orientation === 'reverse' && /_R_/.test(read.fileName))).toBe(true);
    expect(new Set(plate.map((read) => read.baseCalls)).size).toBe(plate.length);
    const fixturePaths = await Promise.all(plate.map(async (read) => {
      const filePath = path.join(plateDirectory, read.fileName);
      await writeFile(filePath, read.bytes);
      return filePath;
    }));

    const beforeCount = await page.evaluate(() => window.motifGetInventory().length);
    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    const msaWindow = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    await msaWindow.getByLabel('Choose sequence files for alignment').setInputFiles(fixturePaths);

    await expect.poll(() => page.evaluate(() => window.motifGetInventory().length), { timeout: 30_000 })
      .toBe(beforeCount + plate.length);
    await expect(msaWindow.getByTestId('msa-record-list').locator('input:checked')).toHaveCount(PREVIEW_LIMIT);
    const selectedNames = await msaWindow.getByTestId('msa-record-list')
      .locator('.motif-cs-msa-record-option[data-active="true"] .motif-cs-msa-record-name')
      .allTextContents();
    expect(selectedNames).not.toContain('pUC19');
    expect(selectedNames.every((name) => plate.some((read) => name.includes(read.sampleName)))).toBe(true);
    const intakeStatus = msaWindow.locator('.motif-cs-msa-intake-status');
    await expect(intakeStatus).toContainText(`Imported ${plate.length} records`);
    await expect(intakeStatus).toContainText(`${plate.length - PREVIEW_LIMIT} over the ${PREVIEW_LIMIT}-record preview limit`);

    const imported = await page.evaluate(() => window.motifGetInventory().filter((record) => record.sangerTrace)) as Array<{
      name: string;
      seq: string;
      sangerTrace?: { baseCalls: string; peakPositions: number[]; metadata: { sampleWell?: string } };
      provenance?: { fileName?: string; warnings?: string[] };
    }>;
    expect(imported).toHaveLength(plate.length);
    const importedByFile = new Map(imported.map((record) => [record.provenance?.fileName, record]));
    for (const read of plate) {
      const record = importedByFile.get(read.fileName);
      expect(record, read.fileName).toBeTruthy();
      expect(record!.name).toBe(read.sampleName);
      expect(record!.seq).toBe(read.baseCalls);
      expect(record!.sangerTrace?.baseCalls).toBe(read.baseCalls);
      expect(record!.sangerTrace?.peakPositions).toHaveLength(read.baseCalls.length);
      expect(record!.sangerTrace?.metadata.sampleWell).toBe(read.well);
      expect(record!.provenance?.warnings ?? []).toEqual([]);
    }
    await page.screenshot({ path: path.join(outputDirectory, `${browserName}-synthetic-plate-direct-msa-intake.png`) });

    await page.setViewportSize({ width: 390, height: 760 });
    const dropzone = msaWindow.getByTestId('msa-record-dropzone');
    await expect(dropzone).toBeVisible();
    expect(await dropzone.evaluate((element) => element.scrollWidth))
      .toBeLessThanOrEqual(await dropzone.evaluate((element) => element.clientWidth + 2));
    const windowBody = msaWindow.locator('.motif-cs-window-body');
    expect(await windowBody.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
      await windowBody.evaluate((element) => element.clientHeight),
    );
    await windowBody.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(intakeStatus).toBeVisible();
    await page.screenshot({ path: path.join(outputDirectory, `${browserName}-synthetic-plate-direct-msa-intake-390x760-bottom.png`) });
    expect(diagnostics).toEqual([]);
  });
});
