// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/next-shim/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc:vi.fn()})}));
vi.mock('@/next-shim/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
import { FollowupQueue, type FollowupItem } from '@/components/followup-queue';
import { ReferralQueue, type ReferralItem } from '@/components/referral-queue';
const followup:FollowupItem={id:'f',client_id:'c',reference_number:'REF-123',status:'PENDING',next_followup_date:null,remark:null,branch_id:null,client_name:'Synthetic Client',phone:'9100000000',crm_name:'Staff',visit_date:null,reason:'Price',seen_categories:'Ring',product_requirement:'Gift',product_seen_remark:'Saved product note',action_point:'Call later',followup_count:0,history_count:0,remark_history:''};
const referral:ReferralItem={id:'r',status:'PENDING',next_followup_date:null,remark:null,converted_client_id:null,followup_count:0,crm_name:'Staff',assigned_doer:null,given_by_client_id:'c',given_by_name:'Synthetic Client',referral_name:'Synthetic Referral',referral_number:'9100000001',salesperson:'Staff',history:'',history_count:0,action_point:null};
afterEach(cleanup);
it('keeps Not Bought filters collapsed, removes duplicate person search and expands saved details',()=>{
 render(<FollowupQueue items={[followup]} role="crm" branchId={null} crmNames={['Staff']} enteredByName="Staff"/>);
 expect(screen.getByText('Filters').closest('details')?.open).toBe(false);
 expect(screen.queryByPlaceholderText('SEARCH CLIENT / PHONE / REFERENCE')).toBeNull();
 const row=screen.getByText('Synthetic Client').closest('tr')!;
 expect(screen.getByText('Saved product note').closest('td')?.getAttribute('data-secondary')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Show record details'}));
 expect(row.classList.contains('is-expanded')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'FOLLOW UP FORM'}));
 expect(screen.getByLabelText('Follow Up Remark')).toBeTruthy();
});
it('keeps referral filters collapsed and preserves follow-up/history actions within the phone record',()=>{
 render(<ReferralQueue items={[referral]} role="crm" branchId={null} enteredByName="Staff"/>);
 expect(screen.getByText('Filters').closest('details')?.open).toBe(false);
 expect(screen.queryByPlaceholderText('SEARCH REFERRAL / PHONE / GIVEN BY')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Show record details'}));
 expect(screen.getByText('Synthetic Referral').closest('tr')?.classList.contains('is-expanded')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'VIEW HISTORY'}));
 expect(screen.getByText('NO HISTORY YET.')).toBeTruthy();
});
it('links the referred person to their own persisted profile before conversion',()=>{
 render(<ReferralQueue items={[{...referral,referred_client_id:'prospect'}]} role="crm" branchId={null} enteredByName="Staff"/>);
 expect(screen.getByRole('link',{name:'Synthetic Referral'}).getAttribute('href')).toBe('/clients/prospect');
});
