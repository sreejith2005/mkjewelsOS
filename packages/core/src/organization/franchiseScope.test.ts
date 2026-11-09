import { describe, expect, it } from "vitest";
import { automaticScopeAuthority, branchesOfferedForUserManagement, directorCoveredStoreIds, isDirectorScope, parseMyOrgScope, resolveOrgScope, scopeLevelForAuthority, type ScopeActor, type ScopeBranch } from "./franchiseScope";

const branches: ScopeBranch[] = [
  { id: "bandra", franchiseGroupId: "mum", managerId: "mgr" },
  { id: "andheri", franchiseGroupId: "mum", managerId: null },
  { id: "zaveri", franchiseGroupId: "mum", managerId: null },
  { id: "ahd1", franchiseGroupId: "ahd", managerId: null },
  { id: "expo", franchiseGroupId: null, managerId: null },
];
const active = new Set(["mum", "ahd"]);
const actor = (overrides: Partial<ScopeActor>): ScopeActor => ({ profileId: "p", branchId: "andheri", active: true, superAdmin: false, grants: [], ...overrides });

describe("automatic franchise scope (mirror of org_automatic_scope, 0393 and 0397)", () => {
  it("maps only HR to a franchise authority", () => {
    expect(automaticScopeAuthority("hr")).toBe("hr");
    for (const role of ["admin", "manager", "staff", "crm", "super_admin", null, undefined]) expect(automaticScopeAuthority(role)).toBeNull();
  });

  it("gives an Admin who is not a Director every store (company scope)", () => {
    const scope = resolveOrgScope(actor({ effectiveRole: "admin", branchId: "expo" }), branches, active);
    expect(scope.company).toBe(true);
    expect(scope.readableBranchIds).toHaveLength(5);
    expect(scope.manageableBranchIds).toHaveLength(5);
    expect(scope.authorities).toEqual([]);
  });

  it("covers HR's franchise, and nothing at a store with no franchise or an inactive one", () => {
    expect(resolveOrgScope(actor({ effectiveRole: "hr", branchId: "ahd1" }), branches, active).readableBranchIds).toEqual(["ahd1"]);
    expect(resolveOrgScope(actor({ effectiveRole: "hr", branchId: "ahd1" }), branches, active).authorities).toEqual(["hr"]);
    expect(resolveOrgScope(actor({ effectiveRole: "hr", branchId: "expo" }), branches, active).readableBranchIds).toEqual(["expo"]);
    expect(resolveOrgScope(actor({ effectiveRole: "hr", branchId: "ahd1" }), branches, new Set(["mum"])).readableBranchIds).toEqual(["ahd1"]);
  });

  it("leaves staff on their own store", () => {
    const scope = resolveOrgScope(actor({ effectiveRole: "staff" }), branches, active);
    expect(scope.readableBranchIds).toEqual(["andheri"]);
    expect(scope.authorities).toEqual([]);
  });
});

