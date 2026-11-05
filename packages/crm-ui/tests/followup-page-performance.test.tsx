import { expect,it,vi } from 'vitest';
import ClientsPage from '@/app/(crm)/clients/page';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mock.rpc})}));
vi.mock('@/components/followup-queue',()=>({FollowupQueue:()=>null}));
it('does not turn a failed Not Bought read into an empty successful screen',async()=>{
 const error={message:'Failed to fetch',code:''};mock.rpc.mockResolvedValue({data:null,error});
 await expect(ClientsPage({searchParams:Promise.resolve({preset:'not_bought'})})).rejects.toBe(error);
});
