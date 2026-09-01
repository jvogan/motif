import { describe, expect, it } from 'vitest';

import { defaultAlignmentWindowRect, defaultTranslationsWindowRect } from '../motif-artifact';

/**
 * Viewports this workspace is swept at, plus the two large displays the caps
 * exist for. A window default that ignores the screen reads as robust under a
 * width sweep precisely because it returns the same number six times.
 */
const SWEEP: ReadonlyArray<readonly [number, number]> = [
  [1100, 650],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1680, 1050],
  [1920, 1080],
];

/** Width the alignment window opened at before it took a viewport fraction. */
function previousAlignmentWidth(viewportWidth: number): number {
  return Math.min(940, Math.max(320, viewportWidth - 40));
}

describe('floating window defaults', () => {
  it('keeps the alignment window inside the viewport at every swept size', () => {
    // 400x300 and 320x400 are the sizes where the centred arithmetic above
    // clampWindowRect actually runs out of the viewport, so they are what makes
    // this a test of the clamp rather than of a rect that happened to fit.
    const sizes = [...SWEEP, [640, 480] as const, [2560, 1440] as const, [3840, 2160] as const, [400, 300] as const, [320, 400] as const];
    for (const [width, height] of sizes) {
      const rect = defaultAlignmentWindowRect(width, height);
      expect(rect.x, `${width}x${height} x`).toBeGreaterThanOrEqual(8);
      expect(rect.y, `${width}x${height} y`).toBeGreaterThanOrEqual(8);
      expect(rect.x + rect.w, `${width}x${height} right`).toBeLessThanOrEqual(width - 8);
      expect(rect.y + rect.h, `${width}x${height} bottom`).toBeLessThanOrEqual(height - 8);
    }
  });

  it('widens the alignment window as the viewport grows instead of repeating one number', () => {
    const widths = SWEEP.map(([width, height]) => defaultAlignmentWindowRect(width, height).w);
    expect(widths).toEqual([940, 967, 1034, 1092, 1279, 1466]);
    // The measured failure was six identical widths. Guard the property, not
    // only the numbers: every step up in viewport width must buy width back.
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i], `viewport ${SWEEP[i][0]} against ${SWEEP[i - 1][0]}`).toBeGreaterThan(widths[i - 1]);
    }
  });

  it('never opens the alignment window narrower than it used to', () => {
    for (let viewportWidth = 640; viewportWidth <= 3840; viewportWidth += 4) {
      const rect = defaultAlignmentWindowRect(viewportWidth, 900);
      const previous = Math.min(previousAlignmentWidth(viewportWidth), Math.max(280, viewportWidth - 16));
      expect(rect.w, `viewport width ${viewportWidth}`).toBeGreaterThanOrEqual(previous);
    }
  });

  it('leaves the alignment window untouched on screens with no width to spare', () => {
    for (const viewportWidth of [640, 800, 900, 1024, 1100, 1200, 1245]) {
      expect(defaultAlignmentWindowRect(viewportWidth, 900).w, `viewport width ${viewportWidth}`)
        .toBe(Math.min(previousAlignmentWidth(viewportWidth), Math.max(280, viewportWidth - 16)));
    }
  });

  it('stops the alignment window short of taking over a large display', () => {
    expect(defaultAlignmentWindowRect(2560, 1440).w).toBe(1480);
    expect(defaultAlignmentWindowRect(3840, 2160).w).toBe(1480);
    // 1,032px of workspace still shows beside it on a 2560px screen.
    expect(2560 - defaultAlignmentWindowRect(2560, 1440).w).toBeGreaterThanOrEqual(1000);
  });

  it('grows the translations window until its frames fit, then stops', () => {
    const heights = SWEEP.map(([width, height]) => defaultTranslationsWindowRect(width, height).h);
    expect(heights).toEqual([500, 570, 618, 680, 680, 680]);
    // 622px of frames plus 45px of window chrome. Below a 900px-tall viewport
    // the screen is the limit; at and above it the window shows all of them.
    for (const [width, height] of SWEEP) {
      if (height < 900) continue;
      expect(defaultTranslationsWindowRect(width, height).h, `${width}x${height}`).toBeGreaterThanOrEqual(667);
    }
  });

  it('keeps the translations window inside the viewport at every swept size', () => {
    const sizes = [...SWEEP, [640, 480] as const, [3840, 2160] as const, [400, 300] as const, [320, 400] as const];
    for (const [width, height] of sizes) {
      const rect = defaultTranslationsWindowRect(width, height);
      expect(rect.w, `${width}x${height} width`).toBe(Math.min(420, Math.max(280, width - 16)));
      expect(rect.x, `${width}x${height} x`).toBeGreaterThanOrEqual(8);
      expect(rect.x + rect.w, `${width}x${height} right`).toBeLessThanOrEqual(width - 8);
      expect(rect.y + rect.h, `${width}x${height} bottom`).toBeLessThanOrEqual(height - 8);
    }
  });

  it('places the translations window off the bottom edge instead of being clamped onto it', () => {
    // The y term has to follow the height the line above it just computed. If
    // it keeps the old constant, clampWindowRect still yields a legal rect —
    // one shoved flush against the viewport floor with an 8px gap.
    for (const [width, height] of SWEEP) {
      if (height < 900) continue;
      const rect = defaultTranslationsWindowRect(width, height);
      expect(height - (rect.y + rect.h), `${width}x${height} bottom gap`).toBeGreaterThanOrEqual(72);
    }
  });
});
