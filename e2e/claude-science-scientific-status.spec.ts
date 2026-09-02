import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

test.describe('Claude Science scientific status UX', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  const diagnostics = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const messages: string[] = [];
    diagnostics.set(page, messages);
    page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        messages.push(`console.${message.type()}: ${message.text()}`);
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
    expect(diagnostics.get(page) ?? []).toEqual([]);
  });

  async function digestPanel(page: Page) {
    const panel = page.locator('details').filter({ hasText: 'Digest Preview' }).first();
    if ((await panel.getAttribute('open')) === null) await panel.locator(':scope > summary').click();
    return panel;
  }

  test('digest statuses distinguish conditional cuts, methylation repair, and nickase continuity', async ({ page }) => {
    await page.evaluate(() => window.motifAddRecords([
      { id: 'edge-type-iis', name: 'Type IIS flank edge', molecule: 'dna', topology: 'linear', seq: 'AAAAGGTCTC' },
      { id: 'edge-dpni', name: 'DpnI methylation edge', molecule: 'dna', topology: 'linear', seq: 'AAAAGATCAAAA' },
      { id: 'edge-nickase', name: 'Nickase continuity edge', molecule: 'dna', topology: 'linear', seq: 'AAAACCTCAGCAAAA' },
    ]));

    await page.getByRole('tab', { name: 'Type IIS flank edge' }).click();
    const digest = await digestPanel(page);
    const enzymeInput = digest.getByRole('combobox', { name: 'Digest enzymes' });
    await enzymeInput.fill('BsaI');

    const typeIisStatus = digest.getByTestId('digest-scientific-status');
    await expect(typeIisStatus).toHaveAttribute('data-status', 'conditional');
    await expect(typeIisStatus).toHaveAttribute('role', 'status');
    await expect(typeIisStatus).toContainText('Sequence context is incomplete.');
    await expect(enzymeInput).toHaveAttribute('aria-invalid', 'false');
    await expect(digest.getByTestId('digest-save')).toHaveText('Resolve before saving');
    const typeIisDetails = typeIisStatus.locator('summary');
    await typeIisDetails.focus();
    await page.keyboard.press('Enter');
    await expect(typeIisStatus).toContainText('insufficient_flanking_bases');
    await expect(typeIisStatus).toContainText(/requires strand cleavage coordinates/i);

    await page.getByRole('tab', { name: 'DpnI methylation edge' }).click();
    await digestPanel(page);
    await enzymeInput.fill('DpnI');
    const methylation = digest.getByTestId('digest-methylation-state');
    await expect(methylation).toHaveValue('unknown');
    const methylationDescriptionId = await methylation.getAttribute('aria-describedby');
    expect(methylationDescriptionId).toBeTruthy();
    await expect(digest.locator(`[id="${methylationDescriptionId}"]`)).toBeVisible();
    await expect(digest.getByTestId('digest-scientific-status')).toContainText('methylation_unknown');
    await methylation.focus();
    await expect(methylation).toBeFocused();
    await methylation.selectOption('methylated');
    await expect(methylation).toHaveValue('methylated');
    await expect(digest.getByTestId('digest-scientific-status')).toHaveCount(0);
    await expect(digest.locator(':scope > summary')).toContainText('1 cut · 2 fragments');
    await expect(digest.getByTestId('digest-save')).toHaveText('Save 2 fragments');
    await methylation.selectOption('unmethylated');
    await expect(digest.getByTestId('digest-scientific-status')).toContainText('methylation_unmethylated');

    await page.getByRole('tab', { name: 'Nickase continuity edge' }).click();
    await digestPanel(page);
    await enzymeInput.fill('Nb.BbvCI');
    await expect(digest.locator(':scope > summary')).toContainText('1 nick · continuous');
    await expect(digest.locator('.motif-cs-digest-enzyme-chip')).toContainText('1 nick');
    await expect(digest.locator('.motif-cs-digest-enzyme-chip')).toContainText('Nickase');
    await expect(digest.locator('.motif-cs-digest-outcome')).toContainText('No double-strand cuts predicted.');
    await expect(digest.locator('.motif-cs-digest-outcome')).toContainText('DNA molecule continuous');

    await page.getByRole('combobox', { name: 'Theme' }).selectOption({ label: 'Warm Dark' });
    await page.setViewportSize({ width: 390, height: 760 });
    await digest.scrollIntoViewIfNeeded();
    const statusBox = await digest.locator('.motif-cs-digest-outcome').boundingBox();
    expect(statusBox).not.toBeNull();
    expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(390);
  });

  test('mixed methylation-sensitive recipes expose independent target controls and receipts', async ({ page }) => {
    await page.evaluate(() => window.motifAddRecords([
      {
        id: 'edge-mixed-methylation',
        name: 'Mixed methylation edge',
        molecule: 'dna',
        topology: 'linear',
        seq: 'AAAAGATCAAAACCGGAAAA',
      },
    ]));

    await page.getByRole('tab', { name: 'Mixed methylation edge' }).click();
    const digest = await digestPanel(page);
    await digest.getByRole('combobox', { name: 'Digest enzymes' }).fill('DpnI, HpaII, MspI');
    const dam = digest.getByTestId('digest-methylation-state-dam');
    const cpg = digest.getByTestId('digest-methylation-state-cpg');
    await expect(dam).toHaveValue('unknown');
    await expect(cpg).toHaveValue('unknown');
    expect(await dam.getAttribute('aria-describedby')).toBeTruthy();
    expect(await cpg.getAttribute('aria-describedby')).toBeTruthy();
    await expect(digest.getByTestId('digest-scientific-status')).toContainText('methylation_unknown');
    await dam.selectOption('methylated');
    await expect(dam).toHaveValue('methylated');
    await expect(cpg).toHaveValue('unknown');
    await expect(digest.getByTestId('digest-scientific-status')).toContainText('methylation_unknown');
    await cpg.selectOption('unmethylated');
    await expect(cpg).toHaveValue('unmethylated');
    await expect(digest.getByTestId('digest-scientific-status')).toHaveCount(0);
    await expect(digest.locator('.motif-cs-digest-methylation-row')).toContainText('DpnI');
    await expect(digest.locator('.motif-cs-digest-methylation-row')).toContainText('HpaII');
    await expect(digest.locator('.motif-cs-digest-methylation-row')).toContainText('MspI');
  });

  test('translation and quarantined-location statuses explain partial and unsupported results', async ({ page }) => {
    await page.evaluate(() => window.motifAddRecords([
      {
        id: 'edge-translation',
        name: 'Translation diagnostics edge',
        molecule: 'dna',
        topology: 'linear',
        seq: 'ATGGCNNNTAA',
        annotations: [
          { id: 'unsupported-table', name: 'unsupported table', type: 'cds', start: 0, end: 11, strand: 1, metadata: { transl_table: 27, codon_start: 1 } },
          { id: 'ambiguous-codon', name: 'ambiguous codon', type: 'cds', start: 0, end: 11, strand: 1, metadata: { transl_table: 1, codon_start: 1 } },
        ],
      },
      {
        id: 'edge-quarantine',
        name: 'GenBank quarantine edge',
        molecule: 'dna',
        topology: 'linear',
        seq: 'ATGCGTACGT',
        annotations: [{
          id: 'remote-cds',
          name: 'remote CDS',
          type: 'cds',
          start: 0,
          end: 1,
          strand: 0,
          metadata: {
            motifLocationQuarantined: true,
            motifOriginalLocation: 'NC_000001.11:100..200',
            motifQualifiers: [
              { key: 'label', value: 'remote CDS' },
              { key: 'note', value: 'first retained note' },
              { key: 'note', value: 'second retained note' },
            ],
            motifImportDiagnostics: [{
              severity: 'warning',
              code: 'remote_location',
              featureKey: 'CDS',
              location: 'NC_000001.11:100..200',
              message: 'Remote location retained.',
            }],
          },
        }],
      },
      {
        id: 'edge-transl-except',
        name: 'Translation exception edge',
        molecule: 'dna',
        topology: 'linear',
        seq: 'AATGTCTTAA',
        annotations: [{
          id: 'valid-exception',
          name: 'codon start with Sec',
          type: 'cds',
          start: 0,
          end: 10,
          strand: 1,
          metadata: {
            codon_start: 2,
            transl_table: 1,
            transl_except: '(pos:5..7,aa:Sec)',
          },
        }],
      },
    ]));

    await page.getByRole('tab', { name: 'Translation diagnostics edge' }).click();
    await page.getByRole('button', { name: /ambiguous codon, cds/i }).first().click();
    await page.getByRole('button', { name: 'Translations window off' }).click();
    const translationWindow = page.locator('.motif-cs-window').filter({ hasText: 'Translation' });
    const ambiguityStatus = translationWindow.getByTestId('translation-ambiguity-status');
    await expect(ambiguityStatus).toHaveAttribute('data-status', 'partial');
    await expect(ambiguityStatus).toContainText('shown as X');
    await ambiguityStatus.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(ambiguityStatus).toContainText('ambiguous_codon');

    await page.getByRole('button', { name: /unsupported table, cds/i }).first().click();
    const unsupportedStatus = translationWindow.getByTestId('translation-table-status');
    await expect(unsupportedStatus).toHaveAttribute('data-status', 'unsupported');
    await expect(unsupportedStatus).toContainText('unsupported_translation_table');
    await expect(unsupportedStatus).toContainText(/choose a supported genetic code/i);

    await page.getByRole('tab', { name: 'Translation exception edge' }).click();
    await page.getByRole('button', { name: /codon start with Sec, cds/i }).first().click();
    await expect(page.locator('.motif-cs-sequence').getByRole('button', { name: 'U, codon 5-7' })).toBeVisible();
    await expect(page.locator('.motif-cs-sequence').getByRole('button', { name: 'S, codon 5-7' })).toHaveCount(0);
    await expect(translationWindow.getByRole('button', { name: 'U, codon 5-7' })).toBeVisible();
    await expect(translationWindow.getByRole('button', { name: 'S, codon 5-7' })).toHaveCount(0);
    await translationWindow.getByRole('button', { name: 'New protein' }).click();
    await expect.poll(async () => page.evaluate(() => window.motifGetActiveRecord()?.seq)).toBe('MU*');

    await page.getByRole('tab', { name: 'GenBank quarantine edge' }).click();
    await page.getByRole('button', { name: /remote CDS, cds/i }).first().click();
    const locationStatus = page.getByTestId('feature-location-status');
    await expect(locationStatus).toHaveAttribute('data-status', 'unsupported');
    await expect(locationStatus).toContainText('Remote location retained, not projected.');
    await expect(locationStatus).toContainText('remote_location');
    await locationStatus.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(locationStatus).toContainText('NC_000001.11:100..200');
    await expect(locationStatus).toContainText('3 retained in source order');
    await expect(page.getByRole('button', { name: 'New protein record' })).toBeDisabled();
  });

  test('bounded comparison provenance stays compact and keyboard-reachable at narrow width', async ({ page }) => {
    await page.evaluate(() => window.motifAddAlignments({
      id: 'edge-bounded-comparison',
      name: 'Bounded comparison provenance edge',
      molecule: 'dna',
      referenceRowId: 'edge-reference',
      rows: [
        { id: 'edge-reference', name: 'Long template', aligned: 'ACGTACGTACGTACGT', inputSha256: 'a'.repeat(64) },
        { id: 'edge-query', name: 'Divergent query', aligned: 'ACGTTTGTACGTACGT', inputSha256: 'b'.repeat(64) },
      ],
      engine: { id: 'motif-browser', label: 'Motif browser comparison', mode: 'browser', usedFallback: false },
      comparison: {
        route: 'browser',
        method: 'seed-and-extend',
        algorithm: 'Bounded monotonic exact-seed-and-extend comparison',
        fallback: true,
        warnings: ['No exact seed anchors were found; a deterministic left-aligned comparison was retained without claiming an optimal global alignment.'],
        ambiguityCount: 0,
      },
    }));
    await page.getByTestId('msa-open-button').dispatchEvent('click');
    const provenance = page.getByTestId('msa-provenance');
    await expect(provenance).toBeVisible();
    await expect(provenance).toContainText('fallback: bounded comparison route');

    await page.getByRole('combobox', { name: 'Theme' }).selectOption({ label: 'Warm Dark' });
    await page.setViewportSize({ width: 390, height: 760 });
    const summary = provenance.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(provenance).toContainText('Bounded monotonic exact-seed-and-extend comparison');
    await expect(provenance).toContainText('without claiming an optimal global alignment');
    const box = await provenance.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
