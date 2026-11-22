import { expect, test, type Page } from '@playwright/test';

/**
 * Hand panning, with real mouse, wheel and keyboard input: the wheel pans, the middle
 * button pans from anywhere, Space held turns a primary drag into a pan, and the
 * toolbar's hand toggle does the same while a plain click still selects. All of them
 * work at every zoom, Fit included, inside one clamp that keeps the ring's centre (or
 * the axis's middle) in the frame. Every drag starts on the ring or the axis, where a
 * primary drag selects a range.
 */
const artifactUrl = process.env.MOTIF_ARTIFACT_URL;
const DRAG = 60;

async function openMap(page: Page, mode: 'Circle' | 'Line', size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(artifactUrl!);
  await expect(page.locator('.motif-cs-shell')).toBeVisible();
  const record = page.locator('.motif-cs-record-tab').filter({ hasText: 'pUC19' }).first();
  if ((await record.getAttribute('data-active')) !== 'true') await record.click();
  const tools = page.getByRole('group', { name: 'Map view controls' });
  if (mode === 'Line') await tools.getByRole('button', { name: 'Line', exact: true }).click();
  await expect(page.locator(`.motif-cs-map-frame[data-map-mode="${mode === 'Line' ? 'linear' : 'circular'}"]`)).toBeVisible();
  return tools;
}

/** A point on the drawn ring or axis well inside the frame, and the drag toward the frame's middle. */
async function onSequence(page: Page) {
  return page.evaluate((drag) => {
    const frame = document.querySelector('.motif-cs-map-frame .motif-pm-container')!.getBoundingClientRect();
    const b = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
    const inside = (x: number, y: number) => x > frame.left + 110 && x < frame.right - 110 && y > frame.top + 90 && y < frame.bottom - 90;
    const toward = (x: number) => (x < frame.left + frame.width / 2 ? drag : -drag);
    if (b.height < 40) {
      const x = Math.max(frame.left + 120, Math.min(frame.right - 120, b.left + b.width / 2));
      return { x, y: b.top + b.height / 2, dx: toward(x) };
    }
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const r = b.width / 2;
    for (let a = 0; a < 360; a += 3) {
      const x = cx + r * Math.sin((a * Math.PI) / 180);
      const y = cy - r * Math.cos((a * Math.PI) / 180);
      if (inside(x, y)) return { x, y, dx: toward(x) };
    }
    throw new Error('no point of the ring is inside the frame');
  }, DRAG);
}

/** Where the drawing is, what is selected, and the cursor at a point. */
async function readMap(page: Page, at?: { x: number; y: number }) {
  return page.evaluate((point) => {
    const frame = document.querySelector('.motif-cs-map-frame')!;
    const box = frame.querySelector('.motif-pm-backbone')!.getBoundingClientRect();
    const el = point ? document.elementFromPoint(point.x, point.y) : null;
    return {
      x: box.left,
      y: box.top,
      selection: [...frame.querySelectorAll('.motif-pm-selection')].map((path) => path.getAttribute('d')).join('|'),
      pan: frame.getAttribute('data-map-pan'),
      cursor: el ? getComputedStyle(el).cursor : '',
    };
  }, at);
}

async function axisIntoView(page: Page) {
  for (let i = 0; i < 40; i += 1) {
    const gap = await page.evaluate(() => {
      const frame = document.querySelector('.motif-cs-map-frame .motif-pm-container')!.getBoundingClientRect();
      const b = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
      if (b.height >= 40) return { x: 0, y: 0, by: 0 };
      return { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2, by: b.top - (frame.top + frame.height / 2) };
    });
    if (Math.abs(gap.by) < 30) return;
    await page.mouse.move(gap.x, gap.y);
    await page.mouse.wheel(0, gap.by > 0 ? 25 : -25);
    await page.waitForTimeout(30);
  }
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, button: 'left' | 'middle' = 'left') {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from.x + (dx * step) / 10, from.y);
  await page.mouse.up({ button });
  // The click suppression after a drag lasts 120 ms.
  await page.waitForTimeout(160);
}

