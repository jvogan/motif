/**
 * computeMapLayout(input) -> MapLayout. The single PURE projection step for the
 * sequence map: it turns bp-space biology (features, restriction sites, coordinates)
 * into fully-projected SVG numbers/paths for BOTH the circular ring and the linear
 * ruler. Deterministic — same input yields byte-identical output — so the layout can
 * be asserted in unit tests before any renderer or screenshot exists.
 *
 * PURE: no React, no DOM, no store, no Date.now()/Math.random(). Imports only the
 * bio types, the map contract, and the sibling geometry helpers. Renderers under
 * src/components/plasmid-map/* consume these objects and never re-derive biology.
 */
import type { FeatureStrand } from '../bio/types';
import type {
  MapInput,
  MapLayout,
  MapFeatureRender,
  MapRestrictionRender,
  MapRestrictionDensityTick,
  MapCoordinateTick,
  MapLabelRender,
  MapBudgets,
  MapFeatureSegment,
  MapDisplayOptions,
  MapOverflowRender,
  MapMode,
  MapCenterTitle,
  MapSpan,
  Pt,
} from './types';
import { mapModeForBlock } from './types';
import {
  bpToAngle,
  pointOnCircle,
  describeArcBand,
  describeCircularFeatureArrowBand,
  describeLinearFeatureArrowPath,
  bpToX,
  round,
} from './geometry/coordinates';
import { featureSegments } from './geometry/ranges';
import { packLanes } from './geometry/lanes';
import type { LaneItem } from './geometry/lanes';
import { buildRestrictionClusters } from './geometry/restrictions';
import type { MapRestrictionCluster } from './geometry/restrictions';
import {
  approxTextWidth,
  arcExtentPx,
  fitsInline,
  deCollideAlongAxis,
  buildLeaderPolyline,
  cmpKey,
  LABEL_LINE_HEIGHT_PX,
} from './geometry/labels';
import type { AxisLabelItem, LabelFontMode } from './geometry/labels';
import {
  layoutRadialTierLabels,
  type RadialTierLabelCandidate,
  type RadialTierLabelOptions,
  type RadialTierLabelPlacement,
} from './geometry/radial-labels';

// ── Circular constants (px) ──────────────────────────────────────────────────
const CIRCULAR_MIN_GUTTER = 42; // floor for the outer restriction-label band
const CIRCULAR_GUTTER_FRACTION = 0.11; // share of the half-extent reserved outside R
const LANE_THICKNESS = 12; // feature arc band thickness
const LANE_GAP = 4; // radial gap between concentric lanes
const FEATURE_BACKBONE_INSET = 22; // lane 0 sits this far inside the backbone,
// leaving a coordinate-ruler band (ticks + bp numbers) between the ring and the
// outermost feature lane so bp labels never collide with feature arcs.
const MIN_INNER_RADIUS = 6; // never let a deep lane collapse through the center
const REC_TICK_INNER_OFFSET = 2; // restriction tick starts this far outside R
const REC_TICK_LEN = 7; // restriction tick length (radial, outside R)
const REC_DENSITY_TICK_INNER_OFFSET = 1; // per-site density substrate starts just outside R
const REC_DENSITY_TICK_LEN = 5; // shorter than clustered interactive ticks
const COORD_TICK_LEN = 6; // coordinate tick length (radial, inside R)
const COORD_LABEL_SEAM_PAD = 2; // air demanded between the wrapped ruler number and "0"
const FEATURE_INSIDE_LABEL_GAP = 6;
const FEATURE_INSIDE_LABEL_EDGE_PAD = 6;
const FEATURE_INSIDE_LABEL_CAP_PAD = LABEL_LINE_HEIGHT_PX;
const CENTER_LABEL_PAD = 8;
const REC_LABEL_RADIAL_SLOT_PX = 62; // approximate radial outside-label slot used for label caps
/**
 * Width budget for a circular restriction cluster label. Over it, circularClusterLabel
 * drops a name and grows the "+N" tail instead.
 *
 * Was 112, with the widest labels sitting at 111.2 — hard against it. Adding the space
 * after each name separator costs 6.2px per separator (measured), so a three-name label
 * needed +12.4 and six labels across the bundled plasmids silently fell back to two
 * names. 126 = 112 + two separators' worth + headroom, which restores byte-identical
 * enzyme content everywhere: a readable separator must not be paid for with a hidden
 * enzyme name. Verified on pUC19 / pBR322 / pACYC184 / pBluescript / pcDNA3.1 at
 * 1920x1080 — label counts unchanged, zero label-box overlaps, and the worst leader's
 * sideways offset from its own tick unchanged (2.9-9.2% of ring radius).
 */
const CIRCULAR_REC_LABEL_MAX_WIDTH_PX = 126;
const LABEL_BAND_MARGIN = 10; // fitted viewBox padding around outside labels
const FEATURE_OUTSIDE_LABEL_PRIORITY_BASE = 1_000_000; // feature/gene names win over crowded enzyme text
const RADIAL_LABEL_MIN_LEADER_GAP = 8;
const CIRCULAR_LABEL_LEADER_TOUCH_GAP = 2;
const CIRCULAR_LABEL_LEADER_TEXT_PAD = 4;
const RADIAL_LABEL_TIER_STEP = LABEL_LINE_HEIGHT_PX + 5;
const RADIAL_LABEL_ANGULAR_THRESHOLD_DEG = 8;
const RADIAL_LABEL_MAX_LEADER_FRACTION = 0.35;
const NESTED_FEATURE_CONTAINMENT_RATIO = 0.85;
const NESTED_FEATURE_MAX_CHILD_FRACTION = 0.45;
const TARGET_COORD_TICKS = 8; // aim for ~6-10 nice coordinate ticks
const REC_CLUSTER_MIN_SEP_DEG = 6; // circular restriction clustering threshold
const REC_CLUSTER_MAX_SPAN_BP = 128; // prevents transitive all-enzyme mega-clusters
const REC_MAX_NAMES = 3; // enzyme names shown before "+N"
// Adaptive lane compression (W2): when overlapping features stack into many lanes,
// thickness + gap shrink toward these floors so deep lanes keep DISTINCT descending
// radii instead of collapsing onto a shared minimum; only when even the floor stack
// overflows the radial depth do the deepest lanes drop to overflow (arc-less, still
// hover-discoverable + in the inspector, counted in budgets.overflowFeatureCount).
const CIRCULAR_LANE_MIN_THICKNESS = 4; // thinnest a compressed feature arc may get
const CIRCULAR_LANE_MIN_GAP = 4; // thinnest radial gap between compressed lanes
const CIRCULAR_COORD_BAND_MIN = 10; // coord ruler yields to this before lanes overflow
const CIRCULAR_ELLIPSIS_MIN_VISIBLE_CHARS = 7;
const CIRCULAR_ELLIPSIS_MIN_RETAINED_RATIO = 0.4;
const CIRCULAR_AUTO_FEATURE_LABEL_BUDGET = 36;
const CIRCULAR_ADAPTIVE_START_FEATURES = 24;
const CIRCULAR_ADAPTIVE_FEATURE_STEP = 10;
const CIRCULAR_ADAPTIVE_RADIUS_STEP = 14;
const CIRCULAR_ADAPTIVE_HEIGHT_STEP = 42;
const CIRCULAR_ADAPTIVE_OUTSIDE_GUTTER_STEP = 5;
const CENTER_TITLE_FONT = 15; // matches .motif-pm-center-name font-size
const CENTER_TITLE_TWO_LINE_FONT = 14; // dropped a notch when the title wraps
const CENTER_TITLE_LINE_HEIGHT = 16; // baseline-to-baseline in the 2-line case
const CENTER_TITLE_WIDTH_RATIO = 1.3;
const CENTER_TITLE_LENGTH_FONT = 11;
const CENTER_TITLE_DESCENT_PAD = 4;
const CENTER_TITLE_WIDE_CHARS = new Set(['m', 'w', 'M', 'W', '—', '@', '%']);
const CENTER_TITLE_NARROW_CHARS = new Set([
  'i', 'l', 'I', 'j', 't', 'f', 'r', '.', ',', ':', ';', "'", '`', '|', '!', '(', ')', '[', ']', '/', '\\', '-',
]);
const CIRCULAR_FEATURE_TYPE_PRIORITY: Record<string, number> = {
  cds: 900,
  gene: 860,
  resistance: 840,
  origin: 800,
  promoter: 760,
  terminator: 720,
  rbs: 680,
  primer_bind: 560,
  misc_feature: 420,
};

// ── Linear constants (px) ────────────────────────────────────────────────────
const LINEAR_PAD_X = 28; // left/right axis padding
const LINEAR_MIN_LAYOUT_WIDTH = 720; // narrow docks use the same proportional lane geometry as center maps
const LINEAR_COORD_LABEL_Y = 14;
const LINEAR_AXIS_Y = 24; // baseline y; top coordinate ruler
const LINEAR_COORD_TICK_LEN = 5; // coordinate tick length (down from the axis)
const LINEAR_COORD_GRID_TOP_Y = LINEAR_AXIS_Y;
const LINEAR_REC_TICK_TOP_Y = 34;
const LINEAR_REC_TICK_BOTTOM_Y = 42;
const LINEAR_REC_DENSITY_TICK_TOP_Y = 36;
const LINEAR_REC_LABEL_ROW_YS = [50, 64] as const;
const LINEAR_REC_LABEL_CENTER_OFFSET = LABEL_LINE_HEIGHT_PX / 2;
const LINEAR_REC_LABEL_TOUCH_GAP = 2;
const LINEAR_REC_BAND_BOTTOM = 72;
const LINEAR_ROW_TOP = 82; // first feature row top (below fixed restriction band)
const LINEAR_ROW_HEIGHT = 16; // feature row height
const LINEAR_ROW_GAP = 6; // gap between stacked rows
const LINEAR_LANE_PITCH_MAX = 46; // dock fill cap: comfortable label clearance without over-spread rows
const LINEAR_ROW_MIN_HEIGHT = 10;
const LINEAR_ROW_MIN_GAP = 4;
const LINEAR_BOTTOM_PAD = 10;
const LINEAR_FEATURE_RADIUS = 0; // Square-ended feature bars
const LINEAR_REC_LABEL_MAX_WIDTH_PX = 64;
/**
 * Floor on the visible stem when a cluster label shortens its enzyme name to keep its
 * "+N" count, so a pathological count cannot grind the name down to a single letter.
 *
 * Where it bites, measured rather than assumed (proportional mode, 6.2px/char, 9-char
 * lead name):
 *   - Counts up to 3 digits — floor not binding, or exactly met. "Nt.… +999" is 55.8px,
 *     equal to the bare name it replaces, so the no-wider invariant still holds.
 *   - 4-digit counts — the floor wins over the width budget. "Nt.… +1200" is 62.0px
 *     against a 55.8px name: ~6px wider than what it replaces, still inside the 64px
 *     cap, so the only cost is that much row width.
 *   - 5-digit counts — "Nt.… +12000" is 68.2px and OVERRUNS the cap by 4.2px. Nothing
 *     clips or overprints, because placement uses actual widths; the row's slot estimate
 *     is simply short by that much, so a very crowded row could drop one more label.
 *
 * Reaching even the 4-digit case needs ~1000 DISTINCT enzymes cutting inside a single
 * cluster window. The bundled set has 154 in total and the densest real cluster on
 * pUC19 is 39. Left unguarded deliberately — the guard would be dead code.
 */
const LINEAR_REC_LABEL_MIN_STEM_CHARS = 3;
const LINEAR_REC_LABEL_GAP_X = 8;
const LINEAR_REC_SLOT_PX = LINEAR_REC_LABEL_MAX_WIDTH_PX + LINEAR_REC_LABEL_GAP_X;
// Min px gap between two ADJACENT restriction labels in a row. Real enzyme names
// ("AluI", "HaeIII") are far narrower than the 64px worst-case slot, so packing by
// actual width + this readable gap lets labels sit close to their ticks — leaders stay
// short + near-vertical instead of cascading right on long shallow lines.
const LINEAR_REC_LABEL_MIN_GAP = 12;
const LINEAR_REC_LEADER_DROP = 4;
const LINEAR_REC_OVERFLOW_RESERVE_PX = 128;
const LINEAR_LABEL_MIN_GAP_PX = 4;
const LINEAR_FEATURE_LABEL_GAP_X = 4;
const LINEAR_FEATURE_LEADER_MIN_DX = LINEAR_FEATURE_LABEL_GAP_X + 1;
const LINEAR_FEATURE_LABEL_MAX_LEADER_DX = 40;
const LINEAR_FEATURE_LEADER_RISE = 6;
const LINEAR_FEATURE_LABEL_BASELINE = 'middle' as const;
const MIN_FEATURE_PX = 2; // minimum drawn width for a point-ish feature
const REC_CLUSTER_MIN_SEP_PX = 10; // linear restriction clustering threshold

// =============================================================================
// Public entry point.
// =============================================================================
export function computeMapLayout(input: MapInput): MapLayout {
  // Sanitize the numeric inputs at the single entry point so a non-finite length/
  // width/height (a corrupt block, a 0-size container mid-mount) can never
  // propagate a NaN into bp projection or the fitted viewBox (which would blank
  // the whole SVG). Downstream Math.max(0, input.length) then stays finite.
  const safe: MapInput = {
    ...input,
    length: Number.isFinite(input.length) ? Math.max(0, input.length) : 0,
    width: Number.isFinite(input.width) && input.width > 0 ? input.width : 1,
    height: Number.isFinite(input.height) && input.height > 0 ? input.height : 1,
  };
  // Defensive: protein is always linear even if a caller mis-set input.mode.
  const mode: MapMode =
    safe.sequenceType === 'protein'
      ? 'linear'
      : safe.mode ?? mapModeForBlock(safe.topology, safe.sequenceType);
  return mode === 'circular' ? computeCircularLayout(safe) : computeLinearLayout(safe);
}

// ── Center title fit (circular) ─────────────────────────────────────────────
// The plasmid title sits in the middle of the ring. A long name (e.g. "Clone of
// pACYC184 + eGFP (Enhanced Green Fluorescent Protein)") would otherwise render
// wider than the whole backbone circle and spill across the feature arcs. We fit
// it to the ring with a DETERMINISTIC width heuristic (no DOM
// measurement / useEffect, so the render stays pure): short names stay on one
// line unchanged; a long name wraps onto two balanced lines a notch smaller; any
// line that still cannot fit is ellipsized. The width budget is a fraction of the
// backbone radius (both are SVG user units, so this scales with the map).
function centerCharAdvance(ch: string): number {
  if (ch === ' ') return 0.32;
  if (CENTER_TITLE_WIDE_CHARS.has(ch)) return 0.92;
  if (CENTER_TITLE_NARROW_CHARS.has(ch)) return 0.35;
  if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) return 0.7;
  return 0.56;
}

function estimateCenterTextWidth(
  text: string,
  fontSize: number,
  fontMode: LabelFontMode = 'proportional',
): number {
  if (fontMode === 'monospace') return approxTextWidth(text, fontSize, fontMode);
  let em = 0;
  for (const ch of text) em += centerCharAdvance(ch);
  return em * fontSize;
}

function ellipsizeCenterTitleLine(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontMode: LabelFontMode = 'proportional',
): string {
  if (estimateCenterTextWidth(text, fontSize, fontMode) <= maxWidth) return text;
  // Trim against a slightly tighter target than the fit budget: the estimate can
  // run a couple percent under the real glyph advance on narrow-char-heavy text,
  // so the small margin keeps the ellipsized result reliably within the budget.
  const target = maxWidth * 0.97;
  const ellipsisW = estimateCenterTextWidth('…', fontSize, fontMode);
  let cut = text;
  while (cut.length > 0 && estimateCenterTextWidth(cut, fontSize, fontMode) + ellipsisW > target) {
    cut = cut.slice(0, -1);
  }
  return cut.replace(/\s+$/, '') + '…';
}

/**
 * Split a name into two lines at the whitespace that best balances their rendered
 * WIDTHS (not char counts) — picks the space minimizing the wider half — so a name
 * whose clauses have uneven glyph widths doesn't overload one line. Returns null
 * when there is no whitespace to break on (a single unbreakable token).
 */
