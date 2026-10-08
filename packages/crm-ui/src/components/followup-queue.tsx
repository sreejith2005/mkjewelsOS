"use client";

import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { useMemo, useState } from "react";
import { isDoneFollowup, queueTabMatches, sortNotBoughtFollowups } from "@/lib/followup-logic";
import { createClient } from "@/lib/supabase/client";
import { displayDate } from "@/lib/clients";
import { kolkataDateKey } from "@/lib/business-date";
import { formatPhone } from "@/lib/phone";
import { byDate, byNumberDesc, byText, sortQueue, type Compare } from "@/lib/queue-sort";
import { normalizeRosterValue, OFF_ROSTER, rosterFilterMatches } from "@/lib/roster";

export type FollowupItem = {
  id: string; client_id: string; reference_number: string | null; status: string;
  next_followup_date: string | null; remark: string | null; branch_id: string | null;
  client_name: string; phone: string; crm_name: string; visit_date: string | null;
  reason: string; seen_categories: string; product_requirement: string;
  product_seen_remark: string; action_point: string | null; followup_count: number;
  history_count: number; remark_history: string; created_at?: string | null;
};

const TABS = [["today", "TODAY FOLLOW UP"], ["pending", "ALL PENDING FOLLOW UP"], ["inprocess", "INPROCESS FOLLOW UP"], ["done", "ALL DONE"]] as const;
const FOLLOW_UP_STATUSES = [
  "PENDING", "CLIENT ASKED TO CALL LATER", "INTERESTED - NEED FOLLOW UP",
  "NEGOTIATION / PRICE DISCUSSION", "VISIT PLANNED", "WHATSAPP SENT", "NOT DECIDED YET",
  "ALREADY PURCHASED FROM MK JEWELS", "ALREADY PURCHASED FROM ANOTHER JEWELLER",
  "NO REQUIREMENT AT THE MOMENT (FOLLOW UP AFTER A FEW MONTHS)", "CALL NOT PICKED",
] as const;
const CALL_RESPONSES = ["CONNECTED", "NOT PICKED", "SWITCHED OFF", "WHATSAPP ONLY", "WRONG NUMBER"] as const;
// Owner request 2026-10-08: sort options. "Default" keeps the original order (due date; newest first outside Today).
const SORTS: readonly (readonly [string, string, Compare<FollowupItem> | null])[] = [
  ["default", "DEFAULT (FOLLOW-UP DATE)", null],
  ["next_soonest", "NEXT FOLLOW UP: SOONEST", byDate((item) => item.next_followup_date, "asc")],
  ["next_latest", "NEXT FOLLOW UP: LATEST", byDate((item) => item.next_followup_date, "desc")],
  ["visit_newest", "VISIT DATE: NEWEST", byDate((item) => item.visit_date, "desc")],
  ["visit_oldest", "VISIT DATE: OLDEST", byDate((item) => item.visit_date, "asc")],
  ["newest", "NEWEST ADDED FIRST", byDate((item) => item.created_at, "desc")],
  ["client", "CLIENT NAME A-Z", byText((item) => item.client_name)],
  ["crm", "CRM NAME A-Z", byText((item) => item.crm_name)],
  ["followups", "MOST FOLLOW-UPS", byNumberDesc((item) => item.followup_count)],
];
const inTab = (item: FollowupItem, tab: string, today: string) => queueTabMatches({ status: item.status, next_followup_date: item.next_followup_date, followup_count: item.followup_count }, tab, today);
type FollowupRpcClient = { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

export function FollowupQueue({ items, crmNames, enteredByName, branches = [] }: {
  role: string; branchId: string | null; items: FollowupItem[]; crmNames: string[]; enteredByName: string; branches?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState("today");
  const [crm, setCrm] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [branch, setBranch] = useState("");
  const [sort, setSort] = useState("default");
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const today = kolkataDateKey();
  // The CRM NAME list is the current roster (JewelOS Users); records keep the name saved on the visit.
  const roster = useMemo(() => new Set(crmNames.map(normalizeRosterValue)), [crmNames]);
  const hasOffRoster = items.some((item) => !roster.has(normalizeRosterValue(item.crm_name)));
  const statuses = useMemo(() => [...new Set(items.map((item) => item.status))].sort(), [items]);
  const filtered = useMemo(() => items.filter((item) => {
    const text = `${item.client_name} ${item.phone} ${item.reference_number ?? ""}`.toLowerCase();
    const digits = search.replace(/\D/g, "");
    return rosterFilterMatches(item.crm_name, crm, roster) && (!status || item.status === status) && (!branch || item.branch_id === branch)
      && (!search || text.includes(search.toLowerCase()) || (digits !== "" && item.phone.replace(/\D/g, "").includes(digits)));
  }), [items, crm, roster, status, branch, search]);
  const counts = useMemo(() => Object.fromEntries(TABS.map(([key]) => [key, filtered.filter((item) => inTab(item, key, today)).length])), [filtered, today]);
  const visible = useMemo(() => {
    const rows = filtered.filter((item) => inTab(item, tab, today));
    const compare = SORTS.find(([key]) => key === sort)?.[2];
    return compare ? sortQueue(rows, compare) : sortNotBoughtFollowups(rows, tab);
  }, [filtered, tab, today, sort]);

  async function sync() {
    setSyncing(true); setMessage("");
    const { data, error } = await (createClient() as unknown as FollowupRpcClient).rpc("sync_not_bought_followups");
    setSyncing(false);
    if (error) { setMessage("Could not sync Not Bought data. Please try again or contact an administrator."); return; }
    setMessage(`Not Bought data synced${typeof data === "number" ? `: ${data} follow-up(s) added.` : "."}`);
    router.refresh();
  }

  async function save(item: FollowupItem, form: HTMLFormElement) {
    const data = new FormData(form);
    const status = String(data.get("status"));
    const remark = String(data.get("remark")).trim();
    if (!isDoneFollowup(status) && !remark) { setMessage("Follow Up Remark is required unless the follow-up is done."); return; }
    const { error } = await (createClient() as unknown as FollowupRpcClient).rpc("save_not_bought_followup", {
      p_followup_id: item.id,
      p_followup_status: status,
      p_call_response: String(data.get("call_response")),
      p_next_followup_date: String(data.get("next_date")) || null,
      p_remark: remark || null,
    });
    if (error) { setMessage("Could not save this follow-up. Please try again or contact an administrator."); return; }
    setOpen(null); setMessage("Follow-up saved."); router.refresh();
  }

  return <main className="mx-auto max-w-[1800px] px-5 py-7">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-3xl font-semibold">Not Bought Follow-Up</h1><p className="mt-1 text-sm text-stone-600">Live CRM data with a manual legacy-compatible sync.</p></div>
      <div className="flex gap-2"><button className="rounded border px-3 py-2 text-sm" disabled={syncing} onClick={() => void sync()}>{syncing ? "SYNCING…" : "SYNC NOT BOUGHT DATA"}</button><button className="rounded bg-amber-800 px-3 py-2 text-sm text-white" onClick={() => router.refresh()}>REFRESH</button></div>
    </div>
    <div className="mt-5 flex flex-wrap gap-2">{TABS.map(([key, label]) => <button key={key} aria-label={label} className={tab === key ? "rounded bg-amber-800 px-3 py-2 text-xs font-semibold text-white" : "rounded border px-3 py-2 text-xs font-semibold"} onClick={() => setTab(key)}>{label} ({counts[key]})</button>)}</div>
    <div className="mt-4 flex flex-wrap gap-3"><select aria-label="CRM name" className="rounded border p-2 text-sm" value={crm} onChange={(event) => setCrm(event.target.value)}><option value="">CRM NAME: ALL</option>{crmNames.map((name) => <option key={name} value={normalizeRosterValue(name)}>{name}</option>)}{hasOffRoster && <option value={OFF_ROSTER}>NOT IN CURRENT ROSTER</option>}</select><select aria-label="Status" className="rounded border p-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">STATUS: ALL</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select>{branches.length > 1 && <select aria-label="Branch" className="rounded border p-2 text-sm" value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">BRANCH: ALL</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<select aria-label="Sort by" className="rounded border p-2 text-sm" value={sort} onChange={(event) => setSort(event.target.value)}>{SORTS.map(([key, label]) => <option key={key} value={key}>SORT: {label}</option>)}</select><input className="min-w-64 rounded border p-2 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SEARCH CLIENT / PHONE / REFERENCE" /></div>
    <p className="mt-2 text-xs text-stone-600">SHOWING {visible.length} OF {items.length} FOLLOW-UPS</p>
    {message && <p role="alert" className="mt-3 text-sm text-red-700">{message}</p>}
    <section className="mt-5 overflow-x-auto rounded border bg-white"><table className="w-full min-w-[2200px] text-left text-xs"><thead className="bg-stone-100 uppercase text-stone-600"><tr>{["CRM Name", "Client Name", "Number", "Client Visit Date", "Next Follow Up", "Reason", "Seen Categories", "Product Requirement", "Remark/Product Seen", "Follow Up Remark", "Action Point", "Action"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
      {visible.map((item) => <tr className="border-t align-top" key={item.id}>
        <td className="p-3">{item.crm_name || "—"}</td><td className="p-3"><Link className="font-semibold text-amber-800 underline" href={`/clients/${item.client_id}`}>{item.client_name}</Link><div className="mt-1 flex gap-1"><span className="rounded bg-stone-100 px-1">{item.status}</span><span className="rounded bg-stone-100 px-1">FU: {item.followup_count}</span><span className="rounded bg-stone-100 px-1">HIST: {item.history_count}</span></div></td><td className="p-3">{formatPhone(item.phone)}</td><td className="p-3">{displayDate(item.visit_date)}</td><td className="p-3">{displayDate(item.next_followup_date)}</td><td className="p-3">{item.reason || "—"}</td><td className="p-3">{item.seen_categories || "—"}</td><td className="p-3">{item.product_requirement || "—"}</td><td className="p-3 max-w-56 whitespace-pre-wrap">{item.product_seen_remark || "—"}</td><td className="p-3 max-w-56 whitespace-pre-wrap">{item.remark || "—"}</td><td className="p-3 max-w-56 whitespace-pre-wrap">{item.action_point || "—"}</td>
        <td className="p-3"><div className="flex flex-col gap-1"><Link className="rounded border px-2 py-1 text-center" href={`/clients/${item.client_id}`}>OPEN PROFILE</Link><button className="rounded border px-2 py-1" onClick={() => setOpen(open === item.id ? null : item.id)}>FOLLOW UP FORM</button><button className="rounded border px-2 py-1" onClick={() => setOpen(open === `${item.id}:history` ? null : `${item.id}:history`)}>VIEW HISTORY</button></div>
          {open === item.id && <form className="mt-2 grid min-w-56 gap-2" onSubmit={(event) => { event.preventDefault(); void save(item, event.currentTarget); }}>
            <label>Follow Up Status<select aria-label="Follow Up Status" name="status" defaultValue={item.status} required className="mt-1 w-full rounded border p-1">{!FOLLOW_UP_STATUSES.includes(item.status as typeof FOLLOW_UP_STATUSES[number]) && <option>{item.status}</option>}{FOLLOW_UP_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label>Next Follow Up Date<input aria-label="Next Follow Up Date" name="next_date" type="date" defaultValue={item.next_followup_date ?? today} className="mt-1 w-full rounded border p-1" /></label>
            <label>Call Response<select aria-label="Call Response" name="call_response" required className="mt-1 w-full rounded border p-1">{CALL_RESPONSES.map((response) => <option key={response}>{response}</option>)}</select></label>
            <label>Entered By<input aria-label="Entered By" value={enteredByName} readOnly className="mt-1 w-full rounded border bg-stone-50 p-1" /></label>
            <label>Follow Up Remark<textarea aria-label="Follow Up Remark" name="remark" defaultValue={item.remark ?? ""} maxLength={2000} className="mt-1 w-full rounded border p-1" /></label>
            <button className="rounded bg-amber-800 p-1 text-white">Save</button>
          </form>}
          {open === `${item.id}:history` && <p className="mt-2 max-w-56 whitespace-pre-wrap text-xs">{item.remark_history || "No logged history."}</p>}
        </td>
      </tr>)}
      {!visible.length && <tr><td className="p-5 text-sm text-stone-600" colSpan={12}>No follow-ups match this view.</td></tr>}
    </tbody></table></section>
  </main>;
}