for (const mode of ['Circle', 'Line'] as const) {
  test.describe(`${mode} map hand panning`, () => {
    test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

    test('the middle button, Space and the hand toggle pan a zoomed map; at Fit none of them moves it', async ({ page }) => {
      const tools = await openMap(page, mode);
      const hand = tools.getByRole('button', { name: 'Pan by dragging' });
      await expect(hand).toBeEnabled();
      await tools.getByRole('button', { name: 'Zoom in' }).click();
      await tools.getByRole('button', { name: 'Zoom in' }).click();
      await expect(hand).toBeEnabled();
      // Zooming a line from its centre lifts the axis out of a 350px-tall frame; the
      // plain wheel, which pans a zoomed map, brings it back.
      await axisIntoView(page);
      await expect(hand).toHaveAttribute('aria-pressed', 'false');

      // A real selection to keep: a plain drag along the sequence.
      let p = await onSequence(page);
      await drag(page, p, p.dx / 2);
      const kept = (await readMap(page)).selection;
      expect(kept).not.toBe('');

      // Middle button: pans by the drag distance from on the sequence and keeps the selection.
      p = await onSequence(page);
      let before = await readMap(page);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down({ button: 'middle' });
      for (let step = 1; step <= 10; step += 1) await page.mouse.move(p.x + (p.dx * step) / 10, p.y);
      expect((await readMap(page)).pan).toBe('grabbing');
      await page.mouse.up({ button: 'middle' });
      await page.waitForTimeout(160);
      let after = await readMap(page);
      expect(Math.abs(after.x - before.x - p.dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
      expect(after.selection).toBe(kept);

      // Space held: the hand shows over the sequence and a primary drag pans.
      p = await onSequence(page);
      await page.mouse.move(p.x, p.y);
      await page.keyboard.down('Space');
      expect(await readMap(page, p)).toMatchObject({ pan: 'grab', cursor: 'grab' });
      before = await readMap(page);
      await drag(page, p, p.dx);
      after = await readMap(page);
      expect(Math.abs(after.x - before.x - p.dx)).toBeLessThanOrEqual(2);
      expect(after.selection).toBe(kept);
      await page.keyboard.up('Space');
      expect((await readMap(page, p)).pan).toBeNull();
      // Released, the same drag selects again and leaves the view where it is.
      p = await onSequence(page);
      before = await readMap(page);
      await drag(page, p, p.dx);
      after = await readMap(page);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
      expect(after.selection).not.toBe(kept);
      expect(after.selection).not.toBe('');
      const dragged = after.selection;

      // The hand toggle: a drag pans, a plain click still selects what is under it.
      await hand.click();
      await expect(hand).toHaveAttribute('aria-pressed', 'true');
      p = await onSequence(page);
      expect((await readMap(page, p)).cursor).toBe('grab');
      before = await readMap(page);
      await drag(page, p, p.dx);
      after = await readMap(page);
      expect(Math.abs(after.x - before.x - p.dx)).toBeLessThanOrEqual(2);
      expect(after.selection).toBe(dragged);
      p = await onSequence(page);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(160);
      const clicked = await readMap(page);
      expect(Math.abs(clicked.x - after.x)).toBeLessThanOrEqual(0.5);
      expect(clicked.selection).not.toBe(dragged);

      // At Fit the toggle stays on and enabled, shows its hand and still pans.
      await tools.getByRole('button', { name: 'Fit map to pane' }).click();
      await expect(hand).toBeEnabled();
      await expect(hand).toHaveAttribute('aria-pressed', 'true');
      p = await onSequence(page);
      before = await readMap(page, p);
      expect(before).toMatchObject({ pan: 'grab', cursor: 'grab' });
      await drag(page, p, p.dx, 'middle');
      after = await readMap(page);
      expect(Math.abs(after.x - before.x - p.dx)).toBeLessThanOrEqual(2);
      expect(after.selection).toBe(before.selection);
    });
  });
}

/** The visible frame (the drawing's box inside the map frame) and the point the clamp keeps in it. */
async function anchorInFrame(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.motif-cs-map-frame')!.getBoundingClientRect();
    const svg = document.querySelector('.motif-cs-map-frame svg.motif-plasmid-map')!.getBoundingClientRect();
    const b = document.querySelector('.motif-cs-map-frame .motif-pm-backbone')!.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    const left = Math.max(frame.left, svg.left);
    const right = Math.min(frame.right, svg.right);
    const top = Math.max(frame.top, svg.top);
    const bottom = Math.min(frame.bottom, svg.bottom);
    return { inside: x >= left - 1 && x <= right + 1 && y >= top - 1 && y <= bottom + 1, x, y, frame: [left, top, right, bottom] };
  });
}

