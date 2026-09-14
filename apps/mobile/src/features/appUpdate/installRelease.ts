// The legacy entry point is the one that reports download progress; its
// methods throw when imported from the package root (MOBILE_PARITY_PLAYBOOK §6).
import * as LegacyFileSystem from "expo-file-system/legacy";
import { startActivityAsync } from "expo-intent-launcher";
import type { ReleaseManifest } from "./releaseManifest";

/** `Intent.FLAG_GRANT_READ_URI_PERMISSION`: lets the system installer read our cached file. */
const GRANT_READ_URI_PERMISSION = 0x00000001;
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const DOWNLOAD_PREFIX = "JewelOS-";

/**
 * Downloads the release APK into the app cache and hands it to Android's
 * package installer.
 *
 * Android itself shows the Install confirmation, and the first time it asks
 * the person to allow JewelOS to install apps, so nothing is installed without
 * them agreeing. The new APK must be signed with the same upload key as the
 * installed one, or Android refuses to replace it.
 */
export async function downloadAndInstallRelease(
  manifest: ReleaseManifest,
  onProgress: (fraction: number | null) => void,
): Promise<void> {
  const cache = LegacyFileSystem.cacheDirectory;
  if (!cache) throw new Error("This phone has no cache folder to download the update into.");

  await removeEarlierDownloads(cache);
  const target = `${cache}${DOWNLOAD_PREFIX}${manifest.versionCode}.apk`;
  const download = LegacyFileSystem.createDownloadResumable(
    manifest.apkUrl,
    target,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      onProgress(totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : null);
    },
  );
  const result = await download.downloadAsync();
  if (!result || result.status !== 200) {
    throw new Error(`The update could not be downloaded${result ? ` (HTTP ${result.status})` : ""}.`);
  }

  if (manifest.sizeBytes !== null) {
    const info = await LegacyFileSystem.getInfoAsync(result.uri);
    if (!info.exists || info.size !== manifest.sizeBytes) {
      await LegacyFileSystem.deleteAsync(result.uri, { idempotent: true });
      throw new Error("The download was incomplete. Check the connection and try again.");
    }
  }

  const contentUri = await LegacyFileSystem.getContentUriAsync(result.uri);
  await startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: GRANT_READ_URI_PERMISSION,
    type: APK_MIME_TYPE,
  });
}

/** Each APK is ~40 MB; keep only the one being installed. */
async function removeEarlierDownloads(cache: string): Promise<void> {
  const names = await LegacyFileSystem.readDirectoryAsync(cache).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.startsWith(DOWNLOAD_PREFIX) && name.endsWith(".apk"))
      .map((name) => LegacyFileSystem.deleteAsync(`${cache}${name}`, { idempotent: true })),
  );
}
