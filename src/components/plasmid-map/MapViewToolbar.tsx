/**
 * The map pane's view controls: zoom out, Fit, zoom in, then the circle/line
 * drawing toggle on a nucleotide record and the restriction-site layer toggle on
 * DNA. The pane heading styles the group by its class names; the host owns every
 * piece of state the group reads and every action it takes.
 *
 * Each control's accessible name holds the word it shows (WCAG 2.5.3): "Fit" is
 * named "Fit map to pane", not "Reset map view". A toggle keeps one name and
 * carries its state in `aria-pressed`, so a screen reader never hears "Hide
 * restriction sites, pressed" for a layer that is on.
 */
import { Circle, Minus, Plus, Scissors, createLucideIcon } from 'lucide-react';
import type { MapMode } from '../../plasmid-map/types';

/**
 * A backbone with two ends, the linear counterpart of the ring the circle icon
 * draws. The double arrow it replaces read as "fit to width", and a bare line
 * would look like the zoom-out minus two buttons to its left.
 */
const LinearMapIcon = createLucideIcon('linear-map', [
  ['path', { d: 'M3 12h18', key: 'backbone' }],
  ['path', { d: 'M3 7.5v9', key: 'left-end' }],
  ['path', { d: 'M21 7.5v9', key: 'right-end' }],
]);

export interface MapViewToolbarProps {
  canZoomOut: boolean;
  canFit: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  /** Present on a nucleotide record. `target` is the drawing a press switches to. */
  renderMode?: {
    current: MapMode;
    target: MapMode;
    canUseTarget: boolean;
    onChange: (mode: MapMode) => void;
  };
  /** Present on a DNA record: the whole restriction-site layer, ticks and labels. */
  restrictionSites?: {
    visible: boolean;
    onChange: (visible: boolean) => void;
  };
}

export function MapViewToolbar({
  canZoomOut,
  canFit,
  canZoomIn,
  onZoomOut,
  onFit,
  onZoomIn,
  renderMode,
  restrictionSites,
}: MapViewToolbarProps) {
  return (
    <div className="motif-cs-map-toolbar" role="group" aria-label="Map view controls">
      {/* The titles name the keys the document already binds: +/= zooms in, -/_
          zooms out and 0 fits, whenever focus is outside a form field. */}
      <button className="motif-cs-map-button" type="button" onClick={onZoomOut} disabled={!canZoomOut} aria-label="Zoom out" title="Zoom out (-)">
        <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <button
        className="motif-cs-map-button motif-cs-map-reset"
        type="button"
        onClick={onFit}
        disabled={!canFit}
        aria-label="Fit map to pane"
        title="Fit map to pane (0)"
      >
        Fit
      </button>
      <button className="motif-cs-map-button" type="button" onClick={onZoomIn} disabled={!canZoomIn} aria-label="Zoom in" title="Zoom in (+)">
        <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {renderMode ? (
        <button
          className="motif-cs-map-button motif-cs-map-mode-toggle"
          type="button"
          data-current-mode={renderMode.current}
          disabled={!renderMode.canUseTarget}
          aria-label={renderMode.target === 'linear' ? 'Draw map as line' : 'Draw map as circle'}
          title={renderMode.canUseTarget
            ? `Draw map as ${renderMode.target === 'linear' ? 'line' : 'circle'}`
            : 'A linear molecule has two ends and cannot be drawn as a circle'}
          onClick={() => renderMode.onChange(renderMode.target)}
        >
          {renderMode.target === 'linear' ? (
            <LinearMapIcon size={15} strokeWidth={2.2} aria-hidden="true" />
          ) : (
            <Circle size={14} strokeWidth={2.2} aria-hidden="true" />
          )}
        </button>
      ) : null}
      {restrictionSites ? (
        <button
          className="motif-cs-map-button motif-cs-map-sites-toggle"
          type="button"
          data-active={restrictionSites.visible || undefined}
          aria-pressed={restrictionSites.visible}
          onClick={() => restrictionSites.onChange(!restrictionSites.visible)}
          aria-label="Restriction sites"
          // The rail's scissors opens the Restriction Sites tool; this one draws
          // or clears every site on the map, so its tooltip says which.
          title="Show or hide all restriction sites on the map"
        >
          <Scissors size={14} strokeWidth={2.1} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
