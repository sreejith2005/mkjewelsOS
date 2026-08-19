import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Theme } from "@/components/ThemeToggle";

const THEME_STORAGE_KEY = "jewelos-theme";
type ThemeContextValue = Readonly<{ theme: Theme; setTheme: (theme: Theme) => void }>;
const ThemeContext = createContext<ThemeContextValue | null>(null);
const storedTheme = (): Theme => window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem(THEME_STORAGE_KEY, theme); }, [theme]);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
