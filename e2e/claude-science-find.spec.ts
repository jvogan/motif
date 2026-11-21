import { expect, test, type Locator, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// Built from repeats. The filler has no G or T, so the only sites are the planted ones.
const [A, C, G, T] = ['A', 'C', 'G', 'T'];
const ECORI = G + A + A + T + T + C;
const BSAI = G + G + T + C + T + C;
const BSAI_BOTTOM = G + A + G + A + C + C;
const filler = (pairs: number) => (C + A).repeat(pairs);
// EcoRI at 60 and 232, a bottom-strand BsaI site at 146.
const SEQUENCE = filler(30) + ECORI + filler(40) + BSAI_BOTTOM + filler(40) + ECORI + filler(30);

type WorkspaceRecord = { id: string; name: string; type: string; topology: string; sequence: string };

async function openWith(page: Page, record: WorkspaceRecord, width = 700, height = 900) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await page.waitForFunction(() => typeof window.motifReplaceWorkspace === 'function');
  await page.evaluate((entry) => window.motifReplaceWorkspace({
    schema: 'motif.claude-science.inventory.v2',
    records: [entry],
    selectedRecordId: entry.id,
  }, { discardUnsavedChanges: true }), record);
  await expect.poll(() => page.evaluate(() => (window.motifGetActiveRecord() as { id?: string } | null)?.id)).toBe(record.id);
  await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();
}

const searchbox = (page: Page) => page.getByRole('searchbox', { name: 'Find in sequence' });
const findStatus = (page: Page) => page.locator('.motif-cs-find-bar').getByRole('status');
const selectedBases = (page: Page) => page.evaluate(() => {
  const described = window.motifDescribe() as { data?: { selection?: { sequence?: string } | null } } | null;
  return described?.data?.selection?.sequence ?? null;
});
// Every painted part of the current match is inside the sequence view and
// clear of the bar. Returns what is wrong, or '' when the rule holds.
const currentMatchCoverage = (page: Page) => page.evaluate(() => {
  const bar = document.querySelector('.motif-cs-find-bar')?.getBoundingClientRect();
  const view = document.getElementById('motif-cs-sequence-view')?.getBoundingClientRect();
  // A match across a circular origin also paints a continuation at base 1; the
  // rule is about the part that runs from the match start.
  const parts = [...document.querySelectorAll('[data-find-current]:not([data-find-current="continued"])')]
    .map((part) => part.getBoundingClientRect());
  if (!bar || !view) return 'no bar or view';
  if (parts.length === 0) return 'no current match painted';
  const problems: string[] = [];
  for (const part of parts) {
    const inView = part.top >= view.top - 1 && part.bottom <= Math.min(view.bottom, window.innerHeight) + 1;
    const underBar = part.top < bar.bottom && part.bottom > bar.top && part.left < bar.right && part.right > bar.left;
    if (!inView) problems.push(`outside the view at ${Math.round(part.top)} (view ${Math.round(view.top)}-${Math.round(view.bottom)})`);
    if (underBar) problems.push(`under the bar at ${Math.round(part.top)} (bar ${Math.round(bar.top)}-${Math.round(bar.bottom)})`);
  }
  return problems.join('; ');
});

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  expect(rect).toBeTruthy();
  return rect!;
};

