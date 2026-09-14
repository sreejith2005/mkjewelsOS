import { describe, expect, it, vi } from "vitest";
import { createFmsNodeDragSession } from "./fmsCanvasGesture";

describe("FMS canvas node drag session", () => {
  it("previews every update but persists exactly once at gesture end", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    const drag = createFmsNodeDragSession({ key: "review", origin: { x: 80, y: 120 }, zoom: 2, preview, commit });
    drag.update({ x: 10, y: 4 });
    drag.update({ x: 30, y: -20 });
    expect(preview).toHaveBeenLastCalledWith("review", { x: 95, y: 110 });
    expect(commit).not.toHaveBeenCalled();
    drag.end();
    drag.end();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ review: { x: 95, y: 110 } });
  });
});
