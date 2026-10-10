// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeProvider, useTheme } from "./ThemeContext";

function Control() {
  const { theme, setTheme } = useTheme();
  return <ThemeToggle theme={theme} onChange={setTheme} />;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "dark";
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("theme selection", () => {
  it("defaults to light and removes an obsolete dark class", () => {
    render(<ThemeProvider><Control /></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("only light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeTruthy();
  });

  it("keeps the palette, class, browser chrome and saved choice together on repeated toggles", () => {
    render(<ThemeProvider><Control /></ThemeProvider>);
    for (const theme of ["dark", "light", "dark", "light"]) {
      fireEvent.click(screen.getByRole("button", { name: /Switch to/ }));
      expect(document.documentElement.dataset.theme).toBe(theme);
      expect(document.documentElement.classList.contains("dark")).toBe(theme === "dark");
      expect(document.documentElement.style.colorScheme).toBe(`only ${theme}`);
      expect(localStorage.getItem("jewelos-theme")).toBe(theme);
      expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content"))
        .toBe(theme === "dark" ? "#17130F" : "#F8FAFC");
    }
  });

  it("restores a deliberately saved dark preference and then restores light after changing it", () => {
    localStorage.setItem("jewelos-theme", "dark");
    const first = render(<ThemeProvider><Control /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    first.unmount();
    render(<ThemeProvider><Control /></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("still loads and switches when the device blocks preference storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    render(<ThemeProvider><Control /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