test.describe('Find in sequence', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  const pageDiagnostics = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const diagnostics: string[] = [];
    pageDiagnostics.set(page, diagnostics);
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') diagnostics.push(`console.${message.type()}: ${message.text()}`);
    });
  });

  test.afterEach(async ({ page }) => {
    expect(pageDiagnostics.get(page) ?? []).toEqual([]);
  });

  test('Cmd/Ctrl+F opens a find bar that searches both strands, steps, clears, and closes', async ({ page }) => {
    await openWith(page, { id: 'find-record', name: 'Find record', type: 'dna', topology: 'linear', sequence: SEQUENCE });
    const view = page.locator('#motif-cs-sequence-view');
    const toolbar = page.locator('.motif-cs-edit-toolbar');
    const viewBefore = await box(view);
    const toolbarBefore = await box(toolbar);

    await view.focus();
    await page.keyboard.press('ControlOrMeta+f');
    await expect(searchbox(page)).toBeFocused();
    await expect(findStatus(page)).toContainText('Both strands');
    // The bar docks above the view: the view's top edge moves down to the
    // bar's bottom edge, its bottom edge and width stay, the toolbar stays.
    const viewOpen = await box(view);
    const barOpen = await box(page.locator('.motif-cs-find-bar'));
    expect(Math.abs(viewOpen.y - (barOpen.y + barOpen.height))).toBeLessThanOrEqual(0.5);
    expect(viewOpen.y + viewOpen.height).toBeCloseTo(viewBefore.y + viewBefore.height, 3);
    expect([viewOpen.x, viewOpen.width]).toEqual([viewBefore.x, viewBefore.width]);
    expect(await box(toolbar)).toEqual(toolbarBefore);

    // A site that is only on the bottom strand.
    await searchbox(page).fill(BSAI.toLowerCase());
    await expect(findStatus(page)).toContainText('1 of 1');
    await expect(findStatus(page)).toContainText('reverse strand');
    await expect.poll(() => selectedBases(page)).toBe(BSAI_BOTTOM);

    // The search continues from the current match and wraps at either end.
    await searchbox(page).fill(ECORI);
    await expect(findStatus(page)).toContainText('2 of 2');
    await expect(findStatus(page)).toContainText('forward strand');
    await searchbox(page).press('Enter');
    await expect(findStatus(page)).toContainText('1 of 2');
    await expect(findStatus(page)).toContainText('Wrapped to the first match');
    await searchbox(page).press('Shift+Enter');
    await expect(findStatus(page)).toContainText('2 of 2');
    await expect(findStatus(page)).toContainText('Wrapped to the last match');
    await page.getByRole('button', { name: 'Next match' }).click();
    await expect(findStatus(page)).toContainText('1 of 2');
    await expect.poll(() => selectedBases(page)).toBe(ECORI);
    await expect(page.locator('.motif-cs-find-hit')).toHaveCount(1);
    await expect(page.locator('[data-find-current]')).toHaveCount(1);

    // The x inside the field clears it and keeps typing focus there.
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(searchbox(page)).toHaveValue('');
    await expect(searchbox(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(0);
    await expect(findStatus(page)).toContainText('Both strands');

    await searchbox(page).fill(ECORI);
    await expect(findStatus(page)).toContainText(/\d of 2/);
    await searchbox(page).press('Escape');
    await expect(page.getByRole('search', { name: 'Find in sequence' })).toHaveCount(0);
    await expect(view).toBeFocused();
    await expect(page.locator('.motif-cs-find-hit, [data-find-current]')).toHaveCount(0);
    expect(await selectedBases(page)).toBe(ECORI);
    expect(await box(toolbar)).toEqual(toolbarBefore);
  });

  for (const width of [400, 700]) {
    test(`at ${width}px the current match is never under the bar, stepping both ways through every match`, async ({ page }) => {
      // The first-open plasmid: 16 matches from the first visible row to the end of the record.
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      await page.waitForFunction(() => typeof window.motifReplaceWorkspace === 'function');
      await expect(page.locator('#motif-cs-sequence-view')).toBeVisible();
      await page.getByRole('button', { name: 'Find', exact: true }).click();
      await searchbox(page).fill(G + A + G + 'N' + C);
      await expect(findStatus(page)).toContainText('1 of 16');
      await expect.poll(() => currentMatchCoverage(page)).toBe('');
      for (let step = 2; step <= 18; step += 1) {
        await searchbox(page).press('Enter');
        await expect(findStatus(page)).toContainText(`${((step - 1) % 16) + 1} of 16`);
        await expect.poll(() => currentMatchCoverage(page), { message: `forward step ${step}` }).toBe('');
      }
      for (let step = 0; step < 4; step += 1) {
        await searchbox(page).press('Shift+Enter');
        await expect.poll(() => currentMatchCoverage(page), { message: `backward step ${step}` }).toBe('');
      }
    });

    test(`at ${width}px matches on the first and last rows of a record stay clear of the bar`, async ({ page }) => {
      const edges = ECORI + filler(150) + ECORI + filler(150) + ECORI;
      await openWith(page, { id: 'find-edges', name: 'Find edges', type: 'dna', topology: 'linear', sequence: edges }, width, 900);
      await page.locator('#motif-cs-sequence-view').focus();
      await page.keyboard.press('ControlOrMeta+f');
      await searchbox(page).fill(ECORI);
      await expect(findStatus(page)).toContainText('1 of 3');
      await expect.poll(() => currentMatchCoverage(page)).toBe('');
      const steps: [string, string][] = [['Enter', '2 of 3'], ['Enter', '3 of 3'], ['Enter', '1 of 3'], ['Shift+Enter', '3 of 3'], ['Shift+Enter', '2 of 3']];
      for (const [key, expected] of steps) {
        await searchbox(page).press(key);
        await expect(findStatus(page)).toContainText(expected);
        await expect.poll(() => currentMatchCoverage(page), { message: expected }).toBe('');
      }
    });
  }

  // The bar docks above the bases while it sits at the top edge: the text moves
  // down instead of going under it, so it covers no base line at 700x860 and at 1440x900.
  for (const { width, height } of [{ width: 700, height: 860 }, { width: 1440, height: 900 }]) {
    test(`the open find bar covers no base line at ${width}x${height}`, async ({ page }) => {
      await openWith(page, { id: 'find-record', name: 'Find record', type: 'dna', topology: 'linear', sequence: SEQUENCE }, width, height);
      await page.locator('#motif-cs-sequence-view').focus();
      await page.keyboard.press('ControlOrMeta+f');
      await searchbox(page).fill(BSAI);
      await expect(page.locator('.motif-cs-find-bar')).toHaveAttribute('data-placement', 'top');
      const covered = await page.evaluate(() => {
        const bar = document.querySelector('.motif-cs-find-bar')!.getBoundingClientRect();
        const view = document.querySelector('#motif-cs-sequence-view')!.getBoundingClientRect();
        return [...document.querySelectorAll('[data-pane-key="sequence"] .motif-cs-seq-bases')].filter((line) => {
          const box = line.getBoundingClientRect();
          return box.height > 0 && box.bottom > view.top && box.top < view.bottom
            && box.left < bar.right && box.right > bar.left && box.top < bar.bottom && box.bottom > bar.top;
        }).length;
      });
      expect(covered).toBe(0);
    });
  }

  test('the Find button opens the same bar, seeded from a short selected range', async ({ page }) => {
    await openWith(page, { id: 'find-record', name: 'Find record', type: 'dna', topology: 'linear', sequence: SEQUENCE });
    const view = page.locator('#motif-cs-sequence-view');
    await view.focus();
    await page.keyboard.press('ControlOrMeta+f');
    await searchbox(page).fill(BSAI);
    await expect.poll(() => selectedBases(page)).toBe(BSAI_BOTTOM);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(view).toBeFocused();

    // Reopening on the match it left selected keeps the query rather than
    // replacing it with the matched bases.
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(searchbox(page)).toHaveValue(BSAI);
    await expect(searchbox(page)).toBeFocused();
    await expect(findStatus(page)).toContainText('1 of 1');

    // Pressing the shortcut again selects the field's text for retyping.
    await page.keyboard.press('ControlOrMeta+f');
    expect(await searchbox(page).evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, BSAI.length]);
  });

  test('a bottom-strand match is drawn on the complement row when that row is shown', async ({ page }) => {
    await openWith(page, { id: 'find-record', name: 'Find record', type: 'dna', topology: 'linear', sequence: SEQUENCE });
    await page.getByRole('button', { name: 'Complement strand' }).click();
    await page.locator('#motif-cs-sequence-view').focus();
    await page.keyboard.press('ControlOrMeta+f');
    await searchbox(page).fill(BSAI);
    const current = page.locator('[data-find-current]');
    await expect(current).toHaveAttribute('data-strand', '-1');
    const bases = current.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " motif-cs-seq-bases ")]');
    const complementRow = await box(bases.locator('.motif-cs-seq-complement'));
    const ring = await box(current);
    expect(ring.y).toBeGreaterThanOrEqual(complementRow.y - 2);
    expect(ring.y + ring.height).toBeLessThanOrEqual(complementRow.y + complementRow.height + 2);
  });

  test('a match is found across the origin of a circular record', async ({ page }) => {
    const circular = ECORI.slice(3) + filler(60) + ECORI.slice(0, 3);
    await openWith(page, { id: 'find-circle', name: 'Find circle', type: 'dna', topology: 'circular', sequence: circular });
    await page.locator('#motif-cs-sequence-view').focus();
    await page.keyboard.press('ControlOrMeta+f');
    await searchbox(page).fill(ECORI);
    await expect(findStatus(page)).toContainText('1 of 1');
    await expect.poll(() => selectedBases(page)).toBe(ECORI);
    await expect(page.locator('[data-find-current]')).toHaveCount(2);
  });

  test('a protein record finds residues with no strands', async ({ page }) => {
    const protein = 'MK' + 'H'.repeat(6) + 'LE'.repeat(20);
    await openWith(page, { id: 'find-protein', name: 'Find protein', type: 'protein', topology: 'linear', sequence: protein });
    await page.locator('#motif-cs-sequence-view').focus();
    await page.keyboard.press('ControlOrMeta+f');
    await expect(findStatus(page)).toContainText('Type residues');
    await searchbox(page).fill('hhhhh');
    await expect(findStatus(page)).toContainText('1 of 2');
    await expect(findStatus(page)).not.toContainText('strand');
  });

  test('typing on keeps the previous matches painted until the new ones arrive', async ({ page }) => {
    await openWith(page, { id: 'find-record', name: 'Find record', type: 'dna', topology: 'linear', sequence: SEQUENCE });
    await page.locator('#motif-cs-sequence-view').focus();
    await page.keyboard.press('ControlOrMeta+f');
    await searchbox(page).pressSequentially(G + A);
    await expect(page.locator('.motif-cs-find-hit, .motif-cs-find-current').first()).toBeVisible();
    // Count the painted matches on every frame while four more letters go in.
    // Every prefix of the EcoRI site matches, so no frame should be bare.
    await page.evaluate(() => {
      const state = window as unknown as { findFrames: number[]; findSampling: boolean };
      state.findFrames = [];
      state.findSampling = true;
      const sample = () => {
        state.findFrames.push(document.querySelectorAll('.motif-cs-find-hit, .motif-cs-find-current').length);
        if (state.findSampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await searchbox(page).pressSequentially(A + T + T + C, { delay: 80 });
    await page.waitForTimeout(500);
    const frames = await page.evaluate(() => {
      const state = window as unknown as { findFrames: number[]; findSampling: boolean };
      state.findSampling = false;
      return state.findFrames;
    });
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.filter((painted) => painted === 0)).toEqual([]);
  });

  test('F3 pressed straight after a new query selects that query\'s match, not the previous one\'s', async ({ page }) => {
    // A record over 50 kb waits 150 ms before it searches, so the F3 below
    // always arrives while the new query is still searching.
    const large = filler(15_000) + ECORI + filler(10_000) + BSAI + filler(15_000);
    await openWith(page, { id: 'find-retype', name: 'Find retype', type: 'dna', topology: 'linear', sequence: large }, 1040, 900);
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await searchbox(page).pressSequentially(ECORI);
    await expect(findStatus(page)).toContainText('1 of 1');
    await expect(page.locator('#motif-cs-sequence-view')).toHaveAttribute('data-selection-start', '30000');

    await searchbox(page).selectText();
    await page.keyboard.type(BSAI);
    await page.keyboard.press('F3');
    await expect(findStatus(page)).toContainText('1 of 1');
    await expect(page.locator('#motif-cs-sequence-view')).toHaveAttribute('data-selection-start', '50006');
  });

  test('a 250 kb record is searched in its large view with an honest capped count', async ({ page }) => {
    const large = filler(62_500) + ECORI + filler(62_497);
    await openWith(page, { id: 'find-large', name: 'Find large', type: 'dna', topology: 'linear', sequence: large }, 1040, 900);
    await expect(page.getByTestId('large-sequence-viewer')).toBeVisible();
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await searchbox(page).fill(ECORI);
    await expect(findStatus(page)).toContainText('1 of 1');
    await expect(page.locator('.motif-cs-find-large-layer [data-find-current]')).toHaveCount(1);
    await expect(page.locator('#motif-cs-sequence-view')).toHaveAttribute('data-selection-start', '125000');

    await searchbox(page).fill(C + A);
    await expect(findStatus(page)).toContainText('of 10,000+');
  });
});

// Opened from the keyboard on pUC19, Find docks above the bases and takes its
// band out of the sequence view: the page does not grow, and the match it
// lands on sits whole between the bar and the status line. Closing it puts the
// view back where it was. (Typed, not filled: filling the field scrolls the
// page, which would hide a page that grows.)
test.describe('Find docked over the default record', () => {
  for (const [width, height] of [[700, 860], [1280, 820], [1440, 900]] as const) {
    test(`keeps the page size and the match clear of the status line at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      const view = page.locator('#motif-cs-sequence-view');
      await expect(view).toBeVisible();
      const layout = () => page.evaluate(() => {
        const main = document.querySelector<HTMLElement>('.motif-cs-main')!;
        const box = document.querySelector('#motif-cs-sequence-view')!.getBoundingClientRect();
        return { overflow: main.scrollHeight - main.clientHeight, mainTop: main.scrollTop, viewTop: Math.round(box.top), viewHeight: Math.round(box.height) };
      });
      await view.focus();
      const closed = await layout();
      await page.keyboard.press('ControlOrMeta+f');
      await expect(searchbox(page)).toBeFocused();
      await page.keyboard.type(ECORI);
      await page.keyboard.press('Enter');
      await expect(findStatus(page)).toContainText('1 of 1');
      const current = page.locator('[data-find-current]:not([data-find-current="continued"])');
      await expect(current).toBeVisible();
      await expect.poll(async () => (await layout()).overflow, 'Find adds no page overflow').toBeLessThanOrEqual(closed.overflow);
      const fit = await current.evaluate((mark) => {
        const m = mark.getBoundingClientRect();
        const bar = document.querySelector('.motif-cs-find-bar')!.getBoundingClientRect();
        const view = document.querySelector<HTMLElement>('#motif-cs-sequence-view')!;
        const v = view.getBoundingClientRect();
        const copy = document.querySelector('[data-pane-key="sequence"] .motif-cs-copy-button');
        const status = copy ? copy.getBoundingClientRect().top : Infinity;
        // The view's top edge under the bar cuts no lane, base line or amino-acid row (1px tolerance).
        const edge = v.top + view.clientTop;
        const cutRows = [...view.querySelectorAll('.motif-cs-feature-track-lane, .motif-cs-restriction-track-lane, .motif-cs-seq-line, .motif-cs-seq-aa-row')]
          .map((row) => row.getBoundingClientRect())
          .filter((row) => row.top < edge - 1 && row.bottom > edge + 1);
        return {
          topRowWhole: cutRows.length === 0,
          belowBar: m.top >= bar.bottom - 0.5,
          aboveStatus: m.bottom <= status + 0.5,
          inView: m.top >= v.top - 0.5 && m.bottom <= v.bottom + 0.5,
          onScreen: m.top >= 0 && m.bottom <= innerHeight,
        };
      });
      expect(fit).toEqual({ topRowWhole: true, belowBar: true, aboveStatus: true, inView: true, onScreen: true });
      expect((await layout()).mainTop).toBe(closed.mainTop);
      await page.keyboard.press('Escape');
      await expect(page.locator('.motif-cs-find-bar')).toHaveCount(0);
      const reopened = await layout();
      expect({ overflow: reopened.overflow, viewTop: reopened.viewTop, viewHeight: reopened.viewHeight }).toEqual({ overflow: closed.overflow, viewTop: closed.viewTop, viewHeight: closed.viewHeight });
    });
  }
});
