import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

if (process.env.MOTIF_SINGLE_PROCESS_BROWSER === '1') {
  test.use({
    launchOptions: {
      args: ['--single-process', '--no-zygote'],
    },
  });
}

// On a narrow window the placer slides pUC19's "M13/pUC forward primer" name past the
// "lac promoter" spoke. Its leader does not bend across that neighbour's leader; it
// runs along the gap under the lane above and leaves on its own spoke. Several sizes,
// because the ring at these widths moves with the window (215 px at 400x700).
// Every pane here is too small for the full-size drawing (SMALL_MAP_PANE_RING_PX), so
// the map draws a miniature: fewer names, features before cut sites, each whole or left
// off (small-ring-miniature.test.ts). The floors are what it names at each size, so
// dropping names fails.
const CASES = [
  { width: 360, height: 700, record: 'pUC19', features: 5, sites: 2 },
  { width: 400, height: 700, record: 'pUC19', features: 5, sites: 2 },
  { width: 440, height: 700, record: 'pUC19', features: 5, sites: 2 },
  { width: 400, height: 600, record: 'pUC19', features: 5, sites: 2 },
  { width: 400, height: 700, record: 'pcDNA3.1(+)', features: 6, sites: 2 },
] as const;

async function openArtifact(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('map-leaders-seeded')) return;
    window.localStorage.clear();
    window.sessionStorage.setItem('map-leaders-seeded', '1');
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
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

test.describe('map leaders on a narrow window', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const c of CASES) {
    test(`do not cross for ${c.record} at ${c.width}x${c.height}`, async ({ page }) => {
      await openArtifact(page, c.width, c.height);
      if (c.record !== 'pUC19') await showRecord(page, c.record);
      const map = await page.evaluate(() => {
        const svg = document.querySelector<SVGSVGElement>('[data-pane-key="map"] svg.motif-plasmid-map')!;
        type Seg = { a: number[]; b: number[]; owner: Element };
        const segs: Seg[] = [];
        for (const line of svg.querySelectorAll<SVGPolylineElement>('polyline.motif-pm-leader')) {
          const m = line.getScreenCTM()!;
          const pts: number[][] = [];
          for (let i = 0; i < line.points.numberOfItems; i += 1) {
            const p = svg.createSVGPoint();
            p.x = line.points.getItem(i).x;
            p.y = line.points.getItem(i).y;
            const s = p.matrixTransform(m);
            pts.push([s.x, s.y]);
          }
          for (let i = 0; i + 1 < pts.length; i += 1) segs.push({ a: pts[i], b: pts[i + 1], owner: line.parentElement! });
        }
        const side = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        const pairs = new Set<string>();
        for (let i = 0; i < segs.length; i += 1) {
          for (let j = i + 1; j < segs.length; j += 1) {
            const s = segs[i];
            const t = segs[j];
            if (s.owner === t.owner) continue;
            if (side(s.a, s.b, t.a) * side(s.a, s.b, t.b) < 0 && side(t.a, t.b, s.a) * side(t.a, t.b, s.b) < 0) {
              pairs.add([s.owner.textContent?.trim(), t.owner.textContent?.trim()].sort().join(' x '));
            }
          }
        }
        const shown = (selector: string) => [...svg.querySelectorAll(selector)]
          .filter((text) => text.getBoundingClientRect().width > 1).length;
        return {
          miniature: svg.getAttribute('data-miniature') === 'true',
          crossings: [...pairs],
          features: shown('text.motif-pm-feature-label'),
          sites: shown('text.motif-pm-restriction-label'),
        };
      });
      expect(map.miniature).toBe(true);
      expect(map.crossings).toEqual([]);
      expect(map.features).toBeGreaterThanOrEqual(c.features);
      expect(map.sites).toBeGreaterThanOrEqual(c.sites);
    });
  }
});
