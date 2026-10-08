import { readCrmResults } from "@/crm-port/read-results";
import { readAllCrmRows } from "@/crm-port/read-all-rows";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReferralQueue } from "@/components/referral-queue";
import { rosterNames } from "@/lib/roster";
import { createClient } from "@/lib/supabase/server";

/** PostgREST returns at most 1000 rows per request (supabase-crm config max_rows), so the
 * referral lists are read completely, in ordered pages (fix 2026-10-08). */
const CLIENT_CHUNK = 200;

export default async function ReferralsPage() {
  const supabase = await createClient();
  const [{ data: profiles }, { data: auth }] = await readCrmResults([supabase.rpc("get_my_profile"), supabase.auth.getUser()]);
  const profile = profiles?.[0];
  if (!profile || !auth.user) return null;
  const db = supabase as any;
  const [{ data: calling }, { data: history }, { data: users }, { data: roster }, { data: branches }] = await readCrmResults([
    readAllCrmRows<any>((from, to) => db.from("referral_calling").select("id,status,remark,next_followup_date,followup_count,converted_client_id,action_point,created_at,referrals!inner(crm_name,assigned_doer,salesperson_id,given_by_client_id,referral_name,referral_number,branch_id,created_at)").order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)),
    readAllCrmRows<any>((from, to) => db.from("referral_calling_history").select("referral_calling_id,remark,entered_by,created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)) /* crm-port: deterministic order */,
    readAllCrmRows<any>((from, to) => db.from("users").select("id,name").order("id").range(from, to)),
    // The CRM/DOER list is the current roster: JewelOS Users synced to crm_allocation (inactive rows are former staff).
    db.from("crm_allocation").select("crm_name").eq("active", true),
    db.from("branches").select("id,name").order("name"),
  ]);
  const rows: any[] = calling ?? [];
  const clientIds = [...new Set(rows.flatMap((row: any) => [row.referrals.given_by_client_id, row.converted_client_id]).filter(Boolean))] as string[];
  const clientChunks: string[][] = [];
  for (let start = 0; start < clientIds.length; start += CLIENT_CHUNK) clientChunks.push(clientIds.slice(start, start + CLIENT_CHUNK));
  const clientResults = await readCrmResults(clientChunks.map((ids) => db.from("clients").select("client_id,primary_name").in("client_id", ids)));
  const clientById = new Map<string, any>(clientResults.flatMap((result: any) => result.data ?? []).map((client: any) => [client.client_id, client]));
  const userById = new Map((users ?? []).map((user: any) => [user.id, user.name]));
  const historyById = new Map<string, any[]>();
  for (const entry of history ?? []) historyById.set(entry.referral_calling_id, [...(historyById.get(entry.referral_calling_id) ?? []), entry]);
  const items = rows.map((row: any) => {
    const referral = row.referrals; const entries = historyById.get(row.id) ?? [];
    return {
      id: row.id, status: row.status, next_followup_date: row.next_followup_date, remark: row.remark, converted_client_id: row.converted_client_id,
      followup_count: row.followup_count, action_point: row.action_point, crm_name: referral.crm_name ?? "", assigned_doer: referral.assigned_doer,
      given_by_client_id: referral.given_by_client_id, given_by_name: clientById.get(referral.given_by_client_id)?.primary_name ?? "Client record",
      referral_name: referral.referral_name, referral_number: referral.referral_number, salesperson: userById.get(referral.salesperson_id) ?? "",
      history_count: entries.length, history: entries.map((entry: any) => [entry.entered_by, entry.remark].filter(Boolean).join(": ")).filter(Boolean).join("\n"),
      created_at: referral.created_at ?? row.created_at ?? null, branch_id: referral.branch_id ?? null,
    };
  });
  const usedBranches = new Set(items.map((item) => item.branch_id).filter(Boolean));
  return <main className="mx-auto max-w-[1500px] px-5 py-7">{/* crm-port fix (owner 2026-10-05): the title and subtitle were rendered twice (here and in ReferralQueue); ReferralQueue's copy, next to its buttons, is kept. */}<ReferralQueue role={profile.role} branchId={null} enteredByName={profile.name} items={items} rosterNames={rosterNames(roster ?? []).sort()} branches={(branches ?? []).filter((branch: any) => usedBranches.has(branch.id))} /></main>;
}
