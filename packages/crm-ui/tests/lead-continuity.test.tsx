// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const rpc=vi.fn();
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})})})})}));
vi.mock('@/next-shim/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
import {lookupClientByPhone} from '@/lib/client-phone-lookup';
import {WalkInForm} from '@/components/walk-in-form';
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('uses the extended persisted profile lookup',async()=>{
 rpc.mockResolvedValue({data:[{client_id:'client',anniversary:'2015-04-05',sugar:'NO SUGAR'}],error:null});
 expect((await lookupClientByPhone('9012345678'))?.anniversary).toBe('2015-04-05');
 expect(rpc).toHaveBeenCalledWith('lookup_client_profile_by_phone',{p_phone:'+919012345678'});
});
it('phone recognition carries anniversary and preferences into the walk-in form',async()=>{
 rpc.mockResolvedValue({data:[{client_id:'client',primary_name:'Synthetic Lead',primary_phone:'9012345678',dob:'1990-02-03',anniversary:'2015-04-05',sugar:'NO SUGAR'}],error:null});
 render(<WalkInForm profile={{role:'salesperson',branchId:'branch',name:'Staff'}} branches={[{id:'branch',name:'Branch'}]} crms={[]} queue={null} client={null} lookups={{productCategories:[],notBoughtReasons:[],beverages:[],snacks:[],sugarOptions:['NO SUGAR']}}/>);
 fireEvent.change(screen.getByLabelText('Mobile *'),{target:{value:'9012345678'}});
 await waitFor(()=>expect(rpc).toHaveBeenCalled());
 fireEvent.click(screen.getByRole('button',{name:'2. Profile'}));
 await waitFor(()=>expect((screen.getByLabelText('Anniversary') as HTMLInputElement).value).toBe('2015-04-05'));
 fireEvent.click(screen.getByRole('button',{name:'6. Preferences & planning'}));
 expect((screen.getByLabelText('Sugar') as HTMLSelectElement).value).toBe('NO SUGAR');
});

it('keeps country-coded identity intact for international lead lookup',async()=>{
 rpc.mockResolvedValue({data:[{client_id:'international'}],error:null});
 await lookupClientByPhone('+65 9123 4567');
 expect(rpc).toHaveBeenCalledWith('lookup_client_profile_by_phone',{p_phone:'+6591234567'});
});
it('master Other gift labels retain their free-text detail',()=>{
 render(<WalkInForm profile={{role:'salesperson',branchId:'branch',name:'Staff'}} branches={[{id:'branch',name:'Branch'}]} crms={[]} queue={null} client={null} lookups={{productCategories:[],notBoughtReasons:[],beverages:[],snacks:[],gifts:['OTHER:']}}/>);
 fireEvent.click(screen.getByRole('button',{name:'6. Preferences & planning'}));
 fireEvent.change(screen.getByLabelText('Gift given'),{target:{value:'OTHER:'}});
 expect(screen.getByLabelText('Other gift')).toBeTruthy();
});