function splitBalanced(
  name: string,
  fontSize: number,
  fontMode: LabelFontMode = 'proportional',
): [string, string] | null {
  let best: [string, string] | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < name.length; i += 1) {
    if (name[i] !== ' ') continue;
    const a = name.slice(0, i).trimEnd();
    const b = name.slice(i + 1).trimStart();
    if (!a || !b) continue;
    const score = Math.max(
      estimateCenterTextWidth(a, fontSize, fontMode),
      estimateCenterTextWidth(b, fontSize, fontMode),
    );
    if (score < bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  return best;
}

/**
 * Fit the plasmid title into the ring. `radius` is the backbone radius and `cy`
 * the ring center — both SVG user units, so the returned baselines are absolute y
 * coordinates. Short names return exactly the historical single-line placement
 * (name at cy-2, length at cy+16) so they render unchanged.
 */
function computeCenterTitle(
  name: string,
  radius: number,
  cy: number,
  fontMode: LabelFontMode = 'proportional',
): MapCenterTitle {
  const single: MapCenterTitle = {
    lines: [{ text: name, fontSize: CENTER_TITLE_FONT, baselineY: round(cy - 2) }],
    lenBaselineY: round(cy + 16),
  };
  const maxWidth = radius * CENTER_TITLE_WIDTH_RATIO;
  if (!(maxWidth > 0) || estimateCenterTextWidth(name, CENTER_TITLE_FONT, fontMode) <= maxWidth) {
    return single;
  }
  const font = CENTER_TITLE_TWO_LINE_FONT;
  const split = splitBalanced(name, font, fontMode);
  if (!split) {
    // One unbreakable token — ellipsize a single line at the base size.
    return {
      ...single,
      lines: [
        {
          text: ellipsizeCenterTitleLine(name, maxWidth, CENTER_TITLE_FONT, fontMode),
          fontSize: CENTER_TITLE_FONT,
          baselineY: round(cy - 2),
        },
      ],
    };
  }
  // Two centered lines a notch smaller; nudge the block up and push the length
  // line down so it clears the second title line.
  return {
    lines: [
      {
        text: ellipsizeCenterTitleLine(split[0], maxWidth, font, fontMode),
        fontSize: font,
        baselineY: round(cy - 11),
      },
      {
        text: ellipsizeCenterTitleLine(split[1], maxWidth, font, fontMode),
        fontSize: font,
        baselineY: round(cy - 11 + CENTER_TITLE_LINE_HEIGHT),
      },
    ],
    lenBaselineY: round(cy + 21),
  };
}

function centerTitleGuard(
  centerTitle: MapCenterTitle,
  lengthLabel: string,
  cx: number,
  fontMode: LabelFontMode = 'proportional',
): BBox {
  const titleWidth = centerTitle.lines.reduce(
    (max, line) => Math.max(max, estimateCenterTextWidth(line.text, line.fontSize, fontMode)),
    0,
  );
  const halfW =
    Math.max(titleWidth, approxTextWidth(lengthLabel, CENTER_TITLE_LENGTH_FONT, fontMode)) / 2 + CENTER_LABEL_PAD;
  const titleMinY = centerTitle.lines.reduce(
    (min, line) => Math.min(min, line.baselineY - line.fontSize),
    Infinity,
  );
  const titleMaxY = centerTitle.lines.reduce(
    (max, line) => Math.max(max, line.baselineY + CENTER_TITLE_DESCENT_PAD),
    -Infinity,
  );
  return {
    minX: round(cx - halfW),
    maxX: round(cx + halfW),
    minY: round(Math.min(titleMinY, centerTitle.lenBaselineY - CENTER_TITLE_LENGTH_FONT)),
    maxY: round(Math.max(titleMaxY, centerTitle.lenBaselineY + CENTER_TITLE_DESCENT_PAD)),
  };
}

// =============================================================================
// Circular projection — concentric feature lanes inside a backbone ring.
// =============================================================================
function computeCircularLayout(input: MapInput): MapLayout {
  const { width, height, features, restrictionSites } = input;
  const length = Math.max(0, input.length);
  const display = input.display ?? {};
  const showFeatureLabels = display.showFeatureLabels !== false;
  const showRestrictionLabels = display.showRestrictionLabels !== false;
  const labelFontMode: LabelFontMode = display.labelFontMode ?? 'proportional';
  const labelWidth = (text: string, fontPx?: number) => approxTextWidth(text, fontPx, labelFontMode);
  const labelFitsInline = (
    text: string,
    extentPx: number,
    fontPx?: number,
    bandThicknessPx?: number,
  ) => fitsInline(text, extentPx, fontPx, labelFontMode, bandThicknessPx);

  const adaptiveSteps = circularAdaptiveSteps(features.length);
  const radiusGrowth = adaptiveSteps * CIRCULAR_ADAPTIVE_RADIUS_STEP;
  const outsideGutterGrowth = adaptiveSteps * CIRCULAR_ADAPTIVE_OUTSIDE_GUTTER_STEP;
  const layoutWidth = width + radiusGrowth * 2;
  const layoutHeight = height + adaptiveSteps * CIRCULAR_ADAPTIVE_HEIGHT_STEP;

  const cx = layoutWidth / 2;
  const cy = layoutHeight / 2;
  const baseSide = Math.min(width, height);
  const outsideGutterScale = clampFinite(display.circularOutsideGutterScale, 0.18, 1.4, 1);
  const baseGutter = Math.max(
    CIRCULAR_MIN_GUTTER * outsideGutterScale,
    baseSide * CIRCULAR_GUTTER_FRACTION * outsideGutterScale,
  );
  const baseRadius = Math.max(MIN_INNER_RADIUS + LANE_THICKNESS, baseSide / 2 - baseGutter);
  const R = Math.max(MIN_INNER_RADIUS + LANE_THICKNESS, baseRadius + radiusGrowth);
  const center = { x: round(cx), y: round(cy) };
  const radius = round(R);
  const centerTitle = computeCenterTitle(input.name, radius, center.y, labelFontMode);
  // Lane packing over each feature's normalized (non-wrapping) segments. Packed
  // BEFORE the coordinate band so the band can yield to the lane floor when many
  // overlapping features must stack (below).
  const segByFeature = new Map<string, MapFeatureSegment[]>();
  const laneItems: LaneItem[] = [];
  const lanePadBp = circularLanePadBp(length, R, LANE_THICKNESS + LANE_GAP + 2);
  for (const f of features) {
    const segs = featureSegments(f, length, 'circular');
    segByFeature.set(f.id, segs);
    if (segs.length > 0) laneItems.push({ id: f.id, spans: expandCircularLaneSpans(segs, length, lanePadBp) });
  }
  const packing = packLanes(laneItems);
  const nestedFeatureIds = detectNestedCircularFeatureIds(segByFeature, packing.laneById);
  const featureLabelBudget = circularFeatureLabelBudget(features.length, display);
  const featureLabelKeep = circularFeatureLabelKeepSet(features, segByFeature, length, featureLabelBudget);

  // Coordinate ruler band between the ring and the outermost feature lane. A
  // HORIZONTAL bp number centered on the band pokes radially by half its WIDTH at
  // the 3/9 o'clock sides, so the band IDEALLY is at least as wide as the widest
  // number. But when many lanes must stack it YIELDS toward CIRCULAR_COORD_BAND_MIN
  // so the lanes keep a legible floor before the ruler hogs radius; once the band
  // can no longer fit a whole number, coordinate LABELS null out (ticks remain).
  const coordLabelWidth = labelWidth(String(Math.max(1, Math.floor(input.length))));
  const coordBandIdeal = Math.min(
    R * 0.45,
    Math.max(10, Math.min(FEATURE_BACKBONE_INSET, R * 0.12), coordLabelWidth + 4),
  );
  const laneFloorDepth =
    packing.laneCount * CIRCULAR_LANE_MIN_THICKNESS +
    Math.max(0, packing.laneCount - 1) * CIRCULAR_LANE_MIN_GAP;
  const coordBand = Math.min(
    coordBandIdeal,
    Math.max(CIRCULAR_COORD_BAND_MIN, R - MIN_INNER_RADIUS - laneFloorDepth),
  );
  const coordLabelsFit = coordBand >= coordLabelWidth + 4;
  const coordLabelInset = coordBand / 2; // center the number in the band (clears ring + lanes)
  const coordTickLenR = Math.min(COORD_TICK_LEN, coordBand * 0.4);

  // Adaptive lane geometry (W2): compress thickness/gap to fit the radial depth
  // BEFORE dropping any lane, so deep lanes get DISTINCT descending radii instead
  // of collapsing onto a shared floor (the old laneOuterR clamp bug). laneBand(lane)
  // returns null for overflow lanes beyond what the floor stack fits.
  const radialDepth = R - coordBand - MIN_INNER_RADIUS;
  const laneMetrics = fitLaneStack(
    packing.laneCount,
    radialDepth,
    LANE_THICKNESS,
    LANE_GAP,
    CIRCULAR_LANE_MIN_THICKNESS,
    CIRCULAR_LANE_MIN_GAP,
  );
  const laneBand = (
    lane: number,
  ): { outerR: number; innerR: number; centerR: number } | null => {
    if (lane >= laneMetrics.visibleCount) return null;
    const outerR = R - coordBand - lane * laneMetrics.pitch;
    return { outerR, innerR: outerR - laneMetrics.size, centerR: outerR - laneMetrics.size / 2 };
  };
  const deepestVisibleLane = Math.min(packing.laneCount, laneMetrics.visibleCount) - 1;
  const deepestVisibleBand = deepestVisibleLane >= 0 ? laneBand(deepestVisibleLane) : null;
  const fallbackVisibleInnerR = Math.max(0, R - coordBand - Math.max(0, laneMetrics.size));

  const featureInsideOuterR = Math.max(
    0,
    (deepestVisibleBand?.innerR ?? fallbackVisibleInnerR) - FEATURE_INSIDE_LABEL_GAP,
  );

  const featureInsideBand = {
    min: cy - featureInsideOuterR + FEATURE_INSIDE_LABEL_CAP_PAD,
    max: cy + featureInsideOuterR - FEATURE_INSIDE_LABEL_CAP_PAD,
  };

  const centerGuard = centerTitleGuard(centerTitle, `${length} bp`, center.x, labelFontMode);

  const insideFeatureLabelGeometry = (
    side: 'start' | 'end',
    y: number,
  ): { x: number; anchor: MapLabelRender['anchor'] } | null => {
    const dy = y - cy;
    const chord = Math.sqrt(Math.max(0, featureInsideOuterR * featureInsideOuterR - dy * dy));
    const leftX = cx - chord + FEATURE_INSIDE_LABEL_EDGE_PAD;
    const rightX = cx + chord - FEATURE_INSIDE_LABEL_EDGE_PAD;

    if (rightX <= leftX) return null;

    if (side === 'start') {
      const x = round(rightX);
      const anchor: MapLabelRender['anchor'] = 'end'; // right side grows inward
      return { x, anchor };
    }

    const x = round(leftX);
    const anchor: MapLabelRender['anchor'] = 'start'; // left side grows inward
    return { x, anchor };
  };

  const labelRowOverlapsCenterGuard = (y: number): boolean => {
    const rowMinY = y - LABEL_LINE_HEIGHT_PX * 0.8;
    const rowMaxY = y + LABEL_LINE_HEIGHT_PX * 0.3;
    return rowMinY < centerGuard.maxY && rowMaxY > centerGuard.minY;
  };

  const insideFeatureLabelAvailableWidth = (
    side: 'start' | 'end',
    y: number,
  ): { x: number; anchor: MapLabelRender['anchor']; availableW: number } | null => {
    const geometry = insideFeatureLabelGeometry(side, y);
    if (!geometry) return null;

    const guardBites = labelRowOverlapsCenterGuard(y);
    if (side === 'start') {
      const leftLimit = Math.max(center.x + CENTER_LABEL_PAD, guardBites ? centerGuard.maxX : -Infinity);
      return { ...geometry, availableW: round(Math.max(0, geometry.x - leftLimit)) };
    }

    const rightLimit = Math.min(center.x - CENTER_LABEL_PAD, guardBites ? centerGuard.minX : Infinity);
    return { ...geometry, availableW: round(Math.max(0, rightLimit - geometry.x)) };
  };

  const featureLabelNames = features.map((f) => f.name || f.type).filter(Boolean);

  const insideFeatureLabelPlacement = (
    side: 'start' | 'end',
    y: number,
    name: string,
    textW: number,
  ): { text: string; width: number; x: number; anchor: MapLabelRender['anchor']; bbox: BBox } | null => {
    if (y < featureInsideBand.min || y > featureInsideBand.max) return null;
    const available = insideFeatureLabelAvailableWidth(side, y);
    if (!available || available.availableW <= 0) return null;

    const build = (text: string, width: number) => {
      const bbox = labelBBoxAt(available.x, y, available.anchor, width);
      return bboxIntersects(bbox, centerGuard)
        ? null
        : { text, width, x: available.x, anchor: available.anchor, bbox };
    };

    if (textW <= available.availableW) {
      const full = build(name, textW);
      if (full) return full;
    }

    const cap =
      textW <= available.availableW
        ? Math.max(0, Math.min(available.availableW, textW - 0.01))
        : available.availableW;
    const label = meaningfulEllipsizeToWidth(name, cap, labelFontMode);
    if (!label) return null;
    if (!usableCircularEllipsis(name, label.text)) return null;
    if (ambiguousCircularEllipsis(name, label.text, featureLabelNames)) return null;
    if (label.text.length <= 1 || label.width > available.availableW) return null;
    return build(label.text, label.width);
  };

  // --- Features: arcs + inline labels; inside fallback labels deferred to de-collision.
  const featureRenders: MapFeatureRender[] = [];
  const overflows: MapOverflowRender[] = [];
  let overflowFeatureCount = 0; // features on lanes the floor stack can't fit (arc-less, title-only)
  let featureHiddenLabels = 0;
  const featureGlyphBoxes: BBox[] = [];
  const featureInside: AxisLabelItem[] = [];
  const featureInsideMeta = new Map<
    string,
    { name: string; side: 'start' | 'end'; anchor: Pt; outsideAnchor: Pt; angleDeg: number; textW: number }
  >();
  const featureOutside: AxisLabelItem[] = [];
  const featureOutsideMeta = new Map<string, { name: string; anchor: Pt; angleDeg: number; width: number }>();
  const queueFeatureOutside = (
    item: AxisLabelItem,
    meta: { name: string; outsideAnchor: Pt; angleDeg: number; textW: number },
  ): void => {
    if (featureOutsideMeta.has(item.key)) return;
    featureOutside.push({
      key: item.key,
      primary: meta.angleDeg,
      priority: FEATURE_OUTSIDE_LABEL_PRIORITY_BASE + item.priority,
    });
    featureOutsideMeta.set(item.key, {
      name: meta.name,
      anchor: meta.outsideAnchor,
      angleDeg: meta.angleDeg,
      width: meta.textW,
    });
  };

  for (const f of features) {
    const segs = segByFeature.get(f.id) ?? [];
    const lane = packing.laneById.get(f.id);
    const displayStrand = toDisplayStrand(f.strand);
    const name = f.name || f.type;

    if (segs.length === 0 || lane === undefined) {
      featureRenders.push({
        id: f.id,
        name,
        type: f.type,
        displayStrand,
        color: f.color,
        lane: 0,
        segmentPaths: [],
        label: null,
        midBp: segs[0]?.start ?? 0,
      });
      continue;
    }

    const bandR = laneBand(lane);
    if (!bandR) {
      // Overflow lane — no radius left to draw a distinct arc. Keep the feature
      // discoverable (hover title + inspector Features list) but draw no geometry;
      // count it so a future "N more" affordance can surface it. No silent removal.
      overflowFeatureCount += 1;
      featureRenders.push({
        id: f.id,
        name,
        type: f.type,
        displayStrand,
        color: f.color,
        lane,
        segmentPaths: [],
        label: null,
        midBp: featureMidBp(segs, length),
        title: featureTitle(name, f.type, segs, f.strand),
      });
      continue;
    }
    const { outerR, innerR, centerR } = bandR;

    // Fold the 3' strand point into the terminal segment path so the feature is
    // one continuous filled/outlined shape instead of a separate marker triangle.
    let terminalIndex = -1;
    let terminalTipDeltaDeg = 0;
    if (displayStrand !== 0) {
      const forward = displayStrand === 1;
      // Segments are stored in biological 5′→3′ order for both strands, so
      // the 3′ arrowhead always belongs to the final segment. Strand chooses
      // which edge of that terminal segment receives the point.
      terminalIndex = segs.length - 1;
      const term = segs[terminalIndex];
      const termExtentPx = arcExtentPx(
        centerR,
        Math.abs(bpToAngle(term.end, length) - bpToAngle(term.start, length)),
      );
      const arrowLenPx = Math.min(laneMetrics.size, termExtentPx);
      terminalTipDeltaDeg = arcDeltaDeg(arrowLenPx, centerR) * (forward ? 1 : -1);
    }
    const segmentPaths = segs.map((s, i) => {
      const startAngle = bpToAngle(s.start, length);
      const endAngle = bpToAngle(s.end, length);
      const isTerminal = i === terminalIndex;
      const terminalTip =
        isTerminal && displayStrand !== 0
          ? [
              pointOnCircle(
                cx,
                cy,
                (innerR + outerR) / 2,
                (displayStrand === 1 ? endAngle : startAngle) + terminalTipDeltaDeg,
              ),
            ]
          : [];
      featureGlyphBoxes.push(circularFeatureBandBBox(cx, cy, innerR, outerR, startAngle, endAngle, terminalTip));
      return isTerminal
        ? describeCircularFeatureArrowBand(
            cx,
            cy,
            innerR,
            outerR,
            startAngle,
            endAngle,
            terminalTipDeltaDeg,
            displayStrand as 1 | -1,
          )
        : describeArcBand(cx, cy, innerR, outerR, startAngle, endAngle);
    });
    const midBp = featureMidBp(segs, length);
    const midAngle = bpToAngle(midBp, length);
    const maxSegExtent = Math.max(
      ...segs.map((s) => arcExtentPx(centerR, bpToAngle(s.end, length) - bpToAngle(s.start, length))),
    );

    let label: MapLabelRender | null = null;
    if (showFeatureLabels && name) {
      const outsideAnchor = pointOnCircle(cx, cy, outerR, midAngle);
      const textW = labelWidth(name);
      if (!featureLabelKeep.has(f.id)) {
        featureHiddenLabels += 1;
      } else if (nestedFeatureIds.has(f.id)) {
        queueFeatureOutside(
          { key: f.id, primary: midAngle, priority: maxSegExtent },
          { name, outsideAnchor, angleDeg: midAngle, textW },
        );
      } else if (labelFitsInline(name, maxSegExtent, undefined, outerR - innerR)) {
        const p = pointOnCircle(cx, cy, centerR, midAngle);
        const arcSweepDeg = arcDeltaDeg(textW, centerR) + ARC_LABEL_PAD_DEG * 2;
        const arcPath = describeInlineLabelArc(cx, cy, centerR, midAngle, arcSweepDeg) ?? undefined;
        label = {
          text: name,
          x: round(p.x),
          y: round(p.y),
          anchor: 'middle',
          baseline: 'middle',
          rotate: round(tangentialRotation(midAngle)),
          arcPath,
          leader: [],
          inside: true,
        };
      } else {
        queueFeatureOutside(
          { key: f.id, primary: midAngle, priority: maxSegExtent },
          { name, outsideAnchor, angleDeg: midAngle, textW },
        );
      }
    }

    featureRenders.push({
      id: f.id,
      name,
      type: f.type,
      displayStrand,
      color: f.color,
      lane,
      segmentPaths,
      label,
      midBp,
      title: featureTitle(name, f.type, segs, f.strand),
    });
  }

  // Resolve deferred feature inside-labels (per side, then map back).
  const placeFeatureInside = (wantSide: 'start' | 'end') => {
    const group = featureInside.filter((i) => featureInsideMeta.get(i.key)!.side === wantSide);
    const placed = deCollideAlongAxis(group, featureInsideBand, LABEL_LINE_HEIGHT_PX);

    for (const item of group) {
      const meta = featureInsideMeta.get(item.key)!;
      const render = featureRenders.find((r) => r.id === item.key)!;
      const p = placed.get(item.key);

      if (!p || p.hidden) {
        render.label = null;
        queueFeatureOutside(item, meta);
        continue;
      }

      const labelY = round(p.primary);
      const placement = insideFeatureLabelPlacement(meta.side, labelY, meta.name, meta.textW);
      if (!placement) {
        render.label = null;
        queueFeatureOutside(item, meta);
        continue;
      }

      const labelPt = { x: placement.x, y: labelY };
      render.label = {
        text: placement.text,
        x: placement.x,
        y: labelY,
        anchor: placement.anchor,
        rotate: 0,
        leader: buildLeaderPolyline(meta.anchor, labelPt, 0).map(roundPt),
        inside: true,
      };
    }
  };

  placeFeatureInside('start');
  placeFeatureInside('end');

  // --- Restriction clusters: radial ticks + grouped outer labels.
  const minSepBp = Math.max(1, Math.round((length * REC_CLUSTER_MIN_SEP_DEG) / 360));
  const { ticks: restrictionTicks, clusters } = buildRestrictionClusters(restrictionSites, length, {
    minSepBp,
    maxClusterSpanBp: REC_CLUSTER_MAX_SPAN_BP,
    maxNamesPerCluster: REC_MAX_NAMES,
    circular: true,
  });

  const densityTickInner = R + REC_DENSITY_TICK_INNER_OFFSET;
  const densityTickOuter = densityTickInner + REC_DENSITY_TICK_LEN;
  const recTickInner = R + REC_TICK_INNER_OFFSET;
  const recTickOuter = recTickInner + REC_TICK_LEN;

  const restrictionDensityTicks: MapRestrictionDensityTick[] = restrictionTicks.map((t, i) => {
    const angle = bpToAngle(t.position, length);
    const p1 = pointOnCircle(cx, cy, densityTickInner, angle);
    const p2 = pointOnCircle(cx, cy, densityTickOuter, angle);
    return {
      id: `redt-${i}-${t.id}`,
      anchorBp: t.position,
      tick: { x1: round(p1.x), y1: round(p1.y), x2: round(p2.x), y2: round(p2.y) },
    };
  });
  const restrictionRenders: MapRestrictionRender[] = [];
  const recItems: AxisLabelItem[] = [];
  const recMeta = new Map<
    string,
    {
      anchor: Pt;
      angleDeg: number;
      text: string;
      width: number;
      labelSegments: readonly { text: string; typeIIS: boolean }[];
    }
  >();
  const recLabelCap = showRestrictionLabels ? circularRecCap(R, clusters.length, display) : 0;
  const labeledRecIds = showRestrictionLabels
    ? selectSpacedRestrictionClusterIds(clusters, recLabelCap, length, true)
    : new Set<string>();

  clusters.forEach((c, i) => {
    const angle = bpToAngle(c.anchorBp, length);
    const p1 = pointOnCircle(cx, cy, recTickInner, angle);
    const p2 = pointOnCircle(cx, cy, recTickOuter, angle);
    restrictionRenders.push({
      clusterId: c.id,
      tick: { x1: round(p1.x), y1: round(p1.y), x2: round(p2.x), y2: round(p2.y) },
      label: null,
      hasTypeIIS: c.hasTypeIIS,
      tickIds: c.ticks.map((t) => t.id),
      anchorBp: c.anchorBp,
      positions: clusterPositions(c),
      title: restrictionTitle(c),
    });
    if (showRestrictionLabels && labeledRecIds.has(c.id)) {
      recItems.push({
        key: c.id,
        primary: angle,
        priority: c.ticks.length * 1000 + (clusters.length - i), // bigger cluster + earlier wins
      });
      const label = circularClusterLabel(c, CIRCULAR_REC_LABEL_MAX_WIDTH_PX, labelFontMode);
      recMeta.set(c.id, {
        anchor: p2,
        angleDeg: angle,
        text: label.text,
        width: label.width,
        labelSegments: label.segments,
      });
    }
  });

  // --- Coordinate ring: nice round bp ticks with labels, 0 at 12 o'clock.
  const coordinates: MapCoordinateTick[] = [];
  const step = Math.max(1, niceStep(length / TARGET_COORD_TICKS));
  const coordInnerR = Math.max(MIN_INNER_RADIUS, R - coordTickLenR);
  const coordLabelR = Math.max(MIN_INNER_RADIUS, R - coordLabelInset);
  for (let bp = 0; bp < length; bp += step) {
    const angle = bpToAngle(bp, length);
    const pOut = pointOnCircle(cx, cy, R, angle);
    const pIn = pointOnCircle(cx, cy, coordInnerR, angle);
    const lp = pointOnCircle(cx, cy, coordLabelR, angle);
    coordinates.push({
      bp,
      major: true,
      tick: { x1: round(pIn.x), y1: round(pIn.y), x2: round(pOut.x), y2: round(pOut.y) },
      label: coordLabelsFit
        ? { text: String(bp), x: round(lp.x), y: round(lp.y), anchor: 'middle', rotate: round(tangentialRotation(angle)) }
        : null,
    });
  }

  let recHiddenLabels = 0;
  const featureOutsideCandidates: RadialTierLabelCandidate[] = [];
  const featureOutsideRadialMeta = new Map<string, CircularRadialLabelMeta>();
  const restrictionOutsideCandidates: RadialTierLabelCandidate[] = [];
  const restrictionOutsideMeta = new Map<string, CircularRadialLabelMeta>();

  for (const item of recItems) {
    const meta = recMeta.get(item.key)!;
    const key = `r:${item.key}`;
    restrictionOutsideCandidates.push({
      id: key,
      groupKey: 'restriction',
      angleDeg: meta.angleDeg,
      anchor: meta.anchor,
      text: meta.text,
      width: meta.width,
      height: LABEL_LINE_HEIGHT_PX,
      priority: item.priority,
    });
    restrictionOutsideMeta.set(key, {
      kind: 'restriction',
      targetId: item.key,
      anchor: meta.anchor,
      angleDeg: meta.angleDeg,
      text: meta.text,
      width: meta.width,
      priority: item.priority,
      labelSegments: meta.labelSegments,
    });
  }

  for (const item of featureOutside) {
    const meta = featureOutsideMeta.get(item.key)!;
    const key = `f:${item.key}`;
    const leaderAnchor = pointOnCircle(cx, cy, recTickOuter + 1, meta.angleDeg);
    featureOutsideCandidates.push({
      id: key,
      groupKey: 'feature',
      angleDeg: meta.angleDeg,
      anchor: leaderAnchor,
      anchorFollowsAngle: true,
      text: meta.name,
      width: meta.width,
      height: LABEL_LINE_HEIGHT_PX,
      priority: item.priority,
    });
    featureOutsideRadialMeta.set(key, {
      kind: 'feature',
      targetId: item.key,
      anchor: leaderAnchor,
      angleDeg: meta.angleDeg,
      text: meta.name,
      width: meta.width,
      priority: item.priority,
    });
  }

  const radialBaseRadius = recTickOuter + RADIAL_LABEL_MIN_LEADER_GAP + outsideGutterGrowth;
  const radialGeometryMaxTier = Math.max(
    2,
    Math.floor(
      Math.max(0, R * RADIAL_LABEL_MAX_LEADER_FRACTION - RADIAL_LABEL_MIN_LEADER_GAP - outsideGutterGrowth) /
        RADIAL_LABEL_TIER_STEP,
    ),
  );
  const featureRadialMaxTier = circularFeatureRadialMaxTier(
    radialGeometryMaxTier,
    featureOutsideCandidates.length,
  );
  const featureOutsideObstacles = circularRadialLabelObstacles({
    centerGuard,
    featureGlyphBoxes,
    featureRenders,
    restrictionRenders,
    restrictionDensityTicks,
    coordinates,
    labelFontMode,
  });
  const writeCircularOutsideLabel = (meta: CircularRadialLabelMeta, label: MapLabelRender | null): void => {
    if (meta.kind === 'feature') {
      const render = featureRenders.find((r) => r.id === meta.targetId);
      if (render) render.label = label;
      return;
    }

    const render = restrictionRenders.find((r) => r.clusterId === meta.targetId);
    if (!render) return;
    render.label = label;
    render.labelSegments = label ? meta.labelSegments : undefined;
  };
  const featureOutsideHidden = placeCircularRadialLabels(
    featureOutsideCandidates,
    featureOutsideRadialMeta,
    {
      cx,
      cy,
      baseRadius: radialBaseRadius,
      radiusStep: RADIAL_LABEL_TIER_STEP,
      angularThresholdDeg: RADIAL_LABEL_ANGULAR_THRESHOLD_DEG,
      maxTier: featureRadialMaxTier,
      maxPushes: featureRadialMaxTier,
      allowGrouping: false,
      maxAngleShiftDeg: RADIAL_LABEL_ANGULAR_THRESHOLD_DEG,
      obstacles: featureOutsideObstacles.labelObstacles,
      leaderObstacles: [centerGuard],
      minClearanceRadius: R + 2,
      defaultLabelHeight: LABEL_LINE_HEIGHT_PX,
    },
    labelFontMode,
    [centerGuard],
    writeCircularOutsideLabel,
  );
  featureHiddenLabels += featureOutsideHidden.feature;
  // Order matters: if the leader pass ran first and had already nulled "0", the seam
  // guard would find nothing to compare against and leave the wrapped number alone at
  // 12 o'clock, reading as the origin — strictly worse than the bug it fixes.
  dropOriginSeamCoordinateLabel(coordinates, labelFontMode);
  dropCoordinateLabelsConflictingWithFeatureLeaders(featureRenders, coordinates, labelFontMode);

  const restrictionOutsideObstacles = circularRadialLabelObstacles({
    centerGuard,
    featureGlyphBoxes,
    featureRenders,
    restrictionRenders,
    restrictionDensityTicks,
    coordinates,
    labelFontMode,
  });
  placeCircularRadialLabels(
    restrictionOutsideCandidates,
    restrictionOutsideMeta,
    {
      cx,
      cy,
      baseRadius: radialBaseRadius,
      radiusStep: RADIAL_LABEL_TIER_STEP,
      angularThresholdDeg: RADIAL_LABEL_ANGULAR_THRESHOLD_DEG,
      maxTier: radialGeometryMaxTier,
      maxPushes: radialGeometryMaxTier,
      allowGrouping: false,
      maxAngleShiftDeg: RADIAL_LABEL_ANGULAR_THRESHOLD_DEG * 2,
      obstacles: restrictionOutsideObstacles.labelObstacles,
      leaderObstacles: restrictionOutsideObstacles.leaderObstacles,
      minClearanceRadius: R + 2,
      defaultLabelHeight: LABEL_LINE_HEIGHT_PX,
    },
    labelFontMode,
    restrictionOutsideObstacles.leaderTextObstacles,
    writeCircularOutsideLabel,
  );
  const missingGroupedRestrictionCandidates = restrictionOutsideCandidates.filter((candidate) => {
    const meta = restrictionOutsideMeta.get(candidate.id);
    const render = meta ? restrictionRenders.find((r) => r.clusterId === meta.targetId) : undefined;
    return Boolean(render && render.tickIds.length > 1 && !render.label);
  });
  if (missingGroupedRestrictionCandidates.length > 0) {
    // This pass is an ESCALATION: it re-places grouped clusters the ordinary pass
    // could not fit, ignoring feature labels as obstacles, then deletes whatever
    // feature labels they landed on. It buys enzyme names with feature names, so
    // it runs as a transaction and is kept only if the trade is worth making.
    // Measured before this guard: pET-28a(+) spent FIVE feature labels — its
    // promoter, operator, RBS, tag and terminator, the entire cloning site — to
    // gain TWO enzyme names, and pETDuet-1 spent four to gain one.
    const rescueTargetIds = new Set(
      missingGroupedRestrictionCandidates
        .map((candidate) => restrictionOutsideMeta.get(candidate.id)?.targetId)
        .filter((id): id is string => Boolean(id)),
    );
    const groupedRestrictionFallbackObstacles = circularRadialLabelObstacles({
      centerGuard,
      featureGlyphBoxes,
      featureRenders,
      restrictionRenders,
      restrictionDensityTicks,
      coordinates,
      labelFontMode,
      includeFeatureLabels: false,
    });
    placeCircularRadialLabels(
      missingGroupedRestrictionCandidates,
      restrictionOutsideMeta,
      {
        cx,
        cy,
        baseRadius: radialBaseRadius,
        radiusStep: RADIAL_LABEL_TIER_STEP,
        angularThresholdDeg: RADIAL_LABEL_ANGULAR_THRESHOLD_DEG,
        maxTier: radialGeometryMaxTier,
        maxPushes: radialGeometryMaxTier,
        allowGrouping: false,
        obstacles: groupedRestrictionFallbackObstacles.labelObstacles,
        leaderObstacles: groupedRestrictionFallbackObstacles.leaderObstacles,
        minClearanceRadius: R + 2,
        defaultLabelHeight: LABEL_LINE_HEIGHT_PX,
      },
      labelFontMode,
      groupedRestrictionFallbackObstacles.leaderTextObstacles,
      writeCircularOutsideLabel,
    );
    featureHiddenLabels += keepRescuedGroupedRestrictionLabelsWorthTheirCost(
      featureRenders,
      restrictionRenders,
      rescueTargetIds,
      labelFontMode,
    );
  }
  dropRestrictionLabelsConflictingWithFeatureLeaders(featureRenders, restrictionRenders, labelFontMode);
  if (showRestrictionLabels) {
    recHiddenLabels = restrictionRenders.reduce((n, r) => n + (r.label ? 0 : 1), 0);
  }

  const centerClearRadius = Math.max(
    0,
    (deepestVisibleBand?.innerR ?? fallbackVisibleInnerR) - CENTER_LABEL_PAD,
  );
  const overflowChipXOffset = Math.min(48, Math.max(0, centerClearRadius * 0.22));
  const overflowChipMaxYOffset = Math.max(0, centerClearRadius - LABEL_LINE_HEIGHT_PX * 1.8);
  const overflowChipMinY = centerGuard.maxY + LABEL_LINE_HEIGHT_PX + 4;
  const overflowChipMaxY = Math.max(overflowChipMinY, cy + overflowChipMaxYOffset);
  const overflowChipY = clamp(
    Math.max(overflowChipMinY, cy + Math.min(44, centerClearRadius * 0.38)),
    overflowChipMinY,
    overflowChipMaxY,
  );
  const overflowChipX = round(cx + overflowChipXOffset);
  const overflowChipBaseY = round(overflowChipY);
  const featureOverflowTotal = featureHiddenLabels + overflowFeatureCount;
  if (featureOverflowTotal > 0) {
    const text = `+${featureOverflowTotal} more`;
    overflows.push({
      id: 'circular-feature-overflow',
      kind: 'feature-labels',
      text,
      title: featureOverflowTitle(overflowFeatureCount, featureHiddenLabels, 'hidden'),
      hiddenBodies: overflowFeatureCount,
      unlabelled: featureHiddenLabels,
      x: overflowChipX,
      y: overflowChipBaseY,
      anchor: 'middle',
      hit: overflowHitRect(text, overflowChipX, overflowChipBaseY, 'middle', OVERFLOW_FONT_PX_CIRCULAR),
    });
  }
  const recHiddenSites = showRestrictionLabels
    ? restrictionRenders.reduce((n, r) => n + (r.label ? 0 : r.tickIds.length), 0)
    : 0;
  if (recHiddenSites > 0) {
    const text = `+${recHiddenSites} more sites`;
    const y = round(overflowChipBaseY + (featureOverflowTotal > 0 ? LABEL_LINE_HEIGHT_PX : 0));
    overflows.push({
      id: 'circular-restriction-overflow',
      kind: 'restriction-labels',
      text,
      title: `${recHiddenSites} restriction sites have hidden labels. All density ticks remain visible.`,
      // Every site keeps its density tick, so nothing here is undrawn — only unnamed.
      hiddenBodies: 0,
      unlabelled: recHiddenSites,
      x: overflowChipX,
      y,
      anchor: 'middle',
      hit: overflowHitRect(text, overflowChipX, y, 'middle', OVERFLOW_FONT_PX_CIRCULAR),
    });
  }

  const backbonePath = circlePath(cx, cy, R);
  const budgets = tallyBudgets(
    featureRenders,
    restrictionDensityTicks,
    restrictionRenders,
    coordinates,
    featureHiddenLabels + recHiddenLabels,
    packing.laneCount,
    overflowFeatureCount,
  );

  // Fit the viewBox to the ring + outer ticks + every placed label so long
  // outside/cluster labels never clip at the nominal viewport edge.
  const ringExtent = R + REC_TICK_INNER_OFFSET + REC_TICK_LEN;
  const coreBounds =
    adaptiveSteps > 0
      ? {
          minX: Math.min(0, cx - ringExtent),
          minY: 0,
          maxX: Math.max(layoutWidth, cx + ringExtent),
          maxY: layoutHeight,
        }
      : { minX: cx - ringExtent, minY: cy - ringExtent, maxX: cx + ringExtent, maxY: cy + ringExtent };
  const { viewBox, bg } = fitViewBox(
    coreBounds,
    featureRenders,
    restrictionRenders,
    coordinates,
    LABEL_BAND_MARGIN,
    adaptiveSteps === 0 ? { x: cx, y: cy } : undefined, // low-density box remains square + byte-stable
    labelFontMode,
  );

  return {
    mode: 'circular',
    width: layoutWidth,
    height: layoutHeight,
    viewBox,
    bg,
    center,
    radius,
    backbonePath,
    name: input.name,
    length: input.length,
    centerTitle,
    topology: input.topology,
    sequenceType: input.sequenceType,
    features: featureRenders,
    restrictionDensityTicks,
    restrictions: restrictionRenders,
    coordinates,
    ...(overflows.length > 0 ? { overflows } : {}),
    budgets,
  };
}

// =============================================================================
// Linear projection — horizontal ruler with stacked feature rows below.
// =============================================================================
function computeLinearLayout(input: MapInput): MapLayout {
  const { height, features, restrictionSites } = input;
  const width = Math.max(LINEAR_MIN_LAYOUT_WIDTH, input.width);
  const length = Math.max(0, input.length);
  const fillAvailableHeight = input.fillAvailableHeight === true;
  const display = input.display ?? {};
  const showFeatureLabels = display.showFeatureLabels !== false;
  const showRestrictionLabels = display.showRestrictionLabels !== false;
  const labelFontMode: LabelFontMode = display.labelFontMode ?? 'proportional';
  const labelWidth = (text: string, fontPx?: number) => approxTextWidth(text, fontPx, labelFontMode);
  const labelFitsInline = (text: string, extentPx: number, fontPx?: number) =>
    fitsInline(text, extentPx, fontPx, labelFontMode);

  const padX = LINEAR_PAD_X;
  const axisWidth = Math.max(1, width - 2 * padX);
  const x = (bp: number) => bpToX(bp, length, padX, axisWidth);
  const pxPerBp = length > 0 ? x(1) - x(0) : 0;

  // Lane packing over normalized segments. Linear-only: outside feature labels
  // reserve right-side room in bp-space so tiled labels trigger row stacking.
  const segByFeature = new Map<string, MapFeatureSegment[]>();
  const laneItems: LaneItem[] = [];
  for (const f of features) {
    // Segment against what the MOLECULE is, not how it is being drawn. The two
    // were the same value for as long as the only way to get a linear drawing
    // was to convert the record, so this hardcoded 'linear' never cost
    // anything. Drawing a circular molecule as a line makes them differ, and an
    // origin-spanning feature normalises to [] under 'linear' against
    // [{2600,2686},{0,120}] under 'circular'. Measured: the feature stayed in
    // the features array with segmentPaths [] and label null — present and
    // invisible, which a list-membership check reports as fine.
    const segs = featureSegments(f, length, input.topology);
    segByFeature.set(f.id, segs);
    if (segs.length > 0) {
      const name = f.name || f.type;
      const bodyPx = Math.max(...segs.map((s) => x(s.end) - x(s.start)));
      const needsOutsideLabel =
        showFeatureLabels && Boolean(name) && !labelFitsInline(name, bodyPx) && pxPerBp > 0;
      if (!needsOutsideLabel) {
        laneItems.push({ id: f.id, spans: segs });
      } else {
        const reservePx = Math.min(axisWidth, labelWidth(name));
        const labelBp = Math.ceil((reservePx + LINEAR_FEATURE_LABEL_GAP_X) / pxPerBp);
        const maxEndIndex = segs.reduce((best, s, i) => (s.end > segs[best].end ? i : best), 0);
        const minStartIndex = segs.reduce((best, s, i) => (s.start < segs[best].start ? i : best), 0);
        laneItems.push({
          id: f.id,
          spans: segs.map((s, i) => ({
            start: i === minStartIndex ? Math.max(0, round(s.start - labelBp)) : s.start,
            end: i === maxEndIndex ? Math.min(length, round(s.end + labelBp)) : s.end,
          })),
        });
      }
    }
  }
  const packing = packLanes(laneItems);
  const usableFeatureDepth = Math.max(
    LINEAR_ROW_MIN_HEIGHT,
    height - LINEAR_ROW_TOP - LINEAR_BOTTOM_PAD,
  );
  const laneMetrics = fitLinearLaneStack(
    packing.laneCount,
    usableFeatureDepth,
    LINEAR_ROW_HEIGHT,
    LINEAR_ROW_GAP,
    LINEAR_ROW_MIN_HEIGHT,
    LINEAR_ROW_MIN_GAP,
    fillAvailableHeight,
  );
  // Keep the linear viewBox content-sized. Dock fill affects row pitch above, but
  // the rendered dock centers this viewBox with SVG yMid meet so whitespace remains
  // balanced under resize instead of being baked into the layout coordinates.
  const contentOffsetY = 0;
  const linearY = (baseY: number): number => baseY + contentOffsetY;
  const rowTopY = linearY(LINEAR_ROW_TOP);
  const axisY = linearY(LINEAR_AXIS_Y);
  const coordLabelY = round(linearY(LINEAR_COORD_LABEL_Y));
  const coordGridTopY = round(linearY(LINEAR_COORD_GRID_TOP_Y));
  const recTickTopY = round(linearY(LINEAR_REC_TICK_TOP_Y));
  const recTickBottomY = round(linearY(LINEAR_REC_TICK_BOTTOM_Y));
  const recDensityTickTopY = round(linearY(LINEAR_REC_DENSITY_TICK_TOP_Y));
  const recLabelRowYs = [
    round(linearY(LINEAR_REC_LABEL_ROW_YS[0])),
    round(linearY(LINEAR_REC_LABEL_ROW_YS[1])),
  ] as const;
  const recBandBottomY = linearY(LINEAR_REC_BAND_BOTTOM);

  const rowBand = (lane: number): { top: number; mid: number; height: number } | null => {
    if (lane >= laneMetrics.visibleCount) return null;
    const top = rowTopY + lane * laneMetrics.pitch;
    return { top, mid: top + laneMetrics.size / 2, height: laneMetrics.size };
  };

  const visibleFeatureBottom =
    laneMetrics.visibleCount > 0
      ? rowTopY + (laneMetrics.visibleCount - 1) * laneMetrics.pitch + laneMetrics.size
      : recBandBottomY;
  const gridBottomY = round(Math.max(visibleFeatureBottom, recBandBottomY));
  const contentHeight = Math.max(recBandBottomY, visibleFeatureBottom) + LINEAR_BOTTOM_PAD;
  const viewHeight = round(contentHeight);

  type FeatureLabelCandidate = {
    id: string;
    lane: number;
    fullText: string;
    anchorY: number;
    y: number;
    sides: readonly FeatureLabelSideChoice[];
  };
  type FeatureLabelSide = 'left' | 'right';
  type FeatureLabelSideChoice = {
    side: FeatureLabelSide;
    anchor: Extract<MapLabelRender['anchor'], 'start' | 'end'>;
    edgeX: number;
  };
  type Interval = { id: string; x0: number; x1: number; box: BBox };

  const outsideByLane = new Map<number, FeatureLabelCandidate[]>();
  const occupiedLabelsByLane = new Map<number, Interval[]>();
  const pushInterval = (map: Map<number, Interval[]>, lane: number, interval: Interval): void => {
    const existing = map.get(lane);
    if (existing) existing.push(interval);
    else map.set(lane, [interval]);
  };
  const pushOutsideCandidate = (lane: number, candidate: FeatureLabelCandidate): void => {
    const existing = outsideByLane.get(lane);
    if (existing) existing.push(candidate);
    else outsideByLane.set(lane, [candidate]);
  };

  // --- Features: bounded flat rows; labels de-collide within each row.
  const featureRenders: MapFeatureRender[] = [];
  let overflowFeatureCount = 0;
  let hiddenFeatureLabelCount = 0;
  for (const f of features) {
    const segs = segByFeature.get(f.id) ?? [];
    const lane = packing.laneById.get(f.id);
    const displayStrand = toDisplayStrand(f.strand);
    const name = f.name || f.type;

    if (segs.length === 0 || lane === undefined) {
      featureRenders.push({
        id: f.id,
        name,
        type: f.type,
        displayStrand,
        color: f.color,
        lane: 0,
        segmentPaths: [],
        label: null,
        midBp: segs[0]?.start ?? 0,
      });
      continue;
    }

    const midBp = featureMidBp(segs, length);
    const title = featureTitle(name, f.type, segs, f.strand);
    const band = rowBand(lane);
    if (!band) {
      // Overflow row — counted ONCE, as a body the map does not draw. It used to be
      // counted here a second time as a dropped label, and since the chip prints
      // bodies + labels the same feature arrived twice in one number: a stack of 26
      // features with 25 pushed off the rows and 7 more drawn-but-unnamed printed
      // "+57" for 32 affected features. The label is not separately missing — there
      // is nothing drawn for it to name, and hiddenFeatureLabelCount is what the
      // circular pass already means by it (features drawn without a name).
      overflowFeatureCount += 1;
      featureRenders.push({
        id: f.id,
        name,
        type: f.type,
        displayStrand,
        color: f.color,
        lane,
        segmentPaths: [],
        label: null,
        midBp,
        title,
      });
      continue;
    }

    const yTop = band.top;
    const yMid = band.mid;
    const rowHeight = band.height;
    // Biological-order segments terminate at the final stored segment on both
    // strands; reverse direction points from that segment's left edge.
    const terminalIndex = displayStrand === 0 ? -1 : segs.length - 1;
    // How far the arrowhead TIP juts past the terminal segment body (0 when
    // directionless — no arrow is drawn). Shared by the glyph path below AND the
    // outside-label side choice, so the label gap clears the arrow tip, not just
    // the flat body edge.
    const terminalArrowLenPx =
      terminalIndex >= 0
        ? Math.min(
            rowHeight / 2,
            Math.abs(x(segs[terminalIndex].end) - x(segs[terminalIndex].start)),
          )
        : 0;
    const segmentVisualRanges: { startX: number; endX: number; width: number }[] = [];
    const segmentPaths = segs.map((s, i) => {
      const x0 = x(s.start);
      const rawW = x(s.end) - x0;
      const w = Math.max(MIN_FEATURE_PX, rawW);
      const radius = Math.min(LINEAR_FEATURE_RADIUS, rowHeight / 2);
      let visualStartX = x0;
      let visualEndX = x0 + w;
      if (i === terminalIndex && displayStrand === 1) visualEndX += terminalArrowLenPx;
      else if (i === terminalIndex && displayStrand === -1) visualStartX -= terminalArrowLenPx;
      segmentVisualRanges.push({
        startX: visualStartX,
        endX: visualEndX,
        width: Math.max(0, visualEndX - visualStartX),
      });
      if (i === terminalIndex) {
        return describeLinearFeatureArrowPath(
          x0,
          yTop,
          w,
          rowHeight,
          radius,
          displayStrand as 1 | -1,
          terminalArrowLenPx,
        );
      }
      return roundedRectPath(x0, yTop, w, rowHeight, radius);
    });
    const maxSegW = Math.max(...segmentVisualRanges.map((s) => s.width));

    let label: MapLabelRender | null = null;
    if (showFeatureLabels && name) {
      const textW = labelWidth(name);
      if (labelFitsInline(name, maxSegW)) {
        const largest = segmentVisualRanges.reduce((a, b) => (b.width > a.width ? b : a));
        const labelX = (largest.startX + largest.endX) / 2;
        label = {
          text: name,
          x: round(labelX),
          y: round(yMid),
          anchor: 'middle',
          baseline: LINEAR_FEATURE_LABEL_BASELINE,
          rotate: 0,
          leader: [],
          inside: true,
        };
        pushInterval(occupiedLabelsByLane, lane, {
          id: f.id,
          x0: labelX - textW / 2,
          x1: labelX + textW / 2,
          box: labelBBoxAt(label.x, label.y, label.anchor, textW, label.baseline),
        });
      } else {
        const startX = Math.min(...segs.map((s) => x(s.start)));
        const endX = Math.max(...segs.map((s) => x(s.end)));
        const sideChoice = (side: FeatureLabelSide): FeatureLabelSideChoice => {
          // The arrowhead only juts out on the side the feature POINTS toward
          // (right for forward strand=1, left for reverse strand=-1); the flat 5'
          // back keeps the body edge. Push edgeX to the true visual tip on that
          // side so the LINEAR_FEATURE_LABEL_GAP_X gap clears the glyph, not the body.
          const pointsThisSide =
            (side === 'right' && displayStrand === 1) ||
            (side === 'left' && displayStrand === -1);
          const tip = pointsThisSide ? terminalArrowLenPx : 0;
          const edgeX = round(side === 'right' ? endX + tip : startX - tip);
          return {
            side,
            anchor: side === 'right' ? 'start' : 'end',
            edgeX,
          };
        };
        const rightChoice = sideChoice('right');
        const leftChoice = sideChoice('left');
        const preferred =
          displayStrand === 1
            ? rightChoice
            : displayStrand === -1
              ? leftChoice
              : rightChoice;
        const alternate = preferred.side === 'right' ? leftChoice : rightChoice;
        pushOutsideCandidate(lane, {
          id: f.id,
          lane,
          fullText: name,
          anchorY: yMid - Math.min(LINEAR_FEATURE_LEADER_RISE, rowHeight / 2),
          y: yMid,
          sides: [preferred, alternate],
        });
      }
    }

    featureRenders.push({
      id: f.id,
      name,
      type: f.type,
      displayStrand,
      color: f.color,
      lane,
      segmentPaths,
      label,
      midBp,
      title,
    });
  }

  function placeLinearOutsideFeatureLabels(): number {
    let hidden = 0;
    const occupiedByLane = new Map<number, Interval[]>();
    const occupiedForLane = (lane: number): Interval[] => {
      let occupied = occupiedByLane.get(lane);
      if (!occupied) {
        occupied = [...(occupiedLabelsByLane.get(lane) ?? [])].sort(
          (a, b) => a.x0 - b.x0 || a.x1 - b.x1 || cmpKey(a.id, b.id),
        );
        occupiedByLane.set(lane, occupied);
      }
      return occupied;
    };
    const pushOccupied = (lane: number, interval: Interval): void => {
      const occupied = occupiedForLane(lane);
      occupied.push(interval);
      occupied.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1 || cmpKey(a.id, b.id));
    };
    const featureBodyBoxesByLane = new Map<number, { id: string; box: BBox }[]>();
    const pushFeatureBodyBox = (lane: number, item: { id: string; box: BBox }): void => {
      const existing = featureBodyBoxesByLane.get(lane);
      if (existing) existing.push(item);
      else featureBodyBoxesByLane.set(lane, [item]);
    };
    for (const render of featureRenders) {
      const band = rowBand(render.lane);
      const segs = segByFeature.get(render.id) ?? [];
      if (!band || render.segmentPaths.length === 0 || segs.length === 0) continue;
      for (const seg of segs) {
        const x0 = x(seg.start);
        const w = Math.max(MIN_FEATURE_PX, x(seg.end) - x0);
        pushFeatureBodyBox(render.lane, {
          id: render.id,
          box: {
            minX: Math.min(x0, x0 + w),
            minY: band.top,
            maxX: Math.max(x0, x0 + w),
            maxY: band.top + band.height,
          },
        });
      }
    }
    const overlapsOccupied = (lane: number, interval: Interval): boolean =>
      occupiedForLane(lane).some(
        (iv) =>
          iv.id !== interval.id &&
          Math.min(iv.x1, interval.x1) - Math.max(iv.x0, interval.x0) >
            -LINEAR_LABEL_MIN_GAP_PX + 1e-6,
      );
    const linearFeatureSideLabelBudget = (
      lane: number,
      ownId: string,
      side: FeatureLabelSideChoice,
    ): number => {
      if (side.side === 'right') {
        const textLeft = side.edgeX + LINEAR_FEATURE_LABEL_GAP_X;
        let limit = width - padX;
        for (const obstacle of featureBodyBoxesByLane.get(lane) ?? []) {
          if (obstacle.id !== ownId && obstacle.box.minX >= side.edgeX - 1e-6) {
            limit = Math.min(limit, obstacle.box.minX - LINEAR_LABEL_MIN_GAP_PX);
          }
        }
        for (const obstacle of occupiedForLane(lane)) {
          if (obstacle.id !== ownId && obstacle.x0 >= side.edgeX - 1e-6) {
            limit = Math.min(limit, obstacle.x0 - LINEAR_LABEL_MIN_GAP_PX);
          }
        }
        return Math.max(0, limit - textLeft);
      }

      const textRight = side.edgeX - LINEAR_FEATURE_LABEL_GAP_X;
      let limit = padX;
      for (const obstacle of featureBodyBoxesByLane.get(lane) ?? []) {
        if (obstacle.id !== ownId && obstacle.box.maxX <= side.edgeX + 1e-6) {
          limit = Math.max(limit, obstacle.box.maxX + LINEAR_LABEL_MIN_GAP_PX);
        }
      }
      for (const obstacle of occupiedForLane(lane)) {
        if (obstacle.id !== ownId && obstacle.x1 <= side.edgeX + 1e-6) {
          limit = Math.max(limit, obstacle.x1 + LINEAR_LABEL_MIN_GAP_PX);
        }
      }
      return Math.max(0, textRight - limit);
    };
    const restrictionLabelBoxes = (): { id: string; box: BBox }[] =>
      restrictionRenders
        .filter((r) => r.label)
        .map((r) => ({
          id: r.clusterId,
          box: labelBBoxAt(
            r.label!.x,
            r.label!.y,
            r.label!.anchor,
            approxTextWidth(r.label!.text, undefined, labelFontMode),
            r.label!.baseline,
          ),
        }));
    const occupiedLabelBoxes = (): { id: string; box: BBox }[] =>
      [...occupiedByLane.values()].flatMap((intervals) =>
        intervals.map((iv) => ({ id: iv.id, box: iv.box })),
      );
    const textObstacles = (ownId: string): { id: string; box: BBox }[] => [
      ...occupiedLabelBoxes().filter((o) => o.id !== ownId),
      ...restrictionLabelBoxes(),
    ];
    const clearOfFeatureBodyObstacles = (box: BBox, ownId: string, lane: number): boolean =>
      (featureBodyBoxesByLane.get(lane) ?? []).every(
        (other) => other.id === ownId || !bboxIntersects(expandBBox(box, LINEAR_LABEL_MIN_GAP_PX), other.box),
      );
    const labelAnchorXForCenter = (
      center: number,
      entry: { halfW: number; side: FeatureLabelSideChoice },
    ): number => {
      const raw = entry.side.side === 'right' ? center - entry.halfW : center + entry.halfW;
      return round(raw);
    };
    const labelBoxForCenter = (
      center: number,
      entry: { halfW: number; width: number; y: number; side: FeatureLabelSideChoice },
    ): BBox =>
      labelBBoxAt(
        labelAnchorXForCenter(center, entry),
        round(entry.y),
        entry.side.anchor,
        entry.width,
        LINEAR_FEATURE_LABEL_BASELINE,
      );
    const sideGapForCenter = (
      center: number,
      entry: { halfW: number; side: FeatureLabelSideChoice },
    ): number => {
      const labelX = labelAnchorXForCenter(center, entry);
      return entry.side.side === 'right' ? labelX - entry.side.edgeX : entry.side.edgeX - labelX;
    };
    const clearOfTextObstacles = (box: BBox, ownId: string): boolean =>
      textObstacles(ownId).every((other) => !bboxIntersects(expandBBox(box, LINEAR_LABEL_MIN_GAP_PX), other.box));
    const leaderClearsText = (
      leader: readonly Pt[],
      ownId: string,
    ): boolean =>
      leader.length < 2 ||
      textObstacles(ownId).every((other) => !polylineIntersectsBBox(leader, other.box));

    const entries = [...outsideByLane.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, cands] of entries) {
      type RowEntry = FeatureLabelCandidate & {
        key: string;
        tickX: number;
        priority: number;
        side: FeatureLabelSideChoice;
        idealCenterX: number;
        text: string;
        width: number;
        halfW: number;
      };
      const dropped = new Set<string>();
      const orderCandidateSides = (cand: FeatureLabelCandidate): readonly FeatureLabelSideChoice[] => {
        const [preferred, alternate] = cand.sides;
        if (!alternate) return cand.sides;
        const preferredBudget = linearFeatureSideLabelBudget(cand.lane, cand.id, preferred);
        const alternateBudget = linearFeatureSideLabelBudget(cand.lane, cand.id, alternate);
        const fullWidth = labelWidth(cand.fullText);
        if (preferredBudget >= fullWidth) return cand.sides;
        if (alternateBudget >= fullWidth || alternateBudget > preferredBudget + 1) return [alternate, preferred];
        return cand.sides;
      };
      const sideOrder = new Map(cands.map((cand) => [cand.id, orderCandidateSides(cand)]));
      const sidesFor = (cand: FeatureLabelCandidate): readonly FeatureLabelSideChoice[] =>
        sideOrder.get(cand.id) ?? cand.sides;
      const sideIndex = new Map(cands.map((cand) => [cand.id, 0]));
      const makeRows = (): RowEntry[] => cands
        .slice()
        .filter((cand) => !dropped.has(cand.id))
        .map((cand, i, row) => {
          const side = sidesFor(cand)[sideIndex.get(cand.id) ?? 0];
          const availableWidth = linearFeatureSideLabelBudget(cand.lane, cand.id, side);
          const outsideLabel = ellipsizeToWidth(cand.fullText, availableWidth, labelFontMode);
          const halfW = outsideLabel.width / 2;
          const idealCenterX = side.side === 'right'
            ? side.edgeX + LINEAR_FEATURE_LABEL_GAP_X + halfW
            : side.edgeX - LINEAR_FEATURE_LABEL_GAP_X - halfW;
          return {
            ...cand,
            key: cand.id,
            side,
            idealCenterX,
            text: outsideLabel.text,
            width: outsideLabel.width,
            halfW,
            tickX: idealCenterX,
            priority: 1000 - outsideLabel.width + (row.length - i) / 1000,
          };
        })
        .sort((a, b) => a.tickX - b.tickX || cmpKey(a.id, b.id));
      const placeFeatureOutsideRow = (entries: readonly RowEntry[]): Map<string, number> => new Map(
        entries.map((entry) => [
          entry.key,
          clamp(entry.idealCenterX, padX + entry.halfW, width - padX - entry.halfW),
        ]),
      );
      let all = makeRows();
      let kept = dropLowestUntilRowFits(all, width - 2 * padX, LINEAR_FEATURE_LABEL_GAP_X);
      let placed = placeFeatureOutsideRow(kept);

      const markBad = (entry: RowEntry): void => {
        const current = sideIndex.get(entry.id) ?? 0;
        if (current + 1 < sidesFor(entry).length) sideIndex.set(entry.id, current + 1);
        else dropped.add(entry.id);
      };
      for (;;) {
        const plannedBoxes = kept.flatMap((e) => {
          const center = placed.get(e.key);
          return center === undefined
            ? []
            : [{ id: e.id, box: labelBoxForCenter(center, e) }];
        });
        let bad: RowEntry | null = null;
        let badScore = -Infinity;
        for (const e of kept) {
          const center = placed.get(e.key);
          if (center === undefined) continue;
          const labelX = labelAnchorXForCenter(center, e);
          const labelBox = labelBoxForCenter(center, e);
          const leader = linearFeatureLeader(e.side.edgeX, labelX, e.anchorY, round(e.y));
          const sideGap = sideGapForCenter(center, e);
          const leaderDx = Math.abs(labelX - e.side.edgeX);
          const invalid =
            e.text.length === 0 ||
            e.width <= 0 ||
            sideGap < LINEAR_LABEL_MIN_GAP_PX - 1e-6 ||
            leaderDx > LINEAR_FEATURE_LABEL_MAX_LEADER_DX + 1e-6 ||
            overlapsOccupied(e.lane, { id: e.id, x0: labelBox.minX, x1: labelBox.maxX, box: labelBox }) ||
            plannedBoxes.some((other) => other.id !== e.id && bboxIntersects(expandBBox(labelBox, LINEAR_LABEL_MIN_GAP_PX), other.box)) ||
            !clearOfFeatureBodyObstacles(labelBox, e.id, e.lane) ||
            !clearOfTextObstacles(labelBox, e.id) ||
            !leaderClearsText(leader, e.id) ||
            (leader.length >= 2 &&
              plannedBoxes.some((other) => other.id !== e.id && polylineIntersectsBBox(leader, other.box)));
          const score = Math.max(
            LINEAR_LABEL_MIN_GAP_PX - sideGap,
            leaderDx - LINEAR_FEATURE_LABEL_MAX_LEADER_DX,
            0,
          );
          if (
            invalid &&
            (score > badScore ||
              !bad ||
              (score === badScore && e.priority < bad.priority) ||
              (score === badScore && e.priority === bad.priority && e.width > bad.width) ||
              (score === badScore && e.priority === bad.priority && e.width === bad.width && e.key > bad.key))
          ) {
            bad = e;
            badScore = score;
          }
        }
        if (!bad) break;
        markBad(bad);
        all = makeRows();
        kept = dropLowestUntilRowFits(all, width - 2 * padX, LINEAR_FEATURE_LABEL_GAP_X);
        placed = placeFeatureOutsideRow(kept);
      }

      const keptIds = new Set(kept.map((e) => e.key));
      hidden += cands.length - keptIds.size;

      for (const cand of makeRows()) {
        const render = featureRenders.find((r) => r.id === cand.id);
        if (!render || !keptIds.has(cand.key)) {
          if (render) render.label = null;
          continue;
        }
        const center = placed.get(cand.key);
        if (center === undefined) {
          render.label = null;
          hidden += 1;
          continue;
        }

        const labelX = labelAnchorXForCenter(center, cand);
        const labelY = round(cand.y);
        const labelBox = labelBoxForCenter(center, cand);
        const interval = { id: cand.id, x0: labelBox.minX, x1: labelBox.maxX, box: labelBox };
        if (overlapsOccupied(cand.lane, interval)) {
          render.label = null;
          hidden += 1;
          continue;
        }

        const leader = linearFeatureLeader(cand.side.edgeX, labelX, cand.anchorY, labelY);
        if (
          cand.text.length === 0 ||
          cand.width <= 0 ||
          sideGapForCenter(center, cand) < LINEAR_LABEL_MIN_GAP_PX - 1e-6 ||
          !clearOfFeatureBodyObstacles(labelBox, cand.id, cand.lane) ||
          !clearOfTextObstacles(labelBox, cand.id) ||
          !leaderClearsText(leader, cand.id)
        ) {
          render.label = null;
          hidden += 1;
          continue;
        }

        render.label = {
          text: cand.text,
          x: labelX,
          y: labelY,
          anchor: cand.side.anchor,
          baseline: LINEAR_FEATURE_LABEL_BASELINE,
          rotate: 0,
          leader,
          inside: false,
        };
        pushOccupied(cand.lane, interval);
      }
    }

    return hidden;
  }

  // --- Restriction clusters: fixed tick band, two staggered horizontal label rows.
  const minSepBp = Math.max(1, Math.round((length * REC_CLUSTER_MIN_SEP_PX) / axisWidth));
  const { ticks: restrictionTicks, clusters } = buildRestrictionClusters(restrictionSites, length, {
    minSepBp,
    maxClusterSpanBp: REC_CLUSTER_MAX_SPAN_BP,
    maxNamesPerCluster: REC_MAX_NAMES,
    circular: false,
  });

  const restrictionDensityTicks: MapRestrictionDensityTick[] = restrictionTicks.map((t, i) => {
    const xc = x(t.position);
    return {
      id: `redt-${i}-${t.id}`,
      anchorBp: t.position,
      tick: {
        x1: round(xc),
        y1: recDensityTickTopY,
        x2: round(xc),
        y2: recTickBottomY,
      },
    };
  });
  const restrictionRenders: MapRestrictionRender[] = [];
  const overflows: MapOverflowRender[] = [];

  clusters.forEach((c) => {
    const xc = x(c.anchorBp);
    restrictionRenders.push({
      clusterId: c.id,
      tick: {
        x1: round(xc),
        y1: recTickTopY,
        x2: round(xc),
        y2: recTickBottomY,
      },
      label: null,
      hasTypeIIS: c.hasTypeIIS,
      tickIds: c.ticks.map((t) => t.id),
      anchorBp: c.anchorBp,
      positions: clusterPositions(c),
      title: restrictionTitle(c),
    });
  });

  function placeLinearRestrictionLabels(
    cap: number,
    reserveOverflow: boolean,
  ): { hiddenLabels: number; hiddenSites: number } {
    // Labels stay whole within [loX, hiX]; each label's CENTER is boxed by its own
    // half-width (below), so a wide label near the edge still fits — the old fixed
    // 64px half wall over-reserved and forced needless spreading.
    const loX = padX;
    const hiX = width - padX - (reserveOverflow ? LINEAR_REC_OVERFLOW_RESERVE_PX : 0);

    const ranked = clusters
      .map((c, i) => ({
        key: c.id,
        primary: x(c.anchorBp),
        priority:
          (c.ticks.length === 1 ? 2000 : 1000 - c.ticks.length) +
          (c.hasTypeIIS ? 50 : 0) +
          (clusters.length - i) / 1000,
      }))
      .sort((a, b) => b.priority - a.priority || cmpKey(a.key, b.key));

    const keep = selectSpacedRestrictionClusterIds(clusters, cap, length, false);
    const priorityOf = (id: string): number => ranked.find((r) => r.key === id)?.priority ?? 0;

    // Row entries in TICK-X order. i%2 staggers adjacent (close) ticks into the two
    // rows, halving per-row density; within a row the left-to-right order is fixed,
    // so a further-right label always gets a further-right slot — leaders stay
    // monotonic (they never cross) once each label is pulled toward its own tick.
    type RowEntry = { key: string; tickX: number; text: string; halfW: number; priority: number };
    const rows: RowEntry[][] = [[], []];
    clusters
      .filter((c) => keep.has(c.id))
      .sort((a, b) => x(a.anchorBp) - x(b.anchorBp) || cmpKey(a.id, b.id))
      .forEach((c, i) => {
        const text = compactLinearClusterText(c);
        rows[i % 2].push({
          key: c.id,
          tickX: x(c.anchorBp),
          text,
          halfW: approxTextWidth(text) / 2,
          priority: priorityOf(c.id),
        });
      });

    for (const row of [0, 1] as const) {
      const all = rows[row];
      // Width-aware min-displacement placement. The cap keeps rows within capacity,
      // but guard anyway: if a row can't fit, drop its lowest-priority labels (ticks
      // stay). Placement then pulls every remaining label as close to its tick as the
      // no-overlap + in-order constraints allow → short, near-vertical, non-crossing.
      const kept = dropLowestUntilRowFits(all, hiX - loX, LINEAR_REC_LABEL_MIN_GAP);
      const rowWidth = restrictionRowWidth(kept, LINEAR_REC_LABEL_MIN_GAP);
      const rowSlack = Math.max(0, hiX - loX - rowWidth);
      const lowerRowPhase =
        row === 1 && kept.length > 0
          ? Math.min(rowSlack, kept[0].halfW + LINEAR_REC_LABEL_MIN_GAP / 2)
          : 0;
      const placed = placeRestrictionRow(kept, loX + lowerRowPhase, hiX, LINEAR_REC_LABEL_MIN_GAP);

      for (const e of all) {
        const render = restrictionRenders.find((r) => r.clusterId === e.key);
        if (!render) continue;
        const center = placed.get(e.key);
        if (center === undefined) {
          render.label = null;
          continue;
        }
        const labelX = round(center);
        const labelY = round(recLabelRowYs[row] + LINEAR_REC_LABEL_CENTER_OFFSET);
        const leaderTouchY = round(labelY - LINEAR_REC_LABEL_CENTER_OFFSET - LINEAR_REC_LABEL_TOUCH_GAP);
        const anchorX = round(e.tickX);
        render.label = {
          text: e.text,
          x: labelX,
          y: labelY,
          anchor: 'middle',
          baseline: 'middle',
          rotate: 0,
          leader: linearRestrictionLeader(anchorX, labelX, recTickBottomY, leaderTouchY),
          inside: false,
        };
      }
    }

    const labelBoxes = restrictionRenders
      .filter((r) => r.label)
      .map((r) => ({
        id: r.clusterId,
        box: labelBBoxAt(
          r.label!.x,
          r.label!.y,
          r.label!.anchor,
          approxTextWidth(r.label!.text, undefined, labelFontMode),
          r.label!.baseline,
        ),
      }));
    for (const render of restrictionRenders) {
      const label = render.label;
      if (!label || label.leader.length < 2) continue;
      const crossesAnotherLabel = labelBoxes.some(
        (other) => other.id !== render.clusterId && polylineIntersectsBBox(label.leader, other.box),
      );
      if (crossesAnotherLabel) render.label = null;
    }

    return {
      hiddenLabels: clusters.reduce((n, c) => {
        const render = restrictionRenders.find((r) => r.clusterId === c.id);
        return n + (render?.label ? 0 : 1);
      }, 0),
      hiddenSites: clusters.reduce((n, c) => {
        const render = restrictionRenders.find((r) => r.clusterId === c.id);
        return n + (render?.label ? 0 : c.ticks.length);
      }, 0),
    };
  }

  const recCapNoReserve = showRestrictionLabels ? linearRecCap(axisWidth, clusters.length, display, false) : 0;
  const reserveRestrictionOverflow = showRestrictionLabels && recCapNoReserve < clusters.length;
  const recCap = showRestrictionLabels
    ? linearRecCap(axisWidth, clusters.length, display, reserveRestrictionOverflow)
    : 0;
  const recHidden = showRestrictionLabels
    ? placeLinearRestrictionLabels(recCap, reserveRestrictionOverflow)
    : { hiddenLabels: 0, hiddenSites: 0 };

  hiddenFeatureLabelCount += placeLinearOutsideFeatureLabels();

  if (recHidden.hiddenSites > 0) {
    const text = `+${recHidden.hiddenSites} more sites`;
    const chipX = round(width - padX);
    const chipY = round(recLabelRowYs[1] + LINEAR_REC_LABEL_CENTER_OFFSET);
    overflows.push({
      id: 'linear-restriction-overflow',
      kind: 'restriction-labels',
      text,
      title: `${recHidden.hiddenSites} restriction sites have hidden labels. All density ticks remain visible.`,
      // Every site keeps its density tick, so nothing here is undrawn — only unnamed.
      hiddenBodies: 0,
      unlabelled: recHidden.hiddenSites,
      x: chipX,
      y: chipY,
      anchor: 'end',
      hit: overflowHitRect(text, chipX, chipY, 'end', OVERFLOW_FONT_PX),
    });
  }

  const featureOverflowTotal = overflowFeatureCount + hiddenFeatureLabelCount;
  if (featureOverflowTotal > 0) {
    const text = `+${featureOverflowTotal}`;
    const chipX = round(width - 2);
    const chipY = round(rowTopY + LABEL_LINE_HEIGHT_PX);
    overflows.push({
      id: 'linear-feature-overflow',
      kind: 'feature-labels',
      text,
      title: featureOverflowTitle(overflowFeatureCount, hiddenFeatureLabelCount, 'dropped'),
      hiddenBodies: overflowFeatureCount,
      unlabelled: hiddenFeatureLabelCount,
      x: chipX,
      y: chipY,
      anchor: 'end',
      hit: overflowHitRect(text, chipX, chipY, 'end', OVERFLOW_FONT_PX),
    });
  }

  // --- Coordinate ruler: nice round bp ticks with labels above the top axis.
  const coordinates: MapCoordinateTick[] = [];
  const step = Math.max(1, niceStep(length / TARGET_COORD_TICKS));
  const coordTickBottomY = axisY + LINEAR_COORD_TICK_LEN;
  for (let bp = 0; bp < length; bp += step) {
    const xc = x(bp);
    coordinates.push({
      bp,
      major: true,
      tick: { x1: round(xc), y1: round(axisY), x2: round(xc), y2: round(coordTickBottomY) },
      grid: {
        x1: round(xc),
        y1: coordGridTopY,
        x2: round(xc),
        y2: gridBottomY,
      },
      label: { text: String(bp), x: round(xc), y: coordLabelY, anchor: 'middle' },
    });
  }

  const backbonePath = `M ${round(padX)} ${round(axisY)} L ${round(width - padX)} ${round(axisY)}`;
  const linearAxis = {
    startX: round(padX),
    endX: round(width - padX),
    width: round(axisWidth),
    y: round(axisY),
  };
  const budgets = tallyBudgets(
    featureRenders,
    restrictionDensityTicks,
    restrictionRenders,
    coordinates,
    recHidden.hiddenLabels + hiddenFeatureLabelCount,
    packing.laneCount,
    overflowFeatureCount,
  );

  const viewBox = `0 0 ${round(width)} ${viewHeight}`;
  const bg = { x: 0, y: 0, width: round(width), height: viewHeight };

  return {
    mode: 'linear',
    width,
    height,
    viewBox,
    bg,
    center: { x: linearAxis.startX, y: linearAxis.y },
    radius: 0,
    backbonePath,
    linearAxis,
    name: input.name,
    length: input.length,
    topology: input.topology,
    sequenceType: input.sequenceType,
    features: featureRenders,
    restrictionDensityTicks,
    restrictions: restrictionRenders,
    coordinates,
    ...(overflows.length > 0 ? { overflows } : {}),
    budgets,
  };
}

