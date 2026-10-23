// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const rpc = vi.fn();
const upload = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc, storage: { from: () => ({ upload, remove: async () => ({ error: null }) }) }, from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }));
vi.mock('@/next-shim/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { WalkInForm } from '@/components/walk-in-form';
import type { Client } from '@/lib/supabase/app-types';
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function form(id: string, client: Partial<Client>) {
  // Only profile fields consumed by this form are needed for this synthetic fixture.
  return <WalkInForm profile={{ role: 'salesperson', branchId: 'branch', name: 'Staff' }} branches={[{ id: 'branch', name: 'Branch' }]} crms={[]} queue={{ id, client_id: client.client_id!, client_name: client.primary_name!, mobile: client.primary_phone!, branch_id: 'branch', assigned_crm_name: null, status: 'pending' }} client={client as Client} />;
}
it('does not label blank stored fields as auto-filled', () => {
  render(form('queue-a', { client_id: 'a', primary_name: 'Synthetic A', primary_phone: '919012345678', address: '', dob: null, pincode: null }));
  fireEvent.click(screen.getByRole('button', { name: '2. Profile' }));
  for (const label of ['Address', 'Pincode', 'Date of birth']) {
    expect(screen.getByLabelText(label).closest('label')?.textContent).not.toContain('Auto-filled');
  }
});
it('does not label empty phone-lookup values as auto-filled', async () => {
  rpc.mockResolvedValue({ data: [{ client_id: 'a', primary_name: 'Synthetic A', primary_phone: '919012345678' }], error: null });
  render(<WalkInForm profile={{ role: 'salesperson', branchId: 'branch', name: 'Staff' }} branches={[{ id: 'branch', name: 'Branch' }]} crms={[]} queue={null} client={null} />);
  fireEvent.change(screen.getByLabelText('Mobile *'), { target: { value: '9012345678' } });
  await waitFor(() => expect((screen.getByLabelText('Client name') as HTMLInputElement).value).toBe('Synthetic A'));
  fireEvent.click(screen.getByRole('button', { name: '2. Profile' }));
  expect(screen.getByLabelText('Address').closest('label')?.textContent).not.toContain('Auto-filled');
});
it('shows a newly registered queue client as new even though its client row already exists', () => {
  const client = { client_id: 'a', primary_name: 'Synthetic A', primary_phone: '919012345678' } as Client;
  render(<WalkInForm profile={{ role: 'salesperson', branchId: 'branch', name: 'Staff' }} branches={[]} crms={[]} queue={{ id: 'new-queue', client_id: 'a', client_name: client.primary_name, mobile: client.primary_phone!, branch_id: 'branch', assigned_crm_name: null, status: 'pending', client_is_new: true }} client={client} />);
  expect(screen.queryByText('Existing client detected')).toBeNull();
  expect(screen.getByText('New client')).toBeTruthy();
});
it('loads the next queue client on the same route without retaining the previous draft', () => {
  const view = render(form('queue-a', { client_id: 'a', primary_name: 'Synthetic A', primary_phone: '919012345678', address: 'Address A' }));
  fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Unsaved A' } });
  view.rerender(form('queue-b', { client_id: 'b', primary_name: 'Synthetic B', primary_phone: '919012345678', address: 'Address B' }));
  expect((screen.getByLabelText('Client name') as HTMLInputElement).value).toBe('Synthetic B');
  fireEvent.click(screen.getByRole('button', { name: '2. Profile' }));
  expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('Address B');
  expect(rpc).not.toHaveBeenCalled();
});
it('keeps unsaved edits when the same queue entry refreshes', () => {
  const client = { client_id: 'a', primary_name: 'Synthetic A', primary_phone: '919012345678' };
  const view = render(form('queue-a', client));
  fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Unsaved A' } });
  view.rerender(form('queue-a', { ...client, primary_name: 'Refreshed A' }));
  expect((screen.getByLabelText('Client name') as HTMLInputElement).value).toBe('Unsaved A');
});
it('prefills saved occupation and wedding planning from accumulated visit answers', () => {
  render(form('queue-a', { client_id: 'a', primary_name: 'Synthetic A', primary_phone: '919012345678', walkin_defaults: { occupation: 'ENGINEER', bridal_or_non_bridal: 'BRIDAL', wedding_month: '2', wedding_year: '2027' } } as Partial<Client>));
  fireEvent.click(screen.getByRole('button', { name: '2. Profile' }));
  expect((screen.getByLabelText('Occupation') as HTMLSelectElement).value).toBe('ENGINEER');
  expect((screen.getByLabelText('Bridal / non-bridal') as HTMLSelectElement).value).toBe('BRIDAL');
});
it('keeps the explicit country code when a stored international billing phone becomes input again', () => {
  render(form('queue-a', { client_id: 'a', primary_name: 'Synthetic A', primary_phone: '919012345678', billing_phone: '6591234567' }));
  fireEvent.click(screen.getByRole('button', { name: '2. Profile' }));
  expect((screen.getByLabelText('Billing phone') as HTMLInputElement).value).toBe('+65 91234567');
});
it('uploads proof under the newly resolved client when the phone is corrected', async () => {
  rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'lookup_client_profile_by_phone' ? [{ client_id: '20000000-0000-4000-8000-000000000002', primary_name: 'Synthetic B', primary_phone: '919012345679' }] : {}, error: null }));
  upload.mockResolvedValue({ error: null });
  render(form('queue-a', { client_id: '20000000-0000-4000-8000-000000000001', primary_name: 'Synthetic A', primary_phone: '919012345678' }));
  fireEvent.change(screen.getByLabelText('Mobile *'), { target: { value: '9012345679' } });
  fireEvent.click(screen.getByRole('button', { name: '6. Preferences & planning' }));
  fireEvent.change(screen.getByLabelText('Remark photo 1'), { target: { files: [new File(['proof'], 'proof.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect(upload).toHaveBeenCalled());
  expect(upload.mock.calls[0][0]).toMatch(/^20000000-0000-4000-8000-000000000002\//);
});
it('shows actual stored address and birth date for the anchored client sharing a phone', async () => {
  rpc.mockResolvedValue({ data: [{ client_id: 'family-member', primary_name: 'Another person' }], error: null });
  render(form('queue-a', { client_id: 'a', primary_name: 'Synthetic A', primary_phone: '919012345678', address: 'Saved address', dob: '1990-01-02' }));
  fireEvent.click(screen.getByRole('button', { name: '2. Profile' }));
  await waitFor(() => expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('Saved address'));
  expect((screen.getByLabelText('Date of birth') as HTMLInputElement).value).toBe('1990-01-02');
  expect(rpc).not.toHaveBeenCalled();
});
