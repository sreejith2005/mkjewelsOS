import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Lock, RotateCcw, Save, Search } from "lucide-react";
import {
  DASHBOARD_AUTHORITIES,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  explainPermission,
  getPermissionDefinition,
  hasPermission,
  isConfigurablePermission,
  type AccessSubject,
  type DashboardAuthority,
  type PermissionDefinition,
  type PermissionEffect,
  type PermissionKey,
  type UserRole,
} from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { ErrorPanel, LoadingPanels, PageHeading, PageSurface, Panel } from "@/features/analytics/components";
import { titleCase } from "@/lib/format";
import {
  fetchPermissionAdminContext,
  fetchUserAccessBreakdown,
  saveDesignationPermissions,
  saveRolePermissions,
  saveUserAccess,
  type OverrideChanges,
  type PermissionAdminContext,
  type RolePermissionChanges,
  type UserAccessBreakdown,
} from "./api";

type CatalogItem = PermissionDefinition & { key: PermissionKey };
const CATALOG: readonly CatalogItem[] = PERMISSION_CATALOG;
const GROUPS = PERMISSION_CATEGORIES
  .map((category) => ({ category, items: CATALOG.filter((item) => item.category === category) }))
  .filter((group) => group.items.length > 0);

type Tab = "roles" | "designations" | "users";
type Feedback = { tone: "success" | "danger"; text: string } | null;

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : typeof cause === "object" && cause && "message" in cause && typeof cause.message === "string" ? cause.message : "The request failed.");
const isDefaultFor = (key: PermissionKey, role: UserRole) => (getPermissionDefinition(key)?.defaultRoles ?? []).includes(role);
const lockedReason = (item: CatalogItem) => (item.kind === "protected" ? "Super Admin authority only" : "Follows dashboard authority");

function Pill({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return <button aria-pressed={active} className={active ? "min-h-10 shrink-0 rounded-full bg-task-accent-soft px-4 text-sm font-semibold text-task-accent" : "min-h-10 shrink-0 rounded-full px-4 text-sm text-task-text-muted hover:bg-task-muted"} onClick={onClick} type="button">{children}</button>;
}

function Allowed({ value }: { value: boolean }) {
  return <span className={value ? "text-xs font-semibold text-success" : "text-xs font-semibold text-task-overdue"}>{value ? "Allowed" : "Denied"}</span>;
}

function EffectSelect({ label, value, onChange, disabled }: { label: string; value: PermissionEffect | null; onChange: (value: PermissionEffect | null) => void; disabled?: boolean }) {
  return <select aria-label={label} className="task-field w-auto min-w-28 py-1 text-xs" disabled={disabled} onChange={(event) => onChange(event.target.value === "grant" || event.target.value === "deny" ? event.target.value : null)} value={value ?? "inherit"}>
    <option value="inherit">Inherit</option>
    <option value="grant">Grant</option>
    <option value="deny">Deny</option>
  </select>;
}

function FeedbackNotice({ feedback }: { feedback: Feedback }) {
  return feedback ? <div className="mb-4"><Notice tone={feedback.tone}>{feedback.text}</Notice></div> : null;
}

function RolePermissionsTab({ context, onSaved }: { context: PermissionAdminContext; onSaved: () => Promise<void> }) {
  const [role, setRole] = useState<UserRole>(context.roles[0] ?? "staff");
  const [draft, setDraft] = useState<Partial<Record<PermissionKey, boolean | null>>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => { setDraft({}); setFeedback(null); }, [role]);
  const configured = context.rolePermissions[role] ?? {};
  const valueFor = (key: PermissionKey) => {
    const pending = draft[key];
    if (pending !== undefined) return pending ?? isDefaultFor(key, role);
    return configured[key] ?? isDefaultFor(key, role);
  };
  const isCustomised = (key: PermissionKey) => (draft[key] !== undefined ? draft[key] !== null : configured[key] !== undefined);
  const changes = Object.entries(draft).filter(([key, value]) => (configured[key as PermissionKey] ?? null) !== value);
  const save = async () => {
    setSaving(true); setFeedback(null);
    try {
      await saveRolePermissions(role, Object.fromEntries(changes) as RolePermissionChanges);
      setDraft({});
      await onSaved();
      setFeedback({ tone: "success", text: `${titleCase(role)} permissions saved. Affected users update on their next request.` });
    } catch (cause) { setFeedback({ tone: "danger", text: errorText(cause) }); } finally { setSaving(false); }
  };
  return <div className="flex flex-col gap-4">
    <div className="scroll-x no-scrollbar flex gap-2 pb-1" role="group" aria-label="Role">{context.roles.map((item) => <Pill active={item === role} key={item} onClick={() => setRole(item)}>{titleCase(item)}</Pill>)}</div>
    <FeedbackNotice feedback={feedback} />
    <p className="text-sm text-task-text-muted">These are the defaults for everyone whose effective role is <strong>{titleCase(role)}</strong> (their role, or their dashboard authority when one is set). Designation and user overrides still apply on top.</p>
    {GROUPS.map((group) => <Panel key={group.category} title={group.category}><ul className="-mx-4 -my-3 divide-y divide-task-border">{group.items.map((item) => <li className="flex items-start justify-between gap-3 px-4 py-3" key={item.key}>
      <div className="min-w-0"><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-task-text-muted">{item.description}</p></div>
      {isConfigurablePermission(item.key) ? <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] text-task-text-muted">{isCustomised(item.key) ? "Customised" : "Default"}</span>
        {isCustomised(item.key) ? <button aria-label={`Reset ${item.label} to default`} className="rounded p-1 text-task-text-muted hover:bg-task-muted" onClick={() => setDraft((current) => ({ ...current, [item.key]: null }))} type="button"><RotateCcw className="size-3.5" /></button> : null}
        <input aria-label={`${item.label} for ${titleCase(role)}`} checked={valueFor(item.key)} className="size-4 accent-gold" onChange={(event) => setDraft((current) => ({ ...current, [item.key]: event.target.checked }))} type="checkbox" />
      </div> : <span className="flex shrink-0 items-center gap-1.5 text-xs text-task-text-muted"><Lock className="size-3.5" />{lockedReason(item)} · <Allowed value={explainPermission({ role, dashboardAuthority: null }, item.key).effective} /></span>}
    </li>)}</ul></Panel>)}
    <div className="flex justify-end"><Button disabled={saving || changes.length === 0} onClick={() => void save()}><Save />{saving ? "Saving…" : `Save ${changes.length || ""} change${changes.length === 1 ? "" : "s"}`}</Button></div>
  </div>;
}

