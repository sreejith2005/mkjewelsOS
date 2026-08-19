import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@jewelos/core";

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

export const supabase: SupabaseClient<Database> = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
);
