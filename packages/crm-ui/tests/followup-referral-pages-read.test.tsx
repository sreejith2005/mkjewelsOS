import { expect,it,vi } from 'vitest';
import ClientsPage from '@/app/(crm)/clients/page';
import FollowupsPage from '@/app/(crm)/followups/page';
import ReferralsPage from '@/app/(crm)/referrals/page';
import { CrmRedirect } from '@/crm-port/runtime';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mock.rpc})}));
vi.mock('@/components/followup-queue',()=>({FollowupQueue:()=>null}));
vi.mock('@/components/referral-queue',()=>({ReferralQueue:()=>null}));
const snapshot={profile:{role:'salesperson',name:'Tester'},rows:[],total:1201,counts:{today:401,pending:801,done:400,inprocess:0,converted:0},roster:['NEEL','RIYA SHAH'],branches:[{id:'b1',name:'Bandra'}],statuses:['PENDING','HISTORICAL'],has_off_roster:true};
it.each([['not_bought','not_bought'],['referrals_received','referral']] as const)('%s retains global counts/roster on a later bounded page',async(preset,kind)=>{
 mock.rpc.mockResolvedValue({data:snapshot,error:null});
 const workspace=await ClientsPage({searchParams:Promise.resolve({preset,page:'22',tab:'pending',crm:'NEEL'})});
 const props=workspace.props.children.props;
 expect(workspace.props.preset).toBe(preset);
 expect(props.embedded).toBe(true);
 expect(props.items).toEqual([]);
 expect(props.paging).toMatchObject({page:22,total:1201,counts:snapshot.counts,statuses:snapshot.statuses,hasOffRoster:true,preset});
 expect(props[kind==='not_bought'?'crmNames':'rosterNames']).toEqual(['NEEL','RIYA SHAH']);
 expect(props.branches).toEqual(snapshot.branches);
 expect(mock.rpc).toHaveBeenCalledWith('browse_crm_followups',{p_kind:kind,p_filters:{tab:'pending',crm:'NEEL'},p_offset:1050,p_limit:50});
});
// Old bookmarks land inside Client Database with their tab, filters, search and page.
it.each([[FollowupsPage,'not_bought'],[ReferralsPage,'referrals_received']] as const)('an old list address redirects into Client Database (%#)',async(Page,preset)=>{
 const thrown=await Page({searchParams:Promise.resolve({tab:'done',crm:'NEEL',search:'98',page:'4',ignored:'x'})}).catch((error:unknown)=>error);
 expect(thrown).toBeInstanceOf(CrmRedirect);
 expect((thrown as CrmRedirect).path).toBe(`/clients?preset=${preset}&tab=done&crm=NEEL&search=98&page=4`);
});
