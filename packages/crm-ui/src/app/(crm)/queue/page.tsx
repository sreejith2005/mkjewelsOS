import { z } from "zod";
import { assertCrmRead } from "@/crm-port/read-results";
import { optionalUuid, queueSnapshotSchema } from "@/crm-port/queue-snapshot";
import { WalkinStart } from "@/components/walkin-start";
import { availableCrmNames } from "@/lib/available-crm-names";
import { rosterNames } from "@/lib/roster";
import { queueMatchesLegacyScope } from "@/lib/queue-visibility";
import { createClient } from "@/lib/supabase/server";

// crm-port: CRM opens here (owner request 2026-11-04): the queue, quick registration and REGISTER LEAD.
export default async function QueuePage({ searchParams }: { searchParams: Promise<{ branch?: string; crm?: string; completed?: string; completedClientId?: string; tab?:string;page?:string }> }) {
  const params = await searchParams;
  const page=Math.max(1,Math.min(1000000,Number.parseInt(params.page??"1",10)||1));
  const tab=params.tab==="recent"?"recent":"active";
  const supabase = await createClient();
  const { data } = assertCrmRead(await supabase.rpc("get_walkin_queue_page", {
    p_tab:tab,p_offset:(page-1)*50,p_limit:50,
    p_branch_id: optionalUuid(params.branch),
    p_crm_name: params.crm,
    p_completed_client_id: optionalUuid(params.completedClientId),
  }));
  // roster_by_branch / branch_source / branch_issues / roster_health come from supabase-crm 20261104000300; older readers omit them.
  const snapshot = queueSnapshotSchema.extend({
    total_count:z.number().int().nonnegative(),
    roster_by_branch:z.record(z.string(),z.array(z.object({crm_name:z.string(),available:z.boolean()}))).optional(),
    branch_source:z.enum(["dropdown_master","crm_branches"]).optional(),
    branch_issues:z.array(z.object({label:z.string(),reason:z.string()})).optional(),
    roster_health:z.object({crm_department_people:z.number(),on_roster:z.number(),not_on_roster:z.array(z.object({outcome:z.string(),reason:z.string(),count:z.number()})),last_staff_sync_at:z.string().nullable(),master_snapshot_at:z.string().nullable()}).nullable().optional(),
  }).parse(data);
  const { profile, branches: activeBranches, allocation, availability } = snapshot;
  const selectedBranchId = snapshot.selected_branch_id ?? "";
  const selectedCrm = snapshot.selected_crm;
  const queueCrms = rosterNames(allocation);
  const activeItems = snapshot.items.filter((item) => queueMatchesLegacyScope(item, selectedBranchId, selectedCrm));
  const completedItems = snapshot.items.filter((item) => item.branch_id === selectedBranchId && item.status === "complete" && (!selectedCrm || item.assigned_crm_name === selectedCrm));
  return <main className="crm-queue-main">{params.completed ? <p role="status" className="mt-4 rounded border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">Walk-in saved for {params.completed}. Client ID: {snapshot.completed_client_code ?? "available in the client record"}.</p> : null}<WalkinStart entryQueueProps={{ profile: { role: profile.role, branchId: snapshot.own_branch_id }, selectedBranchId, selectedCrm, branches: activeBranches, crms: availableCrmNames(allocation, availability), queueCrms, initialItems: [...activeItems, ...completedItems], completedName: params.completed,paging:{page,total:snapshot.total_count,tab}, rosterByBranch: snapshot.roster_by_branch, requestedBranch: optionalUuid(params.branch), branchSetup: { source: snapshot.branch_source ?? "unknown", issues: snapshot.branch_issues ?? [] }, rosterHealth: snapshot.roster_health ?? null }} fields={snapshot.fields} options={snapshot.options} lookupOptions={snapshot.lookup_options} actorId={snapshot.actor_id} /></main>;
}