// =============================================================================
// Shared helpers.
// =============================================================================

/** Per-BLUEPRINT display strand: -1 stays reverse, 0 stays directionless, else fwd. */
function toDisplayStrand(raw: FeatureStrand): FeatureStrand {
  return raw === -1 ? -1 : raw === 0 ? 0 : 1;
}

const RAD2DEG = 180 / Math.PI;
/** Arc length (px) at `radius` expressed as a swept angle in degrees. */
function arcDeltaDeg(arcLenPx: number, radius: number): number {
  return radius > 0 ? (arcLenPx / radius) * RAD2DEG : 0;
}

function circularLanePadBp(length: number, radius: number, padPx: number): number {
  if (!(length > 0) || !(radius > 0) || !(padPx > 0)) return 0;
  return Math.max(1, Math.ceil((padPx / (2 * Math.PI * radius)) * length));
}

function expandCircularLaneSpans(
  spans: readonly MapSpan[],
  length: number,
  padBp: number,
): MapSpan[] {
  if (!(length > 0) || padBp <= 0) return spans.slice();
  const out: MapSpan[] = [];
  for (const span of spans) {
    const spanLen = Math.max(0, span.end - span.start) + padBp * 2;
    if (spanLen >= length) return [{ start: 0, end: length }];
    const start = mod(span.start - padBp, length);
    const end = start + spanLen;
    if (end <= length) {
      out.push({ start, end });
    } else {
      out.push({ start, end: length }, { start: 0, end: end - length });
    }
  }
  return out;
}

