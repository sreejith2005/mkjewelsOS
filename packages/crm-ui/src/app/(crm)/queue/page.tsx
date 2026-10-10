import { assertCrmRead } from "@/crm-port/read-results";
import { optionalUuid, queueSnapshotSchema } from "@/crm-port/queue-snapshot";
import { WalkinStart } from "@/components/walkin-start";
import { availableCrmNames } from "@/lib/available-crm-names";
import { rosterNames } from "@/lib/roster";
import { queueMatchesLegacyScope } from "@/lib/queue-visibility";
import { createClient } from "@/lib/supabase/server";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ branch?: string; crm?: string; completed?: string; completedClientId?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = assertCrmRead(await supabase.rpc("get_walkin_queue_snapshot", {
    p_branch_id: optionalUuid(params.branch),
    p_crm_name: params.crm,
    p_completed_client_id: optionalUuid(params.completedClientId),
  }));
  const snapshot = queueSnapshotSchema.parse(data);
  const { profile, branches: activeBranches, allocation, availability } = snapshot;
  const selectedBranchId = snapshot.selected_branch_id ?? "";
  const selectedCrm = snapshot.selected_crm;
  const queueCrms = rosterNames(allocation);
  const activeItems = snapshot.items.filter((item) => queueMatchesLegacyScope(item, selectedBranchId, selectedCrm));
  const completedItems = snapshot.items.filter((item) => item.branch_id === selectedBranchId && item.status === "complete" && (!selectedCrm || item.assigned_crm_name === selectedCrm));
  return <main className="mx-auto max-w-7xl px-5 py-7"><div><p className="text-sm font-semibold uppercase tracking-wider text-amber-800">Front desk</p><h1 className="mt-1 text-3xl font-semibold">Client walk-in form</h1></div>{params.completed ? <p role="status" className="mt-4 rounded border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">Walk-in saved for {params.completed}. Client ID: {snapshot.completed_client_code ?? "available in the client record"}.</p> : null}<WalkinStart entryQueueProps={{ profile: { role: profile.role, branchId: snapshot.own_branch_id }, selectedBranchId, selectedCrm, branches: activeBranches, crms: availableCrmNames(allocation, availability), queueCrms, initialItems: [...activeItems, ...completedItems], completedName: params.completed }} fields={snapshot.fields} options={snapshot.options} lookupOptions={snapshot.lookup_options} actorId={snapshot.actor_id} /></main>;
}
