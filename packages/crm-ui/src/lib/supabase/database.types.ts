// crm-port: replaces the original generated sreejith-crm/web-app/lib/supabase/database.types.ts.
// Since the 2026-10-01 two-project decision, /crm reads and writes the CRM project (schema
// "public", as the original did), so these are the CRM project's generated types
// (crm-project.types.ts). Components keep reading Database["public"] unchanged.
import type { Database as CrmProjectDatabase, Json as CrmProjectJson } from "./crm-project.types";
import type { CustomerIntegrationFunctions } from "../customer-integration";

export type Json = CrmProjectJson;

type CrmSchema = CrmProjectDatabase["public"];

// The original generated types declared these optional RPC arguments as nullable (the SQL
// parameters default to NULL and the original UI passes null); the generator omits
// "| null". Type-only; the RPC contract is unchanged.
type NullableArgs<T> = { [K in keyof T]: undefined extends T[K] ? T[K] | null : T[K] };
type CrmFunctions = Omit<CrmSchema["Functions"], "manage_crm_roster"> & CustomerIntegrationFunctions & {
  manage_crm_roster: {
    Args: NullableArgs<CrmSchema["Functions"]["manage_crm_roster"]["Args"]>;
    Returns: CrmSchema["Functions"]["manage_crm_roster"]["Returns"];
  };
};

export type Database = {
  public: Omit<CrmSchema, "Functions"|"Tables"> & { Functions: CrmFunctions;Tables:CrmSchema["Tables"]&{
    crm_customer_workflow_events:{Row:{event_id:string;client_id:string;source_tenant:string;journey_key:string;source_actor_id:string|null;actor_id:string|null;branch_id:string|null;occurred_at:string;kind:string;channel:string;workflow:Json|null;answers:Json;provenance:Json;is_contact:boolean;received_at:string};Insert:never;Update:never;Relationships:[]};
  }};
};
