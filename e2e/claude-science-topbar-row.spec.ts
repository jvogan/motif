import { expect, test, type Page } from '@playwright/test';
import { chooseTheme } from './theme';
import { openTool } from './tools-drawer';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;

// With the Records pane hidden, Import sits in the bar after the toggles at every
// width, inside the corner reserved for the host's Annotate pill, rather than starting
// the record strip's row under the top bar, which would read as the bar wrapping onto a
// second row.
// From 470px up the row also keeps the Motif wordmark whole beside it.
test.describe('top bar', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const width of [400, 440, 470, 480, 520, 560, 700, 840, 1280]) {
    test(`keeps Import on the top bar's one row at ${width}px, every control whole and 28px or more`, async ({ page }) => {
      await page.setViewportSize({ width, height: 760 });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      await expect(page.locator('.motif-cs-shell')).toBeVisible();
      const records = page.locator('[data-pane-toggle="inventory"]');
      if ((await records.getAttribute('data-active')) === 'true') await records.click();
      const importButton = page.locator('.motif-cs-add-entry-button');
      await expect(importButton).toHaveCount(1);
      await expect(page.locator('.motif-cs-topbar .motif-cs-add-entry-button')).toBeVisible();
      await expect(importButton).toHaveAttribute('aria-label', 'Import records');
      const geometry = await page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>('.motif-cs-topbar')!;
        const box = bar.getBoundingClientRect();
        const reserveLeft = box.right - parseFloat(getComputedStyle(bar).paddingRight);
        return [...bar.querySelectorAll<HTMLElement>('button, select')]
          .filter((control) => control.getBoundingClientRect().width > 0)
          .map((control) => {
            const r = control.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {
              name: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
              top: Math.round(r.top),
              right: r.right,
              width: r.width,
              height: r.height,
              reachable: !!hit && (hit === control || control.contains(hit)),
              reserveLeft,
              barBottom: box.bottom,
            };
          });
      });
      expect(new Set(geometry.map((control) => control.top)).size, JSON.stringify(geometry)).toBe(1);
      if (width >= 470) {
        const wordmark = await page.evaluate(() => {
          const span = document.querySelector<HTMLElement>('.motif-cs-topbar > .motif-cs-brand > span')!;
          const r = span.getBoundingClientRect();
          return { width: r.width, scrollWidth: span.scrollWidth, clientWidth: span.clientWidth, text: span.textContent };
        });
        expect(wordmark.text).toBe('Motif');
        expect(wordmark.width, JSON.stringify(wordmark)).toBeGreaterThan(0);
        expect(wordmark.scrollWidth, JSON.stringify(wordmark)).toBeLessThanOrEqual(wordmark.clientWidth);
      }
      for (const control of geometry) {
        expect(control.reachable, control.name).toBe(true);
        expect(control.right, control.name).toBeLessThanOrEqual(control.reserveLeft + 0.5);
        expect(control.height, control.name).toBeGreaterThanOrEqual(28);
        expect(control.width, control.name).toBeGreaterThanOrEqual(28);
        expect(control.top + control.height, control.name).toBeLessThanOrEqual(control.barBottom);
      }
      // The panel it opens still drops below the strip, and the button reports it open.
      await importButton.click();
      await expect(importButton).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.motif-cs-record-strip .motif-cs-import-panel[open]')).toBeVisible();
    });
  }
});

// At 340px and below every toggle keeps the narrowest 2px of side padding, Tools too,
// with Import in the bar: the 5px squeeze above stops at 341px.
test('keeps the narrowest toggle padding at 340px with Import in the top bar', async ({ page }) => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');
  await page.setViewportSize({ width: 340, height: 760 });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  const records = page.locator('[data-pane-toggle="inventory"]');
  if ((await records.getAttribute('data-active')) === 'true') await records.click();
  await expect(page.locator('.motif-cs-topbar .motif-cs-add-entry-button')).toBeVisible();
  const tools = page.locator('.motif-cs-topbar [data-pane-toggle="tools"]');
  await expect(tools).toHaveCSS('padding-left', '2px');
  await expect(tools).toHaveCSS('padding-right', '2px');
});

