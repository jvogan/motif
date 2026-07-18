import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const outputDirectory = path.resolve('output/playwright/construct-verification');

// Fixed pseudo-random sequence with no repeated 7-mers. Full-length evidence
// therefore has one unambiguous locus while remaining deterministic in every run.
const REFERENCE_SEQUENCE = 'TCCGGGTCCACTCAATAGGGCCTATGGTGTTAAATATGTGTCTCTTGTTCGCTAGGGTGATAGCAAAAAATATAGTGCCTGCTTTTGTGGATGTAAATAATAACTCGCCCCCCTCCCTCACGAGAGCGCTACGCAAACGTATTTGCCGCCCGCCCTTGGTCAGACATTAGCAGTCGTTTGCTAGATATCCCCTGAAGACTAATGCCCACATTGCGCGCCGATACCCCAGCGTAGGACGAA';
const RECORD_IDS = {
  reference: 'construct-e2e-reference',
  forward: 'construct-e2e-forward',
  reverse: 'construct-e2e-reverse',
} as const;

function reverseComplement(sequence: string): string {
  const complement: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
  return Array.from(sequence).reverse().map((base) => complement[base]).join('');
}

test.describe('Claude Science construct verification trust loop', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test.beforeAll(async () => {
    await mkdir(outputDirectory, { recursive: true });
  });

  test('verifies bidirectional Sanger evidence, saves a compact typed result, and marks it fresh', async ({ page }) => {
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

    const reverseSequence = reverseComplement(REFERENCE_SEQUENCE);
    const seeded = await page.evaluate(({ ids, reference, reverse }) => {
      const trace = (baseCalls: string, sampleName: string) => ({
        schema: 'motif.sanger-trace.v1',
        version: 1,
        baseCalls,
        sequence: baseCalls,
        qualityScores: Array.from({ length: baseCalls.length }, () => 40),
        peakPositions: [],
        channels: { A: [], C: [], G: [], T: [] },
        sampleCount: 0,
        dyeOrder: null,
        storedReverseComplement: false,
        warnings: [],
        metadata: {
          format: 'ABIF',
          abifVersion: 101,
          baseCallsTag: 'PBAS2',
          qualityScoresTag: 'PCON2',
          peakPositionsTag: null,
          channelTags: {},
          sampleName,
        },
      });
      const before = window.motifGetInventory?.().length ?? 0;
      const added = window.motifAddRecords?.([
        {
          id: ids.reference,
          name: 'Predicted construct E2E',
          type: 'dna',
          topology: 'linear',
          group: 'Construct verification E2E',
          sequence: reference,
        },
        {
          id: ids.forward,
          name: 'Sanger forward E2E',
          type: 'dna',
          topology: 'linear',
          group: 'Construct verification E2E',
          sequence: reference,
          sangerTrace: trace(reference, 'Sanger forward E2E'),
        },
        {
          id: ids.reverse,
          name: 'Sanger reverse E2E',
          type: 'dna',
          topology: 'linear',
          group: 'Construct verification E2E',
          sequence: reverse,
          sangerTrace: trace(reverse, 'Sanger reverse E2E'),
        },
      ] as never);
      return {
        added,
        before,
        after: window.motifGetInventory?.().length ?? 0,
        activeId: window.motifGetActiveRecord?.()?.id,
      };
    }, { ids: RECORD_IDS, reference: REFERENCE_SEQUENCE, reverse: reverseSequence });

    expect(REFERENCE_SEQUENCE).toHaveLength(240);
    expect(seeded).toEqual({
      added: 3,
      before: expect.any(Number),
      after: seeded.before + 3,
      activeId: RECORD_IDS.reference,
    });

    const tool = page.locator('details[data-rail-tool="construct-verification"]');
    await tool.scrollIntoViewIfNeeded();
    await tool.locator(':scope > summary').click();
    await expect(tool).toHaveAttribute('open', '');
    await tool.getByTestId('open-construct-verification').click();

    const dialog = page.getByRole('dialog', { name: /Construct Verification/i });
    const workspace = page.getByTestId('construct-verification-workspace');
    await expect(dialog).toBeVisible();
    await expect(workspace).toBeVisible();
    await expect(workspace.getByTestId('construct-verification-reference')).toHaveValue(RECORD_IDS.reference);

    const readList = workspace.getByTestId('construct-verification-read-list');
    await expect(readList.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(readList.locator('input[type="checkbox"]:checked')).toHaveCount(2);
    await expect(readList).toContainText('Sanger forward E2E');
    await expect(readList).toContainText('Sanger reverse E2E');
    await expect(workspace).toContainText('2 of 2 reads selected');

    const requireBothStrands = workspace.getByRole('checkbox', { name: 'Require both strands' });
    const runButton = workspace.getByTestId('construct-verification-run');
    const saveButton = workspace.getByTestId('construct-verification-save');
    await expect(requireBothStrands).not.toBeChecked();
    await expect(runButton).toBeEnabled();
    await expect(saveButton).toBeDisabled();
    await requireBothStrands.check();
    await runButton.click();

    const evidence = workspace.getByTestId('construct-verification-panel');
    await expect(evidence).toBeVisible();
    await expect(evidence.getByText('Consistent', { exact: true })).toBeVisible();
    const facts = evidence.locator('.motif-cs-construct-verification-facts');
    await expect(facts.locator('dd').nth(0)).toHaveText('100.0%');
    await expect(facts.locator('dd').nth(1)).toHaveText('2 / 2');
    await expect(facts.locator('dd').nth(2)).toHaveText('1 F · 1 R');
    await expect(evidence.getByRole('progressbar', { name: 'Reference coverage 100.0%' }))
      .toHaveAttribute('value', '100');
    await expect(workspace.getByTestId('construct-verification-status')).toContainText('Verification complete');
    await expect(saveButton).toBeEnabled();

    await saveButton.click();
    await expect(saveButton).toHaveText('Saved');
    await expect(saveButton).toBeDisabled();
    await expect(workspace.getByTestId('construct-verification-status')).toContainText('saved to Results');
    await expect.poll(() => page.evaluate(() => (
      window.motifGetAnalysisWorkspace?.().analysisResults.filter((result) => result.kind === 'construct_verification').length
    ))).toBe(1);

    const saved = await page.evaluate(() => {
      const analysis = window.motifGetAnalysisWorkspace?.();
      const result = analysis?.analysisResults.find((candidate) => candidate.kind === 'construct_verification');
      const asset = result
        ? analysis?.analysisAssets.find((candidate) => candidate.id === result.data.verificationReportAssetId)
        : undefined;
      const report = asset ? JSON.parse(asset.content) : null;
      return {
        result,
        asset: asset ? {
          id: asset.id,
          name: asset.name,
          mediaType: asset.mediaType,
          sha256: asset.sha256,
          contentBytes: new TextEncoder().encode(asset.content).byteLength,
        } : null,
        report,
      };
    });

    expect(saved.result).toMatchObject({
      kind: 'construct_verification',
      status: 'complete',
      inputRecordIds: [RECORD_IDS.reference, RECORD_IDS.forward, RECORD_IDS.reverse],
      inputSha256s: [
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.stringMatching(/^[0-9a-f]{64}$/),
      ],
      assetIds: [expect.any(String)],
      parameters: {
        topology: 'linear',
        requestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        readEvidence: {
          schema: 'motif.construct-read-evidence.v1',
          sha256s: [
            expect.stringMatching(/^[0-9a-f]{64}$/),
            expect.stringMatching(/^[0-9a-f]{64}$/),
          ],
        },
      },
      data: {
        referenceRecordId: RECORD_IDS.reference,
        readRecordIds: [RECORD_IDS.forward, RECORD_IDS.reverse],
        state: 'consistent',
        referenceLength: 240,
        coveredBases: 240,
        coverageFraction: 1,
        mappedReadCount: 2,
        requiredRegionCount: 1,
        passingRegionCount: 1,
        observedVariantCount: 0,
        expectedVariantCount: 0,
        unexpectedVariantCount: 0,
        missingExpectedVariantCount: 0,
        reasonCodes: [],
        verificationReportAssetId: expect.any(String),
      },
      provenance: {
        operation: 'construct_verification',
        engine: 'motif-construct-verification',
        engineVersion: '1',
        parentIds: [RECORD_IDS.reference, RECORD_IDS.forward, RECORD_IDS.reverse],
      },
    });
    expect(saved.asset).toMatchObject({
      name: 'construct-verification-report.json',
      mediaType: 'application/json',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(saved.asset?.contentBytes).toBeLessThan(64_000);
    expect(saved.result?.assetIds).toEqual([saved.asset?.id]);
    expect(saved.result?.data.verificationReportAssetId).toBe(saved.asset?.id);

    expect(saved.report).toMatchObject({
      schema: 'motif.construct-verification-report.v1',
      version: 1,
      state: 'consistent',
      reasons: [],
      reference: {
        id: RECORD_IDS.reference,
        length: 240,
        topology: 'linear',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      reads: [
        { id: RECORD_IDS.forward, status: 'mapped', mapping: { orientation: 'forward' } },
        { id: RECORD_IDS.reverse, status: 'mapped', mapping: { orientation: 'reverse' } },
      ],
      coverage: {
        coveredBasesAtAnyDepth: 240,
        basesMeetingMinDepth: 240,
        coverageFraction: 1,
        requiredRegions: [{ status: 'covered', bothStrandsCoveredBases: 240 }],
      },
      consensus: { sequence: REFERENCE_SEQUENCE },
      provenance: {
        engine: 'motif-construct-verification',
        engineVersion: '1',
        requestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(saved.report.reference).not.toHaveProperty('sequence');
    expect(saved.report.coverage).not.toHaveProperty('depth');
    expect(saved.report.coverage).not.toHaveProperty('forward');
    expect(saved.report.coverage).not.toHaveProperty('reverse');
    expect(saved.report.consensus).not.toHaveProperty('calls');
    for (const read of saved.report.reads) {
      expect(read).not.toHaveProperty('baseCalls');
      expect(read).not.toHaveProperty('qualityScores');
      expect(read.mapping).not.toHaveProperty('coordinateMap');
    }

    await page.screenshot({ path: path.join(outputDirectory, 'construct-verification-light.png'), fullPage: true });

    await page.locator('select[name="artifact-theme"]').selectOption('claude-dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-dark');
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(dialog).toBeVisible();
    expect(await workspace.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
      await workspace.evaluate((element) => element.clientWidth + 2),
    );
    expect(await workspace.locator('.motif-cs-verification-workspace-body').evaluate((element) => element.scrollWidth))
      .toBeLessThanOrEqual(await workspace.locator('.motif-cs-verification-workspace-body').evaluate((element) => element.clientWidth + 2));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(642);
    const resizeReachability = await dialog.locator('.motif-cs-window-resize').evaluate((handle) => {
      const rail = document.querySelector<HTMLElement>('.motif-cs-inspector[data-tools-pinned="false"]');
      const handleRect = handle.getBoundingClientRect();
      const railRect = rail?.getBoundingClientRect();
      const hit = document.elementFromPoint(
        handleRect.left + handleRect.width / 2,
        handleRect.top + handleRect.height / 2,
      );
      return {
        clearsRail: Boolean(railRect && handleRect.right <= railRect.left),
        pointerHitsHandle: hit === handle || (hit !== null && handle.contains(hit)),
      };
    });
    expect(resizeReachability).toEqual({ clearsRail: true, pointerHitsHandle: true });
    await page.screenshot({ path: path.join(outputDirectory, 'construct-verification-compact-dark.png'), fullPage: true });

    await dialog.getByRole('button', { name: /Close Construct Verification/i }).click();
    await expect(dialog).toHaveCount(0);
    const results = page.locator('details[data-rail-tool="analysis-results"]');
    if ((await results.getAttribute('open')) === null) await results.locator(':scope > summary').click();
    const resultId = saved.result?.id;
    expect(resultId).toBeTruthy();
    const resultRow = page.getByTestId(`analysis-result-${resultId}`);
    await expect(resultRow).toBeVisible();
    await expect(resultRow).toContainText('Construct verification');
    const freshness = resultRow.locator('.motif-cs-agent-result-heading [data-freshness="fresh"]');
    await expect(freshness).toBeVisible();
    await expect(freshness).toContainText('Fresh');

    await resultRow.getByRole('button', { name: /Remove Construct verification/i }).click();
    await resultRow.getByRole('button', { name: 'Remove Result' }).click();
    await expect(resultRow).toHaveCount(0);
    await expect.poll(() => page.evaluate(({ resultId: removedResultId, assetId: removedAssetId }) => {
      const analysis = window.motifGetAnalysisWorkspace?.();
      return {
        resultPresent: analysis?.analysisResults.some((result) => result.id === removedResultId) ?? false,
        assetPresent: analysis?.analysisAssets.some((asset) => asset.id === removedAssetId) ?? false,
      };
    }, { resultId, assetId: saved.asset?.id })).toEqual({ resultPresent: false, assetPresent: false });
    expect(diagnostics).toEqual([]);
  });
});
