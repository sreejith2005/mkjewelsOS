// crm-port: compile-time guard that src/public-api.d.ts (what the web app type-checks against)
// matches the real exports of src/index.ts. `pnpm --filter @jewelos/crm-ui typecheck` fails
// if they drift.
import type * as Declared from "../public-api";
import * as Implemented from "../index";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const crmAppMatches: typeof Declared.CrmApp = Implemented.CrmApp;
export const basePathMatches: typeof Declared.CRM_BASE_PATH = Implemented.CRM_BASE_PATH;
export const propsMatch: Same<Declared.CrmAppProps, Implemented.CrmAppProps> = true;
