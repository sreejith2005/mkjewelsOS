import { expect, it, vi } from 'vitest';
import ClientsPage from '@/app/(crm)/clients/page';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(()=>{throw new Error('A page must not download entire tables');})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc,from:mocks.from,auth:{getUser:async()=>({data:{user:{id:'test'}}})}})}));
vi.mock('@/components/followup-queue',()=>({FollowupQueue:()=>null}));
vi.mock('@/components/referral-queue',()=>({ReferralQueue:()=>null}));
const snapshot={profile:{role:'salesperson',name:'Tester'},rows:[],total:120001,counts:{today:120001,pending:120001,inprocess:0,done:0,converted:0},roster:['NEEL'],branches:[],statuses:['PENDING'],has_off_roster:false};
// Not Bought and referral views of Client Database (2026-11-04) read one bounded server page each.
it.each([['not_bought','not_bought'],['referrals_received','referral'],['referrals_given','referral']] as const)('%s loads a bounded server page with global filters',async(preset,kind)=>{
 mocks.rpc.mockReset();mocks.rpc.mockResolvedValue({data:snapshot,error:null});
 await ClientsPage({searchParams:Promise.resolve({preset,tab:'pending',search:'9999',page:'3',sort:'newest'})});
 expect(mocks.rpc).toHaveBeenCalledTimes(1);
 expect(mocks.rpc).toHaveBeenCalledWith('browse_crm_followups',{p_kind:kind,p_filters:{tab:'pending',search:'9999',sort:'newest'},p_offset:100,p_limit:50});
 expect(mocks.from).not.toHaveBeenCalled();
});
it('Referrals given are ordered by the referring client unless another order is chosen',async()=>{
 mocks.rpc.mockReset();mocks.rpc.mockResolvedValue({data:snapshot,error:null});
 await ClientsPage({searchParams:Promise.resolve({preset:'referrals_given',tab:'pending'})});
 expect(mocks.rpc).toHaveBeenCalledWith('browse_crm_followups',{p_kind:'referral',p_filters:{tab:'pending',sort:'given_by'},p_offset:0,p_limit:50});
});
