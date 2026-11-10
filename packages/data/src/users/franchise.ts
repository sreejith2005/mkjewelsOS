import { getSupabase as db } from "@jewelos/api-client/client";
import {
  assignmentLookupPayload,
  parseAssignmentLocations,
  parseAssignmentRecipientPage,
  parseBranchCounts,
  parseFranchiseModuleCoverage,
  parseOrgAuditHistory,
  type AssignmentLocations,
  type AssignmentLookupContext,
  type AssignmentRecipientPage,
  type FranchiseModuleCoverage,
  type OrgAuditEntry,
  isBranchLocationKind,
  isOrgScopeAuthority,
  parseMyOrgScope,
  type BranchLocationKind,
  type Json,
  type MyOrgScope,
  type OrgScopeAuthority,
  type OrgScopeLevel,
  type Tables,
} from "@jewelos/core";

/**
 * Franchise organisation tools (migration 0385). Every call is an audited,
 * Super Admin-only RPC; the server re-checks authority and tenant on each one.
 */

export type FranchiseGroup = Pick<Tables<"franchise_groups">, "id" | "name" | "code" | "city" | "state" | "is_active">;

export type FranchiseBranch = Readonly<{
  id: string;
  name: string;
  code: string;
  city: string | null;
  isActive: boolean;
  franchiseGroupId: string | null;
  locationKind: BranchLocationKind;
  managerId: string | null;
}>;

export type FranchiseScopeGrant = Readonly<{
  id: string;
  userProfileId: string;
  employeeName: string;
  authority: OrgScopeAuthority;
  scopeLevel: OrgScopeLevel;
  franchiseGroupId: string | null;
  branchId: string | null;
  reason: string | null;
}>;

/** Franchise scope a person has automatically from their role and store (0393). */
export type FranchiseAutomaticScope = Readonly<{
  userProfileId: string;
  employeeName: string;
  authority: OrgScopeAuthority;
  franchiseGroupId: string;
  branchId: string | null;
}>;

export type FranchiseAdminContext = Readonly<{
  enforcementEnabled: boolean;
  franchises: FranchiseGroup[];
  branches: FranchiseBranch[];
  grants: FranchiseScopeGrant[];
  automaticScopes: FranchiseAutomaticScope[];
}>;

export type FranchiseReadiness = Readonly<{
  enforcementEnabled: boolean;
  enforcementSupported: boolean;
  mappingsComplete: boolean;
  unmappedActiveBranches: { id: string; name: string; code: string }[];
  exhibitionLikeBranches: { id: string; name: string; locationKind: string; franchiseGroupId: string | null }[];
  unmappedInactiveBranches: number;
  leadersWithoutScope: { id: string; employeeName: string; role: string }[];
  recordsWithoutBranch: Record<string, number>;
  usersDepartmentBranchMismatch: number;
}>;