export interface LaneMetrics {
  /** lanes that get a drawn band (0..visibleCount-1). */
  visibleCount: number;
  /** lanes beyond capacity -> overflow (arc-less, title-only, counted in budgets). */
  hiddenCount: number;
  /** band thickness (radial px circular / vertical px linear) for every visible lane. */
  size: number;
  /** gap between consecutive visible lanes (0 when a single lane). */
  gap: number;
  /** centre-to-centre spacing = size + gap; ALWAYS > 0 so lanes never share a coord. */
  pitch: number;
}

/**
 * Fit `laneCount` stacked bands into `availableDepth`. Compress size+gap from the
 * target toward the floor BEFORE dropping any lane; only when even the floor stack
 * overflows do we cap `visibleCount` and report the remainder as `hiddenCount`
 * (surfaced via budgets, never silently dropped). Pure + deterministic.
 *
 * Guarantees for the returned VISIBLE stack (given sane floors minSize>=1):
 *  - size >= max(1, minSize); gap is 0 (single lane) or >= max(0, minGap);
 *  - pitch > 0, so consecutive lanes ALWAYS get distinct coordinates (kills the
 *    lane-collapse bug where deep lanes clamped to one shared radius);
 *  - at least one lane always draws (kept within the ring), even in a tiny viewport.
 * Sanitizes non-finite / inverted inputs up front so a corrupt size can never leak
 * a NaN pitch into geometry (adversarial-review hardening).
 */
