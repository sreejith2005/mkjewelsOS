export type { Database, Json } from "@jewelos/core";
export {
  createJewelosClient,
  getSupabase,
  setSupabaseClient,
  type JewelosClient,
  type JewelosClientConfig,
  type JewelosSessionStorage,
} from "./client";
export { supabase } from "./supabase";
