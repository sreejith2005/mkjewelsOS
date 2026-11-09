import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BRANCH_LOCATION_KINDS,
  BRANCH_LOCATION_KIND_LABELS,
  ORG_SCOPE_AUTHORITIES,
  ORG_SCOPE_AUTHORITY_LABELS,
  STORE_AUTHORITIES,
  isBranchLocationKind,
  isOrgScopeAuthority,
  type BranchLocationKind,
  type FranchiseModuleCoverage,
  type OrgAuditEntry,
  type OrgScopeAuthority,
} from "@jewelos/core";
import {
  assignBranchFranchise,
  grantScope,
  loadFranchiseAdmin,
  loadFranchiseHistory,
  loadFranchiseInsights,
  revokeScope,
  saveFranchise,
  type FranchiseAdminContext,
  type FranchiseBranch,
  type FranchiseGroup,
  type FranchiseReadiness,
} from "@jewelos/data/users/franchise";
import { Button, Field, Modal, Notice } from "@/components/ui";

type Person = Readonly<{ id: string; employee_name: string; account_status: string | null }>;
type Insights = Readonly<{ branchCounts: ReadonlyMap<string, number>; coverage: FranchiseModuleCoverage[] }>;
type Editor =
  | { kind: "franchise"; franchise: FranchiseGroup | null }
  | { kind: "branch"; branch: FranchiseBranch }
  | { kind: "grant" };

const RECORD_LABELS: Readonly<Record<string, string>> = {
  task_instances: "Tasks",
  task_templates: "Task templates",
  form_templates_shared: "Shared form templates",
  form_submissions: "Form submissions",
  fms_flows_shared: "Shared FMS workflows",
  fms_instances: "FMS runs",
  notifications: "Notifications",
  clients: "Clients (old CRM tables)",
};

const errorText = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

function FranchiseEditor({ franchise, onClose, onSaved }: { franchise: FranchiseGroup | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(franchise?.name ?? "");
  const [code, setCode] = useState(franchise?.code ?? "");
  const [city, setCity] = useState(franchise?.city ?? "");
  const [state, setState] = useState(franchise?.state ?? "");
  const [active, setActive] = useState(franchise?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !/^[A-Za-z0-9_-]{2,32}$/.test(code.trim())) return setError("Enter a name and a code of 2–32 letters, numbers, underscores, or hyphens.");
    setBusy(true); setError(null);
    try { await saveFranchise(franchise?.id ?? null, { name: name.trim(), code: code.trim(), city, state, is_active: active }); await onSaved(); onClose(); }
    catch (caught) { setError(errorText(caught, "Unable to save franchise.")); }
    finally { setBusy(false); }
  };
  return <Modal onClose={onClose} title={franchise ? "Edit franchise" : "Add franchise"}>
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Franchise name"><input className="field" maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} /></Field>
        <Field label="Franchise code"><input className="field" maxLength={32} onChange={(event) => setCode(event.target.value)} required value={code} /></Field>
        <Field label="City"><input className="field" onChange={(event) => setCity(event.target.value)} value={city} /></Field>
        <Field label="State"><input className="field" onChange={(event) => setState(event.target.value)} value={state} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-champagne"><input checked={active} className="accent-gold" onChange={(event) => setActive(event.target.checked)} type="checkbox" />Active</label>
      <div className="flex justify-end gap-2"><Button onClick={onClose} type="button" variant="secondary">Cancel</Button><Button disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</Button></div>
    </form>
  </Modal>;
}

