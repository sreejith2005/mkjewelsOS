import type { TaskImportCanonicalRow, TaskImportDraftRow } from "@jewelos/core";
import type { TaskBulkImportIssue } from "./workbook";

export type TaskImportIdentityCandidate = Readonly<{
  id: string;
  employee_name: string;
  email: string;
  branch_id: string;
  department_id: string;
  manager_id: string | null;
}>;

const normalized = (value: string) => value.trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " ");
const unique = (candidates: readonly TaskImportIdentityCandidate[], predicate: (candidate: TaskImportIdentityCandidate) => boolean) => {
  const matches = candidates.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
};

export function applyIdentityMappings(draftRows: readonly TaskImportDraftRow[], candidates: readonly TaskImportIdentityCandidate[]) {
  const issues: TaskBulkImportIssue[] = [];
  const rows: TaskImportCanonicalRow[] = draftRows.map((row) => {
    const email = normalized(row.assignee_email);
    const name = normalized(row.assignee_name);
    const assignee = email
      ? unique(candidates, (candidate) => normalized(candidate.email) === email)
      : name ? unique(candidates, (candidate) => normalized(candidate.employee_name) === name) : undefined;
    const verifierLabel = normalized(row.verifier_label);
    const explicitVerifier = row.verification_required && verifierLabel
      ? unique(candidates, (candidate) => normalized(candidate.employee_name) === verifierLabel || normalized(candidate.email) === verifierLabel)
      : undefined;
    const manager = assignee?.manager_id ? candidates.find((candidate) => candidate.id === assignee.manager_id) : undefined;
    const verifier = row.verification_required ? explicitVerifier ?? manager : undefined;
    const assignment_status = assignee ? "assigned" : "assigning_left";
    return { ...row, assignee_profile_id: assignee?.id ?? "", verifier_profile_id: verifier?.id ?? "", assignment_status };
  });
  return { rows, issues };
}