// The record strip's overflow edge beside "+N records" is a 1px hairline, shown only at an
// edge with more tabs past it, not a 16px shadow of the text colour (which reads as a smudge
// in dark: up to 2.9:1 off the strip across 16 columns).
test.describe('records strip edge', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const theme of ['light', 'dark']) {
    test(`shows a hairline, not a smudge, beside the overflow count in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 700, height: 860 });
      await page.addInitScript((name) => {
        if (window.sessionStorage.getItem('edge-seeded')) return;
        window.localStorage.clear();
        window.localStorage.setItem('motif.workspace-layout.v1', JSON.stringify({ theme: name }));
        window.sessionStorage.setItem('edge-seeded', '1');
      }, theme);
      await page.goto(artifactUrl!);
      await expect(page.locator('.motif-cs-record-strip-more')).toBeVisible();
      const nav = page.locator('.motif-cs-record-tabs');
      // Columns of the 20px inside an edge whose contrast against the strip's background
      // exceeds 1.02, read from a screenshot of the page.
      const marked = async (edge: 'right') => {
        const box = (await nav.boundingBox())!;
        const x = edge === 'right' ? Math.round(box.x + box.width) - 20 : Math.round(box.x);
        const shot = await page.screenshot({ clip: { x, y: Math.round(box.y) + 2, width: 20, height: Math.round(box.height) - 5 } });
        return page.evaluate(async (src) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const data = context.getImageData(0, 0, image.width, image.height).data;
          const probe = document.createElement('canvas').getContext('2d')!;
          probe.fillStyle = getComputedStyle(document.querySelector('.motif-cs-record-strip')!).backgroundColor;
          probe.fillRect(0, 0, 1, 1);
          const bg = Array.from(probe.getImageData(0, 0, 1, 1).data.slice(0, 3));
          const channel = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
          const lum = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
          const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
          let columns = 0;
          for (let x = 0; x < image.width; x += 1) {
            let worst = 1;
            for (let y = 0; y < image.height; y += 1) {
              const i = (y * image.width + x) * 4;
              worst = Math.max(worst, ratio([data[i], data[i + 1], data[i + 2]], bg));
            }
            if (worst > 1.02) columns += 1;
          }
          return columns;
        }, 'data:image/png;base64,' + shot.toString('base64'));
      };
      // A tab the edge would cut is hidden whole, so the 20px is the strip's background
      // plus the hairline: one marked column.
      expect(await marked('right'), 'right edge with tabs past it').toBe(1);
    });
  }
});

// Settings > Appearance lists the themes. The bar has no theme select or theme word at
// any width; its sun or moon icon button flips the theme (pinned below). Its controls
// stay on one row inside the Annotate reserve, and a theme picked in Settings is the one
// saved.
test.describe('theme control', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  for (const [width, height] of [[1440, 900], [1280, 820], [700, 860], [660, 788]] as const) {
    test(`is listed in Settings, with no select in the top bar, at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        if (window.sessionStorage.getItem('theme-control-seeded')) return;
        window.localStorage.clear();
        window.sessionStorage.setItem('theme-control-seeded', '1');
      });
      await page.goto(artifactUrl!);
      await expect(page.locator('.motif-cs-shell')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      const bar = page.locator('.motif-cs-topbar');
      await expect(bar.locator('select')).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveCount(0);
      await expect(bar.getByText(/^(Light|Dark|Theme)$/)).toHaveCount(0);
      // The bar's controls still sit on one row, each 28px tall, inside the Annotate reserve.
      const controls = await bar.evaluate((element) => {
        const reserveLeft = element.getBoundingClientRect().right - parseFloat(getComputedStyle(element).paddingRight);
        return [...element.querySelectorAll<HTMLElement>('button')]
          .filter((control) => control.getBoundingClientRect().width > 0)
          .map((control) => {
            const r = control.getBoundingClientRect();
            return { top: Math.round(r.top), height: Math.round(r.height), right: r.right, reserveLeft };
          });
      });
      expect(new Set(controls.map((control) => control.top)).size, JSON.stringify(controls)).toBe(1);
      for (const control of controls) {
        expect(control.height).toBe(28);
        expect(control.right).toBeLessThanOrEqual(control.reserveLeft);
      }

      await chooseTheme(page, 'dark');
      await page.reload();
      await expect(page.locator('.motif-cs-shell')).toBeVisible();
      await expect(page.locator('html'), 'the pick made in Settings is the one saved').toHaveAttribute('data-theme', 'dark');
      await expect(bar.locator('select')).toHaveCount(0);
    });
  }
});

