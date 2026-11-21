/**
 * The map pane's view controls: zoom out, Fit, zoom in, then the Circle | Line
 * drawing pair on a nucleotide record and the Sites menu (Unique, All, None)
 * on DNA. The pane heading styles the group by its class names; the host owns every
 * piece of state the group reads and every action it takes.
 *
 * Each control's accessible name holds the word it shows (WCAG 2.5.3): "Fit" is
 * named "Fit map to pane", not "Reset map view". A toggle keeps one name and
 * carries its state in its value, so a screen reader never hears "Hide
 * restriction sites" for a layer that is on.
 */
import { Hand, Minus, Plus } from 'lucide-react';
import type { MapMode } from '../../plasmid-map/types';

/**
 * Which restriction sites the map draws. `unique` is enzymes that cut once, the
 * default; `custom` is any other hand-picked set from the Restriction tool.
 */
export type MapSiteMode = 'unique' | 'all' | 'none' | 'custom';

export interface MapViewToolbarProps {
  canZoomOut: boolean;
  canFit: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  /** The hand toggle: a primary drag pans while it is on, at every zoom. */
  handPan?: { on: boolean; onToggle: () => void };
  /** Present on a nucleotide record. `target` is the other drawing; `canUseTarget` is false when it cannot be drawn. */
  renderMode?: {
    current: MapMode;
    target: MapMode;
    canUseTarget: boolean;
    onChange: (mode: MapMode) => void;
  };
  /** Present on a DNA record: which restriction sites the map draws. */
  restrictionSites?: {
    mode: MapSiteMode;
    /** False when no enzyme cuts once, or every enzyme does. */
    canShowUnique: boolean;
    onChange: (mode: Exclude<MapSiteMode, 'custom'>) => void;
  };
}

export function MapViewToolbar({
  canZoomOut,
  canFit,
  canZoomIn,
  onZoomOut,
  onFit,
  onZoomIn,
  handPan,
  renderMode,
  restrictionSites,
}: MapViewToolbarProps) {
  return (
    <div className="motif-cs-map-toolbar" role="group" aria-label="Map view controls">
      {/* The titles name the keys the document already binds: +/= zooms in, -/_
          zooms out and 0 fits, whenever focus is outside a form field. A disabled
          control's title says why it cannot act. */}
      <button className="motif-cs-map-button" type="button" onClick={onZoomOut} disabled={!canZoomOut} aria-label="Zoom out" title={canZoomOut ? 'Zoom out (-)' : 'The whole map is already in view'}>
        <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <button
        className="motif-cs-map-button motif-cs-map-reset"
        type="button"
        onClick={(event) => {
          // Fit disables itself once the map is home; focus moves to Zoom in rather than the page.
          const zoomIn = event.currentTarget.nextElementSibling as HTMLElement | null;
          onFit();
          window.requestAnimationFrame(() => zoomIn?.focus());
        }}
        disabled={!canFit}
        aria-label="Fit map to pane"
        title={canFit ? 'Fit map to pane (0)' : 'The map already fits the pane'}
      >
        Fit
      </button>
      <button className="motif-cs-map-button" type="button" onClick={onZoomIn} disabled={!canZoomIn} aria-label="Zoom in" title={canZoomIn ? 'Zoom in (+)' : 'Zoomed in as far as the map goes'}>
        <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {handPan ? (
        <button
          className="motif-cs-map-button motif-cs-map-hand"
          type="button"
          onClick={handPan.onToggle}
          data-active={handPan.on || undefined}
          aria-pressed={handPan.on}
          aria-label="Pan by dragging"
          title="Pan by dragging (or hold Space; middle button always pans)"
        >
          <Hand size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
      {renderMode ? (
        /* Circle | Line: the pressed segment is the drawing on screen, so the
           state reads without a press. A view change only: the record is
           untouched. The pair sits in one ch-based width with a 6px margin, so no
           other control in the heading moves; two words do not fit that box, so
           each segment is a drawn shape with its name as its accessible name and
           its tooltip. */
        <div
          className="motif-cs-segmented motif-cs-map-shape"
          role="group"
          aria-label="Map shape"
          data-current-mode={renderMode.current}
        >
          {(['circular', 'linear'] as const).map((mode) => {
            const pressed = renderMode.current === mode;
            const name = mode === 'circular' ? 'Circle' : 'Line';
            const disabled = !pressed && mode === renderMode.target && !renderMode.canUseTarget;
            return (
              <button
                key={mode}
                type="button"
                data-active={pressed || undefined}
                aria-pressed={pressed}
                aria-label={name}
                disabled={disabled}
                title={pressed
                  ? `Map drawn as a ${mode === 'circular' ? 'circle' : 'line'}`
                  : disabled
                    ? 'A linear molecule has two ends and cannot be drawn as a circle; convert it in Record details to draw it as one'
                    : `Draw map as ${mode === 'circular' ? 'circle' : 'line'}`}
                onClick={() => { if (!pressed) renderMode.onChange(mode); }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
                  {mode === 'circular'
                    ? <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    : <path d="M1.8 7h10.4M1.8 4.2v5.6M12.2 4.2v5.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
                </svg>
              </button>
            );
          })}
        </div>
      ) : null}
      {restrictionSites ? (
        <label className="motif-cs-map-sites-field" title="Restriction sites drawn on the map">
          <span className="motif-cs-map-sites-field-label">Sites</span>
          <select
            className="motif-cs-map-sites-toggle"
            aria-label="Restriction sites"
            data-active={restrictionSites.mode !== 'none' || undefined}
            value={restrictionSites.mode}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (next === 'unique' || next === 'all' || next === 'none') restrictionSites.onChange(next);
            }}
          >
            <option value="unique" disabled={!restrictionSites.canShowUnique}>Unique</option>
            <option value="all">All</option>
            <option value="none">None</option>
            {restrictionSites.mode === 'custom' ? <option value="custom" disabled>Custom</option> : null}
          </select>
        </label>
      ) : null}
    </div>
  );
}
