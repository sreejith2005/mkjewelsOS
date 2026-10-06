import { getPageForPath, notificationDestination } from "@jewelos/core";
import { resolveNativeWorkPath } from "./workPath";

/** Accept only the installed app's scheme or its configured web origin. */
export function incomingNativePath(raw: string, webOrigin: string | null): string | null {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    let path: string;
    if (url.protocol === "jewelos:") path = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}${url.search}`;
    else if (webOrigin && url.origin === webOrigin && ["https:", "http:"].includes(url.protocol)) path = `${url.pathname}${url.search}`;
    else return null;
    if (!notificationDestination(path) || !getPageForPath(path.split("?")[0] ?? path)) return null;
    if (path.startsWith("/tasks/fms?") && !resolveNativeWorkPath(path)) return null;
    return path;
  } catch { return null; }
}
