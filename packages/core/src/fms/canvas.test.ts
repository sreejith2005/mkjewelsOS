import { describe, expect, it } from "vitest";
import {
  clampFmsZoom,
  fitFmsViewport,
  fmsNodeBounds,
  moveFmsNode,
  zoomFmsViewport,
  FMS_MAX_ZOOM,
  FMS_MIN_ZOOM,
} from "./canvas";

describe("clampFmsZoom", () => {
  it("holds zoom inside the usable range", () => {
    expect(clampFmsZoom(0.2)).toBe(0.5);
    expect(clampFmsZoom(2.8)).toBe(2);
    expect(clampFmsZoom(1.25)).toBe(1.25);
    expect(clampFmsZoom(FMS_MIN_ZOOM)).toBe(FMS_MIN_ZOOM);
    expect(clampFmsZoom(FMS_MAX_ZOOM)).toBe(FMS_MAX_ZOOM);
  });

  it("falls back to a usable zoom for non-finite input", () => {
    expect(clampFmsZoom(Number.NaN)).toBe(1);
    expect(clampFmsZoom(Number.POSITIVE_INFINITY)).toBe(FMS_MAX_ZOOM);
    expect(clampFmsZoom(Number.NEGATIVE_INFINITY)).toBe(FMS_MIN_ZOOM);
  });
});

describe("zoomFmsViewport", () => {
  it("keeps the focal point anchored while scaling", () => {
    expect(zoomFmsViewport({ x: 40, y: 60, zoom: 1 }, { x: 100, y: 120 }, 1.5))
      .toEqual({ x: 10, y: 30, zoom: 1.5 });
  });

  it("leaves the focal point exactly where it was", () => {
    const start = { x: -120, y: 35, zoom: 0.8 };
    const focal = { x: 210, y: 190 };
    const next = zoomFmsViewport(start, focal, 1.9);
    const worldBefore = { x: (focal.x - start.x) / start.zoom, y: (focal.y - start.y) / start.zoom };
    const worldAfter = { x: (focal.x - next.x) / next.zoom, y: (focal.y - next.y) / next.zoom };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 10);
  });

  it("clamps the requested zoom rather than escaping the range", () => {
    expect(zoomFmsViewport({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 12).zoom).toBe(FMS_MAX_ZOOM);
    expect(zoomFmsViewport({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 0.01).zoom).toBe(FMS_MIN_ZOOM);
  });

  it("returns the original viewport for non-finite input", () => {
    const viewport = { x: 12, y: 34, zoom: 1.2 };
    expect(zoomFmsViewport(viewport, { x: Number.NaN, y: 0 }, 1.5)).toEqual(viewport);
    expect(zoomFmsViewport(viewport, { x: 0, y: Number.POSITIVE_INFINITY }, 1.5)).toEqual(viewport);
  });

  it("does not mutate the viewport it was given", () => {
    const viewport = { x: 40, y: 60, zoom: 1 };
    zoomFmsViewport(viewport, { x: 100, y: 120 }, 1.5);
    expect(viewport).toEqual({ x: 40, y: 60, zoom: 1 });
  });
});

describe("moveFmsNode", () => {
  it("translates a screen gesture into world movement at the current zoom", () => {
    expect(moveFmsNode({ x: 80, y: 120 }, { x: 32, y: -16 }, 1.6)).toEqual({ x: 100, y: 110 });
  });

  it("moves a node further in world space when zoomed out", () => {
    expect(moveFmsNode({ x: 0, y: 0 }, { x: 25, y: 50 }, 0.5)).toEqual({ x: 50, y: 100 });
  });

  it("never returns a negative coordinate", () => {
    expect(moveFmsNode({ x: 10, y: 10 }, { x: -400, y: -400 }, 1)).toEqual({ x: 0, y: 0 });
  });

  it("returns the original position for non-finite input", () => {
    expect(moveFmsNode({ x: 5, y: 6 }, { x: Number.NaN, y: 0 }, 1)).toEqual({ x: 5, y: 6 });
    expect(moveFmsNode({ x: 5, y: 6 }, { x: 1, y: 1 }, 0)).toEqual({ x: 5, y: 6 });
  });

  it("does not mutate the position it was given", () => {
    const position = { x: 80, y: 120 };
    moveFmsNode(position, { x: 32, y: -16 }, 1.6);
    expect(position).toEqual({ x: 80, y: 120 });
  });
});

describe("fmsNodeBounds", () => {
  it("covers every node plus its own size", () => {
    expect(fmsNodeBounds([{ x: 10, y: 20 }, { x: 110, y: 220 }], { width: 100, height: 50 }))
      .toEqual({ left: 10, top: 20, right: 210, bottom: 270 });
  });

  it("reports nothing for an empty graph", () => {
    expect(fmsNodeBounds([], { width: 100, height: 50 })).toBeNull();
  });

  it("ignores non-finite positions rather than poisoning the bounds", () => {
    expect(fmsNodeBounds([{ x: 10, y: 20 }, { x: Number.NaN, y: 5 }], { width: 100, height: 50 }))
      .toEqual({ left: 10, top: 20, right: 110, bottom: 70 });
  });
});

describe("fitFmsViewport", () => {
  it("centres the content and scales it to fit inside the padding", () => {
    const viewport = fitFmsViewport(
      { left: 0, top: 0, right: 200, bottom: 100 },
      { width: 440, height: 240 },
      20,
    );
    expect(viewport.zoom).toBe(2);
    expect(viewport.x).toBe(20);
    expect(viewport.y).toBe(20);
  });

  it("shrinks content that is larger than the viewport", () => {
    const viewport = fitFmsViewport(
      { left: 0, top: 0, right: 1000, bottom: 1000 },
      { width: 520, height: 520 },
      10,
    );
    expect(viewport.zoom).toBe(0.5);
  });

  it("never scales beyond the usable zoom range", () => {
    expect(fitFmsViewport({ left: 0, top: 0, right: 10, bottom: 10 }, { width: 4000, height: 4000 }, 0).zoom)
      .toBe(FMS_MAX_ZOOM);
    expect(fitFmsViewport({ left: 0, top: 0, right: 100000, bottom: 100000 }, { width: 100, height: 100 }, 0).zoom)
      .toBe(FMS_MIN_ZOOM);
  });

  it("resets to the origin when there is nothing to fit", () => {
    expect(fitFmsViewport(null, { width: 400, height: 400 }, 20)).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("resets rather than dividing by a zero-sized viewport", () => {
    expect(fitFmsViewport({ left: 0, top: 0, right: 10, bottom: 10 }, { width: 0, height: 0 }, 0))
      .toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
