"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

import { createClient } from "@/lib/supabase/client";

type Branch = { id: string; name: string };
type RosterItem = { id: string; crm_name: string; active: boolean; pending_count: number };

export function AllocationManager({ role, branchId, branches, roster, unavailableNames, date }: { role: string; branchId: string; branches: Branch[]; roster: RosterItem[]; unavailableNames: string[]; date: string }) {
  const router = useRouter();
  const canWrite = role === "super_admin" || role === "branch_manager";
  const [crmName, setCrmName] = useState("");
  const [editing, setEditing] = useState<RosterItem | null>(null);
  const [targetBranchId, setTargetBranchId] = useState(branchId);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const unavailable = new Set(unavailableNames);

  function refresh() { router.refresh(); }
  function resetEdit(message = "") { setEditing(null); setCrmName(""); setTargetBranchId(branchId); setMessage(message); }

  async function saveRoster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!crmName.trim()) { setMessage("PLEASE ENTER CRM NAME."); return; }
    setSaving("roster"); setMessage("");
    const { error } = await createClient().rpc("manage_crm_roster", {
      p_operation: editing ? "UPDATE" : "ADD",
      p_roster_id: editing?.id ?? null,
      p_branch_id: editing ? branchId : targetBranchId,
      p_target_branch_id: editing ? targetBranchId : null,
      p_crm_name: crmName,
    });
    setSaving(null);
    if (error) { setMessage("Could not save this roster entry. Check your branch access and whether the name already exists."); return; }
    resetEdit(editing ? "CRM / BRANCH UPDATED SUCCESSFULLY." : "CRM / BRANCH ADDED SUCCESSFULLY."); refresh();
  }

  async function deleteRoster(item: RosterItem) {
    if (!window.confirm(`DELETE CRM "${item.crm_name}" FROM BRANCH "${branches.find((branch) => branch.id === branchId)?.name ?? branchId}"?`)) return;
    setSaving(item.id); setMessage("");
    const { error } = await createClient().rpc("manage_crm_roster", { p_operation: "DELETE", p_roster_id: item.id });
    setSaving(null);
    if (error) { setMessage("Could not delete this roster entry."); return; }
    resetEdit("CRM DELETED SUCCESSFULLY."); refresh();
  }

  async function setAvailability(name: string, isAvailable: boolean) {
    setSaving(`availability-${name}`); setMessage("");
    const client = createClient();
    const result = isAvailable
      ? await client.from("crm_daily_availability").delete().eq("branch_id", branchId).eq("crm_name", name).eq("date", date)
      : await client.from("crm_daily_availability").upsert({ branch_id: branchId, crm_name: name, date, is_available: false }, { onConflict: "branch_id,crm_name,date" });
    setSaving(null);
    if (result.error) { setMessage("Could not update availability for this date."); return; }
    setMessage(`TODAY AVAILABILITY SAVED SUCCESSFULLY FOR ${branches.find((branch) => branch.id === branchId)?.name ?? branchId}.`); refresh();
  }

  return <main className="mx-auto max-w-5xl px-5 py-7"><p className="text-sm font-semibold uppercase tracking-wider text-amber-800">Branch administration</p><h1 className="mt-1 text-3xl font-semibold">CRM roster and availability</h1><p className="mt-2 text-stone-600">The roster is ongoing. A daily row exists only when someone is unavailable; no row means available.</p><div className="mt-6 grid gap-4 md:grid-cols-2">{role === "super_admin" ? <label className="block text-sm font-medium">BRANCH<select className="mt-1 w-full rounded border p-2" value={branchId} onChange={(event) => router.push(`/allocation?branch=${event.target.value}&date=${date}`)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : <p className="text-sm text-stone-600">Your branch roster is shown below.</p>}<label className="block text-sm font-medium">Availability date<input className="mt-1 w-full rounded border p-2" type="date" value={date} onChange={(event) => router.push(`/allocation?branch=${branchId}&date=${event.target.value}`)} /></label></div><section className="mt-6 overflow-hidden rounded-xl border bg-white"><div className="border-b p-4"><h2 className="font-semibold">ADD / EDIT BRANCH / CRM</h2><p className="text-sm text-stone-600">Use ADD for new branch/CRM. Use EDIT beside a CRM name to change CRM name or move it to another branch. Use DELETE to remove a CRM name.</p></div>{canWrite ? <form className="grid gap-2 p-4 md:grid-cols-[1fr_1fr_auto_auto]" onSubmit={saveRoster}><label className="text-sm">BRANCH<select aria-label="Branch name" className="mt-1 w-full rounded border p-2" value={targetBranchId} onChange={(event) => setTargetBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="text-sm">CRM NAME<input aria-label="CRM name" className="mt-1 w-full rounded border p-2" value={crmName} onChange={(event) => setCrmName(event.target.value)} placeholder="TYPE CRM NAME" maxLength={160} /></label><button className="self-end rounded bg-amber-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={saving === "roster"}>{editing ? "UPDATE" : "ADD"}</button>{editing ? <button type="button" className="self-end rounded border px-3 py-2 text-sm" onClick={() => resetEdit("EDIT CANCELLED.")}>CANCEL EDIT</button> : null}</form> : null}{roster.length ? roster.map((item) => <div key={item.id} className="grid gap-3 border-t p-4 text-sm md:grid-cols-[1fr_auto_auto]"><div><b>{item.crm_name}</b>{item.pending_count > 0 ? <p className="mt-1 text-amber-800">{item.pending_count} pending queue assignment{item.pending_count === 1 ? "" : "s"}</p> : null}</div><span className={item.active ? "text-emerald-700" : "text-stone-500"}>{item.active ? "Active" : "Inactive"}</span>{canWrite ? <span className="flex gap-2"><button type="button" className="rounded border px-3 py-1.5" onClick={() => { setEditing(item); setCrmName(item.crm_name); setTargetBranchId(branchId); setMessage("EDIT MODE: CHANGE BRANCH NAME / CRM NAME, THEN CLICK UPDATE."); }}>EDIT</button><button type="button" className="rounded border px-3 py-1.5" disabled={saving === item.id} onClick={() => void deleteRoster(item)}>DELETE</button></span> : null}</div>) : <p className="p-4 text-sm text-stone-600">NO CRM FOUND FOR THIS BRANCH.</p>}</section><section className="mt-6 overflow-hidden rounded-xl border bg-white"><div className="border-b p-4"><h2 className="font-semibold">CRM PRESENT TODAY</h2><p className="text-sm text-stone-600">TODAY ({date}) availability. Only active roster members appear; absent exception rows mean the full branch list is active.</p></div>{roster.filter((item) => item.active).length ? roster.filter((item) => item.active).map((item) => { const available = !unavailable.has(item.crm_name); return <div key={item.id} className="flex items-center justify-between gap-4 border-b p-4 text-sm"><b>{item.crm_name}</b><label className="flex items-center gap-2"><input type="checkbox" checked={available} disabled={!canWrite || saving === `availability-${item.crm_name}`} onChange={(event) => void setAvailability(item.crm_name, event.target.checked)} />Available</label></div>; }) : <p className="p-4 text-sm text-stone-600">NO CRM FOUND FOR THIS BRANCH.</p>}</section>{message ? <p role="status" className="mt-4 text-sm text-stone-700">{message}</p> : null}</main>;
}
