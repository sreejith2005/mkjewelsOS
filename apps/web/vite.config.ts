import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const webSource = fileURLToPath(new URL("./src", import.meta.url));

// "@/..." is this app's src alias. (Vite applies resolve.alias before any plugin, so the alias
// itself lives here.)
function sourceRootAlias(): Plugin {
  return {
    name: "jewelos:source-root-alias",
    enforce: "pre",
    resolveId(source, importer, options) {
      if (!source.startsWith("@/")) return null;
      const root = webSource;
      const queryStart = source.indexOf("?");
      const file = queryStart === -1 ? source.slice(2) : source.slice(2, queryStart);
      const query = queryStart === -1 ? "" : source.slice(queryStart);
      return this.resolve(`${path.join(root, file)}${query}`, importer, { ...options, skipSelf: true });
    },
  };
}

export default defineConfig({
  build: { manifest: true },
  plugins: [sourceRootAlias(), react()],
  test: {
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
