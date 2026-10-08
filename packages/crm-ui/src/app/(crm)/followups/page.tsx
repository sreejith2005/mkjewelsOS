import { readCrmResults } from "@/crm-port/read-results";
import { readAllCrmRows } from "@/crm-port/read-all-rows";
import { FollowupQueue } from "@/components/followup-queue";
import { legacyNotBoughtHistory } from "@/lib/followup-logic";
import { rosterNames } from "@/lib/roster";
import { createClient } from "@/lib/supabase/server";
export default async function FollowupsPage() {
 const supabase=await createClient(); const [{data:profileRows},{data:auth}] = await readCrmResults([supabase.rpc("get_my_profile"),supabase.auth.getUser()]); const profile=profileRows?.[0]; if(!profile||!auth.user)return null;
 const db=supabase as any;
 // PostgREST returns at most 1000 rows per request (supabase-crm max_rows): read complete, ordered pages (fix 2026-10-08).
 const [{data:followups},{data:history},{data:roster},{data:branches}]=await readCrmResults([
   readAllCrmRows<any>((from,to)=>db.from("not_bought_followups").select("id,client_id,reference_number,status,next_followup_date,remark,action_point,branch_id,followup_count,source_timeline_id,source_visit_form_id,created_at,clients!inner(primary_name,primary_phone),client_timeline(event_date,crm_name,seen_categories,product_requirement,remark),visit_forms(not_bought_reasons,not_bought_other)").order("created_at",{ascending:false}).order("id",{ascending:false}).range(from,to)),
   readAllCrmRows<any>((from,to)=>db.from("not_bought_history").select("followup_id,status,previous_status,call_response,remark,created_at,updated_by,not_bought_followups!inner(client_id,reference_number)").order("created_at",{ascending:false}).order("id",{ascending:false}).range(from,to)),
   // The CRM NAME list is the current roster: JewelOS Users synced to crm_allocation (inactive rows are former staff).
   db.from("crm_allocation").select("crm_name").eq("active",true),
   db.from("branches").select("id,name").order("name"),
 ]);
 const rows:any[]=followups??[]; const normalizedHistory=(history??[]).map((entry:any)=>({...entry,client_id:entry.not_bought_followups.client_id,reference_number:entry.not_bought_followups.reference_number}));
 const items=rows.map((row:any)=>{const timeline=row.client_timeline??{};const form=row.visit_forms??{};const h=legacyNotBoughtHistory(normalizedHistory,row.client_id,row.reference_number);return {id:row.id,client_id:row.client_id,reference_number:row.reference_number,status:row.status,next_followup_date:row.next_followup_date,remark:row.remark,action_point:row.action_point,branch_id:row.branch_id,client_name:row.clients.primary_name,phone:row.clients.primary_phone,crm_name:timeline.crm_name??"",visit_date:timeline.event_date??null,reason:[...(form.not_bought_reasons??[]),form.not_bought_other].filter(Boolean).join(", "),seen_categories:(timeline.seen_categories??[]).join(", "),product_requirement:timeline.product_requirement??"",product_seen_remark:timeline.remark??"",followup_count:row.followup_count,history_count:h.length,remark_history:h.map((entry:any)=>`${entry.created_at}: ${entry.status}${entry.remark?` — ${entry.remark}`:""}`).join("\n"),created_at:row.created_at??null};});
 const usedBranches=new Set(items.map((item:any)=>item.branch_id).filter(Boolean));
 return <FollowupQueue role={profile.role} branchId={null} items={items} crmNames={rosterNames(roster??[]).sort()} branches={(branches??[]).filter((branch:any)=>usedBranches.has(branch.id))} enteredByName={profile.name??auth.user.email??"Current user"}/>;
}
