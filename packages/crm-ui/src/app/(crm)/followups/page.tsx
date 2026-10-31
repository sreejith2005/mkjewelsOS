import { assertCrmRead } from '@/crm-port/read-results';
import { FOLLOWUP_PAGE_SIZE,followupParams,followupPageSchema,followupItemSchema } from '@/crm-port/followup-page';
import { FollowupQueue } from '@/components/followup-queue';
import { createClient } from '@/lib/supabase/server';
export default async function FollowupsPage({searchParams=Promise.resolve({})}:{searchParams?:Promise<Record<string,string|undefined>>}={}){
 const {filters,page}=followupParams(await searchParams);
 const db=await createClient();
 const {data}=assertCrmRead(await db.rpc('browse_crm_followups',{p_kind:'not_bought',p_filters:filters,p_offset:(page-1)*FOLLOWUP_PAGE_SIZE,p_limit:FOLLOWUP_PAGE_SIZE}));
 const result=followupPageSchema.parse(data);
 return <FollowupQueue items={result.rows.map(row=>followupItemSchema.parse(row))} crmNames={result.roster} branches={result.branches} role={result.profile.role} branchId={null} enteredByName={result.profile.name} paging={{page,total:result.total,counts:result.counts,statuses:result.statuses,hasOffRoster:result.has_off_roster,filters}}/>;
}
