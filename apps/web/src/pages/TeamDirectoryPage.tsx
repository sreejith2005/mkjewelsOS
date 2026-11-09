import { UserSectionAccess } from "@/features/permissions/UserSectionAccess";
import { SectionAccessMatrix } from "@/features/permissions/SectionAccessMatrix";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, KeyRound, Network, Pencil, Plus, Search, Users } from "lucide-react";
import { hasPermission, isFormerEmployee, type MyOrgScope } from "@jewelos/core";
import { supabase } from "@jewelos/api-client";
import { loadOrganization, type OrganizationData } from "@jewelos/data/users/organization";
import { loadDirectorScopes, loadMyOrgScope, type DirectorScope } from "@jewelos/data/users/franchise";
import { useAuth } from "@/auth/AuthContext";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { Button, Notice } from "@/components/ui";
import { initials, titleCase } from "@/lib/format";
import { AddUserForm, EditUser, type Data as UserManagementData } from "@/pages/UserManagementPage";
import { OrganizationManager } from "@/features/users/OrganizationManager";
import { FranchiseManager, LocationsManager } from "@/features/users/FranchiseManager";
import type { Branch, Department, DropdownMaster, UserProfile } from "@/types";

type Employee = UserProfile;
type Franchise = { id: string; name: string; is_active: boolean };
type ReferenceData = { employees: Employee[]; branches: Branch[]; departments: Department[]; designations: DropdownMaster[]; franchises: Franchise[]; scope: MyOrgScope | null; directors: ReadonlyMap<string, DirectorScope> };
const EMPTY: ReferenceData = { employees: [], branches: [], departments: [], designations: [], franchises: [], scope: null, directors: new Map() };

function AccountStatus({ value }: { value: Employee["account_status"] }) {
  const tone = value === "active" ? "bg-success/15 text-success" : value === "invited" ? "bg-gold/10 text-gold-secondary" : "bg-task-muted text-task-text-muted";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>{titleCase(value)}</span>;
}

