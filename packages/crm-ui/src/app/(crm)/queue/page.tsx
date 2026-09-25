import { getCrmUser } from "@/crm-port/crm-user"; // crm-port: see getCrmUser
import { WalkinStart } from "@/components/walkin-start";
import type { LeadField, LeadOption } from "@/components/lead-form";
import { availableCrmNames } from "@/lib/available-crm-names";
import { kolkataDateKey } from "@/lib/business-date";
import { rosterNames } from "@/lib/roster";
import { queueMatchesLegacyScope } from "@/lib/queue-visibility";
import { createClient } from "@/lib/supabase/server";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ branch?: string; crm?: string; completed?: string; completedClientId?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const [{ data: profileRows }, { data: auth }] = await Promise.all([supabase.rpc("get_my_profile"), getCrmUser(supabase) /* crm-port: auth.getUser().id is used as the CRM user id -> crm.current_crm_user_id() */]);
  const profile = profileRows?.[0];
  if (!profile || !auth.user) return null;
  const [{ data: user }, { data: branches }, { data: fields }, { data: fieldOptions }, { data: communities }, { data: beverages }, { data: snacks }, { data: gifts }] = await Promise.all([supabase.from("users").select("branch_id").eq("id", auth.user.id).single(), supabase.from("branches").select("id,name").eq("active", true).order("name"), supabase.from("lead_form_fields").select("id,field_key,label,field_type,is_mandatory,is_hidden,display_order,is_runo_synced,runo_field_name,option_source").order("display_order"), supabase.from("lead_form_field_options").select("id,field_id,option_value,display_order,triggers_field_key").order("display_order"), supabase.from("lookup_communities").select("label").eq("active", true).order("label"), supabase.from("lookup_beverages").select("label").eq("active", true).order("label"), supabase.from("lookup_snacks").select("label").eq("active", true).order("label"), supabase.from("lookup_gifts").select("label").eq("active", true).order("label")]);
  const activeBranches = branches ?? [];
  // An all-branches admin must deliberately choose a branch. Falling back to
  // the first alphabetic branch (usually Andheri) caused the wrong roster to
  // appear in both the queue and the walk-in form.
  const selectedBranchId = profile.role === "super_admin"
    ? activeBranches.some((branch) => branch.id === params.branch) ? params.branch! : ""
    : user?.branch_id ?? "";
  const today = kolkataDateKey();
  const [{ data: allocation }, { data: availability }] = selectedBranchId ? await Promise.all([supabase.from("crm_allocation").select("crm_name").eq("branch_id", selectedBranchId).eq("active", true).order("created_at"), supabase.from("crm_daily_availability").select("crm_name,is_available").eq("branch_id", selectedBranchId).eq("date", today)]) : [{ data: [] }, { data: [] }];
  const queueCrms = rosterNames(allocation ?? []);
  const selectedCrm = queueCrms.includes(params.crm ?? "") ? params.crm! : "";
  const queue = selectedBranchId ? await (selectedCrm ? supabase.from("entry_queue").select("id,token,client_name,mobile,assigned_crm_name,status,created_at,client_id,branch_id").eq("branch_id", selectedBranchId).eq("assigned_crm_name", selectedCrm).order("created_at", { ascending: false }) : supabase.from("entry_queue").select("id,token,client_name,mobile,assigned_crm_name,status,created_at,client_id,branch_id").eq("branch_id", selectedBranchId).order("created_at", { ascending: false })) : { data: [] };
  const activeItems = (queue.data ?? []).filter((item) => queueMatchesLegacyScope(item, selectedBranchId, selectedCrm));
  const completedItems = (queue.data ?? []).filter((item) => item.branch_id === selectedBranchId && item.status === "complete" && (!selectedCrm || item.assigned_crm_name === selectedCrm));
  const completedClient = params.completedClientId ? await supabase.from("clients").select("client_code").eq("client_id", params.completedClientId).maybeSingle() : { data: null };
  const lookupOptions = { lookup_communities: (communities ?? []).map((row) => row.label), lookup_beverages: (beverages ?? []).map((row) => row.label), lookup_sugar_options: [], lookup_snacks: (snacks ?? []).map((row) => row.label), lookup_gifts: (gifts ?? []).map((row) => row.label) };
  return <main className="mx-auto max-w-7xl px-5 py-7"><div><p className="text-sm font-semibold uppercase tracking-wider text-amber-800">Front desk</p><h1 className="mt-1 text-3xl font-semibold">Client walk-in form</h1></div>{params.completed ? <p role="status" className="mt-4 rounded border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">Walk-in saved for {params.completed}. Client ID: {completedClient.data?.client_code ?? "available in the client record"}.</p> : null}<WalkinStart entryQueueProps={{ profile: { role: profile.role, branchId: user?.branch_id ?? null }, selectedBranchId, selectedCrm, branches: activeBranches, crms: availableCrmNames(allocation ?? [], availability ?? []), queueCrms, initialItems: [...activeItems, ...completedItems], completedName: params.completed }} fields={(fields ?? []) as LeadField[]} options={(fieldOptions ?? []) as LeadOption[]} lookupOptions={lookupOptions} actorId={auth.user.id} /></main>;
}
