// crm-port: replaces the original generated sreejith-crm/web-app/lib/supabase/database.types.ts.
// Since the 2026-10-01 two-project decision, /crm reads and writes the CRM project (schema
// "public", as the original did), so these are the CRM project's generated types
// (crm-project.types.ts). Components keep reading Database["public"] unchanged.
import type { Database as CrmProjectDatabase, Json as CrmProjectJson } from "./crm-project.types";

export type Json = CrmProjectJson;

type CrmSchema = CrmProjectDatabase["public"];

// The original generated types declared these optional RPC arguments as nullable (the SQL
// parameters default to NULL and the original UI passes null); the generator omits
// "| null". Type-only; the RPC contract is unchanged.
type NullableArgs<T> = { [K in keyof T]: undefined extends T[K] ? T[K] | null : T[K] };
type CrmFunctions = Omit<CrmSchema["Functions"], "manage_crm_roster"> & {
  manage_crm_roster: {
    Args: NullableArgs<CrmSchema["Functions"]["manage_crm_roster"]["Args"]>;
    Returns: CrmSchema["Functions"]["manage_crm_roster"]["Returns"];
  };
};

export type Database = {
  public: Omit<CrmSchema, "Functions"> & { Functions: CrmFunctions };
};
