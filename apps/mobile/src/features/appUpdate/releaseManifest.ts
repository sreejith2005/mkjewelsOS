/**
 * The published description of the newest Android release, and the decision
 * of whether this install should move to it.
 *
 * `scripts/release-mobile.ps1` uploads `latest.json` beside the APK on every
 * GitHub release, and GitHub serves the newest release's copy at a permanent
 * URL. An installed app can therefore always find the current build without a
 * server of our own. See `docs/MOBILE_RELEASE_GUIDE.md`.
 *
 * Pure: no native module, so it is tested under Node.
 */

export const RELEASE_REPOSITORY = "sreejith2005/mkjewelsOS";
export const RELEASE_MANIFEST_URL = `https://github.com/${RELEASE_REPOSITORY}/releases/latest/download/latest.json`;

export type ReleaseManifest = Readonly<{
  versionName: string;
  versionCode: number;
  /** Installs below this versionCode may not postpone the update. 0 = none. */
  requiredVersionCode: number;
  notes: string;
  apkUrl: string;
  sizeBytes: number | null;
  publishedAt: string | null;
}>;

export type UpdateDecision =
  | Readonly<{ kind: "current" }>
  | Readonly<{ kind: "optional" | "required"; manifest: ReleaseManifest }>;

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** Accepts only a well-formed manifest; anything else reads as "no update". */
export function parseReleaseManifest(value: unknown): ReleaseManifest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  // Parsed JSON: every field is type-checked below before it is used.
  const record = value as Record<string, unknown>;
  const versionCode = positiveInteger(record["versionCode"]);
  const versionName = typeof record["versionName"] === "string" ? record["versionName"].trim() : "";
  const apkUrl = typeof record["apkUrl"] === "string" ? record["apkUrl"] : "";
  if (versionCode === null || !versionName || !apkUrl.startsWith("https://")) return null;
  return {
    versionName,
    versionCode,
    requiredVersionCode: positiveInteger(record["requiredVersionCode"]) ?? 0,
    notes: typeof record["notes"] === "string" ? record["notes"].trim() : "",
    apkUrl,
    sizeBytes: positiveInteger(record["sizeBytes"]),
    publishedAt: typeof record["publishedAt"] === "string" ? record["publishedAt"] : null,
  };
}

/** Android's installed `versionCode`, as `expo-application` reports it. */
export function parseVersionCode(value: string | null | undefined): number | null {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? positiveInteger(Number(value)) : null;
}

export function decideUpdate(manifest: ReleaseManifest | null, installedVersionCode: number | null): UpdateDecision {
  if (!manifest || installedVersionCode === null || manifest.versionCode <= installedVersionCode) {
    return { kind: "current" };
  }
  return { kind: installedVersionCode < manifest.requiredVersionCode ? "required" : "optional", manifest };
}
