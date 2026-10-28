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

describe("lazyPage preload", () => {
  it("downloads the page once for any number of preloads and retries after a failure", async () => {
    const { lazyPage } = await import("./lazyPage");
    const Page = () => null;
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ default: Page });
    const page = lazyPage("tasks", loader);

    await expect(page.preload()).resolves.toBeUndefined();
    await page.preload();
    await page.preload();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("shouldSkipPrefetch", () => {
  it("skips on data saver and 2G, prefetches otherwise", async () => {
    const { shouldSkipPrefetch } = await import("./lazyPage");
    expect(shouldSkipPrefetch(undefined)).toBe(false);
    expect(shouldSkipPrefetch({ effectiveType: "4g" })).toBe(false);
    expect(shouldSkipPrefetch({ saveData: true, effectiveType: "4g" })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: "2g" })).toBe(true);
  });
});

describe("prefetchPagesWhenIdle", () => {
  it("runs preloads one after another after the start delay, and stops when cancelled", async () => {
    vi.useFakeTimers();
    try {
      const { prefetchPagesWhenIdle } = await import("./lazyPage");
      const first = vi.fn(() => Promise.resolve());
      const second = vi.fn(() => Promise.resolve());
      const cancel = prefetchPagesWhenIdle([first, second], 1000);
      await vi.advanceTimersByTimeAsync(999);
      expect(first).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(first).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(100);
      expect(second).toHaveBeenCalledOnce();

      const third = vi.fn(() => Promise.resolve());
      prefetchPagesWhenIdle([third], 1000)();
      await vi.advanceTimersByTimeAsync(5000);
      expect(third).not.toHaveBeenCalled();
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});
