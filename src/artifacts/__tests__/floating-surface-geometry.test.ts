import { describe, expect, it } from 'vitest';

import {
  clampFloatingSurfaceRect,
  moveFloatingSurfaceRect,
  resizeFloatingSurfaceRectFromBottomLeft,
  resizeFloatingSurfaceRectFromBottomRight,
  type FloatingSurfaceRect,
} from '../floating-surface-geometry';

const viewport = {
  width: 1_000,
  height: 700,
  insets: { top: 40, right: 60, bottom: 30, left: 20 },
};

describe('floating surface geometry', () => {
  it('clamps position and size against every viewport inset', () => {
    expect(clampFloatingSurfaceRect(
      { x: -100, y: -100, w: 1_200, h: 900 },
      viewport,
    )).toEqual({ x: 20, y: 40, w: 920, h: 630 });

    expect(moveFloatingSurfaceRect(
      { x: 300, y: 200, w: 320, h: 240 },
      { dx: 2_000, dy: 2_000 },
      viewport,
    )).toEqual({ x: 620, y: 430, w: 320, h: 240 });
  });

  it('shrinks effective minima to fit a narrow safe viewport', () => {
    expect(clampFloatingSurfaceRect(
      { x: 400, y: 300, w: 500, h: 400 },
      {
        width: 240,
        height: 170,
        insets: { top: 12, right: 18, bottom: 14, left: 16 },
      },
    )).toEqual({ x: 16, y: 12, w: 206, h: 144 });
  });

  it('grows leftward from the bottom-left while keeping the right edge anchored', () => {
    const before = { x: 500, y: 100, w: 320, h: 240 };
    const after = resizeFloatingSurfaceRectFromBottomLeft(
      before,
      { dx: -120, dy: 50 },
      viewport,
    );

    expect(after).toEqual({ x: 380, y: 100, w: 440, h: 290 });
    expect(after.x + after.w).toBe(before.x + before.w);
  });

  it('keeps bottom-left growth inside the left and bottom insets', () => {
    expect(resizeFloatingSurfaceRectFromBottomLeft(
      { x: 500, y: 100, w: 320, h: 240 },
      { dx: -1_000, dy: 1_000 },
      viewport,
    )).toEqual({ x: 20, y: 100, w: 800, h: 570 });
  });

  it('keeps the top-left corner anchored during bottom-right resizing', () => {
    expect(resizeFloatingSurfaceRectFromBottomRight(
      { x: 300, y: 200, w: 320, h: 240 },
      { dx: 800, dy: 800 },
      viewport,
    )).toEqual({ x: 300, y: 200, w: 640, h: 470 });
  });

  it('clamps stably without changing the preferred desktop rectangle', () => {
    const preferred: FloatingSurfaceRect = Object.freeze({ x: 620, y: 180, w: 520, h: 360 });
    const narrowViewport = {
      width: 420,
      height: 320,
      insets: { top: 24, right: 12, bottom: 12, left: 12 },
    };
    const narrow = clampFloatingSurfaceRect(preferred, narrowViewport);

    expect(narrow).toEqual({ x: 12, y: 24, w: 396, h: 284 });
    expect(clampFloatingSurfaceRect(narrow, narrowViewport)).toEqual(narrow);
    expect(preferred).toEqual({ x: 620, y: 180, w: 520, h: 360 });
    expect(clampFloatingSurfaceRect(preferred, {
      width: 1_400,
      height: 900,
      insets: { top: 8, right: 8, bottom: 8, left: 8 },
    })).toEqual(preferred);
  });
});
