import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const fixtureDirectory = process.env.MOTIF_REAL_AB1_DIR;
const alignmentPayloadPaths = (process.env.MOTIF_REAL_MSA_PAYLOADS ?? '')
  .split(path.delimiter)
  .filter(Boolean);
const outputDirectory = path.resolve('output/playwright/real-sanger-campaign');

test.describe('Claude Science real Sanger campaign', () => {
  test.skip(
    !artifactUrl || !fixtureDirectory,
    'Set MOTIF_ARTIFACT_URL and MOTIF_REAL_AB1_DIR for the non-vendored real-data audit.',
  );

  async function openArtifact(page: Page) {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
  }

  test('directly imports and selects a real AB1 plate from the MSA file picker', async ({ page, browserName }) => {
    await mkdir(outputDirectory, { recursive: true });
    const diagnostics: string[] = [];
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') diagnostics.push(`console.${message.type()}: ${message.text()}`);
    });
    await openArtifact(page);

    const fixtureNames = (await readdir(fixtureDirectory!)).filter((name) => /\.(?:ab1|abi)$/i.test(name)).sort();
    expect(fixtureNames.length).toBeGreaterThanOrEqual(10);
    const fixturePaths = fixtureNames.map((name) => path.join(fixtureDirectory!, name));
    const beforeCount = await page.evaluate(() => window.motifGetInventory().length);
    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    const msaWindow = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    await msaWindow.getByLabel('Choose sequence files for alignment').setInputFiles(fixturePaths);

    await expect.poll(() => page.evaluate(() => window.motifGetInventory().length), { timeout: 30_000 })
      .toBe(beforeCount + fixtureNames.length);
    await expect(msaWindow.getByTestId('msa-record-list').locator('input:checked')).toHaveCount(10);
    const selectedNames = await msaWindow.getByTestId('msa-record-list')
      .locator('.motif-cs-msa-record-option[data-active="true"] .motif-cs-msa-record-name')
      .allTextContents();
    expect(selectedNames).not.toContain('pUC19');
    await expect(msaWindow.locator('.motif-cs-msa-intake-status')).toContainText(`Imported ${fixtureNames.length} records`);
    if (fixtureNames.length > 10) {
      await expect(msaWindow.locator('.motif-cs-msa-intake-status')).toContainText('over the 10-record preview limit');
    } else {
      await expect(msaWindow.locator('.motif-cs-msa-intake-status')).not.toContainText('over the 10-record preview limit');
    }
    const imported = await page.evaluate(() => window.motifGetInventory().filter((record) => record.sangerTrace));
    expect(imported).toHaveLength(fixtureNames.length);
    await page.screenshot({ path: path.join(outputDirectory, `${browserName}-real-plate-direct-msa-intake.png`) });

    await page.setViewportSize({ width: 390, height: 760 });
    await expect(msaWindow.getByTestId('msa-record-dropzone')).toBeVisible();
    expect(await msaWindow.getByTestId('msa-record-dropzone').evaluate((element) => element.scrollWidth))
      .toBeLessThanOrEqual(await msaWindow.getByTestId('msa-record-dropzone').evaluate((element) => element.clientWidth + 2));
    await page.screenshot({ path: path.join(outputDirectory, `${browserName}-real-plate-direct-msa-intake-390x760.png`) });
    const windowBody = msaWindow.locator('.motif-cs-window-body');
    expect(await windowBody.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
      await windowBody.evaluate((element) => element.clientHeight),
    );
    await windowBody.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(msaWindow.locator('.motif-cs-msa-intake-status')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outputDirectory, `${browserName}-real-plate-direct-msa-intake-390x760-bottom.png`) });
    expect(diagnostics).toEqual([]);
  });

  test('imports a plate, links three external alignments, and reviews reverse traces', async ({ page, browserName }) => {
    test.skip(alignmentPayloadPaths.length === 0, 'Set MOTIF_REAL_MSA_PAYLOADS for the external-engine trace-link audit.');
    await mkdir(outputDirectory, { recursive: true });
    const diagnostics: string[] = [];
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') diagnostics.push(`console.${message.type()}: ${message.text()}`);
    });
    await openArtifact(page);

    const fixtureNames = (await readdir(fixtureDirectory!)).filter((name) => /\.(?:ab1|abi)$/i.test(name)).sort();
    expect(fixtureNames.length).toBeGreaterThanOrEqual(10);
    const fixturePaths = fixtureNames.map((name) => path.join(fixtureDirectory!, name));
    const payloads = await Promise.all(alignmentPayloadPaths.map(async (payloadPath) => (
      JSON.parse(await readFile(payloadPath, 'utf8')) as {
        records: Array<{ id: string; name: string; sequence: string }>;
        alignments: Array<Record<string, unknown> & {
          id: string;
          name: string;
          rows: Array<{ id: string; name: string; sourceRecordId?: string; aligned: string }>;
          engine: { id: string; label: string; version: string };
        }>;
      }
    )));
    const template = payloads[0].records[0];
    const templateId = 'real-sanger-template';
    await page.evaluate(({ id, name, sequence }) => window.motifAddRecords({
      id,
      name,
      molecule: 'dna',
      topology: 'linear',
      group: 'Real Sanger review',
      seq: sequence,
    }), { id: templateId, name: template.name, sequence: template.sequence });

    const beforeCount = await page.evaluate(() => window.motifGetInventory().length);
    const alignmentTool = page.locator('details[data-rail-tool="alignment"]');
    await alignmentTool.locator(':scope > summary').click();
    await alignmentTool.getByTestId('msa-open-button').click();
    const msaWindow = page.locator('.motif-cs-window').filter({ has: page.getByTestId('msa-workspace') });
    await expect(msaWindow.getByTestId('msa-record-dropzone')).toBeVisible();
    await msaWindow.getByLabel('Choose sequence files for alignment').setInputFiles(fixturePaths);
    await expect.poll(() => page.evaluate(() => window.motifGetInventory().length), { timeout: 30_000 })
      .toBe(beforeCount + fixtureNames.length);
    await expect(msaWindow.getByTestId('msa-record-list').locator('input:checked')).toHaveCount(10);
    await expect(msaWindow.locator('.motif-cs-msa-local-options select')).not.toHaveValue(templateId);
    await expect(msaWindow.locator('.motif-cs-msa-intake-status')).toContainText(`Imported ${fixtureNames.length} records`);
    await page.screenshot({ path: path.join(outputDirectory, `${browserName}-real-plate-direct-msa-intake.png`) });

    const inventory = await page.evaluate(() => window.motifGetInventory()) as Array<{
      id: string;
      name: string;
      seq: string;
      sangerTrace?: { baseCalls: string; channels: { A: number[] }; qualityScores: number[] };
      provenance?: { fileName?: string };
    }>;
    const imported = inventory.filter((record) => record.sangerTrace);
    expect(imported).toHaveLength(fixtureNames.length);
    expect(imported.every((record) => record.sangerTrace?.baseCalls === record.seq)).toBe(true);
    expect(imported.every((record) => (record.sangerTrace?.channels.A.length ?? 0) > 1_000)).toBe(true);

    const recordIdByFilename = new Map(imported.map((record) => [
      record.provenance?.fileName?.replace(/\.(?:ab1|abi)$/i, '') ?? record.name,
      record.id,
    ]));
    const alignments = payloads.map((payload, index) => {
      const alignment = payload.alignments[0];
      return {
        ...alignment,
        id: `real-sanger-${alignment.engine.id}-${index + 1}`,
        name: `Real Sanger · ${alignment.engine.label}`,
        note: `Real ${fixtureNames.length}-read AB1 audit; reverse-primer calls were reverse-complemented before ${alignment.engine.label}.`,
        rows: alignment.rows.map((row, rowIndex) => ({
          ...row,
          sourceRecordId: rowIndex === 0 ? templateId : recordIdByFilename.get(row.name),
        })),
      };
    });
    expect(alignments.every((alignment) => alignment.rows.slice(1).every((row) => row.sourceRecordId))).toBe(true);
    await page.evaluate((items) => window.motifAddAlignments(items as never), alignments);

    await expect(msaWindow).toBeVisible();
    await expect(page.getByTestId('msa-stats-bar')).toContainText(`${fixtureNames.length + 1} rows`);
    const picker = msaWindow.locator('.motif-cs-msa-alignment-picker select');
    await expect(picker.locator('option')).toHaveCount(alignments.length);

    for (const alignment of alignments) {
      await picker.selectOption(alignment.id);
      await msaWindow.getByRole('button', { name: 'Traces' }).click();
      const traceViewer = page.getByTestId('sanger-trace-viewer');
      await expect(traceViewer).toBeVisible();
      const reverseRow = alignment.rows.find((row) => /_R_/i.test(row.name));
      expect(reverseRow).toBeTruthy();
      await traceViewer.locator('.motif-cs-sanger-toolbar select').selectOption({ label: reverseRow!.name });
      await expect(traceViewer.locator('.motif-cs-sanger-toolbar .motif-cs-chip')).toHaveText('reverse');
      const slider = traceViewer.getByRole('slider', { name: 'Alignment position' });
      await slider.fill(String(Math.floor(Number(await slider.getAttribute('max')) * 0.62)));
      await traceViewer.locator('canvas').click({ position: { x: 240, y: 46 } });
      await expect(traceViewer.locator('.motif-cs-sanger-call-status')).toContainText('quality');
      await page.screenshot({ path: path.join(outputDirectory, `${browserName}-${alignment.engine.id}-reverse-trace.png`) });
      await msaWindow.getByRole('button', { name: 'Viewer' }).click();
    }

    await page.setViewportSize({ width: 640, height: 760 });
    await picker.selectOption(alignments[0].id);
    await msaWindow.getByRole('button', { name: 'Traces' }).click();
    const compactTrace = page.getByTestId('sanger-trace-viewer');
    await expect(compactTrace).toBeVisible();
    expect(await compactTrace.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(await compactTrace.evaluate((element) => element.clientWidth + 2));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outputDirectory, `${browserName}-real-plate-compact.png`) });
    expect(diagnostics).toEqual([]);
  });
});
