import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Clipboard, Filter, Pencil, Plus, Search, ShieldCheck, UserCog } from "lucide-react";
import { USER_ROLES, type Json, type UserRole } from "@jewelos/core";
import { supabase } from "@jewelos/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { errorMessage, initials, PHONE_PATTERN, titleCase } from "@/lib/format";
import type { Branch, Department, DropdownMaster, Resignation, UserProfile } from "@/types";

const WORKING_STATUSES = ["active", "inactive", "on_leave", "half_day", "resigned"] as const;
type WorkingStatus = (typeof WORKING_STATUSES)[number];

type LookupData = {
  branches: Branch[];
  departments: Department[];
  dropdowns: DropdownMaster[];
  profiles: UserProfile[];
  resignations: Resignation[];
};

type ProfileDraft = {
  employee_name: string;
  branch_id: string;
  department_id: string;
  designation_id: string;
  personal_mobile: string;
  official_mobile: string;
  email: string;
  week_off: string[];
  user_role: UserRole;
  employee_code: string;
  buddy_id: string;
  working_status: WorkingStatus;
};

type ResignationDraft = {
  resignation_date: string;
  last_working_date: string;
  resignation_reason_id: string;
  notice_period_served: string;
  handover_completed: string;
  handover_given_to: string;
  pending_tasks_reassigned: string;
  replacement_buddy_id: string;
  company_assets_returned: string;
  official_mobile_returned: string;
  email_access_remove_date: string;
  final_settlement_status: string;
  hr_remark: string;
};

const EMPTY_RESIGNATION: ResignationDraft = {
  resignation_date: "",
  last_working_date: "",
  resignation_reason_id: "",
  notice_period_served: "no",
  handover_completed: "no",
  handover_given_to: "",
  pending_tasks_reassigned: "no",
  replacement_buddy_id: "",
  company_assets_returned: "no",
  official_mobile_returned: "",
  email_access_remove_date: "",
  final_settlement_status: "",
  hr_remark: "",
};

function asDraft(profile: UserProfile): ProfileDraft {
  return {
    employee_name: profile.employee_name,
    branch_id: profile.branch_id,
    department_id: profile.department_id,
    designation_id: profile.designation_id ?? "",
    personal_mobile: profile.personal_mobile,
    official_mobile: profile.official_mobile ?? "",
    email: profile.email,
    week_off: profile.week_off,
    user_role: profile.user_role,
    employee_code: profile.employee_code,
    buddy_id: profile.buddy_id ?? "",
    working_status: profile.working_status,
  };
}

function profileChanges(draft: ProfileDraft): Json {
  return {
    employee_name: draft.employee_name.trim(),
    branch_id: draft.branch_id,
    department_id: draft.department_id,
    designation_id: draft.designation_id,
    personal_mobile: draft.personal_mobile.trim(),
    official_mobile: draft.official_mobile.trim(),
    week_off: draft.week_off,
    user_role: draft.user_role,
    employee_code: draft.employee_code.trim(),
    buddy_id: draft.buddy_id,
    working_status: draft.working_status,
  };
}

function resignationPayload(draft: ResignationDraft): Json {
  return {
    ...draft,
    notice_period_served: draft.notice_period_served === "yes",
    handover_completed: draft.handover_completed === "yes",
    pending_tasks_reassigned: draft.pending_tasks_reassigned === "yes",
    company_assets_returned: draft.company_assets_returned === "yes",
    official_mobile_returned:
      draft.official_mobile_returned === "" ? "" : draft.official_mobile_returned === "yes",
  };
}

function validateProfile(draft: ProfileDraft, resigning: boolean): string | null {
  if (!draft.employee_name.trim() || !draft.branch_id || !draft.department_id || !draft.employee_code.trim()) {
    return "Employee Name, Branch, Department, and Employee Code are required.";
  }
  if (!PHONE_PATTERN.test(draft.personal_mobile.trim())) return "Enter a valid personal mobile number.";
  if (draft.official_mobile.trim() && !PHONE_PATTERN.test(draft.official_mobile.trim())) {
    return "Enter a valid official mobile number or leave it blank.";
  }
  if (!resigning && draft.working_status === "active" && !draft.buddy_id) {
    return "Buddy is required when Working Status is Active.";
  }
  return null;
}

