import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { themes } from "@jewelos/ui-tokens";
import type { Theme } from "@/components/ThemeToggle";

const THEME_STORAGE_KEY = "jewelos-theme";
type ThemeContextValue = Readonly<{ theme: Theme; setTheme: (theme: Theme) => void }>;
const ThemeContext = createContext<ThemeContextValue | null>(null);
const storedTheme = (): Theme => {
  try { return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light"; }
  catch { return "light"; }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = `only ${theme}`;
    // Storage restrictions must not interrupt loading or an explicit theme change.
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
    // Keeps the phone browser's own chrome (address bar, status bar) the same
    // colour as the app instead of a mismatched strip above the header.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove();
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = themes[theme].obsidian;
    document.head.append(meta);
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
