// crm-port: JewelOS hosting of the original CRM. Not part of the original source.
//
// The original app ran as its own Next.js deployment with basePath "/crm", its own
// Supabase session and environment. In JewelOS the web app hands the CRM its signed-in
// JewelOS client, the CRM project's address, its navigation and its sign-out. This module
// holds that host configuration for the ported client/server Supabase modules and the Next
// shims.
//
// Two-project design (2026-10-01,
// docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md): CRM data
// lives in the separate CRM Supabase project. The JewelOS session only proves who the user
// is. ./crm-project exchanges it for a short-lived CRM token through the login bridge.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JewelosClient } from "@jewelos/api-client";

import type { Database } from "@/lib/supabase/database.types";

import { createCrmProjectClient, crmTokenSource, type CrmProjectConfig, type CrmTokenSource } from "./crm-project";

/** The original next.config.ts basePath. CRM URLs are unchanged inside JewelOS. */
export const CRM_BASE_PATH = "/crm";

export type CrmSupabaseClient = SupabaseClient<Database>;

/**
 * The part of supabase.auth the original uses: getUser() (layout, followups, referrals,
 * getCrmUser). The JewelOS Android app's WebView (embedded mode) has no Supabase auth client
 * of its own (the native app is the only session holder), so it supplies this instead.
 */
export type CrmAuth = {
  getUser: () => Promise<{ data: { user: { id: string; email?: string | undefined } | null }; error: unknown }>;
};

export type CrmHost = {
  /** The signed-in JewelOS client. It is the identity only; CRM data is not read through it. */
  supabase: JewelosClient;
  /** The CRM Supabase project (public URL and anon key). */
  crmProject: CrmProjectConfig;
  /**
   * The current JewelOS access token. Embedded mode supplies the native app's token. In the
   * browser the JewelOS client's own session is used.
   */
  jewelosAccessToken?: (() => Promise<string | null>) | undefined;
  /** Replaces supabase.auth for the ported code (embedded mode only). */
  auth?: CrmAuth | undefined;
  /** JewelOS client-side navigation (history push) to an absolute JewelOS path. */
  navigate: (href: string) => void;
  onSignOut: () => Promise<void> | void;
  jewelosHomePath: string;
};

type Facade = {
  base: JewelosClient;
  auth: CrmAuth | undefined;
  url: string;
  anonKey: string;
  jewelosAccessToken: CrmHost["jewelosAccessToken"];
  source: CrmTokenSource;
  project: CrmSupabaseClient;
  client: CrmSupabaseClient;
};

let host: CrmHost | null = null;
let facade: Facade | null = null;

export function configureCrmHost(next: CrmHost): void {
  host = next;
}

export function crmHost(): CrmHost {
  if (!host) throw new Error("The CRM is not mounted: CrmApp must provide the JewelOS host first.");
  return host;
}

function currentFacade(): Facade {
  const { supabase, auth, crmProject, jewelosAccessToken } = crmHost();
  if (!crmProject.url || !crmProject.anonKey) throw new Error("The CRM project is not configured (VITE_CRM_SUPABASE_URL, VITE_CRM_SUPABASE_ANON_KEY).");
  if (
    !facade || facade.base !== supabase || facade.auth !== auth || facade.url !== crmProject.url
    || facade.anonKey !== crmProject.anonKey || facade.jewelosAccessToken !== jewelosAccessToken
  ) {
    const source = crmTokenSource({
      config: crmProject,
      jewelosAccessToken: jewelosAccessToken ?? (async () => (await supabase.auth.getSession()).data.session?.access_token ?? null),
    });
    const project = createCrmProjectClient({ config: crmProject, source }) as unknown as CrmSupabaseClient;
    facade = {
      base: supabase, auth, url: crmProject.url, anonKey: crmProject.anonKey, jewelosAccessToken, source, project,
      client: crmFacade(project, auth ?? supabase.auth),
    };
  }
  return facade;
}

/** The single client every ported query reads through: the CRM project, as the caller's CRM user. */
export function crmSupabase(): CrmSupabaseClient {
  return currentFacade().client;
}

/** The CRM-project client itself (Edge Function calls, e.g. crm-runo-push). */
export function crmProjectClient(): CrmSupabaseClient {
  return currentFacade().project;
}

/** Forget the cached CRM token (sign-out). */
export function forgetCrmSession(): void {
  facade?.source.invalidate();
}

function crmFacade(project: CrmSupabaseClient, auth: CrmAuth | CrmSupabaseClient["auth"]): CrmSupabaseClient {
  // The original code uses only from(), rpc(), storage and auth on its client. from, rpc and
  // storage go to the CRM project, where the original queries and bucket names apply as
  // written. auth stays the JewelOS session: the layout's "signed in?" check and getCrmUser's
  // email are about the JewelOS login, and the CRM user id comes from the database
  // (current_crm_user_id). The cast is narrow and safe for that surface. In embedded mode
  // the JewelOS client's auth is unusable by design, and `auth` stands in for getUser().
  return {
    from: project.from.bind(project),
    rpc: project.rpc.bind(project),
    schema: project.schema.bind(project),
    storage: project.storage,
    auth,
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
