import { expect, test, type Page } from '@playwright/test';
import { chooseTheme } from './theme';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const themes = ['light', 'dark'] as const;

type ThemeName = (typeof themes)[number];
type RatioMeasurement = {
  after: number;
  before: number;
  border: string;
  outside: string;
};

test.describe('control boundary and focus contrast', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
  });

  test('control boundaries rasterize above 3:1 in every theme and forced colors', async ({ page }) => {
    await installControlFixtures(page);

    for (const theme of themes) {
      await applyTheme(page, theme);
      const measurements = await measureControlFixtures(page);
      process.stdout.write(`${theme} control contrast ${JSON.stringify(measurements)}\n`);
      for (const [name, measurement] of Object.entries(measurements)) {
        // A button drawn without an outline has no boundary to measure; what identifies
        // it is asserted below. Fields, selects and the segmented container keep 3:1.
        if (borderlessCases.includes(name)) continue;
        expect(measurement.after, `${theme} ${name}`).toBeGreaterThanOrEqual(3);
      }
      const buttons = await measureBorderlessButtons(page);
      process.stdout.write(`${theme} borderless buttons ${JSON.stringify(buttons)}\n`);
      for (const name of borderlessCases) {
        const button = buttons[name];
        // (a) The label against the button's resting fill composited over its backdrop.
        expect(button.labelOnRest, `${theme} ${name} label on its resting fill`).toBeGreaterThanOrEqual(4.5);
        // (b) The focus-visible ring against the backdrop.
        expect(button.ringStyle, `${theme} ${name} draws a focus ring`).not.toBe('none');
        expect(button.ringOnBackdrop, `${theme} ${name} focus ring`).toBeGreaterThanOrEqual(3);
        // (c) Hover paints a fill that differs from rest.
        expect(button.hover, `${theme} ${name} hover fill`).not.toEqual(button.rest);
      }
    }

    await page.emulateMedia({ forcedColors: 'active' });
    const forcedMeasurements = await measureControlFixtures(page);
    process.stdout.write(`forced-colors control contrast ${JSON.stringify(forcedMeasurements)}\n`);
    for (const [name, measurement] of Object.entries(forcedMeasurements)) {
      expect(measurement.after, `forced-colors ${name}`).toBeGreaterThanOrEqual(3);
    }
  });

  test('the record title receives a visible 3:1 shell focus outline', async ({ page }) => {
    // Five real keyboard traversals plus before/after raster captures take just
    // over the 30-second default on the hosted runner. Keep every appearance
    // and pixel assertion, but give this measurement-heavy audit a bounded
    // budget that reflects the work it deliberately performs.
    test.setTimeout(60_000);

    for (const theme of themes) {
      const measurement = await measureTitleFocus(page, theme);
      process.stdout.write(`${theme} title focus ${JSON.stringify(measurement)}\n`);
      expect(measurement.matchesFocusVisible).toBe(true);
      expect(measurement.outlineStyle).toBe('solid');
      expect(measurement.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(measurement.ratioAgainstAdjacent).toBeGreaterThanOrEqual(3);
      expect(measurement.ratioAgainstUnfocused).toBeGreaterThanOrEqual(3);
      expect(measurement.changedPixels).toBeGreaterThan(0);
    }

    await page.emulateMedia({ forcedColors: 'active' });
    const forcedMeasurement = await measureTitleFocus(page, 'dark', 'active');
    process.stdout.write(`forced-colors title focus ${JSON.stringify(forcedMeasurement)}\n`);
    expect(forcedMeasurement.ratioAgainstAdjacent).toBeGreaterThanOrEqual(3);
    expect(forcedMeasurement.changedPixels).toBeGreaterThan(0);
  });
});

