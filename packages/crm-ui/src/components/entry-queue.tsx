"use client";

import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { lookupClientByPhone } from "@/lib/client-phone-lookup";
import { PhoneNumberInput } from "@/components/phone-number-input";
import { composePhone, DEFAULT_COUNTRY_CODE, formatPhone, phoneError } from "@/lib/phone";
import { normalizeRosterValue } from "@/lib/roster";
import { createClient } from "@/lib/supabase/client";

type Item = { id: string; token: string; client_name: string; mobile: string; assigned_crm_name: string | null; status: string; created_at: string; client_id: string | null; client_is_new?: boolean; branch_id?: string };
type Branch = { id: string; name: string };
/** One person on a branch's CRM roster (JewelOS Users, CRM department) and whether they are in today. */
export type RosterPerson = { crm_name: string; available: boolean };
/** Why CRM-department people may be missing from the roster (managers only), from get_walkin_roster_health. */
export type RosterHealth = { crm_department_people: number; on_roster: number; not_on_roster: { outcome: string; reason: string; count: number }[]; last_staff_sync_at: string | null; master_snapshot_at: string | null } | null;
export type BranchSetup = { source: "dropdown_master" | "crm_branches" | "unknown"; issues: { label: string; reason: string }[] };

type Registered = Item & { client_type?: string; client_code?: string };
/** crm-port: a linked Form Builder queue form replaces the name and mobile inputs (CRM Form Settings, 2026-11-03). */
export type QueueRegistrationSlot = (context: { branch: string; branchSelect: ReactNode; onRegistered: (saved: Registered) => void }) => ReactNode;

/** The last queue the person opened, so the CRM tab reopens it (per browser; the server still decides access). */
export const QUEUE_SELECTION_KEY = "jewelos.crm.queue.selection";

const ROSTER_REASONS: Record<string, string> = {
  unmapped_branch: "their JewelOS branch has no CRM branch",
  not_eligible: "CRM login or CRM permission is off in JewelOS Users",
  deleted: "removed from JewelOS Users",
  needs_link: "an older CRM user has the same email and needs linking",
  email_conflict: "another CRM user has the same email",
  crm_user_in_use: "their CRM user belongs to someone else",
  invalid_snapshot: "their name or email in JewelOS Users is incomplete",
};

function readStoredSelection(): { branch?: string; crm?: string } {
  try { const value: unknown = JSON.parse(window.localStorage.getItem(QUEUE_SELECTION_KEY) ?? "{}"); return value && typeof value === "object" ? value as { branch?: string; crm?: string } : {}; } catch { return {}; }
}

