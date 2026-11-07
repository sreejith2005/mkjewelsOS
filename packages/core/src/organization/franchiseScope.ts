/**
 * Franchise data scope (migration 0385). The database is the authority:
 * `org_scope_branch_ids()` and `assert_org_user_write()` decide every read and
 * write. This module mirrors the rules for previews and parses the server
 * payloads; nothing here grants access.
 */

export const ORG_SCOPE_AUTHORITIES = ["director", "regional_admin", "hr", "store_manager", "store_access"] as const;
export type OrgScopeAuthority = (typeof ORG_SCOPE_AUTHORITIES)[number];

export const ORG_SCOPE_LEVELS = ["company", "franchise", "branch"] as const;
export type OrgScopeLevel = (typeof ORG_SCOPE_LEVELS)[number];

export const BRANCH_LOCATION_KINDS = ["store", "exhibition", "office", "warehouse"] as const;
export type BranchLocationKind = (typeof BRANCH_LOCATION_KINDS)[number];

/** Authorities that cover a whole franchise (or, by Super Admin grant, the company). */
export const FRANCHISE_AUTHORITIES: readonly OrgScopeAuthority[] = ["director", "regional_admin", "hr"];
/** Authorities that cover one store each. */
export const STORE_AUTHORITIES: readonly OrgScopeAuthority[] = ["store_manager", "store_access"];

export const ORG_SCOPE_AUTHORITY_LABELS: Readonly<Record<OrgScopeAuthority, string>> = {
  director: "Director",
  regional_admin: "Regional Admin",
  hr: "HR",
  store_manager: "Store Manager",
  store_access: "Store access (read only)",
};

export const BRANCH_LOCATION_KIND_LABELS: Readonly<Record<BranchLocationKind, string>> = {
  store: "Store",
  exhibition: "Exhibition",
  office: "Office",
  warehouse: "Warehouse",
};

export function isOrgScopeAuthority(value: unknown): value is OrgScopeAuthority {
  return typeof value === "string" && (ORG_SCOPE_AUTHORITIES as readonly string[]).includes(value);
}

export function isBranchLocationKind(value: unknown): value is BranchLocationKind {
  return typeof value === "string" && (BRANCH_LOCATION_KINDS as readonly string[]).includes(value);
}

/**
 * Mirrors `org_automatic_scope()` (migration 0390): the franchise authority a
 * person's own effective role (dashboard authority, else role) confers through
 * the franchise of their own store. Admin -> Regional Admin, HR -> HR; any other
 * role confers nothing (a store manager comes from the store's manager).
 */
export function automaticScopeAuthority(effectiveRole: string | null | undefined): OrgScopeAuthority | null {
  if (effectiveRole === "admin") return "regional_admin";
  if (effectiveRole === "hr") return "hr";
  return null;
}

export function scopeLevelForAuthority(authority: OrgScopeAuthority, company: boolean): OrgScopeLevel {
  if (STORE_AUTHORITIES.includes(authority)) return "branch";
  return company ? "company" : "franchise";
}

export type OrgScopeGrant = Readonly<{
  id: string;
  authority: OrgScopeAuthority;
  scopeLevel: OrgScopeLevel;
  franchiseGroupId: string | null;
  branchId: string | null;
}>;

export type ScopeBranch = Readonly<{ id: string; franchiseGroupId: string | null; managerId: string | null }>;

export type ScopeActor = Readonly<{
  profileId: string;
  branchId: string;
  active: boolean;
  /** Super Admin dashboard authority. */
  superAdmin: boolean;
  /** Effective role (dashboard authority, else role); Admin and HR cover their store's franchise (0390). */
  effectiveRole?: string | null;
  grants: readonly OrgScopeGrant[];
}>;

export type ResolvedOrgScope = Readonly<{
  company: boolean;
  readableBranchIds: readonly string[];
  manageableBranchIds: readonly string[];
  authorities: readonly OrgScopeAuthority[];
}>;

/**
 * Mirrors `org_has_company_scope()`, `org_scope_branch_ids()` and
 * `org_scope_authorities()`, including the automatic franchise scope of 0390. `activeFranchiseIds` lists franchises that are
 * active; a grant on an inactive franchise confers nothing.
 */
