"use client";

// crm-port: the original created a @supabase/ssr browser client from NEXT_PUBLIC_SUPABASE_*.
// The port reads through the signed-in JewelOS session scoped to schema crm, so every
// original createClient() call site is unchanged. JewelOS login is the only CRM login.
import { crmSupabase } from "@/crm-port/runtime";

export function createClient() {
  return crmSupabase();
}
