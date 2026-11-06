// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { isTransientFailure, performanceErrorMessage, usePerformanceRequest } from "./usePerformanceRequest";

afterEach(() => vi.useRealTimers());

describe("performance request lifecycle", () => {
  it("retries a transient failure and then shows the data", async () => {
    const load = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => usePerformanceRequest("k", load));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }), { timeout: 3000 });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it("does not retry a permission error", async () => {
    const load = vi.fn().mockRejectedValue({ code: "42501", message: "denied" });
    const { result } = renderHook(() => usePerformanceRequest("k", load));
    await waitFor(() => expect(result.current.error).toBe("Your access does not include this view."));
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBeNull();
  });

  it("keeps the last good data, marked stale, when a refresh fails", async () => {
    const load = vi.fn().mockResolvedValueOnce({ n: 1 }).mockRejectedValue({ code: "42501", message: "denied" });
    const { result } = renderHook(() => usePerformanceRequest("k", load));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    await act(() => result.current.refresh());
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.stale).toBe(true);
    expect(result.current.updatedAt).not.toBeNull();
  });

  it("aborts the old request when the filter changes and never shows its answer", async () => {
    const signals: AbortSignal[] = [];
    let resolveOld: (v: unknown) => void = () => {};
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve("new");
    });
    const { result, rerender } = renderHook(({ k }) => usePerformanceRequest(k, load), { initialProps: { k: "old" } });
    rerender({ k: "new" });
    await waitFor(() => expect(result.current.data).toBe("new"));
    expect(signals[0]?.aborted).toBe(true);
    resolveOld("old");
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.data).toBe("new");
  });

  it("classifies failures", () => {
    expect(isTransientFailure({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(true);
    expect(isTransientFailure({ code: "22023", message: "Choose 1 to 366 days" })).toBe(false);
    expect(performanceErrorMessage({ code: "57014", message: "statement timeout" })).toMatch(/took too long/);
  });
});