export function fitLaneStack(
  laneCount: number,
  availableDepth: number,
  targetSize: number,
  targetGap: number,
  minSize: number,
  minGap: number,
): LaneMetrics {
  const count = Number.isFinite(laneCount) ? Math.max(0, Math.floor(laneCount)) : 0;
  const floorSize = Math.max(1, Number.isFinite(minSize) ? minSize : 1);
  const idealSize = Math.max(floorSize, Number.isFinite(targetSize) ? targetSize : floorSize);
  if (count === 0) {
    return { visibleCount: 0, hiddenCount: 0, size: idealSize, gap: 0, pitch: idealSize };
  }
  // Always fit at least one floor-height lane; a hair of overdraw in a sub-floor
  // viewport still renders inside the ring and beats drawing nothing.
  const depth = Math.max(floorSize, Number.isFinite(availableDepth) ? availableDepth : floorSize);
  const gaps = count - 1;
  const floorGap = gaps > 0 ? Math.max(0, Number.isFinite(minGap) ? minGap : 0) : 0;
  const idealGap = gaps > 0 ? Math.max(floorGap, Number.isFinite(targetGap) ? targetGap : 0) : 0;

  const targetDepth = count * idealSize + gaps * idealGap;
  if (targetDepth <= depth) {
    return { visibleCount: count, hiddenCount: 0, size: idealSize, gap: idealGap, pitch: idealSize + idealGap };
  }
  const minDepth = count * floorSize + gaps * floorGap;
  if (minDepth <= depth) {
    // Everything fits at >= floor: scale down proportionally, then repair floors
    // while keeping the stack exactly filling `depth`.
    const scale = depth / targetDepth;
    let size = idealSize * scale;
    let gap = gaps > 0 ? idealGap * scale : 0;
    if (size < floorSize) {
      size = floorSize;
      gap = gaps > 0 ? (depth - count * size) / gaps : 0;
    }
    if (gaps > 0 && gap < floorGap) {
      gap = floorGap;
      size = (depth - gaps * gap) / count;
    }
    return { visibleCount: count, hiddenCount: 0, size, gap, pitch: size + gap };
  }
  // Even the floor stack overflows -> cap the visible count; the rest overflow.
  const denom = floorSize + floorGap;
  const visibleCount = Math.max(1, Math.floor((depth + floorGap) / denom));
  const vGaps = visibleCount - 1;
  return {
    visibleCount,
    hiddenCount: count - visibleCount,
    size: floorSize,
    gap: vGaps > 0 ? floorGap : 0,
    pitch: floorSize + (vGaps > 0 ? floorGap : 0),
  };
}

function fitLinearLaneStack(
  laneCount: number,
  availableDepth: number,
  targetSize: number,
  targetGap: number,
  minSize: number,
  minGap: number,
  fillAvailableHeight: boolean,
): LaneMetrics {
  const count = Number.isFinite(laneCount) ? Math.max(0, Math.floor(laneCount)) : 0;
  const depth = Number.isFinite(availableDepth) ? Math.max(0, availableDepth) : 0;
  const size = Math.max(1, Number.isFinite(targetSize) ? targetSize : 1);
  const idealGap = Math.max(0, Number.isFinite(targetGap) ? targetGap : 0);
  const targetDepth = count * size + Math.max(0, count - 1) * idealGap;

  if (count > 1 && targetDepth <= depth) {
    const expandedGap = Math.max(idealGap, (depth - count * size) / (count - 1));
    const gap = fillAvailableHeight
      ? Math.min(expandedGap, Math.max(idealGap, LINEAR_LANE_PITCH_MAX - size))
      : expandedGap;
    return { visibleCount: count, hiddenCount: 0, size, gap, pitch: size + gap };
  }

  return fitLaneStack(laneCount, availableDepth, targetSize, targetGap, minSize, minGap);
}

function circularAdaptiveSteps(featureCount: number): number {
  const count = Number.isFinite(featureCount) ? Math.max(0, Math.floor(featureCount)) : 0;
  if (count <= CIRCULAR_ADAPTIVE_START_FEATURES) return 0;
  return Math.ceil((count - CIRCULAR_ADAPTIVE_START_FEATURES) / CIRCULAR_ADAPTIVE_FEATURE_STEP);
}

function circularFeatureLabelBudget(featureCount: number, display: MapDisplayOptions): number {
  if (typeof display.maxFeatureLabels === 'number') {
    return Math.max(0, Math.floor(display.maxFeatureLabels));
  }
  const density = display.labelDensity ?? 'auto';
  const autoBudget =
    density === 'low'
      ? 24
      : density === 'medium'
        ? 30
        : density === 'high'
          ? 48
          : CIRCULAR_AUTO_FEATURE_LABEL_BUDGET;
  return Math.max(0, Math.min(Math.max(0, Math.floor(featureCount)), autoBudget));
}

function circularFeatureRadialMaxTier(baseMaxTier: number, outsideLabelCount: number): number {
  const base = Math.max(0, Math.floor(baseMaxTier));
  const count = Math.max(0, Math.floor(outsideLabelCount));
  if (count <= 0) return base;
  const densityTier = Math.ceil(count / 4);
  return Math.max(base, Math.min(8, densityTier));
}

