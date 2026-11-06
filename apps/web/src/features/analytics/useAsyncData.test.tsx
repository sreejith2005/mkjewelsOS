// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useAsyncData } from "./useAsyncData";

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it("keeps the current screen available while refreshing", async () => {
  const next = deferred<string>();
  let count = 0;
  const { result } = renderHook(() => useAsyncData(() => ++count === 1 ? Promise.resolve("current") : next.promise));
  await waitFor(() => expect(result.current.data).toBe("current"));
  let refresh!: Promise<void>;
  act(() => { refresh = result.current.retry(); });
  expect(result.current.loading).toBe(false);
  expect(result.current.refreshing).toBe(true);
  expect(result.current.data).toBe("current");
  await act(async () => { next.resolve("updated"); await refresh; });
  expect(result.current.data).toBe("updated");
  expect(result.current.refreshing).toBe(false);
});

it("never replaces newer data with an older response", async () => {
  const old = deferred<string>();
  const latest = deferred<string>();
  let count = 0;
  const { result } = renderHook(() => useAsyncData(() => ++count === 1 ? old.promise : latest.promise));
  let refresh!: Promise<void>;
  act(() => { refresh = result.current.retry(); });
  await act(async () => { latest.resolve("latest"); await refresh; });
  await act(async () => { old.resolve("obsolete"); });
  expect(result.current.data).toBe("latest");
});

it("clears the old scope immediately when dependencies change", async () => {
  const next = deferred<string>();
  const { result, rerender } = renderHook(({ scope }) => useAsyncData(() => scope === "a" ? Promise.resolve("scope a") : next.promise, [scope]), { initialProps: { scope: "a" } });
  await waitFor(() => expect(result.current.data).toBe("scope a"));
  rerender({ scope: "b" });
  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(true);
  await act(async () => { next.resolve("scope b"); });
  expect(result.current.data).toBe("scope b");
});
