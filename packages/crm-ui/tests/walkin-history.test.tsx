// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,describe,it,expect,vi } from 'vitest';
const signed = vi.fn();
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({storage:{from:()=>({createSignedUrl:signed})}})}));
import { WalkinHistory } from '@/components/walkin-history';
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('persisted walk-in history',()=>{
  it('shows submitted fields, nested product tags, exact engagement answers and media purpose',async()=>{
    signed.mockResolvedValue({data:{signedUrl:'https://example.invalid/private-proof'},error:null});
    render(<WalkinHistory visits={[{timelineId:'visit-1',reference:'REF-1',form:{occupation:'Business',category_details:{seen_tags:['TAG-987'],new_things_count:'2'},additional_fields:{engagement_answers:{instagram:'CLIENT_ALREADY_FOLLOWING_US'},submitted_fields:{billing_phone:'9100700002',gift_other:'Personal gift'}}},documents:[{id:'doc-1',file_name:'testimonial.mov',storage_path:'private/path',mime_type:'video/quicktime',purpose:'testimonial'}]}]} />);
    expect(screen.getByText('TAG-987')).toBeTruthy();
    expect(screen.getByText('CLIENT_ALREADY_FOLLOWING_US')).toBeTruthy();
    expect(screen.getByText('Personal gift')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:/testimonial.mov/}));
    expect(await screen.findByRole('link',{name:/Open testimonial.mov/})).toBeTruthy();
    expect(signed).toHaveBeenCalledWith('private/path',300);
  });
  it('reports signed media failures without hiding the saved document',async()=>{
    signed.mockResolvedValue({data:null,error:{message:'denied'}});
    render(<WalkinHistory visits={[{timelineId:'v',reference:'R',form:null,documents:[{id:'d',file_name:'proof.jpg',storage_path:'p',mime_type:'image/jpeg',purpose:null}]}]} />);
    fireEvent.click(screen.getByRole('button',{name:/proof.jpg/}));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/proof.jpg/)).toBeTruthy();
  });
});
