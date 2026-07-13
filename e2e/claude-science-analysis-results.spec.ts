import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

test.describe('Claude Science typed analysis result runtime', () => {
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
  });

  test.afterEach(async ({ page }) => {
    expect(pageDiagnostics.get(page) ?? []).toEqual([]);
  });

  test('adds inert assets and results, rejects HTML media atomically, reveals Results, and includes both in backup', async ({ page }) => {
    const hostileText = '<img src=x onerror="globalThis.__MOTIF_ANALYSIS_E2E_PWNED__=true"><script>globalThis.__MOTIF_ANALYSIS_E2E_PWNED__=true</script>';
    const runtime = await page.evaluate((hostile) => {
      const api = window as typeof window & {
        motifGetWorkspace: () => Record<string, unknown> & { records: Array<{ id: string; name: string }> };
        motifAddAnalysisAssets: (value: unknown) => number;
        motifAddAnalysisResults: (value: unknown) => number;
        motifGetAnalysisWorkspace: () => { analysisAssets: Array<{ id: string }>; analysisResults: Array<{ id: string }> };
      };
      const record = api.motifGetWorkspace().records[0];
      const createdAt = '2026-07-12T23:00:00.000Z';
      const safeAssetCount = api.motifAddAnalysisAssets({
        id: 'agent-report-asset',
        name: 'agent-safety-report.txt',
        mediaType: 'text/plain',
        content: 'Bounded inert evidence for the saved report.',
        createdAt,
        provenance: {
          source: 'claude-science-e2e',
          operation: 'analysis-result-runtime-check',
          engine: 'Motif',
          engineVersion: '2.6.0',
        },
      });
      const afterSafeAsset = api.motifGetAnalysisWorkspace();
      let rejected: { code?: string; message: string } | null = null;
      try {
        api.motifAddAnalysisAssets({
          id: 'forbidden-html-asset',
          name: 'unsafe.html',
          mediaType: 'text/html',
          content: hostile,
          createdAt,
          provenance: { source: 'claude-science-e2e' },
        });
      } catch (error) {
        rejected = {
          code: (error as { code?: string }).code,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      const afterRejectedAsset = api.motifGetAnalysisWorkspace();
      const safeResultCount = api.motifAddAnalysisResults({
        id: 'agent-safety-report',
        kind: 'report',
        name: 'Agent safety report',
        status: 'complete',
        summary: 'A visible, reviewable result supplied through the typed agent API.',
        inputRecordIds: [record.id],
        dependsOnResultIds: [],
        assetIds: ['agent-report-asset'],
        parameters: { renderer: 'inert-text', uploaded: false },
        data: { format: 'plain', body: hostile },
        createdAt,
        provenance: {
          source: 'claude-science-e2e',
          operation: 'analysis-result-runtime-check',
          engine: 'Motif',
          engineVersion: '2.6.0',
        },
      });
      const analysis = api.motifGetAnalysisWorkspace();
      const backup = api.motifGetWorkspace() as Record<string, unknown> & {
        analysisAssets?: Array<{ id: string }>;
        analysisResults?: Array<{ id: string }>;
      };
      return {
        recordName: record.name,
        safeAssetCount,
        safeResultCount,
        rejected,
        assetCountBeforeReject: afterSafeAsset.analysisAssets.length,
        assetCountAfterReject: afterRejectedAsset.analysisAssets.length,
        assetIds: analysis.analysisAssets.map((asset) => asset.id),
        resultIds: analysis.analysisResults.map((result) => result.id),
        backupAssetIds: backup.analysisAssets?.map((asset) => asset.id) ?? [],
        backupResultIds: backup.analysisResults?.map((result) => result.id) ?? [],
      };
    }, hostileText);

    expect(runtime.safeAssetCount).toBe(1);
    expect(runtime.safeResultCount).toBe(1);
    expect(runtime.rejected).toMatchObject({ code: 'MOTIF_INVALID_WORKSPACE_INPUT' });
    expect(runtime.rejected?.message).toMatch(/not an allowed inert text\/JSON media type|HTML, SVG, and binary assets are forbidden/i);
    expect(runtime.assetCountAfterReject).toBe(runtime.assetCountBeforeReject);
    expect(runtime.assetIds).toEqual(['agent-report-asset']);
    expect(runtime.resultIds).toEqual(['agent-safety-report']);
    expect(runtime.backupAssetIds).toEqual(['agent-report-asset']);
    expect(runtime.backupResultIds).toEqual(['agent-safety-report']);

    const resultsPanel = page.locator('details[data-rail-tool="analysis-results"]');
    await expect(resultsPanel).toHaveAttribute('open', '');
    await expect(resultsPanel.locator(':scope > summary')).toContainText('Results');
    await expect(resultsPanel.locator('.motif-cs-chip')).toHaveText('1');
    const resultRow = page.getByTestId('analysis-result-agent-safety-report');
    await expect(resultRow).toBeVisible();
    await expect(resultRow).toContainText('Agent safety report');
    await expect(resultRow).toContainText('Report');
    await expect(resultRow).toContainText('complete');
    await expect(resultRow).toContainText(runtime.recordName);

    await resultRow.locator('.motif-cs-agent-result-details > summary').click();
    const preview = resultRow.getByLabel('Agent safety report safe text preview');
    await expect(preview).toHaveText(hostileText);
    await expect(preview.locator('img, script, svg')).toHaveCount(0);
    expect(await page.evaluate(() => (globalThis as { __MOTIF_ANALYSIS_E2E_PWNED__?: boolean }).__MOTIF_ANALYSIS_E2E_PWNED__))
      .toBeUndefined();

    const settings = page.locator('details[data-rail-tool="settings"]');
    await settings.locator(':scope > summary').click();
    const downloadPromise = page.waitForEvent('download');
    await settings.getByTestId('download-workspace-backup').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('motif-workspace-backup.json');
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const downloaded = JSON.parse(await readFile(downloadPath!, 'utf8')) as {
      analysisAssets?: Array<{ id: string; mediaType: string; content: string }>;
      analysisResults?: Array<{ id: string; data: { body?: string } }>;
    };
    expect(downloaded.analysisAssets).toEqual([
      expect.objectContaining({
        id: 'agent-report-asset',
        mediaType: 'text/plain',
        content: 'Bounded inert evidence for the saved report.',
      }),
    ]);
    expect(downloaded.analysisResults).toEqual([
      expect.objectContaining({
        id: 'agent-safety-report',
        data: expect.objectContaining({ body: hostileText }),
      }),
    ]);
  });
});