test.describe('theme default', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('opens light under a dark system setting until the user picks a theme', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    // Clear storage on the first load only, so the reload below sees the saved pick.
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem('contrast-spec-seeded')) return;
      window.localStorage.clear();
      window.sessionStorage.setItem('contrast-spec-seeded', '1');
    });
    await page.goto(artifactUrl!);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(300);
    await expect(html, 'the system setting does not switch the theme after mount').toHaveAttribute('data-theme', 'light');

    await chooseTheme(page, 'dark');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html, 'a saved pick wins on the next open').toHaveAttribute('data-theme', 'dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await chooseTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('clickable and read text is not drawn as a caption', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('panel heads, site labels and residues clear 4.5:1 in the primary or secondary colour', async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    await expect(page.locator('.motif-cs-seq-aa').first()).toBeAttached();

    const cases = {
      // The one Export control, in the title row; there is no summary row under the bases.
      'export head': '.motif-cs-sequence-title [aria-controls="motif-cs-export-panel"]',
      'restriction label': '.motif-cs-restriction-label',
      'translation residue': '.motif-cs-seq-aa:not([data-stop]):not([data-start])',
      'translation row name': '.motif-cs-aa-row-label',
    };
    for (const theme of themes) {
      await applyTheme(page, theme);
      const measured = await page.evaluate((selectors) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('A 2D canvas context is required for contrast measurement.');
        const rasterize = (value: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const linear = (channel: number) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (pixel: number[]) => 0.2126 * linear(pixel[0]) + 0.7152 * linear(pixel[1]) + 0.0722 * linear(pixel[2]);
        const ratio = (left: number[], right: number[]) => {
          const a = luminance(left);
          const b = luminance(right);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const opaqueBackground = (element: Element) => {
          for (let current: Element | null = element; current; current = current.parentElement) {
            const value = getComputedStyle(current).backgroundColor;
            if (rasterize(value)[3] === 255) return rasterize(value);
          }
          return rasterize(getComputedStyle(document.documentElement).backgroundColor);
        };
        const token = (name: string) => rasterize(getComputedStyle(document.documentElement).getPropertyValue(name).trim()).join(',');
        const allowed = new Set([token('--text-primary'), token('--text-secondary')]);
        return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
          const element = document.querySelector(selector);
          if (!element) return [name, null];
          const color = rasterize(getComputedStyle(element).color);
          return [name, {
            ratio: Number(ratio(color, opaqueBackground(element)).toFixed(2)),
            strongToken: allowed.has(color.join(',')),
          }];
        }));
      }, cases);
      process.stdout.write(`${theme} caption-colour audit ${JSON.stringify(measured)}\n`);
      for (const [name, result] of Object.entries(measured)) {
        expect(result, `${theme} ${name} is on screen`).not.toBeNull();
        expect(result!.ratio, `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
        expect(result!.strongToken, `${theme} ${name} uses --text-primary or --text-secondary`).toBe(true);
      }
    }
  });

  // A disabled label has to be legible (3:1) and plainly dimmer than an enabled one (under 4.5)
  // in every theme, so that it does not read as available.
  test('a disabled toolbar label reads dimmed in dark as in light, and stays above 3:1', async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(artifactUrl!);
    await expect(page.locator('.motif-cs-shell')).toBeVisible();
    const actions = page.locator('.motif-cs-sequence-panel .motif-cs-selection-actions');
    await expect(actions.locator('.motif-cs-copy-button')).toBeDisabled();
    await expect(actions.getByRole('button', { name: 'Add feature', exact: true })).toBeDisabled();
    await expect(actions.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();

    for (const theme of themes) {
      await applyTheme(page, theme);
      const measured = await actions.evaluate(labelContrast);
      process.stdout.write(`${theme} disabled-ink audit ${JSON.stringify(measured)}\n`);
      expect(Object.keys(measured).length, `${theme} measured Copy, Add feature and Create`).toBeGreaterThanOrEqual(3);
      for (const [name, result] of Object.entries(measured)) {
        if (result.disabled) {
          expect(result.ratio, `${theme} disabled ${name} is legible`).toBeGreaterThanOrEqual(3);
          expect(result.ratio, `${theme} disabled ${name} is dimmer than an enabled label`).toBeLessThan(4.5);
        } else {
          expect(result.ratio, `${theme} enabled ${name}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

// The label ink of each visible button under `root` against what is painted behind it, with
// every background, colour alpha and opacity group from the label up to the page composited as
// the screen does: each element's content is drawn over its own background, then faded by its
// opacity. Self-contained, because Playwright runs it in the page.
function labelContrast(root: Element) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const rasterize = (value: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top: number[], bottom: number[]) => {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    if (alpha === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha).concat(alpha);
  };
  const flatten = (start: number[], leaf: Element) => {
    let layer = start;
    for (let element: Element | null = leaf; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      layer = over(layer, rasterize(style.backgroundColor));
      layer = [layer[0], layer[1], layer[2], layer[3] * Number(style.opacity)];
    }
    return over(layer, [255, 255, 255, 1]);
  };
  const linear = (channel: number) => {
    const n = channel / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (p: number[]) => 0.2126 * linear(p[0]) + 0.7152 * linear(p[1]) + 0.0722 * linear(p[2]);
  const result: Record<string, { ratio: number; disabled: boolean }> = {};
  for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
    if (!button.checkVisibility()) continue;
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.textContent?.trim() && node.parentElement?.checkVisibility({ visibilityProperty: true })
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP),
    });
    const text = walker.nextNode();
    if (!text?.parentElement) continue;
    const leaf = text.parentElement;
    const ink = flatten(rasterize(getComputedStyle(leaf).color), leaf);
    const backdrop = flatten([0, 0, 0, 0], leaf);
    const a = luminance(ink);
    const b = luminance(backdrop);
    result[text.textContent!.trim()] = {
      ratio: Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2)),
      disabled: button.disabled,
    };
  }
  return result;
}

