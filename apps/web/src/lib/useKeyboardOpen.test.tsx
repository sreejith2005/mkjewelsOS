// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { opensKeyboard, useKeyboardOpen } from "./useKeyboardOpen";

function Probe() {
  useKeyboardOpen();
  return <><input aria-label="Name" /><input aria-label="Agree" type="checkbox" /><textarea aria-label="Notes" /></>;
}
const phone = (matches: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener() {}, removeEventListener() {} }));
beforeEach(() => { vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("marks the page while a phone keyboard is open and clears it after", () => {
  phone(true);
  render(<Probe />);
  act(() => screen.getByLabelText("Name").focus());
  expect(document.documentElement.dataset.keyboard).toBe("open");
  act(() => screen.getByLabelText("Agree").focus());
  expect(document.documentElement.dataset.keyboard).toBeUndefined();
  act(() => screen.getByLabelText("Notes").focus());
  expect(document.documentElement.dataset.keyboard).toBe("open");
  act(() => screen.getByLabelText("Notes").blur());
  expect(document.documentElement.dataset.keyboard).toBeUndefined();
});

it("never marks a desktop", () => {
  phone(false);
  render(<Probe />);
  act(() => screen.getByLabelText("Name").focus());
  expect(document.documentElement.dataset.keyboard).toBeUndefined();
});

it("knows which controls open a keyboard", () => {
  const date = document.createElement("input"); date.type = "date";
  const phoneNumber = document.createElement("input"); phoneNumber.type = "tel";
  expect(opensKeyboard(date)).toBe(false);
  expect(opensKeyboard(phoneNumber)).toBe(true);
  expect(opensKeyboard(document.createElement("select"))).toBe(false);
});
