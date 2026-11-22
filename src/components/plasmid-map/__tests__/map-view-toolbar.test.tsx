// @vitest-environment jsdom

/**
 * The map heading's control group. Every control is named with the words it shows:
 * Fit shows "Fit" and is named "Fit map to pane", zoom out and zoom in are icon buttons
 * with tooltips, the Circle and Line segments show words and report their drawing
 * through aria-pressed, and the Sites select shows its current choice (Unique, All,
 * None or Custom).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapViewToolbar, type MapViewToolbarProps } from '../MapViewToolbar';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(props: Partial<MapViewToolbarProps> = {}) {
  const handlers = {
    onZoomOut: vi.fn(),
    onFit: vi.fn(),
    onZoomIn: vi.fn(),
    onRenderMode: vi.fn(),
    onSites: vi.fn(),
  };
  const full: MapViewToolbarProps = {
    canZoomOut: true,
    canFit: true,
    canZoomIn: true,
    onZoomOut: handlers.onZoomOut,
    onFit: handlers.onFit,
    onZoomIn: handlers.onZoomIn,
    renderMode: { current: 'circular', target: 'linear', canUseTarget: true, onChange: handlers.onRenderMode },
    restrictionSites: { mode: 'unique', canShowUnique: true, onChange: handlers.onSites },
    ...props,
  };
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root!.render(<MapViewToolbar {...full} />));
  return handlers;
}

function buttons(): HTMLButtonElement[] {
  return [...host!.querySelectorAll<HTMLButtonElement>('.motif-cs-map-toolbar > button, .motif-cs-map-toolbar > .motif-cs-map-shape > button')];
}

function byName(name: string): HTMLButtonElement {
  const found = buttons().find((button) => button.getAttribute('aria-label') === name);
  expect(found, `no toolbar button named "${name}"`).toBeDefined();
  return found!;
}

function click(button: HTMLButtonElement) {
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('map view toolbar', () => {
  it('names every control with the words it shows', () => {
    render();
    // Zoom out, Fit, zoom in, and the Circle | Line pair.
    expect(buttons()).toHaveLength(5);
    for (const button of buttons()) {
      const shown = button.textContent!.trim();
      const name = button.getAttribute('aria-label')!;
      expect(name, `${button.className} has no accessible name`).toBeTruthy();
      if (shown) expect(name.toLowerCase(), `"${shown}" is not in its name "${name}"`).toContain(shown.toLowerCase());
    }
    const fit = host!.querySelector<HTMLButtonElement>('.motif-cs-map-reset')!;
    expect(fit.textContent).toBe('Fit');
    expect(fit.getAttribute('aria-label')).toBe('Fit map to pane');
  });

  it('draws both zoom glyphs as icons and gives each a tooltip with its key', () => {
    render();
    const zoomOut = byName('Zoom out');
    const zoomIn = byName('Zoom in');
    // A hyphen inked 4x3px beside a 8x7px "+": the two actions now share one icon set.
    expect(zoomOut.textContent).toBe('');
    expect(zoomOut.querySelector('svg.lucide-minus')).not.toBeNull();
    expect(zoomIn.textContent).toBe('');
    expect(zoomIn.querySelector('svg.lucide-plus')).not.toBeNull();
    expect(zoomOut.title).toBe('Zoom out (-)');
    expect(zoomIn.title).toBe('Zoom in (+)');
    expect(byName('Fit map to pane').title).toBe('Fit map to pane (0)');
  });

  it('offers Unique, All and None under one labeled Sites menu', () => {
    const on = render({ restrictionSites: { mode: 'unique', canShowUnique: true, onChange: vi.fn() } });
    const sites = host!.querySelector<HTMLSelectElement>('select.motif-cs-map-sites-toggle')!;
    expect(sites.getAttribute('aria-label')).toBe('Restriction sites');
    expect(sites.closest('label')!.textContent).toContain('Sites');
    expect([...sites.options].map((option) => option.text)).toEqual(['Unique', 'All', 'None']);
    expect(sites.value).toBe('unique');
    expect(sites.dataset.active).toBe('true');

    const onSites = vi.fn();
    render({ restrictionSites: { mode: 'none', canShowUnique: false, onChange: onSites } });
    const off = host!.querySelector<HTMLSelectElement>('select.motif-cs-map-sites-toggle')!;
    expect(off.value).toBe('none');
    expect(off.dataset.active).toBeUndefined();
    expect(off.options[0].disabled).toBe(true);
    act(() => {
      off.value = 'all';
      off.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSites).toHaveBeenCalledWith('all');
    expect(on.onSites).not.toHaveBeenCalled();

    render({ restrictionSites: { mode: 'custom', canShowUnique: true, onChange: vi.fn() } });
    const custom = host!.querySelector<HTMLSelectElement>('select.motif-cs-map-sites-toggle')!;
    expect(custom.value).toBe('custom');
    expect([...custom.options].map((option) => option.text)).toEqual(['Unique', 'All', 'None', 'Custom']);
  });

  it('shows the drawing as a pressed Circle or Line segment and switches on the other', () => {
    const { onRenderMode } = render();
    const group = document.querySelector('[role="group"][aria-label="Map shape"]');
    expect(group).not.toBeNull();
    const circle = byName('Circle');
    const line = byName('Line');
    expect(group!.contains(circle) && group!.contains(line)).toBe(true);
    expect(circle.getAttribute('aria-pressed')).toBe('true');
    expect(line.getAttribute('aria-pressed')).toBe('false');
    expect(circle.title).toBe('Map drawn as a circle');
    expect(line.title).toBe('Draw map as line');
    // The pressed segment is the drawing already on screen: pressing it writes nothing.
    click(circle);
    expect(onRenderMode).not.toHaveBeenCalled();
    click(line);
    expect(onRenderMode).toHaveBeenCalledWith('linear');
    expect(onRenderMode).toHaveBeenCalledTimes(1);

    render({ renderMode: { current: 'linear', target: 'circular', canUseTarget: false, onChange: vi.fn() } });
    expect(byName('Line').getAttribute('aria-pressed')).toBe('true');
    const toCircle = byName('Circle');
    expect(toCircle.getAttribute('aria-pressed')).toBe('false');
    expect(toCircle.disabled).toBe(true);
    expect(toCircle.title).toBe('A linear molecule has two ends and cannot be drawn as a circle; convert it in Record details to draw it as one');
  });

  it('disables what cannot act and leaves out the toggles a record cannot use', () => {
    const { onZoomIn } = render({ canZoomOut: false, canFit: false, renderMode: undefined, restrictionSites: undefined });
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom out', 'Fit map to pane', 'Zoom in']);
    expect(byName('Zoom out').disabled).toBe(true);
    expect(byName('Fit map to pane').disabled).toBe(true);
    // A disabled control says why, instead of naming a key that does nothing.
    expect(byName('Zoom out').title).toBe('The whole map is already in view');
    expect(byName('Fit map to pane').title).toBe('The map already fits the pane');
    expect(byName('Zoom in').title).toBe('Zoom in (+)');
    click(byName('Zoom in'));
    expect(onZoomIn).toHaveBeenCalledTimes(1);

    render({ canZoomIn: false });
    expect(byName('Zoom in').disabled).toBe(true);
    expect(byName('Zoom in').title).toBe('Zoomed in as far as the map goes');
  });
});