// Colours ease for 120ms on many controls, so a measurement taken in the same task as the theme
// switch reads a blend of the old and new palettes. Wait for every running transition to end.
async function applyTheme(page: Page, theme: ThemeName) {
  await page.evaluate(async (nextTheme) => {
    document.documentElement.dataset.theme = nextTheme;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  }, theme);
}

async function installControlFixtures(page: Page) {
  await page.evaluate(() => {
    const existing = document.querySelector('[data-a11y-fixtures]');
    existing?.remove();

    const host = document.createElement('div');
    host.dataset.a11yFixtures = '';
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.zIndex = '-1';
    host.style.pointerEvents = 'none';
    document.body.append(host);

    const add = (
      name: string,
      tag: 'button' | 'div' | 'input' | 'label' | 'select' | 'textarea',
      className: string,
      surfaceClass = '',
      intermediateClass = '',
    ) => {
      const surface = document.createElement('div');
      surface.className = surfaceClass;
      surface.style.background = 'var(--bg-primary)';
      surface.style.padding = '8px';
      const parent = intermediateClass ? document.createElement('div') : surface;
      if (intermediateClass) {
        parent.className = intermediateClass;
        surface.append(parent);
      }
      const target = document.createElement(tag);
      target.className = className;
      target.dataset.a11yCase = name;
      if (target instanceof HTMLInputElement) target.type = name === 'color-field' ? 'color' : 'text';
      if (target instanceof HTMLSelectElement) {
        const option = document.createElement('option');
        option.textContent = 'Option';
        target.append(option);
      } else {
        target.textContent = name;
      }
      parent.append(target);
      host.append(surface);
    };

    add('icon-button', 'button', 'motif-cs-icon-button');
    add('input', 'input', 'motif-cs-input');
    add('field', 'input', 'motif-cs-field');
    add('textarea', 'textarea', 'motif-cs-textarea');
    add('color-field', 'input', 'motif-cs-color-field');
    add('mini-button', 'button', 'motif-cs-mini-button');
    add('gel-option', 'label', '', 'motif-cs-gel-ladder-picker', 'motif-cs-segmented');
    add('assembly-input', 'input', '', 'motif-cs-assembly-workspace');
    add('msa-select', 'select', '', 'motif-cs-msa-alignment-picker');
    add('msa-coordinate-select', 'select', '', 'motif-cs-msa-coordinate-system');
    add('segmented-control', 'div', 'motif-cs-segmented');
  });
}

