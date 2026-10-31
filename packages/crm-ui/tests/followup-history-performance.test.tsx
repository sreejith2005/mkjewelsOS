// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { FollowupHistory } from '@/components/followup-history';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc:mock.rpc})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('keeps older calls reachable through bounded history pages',async()=>{
 mock.rpc.mockResolvedValueOnce({data:{total:101,rows:[{id:'h1',text:'Newest call'}]},error:null}).mockResolvedValueOnce({data:{total:101,rows:[{id:'h101',text:'Oldest call'}]},error:null});
 render(<FollowupHistory kind="not_bought" id="f1"/>);
 await screen.findByText('Newest call');fireEvent.click(screen.getByText('OLDER HISTORY'));
 await screen.findByText('Oldest call');
 expect(mock.rpc).toHaveBeenLastCalledWith('read_crm_followup_history',{p_kind:'not_bought',p_id:'f1',p_offset:100,p_limit:100});
 expect(screen.getByText('NEWER HISTORY')).toBeTruthy();
});
it('offers retry after a failed history request',async()=>{
 mock.rpc.mockResolvedValueOnce({data:null,error:{message:'offline'}}).mockResolvedValueOnce({data:{total:0,rows:[]},error:null});
 render(<FollowupHistory kind="referral" id="r1"/>);
 await screen.findByRole('alert');fireEvent.click(screen.getByText('Retry'));
 await waitFor(()=>expect(screen.getByText('No logged history.')).toBeTruthy());
});
