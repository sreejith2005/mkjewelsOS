// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverFromStaleLazyPageChunk } from "./lazyPage";

afterEach(() => window.sessionStorage.clear());

describe("recoverFromStaleLazyPageChunk", () => {
  it("reloads exactly once when a deployment has replaced a lazy page chunk", () => {
    const reload = vi.fn();
    const error = new TypeError("Failed to fetch dynamically imported module: https://app.example/assets/CRMPage-old.js");

    expect(recoverFromStaleLazyPageChunk("crm", error, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(recoverFromStaleLazyPageChunk("crm", error, reload)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload for a real page render failure", () => {
    const reload = vi.fn();

    expect(recoverFromStaleLazyPageChunk("forms", new Error("Cannot read properties of undefined"), reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("recovers Firefox's stale dynamic-module error", () => {
    const reload = vi.fn();

    expect(recoverFromStaleLazyPageChunk("forms", new TypeError("error loading dynamically imported module"), reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
