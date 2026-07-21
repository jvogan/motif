/**
 * Radial tier placement for circular-map labels.
 *
 * Pure + deterministic: no DOM measurement, no React, no store, no Date/Math.random.
 * Inputs must carry precomputed text dimensions; this helper only performs circular
 * degree-space ordering, tier assignment, and AABB/leader collision checks.
 */
import { pointOnCircle } from './coordinates';
import type { BBox, Pt } from '../types';

export interface RadialTierLabelCandidate {
  id: string;
  /**
   * Candidates with different group keys may share an angle but are never folded
   * into one comma label. Used by the plasmid map to keep feature names separate
   * from restriction/enzyme clusters.
   */
  groupKey?: string;
  /** Degrees clockwise from 12 o'clock, matching coordinates.ts. */
  angleDeg: number;
  /** On-ring point where the leader departs. Usually the tick outer point. */
  anchor: Pt;
  /** For soft feature labels, slide the leader start along this radius when angle shifting. */
  anchorFollowsAngle?: boolean;
  text: string;
  width: number;
  height: number;
  /** Higher priority wins deterministic tie-breaks at the same angle. */
  priority?: number;
  /** Optional hard cap for the generated leader polyline length. */
  maxLeaderLength?: number;
}

export interface RadialTierLabelOptions {
  cx: number;
  cy: number;
  baseRadius: number;
  radiusStep: number;
  angularThresholdDeg: number;
  /** Highest outward tier allowed. Tier 0 is at baseRadius. */
  maxTier: number;
  /** Maximum outward pushes per label after its initial tier. */
  maxPushes: number;
  /** Defaults to true for legacy callers; circular map callers set false to keep labels individual. */
  allowGrouping?: boolean;
  /** Maximum tangential drift from the candidate's true angle. Defaults to half the clustering threshold. */
  maxAngleShiftDeg?: number;
  /** Search increment for bounded angular drift. */
  angleStepDeg?: number;
  obstacles: readonly BBox[];
  /** Defaults to `obstacles`; callers may pass text/tick-only boxes when glyph boxes are too coarse for leader checks. */
  leaderObstacles?: readonly BBox[];
  /** Minimum protected radius for the whole label box. Defaults to each candidate's anchor radius. */
  minClearanceRadius?: number;
  defaultLabelWidth?: number;
  defaultLabelHeight?: number;
}

export type RadialTextAnchor = 'start' | 'middle' | 'end';
export type RadialLabelBaseline = 'middle' | 'hanging' | 'auto';

export interface RadialTierLabelPlacement {
  id: string;
  pos: Pt;
  textAnchor: RadialTextAnchor;
  baseline: RadialLabelBaseline;
  leader: readonly Pt[];
  tier: number;
  angleDeg: number;
  group?: {
    members: string[];
    text: string;
  };
}

interface OrderedCandidate {
  candidate: RadialTierLabelCandidate;
  inputIndex: number;
  angle: number;
}

interface PreparedLabel {
  id: string;
  text: string;
  width: number;
  height: number;
  angleDeg: number;
  anchor: Pt;
  anchorRadius: number;
  anchorFollowsAngle: boolean;
  startTier: number;
  preferredShiftSign: -1 | 1;
  maxLeaderLength?: number;
  group?: {
    members: string[];
    text: string;
  };
}

interface PlacementAttempt {
  placement: RadialTierLabelPlacement;
  box: BBox;
}

interface PlacedLabel {
  box: BBox;
  leader: readonly Pt[];
  angleDeg: number;
}

/**
 * A candidate the greedy pass could not place, remembered so the row-gap spread never
 * escalates a placed label into the angular column a later placement pass needs for it.
 */
interface SkipZone {
  angle: number;
  width: number;
}

