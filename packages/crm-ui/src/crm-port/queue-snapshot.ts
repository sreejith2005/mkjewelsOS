import { z } from "zod";

// Validate the JSON RPC boundary before using it as page/component props.
export const queueSnapshotSchema = z.object({
  actor_id: z.string(),
  profile: z.object({ name: z.string(), role: z.enum(["super_admin", "branch_manager", "salesperson"]), branch_name: z.string().nullable() }),
  own_branch_id: z.string().nullable(), selected_branch_id: z.string().nullable(), selected_crm: z.string(),
  branches: z.array(z.object({ id: z.string(), name: z.string() })),
  allocation: z.array(z.object({ crm_name: z.string() })),
  availability: z.array(z.object({ crm_name: z.string(), is_available: z.boolean() })),
  items: z.array(z.object({ id: z.string(), token: z.string(), client_name: z.string(), mobile: z.string(), assigned_crm_name: z.string().nullable(), status: z.string(), created_at: z.string(), client_id: z.string().nullable(), branch_id: z.string(), client_is_new: z.boolean() })),
  completed_client_code: z.string().nullable(),
  fields: z.array(z.object({ id: z.string(), field_key: z.string(), label: z.string(), field_type: z.enum(["text", "number", "dropdown", "date", "geo", "file"]), is_mandatory: z.boolean(), is_hidden: z.boolean(), display_order: z.number(), is_runo_synced: z.boolean(), runo_field_name: z.string().nullable(), option_source: z.string().nullable() })),
  options: z.array(z.object({ id: z.string(), field_id: z.string(), option_value: z.string(), display_order: z.number(), triggers_field_key: z.string().nullable() })),
  lookup_options: z.record(z.string(), z.array(z.string())),
});

export function optionalUuid(value: string | undefined): string | undefined {
  return value && z.uuid().safeParse(value).success ? value : undefined;
}
