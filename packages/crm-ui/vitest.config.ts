import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirrors sreejith-crm/web-app/vitest.config.ts; "@" is the package source root, which
// holds the same app/, components/ and lib/ folders as the original project root.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
  },
});