export function resolveOrgScope(actor: ScopeActor, branches: readonly ScopeBranch[], activeFranchiseIds: ReadonlySet<string>): ResolvedOrgScope {
  const empty: ResolvedOrgScope = { company: false, readableBranchIds: [], manageableBranchIds: [], authorities: [] };
  if (!actor.active) return empty;
  const company = actor.superAdmin || actor.grants.some((grant) => grant.scopeLevel === "company");
  const franchiseIds = new Set(
    actor.grants.filter((grant) => grant.scopeLevel === "franchise" && grant.franchiseGroupId && activeFranchiseIds.has(grant.franchiseGroupId)).map((grant) => grant.franchiseGroupId as string),
  );
  const automatic = automaticScopeAuthority(actor.effectiveRole);
  const ownFranchiseId = branches.find((branch) => branch.id === actor.branchId)?.franchiseGroupId ?? null;
  const automaticApplies = automatic !== null && ownFranchiseId !== null && activeFranchiseIds.has(ownFranchiseId);
  if (automaticApplies) franchiseIds.add(ownFranchiseId);
  const storeGrants = actor.grants.filter((grant) => grant.scopeLevel === "branch");
  const inScope = (branch: ScopeBranch, manage: boolean): boolean =>
    company
    || (!manage && branch.id === actor.branchId)
    || branch.managerId === actor.profileId
    || (branch.franchiseGroupId !== null && franchiseIds.has(branch.franchiseGroupId))
    || storeGrants.some((grant) => grant.branchId === branch.id && (!manage || grant.authority === "store_manager"));
  const authorities = new Set<OrgScopeAuthority>(actor.grants.map((grant) => grant.authority));
  if (branches.some((branch) => branch.managerId === actor.profileId)) authorities.add("store_manager");
  if (automaticApplies) authorities.add(automatic);
  return {
    company,
    readableBranchIds: branches.filter((branch) => inScope(branch, false)).map((branch) => branch.id).sort(),
    manageableBranchIds: branches.filter((branch) => inScope(branch, true)).map((branch) => branch.id).sort(),
    authorities: ORG_SCOPE_AUTHORITIES.filter((authority) => authorities.has(authority)),
  };
}

/** The snapshot `get_my_org_scope()` returns. Informational only. */
export type MyOrgScope = Readonly<{
  enforcementEnabled: boolean;
  companyScope: boolean;
  branchId: string;
  franchiseGroupId: string | null;
  authorities: readonly OrgScopeAuthority[];
  readableBranchIds: readonly string[];
  manageableBranchIds: readonly string[];
}>;

const stringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** Fails closed: anything malformed yields no scope beyond the person's own branch. */
export function parseMyOrgScope(input: unknown): MyOrgScope {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Scope must be an object");
  const value = input as Record<string, unknown>;
  if (typeof value.branch_id !== "string") throw new Error("Invalid scope");
  return {
    enforcementEnabled: value.enforcement_enabled === true,
    companyScope: value.company_scope === true,
    branchId: value.branch_id,
    franchiseGroupId: typeof value.franchise_group_id === "string" ? value.franchise_group_id : null,
    authorities: stringArray(value.authorities).filter(isOrgScopeAuthority),
    readableBranchIds: stringArray(value.readable_branch_ids),
    manageableBranchIds: stringArray(value.manageable_branch_ids),
  };
}

/**
 * Branches a user-management form may offer. Before isolation is switched on,
 * or for company scope, every active branch is offered (today's behaviour).
 */
export function branchesOfferedForUserManagement<T extends { id: string; is_active: boolean | null }>(branches: readonly T[], scope: MyOrgScope | null): T[] {
  const active = branches.filter((branch) => branch.is_active !== false);
  if (!scope || !scope.enforcementEnabled || scope.companyScope) return active;
  const allowed = new Set(scope.manageableBranchIds);
  return active.filter((branch) => allowed.has(branch.id));
}

/** A franchise choice in a cascading location picker; `id` null = stores not yet mapped. */
export type FranchiseChoice = Readonly<{ id: string | null; name: string }>;

type ChoiceBranch = { id: string; name: string; is_active: boolean | null; franchise_group_id?: string | null };
type ChoiceFranchise = { id: string; name: string; is_active: boolean };

/**
 * Franchise -> Store choices for the Add / Edit user forms. Stores come from
 * `branchesOfferedForUserManagement` (the server re-checks every write);
 * franchises are those with at least one offered store, in name order, with
 * unmapped stores last under "Not mapped yet".
 */
export function userFormLocationChoices<B extends ChoiceBranch>(
  branches: readonly B[],
  franchises: readonly ChoiceFranchise[],
  scope: MyOrgScope | null,
): { franchises: FranchiseChoice[]; storesOf: (franchiseId: string | null) => B[]; lockedFranchiseId: string | null | undefined } {
  const offered = branchesOfferedForUserManagement(branches, scope);
  const known = new Map(franchises.filter((item) => item.is_active).map((item) => [item.id, item.name]));
  const keyOf = (branch: B): string | null => (branch.franchise_group_id && known.has(branch.franchise_group_id) ? branch.franchise_group_id : null);
  const ids = [...new Set(offered.map(keyOf))];
  const choices: FranchiseChoice[] = ids
    .map((id) => ({ id, name: id ? known.get(id) ?? "" : "Not mapped yet" }))
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));
  const storesOf = (franchiseId: string | null) => offered.filter((branch) => keyOf(branch) === franchiseId).sort((a, b) => a.name.localeCompare(b.name));
  // A person scoped to one franchise cannot switch into another.
  const restricted = Boolean(scope?.enforcementEnabled && !scope.companyScope);
  return { franchises: choices, storesOf, lockedFranchiseId: restricted && choices.length === 1 ? choices[0]!.id : undefined };
}

/** Departments a store may use: its own and shared (no store) ones, active only. */
export function departmentsForStore<D extends { id: string; branch_id: string | null; is_active: boolean | null }>(departments: readonly D[], storeId: string): D[] {
  return departments.filter((department) => department.is_active !== false && (department.branch_id === null || department.branch_id === storeId));
}