const FULL_CIRCLE_DEG = 360;
const VERTICAL_ANCHOR_BAND_DEG = 10;
const GROUP_VISIBLE_NAMES = 2;
const EPS = 1e-6;
const DEFAULT_ANGLE_STEP_DEG = 1.5;
/**
 * Bias between the two ways a crowded label can dodge its neighbours: slide tangentially
 * along one ring, or step outward onto a fresh radial tier. Each tier of outward bump is
 * treated as "costing" this many degrees of tangential drift, so the placement search
 * (orderedPlacementSlots) prefers a short radial stack over a long sideways fan once a
 * label would otherwise have to slide more than this many degrees — the user's
 * "one ring, fanned -> two rings, stacked" model. Smaller = stack more eagerly (labels
 * climb tiers sooner, shorter/straighter leaders); larger = fan further before stacking.
 *
 * It never changes WHICH spots exist — every tier/shift combination is still attempted —
 * only the ORDER they are tried in. A single label therefore still places iff some spot
 * fits, exactly as before. That does NOT make the label COUNT invariant — see point 2
 * below, which is precisely the mistake this sentence used to invite.
 *
 * Set to one DEFAULT_ANGLE_STEP_DEG: stepping out one tier costs exactly what the
 * smallest sideways step costs. That is the right exchange rate because a tier bump
 * adds NO tangential displacement while even the smallest slide adds several units
 * of it, and tangential displacement is what actually breaks a leader (see the
 * 'pointing at their own tick' test in plasmid-map/__tests__/layout.test.ts).
 *
 * Chosen by measurement, not taste. Worst-case sideways offset of a label from its own
 * tick's spoke, in ring-radius %, on the bundled plasmids at 1920x1080:
 *   value 4 (previous): 26%   <- one leader ran 86 degrees off radial, unreadable
 *   value 1.5:           5%
 *   value <= 1:          0%   but stacks far enough out to shrink the drawn ring.
 *
 * Two measured constraints matter when changing this value:
 *
 * 1. "Ring size is unchanged at 1.5" holds only on the SPARSE bundled fixtures. On a
 *    crowded ring WITH features the drawn ring (radius / bg.width) goes 77.0% -> 71.4%
 *    at 1920x1080 and 67.8% -> 66.2% at 1440x900. The ring does shrink here, so the
 *    value may still be affordable. Re-measure both on a crowded-with-features map
 *    before changing it.
 *
 * 2. The label COUNT is not invariant. The pack is sequential, and this same constant
 *    also governs the FEATURE label pass, which runs first and whose output becomes the
 *    obstacle set for the restriction pass. Measured on a crowded ring, totals move both
 *    ways: 32 -> 31 on one seed (the casualty was a feature label, "M13-rev primer") and
 *    24 -> 25 on another. A sweep with `features: []` cannot see this at all — with no
 *    features the outer tiers are empty, the packer stacks freely, and the effect very
 *    nearly vanishes. Any future sweep here MUST vary features.
 */
const TIER_ESCALATION_ANGLE_EQUIV_DEG = 1.5;
const CENTERED_LABEL_RING_CLEARANCE_PX = 1;
const CENTERED_LABEL_COLLISION_PAD_PX = 0;
/**
 * Minimum horizontal separation (in packer user-units) preferred between two placed
 * labels that share a visual row, so adjacent restriction labels do not read as one
 * run-on string ("EarI,MboII +14DpnI,MboI +14").
 *
 * Applied as a SOFT preference by spreadPlacedLabelsForRowGap AFTER the initial pack,
 * NOT by inflating the collision box: the greedy pack ignores this gap (so it fixes the
 * label SET), then the spread relocates a crowded label to a nearby spot that clears this
 * separation, committing the move only when such a spot exists. A label with no gap-clean
 * spot just stays put — the gap is never a hard constraint, so it can never drop a label.
 * (Padding CENTERED_LABEL_COLLISION_PAD_PX to enforce the gap DURING packing did drop
 * labels; that stays 0 on purpose.)
 */
const CENTERED_LABEL_MIN_ROW_GAP_PX = 10;
/** Two boxes count as sharing a row when they vertically overlap by more than this fraction of the shorter box. */
const SAME_ROW_OVERLAP_FRACTION = 0.25;
/**
 * A leader that fans far around the ring is easier to trace when it first leaves
 * the cut-site tick radially, then turns toward the label. Sparse / nearly radial
 * leaders stay as one straight segment; these values only affect clearly displaced
 * labels and are expressed in the same SVG user-units as the layout.
 */
const LEADER_ELBOW_TANGENTIAL_THRESHOLD_PX = 12;
const LEADER_ELBOW_MIN_RADIAL_PX = 8;
const LEADER_ELBOW_MAX_RADIAL_PX = 16;

function normalizeAngleDeg(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) return 0;
  const normalized = angleDeg % FULL_CIRCLE_DEG;
  return normalized < 0 ? normalized + FULL_CIRCLE_DEG : normalized;
}

function circularGapDeg(a: number, b: number): number {
  const gap = b - a;
  return gap < 0 ? gap + FULL_CIRCLE_DEG : gap;
}

function angularDistanceDeg(a: number, b: number): number {
  return Math.min(circularGapDeg(a, b), circularGapDeg(b, a));
}

function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function candidateSort(a: OrderedCandidate, b: OrderedCandidate): number {
  return (
    a.angle - b.angle ||
    cmpString(a.candidate.groupKey ?? '', b.candidate.groupKey ?? '') ||
    (b.candidate.priority ?? 0) - (a.candidate.priority ?? 0) ||
    cmpString(a.candidate.id, b.candidate.id) ||
    a.inputIndex - b.inputIndex
  );
}

function orderForCircularClusters(
  candidates: readonly RadialTierLabelCandidate[],
  angularThresholdDeg: number,
): OrderedCandidate[] {
  const ordered = candidates
    .map((candidate, inputIndex) => ({
      candidate,
      inputIndex,
      angle: normalizeAngleDeg(candidate.angleDeg),
    }))
    .sort(candidateSort);

  if (ordered.length <= 1) return ordered;

  let largestGap = -1;
  let largestGapIndex = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const next = ordered[(i + 1) % ordered.length];
    const gap = circularGapDeg(ordered[i].angle, next.angle);
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = i;
    }
  }

  if (largestGap <= angularThresholdDeg) return ordered;
  const start = (largestGapIndex + 1) % ordered.length;
  return ordered.slice(start).concat(ordered.slice(0, start));
}

