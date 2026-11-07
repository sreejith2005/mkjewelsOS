begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Contract surface.
select ok(not has_table_privilege('authenticated','public.clients','DELETE'), 'browsers can no longer delete client rows');
select ok(not has_function_privilege('anon','archive_client(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','restore_client(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','get_client_archive_state(uuid)','EXECUTE'), 'anonymous callers cannot archive, restore or read archive state');

insert into branches(id,name) values('20261107-0000-4000-8000-000000000001','Synthetic Archive Branch');
insert into auth.users(id,email) values
  ('20261107-1111-4000-8000-000000000001','archive-sa@example.invalid'),
  ('20261107-1111-4000-8000-000000000002','archive-staff@example.invalid'),
  ('20261107-1111-4000-8000-000000000003','archive-manager@example.invalid');
insert into users(id,name,email,role,branch_id,active) values
  ('20261107-1111-4000-8000-000000000001','ARCHIVE SA','archive-sa@example.invalid','super_admin',null,true),
  ('20261107-1111-4000-8000-000000000002','ARCHIVE STAFF','archive-staff@example.invalid','salesperson','20261107-0000-4000-8000-000000000001',true),
  ('20261107-1111-4000-8000-000000000003','ARCHIVE MANAGER','archive-manager@example.invalid','branch_manager','20261107-0000-4000-8000-000000000001',true);
insert into crm_sso_access_grants(jewelos_user_id,legacy_crm_user_id,crm_auth_user_id,work_email,active)
  select id,id,id,email,true from users where email like 'archive-%@example.invalid';
insert into clients(client_id,primary_name,primary_phone,last_branch_id) values
  ('20261107-3333-4000-8000-000000000001','ARCHIVE TEST CLIENT','+919100700001','20261107-0000-4000-8000-000000000001'),
  ('20261107-3333-4000-8000-000000000002','KEPT TEST CLIENT','+919100700002','20261107-0000-4000-8000-000000000001');

create function pg_temp.act(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_user)::text,true);
  select set_config('request.jwt.claim.sub',p_user,true);
  select set_config('request.jwt.claim.role','authenticated',true);
$$;
create function pg_temp.listed(p_filters jsonb) returns integer language sql as $$
  select count(*)::int from jsonb_array_elements(public.browse_crm_records_page(p_filters,0,200)->'rows') r
  where r->>'client_id' in ('20261107-3333-4000-8000-000000000001','20261107-3333-4000-8000-000000000002');
$$;
grant execute on function pg_temp.act(text), pg_temp.listed(jsonb) to authenticated;

set local role authenticated;

-- Staff and branch managers cannot archive, and cannot set the archive fields directly.
select pg_temp.act('20261107-1111-4000-8000-000000000002');
select throws_ok($$select archive_client('20261107-3333-4000-8000-000000000001','duplicate record')$$, '42501', null, 'a salesperson cannot archive');
select throws_ok($$update clients set archived_at=now() where client_id='20261107-3333-4000-8000-000000000001'$$, '42501', null, 'nor set the archive fields directly');
select throws_ok($$delete from clients where client_id='20261107-3333-4000-8000-000000000001'$$, '42501', null, 'nor delete the client');
select is((get_client_archive_state('20261107-3333-4000-8000-000000000001')->>'can_archive')::boolean, false, 'staff are not offered Archive');
select pg_temp.act('20261107-1111-4000-8000-000000000003');
select throws_ok($$select archive_client('20261107-3333-4000-8000-000000000001','duplicate record')$$, '42501', null, 'a branch manager cannot archive');

-- Super Admin: even the Super Admin cannot hard-delete through the API.
select pg_temp.act('20261107-1111-4000-8000-000000000001');
select throws_ok($$delete from clients where client_id='20261107-3333-4000-8000-000000000001'$$, '42501', null, 'Super Admin cannot hard-delete a client through the API');
select is(pg_temp.listed('{}'), 2, 'both clients are listed before archiving');
select throws_ok($$select archive_client('20261107-3333-4000-8000-000000000001','  ')$$, '22023', null, 'a reason is required');
select lives_ok($$select archive_client('20261107-3333-4000-8000-000000000001','Duplicate of another client')$$, 'Super Admin archives with a reason');
select throws_ok($$select archive_client('20261107-3333-4000-8000-000000000001','again')$$, '22023', null, 'archiving twice is refused');
select is(pg_temp.listed('{}'), 1, 'the archived client leaves the Client Database list');
select is(pg_temp.listed('{"archived":"only"}'), 1, 'and appears under Archived');
select is((get_client_archive_state('20261107-3333-4000-8000-000000000001')->>'archived_by_name'), 'ARCHIVE SA', 'the archive state says who archived it');

-- Identity lookups still find the archived client (no duplicate on return).
select pg_temp.act('20261107-1111-4000-8000-000000000002');
select is((select count(*)::int from search_clients('+919100700001',8) s where s.client_id='20261107-3333-4000-8000-000000000001'), 1, 'search by phone still finds the archived client');
select is((get_client_archive_state('20261107-3333-4000-8000-000000000001')->>'archived')::boolean, true, 'staff see the client is archived');
-- Ordinary detail edits still save (a returning customer's walk-in never fails).
select lives_ok($$update clients set address='Synthetic address' where client_id='20261107-3333-4000-8000-000000000001'$$, 'staff can still save details of an archived client');
select is((select count(*)::int from clients where client_id='20261107-3333-4000-8000-000000000001' and archived_at is not null), 1, 'which stays archived');
select throws_ok($$select restore_client('20261107-3333-4000-8000-000000000001')$$, '42501', null, 'a salesperson cannot restore');

select pg_temp.act('20261107-1111-4000-8000-000000000001');
select lives_ok($$select restore_client('20261107-3333-4000-8000-000000000001','archived by mistake')$$, 'Super Admin restores');
select is(pg_temp.listed('{}'), 2, 'the restored client is listed again');
reset role;

select is((select count(*)::int from crm_private.audit_logs where record_id='20261107-3333-4000-8000-000000000001' and action in ('crm.archive_client','crm.restore_client')), 2, 'archive and restore are audited');
select is((select count(*)::int from clients where client_id='20261107-3333-4000-8000-000000000001'), 1, 'the client row and its history were never deleted');

select * from finish();
rollback;
