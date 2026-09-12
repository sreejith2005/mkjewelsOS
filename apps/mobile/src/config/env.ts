/**
 * Every runtime value the app needs, resolved in one place.
 *
 * Expo's Babel transform inlines `process.env.EXPO_PUBLIC_*` at build time, so
 * a release APK carries the values it was built with and never reads a `.env`
 * from the device. Nothing here may be secret: the anon key is safe to ship
 * only because the database enforces RLS, exactly as on web.
 */

const read = (value: string | undefined, name: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      `${name} is missing. Add it to apps/mobile/.env and rebuild — Expo inlines it at build time, so a Metro reload is not enough.`,
    );
  }
  return trimmed;
};

export const env = {
  supabaseUrl: read(process.env.EXPO_PUBLIC_SUPABASE_URL, "EXPO_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: read(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, "EXPO_PUBLIC_SUPABASE_ANON_KEY"),
  /** `__DEV__` is a React Native global: true for a debug bundle, false in a release APK. */
  isDevelopment: __DEV__,
} as const;