function clusterOrderedCandidates(
  ordered: readonly OrderedCandidate[],
  angularThresholdDeg: number,
): OrderedCandidate[][] {
  if (ordered.length === 0) return [];
  const clusters: OrderedCandidate[][] = [];
  let current: OrderedCandidate[] = [ordered[0]];

  for (let i = 1; i < ordered.length; i += 1) {
    const gap = circularGapDeg(ordered[i - 1].angle, ordered[i].angle);
    const sameGroupKey = (ordered[i - 1].candidate.groupKey ?? '') === (ordered[i].candidate.groupKey ?? '');
    if (sameGroupKey && gap <= angularThresholdDeg) {
      current.push(ordered[i]);
    } else {
      clusters.push(current);
      current = [ordered[i]];
    }
  }

  clusters.push(current);
  return clusters;
}

function clusterMidAngleDeg(cluster: readonly OrderedCandidate[]): number {
  if (cluster.length === 0) return 0;
  if (cluster.length === 1) return cluster[0].angle;

  const first = cluster[0].angle;
  let prev = first;
  let last = first;
  for (let i = 1; i < cluster.length; i += 1) {
    let angle = cluster[i].angle;
    while (angle < prev) angle += FULL_CIRCLE_DEG;
    prev = angle;
    last = angle;
  }
  return normalizeAngleDeg(first + (last - first) / 2);
}

function groupText(cluster: readonly OrderedCandidate[]): { text: string; members: string[] } {
  const members = cluster.map((item) => item.candidate.id);
  const visible = cluster.slice(0, GROUP_VISIBLE_NAMES).map((item) => item.candidate.text);
  const hiddenCount = Math.max(0, cluster.length - visible.length);
  const suffix = hiddenCount > 0 ? ` +${hiddenCount}` : '';
  return { text: `${visible.join(', ')}${suffix}`, members };
}

function estimatedCharWidth(candidates: readonly OrderedCandidate[]): number {
  let max = 0;
  for (const item of candidates) {
    const textLength = Math.max(1, item.candidate.text.length);
    max = Math.max(max, item.candidate.width / textLength);
  }
  return max > 0 ? max : 6;
}

function groupDimensions(
  group: readonly OrderedCandidate[],
  text: string,
  opts: RadialTierLabelOptions,
): { width: number; height: number } {
  const charWidth = estimatedCharWidth(group);
  const width = Math.max(
    opts.defaultLabelWidth ?? 0,
    text.length * charWidth,
    ...group.map((item) => item.candidate.width),
  );
  const height = Math.max(
    opts.defaultLabelHeight ?? 0,
    ...group.map((item) => item.candidate.height),
  );
  return { width, height };
}

function anchorForAngle(angleDeg: number): {
  textAnchor: RadialTextAnchor;
  baseline: RadialLabelBaseline;
} {
  const a = normalizeAngleDeg(angleDeg);
  if (a <= VERTICAL_ANCHOR_BAND_DEG || a >= FULL_CIRCLE_DEG - VERTICAL_ANCHOR_BAND_DEG) {
    return { textAnchor: 'middle', baseline: 'auto' };
  }
  if (Math.abs(a - 180) <= VERTICAL_ANCHOR_BAND_DEG) {
    return { textAnchor: 'middle', baseline: 'hanging' };
  }
  return { textAnchor: 'middle', baseline: 'middle' };
}

function labelBBoxAt(
  pos: Pt,
  textAnchor: RadialTextAnchor,
  baseline: RadialLabelBaseline,
  width: number,
  height: number,
): BBox {
  const minX = textAnchor === 'start' ? pos.x : textAnchor === 'end' ? pos.x - width : pos.x - width / 2;
  const maxX = textAnchor === 'start' ? pos.x + width : textAnchor === 'end' ? pos.x : pos.x + width / 2;
  const minY = baseline === 'hanging' ? pos.y : baseline === 'auto' ? pos.y - height : pos.y - height / 2;
  const maxY = baseline === 'hanging' ? pos.y + height : baseline === 'auto' ? pos.y : pos.y + height / 2;
  return { minX, minY, maxX, maxY };
}

