/**
 * The plasmid map draws its geometry inside a pan/zoom group:
 *
 *   <svg class="motif-plasmid-map" viewBox="...">        <- ROOT space
 *     <rect class="motif-pm-bg" />                       <- the click surface, ROOT space
 *     <g class="motif-pm-viewport" transform="translate(tx ty) scale(k)">
 *       ...backbone, features, restriction ticks...      <- CONTENT space
 *     </g>
 *   </svg>
 *
 * The transparent surface the user actually clicks is rendered OUTSIDE the group
 * on purpose, so it always covers the whole view. That puts the pointer position
 * in root space while every value a map layout emits — `center`, `radius`,
 * `linearAxis`, and all the drawn paths — is in content space.
 *
 * The two are related by the group transform, and are equal ONLY at a pristine
 * fit (k === 1, tx === 0, ty === 0):
 *
 *   root = k * content + t          content = (root - t) / k
 *
 * That "only at fit" is what makes confusing them so easy to ship: the default
 * state is the identity, so an unconverted point is exactly right until the user
 * touches the map, and then it is quietly wrong by a growing amount. A pan alone
 * is enough — the zoom badge can still read 100%.
 *
 * Which space a value is in is therefore part of its type, not a comment.
 */

/** The SVG pan/zoom transform applied to `<g class="motif-pm-viewport">`. */
export interface MapPointTransform {
  k: number;
  tx: number;
  ty: number;
}

/**
 * A point in the map's SVG ROOT space, i.e. before the viewport group's
 * translate/scale. This is the space `{k, tx, ty}` itself is expressed in, so it
 * is the space zoom anchoring must work in.
 */
export type MapRootPoint = { x: number; y: number; readonly space?: 'root' };

/**
 * A point in the map's CONTENT space — inside the viewport group, where the
 * layout's geometry lives. This is the space that converts to an angle or a base.
 */
export type MapContentPoint = { x: number; y: number; readonly space?: 'content' };

export const mapRootPoint = (x: number, y: number): MapRootPoint => ({ x, y, space: 'root' });
export const mapContentPoint = (x: number, y: number): MapContentPoint => ({ x, y, space: 'content' });

/**
 * A transform is only usable if it can be inverted. A zero, negative or
 * non-finite scale would divide a coordinate to Infinity or NaN and place a
 * selection at a nonsense base, so fall back to the identity: the point passes
 * through unchanged, which is the pristine-fit behaviour and visibly harmless.
 */
function usableTransform(transform: MapPointTransform): MapPointTransform {
  if (!Number.isFinite(transform.k) || transform.k <= 0) return { k: 1, tx: 0, ty: 0 };
  const k = transform.k;
  const tx = Number.isFinite(transform.tx) ? transform.tx : 0;
  const ty = Number.isFinite(transform.ty) ? transform.ty : 0;
  return { k, tx, ty };
}

/** Undo the viewport transform. Required before deriving any angle or base. */
export function contentPointFromRoot(point: MapRootPoint, transform: MapPointTransform): MapContentPoint {
  const { k, tx, ty } = usableTransform(transform);
  return mapContentPoint((point.x - tx) / k, (point.y - ty) / k);
}

/** Apply the viewport transform. Required before anchoring a zoom on layout geometry. */
export function rootPointFromContent(point: MapContentPoint, transform: MapPointTransform): MapRootPoint {
  const { k, tx, ty } = usableTransform(transform);
  return mapRootPoint((point.x * k) + tx, (point.y * k) + ty);
}