function DesignationPermissionsTab({ context, onSaved }: { context: PermissionAdminContext; onSaved: () => Promise<void> }) {
  const [designationId, setDesignationId] = useState(context.designations[0]?.id ?? "");
  const [draft, setDraft] = useState<Partial<Record<PermissionKey, PermissionEffect | null>>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => { setDraft({}); setFeedback(null); }, [designationId]);
  if (!context.designations.length) return <Notice>No active designations exist. Add them in Dropdown Master first.</Notice>;
  const saved = context.designationOverrides[designationId] ?? {};
  const valueFor = (key: PermissionKey) => (draft[key] !== undefined ? draft[key] ?? null : saved[key] ?? null);
  const changes = Object.entries(draft).filter(([key, value]) => (saved[key as PermissionKey] ?? null) !== value);
  const save = async () => {
    setSaving(true); setFeedback(null);
    try {
      await saveDesignationPermissions(designationId, Object.fromEntries(changes) as OverrideChanges);
      setDraft({});
      await onSaved();
      setFeedback({ tone: "success", text: "Designation permissions saved." });
    } catch (cause) { setFeedback({ tone: "danger", text: errorText(cause) }); } finally { setSaving(false); }
  };
  return <div className="flex flex-col gap-4">
    <label className="max-w-md"><span className="mb-1 block text-xs font-medium text-task-text-muted">Designation</span><select className="task-field" onChange={(event) => setDesignationId(event.target.value)} value={designationId}>{context.designations.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <FeedbackNotice feedback={feedback} />
    <p className="text-sm text-task-text-muted">Grant or deny a permission for everyone with this designation, whatever their role. A user override still wins.</p>
    {GROUPS.map((group) => {
      const items = group.items.filter((item) => isConfigurablePermission(item.key));
      return items.length ? <Panel key={group.category} title={group.category}><ul className="-mx-4 -my-3 divide-y divide-task-border">{items.map((item) => <li className="flex items-center justify-between gap-3 px-4 py-3" key={item.key}>
        <div className="min-w-0"><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-task-text-muted">{item.description}</p></div>
        <EffectSelect label={`${item.label} override`} onChange={(value) => setDraft((current) => ({ ...current, [item.key]: value }))} value={valueFor(item.key)} />
      </li>)}</ul></Panel> : null;
    })}
    <div className="flex justify-end"><Button disabled={saving || changes.length === 0} onClick={() => void save()}><Save />{saving ? "Saving…" : "Save designation"}</Button></div>
  </div>;
}

