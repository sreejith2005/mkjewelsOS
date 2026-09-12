const { themes, fonts } = require("@jewelos/ui-tokens");

/**
 * The mobile app's Tailwind config, deliberately mirroring `apps/web/tailwind.config.ts`.
 *
 * The web resolves every colour through a CSS variable
 * (`rgb(var(--color-task-bg) / <alpha-value>)`) so one stylesheet can serve both
 * themes. NativeWind supports the same indirection, so the variables are
 * declared here from `@jewelos/ui-tokens` — the palettes extracted from the
 * web's own `index.css` and guarded by `apps/web/src/theme/tokens.test.ts`.
 *
 * The upshot is that a class string copied from a web component means exactly
 * the same thing here, in both themes, with no second palette to maintain.
 */

/** `#RRGGBB` to the `R G B` triple a CSS variable holds. */
const triple = (hex) => {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16)).join(" ");
};

/** `taskBg` -> `--color-task-bg`, matching the web's variable names. */
const cssVarName = (key) => `--color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const variables = (theme) =>
  Object.fromEntries(Object.entries(themes[theme]).map(([key, hex]) => [cssVarName(key), triple(hex)]));

const themeColor = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

module.exports = {
  content: ["./App.tsx", "./index.js", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  // NativeWind switches on this class, and the ThemeProvider drives it.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        obsidian: themeColor("obsidian"),
        gold: themeColor("gold"),
        "gold-secondary": themeColor("gold-secondary"),
        charcoal: themeColor("charcoal"),
        champagne: themeColor("champagne"),
        "soft-grey": themeColor("soft-grey"),
        danger: themeColor("danger"),
        success: themeColor("success"),
        warning: themeColor("warning"),
        white: themeColor("white"),
        "task-bg": themeColor("task-bg"),
        "task-muted": themeColor("task-muted"),
        "task-border": themeColor("task-border"),
        "task-text": themeColor("task-text"),
        "task-text-muted": themeColor("task-text-muted"),
        "task-accent": themeColor("task-accent"),
        "task-accent-soft": themeColor("task-accent-soft"),
        "task-overdue": themeColor("task-overdue"),
        "task-warning": themeColor("task-warning"),
      },
      fontFamily: {
        sans: [...fonts.sans],
        display: [...fonts.display],
        mono: [...fonts.mono],
      },
      // Same scale as the web config.
      borderRadius: { lg: "0.75rem", md: "0.625rem", sm: "0.5rem" },
    },
  },
  plugins: [
    ({ addBase }) =>
      addBase({
        ":root": variables("light"),
        ".dark:root": variables("dark"),
      }),
  ],
};
