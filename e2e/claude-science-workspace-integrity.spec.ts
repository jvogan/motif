import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

type RuntimeWorkspace = Record<string, unknown> & {
  exportedAt?: unknown;
  records: Array<Record<string, unknown> & { id: string; name: string; seq: string }>;
  notes: Array<Record<string, unknown> & { id: string }>;
  artifactState: Record<string, unknown> & {
    translationLayersByRecord: Record<string, Array<Record<string, unknown> & { id: string }>>;
  };
};

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

  test('edits sequence, note anchors, and translation anchors as one undoable transaction', async ({ page }) => {
    await openInjectedWorkspace(page);
    await page.evaluate((timestamp) => {
      const workspace = window.motifGetWorkspace?.() as RuntimeWorkspace;
      delete workspace.exportedAt;
      workspace.notes = [
        ...(workspace.notes ?? []),
        {
          id: 'range-note',
          title: 'Tail observation',
          body: 'Keep this note attached to its bases.',
          format: 'plain',
          scope: 'range',
          recordId: 'record-a',
          range: { start: 8, end: 12 },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ];
      workspace.artifactState.translationLayersByRecord['record-a'].push({
        id: 'layer-tail',
        label: 'Tail translation',
        start: 6,
        end: 12,
        strand: 1,
        frame: 0,
        source: 'layer',
      });
      window.motifReplaceWorkspace?.(workspace);
    }, createdAt);

    await expect(page.getByTestId('session-durability-status')).toHaveText('session only');
    const before = await page.evaluate(() => {
      const workspace = structuredClone(window.motifGetWorkspace?.() as Record<string, unknown>);
      delete workspace.exportedAt;
      return workspace;
    });

    const editor = page.getByRole('textbox', { name: /Editable sequence/ });
    await editor.click({ position: { x: 70, y: 50 } });
    await editor.press('End');
    await editor.press('ArrowLeft');
    await editor.press('ArrowLeft');
    await editor.press('ArrowLeft');
    await expect(page.locator('.motif-cs-edit-hint')).toContainText('Caret 10');
    await editor.press('t');
    await expect(page.locator('.motif-cs-edit-hint')).toContainText('Caret 11');
    const afterSameBase = await page.evaluate(() => {
      const workspace = structuredClone(window.motifGetWorkspace?.() as Record<string, unknown>);
      delete workspace.exportedAt;
      return workspace;
    });
    expect(afterSameBase).toEqual(before);
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(page.getByTestId('session-durability-status')).toHaveText('session only');
    await editor.press('ArrowLeft');
    await editor.press('g');

    const edited = await page.evaluate(() => {
      const workspace = window.motifGetWorkspace?.() as RuntimeWorkspace;
      return {
        sequence: workspace.records[0].seq,
        note: workspace.notes.find((note) => note.id === 'range-note'),
        layer: workspace.artifactState.translationLayersByRecord['record-a']
          .find((layer: { id: string }) => layer.id === 'layer-tail'),
      };
    });
    expect(edited.sequence).toBe('ATGGAATTCGAA');
    expect(edited.note).toMatchObject({
      scope: 'range',
      range: { start: 8, end: 12 },
      provenance: {
        operation: 'sequence_edit_anchor_review',
        metadata: { motifRangeAnchor: { status: 'review' } },
      },
    });
    expect(edited.layer).toMatchObject({ start: 6, end: 12, needsReview: true });
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');

    const notesPanel = page.locator('details[data-rail-tool="notes"]');
    if (!(await notesPanel.getAttribute('open'))) await notesPanel.locator(':scope > summary').click();
    await expect(notesPanel.getByText('Review range anchor.')).toBeVisible();

    const annotationsPanel = page.locator('details[data-rail-tool="annotations"]');
    if (!(await annotationsPanel.getAttribute('open'))) await annotationsPanel.locator(':scope > summary').click();
    await expect(annotationsPanel.getByText('Review anchor')).toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();
    const afterUndo = await page.evaluate(() => {
      const workspace = structuredClone(window.motifGetWorkspace?.() as Record<string, unknown>);
      delete workspace.exportedAt;
      return workspace;
    });
    expect(afterUndo).toEqual(before);
    await expect(page.getByTestId('session-durability-status')).toHaveText('session only');

    await page.getByRole('button', { name: 'Redo' }).click();
    await expect.poll(() => page.evaluate(() => (
      (window.motifGetWorkspace?.() as RuntimeWorkspace).records[0].seq
    ))).toBe('ATGGAATTCGAA');
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');
  });

  test('undo preserves an absent translation-layer entry exactly', async ({ page }) => {
    await openInjectedWorkspace(page);
    await page.evaluate(() => {
      const workspace = structuredClone(window.motifGetWorkspace?.() as RuntimeWorkspace);
      delete workspace.exportedAt;
      workspace.artifactState.translationLayersByRecord = {};
      window.motifReplaceWorkspace?.(workspace);
    });
    await expect(page.getByTestId('session-durability-status')).toHaveText('session only');

    const before = await page.evaluate(() => {
      const workspace = structuredClone(window.motifGetWorkspace?.() as RuntimeWorkspace);
      delete workspace.exportedAt;
      return workspace;
    });
    expect(before.artifactState.translationLayersByRecord).not.toHaveProperty('record-a');

    const editor = page.getByRole('textbox', { name: /Editable sequence/ });
    await editor.click({ position: { x: 70, y: 50 } });
    await editor.press('End');
    await editor.press('ArrowLeft');
    await editor.press('ArrowLeft');
    await editor.press('ArrowLeft');
    await editor.press('g');
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');

    await page.getByRole('button', { name: 'Undo' }).click();
    const afterUndo = await page.evaluate(() => {
      const workspace = structuredClone(window.motifGetWorkspace?.() as RuntimeWorkspace);
      delete workspace.exportedAt;
      return workspace;
    });
    expect(afterUndo).toEqual(before);
    await expect(page.getByTestId('session-durability-status')).toHaveText('session only');
  });

  test('keeps browser downloads unverified and blocks dirty runtime replacement', async ({ page }) => {
    await openInjectedWorkspace(page);
    await expect(page.getByTestId('session-durability-status')).toHaveText('session only');

    await page.evaluate((timestamp) => {
      window.motifAddRecords?.({
        id: 'record-b',
        name: 'Original B',
        molecule: 'dna',
        topology: 'linear',
        seq: 'ATGCCCTAA',
      });
      window.motifAddNotes?.({
        id: 'dirty-note',
        body: 'Unsaved local observation.',
        format: 'plain',
        scope: 'workspace',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }, createdAt);
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');

    await page.locator('.motif-cs-record-tab').filter({ hasText: 'Original A' }).click();
    const dirty = await page.evaluate(() => {
      const workspace = structuredClone(window.motifGetWorkspace?.() as RuntimeWorkspace);
      delete workspace.exportedAt;
      return workspace;
    });
    expect(dirty.selectedRecordId).toBe('record-a');

    const selectionOnlyReplacement = structuredClone(dirty);
    selectionOnlyReplacement.selectedRecordId = 'record-b';

    const identicalCount = await page.evaluate(
      (workspace) => window.motifReplaceWorkspace?.(workspace),
      selectionOnlyReplacement,
    );
    expect(identicalCount).toBe(2);
    await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toContainText('Original B');
    const afterSelectionOnlyReplace = await page.evaluate(() => {
      const workspace = structuredClone(window.motifGetWorkspace?.() as RuntimeWorkspace);
      delete workspace.exportedAt;
      return workspace;
    });
    expect(afterSelectionOnlyReplace).toEqual(selectionOnlyReplacement);
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');

    const dirtyAfterSelection = selectionOnlyReplacement;

    const blocked = await page.evaluate((workspace) => {
      const replacement = structuredClone(workspace);
      replacement.records[0].name = 'Runtime replacement';
      let error: { code?: string; message: string } | null = null;
      try {
        window.motifReplaceWorkspace?.(replacement);
      } catch (cause) {
        error = {
          code: (cause as { code?: string }).code,
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
      const after = structuredClone(window.motifGetWorkspace?.() as RuntimeWorkspace);
      delete after.exportedAt;
      return { error, after };
    }, dirtyAfterSelection);
    expect(blocked.error).toMatchObject({ code: 'MOTIF_UNSAVED_WORKSPACE' });
    expect(blocked.after).toEqual(dirtyAfterSelection);

    const spoofedDiscard = await page.evaluate((workspace) => {
      const replacement = structuredClone(workspace);
      replacement.records[0].name = 'Truthy option must not replace';
      let error: { code?: string; message: string } | null = null;
      try {
        window.motifReplaceWorkspace?.(
          replacement,
          { discardUnsavedChanges: 'false' } as never,
        );
      } catch (cause) {
        error = {
          code: (cause as { code?: string }).code,
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
      const after = structuredClone(window.motifGetWorkspace?.() as RuntimeWorkspace);
      delete after.exportedAt;
      return { error, after };
    }, dirtyAfterSelection);
    expect(spoofedDiscard.error).toMatchObject({ code: 'MOTIF_UNSAVED_WORKSPACE' });
    expect(spoofedDiscard.after).toEqual(dirtyAfterSelection);

    const exportPanel = page.locator('.motif-cs-sequence-tools-panel');
    if (!(await exportPanel.getAttribute('open'))) await exportPanel.locator(':scope > summary').click();
    await exportPanel.locator('select[name="export-format"]').selectOption('inventory-json');
    const browserDownload = page.waitForEvent('download');
    await exportPanel.locator('.motif-cs-export-picker-actions').getByRole('button', { name: 'Download' }).click();
    await browserDownload;
    await expect(exportPanel.getByText(/Download requested for motif-inventory\.json/)).toBeVisible();
    await expect(page.getByTestId('session-durability-status')).toHaveText('unsaved changes');

    const checkpointWorkspace = await page.evaluate((workspace) => {
      const replacement = structuredClone(workspace);
      replacement.records[0].name = 'Runtime replacement';
      window.motifReplaceWorkspace?.(replacement, { discardUnsavedChanges: true });
      return window.motifGetWorkspace?.() as Record<string, unknown>;
    }, dirtyAfterSelection);
    await expect(page.getByTestId('session-durability-status')).toHaveText('session only');

    const settings = page.locator('details[data-rail-tool="settings"]');
    if (!(await settings.getAttribute('open'))) await settings.locator(':scope > summary').click();
    await settings.getByTestId('restore-workspace-file').setInputFiles({
      name: 'verified-workspace.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(checkpointWorkspace)),
    });
    const dialog = page.getByTestId('database-restore-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Replace workspace' }).click();
    await expect(page.getByTestId('session-durability-status')).toHaveText('restored checkpoint');
  });
});
