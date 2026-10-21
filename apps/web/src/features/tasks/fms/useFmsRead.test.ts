// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useFmsRead } from "./useFmsRead";

afterEach(cleanup);

it("ignores a previous actor or filter response that finishes after the current request", async () => {
  let resolvePrevious!: (value: string) => void;
  const previous = new Promise<string>(resolve => { resolvePrevious = resolve; });
  const { result, rerender } = renderHook(({ identity }) => useFmsRead(true, identity,
    () => identity === "actor-a|old-filter" ? previous : Promise.resolve("current actor work")),
  { initialProps: { identity: "actor-a|old-filter" } });
  rerender({ identity: "actor-b|new-filter" });
  await waitFor(() => expect(result.current.data).toBe("current actor work"));
  await act(async () => { resolvePrevious("previous actor private work"); });
  expect(result.current.data).toBe("current actor work");
});

it("hides previous filter data while a changed filter is pending", async () => {
  const { result, rerender } = renderHook(({ identity }) => useFmsRead(true, identity,
    () => identity === "old" ? Promise.resolve("old results") : new Promise<string>(() => {})),
  { initialProps: { identity: "old" } });
  await waitFor(() => expect(result.current.data).toBe("old results"));
  rerender({ identity: "new" });
  expect(result.current.data).toBeUndefined();
  expect(result.current.loading).toBe(true);
});