function circularFeatureLabelPriority(
  feature: MapInput['features'][number],
  segs: readonly MapFeatureSegment[],
  length: number,
): number {
  const spanBp = segmentTotalLength(segs);
  const spanShare = length > 0 ? Math.min(1, spanBp / length) : 0;
  const typeWeight = CIRCULAR_FEATURE_TYPE_PRIORITY[feature.type] ?? CIRCULAR_FEATURE_TYPE_PRIORITY.misc_feature;
  return spanShare * 1_000_000 + typeWeight * 100 + Math.min(999, spanBp);
}

function circularFeatureLabelKeepSet(
  features: readonly MapInput['features'][number][],
  segByFeature: ReadonlyMap<string, readonly MapFeatureSegment[]>,
  length: number,
  budget: number,
): Set<string> {
  const labelable = features.filter((f) => {
    const name = f.name || f.type;
    return Boolean(name) && (segByFeature.get(f.id)?.length ?? 0) > 0;
  });
  if (budget >= labelable.length) return new Set(labelable.map((f) => f.id));
  if (budget <= 0) return new Set();

  const ranked = labelable
    .map((f) => {
      const segs = segByFeature.get(f.id) ?? [];
      return {
        id: f.id,
        midBp: featureMidBp(segs, length),
        priority: circularFeatureLabelPriority(f, segs, length),
      };
    })
    .sort((a, b) => b.priority - a.priority || a.midBp - b.midBp || cmpKey(a.id, b.id));
  return new Set(ranked.slice(0, budget).map((f) => f.id));
}

function detectNestedCircularFeatureIds(
  segByFeature: Map<string, MapFeatureSegment[]>,
  laneById: ReadonlyMap<string, number>,
): Set<string> {
  const nested = new Set<string>();
  const entries = [...segByFeature.entries()];

  for (const [childId, childSegs] of entries) {
    const childLane = laneById.get(childId);
    if (childLane === undefined || childSegs.length === 0) continue;
    const childTotal = segmentTotalLength(childSegs);
    if (!(childTotal > 0)) continue;

    for (const [parentId, parentSegs] of entries) {
      if (parentId === childId || parentSegs.length === 0) continue;
      const parentLane = laneById.get(parentId);
      if (parentLane === undefined || parentLane === childLane) continue;

      const parentTotal = segmentTotalLength(parentSegs);
      if (!(parentTotal > childTotal)) continue;
      if (childTotal / parentTotal > NESTED_FEATURE_MAX_CHILD_FRACTION) continue;

      const covered = Math.min(childTotal, coveredSegmentLength(childSegs, parentSegs));
      if (covered / childTotal >= NESTED_FEATURE_CONTAINMENT_RATIO) {
        nested.add(childId);
        break;
      }
    }
  }

  return nested;
}

function segmentTotalLength(segs: readonly MapFeatureSegment[]): number {
  return segs.reduce((sum, seg) => sum + Math.max(0, seg.end - seg.start), 0);
}

function coveredSegmentLength(
  childSegs: readonly MapFeatureSegment[],
  parentSegs: readonly MapFeatureSegment[],
): number {
  let covered = 0;
  for (const child of childSegs) {
    for (const parent of parentSegs) {
      covered += Math.max(0, Math.min(child.end, parent.end) - Math.max(child.start, parent.start));
    }
  }
  return covered;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampFinite(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(value as number, min, max) : fallback;
}

function labelVerticalOffsets(
  baseline: MapLabelRender['baseline'] | undefined,
  lineHeight: number = LABEL_LINE_HEIGHT_PX,
): { ay0: number; ay1: number } {
  if (baseline === 'middle') return { ay0: -lineHeight / 2, ay1: lineHeight / 2 };
  if (baseline === 'hanging') return { ay0: 0, ay1: lineHeight };
  if (baseline === 'auto') return { ay0: -lineHeight, ay1: 0 };
  return { ay0: -lineHeight * 0.8, ay1: lineHeight * 0.3 };
}

function labelBBoxAt(
  x: number,
  y: number,
  anchor: MapLabelRender['anchor'],
  textW: number,
  baseline?: MapLabelRender['baseline'],
  rotate: number = 0,
): BBox {
  const ax0 = anchor === 'start' ? 0 : anchor === 'end' ? -textW : -textW / 2;
  const ax1 = anchor === 'start' ? textW : anchor === 'end' ? 0 : textW / 2;
  const { ay0, ay1 } = labelVerticalOffsets(baseline);
  if (rotate === 0) {
    return {
      minX: round(x + ax0),
      maxX: round(x + ax1),
      minY: round(y + ay0),
      maxY: round(y + ay1),
    };
  }

  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [ax0, ay0],
    [ax1, ay0],
    [ax1, ay1],
    [ax0, ay1],
  ] as const;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [dx, dy] of corners) {
    xs.push(x + dx * cos - dy * sin);
    ys.push(y + dx * sin + dy * cos);
  }
  return {
    minX: round(Math.min(...xs)),
    maxX: round(Math.max(...xs)),
    minY: round(Math.min(...ys)),
    maxY: round(Math.max(...ys)),
  };
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function expandBBox(box: BBox, pad: number): BBox {
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
}

function segmentIntersectsBBox(a: Pt, b: Pt, box: BBox): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  return (
    clip(-dx, a.x - box.minX) &&
    clip(dx, box.maxX - a.x) &&
    clip(-dy, a.y - box.minY) &&
    clip(dy, box.maxY - a.y) &&
    t1 > t0 + 1e-6
  );
}

function polylineIntersectsBBox(polyline: readonly Pt[], box: BBox): boolean {
  for (let i = 1; i < polyline.length; i += 1) {
    if (segmentIntersectsBBox(polyline[i - 1], polyline[i], box)) return true;
  }
  return false;
}

function pointInsideBBox(point: Pt, box: BBox): boolean {
  return point.x > box.minX && point.x < box.maxX && point.y > box.minY && point.y < box.maxY;
}

function segmentEntryIntoBBoxT(a: Pt, b: Pt, box: BBox): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    !clip(-dx, a.x - box.minX) ||
    !clip(dx, box.maxX - a.x) ||
    !clip(-dy, a.y - box.minY) ||
    !clip(dy, box.maxY - a.y)
  ) {
    return null;
  }
  return t1 > t0 + 1e-6 ? t0 : null;
}

function circularLeaderToLabelEdge(
  leader: readonly Pt[],
  labelBox: BBox,
  gap: number = CIRCULAR_LABEL_LEADER_TOUCH_GAP,
): readonly Pt[] {
  if (leader.length < 2) return leader;
  const guardBox = expandBBox(labelBox, CIRCULAR_LABEL_LEADER_TEXT_PAD);
  const from = leader[leader.length - 2];
  const to = leader[leader.length - 1];
  if (pointInsideBBox(from, guardBox)) return [];
  const tEnter = segmentEntryIntoBBoxT(from, to, guardBox);
  if (tEnter == null || tEnter <= 0) return leader;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return leader;

  const tTouch = Math.max(0, tEnter - Math.max(0, gap) / len);
  const touch = {
    x: round(from.x + dx * tTouch),
    y: round(from.y + dy * tTouch),
  };
  const prefix = leader.slice(0, -1).map(roundPt);
  const last = prefix[prefix.length - 1];
  if (last && Math.abs(last.x - touch.x) < 1e-6 && Math.abs(last.y - touch.y) < 1e-6) {
    return prefix;
  }
  return [...prefix, touch];
}

