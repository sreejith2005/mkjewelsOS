begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Saved-submission events name the client's CRM (20261109000100): the visit's CRM, else today's
-- Client Queue CRM. The salesperson stays in staff_jewelos_user_id.
insert into branches(id,name,jewelos_branch_id) values('20261109-0100-4000-8000-00000000000a','Client CRM Branch','20261109-0100-4000-8000-0000000000aa');
insert into users(id,name,email,role,branch_id,active) values
('20261109-0100-4000-8000-000000000001','Client Seller','client-seller@example.invalid','salesperson','20261109-0100-4000-8000-00000000000a',true),
('20261109-0100-4000-8000-000000000002','Client Crm','client-crm@example.invalid','salesperson','20261109-0100-4000-8000-00000000000a',true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id,active) values
('20261109-0100-4000-8000-0000000000f1','client-seller@example.invalid','20261109-0100-4000-8000-000000000001','20261109-0100-4000-8000-000000000001',true),
('20261109-0100-4000-8000-0000000000f2','client-crm@example.invalid','20261109-0100-4000-8000-000000000002','20261109-0100-4000-8000-000000000002',true);
insert into crm_private.staff_sync_state(jewelos_user_id,snapshot_at,outcome,crm_user_id,selection_department) values
('20261109-0100-4000-8000-0000000000f1',now(),'applied','20261109-0100-4000-8000-000000000001','sales'),
('20261109-0100-4000-8000-0000000000f2',now(),'applied','20261109-0100-4000-8000-000000000002','crm');
\ir fixtures/crm_master_options.psql
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values('20261109-0100-4000-8000-00000000000a','CLIENT CRM','20261109-0100-4000-8000-000000000002',true);

create function pg_temp.visit(p_client uuid,p_timeline uuid,p_phone text,p_crm text) returns jsonb language sql as $$
  select jsonb_build_object('branch_id','20261109-0100-4000-8000-00000000000a','primary_name','Synthetic Client CRM','primary_phone',p_phone,
    'proposed_client_id',p_client,'proposed_timeline_id',p_timeline,'event_date',now(),'crm_name',p_crm,'salesperson','Client Seller',
    'salesperson_id','20261109-0100-4000-8000-000000000001','visit_status','NO','did_buy',false,
    'seen_categories',jsonb_build_array('Ring'),'bought_categories','[]'::jsonb,'not_bought_reasons',jsonb_build_array('PRICE'),
    'product_requirement','Bangles','category_details',jsonb_build_object('seen_count','1','seen_tags',jsonb_build_array('T1')),
    'additional_fields',jsonb_build_object('visit_status','NO','salesperson','Client Seller'))
$$;
create function pg_temp.event(p_timeline uuid) returns jsonb language sql as $$
  select o.payload from crm_private.submission_outbox o join visit_forms v on v.id=o.record_id
  where o.kind='crm.walkin_visit_saved' and v.client_timeline_id=p_timeline $$;
grant execute on function pg_temp.visit(uuid,uuid,text,text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','20261109-0100-4000-8000-000000000001',true);
select lives_ok($$select * from submit_walkin_visit(pg_temp.visit('20261109-0100-4000-8000-000000000010','20261109-0100-4000-8000-000000000011','9100910001','CLIENT CRM'))$$,'a visit with its CRM saves');
select lives_ok($$select * from submit_walkin_visit(pg_temp.visit('20261109-0100-4000-8000-000000000020','20261109-0100-4000-8000-000000000021','9100910002',null))$$,'a visit without a CRM saves');
reset role;
set constraints all immediate;

select is(pg_temp.event('20261109-0100-4000-8000-000000000011')->>'crm_jewelos_user_id','20261109-0100-4000-8000-0000000000f2','the visit''s CRM is named');
select is(pg_temp.event('20261109-0100-4000-8000-000000000011')->>'staff_jewelos_user_id','20261109-0100-4000-8000-0000000000f1','the salesperson is still sent');
select is(pg_temp.event('20261109-0100-4000-8000-000000000021')->>'crm_jewelos_user_id',null,'no CRM and no queue entry: nothing is named');

-- Registered in the Client Queue today: the round-robin CRM is named on the queue event and on a
-- later visit that records no CRM.
insert into entry_queue(token,client_name,mobile,branch_id,assigned_crm_name,status,client_id)
values('T-0109','Synthetic Client CRM','9100910002','20261109-0100-4000-8000-00000000000a','Client Crm','waiting','20261109-0100-4000-8000-000000000020');
set constraints all immediate;
select is((select payload->>'crm_jewelos_user_id' from crm_private.submission_outbox where kind='crm.queue_registered' and payload->>'client_id'='20261109-0100-4000-8000-000000000020'),
  '20261109-0100-4000-8000-0000000000f2','the queue event names its round-robin CRM');
set local role authenticated;
select lives_ok($$select * from submit_walkin_visit(pg_temp.visit('20261109-0100-4000-8000-000000000020','20261109-0100-4000-8000-000000000022','9100910002',null))$$,'the queued client''s visit saves');
reset role;
set constraints all immediate;
select is(pg_temp.event('20261109-0100-4000-8000-000000000022')->>'crm_jewelos_user_id','20261109-0100-4000-8000-0000000000f2','a visit without a CRM uses today''s queue CRM');

-- Yesterday's queue entry does not count.
update entry_queue set created_at=now()-interval '2 days' where token='T-0109';
select is(crm_private.client_crm_jewelos_user('20261109-0100-4000-8000-000000000020','20261109-0100-4000-8000-00000000000a',null,now()),null,'an older queue entry is not today''s CRM');

select ok(not has_function_privilege('authenticated','crm_private.client_crm_jewelos_user(uuid,uuid,text,timestamp with time zone)','EXECUTE'),'the resolver is internal');

select * from finish();
rollback;
