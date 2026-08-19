/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      keyframes: {
        josUp: { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "none" } },
        josSheet: { from: { transform: "translateY(100%)" }, to: { transform: "none" } },
        josDrawer: { from: { transform: "translateX(-100%)" }, to: { transform: "none" } },
      },
      animation: {
        "jos-up": "josUp 380ms cubic-bezier(.16,1,.3,1) both",
        "jos-sheet": "josSheet 260ms cubic-bezier(.16,1,.3,1) both",
        "jos-drawer": "josDrawer 240ms cubic-bezier(.16,1,.3,1) both",
      },
    },
  },
  plugins: [],
};
