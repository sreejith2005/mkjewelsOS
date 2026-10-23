// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Modal } from "./ui";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the mobile form inside the visible viewport as the keyboard resizes and pans it", () => {
  const viewport = Object.assign(new EventTarget(), { height: 780, offsetTop: 0 });
  vi.stubGlobal("visualViewport", viewport);
  render(<Modal mobileFullscreen title="Create task" onClose={() => {}}><input aria-label="Title" /></Modal>);
  const backdrop = screen.getByRole("dialog").parentElement!;
  act(() => { viewport.height = 360; viewport.offsetTop = 42; viewport.dispatchEvent(new Event("resize")); });
  expect(backdrop.style.height).toBe("360px");
  expect(backdrop.style.top).toBe("42px");
  act(() => { viewport.height = 780; viewport.offsetTop = 0; viewport.dispatchEvent(new Event("scroll")); });
  expect(backdrop.style.height).toBe("780px");
  expect(backdrop.style.top).toBe("0px");
});
