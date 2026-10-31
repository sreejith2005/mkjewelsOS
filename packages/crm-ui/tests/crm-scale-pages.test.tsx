import { expect, it, vi } from 'vitest';
import FollowupsPage from '@/app/(crm)/followups/page';
import ReferralsPage from '@/app/(crm)/referrals/page';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(()=>{throw new Error('A page must not download entire tables');})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc,from:mocks.from,auth:{getUser:async()=>({data:{user:{id:'test'}}})}})}));
vi.mock('@/components/followup-queue',()=>({FollowupQueue:()=>null}));
vi.mock('@/components/referral-queue',()=>({ReferralQueue:()=>null}));
const snapshot={profile:{role:'salesperson',name:'Tester'},rows:[],total:120001,counts:{today:120001,pending:120001,inprocess:0,done:0,converted:0},roster:['NEEL'],branches:[],statuses:['PENDING'],has_off_roster:false};
it.each([['not_bought',FollowupsPage],['referral',ReferralsPage]] as const)('%s loads a bounded server page with global filters',async(kind,Page)=>{
 mocks.rpc.mockResolvedValue({data:snapshot,error:null});
 await Page({searchParams:Promise.resolve({tab:'pending',search:'9999',page:'3',sort:'newest'})});
 expect(mocks.rpc).toHaveBeenCalledWith('browse_crm_followups',{p_kind:kind,p_filters:{tab:'pending',search:'9999',sort:'newest'},p_offset:100,p_limit:50});
 expect(mocks.from).not.toHaveBeenCalled();
});
