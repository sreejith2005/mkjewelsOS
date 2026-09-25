import { getCrmUser } from "@/crm-port/crm-user"; // crm-port: see getCrmUser
import { AllocationManager } from "@/components/allocation-manager";
import { createClient } from "@/lib/supabase/server";

function today() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export default async function AllocationPage({ searchParams }: { searchParams: Promise<{ branch?: string; date?: string }> }) {
  const params = await searchParams; const supabase = await createClient(); const [{ data: profileRows }, { data: auth }] = await Promise.all([supabase.rpc("get_my_profile"), getCrmUser(supabase) /* crm-port: auth.getUser().id is used as the CRM user id -> crm.current_crm_user_id() */]); const profile = profileRows?.[0]; if (!profile || !auth.user) return null;
  const [{ data: user }, { data: branches }] = await Promise.all([supabase.from("users").select("branch_id").eq("id", auth.user.id).single(), supabase.from("branches").select("id,name").eq("active", true).order("name")]); const permittedBranches = branches ?? [];
  const requestedBranch = profile.role === "super_admin" ? params.branch : user?.branch_id; const branchId = permittedBranches.some((branch) => branch.id === requestedBranch) ? requestedBranch : (profile.role === "super_admin" ? permittedBranches[0]?.id : user?.branch_id);
  if (!branchId) return <main className="mx-auto max-w-5xl px-5 py-7"><h1 className="text-3xl font-semibold">CRM roster and availability</h1><p className="mt-2 text-stone-600">No active branch is available for this account.</p></main>;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : today(); const [{ data: allocations }, { data: availability }, { data: pending }] = await Promise.all([supabase.from("crm_allocation").select("id,crm_name,active").eq("branch_id", branchId).order("crm_name"), supabase.from("crm_daily_availability").select("crm_name").eq("branch_id", branchId).eq("date", date).eq("is_available", false), supabase.from("entry_queue").select("assigned_crm_name").eq("branch_id", branchId).neq("status", "complete").not("assigned_crm_name", "is", null)]);
  const pendingCounts = new Map<string, number>(); for (const row of pending ?? []) if (row.assigned_crm_name) pendingCounts.set(row.assigned_crm_name, (pendingCounts.get(row.assigned_crm_name) ?? 0) + 1); const roster = (allocations ?? []).map((item) => ({ ...item, pending_count: pendingCounts.get(item.crm_name) ?? 0 }));
  return <AllocationManager role={profile.role} branchId={branchId} branches={permittedBranches} roster={roster} unavailableNames={(availability ?? []).map((item) => item.crm_name)} date={date} />;
}