function fail(label: string, error: { message: string } | null): asserts error is null {
  if (error) throw new Error(`${label}: ${error.message}`);
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const optionalText = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function parseFranchiseAdminContext(input: unknown): FranchiseAdminContext {
  const value = record(input);
  return {
    enforcementEnabled: value.enforcement_enabled === true,
    franchises: list(value.franchises).map((row) => ({
      id: text(row.id), name: text(row.name), code: text(row.code), city: optionalText(row.city), state: optionalText(row.state), is_active: row.is_active === true,
    })),
    branches: list(value.branches).map((row) => ({
      id: text(row.id), name: text(row.name), code: text(row.code), city: optionalText(row.city), isActive: row.is_active === true,
      franchiseGroupId: optionalText(row.franchise_group_id), locationKind: isBranchLocationKind(row.location_kind) ? row.location_kind : "store",
      managerId: optionalText(row.manager_id),
    })),
    grants: list(value.grants).flatMap((row) => {
      if (!isOrgScopeAuthority(row.authority)) return [];
      const level = row.scope_level === "company" || row.scope_level === "franchise" || row.scope_level === "branch" ? row.scope_level : null;
      if (!level) return [];
      return [{
        id: text(row.id), userProfileId: text(row.user_profile_id), employeeName: text(row.employee_name), authority: row.authority, scopeLevel: level,
        franchiseGroupId: optionalText(row.franchise_group_id), branchId: optionalText(row.branch_id), reason: optionalText(row.reason),
      }];
    }),
    automaticScopes: list(value.automatic_scopes).flatMap((row) => {
      const franchiseGroupId = optionalText(row.franchise_group_id);
      if (!isOrgScopeAuthority(row.authority) || !franchiseGroupId) return [];
      return [{
        userProfileId: text(row.user_profile_id), employeeName: text(row.employee_name), authority: row.authority,
        franchiseGroupId, branchId: optionalText(row.branch_id),
      }];
    }),
  };
}

export function parseFranchiseReadiness(input: unknown): FranchiseReadiness {
  const value = record(input);
  return {
    enforcementEnabled: value.enforcement_enabled === true,
    enforcementSupported: value.enforcement_supported === true,
    mappingsComplete: value.mappings_complete === true,
    unmappedActiveBranches: list(value.unmapped_active_branches).map((row) => ({ id: text(row.id), name: text(row.name), code: text(row.code) })),
    exhibitionLikeBranches: list(value.exhibition_like_branches).map((row) => ({
      id: text(row.id), name: text(row.name), locationKind: text(row.location_kind), franchiseGroupId: optionalText(row.franchise_group_id),
    })),
    unmappedInactiveBranches: count(value.unmapped_inactive_branches),
    leadersWithoutScope: list(value.leaders_without_scope).map((row) => ({ id: text(row.id), employeeName: text(row.employee_name), role: text(row.role) })),
    recordsWithoutBranch: Object.fromEntries(Object.entries(record(value.records_without_branch)).map(([key, item]) => [key, count(item)])),
    usersDepartmentBranchMismatch: count(value.users_department_branch_mismatch),
  };
}

export async function loadMyOrgScope(): Promise<MyOrgScope> {
  const { data, error } = await db().rpc("get_my_org_scope");
  fail("Load scope", error);
  return parseMyOrgScope(data);
}

export async function loadFranchiseAdmin(): Promise<{ context: FranchiseAdminContext; readiness: FranchiseReadiness }> {
  const [context, readiness] = await Promise.all([db().rpc("get_franchise_admin_context"), db().rpc("get_franchise_readiness_report")]);
  fail("Load franchises", context.error);
  fail("Load readiness", readiness.error);
  return { context: parseFranchiseAdminContext(context.data), readiness: parseFranchiseReadiness(readiness.data) };
}

/**
 * Super Admin switches franchise isolation on or off (audited). The server
 * refuses "on" until every active store has a franchise and every section is
 * ready; "off" is always allowed.
 */
export async function setFranchiseIsolation(enabled: boolean, reason: string): Promise<void> {
  const { error } = await db().rpc("set_franchise_enforcement_with_audit", { p_enabled: enabled, p_reason: reason });
  fail(enabled ? "Switch isolation on" : "Switch isolation off", error);
}

export type FranchiseChanges = Readonly<{ name: string; code: string; city?: string | null; state?: string | null; is_active: boolean }>;

export async function saveFranchise(id: string | null, changes: FranchiseChanges): Promise<void> {
  const { error } = await db().rpc("save_franchise_group_with_audit", { p_franchise_group_id: id, p_payload: changes as Json });
  fail("Save franchise", error);
}

export async function assignBranchFranchise(branchId: string, franchiseGroupId: string | null, locationKind: BranchLocationKind, reason: string): Promise<void> {
  const { error } = await db().rpc("assign_branch_franchise_with_audit", {
    p_branch_id: branchId, p_franchise_group_id: franchiseGroupId, p_location_kind: locationKind, p_reason: reason,
  });
  fail("Assign franchise", error);
}

export type ScopeGrantRequest = Readonly<{
  profileId: string;
  authority: OrgScopeAuthority;
  franchiseGroupId: string | null;
  branchId: string | null;
  company: boolean;
  reason: string;
}>;

export async function grantScope(request: ScopeGrantRequest): Promise<void> {
  const { error } = await db().rpc("grant_org_scope_with_audit", {
    p_profile_id: request.profileId, p_authority: request.authority, p_franchise_group_id: request.franchiseGroupId,
    p_branch_id: request.branchId, p_company: request.company, p_reason: request.reason,
  });
  fail("Grant scope", error);
}

export async function revokeScope(grantId: string, reason: string): Promise<void> {
  const { error } = await db().rpc("revoke_org_scope_with_audit", { p_grant_id: grantId, p_reason: reason });
  fail("Revoke scope", error);
}

// ---------------------------------------------------------------------------
// Leadership hierarchy (migration 0397): Directors and adding locations
// ---------------------------------------------------------------------------

/** What a Director oversees: whole franchises and single stores. */
export type DirectorScope = Readonly<{ franchiseGroupIds: string[]; branchIds: string[] }>;

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

export function parseDirectorScopes(input: unknown): Map<string, DirectorScope> {
  return new Map(list(input).flatMap((row) => {
    const profileId = text(row.user_profile_id);
    return profileId ? [[profileId, { franchiseGroupIds: ids(row.franchise_group_ids), branchIds: ids(row.branch_ids) }] as const] : [];
  }));
}

/** Directors among the employees the viewer may see (Users section). */
export async function loadDirectorScopes(): Promise<Map<string, DirectorScope>> {
  const { data, error } = await db().rpc("list_director_scopes");
  fail("Load Directors", error);
  return parseDirectorScopes(data);
}

/** Make an employee a Director, or change a Director's franchises and stores (Super Admin, Admin). */
export async function saveDirector(profileId: string, scope: DirectorScope, homeBranchId: string | null, reason: string): Promise<void> {
  const { error } = await db().rpc("save_director_with_audit", {
    p_profile_id: profileId, p_franchise_ids: [...scope.franchiseGroupIds], p_branch_ids: [...scope.branchIds],
    p_home_branch_id: homeBranchId, p_reason: reason,
  });
  fail("Save Director", error);
}

/** A Director becomes a company-wide Admin. */
export async function endDirector(profileId: string, reason: string): Promise<void> {
  const { error } = await db().rpc("end_director_with_audit", { p_profile_id: profileId, p_reason: reason });
  fail("Change Director to Admin", error);
}

export type OrgLocations = Readonly<{
  companyScope: boolean;
  canAddFranchise: boolean;
  addableFranchiseIds: string[];
  franchises: FranchiseGroup[];
  branches: FranchiseBranch[];
}>;

export function parseOrgLocations(input: unknown): OrgLocations {
  const value = record(input);
  const context = parseFranchiseAdminContext({ franchises: value.franchises, branches: value.branches });
  return {
    companyScope: value.company_scope === true,
    canAddFranchise: value.can_add_franchise === true,
    addableFranchiseIds: ids(value.addable_franchise_ids),
    franchises: context.franchises,
    branches: context.branches,
  };
}

/** The franchises and stores the viewer may see, and where they may add (Admin, Director). */
export async function loadOrgLocations(): Promise<OrgLocations> {
  const { data, error } = await db().rpc("get_org_locations");
  fail("Load franchises", error);
  return parseOrgLocations(data);
}

export type NewStore = Readonly<{ name: string; code: string; city?: string | null; state?: string | null; address?: string | null }>;

/** Add a store to a franchise (Super Admin, Admin, or a Director of that franchise). */
export async function addStoreToFranchise(franchiseGroupId: string, store: NewStore): Promise<void> {
  const { error } = await db().rpc("create_branch_in_franchise_with_audit", { p_franchise_group_id: franchiseGroupId, p_payload: store as Json });
  fail("Add store", error);
}

// ---------------------------------------------------------------------------
// Phase 2 (migration 0386)
// ---------------------------------------------------------------------------

/** Counts, module coverage and organisation history for the Super Admin panel. */
export async function loadFranchiseInsights(): Promise<{ branchCounts: ReadonlyMap<string, number>; coverage: FranchiseModuleCoverage[] }> {
  const [counts, coverage] = await Promise.all([
    db().rpc("get_franchise_branch_counts"),
    db().rpc("get_franchise_module_coverage"),
  ]);
  fail("Load employee counts", counts.error);
  fail("Load module coverage", coverage.error);
  return { branchCounts: parseBranchCounts(counts.data), coverage: parseFranchiseModuleCoverage(coverage.data) };
}

/** Organisation history, loaded on its own so it can never block the store list. */
export async function loadFranchiseHistory(): Promise<OrgAuditEntry[]> {
  const { data, error } = await db().rpc("get_franchise_audit_history", { p_limit: 50 });
  fail("Load organisation history", error);
  return parseOrgAuditHistory(data);
}

/** Franchises and stores the cross-location picker may offer (names only). */
export async function loadAssignmentLocations(context: AssignmentLookupContext): Promise<AssignmentLocations> {
  const { data, error } = await db().rpc("list_assignment_locations", { p_context: assignmentLookupPayload(context) as Json });
  fail("Load locations", error);
  return parseAssignmentLocations(data);
}

/** One store at a time, at most 50 people per page; no contact details. */
export async function searchAssignmentRecipients(context: AssignmentLookupContext, storeId: string, search: string, offset: number, limit = 20): Promise<AssignmentRecipientPage> {
  const { data, error } = await db().rpc("search_assignment_recipients", {
    p_context: assignmentLookupPayload(context) as Json, p_branch_id: storeId, p_search: search, p_offset: offset, p_limit: limit,
  });
  fail("Load employees", error);
  return parseAssignmentRecipientPage(data);
}

/** Super Admin: which franchise owns a form or FMS workflow family (null = shared). */
export async function setDefinitionOwnerFranchise(kind: "form" | "fms", familyId: string, franchiseGroupId: string | null, reason: string): Promise<void> {
  const { error } = await db().rpc("set_definition_owner_franchise_with_audit", {
    p_kind: kind, p_family_id: familyId, p_franchise_group_id: franchiseGroupId, p_reason: reason,
  });
  fail("Set owner", error);
}
