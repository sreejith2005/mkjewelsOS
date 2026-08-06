import tokenData from "./tokens.json";

export const colors = tokenData.colors;
export const spacing = tokenData.spacing;
export const fonts = tokenData.fonts;

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
  fonts,
} as const;
