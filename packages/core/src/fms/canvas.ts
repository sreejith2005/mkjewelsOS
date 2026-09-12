/**
 * Pure viewport and node geometry for the FMS graph canvas.
 *
 * Both the web canvas and the native canvas draw the same graph, but they get
 * their input from very different places — pointer events and wheel deltas on
 * one side, Gesture Handler and Reanimated shared values on the other. Keeping
 * the arithmetic here means the two canvases cannot drift apart on what a pinch
 * or a drag actually does, and it lets the maths be tested without rendering
 * anything.
 *
 * Every function is total: non-finite input yields the unchanged input rather
 * than an exception or a `NaN` that would silently corrupt a saved position.
 * Gesture streams produce junk values often enough (a released touch, a
 * zero-size layout pass) that returning a safe value matters more than
 * reporting the bad one.
 */

export const FMS_MIN_ZOOM = 0.5;
export const FMS_MAX_ZOOM = 2;

export type FmsPoint = Readonly<{ x: number; y: number }>;
export type FmsViewport = Readonly<{ x: number; y: number; zoom: number }>;
export type FmsSize = Readonly<{ width: number; height: number }>;
export type FmsBounds = Readonly<{ left: number; top: number; right: number; bottom: number }>;

const isFinitePoint = (point: FmsPoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/** Holds zoom inside the range the canvas can actually render legibly. */
export function clampFmsZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(FMS_MAX_ZOOM, Math.max(FMS_MIN_ZOOM, zoom));
}

/**
 * Scales around a focal point — the midpoint between two pinching fingers, or
 * the cursor — so the content under that point stays under it.
 */
export function zoomFmsViewport(viewport: FmsViewport, focal: FmsPoint, nextZoom: number): FmsViewport {
  if (!isFinitePoint(focal) || Number.isNaN(nextZoom)) return viewport;
  if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) || !viewport.zoom) return viewport;

  const zoom = clampFmsZoom(nextZoom);
  // The world point currently under the focal point must stay under it, so
  // solve `focal = pan + world * zoom` for the new pan.
  const worldX = (focal.x - viewport.x) / viewport.zoom;
  const worldY = (focal.y - viewport.y) / viewport.zoom;
  return { x: focal.x - worldX * zoom, y: focal.y - worldY * zoom, zoom };
}

/**
 * Applies a drag measured in screen pixels to a node stored in world
 * coordinates. Dividing by the zoom is what makes a node track the finger at
 * every scale instead of drifting away from it.
 */
export function moveFmsNode(position: FmsPoint, delta: FmsPoint, zoom: number): FmsPoint {
  if (!isFinitePoint(position) || !isFinitePoint(delta)) return position;
  if (!Number.isFinite(zoom) || zoom === 0) return position;

  return {
    x: Math.max(0, position.x + delta.x / zoom),
    y: Math.max(0, position.y + delta.y / zoom),
  };
}

/** The rectangle covering every node, or `null` when there is nothing to cover. */
export function fmsNodeBounds(positions: readonly FmsPoint[], node: FmsSize): FmsBounds | null {
  const usable = positions.filter(isFinitePoint);
  if (usable.length === 0) return null;

  return usable.reduce<FmsBounds>((bounds, position) => ({
    left: Math.min(bounds.left, position.x),
    top: Math.min(bounds.top, position.y),
    right: Math.max(bounds.right, position.x + node.width),
    bottom: Math.max(bounds.bottom, position.y + node.height),
  }), {
    left: usable[0]!.x,
    top: usable[0]!.y,
    right: usable[0]!.x + node.width,
    bottom: usable[0]!.y + node.height,
  });
}

/** Centres `bounds` inside `viewport`, scaled to fit within `padding` on each edge. */
export function fitFmsViewport(bounds: FmsBounds | null, viewport: FmsSize, padding: number): FmsViewport {
  const origin: FmsViewport = { x: 0, y: 0, zoom: 1 };
  if (!bounds) return origin;
  if (!(viewport.width > 0) || !(viewport.height > 0)) return origin;

  const available = { width: viewport.width - padding * 2, height: viewport.height - padding * 2 };
  if (!(available.width > 0) || !(available.height > 0)) return origin;

  const content = { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
  const zoom = clampFmsZoom(Math.min(
    available.width / Math.max(1, content.width),
    available.height / Math.max(1, content.height),
  ));

  return {
    x: padding + (available.width - content.width * zoom) / 2 - bounds.left * zoom,
    y: padding + (available.height - content.height * zoom) / 2 - bounds.top * zoom,
    zoom,
  };
}