for (const size of [{ width: 1440, height: 900 }, { width: 700, height: 860 }]) {
  for (const mode of ['Circle', 'Line'] as const) {
    test.describe(`${mode} map at ${size.width}x${size.height} from Fit`, () => {
      test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

      test('the wheel, middle button, Space and the hand toggle pan from Fit, and one clamp keeps the centre in the frame', async ({ page }) => {
        const tools = await openMap(page, mode, size);
        const fit = tools.getByRole('button', { name: 'Fit map to pane' });
        const hand = tools.getByRole('button', { name: 'Pan by dragging' });
        await expect(fit).toBeDisabled();
        const home = await readMap(page);
        const moved = async (from: { x: number; y: number }) => {
          const now = await readMap(page);
          return Math.hypot(now.x - from.x, now.y - from.y);
        };
        // Fit is enabled once the view leaves home, brings it home, and leaves focus on a map control.
        const backHome = async () => {
          await expect(fit).toBeEnabled();
          await fit.click();
          await expect(fit).toBeDisabled();
          expect(await moved(home)).toBeLessThanOrEqual(0.5);
          await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)).toBe('Zoom in');
        };

        // The wheel (a two-finger scroll is one) over the drawing.
        const middle = await page.evaluate(() => {
          const r = document.querySelector('.motif-cs-map-frame .motif-pm-container')!.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.mouse.move(middle.x, middle.y);
        await page.mouse.wheel(0, -60);
        await page.waitForTimeout(100);
        expect(await moved(home)).toBeGreaterThan(10);
        expect((await readMap(page)).selection).toBe(home.selection);
        await backHome();

        if (mode === 'Line') {
          // Below the Line view's drawing, still in the map frame.
          const below = await page.evaluate(() => {
            const svg = document.querySelector('.motif-cs-map-frame svg.motif-plasmid-map')!.getBoundingClientRect();
            const frame = document.querySelector('.motif-cs-map-frame')!.getBoundingClientRect();
            return { x: svg.left + svg.width / 2, y: (svg.bottom + frame.bottom) / 2, gap: frame.bottom - svg.bottom };
          });
          expect(below.gap).toBeGreaterThan(20);
          await page.mouse.move(below.x, below.y);
          await page.mouse.wheel(0, -60);
          await page.waitForTimeout(100);
          expect(await moved(home)).toBeGreaterThan(10);
          await backHome();
        }

        // The middle button, from on the sequence.
        let p = await onSequence(page);
        await drag(page, p, p.dx, 'middle');
        let after = await readMap(page);
        expect(Math.abs(after.x - home.x - p.dx)).toBeLessThanOrEqual(2);
        expect(after.selection).toBe(home.selection);
        await backHome();

        // Space held.
        p = await onSequence(page);
        await page.mouse.move(p.x, p.y);
        await page.keyboard.down('Space');
        expect(await readMap(page, p)).toMatchObject({ pan: 'grab', cursor: 'grab' });
        await drag(page, p, p.dx);
        await page.keyboard.up('Space');
        after = await readMap(page);
        expect(Math.abs(after.x - home.x - p.dx)).toBeLessThanOrEqual(2);
        expect(after.selection).toBe(home.selection);
        await backHome();

        // The hand toggle.
        await expect(hand).toBeEnabled();
        await hand.click();
        await expect(hand).toHaveAttribute('aria-pressed', 'true');
        p = await onSequence(page);
        await drag(page, p, p.dx);
        after = await readMap(page);
        expect(Math.abs(after.x - home.x - p.dx)).toBeLessThanOrEqual(2);
        await hand.click();
        await expect(hand).toHaveAttribute('aria-pressed', 'false');
        await backHome();

        // Oversized drags in each direction, with the middle button from the frame's middle,
        // never take the centre out of the frame.
        const { width, height } = size;
        for (const [tx, ty] of [[width - 2, height - 2], [2, 2], [width - 2, 2], [2, height - 2]]) {
          for (let i = 0; i < 3; i += 1) {
            await page.mouse.move(middle.x, middle.y);
            await page.mouse.down({ button: 'middle' });
            for (let step = 1; step <= 8; step += 1) await page.mouse.move(middle.x + ((tx - middle.x) * step) / 8, middle.y + ((ty - middle.y) * step) / 8);
            await page.mouse.up({ button: 'middle' });
          }
          await page.waitForTimeout(100);
          expect(await anchorInFrame(page), `after a drag toward ${tx},${ty}`).toMatchObject({ inside: true });
        }
        await backHome();

        if (mode === 'Circle') {
          // The plain drag on the empty background, far from the ring, is held by the same clamp.
          const corner = await page.evaluate(() => {
            const r = document.querySelector('.motif-cs-map-frame .motif-pm-container')!.getBoundingClientRect();
            return { x: r.left + 6, y: r.top + 6 };
          });
          for (let i = 0; i < 2; i += 1) {
            await page.mouse.move(corner.x, corner.y);
            await page.mouse.down();
            for (let step = 1; step <= 10; step += 1) await page.mouse.move(corner.x + ((width - 4 - corner.x) * step) / 10, corner.y + ((height - 4 - corner.y) * step) / 10);
            await page.mouse.up();
            await page.waitForTimeout(160);
          }
          expect(await moved(home)).toBeGreaterThan(10);
          expect(await anchorInFrame(page)).toMatchObject({ inside: true });
          await backHome();
        }

        // Focus on a control in another pane keeps Space for that control.
        const other = await page.evaluate(() => {
          const pane = document.querySelector('.motif-cs-map-frame')!.parentElement!;
          const button = [...document.querySelectorAll<HTMLButtonElement>('.motif-cs-shell button:not(:disabled)')]
            .find((el) => !pane.contains(el) && el.getBoundingClientRect().width > 0);
          button?.focus();
          return !!button && document.activeElement === button;
        });
        expect(other).toBe(true);
        await page.mouse.move(p.x, p.y);
        await page.keyboard.down('Space');
        expect((await readMap(page)).pan).toBeNull();
        // Blur before the release so the control is not pressed.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.up('Space');
      });
    });
  }
}