export function EntryQueue({ profile, selectedBranchId, selectedCrm, branches, crms, queueCrms, initialItems, completedName, paging, registration, rosterByBranch, requestedBranch, rosterHealth }: {
  profile: { role: string; branchId: string | null }; selectedBranchId: string; selectedCrm: string; branches: Branch[];
  /** CRM people present today in the selected branch (legacy prop, used when rosterByBranch is absent). */
  crms: string[]; queueCrms: string[]; initialItems: Item[]; completedName?: string; paging?: { page: number; total: number; tab: "active" | "recent" }; registration?: QueueRegistrationSlot | undefined;
  /** Every choosable branch's roster, so CRM NAME follows the BRANCH choice at once. */
  rosterByBranch?: Record<string, RosterPerson[]> | undefined;
  /** The branch in the address, if any; without one the last opened queue is restored. */
  requestedBranch?: string | undefined;
  /** Branch-list source and issues (supabase-crm 20261104000300); kept for the page contract, not shown on the queue (owner 2026-11-05). */
  branchSetup?: BranchSetup | undefined; rosterHealth?: RosterHealth | undefined;
}) {
  const router = useRouter(); const queueRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(""); const [mobile, setMobile] = useState(""); const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE); const [branch, setBranch] = useState(selectedBranchId); const [queueCrm, setQueueCrm] = useState(selectedCrm); const [queueTab, setQueueTab] = useState<"active" | "recent">(paging?.tab ?? "active"); const [message, setMessage] = useState(""); const [autoFilled, setAutoFilled] = useState(false); const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<Registered | null>(null);
  const manager = profile.role === "super_admin" || profile.role === "branch_manager";
  useEffect(() => { if (paging) setQueueTab(paging.tab); }, [paging?.tab]);
  function queueHref(tab: string, page = 1, branchId = selectedBranchId, crmName = selectedCrm) { const params = new URLSearchParams(); if (branchId) params.set("branch", branchId); if (crmName) params.set("crm", crmName); if (tab === "recent") params.set("tab", tab); if (page > 1) params.set("page", String(page)); return `/queue${params.size ? `?${params}` : ""}`; }
  function changeTab(tab: "active" | "recent") { setQueueTab(tab); if (paging) router.push(queueHref(tab)); }
  useEffect(() => { setBranch(selectedBranchId); setQueueCrm(selectedCrm); }, [selectedBranchId, selectedCrm]);
  // Remember the opened queue; reopen it when CRM is opened without one in the address.
  useEffect(() => {
    if (!selectedBranchId) return;
    try { window.localStorage.setItem(QUEUE_SELECTION_KEY, JSON.stringify({ branch: selectedBranchId, crm: selectedCrm })); } catch { /* storage unavailable: nothing to remember */ }
  }, [selectedBranchId, selectedCrm]);
  useEffect(() => {
    if (requestedBranch || profile.role !== "super_admin") return;
    const stored = readStoredSelection();
    if (stored.branch && stored.branch !== selectedBranchId && branches.some((item) => item.id === stored.branch)) router.replace(queueHref(queueTab, 1, stored.branch, typeof stored.crm === "string" ? stored.crm : ""));
    // Only on arrival: later choices go through LOAD QUEUE.
  }, []);
  const [committedItems, setCommittedItems] = useState<Item[]>([]);
  useEffect(() => {
    const acknowledged = new Set(initialItems.map((item) => item.id));
    setCommittedItems((items) => {
      const pending = items.filter((item) => !acknowledged.has(item.id));
      return pending.length === items.length ? items : pending;
    });
  }, [initialItems]);
  useEffect(() => { if (phoneError(countryCode, mobile)) return; const timer = window.setTimeout(() => { void lookupClientByPhone(composePhone(countryCode, mobile)).then((client) => { if (!client) { setAutoFilled(false); return; } setName(client.primary_name); setAutoFilled(true); }); }, 350); return () => window.clearTimeout(timer); }, [countryCode, mobile]);
  function openQueue() { if (typeof queueRef.current?.scrollIntoView === "function") queueRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const phoneProblem = phoneError(countryCode, mobile);
    if (!name.trim() || phoneProblem || !branch) { setMessage(phoneProblem ?? "Name and branch are required."); return; }
    setSaving(true);
    try {
      const { data, error } = await createClient().rpc("register_walkin_entry", { p_client_name: name, p_mobile: composePhone(countryCode, mobile), p_branch_id: branch });
      const saved = data?.[0];
      if (error || !saved) { setMessage("Could not register the queue entry. Check the selected branch."); return; }
      afterRegistered(saved);
    } catch {
      setMessage("Could not confirm registration. Refresh the queue before retrying.");
    } finally { setSaving(false); }
  }
  function afterRegistered(saved: Registered) {
    // Same person, same branch, same business day: the server returned the pending entry instead of a new one.
    if (saved.client_type === "pending_duplicate") { setDuplicate(saved); setMessage(""); return; }
    setDuplicate(null);
    // This is the row acknowledged by the audited transaction, never an optimistic record.
    setCommittedItems((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
    setMessage(saved.client_type === "existing" ? `Existing client added to the CRM queue. Client ID: ${saved.client_code}.` : `Client registered. Client ID: ${saved.client_code}.`);
    setQueueTab("active");
    if (branch !== selectedBranchId || (paging && (paging.tab !== "active" || paging.page > 1))) router.push(queueHref("active", 1, branch));
    else router.refresh();
    window.setTimeout(openQueue, 0);
  }
  function loadQueue() { router.push(queueHref(queueTab, 1, branch, branch === selectedBranchId ? queueCrm : (rosterFor(branch).some((person) => normalizeRosterValue(person.crm_name) === normalizeRosterValue(queueCrm)) ? queueCrm : ""))); window.setTimeout(openQueue, 0); }
  function rosterFor(branchId: string): RosterPerson[] {
    if (rosterByBranch) return rosterByBranch[branchId] ?? [];
    // Before the roster-by-branch reader is deployed: the selected branch's roster only.
    return branchId === selectedBranchId ? queueCrms.map((crm_name) => ({ crm_name, available: crms.includes(crm_name) })) : [];
  }
  const toolbarRoster = useMemo(() => rosterFor(branch), [branch, rosterByBranch, queueCrms, crms, selectedBranchId]);
  const presentToday = useMemo(() => rosterFor(selectedBranchId).filter((person) => person.available).map((person) => normalizeRosterValue(person.crm_name)), [selectedBranchId, rosterByBranch, queueCrms, crms]);
  const acknowledgedIds = new Set(initialItems.map((item) => item.id));
  const items = [...committedItems.filter((item) => !acknowledgedIds.has(item.id)
    && item.branch_id === (selectedBranchId || branch)
    && (!selectedCrm || item.assigned_crm_name === selectedCrm)), ...initialItems];
  const visibleItems = items.filter((item) => queueTab === "active" ? item.status !== "complete" : item.status === "complete");
  const choosableBranches = branches.filter((item) => profile.role === "super_admin" || item.id === profile.branchId);
  const branchSelect = (id: string, onChange: (value: string) => void, label: string) => <label className="block text-sm"><span>{label}</span><select aria-label={label} title={profile.role === "super_admin" ? "Choose branch" : "Your assigned branch"} className="mt-1 w-full rounded border border-stone-300 bg-white p-2" value={id} onChange={(event) => onChange(event.target.value)}>{!id ? <option value="">SELECT BRANCH</option> : null}{choosableBranches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>;
  const notOnRoster = rosterHealth?.not_on_roster.filter((row) => row.count > 0) ?? [];
  return <div className="space-y-5">
    {!choosableBranches.length ? <p role="alert" className="crm-notice crm-notice--error">No branch available. {manager ? "Add it in Dropdown Master > CRM Branches." : "Ask an administrator."}</p> : null}
    <section className="crm-flat-section" aria-labelledby="register-client-entry"><h2 id="register-client-entry" className="crm-flat-heading">Register client</h2>
      {duplicate ? <p role="alert" className="crm-notice mt-3">{duplicate.client_name || "This client"} is already waiting in the queue today (token {duplicate.token}). <Link href={`/visits/new?queue=${duplicate.id}`}>Open that entry</Link></p> : null}
      {registration ? <>{registration({ branch, branchSelect: branchSelect(branch, setBranch, "BRANCH"), onRegistered: afterRegistered })}{message ? <p role="status" className="mt-3 text-sm text-green-800">{message}</p> : null}</> : <form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-3">{branchSelect(branch, setBranch, "BRANCH")}<label className="block text-sm"><span>CLIENT NAME</span><input className={`mt-1 w-full rounded border p-2 ${autoFilled ? "border-amber-400 bg-amber-50" : "border-stone-300 bg-white"}`} value={name} onChange={(event) => { setName(event.target.value); setAutoFilled(false); }} />{autoFilled ? <small className="mt-1 block text-amber-800">Auto-filled from client history — editable</small> : null}</label><PhoneNumberInput label="MOBILE NUMBER" ariaLabel="Mobile Number" countryLabel="COUNTRY CODE *" countryCode={countryCode} number={mobile} onCountryCodeChange={(code) => { setCountryCode(code); setAutoFilled(false); }} onNumberChange={(value) => { setMobile(value); setAutoFilled(false); }} /><div className="flex flex-wrap items-end gap-3 md:col-span-3"><button disabled={saving} className="rounded bg-amber-800 px-4 py-2 font-medium text-white disabled:opacity-50">{saving ? "REGISTERING…" : "REGISTER CLIENT"}</button>{message ? <p role="status" className="text-sm text-green-800">{message}</p> : null}</div></form>}
    </section>
    <section ref={queueRef} className="crm-flat-section" aria-labelledby="crm-queue"><div><h2 id="crm-queue" className="crm-flat-heading">Queue</h2>
      {/* Always visible (owner request 2026-11-04): no Filters disclosure on the queue. */}
      <div className="crm-queue-toolbar mt-4" role="group" aria-label="Queue selection">
        <label>CRM NAME<select aria-label="CRM NAME" className="rounded border border-stone-300 bg-white p-2" value={queueCrm} onChange={(event) => setQueueCrm(event.target.value)}><option value="">ALL CRM</option>{toolbarRoster.map((person) => <option value={normalizeRosterValue(person.crm_name)} key={person.crm_name}>{normalizeRosterValue(person.crm_name)}{person.available ? "" : " (NOT AVAILABLE TODAY)"}</option>)}</select></label>
        {branchSelect(branch, setBranch, "BRANCH")}
        <button type="button" onClick={loadQueue} className="min-h-11 rounded bg-stone-800 px-4 py-2 text-sm font-medium text-white">LOAD QUEUE</button>
      </div>
      {branch && !toolbarRoster.length ? <p role="status" className="crm-notice mt-3">No CRM staff for this branch.{manager && notOnRoster.length ? ` ${notOnRoster.map((row) => `${row.count} missing: ${ROSTER_REASONS[row.reason] ?? (row.reason || row.outcome)}`).join("; ")}.` : ""}</p> : null}
      {presentToday.length ? <p className="crm-flat-meta mt-3">In today: {presentToday.join(", ")}</p> : branch && toolbarRoster.length ? <p className="crm-flat-meta mt-3">No CRM staff in today.</p> : null}
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => changeTab("active")} aria-pressed={queueTab === "active"} className={queueTab === "active" ? "rounded bg-amber-800 px-3 py-2 text-xs font-semibold text-white" : "rounded border px-3 py-2 text-xs font-semibold"}>Active queue</button><button type="button" onClick={() => changeTab("recent")} aria-pressed={queueTab === "recent"} className={queueTab === "recent" ? "rounded bg-amber-800 px-3 py-2 text-xs font-semibold text-white" : "rounded border px-3 py-2 text-xs font-semibold"}>Recently submitted</button></div>
      {completedName ? <p role="status" className="mt-3 text-sm font-medium text-green-800">Visit saved for {completedName}. It is under Recently submitted.</p> : null}</div>
      {visibleItems.length ? <div className="overflow-x-auto"><table className="crm-record-table w-full text-left text-sm"><thead className="bg-stone-50 text-stone-600"><tr><th className="p-4">ENTRY TIME</th><th className="p-4">CLIENT NAME</th><th className="p-4">MOBILE</th><th className="p-4">BRANCH</th><th className="p-4">CRM</th><th className="p-4">TYPE</th><th className="p-4">ACTION</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id} className="border-t"><td data-label="Entry time" className="p-4 font-medium">{new Date(item.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td data-label="Name" className="p-4">{item.client_name}</td><td data-label="Phone" className="p-4">{formatPhone(item.mobile)}</td><td data-label="Branch" className="p-4">{branches.find((itemBranch) => itemBranch.id === (item.branch_id ?? selectedBranchId))?.name ?? ""}</td><td data-label="CRM" className="p-4">{item.assigned_crm_name ?? "NA"}</td><td data-label="Type" className="p-4">{/* crm-port fix (owner 2026-10-05): registration always creates the client, so client_id alone always read EXISTING. */}{item.client_is_new || !item.client_id ? "NEW" : "EXISTING"}</td><td data-label="Action" className="p-4">{item.status === "complete" ? item.client_id ? <Link className="font-medium text-amber-800 underline" href={`/clients/${item.client_id}`}>Review client record</Link> : <span className="crm-status crm-status--done">Done</span> : <Link className="font-medium text-amber-800 underline" href={`/visits/new?queue=${item.id}`}>{item.client_id ? "MAKE WALK-IN ENTRY" : "ADD WALKIN ENTRY"}</Link>}</td></tr>)}</tbody></table></div> : <p className="crm-flat-empty">{selectedBranchId ? "No one is waiting." : "Choose a branch and press LOAD QUEUE."}</p>}
      {paging && <nav aria-label="Queue pages" className="flex flex-wrap gap-3 p-4 text-xs text-stone-600"><span>PAGE {paging.page} OF {Math.max(1, Math.ceil(paging.total / 50))} | {paging.total} ENTRIES</span>{paging.page > 1 && <Link className="rounded border px-3 py-1" href={queueHref(queueTab, paging.page - 1)}>PREVIOUS</Link>}{paging.page * 50 < paging.total && <Link className="rounded border px-3 py-1" href={queueHref(queueTab, paging.page + 1)}>NEXT</Link>}</nav>}
    </section>
  </div>;
}