function UserPermissionsTab({ context, onSaved, selfId }: { context: PermissionAdminContext; onSaved: () => Promise<void>; selfId: string | undefined }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<UserAccessBreakdown | null>(null);
  const [authority, setAuthority] = useState<DashboardAuthority | null>(null);
  const [draft, setDraft] = useState<Partial<Record<PermissionKey, PermissionEffect | null>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return context.users.filter((user) => !needle || `${user.employeeName} ${user.employeeCode}`.toLowerCase().includes(needle)).slice(0, 60);
  }, [context.users, query]);
  const select = useCallback(async (id: string) => {
    setSelectedId(id); setLoading(true); setFeedback(null); setDraft({});
    try {
      const next = await fetchUserAccessBreakdown(id);
      setBreakdown(next); setAuthority(next.dashboardAuthority);
    } catch (cause) { setBreakdown(null); setFeedback({ tone: "danger", text: errorText(cause) }); } finally { setLoading(false); }
  }, []);
  const savedUser = useMemo(() => Object.fromEntries((breakdown?.rows ?? []).flatMap((row) => (row.user ? [[row.key, row.user]] : []))) as Partial<Record<PermissionKey, PermissionEffect>>, [breakdown]);
  const changes = Object.entries(draft).filter(([key, value]) => (savedUser[key as PermissionKey] ?? null) !== value);
  const authorityChanged = breakdown ? authority !== breakdown.dashboardAuthority : false;
  const isSelf = breakdown?.profileId === selfId;
  const activeDesignation = breakdown?.designationId && context.designations.some((item) => item.id === breakdown.designationId) ? breakdown.designationId : null;
  const subject: AccessSubject | null = breakdown ? {
    role: breakdown.baseRole,
    dashboardAuthority: authority,
    rolePermissions: context.rolePermissions,
    designationOverrides: activeDesignation ? context.designationOverrides[activeDesignation] ?? {} : {},
    userOverrides: Object.fromEntries(CATALOG.flatMap((item) => {
      const value = draft[item.key] !== undefined ? draft[item.key] ?? null : savedUser[item.key] ?? null;
      return value ? [[item.key, value]] : [];
    })),
  } : null;
  const save = async () => {
    if (!breakdown) return;
    setSaving(true); setFeedback(null);
    try {
      const next = await saveUserAccess(breakdown.profileId, authority, Object.fromEntries(changes) as OverrideChanges);
      setBreakdown(next); setAuthority(next.dashboardAuthority); setDraft({});
      await onSaved();
      setFeedback({ tone: "success", text: `${next.employeeName}'s access saved. It applies on their next request.` });
    } catch (cause) { setFeedback({ tone: "danger", text: errorText(cause) }); } finally { setSaving(false); }
  };
  return <div className="grid gap-4 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
    <Panel title="Users" description={`${context.users.length} people`}>
      <label className="relative mb-3 block"><Search className="absolute left-3 top-2.5 size-4 text-task-text-muted" /><input aria-label="Search users" className="task-field pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Name or employee code" value={query} /></label>
      <ul className="-mx-4 -mb-3 max-h-[60dvh] divide-y divide-task-border overflow-y-auto">{users.map((user) => <li key={user.id}><button aria-current={user.id === selectedId} className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-task-muted ${user.id === selectedId ? "bg-task-accent-soft" : ""}`} onClick={() => void select(user.id)} type="button">
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{user.employeeName}</span><span className="block truncate text-xs text-task-text-muted">{titleCase(user.role)}{user.dashboardAuthority ? ` · ${titleCase(user.dashboardAuthority)} authority` : ""}{user.employeeCode ? ` · ${user.employeeCode}` : ""}</span></span>
        {user.overrideCount ? <span className="shrink-0 rounded-full bg-task-muted px-2 py-0.5 text-[11px] text-task-text-muted">{user.overrideCount}</span> : null}
      </button></li>)}</ul>
    </Panel>
    <div className="min-w-0">
      <FeedbackNotice feedback={feedback} />
      {loading ? <LoadingPanels count={2} /> : !breakdown || !subject ? <Notice>Select a user to see and change their access.</Notice> : <div className="flex flex-col gap-4">
        <Panel title={breakdown.employeeName} description={`Role: ${titleCase(breakdown.baseRole)} · Designation: ${breakdown.designationLabel ?? "None"} · Effective role: ${titleCase(authority ?? breakdown.baseRole)}`}>
          {isSelf ? <div className="mb-3"><Notice>You cannot change your own access. Ask another Super Admin.</Notice></div> : null}
          <fieldset disabled={isSelf}><legend className="mb-2 text-xs font-medium text-task-text-muted">Dashboard authority</legend><div className="flex flex-wrap gap-2">
            {[null, ...DASHBOARD_AUTHORITIES].map((level) => <label className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${authority === level ? "border-task-accent bg-task-accent-soft" : "border-task-border"}`} key={level ?? "inherit"}>
              <input checked={authority === level} className="accent-gold" name="dashboard-authority" onChange={() => setAuthority(level)} type="radio" />
              {level ? titleCase(level) : `Inherit (${titleCase(breakdown.baseRole)})`}
            </label>)}
          </div></fieldset>
        </Panel>
        <div className="overflow-x-auto rounded-xl border border-task-border bg-task-bg">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-task-border text-xs text-task-text-muted"><tr><th className="px-4 py-2 font-medium">Permission</th><th className="px-3 py-2 font-medium">Role</th><th className="px-3 py-2 font-medium">Designation</th><th className="px-3 py-2 font-medium">User override</th><th className="px-3 py-2 font-medium">Effective</th></tr></thead>
            <tbody className="divide-y divide-task-border">{GROUPS.flatMap((group) => [
              <tr className="bg-task-muted" key={group.category}><td className="px-4 py-1.5 text-xs font-semibold" colSpan={5}>{group.category}</td></tr>,
              ...group.items.map((item) => {
                const explanation = explainPermission(subject, item.key);
                const serverEffective = breakdown.rows.find((row) => row.key === item.key)?.effective;
                const pending = serverEffective !== undefined && serverEffective !== explanation.effective;
                return <tr key={item.key}>
                  <td className="px-4 py-2"><span className="font-medium">{item.label}</span></td>
                  <td className="px-3 py-2"><Allowed value={explanation.roleDefault} /><span className="block text-[11px] text-task-text-muted">{explanation.decidedBy === "protected" || explanation.decidedBy === "authority" ? lockedReason(item) : `${titleCase(explanation.effectiveRole)}${explanation.roleConfigured ? " · customised" : ""}`}</span></td>
                  <td className="px-3 py-2 text-xs">{explanation.designation ? titleCase(explanation.designation) : <span className="text-task-text-muted">—</span>}</td>
                  <td className="px-3 py-2">{isConfigurablePermission(item.key) ? <EffectSelect disabled={isSelf} label={`${item.label} override for ${breakdown.employeeName}`} onChange={(value) => setDraft((current) => ({ ...current, [item.key]: value }))} value={explanation.user} /> : <Lock aria-label="Locked" className="size-3.5 text-task-text-muted" />}</td>
                  <td className="px-3 py-2"><Allowed value={explanation.effective} />{pending ? <span className="block text-[11px] text-task-text-muted">unsaved</span> : null}</td>
                </tr>;
              }),
            ])}</tbody>
          </table>
        </div>
        <div className="flex justify-end"><Button disabled={isSelf || saving || (changes.length === 0 && !authorityChanged)} onClick={() => void save()}><Save />{saving ? "Saving…" : "Save access"}</Button></div>
      </div>}
    </div>
  </div>;
}

