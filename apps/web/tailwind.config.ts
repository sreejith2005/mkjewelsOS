import type { Config } from "tailwindcss";
import { fonts, spacing } from "@jewelos/ui-tokens";

const themeColor = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: themeColor("obsidian"), gold: themeColor("gold"), "gold-secondary": themeColor("gold-secondary"), charcoal: themeColor("charcoal"), champagne: themeColor("champagne"), "soft-grey": themeColor("soft-grey"), danger: themeColor("danger"), success: themeColor("success"), warning: themeColor("warning"), white: themeColor("white"),
        "on-gold": themeColor("on-gold"),
        "task-bg": themeColor("task-bg"), "task-muted": themeColor("task-muted"), "task-border": themeColor("task-border"), "task-text": themeColor("task-text"), "task-text-muted": themeColor("task-text-muted"), "task-accent": themeColor("task-accent"), "task-accent-soft": themeColor("task-accent-soft"), "task-overdue": themeColor("task-overdue"), "task-warning": themeColor("task-warning"),
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
      boxShadow: {
        // Theme-aware elevation: --color-shadow is a cool ink on light surfaces and pure black
        // on the dark theme, so cards separate in both.
        card: "0 1px 2px rgb(var(--color-shadow) / 0.04), 0 4px 16px -6px rgb(var(--color-shadow) / 0.08)",
        lift: "0 2px 4px rgb(var(--color-shadow) / 0.05), 0 14px 32px -12px rgb(var(--color-shadow) / 0.18)",
        gold: "0 1px 2px rgb(var(--color-gold-secondary) / 0.22), 0 6px 14px -8px rgb(var(--color-gold) / 0.5)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
