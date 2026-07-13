/**
 * Pure layout contract for the sequence map viewer (circular + linear).
 *
 * This module and everything under src/plasmid-map/* is PURE: no React, no store,
 * no DOM. It imports only pure bio types. The React renderers under
 * src/components/plasmid-map/* consume the computed layout objects and map them to
 * SVG — they never re-derive biological ranges.
 *
 * Gated behind the default-off USE_PLASMID_MAP flag and lazy-loaded, so compact/
 * detail sequence flows never pay for any of this. See
 * qa-logs/2026-07-02-plasmid-map/NOTES.md for the reversibility charter.
 */
import type { Feature, RestrictionSite, FeatureStrand, Topology, SequenceType } from '../bio/types';

export type MapMode = 'circular' | 'linear';

/**
 * A drawable, already-normalized span in bp. After normalization a span NEVER
 * wraps the origin — an origin-crossing feature/range is split into multiple
 * MapSpans. `end` is exclusive and always `> start`.
 */
export interface MapSpan {
  start: number; // 0-indexed, inclusive
  end: number; // exclusive; always > start; <= sequence length
}

/** One drawable segment of a feature after subrange + origin-wrap resolution. */
export interface MapFeatureSegment extends MapSpan {
  /** First segment in biological/import order (reverse-strand arrow tail lives here). */
  isStart: boolean;
  /** Last segment in biological/import order (forward-strand arrow head lives here). */
  isEnd: boolean;
}

/**
 * Multi-span selection result for one feature. Feeds the store as:
 *   focusedRanges <- ranges (all segments highlighted)
 *   selectedRange <- primary (single caret/reveal target)
 * Mirrors WorkspaceInspector.focusRanges but is map-owned so we never touch the
 * locked contiguousRangeForFeatureSelection helper.
 */
export interface FeatureSelectionRanges {
  /** Every drawable span, in biological/import order. */
  ranges: readonly MapSpan[];
  /** Deterministic primary span (first in biological order), or null if degenerate. */
  primary: MapSpan | null;
}

/**
 * Which projection a block gets. Protein is ALWAYS linear (no meaningful circle);
 * every other sequence type follows its topology, so circular DNA/RNA (and any
 * other circular nucleotide-ish block) gets the ring while linear blocks get the
 * linear schematic. Restriction ticks simply won't appear for non-DNA input.
 */
export function mapModeForBlock(topology: Topology, type: SequenceType): MapMode {
  if (type === 'protein') return 'linear';
  return topology === 'circular' ? 'circular' : 'linear';
}

// ============================================================================
// Projected layout contract — computeMapLayout(input) -> MapLayout.
// The layout is fully projected to SVG coordinates and deterministic, so it can
// be asserted in unit tests (numbers/paths) before any screenshot. Renderers map
// these objects to SVG elements and NEVER re-derive biological ranges.
// ============================================================================

export interface Pt {
  x: number;
  y: number;
}

/** Axis-aligned screen-space bounding box for pure map geometry collision checks. */
export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapLabelRender {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  /** SVG dominant-baseline hint; absent preserves the historical alphabetic baseline. */
  baseline?: 'middle' | 'hanging' | 'auto';
  /** degrees; tangential rotation for circular labels, 0/undefined = upright.
   * Kept even when `arcPath` is present: it is the straight-text fallback and the
   * conservative bounding-box basis for label de-collision. */
  rotate?: number;
  /** SVG path (baseline arc at the feature's mid-radius) for on-arc inline labels
   * rendered via <textPath>, so long labels follow the curve instead of drifting
   * off a straight tangent. Absent = render straight (using x/y/rotate). Path
   * direction already encodes the bottom-arc flip that keeps text upright. */
  arcPath?: string;
  /** leader polyline from tick/arc to the label; empty when inline. */
  leader: readonly Pt[];
  /** inline (on/inside the arc) vs outside-with-leader. */
  inside: boolean;
}

