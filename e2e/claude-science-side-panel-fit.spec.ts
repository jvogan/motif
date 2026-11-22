import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('side-panel-fit-seeded')) return;
    window.localStorage.clear();
    window.sessionStorage.setItem('side-panel-fit-seeded', '1');
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  await expect(page.locator('.motif-cs-seq-bases').first()).toBeVisible();
}

async function showRecord(page: Page, name: string) {
  await page.evaluate((recordName) => {
    [...document.querySelectorAll<HTMLElement>('.motif-cs-record-tab')]
      .find((candidate) => candidate.getAttribute('title') === recordName)
      ?.click();
  }, name);
  await expect(page.locator('.motif-cs-record-tab[data-active="true"]')).toHaveAttribute('title', name);
  await page.waitForTimeout(250);
}

/** Enzyme names the circular map names outright (a cluster's "+N" names none). */
async function namedEnzymes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const names: string[] = [];
    for (const el of document.querySelectorAll('.motif-cs-map-frame[data-map-mode="circular"] .motif-pm-restriction-label')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').replace(/\s*\+\d+$/, '');
      names.push(...text.split(/,\s*/).filter(Boolean));
    }
    return names;
  });
}

test.describe('A side panel keeps the map whole', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  // In a 335px frame at 700x860 (and 299px at 660x788) the map names these enzymes outright, not as "+1".
  // The pane alone decides whether the map is drawn full size or as a miniature, so
  // every record in one window gets the same drawing: full size at 700x860 and 660x788,
  // where the rings these records end up with run from about 280px to 380px, and the
  // miniature at 400x700.
  const cases = [
    { width: 700, height: 860, miniature: false, named: { 'pcDNA3.1(+)': ['NdeI'], pUC19: ['SapI'], 'pET-28a(+)': ['SphI', 'SapI'] } },
    { width: 660, height: 788, miniature: false, named: { 'pcDNA3.1(+)': ['NdeI'], 'pET-28a(+)': ['XhoI'], 'pCDFDuet-1': ['NdeI'] } },
    // The phone panel's 290px frame keeps these names.
    { width: 400, height: 700, miniature: true, named: { pBR322: ['BsmBI'], 'pCOLADuet-1': ['NcoI'], 'pACYCDuet-1': ['NcoI'] } },
  ] as const;
  for (const { width, height, miniature, named } of cases) {
    test(`at ${width}x${height} every enzyme the full map names is still named`, async ({ page }) => {
      await open(page, width, height);
      for (const [record, enzymes] of Object.entries(named)) {
        await showRecord(page, record);
        const shown = await namedEnzymes(page);
        for (const enzyme of enzymes) expect(shown, `${record} names ${enzyme}`).toContain(enzyme);
        const drawn = await page
          .locator('.motif-cs-map-frame[data-map-mode="circular"] svg.motif-plasmid-map')
          .first()
          .getAttribute('data-miniature');
        expect(drawn === 'true', `${record} drawn ${miniature ? 'as a miniature' : 'full size'}`).toBe(miniature);
      }
    });
  }
});

test.describe('A short side panel keeps the centre title off the features', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  // In a 260px frame the centre title stays clear of the features.
  for (const [width, height] of [[400, 700], [700, 700]] as const) {
    test(`at ${width}x${height} the centre title clears every feature body`, async ({ page }) => {
      await open(page, width, height);
      for (const record of ['pUC19', 'pBluescript SK(+)', 'pCOLADuet-1', 'pACYCDuet-1']) {
        await showRecord(page, record);
        const hits = await page.evaluate(() => {
          const frame = document.querySelector('.motif-cs-map-frame[data-map-mode="circular"]')!;
          const bodies = [...frame.querySelectorAll<SVGGeometryElement>('.motif-pm-feature-body')];
          let n = 0;
          for (const text of frame.querySelectorAll<SVGGraphicsElement>('.motif-pm-center-name, .motif-pm-center-len')) {
            const box = text.getBoundingClientRect();
            if (box.width < 1) continue;
            const point = text.ownerSVGElement!.createSVGPoint();
            for (let i = 1; i < 8; i++) for (let j = 1; j < 4; j++) {
              point.x = box.left + (box.width * i) / 8;
              point.y = box.top + (box.height * j) / 4;
              for (const body of bodies) {
                const local = point.matrixTransform(body.getScreenCTM()!.inverse());
                if (body.isPointInStroke(local) || body.isPointInFill(local)) { n++; break; }
              }
            }
          }
          return n;
        });
        expect(hits, `${record} centre title on a feature`).toBe(0);
      }
    });
  }
});