function BranchAssignEditor({ branch, franchises, onClose, onSaved }: { branch: FranchiseBranch; franchises: readonly FranchiseGroup[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [franchiseId, setFranchiseId] = useState(branch.franchiseGroupId ?? "");
  const [kind, setKind] = useState<BranchLocationKind>(branch.locationKind);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moving = branch.franchiseGroupId !== null && franchiseId !== branch.franchiseGroupId;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!franchiseId && kind !== "exhibition") return setError("Choose a franchise.");
    if (moving && !window.confirm(`Move ${branch.name} to another franchise? Once franchise isolation is on, its people, tasks, forms and FMS history move with it.`)) return;
    setBusy(true); setError(null);
    try { await assignBranchFranchise(branch.id, franchiseId || null, kind, reason.trim()); await onSaved(); onClose(); }
    catch (caught) { setError(errorText(caught, "Unable to assign franchise.")); }
    finally { setBusy(false); }
  };
  return <Modal onClose={onClose} title={`Franchise for ${branch.name}`}>
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Franchise"><select className="field" onChange={(event) => setFranchiseId(event.target.value)} value={franchiseId}><option value="">{kind === "exhibition" ? "No franchise" : "Choose…"}</option>{franchises.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Location type"><select className="field" onChange={(event) => { if (isBranchLocationKind(event.target.value)) setKind(event.target.value); }} value={kind}>{BRANCH_LOCATION_KINDS.map((item) => <option key={item} value={item}>{BRANCH_LOCATION_KIND_LABELS[item]}</option>)}</select></Field>
      <Field label="Reason"><input className="field" onChange={(event) => setReason(event.target.value)} placeholder={moving ? "Required" : "Optional"} value={reason} /></Field>
      {kind === "exhibition" ? <p className="text-xs text-soft-grey">An exhibition is a temporary event location and needs no franchise. Its work reaches the people who do it; Super Admin sees everything.</p> : null}
      <div className="flex justify-end gap-2"><Button onClick={onClose} type="button" variant="secondary">Cancel</Button><Button disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</Button></div>
    </form>
  </Modal>;
}

