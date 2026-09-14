import { describe, expect, it } from "vitest";
import { decideUpdate, parseReleaseManifest, parseVersionCode } from "./releaseManifest";

const published = {
  schema: 1,
  versionName: "1.0.4",
  versionCode: 5,
  requiredVersionCode: 3,
  notes: "  Faster task list  ",
  apkUrl: "https://github.com/sreejith2005/mkjewelsOS/releases/download/mobile-v1.0.4/JewelOS.apk",
  sizeBytes: 38639512,
  publishedAt: "2026-09-14T10:00:00.0000000Z",
};

describe("parseReleaseManifest", () => {
  it("reads the manifest the release script publishes", () => {
    expect(parseReleaseManifest(published)).toEqual({
      versionName: "1.0.4",
      versionCode: 5,
      requiredVersionCode: 3,
      notes: "Faster task list",
      apkUrl: published.apkUrl,
      sizeBytes: 38639512,
      publishedAt: published.publishedAt,
    });
  });

  it("treats a missing required version as no requirement", () => {
    const { requiredVersionCode: _omitted, ...rest } = published;
    expect(parseReleaseManifest(rest)?.requiredVersionCode).toBe(0);
  });

  it("rejects anything that could send the phone to a bad download", () => {
    expect(parseReleaseManifest(null)).toBeNull();
    expect(parseReleaseManifest([])).toBeNull();
    expect(parseReleaseManifest({ ...published, versionCode: "5" })).toBeNull();
    expect(parseReleaseManifest({ ...published, versionCode: 0 })).toBeNull();
    expect(parseReleaseManifest({ ...published, versionName: " " })).toBeNull();
    expect(parseReleaseManifest({ ...published, apkUrl: "http://example.com/JewelOS.apk" })).toBeNull();
  });
});

describe("parseVersionCode", () => {
  it("reads Android's build number and ignores anything else", () => {
    expect(parseVersionCode("12")).toBe(12);
    expect(parseVersionCode(null)).toBeNull();
    expect(parseVersionCode("")).toBeNull();
    expect(parseVersionCode("1.0")).toBeNull();
  });
});

describe("decideUpdate", () => {
  const manifest = parseReleaseManifest(published);

  it("stays quiet when the phone already runs the newest build", () => {
    expect(decideUpdate(manifest, 5)).toEqual({ kind: "current" });
    expect(decideUpdate(manifest, 6)).toEqual({ kind: "current" });
  });

  it("offers a newer build that the phone may postpone", () => {
    expect(decideUpdate(manifest, 4)).toMatchObject({ kind: "optional" });
    expect(decideUpdate(manifest, 3)).toMatchObject({ kind: "optional" });
  });

  it("insists when the installed build is below the required version", () => {
    expect(decideUpdate(manifest, 2)).toMatchObject({ kind: "required" });
  });

  it("never prompts without a manifest or a known installed version", () => {
    expect(decideUpdate(null, 1)).toEqual({ kind: "current" });
    expect(decideUpdate(manifest, null)).toEqual({ kind: "current" });
  });
});
