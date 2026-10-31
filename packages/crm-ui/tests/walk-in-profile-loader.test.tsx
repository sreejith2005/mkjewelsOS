// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ isNew: true, error: null as { code: string; message: string } | null, rpc: vi.fn() }));
vi.mock('@/crm-port/master-options', () => ({ loadCrmMasterOptions: async () => ({}) }));
vi.mock('@/crm-port/crm-user', () => ({ getCrmUser: async () => ({ data: { user: { id: 'staff' } }, error: null }) }));
vi.mock('@/components/walk-in-form', () => ({ WalkInForm: ({ client, queue }: { client: { client_id: string; address: string } | null; queue: { client_id: string; client_is_new: boolean } }) => <output>{JSON.stringify({ client, queue })}</output> }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  rpc: (name: string, args: unknown) => {
    state.rpc(name, args);
    const data = name === 'get_my_profile' ? [{ role: 'salesperson' }] : name === 'get_client_profile' || name === 'lookup_client_profile_by_phone' ? [{ client_id: state.isNew ? 'established' : 'registered', address: 'Saved address' }] : [];
    return Object.assign(Promise.resolve({ data, error: state.error }), { single: async () => ({ data: data[0], error: state.error }) });
  },
  from: (table: string) => {
    const data = table === 'entry_queue' ? { id: 'queue', client_id: 'registered', mobile: '919012345678', branch_id: 'branch', status: 'pending', client_is_new: state.isNew } : table === 'users' ? { branch_id: 'branch', name: 'Staff' } : table === 'clients' ? { client_id: 'registered', address: null } : [];
    const response = Promise.resolve({ data, error: null });
    const query = { select: () => query, eq: () => query, order: () => query, single: () => response, then: response.then.bind(response) };
    return query;
  },
}) }));
import NewVisitPage from '@/app/(crm)/visits/new/page';
afterEach(() => { cleanup(); vi.clearAllMocks(); state.isNew = true; state.error = null; });
it('resolves a new sparse queue record to the latest phone profile and keeps the queue assignment', async () => {
  render(await NewVisitPage({ searchParams: Promise.resolve({ queue: 'queue' }) }));
  expect(state.rpc).toHaveBeenCalledWith('lookup_client_profile_by_phone', { p_phone: '+919012345678' });
  const result = JSON.parse(screen.getByRole('status').textContent ?? '{}');
  expect(result.client.address).toBe('Saved address');
  expect(result.queue).toMatchObject({ id: 'queue', client_id: 'established', client_is_new: false });
});
it('reads cumulative details for an established queue identity', async () => {
  state.isNew = false;
  render(await NewVisitPage({ searchParams: Promise.resolve({ queue: 'queue' }) }));
  expect(state.rpc).toHaveBeenCalledWith('get_client_profile', { p_client_id: 'registered' });
});
it('does not render blank successful defaults after an authorization failure', async () => {
  state.error = { code: '42501', message: 'Denied' };
  await expect(NewVisitPage({ searchParams: Promise.resolve({ queue: 'queue' }) })).rejects.toBe(state.error);
});