// The light/dark icon is a button, not a select. The bar's last control is
// one quiet 28px icon button seated right after the row's last control, one row gap after
// it, as the row's controls sit after each other: a sun in Light, a moon in Dark, named for
// what a press does. A click, Enter or Space flips the theme through the same setter as
// Settings, so Settings shows the new pick and it survives a reload. It shows at any width
// where the row has room for it there, the viewer's 660px default included, and leaves the
// bar where the row has none (Settings still offers the choice). It never enters the corner
// kept for the host's control.
test.describe('theme icon', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  const lastControl = (page: Page) => page.locator('.motif-cs-topbar').evaluate((bar) => {
    const box = bar.getBoundingClientRect();
    const contentRight = box.right - parseFloat(getComputedStyle(bar).paddingRight);
    const shown = [...bar.querySelectorAll<HTMLElement>('button, select')].filter((control) => control.getBoundingClientRect().width > 0);
    const last = shown.at(-1)!;
    const r = last.getBoundingClientRect();
    const before = shown.at(-2)?.getBoundingClientRect();
    const icon = last.querySelector('svg')?.getBoundingClientRect();
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      label: last.getAttribute('aria-label'),
      title: last.getAttribute('title'),
      pressed: last.getAttribute('aria-pressed'),
      icon: last.querySelector('svg')?.innerHTML ?? null,
      iconSize: icon ? [Math.round(icon.width), Math.round(icon.height)] : null,
      size: [Math.round(r.width), Math.round(r.height)],
      // From the control before it to its left edge, beside the row's own gap.
      seat: before ? round(r.left - before.right) : null,
      rowGap: parseFloat(getComputedStyle(bar.querySelector('.motif-cs-topbar-meta')!).columnGap),
      rightGap: round(contentRight - r.right),
      centres: [...new Set(shown.map((control) => {
        const c = control.getBoundingClientRect();
        return Math.round(c.top + c.height / 2);
      }))],
    };
  });

  const openAt = async (page: Page, width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem('theme-icon-seeded')) return;
      window.localStorage.clear();
      window.sessionStorage.setItem('theme-icon-seeded', '1');
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
  };

  test('ends the top bar and flips Light and Dark, with Settings agreeing', async ({ page }) => {
    await openAt(page, 1440, 900);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');

    const inLight = await lastControl(page);
    expect(inLight.label).toBe('Switch to dark theme');
    expect(inLight.title).toBe('Switch to dark theme');
    expect(inLight.pressed, 'an action button, not a pressed toggle').toBeNull();
    expect(inLight.size).toEqual([28, 28]);
    expect(inLight.iconSize).toEqual([14, 14]);
    expect(inLight.seat, 'one row gap after the last control, not at the bar\'s far end').toBe(inLight.rowGap);
    expect(inLight.rightGap, 'clear of the corner kept for the host\'s control').toBeGreaterThan(0);
    expect(inLight.centres, 'centred with the other controls').toHaveLength(1);

    const toggle = page.getByRole('button', { name: 'Switch to dark theme' });
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const inDark = await lastControl(page);
    expect(inDark.label).toBe('Switch to light theme');
    expect(inDark.title).toBe('Switch to light theme');
    expect(inDark.icon, 'a moon, not the sun').not.toBe(inLight.icon);
    expect(inDark.seat).toBe(inDark.rowGap);

    // The keyboard flips it too, and focus stays on the button.
    const flip = page.locator('.motif-cs-topbar > .motif-cs-theme-toggle');
    await flip.focus();
    await page.keyboard.press('Enter');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(flip).toHaveAttribute('aria-label', 'Switch to dark theme');
    await expect(flip).toBeFocused();
    await page.keyboard.press('Space');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(flip).toHaveAttribute('aria-label', 'Switch to light theme');

    // Settings > Appearance shows the pick, and the pick is saved.
    const settings = await openTool(page, 'settings');
    await expect(settings.locator('input[name="settings-theme"][value="dark"]')).toBeChecked();
    await page.reload();
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
  });

  test('shows and flips the theme at 660x788, the viewer\'s default size', async ({ page }) => {
    await openAt(page, 660, 788);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    const shown = await lastControl(page);
    expect(shown.label).toBe('Switch to dark theme');
    expect(shown.size).toEqual([28, 28]);
    expect(shown.seat, 'one row gap after Import').toBe(shown.rowGap);
    expect(shown.rightGap, 'clear of the corner kept for the host\'s control').toBeGreaterThanOrEqual(0);
    expect(shown.centres, 'centred with the other controls').toHaveLength(1);
    const overflow = await page.evaluate(() => {
      const meta = document.querySelector('.motif-cs-topbar-meta')!;
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, row: meta.scrollWidth - meta.clientWidth };
    });
    expect(overflow, 'neither the page nor the row scrolls').toEqual({ page: 0, row: 0 });

    // It comes last in tab order, straight after Import.
    await page.locator('.motif-cs-topbar .motif-cs-add-entry-button').focus();
    await page.keyboard.press('Tab');
    const flip = page.locator('.motif-cs-topbar > .motif-cs-theme-toggle');
    await expect(flip).toBeFocused();

    await flip.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(flip).toHaveAttribute('aria-label', 'Switch to light theme');
    const settings = await openTool(page, 'settings');
    await expect(settings.locator('input[name="settings-theme"][value="dark"]')).toBeChecked();
  });

  // 700px ends the row at Import with 10px to spare; 520px uses the narrow 4px gaps; at
  // 469px the brand is not in the bar.
  for (const [width, height] of [[700, 860], [520, 760], [469, 760]] as const) {
    test(`sits one row gap after the last control at ${width}x${height}, clear of the host's corner`, async ({ page }) => {
      await openAt(page, width, height);
      const shown = await lastControl(page);
      expect(shown.label).toBe('Switch to dark theme');
      expect(shown.size).toEqual([28, 28]);
      expect(shown.seat).toBe(shown.rowGap);
      expect(shown.rightGap).toBeGreaterThanOrEqual(0);
      expect(shown.centres).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }

  // From 681px to 700px the row ends within a few pixels of the room the button needs, so
  // which side of the line a width falls on depends on the font's letter widths. The pin
  // here is the rule, not the width: shown and seated with room to spare, or absent because
  // the row's free end is narrower than one gap and the 28px button.
  test('at 685x860 it shows only if the row has room for it', async ({ page }) => {
    await openAt(page, 685, 860);
    const last = await lastControl(page);
    if (last.label === 'Switch to dark theme') {
      expect(last.size).toEqual([28, 28]);
      expect(last.seat).toBe(last.rowGap);
      expect(last.rightGap).toBeGreaterThanOrEqual(0);
    } else {
      expect(last.rightGap, 'less room than one gap and the button').toBeLessThan(last.rowGap + 28);
    }
    const row = await page.locator('.motif-cs-topbar-meta').evaluate((meta) => meta.scrollWidth - meta.clientWidth);
    expect(row, 'the row does not scroll').toBeLessThanOrEqual(0);
    expect(last.centres).toHaveLength(1);
  });

  for (const [width, height] of [[400, 700]] as const) {
    test(`leaves the top bar where the row has no room for it, at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(artifactUrl!);
      await expect(page.locator('.motif-cs-shell')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Switch to (dark|light) theme$/ })).toHaveCount(0);
      const row = await page.locator('.motif-cs-topbar-meta').evaluate((meta) => meta.scrollWidth - meta.clientWidth);
      expect(row, 'the row does not scroll').toBeLessThanOrEqual(0);
      expect((await lastControl(page)).centres).toHaveLength(1);
    });
  }
});
