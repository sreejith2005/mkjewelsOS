// crm-port: replaces the original generated sreejith-crm/web-app/lib/supabase/database.types.ts.
// The original schema now lives in JewelOS schema "crm" (0179-0185) with the same table,
// column, enum and function names, so the original "public" types are the generated
// JewelOS "crm" types. Components keep reading Database["public"] unchanged.
import type { Database as JewelosDatabase, Json as JewelosJson } from "@jewelos/api-client";

export type Json = JewelosJson;

type CrmSchema = JewelosDatabase["crm"];

// The original generated types declared these optional RPC arguments as nullable (the SQL
// parameters default to NULL and the original UI passes null); the JewelOS generator omits
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
