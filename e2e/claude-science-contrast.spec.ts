import { expect, test, type Page } from '@playwright/test';

const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const themes = ['light', 'dark', 'claude-light', 'claude-dark'] as const;

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
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      const measurements = await measureControlFixtures(page);
      process.stdout.write(`${theme} control contrast ${JSON.stringify(measurements)}\n`);
      for (const [name, measurement] of Object.entries(measurements)) {
        expect(measurement.after, `${theme} ${name}`).toBeGreaterThanOrEqual(3);
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

    add('theme-picker-select', 'select', '', 'motif-cs-theme-picker');
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
  await page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme;
    (document.activeElement as HTMLElement | null)?.blur();
  }, theme);

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
