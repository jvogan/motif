// @vitest-environment jsdom

/**
 * The map heading's control group. Before: Fit showed "Fit" and was named "Reset map
 * view", zoom out was an ASCII hyphen, neither zoom button had a tooltip, the line
 * drawing was a double arrow that read as "fit to width", and the sites toggle was
 * named "Hide restriction sites" while also reporting aria-pressed="true".
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
    restrictionSites: { visible: true, onChange: handlers.onSites },
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
  return [...host!.querySelectorAll<HTMLButtonElement>('.motif-cs-map-toolbar > button')];
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

  it('keeps the sites toggle one name and carries its state in aria-pressed', () => {
    const on = render({ restrictionSites: { visible: true, onChange: vi.fn() } });
    const sites = byName('Restriction sites');
    expect(sites.getAttribute('aria-pressed')).toBe('true');
    expect(sites.dataset.active).toBe('true');
    expect(sites.title).toBe('Show or hide all restriction sites on the map');

    const onSites = vi.fn();
    render({ restrictionSites: { visible: false, onChange: onSites } });
    const off = byName('Restriction sites');
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(off.dataset.active).toBeUndefined();
    click(off);
    expect(onSites).toHaveBeenCalledWith(true);
    expect(on.onSites).not.toHaveBeenCalled();
  });

  it('draws the line target as a backbone with two ends, not a double arrow', () => {
    const { onRenderMode } = render();
    const toLine = byName('Draw map as line');
    expect(toLine.querySelector('svg.lucide-linear-map')).not.toBeNull();
    expect(toLine.querySelector('svg.lucide-move-horizontal')).toBeNull();
    click(toLine);
    expect(onRenderMode).toHaveBeenCalledWith('linear');

    render({ renderMode: { current: 'linear', target: 'circular', canUseTarget: false, onChange: vi.fn() } });
    const toCircle = byName('Draw map as circle');
    expect(toCircle.querySelector('svg.lucide-circle')).not.toBeNull();
    expect(toCircle.disabled).toBe(true);
    expect(toCircle.title).toBe('A linear molecule has two ends and cannot be drawn as a circle');
  });

  it('disables what cannot act and leaves out the toggles a record cannot use', () => {
    const { onZoomIn } = render({ canZoomOut: false, canFit: false, renderMode: undefined, restrictionSites: undefined });
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom out', 'Fit map to pane', 'Zoom in']);
    expect(byName('Zoom out').disabled).toBe(true);
    expect(byName('Fit map to pane').disabled).toBe(true);
    click(byName('Zoom in'));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });
});
