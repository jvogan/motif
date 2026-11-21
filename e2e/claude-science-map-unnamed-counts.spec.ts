import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

if (process.env.MOTIF_SINGLE_PROCESS_BROWSER === '1') {
  test.use({
    launchOptions: {
      args: ['--single-process', '--no-zygote'],
    },
  });
}

// "+2 features" and "+8 sites" are one quiet group in the map's control rows, not
// links floating over the drawing's lower-right corner: 12px secondary text, no
// underline, no fill at rest, below the drawing, and the drawing keeps its size.
const CASES = [
  { width: 1440, height: 900, theme: 'light', ring: 551 },
  { width: 1440, height: 900, theme: 'dark', ring: 551 },
  { width: 700, height: 860, theme: 'light', ring: 377 },
  // Narrower strips give the counts the Sites caption's room, so the status line
  // still reads whole beside them (660) or above them (400).
  { width: 660, height: 788, theme: 'dark', ring: 340 },
  // A phone-width panel gives about 4px of ring and the map's status row to a third
  // whole sequence line (side-panel-fit): the sequence's own status line shows the
  // same words, so the map's line stays for assistive technology only.
  { width: 400, height: 700, theme: 'light', ring: 211, lineVisuallyHidden: true },
] as const;

async function openArtifact(page: Page, width: number, height: number, theme: string) {
  await page.setViewportSize({ width, height });
  await page.addInitScript((nextTheme) => {
    if (window.sessionStorage.getItem('map-counts-seeded')) return;
    window.localStorage.clear();
    if (nextTheme !== 'light') {
      window.localStorage.setItem('motif.workspace-layout.v1', JSON.stringify({ theme: nextTheme }));
    }
    window.sessionStorage.setItem('map-counts-seeded', '1');
  }, theme);
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test.describe('the counts of what the map leaves unnamed', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const c of CASES) {
    test(`sit quietly under the drawing at ${c.width}x${c.height} in ${c.theme}`, async ({ page }) => {
      await openArtifact(page, c.width, c.height, c.theme);
      const group = page.getByRole('group', { name: 'Unnamed on the map' });
      await expect(group.locator('.motif-cs-map-overflow-button')).toHaveCount(2);
      const read = await page.evaluate(() => {
        const svg = document.querySelector('[data-pane-key="map"] svg.motif-plasmid-map')!;
        const frame = document.querySelector('.motif-cs-map-frame')!.getBoundingClientRect();
        const secondary = getComputedStyle(document.querySelector('.motif-cs-map-selection-line[data-empty]')!).color;
        const line = document.querySelector<HTMLElement>('.motif-cs-map-selection-line')!;
        const buttons = [...document.querySelectorAll<HTMLElement>('.motif-cs-map-overflow-button')].map((button) => {
          const box = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return {
            text: (button.textContent ?? '').trim(),
            top: Math.round(box.top),
            height: Math.round(box.height),
            belowFrame: box.top >= frame.bottom - 0.5,
            fontSize: style.fontSize,
            color: style.color,
            decoration: style.textDecorationLine,
            background: style.backgroundColor,
            hits: hit === button || button.contains(hit),
            inPane: Boolean(button.closest('[data-pane-key="map"]')),
          };
        });
        return {
          ring: svg.querySelector('path.motif-pm-backbone')!.getBoundingClientRect().width,
          secondary,
          lineCut: line.scrollWidth > line.clientWidth + 0.5,
          lineBox: { width: line.getBoundingClientRect().width, height: line.getBoundingClientRect().height },
          lineText: (line.textContent ?? '').trim(),
          stripCut: [...document.querySelectorAll<HTMLElement>('.motif-cs-map-dock-strip summary *')]
            .filter((element) => element.getBoundingClientRect().width > 0 && element.childElementCount === 0)
            .filter((element) => element.scrollWidth > element.clientWidth + 0.5)
            .map((element) => (element.textContent ?? '').trim()),
          buttons,
        };
      });
      expect(Math.abs(read.ring - c.ring)).toBeLessThanOrEqual(1);
      if ('lineVisuallyHidden' in c && c.lineVisuallyHidden) {
        expect(read.lineBox.width).toBeLessThanOrEqual(1);
        expect(read.lineBox.height).toBeLessThanOrEqual(1);
        expect(read.lineText).not.toBe('');
      } else {
        expect(read.lineCut).toBe(false);
      }
      expect(read.stripCut).toEqual([]);
      expect(new Set(read.buttons.map((button) => button.top)).size).toBe(1);
      for (const button of read.buttons) {
        expect(button.text).toMatch(/^\+\d+ (features?|sites?)$/);
        expect(button.inPane).toBe(true);
        expect(button.belowFrame).toBe(true);
        expect(button.hits).toBe(true);
        expect(button.height).toBeGreaterThanOrEqual(28);
        expect(button.fontSize).toBe('12px');
        expect(button.color).toBe(read.secondary);
        expect(button.decoration).toBe('none');
        expect(button.background).toBe('rgba(0, 0, 0, 0)');
      }
    });
  }
});
