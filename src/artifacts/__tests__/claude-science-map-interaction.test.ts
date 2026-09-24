import { describe, expect, it } from 'vitest';
import { emptyProteinMapHint, mapClickPlacesPosition, mapWheelIntent, mapZoomHint } from '../motif-artifact';
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
});

describe('map wheel at Fit', () => {
  it('lets a plain wheel at Fit scroll the page instead of panning a map that is already in view', () => {
    expect(mapWheelIntent(1, false)).toBe('pass');
    // A clamp below Fit is still Fit.
    expect(mapWheelIntent(0.5, false)).toBe('pass');
    expect(mapWheelIntent(Number.NaN, false)).toBe('pass');
  });

  it('pans once zoomed and zooms on Ctrl or a pinch at any scale', () => {
    expect(mapWheelIntent(1.25, false)).toBe('pan');
    expect(mapWheelIntent(8, false)).toBe('pan');
    expect(mapWheelIntent(1, true)).toBe('zoom');
    expect(mapWheelIntent(3, true)).toBe('zoom');
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
    expect(emptyProteinMapHint('protein', 0)).toBe('No features yet · select residues, then + Feature');
  });

  it('says nothing once the protein has a feature, or for a nucleotide record', () => {
    expect(emptyProteinMapHint('protein', 1)).toBeNull();
    expect(emptyProteinMapHint('dna', 0)).toBeNull();
    expect(emptyProteinMapHint('rna', 0)).toBeNull();
  });
});
