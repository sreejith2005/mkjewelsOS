import { describe, expect, it } from "vitest";
import { incomingNativePath } from "./incomingPath";

describe("incoming native app URLs", () => {
  it("retains exact work identifiers in JewelOS scheme and trusted web links", () => {
    const path = "/tasks/fms?starter=assignment-1&form=form-1";
    expect(incomingNativePath(`jewelos://${path}`, "https://app.example")).toBe(path);
    expect(incomingNativePath(`jewelos://${path.slice(1)}`, "https://app.example")).toBe(path);
    expect(incomingNativePath(`https://app.example${path}`, "https://app.example")).toBe(path);
  });
  it("rejects foreign origins, credentials, unknown routes and incomplete work", () => {
    expect(incomingNativePath("https://foreign.example/tasks", "https://app.example")).toBeNull();
    expect(incomingNativePath("https://name@app.example/tasks", "https://app.example")).toBeNull();
    expect(incomingNativePath("jewelos://unknown", null)).toBeNull();
    expect(incomingNativePath("jewelos://tasks/fms?form=f", null)).toBeNull();
    expect(incomingNativePath("javascript:alert(1)", null)).toBeNull();
  });
});
