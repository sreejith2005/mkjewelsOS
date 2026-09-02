import type { TaskImportCanonicalRow, TaskImportDraftRow } from "@jewelos/core";
import type { TaskBulkImportIssue } from "./workbook";

export type TaskImportIdentityCandidate = Readonly<{
  id: string;
  employee_name: string;
  email: string;
  branch_id: string;
  department_id: string;
  manager_id: string | null;
  import_aliases: readonly string[];
}>;

const normalized = (value: string) => value.trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " ");
const nameKey = (value: string) => {
  const parts = normalized(value).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)}` : parts[0] ?? "";
};
const unique = (candidates: readonly TaskImportIdentityCandidate[], predicate: (candidate: TaskImportIdentityCandidate) => boolean) => {
  const matches = candidates.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
};

function resolveIdentity(email: string, name: string, candidates: readonly TaskImportIdentityCandidate[]) {
  const emailMatch = email ? unique(candidates, (candidate) => normalized(candidate.email) === email) : undefined;
  if (emailMatch) return emailMatch;
  if (!name) return undefined;
  const aliasMatch = unique(candidates, (candidate) => candidate.import_aliases.some((alias) => normalized(alias) === name));
  if (aliasMatch) return aliasMatch;
  const exactNameMatch = unique(candidates, (candidate) => normalized(candidate.employee_name) === name);
  if (exactNameMatch) return exactNameMatch;
  const compactName = nameKey(name);
  return compactName ? unique(candidates, (candidate) => nameKey(candidate.employee_name) === compactName) : undefined;
}

export function applyIdentityMappings(draftRows: readonly TaskImportDraftRow[], candidates: readonly TaskImportIdentityCandidate[]) {
  const issues: TaskBulkImportIssue[] = [];
  const unresolved = new Map<string, { label: string; source_rows: number[] }>();
  const rows: TaskImportCanonicalRow[] = draftRows.map((row) => {
    const email = normalized(row.assignee_email);
    const name = normalized(row.assignee_name);
    const assignee = resolveIdentity(email, name, candidates);
    if (!assignee && name) {
      const found = unresolved.get(name);
      if (found) found.source_rows.push(row.source_row);
      else unresolved.set(name, { label: row.assignee_name.trim(), source_rows: [row.source_row] });
    }
    const verifierLabel = normalized(row.verifier_label);
    const explicitVerifier = row.verification_required && verifierLabel
      ? resolveIdentity(verifierLabel.includes("@") ? verifierLabel : "", verifierLabel, candidates)
      : undefined;
    const manager = assignee?.manager_id ? candidates.find((candidate) => candidate.id === assignee.manager_id) : undefined;
    const verifier = row.verification_required ? explicitVerifier ?? manager : undefined;
    const assignment_status = assignee ? "assigned" : "assigning_left";
    return { ...row, assignee_profile_id: assignee?.id ?? "", verifier_profile_id: verifier?.id ?? "", assignment_status };
  });
  return { rows, issues, unresolvedAssignees: [...unresolved.values()] };
}
