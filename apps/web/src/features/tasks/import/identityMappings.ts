import { identityRequirementKey, type TaskImportCanonicalRow, type TaskImportDraftRow } from "@jewelos/core";
import type { TaskBulkImportIssue } from "./workbook";

export type TaskImportIdentityMappings = Readonly<Record<string, string>>;
export function applyIdentityMappings(draftRows: readonly TaskImportDraftRow[], mappings: TaskImportIdentityMappings) {
  const issues: TaskBulkImportIssue[] = [];
  const rows: TaskImportCanonicalRow[] = draftRows.map((row) => {
    const assignee_profile_id = row.assignee_email ? "" : mappings[identityRequirementKey("assignee", row.assignee_name)] ?? "";
    const verifier_profile_id = !row.verification_required ? "" : mappings[identityRequirementKey("verifier", row.verifier_label)] ?? "";
    if (!row.assignee_email && !assignee_profile_id) issues.push({ sheet: "Tasks", row: row.source_row, field: "EMPLOYEE EMAIL", reason: "Employee identity mapping is required", guidance: "Select and confirm an active employee.", severity: "error" });
    if (row.verification_required && !verifier_profile_id) issues.push({ sheet: "Tasks", row: row.source_row, field: "VERIFIER", reason: "Verifier identity mapping is required", guidance: "Select and confirm an active verifier.", severity: "error" });
    return { ...row, assignee_profile_id, verifier_profile_id };
  });
  return { rows, issues };
}
