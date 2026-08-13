import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const footerActionNames = [
  'Copy pair',
  'Export FASTA',
  'Save design',
  'Add annotations',
  'Simulate PCR',
  'Create amplicon record',
  'Use in cloning',
] as const;
const evidenceOutputDir = path.resolve(process.cwd(), 'output', 'playwright', 'primer-review');
mkdirSync(evidenceOutputDir, { recursive: true });

test.describe('Claude Science primer workspace responsive footer', () => {
  test.describe.configure({ retries: 0 });
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const viewport of [
    { width: 760, height: 600, theme: 'light' },
    { width: 390, height: 650, theme: 'claude-dark' },
  ] as const) {
    test(`keeps review evidence legible and actions reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      await page.locator('select[name="artifact-theme"]').evaluate((select, theme) => {
        const themeSelect = select as HTMLSelectElement;
        themeSelect.value = theme;
        themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }, viewport.theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', viewport.theme);
      const primerPanel = page.locator('details[data-rail-tool="primer-design"]');
      await primerPanel.locator(':scope > summary').click();
      await primerPanel.getByTestId('open-primer-workspace').click();

      const workspace = page.getByTestId('primer-workspace');
      await workspace.getByText('Advanced constraints').click();
      await workspace.getByLabel('Forward 5′ tail').fill('NNNN');
      await workspace.getByLabel('Reverse 5′ tail').fill('NNNN');
      const review = workspace.getByTestId('primer-evidence-review');
      const acknowledgment = workspace.getByTestId('primer-evidence-acknowledgment');
      const save = workspace.getByRole('button', { name: 'Save design', exact: true });
      await review.scrollIntoViewIfNeeded();
      await expect(review).toBeVisible();
      await expect(save).toBeDisabled();

      const fontSizes = await workspace.evaluate((element) => {
        const reviewElement = element.querySelector<HTMLElement>('.motif-cs-primer-evidence-review')!;
        const crossValue = element.querySelector<HTMLElement>('.motif-cs-primer-cross-check strong')!;
        const crossMessage = element.querySelector<HTMLElement>('.motif-cs-primer-cross-check small')!;
        return [reviewElement, crossValue, crossMessage].map((item) => Number.parseFloat(getComputedStyle(item).fontSize));
      });
      expect(fontSizes.every((size) => size >= 12)).toBe(true);

      await acknowledgment.focus();
      await acknowledgment.press('Space');
      await expect(acknowledgment).toBeChecked();
      await expect(save).toBeEnabled();
      await workspace.getByLabel('Target Tm °C').fill('61');
      await expect(acknowledgment).not.toBeChecked();
      await expect(save).toBeDisabled();
      await acknowledgment.click();
      await expect(save).toBeEnabled();
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport({ ratio: 1 });

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        workspace: (() => {
          const element = document.querySelector<HTMLElement>('[data-testid="primer-workspace"]')!;
          return element.scrollWidth > element.clientWidth + 1;
        })(),
      }));
      expect(overflow).toEqual({ document: false, workspace: false });
      expect(consoleErrors).toEqual([]);
      await page.screenshot({
        path: path.join(evidenceOutputDir, `primer-review-${viewport.theme}-${viewport.width}x${viewport.height}.png`),
      });
    });
  }

  for (const width of [760, 390]) test(`keeps every action visible and mouse- and keyboard-operable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();

    const primerPanel = page.locator('details[data-rail-tool="primer-design"]');
    await primerPanel.locator(':scope > summary').click();
    await primerPanel.getByTestId('open-primer-workspace').click();

    const workspace = page.getByTestId('primer-workspace');
    const footer = workspace.locator('.motif-cs-primer-workspace-footer');
    const actionRow = footer.locator('.motif-cs-primer-footer-actions');
    await expect(workspace).toBeVisible();
    await expect(footer).toBeVisible();

    const footerBox = await footer.boundingBox();
    expect(footerBox).not.toBeNull();
    for (const name of footerActionNames) {
      const action = footer.getByRole('button', { name, exact: true });
      await expect(action).toBeVisible();
      await expect(action).toBeEnabled();
      await expect(action).toBeInViewport({ ratio: 1 });
      const actionBox = await action.boundingBox();
      expect(actionBox, `${name} should have a rendered box`).not.toBeNull();
      expect(actionBox!.x, `${name} should stay inside the footer's left edge`).toBeGreaterThanOrEqual(footerBox!.x - 1);
      expect(actionBox!.x + actionBox!.width, `${name} should stay inside the footer's right edge`).toBeLessThanOrEqual(
        footerBox!.x + footerBox!.width + 1,
      );
    }
    expect(await actionRow.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    await page.evaluate(() => {
      type Activation = { label: string; input: 'keyboard' | 'mouse'; trusted: boolean };
      const auditWindow = window as Window & { __motifPrimerFooterActivations?: Activation[] };
      auditWindow.__motifPrimerFooterActivations = [];
      document.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.motif-cs-primer-footer-actions button');
        if (!button) return;
        auditWindow.__motifPrimerFooterActivations?.push({
          label: button.textContent?.trim() ?? '',
          input: event.detail === 0 ? 'keyboard' : 'mouse',
          trusted: event.isTrusted,
        });
        event.preventDefault();
        event.stopImmediatePropagation();
      }, { capture: true });
    });

    for (const name of footerActionNames) {
      await footer.getByRole('button', { name, exact: true }).click();
    }
    await footer.getByRole('button', { name: footerActionNames[0], exact: true }).focus();
    for (let index = 0; index < footerActionNames.length; index += 1) {
      await expect(footer.getByRole('button', { name: footerActionNames[index], exact: true })).toBeFocused();
      if (index < footerActionNames.length - 1) await page.keyboard.press('Tab');
    }
    for (const name of footerActionNames) {
      const action = footer.getByRole('button', { name, exact: true });
      await action.focus();
      await expect(action).toBeFocused();
      await action.press('Enter');
    }

    const activations = await page.evaluate(() => (
      window as Window & {
        __motifPrimerFooterActivations?: Array<{ label: string; input: 'keyboard' | 'mouse'; trusted: boolean }>;
      }
    ).__motifPrimerFooterActivations ?? []);
    expect(activations).toEqual([
      ...footerActionNames.map((label) => ({ label, input: 'mouse', trusted: true })),
      ...footerActionNames.map((label) => ({ label, input: 'keyboard', trusted: true })),
    ]);
  });

  for (const width of [1440, 760, 390]) {
    test(`keeps the explicit target, selected pair, status, and focus stable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      await expect(page.locator('.motif-cs-shell')).toBeVisible();

      const primerPanel = page.locator('details[data-rail-tool="primer-design"]');
      await primerPanel.locator(':scope > summary').click();
      await primerPanel.getByTestId('open-primer-workspace').click();

      const workspace = page.getByTestId('primer-workspace');
      const rows = workspace.locator('.motif-cs-primer-pair-row');
      const targetStart = workspace.getByLabel('Target start');
      const targetEnd = workspace.getByLabel('Target end');
      await expect(rows).toHaveCount(10);
      await expect(workspace).toBeVisible();
      const initialTarget = {
        start: await targetStart.inputValue(),
        end: await targetEnd.inputValue(),
      };

      const pairTwo = rows.nth(1);
      await pairTwo.scrollIntoViewIfNeeded();
      await pairTwo.click();
      await expect(pairTwo).toHaveAttribute('aria-selected', 'true');
      await expect(workspace.getByRole('region', { name: 'Primer pair 2 evidence' })).toBeVisible();
      await expect(workspace.locator('.motif-cs-primer-live-status')).toContainText('Pair 2 selected on the sequence.');
      await expect(targetStart).toHaveValue(initialTarget.start);
      await expect(targetEnd).toHaveValue(initialTarget.end);
      await expect(pairTwo).toBeFocused();

      const pairThree = rows.nth(2);
      await pairTwo.press('ArrowDown');
      await expect(pairThree).toHaveAttribute('aria-selected', 'true');
      await expect(workspace.getByRole('region', { name: 'Primer pair 3 evidence' })).toBeVisible();
      await expect(workspace.locator('.motif-cs-primer-live-status')).toContainText('Pair 3 selected on the sequence.');
      await expect(targetStart).toHaveValue(initialTarget.start);
      await expect(targetEnd).toHaveValue(initialTarget.end);
      await expect(pairThree).toBeFocused();
    });
  }
});
