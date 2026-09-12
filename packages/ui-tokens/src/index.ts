import tokenData from "./tokens.json";

export const colors = tokenData.colors;
export const spacing = tokenData.spacing;
export const fonts = tokenData.fonts;

/**
 * The application's real palette, in both themes.
 *
 * These values are the same ones `apps/web/src/index.css` declares as CSS
 * variables — that stylesheet remains the web app's source, and
 * `apps/web/src/theme/tokens.test.ts` fails if the two ever drift apart. Any
 * client that cannot read CSS variables (React Native) reads them from here, so
 * there is one palette rather than one per platform.
 *
 * Note that **light is the default theme**, and that in light mode several
 * names read counter-intuitively: `obsidian` is near-white and `white` is dark
 * slate, because each name denotes a *role* that inverts between themes rather
 * than a fixed colour.
 */
export const themes = tokenData.themes;

export type ThemeName = keyof typeof themes;
export type ThemePalette = (typeof themes)["light"];

export const palette = (theme: ThemeName): ThemePalette => themes[theme];



/**
 * React Native styles take unitless numbers, while `spacing` carries CSS
 * strings for the web. The numeric scale below is the same ladder, parsed once
 * so a screen never has to strip "px" by hand.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/** Android's minimum comfortable touch target is 48dp; nothing tappable goes below it. */
export const touchTarget = 48;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const fontSize = {
  caption: 12,
  small: 13,
  body: 15,
  subtitle: 17,
  title: 20,
  heading: 24,
  display: 30,
} as const;

export const mobileTheme = {
  colors: {
    background: colors.obsidian,
    primary: colors.gold,
    secondary: colors.goldSecondary,
    surface: colors.charcoal,
    surfaceGlass: colors.charcoalGlass,
    text: colors.white,
    textWarm: colors.champagne,
    textMuted: colors.softGrey,
    danger: colors.danger,
    success: colors.success,
    warning: colors.warning,
  },
  spacing,
  space,
  radius,
  fontSize,
  touchTarget,
  fonts,
} as const;
