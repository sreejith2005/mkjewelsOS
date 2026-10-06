import { afterEach, describe, expect, it, vi } from "vitest";
import { createRefreshCoordinator } from "./refreshCoordinator";

afterEach(() => vi.useRealTimers());

describe("refresh coordination", () => {
  it("refreshes within the debounce window even when signals keep arriving", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const coordinator = createRefreshCoordinator(refresh, 10);
    coordinator.request();
    for (let index = 0; index < 5; index += 1) {
      await vi.advanceTimersByTimeAsync(2);
      coordinator.request();
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });
  it("coalesces a burst without overlapping a slow request", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const coordinator = createRefreshCoordinator(refresh, 5);
    coordinator.request(); coordinator.request();
    await vi.advanceTimersByTimeAsync(5);
    expect(refresh).toHaveBeenCalledTimes(1);
    coordinator.request(); coordinator.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(refresh).toHaveBeenCalledTimes(1);
    finish?.();
    await vi.advanceTimersByTimeAsync(5);
    expect(refresh).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("contains a failure and permits a subsequent refresh", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const coordinator = createRefreshCoordinator(refresh, 5);
    coordinator.request();
    await vi.advanceTimersByTimeAsync(5);
    coordinator.request();
    await vi.advanceTimersByTimeAsync(5);
    expect(refresh).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("cancels a timer and ignores requests after disposal", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const coordinator = createRefreshCoordinator(refresh, 5);
    coordinator.request(); coordinator.dispose(); coordinator.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("drops a queued follow-up when disposed during a request", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const coordinator = createRefreshCoordinator(refresh, 5);
    coordinator.request();
    await vi.advanceTimersByTimeAsync(5);
    coordinator.request(); coordinator.dispose(); finish?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
