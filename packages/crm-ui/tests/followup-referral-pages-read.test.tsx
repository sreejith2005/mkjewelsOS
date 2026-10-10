import { expect,it,vi } from 'vitest';
import FollowupsPage from '@/app/(crm)/followups/page';
import ReferralsPage from '@/app/(crm)/referrals/page';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mock.rpc})}));
vi.mock('@/components/followup-queue',()=>({FollowupQueue:()=>null}));
vi.mock('@/components/referral-queue',()=>({ReferralQueue:()=>null}));
const snapshot={profile:{role:'salesperson',name:'Tester'},rows:[],total:1201,counts:{today:401,pending:801,done:400,inprocess:0,converted:0},roster:['NEEL','RIYA SHAH'],branches:[{id:'b1',name:'Bandra'}],statuses:['PENDING','HISTORICAL'],has_off_roster:true};
it.each([['not_bought',FollowupsPage],['referral',ReferralsPage]] as const)('%s retains global counts/roster on a later bounded page',async(kind,Page)=>{
 mock.rpc.mockResolvedValue({data:snapshot,error:null});
 const element=await Page({searchParams:Promise.resolve({page:'22',tab:'pending',crm:'NEEL'})});
 const props=kind==='not_bought'?element.props:element.props.children.props;
 expect(props.items).toEqual([]);
 expect(props.paging).toMatchObject({page:22,total:1201,counts:snapshot.counts,statuses:snapshot.statuses,hasOffRoster:true});
 expect(props[kind==='not_bought'?'crmNames':'rosterNames']).toEqual(['NEEL','RIYA SHAH']);
 expect(props.branches).toEqual(snapshot.branches);
 expect(mock.rpc).toHaveBeenCalledWith('browse_crm_followups',{p_kind:kind,p_filters:{tab:'pending',crm:'NEEL'},p_offset:1050,p_limit:50});
});
