/** Reserve most of the builder's phone viewport for the configuration list. */
export function builderCanvasHeight(windowHeight: number, expanded: boolean): number {
  if (expanded) return 320;
  return Math.min(240, Math.max(160, Math.round(windowHeight * 0.275)));
}
