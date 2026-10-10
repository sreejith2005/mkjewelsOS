import { assertCrmRead } from '@/crm-port/read-results';
import { FOLLOWUP_PAGE_SIZE,followupParams,followupPageSchema,referralItemSchema } from '@/crm-port/followup-page';
import { ReferralQueue } from '@/components/referral-queue';
import { createClient } from '@/lib/supabase/server';
export default async function ReferralsPage({searchParams=Promise.resolve({})}:{searchParams?:Promise<Record<string,string|undefined>>}={}){
 const {filters,page}=followupParams(await searchParams);
 const db=await createClient();
 const {data}=assertCrmRead(await db.rpc('browse_crm_followups',{p_kind:'referral',p_filters:filters,p_offset:(page-1)*FOLLOWUP_PAGE_SIZE,p_limit:FOLLOWUP_PAGE_SIZE}));
 const result=followupPageSchema.parse(data);
 return <main className="mx-auto max-w-[1500px] px-5 py-7"><ReferralQueue items={result.rows.map(row=>referralItemSchema.parse(row))} rosterNames={result.roster} branches={result.branches} role={result.profile.role} branchId={null} enteredByName={result.profile.name} paging={{page,total:result.total,counts:result.counts,statuses:result.statuses,hasOffRoster:result.has_off_roster,filters}}/></main>;
}
