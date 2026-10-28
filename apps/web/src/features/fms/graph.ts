export * from "@jewelos/data/fms/graph";
import type { FmsGraphPosition } from "@jewelos/data/fms/graph";

/**
 * How far a set of canvas cards sits past the left/top edge (0 when it does not).
 * Saved positions cannot be negative, so the canvas shifts the layout by this much.
 */
export function fmsCanvasOvershoot(points: readonly FmsGraphPosition[]): FmsGraphPosition {
  return {
    x: Math.max(0, -Math.min(0, ...points.map((point) => point.x))),
    y: Math.max(0, -Math.min(0, ...points.map((point) => point.y))),
  };
}
