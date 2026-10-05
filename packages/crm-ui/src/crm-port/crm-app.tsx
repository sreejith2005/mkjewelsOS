// crm-port: the CRM entry point JewelOS renders full-screen for /crm and /crm/*.
import type { JewelosClient } from "@jewelos/api-client";

import RootLayout from "@/app/layout";

import { CrmAppRouter } from "./app-router";
import type { CrmProjectConfig } from "./crm-project";
import { configureCrmHost, type CrmAuth } from "./runtime";

export type CrmAppProps = {
  /** The signed-in JewelOS browser client: the identity only. CRM data is read from the CRM project. */
  supabase: JewelosClient;
  /** The CRM Supabase project's public URL and anon key (two-project design, 2026-10-01). */
  crmProject: CrmProjectConfig;
  /**
   * Embedded mode only: the native app's current JewelOS access token, which the login bridge
   * exchanges for a CRM token. In the browser the JewelOS client's own session is used.
   */
  jewelosAccessToken?: (() => Promise<string | null>) | undefined;
  /** Current JewelOS browser pathname, e.g. "/crm/queue". */
  path: string;
  /** Current location.search, e.g. "?branch=...". */
  search: string;
  /** JewelOS history navigation to an absolute path. */
  navigate: (href: string) => void;
  /** JewelOS sign-out (the original CRM sign-out server action). */
  onSignOut: () => Promise<void> | void;
  /** Where "← JewelOS" returns to. */
  jewelosHomePath: string;
  /**
   * Embedded mode only (the JewelOS Android app's WebView): stands in for supabase.auth, which
   * a client fed by the native access token does not have.
   */
  auth?: CrmAuth | undefined;
};

export function CrmApp({ supabase, crmProject, jewelosAccessToken, path, search, navigate, onSignOut, jewelosHomePath, auth }: CrmAppProps) {
  configureCrmHost({ supabase, crmProject, jewelosAccessToken, navigate, onSignOut, jewelosHomePath, auth });
  return <RootLayout><CrmAppRouter browserPath={path} browserSearch={search} /></RootLayout>;
}
