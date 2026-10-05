// Type surface of @jewelos/crm-ui for its consumers (the web app). The ported original CRM
// sources are checked with their own compiler settings in this package; consumers read only
// this declaration. tests/public-api.test.ts keeps it identical to src/index.ts.
import type { ReactElement } from "react";
import type { JewelosClient } from "@jewelos/api-client";

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

/** The CRM Supabase project the CRM reads and writes (public URL and anon key). */
export type CrmProjectConfig = Readonly<{ url: string; anonKey: string }>;

/** The part of supabase.auth the ported CRM uses. */
export type CrmAuth = {
  getUser: () => Promise<{ data: { user: { id: string; email?: string | undefined } | null }; error: unknown }>;
};

export declare function CrmApp(props: CrmAppProps): ReactElement;

export declare const CRM_BASE_PATH: "/crm";
