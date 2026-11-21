import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

if (process.env.MOTIF_SINGLE_PROCESS_BROWSER === '1') {
  test.use({
    launchOptions: {
      args: ['--single-process', '--no-zygote'],
    },
  });
}

// A short, wide map frame scales the ring by its height, so the frame keeps free
// margin beside the drawing. Outside names use that margin before they are shortened:
// at these first-open sizes every name is drawn whole and the ring keeps its size.
const CASES = [
  { width: 660, height: 788, theme: 'dark', record: 'pUC19', ring: 340 },
  { width: 660, height: 788, theme: 'light', record: 'pUC19', ring: 340 },
  { width: 700, height: 860, theme: 'light', record: 'pUC19', ring: 377 },
  { width: 660, height: 788, theme: 'dark', record: 'pcDNA3.1(+)', ring: 332 },
] as const;

async function openArtifact(page: Page, width: number, height: number, theme: string) {
  await page.setViewportSize({ width, height });
  await page.addInitScript((nextTheme) => {
    if (window.sessionStorage.getItem('map-names-seeded')) return;
    window.localStorage.clear();
    if (nextTheme !== 'light') {
      window.localStorage.setItem('motif.workspace-layout.v1', JSON.stringify({ theme: nextTheme }));
    }
    window.sessionStorage.setItem('map-names-seeded', '1');
  }, theme);
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function showRecord(page: Page, name: string) {
  await page.evaluate((recordName) => {
    const tab = [...document.querySelectorAll<HTMLElement>('.motif-cs-record-tab')]
      .find((candidate) => candidate.getAttribute('title') === recordName);
    tab?.click();
  }, name);
  await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toHaveAttribute('title', name);
  await expect(page.locator('.motif-cs-map-frame[data-map-mode="circular"]')).toBeVisible();
  await page.waitForTimeout(250);
}

test.describe('outside map names at first open', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const c of CASES) {
    test(`are whole for ${c.record} at ${c.width}x${c.height} in ${c.theme}`, async ({ page }) => {
      await openArtifact(page, c.width, c.height, c.theme);
      if (c.record !== 'pUC19') await showRecord(page, c.record);
      const map = await page.evaluate(() => {
        const svg = document.querySelector<SVGSVGElement>('[data-pane-key="map"] svg.motif-plasmid-map')!;
        const frame = svg.getBoundingClientRect();
        const names = [...svg.querySelectorAll<SVGTextElement>('text.motif-pm-feature-label, text.motif-pm-restriction-label')]
          .filter((text) => text.getBoundingClientRect().width > 1);
        const outside = names.map((text) => text.getBoundingClientRect())
          .filter((box) => box.left < frame.left - 0.5 || box.right > frame.right + 0.5
            || box.top < frame.top - 0.5 || box.bottom > frame.bottom + 0.5).length;
        return {
          ring: svg.querySelector('path.motif-pm-backbone')!.getBoundingClientRect().width,
          features: [...svg.querySelectorAll('text.motif-pm-feature-label')].map((t) => (t.textContent ?? '').trim()),
          cut: names.map((text) => (text.textContent ?? '').trim()).filter((text) => /…|\.\.\./.test(text)),
          outside,
        };
      });
      expect(map.cut).toEqual([]);
      expect(map.outside).toBe(0);
      expect(Math.abs(map.ring - c.ring)).toBeLessThanOrEqual(1);
      if (c.record === 'pUC19') {
        expect(map.features).toEqual(expect.arrayContaining([
          'lacZ-alpha',
          'lac promoter',
          'M13/pUC forward primer (-47)',
        ]));
      } else {
        expect(map.features).toContain('CMV promoter');
      }
    });
  }
});
