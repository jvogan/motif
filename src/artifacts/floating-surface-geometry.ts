export type FloatingSurfaceRect = Readonly<{
  x: number;
  y: number;
  w: number;
  h: number;
}>;

export type FloatingSurfaceDelta = Readonly<{
  dx: number;
  dy: number;
}>;

export type FloatingSurfaceInsets = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
}>;

export type FloatingSurfaceViewport = Readonly<{
  width: number;
  height: number;
  insets?: Partial<FloatingSurfaceInsets>;
}>;

export type FloatingSurfaceSizeLimits = Readonly<{
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}>;

export const DEFAULT_FLOATING_SURFACE_INSETS: FloatingSurfaceInsets = {
  top: 8,
  right: 8,
  bottom: 8,
  left: 8,
};

export const DEFAULT_FLOATING_SURFACE_SIZE_LIMITS: Required<FloatingSurfaceSizeLimits> = {
  minWidth: 280,
  minHeight: 180,
  maxWidth: Number.POSITIVE_INFINITY,
  maxHeight: Number.POSITIVE_INFINITY,
};

type FloatingSurfaceBounds = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

type ResolvedSizeLimits = Readonly<{
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}>;

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function resolveAxisBounds(
  length: number,
  leadingInset: number | undefined,
  trailingInset: number | undefined,
  defaultLeadingInset: number,
  defaultTrailingInset: number,
): readonly [number, number] {
  const safeLength = Math.max(0, finiteOr(length, 0));
  const leading = clamp(finiteOr(leadingInset, defaultLeadingInset), 0, safeLength);
  const trailing = clamp(finiteOr(trailingInset, defaultTrailingInset), 0, safeLength - leading);
  return [leading, safeLength - trailing];
}

function resolveViewportBounds(viewport: FloatingSurfaceViewport): FloatingSurfaceBounds {
  const [left, right] = resolveAxisBounds(
    viewport.width,
    viewport.insets?.left,
    viewport.insets?.right,
    DEFAULT_FLOATING_SURFACE_INSETS.left,
    DEFAULT_FLOATING_SURFACE_INSETS.right,
  );
  const [top, bottom] = resolveAxisBounds(
    viewport.height,
    viewport.insets?.top,
    viewport.insets?.bottom,
    DEFAULT_FLOATING_SURFACE_INSETS.top,
    DEFAULT_FLOATING_SURFACE_INSETS.bottom,
  );
  return { left, top, right, bottom };
}

function resolveSizeLimits(limits: FloatingSurfaceSizeLimits = {}): ResolvedSizeLimits {
  const minWidth = Math.max(0, finiteOr(limits.minWidth, DEFAULT_FLOATING_SURFACE_SIZE_LIMITS.minWidth));
  const minHeight = Math.max(0, finiteOr(limits.minHeight, DEFAULT_FLOATING_SURFACE_SIZE_LIMITS.minHeight));
  const maxWidth = Math.max(0, finiteOr(limits.maxWidth, DEFAULT_FLOATING_SURFACE_SIZE_LIMITS.maxWidth));
  const maxHeight = Math.max(0, finiteOr(limits.maxHeight, DEFAULT_FLOATING_SURFACE_SIZE_LIMITS.maxHeight));
  return { minWidth, minHeight, maxWidth, maxHeight };
}

function resolveAxisSize(value: number, available: number, minimum: number, maximum: number): number {
  const effectiveMaximum = Math.min(available, maximum);
  const effectiveMinimum = Math.min(minimum, effectiveMaximum);
  return clamp(finiteOr(value, effectiveMinimum), effectiveMinimum, effectiveMaximum);
}

/**
 * Fits a surface into the viewport's safe rectangle without mutating the
 * preferred rectangle. Callers can therefore clamp the same desktop
 * preference for a narrow viewport and recover it when the viewport expands.
 */
export function clampFloatingSurfaceRect(
  preferred: FloatingSurfaceRect,
  viewport: FloatingSurfaceViewport,
  limits: FloatingSurfaceSizeLimits = {},
): FloatingSurfaceRect {
  const bounds = resolveViewportBounds(viewport);
  const sizeLimits = resolveSizeLimits(limits);
  const availableWidth = bounds.right - bounds.left;
  const availableHeight = bounds.bottom - bounds.top;
  const w = resolveAxisSize(preferred.w, availableWidth, sizeLimits.minWidth, sizeLimits.maxWidth);
  const h = resolveAxisSize(preferred.h, availableHeight, sizeLimits.minHeight, sizeLimits.maxHeight);
  const x = clamp(finiteOr(preferred.x, bounds.left), bounds.left, bounds.right - w);
  const y = clamp(finiteOr(preferred.y, bounds.top), bounds.top, bounds.bottom - h);
  return { x, y, w, h };
}

export function moveFloatingSurfaceRect(
  preferred: FloatingSurfaceRect,
  delta: FloatingSurfaceDelta,
  viewport: FloatingSurfaceViewport,
  limits: FloatingSurfaceSizeLimits = {},
): FloatingSurfaceRect {
  const current = clampFloatingSurfaceRect(preferred, viewport, limits);
  return clampFloatingSurfaceRect({
    ...current,
    x: current.x + finiteOr(delta.dx, 0),
    y: current.y + finiteOr(delta.dy, 0),
  }, viewport, limits);
}

export function resizeFloatingSurfaceRectFromBottomRight(
  preferred: FloatingSurfaceRect,
  delta: FloatingSurfaceDelta,
  viewport: FloatingSurfaceViewport,
  limits: FloatingSurfaceSizeLimits = {},
): FloatingSurfaceRect {
  const bounds = resolveViewportBounds(viewport);
  const sizeLimits = resolveSizeLimits(limits);
  const current = clampFloatingSurfaceRect(preferred, viewport, limits);
  const availableWidth = bounds.right - current.x;
  const availableHeight = bounds.bottom - current.y;
  const w = resolveAxisSize(
    current.w + finiteOr(delta.dx, 0),
    availableWidth,
    sizeLimits.minWidth,
    sizeLimits.maxWidth,
  );
  const h = resolveAxisSize(
    current.h + finiteOr(delta.dy, 0),
    availableHeight,
    sizeLimits.minHeight,
    sizeLimits.maxHeight,
  );
  return { x: current.x, y: current.y, w, h };
}

export function resizeFloatingSurfaceRectFromBottomLeft(
  preferred: FloatingSurfaceRect,
  delta: FloatingSurfaceDelta,
  viewport: FloatingSurfaceViewport,
  limits: FloatingSurfaceSizeLimits = {},
): FloatingSurfaceRect {
  const bounds = resolveViewportBounds(viewport);
  const sizeLimits = resolveSizeLimits(limits);
  const current = clampFloatingSurfaceRect(preferred, viewport, limits);
  const anchoredRight = current.x + current.w;
  const availableWidth = anchoredRight - bounds.left;
  const availableHeight = bounds.bottom - current.y;
  const w = resolveAxisSize(
    current.w - finiteOr(delta.dx, 0),
    availableWidth,
    sizeLimits.minWidth,
    sizeLimits.maxWidth,
  );
  const h = resolveAxisSize(
    current.h + finiteOr(delta.dy, 0),
    availableHeight,
    sizeLimits.minHeight,
    sizeLimits.maxHeight,
  );
  return { x: anchoredRight - w, y: current.y, w, h };
}
