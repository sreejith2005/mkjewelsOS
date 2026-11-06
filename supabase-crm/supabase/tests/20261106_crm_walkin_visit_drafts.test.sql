begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Contract surface: no direct table access; the functions are for signed-in CRM users only.
select ok(not has_table_privilege('authenticated','public.walkin_visit_drafts','SELECT') and not has_table_privilege('anon','public.walkin_visit_drafts','SELECT'), 'drafts are not readable directly');
select ok(not has_table_privilege('authenticated','public.walkin_visit_drafts','INSERT'), 'drafts are not writable directly');
select ok((select relrowsecurity from pg_class where oid='public.walkin_visit_drafts'::regclass), 'drafts have row level security');
select ok(has_function_privilege('authenticated','save_walkin_visit_draft(uuid,uuid,integer,jsonb,jsonb)','EXECUTE'), 'CRM users can save a draft');
select ok(not has_function_privilege('anon','save_walkin_visit_draft(uuid,uuid,integer,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('anon','get_walkin_visit_draft(uuid)','EXECUTE')
  and not has_function_privilege('anon','get_walkin_visit_draft_markers(uuid[])','EXECUTE')
  and not has_function_privilege('anon','discard_walkin_visit_draft(uuid)','EXECUTE'), 'anonymous callers cannot use drafts');

insert into branches(id,name) values('20261106-0000-4000-8000-000000000001','Synthetic Draft Branch'),('20261106-0000-4000-8000-000000000002','Synthetic Other Branch');
insert into auth.users(id,email) values
  ('20261106-1111-4000-8000-000000000001','draft-staff@example.invalid'),
  ('20261106-1111-4000-8000-000000000002','draft-other@example.invalid'),
  ('20261106-1111-4000-8000-000000000003','draft-inactive@example.invalid');
insert into users(id,name,email,role,branch_id,active) values
  ('20261106-1111-4000-8000-000000000001','DRAFT STAFF','draft-staff@example.invalid','salesperson','20261106-0000-4000-8000-000000000001',true),
  ('20261106-1111-4000-8000-000000000002','OTHER STAFF','draft-other@example.invalid','salesperson','20261106-0000-4000-8000-000000000002',true),
  ('20261106-1111-4000-8000-000000000003','INACTIVE STAFF','draft-inactive@example.invalid','salesperson','20261106-0000-4000-8000-000000000001',false);
insert into crm_sso_access_grants(jewelos_user_id,legacy_crm_user_id,crm_auth_user_id,work_email,active)
  select id,id,id,email,true from users where email like 'draft-%@example.invalid';
insert into entry_queue(id,token,client_name,mobile,branch_id,status) values
  ('20261106-2222-4000-8000-000000000001','D1','Draft Client','+919100800001','20261106-0000-4000-8000-000000000001','pending'),
  ('20261106-2222-4000-8000-000000000002','D2','Second Client','+919100800002','20261106-0000-4000-8000-000000000001','pending');

create function pg_temp.act(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_user)::text,true);
  select set_config('request.jwt.claim.sub',p_user,true);
  select set_config('request.jwt.claim.role','authenticated',true);
$$;
grant execute on function pg_temp.act(text) to authenticated;

set local role authenticated;
select pg_temp.act('20261106-1111-4000-8000-000000000001');