function GrantEditor({ context, people, onClose, onSaved }: { context: FranchiseAdminContext; people: readonly Person[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [profileId, setProfileId] = useState("");
  const [authority, setAuthority] = useState<OrgScopeAuthority>("director");
  const [company, setCompany] = useState(false);
  const [franchiseId, setFranchiseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storeLevel = STORE_AUTHORITIES.includes(authority);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!profileId || !reason.trim()) return setError("Choose an employee and give a reason.");
    if (company && !window.confirm("Company scope lets this person see every franchise. Continue?")) return;
    setBusy(true); setError(null);
    try {
      await grantScope({ profileId, authority, company: !storeLevel && company, franchiseGroupId: !storeLevel && !company ? franchiseId || null : null, branchId: storeLevel ? branchId || null : null, reason: reason.trim() });
      await onSaved(); onClose();
    } catch (caught) { setError(errorText(caught, "Unable to grant scope.")); }
    finally { setBusy(false); }
  };
  return <Modal onClose={onClose} title="Add extra scope">
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Employee"><select className="field" onChange={(event) => setProfileId(event.target.value)} value={profileId}><option value="">Choose…</option>{people.filter((person) => person.account_status === "active").map((person) => <option key={person.id} value={person.id}>{person.employee_name}</option>)}</select></Field>
      <Field label="Authority"><select className="field" onChange={(event) => { if (isOrgScopeAuthority(event.target.value)) setAuthority(event.target.value); }} value={authority}>{ORG_SCOPE_AUTHORITIES.map((item) => <option key={item} value={item}>{ORG_SCOPE_AUTHORITY_LABELS[item]}</option>)}</select></Field>
      {storeLevel
        ? <Field label="Store"><select className="field" onChange={(event) => setBranchId(event.target.value)} value={branchId}><option value="">Choose…</option>{context.branches.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        : <>
          <label className="flex items-center gap-2 text-sm text-champagne"><input checked={company} className="accent-gold" onChange={(event) => setCompany(event.target.checked)} type="checkbox" />Whole company (every franchise)</label>
          {company ? null : <Field label="Franchise"><select className="field" onChange={(event) => setFranchiseId(event.target.value)} value={franchiseId}><option value="">Choose…</option>{context.franchises.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        </>}
      <Field label="Reason"><input className="field" onChange={(event) => setReason(event.target.value)} required value={reason} /></Field>
      <p className="text-xs text-soft-grey">Admin and HR already cover their own store&apos;s franchise automatically. Extra scope adds to that. What they can do still comes from their role and section access.</p>
      <div className="flex justify-end gap-2"><Button onClick={onClose} type="button" variant="secondary">Cancel</Button><Button disabled={busy} type="submit">{busy ? "Saving…" : "Grant"}</Button></div>
    </form>
  </Modal>;
}

/**
 * Super Admin only (franchise.manage): Company -> Franchise -> Store, with
 * employee counts, store managers, scope grants, readiness and history. The
 * Users page shows it when the Franchises button is pressed; it loads then.
 */
export function FranchiseManager({ people, onChanged }: { people: readonly Person[]; onChanged?: (() => Promise<void> | void) | undefined }) {
  const [state, setState] = useState<{ context: FranchiseAdminContext; readiness: FranchiseReadiness } | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [history, setHistory] = useState<OrgAuditEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    // History loads on its own: a slow history never hides the stores.
    setHistoryError(null);
    void loadFranchiseHistory().then(setHistory, (caught: unknown) => setHistoryError(errorText(caught, "Unable to load organisation history.")));
    try {
      const [admin, extra] = await Promise.all([loadFranchiseAdmin(), loadFranchiseInsights()]);
      setState(admin); setInsights(extra);
    } catch (caught) { setError(errorText(caught, "Unable to load franchises.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const saved = useCallback(async () => { await load(); await onChanged?.(); }, [load, onChanged]);
  const revoke = async (grantId: string, name: string) => {
    const reason = window.prompt(`Why are you removing this scope from ${name}?`);
    if (!reason?.trim()) return;
    try { await revokeScope(grantId, reason.trim()); await saved(); } catch (caught) { setError(errorText(caught, "Unable to revoke scope.")); }
  };
  const context = state?.context;
  const readiness = state?.readiness;
  const franchiseName = (id: string | null) => (id ? context?.franchises.find((item) => item.id === id)?.name ?? "Unknown franchise" : "Not mapped");
  const branchName = (id: string | null) => context?.branches.find((item) => item.id === id)?.name ?? "Unknown store";
  const personName = (id: string | null) => (id ? people.find((person) => person.id === id)?.employee_name ?? "Unknown" : null);
  const employeesIn = (branchIds: readonly string[]) => branchIds.reduce((sum, id) => sum + (insights?.branchCounts.get(id) ?? 0), 0);
  const groups = context ? [
    ...context.franchises.map((franchise) => ({ franchise, branches: context.branches.filter((branch) => branch.franchiseGroupId === franchise.id) })),
    ...(context.branches.some((branch) => !branch.franchiseGroupId) ? [{ franchise: null, branches: context.branches.filter((branch) => !branch.franchiseGroupId) }] : []),
  ] : [];
  return <section aria-label="Franchises" className="glass-card mb-4 rounded-xl p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-champagne">Franchises</h2><p className="text-xs text-soft-grey">Company → Franchise → Store → Department → Employee. Group stores into franchises and decide who covers which franchise or store.</p></div>
      <Button onClick={() => setEditor({ kind: "franchise", franchise: null })} type="button">Add franchise</Button>
    </div>
    <div className="mt-4 space-y-5">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!context || !readiness ? (error ? null : <p className="text-sm text-soft-grey">Loading…</p>) : <>
        <Notice tone="neutral">Franchise isolation: <strong>{context.enforcementEnabled ? "On" : "Off"}</strong>. {context.enforcementEnabled ? "People below company scope see only their franchise or stores." : "Everyone keeps today's access until isolation is switched on."}</Notice>

        <div>
          <h3 className="text-sm font-semibold text-champagne">Organisation</h3>
          <div className="mt-2 grid gap-2 xl:grid-cols-2">{groups.map(({ franchise, branches }) => {
            const active = branches.filter((branch) => branch.isActive);
            return <details className="rounded-lg border border-gold/15 p-3" key={franchise?.id ?? "unmapped"} open={groups.length <= 3}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <span className="min-w-0"><span className="block font-medium text-white">{franchise?.name ?? "Stores not mapped yet"}</span>
                  <span className="block text-xs text-soft-grey">{franchise ? `${franchise.code}${franchise.city ? ` · ${franchise.city}` : ""}${franchise.state ? `, ${franchise.state}` : ""} · ` : ""}{active.length} {active.length === 1 ? "store" : "stores"} · {employeesIn(active.map((branch) => branch.id))} employees{franchise && !franchise.is_active ? " · Inactive" : ""}</span></span>
                {franchise ? <Button aria-label={`Edit ${franchise.name}`} className="h-9 min-h-9 px-2" onClick={(event) => { event.preventDefault(); setEditor({ kind: "franchise", franchise }); }} type="button" variant="ghost">Edit</Button> : null}
              </summary>
              <ul className="mt-2 divide-y divide-gold/10">{branches.map((branch) => <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={branch.id}>
                <div className="min-w-0"><p className="text-sm text-white">{branch.name}{branch.isActive ? "" : " (inactive)"}</p>
                  <p className="text-xs text-soft-grey">{BRANCH_LOCATION_KIND_LABELS[branch.locationKind]} · {insights?.branchCounts.get(branch.id) ?? 0} employees · Manager: {personName(branch.managerId) ?? "not set"}</p></div>
                <Button aria-label={`Set franchise for ${branch.name}`} className="h-9 min-h-9 px-2" onClick={() => setEditor({ kind: "branch", branch })} type="button" variant="ghost">Set franchise</Button>
              </li>)}</ul>
              {branches.length === 0 ? <p className="mt-2 text-xs text-soft-grey">No stores yet. Use Set franchise on a store to add it here.</p> : null}
            </details>;
          })}</div>
          {context.franchises.length === 0 ? <p className="mt-2 text-sm text-soft-grey">No franchises yet. Add Mumbai and Ahmedabad, then set each store's franchise.</p> : null}
          <p className="mt-2 text-xs text-soft-grey">Change a store manager in Branches &amp; departments. A store manager covers their own store once isolation is on.</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-champagne">Scope</h3>
          <p className="mt-1 text-xs text-soft-grey">Worked out automatically from each person&apos;s store: Admin and HR cover every store of their store&apos;s franchise, a store&apos;s manager covers that store, and everyone else sees their own store. Changing someone&apos;s store or role in Users moves it at once.</p>
          <p className="mt-3 text-sm text-champagne">Automatic</p>
          <ul className="mt-1 divide-y divide-gold/10">{context.automaticScopes.map((item) => <li className="py-2" key={item.userProfileId}>
            <p className="text-sm text-white">{item.employeeName}</p><p className="text-xs text-soft-grey">{ORG_SCOPE_AUTHORITY_LABELS[item.authority]} · {franchiseName(item.franchiseGroupId)} (from {branchName(item.branchId)})</p>
          </li>)}</ul>
          {context.automaticScopes.length === 0 ? <p className="mt-1 text-sm text-soft-grey">Nobody yet. Admin and HR accounts appear here once their store is in a franchise.</p> : null}
          <div className="mt-3 flex items-center justify-between gap-2"><p className="text-sm text-champagne">Extra scope (optional)</p><Button onClick={() => setEditor({ kind: "grant" })} type="button" variant="secondary">Add extra scope</Button></div>
          <p className="text-xs text-soft-grey">Only for exceptions: the whole company, another franchise, or a Director who keeps the manager role.</p>
          <ul className="mt-2 divide-y divide-gold/10">{context.grants.map((grant) => <li className="flex items-center justify-between gap-2 py-2" key={grant.id}>
            <div><p className="text-sm text-white">{grant.employeeName}</p><p className="text-xs text-soft-grey">{ORG_SCOPE_AUTHORITY_LABELS[grant.authority]} · {grant.scopeLevel === "company" ? "Whole company" : grant.scopeLevel === "franchise" ? franchiseName(grant.franchiseGroupId) : branchName(grant.branchId)}</p></div>
            <Button aria-label={`Remove scope from ${grant.employeeName}`} className="h-9 min-h-9 px-2" onClick={() => void revoke(grant.id, grant.employeeName)} type="button" variant="ghost">Remove</Button>
          </li>)}</ul>
          {context.grants.length === 0 ? <p className="mt-2 text-sm text-soft-grey">No extra scope.</p> : null}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-champagne">Readiness</h3>
          <ul className="mt-2 space-y-1 text-sm text-soft-grey">
            <li>{readiness.mappingsComplete ? "Every active store has a franchise." : `Stores without a franchise: ${readiness.unmappedActiveBranches.map((item) => item.name).join(", ")}`}</li>
            {readiness.exhibitionLikeBranches.length ? <li>Exhibitions (no franchise needed): {readiness.exhibitionLikeBranches.map((item) => `${item.name} (${franchiseName(item.franchiseGroupId)})`).join(", ")}</li> : null}
            {readiness.leadersWithoutScope.length ? <li>Leaders who would see only their own store (their store has no franchise, or their role covers one store): {readiness.leadersWithoutScope.map((item) => item.employeeName).join(", ")}</li> : null}
            {Object.entries(readiness.recordsWithoutBranch).filter(([, value]) => value > 0).map(([key, value]) => <li key={key}>{RECORD_LABELS[key] ?? key} with no store: {value} (company scope only once isolation is on)</li>)}
            {readiness.usersDepartmentBranchMismatch ? <li>Employees whose department belongs to another store: {readiness.usersDepartmentBranchMismatch}</li> : null}
          </ul>
          {insights?.coverage.length ? <>
            <p className="mt-3 text-sm text-champagne">Sections that follow franchise scope</p>
            <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">{insights.coverage.map((item) => <li className="rounded-md border border-gold/10 px-2 py-1.5" key={item.module}>
              <span className={item.enforced ? "text-success" : "text-gold-secondary"}>{item.enforced ? "Ready" : "Not yet"}</span> · <span className="text-white">{item.label}</span>
              {item.pendingReason ? <span className="block text-xs text-soft-grey">{item.pendingReason}</span> : null}
            </li>)}</ul>
            {insights.coverage.some((item) => !item.enforced) ? <p className="mt-2 text-xs text-soft-grey">Isolation can be switched on only when every section is ready.</p> : null}
          </> : null}
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-semibold text-champagne">History</summary>
          <ul className="mt-2 divide-y divide-gold/10">{(history ?? []).map((entry) => <li className="flex flex-wrap justify-between gap-2 py-1.5 text-sm" key={entry.id}>
            <span className="text-white">{entry.label}</span><span className="text-xs text-soft-grey">{entry.actorName ?? "System"} · {new Date(entry.createdAt).toLocaleString()}</span>
          </li>)}</ul>
          {historyError ? <p className="mt-2 text-sm text-soft-grey">{historyError}</p> : null}
          {history && history.length === 0 ? <p className="mt-2 text-sm text-soft-grey">No organisation changes yet.</p> : null}
        </details>
      </>}
    </div>
    {editor?.kind === "franchise" ? <FranchiseEditor franchise={editor.franchise} onClose={() => setEditor(null)} onSaved={saved} /> : null}
    {editor?.kind === "branch" && context ? <BranchAssignEditor branch={editor.branch} franchises={context.franchises} onClose={() => setEditor(null)} onSaved={saved} /> : null}
    {editor?.kind === "grant" && context ? <GrantEditor context={context} onClose={() => setEditor(null)} onSaved={saved} people={people} /> : null}
  </section>;
}