test.describe('A bottom sheet leaves the picked lines above it', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  // From 600px wide in a panel 860px or taller the Translation window sits in the flow and the
  // map keeps a ring (claude-science-overlays.spec.ts); 1px shorter, 700 wide is still a sheet.
  for (const [width, height, floor] of [[700, 859, 2], [660, 788, 2]] as const) {
    test(`at ${width}x${height} at least ${floor} lines show above the Translation sheet`, async ({ page }) => {
      await open(page, width, height);
      const rows = page.locator('.motif-cs-orf-select');
      if (!(await rows.first().isVisible())) {
        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await page.getByRole('button', { name: 'Analysis', exact: true }).click();
      }
      await rows.first().click();
      await expect(page.locator('.motif-cs-selection-name')).toContainText('bp');
      if (await page.locator('[data-tools-drawer="open"]').count()) {
        await page.getByRole('button', { name: 'Tools', exact: true }).click();
      }
      const scrolled = () => page.evaluate(() => document.querySelector('.motif-cs-main')!.scrollTop);
      const scrollBefore = await scrolled();
      await page.evaluate(() => document.querySelector<HTMLElement>('button[aria-label^="Translations window"]')!.click());
      await expect(page.locator('.motif-cs-window .motif-cs-protein-readout')).toBeVisible();
      const measure = () => page.evaluate(() => {
        const sheet = document.querySelector('.motif-cs-window')!.getBoundingClientRect();
        const view = document.querySelector('.motif-cs-sequence')!.getBoundingClientRect();
        const main = document.querySelector('.motif-cs-main')!.getBoundingClientRect();
        const status = document.querySelector('[data-readout]')?.getBoundingClientRect();
        const lines = [...document.querySelectorAll('.motif-cs-sequence .motif-cs-seq-bases[data-line-start]')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= Math.max(main.top, view.top) && r.bottom <= Math.min(sheet.top, view.bottom);
          }).length;
        const ring = document.querySelector('[data-pane-key="map"] .motif-pm-backbone')?.getBoundingClientRect();
        return {
          lines,
          statusUnderSheet: status ? status.bottom > sheet.top && status.top < sheet.bottom : true,
          statusInView: status ? status.top >= main.top && status.bottom <= sheet.top && status.height > 0 : false,
          ringShown: ring ? ring.height > 0 : false,
        };
      });
      await expect.poll(async () => (await measure()).lines).toBeGreaterThanOrEqual(floor);
      const seen = await measure();
      expect(seen.statusUnderSheet, 'status line under the sheet').toBe(false);
      expect(seen.statusInView, 'status line in view above the sheet').toBe(true);
      // The map folds to its header row: no sliver of ring, and the page does not jump.
      expect(seen.ringShown, 'ring drawn while the sheet is open').toBe(false);
      expect(Math.abs((await scrolled()) - scrollBefore), 'workspace scroll jump').toBeLessThanOrEqual(1);
      // Closing the sheet brings the map back.
      await page.locator('.motif-cs-window').getByRole('button', { name: /^Close/ }).first().click();
      await expect(page.locator('[data-pane-key="map"] .motif-pm-backbone')).toBeVisible();
    });
  }
});

test.describe('A phone-width panel shows the sequence under the map', () => {
  test.skip(!artifactUrl, 'MOTIF_ARTIFACT_URL is required');

  test('at 400x700 three whole lines show and the bases end where the status line begins', async ({ page }) => {
    await open(page, 400, 700);
    const read = () => page.evaluate(() => {
      const view = document.querySelector('.motif-cs-sequence')!;
      const box = view.getBoundingClientRect();
      const status = document.querySelector('[data-pane-key="sequence"] .motif-cs-selection-bar')!.getBoundingClientRect();
      // Whole: eight points down the line all hit the bases, not the status line or the page.
      const whole = [...view.querySelectorAll<HTMLElement>('.motif-cs-seq-bases[data-line-start]')].filter((line) => {
        const r = line.getBoundingClientRect();
        for (let k = 0; k < 8; k++) {
          const y = r.top + 1 + ((r.height - 2) * k) / 7;
          if (y < 0 || y >= window.innerHeight) return false;
          const hit = document.elementFromPoint(r.left + 30, y);
          if (!hit || !view.contains(hit)) return false;
        }
        return true;
      }).length;
      const ring = document.querySelector('[data-pane-key="map"] .motif-pm-backbone')!.getBoundingClientRect();
      const readout = document.querySelector('.motif-cs-map-selection-line')!.getBoundingClientRect();
      return {
        whole,
        basesBottom: box.bottom,
        statusTop: status.top,
        statusBottom: status.bottom,
        ring: Math.round(Math.max(ring.width, ring.height)),
        readoutHeight: readout.height,
      };
    });
    await expect.poll(async () => (await read()).whole).toBeGreaterThanOrEqual(3);
    const seen = await read();
    expect(seen.basesBottom, 'bases under the status line').toBeLessThanOrEqual(seen.statusTop + 1);
    expect(seen.statusBottom).toBeLessThanOrEqual(700.5);
    expect(seen.ring).toBeGreaterThanOrEqual(208);
    // The sequence's status line carries the readout; the map's own row stays for
    // assistive technology and comes back when Sequence is hidden.
    expect(seen.readoutHeight).toBeLessThanOrEqual(1);
    await expect(page.locator('.motif-cs-map-selection-line')).toHaveText(/drag to select a range/);
    await page.getByRole('button', { name: 'Collapse sequence pane' }).click();
    await expect.poll(() => page.locator('.motif-cs-map-selection-line').evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(20);
  });
});
