import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const documentHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("./index.css", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("./components/shell/ApplicationShell.tsx", import.meta.url), "utf8");

describe("mobile document and shell contract", () => {
  it("declares an iPhone-safe UTF-8 viewport", () => {
    expect(documentHtml).toContain('<meta charset="UTF-8" />');
    expect(documentHtml).toContain("viewport-fit=cover");
    expect(documentHtml).toContain("interactive-widget=resizes-content");
  });

  it("preserves literal ampersands and reserves both iPhone safe areas", () => {
    const ampersand = new TextDecoder("utf-8").decode(new TextEncoder().encode("MK & Sons"));

    expect(ampersand).toBe("MK & Sons");
    expect(globalCss).toContain("-webkit-text-size-adjust: 100%");
    expect(shellSource).toContain("env(safe-area-inset-top)");
    expect(globalCss).toContain("env(safe-area-inset-bottom)");
  });
});
