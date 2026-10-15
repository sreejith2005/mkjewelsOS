/**
 * Every runtime value the app needs, resolved in one place.
 *
 * Expo's Babel transform inlines `process.env.EXPO_PUBLIC_*` at build time, so
 * a release APK carries the values it was built with and never reads a `.env`
 * from the device. Nothing here may be secret.
 *
 * The app talks to no backend itself: the web page it shows does, with its own
 * configuration. So the web origin is the app's only setting.
 */

/**
 * The JewelOS web origin the app shows. Optional so that a build without it still starts; the app
 * then explains that it is not configured. A release build accepts only https; http is for a
 * local debug stack (emulator host or LAN address).
 */
const readWebOrigin = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && !(__DEV__ && url.protocol === "http:")) return null;
    if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
};

export const env = {
  /** Null when EXPO_PUBLIC_JEWELOS_WEB_ORIGIN is missing or invalid. */
  jewelosWebOrigin: readWebOrigin(process.env.EXPO_PUBLIC_JEWELOS_WEB_ORIGIN),
  /** `__DEV__` is a React Native global: true for a debug bundle, false in a release APK. */
  isDevelopment: __DEV__,
} as const;