function pointsSame(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function segmentOrientation(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(a: Pt, b: Pt, p: Pt): boolean {
  return (
    Math.min(a.x, b.x) - 1e-6 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-6 &&
    Math.min(a.y, b.y) - 1e-6 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-6 &&
    Math.abs(segmentOrientation(a, b, p)) < 1e-6
  );
}

function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  if (pointsSame(a, c) || pointsSame(a, d) || pointsSame(b, c) || pointsSame(b, d)) return false;

  const o1 = segmentOrientation(a, b, c);
  const o2 = segmentOrientation(a, b, d);
  const o3 = segmentOrientation(c, d, a);
  const o4 = segmentOrientation(c, d, b);
  if (Math.abs(o1) < 1e-6 && pointOnSegment(a, b, c)) return true;
  if (Math.abs(o2) < 1e-6 && pointOnSegment(a, b, d)) return true;
  if (Math.abs(o3) < 1e-6 && pointOnSegment(c, d, a)) return true;
  if (Math.abs(o4) < 1e-6 && pointOnSegment(c, d, b)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function polylinesIntersect(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      if (segmentsIntersect(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Chip type sizes, mirroring `.motif-pm-overflow` in plasmid-map.css (10px, with a
 * 9px circular override). Duplicated here because the hit rect must be sized from
 * the same metric the glyphs are drawn at, and this module may not touch the DOM.
 * `overflow-chip-hit.test.ts` reads the stylesheet and fails if the two drift.
 */
const OVERFLOW_FONT_PX = 10;
const OVERFLOW_FONT_PX_CIRCULAR = 9;
/** Horizontal breathing room each side of the glyph run. */
const OVERFLOW_HIT_PAD_X = 8;
/**
 * Baseline-to-visual-middle offset, in em. Taken off the rendered chips: a 9px
 * circular chip's box is 10.25 units tall and a 10px linear chip's is 12, each
 * sitting ~0.9em above and ~0.25em below its baseline.
 *
 * It is a MEASUREMENT, not a derivation — SVG text is boxed by its font's own
 * ascent/descent and this module may not touch the DOM, so a font swap moves the
 * middle and nothing here would notice. So it is guarded rather than trusted:
 * `overflow-chip-hit.test.ts` holds the measured ink box, asserts the rect stays
 * centred on it (which pins this number to ~±0.01em without restating it), and pins
 * the family `.motif-pm-overflow` declares — change the font stack and the guard
 * fails until someone re-measures. Same arrangement as the font sizes above, whose
 * external truth is the stylesheet rather than a ruler.
 */
const OVERFLOW_HIT_CENTER_EM = 0.32;

/**
 * The chip's pointer target: its own estimated glyph run, padded sideways into the
 * empty space the chip sits in, and exactly one label line tall.
 *
 * One line is not a round number picked for looks. It is the pitch `overflows` are
 * stacked at, so a second chip's target abuts this one instead of covering it, and
 * it is what keeps the rect clear of the feature lane below the linear chip — the
 * chip layer paints above the features and a taller rect would eat their clicks.
 */
function overflowHitRect(
  text: string,
  x: number,
  y: number,
  anchor: 'start' | 'middle' | 'end',
  fontPx: number,
): { x: number; y: number; width: number; height: number } {
  const width = approxTextWidth(text, fontPx) + OVERFLOW_HIT_PAD_X * 2;
  const height = LABEL_LINE_HEIGHT_PX;
  const left =
    anchor === 'middle' ? x - width / 2
      : anchor === 'end' ? x + OVERFLOW_HIT_PAD_X - width
        : x - OVERFLOW_HIT_PAD_X;
  return {
    x: round(left),
    y: round(y - OVERFLOW_HIT_CENTER_EM * fontPx - height / 2),
    width: round(width),
    height: round(height),
  };
}

function featureOverflowTitle(
  hiddenBodies: number,
  hiddenLabels: number,
  labelVerb: 'dropped' | 'hidden',
): string {
  const clauses: string[] = [];
  if (hiddenBodies > 0) {
    clauses.push(`${hiddenBodies} ${plural(hiddenBodies, 'feature body', 'feature bodies')} hidden`);
  }
  if (hiddenLabels > 0) {
    clauses.push(
      `${hiddenLabels} ${plural(hiddenLabels, 'feature label', 'feature labels')} ${labelVerb}`,
    );
  }
  const reachability =
    hiddenBodies > 0
      ? 'open the Features tab to see all.'
      : 'hover visible features or open the Features tab.';
  return `${clauses.join(' and ')} - ${reachability}`;
}

/**
 * Grow `bb` to include a placed label's rendered extent (text glyphs + leader
 * polyline). Horizontal labels use the anchor + approx text width; vertical
 * labels (rotate ±90, linear restriction ticks) map that width onto the y axis.
 * This is what lets the final viewBox contain long outside labels instead of
 * clipping them at the nominal viewport edge.
 */
/** Structural minimum both MapLabelRender and the smaller coordinate label satisfy. */
type MeasurableLabel = {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'end' | 'middle';
  baseline?: MapLabelRender['baseline'];
  rotate?: number;
  leader?: readonly Pt[];
};

function growByFinitePt(bb: BBox, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return; // never poison the bbox
  bb.minX = Math.min(bb.minX, x);
  bb.maxX = Math.max(bb.maxX, x);
  bb.minY = Math.min(bb.minY, y);
  bb.maxY = Math.max(bb.maxY, y);
}

function growByLabel(
  bb: BBox,
  label: MeasurableLabel | null,
  fontMode: LabelFontMode = 'proportional',
): void {
  if (!label || !Number.isFinite(label.x) || !Number.isFinite(label.y)) return;
  const w = approxTextWidth(label.text, undefined, fontMode);
  // Unrotated glyph box relative to the anchor point.
  let ax0: number;
  let ax1: number;
  if (label.anchor === 'start') {
    ax0 = 0;
    ax1 = w;
  } else if (label.anchor === 'end') {
    ax0 = -w;
    ax1 = 0;
  } else {
    ax0 = -w / 2;
    ax1 = w / 2;
  }
  const { ay0, ay1 } = labelVerticalOffsets(label.baseline);
  const rot = label.rotate ?? 0;
  if (rot === 0) {
    growByFinitePt(bb, label.x + ax0, label.y + ay0);
    growByFinitePt(bb, label.x + ax1, label.y + ay1);
  } else {
    // Rotate all four corners around the anchor (SVG rotates the same way) and
    // take their axis-aligned bounds, so a tangential/±90/270 label is measured
    // correctly instead of only the horizontal case.
    const rad = (rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (const [dx, dy] of [
      [ax0, ay0],
      [ax1, ay0],
      [ax1, ay1],
      [ax0, ay1],
    ]) {
      growByFinitePt(bb, label.x + dx * cos - dy * sin, label.y + dx * sin + dy * cos);
    }
  }
  for (const p of label.leader ?? []) growByFinitePt(bb, p.x, p.y);
}

/**
 * Content-fitted viewBox: start from the core geometry bounds (`base`), fold in
 * every placed label's extent, pad, and emit both the viewBox string and the
 * numeric background rect. The SVG uses preserveAspectRatio meet, so a box that
 * grew past the nominal viewport just scales the whole map down to fit.
 */
function fitViewBox(
  base: BBox,
  features: readonly MapFeatureRender[],
  restrictions: readonly MapRestrictionRender[],
  coordinates: readonly MapCoordinateTick[],
  pad: number,
  squareAround?: Pt,
  fontMode: LabelFontMode = 'proportional',
): { viewBox: string; bg: { x: number; y: number; width: number; height: number } } {
  const bb: BBox = { ...base };
  for (const f of features) growByLabel(bb, f.label, fontMode);
  for (const r of restrictions) growByLabel(bb, r.label, fontMode);
  for (const c of coordinates) growByLabel(bb, c.label, fontMode);
  let x = bb.minX - pad;
  let y = bb.minY - pad;
  let width = bb.maxX + pad - x;
  let height = bb.maxY + pad - y;
  if (squareAround) {
    // Keep the ring centered and the box square: use the largest half-extent on
    // any side. A wide label spread then just widens the empty margins, it does
    // not squash the ring (which meet-scaling would otherwise do).
    const half =
      Math.max(
        squareAround.x - (bb.minX - pad),
        bb.maxX + pad - squareAround.x,
        squareAround.y - (bb.minY - pad),
        bb.maxY + pad - squareAround.y,
      );
    x = squareAround.x - half;
    y = squareAround.y - half;
    width = half * 2;
    height = half * 2;
  }
  const bg = { x: round(x), y: round(y), width: round(width), height: round(height) };
  return { viewBox: `${bg.x} ${bg.y} ${bg.width} ${bg.height}`, bg };
}

/**
 * Biological midpoint bp of a feature: walk half the total drawn length from the
 * first segment, so origin-wrap / multi-subrange features get a mid that actually
 * lands on the molecule (used for reveal/scroll + deterministic hit ordering).
 */
function featureMidBp(segs: readonly MapFeatureSegment[], length: number): number {
  if (segs.length === 0) return 0;
  const total = segs.reduce((sum, s) => sum + (s.end - s.start), 0);
  let half = total / 2;
  for (const s of segs) {
    const len = s.end - s.start;
    if (half <= len) return length > 0 ? mod(s.start + half, length) : s.start + half;
    half -= len;
  }
  return segs[0].start;
}

function circularClusterLabel(
  c: MapRestrictionCluster,
  maxPx: number,
  fontMode: LabelFontMode,
): { text: string; width: number; segments: readonly { text: string; typeIIS: boolean }[] } {
  const typeIISByEnzyme = new Map<string, boolean>();
  for (const t of c.ticks) {
    typeIISByEnzyme.set(t.enzyme, (typeIISByEnzyme.get(t.enzyme) ?? false) || t.isTypeIIS);
  }
  const cap = Math.max(0, maxPx);
  const candidateNames = c.shownEnzymes.length > 0 ? c.shownEnzymes : c.enzymes.slice(0, 1);
  const build = (shown: readonly string[], displayNames: readonly string[] = shown) => {
    const overflow = Math.max(0, c.enzymes.length - shown.length);
    // Enzyme names join with ", " and the "+N" overflow tail with " ". The tail is a
    // COUNT, not another list member, so it is deliberately not comma-separated.
    // The space after the comma is load-bearing: without it the only thing separating
    // "BsmBI" from "Esp3I" is the Type IIS colour change, and colour does not survive
    // a monochrome export or forced-colors mode. Any change here must be mirrored in
    // SequenceMapView's tspan renderer AND its `segmented` guard, which silently drops
    // per-enzyme coloring when its reconstruction stops matching this string.
    const text = `${displayNames.join(', ')}${overflow > 0 ? ` +${overflow}` : ''}`;
    const segments = shown.map((name, index) => ({
      text: displayNames[index] ?? name,
      typeIIS: typeIISByEnzyme.get(name) ?? false,
    }));
    if (overflow > 0) segments.push({ text: `+${overflow}`, typeIIS: false });
    return {
      text,
      width: round(approxTextWidth(text, undefined, fontMode)),
      segments,
    };
  };

  for (let count = candidateNames.length; count >= 1; count -= 1) {
    const label = build(candidateNames.slice(0, count));
    if (label.width <= cap) return label;
  }

  const lead = candidateNames[0] ?? c.enzymes[0] ?? '';
  const overflow = Math.max(0, c.enzymes.length - 1);
  const suffix = overflow > 0 ? ` +${overflow}` : '';
  let displayLead = lead;
  if (approxTextWidth(`${displayLead}${suffix}`, undefined, fontMode) > cap) {
    while (
      displayLead.length > 1 &&
      approxTextWidth(`${displayLead}…${suffix}`, undefined, fontMode) > cap
    ) {
      displayLead = displayLead.slice(0, -1);
    }
    displayLead = displayLead === lead ? lead : `${displayLead}…`;
  }

  const compact = build([lead], [displayLead]);
  if (compact.width <= cap || displayLead.length <= 1) return compact;
  return build([lead], [displayLead.slice(0, 1)]);
}

/**
 * Compact label for a linear restriction cluster: the lead enzyme name plus the "+N"
 * count of names that did not fit.
 *
 * The count is not optional. This used to ellipsise the name and then return the stem
 * ALONE when the pair overran the width cap, so a 14-enzyme cluster led by a long name
 * rendered as a bare "Nt.BstNBI" — visually identical to a lone cut site. That is worse
 * than a crowded label: a truncation that hides that it truncated states something
 * false, where a crowded one merely states something incomplete. So characters of the
 * NAME are what gets spent; the "+N" is the only mark saying "there is more here".
 *
 * Names of 8 characters or fewer (153 of the 154 bundled enzymes) take the early return
 * and are not width-checked at all — "HindIII +13" ships at 68px against a 64px cap.
 * That inconsistency predates this and is deliberately left alone: it already keeps the
 * count, which is the property that matters, and re-imposing the cap there would
 * re-truncate a lot of labels that are placed by their ACTUAL width anyway.
 */
function compactLinearClusterText(c: MapRestrictionCluster): string {
  const first = c.shownEnzymes[0] ?? c.enzymes[0] ?? '';
  const extra = c.enzymes.length - 1;
  const suffix = extra > 0 ? ` +${extra}` : '';
  if (first.length <= 8) return `${first}${suffix}`;

  const full = `${first}${suffix}`;
  if (approxTextWidth(full) <= LINEAR_REC_LABEL_MAX_WIDTH_PX) return full;

  // Budget the name against what is left after the count, never the other way round —
  // and never let the summary take MORE room than the bare name it replaces. Labels are
  // placed by actual width, so width taken here is width taken from a neighbour: the
  // first cut of this fix grew these two labels by 6.2px each and cost an unrelated
  // "AclI" label its place in a crowded row at 1920x1080 with all sources on. Trading
  // name characters for count characters one-for-one keeps the width identical, so the
  // packing cannot move and the only thing that changes is what the label says.
  const budget =
    Math.min(LINEAR_REC_LABEL_MAX_WIDTH_PX, approxTextWidth(first)) - approxTextWidth(suffix);
  let stem = first;
  while (
    stem.length > LINEAR_REC_LABEL_MIN_STEM_CHARS &&
    approxTextWidth(`${stem}…`) > budget
  ) {
    stem = stem.slice(0, -1);
  }
  // Unreachable with a non-empty suffix (a stem that fits the budget would have fit the
  // cap alongside it), but if the name alone was the thing that overran, it keeps both.
  return stem === first ? full : `${stem}…${suffix}`;
}

function ellipsizeToWidth(
  text: string,
  maxPx: number,
  fontMode: LabelFontMode = 'proportional',
): { text: string; width: number } {
  const cap = Math.max(0, maxPx);
  const width = approxTextWidth(text, undefined, fontMode);
  if (width <= cap) return { text, width: round(width) };
  if (cap <= 0) return { text: '', width: 0 };

  let stem = text;
  while (stem.length > 0 && approxTextWidth(`${stem}…`, undefined, fontMode) > cap) {
    stem = stem.slice(0, -1);
  }
  const out = stem.length > 0 || approxTextWidth('…', undefined, fontMode) <= cap ? `${stem}…` : '';
  return { text: out, width: round(approxTextWidth(out, undefined, fontMode)) };
}

function meaningfulEllipsizeToWidth(
  text: string,
  maxPx: number,
  fontMode: LabelFontMode = 'proportional',
): { text: string; width: number } | null {
  if (text.length <= 8) return null;
  const label = ellipsizeToWidth(text, maxPx, fontMode);
  if (!label.text.endsWith('…')) return null;

  const stem = label.text.slice(0, -1).trimEnd();
  const cleaned = `${stem}…`;
  const savedChars = text.trimEnd().length - stem.length;
  const realChars = stem.replace(/\s/g, '').length;
  const words = stem.split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1] ?? '';

  if (savedChars <= 1 || realChars < 3 || (words.length > 1 && lastWord.length < 2)) {
    return null;
  }

  const width = round(approxTextWidth(cleaned, undefined, fontMode));
  return width <= Math.max(0, maxPx) ? { text: cleaned, width } : null;
}

function usableCircularEllipsis(fullText: string, labelText: string): boolean {
  if (!labelText.endsWith('…')) return true;

  const sourceChars = fullText.trimEnd().length;
  const keptChars = labelText.slice(0, -1).trimEnd().length;
  if (keptChars < CIRCULAR_ELLIPSIS_MIN_VISIBLE_CHARS) return false;
  return sourceChars === 0 || keptChars / sourceChars >= CIRCULAR_ELLIPSIS_MIN_RETAINED_RATIO;
}

function ambiguousCircularEllipsis(
  fullText: string,
  labelText: string,
  allFeatureNames: readonly string[],
): boolean {
  if (!labelText.endsWith('…')) return false;
  const stem = labelText.slice(0, -1).trimEnd();
  if (!stem) return true;
  const matchingNames = new Set(
    allFeatureNames
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && name !== fullText.trim() && name.startsWith(stem)),
  );
  return matchingNames.size > 0;
}

function linearRecCap(
  axisWidth: number,
  count: number,
  display: MapDisplayOptions,
  reserve: boolean,
): number {
  const usable = axisWidth - (reserve ? LINEAR_REC_OVERFLOW_RESERVE_PX : 0);
  const perRow = Math.max(
    0,
    Math.floor((usable - LINEAR_REC_LABEL_MAX_WIDTH_PX) / LINEAR_REC_SLOT_PX) + 1,
  );
  const densityCap = Math.min(count, perRow * LINEAR_REC_LABEL_ROW_YS.length);
  const hardCap =
    typeof display.maxRestrictionLabels === 'number'
      ? Math.max(0, Math.floor(display.maxRestrictionLabels))
      : densityCap;
  return Math.max(0, Math.min(hardCap, densityCap));
}

function circularRecCap(
  radius: number,
  count: number,
  display: MapDisplayOptions,
): number {
  if (count <= 0) return 0;
  if (typeof display.maxRestrictionLabels === 'number') {
    return Math.max(0, Math.min(count, Math.floor(display.maxRestrictionLabels)));
  }
  const byCircumference = Math.floor((2 * Math.PI * Math.max(0, radius)) / REC_LABEL_RADIAL_SLOT_PX);
  return Math.max(0, Math.min(count, Math.max(6, byCircumference)));
}

function selectSpacedRestrictionClusterIds(
  clusters: readonly MapRestrictionCluster[],
  cap: number,
  length: number,
  circular: boolean,
): Set<string> {
  const limit = Math.max(0, Math.min(clusters.length, Math.floor(cap)));
  if (limit >= clusters.length) return new Set(clusters.map((c) => c.id));
  if (limit === 0 || length <= 0) return new Set();

  const ordered = [...clusters].sort(
    (a, b) => a.anchorBp - b.anchorBp || cmpKey(a.id, b.id),
  );
  const selected = new Set<string>();
  const usedIndexes = new Set<number>();

  for (let i = 0; i < limit; i += 1) {
    const target = circular ? (i * length) / limit : ((i + 0.5) * length) / limit;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPriority = Number.NEGATIVE_INFINITY;

    for (let j = 0; j < ordered.length; j += 1) {
      if (usedIndexes.has(j)) continue;
      const c = ordered[j];
      const distance = circular
        ? circularBpDistance(c.anchorBp, target, length)
        : Math.abs(c.anchorBp - target);
      const priority = c.ticks.length * 10 + (c.hasTypeIIS ? 1 : 0);
      const better =
        distance < bestDistance - 1e-6 ||
        (Math.abs(distance - bestDistance) <= 1e-6 &&
          (priority > bestPriority ||
            (priority === bestPriority && (bestIndex < 0 || cmpKey(c.id, ordered[bestIndex].id) < 0))));
      if (better) {
        bestIndex = j;
        bestDistance = distance;
        bestPriority = priority;
      }
    }

    if (bestIndex >= 0) {
      usedIndexes.add(bestIndex);
      selected.add(ordered[bestIndex].id);
    }
  }

  return selected;
}

function circularBpDistance(a: number, b: number, length: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, Math.max(0, length - direct));
}

// ── Linear restriction-label row placement (non-crossing, near-vertical leaders) ──

/** Total px a row of centred labels needs: their widths plus one gap between each. */
function restrictionRowWidth(
  entries: readonly { halfW: number }[],
  gap: number,
): number {
  if (entries.length === 0) return 0;
  const glyphs = entries.reduce((sum, e) => sum + 2 * e.halfW, 0);
  return glyphs + (entries.length - 1) * gap;
}

/**
 * The cap normally keeps a row within capacity, but if a row still cannot fit its
 * labels width-aware, drop the LOWEST-priority ones (ties: widest, then key desc)
 * until it does. Ticks are untouched; only labels drop. Kept entries stay in the
 * incoming (tick-x) order so downstream placement + leaders remain monotonic.
 */
function dropLowestUntilRowFits<T extends { key: string; halfW: number; priority: number }>(
  entries: readonly T[],
  available: number,
  gap: number,
): T[] {
  const kept = entries.slice();
  while (kept.length > 1 && restrictionRowWidth(kept, gap) > available) {
    let worst = 0;
    for (let i = 1; i < kept.length; i += 1) {
      const a = kept[i];
      const b = kept[worst];
      if (
        a.priority < b.priority ||
        (a.priority === b.priority && a.halfW > b.halfW) ||
        (a.priority === b.priority && a.halfW === b.halfW && a.key > b.key)
      ) {
        worst = i;
      }
    }
    kept.splice(worst, 1);
  }
  return kept;
}

/**
 * Minimum-displacement 1D placement for ONE linear restriction-label row. Returns
 * each label's CENTRE x. Every centre is pulled as close to its tick as possible
 * subject to: (a) tick order is preserved (centres non-decreasing → leaders never
 * cross), (b) neighbours don't overlap (centres ≥ halfW_i + halfW_{i+1} + gap
 * apart), (c) each label stays whole within [loX, hiX]. This is bounded isotonic
 * regression solved by pool-adjacent-violators — it minimises total squared
 * displacement, so leaders stay as SHORT and VERTICAL as the row's density allows,
 * replacing the fixed-72px slot pass that cascaded left-clustered labels far right
 * onto long shallow (near-horizontal) leaders. Pure + deterministic; `entries` MUST
 * be sorted by tickX ascending.
 */
export function placeRestrictionRow(
  entries: readonly { key: string; tickX: number; halfW: number }[],
  loX: number,
  hiX: number,
  gap: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const n = entries.length;
  if (n === 0) return out;

  // Required centre-to-centre gap before item i (0 for the first).
  const minGap: number[] = new Array(n);
  minGap[0] = 0;
  for (let i = 1; i < n; i += 1) minGap[i] = entries[i - 1].halfW + entries[i].halfW + gap;
  // Cumulative min offset: substituting z_i = centre_i - cum_i turns the ordered
  // min-gap constraint into a plain z_i ≥ z_{i-1} (isotonic) problem.
  const cum: number[] = new Array(n);
  cum[0] = 0;
  for (let i = 1; i < n; i += 1) cum[i] = cum[i - 1] + minGap[i];

  // Pool-adjacent-violators over blocks of z. Each block carries the sum/count of
  // its ideal z targets (→ mean) clamped to the block's tightest feasible [lo, hi].
  type Block = { sum: number; count: number; lo: number; hi: number; val: number; from: number; to: number };
  const blocks: Block[] = [];
  const relax = (b: Block): void => {
    b.val = Math.min(Math.max(b.sum / b.count, b.lo), b.hi);
  };
  for (let i = 0; i < n; i += 1) {
    const zTarget = entries[i].tickX - cum[i];
    const zLo = loX + entries[i].halfW - cum[i];
    const zHi = hiX - entries[i].halfW - cum[i];
    const b: Block = { sum: zTarget, count: 1, lo: zLo, hi: Math.max(zLo, zHi), val: 0, from: i, to: i };
    relax(b);
    // Merge left while the previous block's value would sit at/above this one
    // (a monotonicity violation), pooling their targets and intersecting boxes.
    while (blocks.length > 0 && blocks[blocks.length - 1].val >= b.val) {
      const prev = blocks.pop()!;
      b.sum += prev.sum;
      b.count += prev.count;
      b.lo = Math.max(b.lo, prev.lo);
      b.hi = Math.max(b.lo, Math.min(b.hi, prev.hi));
      b.from = prev.from;
      relax(b);
    }
    blocks.push(b);
  }

  for (const b of blocks) {
    for (let i = b.from; i <= b.to; i += 1) out.set(entries[i].key, b.val + cum[i]);
  }
  return out;
}

/** Orthogonal restriction leader: tick drop, horizontal jog, vertical touch at the label box edge. */
function linearRestrictionLeader(
  anchorX: number,
  labelX: number,
  tickBottomY: number,
  labelTouchY: number,
): Pt[] {
  const start = { x: round(anchorX), y: round(tickBottomY) };
  const touch = { x: round(labelX), y: round(labelTouchY) };
  const jogY = round(Math.min(labelTouchY - 1, tickBottomY + LINEAR_REC_LEADER_DROP));
  const points = [
    start,
    { x: start.x, y: jogY },
    { x: touch.x, y: jogY },
    touch,
  ];
  return points.filter((point, index) => index === 0 || !pointsSame(point, points[index - 1]));
}

function linearFeatureLeader(
  anchorX: number,
  labelX: number,
  anchorY: number,
  labelY: number,
): Pt[] {
  if (Math.abs(labelX - anchorX) <= LINEAR_FEATURE_LEADER_MIN_DX) return [];
  return [
    { x: round(labelX), y: round(anchorY) },
    { x: round(labelX), y: round(labelY) },
  ];
}

/**
 * Native-tooltip text for a feature: "name · type · 1627–2486 →". Built from the
 * DRAWN segments (1-indexed) so a joined/origin-wrapping feature shows its real
 * spans (e.g. "2900–3000, 1–200") rather than a misleading aggregate start/end.
 */
function featureTitle(
  name: string,
  type: string,
  segs: readonly { start: number; end: number }[],
  strand: FeatureStrand,
): string {
  const dir = strand === 1 ? ' →' : strand === -1 ? ' ←' : '';
  const range = segs.length
    ? segs.map((s) => `${Math.trunc(s.start) + 1}–${Math.trunc(s.end)}`).join(', ')
    : '?';
  return `${name} · ${type} · ${range}${dir}`;
}

/** Recognition-window start positions of a cluster's sites, ascending. */
function clusterPositions(c: MapRestrictionCluster): number[] {
  return c.ticks.map((t) => t.position).sort((a, b) => a - b);
}

/**
 * Native-tooltip text for a restriction cluster: "EcoRI, SacI · cut 398, 408"
 * (cut bonds shown 1-indexed to match the detail restriction UI).
 *
 * A crowded cluster names BOTH counts — "· 39 enzymes · 50 sites" — because the two
 * numbers a reader meets are in DIFFERENT UNITS. The label's "+N" tail counts enzyme
 * NAMES that did not fit (circularClusterLabel / compactLinearClusterText), while the
 * cut tally counts SITES. Printing only the site count put "Nt.BstNBI +38" on the ring
 * beside a tooltip reading "50 sites" with nothing anywhere to say they measure
 * different things. Naming the enzyme count lets 1 shown + 38 hidden reconcile against
 * "39 enzymes" — and it is the same 39 names this very string already enumerates — so
 * "50 sites" keeps its own unit instead of looking like a contradiction.
 */
function restrictionTitle(c: MapRestrictionCluster): string {
  // `c.enzymes` is in DISPLAY order (Type IIS first), which is the order the drawn
  // label reads in — so the name the user clicked is the name this opens with, and
  // the label's shown names are this list's first few.
  const names = [...new Set(c.enzymes)]; // dedupe isoschizomers/repeats
  const enz = names.join(', ');
  // The short form prints two same-length lists side by side and a reader pairs them
  // off: "AluI, BsmFI, MseI · cut 1898, 1919, 1945" is only true if the Nth cut
  // belongs to the Nth name. Measured on pUC19 with every source on, 14 of 14
  // multi-name short-form tooltips were pairable that way — so the pairing is real,
  // and ordering the NAMES for display without reordering the cuts would have quietly
  // made it lie. Sorting the ticks the same way keeps it, and beats the old code when
  // one enzyme cuts twice in a cluster: its two cuts now sit together under its own
  // name instead of straddling a neighbour's.
  const rank = new Map(names.map((name, index) => [name, index]));
  const cuts = [...c.ticks]
    .sort((a, b) =>
      (rank.get(a.enzyme) ?? names.length) - (rank.get(b.enzyme) ?? names.length)
      || a.cutPosition - b.cutPosition)
    .map((t) => t.cutPosition + 1);
  // <=3 cuts enumerates the cut bonds, so there is no bare count to be mistaken for
  // the name count; the reader can see every name and every cut.
  if (cuts.length <= 3) return `${enz} · cut ${cuts.join(', ')}`;
  return `${enz} · ${names.length} ${names.length === 1 ? 'enzyme' : 'enzymes'} · ${cuts.length} sites`;
}

interface CircularRadialLabelMeta {
  kind: 'feature' | 'restriction';
  targetId: string;
  anchor: Pt;
  angleDeg: number;
  text: string;
  width: number;
  priority: number;
  labelSegments?: readonly { text: string; typeIIS: boolean }[];
}

interface CircularRadialObstacleSets {
  labelObstacles: BBox[];
  leaderObstacles: BBox[];
  leaderTextObstacles: BBox[];
}

function labelBBoxForRender(
  label: MeasurableLabel,
  fontMode: LabelFontMode = 'proportional',
): BBox {
  return labelBBoxAt(
    label.x,
    label.y,
    label.anchor,
    approxTextWidth(label.text, undefined, fontMode),
    label.baseline,
    label.rotate ?? 0,
  );
}

function lineBBox(
  line: { x1: number; y1: number; x2: number; y2: number },
  pad: number = 1,
): BBox {
  return {
    minX: Math.min(line.x1, line.x2) - pad,
    minY: Math.min(line.y1, line.y2) - pad,
    maxX: Math.max(line.x1, line.x2) + pad,
    maxY: Math.max(line.y1, line.y2) + pad,
  };
}

function bboxFromPoints(points: readonly Pt[], pad: number = 0): BBox {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: round(Math.min(...xs) - pad),
    minY: round(Math.min(...ys) - pad),
    maxX: round(Math.max(...xs) + pad),
    maxY: round(Math.max(...ys) + pad),
  };
}

function angleWithinSweep(angleDeg: number, startDeg: number, endDeg: number): boolean {
  const sweep = endDeg - startDeg;
  if (Math.abs(sweep) >= 360) return true;
  if (sweep >= 0) {
    let a = angleDeg;
    while (a < startDeg) a += 360;
    return a <= endDeg + 1e-6;
  }
  let a = angleDeg;
  while (a > startDeg) a -= 360;
  return a >= endDeg - 1e-6;
}

function circularFeatureBandBBox(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
  extraPoints: readonly Pt[] = [],
): BBox {
  const points: Pt[] = [...extraPoints];
  for (const r of [innerR, outerR]) {
    points.push(pointOnCircle(cx, cy, r, startAngle));
    points.push(pointOnCircle(cx, cy, r, endAngle));
  }
  const lo = Math.min(startAngle, endAngle);
  const hi = Math.max(startAngle, endAngle);
  for (let k = Math.floor((lo - 360) / 90); k <= Math.ceil((hi + 360) / 90); k += 1) {
    const angle = k * 90;
    if (!angleWithinSweep(angle, startAngle, endAngle)) continue;
    points.push(pointOnCircle(cx, cy, innerR, angle));
    points.push(pointOnCircle(cx, cy, outerR, angle));
  }
  return bboxFromPoints(points, 1);
}

function circularRadialLabelObstacles({
  centerGuard,
  featureGlyphBoxes,
  featureRenders,
  restrictionRenders,
  restrictionDensityTicks,
  coordinates,
  labelFontMode,
  includeFeatureLabels = true,
}: {
  centerGuard: BBox;
  featureGlyphBoxes: readonly BBox[];
  featureRenders: readonly MapFeatureRender[];
  restrictionRenders: readonly MapRestrictionRender[];
  restrictionDensityTicks: readonly MapRestrictionDensityTick[];
  coordinates: readonly MapCoordinateTick[];
  labelFontMode: LabelFontMode;
  includeFeatureLabels?: boolean;
}): CircularRadialObstacleSets {
  const textObstacles: BBox[] = [centerGuard];

  if (includeFeatureLabels) {
    for (const feature of featureRenders) {
      if (feature.label) textObstacles.push(labelBBoxForRender(feature.label, labelFontMode));
    }
  }
  for (const restriction of restrictionRenders) {
    if (restriction.label) textObstacles.push(labelBBoxForRender(restriction.label, labelFontMode));
  }

  for (const coord of coordinates) {
    if (coord.label) textObstacles.push(labelBBoxForRender(coord.label, labelFontMode));
  }

  const textAndTickObstacles: BBox[] = [...textObstacles];

  if (includeFeatureLabels) {
    for (const feature of featureRenders) {
      const leader = feature.label?.leader ?? [];
      for (let i = 1; i < leader.length; i += 1) {
        textAndTickObstacles.push(lineBBox({
          x1: leader[i - 1].x,
          y1: leader[i - 1].y,
          x2: leader[i].x,
          y2: leader[i].y,
        }, 2));
      }
    }
  }

  for (const coord of coordinates) {
    textAndTickObstacles.push(lineBBox(coord.tick, 1));
  }
  for (const restriction of restrictionRenders) {
    textAndTickObstacles.push(lineBBox(restriction.tick, 1));
  }
  for (const densityTick of restrictionDensityTicks) {
    textAndTickObstacles.push(lineBBox(densityTick.tick, 0.5));
  }

  return {
    labelObstacles: [...featureGlyphBoxes, ...textAndTickObstacles],
    leaderObstacles: textAndTickObstacles,
    leaderTextObstacles: textObstacles,
  };
}

/**
 * Settle the grouped-cluster rescue: keep the rescued restriction labels that are
 * worth what they cost, and undo the rest. Returns how many feature labels were
 * actually evicted.
 *
 * The rescue pass places grouped clusters while ignoring feature labels, so each
 * label it wins may be sitting on one. Deciding that per rescued label rather than
 * for the pass as a whole matters: a rescue that overlaps nothing is free and is
 * always kept, and only the ones that would cost a feature name have to justify
 * themselves.
 *
 * Cheapest first, then two conditions checked against the running totals — no
 * tuned constant, just counts:
 *  - the rescue must never delete more names than it adds, since that leaves the
 *    map strictly poorer, with fewer labels AND one class quieter; and
 *  - it must not erase most of the feature class. Destroying more feature labels
 *    than survive is no longer resolving a local collision, it is deciding the map
 *    answers only one of its two questions.
 *
 * A rescue that fails either test gives its label back; that cluster keeps its
 * ticks and is counted by the "+N more sites" chip like any other unnamed one.
 */
function keepRescuedGroupedRestrictionLabelsWorthTheirCost(
  featureRenders: MapFeatureRender[],
  restrictionRenders: readonly MapRestrictionRender[],
  rescuedClusterIds: ReadonlySet<string>,
  labelFontMode: LabelFontMode,
): number {
  const grouped = restrictionRenders
    .filter((restriction) => restriction.tickIds.length > 1 && restriction.label)
    .map((restriction) => ({
      render: restriction,
      label: restriction.label!,
      box: labelBBoxForRender(restriction.label!, labelFontMode),
      rescued: rescuedClusterIds.has(restriction.clusterId),
    }));
  if (grouped.length === 0) return 0;

  const outsideFeatures = featureRenders
    .filter((feature) => feature.label && !feature.label.inside)
    .map((feature) => ({
      feature,
      box: labelBBoxForRender(feature.label!, labelFontMode),
      leader: feature.label!.leader,
    }));

  const collides = (
    featureEntry: (typeof outsideFeatures)[number],
    restriction: (typeof grouped)[number],
  ): boolean => {
    const restrictionLeader = restriction.label.leader;
    return (
      bboxIntersects(featureEntry.box, restriction.box) ||
      (featureEntry.leader.length > 1 && polylineIntersectsBBox(featureEntry.leader, restriction.box)) ||
      (restrictionLeader.length > 1 && polylineIntersectsBBox(restrictionLeader, featureEntry.box)) ||
      (featureEntry.leader.length > 1 &&
        restrictionLeader.length > 1 &&
        polylinesIntersect(featureEntry.leader, restrictionLeader))
    );
  };

  // Labels that were already placed the ordinary way have precedence: the feature
  // labels they overlap are not the rescue's doing and are dropped unconditionally,
  // exactly as before.
  const evicted = new Set<(typeof outsideFeatures)[number]>();
  for (const restriction of grouped) {
    if (restriction.rescued) continue;
    for (const featureEntry of outsideFeatures) {
      if (collides(featureEntry, restriction)) evicted.add(featureEntry);
    }
  }

  const rescues = grouped
    .filter((restriction) => restriction.rescued)
    .map((restriction) => ({
      restriction,
      cost: outsideFeatures.filter(
        (featureEntry) => !evicted.has(featureEntry) && collides(featureEntry, restriction),
      ),
    }))
    .sort((a, b) => a.cost.length - b.cost.length || cmpKey(a.restriction.render.clusterId, b.restriction.render.clusterId));

  let kept = 0;
  for (const rescue of rescues) {
    const wouldEvict = new Set(evicted);
    for (const featureEntry of rescue.cost) wouldEvict.add(featureEntry);
    const survivingFeatures = outsideFeatures.length - wouldEvict.size;
    if (kept + 1 >= wouldEvict.size && survivingFeatures >= wouldEvict.size) {
      for (const featureEntry of rescue.cost) evicted.add(featureEntry);
      kept += 1;
      continue;
    }
    rescue.restriction.render.label = null;
    rescue.restriction.render.labelSegments = undefined;
  }

  for (const featureEntry of evicted) featureEntry.feature.label = null;
  return evicted.size;
}

function dropRestrictionLabelsConflictingWithFeatureLeaders(
  featureRenders: readonly MapFeatureRender[],
  restrictionRenders: MapRestrictionRender[],
  labelFontMode: LabelFontMode,
): void {
  const featureLeaders = featureRenders
    .map((feature) => feature.label?.leader ?? [])
    .filter((leader) => leader.length > 1);
  if (featureLeaders.length === 0) return;

  for (const restriction of restrictionRenders) {
    const label = restriction.label;
    if (!label) continue;
    if (restriction.tickIds.length > 1) continue;
    const labelBox = labelBBoxForRender(label, labelFontMode);
    const restrictionLeader = label.leader;
    const conflicts = featureLeaders.some((featureLeader) => {
      if (polylineIntersectsBBox(featureLeader, labelBox)) return true;
      return restrictionLeader.length > 1 && polylinesIntersect(featureLeader, restrictionLeader);
    });

    if (conflicts) {
      restriction.label = null;
      restriction.labelSegments = undefined;
    }
  }
}

function dropCoordinateLabelsConflictingWithFeatureLeaders(
  featureRenders: readonly MapFeatureRender[],
  coordinates: MapCoordinateTick[],
  labelFontMode: LabelFontMode,
): void {
  const featureLeaders = featureRenders
    .map((feature) => feature.label?.leader ?? [])
    .filter((leader) => leader.length > 1);
  if (featureLeaders.length === 0) return;

  for (const coordinate of coordinates) {
    const label = coordinate.label;
    if (!label) continue;
    const labelBox = labelBBoxForRender(label, labelFontMode);
    if (featureLeaders.some((leader) => polylineIntersectsBBox(leader, labelBox))) {
      coordinate.label = null;
    }
  }
}

/**
 * The circular ruler wraps, so the last nice-step tick can land a few bp short of the
 * origin and print its number on top of "0" at 12 o'clock. pACYCDuet-1 is 4,008 bp on a
 * 1,000 bp step: the 4000 tick sits 8 bp — about 3px of arc — before the seam, and
 * "4000" is four times wider than "0", so "0" is 100% covered and the map reads as
 * though it starts at 4000.
 *
 * The wrapped neighbour yields its NUMBER and keeps its TICK. "0" is what orients the
 * whole map, so it is never the one dropped, and keeping the tick leaves the ruler's
 * cadence unbroken.
 *
 * Circular only: the linear generator puts its last tick at the right-hand end of the
 * axis with nothing after it, so it has no seam to guard.
 */
function dropOriginSeamCoordinateLabel(
  coordinates: MapCoordinateTick[],
  labelFontMode: LabelFontMode,
): void {
  if (coordinates.length < 2) return;
  const origin = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (origin.bp !== 0 || !origin.label || !last.label) return;
  const originBox = expandBBox(labelBBoxForRender(origin.label, labelFontMode), COORD_LABEL_SEAM_PAD);
  if (!bboxIntersects(originBox, labelBBoxForRender(last.label, labelFontMode))) return;
  last.label = null;
}

function chooseRadialPlacementOwner(
  ids: readonly string[],
  candidatesById: ReadonlyMap<string, RadialTierLabelCandidate>,
): string | null {
  let best: string | null = null;
  for (const id of ids) {
    const candidate = candidatesById.get(id);
    if (!candidate) continue;
    if (!best) {
      best = id;
      continue;
    }
    const bestCandidate = candidatesById.get(best);
    const priority = candidate.priority ?? 0;
    const bestPriority = bestCandidate?.priority ?? 0;
    if (priority > bestPriority || (priority === bestPriority && cmpKey(id, best) < 0)) best = id;
  }
  return best;
}

function placementLabelText(
  placement: RadialTierLabelPlacement,
  meta: ReadonlyMap<string, CircularRadialLabelMeta>,
  ownerId: string,
): string {
  return placement.group?.text ?? meta.get(ownerId)?.text ?? '';
}

function placeCircularRadialLabels(
  candidates: readonly RadialTierLabelCandidate[],
  meta: Map<string, CircularRadialLabelMeta>,
  opts: RadialTierLabelOptions,
  labelFontMode: LabelFontMode,
  staticLeaderTextObstacles: readonly BBox[],
  writeLabel: (meta: CircularRadialLabelMeta, label: MapLabelRender | null) => void,
): { feature: number; restriction: number } {
  const hidden = { feature: 0, restriction: 0 };
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const representedIds = new Set<string>();
  type ResolvedPlacement = {
    placement: RadialTierLabelPlacement;
    members: readonly string[];
    ownerId: string;
    ownerMeta: CircularRadialLabelMeta;
    text: string;
    x: number;
    y: number;
    leader: readonly Pt[];
    box: BBox;
    priority: number;
  };
  const resolved: ResolvedPlacement[] = [];

  for (const placement of layoutRadialTierLabels(candidates, opts)) {
    const members = placement.group?.members ?? [placement.id];
    const ownerId = chooseRadialPlacementOwner(members, candidatesById);
    if (!ownerId) continue;
    const ownerMeta = meta.get(ownerId);
    if (!ownerMeta) continue;
    const text = placementLabelText(placement, meta, ownerId);
    const x = round(placement.pos.x);
    const y = round(placement.pos.y);
    const box = labelBBoxAt(x, y, placement.textAnchor, approxTextWidth(text, undefined, labelFontMode), placement.baseline);
    const leader = circularLeaderToLabelEdge(placement.leader.map(roundPt), box);

    resolved.push({
      placement,
      members,
      ownerId,
      ownerMeta,
      text,
      x,
      y,
      leader,
      box,
      priority: ownerMeta.priority,
    });
  }

  const dropLowerPriorityIndex = (i: number, j: number, active: readonly ResolvedPlacement[]): number => {
    const a = active[i];
    const b = active[j];
    if (a.priority !== b.priority) return a.priority < b.priority ? i : j;
    const aWidth = a.box.maxX - a.box.minX;
    const bWidth = b.box.maxX - b.box.minX;
    if (aWidth !== bWidth) return aWidth > bWidth ? i : j;
    return cmpKey(a.ownerId, b.ownerId) > 0 ? i : j;
  };

  const dropIndexForConflict = (active: readonly ResolvedPlacement[]): number => {
    for (let i = 0; i < active.length; i += 1) {
      if (staticLeaderTextObstacles.some((obstacle) => bboxIntersects(active[i].box, obstacle))) return i;
    }

    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        if (bboxIntersects(active[i].box, active[j].box)) {
          return dropLowerPriorityIndex(i, j, active);
        }
      }
    }

    for (let i = 0; i < active.length; i += 1) {
      const leader = active[i].leader;
      if (leader.length < 2) continue;

      if (staticLeaderTextObstacles.some((obstacle) => polylineIntersectsBBox(leader, obstacle))) return i;

      for (let j = 0; j < active.length; j += 1) {
        if (i === j) continue;
        if (polylineIntersectsBBox(leader, active[j].box)) return i;
      }

      for (let j = i + 1; j < active.length; j += 1) {
        const otherLeader = active[j].leader;
        if (otherLeader.length < 2 || !polylinesIntersect(leader, otherLeader)) continue;
        return dropLowerPriorityIndex(i, j, active);
      }
    }

    return -1;
  };

  const active = resolved.slice();
  for (;;) {
    const dropIndex = dropIndexForConflict(active);
    if (dropIndex < 0) break;
    active.splice(dropIndex, 1);
  }

  for (const item of active) {
    representedIds.add(item.ownerId);
    writeLabel(item.ownerMeta, {
      text: item.text,
      x: item.x,
      y: item.y,
      anchor: item.placement.textAnchor,
      baseline: item.placement.baseline,
      rotate: 0,
      leader: item.leader,
      inside: false,
    });

    for (const id of item.members) {
      if (id === item.ownerId) continue;
      const memberMeta = meta.get(id);
      if (!memberMeta) continue;
      representedIds.add(id);
      writeLabel(memberMeta, null);
      hidden[memberMeta.kind] += 1;
    }
  }

  for (const candidate of candidates) {
    if (representedIds.has(candidate.id)) continue;
    const candidateMeta = meta.get(candidate.id);
    if (!candidateMeta) continue;
    writeLabel(candidateMeta, null);
    hidden[candidateMeta.kind] += 1;
  }

  return hidden;
}

/**
 * Realistic SVG-node estimate + culling counts. Counts every drawn primitive:
 * backbone, feature segment paths, visible feature/restriction labels and their
 * leaders, one density tick per restriction site, one tick per restriction
 * cluster, and coordinate ticks + labels.
 */
function tallyBudgets(
  features: readonly MapFeatureRender[],
  restrictionDensityTicks: readonly MapRestrictionDensityTick[],
  restrictions: readonly MapRestrictionRender[],
  coordinates: readonly MapCoordinateTick[],
  hiddenLabelCount: number,
  laneCount: number,
  overflowFeatureCount: number,
): MapBudgets {
  let segmentPaths = 0;
  let featureLabels = 0;
  let featureLeaders = 0;
  for (const f of features) {
    segmentPaths += f.segmentPaths.length;
    if (f.label) {
      featureLabels += 1;
      if (f.label.leader.length > 0) featureLeaders += 1;
    }
  }
  let recLabels = 0;
  let recLeaders = 0;
  for (const r of restrictions) {
    if (r.label) {
      recLabels += 1;
      if (r.label.leader.length > 0) recLeaders += 1;
    }
  }
  const coordLabels = coordinates.reduce((n, c) => n + (c.label ? 1 : 0), 0);

  const estimatedSvgNodes =
    1 + // backbone
    segmentPaths +
    featureLabels +
    featureLeaders +
    restrictionDensityTicks.length +
    restrictions.length + // one tick line per cluster
    recLabels +
    recLeaders +
    coordinates.length + // coordinate ticks
    coordLabels;

  return {
    estimatedSvgNodes,
    visibleLabelCount: featureLabels + recLabels,
    hiddenLabelCount,
    laneCount,
    overflowFeatureCount,
  };
}

/** Round a point's coordinates to keep output compact + deterministic. */
function roundPt(p: Pt): Pt {
  return { x: round(p.x), y: round(p.y) };
}

/** Tangential-ish rotation for an inline circular label, kept upright. */
function tangentialRotation(angleDeg: number): number {
  let rot = ((((angleDeg % 360) + 540) % 360) - 180);
  if (rot > 90) rot -= 180;
  if (rot < -90) rot += 180;
  return rot;
}

// On-arc inline labels follow a baseline arc so long names hug the feature curve.
const ARC_LABEL_MIN_SWEEP_DEG = 5; // below this a straight tangent is indistinguishable
const ARC_LABEL_MAX_SWEEP_DEG = 320; // avoid near-full-circle wrap-around
const ARC_LABEL_PAD_DEG = 1; // slight breathing room past the raw text width

/**
 * SVG baseline-arc path for an inline (on-arc) feature label at radius `r`,
 * centered on `midAngleDeg` and spanning `sweepDeg`. On the bottom half of the
 * circle the path is drawn counter-clockwise so the text renders upright rather
 * than upside-down (the standard donut-label flip). Returns null when the sweep
 * is too small to be worth curving or so large it would wrap the ring — the
 * caller then falls back to a single straight rotated <text>.
 */
function describeInlineLabelArc(
  cx: number,
  cy: number,
  r: number,
  midAngleDeg: number,
  sweepDeg: number,
): string | null {
  if (!(r > 0) || !(sweepDeg >= ARC_LABEL_MIN_SWEEP_DEG) || sweepDeg > ARC_LABEL_MAX_SWEEP_DEG) return null;
  const half = sweepDeg / 2;
  const norm = ((midAngleDeg % 360) + 360) % 360;
  const bottom = norm > 90 && norm < 270;
  const startA = bottom ? midAngleDeg + half : midAngleDeg - half;
  const endA = bottom ? midAngleDeg - half : midAngleDeg + half;
  const sweepFlag = bottom ? 0 : 1;
  const largeArc = sweepDeg > 180 ? 1 : 0;
  const s = pointOnCircle(cx, cy, r, startA);
  const e = pointOnCircle(cx, cy, r, endA);
  return `M ${round(s.x)} ${round(s.y)} A ${round(r)} ${round(r)} 0 ${largeArc} ${sweepFlag} ${round(e.x)} ${round(e.y)}`;
}

/** Full-circle backbone as a two-arc SVG path. */
function circlePath(cx: number, cy: number, r: number): string {
  const top = { x: cx, y: cy - r };
  const bottom = { x: cx, y: cy + r };
  return [
    `M ${round(top.x)} ${round(top.y)}`,
    `A ${round(r)} ${round(r)} 0 1 1 ${round(bottom.x)} ${round(bottom.y)}`,
    `A ${round(r)} ${round(r)} 0 1 1 ${round(top.x)} ${round(top.y)}`,
    'Z',
  ].join(' ');
}

/**
 * Rounded-rectangle SVG path (clockwise from the top-left corner). Radius is clamped
 * so thin/short features degrade gracefully to a near-rectangle.
 */
function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M ${round(x + rr)} ${round(y)}`,
    `H ${round(x + w - rr)}`,
    `A ${round(rr)} ${round(rr)} 0 0 1 ${round(x + w)} ${round(y + rr)}`,
    `V ${round(y + h - rr)}`,
    `A ${round(rr)} ${round(rr)} 0 0 1 ${round(x + w - rr)} ${round(y + h)}`,
    `H ${round(x + rr)}`,
    `A ${round(rr)} ${round(rr)} 0 0 1 ${round(x)} ${round(y + h - rr)}`,
    `V ${round(y + rr)}`,
    `A ${round(rr)} ${round(rr)} 0 0 1 ${round(x + rr)} ${round(y)}`,
    'Z',
  ].join(' ');
}

/** Nearest "nice" 1/2/5 x 10^n step at or above `raw` (for coordinate ticks). */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const frac = raw / base;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return niceFrac * base;
}

/** Positive modulo onto [0, length). */
function mod(value: number, length: number): number {
  return ((value % length) + length) % length;
}