export interface MapFeatureRender {
  id: string;
  name: string;
  type: string; // FeatureType
  /** 1 forward, -1 reverse, 0 directionless (plain block, no terminal point). */
  displayStrand: FeatureStrand;
  /** resolved fill hint; renderer may override via theme tokens. */
  color: string;
  /** 0 = outermost ring (circular) / topmost row (linear). */
  lane: number;
  /** one SVG path per drawable segment; directional terminal segments include the point. */
  segmentPaths: readonly string[];
  /** label placement, or null when culled. */
  label: MapLabelRender | null;
  /** midpoint bp for reveal/scroll + deterministic hit ordering. */
  midBp: number;
  /** hover/native-tooltip text (name · type · range · strand); rendered as <title>. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Restriction density substrate: one unlabeled tick per raw restriction site.
// This is separate from MapRestrictionRender, which remains the clustered,
// interactive label/tick contract.
// ---------------------------------------------------------------------------
export interface MapRestrictionDensityTick {
  id: string;
  anchorBp: number;
  tick: { x1: number; y1: number; x2: number; y2: number };
}

export interface MapRestrictionRender {
  clusterId: string;
  /** radial (circular) / vertical (linear) tick line. */
  tick: { x1: number; y1: number; x2: number; y2: number };
  /** cluster label (with leader), or null when culled. */
  label: MapLabelRender | null;
  /**
   * Per-enzyme breakdown of `label.text` for PER-TOKEN Type IIS coloring: one
   * entry per shown enzyme (text = the enzyme name, typeIIS = whether that enzyme
   * cuts outside its recognition window anywhere in this cluster) plus a trailing
   * non-Type-IIS `+N` overflow segment when present. The renderer joins enzyme
   * tokens with "," and the tail with " ", so the concatenation is IDENTICAL to
   * `label.text` — only the Type IIS tokens get the tan/orange, matching Benchling.
   * Additive + optional: absent on linear (single compact token), where the label
   * falls back to the aggregate whole-label color.
   */
  labelSegments?: readonly { text: string; typeIIS: boolean }[];
  /** any tick in the cluster cuts outside its recognition window. */
  hasTypeIIS: boolean;
  /** tick ids in this cluster (for hit-testing / site activation). */
  tickIds: readonly string[];
  anchorBp: number;
  /** recognition-window start positions of every site in the cluster (0-indexed),
   * ascending — the container focuses these on click for exact sequence sync. */
  positions: readonly number[];
  /** hover/native-tooltip text (enzymes · cut position); rendered as <title>. */
  title?: string;
}

export interface MapCoordinateTick {
  bp: number;
  major: boolean;
  tick: { x1: number; y1: number; x2: number; y2: number };
  grid?: { x1: number; y1: number; x2: number; y2: number };
  label: { text: string; x: number; y: number; anchor: 'start' | 'middle' | 'end'; rotate?: number } | null;
}

export interface MapOverflowRender {
  id: string;
  kind: string;
  text: string;
  title: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface MapCenterTitle {
  /** fitted circular title lines; baselines are absolute SVG y coordinates. */
  lines: readonly { text: string; fontSize: number; baselineY: number }[];
  /** absolute SVG y baseline for the length line. */
  lenBaselineY: number;
}

export interface MapBudgets {
  estimatedSvgNodes: number;
  visibleLabelCount: number;
  hiddenLabelCount: number;
  laneCount: number;
  /** features on lanes beyond what the compressed floor stack could fit — drawn
   * arc-less (hover title + inspector only), so dense maps never silently overdraw. */
  overflowFeatureCount: number;
}

export interface LinearMapAxis {
  /** SVG x coordinate where the linear sequence axis starts. */
  startX: number;
  /** SVG x coordinate where the linear sequence axis ends. */
  endX: number;
  /** Drawable linear sequence axis width in SVG units. */
  width: number;
  /** SVG y coordinate of the linear sequence axis/backbone. */
  y: number;
}

export interface MapDisplayOptions {
  showFeatureLabels?: boolean;
  showRestrictionLabels?: boolean;
  /** hard cap on restriction cluster labels before culling to +N/list. */
  maxRestrictionLabels?: number;
  /** hard cap on circular feature labels before surfacing the remainder as +N more. */
  maxFeatureLabels?: number;
  /** Feature-label font metrics. High contrast renders UI labels monospace. */
  labelFontMode?: 'proportional' | 'monospace';
  labelDensity?: 'auto' | 'low' | 'medium' | 'high';
  /** Circular-only: lower values reserve less outside gutter, making the ring larger. */
  circularOutsideGutterScale?: number;
}

export interface MapInput {
  mode: MapMode;
  name: string;
  length: number;
  topology: Topology;
  sequenceType: SequenceType;
  features: readonly Feature[];
  restrictionSites: readonly RestrictionSite[];
  /** viewport pixel size (roughly square for circular). */
  width: number;
  height: number;
  /** Dock-only: consume extra host height as margins instead of content scaling. */
  fillAvailableHeight?: boolean;
  display?: MapDisplayOptions;
}

export interface MapLayout {
  mode: MapMode;
  width: number;
  height: number;
  viewBox: string;
  /**
   * The viewBox as numbers (x, y, w, h). Equals the content bounding box after
   * label extents are folded in, so it can start negative / exceed width/height.
   * Renderers use this for the background rect + click target so both cover the
   * whole visible box (not just the nominal viewport).
   */
  bg: { x: number; y: number; width: number; height: number };
  /** circular ring center; linear left/baseline origin. */
  center: Pt;
  /** circular backbone radius; 0 for linear. */
  radius: number;
  /** SVG path for the backbone (circle circular / horizontal line linear). */
  backbonePath: string;
  /** Explicit linear sequence axis geometry. Present only for linear layouts. */
  linearAxis?: LinearMapAxis;
  name: string;
  length: number;
  /** circular-only fitted center title; linear layouts do not set it. */
  centerTitle?: MapCenterTitle;
  topology: Topology;
  sequenceType: SequenceType;
  features: readonly MapFeatureRender[];
  restrictionDensityTicks: readonly MapRestrictionDensityTick[];
  restrictions: readonly MapRestrictionRender[];
  coordinates: readonly MapCoordinateTick[];
  overflows?: readonly MapOverflowRender[];
  budgets: MapBudgets;
}

export type { Feature, RestrictionSite, FeatureStrand, Topology, SequenceType };
