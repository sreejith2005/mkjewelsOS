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
  it("opens Ask Kiara links (also from a cold start) with their conversation or question", () => {
    expect(incomingNativePath("jewelos://ask-kiara", null)).toBe("/ask-kiara");
    expect(incomingNativePath("jewelos://ask-kiara?conversation=c1", null)).toBe("/ask-kiara?conversation=c1");
    expect(incomingNativePath("https://app.example/ask-kiara?tab=questions&escalation=e1", "https://app.example")).toBe("/ask-kiara?tab=questions&escalation=e1");
    expect(incomingNativePath("https://foreign.example/ask-kiara?conversation=c1", "https://app.example")).toBeNull();
  });
});
