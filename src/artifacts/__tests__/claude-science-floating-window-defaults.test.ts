import { describe, expect, it } from 'vitest';

import {
  defaultAlignmentWindowRect,
  defaultAssemblyWindowRect,
  defaultCloningDesignWindowRect,
  defaultConstructVerificationWindowRect,
  defaultGelWindowRect,
  defaultPrimerWindowRect,
  defaultToolWindowRect,
  defaultTranslationsWindowRect,
  sideWindowWidth,
  translationDockWidth,
} from '../motif-artifact';

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
    // A fixed width would repeat one number at every size. Guard the property, not
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

  it('grows the primer window with the screen instead of stopping at 720px', () => {
    const heights = SWEEP.map(([width, height]) => defaultPrimerWindowRect(width, height).h);
    // A 720px cap would leave 90-272px of height unused on the last three screens
    // while the selected pair's sequences sit below the fold. The window takes all
    // the room under the top edge, to the 1000px cap.
    expect(heights).toEqual([594, 664, 712, 844, 994, 1000]);
    // The right half of the screen, never under 560px: a 1120px window at 1440x900 would cover the whole Sequence.
    expect(SWEEP.map(([width, height]) => defaultPrimerWindowRect(width, height).w)).toEqual([560, 624, 667, 704, 824, 944]);
    expect(defaultPrimerWindowRect(2560, 1440).h).toBe(1000);
    for (const [width, height] of [...SWEEP, [640, 480] as const, [400, 300] as const]) {
      const rect = defaultPrimerWindowRect(width, height);
      expect(rect.y + rect.h, `${width}x${height} bottom`).toBeLessThanOrEqual(height - 8);
    }
  });

  it('opens the gel window taller where the screen has height for the plate', () => {
    const heights = SWEEP.map(([width, height]) => defaultGelWindowRect(width, height).h);
    // The plate takes the window's spare height, up to the workflow cap of 760px
    // that every workflow window shares.
    expect(heights).toEqual([594, 664, 712, 760, 760, 760]);
    expect(defaultGelWindowRect(2560, 1440).h).toBe(760);
    for (const [width, height] of [...SWEEP, [640, 480] as const, [400, 300] as const]) {
      const rect = defaultGelWindowRect(width, height);
      expect(rect.y + rect.h, `${width}x${height} bottom`).toBeLessThanOrEqual(height - 8);
    }
  });

  it('grows the translations window until its frames fit, then stops', () => {
    const heights = SWEEP.map(([width, height]) => defaultTranslationsWindowRect(width, height).h);
    expect(heights).toEqual([594, 664, 680, 680, 680, 680]);
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
      // From 1280 to 1535px the window docks and takes the Tools drawer's 320px.
      const docks = width >= 1280 && width <= 1535;
      expect(rect.w, `${width}x${height} width`).toBe(docks ? 320 : Math.min(420, Math.max(280, width - 16)));
      expect(rect.x, `${width}x${height} x`).toBeGreaterThanOrEqual(8);
      expect(rect.x + rect.w, `${width}x${height} right`).toBeLessThanOrEqual(width - 8);
      expect(rect.y + rect.h, `${width}x${height} bottom`).toBeLessThanOrEqual(height - 8);
    }
  });

  it('places the translations window off the bottom edge instead of being clamped onto it', () => {
    // The y term has to follow the height the line above it just computed. If
    // it keeps a constant, clampWindowRect still yields a legal rect —
    // one shoved flush against the viewport floor with an 8px gap.
    for (const [width, height] of SWEEP) {
      if (height < 900) continue;
      const rect = defaultTranslationsWindowRect(width, height);
      expect(height - (rect.y + rect.h), `${width}x${height} bottom gap`).toBeGreaterThanOrEqual(72);
    }
  });
});

/** Every tool window, by the default each one opens with. */
const WINDOWS = {
  translation: defaultTranslationsWindowRect,
  alignment: defaultAlignmentWindowRect,
  gel: defaultGelWindowRect,
  assembly: defaultAssemblyWindowRect,
  primer: defaultPrimerWindowRect,
  cloningDesign: defaultCloningDesignWindowRect,
  verification: defaultConstructVerificationWindowRect,
} as const;

/** The 40px top bar and an 8px gap. */
const TOP_EDGE = 48;
const SIZES: ReadonlyArray<readonly [number, number]> = [
  ...SWEEP, [700, 860], [1040, 860], [640, 480], [2560, 1440], [400, 300], [320, 400],
];

