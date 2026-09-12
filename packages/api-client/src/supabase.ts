import { createJewelosClient, setSupabaseClient, type JewelosClient } from "./client";

type RuntimeProcess = {
  env?: Record<string, string | undefined>;
};

declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_ANON_KEY?: string;
    readonly VITE_SUPABASE_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const runtimeProcess = (
  globalThis as typeof globalThis & { process?: RuntimeProcess }
).process;

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? runtimeProcess?.env?.SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  runtimeProcess?.env?.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set for the web app",
  );
}

export const supabase: JewelosClient = createJewelosClient({
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
});

// Shared data modules read through the registered singleton. React Native
// registers its own client from the mobile entry instead of importing this
// browser-specific environment module.
setSupabaseClient(supabase);
