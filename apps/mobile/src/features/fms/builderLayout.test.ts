import { describe, expect, it } from "vitest";
import { builderCanvasHeight } from "./builderLayout";

describe("builderCanvasHeight", () => {
  it("keeps most of a short phone available for workflow configuration", () => {
    expect(builderCanvasHeight(640, false)).toBe(176);
    expect(builderCanvasHeight(640, true)).toBe(320);
  });

  it("bounds the canvas on a tall phone or tablet", () => {
    expect(builderCanvasHeight(900, false)).toBe(240);
    expect(builderCanvasHeight(1400, false)).toBe(240);
  });
});