function labelOffsetCorners(
  textAnchor: RadialTextAnchor,
  baseline: RadialLabelBaseline,
  width: number,
  height: number,
): readonly Pt[] {
  const minX = textAnchor === 'start' ? 0 : textAnchor === 'end' ? -width : -width / 2;
  const maxX = textAnchor === 'start' ? width : textAnchor === 'end' ? 0 : width / 2;
  const minY = baseline === 'hanging' ? 0 : baseline === 'auto' ? -height : -height / 2;
  const maxY = baseline === 'hanging' ? height : baseline === 'auto' ? 0 : height / 2;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

function labelRadialClearance(
  label: PreparedLabel,
  opts: RadialTierLabelOptions,
  textAnchor: RadialTextAnchor,
  baseline: RadialLabelBaseline,
  width: number,
  height: number,
  angleDeg: number,
): number {
  const unit = pointOnCircle(0, 0, 1, angleDeg);
  const minCornerProjection = Math.min(
    ...labelOffsetCorners(textAnchor, baseline, width, height).map((corner) => corner.x * unit.x + corner.y * unit.y),
  );
  const inwardExtent = Math.max(0, -minCornerProjection);
  const anchorRadius = Math.hypot(label.anchor.x - opts.cx, label.anchor.y - opts.cy);
  const protectedRadius = Math.max(0, opts.minClearanceRadius ?? anchorRadius);
  const sideClearance =
    textAnchor === 'middle' && baseline === 'middle' ? CENTERED_LABEL_RING_CLEARANCE_PX : 0;
  return Math.max(0, protectedRadius + inwardExtent + sideClearance - opts.baseRadius);
}

function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function labelCollisionBox(box: BBox, textAnchor: RadialTextAnchor): BBox {
  const padX = textAnchor === 'middle' ? CENTERED_LABEL_COLLISION_PAD_PX : 0;
  return {
    minX: box.minX - padX,
    minY: box.minY,
    maxX: box.maxX + padX,
    maxY: box.maxY,
  };
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return (
    a.minX < b.maxX - EPS &&
    a.maxX > b.minX + EPS &&
    a.minY < b.maxY - EPS &&
    a.maxY > b.minY + EPS
  );
}

/** True when two boxes overlap vertically enough to read as the same horizontal row. */
function boxesShareRow(a: BBox, b: BBox): boolean {
  const verticalOverlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const shorter = Math.min(a.maxY - a.minY, b.maxY - b.minY);
  return verticalOverlap > Math.max(EPS, SAME_ROW_OVERLAP_FRACTION * shorter);
}

/** Signed horizontal gap between two boxes: > 0 is clear space, <= 0 is touching/overlapping. */
function horizontalGapBetween(a: BBox, b: BBox): number {
  return Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
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
    t1 > t0 + EPS
  );
}

function polylineIntersectsBBox(polyline: readonly Pt[], box: BBox): boolean {
  for (let i = 1; i < polyline.length; i += 1) {
    if (segmentIntersectsBBox(polyline[i - 1], polyline[i], box)) return true;
  }
  return false;
}

function polylineIntersectsAnyBBox(polyline: readonly Pt[], boxes: readonly BBox[]): boolean {
  return boxes.some((box) => polylineIntersectsBBox(polyline, box));
}

function pointInsideOrOnBBox(point: Pt, box: BBox): boolean {
  return (
    point.x >= box.minX - EPS &&
    point.x <= box.maxX + EPS &&
    point.y >= box.minY - EPS &&
    point.y <= box.maxY + EPS
  );
}

function samePoint(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
}

function leaderFor(
  anchor: Pt,
  pos: Pt,
  tier: number,
  startTier: number,
  center: Pt,
): readonly Pt[] {
  if (tier === 0 && startTier === 0 && samePoint(anchor, pos)) return [];

  const radialX = anchor.x - center.x;
  const radialY = anchor.y - center.y;
  const radialLength = Math.hypot(radialX, radialY);
  if (radialLength <= EPS) return [anchor, pos];

  const unitX = radialX / radialLength;
  const unitY = radialY / radialLength;
  const deltaX = pos.x - anchor.x;
  const deltaY = pos.y - anchor.y;
  const tangentialTravel = Math.abs(deltaX * -unitY + deltaY * unitX);
  const outwardTravel = deltaX * unitX + deltaY * unitY;
  if (tangentialTravel < LEADER_ELBOW_TANGENTIAL_THRESHOLD_PX || outwardTravel <= LEADER_ELBOW_MIN_RADIAL_PX) {
    return [anchor, pos];
  }

  const elbowTravel = Math.min(
    LEADER_ELBOW_MAX_RADIAL_PX,
    Math.max(LEADER_ELBOW_MIN_RADIAL_PX, outwardTravel * 0.45),
  );
  const elbow = {
    x: anchor.x + unitX * elbowTravel,
    y: anchor.y + unitY * elbowTravel,
  };
  return [anchor, elbow, pos];
}

function segmentOrientation(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(a: Pt, b: Pt, p: Pt): boolean {
  return (
    Math.min(a.x, b.x) - EPS <= p.x &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.y, b.y) - EPS <= p.y &&
    p.y <= Math.max(a.y, b.y) + EPS &&
    Math.abs(segmentOrientation(a, b, p)) <= EPS
  );
}

function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  if (samePoint(a, c) || samePoint(a, d) || samePoint(b, c) || samePoint(b, d)) return false;

  const o1 = segmentOrientation(a, b, c);
  const o2 = segmentOrientation(a, b, d);
  const o3 = segmentOrientation(c, d, a);
  const o4 = segmentOrientation(c, d, b);
  if (Math.abs(o1) <= EPS && pointOnSegment(a, b, c)) return true;
  if (Math.abs(o2) <= EPS && pointOnSegment(a, b, d)) return true;
  if (Math.abs(o3) <= EPS && pointOnSegment(c, d, a)) return true;
  if (Math.abs(o4) <= EPS && pointOnSegment(c, d, b)) return true;
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