describe("resolveOrgScope (mirror of org_scope_branch_ids)", () => {
  it("gives Super Admin every branch, including unmapped ones", () => {
    const scope = resolveOrgScope(actor({ superAdmin: true }), branches, active);
    expect(scope.company).toBe(true);
    expect(scope.readableBranchIds).toHaveLength(5);
  });

  it("gives a franchise Director every store of that franchise and nothing else", () => {
    const scope = resolveOrgScope(actor({ grants: [{ id: "g", authority: "director", scopeLevel: "franchise", franchiseGroupId: "mum", branchId: null }] }), branches, active);
    expect(scope.readableBranchIds).toEqual(["andheri", "bandra", "zaveri"]);
    expect(scope.manageableBranchIds).toEqual(["andheri", "bandra", "zaveri"]);
    expect(scope.readableBranchIds).not.toContain("ahd1");
    expect(scope.readableBranchIds).not.toContain("expo");
  });

  it("limits an Admin-role Director to the chosen franchises and stores (0397)", () => {
    const grants = [
      { id: "g1", authority: "director" as const, scopeLevel: "franchise" as const, franchiseGroupId: "ahd", branchId: null },
      { id: "g2", authority: "director" as const, scopeLevel: "branch" as const, franchiseGroupId: null, branchId: "bandra" },
    ];
    expect(isDirectorScope("admin", grants)).toBe(true);
    expect(isDirectorScope("manager", grants)).toBe(false);
    expect(isDirectorScope("admin", [])).toBe(false);
    const scope = resolveOrgScope(actor({ effectiveRole: "admin", branchId: "ahd1", grants }), branches, active);
    expect(scope.company).toBe(false);
    expect(scope.readableBranchIds).toEqual(["ahd1", "bandra"]);
    expect(scope.manageableBranchIds).toEqual(["ahd1", "bandra"]);
  });

  it("previews the stores a Director covers", () => {
    const rows = [{ id: "bandra", franchise_group_id: "mum" }, { id: "andheri", franchise_group_id: "mum" }, { id: "ahd1", franchise_group_id: "ahd" }, { id: "ahd2", franchise_group_id: "ahd" }];
    expect(directorCoveredStoreIds(rows, ["ahd"], ["bandra"])).toEqual(["bandra", "ahd1", "ahd2"]);
    expect(directorCoveredStoreIds(rows, [], [])).toEqual([]);
  });

  it("treats branches.manager_id as store manager authority for that store only", () => {
    const scope = resolveOrgScope(actor({ profileId: "mgr", branchId: "bandra" }), branches, active);
    expect(scope.manageableBranchIds).toEqual(["bandra"]);
    expect(scope.authorities).toEqual(["store_manager"]);
  });

  it("lets staff read their own store but manage nothing", () => {
    const scope = resolveOrgScope(actor({}), branches, active);
    expect(scope.readableBranchIds).toEqual(["andheri"]);
    expect(scope.manageableBranchIds).toEqual([]);
  });

  it("keeps store access read only", () => {
    const scope = resolveOrgScope(actor({ grants: [{ id: "g", authority: "store_access", scopeLevel: "branch", franchiseGroupId: null, branchId: "bandra" }] }), branches, active);
    expect(scope.readableBranchIds).toEqual(["andheri", "bandra"]);
    expect(scope.manageableBranchIds).toEqual([]);
  });

  it("ignores grants on an inactive franchise and everything for an inactive person", () => {
    const grants = [{ id: "g", authority: "hr" as const, scopeLevel: "franchise" as const, franchiseGroupId: "ahd", branchId: null }];
    expect(resolveOrgScope(actor({ grants }), branches, new Set(["mum"])).readableBranchIds).toEqual(["andheri"]);
    expect(resolveOrgScope(actor({ grants, active: false }), branches, active).readableBranchIds).toEqual([]);
  });

  it("maps authorities to their scope level", () => {
    expect(scopeLevelForAuthority("director", false)).toBe("franchise");
    expect(scopeLevelForAuthority("director", true)).toBe("company");
    expect(scopeLevelForAuthority("store_manager", true)).toBe("branch");
  });
});

describe("parseMyOrgScope and offered branches", () => {
  const rows = [{ id: "bandra", is_active: true }, { id: "andheri", is_active: true }, { id: "old", is_active: false }];

  it("offers every active branch while isolation is off", () => {
    const scope = parseMyOrgScope({ enforcement_enabled: false, company_scope: false, branch_id: "bandra", manageable_branch_ids: [] });
    expect(branchesOfferedForUserManagement(rows, scope).map((row) => row.id)).toEqual(["bandra", "andheri"]);
  });

  it("offers only manageable branches while isolation is on", () => {
    const scope = parseMyOrgScope({ enforcement_enabled: true, company_scope: false, branch_id: "bandra", manageable_branch_ids: ["bandra"], authorities: ["store_manager", "unknown"] });
    expect(branchesOfferedForUserManagement(rows, scope).map((row) => row.id)).toEqual(["bandra"]);
    expect(scope.authorities).toEqual(["store_manager"]);
  });

  it("rejects malformed payloads", () => {
    expect(() => parseMyOrgScope(null)).toThrow();
    expect(() => parseMyOrgScope({ enforcement_enabled: true })).toThrow();
  });
});
