import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The data layer talks to Supabase through a doubled client, so it needs no
    // DOM. Anything that renders belongs in the app that renders it.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