-- Branch staff start and keep saving a draft; only the start is audited.
select ok((save_walkin_visit_draft('20261106-2222-4000-8000-000000000001','20261106-5555-4000-8000-000000000001',3,'{"q1":"Gold"}','{"submissionKey":"20261106-7777-4000-8000-000000000001"}')->>'started_at') is not null, 'branch staff can start a draft');
select ok((save_walkin_visit_draft('20261106-2222-4000-8000-000000000001','20261106-5555-4000-8000-000000000001',3,'{"q1":"Gold","q2":"Ring"}','{}')->>'updated_at') is not null, 'the next autosave overwrites it');
select is(get_walkin_visit_draft('20261106-2222-4000-8000-000000000001')->'answers', '{"q1":"Gold","q2":"Ring"}'::jsonb, 'the latest answers are kept');
select is(get_walkin_visit_draft('20261106-2222-4000-8000-000000000001')->>'started_by_name', 'DRAFT STAFF', 'the draft says who started it');
select is(get_walkin_visit_draft('20261106-2222-4000-8000-000000000002'), null, 'an entry without a draft has none');
select is((select count(*)::int from get_walkin_visit_draft_markers(array['20261106-2222-4000-8000-000000000001','20261106-2222-4000-8000-000000000002']::uuid[])), 1, 'the queue marker lists the started entry only');
select throws_ok($$select save_walkin_visit_draft('20261106-2222-4000-8000-000000000001','20261106-5555-4000-8000-000000000001',3,'[]','{}')$$, '22023', null, 'answers must be an object');
select throws_ok($$select save_walkin_visit_draft('20261106-2222-4000-8000-000000000001',null,3,'{}','{}')$$, '22023', null, 'the form must be named');
select throws_ok($$select * from get_walkin_visit_draft_markers(array_fill('20261106-2222-4000-8000-000000000001'::uuid, array[201]))$$, '22023', null, 'the marker read is bounded');

-- Another branch's staff cannot see, read, write or discard it.
select pg_temp.act('20261106-1111-4000-8000-000000000002');
select throws_ok($$select get_walkin_visit_draft('20261106-2222-4000-8000-000000000001')$$, '42501', null, 'other-branch staff cannot read the draft');
select throws_ok($$select save_walkin_visit_draft('20261106-2222-4000-8000-000000000001','20261106-5555-4000-8000-000000000001',3,'{}','{}')$$, '42501', null, 'other-branch staff cannot overwrite the draft');
select throws_ok($$select discard_walkin_visit_draft('20261106-2222-4000-8000-000000000001')$$, '42501', null, 'other-branch staff cannot discard the draft');
select is((select count(*)::int from get_walkin_visit_draft_markers(array['20261106-2222-4000-8000-000000000001']::uuid[])), 0, 'other-branch staff see no marker');

-- An inactive person and an unknown caller have no access.
select pg_temp.act('20261106-1111-4000-8000-000000000003');
select throws_ok($$select get_walkin_visit_draft('20261106-2222-4000-8000-000000000001')$$, '42501', null, 'an inactive person cannot read drafts');
select pg_temp.act('20261106-1111-4000-8000-000000000099');
select throws_ok($$select * from get_walkin_visit_draft_markers(array['20261106-2222-4000-8000-000000000001']::uuid[])$$, '42501', null, 'a caller without CRM access cannot list markers');

-- Discard ("Start over") is audited and leaves the entry waiting.
select pg_temp.act('20261106-1111-4000-8000-000000000001');
select save_walkin_visit_draft('20261106-2222-4000-8000-000000000002','20261106-5555-4000-8000-000000000001',3,'{"q1":"Silver"}','{}');
select ok(discard_walkin_visit_draft('20261106-2222-4000-8000-000000000002'), 'staff can discard a draft');
select ok(not discard_walkin_visit_draft('20261106-2222-4000-8000-000000000002'), 'discarding again changes nothing');
reset role;
select is((select count(*)::int from crm_private.audit_logs where action='crm.walkin_draft_started' and record_id='20261106-2222-4000-8000-000000000001'), 1, 'starting a draft is audited once, not on every autosave');
select is((select count(*)::int from crm_private.audit_logs where action='crm.walkin_draft_discarded' and record_id='20261106-2222-4000-8000-000000000002'), 1, 'discarding is audited');
select is((select status from entry_queue where id='20261106-2222-4000-8000-000000000002'), 'pending', 'the entry still waits after a discard');

-- Completing the queue entry (any form) removes its draft; a completed entry takes no new draft.
update entry_queue set status='complete' where id='20261106-2222-4000-8000-000000000001';
select is((select count(*)::int from walkin_visit_drafts where entry_queue_id='20261106-2222-4000-8000-000000000001'), 0, 'completing the visit removes the draft');
set local role authenticated;
select pg_temp.act('20261106-1111-4000-8000-000000000001');
select throws_ok($$select save_walkin_visit_draft('20261106-2222-4000-8000-000000000001','20261106-5555-4000-8000-000000000001',3,'{}','{}')$$, '55000', null, 'a submitted visit takes no new draft');
reset role;

select * from finish();
rollback;
