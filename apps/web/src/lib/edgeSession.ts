import { supabase } from "@jewelos/api-client";

/** Ensures sensitive Edge Function requests never reuse an expired access token. */
export async function refreshSessionForSensitiveAction(): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshed.session) {
    throw new Error("Your session has expired. Please sign in again.");
  }
}
