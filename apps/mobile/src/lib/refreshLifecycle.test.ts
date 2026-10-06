import { afterEach, describe, expect, it, vi } from "vitest";
import { createRefreshLifecycle } from "./refreshLifecycle";

afterEach(() => vi.useRealTimers());
describe("native refresh lifecycle", () => {
  it("defers remote signals while inactive and catches up once on return", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const lifecycle = createRefreshLifecycle(refresh, false, 5);
    lifecycle.request(); lifecycle.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(refresh).not.toHaveBeenCalled();
    lifecycle.setActive(true);
    await vi.advanceTimersByTimeAsync(5);
    expect(refresh).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });
  it("catches up after foreground return even without a delivered event", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const lifecycle = createRefreshLifecycle(refresh, true, 5);
    lifecycle.setActive(false); lifecycle.setActive(true); lifecycle.setActive(true);
    await vi.advanceTimersByTimeAsync(5);
    expect(refresh).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });
  it("does not load after losing focus with a pending timer", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const lifecycle = createRefreshLifecycle(refresh, true, 5);
    lifecycle.request(); lifecycle.setActive(false);
    await vi.advanceTimersByTimeAsync(5);
    expect(refresh).not.toHaveBeenCalled();
    lifecycle.setActive(true);
    await vi.advanceTimersByTimeAsync(5);
    expect(refresh).toHaveBeenCalledTimes(1);
    lifecycle.dispose(); lifecycle.request(); lifecycle.setActive(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
