import { describe, expect, it } from 'vitest';
import {
  contentPointFromRoot,
  mapContentPoint,
  mapRootPoint,
  rootPointFromContent,
  type MapPointTransform,
} from '../point-spaces';

// Real viewport states, taken from the measured investigation rather than
// invented: a pristine fit, a pan with the zoom badge still reading 100%, a zoom
// anchored on the ring centre, the reported off-centre zoom, and max zoom.
const VIEWPORTS: Array<{ name: string; transform: MapPointTransform }> = [
  { name: 'pristine fit', transform: { k: 1, tx: 0, ty: 0 } },
  { name: 'pan at fit', transform: { k: 1, tx: 0, ty: 57.2 } },
  { name: 'zoomed on the ring centre', transform: { k: 1.499, tx: -179.9, ty: -211.7 } },
  { name: 'zoomed off centre', transform: { k: 1.949, tx: -183.1, ty: -243.6 } },
  { name: 'max zoom', transform: { k: 8, tx: -1349.9, ty: -1796.3 } },
];

describe('map point spaces', () => {
  it('is the identity only at a pristine fit', () => {
    const point = mapRootPoint(600, 400);
    expect(contentPointFromRoot(point, { k: 1, tx: 0, ty: 0 })).toMatchObject({ x: 600, y: 400 });

    // A pan alone moves the point even though k is still 1 and the zoom badge
    // still reads 100%. This is the case that makes the bug look intermittent.
    expect(contentPointFromRoot(point, { k: 1, tx: 0, ty: 57.2 })).toMatchObject({ x: 600, y: 342.8 });
  });

  it.each(VIEWPORTS)('round-trips a point under $name', ({ transform }) => {
    const point = mapRootPoint(613.7, 402.1);
    const back = rootPointFromContent(contentPointFromRoot(point, transform), transform);
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it.each(VIEWPORTS)('round-trips the other direction under $name', ({ transform }) => {
    const point = mapContentPoint(360.5, 86.2);
    const back = contentPointFromRoot(rootPointFromContent(point, transform), transform);
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it('places a content point where the rendered transform would draw it', () => {
    // root = k * content + t, the same arithmetic the SVG group applies.
    const transform = { k: 1.949, tx: -183.1, ty: -243.6 };
    expect(rootPointFromContent(mapContentPoint(360.5, 86.2), transform)).toMatchObject({
      x: (360.5 * 1.949) - 183.1,
      y: (86.2 * 1.949) - 243.6,
    });
  });

  it('falls back to the identity rather than producing Infinity or NaN', () => {
    for (const bad of [
      { k: 0, tx: 100, ty: 50 },
      { k: -2, tx: 0, ty: 0 },
      { k: Number.NaN, tx: Number.NaN, ty: Number.NaN },
      { k: Number.POSITIVE_INFINITY, tx: 0, ty: 0 },
    ]) {
      expect(contentPointFromRoot(mapRootPoint(10, 10), bad)).toMatchObject({ x: 10, y: 10 });
      expect(rootPointFromContent(mapContentPoint(10, 10), bad)).toMatchObject({ x: 10, y: 10 });
    }
  });

  it('grows the error with the displacement of the origin, not with zoom alone', () => {
    // Zooming anchored exactly on a point leaves that point where it was, so an
    // unconverted click there stays correct however far you zoom in. That is why
    // "it only breaks when zoomed" was the wrong description of this defect.
    const anchor = mapContentPoint(360, 424);
    const k = 4;
    const anchored: MapPointTransform = { k, tx: anchor.x - (anchor.x * k), ty: anchor.y - (anchor.y * k) };
    const unconverted = rootPointFromContent(anchor, anchored);
    expect(unconverted.x).toBeCloseTo(anchor.x, 9);
    expect(unconverted.y).toBeCloseTo(anchor.y, 9);

    // Pan the same zoom and the identical click is now wrong by the pan.
    const panned: MapPointTransform = { ...anchored, ty: anchored.ty + 120 };
    expect(rootPointFromContent(anchor, panned).y).toBeCloseTo(anchor.y + 120, 9);
  });
});
