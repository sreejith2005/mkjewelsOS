begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Contract surface.
select ok(not has_table_privilege('authenticated','public.entry_queue','DELETE'), 'browsers can no longer delete queue rows directly');
select ok(not has_function_privilege('anon','delete_queue_entries(uuid[],text)','EXECUTE'), 'anonymous callers cannot delete queue entries');

insert into branches(id,name) values('20261109-0000-4000-8000-000000000001','Synthetic Queue Delete Branch');
insert into auth.users(id,email) values
  ('20261109-1111-4000-8000-000000000001','qdel-sa@example.invalid'),
  ('20261109-1111-4000-8000-000000000002','qdel-staff@example.invalid'),
  ('20261109-1111-4000-8000-000000000003','qdel-manager@example.invalid');
insert into users(id,name,email,role,branch_id,active) values
  ('20261109-1111-4000-8000-000000000001','QDEL SA','qdel-sa@example.invalid','super_admin',null,true),
  ('20261109-1111-4000-8000-000000000002','QDEL STAFF','qdel-staff@example.invalid','salesperson','20261109-0000-4000-8000-000000000001',true),
  ('20261109-1111-4000-8000-000000000003','QDEL MANAGER','qdel-manager@example.invalid','branch_manager','20261109-0000-4000-8000-000000000001',true);
insert into crm_sso_access_grants(jewelos_user_id,legacy_crm_user_id,crm_auth_user_id,work_email,active)
  select id,id,id,email,true from users where email like 'qdel-%@example.invalid';
insert into clients(client_id,primary_name,primary_phone,last_branch_id) values
  ('20261109-3333-4000-8000-000000000001','QUEUE DEMO CLIENT','+919100900001','20261109-0000-4000-8000-000000000001');
insert into entry_queue(id,token,client_name,mobile,branch_id,status,client_id) values
  ('20261109-2222-4000-8000-000000000001','QD-1','QUEUE DEMO ONE','+919100900001','20261109-0000-4000-8000-000000000001','pending','20261109-3333-4000-8000-000000000001'),
  ('20261109-2222-4000-8000-000000000002','QD-2','QUEUE DEMO TWO','+919100900002','20261109-0000-4000-8000-000000000001','complete',null),
  ('20261109-2222-4000-8000-000000000003','QD-3','QUEUE KEPT','+919100900003','20261109-0000-4000-8000-000000000001','pending',null);
-- Registering created one walk-in sync event per entry; mark them delivered so the delete's own events are visible.
update crm_private.sync_outbox set delivered_at=now() where aggregate_id::text like '20261109-2222-%';
insert into walkin_visit_drafts(entry_queue_id,branch_id,form_family_id,form_version,answers,meta,started_by,updated_by)
  values('20261109-2222-4000-8000-000000000001','20261109-0000-4000-8000-000000000001',gen_random_uuid(),1,'{}','{}',
    '20261109-1111-4000-8000-000000000002','20261109-1111-4000-8000-000000000002');

create function pg_temp.act(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_user)::text,true);
  select set_config('request.jwt.claim.sub',p_user,true);
  select set_config('request.jwt.claim.role','authenticated',true);
$$;
grant execute on function pg_temp.act(text) to authenticated;

set local role authenticated;

-- Staff and branch managers cannot delete queue entries.
select pg_temp.act('20261109-1111-4000-8000-000000000002');
select throws_ok($$select delete_queue_entries(array['20261109-2222-4000-8000-000000000001']::uuid[],'demo')$$, '42501', null, 'a salesperson cannot delete queue entries');
select throws_ok($$delete from entry_queue where id='20261109-2222-4000-8000-000000000001'$$, '42501', null, 'nor delete a queue row directly');
select pg_temp.act('20261109-1111-4000-8000-000000000003');
select throws_ok($$select delete_queue_entries(array['20261109-2222-4000-8000-000000000001']::uuid[],'demo')$$, '42501', null, 'a branch manager cannot delete queue entries');

-- Super Admin deletes several at once, from both tabs.
select pg_temp.act('20261109-1111-4000-8000-000000000001');
select throws_ok($$select delete_queue_entries('{}'::uuid[],'demo')$$, '22023', null, 'at least one entry must be chosen');
select is(delete_queue_entries(array['20261109-2222-4000-8000-000000000001','20261109-2222-4000-8000-000000000002','20261109-2222-4000-8000-000000000001','20261109-2222-4000-8000-0000000000ff']::uuid[],'Demo walk-ins')->>'deleted',
  '2', 'Super Admin deletes the chosen waiting and submitted entries in one go');
reset role;
select is((select count(*)::int from entry_queue where id::text like '20261109-2222-%'), 1, 'only the chosen entries are removed');
select ok(exists(select 1 from entry_queue where id='20261109-2222-4000-8000-000000000003'), 'the other entry stays in the queue');
select ok(exists(select 1 from clients where client_id='20261109-3333-4000-8000-000000000001'), 'the client record is kept');
select ok(not exists(select 1 from walkin_visit_drafts where entry_queue_id='20261109-2222-4000-8000-000000000001'), 'the unfinished walk-in form draft goes with its entry');
select is((select count(*)::int from crm_private.audit_logs where action='crm.delete_queue_entry' and record_id::text like '20261109-2222-%'), 2, 'each removed entry is audited');
select is((select details->>'reason' from crm_private.audit_logs where action='crm.delete_queue_entry' and record_id='20261109-2222-4000-8000-000000000001'), 'Demo walk-ins', 'with the reason given');
select is((select count(*)::int from crm_private.sync_outbox where aggregate_id::text like '20261109-2222-%' and delivered_at is null), 2, 'JewelOS is told each entry is gone');
select is((crm_private.walkin_snapshot('20261109-2222-4000-8000-000000000001')->>'present')::boolean, false, 'so it closes the entry''s walk-in task');

select * from finish();
rollback;
