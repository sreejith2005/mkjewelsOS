import { fontSize, radius, space, themes, touchTarget, type ThemeName, type ThemePalette } from "@jewelos/ui-tokens";

export type { ThemeName, ThemePalette };

/** Matches the web app, where light is the default and dark is opt-in. */
export const DEFAULT_THEME: ThemeName = "light";

/** `#RRGGBB` plus an alpha as `rgba()`; React Native has no colour-mix function. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A resolved theme, built from the palette the web app actually uses.
 *
 * Two groups of names are exposed deliberately:
 *
 *  - the **palette** names (`taskBg`, `taskAccent`, `champagne`, …) are the web
 *    app's own, so a colour can be matched to its stylesheet by searching for
 *    the same word. They denote roles, not fixed colours: in light mode
 *    `obsidian` is near-white and `white` is dark slate.
 *  - the **semantic** names (`background`, `surface`, `text`, …) map those roles
 *    onto what a screen is actually drawing, and are what most components use.
 *
 * Values the web expresses as Tailwind opacity utilities (`bg-gold/10`,
 * `border-task-border`) are derived here, since a StyleSheet has no equivalent.
 */
function build(name: ThemeName) {
  const p: ThemePalette = themes[name];
  const dark = name === "dark";
  return {
    name,
    colors: {
      ...p,

      /** The page behind everything — the web's `bg-task-muted` content ground. */
      background: p.taskMuted,
      /** A card or list row sitting on the page. */
      surface: p.taskBg,
      /** The app shell: header and bottom navigation. */
      shell: p.charcoal,
      /** Body text, and the muted variant beside it. */
      text: p.taskText,
      textMuted: p.taskTextMuted,
      /** Warm emphasis, used for section titles in the web shell. */
      textWarm: p.champagne,
      /** The primary action colour in task surfaces. */
      primary: p.taskAccent,
      primarySoft: p.taskAccentSoft,
      /** The brand gold, for shell chrome rather than task actions. */
      brand: p.gold,
      brandSoft: withAlpha(p.gold, dark ? 0.14 : 0.12),
      /** Deadline and failure states. */
      overdue: p.taskOverdue,
      dangerSoft: withAlpha(p.danger, dark ? 0.16 : 0.1),
      successSoft: withAlpha(p.success, dark ? 0.16 : 0.1),
      warningSoft: withAlpha(p.warning, dark ? 0.16 : 0.1),
      /** Hairlines and card outlines. */
      border: p.taskBorder,
      borderStrong: withAlpha(p.gold, dark ? 0.5 : 0.45),
      /** Laid over the screen behind a sheet or dialog. */
      scrim: dark ? "rgba(0, 0, 0, 0.6)" : "rgba(15, 23, 42, 0.45)",
      /** A control the viewer may see but not operate. */
      disabled: p.taskTextMuted,
      /** Text drawn on top of `primary`. */
      onPrimary: dark ? p.obsidian : p.taskText,
    },
    space,
    radius,
    fontSize,
    touchTarget,
  } as const;
}

export type Theme = ReturnType<typeof build>;
export type ThemeColor = keyof Theme["colors"];

export const lightTheme = build("light");
export const darkTheme = build("dark");

export const themeFor = (name: ThemeName): Theme => (name === "dark" ? darkTheme : lightTheme);

/**
 * The light theme as a plain value.
 *
 * @deprecated Use `useTheme()` so a screen repaints when the viewer switches
 * themes. This export exists so components can be migrated one at a time, and
 * should be gone once they all have been.
 */
export const theme = lightTheme;
