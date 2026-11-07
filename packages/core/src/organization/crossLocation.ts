/**
 * Cross-location assignment (migration 0386). The server decides who may be
 * picked: `list_assignment_locations` and `search_assignment_recipients` check
 * the capability and the saved question setting, and the submission or task
 * contract re-checks every answer. These parsers only shape the replies and
 * fail closed (anything malformed is dropped).
 */

/** Which saved setting authorises the lookup. */
export type AssignmentLookupContext =
  | Readonly<{ kind: "form"; formTemplateId: string; fieldKey: string }>
  | Readonly<{ kind: "task" }>;

export function assignmentLookupPayload(context: AssignmentLookupContext): Record<string, string> {
  return context.kind === "form"
    ? { kind: "form", form_template_id: context.formTemplateId, field_key: context.fieldKey }
    : { kind: "task" };
}

export type AssignmentStore = Readonly<{ id: string; name: string }>;
/** A franchise with its active stores; `id` null groups stores not yet mapped. */
export type AssignmentLocation = Readonly<{ id: string | null; name: string; stores: readonly AssignmentStore[] }>;
export type AssignmentLocations = Readonly<{
  ownBranchId: string | null;
  ownFranchiseId: string | null;
  locations: readonly AssignmentLocation[];
}>;

export type AssignmentRecipient = Readonly<{
  id: string;
  name: string;
  designation: string | null;
  storeId: string;
  storeName: string;
  /** Department id only (no HR detail), so a task can name the doer's department. */
  departmentId: string | null;
  franchiseId: string | null;
  franchiseName: string | null;
}>;
export type AssignmentRecipientPage = Readonly<{ rows: readonly AssignmentRecipient[]; hasMore: boolean }>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export function parseAssignmentLocations(input: unknown): AssignmentLocations {
  const value = record(input);
  return {
    ownBranchId: text(value.own_branch_id),
    ownFranchiseId: text(value.own_franchise_group_id),
    locations: list(value.franchises).flatMap((row) => {
      const name = text(row.name);
      if (!name) return [];
      const stores = list(row.branches).flatMap((store) => {
        const id = text(store.id);
        const storeName = text(store.name);
        return id && storeName ? [{ id, name: storeName }] : [];
      });
      return stores.length ? [{ id: text(row.id), name, stores }] : [];
    }),
  };
}

export function parseAssignmentRecipientPage(input: unknown): AssignmentRecipientPage {
  const value = record(input);
  return {
    hasMore: value.has_more === true,
    rows: list(value.rows).flatMap((row) => {
      const id = text(row.id);
      const name = text(row.name);
      const storeId = text(row.branch_id);
      const storeName = text(row.branch_name);
      if (!id || !name || !storeId || !storeName) return [];
      return [{ id, name, designation: text(row.designation), storeId, storeName, departmentId: text(row.department_id), franchiseId: text(row.franchise_group_id), franchiseName: text(row.franchise_name) }];
    }),
  };
}

/** Franchise readiness: which modules already follow franchise scope. */
export type FranchiseModuleCoverage = Readonly<{ module: string; label: string; enforced: boolean; pendingReason: string | null }>;

export function parseFranchiseModuleCoverage(input: unknown): FranchiseModuleCoverage[] {
  return list(input).flatMap((row) => {
    const module = text(row.module);
    const label = text(row.label);
    if (!module || !label) return [];
    return [{ module, label, enforced: row.status === "enforced", pendingReason: text(row.pending_reason) }];
  });
}

export const ORG_AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  franchise_group_saved: "Franchise saved",
  branch_franchise_assigned: "Store franchise set",
  org_scope_granted: "Scope granted",
  org_scope_revoked: "Scope removed",
  employee_franchise_transferred: "Employee transferred",
  franchise_enforcement_changed: "Franchise isolation changed",
  cross_location_task_assigned: "Task assigned to another location",
  cross_location_recipient_selected: "Form answer named another location",
  definition_owner_franchise_set: "Form or workflow owner set",
};

export type OrgAuditEntry = Readonly<{ id: string; action: string; label: string; actorName: string | null; createdAt: string }>;

export function parseOrgAuditHistory(input: unknown): OrgAuditEntry[] {
  return list(input).flatMap((row) => {
    const id = text(row.id);
    const action = text(row.action);
    const createdAt = text(row.created_at);
    if (!id || !action || !createdAt) return [];
    return [{ id, action, label: ORG_AUDIT_ACTION_LABELS[action] ?? action, actorName: text(row.actor_name), createdAt }];
  });
}

/** Active employees per store, from `get_franchise_branch_counts`. */
export function parseBranchCounts(input: unknown): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const [key, value] of Object.entries(record(input))) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) counts.set(key, value);
  }
  return counts;
}
