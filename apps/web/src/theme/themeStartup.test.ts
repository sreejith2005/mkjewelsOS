// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(`${process.cwd()}/index.html`, "utf8");

function boot() {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.head.innerHTML = parsed.head.innerHTML;
  document.documentElement.className = parsed.documentElement.className;
  document.documentElement.dataset.theme = parsed.documentElement.dataset.theme;
  const script = parsed.querySelector("script[data-theme-bootstrap]");
  expect(script, "Theme must be selected before the application loads").not.toBeNull();
  // Run the actual document bootstrap, before rendering React.
  new Function(script?.textContent ?? "")();
}

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("theme before first paint", () => {
  it.each([null, "invalid", "light", "dark"])("boots from saved preference %s", (saved) => {
    if (saved !== null) localStorage.setItem("jewelos-theme", saved);
    boot();
    const expected = saved === "dark" ? "dark" : "light";
    expect(document.documentElement.dataset.theme).toBe(expected);
    expect(document.documentElement.classList.contains("dark")).toBe(expected === "dark");
    expect(document.documentElement.style.colorScheme).toBe(`only ${expected}`);
  });

  it("boots light when storage is inaccessible", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    boot();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    vi.restoreAllMocks();
  });
});