test.describe('Space and the sequence', () => {
  test.skip(!artifactUrl, 'Set MOTIF_ARTIFACT_URL to run the standalone artifact audit.');

  test('Space over a zoomed map belongs to the map, except while focus is in the sequence', async ({ page }) => {
    const tools = await openMap(page, 'Circle');
    await tools.getByRole('button', { name: 'Zoom in' }).click();
    const p = await onSequence(page);
    await page.evaluate(() => {
      const w = window as unknown as { spaceAtSequence: number };
      w.spaceAtSequence = 0;
      document.getElementById('motif-cs-sequence-view')!.addEventListener('keydown', (event) => {
        if (event.code === 'Space') w.spaceAtSequence += 1;
      });
    });
    const seen = () => page.evaluate(() => (window as unknown as { spaceAtSequence: number }).spaceAtSequence);

    // Focus elsewhere, pointer over the map: Space is the map's.
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down('Space');
    expect((await readMap(page)).pan).toBe('grab');
    await page.keyboard.up('Space');

    // Focus in the sequence, pointer still over the map: Space reaches the sequence.
    await page.locator('#motif-cs-sequence-view').focus();
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down('Space');
    expect((await readMap(page)).pan).toBeNull();
    await page.keyboard.up('Space');
    expect(await seen()).toBe(1);
  });
});
