import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

const createdAt = '2026-07-12T12:00:00.000Z';
const embeddedWorkspace = {
  schema: 'motif.claude-science.inventory.v2',
  inventory: { id: 'integrity-workspace', title: 'Integrity workspace', description: 'Atomic preload fixture' },
  selectedRecordId: 'record-a',
  records: [{ id: 'record-a', name: 'Original A', molecule: 'dna', topology: 'linear', seq: 'ATGGAATTCTAA' }],
  alignments: [{
    id: 'alignment-a',
    name: 'Linked alignment',
    molecule: 'dna',
    referenceRowId: 'row-a',
    rows: [
      { id: 'row-a', name: 'Record A', aligned: 'ATGGAATTCTAA', sourceRecordId: 'record-a' },
      { id: 'row-b', name: 'Variant', aligned: 'ATGGAA-TCTAA' },
    ],
    engine: { id: 'mafft', label: 'MAFFT', version: '7.526', mode: 'local-command' },
  }],
  notes: [{
    id: 'note-a', body: 'Review record A.', format: 'plain', scope: 'record', recordId: 'record-a', createdAt, updatedAt: createdAt,
  }],
  workflowResults: [{
    id: 'digest-a',
    kind: 'digest',
    name: 'Digest A',
    inputRecordIds: ['record-a'],
    outputRecordIds: ['record-a'],
    parameters: { enzymes: ['EcoRI'] },
    createdAt,
    provenance: { source: 'motif-artifact', operation: 'digest' },
  }],
  analysisAssets: [{
    id: 'asset-a',
    name: 'report.txt',
    mediaType: 'text/plain',
    content: 'Inert report evidence.',
    createdAt,
    provenance: { source: 'claude-science-e2e', operation: 'report' },
  }],
  analysisResults: [{
    id: 'report-a',
    kind: 'report',
    name: 'Linked report',
    status: 'complete',
    summary: 'A linked report.',
    inputRecordIds: ['record-a'],
    dependsOnResultIds: [],
    assetIds: ['asset-a'],
    parameters: {},
    data: { format: 'plain', body: 'Review A.' },
    createdAt,
    provenance: { source: 'claude-science-e2e', operation: 'report' },
  }],
  artifactState: {
    customEnzymes: [{
      name: 'PreloadI', recognitionSequence: 'GAATTC', cutOffset: 1, complementCutOffset: 5, overhang: '5prime',
    }],
    translationLayersByRecord: {
      'record-a': [{ id: 'layer-a', label: 'Layer A', start: 0, end: 6, strand: 1, frame: 0, source: 'layer' }],
    },
    enzymeSourcesByRecord: { 'record-a': ['common'] },
    hiddenEnzymesByRecord: { 'record-a': ['EcoRI'] },
    hiddenFeatureTranslationsByRecord: { 'record-a': ['feat:a'] },
    restrictionLabelsByRecord: { 'record-a': true },
    motifsByRecord: { 'record-a': 'GAATTC' },
  },
};

async function openInjectedWorkspace(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.route(artifactUrl!, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const pattern = /(<script type="application\/json" id="motif-artifact-data">)([\s\S]*?)(<\/script>)/u;
    expect(pattern.test(source)).toBe(true);
    const body = source.replace(pattern, (_match, open, _payload, close) => (
      `${open}${JSON.stringify(embeddedWorkspace)}${close}`
    ));
    await route.fulfill({ response, body });
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('Original A');
}

test.describe('Claude Science workspace integrity', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('hydrates every durable field and keeps records-only updates transactional', async ({ page }) => {
    const diagnostics: string[] = [];
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        diagnostics.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    await openInjectedWorkspace(page);

    const initial = await page.evaluate(() => window.motifGetWorkspace?.());
    expect(initial).toMatchObject({
      inventory: { id: 'integrity-workspace' },
      records: [{ id: 'record-a', name: 'Original A' }],
      alignments: [{ id: 'alignment-a' }],
      notes: [{ id: 'note-a', recordId: 'record-a' }],
      workflowResults: [{ id: 'digest-a', inputRecordIds: ['record-a'] }],
      analysisAssets: [{ id: 'asset-a' }],
      analysisResults: [{ id: 'report-a', inputRecordIds: ['record-a'] }],
      artifactState: {
        customEnzymes: [{ name: 'PreloadI' }],
        translationLayersByRecord: { 'record-a': [{ id: 'layer-a', source: 'layer' }] },
        enzymeSourcesByRecord: { 'record-a': ['common'] },
        hiddenEnzymesByRecord: { 'record-a': ['EcoRI'] },
        hiddenFeatureTranslationsByRecord: { 'record-a': ['feat:a'] },
        restrictionLabelsByRecord: { 'record-a': true },
        motifsByRecord: { 'record-a': 'GAATTC' },
      },
    });

    const compatible = await page.evaluate(() => {
      const before = window.motifGetWorkspace?.() as Record<string, unknown>;
      window.motifRenderInventory?.([{
        id: 'record-a', name: 'Updated A', molecule: 'dna', topology: 'linear', seq: 'ATGGAATTCTAA',
      }]);
      const after = window.motifGetWorkspace?.() as Record<string, unknown>;
      const sidecars = (workspace: Record<string, unknown>) => ({
        alignments: workspace.alignments,
        notes: workspace.notes,
        workflowResults: workspace.workflowResults,
        analysisResults: workspace.analysisResults,
        analysisAssets: workspace.analysisAssets,
        artifactState: workspace.artifactState,
      });
      return { before: sidecars(before), after: sidecars(after), records: after.records };
    });
    expect(compatible.records).toEqual([expect.objectContaining({ id: 'record-a', name: 'Updated A' })]);
    expect(compatible.after).toEqual(compatible.before);

    const orphanAttempt = await page.evaluate(() => {
      const clean = (workspace: Record<string, unknown>) => {
        const copy = structuredClone(workspace);
        delete copy.exportedAt;
        return copy;
      };
      const before = clean(window.motifGetWorkspace?.() as Record<string, unknown>);
      let rejected: { code?: string; details?: Record<string, unknown>; message: string } | null = null;
      try {
        window.motifRenderInventory?.([{
          id: 'record-b', name: 'Unrelated B', molecule: 'dna', topology: 'linear', seq: 'ATGGAATTCTAA',
        }]);
      } catch (error) {
        rejected = {
          code: (error as { code?: string }).code,
          details: (error as { details?: Record<string, unknown> }).details,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      const after = clean(window.motifGetWorkspace?.() as Record<string, unknown>);
      return { before, after, rejected };
    });
    expect(orphanAttempt.rejected).toMatchObject({
      code: 'MOTIF_INVALID_INVENTORY_REPLACEMENT',
      details: { operation: 'motifRenderInventory', mutated: false },
    });
    const issueCategories = (orphanAttempt.rejected?.details?.issues as Array<{ category: string }>).map((issue) => issue.category);
    expect(new Set(issueCategories)).toEqual(new Set([
      'alignment', 'note', 'workflowResult', 'analysisResult', 'artifactState',
    ]));
    expect(orphanAttempt.after).toEqual(orphanAttempt.before);
    expect(diagnostics).toEqual([]);
  });
});
