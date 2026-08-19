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
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
