// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import '../../../artifacts/__tests__/motif-workbench-jsdom-setup';
import '../../../artifacts/motif-artifact';

async function loadMap() {
  await waitFor(() => expect(window.motifRenderInventory).toBeDefined());
  act(() => window.motifRenderInventory!([{
    id: 'map-gesture',
    name: 'Map gesture',
    molecule: 'dna',
    topology: 'linear',
    seq: 'ACGT'.repeat(40),
    annotations: [{ id: 'mark', name: 'Marker', type: 'misc_feature', start: 20, end: 50, strand: 1 }],
  }]));
  const feature = document.querySelector<SVGGElement>('.motif-pm-feature[data-feature-id="mark"]')!;
  const svg = feature.ownerSVGElement!;
  const surface = svg.closest<HTMLElement>('[data-map-interaction-surface]')!;
  const setPointerCapture = vi.fn();
  Object.defineProperties(surface, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: () => false },
  });
  Object.defineProperties(svg, {
    getScreenCTM: { configurable: true, value: () => ({ inverse: () => ({}) }) },
    createSVGPoint: {
      configurable: true,
      value: () => ({ x: 0, y: 0, matrixTransform() { return this; } }),
    },
  });
  return { feature, surface, setPointerCapture };
}

const press = { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1, clientX: 3, clientY: 60 };

it.each(['outside release', 'unpressed move', 'blur', 'lostpointercapture'])('disarms a map gesture on %s', async (ending) => {
  const { surface, setPointerCapture } = await loadMap();
  fireEvent.pointerDown(surface, press);
  expect(setPointerCapture).not.toHaveBeenCalled();
  if (ending === 'outside release') fireEvent.pointerUp(document.body, { ...press, buttons: 0 });
  else if (ending === 'unpressed move') fireEvent.pointerMove(surface, { ...press, buttons: 0, clientX: 80 });
  else if (ending === 'blur') fireEvent.blur(window);
  else {
    fireEvent.pointerMove(surface, { ...press, clientX: 90 });
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    setPointerCapture.mockClear();
    fireEvent.lostPointerCapture(surface, press);
  }
  // A new press can start outside the map and enter with the button held.
  // That move alone must never acquire capture for the old press.
  fireEvent.pointerDown(document.body, press);
  fireEvent.pointerMove(surface, { ...press, clientX: 100 });
  expect(setPointerCapture).not.toHaveBeenCalled();

  fireEvent.pointerDown(surface, press);
  fireEvent.pointerMove(surface, { ...press, clientX: 100 });
  expect(setPointerCapture).toHaveBeenCalledWith(1);
  fireEvent.pointerCancel(surface, press);
});

it('keeps a normal map feature click on its original target', async () => {
  const { feature, setPointerCapture } = await loadMap();
  expect(feature.getAttribute('aria-pressed')).toBe('false');
  fireEvent.pointerDown(feature, press);
  fireEvent.pointerUp(feature, { ...press, buttons: 0 });
  fireEvent.click(feature);
  expect(setPointerCapture).not.toHaveBeenCalled();
  expect(feature.getAttribute('aria-pressed')).toBe('true');
});

it('keeps a touch press armed when a contact move reports no button', async () => {
  const { surface, setPointerCapture } = await loadMap();
  const touch = { ...press, pointerType: 'touch' };
  fireEvent.pointerDown(surface, touch);
  fireEvent.pointerMove(surface, { ...touch, buttons: 0, clientX: 90 });
  expect(setPointerCapture).toHaveBeenCalledWith(1);
  fireEvent.pointerCancel(surface, touch);
});
