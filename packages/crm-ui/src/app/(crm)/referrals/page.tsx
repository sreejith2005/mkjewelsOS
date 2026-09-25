/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReferralQueue } from "@/components/referral-queue";
import { createClient } from "@/lib/supabase/server";

export default async function ReferralsPage() {
  const supabase = await createClient();
  const [{ data: profiles }, { data: auth }] = await Promise.all([supabase.rpc("get_my_profile"), supabase.auth.getUser()]);
  const profile = profiles?.[0];
  if (!profile || !auth.user) return null;
  const db = supabase as any;
  const [{ data: calling }] = await Promise.all([
    db.from("referral_calling").select("id,status,remark,next_followup_date,followup_count,converted_client_id,action_point,referrals!inner(crm_name,assigned_doer,salesperson_id,given_by_client_id,referral_name,referral_number)"),
  ]);
  const rows = calling ?? [];
  const clientIds = [...new Set(rows.flatMap((row: any) => [row.referrals.given_by_client_id, row.converted_client_id]).filter(Boolean))];
  const [{ data: clients }, { data: history }, { data: users }] = await Promise.all([
    clientIds.length ? db.from("clients").select("client_id,primary_name").in("client_id", clientIds) : Promise.resolve({ data: [] }),
    rows.length ? db.from("referral_calling_history").select("referral_calling_id,remark,entered_by,created_at").in("referral_calling_id", rows.map((row: any) => row.id)).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    db.from("users").select("id,name"),
  ]);
  const clientById = new Map<string, any>((clients ?? []).map((client: any) => [client.client_id, client]));
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
    };
  });
  return <main className="mx-auto max-w-[1500px] px-5 py-7"><h1 className="text-3xl font-semibold">REFERRALS CALLING</h1><p className="mt-1 text-sm text-stone-600">CALL REFERRALS GIVEN BY CLIENTS. CRM CAN SEE WHO GAVE THE REFERRAL, SAVE FOLLOW-UP HISTORY, AND TRACK CONVERTED REFERRALS.</p><ReferralQueue role={profile.role} branchId={null} enteredByName={profile.name} items={items} /></main>;
}
