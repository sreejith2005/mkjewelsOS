// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const rpc=vi.fn();const refresh=vi.fn();
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc})}));
vi.mock('@/next-shim/navigation',()=>({useRouter:()=>({refresh})}));
import {ClientActivity} from '@/components/client-activity';
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('shows saved lead answers and followups in one history',()=>{
 render(<ClientActivity clientId="client" activity={[{activity_id:'lead:1',client_id:'client',occurred_at:'2026-01-01Z',kind:'LEAD_REGISTERED',channel:'Instagram',actor_id:null,branch_id:null,note:'Synthetic',details:{dob:'1990-02-03',custom_answer:'Keep this'},is_contact:true,source_table:'leads',source_id:'1'}]}/>);
 expect(screen.getByText('Keep this')).toBeTruthy();
 expect(screen.getByText('1990-02-03')).toBeTruthy();
});
it('records a thank-you contact through the audited server contract',async()=>{
 rpc.mockResolvedValue({data:{id:'contact'},error:null});
 render(<ClientActivity clientId="client" activity={[]}/>);
 fireEvent.change(screen.getByLabelText('Contact type'),{target:{value:'THANK_YOU'}});
 fireEvent.change(screen.getByLabelText('Contact notes'),{target:{value:'Thank-you sent'}});
 fireEvent.click(screen.getByRole('button',{name:'Record contact'}));
 await waitFor(()=>expect(rpc).toHaveBeenCalledWith('record_crm_contact',expect.objectContaining({p_client:'client',p_kind:'THANK_YOU',p_note:'Thank-you sent',p_request:expect.any(String)})));
 expect(refresh).toHaveBeenCalled();
});

it('keeps retry identity for the same contact and allows changed notes as another contact',async()=>{
 rpc.mockResolvedValue({data:null,error:{code:'network'}});
 render(<ClientActivity clientId="client" activity={[]}/>);
 fireEvent.change(screen.getByLabelText('Contact notes'),{target:{value:'First contact'}});
 fireEvent.click(screen.getByRole('button',{name:'Record contact'}));
 await screen.findByRole('status');
 const firstKey=rpc.mock.calls[0][1].p_request;
 fireEvent.click(screen.getByRole('button',{name:'Record contact'}));
 await waitFor(()=>expect(rpc).toHaveBeenCalledTimes(2));
 expect(rpc.mock.calls[1][1].p_request).toBe(firstKey);
 await waitFor(()=>expect((screen.getByRole('button',{name:'Record contact'}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('Contact notes'),{target:{value:'Second contact'}});
 fireEvent.click(screen.getByRole('button',{name:'Record contact'}));
 await waitFor(()=>expect(rpc).toHaveBeenCalledTimes(3));
 expect(rpc.mock.calls[2][1].p_request).not.toBe(firstKey);
});
