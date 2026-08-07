import type { Config } from "tailwindcss";
import { colors, fonts, spacing } from "@jewelos/ui-tokens";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: colors.obsidian,
        gold: colors.gold,
        "gold-secondary": colors.goldSecondary,
        charcoal: colors.charcoal,
        champagne: colors.champagne,
        "soft-grey": colors.softGrey,
        danger: colors.danger,
        success: colors.success,
        warning: colors.warning,
        white: colors.white,
        "task-bg": colors.taskBackground,
        "task-muted": colors.taskSurfaceMuted,
        "task-border": colors.taskBorder,
        "task-text": colors.taskText,
        "task-text-muted": colors.taskTextMuted,
        "task-accent": colors.taskAccent,
        "task-accent-soft": colors.taskAccentSoft,
        "task-overdue": colors.taskOverdue,
        "task-warning": colors.taskWarning,
      },
      fontFamily: {
        sans: [...fonts.sans],
        display: [...fonts.display],
        mono: [...fonts.mono],
      },
      spacing,
      borderRadius: {
        lg: "0.75rem",
        md: "0.625rem",
        sm: "0.5rem",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
