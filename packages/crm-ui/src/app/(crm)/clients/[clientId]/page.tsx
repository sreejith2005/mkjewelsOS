import { savedSalespersonName } from "@/lib/saved-salesperson";
import { assertCrmRead, readCrmResults } from "@/crm-port/read-results";
import { getCrmUser } from "@/crm-port/crm-user"; // crm-port: see getCrmUser
import { notFound } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

import { ClientProfile } from "@/components/client-profile";
import { createClient } from "@/lib/supabase/server";
import type { Json } from '@/lib/supabase/database.types';
import { readAllCrmRows } from '@/crm-port/read-all-rows';

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const supabase = await createClient();
  const [
    clientResult,
    timelineResult,
    auditResult,
    profileResult,
    authResult,
    branchesResult,
    beveragesResult,
    snacksResult,
    sugarsResult,
    communitiesResult,
    giftsResult,
  ] = await readCrmResults([
    supabase.from("clients").select("*").eq("client_id", clientId).single(),
    readAllCrmRows((from,to)=>supabase.from("client_timeline").select("id,created_at,event_date,event_type,buy_status,crm_name,remark,branch_id,salesperson_id,seen_categories,bought_categories,order_categories,product_requirement,reference_number").eq("client_id", clientId).order("created_at", { ascending: false }).order("event_date", { ascending: false }).order("id", { ascending: false }).range(from,to)),
    supabase.from("client_edit_log").select("id,field_name,old_value,new_value,created_at,edited_by").eq("client_id", clientId).order("created_at", { ascending: false }).order("id", { ascending: false }) /* crm-port: deterministic order */,
    supabase.rpc("get_my_profile"),
    getCrmUser(supabase) /* crm-port: auth.getUser().id is used as the CRM user id -> crm.current_crm_user_id() */,
    supabase.from("branches").select("id,name").eq("active", true).order("name"),
    supabase.from("lookup_beverages").select("label").eq("active", true).order("label"),
    supabase.from("lookup_snacks").select("label").eq("active", true).order("label"),
    supabase.from("lookup_sugar_options").select("label").eq("active", true).order("label"),
    supabase.from("lookup_communities").select("label").eq("active", true).order("label"),
    supabase.from("lookup_gifts").select("label").eq("active", true).order("label"),
  ]);

  if (clientResult.error || !clientResult.data) notFound();

  const { data: currentUser } = authResult.data.user
    ? assertCrmRead(await supabase.from("users").select("branch_id").eq("id", authResult.data.user.id).single())
    : { data: null };

  const branchIds = [...new Set([clientResult.data.last_branch_id, ...(timelineResult.data ?? []).map((item) => item.branch_id)].filter(Boolean))] as string[];
  const editorIds = [...new Set((auditResult.data ?? []).map((item) => item.edited_by).filter(Boolean))] as string[];
  const salespersonIds = [...new Set([clientResult.data.last_salesperson_id, ...(timelineResult.data ?? []).map((item) => item.salesperson_id)].filter(Boolean))] as string[];
  const [{ data: branches }, { data: users }] = await readCrmResults([
    branchIds.length ? supabase.from("branches").select("id,name").in("id", branchIds) : Promise.resolve({ data: [] }),
    [...editorIds, ...salespersonIds].length ? supabase.from("users").select("id,name").in("id", [...new Set([...editorIds, ...salespersonIds])]) : Promise.resolve({ data: [] }),
  ]);
  // Approved identity extension: codes, referrer and family (company-wide read, as clients).
  const { data: identity } = assertCrmRead(await supabase.from("client_identity").select("referral_code,household_code,household_id,referral_id,referral_person_id,relation,referred_by_client_id,referred_by_client_code,referred_by_name,lifecycle_stage").eq("client_id", clientId).maybeSingle());
  const { data: family } = identity?.household_id
    ? assertCrmRead(await supabase.from("clients").select("client_id,client_code,primary_name").eq("household_id", identity.household_id).neq("client_id", clientId).order("client_code"))
    : { data: [] };
  const branchNames = new Map((branches ?? []).map((item) => [item.id, item.name]));
  const userNames = new Map((users ?? []).map((item) => [item.id, item.name]));
  const timelineIds = (timelineResult.data ?? []).map(item=>item.id);
  const timelineBatches = Array.from({length:Math.ceil(timelineIds.length/100)},(_,index)=>timelineIds.slice(index*100,(index+1)*100));
  const [{data: forms},{data: documents}] = await readCrmResults([
    Promise.all(timelineBatches.map(ids=>supabase.from('visit_forms').select('*').in('client_timeline_id',ids).then(assertCrmRead))).then(results=>({data:results.flatMap(result=>result.data ?? [])})),
    readAllCrmRows((from,to)=>supabase.from('documents').select('id,client_timeline_id,file_name,storage_path,mime_type').eq('client_id',clientId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to)),
  ]);
  const formsByTimeline = new Map((forms ?? []).map(form=>[form.client_timeline_id,form]));
  function mediaPurpose(form: {additional_fields: Json} | undefined, path: string): string | null {
    const fields = form?.additional_fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
    const snapshot = fields.submitted_fields;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.documents)) return null;
    const found = snapshot.documents.find(item=>item && typeof item === 'object' && !Array.isArray(item) && item.storage_path === path);
    return found && typeof found === 'object' && !Array.isArray(found) && typeof found.purpose === 'string' ? found.purpose : null;
  }

  return <ClientProfile
    client={clientResult.data}
    timeline={(timelineResult.data ?? []).map((item) => ({ ...item, seen_categories: item.seen_categories ?? [], bought_categories: item.bought_categories ?? [], order_categories: item.order_categories ?? [], branch: branchNames.get(item.branch_id) ?? null, salesperson: savedSalespersonName(formsByTimeline.get(item.id)?.additional_fields,item.salesperson_id ? userNames.get(item.salesperson_id) ?? null : null) }))}
    audit={(auditResult.data ?? []).map((item) => ({ ...item, editor: item.edited_by ? userNames.get(item.edited_by) ?? null : null }))}
    lastBranchName={clientResult.data.last_branch_id ? branchNames.get(clientResult.data.last_branch_id) ?? null : null}
    identity={identity}
    family={family ?? []}
    savedWalkins={(timelineResult.data ?? []).map(item=>({timelineId:item.id,reference:item.reference_number,form:formsByTimeline.get(item.id) ?? null,documents:(documents ?? []).filter(doc=>doc.client_timeline_id===item.id).map(doc=>({...doc,purpose:mediaPurpose(formsByTimeline.get(item.id),doc.storage_path)}))}))}
    lastSalespersonName={savedSalespersonName(formsByTimeline.get([...(timelineResult.data ?? [])].sort((a,b)=>b.event_date.localeCompare(a.event_date)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))[0]?.id)?.additional_fields,clientResult.data.last_salesperson_id ? userNames.get(clientResult.data.last_salesperson_id) ?? null : null)}
    walkinContext={{ role: profileResult.data?.[0]?.role ?? "", branchId: currentUser?.branch_id ?? null, branches: branchesResult.data ?? [] }}
    lookups={{
      beverages: (beveragesResult.data ?? []).map((item) => item.label),
      snacks: (snacksResult.data ?? []).map((item) => item.label),
      sugars: (sugarsResult.data ?? []).map((item: { label: string }) => item.label),
      communities: (communitiesResult.data ?? []).map((item) => item.label),
      gifts: (giftsResult.data ?? []).map((item) => item.label),
    }}
  />;
}
