// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type React from 'react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/next-shim/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/next-shim/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => <a {...rest} href={`/crm${href}`}>{children}</a> }));
import { ClientActivity, type ClientActivityRow } from '@/components/client-activity';
import { CustomerLifecycle } from '@/components/customer-lifecycle';
import { journeyGroup, journeySources, journeyTitle } from '@/lib/customer-journey';
import { ClientHistoryPager } from '@/components/client-history-pager';
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const base = { client_id: 'c', actor_id: null, branch_id: null, note: null, is_contact: true };
const visit: ClientActivityRow = { ...base, activity_id: 'visit:1', occurred_at: '2026-10-05', kind: 'NOT_BOUGHT', channel: 'IN_PERSON', details: {}, source_table: 'client_timeline', source_id: '1' };
const fms: ClientActivityRow = { ...base, activity_id: 'fms:e1', occurred_at: '2026-10-12T05:00:00Z', kind: 'FMS_CUSTOMER_EVENT', channel: 'INSTAGRAM', source_table: 'crm_customer_workflow_events', source_id: 'e1',
  details: { workflow: { stageName: 'Introduction call', actorName: 'Synthetic caller', instanceId: '11111111-1111-4111-8111-111111111111', instanceStageId: '22222222-2222-4222-8222-222222222222', referenceNumber: 'IG-7', assignedEmployees: [{ id: 'u', name: 'Synthetic seller' }] },
    answers: [{ fieldKey: 'field_8', label: 'STATUS', original: 'not_interested', optionLabels: ['DECISION PENDING'] }] } };

it('shows one chronological journey with readable FMS evidence and a link to the work', () => {
  render(<ClientActivity clientId="c" activity={[fms, visit]} />);
  expect(screen.getByRole('heading', { name: 'Customer journey' })).toBeTruthy();
  expect(screen.getByText(/FMS · Introduction call/)).toBeTruthy();
  expect(screen.getByText(/Store visit · NOT BOUGHT/)).toBeTruthy();
  expect(screen.getByText(/Synthetic caller/)).toBeTruthy();
  expect(screen.getByText('Assigned to: Synthetic seller')).toBeTruthy();
  // The saved option label is shown, never the raw token.
  expect(screen.getByText('DECISION PENDING')).toBeTruthy();
  expect(screen.queryByText('not_interested')).toBeNull();
  expect(screen.getByRole('link', { name: 'Open this FMS work' }).getAttribute('href')).toContain('11111111-1111-4111-8111-111111111111');
});

it('offers filters and keeps the selected one when paging', () => {
  render(<><ClientActivity clientId="c" activity={[visit]} journey="visits" /><ClientHistoryPager clientId="c" section="activity" paging={{ visits: 1, activity: 1, audit: 1, hasMoreVisits: false, hasMoreActivity: true, hasMoreAudit: false, journey: 'visits' }} /></>);
  expect(screen.getByRole('link', { name: 'Store visits' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'OLDER ACTIVITY' }).getAttribute('href')).toBe('/crm/clients/c?activity_page=2&journey=visits');
});

it('accepts only known journey filters', () => {
  expect(journeyGroup('fms')).toBe('fms');
  expect(journeyGroup('anything')).toBeNull();
  expect(journeySources(journeyGroup('fms'))).toEqual(['crm_customer_workflow_events']);
  expect(journeySources(null)).toBeNull();
  expect(journeyTitle('LEAD_REGISTERED', 'leads', null)).toBe('Enquiry registered');
});

it('shows Lead until a store visit, and keeps purchase evidence separate', async () => {
  mocks.rpc.mockResolvedValue({ data: { classification: 'Non-Buyer/Prospect' }, error: null });
  const view = render(<CustomerLifecycle clientId="c" lifecycleStage="lead" totalVisits={0} />);
  expect(screen.getByText('LEAD')).toBeTruthy();
  view.rerender(<CustomerLifecycle clientId="c" lifecycleStage="lead" totalVisits={1} />);
  expect(screen.getByText('CLIENT')).toBeTruthy();
  expect(await screen.findByText('Purchase evidence: Non-Buyer/Prospect')).toBeTruthy();
});

it('marks legacy client records that have no recorded visit', () => {
  mocks.rpc.mockResolvedValue({ data: { classification: 'Unknown' }, error: null });
  render(<CustomerLifecycle clientId="c" lifecycleStage="visited" totalVisits={0} />);
  expect(screen.getByText(/client record without a recorded store visit/)).toBeTruthy();
});

const store: ClientActivityRow = { ...base, is_contact: false, activity_id: 'store:l1', occurred_at: '2026-11-05T05:00:00Z', kind: 'STORE_CONVERSATION', channel: 'IN_PERSON', note: 'Store conversation recorded',
  source_table: 'crm_store_conversations', source_id: 'l1', details: { jewelosPath: '/sales-recording/conversations/33333333-3333-4333-8333-333333333333', durationSeconds: 420, salespersonName: 'Synthetic seller' } };

it('shows a Store Intelligence conversation as a read-only visit entry that links back to JewelOS', () => {
  render(<ClientActivity clientId="c" activity={[store]} />);
  expect(screen.getAllByText(/Store conversation/).length).toBeGreaterThan(0);
  expect(screen.getByText(/about 7 min · Synthetic seller/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open conversation' }).getAttribute('href')).toBe('/sales-recording/conversations/33333333-3333-4333-8333-333333333333');
  expect(screen.queryByText(/transcript:/i)).toBeNull();
  expect(journeyTitle('STORE_CONVERSATION', 'crm_store_conversations', null)).toBe('Store conversation');
  expect(journeySources('visits')).toContain('crm_store_conversations');
});

it('never renders a link the CRM row did not prove to be a Store Intelligence conversation', () => {
  for (const jewelosPath of ['https://example.invalid/sales-recording/conversations/33333333-3333-4333-8333-333333333333', '/sales-recording/conversations/../../admin', 'javascript:alert(1)']) {
    cleanup();
    render(<ClientActivity clientId="c" activity={[{ ...store, details: { ...(store.details as object), jewelosPath } }]} />);
    expect(screen.queryByRole('link', { name: 'Open conversation' })).toBeNull();
  }
});
