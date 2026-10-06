// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useSyncedDraft } from "./useSyncedDraft";

it("resets the draft when its record identity changes", () => {
  const view = renderHook(({ incoming, identity }) => useSyncedDraft(incoming, identity), { initialProps: { incoming: { name: "Branch A", version: 1 }, identity: "a" } });
  act(() => view.result.current.setValue({ name: "Dirty A", version: 1 }));
  view.rerender({ incoming: { name: "Branch B", version: 3 }, identity: "b" });
  expect(view.result.current.value).toEqual({ name: "Branch B", version: 3 });
  expect(view.result.current.changedRemotely).toBe(false);
  view.unmount();
});

it("ignores a completed save for a previous record", () => {
  const view = renderHook(({ incoming, identity }) => useSyncedDraft(incoming, identity), { initialProps: { incoming: { name: "A", version: 1 }, identity: "a" } });
  const acknowledgeA = view.result.current.saved;
  view.rerender({ incoming: { name: "B", version: 3 }, identity: "b" });
  act(() => acknowledgeA({ name: "A", version: 1 }, { name: "A", version: 2 }));
  expect(view.result.current.value).toEqual({ name: "B", version: 3 });
  expect(view.result.current.changedRemotely).toBe(false);
  view.unmount();
});

it("preserves an edit and its expected version until the user discards it", () => {
  const initial = { name: "First", version: 1 };
  const view = renderHook(({ incoming }) => useSyncedDraft(incoming), { initialProps: { incoming: initial } });
  act(() => view.result.current.setValue({ name: "My edit", version: 1 }));
  view.rerender({ incoming: { name: "Remote", version: 2 } });
  expect(view.result.current.value).toEqual({ name: "My edit", version: 1 });
  expect(view.result.current.changedRemotely).toBe(true);
  act(() => view.result.current.discard());
  expect(view.result.current.value).toEqual({ name: "Remote", version: 2 });
  view.unmount();
});

it("adopts a saved snapshot without discarding a later edit", () => {
  const initial = { name: "First", version: 1 };
  const view = renderHook(({ incoming }) => useSyncedDraft(incoming), { initialProps: { incoming: initial } });
  const submitted = { name: "Submitted", version: 1 };
  act(() => view.result.current.setValue(submitted));
  act(() => view.result.current.saved(submitted));
  view.rerender({ incoming: { name: "Submitted", version: 2 } });
  expect(view.result.current.value.version).toBe(2);
  act(() => view.result.current.setValue({ name: "Later edit", version: 2 }));
  act(() => view.result.current.saved({ name: "Submitted", version: 2 }));
  view.rerender({ incoming: { name: "Remote", version: 3 } });
  expect(view.result.current.value).toEqual({ name: "Later edit", version: 2 });
  view.unmount();
});
