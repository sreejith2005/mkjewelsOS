import type { Json } from "@/lib/supabase/database.types";

/** Display the recorded attendance answer without inventing an account link. */
export function savedSalespersonName(fields: Json | undefined, linkedName: string | null): string | null {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return linkedName;
  const legacy = fields.legacy_submitted_fields;
  const source = legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy : fields;
  const snapshot = fields.submitted_fields;
  const values = [snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot.salesperson : null, fields.salesperson, source.SALESPERSON];
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? linkedName;
}
