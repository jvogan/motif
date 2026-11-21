/**
 * A circular map is drawn into a viewBox that holds the ring plus every outside
 * label, and the SVG scales that box down to the pane. On a narrow pane the
 * labels overhang the ring by about the same amount whatever the ring's size, so
 * the box would outgrow the pane and every 16px label would land below 12 screen
 * px. This lays the ring out smaller instead, until the scale keeps the labels at
 * 12px or more.
 */
import { circularPaneRingDiameter, computeMapLayout, resolveMapMode } from './layout';
import { LABEL_FONT_PX } from './geometry/labels';
import type { MapDisplayOptions, MapInput, MapLayout } from './types';

/** The smallest on-screen size a 16px map label may render at. */
export const MIN_SCREEN_MAP_LABEL_PX = 12;
const MIN_SCREEN_SCALE = MIN_SCREEN_MAP_LABEL_PX / LABEL_FONT_PX;
/** Never shrink the ring's layout below this share of the pane. */
const MIN_RING_SHARE = 0.4;

function drawnBox(layout: MapLayout): { width: number; height: number } {
  const parts = (layout.contentViewBox ?? layout.viewBox).split(/\s+/).map(Number);
  const [, , width, height] = parts;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : { width: layout.bg.width, height: layout.bg.height };
}

/** The scale the pane applies to a layout drawn with `meet`. */
export function mapScreenScale(layout: MapLayout, paneWidth: number, paneHeight: number): number {
  const box = drawnBox(layout);
  return Math.min(paneWidth / box.width, paneHeight / box.height);
}

/**
 * A pane whose label-free ring (circularPaneRingDiameter) is under this many CSS px
 * draws every circular map in it as a miniature: the name alone in the centre, arcs
 * near the backbone, short leaders and fewer, whole labels. At and above it every
 * record gets exactly the full-size layout.
 *
 * The switch reads the pane only. Reading the ring each record ends up with after its
 * names take their room would move with the record's names: in one 640x392 pane
 * pUC19's ring comes out at 340px and stays full size while pcDNA3.1(+)'s (332px)
 * and pET-28a(+)'s (279px) would become miniatures, so switching records would switch
 * the drawing. With the map's display options a 392px-high pane gives a 368px
 * label-free ring and keeps the full-size drawing; a 372px pane (348px) is where
 * the full-size rings fall to 260-313px and the miniature takes over.
 */
export const SMALL_MAP_PANE_RING_PX = 360;

/** Whether a circular map in a width x height pane is drawn as a miniature. */
export function isSmallMapPane(width: number, height: number, display?: MapDisplayOptions): boolean {
  return width > 0 && height > 0 && circularPaneRingDiameter(width, height, display) < SMALL_MAP_PANE_RING_PX;
}

/** The ring's diameter on screen, in CSS px, for a layout drawn into this pane. */
export function ringScreenDiameter(layout: MapLayout, paneWidth: number, paneHeight: number): number {
  return 2 * layout.radius * mapScreenScale(layout, paneWidth, paneHeight);
}

export function computeReadableMapLayout(input: MapInput): MapLayout {
  if (
    resolveMapMode(input) === 'circular'
    && input.display?.smallRing === undefined
    && isSmallMapPane(input.width, input.height, input.display)
  ) {
    return fitSmallRingLayout({ ...input, display: { ...input.display, smallRing: true } });
  }
  return fitReadableMapLayout(input);
}

const SMALL_RING_SHARE_STEPS = 7;

/**
 * A small ring names fewer things as it shrinks, so the overhang the two-pass solve
 * below extrapolates from does not hold: pcDNA3.1(+) in a 220x260 pane would be shrunk
 * for labels it then drops and drawn at 1.36x, its 16px names at 22px. So this bisects
 * for the largest ring whose labels still render at MIN_SCREEN_MAP_LABEL_PX.
 */
function fitSmallRingLayout(input: MapInput): MapLayout {
  const at = (share: number) => share === 1
    ? computeMapLayout(input)
    : computeMapLayout({ ...input, width: input.width * share, height: input.height * share });
  const readable = (layout: MapLayout) =>
    mapScreenScale(layout, input.width, input.height) >= MIN_SCREEN_SCALE - 0.001;
  const first = at(1);
  if (readable(first)) return first;
  let low = MIN_RING_SHARE;
  let high = 1;
  let best: MapLayout | null = null;
  for (let step = 0; step < SMALL_RING_SHARE_STEPS; step += 1) {
    const share = (low + high) / 2;
    const layout = at(share);
    if (readable(layout)) {
      best = layout;
      low = share;
    } else {
      high = share;
    }
  }
  return best ?? at(MIN_RING_SHARE);
}

function fitReadableMapLayout(input: MapInput): MapLayout {
  const first = computeMapLayout(input);
  if (first.mode !== 'circular' || !(input.width > 0) || !(input.height > 0)) return first;
  let layout = first;
  let share = 1;
  // Two passes: the second corrects for labels the smaller ring culls or moves.
  for (let pass = 0; pass < 2; pass += 1) {
    const box = drawnBox(layout);
    const scale = mapScreenScale(layout, input.width, input.height);
    if (scale >= MIN_SCREEN_SCALE - 0.001) return layout;
    // The overhang (box minus laid-out side) stays roughly fixed; solve for the
    // laid-out side that brings box * scale back to the pane at the target scale.
    const widthShare = (input.width / MIN_SCREEN_SCALE - (box.width - input.width * share)) / input.width;
    const heightShare = (input.height / MIN_SCREEN_SCALE - (box.height - input.height * share)) / input.height;
    const next = Math.max(MIN_RING_SHARE, Math.min(share - 0.05, widthShare, heightShare));
    if (!(next < share)) return layout;
    share = next;
    layout = computeMapLayout({ ...input, width: input.width * share, height: input.height * share });
  }
  return layout;
}