export function TeamDirectoryPage() {
  const { access, profile } = useAuth(); const [data, setData] = useState<ReferenceData>(EMPTY); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [search, setSearch] = useState(""); const [branchId, setBranchId] = useState(""); const [franchiseId, setFranchiseId] = useState(""); const [departmentId, setDepartmentId] = useState(""); const [editing, setEditing] = useState<Employee | null>(null); const [inviting, setInviting] = useState(false); const [showFormer, setShowFormer] = useState(false);
  const [sectionAccessEmployee, setSectionAccessEmployee] = useState<Employee | null>(null);
  const canManageSections = hasPermission(access, "permissions.manage");
  const canDelete = hasPermission(access, "users.delete");
  const [organizationData, setOrganizationData] = useState<OrganizationData | null>(null);
  const load = useCallback(async () => { setLoading(true); const [employees, branches, departments, designations, franchises, scope, directors] = await Promise.all([supabase.from("user_profiles").select("*").is("removed_at", null).order("employee_name"), supabase.from("branches").select("*").eq("is_active", true).order("name"), supabase.from("departments").select("*").eq("is_active", true).order("name"), supabase.from("dropdown_masters").select("*").eq("master_type", "designation").order("sort_order"), supabase.from("franchise_groups").select("id,name,is_active").order("name"),
    // The scope snapshot only shapes choices; every write is re-checked on the server.
    loadMyOrgScope().catch(() => null),
    // Directors are the Admin role limited to chosen franchises and stores (0397); the list only labels them.
    loadDirectorScopes().catch(() => new Map<string, DirectorScope>())]);
    const first = [employees.error, branches.error, departments.error, designations.error, franchises.error].find(Boolean); if (first) setError(first.message); else setData({ employees: employees.data ?? [], branches: branches.data ?? [], departments: departments.data ?? [], designations: designations.data ?? [], franchises: franchises.data ?? [], scope, directors }); setLoading(false); }, []);
  const loadOrganizationData = useCallback(async () => {
    try { setOrganizationData(await loadOrganization()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load organization units."); }
  }, []);
  const canManageOrganization = hasPermission(access, "organization.manage");
  const refreshOrganization = useCallback(async () => {
    await Promise.all([load(), loadOrganizationData()]);
  }, [load, loadOrganizationData]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (canManageOrganization) void loadOrganizationData(); }, [canManageOrganization, loadOrganizationData]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["organization", "settings"], refresh: canManageOrganization ? refreshOrganization : load });
  const filteredDepartments = useMemo(() => data.departments.filter((department) => !branchId || department.branch_id === branchId), [branchId, data.departments]);
  const franchiseOfBranch = useMemo(() => new Map(data.branches.map((branch) => [branch.id, branch.franchise_group_id])), [data.branches]);
  const franchiseNames = useMemo(() => new Map(data.franchises.map((franchise) => [franchise.id, franchise.name])), [data.franchises]);
  const filteredBranches = useMemo(() => data.branches.filter((branch) => !franchiseId || branch.franchise_group_id === franchiseId), [data.branches, franchiseId]);
  const employees = useMemo(() => data.employees.filter((employee) => (showFormer || !isFormerEmployee(employee)) && (!franchiseId || franchiseOfBranch.get(employee.branch_id) === franchiseId) && (!branchId || employee.branch_id === branchId) && (!departmentId || employee.department_id === departmentId) && (!search.trim() || `${employee.employee_name} ${employee.employee_code} ${employee.email}`.toLowerCase().includes(search.trim().toLowerCase()))), [branchId, data.employees, departmentId, franchiseId, franchiseOfBranch, search, showFormer]);
  // Former employees keep their profile for history; they are not headcount.
  const formerCount = useMemo(() => data.employees.filter(isFormerEmployee).length, [data.employees]);
  const branchNames = useMemo(() => new Map(data.branches.map((branch) => [branch.id, branch.name])), [data.branches]); const departmentNames = useMemo(() => new Map(data.departments.map((department) => [department.id, department.name])), [data.departments]); const designationNames = useMemo(() => new Map(data.designations.map((designation) => [designation.id, designation.label])), [data.designations]);
  const userManagementData: UserManagementData = { profiles: data.employees, branches: data.branches, departments: data.departments, dropdowns: data.designations, franchises: data.franchises, scope: data.scope };
  // users.manage_scoped: Directors, Regional Admins, HR and Store Managers manage people in their own scope only (assert_org_user_write).
  const canManage = hasPermission(access, "users.manage") || hasPermission(access, "users.manage_scoped");
  const canManageFranchises = hasPermission(access, "franchise.manage");
  // Admin and Directors see their franchises and add franchises / stores (0397); Super Admin gets the full panel.
  const canAddLocations = !canManageFranchises && hasPermission(access, "organization.add_locations");
  const roleLabel = (employee: Employee) => (data.directors.has(employee.id) ? "Director" : titleCase(employee.user_role));
  const [franchisesOpen, setFranchisesOpen] = useState(false);
  const [sectionMatrixOpen, setSectionMatrixOpen] = useState(false);
  const showFranchise = data.franchises.length > 0;
  const franchiseLabel = (employee: Employee) => franchiseNames.get(franchiseOfBranch.get(employee.branch_id) ?? "");
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const desktop = useMediaQuery("(min-width: 1024px)");
  // Edit is the one entry point. People who may edit or delete open the employee editor, which
  // carries Section access as a tab when they may also manage sections; people who may only
  // manage sections open Section access directly.
  const canEditEmployee = canManage || canDelete;
  const sectionAccessFor = (employee: Employee) => profile && access && canManageSections ? <UserSectionAccess embedded key={employee.id} profileId={employee.id} selfId={access.profileId} tenantId={profile.tenant_id} onClose={() => setEditing(null)} onSaved={load} /> : undefined;
  if (editing) return <EditUser data={userManagementData} onClose={() => setEditing(null)} onSaved={load} sectionAccess={sectionAccessFor(editing)} superAdmin={profile?.user_role === "super_admin"} user={editing} directorScope={data.directors.get(editing.id) ?? null} />;
  const phoneOf = (employee: Employee) => employee.official_mobile || employee.personal_mobile || null;
  const openEmployee = (employee: Employee) => { if (canEditEmployee) setEditing(employee); else if (canManageSections) setSectionAccessEmployee(employee); };
  const actionLabel = (employee: Employee) => canEditEmployee ? `Edit ${employee.employee_name}` : `Section access for ${employee.employee_name}`;
  const hasAction = canEditEmployee || canManageSections;
  const empty = (value: string | null | undefined) => value ? value : <span className="text-task-text-muted/70">—</span>;
  return <section className="mx-auto w-full max-w-[110rem]">{sectionAccessEmployee && profile && access && canManageSections ? <UserSectionAccess key={sectionAccessEmployee.id} profileId={sectionAccessEmployee.id} selfId={access.profileId} tenantId={profile.tenant_id} onClose={() => setSectionAccessEmployee(null)} onSaved={load} /> : null}
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-gold-sheen p-2.5 text-on-gold shadow-gold"><Users className="size-5" /></span><div className="min-w-0"><h1 className="font-display text-[1.75rem] font-semibold leading-tight text-gold-secondary sm:text-[2rem]">Employee Directory</h1><p className="text-sm text-soft-grey tabular-nums">{data.employees.length - formerCount} employees{employees.length !== data.employees.length - formerCount ? ` · ${employees.length} shown` : ""}</p></div></div>
      <div className="flex flex-wrap items-center gap-2">{canManageSections && profile && access ? <Button aria-expanded={sectionMatrixOpen} onClick={() => setSectionMatrixOpen((open) => !open)} type="button" variant="secondary"><KeyRound className="size-4" />Section access</Button> : null}{canManageFranchises || canAddLocations ? <Button aria-expanded={franchisesOpen} onClick={() => setFranchisesOpen((open) => !open)} type="button" variant="secondary"><Network className="size-4" />Franchises</Button> : null}{canManageOrganization && organizationData ? <Button aria-expanded={organizationOpen} onClick={() => setOrganizationOpen((open) => !open)} type="button" variant="secondary"><Building2 className="size-4" />Branches &amp; departments</Button> : null}{canManage ? <Button onClick={() => setInviting(true)}><Plus className="size-4" />Add user</Button> : null}</div></header>
    {error ? <div className="mb-4"><Notice tone="danger">{error}</Notice></div> : null}
    {canManageSections && profile && access && sectionMatrixOpen ? <SectionAccessMatrix branches={data.branches} departments={data.departments} onSaved={load} selfId={access.profileId} tenantId={profile.tenant_id} /> : null}
    {canManageFranchises && franchisesOpen ? <FranchiseManager onChanged={load} people={data.employees} /> : null}
    {canAddLocations && franchisesOpen ? <LocationsManager onChanged={load} people={data.employees} /> : null}
    {canManageOrganization && organizationData && organizationOpen ? <OrganizationManager data={organizationData} onChanged={refreshOrganization} /> : null}
    <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center"><label className="relative block flex-1"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-soft-grey" /><input aria-label="Search employees" className="field pl-9" enterKeyHint="search" onChange={(event) => setSearch(event.target.value)} placeholder="Search employee, code, or email" type="search" value={search} /></label><div className={`grid gap-2 lg:flex ${showFranchise ? "grid-cols-3" : "grid-cols-2"}`}>{showFranchise ? <select aria-label="Filter franchise" className="field lg:w-48" onChange={(event) => { setFranchiseId(event.target.value); setBranchId(""); setDepartmentId(""); }} value={franchiseId}><option value="">All franchises</option>{data.franchises.map((franchise) => <option key={franchise.id} value={franchise.id}>{franchise.name}</option>)}</select> : null}<select aria-label="Filter branch" className="field lg:w-48" onChange={(event) => { setBranchId(event.target.value); setDepartmentId(""); }} value={branchId}><option value="">All branches</option>{filteredBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><select aria-label="Filter department" className="field lg:w-48" onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}><option value="">All departments</option>{filteredDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></div>{formerCount > 0 ? <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm text-soft-grey"><input checked={showFormer} onChange={(event) => setShowFormer(event.target.checked)} type="checkbox" />Show former employees ({formerCount})</label> : null}</div>
    {loading ? <div className="grid gap-2" aria-label="Loading employees"><div className="skeleton h-12 rounded-xl" /><div className="skeleton h-12 rounded-xl" /><div className="skeleton h-12 rounded-xl" /></div> : employees.length === 0 ? <p className="rounded-xl border border-task-border p-10 text-center text-soft-grey">No employees match the selected filters.</p> : <>
      {/* Desktop: one spreadsheet-like table across every branch; branch and department are columns and filters. */}
      {desktop ? <div className="-mx-4 overflow-x-auto border-y border-task-border sm:-mx-6">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-task-text-muted"><tr>{["Employee", ...(showFranchise ? ["Franchise"] : []), "Branch", "Department", "Designation", "Role", "Phone", "Status"].map((heading) => <th className="border-b border-task-border bg-task-muted px-3 py-2.5 font-semibold" key={heading} scope="col">{heading}</th>)}{hasAction ? <th className="sticky right-0 z-10 border-b border-task-border bg-task-muted px-3 py-2.5 text-right font-semibold" scope="col"><span className="sr-only">Actions</span></th> : null}</tr></thead>
          <tbody>{employees.map((employee) => <tr className="group hover:bg-gold/5" key={employee.id}>
            <td className="border-b border-task-border px-3 py-2"><div className="flex min-w-0 items-center gap-2.5"><span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-semibold text-on-gold">{initials(employee.employee_name)}</span><div className="min-w-0"><p className="truncate font-semibold text-task-text">{employee.employee_name}</p><p className="truncate text-xs text-task-text-muted">{employee.employee_code} · {employee.email}</p></div></div></td>
            {showFranchise ? <td className="border-b border-task-border px-3 py-2 text-task-text">{empty(franchiseLabel(employee))}</td> : null}
            <td className="border-b border-task-border px-3 py-2 text-task-text">{empty(branchNames.get(employee.branch_id))}</td>
            <td className="border-b border-task-border px-3 py-2 text-task-text">{empty(departmentNames.get(employee.department_id))}</td>
            <td className="border-b border-task-border px-3 py-2 text-task-text">{empty(designationNames.get(employee.designation_id ?? ""))}</td>
            <td className="border-b border-task-border px-3 py-2 text-xs font-semibold text-gold-secondary">{roleLabel(employee)}</td>
            <td className="whitespace-nowrap border-b border-task-border px-3 py-2 text-task-text tabular-nums">{empty(phoneOf(employee))}</td>
            <td className="border-b border-task-border px-3 py-2"><AccountStatus value={employee.account_status} /></td>
            {hasAction ? <td className="sticky right-0 border-b border-task-border bg-task-bg px-3 py-2 text-right group-hover:bg-task-muted"><Button aria-label={actionLabel(employee)} className="min-h-9 px-3" onClick={() => openEmployee(employee)} type="button" variant="secondary">{canEditEmployee ? <><Pencil className="size-4" />Edit</> : <><KeyRound className="size-4" />Section access</>}</Button></td> : null}
          </tr>)}</tbody>
        </table>
      </div> : null}
      {/* Phones and tablets: one compact row per person; tap to open what the account may edit. */}
      {desktop ? null : <ul className="-mx-4 divide-y divide-task-border border-y border-task-border sm:-mx-6">{employees.map((employee) => {
        const body = <><span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-semibold text-on-gold">{initials(employee.employee_name)}</span><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold text-task-text">{employee.employee_name}</span><AccountStatus value={employee.account_status} /></span><span className="block truncate text-xs text-task-text-muted">{designationNames.get(employee.designation_id ?? "") ?? "No designation"} · {roleLabel(employee)}</span><span className="block truncate text-xs text-task-text-muted">{showFranchise && franchiseLabel(employee) ? `${franchiseLabel(employee)} · ` : ""}{branchNames.get(employee.branch_id) ?? "Unassigned branch"} · {departmentNames.get(employee.department_id) ?? "Unassigned department"}</span></span></>;
        return <li key={employee.id}>{hasAction ? <button aria-label={actionLabel(employee)} className="flex min-h-16 w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-gold/5" onClick={() => openEmployee(employee)} type="button">{body}<Pencil aria-hidden className="size-4 shrink-0 text-gold-secondary" /></button> : <div className="flex min-h-16 items-center gap-3 px-3 py-2.5">{body}</div>}</li>;
      })}</ul>}
    </>}
    {inviting && profile ? <AddUserForm data={userManagementData} role={profile.user_role} onClose={() => setInviting(false)} onDone={load} /> : null}</section>;
}
