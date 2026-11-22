import { describe, expect, it } from 'vitest';
import { clampMapViewport, emptyProteinMapHint, mapClickPlacesPosition, mapHandPanCursor, mapPointerActionAtPoint, mapWheelIntent, mapZoomHint } from '../motif-artifact';
import { computeMapLayout } from '../../plasmid-map/layout';
import { mapContentPoint } from '../../plasmid-map/point-spaces';

describe('a click inside the ring', () => {
  const ring = computeMapLayout({
    mode: 'circular',
    name: 'click fixture',
    length: 3000,
    topology: 'circular',
    sequenceType: 'dna',
    features: [],
    restrictionSites: [],
    width: 600,
    height: 600,
  });
  const at = (radius: number, degrees = 90) => mapContentPoint(
    ring.center.x + Math.sin((degrees * Math.PI) / 180) * radius,
    ring.center.y - Math.cos((degrees * Math.PI) / 180) * radius,
  );

  it('places a position only on the backbone band', () => {
    // The band is 0.14 R either side of the backbone here (inside the 18-34 clamp):
    // 32.76 units on this 234-unit ring.
    expect(ring.radius).toBe(234);
    expect(mapClickPlacesPosition(at(ring.radius), ring, 1)).toBe(true);
    expect(mapClickPlacesPosition(at(ring.radius - 32), ring, 1)).toBe(true);
    expect(mapClickPlacesPosition(at(ring.radius + 32, 200), ring, 1)).toBe(true);
    // The name at the centre, and the empty disc between it and the lanes.
    expect(mapClickPlacesPosition(at(0), ring, 1)).toBe(false);
    expect(mapClickPlacesPosition(at(ring.radius * 0.4, 270), ring, 1)).toBe(false);
    expect(mapClickPlacesPosition(at(ring.radius - 34), ring, 1)).toBe(false);
  });

  it('keeps the band a screen-sized strip as the map zooms', () => {
    expect(mapClickPlacesPosition(at(ring.radius - 20), ring, 1)).toBe(true);
    expect(mapClickPlacesPosition(at(ring.radius - 20), ring, 4)).toBe(false);
  });

  it('leaves the linear axis band as it was', () => {
    const line = computeMapLayout({
      mode: 'linear',
      name: 'click fixture',
      length: 3000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [],
      restrictionSites: [],
      width: 1000,
      height: 420,
    });
    expect(mapClickPlacesPosition(mapContentPoint(line.center.x + 100, line.center.y), line, 1)).toBe(true);
  });

  it('makes the whole Line drawing drag space, while a click off the axis band places nothing', () => {
    const line = computeMapLayout({
      mode: 'linear',
      name: 'drag fixture',
      length: 3000,
      topology: 'linear',
      sequenceType: 'dna',
      features: [],
      restrictionSites: [],
      width: 1000,
      height: 420,
    });
    const axis = line.linearAxis!;
    const blank = [
      mapContentPoint(axis.startX + 200, line.bg.y + line.bg.height - 4),
      mapContentPoint(axis.startX + 200, line.bg.y + 4),
      mapContentPoint(line.bg.x + 2, axis.y + 120),
    ];
    for (const zoom of [1, 2, 4, 8]) {
      for (const point of blank) expect(mapPointerActionAtPoint(point, line, zoom)).toBe('range');
      expect(mapClickPlacesPosition(blank[1], line, zoom)).toBe(false);
    }
  });
});

describe('map wheel', () => {
  it('pans the map on a plain wheel or two-finger scroll at every zoom, Fit included', () => {
    expect(mapWheelIntent(false)).toBe('pan');
  });

  it('zooms on Ctrl, Command or a pinch', () => {
    expect(mapWheelIntent(true)).toBe('zoom');
  });

  it('prints a zoom percentage only while the map is scaled', () => {
    expect(mapZoomHint(1)).toBeNull();
    expect(mapZoomHint(1.00001)).toBeNull();
    expect(mapZoomHint(1.5625)).toBe('156%');
    expect(mapZoomHint(8)).toBe('800%');
  });
});

describe('emptyProteinMapHint', () => {
  it('tells the reader how to fill a protein map that has no features', () => {
    expect(emptyProteinMapHint('protein', 0)).toBe('No features yet · select residues, then Add feature');
  });

  it('says nothing once the protein has a feature, or for a nucleotide record', () => {
    expect(emptyProteinMapHint('protein', 1)).toBeNull();
    expect(emptyProteinMapHint('dna', 0)).toBeNull();
    expect(emptyProteinMapHint('rna', 0)).toBeNull();
  });
});

describe('hand pan grab cursor', () => {
  it('shows the grab cursor whenever a drag pans, at every zoom', () => {
    // Not armed: the primary drag selects, so no hand.
    expect(mapHandPanCursor(false, false)).toBeUndefined();
    // Space held or the hand toggle on: a hand, Fit included.
    expect(mapHandPanCursor(true, false)).toBe('grab');
    // A pan in progress (a middle-button drag is one, armed or not) grabs.
    expect(mapHandPanCursor(false, true)).toBe('grabbing');
    expect(mapHandPanCursor(true, true)).toBe('grabbing');
  });
});

describe('the one pan clamp', () => {
  // A 600x500 frame whose ring centre sits at its middle, and a Line axis near its top.
  const frame = { x: 0, y: 0, width: 600, height: 500 };
  const ring = { x: 300, y: 250 };

  it('keeps the ring centre inside the frame at Fit however far a drag goes', () => {
    for (const [tx, ty] of [[5000, 5000], [-5000, -5000], [5000, -5000], [-5000, 5000]]) {
      const v = clampMapViewport({ k: 1, tx, ty }, frame, ring);
      const cx = ring.x * v.k + v.tx;
      const cy = ring.y * v.k + v.ty;
      expect(cx).toBeGreaterThanOrEqual(frame.x);
      expect(cx).toBeLessThanOrEqual(frame.x + frame.width);
      expect(cy).toBeGreaterThanOrEqual(frame.y);
      expect(cy).toBeLessThanOrEqual(frame.y + frame.height);
    }
    // A clamp that stopped a Fit drag at 24% of the frame would be too tight; the centre reaches the edge.
    expect(clampMapViewport({ k: 1, tx: 5000, ty: 0 }, frame, ring).tx).toBe(300);
  });

  it('is exactly home at Fit with no offset', () => {
    expect(clampMapViewport({ k: 1, tx: 0.001, ty: -0.001 }, frame, ring)).toEqual({ k: 1, tx: 0, ty: 0 });
  });

  it('lets a zoomed frame reach every edge of what showed at Fit', () => {
    const k = 8;
    // The frame's left edge shows content x = 0, and its right edge content x = 600.
    expect(clampMapViewport({ k, tx: 5000, ty: 0 }, frame, ring).tx).toBeGreaterThanOrEqual(0);
    expect(clampMapViewport({ k, tx: -50000, ty: 0 }, frame, ring).tx).toBeLessThanOrEqual(600 - 600 * k);
    // A Line axis near the top: the rows at the bottom of the drawing stay reachable.
    const axis = { x: 300, y: 24 };
    expect(clampMapViewport({ k, tx: 0, ty: -50000 }, frame, axis).ty).toBeLessThanOrEqual(500 - 500 * k);
    expect(clampMapViewport({ k, tx: 0, ty: 50000 }, frame, axis).ty).toBeGreaterThanOrEqual(0);
  });
});