function YesNoSelect({ value, onChange, optional = false }: { value: string; onChange: (value: string) => void; optional?: boolean }) {
  return (
    <select className="field" onChange={(event) => onChange(event.target.value)} value={value}>
      {optional ? <option value="">Not specified</option> : null}
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  );
}

function WeekOffSelect({ items, value, onChange }: { items: DropdownMaster[]; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => {
        const selected = value.includes(item.value);
        return (
          <button
            className={`rounded-lg border px-2 py-2 text-xs ${selected ? "border-gold bg-gold text-obsidian" : "border-gold/20 bg-obsidian text-champagne"}`}
            key={item.id}
            onClick={() => onChange(selected ? value.filter((day) => day !== item.value) : [...value, item.value])}
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function ProfileEditor({
  data,
  profile,
  canChangeRole,
  onClose,
  onSaved,
}: {
  data: LookupData;
  profile: UserProfile;
  canChangeRole: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => asDraft(profile));
  const [resignation, setResignation] = useState<ResignationDraft>(EMPTY_RESIGNATION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resigning = draft.working_status === "resigned" && profile.working_status !== "resigned";
  const departments = data.departments.filter((item) => !item.branch_id || item.branch_id === draft.branch_id);
  const designations = data.dropdowns.filter((item) => item.master_type === "designation" && item.is_active !== false);
  const weekOffs = data.dropdowns.filter((item) => item.master_type === "week_off" && item.is_active !== false);
  const reasons = data.dropdowns.filter((item) => item.master_type === "resignation_reason" && item.is_active !== false);
  const buddies = data.profiles.filter((item) => item.id !== profile.id && item.working_status === "active");

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const setExit = <K extends keyof ResignationDraft>(key: K, value: ResignationDraft[K]) => {
    setResignation((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validateProfile(draft, resigning);
    if (validation) return setError(validation);
    if (resigning && (
      !resignation.resignation_date || !resignation.last_working_date ||
      !resignation.email_access_remove_date || !resignation.resignation_reason_id
    )) return setError("Complete the required resignation dates and reason.");

    setSaving(true);
    setError(null);
    try {
      const result = resigning
        ? await supabase.rpc("submit_resignation_with_audit", {
            p_profile_id: profile.id,
            p_profile_changes: profileChanges(draft),
            p_resignation: resignationPayload(resignation),
          })
        : await supabase.rpc("update_user_profile_with_audit", {
            p_profile_id: profile.id,
            p_changes: profileChanges(draft),
          });
      if (result.error) throw result.error;
      await onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title={`Edit ${profile.employee_name}`} wide>
      <form className="space-y-5" onSubmit={submit}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Employee Name"><input className="field" onChange={(e) => set("employee_name", e.target.value)} required value={draft.employee_name} /></Field>
          <Field label="Branch">
            <select className="field" onChange={(e) => { set("branch_id", e.target.value); set("department_id", ""); }} required value={draft.branch_id}>
              {data.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Department">
            <select className="field" onChange={(e) => set("department_id", e.target.value)} required value={draft.department_id}>
              <option value="">Select department</option>
              {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Designation">
            <select className="field" onChange={(e) => set("designation_id", e.target.value)} value={draft.designation_id}>
              <option value="">No designation</option>
              {designations.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Personal Mobile"><input className="field" onChange={(e) => set("personal_mobile", e.target.value)} required type="tel" value={draft.personal_mobile} /></Field>
          <Field label="Official Mobile"><input className="field" onChange={(e) => set("official_mobile", e.target.value)} type="tel" value={draft.official_mobile} /></Field>
          <Field label="Email"><input className="field" disabled readOnly type="email" value={draft.email} /></Field>
          <Field label="User Role">
            <select className="field" disabled={!canChangeRole} onChange={(e) => set("user_role", e.target.value as UserRole)} value={draft.user_role}>
              {USER_ROLES.map((role) => <option key={role} value={role}>{titleCase(role)}</option>)}
            </select>
          </Field>
          <Field label="Employee Code"><input className="field" onChange={(e) => set("employee_code", e.target.value)} required value={draft.employee_code} /></Field>
          <Field label="Buddy">
            <select className="field" onChange={(e) => set("buddy_id", e.target.value)} value={draft.buddy_id}>
              <option value="">No buddy</option>
              {buddies.map((item) => <option key={item.id} value={item.id}>{item.employee_name}</option>)}
            </select>
          </Field>
          <Field label="Working Status">
            <select className="field" onChange={(e) => set("working_status", e.target.value as WorkingStatus)} value={draft.working_status}>
              {WORKING_STATUSES.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <span className="label">Week Off</span>
            <WeekOffSelect items={weekOffs} onChange={(value) => set("week_off", value)} value={draft.week_off} />
          </div>
        </div>

        {resigning ? (
          <section className="rounded-xl border border-danger/30 bg-danger/5 p-4">
            <h3 className="mb-4 font-display text-2xl text-danger">Resignation details</h3>
            <p className="mb-4 text-xs text-soft-grey">Login remains enabled in the profile record until both approvals, although resigned accounts are blocked by the auth shell immediately.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Resignation Date"><input className="field" onChange={(e) => setExit("resignation_date", e.target.value)} required type="date" value={resignation.resignation_date} /></Field>
              <Field label="Last Working Date"><input className="field" onChange={(e) => setExit("last_working_date", e.target.value)} required type="date" value={resignation.last_working_date} /></Field>
              <Field label="Resignation Reason">
                <select className="field" onChange={(e) => setExit("resignation_reason_id", e.target.value)} required value={resignation.resignation_reason_id}>
                  <option value="">Select reason</option>
                  {reasons.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Notice Period Served"><YesNoSelect onChange={(value) => setExit("notice_period_served", value)} value={resignation.notice_period_served} /></Field>
              <Field label="Handover Completed"><YesNoSelect onChange={(value) => setExit("handover_completed", value)} value={resignation.handover_completed} /></Field>
              <Field label="Handover Given To">
                <select className="field" onChange={(e) => setExit("handover_given_to", e.target.value)} value={resignation.handover_given_to}>
                  <option value="">Select user</option>{buddies.map((item) => <option key={item.id} value={item.id}>{item.employee_name}</option>)}
                </select>
              </Field>
              <Field label="Pending Tasks Reassigned"><YesNoSelect onChange={(value) => setExit("pending_tasks_reassigned", value)} value={resignation.pending_tasks_reassigned} /></Field>
              <Field label="Replacement Buddy">
                <select className="field" onChange={(e) => setExit("replacement_buddy_id", e.target.value)} value={resignation.replacement_buddy_id}>
                  <option value="">Select user</option>{buddies.map((item) => <option key={item.id} value={item.id}>{item.employee_name}</option>)}
                </select>
              </Field>
              <Field label="Company Assets Returned"><YesNoSelect onChange={(value) => setExit("company_assets_returned", value)} value={resignation.company_assets_returned} /></Field>
              <Field label="Official Mobile Returned"><YesNoSelect onChange={(value) => setExit("official_mobile_returned", value)} optional value={resignation.official_mobile_returned} /></Field>
              <Field label="Email Access Remove Date"><input className="field" onChange={(e) => setExit("email_access_remove_date", e.target.value)} required type="date" value={resignation.email_access_remove_date} /></Field>
              <Field label="Final Settlement Status"><input className="field" onChange={(e) => setExit("final_settlement_status", e.target.value)} value={resignation.final_settlement_status} /></Field>
              <div className="sm:col-span-2 lg:col-span-3"><Field label="HR Remark"><textarea className="field min-h-24" onChange={(e) => setExit("hr_remark", e.target.value)} value={resignation.hr_remark} /></Field></div>
            </div>
          </section>
        ) : null}

        <div className="flex justify-end gap-3"><Button onClick={onClose} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Saving…" : "Save profile"}</Button></div>
      </form>
    </Modal>
  );
}

function InviteUser({ data, callerRole, onClose, onInvited }: { data: LookupData; callerRole: UserRole; onClose: () => void; onInvited: () => Promise<void> }) {
  const [form, setForm] = useState({
    email: "", employee_name: "", branch_id: "", department_id: "", designation_id: "",
    personal_mobile: "", official_mobile: "", week_off: [] as string[], user_role: "staff" as UserRole,
    employee_code: "", buddy_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const departments = data.departments.filter((item) => !item.branch_id || item.branch_id === form.branch_id);
  const designations = data.dropdowns.filter((item) => item.master_type === "designation" && item.is_active !== false);
  const weekOffs = data.dropdowns.filter((item) => item.master_type === "week_off" && item.is_active !== false);
  const buddies = data.profiles.filter((item) => item.working_status === "active");
  const roles = callerRole === "super_admin" ? USER_ROLES : USER_ROLES.filter((role) => role !== "super_admin");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!PHONE_PATTERN.test(form.personal_mobile.trim())) return setError("Enter a valid personal mobile number.");
    if (form.official_mobile.trim() && !PHONE_PATTERN.test(form.official_mobile.trim())) return setError("Enter a valid official mobile number.");
    if (!form.buddy_id) return setError("Buddy is required for a new active user.");
    setSaving(true); setError(null);
    const { data: response, error: invokeError } = await supabase.functions.invoke<{ temporary_password: string }>("invite-user", { body: form });
    if (invokeError || !response?.temporary_password) {
      setError(invokeError?.message ?? "The invite could not be completed.");
      setSaving(false);
      return;
    }
    setPassword(response.temporary_password);
    await onInvited();
    setSaving(false);
  };

  if (password) {
    return (
      <Modal onClose={onClose} title="Temporary password">
        <Notice tone="success">This password is shown only once. Copy it now and share it securely with the employee.</Notice>
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-gold/30 bg-obsidian p-3">
          <code className="min-w-0 flex-1 break-all text-gold">{password}</code>
          <Button aria-label="Copy temporary password" className="h-10 w-10 p-0" onClick={() => void navigator.clipboard.writeText(password)} variant="secondary"><Clipboard className="h-4 w-4" /></Button>
        </div>
        <Button className="mt-5 w-full" onClick={onClose}>I have copied it</Button>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Invite User" wide>
      <form className="space-y-5" onSubmit={submit}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Email"><input className="field" onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))} required type="email" value={form.email} /></Field>
          <Field label="Employee Name"><input className="field" onChange={(e) => setForm((v) => ({ ...v, employee_name: e.target.value }))} required value={form.employee_name} /></Field>
          <Field label="Employee Code"><input className="field" onChange={(e) => setForm((v) => ({ ...v, employee_code: e.target.value }))} required value={form.employee_code} /></Field>
          <Field label="Branch"><select className="field" onChange={(e) => setForm((v) => ({ ...v, branch_id: e.target.value, department_id: "" }))} required value={form.branch_id}><option value="">Select branch</option>{data.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Department"><select className="field" onChange={(e) => setForm((v) => ({ ...v, department_id: e.target.value }))} required value={form.department_id}><option value="">Select department</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Designation"><select className="field" onChange={(e) => setForm((v) => ({ ...v, designation_id: e.target.value }))} value={form.designation_id}><option value="">No designation</option>{designations.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
          <Field label="Personal Mobile"><input className="field" onChange={(e) => setForm((v) => ({ ...v, personal_mobile: e.target.value }))} required type="tel" value={form.personal_mobile} /></Field>
          <Field label="Official Mobile"><input className="field" onChange={(e) => setForm((v) => ({ ...v, official_mobile: e.target.value }))} type="tel" value={form.official_mobile} /></Field>
          <Field label="User Role"><select className="field" onChange={(e) => setForm((v) => ({ ...v, user_role: e.target.value as UserRole }))} value={form.user_role}>{roles.map((role) => <option key={role} value={role}>{titleCase(role)}</option>)}</select></Field>
          <Field label="Buddy"><select className="field" onChange={(e) => setForm((v) => ({ ...v, buddy_id: e.target.value }))} required value={form.buddy_id}><option value="">Select buddy</option>{buddies.map((item) => <option key={item.id} value={item.id}>{item.employee_name}</option>)}</select></Field>
          <div className="sm:col-span-2 lg:col-span-3"><span className="label">Week Off</span><WeekOffSelect items={weekOffs} onChange={(week_off) => setForm((v) => ({ ...v, week_off }))} value={form.week_off} /></div>
        </div>
        <div className="flex justify-end gap-3"><Button onClick={onClose} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Inviting…" : "Create user"}</Button></div>
      </form>
    </Modal>
  );
}

function ResignationDetail({ resignation, data, callerRole, onClose, onReviewed }: { resignation: Resignation; data: LookupData; callerRole: UserRole; onClose: () => void; onReviewed: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: string | null) => data.profiles.find((item) => item.id === id)?.employee_name ?? "—";
  const reason = data.dropdowns.find((item) => item.id === resignation.resignation_reason_id)?.label ?? "—";
  const details = [
    ["Resignation date", resignation.resignation_date], ["Last working date", resignation.last_working_date],
    ["Reason", reason], ["Notice served", resignation.notice_period_served ? "Yes" : "No"],
    ["Handover completed", resignation.handover_completed ? "Yes" : "No"], ["Handover given to", nameOf(resignation.handover_given_to)],
    ["Pending tasks reassigned", resignation.pending_tasks_reassigned ? "Yes" : "No"], ["Replacement buddy", nameOf(resignation.replacement_buddy_id)],
    ["Assets returned", resignation.company_assets_returned ? "Yes" : "No"], ["Official mobile returned", resignation.official_mobile_returned == null ? "Not specified" : resignation.official_mobile_returned ? "Yes" : "No"],
    ["Email access removal", resignation.email_access_remove_date], ["Final settlement", resignation.final_settlement_status ?? "—"],
    ["HR remark", resignation.hr_remark ?? "—"], ["Manager approval", resignation.manager_approval_status ?? "pending"],
    ["Super admin approval", resignation.super_admin_approval_status ?? "pending"],
  ] as const;
  const canReview = (callerRole === "manager" && resignation.manager_approval_status === "pending") || (callerRole === "super_admin" && resignation.super_admin_approval_status === "pending");
  const review = async (decision: "approved" | "rejected") => {
    setSaving(true); setError(null);
    const { error: reviewError } = await supabase.rpc("review_resignation_with_audit", { p_resignation_id: resignation.id, p_decision: decision });
    if (reviewError) setError(reviewError.message);
    else { await onReviewed(); onClose(); }
    setSaving(false);
  };
  return (
    <Modal onClose={onClose} title="Resignation detail">
      {error ? <div className="mb-4"><Notice tone="danger">{error}</Notice></div> : null}
      <dl className="divide-y divide-gold/10">{details.map(([label, value]) => <div className="grid grid-cols-2 gap-4 py-2.5 text-sm" key={label}><dt className="text-soft-grey">{label}</dt><dd className="text-right capitalize text-champagne">{value}</dd></div>)}</dl>
      {canReview ? <div className="mt-5 flex gap-3"><Button className="flex-1" disabled={saving} onClick={() => void review("approved")}><Check className="h-4 w-4" />Approve</Button><Button className="flex-1" disabled={saving} onClick={() => void review("rejected")} variant="danger">Reject</Button></div> : null}
    </Modal>
  );
}

const EMPTY_DATA: LookupData = { branches: [], departments: [], dropdowns: [], profiles: [], resignations: [] };

export function UserManagementPage() {
  const { profile: caller } = useAuth();
  const [data, setData] = useState<LookupData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [branch, setBranch] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [inviting, setInviting] = useState(false);
  const [viewingExit, setViewingExit] = useState<Resignation | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [profiles, branches, departments, dropdowns, resignations] = await Promise.all([
      supabase.from("user_profiles").select("*").order("employee_name"),
      supabase.from("branches").select("*").order("name"),
      supabase.from("departments").select("*").order("name"),
      supabase.from("dropdown_masters").select("*").order("master_type").order("sort_order"),
      supabase.from("resignations").select("*").order("created_at", { ascending: false }),
    ]);
    const firstError = [profiles.error, branches.error, departments.error, dropdowns.error, resignations.error].find(Boolean);
    if (firstError) setError(firstError.message);
    else setData({
      profiles: profiles.data ?? [],
      branches: branches.data ?? [],
      departments: departments.data ?? [],
      dropdowns: dropdowns.data ?? [],
      resignations: resignations.data ?? [],
    });
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const latestExit = useMemo(() => {
    const map = new Map<string, Resignation>();
    for (const item of data.resignations) if (!map.has(item.user_profile_id)) map.set(item.user_profile_id, item);
    return map;
  }, [data.resignations]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.profiles.filter((item) =>
      (!needle || item.employee_name.toLowerCase().includes(needle) || item.employee_code.toLowerCase().includes(needle)) &&
      (!role || item.user_role === role) && (!branch || item.branch_id === branch) &&
      (!department || item.department_id === department) && (!status || item.working_status === status));
  }, [branch, data.profiles, department, role, search, status]);
  if (!caller) return null;
  const canEdit = caller.user_role === "super_admin" || caller.user_role === "admin";

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-gold p-2.5 text-obsidian"><UserCog className="h-5 w-5" /></span><div><h1 className="font-display text-3xl text-gold">User Management</h1><p className="text-sm text-soft-grey">{data.profiles.length} profiles visible under RLS</p></div></div>
        {canEdit ? <Button onClick={() => setInviting(true)}><Plus className="h-4 w-4" />Invite User</Button> : null}
      </header>
      {error ? <div className="mb-5"><Notice tone="danger">{error}</Notice></div> : null}
      <div className="glass-card mb-5 grid gap-3 rounded-xl p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="relative sm:col-span-2 lg:col-span-1"><Search className="absolute left-3 top-3 h-4 w-4 text-soft-grey" /><input aria-label="Search users" className="field pl-9" onChange={(e) => setSearch(e.target.value)} placeholder="Name or code" value={search} /></label>
        <select aria-label="Filter by role" className="field" onChange={(e) => setRole(e.target.value)} value={role}><option value="">All roles</option>{USER_ROLES.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select>
        <select aria-label="Filter by branch" className="field" onChange={(e) => setBranch(e.target.value)} value={branch}><option value="">All branches</option>{data.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="Filter by department" className="field" onChange={(e) => setDepartment(e.target.value)} value={department}><option value="">All departments</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="Filter by working status" className="field" onChange={(e) => setStatus(e.target.value)} value={status}><option value="">All statuses</option>{WORKING_STATUSES.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select>
      </div>
      <div className="mb-3 flex items-center gap-2 text-xs text-soft-grey"><Filter className="h-3.5 w-3.5" />Showing {filtered.length} users</div>
      {loading ? <p className="py-10 text-center text-gold">Loading users…</p> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((item) => {
            const branchName = data.branches.find((entry) => entry.id === item.branch_id)?.name ?? "Unknown branch";
            const departmentName = data.departments.find((entry) => entry.id === item.department_id)?.name ?? "Unknown department";
            const exit = latestExit.get(item.id);
            return (
              <article className="glass-card flex gap-4 rounded-xl p-4" key={item.id}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gold font-bold text-obsidian">{initials(item.employee_name)}</span>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-semibold text-white">{item.employee_name}</h2><span className="rounded bg-gold/10 px-2 py-0.5 text-[10px] uppercase text-gold">{titleCase(item.user_role)}</span></div><p className="mt-1 text-xs text-soft-grey">{item.employee_code} · {branchName} · {departmentName}</p><p className={`mt-2 text-xs uppercase ${item.working_status === "resigned" ? "text-danger" : "text-success"}`}>{titleCase(item.working_status)}</p>{exit ? <Button className="mt-2 h-8 min-h-8 px-2 text-xs" onClick={() => setViewingExit(exit)} variant="ghost"><ShieldCheck className="h-3.5 w-3.5" />Resignation detail</Button> : null}</div>
                {canEdit ? <Button aria-label={`Edit ${item.employee_name}`} className="h-9 w-9 shrink-0 p-0" onClick={() => setEditing(item)} variant="secondary"><Pencil className="h-4 w-4" /></Button> : null}
              </article>
            );
          })}
        </div>
      )}
      {editing ? <ProfileEditor canChangeRole={caller.user_role === "super_admin"} data={data} onClose={() => setEditing(null)} onSaved={load} profile={editing} /> : null}
      {inviting ? <InviteUser callerRole={caller.user_role} data={data} onClose={() => setInviting(false)} onInvited={load} /> : null}
      {viewingExit ? <ResignationDetail callerRole={caller.user_role} data={data} onClose={() => setViewingExit(null)} onReviewed={load} resignation={viewingExit} /> : null}
    </section>
  );
}
