// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSidebarOpen, rememberSidebarOpen } from "./sidebarState";

afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("sidebar open state", () => {
  it("opens on a first visit and stays closed across a reload once a section was chosen", () => {
    expect(readSidebarOpen()).toBe(true);
    rememberSidebarOpen(false);
    expect(readSidebarOpen()).toBe(false);
    rememberSidebarOpen(true);
    expect(readSidebarOpen()).toBe(true);
  });
  it("falls back to open when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => rememberSidebarOpen(false)).not.toThrow();
    expect(readSidebarOpen()).toBe(true);
  });
});
