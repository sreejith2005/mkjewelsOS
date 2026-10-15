import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import type { WebShellDownload } from "./webShellBridge";

/**
 * Hands a file the web page built (an export or a template) to Android's share sheet, where the
 * employee saves it to Files or Drive or sends it on. Each download gets its own folder in the
 * app cache so that a name the page chose can never overwrite another file; older folders are
 * removed first, because the share sheet may still be reading the newest one.
 */
export async function saveWebDownload(download: WebShellDownload): Promise<void> {
  const root = new Directory(Paths.cache, "web-downloads");
  try { if (root.exists) root.delete(); } catch { /* cache cleanup is best effort */ }
  const folder = new Directory(root, String(Date.now()));
  folder.create({ intermediates: true });
  const file = new File(folder, download.fileName);
  file.write(download.base64, { encoding: "base64" });
  if (!(await Sharing.isAvailableAsync())) throw new Error("This phone cannot save or share files from JewelOS.");
  await Sharing.shareAsync(file.uri, { mimeType: download.mimeType, dialogTitle: `Save ${download.fileName}` });
}
