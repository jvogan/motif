import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

if (process.env.MOTIF_SINGLE_PROCESS_BROWSER === '1') {
  test.use({
    launchOptions: {
      args: ['--single-process', '--no-zygote'],
    },
  });
}

// Twice the pixels, so a quarter-pixel crossing still shows up as whole device pixels.
test.use({ deviceScaleFactor: 2 });

const DPR = 2;
const VIEWPORTS = [
  { width: 700, height: 860 },
  { width: 1280, height: 820 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;
const THEMES = ['light', 'dark'] as const;
// Records that stress the map names: the one with the most riding names, and the largest.
const RECORDS = ['pUC19', 'pBR322', 'pcDNA3.1(+)'] as const;

type Extent = { n: number; minR: number; maxR: number; minA: number; maxA: number };
type RidingName = {
  k: number;
  text: string;
  outerR: number;
  innerR: number;
  center: { x: number; y: number };
  clip: { x: number; y: number; width: number; height: number };
};

async function openArtifact(page: Page, width: number, height: number, theme: string) {
  await page.setViewportSize({ width, height });
  await page.addInitScript((nextTheme) => {
    if (window.sessionStorage.getItem('map-labels-seeded')) return;
    window.localStorage.clear();
    if (nextTheme !== 'light') {
      window.localStorage.setItem('motif.workspace-layout.v1', JSON.stringify({ theme: nextTheme }));
    }
    window.sessionStorage.setItem('map-labels-seeded', '1');
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

/** Every name drawn on its feature's arc, with its band's radii and a clip around both. */
async function ridingNames(page: Page): Promise<{ ctm: number[]; scale: number; names: RidingName[] }> {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('[data-pane-key="map"] svg.motif-plasmid-map')!;
    const m = svg.getScreenCTM()!;
    const names: RidingName[] = [];
    let k = 0;
    for (const text of svg.querySelectorAll<SVGTextElement>('g.motif-pm-feature text[data-on-arc]')) {
      const group = text.closest('g.motif-pm-feature')!;
      const body = group.querySelector<SVGPathElement>('path.motif-pm-feature-body')!;
      const radii = [...(body.getAttribute('d') ?? '').matchAll(/A\s*([\d.]+)/g)].map((match) => Number(match[1]));
      const textPath = text.querySelector('textPath')!;
      const arc = svg.querySelector<SVGPathElement>(`#${CSS.escape((textPath.getAttribute('href') ?? textPath.getAttribute('xlink:href') ?? '').slice(1))}`)!;
      const length = arc.getTotalLength();
      const [a, b, c] = [0, length / 2, length].map((at) => arc.getPointAtLength(at));
      // The ring's centre is the circumcentre of three points on the name's arc.
      const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
      const center = {
        x: ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d,
        y: ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d,
      };
      const tb = text.getBoundingClientRect();
      const bb = body.getBoundingClientRect();
      const x0 = Math.max(0, Math.min(tb.left, bb.left) - 8);
      const y0 = Math.max(0, Math.min(tb.top, bb.top) - 8);
      const x1 = Math.min(window.innerWidth, Math.max(tb.right, bb.right) + 8);
      const y1 = Math.min(window.innerHeight, Math.max(tb.bottom, bb.bottom) + 8);
      text.dataset.mapLabelProbe = String(k);
      names.push({
        k: k++,
        text: text.textContent?.trim() ?? '',
        outerR: Math.max(...radii),
        innerR: Math.min(...radii),
        center,
        clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      });
    }
    return { ctm: [m.a, m.b, m.c, m.d, m.e, m.f], scale: Math.hypot(m.a, m.b), names };
  });
}

/** Paint only one part of the map on white: the name's ink, the name as drawn, or its band. */
async function isolate(page: Page, k: number, mode: 'ink' | 'paint' | 'band' | 'none') {
  await page.evaluate(({ k: index, mode: what }) => {
    let style = document.getElementById('map-label-probe');
    if (!style) {
      style = document.createElement('style');
      style.id = 'map-label-probe';
      document.head.appendChild(style);
    }
    const svg = '[data-pane-key="map"] svg.motif-plasmid-map';
    const text = document.querySelector<SVGTextElement>(`${svg} text[data-map-label-probe="${index}"]`)!;
    const group = text.closest<SVGGElement>('g.motif-pm-feature')!;
    group.dataset.mapLabelProbeGroup = 'true';
    text.dataset.mapLabelProbeOn = 'true';
    const hideAll = `${svg} *{visibility:hidden !important}
      html,body,.motif-cs-shell,[data-pane-key="map"],[data-pane-key="map"] *{background:#ffffff !important;box-shadow:none !important}`;
    const css: Record<string, string> = {
      none: '',
      ink: `${hideAll} ${svg} text[data-map-label-probe-on], ${svg} text[data-map-label-probe-on] *{visibility:visible !important;fill:#000000 !important;stroke:none !important}`,
      paint: `${hideAll} ${svg} text[data-map-label-probe-on], ${svg} text[data-map-label-probe-on] *{visibility:visible !important}`,
      band: `${hideAll} ${svg} g[data-map-label-probe-group] path.motif-pm-feature-body{visibility:visible !important}`,
    };
    style.textContent = css[what];
    if (what === 'none') {
      delete group.dataset.mapLabelProbeGroup;
      delete text.dataset.mapLabelProbeOn;
    }
  }, { k, mode });
}

/** Radial extent, in layout units about the ring centre, of the pixels darker than `threshold`. */
async function radialExtent(
  page: Page,
  name: RidingName,
  ctm: number[],
  threshold: number,
  angles: [number, number] | null,
): Promise<Extent> {
  const png = await page.screenshot({ clip: name.clip });
  return page.evaluate(async ({ b64, clip, ctm: matrix, center, threshold: limit, angles: range, dpr }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const [a, b, c, d, e, f] = matrix;
    const det = a * d - b * c;
    const out = { n: 0, minR: Infinity, maxR: -Infinity, minA: Infinity, maxA: -Infinity };
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const i = (y * canvas.width + x) * 4;
        if (data[i] + data[i + 1] + data[i + 2] >= limit) continue;
        const sx = clip.x + (x + 0.5) / dpr;
        const sy = clip.y + (y + 0.5) / dpr;
        const ux = (d * (sx - e) - c * (sy - f)) / det;
        const uy = (-b * (sx - e) + a * (sy - f)) / det;
        const angle = Math.atan2(uy - center.y, ux - center.x);
        if (range && (angle < range[0] || angle > range[1])) continue;
        const r = Math.hypot(ux - center.x, uy - center.y);
        out.n += 1;
        out.minR = Math.min(out.minR, r);
        out.maxR = Math.max(out.maxR, r);
        out.minA = Math.min(out.minA, angle);
        out.maxA = Math.max(out.maxA, angle);
      }
    }
    return out;
  }, { b64: png.toString('base64'), clip: name.clip, ctm, center: name.center, threshold, angles, dpr: DPR });
}

test.describe('names riding the circular map', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');
  test.setTimeout(240_000);

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`stay inside their own band at ${viewport.width}x${viewport.height} in ${theme}`, async ({ page }) => {
        await openArtifact(page, viewport.width, viewport.height, theme);
        const failures: string[] = [];
        let measured = 0;
        for (const record of RECORDS) {
          await showRecord(page, record);
          const { ctm, scale, names } = await ridingNames(page);
          // The outline is 1 screen px on the band's edge, so half of it lies inside.
          const outlineHalf = 0.5 / scale;
          for (const name of names) {
            await isolate(page, name.k, 'ink');
            const ink = await radialExtent(page, name, ctm, 384, null);
            const angles: [number, number] = [ink.minA, ink.maxA];
            await isolate(page, name.k, 'paint');
            const paint = await radialExtent(page, name, ctm, 750, angles);
            await isolate(page, name.k, 'band');
            const band = await radialExtent(page, name, ctm, 750, angles);
            await isolate(page, name.k, 'none');
            expect(ink.n, `${record} ${name.text} has ink`).toBeGreaterThan(0);
            const px = (units: number) => Math.round(units * scale * 100) / 100;
            const into = {
              // Ink at half strength or more never reaches the outline itself.
              inkOuter: px(ink.maxR - (name.outerR - outlineHalf)),
              inkInner: px(name.innerR + outlineHalf - ink.minR),
              // Nothing the name paints, halo included, reaches past the drawn band.
              paintOuter: px(paint.maxR - band.maxR),
              paintInner: px(band.minR - paint.minR),
            };
            measured += 1;
            if (into.inkOuter > 0 || into.inkInner > 0 || into.paintOuter > 0 || into.paintInner > 0) {
              failures.push(`${record} "${name.text}" ${JSON.stringify(into)}`);
            }
          }
        }
        process.stdout.write(`${viewport.width}x${viewport.height} ${theme}: ${measured} riding names measured\n`);
        // The side panel's smaller map frame (700x860) rides 7 names on their arcs
        // across the three records; every larger viewport rides at least 8.
        expect(measured).toBeGreaterThanOrEqual(8);
        expect(failures).toEqual([]);
      });
    }
  }
});