describe('one placement rule for every tool window', () => {
  it('opens all seven on the same top edge, clear of the top bar', () => {
    // One shared top edge keeps every window clear of the top bar's Tools and Translation
    // buttons, even on a short screen.
    for (const [width, height] of SIZES) {
      for (const [name, open] of Object.entries(WINDOWS)) {
        expect(open(width, height).y, `${name} at ${width}x${height}`).toBe(TOP_EDGE);
      }
    }
  });

  it('never opens past an edge of the viewport', () => {
    for (const [width, height] of SIZES) {
      for (const [name, open] of Object.entries(WINDOWS)) {
        const rect = open(width, height);
        expect(rect.x, `${name} at ${width}x${height} left`).toBeGreaterThanOrEqual(8);
        expect(rect.x + rect.w, `${name} at ${width}x${height} right`).toBeLessThanOrEqual(width - 8);
        expect(rect.y + rect.h, `${name} at ${width}x${height} bottom`).toBeLessThanOrEqual(height - 8);
      }
    }
  });

  it('gives the six workflow windows one height, and lets only the primer window outgrow it', () => {
    for (const [width, height] of SIZES) {
      const heights = [
        defaultAlignmentWindowRect, defaultGelWindowRect, defaultAssemblyWindowRect,
        defaultCloningDesignWindowRect, defaultConstructVerificationWindowRect,
      ].map((open) => open(width, height).h);
      expect(new Set(heights).size, `${width}x${height}: ${heights.join(', ')}`).toBe(1);
      expect(defaultPrimerWindowRect(width, height).h, `${width}x${height} primer`).toBeGreaterThanOrEqual(heights[0]);
    }
    expect(defaultAssemblyWindowRect(1440, 900).h).toBe(760);
    expect(defaultAssemblyWindowRect(1440, 700).h).toBe(644);
  });

  it('opens the translations window against the right edge, where the Sequence pane stays uncovered', () => {
    // Against the right edge the window leaves the Sequence pane, and the find bar's
    // Previous, Next and Done controls, uncovered.
    expect(defaultTranslationsWindowRect(1040, 860).x).toBe(604);
    for (const [width, height] of SWEEP) {
      const rect = defaultTranslationsWindowRect(width, height);
      expect(width - (rect.x + rect.w), `${width}x${height}`).toBe(16);
    }
    // Beside a pinned 260px Tools pane, not over it.
    expect(defaultTranslationsWindowRect(1440, 900, 260).x + 320).toBe(1440 - 260 - 16);
    expect(defaultTranslationsWindowRect(1680, 1050, 260).x + 420).toBe(1680 - 260 - 16);
  });

  it('docks the translations window at the drawer width and leaves the panes their side-by-side width', () => {
    // From 1280px the docked window takes 320px, which leaves the panes at least 904px so the map stays on its row.
    for (let width = 1280; width <= 1535; width += 1) {
      const dock = translationDockWidth(width);
      expect(dock, `${width}`).toBe(320);
      expect(width - dock - 24, `${width} panes`).toBeGreaterThanOrEqual(904);
      expect(defaultTranslationsWindowRect(width, 900).w, `${width}`).toBe(dock);
    }
  });

  it('opens the workflow windows in the right half from 900px up, so the Sequence stays in view', () => {
    const sideWindows = [
      defaultPrimerWindowRect, defaultGelWindowRect, defaultAssemblyWindowRect,
      defaultCloningDesignWindowRect, defaultConstructVerificationWindowRect,
    ];
    for (const [width, height] of [...SWEEP, [900, 700] as const, [1040, 860] as const, [2560, 1440] as const]) {
      for (const open of sideWindows) {
        const rect = open(width, height);
        expect(rect.w, `${open.name} at ${width}x${height}`).toBeLessThanOrEqual(sideWindowWidth(width));
        expect(width - (rect.x + rect.w), `${open.name} at ${width}x${height} right gap`).toBe(16);
      }
      // The alignment keeps its width, for its columns, and stays centred: against the
      // right edge it would cover the pinned Tools pane and the Map's collapse control.
      const alignment = defaultAlignmentWindowRect(width, height);
      expect(Math.abs(alignment.x - (width - (alignment.x + alignment.w))), `alignment at ${width}x${height} centred`).toBeLessThanOrEqual(1);
    }
    expect([1280, 1440, 1920].map(sideWindowWidth)).toEqual([624, 704, 944]);
    // Below 900px the stylesheet draws them as a bottom sheet; the stored rect stays centred.
    expect(defaultPrimerWindowRect(700, 860).x).toBe(20);
  });

  it('centres a window of any width and keeps the helper pure', () => {
    expect(defaultToolWindowRect({ w: 600, h: 500 }, 1000, 800)).toEqual({ x: 200, y: TOP_EDGE, w: 600, h: 500 });
    expect(defaultToolWindowRect({ w: 600, h: 900 }, 1000, 800)).toEqual({ x: 200, y: TOP_EDGE, w: 600, h: 744 });
  });
});