function routeLeaderAroundObstacles(
  anchor: Pt,
  pos: Pt,
  tier: number,
  startTier: number,
  center: Pt,
  obstacles: readonly BBox[],
  placedLeaders: readonly (readonly Pt[])[],
): readonly Pt[] | null {
  const elbow = leaderFor(anchor, pos, tier, startTier, center);
  if (elbow.length < 2) return elbow;

  const relevantObstacles = obstacles.filter(
    (box) => !pointInsideOrOnBBox(anchor, box) && !pointInsideOrOnBBox(pos, box),
  );
  const clears = (leader: readonly Pt[]) => (
    !polylineIntersectsAnyBBox(leader, relevantObstacles)
    && !placedLeaders.some((placed) => placed.length > 1 && polylinesIntersect(leader, placed))
  );

  // A direct leader is the calmest and most legible route when the chord is clear.
  // Keep the short radial-first elbow as a real collision escape hatch rather than
  // adding a decorative dogleg to every sufficiently shifted label.
  const straight = [anchor, pos];
  if (clears(straight)) return straight;
  return elbow.length > 2 && clears(elbow) ? elbow : null;
}

function polylineLength(polyline: readonly Pt[]): number {
  let length = 0;
  for (let i = 1; i < polyline.length; i += 1) {
    const dx = polyline[i].x - polyline[i - 1].x;
    const dy = polyline[i].y - polyline[i - 1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

function maxFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function angularShiftCandidates(
  maxShiftDeg: number,
  stepDeg: number,
  preferredSign: -1 | 1,
): number[] {
  const maxShift = Math.max(0, maxShiftDeg);
  const step = Math.max(0.25, stepDeg);
  const shifts = [0];
  let lastAmount = 0;
  for (let amount = step; amount <= maxShift + EPS; amount += step) {
    shifts.push(amount * preferredSign);
    shifts.push(-amount * preferredSign);
    lastAmount = amount;
  }
  if (maxShift > EPS && maxShift - lastAmount > EPS) {
    shifts.push(maxShift * preferredSign);
    shifts.push(-maxShift * preferredSign);
  }
  return shifts;
}

interface PlacementSlot {
  tier: number;
  angleShift: number;
}

/**
 * Enumerate the (tier, tangential-shift) spots a label may occupy, ordered so the greedy
 * search tries the ones that keep it closest to a short, radial leader FIRST.
 *
 * Cost = (tiers bumped past startTier) * TIER_ESCALATION_ANGLE_EQUIV_DEG + |shift in deg|.
 * The sort is stable and index-broken, so:
 *   - within one tier, slots keep the caller's angle-shift order (0, preferred sign, other,
 *     then outward) unchanged;
 *   - with maxPushes 0 the list collapses to that single-tier order, so the row-gap spread's
 *     per-tier probe and every single-tier caller behave EXACTLY as before this change;
 *   - only when outward tiers are available do small radial bumps interleave AHEAD of large
 *     tangential slides, turning a fanned arc into a radial stack.
 *
 * Crucially it emits every slot the old nested loop did (same set, reordered), so a label
 * that only fit via a large slide still finds that slide here — no label can be lost.
 */
function orderedPlacementSlots(
  startTier: number,
  maxTier: number,
  maxPushes: number,
  angleShifts: readonly number[],
): PlacementSlot[] {
  const entries: { slot: PlacementSlot; cost: number; index: number }[] = [];
  let index = 0;
  for (let push = 0; push <= maxPushes; push += 1) {
    const tier = startTier + push;
    if (tier > maxTier) break;
    for (let order = 0; order < angleShifts.length; order += 1) {
      const angleShift = angleShifts[order];
      entries.push({
        slot: { tier, angleShift },
        cost: push * TIER_ESCALATION_ANGLE_EQUIV_DEG + Math.abs(angleShift),
        index,
      });
      index += 1;
    }
  }
  entries.sort((a, b) => a.cost - b.cost || a.index - b.index);
  return entries.map((entry) => entry.slot);
}

function attemptPlaceWithSeparation(
  label: PreparedLabel,
  opts: RadialTierLabelOptions,
  placedLabels: readonly PlacedLabel[],
  minSeparation: number,
): PlacementAttempt | null {
  const maxTier = Math.max(0, Math.floor(opts.maxTier));
  const maxPushes = Math.max(0, Math.floor(opts.maxPushes));
  const startTier = Math.min(maxTier, Math.max(0, Math.floor(label.startTier)));
  const width = maxFinite(label.width, opts.defaultLabelWidth ?? 0);
  const height = maxFinite(label.height, opts.defaultLabelHeight ?? 0);
  const maxAngleShiftDeg = Math.max(
    0,
    opts.maxAngleShiftDeg ?? Math.max(DEFAULT_ANGLE_STEP_DEG, opts.angularThresholdDeg / 2),
  );
  const angleStepDeg = Math.max(0.25, opts.angleStepDeg ?? DEFAULT_ANGLE_STEP_DEG);
  const angleShifts = angularShiftCandidates(maxAngleShiftDeg, angleStepDeg, label.preferredShiftSign);
  const placedBoxes = placedLabels.map((placed) => placed.box);
  const placedLeaders = placedLabels.map((placed) => placed.leader);

  // Try (tier, shift) spots in cost order: small radial bumps beat big tangential slides,
  // so a crowded label stacks onto a fresh ring near its own tick instead of fanning far
  // sideways along one ring. The slot set is identical to the old nested loop — only the
  // visiting order changed — so first-fit still finds a spot whenever one exists.
  const slots = orderedPlacementSlots(startTier, maxTier, maxPushes, angleShifts);
  for (const { tier, angleShift } of slots) {
    const radius = opts.baseRadius + tier * opts.radiusStep;
    const angleDeg = normalizeAngleDeg(label.angleDeg + angleShift);
    const { textAnchor, baseline } = anchorForAngle(angleDeg);
    const rawPos = pointOnCircle(opts.cx, opts.cy, radius, angleDeg);
    const leaderAnchor = label.anchorFollowsAngle
      ? pointOnCircle(opts.cx, opts.cy, label.anchorRadius, angleDeg)
      : label.anchor;
    const radialClearance = labelRadialClearance(label, opts, textAnchor, baseline, width, height, angleDeg);
    const pos = pointOnCircle(opts.cx, opts.cy, radius + radialClearance, angleDeg);
    const box = labelBBoxAt(pos, textAnchor, baseline, width, height);
    const collisionBox = labelCollisionBox(box, textAnchor);
    const obstacleBox =
      radialClearance > EPS
        ? unionBBox(labelCollisionBox(labelBBoxAt(rawPos, textAnchor, baseline, width, height), textAnchor), collisionBox)
        : collisionBox;

    const collides =
      opts.obstacles.some((obstacle) => bboxIntersects(obstacleBox, obstacle)) ||
      placedBoxes.some((placed) => bboxIntersects(collisionBox, placed));
    if (collides) continue;

    // Same-row separation: reject spots that clear the overlap test but still crowd an
    // already-placed label on the same row. Only the post-pass (spreadPlacedLabelsForRowGap)
    // passes minSeparation > 0; the initial pack uses 0, so this never affects the set of
    // labels placed — it only steers the spread's re-search toward roomier spots.
    if (
      minSeparation > 0 &&
      placedBoxes.some(
        (placed) =>
          boxesShareRow(collisionBox, placed) &&
          horizontalGapBetween(collisionBox, placed) < minSeparation - EPS,
      )
    ) {
      continue;
    }

    const leaderObstacles = opts.leaderObstacles ?? opts.obstacles;
    const sameSpokeStackBoxes =
      textAnchor === 'middle' && baseline === 'middle'
        ? placedLabels.filter((placed) => angularDistanceDeg(placed.angleDeg, angleDeg) > EPS)
        : placedLabels;
    const combinedLeaderObstacles = [...leaderObstacles, ...sameSpokeStackBoxes.map((placed) => placed.box)];
    const leader = routeLeaderAroundObstacles(
      leaderAnchor,
      pos,
      tier,
      startTier,
      { x: opts.cx, y: opts.cy },
      combinedLeaderObstacles,
      placedLeaders,
    );
    if (leader == null) continue;
    const leaderTooLong =
      label.maxLeaderLength !== undefined && leader.length > 1 && polylineLength(leader) > label.maxLeaderLength;

    if (!leaderTooLong) {
      return {
        box: collisionBox,
        placement: {
          id: label.id,
          pos,
          textAnchor,
          baseline,
          leader,
          tier,
          angleDeg,
          ...(label.group ? { group: label.group } : {}),
        },
      };
    }
  }

  return null;
}

function attemptPlace(
  label: PreparedLabel,
  opts: RadialTierLabelOptions,
  placedLabels: readonly PlacedLabel[],
): PlacementAttempt | null {
  // The initial pack is gap-agnostic (minSeparation 0): every label lands in the first
  // clear tier/angle exactly as before the row-gap work, so this pass fixes the SET of
  // placed labels. Comfortable same-row separation is opened afterwards by
  // spreadPlacedLabelsForRowGap, which only RELOCATES placed labels into free space —
  // never adding or dropping one — so label counts can't regress.
  return attemptPlaceWithSeparation(label, opts, placedLabels, 0);
}

/** True when `box` crowds any same-row label in `others` closer than the min gap. */
function boxHasTightRowNeighbor(
  box: BBox,
  others: readonly PlacedLabel[],
  minSeparation: number,
): boolean {
  return others.some(
    (other) => boxesShareRow(box, other.box) && horizontalGapBetween(box, other.box) < minSeparation - EPS,
  );
}

/**
 * True when an escalated placement lands close enough (in angle) to an unplaced candidate
 * that their labels would share horizontal space — i.e. the escalation is eating into the
 * angular column a later placement pass will try to reuse for that candidate.
 */
function encroachesReservedColumn(
  attempt: PlacementAttempt,
  labelWidth: number,
  skipped: readonly SkipZone[],
  opts: RadialTierLabelOptions,
  minSeparation: number,
): boolean {
  if (skipped.length === 0) return false;
  const radius = Math.max(1, Math.hypot(attempt.placement.pos.x - opts.cx, attempt.placement.pos.y - opts.cy));
  for (const skip of skipped) {
    const reservedArc = labelWidth / 2 + skip.width / 2 + minSeparation;
    const reservedDeg = (reservedArc / radius) * (180 / Math.PI);
    if (angularDistanceDeg(attempt.placement.angleDeg, skip.angle) < reservedDeg) return true;
  }
  return false;
}

/**
 * Second pass that opens a comfortable horizontal gap between labels sharing a row, so
 * adjacent restriction clusters stop reading as one run-on string.
 *
 * The greedy pass has already fixed the SET of placed labels — this pass adds and removes
 * nothing. For each label that crowds a same-row neighbor it re-places THAT one label,
 * from its current tier outward, against every OTHER label's fixed box. A restriction
 * leader is pinned to its true cut-site tick, so a large same-tier tangential slide would
 * slant the leader across neighbouring ticks and be rejected; bumping the label one tier
 * out keeps the leader short and radial, which is what actually opens a tight cluster.
 *
 * A move is committed only when it (1) clears `CENTERED_LABEL_MIN_ROW_GAP_PX`, (2) leaves
 * the label's box and leader clear of every other placed label — the exact pairwise
 * conflicts layout.ts would otherwise resolve by DROPPING a label — and (3) if it bumps a
 * tier, does not settle into the angular column reserved for a candidate the greedy could
 * not place (which a later fallback pass needs). Otherwise the label keeps its greedy spot.
 * Because a committed label ends up clear of all the others, moving one can never crowd
 * another; tightness is monotonically non-increasing and no label is ever lost.
 */
function spreadPlacedLabelsForRowGap(
  placed: RadialTierLabelPlacement[],
  placedLabels: PlacedLabel[],
  prepared: readonly PreparedLabel[],
  opts: RadialTierLabelOptions,
  skipped: readonly SkipZone[],
): void {
  const minSeparation = CENTERED_LABEL_MIN_ROW_GAP_PX;
  if (minSeparation <= 0 || placedLabels.length < 2) return;
  const maxTier = Math.max(0, Math.floor(opts.maxTier));

  const MAX_PASSES = 3;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let moved = false;
    for (let k = 0; k < placedLabels.length; k += 1) {
      const others = placedLabels.filter((_, idx) => idx !== k);
      if (!boxHasTightRowNeighbor(placedLabels[k].box, others, minSeparation)) continue;

      // Walk outward from the label's current tier and take the FIRST tier that offers a
      // spot which is gap-clean, conflict-free, and skip-safe. Testing each tier in turn
      // (rather than accepting attemptPlaceWithSeparation's first gap-clean spot outright)
      // matters because a gap-clean spot on the current tier can still put the label under
      // a neighbour's leader; when it does, the label bumps one tier out instead of being
      // left crowded. Starting at the current tier (never inward) keeps the move minimal.
      const fromTier = placed[k].tier;
      let chosen: PlacementAttempt | null = null;
      for (let tier = fromTier; tier <= maxTier; tier += 1) {
        const reLabel: PreparedLabel = { ...prepared[k], startTier: tier };
        const reOpts: RadialTierLabelOptions = { ...opts, maxTier: tier, maxPushes: 0 };
        const candidate = attemptPlaceWithSeparation(reLabel, reOpts, others, minSeparation);
        if (candidate == null) continue; // no gap-clean angle on this tier

        // (2) The new box and leader must stay clear of every other placed label — the exact
        // pairwise conflicts layout.ts would otherwise resolve by DROPPING a label. The
        // packer avoids the shared obstacles, but its own leader check exempts same-spoke
        // labels and never tests a foreign leader against this box, so re-verify the full set.
        const candidateLeader = candidate.placement.leader;
        const conflicts = others.some(
          (other) =>
            bboxIntersects(candidate.box, other.box) ||
            (candidateLeader.length > 1 && polylineIntersectsBBox(candidateLeader, other.box)) ||
            (other.leader.length > 1 && polylineIntersectsBBox(other.leader, candidate.box)) ||
            (candidateLeader.length > 1 && other.leader.length > 1 && polylinesIntersect(candidateLeader, other.leader)),
        );
        if (conflicts) continue;

        // (3) An outward bump must not claim the angular column a still-unplaced candidate
        // needs. Same-tier moves take no new tier space, so only guard genuine escalations.
        if (tier > fromTier && encroachesReservedColumn(candidate, prepared[k].width, skipped, opts, minSeparation)) {
          continue;
        }

        chosen = candidate;
        break;
      }
      if (chosen == null) continue; // nowhere clean to open the gap -> leave the label put

      placedLabels[k] = {
        box: chosen.box,
        leader: chosen.placement.leader,
        angleDeg: chosen.placement.angleDeg,
      };
      placed[k] = chosen.placement;
      moved = true;
    }
    if (!moved) break;
  }
}

function preparedIndividual(
  item: OrderedCandidate,
  startTier: number,
  preferredShiftSign: -1 | 1,
  opts: RadialTierLabelOptions,
): PreparedLabel {
  const anchorRadius = Math.hypot(item.candidate.anchor.x - opts.cx, item.candidate.anchor.y - opts.cy);
  return {
    id: item.candidate.id,
    text: item.candidate.text,
    width: item.candidate.width,
    height: item.candidate.height,
    angleDeg: item.angle,
    anchor: item.candidate.anchor,
    anchorRadius,
    anchorFollowsAngle: item.candidate.anchorFollowsAngle === true,
    startTier,
    preferredShiftSign,
    maxLeaderLength: item.candidate.maxLeaderLength,
  };
}

function preparedGroup(
  group: readonly OrderedCandidate[],
  startTier: number,
  opts: RadialTierLabelOptions,
): PreparedLabel {
  const { text, members } = groupText(group);
  const angleDeg = clusterMidAngleDeg(group);
  const { width, height } = groupDimensions(group, text, opts);
  return {
    id: `group:${members.join(',')}`,
    text,
    width,
    height,
    angleDeg,
    anchor: pointOnCircle(opts.cx, opts.cy, opts.baseRadius, angleDeg),
    anchorRadius: opts.baseRadius,
    anchorFollowsAngle: true,
    startTier,
    preferredShiftSign: 1,
    group: { members, text },
  };
}

function resultSort(a: RadialTierLabelPlacement, b: RadialTierLabelPlacement): number {
  return normalizeAngleDeg(a.angleDeg) - normalizeAngleDeg(b.angleDeg) || cmpString(a.id, b.id);
}

/**
 * Place circular labels on radial tiers near their true angles.
 *
 * The output is intentionally close to MapLabelRender: `pos` maps to x/y,
 * `textAnchor` maps to anchor, and `leader` is already a polyline. This module
 * does not wire into layout.ts; callers decide how candidate dimensions and
 * obstacle boxes are derived.
 */
export function layoutRadialTierLabels(
  candidates: readonly RadialTierLabelCandidate[],
  opts: RadialTierLabelOptions,
): RadialTierLabelPlacement[] {
  if (candidates.length === 0) return [];

  const maxTier = Math.max(0, Math.floor(opts.maxTier));
  const maxPushes = Math.max(0, Math.floor(opts.maxPushes));
  const tierCount = maxTier + 1;
  const threshold = Math.max(0, opts.angularThresholdDeg);
  const allowGrouping = opts.allowGrouping !== false;
  const ordered = orderForCircularClusters(candidates, threshold);
  const clusters = clusterOrderedCandidates(ordered, threshold);
  const placedLabels: PlacedLabel[] = [];
  const placed: RadialTierLabelPlacement[] = [];
  // Prepared label kept per placement (lockstep with `placed`/`placedLabels`) so the
  // row-gap spread pass can re-place an individual label without re-deriving it.
  const prepared: PreparedLabel[] = [];

  for (const cluster of clusters) {
    if (maxPushes > 0 && cluster.length > 4) {
      const clusterMidIndex = (cluster.length - 1) / 2;
      const indices = cluster
        .map((_, index) => index)
        .sort((a, b) => (b % tierCount) - (a % tierCount) || a - b);
      for (const index of indices) {
        const startTier = index % tierCount;
        const preferredShiftSign: -1 | 1 = index < clusterMidIndex ? -1 : 1;
        const label = preparedIndividual(cluster[index], startTier, preferredShiftSign, opts);
        const attempt = attemptPlace(label, opts, placedLabels);
        if (attempt == null) continue;
        placedLabels.push({
          box: attempt.box,
          leader: attempt.placement.leader,
          angleDeg: attempt.placement.angleDeg,
        });
        placed.push(attempt.placement);
        prepared.push(label);
      }
      continue;
    }

    let i = 0;
    while (i < cluster.length) {
      const startTier = i % tierCount;
      const clusterMidIndex = (cluster.length - 1) / 2;
      const preferredShiftSign: -1 | 1 = i < clusterMidIndex ? -1 : 1;
      const label = preparedIndividual(cluster[i], startTier, preferredShiftSign, opts);
      const attempt = attemptPlace(label, opts, placedLabels);

      if (attempt != null) {
        placedLabels.push({
          box: attempt.box,
          leader: attempt.placement.leader,
          angleDeg: attempt.placement.angleDeg,
        });
        placed.push(attempt.placement);
        prepared.push(label);
        i += 1;
        continue;
      }

      const trailing = cluster.slice(i);
      if (!allowGrouping || trailing.length <= 1) {
        i += 1;
        continue;
      }

      const groupStartTier = Math.min(maxTier, startTier + 1);
      const group = preparedGroup(trailing, groupStartTier, opts);
      const groupAttempt = attemptPlace(group, opts, placedLabels);
      if (groupAttempt != null) {
        placedLabels.push({
          box: groupAttempt.box,
          leader: groupAttempt.placement.leader,
          angleDeg: groupAttempt.placement.angleDeg,
        });
        placed.push(groupAttempt.placement);
        prepared.push(group);
      }
      break;
    }
  }

  // Candidates the greedy left unplaced: a later placement pass (e.g. layout.ts's grouped
  // restriction fallback) will try to place them, so the spread must not escalate a label
  // into the angular column one of them needs.
  const placedIdSet = new Set<string>();
  for (const item of placed) {
    placedIdSet.add(item.id);
    if (item.group) for (const member of item.group.members) placedIdSet.add(member);
  }
  const skipped: SkipZone[] = candidates
    .filter((candidate) => !placedIdSet.has(candidate.id))
    .map((candidate) => ({ angle: normalizeAngleDeg(candidate.angleDeg), width: candidate.width }));

  spreadPlacedLabelsForRowGap(placed, placedLabels, prepared, opts, skipped);
  return placed.sort(resultSort);
}
