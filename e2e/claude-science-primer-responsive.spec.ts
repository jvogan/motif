import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openTool } from './tool-panel-aliases';
import { chooseTheme } from './theme';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
// Two actions sit in the footer; the other five live in its "More" menu. The order is the
// order a keyboard user reaches them: Save design, More, the menu items, Use in cloning.
const footerButtonNames = ['Save design', 'Use in cloning'] as const;
const moreMenuItemNames = [
  'Copy pair',
  'Export FASTA',
  'Add annotations',
  'Simulate PCR',
  'Create amplicon record',
] as const;
const evidenceOutputDir = path.resolve(process.cwd(), 'output', 'playwright', 'primer-review');
mkdirSync(evidenceOutputDir, { recursive: true });

test.describe('Claude Science primer workspace responsive footer', () => {
  test.describe.configure({ retries: 0 });
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const viewport of [
    { width: 760, height: 600, theme: 'light' },
    { width: 390, height: 650, theme: 'dark' },
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
      await chooseTheme(page, viewport.theme);
      const primerPanel = await openTool(page, 'primer-design');
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

    const primerPanel = await openTool(page, 'primer-design');
    await primerPanel.getByTestId('open-primer-workspace').click();

    const workspace = page.getByTestId('primer-workspace');
    const footer = workspace.locator('.motif-cs-primer-workspace-footer');
    const actionRow = footer.locator('.motif-cs-primer-footer-actions');
    await expect(workspace).toBeVisible();
    await expect(footer).toBeVisible();

    const footerBox = await footer.boundingBox();
    expect(footerBox).not.toBeNull();
    const more = footer.getByTestId('primer-more-menu');
    const inFooter = async (name: string, action: ReturnType<typeof footer.getByRole>) => {
      await expect(action).toBeVisible();
      await expect(action).toBeEnabled();
      await expect(action).toBeInViewport({ ratio: 1 });
      const actionBox = await action.boundingBox();
      expect(actionBox, `${name} should have a rendered box`).not.toBeNull();
      expect(actionBox!.x, `${name} should stay inside the footer's left edge`).toBeGreaterThanOrEqual(footerBox!.x - 1);
      expect(actionBox!.x + actionBox!.width, `${name} should stay inside the footer's right edge`).toBeLessThanOrEqual(
        footerBox!.x + footerBox!.width + 1,
      );
    };
    for (const name of footerButtonNames) await inFooter(name, footer.getByRole('button', { name, exact: true }));
    await expect(more).toBeVisible();
    await more.click();
    for (const name of moreMenuItemNames) await inFooter(name, footer.getByRole('menuitem', { name, exact: true }));
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

    // The audit listener swallows each click, but a press outside the menu still closes it, so the
    // menu is reopened before each of its items.
    const openMore = async () => {
      if (!(await more.evaluate((summary) => (summary.closest('details') as HTMLDetailsElement).open))) await more.click();
    };
    const everyAction = [
      footer.getByRole('button', { name: 'Save design', exact: true }),
      ...moreMenuItemNames.map((name) => footer.getByRole('menuitem', { name, exact: true })),
      footer.getByRole('button', { name: 'Use in cloning', exact: true }),
    ];
    const labels = ['Save design', ...moreMenuItemNames, 'Use in cloning'];
    for (const [index, action] of everyAction.entries()) {
      // Indexes 1 to 5 are the menu items; their role does not exist while the menu is shut.
      if (index >= 1 && index <= moreMenuItemNames.length) await openMore();
      await action.click();
    }
    await openMore();
    // Keyboard path: Save design, then the More summary, the five items, Use in cloning.
    await everyAction[0].focus();
    await expect(everyAction[0]).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(more).toBeFocused();
    for (let index = 1; index < everyAction.length; index += 1) {
      await page.keyboard.press('Tab');
      await expect(everyAction[index]).toBeFocused();
    }
    for (const action of everyAction) {
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
      ...labels.map((label) => ({ label, input: 'mouse', trusted: true })),
      ...labels.map((label) => ({ label, input: 'keyboard', trusted: true })),
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

      const primerPanel = await openTool(page, 'primer-design');
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
