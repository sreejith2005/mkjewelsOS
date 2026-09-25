// Type surface of @jewelos/crm-ui for its consumers (the web app). The ported original CRM
// sources are checked with their own compiler settings in this package; consumers read only
// this declaration. tests/public-api.test.ts keeps it identical to src/index.ts.
import type { ReactElement } from "react";
import type { JewelosClient } from "@jewelos/api-client";

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

export declare function CrmApp(props: CrmAppProps): ReactElement;

export declare const CRM_BASE_PATH: "/crm";
