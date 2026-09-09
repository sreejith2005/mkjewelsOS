import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_THEME, themeFor, type Theme, type ThemeName } from "@/theme/theme";
import { log } from "@/lib/log";

/**
 * The same key the web app writes to `localStorage`, kept identical so the two
 * clients describe the preference the same way even though the stores differ.
 */
const STORAGE_KEY = "jewelos-theme";

type ThemeContextValue = Readonly<{
  theme: Theme;
  name: ThemeName;
  setTheme: (name: ThemeName) => void;
  toggleTheme: () => void;
  /** False until the stored preference has been read, to avoid a visible flip. */
  ready: boolean;
}>;

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<ThemeName>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  // A phone reads its stored preference asynchronously, unlike a browser. The
  // app starts on the default and swaps once, rather than rendering nothing.
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        if (stored === "dark" || stored === "light") setName(stored);
      })
      .catch((error: unknown) => {
        log.warn("startup", "could not read the saved theme; using the default");
        log.debug("startup", "theme read error", error);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setTheme = useCallback((next: ThemeName) => {
    setName(next);
    // The preference is a convenience, not data — a failed write must never
    // interrupt the person who just tapped the toggle.
    void AsyncStorage.setItem(STORAGE_KEY, next).catch((error: unknown) => {
      log.warn("startup", "could not save the theme preference");
      log.debug("startup", "theme write error", error);
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themeFor(name),
      name,
      setTheme,
      toggleTheme: () => setTheme(name === "dark" ? "light" : "dark"),
      ready,
    }),
    [name, ready, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}

/** The resolved palette on its own, for the common case of styling. */
export function useAppTheme(): Theme {
  return useTheme().theme;
}