const borderlessCases = ['icon-button', 'mini-button'];

type BorderlessMeasurement = {
  rest: number[];
  hover: number[];
  labelOnRest: number;
  ringOnBackdrop: number;
  ringStyle: string;
};

// Composites each borderless fixture's fill over its opaque backdrop at rest, under a
// forced :hover and under a forced :focus-visible (DevTools protocol pseudo-state).
async function measureBorderlessButtons(page: Page): Promise<Record<string, BorderlessMeasurement>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const read = (name: string) => page.evaluate((caseName) => {
    const element = document.querySelector<HTMLElement>(`[data-a11y-case="${caseName}"]`);
    if (!element) throw new Error(`Missing fixture ${caseName}`);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const paint = (...layers: string[]) => {
      context.clearRect(0, 0, 1, 1);
      for (const layer of layers) {
        context.fillStyle = layer;
        context.fillRect(0, 0, 1, 1);
      }
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    let backdrop = getComputedStyle(document.documentElement).backgroundColor;
    for (let current = element.parentElement; current; current = current.parentElement) {
      const value = getComputedStyle(current).backgroundColor;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      if (context.getImageData(0, 0, 1, 1).data[3] === 255) { backdrop = value; break; }
    }
    const style = getComputedStyle(element);
    return {
      backdrop: paint(backdrop),
      fill: paint(backdrop, style.backgroundColor),
      label: paint(backdrop, style.backgroundColor, style.color),
      ring: paint(backdrop, style.outlineColor),
      ringStyle: style.outlineStyle,
    };
  }, name);
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (c: number[]) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
  const contrast = (a: number[], b: number[]) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
  };
  const out: Record<string, BorderlessMeasurement> = {};
  for (const name of borderlessCases) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-a11y-case="${name}"]` });
    const rest = await read(name);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    await page.waitForTimeout(250);
    const hover = await read(name);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });
    await page.waitForTimeout(250);
    const focus = await read(name);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    await page.waitForTimeout(250);
    out[name] = {
      rest: rest.fill,
      hover: hover.fill,
      labelOnRest: contrast(rest.label, rest.fill),
      ringOnBackdrop: contrast(focus.ring, focus.backdrop),
      ringStyle: focus.ringStyle,
    };
  }
  await cdp.detach();
  return out;
}

async function measureControlFixtures(page: Page): Promise<Record<string, RatioMeasurement>> {
  return page.evaluate(() => {
    const rasterize = (value: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('A 2D canvas context is required for contrast measurement.');
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data] as [number, number, number, number];
    };
    const linear = (channel: number) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const contrast = (left: [number, number, number, number], right: [number, number, number, number]) => {
      const leftLuminance = 0.2126 * linear(left[0]) + 0.7152 * linear(left[1]) + 0.0722 * linear(left[2]);
      const rightLuminance = 0.2126 * linear(right[0]) + 0.7152 * linear(right[1]) + 0.0722 * linear(right[2]);
      return (Math.max(leftLuminance, rightLuminance) + 0.05)
        / (Math.min(leftLuminance, rightLuminance) + 0.05);
    };
    const opaqueBackground = (element: Element) => {
      let current: Element | null = element.parentElement;
      while (current) {
        const value = getComputedStyle(current).backgroundColor;
        if (rasterize(value)[3] === 255) return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    };

    const subtle = getComputedStyle(document.documentElement).getPropertyValue('--border-subtle').trim();
    return Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-a11y-case]')].map((element) => {
      const style = getComputedStyle(element);
      const outside = opaqueBackground(element);
      return [element.dataset.a11yCase!, {
        after: Number(contrast(rasterize(style.borderTopColor), rasterize(outside)).toFixed(2)),
        before: Number(contrast(rasterize(subtle), rasterize(outside)).toFixed(2)),
        border: style.borderTopColor,
        outside,
      }];
    }));
  });
}

async function measureTitleFocus(page: Page, theme: ThemeName, forcedColors: 'active' | 'none' = 'none') {
  await page.emulateMedia({ forcedColors });
  await applyTheme(page, theme);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const title = page.locator('.motif-cs-title-edit-trigger').first();
  await title.scrollIntoViewIfNeeded();
  const box = await title.boundingBox();
  if (!box) throw new Error('The record title button does not have a box.');
  const clip = {
    x: Math.max(0, box.x - 6),
    y: Math.max(0, box.y - 6),
    width: Math.min(1440 - Math.max(0, box.x - 6), box.width + 12),
    height: Math.min(900 - Math.max(0, box.y - 6), box.height + 12),
  };
  const before = await page.screenshot({ clip });

  let reachedTitle = false;
  for (let step = 0; step < 100; step += 1) {
    await page.keyboard.press('Tab');
    reachedTitle = await title.evaluate((element) => document.activeElement === element);
    if (reachedTitle) break;
  }
  expect(reachedTitle, `${theme} title keyboard reachability`).toBe(true);
  const after = await page.screenshot({ clip });

  const styleMeasurement = await title.evaluate((element) => {
    const rasterize = (value: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('A 2D canvas context is required for contrast measurement.');
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data] as [number, number, number, number];
    };
    const linear = (channel: number) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const contrast = (left: [number, number, number, number], right: [number, number, number, number]) => {
      const leftLuminance = 0.2126 * linear(left[0]) + 0.7152 * linear(left[1]) + 0.0722 * linear(left[2]);
      const rightLuminance = 0.2126 * linear(right[0]) + 0.7152 * linear(right[1]) + 0.0722 * linear(right[2]);
      return (Math.max(leftLuminance, rightLuminance) + 0.05)
        / (Math.min(leftLuminance, rightLuminance) + 0.05);
    };
    let current: Element | null = element.parentElement;
    let adjacent = getComputedStyle(document.documentElement).backgroundColor;
    while (current) {
      const candidate = getComputedStyle(current).backgroundColor;
      if (rasterize(candidate)[3] === 255) {
        adjacent = candidate;
        break;
      }
      current = current.parentElement;
    }
    const style = getComputedStyle(element);
    const ratio = Number(contrast(rasterize(style.outlineColor), rasterize(adjacent)).toFixed(2));
    return {
      adjacent,
      matchesFocusVisible: element.matches(':focus-visible'),
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      ratioAgainstAdjacent: ratio,
      ratioAgainstUnfocused: ratio,
    };
  });
  const changedPixels = await countChangedPixels(page, before.toString('base64'), after.toString('base64'));
  return { ...styleMeasurement, changedPixels };
}

async function countChangedPixels(page: Page, beforeBase64: string, afterBase64: string) {
  return page.evaluate(async ({ beforeSource, afterSource }) => {
    const decode = async (source: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('A 2D canvas context is required for focus measurement.');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const beforePixels = await decode(beforeSource);
    const afterPixels = await decode(afterSource);
    let changed = 0;
    for (let index = 0; index < beforePixels.length; index += 4) {
      if (
        beforePixels[index] !== afterPixels[index]
        || beforePixels[index + 1] !== afterPixels[index + 1]
        || beforePixels[index + 2] !== afterPixels[index + 2]
        || beforePixels[index + 3] !== afterPixels[index + 3]
      ) changed += 1;
    }
    return changed;
  }, { beforeSource: beforeBase64, afterSource: afterBase64 });
}
