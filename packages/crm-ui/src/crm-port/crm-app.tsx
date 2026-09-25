// crm-port: the CRM entry point JewelOS renders full-screen for /crm and /crm/*.
import type { JewelosClient } from "@jewelos/api-client";

import RootLayout from "@/app/layout";

import { CrmAppRouter } from "./app-router";
import { configureCrmHost } from "./runtime";

export type CrmAppProps = {
  /** The signed-in JewelOS browser client; CRM queries use its schema("crm"). */
  supabase: JewelosClient;
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
};

export function CrmApp({ supabase, path, search, navigate, onSignOut, jewelosHomePath }: CrmAppProps) {
  configureCrmHost({ supabase, navigate, onSignOut, jewelosHomePath });
  return <RootLayout><CrmAppRouter browserPath={path} browserSearch={search} /></RootLayout>;
}
