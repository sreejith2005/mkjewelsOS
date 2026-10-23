// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: vi.fn() }) }));
vi.mock('@/next-shim/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ProfileEditLog, type ProfileEdit } from '@/components/profile-edit-log';
import { WalkinHistory } from '@/components/walkin-history';
import { ClientActivity, type ClientActivityRow } from '@/components/client-activity';
afterEach(cleanup);

it('retains colliding nested answer names without overwriting their original values', () => {
 render(<WalkinHistory visits={[{timelineId:'collision',reference:'C',documents:[],form:{'additional_fields.occupation':'Literal dotted answer',additional_fields:{occupation:'Business',additional_fields:{occupation:'Engineer'}}}}]}/>);
 expect(screen.getByText('Literal dotted answer')).toBeTruthy();
 expect(screen.getByText('Business')).toBeTruthy();
 expect(screen.getByText('Engineer')).toBeTruthy();
});

it('resets contact Show more when switching to another client or server page', () => {
 const rows=(prefix:string):ClientActivityRow[]=>Array.from({length:7},(_,i)=>({activity_id:`${prefix}${i}`,client_id:prefix,occurred_at:null,kind:'NOTE',channel:null,actor_id:null,branch_id:null,note:'Saved',details:{},is_contact:true,source_table:'contacts',source_id:`${i}`}));
 const view=render(<ClientActivity clientId="a" activity={rows('a')}/>);
 fireEvent.click(screen.getByRole('button',{name:'Show more'}));
 expect(screen.getAllByTestId('contact-history-entry')).toHaveLength(7);
 view.rerender(<ClientActivity clientId="b" activity={rows('b')}/>);
 expect(screen.getAllByTestId('contact-history-entry')).toHaveLength(5);
 fireEvent.click(screen.getByRole('button',{name:'Show more'}));
 view.rerender(<ClientActivity clientId="b" activity={rows('page2')}/>);
 expect(screen.getAllByTestId('contact-history-entry')).toHaveLength(5);
});

it('groups only edits with the same timestamp and editor and labels before/after values', () => {
 const base = { created_at: '2026-10-23T10:02:03Z', editor: 'Staff A' };
 const edits: ProfileEdit[] = [
  { ...base, id: 1, field_name: 'city', old_value: null, new_value: 'Mumbai' },
  { ...base, id: 2, field_name: 'gift_history', old_value: false, new_value: { count: 0, notes: ['Gift retained'] } },
  { ...base, id: 3, editor: 'Staff B', field_name: 'address', old_value: '', new_value: 'Another save' },
  { ...base, id: 4, created_at: '2026-10-23T10:02:04Z', field_name: 'city', old_value: 'Mumbai', new_value: 'Pune' },
 ];
 render(<ProfileEditLog edits={edits} />);
 expect(screen.getAllByTestId('profile-edit-entry')).toHaveLength(3);
 const group = screen.getAllByTestId('profile-edit-entry')[0];
 expect(within(group).getByText('2 fields changed')).toBeTruthy();
 fireEvent.click(within(group).getByText('2 fields changed').closest('summary')!);
 expect(within(group).getAllByText('Before')).toHaveLength(2);
 expect(within(group).getAllByText('After')).toHaveLength(2);
 expect(within(group).getByText('Not recorded')).toBeTruthy();
 expect(within(group).getByText('No')).toBeTruthy();
 expect(within(group).getByText('0')).toBeTruthy();
 expect(within(group).getByText('Gift retained')).toBeTruthy();
});

it('shows five edit groups and allows all remaining groups to be read', () => {
 const edits = Array.from({length: 7}, (_,i) => ({id:i, field_name:'city', old_value:'Old', new_value:`City ${i}`, editor:'Staff', created_at:`2026-10-${String(23-i).padStart(2,'0')}T10:00:00Z`}));
 render(<ProfileEditLog edits={edits} />);
 expect(screen.getAllByTestId('profile-edit-entry')).toHaveLength(5);
 fireEvent.click(screen.getByRole('button', {name:/Show more/}));
 expect(screen.getAllByTestId('profile-edit-entry')).toHaveLength(7);
});

it('bounds contact entries without losing saved answers or contact recording controls', () => {
 const activity: ClientActivityRow[] = Array.from({length:7}, (_,i) => ({activity_id:`a${i}`,client_id:'c',occurred_at:'2026-10-23T10:00:00Z',kind:'NOTE',channel:'PHONE',actor_id:null,branch_id:null,note:`Note ${i}`,details:{custom_field:{answer:'Nested retained'}},is_contact:true,source_table:'contacts',source_id:`${i}`}));
 render(<ClientActivity clientId="c" activity={activity} />);
 expect(screen.getAllByTestId('contact-history-entry')).toHaveLength(5);
 fireEvent.click(screen.getByText('Add a contact'));
 expect(screen.getByRole('button', {name:'Record contact'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button', {name:/Show more/}));
 expect(screen.getAllByTestId('contact-history-entry')).toHaveLength(7);
 expect(screen.getAllByText('Nested retained')).toHaveLength(7);
});

it('bounds visits and retains unknown original answers in readable groups', () => {
 const visits = Array.from({length:7}, (_,i) => ({timelineId:`v${i}`,reference:`REF-${i}`,date:'2026-10-23',form:{occupation:'Business',unknown_field:{legacy_answer:'Original retained'},additional_fields:{submitted_fields:{gift_other:'Custom gift'}}},documents:[]}));
 render(<WalkinHistory visits={visits} />);
 expect(screen.getAllByTestId('walkin-history-entry')).toHaveLength(5);
 expect(screen.getAllByText('Preferences & planning').length).toBeGreaterThanOrEqual(5);
 expect(screen.getAllByText('Other saved details')).toHaveLength(5);
 fireEvent.click(screen.getByRole('button', {name:/Show more/}));
 expect(screen.getAllByTestId('walkin-history-entry')).toHaveLength(7);
 expect(screen.getAllByText('Original retained')).toHaveLength(7);
 expect(screen.getAllByText('Custom gift')).toHaveLength(7);
});
