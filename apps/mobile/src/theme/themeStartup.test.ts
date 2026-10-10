import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themes } from "@jewelos/ui-tokens";
import { DEFAULT_THEME, themeFor } from "./theme";

describe("native theme startup", () => {
  it("starts light with matching native window and splash backgrounds", () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/app.json`, "utf8")) as {
      expo: { userInterfaceStyle: string; backgroundColor: string; splash: { backgroundColor: string }; plugins: unknown[] };
    };
    expect(DEFAULT_THEME).toBe("light");
    expect(themeFor(DEFAULT_THEME).colors.background).toBe(themes.light.taskMuted);
    expect(config.expo.userInterfaceStyle).toBe("automatic");
    expect(config.expo.backgroundColor).toBe(themes.light.obsidian);
    expect(config.expo.splash.backgroundColor).toBe(themes.light.obsidian);
    expect(config.expo.plugins).toContainEqual([
      "expo-splash-screen",
      expect.objectContaining({ backgroundColor: themes.light.obsidian }),
    ]);
  });
});