export function PermissionManagementPage({ onBack }: { onBack: () => void }) {
  const { access, refreshAccess } = useAuth();
  const [tab, setTab] = useState<Tab>("roles");
  const [context, setContext] = useState<PermissionAdminContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setError(null);
    try { setContext(await fetchPermissionAdminContext()); } catch (cause) { setError(errorText(cause)); } finally { setLoading(false); }
  }, []);
  const afterSave = useCallback(async () => { await Promise.all([load(), refreshAccess()]); }, [load, refreshAccess]);
  useEffect(() => { void load(); }, [load]);
  if (!hasPermission(access, "permissions.manage")) return <PageSurface><Notice tone="danger">Permission management is available to Super Admins only.</Notice></PageSurface>;
  return <PageSurface>
    <PageHeading title="Permission management" description="Role defaults, designation and user overrides, and dashboard authority. Enforced by the database; every change is audited." actions={<Button onClick={onBack} variant="secondary"><ArrowLeft />Settings</Button>} />
    <div className="mb-5 flex gap-2" role="tablist" aria-label="Permission scope">
      <Pill active={tab === "roles"} onClick={() => setTab("roles")}>Roles</Pill>
      <Pill active={tab === "designations"} onClick={() => setTab("designations")}>Designations</Pill>
      <Pill active={tab === "users"} onClick={() => setTab("users")}>Users</Pill>
    </div>
    {loading ? <LoadingPanels count={3} /> : error && !context ? <ErrorPanel message={error} onRetry={() => void load()} /> : context ? (
      tab === "roles" ? <RolePermissionsTab context={context} onSaved={afterSave} />
        : tab === "designations" ? <DesignationPermissionsTab context={context} onSaved={afterSave} />
          : <UserPermissionsTab context={context} onSaved={afterSave} selfId={access?.profileId} />
    ) : null}
  </PageSurface>;
}
