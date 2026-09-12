import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

/**
 * Only the app's pure modules are tested here — formatting, workflow helpers,
 * and anything else that reaches no native module. Rendering React Native
 * components under Node needs a preset this project does not carry, and the
 * rules worth testing already live in @jewelos/core and @jewelos/data.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
