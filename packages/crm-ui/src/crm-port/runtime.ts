// crm-port: JewelOS hosting of the original CRM. Not part of the original source.
//
// The original app ran as its own Next.js deployment with basePath "/crm", its own
// Supabase session and environment. In JewelOS the web app hands the CRM its signed-in
// Supabase client, its navigation and its sign-out; this module holds that host
// configuration for the ported client/server Supabase modules and the Next shims.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JewelosClient } from "@jewelos/api-client";

import type { Database } from "@/lib/supabase/database.types";

/** The original next.config.ts basePath. CRM URLs are unchanged inside JewelOS. */
export const CRM_BASE_PATH = "/crm";

export type CrmSupabaseClient = SupabaseClient<Database>;

export type CrmHost = {
  supabase: JewelosClient;
  /** JewelOS client-side navigation (history push) to an absolute JewelOS path. */
  navigate: (href: string) => void;
  onSignOut: () => Promise<void> | void;
  jewelosHomePath: string;
};

let host: CrmHost | null = null;
let facade: { base: JewelosClient; client: CrmSupabaseClient } | null = null;

export function configureCrmHost(next: CrmHost): void {
  host = next;
}

export function crmHost(): CrmHost {
  if (!host) throw new Error("The CRM is not mounted: CrmApp must provide the JewelOS host first.");
  return host;
}

/** The single client every ported query reads through: the JewelOS session, schema crm. */
export function crmSupabase(): CrmSupabaseClient {
  const { supabase } = crmHost();
  if (!facade || facade.base !== supabase) facade = { base: supabase, client: crmFacade(supabase) };
  return facade.client;
}

function crmFacade(base: JewelosClient): CrmSupabaseClient {
  const crm = base.schema("crm");
  // The original code uses only from(), rpc(), storage and auth on its client. from/rpc
  // go to PostgREST schema crm; storage and auth stay on the JewelOS session. The cast is
  // narrow and safe for that surface: the crm schema types are exactly Database["public"].
  return {
    from: crm.from.bind(crm),
    rpc: crm.rpc.bind(crm),
    schema: base.schema.bind(base),
    storage: base.storage,
    auth: base.auth,
  } as unknown as CrmSupabaseClient;
}

/** Next.js prefixes basePath onto app paths ("/" becomes "/crm"). */
export function withBasePath(href: string): string {
  if (!href.startsWith("/")) return href;
  const url = new URL(href, "http://crm.invalid");
  const path = url.pathname === "/" ? CRM_BASE_PATH : `${CRM_BASE_PATH}${url.pathname}`;
  return `${path}${url.search}${url.hash}`;
}

/** The app path inside the CRM for a JewelOS browser path ("/crm/queue" -> "/queue"). */
export function crmAppPath(browserPath: string): string {
  if (browserPath === CRM_BASE_PATH) return "/";
  return browserPath.startsWith(`${CRM_BASE_PATH}/`) ? browserPath.slice(CRM_BASE_PATH.length) : browserPath;
}

/** Thrown by the shimmed redirect(): the router replaces the URL, like a Next redirect. */
export class CrmRedirect extends Error {
  constructor(readonly path: string) {
    super(`CRM redirect to ${path}`);
  }
}

/** Thrown by the shimmed notFound(): the router renders the Next default 404. */
export class CrmNotFound extends Error {
  constructor() {
    super("CRM page not found");
  }
}

/** Leaves the CRM for a JewelOS path (the JewelOS login replaces the original /login). */
export class CrmLeave extends Error {
  constructor(readonly jewelosPath: string) {
    super(`Leave the CRM for ${jewelosPath}`);
  }
}
