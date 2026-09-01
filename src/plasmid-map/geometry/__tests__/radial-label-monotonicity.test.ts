import { describe, expect, it } from 'vitest';
import { pointOnCircle } from '../coordinates';
import {
  layoutRadialTierLabels,
  type RadialTierLabelCandidate,
  type RadialTierLabelOptions,
} from '../radial-labels';
import type { BBox } from '../../types';

/**
 * Shrinking an obstacle should never cost a label: a smaller obstacle only frees
 * space, so the packer can only gain places to put one.
 *
 * The packer holds that on 159 of the 160 comparisons below. This file pins the
 * exception rather than rounding it away. First-fit is the leak: when an obstacle
 * shrinks, an earlier label can reach a cheaper slot that is closer to the ring but
 * further off its own spoke, and that sideways displacement covers a later label's
 * angular column. Trial 18 is the one case in this family where it does, and it
 * costs a single label.
 *
 * The budget is the guard. It fails if a change widens the coupling — anything that
 * reads obstacle geometry into a sort key, an anchor, or a tie-break — and it still
 * passes if someone closes the remaining gap.
 *
 * One repair was measured and rejected. Refusing, on a first sweep of the slot list,
 * any spot inside a not-yet-packed candidate's column takes this family to zero
 * losses and to 888 labels from 876, but costs the five bundled plasmids 8 labels
 * net across their circular layouts. The synthetic family is not the map.
 */

const CX = 400;
const CY = 400;
const RING = 260;
const TRIALS = 40;
const FACTORS = [0.95, 0.8, 0.5, 0.2];

/** Deterministic LCG: the same cases every run, on every machine. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function scaleAboutCenter(box: BBox, factor: number): BBox {
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;
  const halfW = ((box.maxX - box.minX) / 2) * factor;
  const halfH = ((box.maxY - box.minY) / 2) * factor;
  return { minX: midX - halfW, minY: midY - halfH, maxX: midX + halfW, maxY: midY + halfH };
}

function crowdedCase(random: () => number): { candidates: RadialTierLabelCandidate[]; obstacles: BBox[] } {
  const candidates: RadialTierLabelCandidate[] = [];
  const labelCount = 10 + Math.floor(random() * 30);
  for (let i = 0; i < labelCount; i += 1) {
    const angleDeg = random() * 360;
    candidates.push({
      id: `c${i}`,
      angleDeg,
      anchor: pointOnCircle(CX, CY, RING, angleDeg),
      anchorFollowsAngle: true,
      text: `label ${i}`,
      width: 30 + random() * 60,
      height: 16,
      priority: i,
    });
  }

  // Obstacles land in the band the labels themselves occupy — RING + 14 out to the
  // outermost tier. Scattered inside the ring instead, they gate nothing: the sweep
  // then reports zero violations while testing nothing, which it did on the first try.
  const obstacles: BBox[] = [];
  const obstacleCount = 5 + Math.floor(random() * 40);
  for (let i = 0; i < obstacleCount; i += 1) {
    const point = pointOnCircle(CX, CY, RING + 14 + random() * 66, random() * 360);
    const halfW = (10 + random() * 50) / 2;
    const halfH = (10 + random() * 30) / 2;
    obstacles.push({
      minX: point.x - halfW,
      minY: point.y - halfH,
      maxX: point.x + halfW,
      maxY: point.y + halfH,
    });
  }
  return { candidates, obstacles };
}

function opts(obstacles: readonly BBox[]): RadialTierLabelOptions {
  return {
    cx: CX,
    cy: CY,
    baseRadius: RING + 14,
    radiusStep: 22,
    angularThresholdDeg: 6,
    maxTier: 3,
    maxPushes: 3,
    allowGrouping: false,
    maxAngleShiftDeg: 8,
    obstacles,
    leaderObstacles: [],
    minClearanceRadius: RING + 2,
    defaultLabelHeight: 16,
  };
}

describe('radial packer monotonicity under shrinking obstacles', () => {
  it('loses at most one label in at most one of 160 shrink comparisons', () => {
    const random = makeRandom(20260901);
    let comparisons = 0;
    let losses = 0;
    let gains = 0;
    let crowded = 0;

    for (let trial = 0; trial < TRIALS; trial += 1) {
      const { candidates, obstacles } = crowdedCase(random);
      const placed = layoutRadialTierLabels(candidates, opts(obstacles)).length;
      if (placed < candidates.length) crowded += 1;

      for (const factor of FACTORS) {
        const shrunk = layoutRadialTierLabels(
          candidates,
          opts(obstacles.map((box) => scaleAboutCenter(box, factor))),
        ).length;
        comparisons += 1;
        if (shrunk > placed) gains += 1;
        if (shrunk < placed) losses += 1;
        expect(
          shrunk,
          `trial ${trial}, obstacles x${factor}: placed ${shrunk} of ${candidates.length}, full-size obstacles placed ${placed}`,
        ).toBeGreaterThanOrEqual(placed - 1);
      }
    }

    expect(comparisons).toBe(TRIALS * FACTORS.length);
    expect(losses).toBeLessThanOrEqual(1);
    // Both sentinels guard the instrument, not the packer. Without them a family
    // where the obstacles gate nothing reports a clean sweep and proves nothing.
    expect(crowded).toBeGreaterThan(10);
    expect(gains).toBeGreaterThan(20);
  });

  it('places more labels once the obstacles shrink to nothing', () => {
    const random = makeRandom(20260901);
    let blocked = 0;
    let clear = 0;
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const { candidates, obstacles } = crowdedCase(random);
      blocked += layoutRadialTierLabels(candidates, opts(obstacles)).length;
      clear += layoutRadialTierLabels(
        candidates,
        opts(obstacles.map((box) => scaleAboutCenter(box, 0.01))),
      ).length;
    }
    expect(clear).toBeGreaterThan(blocked);
  });
});
