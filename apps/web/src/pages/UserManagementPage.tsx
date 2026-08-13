import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Copy, KeyRound, MoreVertical, Network, Plus, Search, Trash2, UserCog } from "lucide-react";
import { USER_ROLES, type Json, type UserRole } from "@jewelos/core";
import { supabase } from "@jewelos/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { errorMessage, initials, PHONE_PATTERN, titleCase } from "@/lib/format";
import type { Branch, Department, DropdownMaster, UserProfile } from "@/types";

const ACCOUNT_STATUSES = ["active", "invited", "inactive", "suspended", "left"] as const;
type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
type Data = { profiles: UserProfile[]; branches: Branch[]; departments: Department[]; dropdowns: DropdownMaster[] };
const EMPTY: Data = { profiles: [], branches: [], dropdowns: [], departments: [] };
function eligibleBuddies(profiles: UserProfile[], departmentId: string, excludedId?: string) {
  return profiles.filter((profile) => profile.id !== excludedId
    && (profile.account_status === "active" || profile.account_status === "invited")
    && profile.department_id === departmentId);
}

function Status({ value }: { value: AccountStatus }) {
  const color = value === "active" ? "bg-success/15 text-success" : value === "suspended" ? "bg-danger/15 text-danger" : "bg-gold/10 text-gold";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${color}`}>{titleCase(value)}</span>;
}

function TemporaryPassword({ password, title, onClose }: { password: string; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(password); setCopied(true); };
  return <Modal onClose={onClose} title={title}><div className="space-y-4"><Notice tone="danger">This temporary password is displayed only now. Copy it and share it securely; JewelOS never stores or lists passwords.</Notice><div className="break-all rounded-lg border border-gold/30 bg-obsidian p-3 font-mono text-sm text-champagne">{password}</div><div className="flex justify-end gap-3"><Button onClick={() => void copy()} type="button" variant="secondary"><Copy className="h-4 w-4" />{copied ? "Copied" : "Copy password"}</Button><Button onClick={onClose} type="button">Done</Button></div></div></Modal>;
}

function EditUser({ user, data, superAdmin, onClose, onSaved }: { user: UserProfile; data: Data; superAdmin: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState({ employee_name: user.employee_name, employee_code: user.employee_code, branch_id: user.branch_id, department_id: user.department_id, designation_id: user.designation_id ?? "", buddy_id: user.buddy_id ?? "", reports_to_user_id: user.reports_to_user_id ?? "", account_status: user.account_status, user_role: user.user_role, personal_mobile: user.personal_mobile ?? "", official_mobile: user.official_mobile ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const activeProfiles = data.profiles.filter((profile) => profile.id !== user.id && profile.account_status === "active");
  const buddyProfiles = eligibleBuddies(data.profiles, draft.department_id, user.id);
  const departments = data.departments.filter((department) => !department.branch_id || department.branch_id === draft.branch_id);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.employee_name.trim() || !draft.employee_code.trim() || (draft.personal_mobile.trim() && !PHONE_PATTERN.test(draft.personal_mobile.trim()))) {
      setError("Name and employee code are required; provide a valid mobile number if one is entered.");
      return;
    }
    setSaving(true); setError(null);
    try {
      const { error: rpcError } = await supabase.rpc("update_user_profile_with_audit", { p_profile_id: user.id, p_changes: draft as Json });
      if (rpcError) throw rpcError;
      await onSaved(); onClose();
    } catch (caught) { setError(errorMessage(caught)); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!superAdmin || !window.confirm(`Permanently delete ${user.employee_name}? This only works for disabled or invited accounts with no linked work.`)) return;
    setSaving(true); setError(null);
    try {
      const { error: invokeError } = await supabase.functions.invoke("delete-user", { body: { profile_id: user.id } });
      if (invokeError) throw invokeError;
      await onSaved(); onClose();
    } catch (caught) { setError(errorMessage(caught)); } finally { setSaving(false); }
  };

  const resetPassword = async () => {
    if (!superAdmin || !window.confirm(`Reset ${user.employee_name}'s password? Their current password will stop working.`)) return;
    setSaving(true); setError(null);
    try {
      const { data: result, error: invokeError } = await supabase.functions.invoke<{ temporary_password?: string }>("reset-user-password", { body: { profile_id: user.id } });
      if (invokeError) throw invokeError;
      if (!result?.temporary_password) throw new Error("The password reset did not return a temporary password.");
      setTemporaryPassword(result.temporary_password);
    } catch (caught) { setError(errorMessage(caught)); } finally { setSaving(false); }
  };

  if (temporaryPassword) return <TemporaryPassword onClose={() => setTemporaryPassword(null)} password={temporaryPassword} title={`${user.employee_name}'s temporary password`} />;
  return <Modal onClose={onClose} title={`Edit ${user.employee_name}`} wide>
    <form className="space-y-5" onSubmit={submit}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Employee name"><input className="field" value={draft.employee_name} onChange={(event) => set("employee_name", event.target.value)} /></Field>
        <Field label="Employee code"><input className="field" value={draft.employee_code} onChange={(event) => set("employee_code", event.target.value)} /></Field>
        <Field label="Personal mobile"><input className="field" type="tel" value={draft.personal_mobile} onChange={(event) => set("personal_mobile", event.target.value)} /></Field>
        <Field label="Branch"><select className="field" value={draft.branch_id} onChange={(event) => { set("branch_id", event.target.value); set("department_id", ""); }}>{data.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Department"><select className="field" value={draft.department_id} onChange={(event) => set("department_id", event.target.value)}>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Designation"><select className="field" value={draft.designation_id} onChange={(event) => set("designation_id", event.target.value)}><option value="">None</option>{data.dropdowns.filter((item) => item.master_type === "designation" && item.is_active).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
        <Field label="Reports to"><select className="field" value={draft.reports_to_user_id} onChange={(event) => set("reports_to_user_id", event.target.value)}><option value="">No manager</option>{activeProfiles.map((item) => <option key={item.id} value={item.id}>{item.employee_name}</option>)}</select></Field>
        <Field label="Buddy"><select className="field" value={draft.buddy_id} onChange={(event) => set("buddy_id", event.target.value)}><option value="">No buddy</option>{buddyProfiles.map((item) => <option key={item.id} value={item.id}>{item.employee_name}</option>)}</select></Field>
        <Field label="Account status"><select className="field" value={draft.account_status} onChange={(event) => set("account_status", event.target.value as AccountStatus)}>{ACCOUNT_STATUSES.filter((status) => status !== "left").map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></Field>
        <Field label="System role"><select className="field" disabled={!superAdmin} value={draft.user_role} onChange={(event) => set("user_role", event.target.value as UserRole)}>{USER_ROLES.map((role) => <option key={role} value={role}>{titleCase(role)}</option>)}</select></Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">{superAdmin ? <Button disabled={saving} type="button" variant="secondary" onClick={() => void resetPassword()}><KeyRound className="h-4 w-4" />Reset password</Button> : null}{superAdmin ? <Button disabled={saving} type="button" variant="danger" onClick={remove}><Trash2 className="h-4 w-4" />Delete user</Button> : null}</div>
        <div className="flex gap-3"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={saving} type="submit">{saving ? "Saving..." : "Save user"}</Button></div>
      </div>
    </form>
  </Modal>;
}

function AddUserForm({ data, role, onClose, onDone }: { data: Data; role: UserRole; onClose: () => void; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", branch_id: "", personal_mobile: "", official_mobile: "", personal_email: "", official_email: "", department_id: "", designation_id: "", buddy_id: "", week_off: [] as string[], user_role: "staff" as UserRole });
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const departments = data.departments.filter((item) => !item.branch_id || item.branch_id === form.branch_id);
  const buddies = eligibleBuddies(data.profiles, form.department_id);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    if (!form.first_name.trim() || !form.personal_email.trim() || !form.branch_id || !form.department_id) { setError("First name, branch, personal email, and department are required."); return; }
    if ((form.personal_mobile && !PHONE_PATTERN.test(form.personal_mobile)) || (form.official_mobile && !PHONE_PATTERN.test(form.official_mobile))) { setError("Enter valid phone numbers or leave them blank."); return; }
    setSaving(true);
    try { const { data: result, error: invokeError } = await supabase.functions.invoke<{ temporary_password?: string; already_exists?: boolean }>("invite-user", { body: form }); if (invokeError) throw invokeError; await onDone(); if (result?.temporary_password) setTemporaryPassword(result.temporary_password); else if (result?.already_exists) setError("A user with this login email already exists."); else throw new Error("The account was created but no temporary password was returned."); } catch (caught) { setError(errorMessage(caught)); } finally { setSaving(false); }
  };
  if (temporaryPassword) return <TemporaryPassword onClose={onClose} password={temporaryPassword} title="New user's temporary password" />;
  return <Modal onClose={onClose} title="Add user" wide><form className="space-y-4" onSubmit={submit}>{error ? <Notice tone="danger">{error}</Notice> : null}<p className="text-sm text-soft-grey">Employee code is generated automatically. Personal email is the login address. Buddy choices are restricted to active users in the same branch, department, and designation at the same or lower hierarchy.</p><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="First name"><input className="field" required value={form.first_name} onChange={(event) => set("first_name", event.target.value)} /></Field><Field label="Last name"><input className="field" value={form.last_name} onChange={(event) => set("last_name", event.target.value)} /></Field><Field label="Branch"><select className="field" required value={form.branch_id} onChange={(event) => { set("branch_id", event.target.value); set("department_id", ""); set("buddy_id", ""); }}><option value="">Select</option>{data.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Personal phone number"><input className="field" type="tel" value={form.personal_mobile} onChange={(event) => set("personal_mobile", event.target.value)} /></Field><Field label="Official phone number"><input className="field" type="tel" value={form.official_mobile} onChange={(event) => set("official_mobile", event.target.value)} /></Field><Field label="Personal email"><input className="field" required type="email" value={form.personal_email} onChange={(event) => set("personal_email", event.target.value)} /></Field><Field label="Official email"><input className="field" type="email" value={form.official_email} onChange={(event) => set("official_email", event.target.value)} /></Field><Field label="Department"><select className="field" required value={form.department_id} onChange={(event) => { set("department_id", event.target.value); set("buddy_id", ""); }}><option value="">Select</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Designation"><select className="field" value={form.designation_id} onChange={(event) => { set("designation_id", event.target.value); set("buddy_id", ""); }}><option value="">None</option>{data.dropdowns.filter((item) => item.master_type === "designation" && item.is_active).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field><Field label="Buddy"><select className="field" disabled={!form.department_id} value={form.buddy_id} onChange={(event) => set("buddy_id", event.target.value)}><option value="">{form.department_id ? "No buddy" : "Choose a department first"}</option>{buddies.map((item) => <option key={item.id} value={item.id}>{item.employee_name}</option>)}</select></Field><Field label="System role"><select className="field" value={form.user_role} onChange={(event) => { set("user_role", event.target.value as UserRole); set("buddy_id", ""); }}>{(role === "super_admin" ? USER_ROLES : USER_ROLES.filter((item) => item !== "super_admin")).map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></Field></div><div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={saving} type="submit">{saving ? "Creatingâ€¦" : "Create user"}</Button></div></form></Modal>;
}

function Organization({ profiles }: { profiles: UserProfile[] }) {
  const byManager = useMemo(() => new Map<string, UserProfile[]>(profiles.reduce((map, profile) => { const key = profile.reports_to_user_id ?? "root"; map.set(key, [...(map.get(key) ?? []), profile]); return map; }, new Map<string, UserProfile[]>())), [profiles]);
  const Tree = ({ parent, depth = 0 }: { parent: string; depth?: number }) => <>{(byManager.get(parent) ?? []).map((user) => <div className="mt-3" key={user.id} style={{ marginLeft: `${depth * 20}px` }}><div className="glass-card flex items-center gap-3 rounded-xl p-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold font-semibold text-obsidian">{initials(user.employee_name)}</span><div className="min-w-0 flex-1"><p className="truncate font-semibold text-white">{user.employee_name}</p><p className="text-xs text-soft-grey">{titleCase(user.user_role)}</p></div><Status value={user.account_status} /></div><Tree parent={user.id} depth={depth + 1} /></div>)}</>;
  return <div className="rounded-xl border border-gold/15 p-4"><Tree parent="root" />{profiles.length > 0 && (byManager.get("root") ?? []).length === 0 ? <p className="text-soft-grey">No root profile is available in this filtered hierarchy.</p> : null}</div>;
}

export function UserManagementPage() {
  const { profile: caller } = useAuth(); const [data, setData] = useState<Data>(EMPTY); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [search, setSearch] = useState(""); const [status, setStatus] = useState(""); const [view, setView] = useState<"list" | "organization">("list"); const [editing, setEditing] = useState<UserProfile | null>(null); const [inviting, setInviting] = useState(false);
  const load = useCallback(async () => { setLoading(true); const [profiles, branches, departments, dropdowns] = await Promise.all([supabase.from("user_profiles").select("*").order("employee_name"), supabase.from("branches").select("*").order("name"), supabase.from("departments").select("*").order("name"), supabase.from("dropdown_masters").select("*").order("sort_order")]); const first = [profiles.error, branches.error, departments.error, dropdowns.error].find(Boolean); if (first) setError(first.message); else setData({ profiles: profiles.data ?? [], branches: branches.data ?? [], departments: departments.data ?? [], dropdowns: dropdowns.data ?? [] }); setLoading(false); }, []);
  useEffect(() => { void load(); }, [load]);
  const users = useMemo(() => data.profiles.filter((user) => (!search || `${user.employee_name} ${user.employee_code} ${user.email}`.toLowerCase().includes(search.toLowerCase())) && (!status || user.account_status === status)), [data.profiles, search, status]);
  if (!caller) return null;
  const canEdit = ["super_admin", "admin"].includes(caller.user_role);
  const InviteUser = AddUserForm;
  return <section><header className="mb-6 flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-gold p-2.5 text-obsidian"><UserCog className="h-5 w-5" /></span><div><h1 className="font-display text-3xl text-gold">Team</h1><p className="text-sm text-soft-grey">{users.length} authorized profiles Â· {users.filter((user) => user.account_status === "active").length} active</p></div></div>{canEdit ? <Button onClick={() => setInviting(true)}><Plus className="h-4 w-4" />Add user</Button> : null}</header>{error ? <Notice tone="danger">{error}</Notice> : null}<div className="glass-card mb-4 grid gap-3 rounded-xl p-4 sm:grid-cols-[1fr_180px_auto]"><label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-soft-grey" /><input className="field pl-9" aria-label="Search users" placeholder="Search name, code, or email" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select className="field" aria-label="Account status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{ACCOUNT_STATUSES.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select><div className="flex rounded-lg border border-gold/20 p-1"><Button className="h-8 min-h-8 px-3 text-xs" variant={view === "list" ? "primary" : "ghost"} onClick={() => setView("list")}>List</Button><Button className="h-8 min-h-8 px-3 text-xs" variant={view === "organization" ? "primary" : "ghost"} onClick={() => setView("organization")}><Network className="h-3.5 w-3.5" />Chart</Button></div></div>{loading ? <p className="py-12 text-center text-gold">Loading usersâ€¦</p> : view === "organization" ? <Organization profiles={users} /> : <div className="overflow-x-auto rounded-xl border border-gold/15"><table className="w-full min-w-[920px] text-left text-sm"><thead className="border-b border-gold/15 bg-charcoal text-xs uppercase text-soft-grey"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Mobile</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Reports to</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead><tbody>{users.map((user) => <tr className="border-b border-gold/10 last:border-0" key={user.id}><td className="px-4 py-3"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold font-semibold text-obsidian">{initials(user.employee_name)}</span><div><p className="font-semibold text-white">{user.employee_name}</p><p className="text-xs text-soft-grey">{user.employee_code}</p></div></div></td><td className="px-4 py-3 text-soft-grey">{user.personal_mobile ?? "â€”"}</td><td className="px-4 py-3 text-soft-grey">{user.email}</td><td className="px-4 py-3 text-soft-grey">{data.profiles.find((item) => item.id === user.reports_to_user_id)?.employee_name ?? "â€”"}</td><td className="px-4 py-3"><span className="rounded bg-gold/10 px-2 py-1 text-xs text-gold">{titleCase(user.user_role)}</span></td><td className="px-4 py-3"><Status value={user.account_status} /></td><td className="px-4 py-3">{canEdit ? <Button aria-label={`Edit ${user.employee_name}`} className="h-9 min-h-9 w-9 p-0" variant="ghost" onClick={() => setEditing(user)}><MoreVertical className="h-4 w-4" /></Button> : null}</td></tr>)}</tbody></table>{users.length === 0 ? <p className="p-10 text-center text-soft-grey">No users match this view.</p> : null}</div>}{editing ? <EditUser data={data} user={editing} superAdmin={caller.user_role === "super_admin"} onClose={() => setEditing(null)} onSaved={load} /> : null}{inviting ? <InviteUser data={data} role={caller.user_role} onClose={() => setInviting(false)} onDone={load} /> : null}</section>;
}
