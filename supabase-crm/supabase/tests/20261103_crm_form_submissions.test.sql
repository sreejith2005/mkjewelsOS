begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Contract surface
select ok(has_function_privilege('authenticated','register_walkin_entry_from_form(uuid,text,text,uuid,jsonb)','EXECUTE')
  and has_function_privilege('authenticated','save_crm_lead_from_form(uuid,text,text,jsonb,jsonb)','EXECUTE'),'CRM users can save through linked forms');
select ok(not has_function_privilege('anon','register_walkin_entry_from_form(uuid,text,text,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','save_crm_lead_from_form(uuid,text,text,jsonb,jsonb)','EXECUTE'),'anonymous callers cannot save');
select ok(not has_function_privilege('authenticated','crm_private.claim_form_submission(uuid,text,uuid,text,jsonb)','EXECUTE'),'the replay check is internal');
select ok(not has_table_privilege('authenticated','crm_private.form_submission_links','SELECT'),'browsers cannot read the links table directly');

-- Synthetic CRM: one branch, an active and an inactive salesperson, the CRM queue roster and lead fields.
insert into branches(id,name) values('20261103-0000-4000-8000-000000000001','Synthetic Forms Branch');
insert into auth.users(id,email) values
 ('20261103-1111-4000-8000-000000000001','forms-staff@example.invalid'),
 ('20261103-1111-4000-8000-000000000002','forms-inactive@example.invalid');
insert into users(id,name,email,role,branch_id,active) values
 ('20261103-1111-4000-8000-000000000001','FORMS STAFF','forms-staff@example.invalid','salesperson','20261103-0000-4000-8000-000000000001',true),
 ('20261103-1111-4000-8000-000000000002','FORMS INACTIVE','forms-inactive@example.invalid','salesperson','20261103-0000-4000-8000-000000000001',false);
insert into crm_sso_access_grants(jewelos_user_id,legacy_crm_user_id,crm_auth_user_id,work_email,active) select id,id,id,email,true from users where email like 'forms-%@example.invalid';
insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at,active) select id,'20261103-9999-4000-8000-000000000001',now(),true from users where email like 'forms-%@example.invalid';
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values('20261103-0000-4000-8000-000000000001','FORMS STAFF','20261103-1111-4000-8000-000000000001',true);
insert into lead_form_fields(field_key,label,field_type,display_order,is_mandatory) values
 ('mobile_no','Mobile','text',1,true),('name','Name','text',2,true),('dob','Date of birth','date',3,false),('exhibition_name','Exhibition','text',4,false);

create temp table out(k text primary key, v jsonb);
grant all on out to authenticated;
create function pg_temp.src(p_answers jsonb default '{"answers":{"n":"Asha"}}') returns jsonb language sql immutable as $$
 select jsonb_build_object('formFamilyId','20261103-5555-4000-8000-000000000001','formTemplateId','20261103-5555-4000-8000-000000000002','formVersion',3,'bindingVersionId','20261103-5555-4000-8000-000000000003','answers',p_answers) $$;
grant execute on function pg_temp.src(jsonb) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261103-1111-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','20261103-1111-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

-- Client queue registration from a Form Builder form.
insert into out select 'q1', register_walkin_entry_from_form('20261103-7777-4000-8000-000000000001','Asha Forms','+919100900001','20261103-0000-4000-8000-000000000001',pg_temp.src());
select ok((select v->>'client_code' like 'MKC-%' and (v->>'replayed')::boolean = false from out where k='q1'),'the queue entry is saved through register_walkin_entry and returns the client ID');
insert into out select 'q1_again', register_walkin_entry_from_form('20261103-7777-4000-8000-000000000001','Asha Forms','+919100900001','20261103-0000-4000-8000-000000000001',pg_temp.src());
select is((select v->>'id' from out where k='q1_again'),(select v->>'id' from out where k='q1'),'a retried submission returns the first queue entry');
select ok((select (v->>'replayed')::boolean from out where k='q1_again'),'and says it was a replay');
select throws_ok($$select register_walkin_entry_from_form('20261103-7777-4000-8000-000000000001','Asha Changed','+919100900001','20261103-0000-4000-8000-000000000001',pg_temp.src())$$,
  '23505','This submission was already saved with different answers','the same submission key with different answers is refused');
select throws_ok($$select register_walkin_entry_from_form(null,'Asha','+919100900002','20261103-0000-4000-8000-000000000001',pg_temp.src())$$,'22023',null,'a submission key is required');
select throws_ok($$select register_walkin_entry_from_form(gen_random_uuid(),'Asha','+919100900002','20261103-0000-4000-8000-000000000001','{"formFamilyId":"x"}')$$,'22023','The form details are not valid','the form source is checked');
select throws_ok($$select register_walkin_entry_from_form(gen_random_uuid(),'Bad Phone','12','20261103-0000-4000-8000-000000000001',pg_temp.src())$$,null,null,'the existing queue rules still validate the phone number');
reset role;
select is((select count(*)::int from entry_queue where client_name='Asha Forms'),1,'one queue entry for the retried registration');
select is((select record_type||':'||record_id::text from crm_private.form_submission_links where submission_key='20261103-7777-4000-8000-000000000001'),
  'entry_queue:'||(select v->>'id' from out where k='q1'),'the link points at the queue entry');
select is((select source->>'formVersion' from crm_private.form_submission_links where submission_key='20261103-7777-4000-8000-000000000001'),'3','the link keeps the form version the answers came from');
select ok(exists(select 1 from crm_private.audit_logs where action='crm.form_submission_linked' and record_id=(select (v->>'id')::uuid from out where k='q1')),'the linked save is audited');
select ok(exists(select 1 from crm_private.audit_logs where action='crm.create_entry_queue' and record_id=(select (v->>'id')::uuid from out where k='q1')),'the existing queue audit still runs');

-- Lead registration from a Form Builder form.
set local role authenticated;
insert into out select 'l1', save_crm_lead_from_form('20261103-7777-4000-8000-000000000002','9199009001','Ravi Forms','{"dob":"1990-01-02","exhibition_name":"Trade fair","rogue":"value"}',pg_temp.src('{"answers":{"x":1}}'));
insert into out select 'l1_again', save_crm_lead_from_form('20261103-7777-4000-8000-000000000002','9199009001','Ravi Forms','{"dob":"1990-01-02","exhibition_name":"Trade fair","rogue":"value"}',pg_temp.src('{"answers":{"x":1}}'));
select throws_ok($$select save_crm_lead_from_form(gen_random_uuid(),'9199009002','','{}',pg_temp.src())$$,'22023',null,'save_crm_lead still requires the lead name');
reset role;
select is((select v->>'id' from out where k='l1_again'),(select v->>'id' from out where k='l1'),'a retried lead submission returns the first lead');
select is((select count(*)::int from leads where name='Ravi Forms'),1,'one lead for the retried submission');
select is((select field_values from leads where name='Ravi Forms'),'{"dob":"1990-01-02"}'::jsonb,'only answers CRM''s lead routing shows are saved on the lead');
select is((select unused_answers from crm_private.form_submission_links where submission_key='20261103-7777-4000-8000-000000000002'),
  '{"exhibition_name":"Trade fair","rogue":"value"}'::jsonb,'answers CRM did not take are kept with the link');
select ok(exists(select 1 from crm_private.audit_logs where action='crm.lead_saved' and record_id=(select (v->>'id')::uuid from out where k='l1')),'the existing lead audit still runs');

-- Inactive staff, and the links stay as recorded.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261103-1111-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','20261103-1111-4000-8000-000000000002',true);
select throws_ok($$select register_walkin_entry_from_form(gen_random_uuid(),'Denied','+919100900003','20261103-0000-4000-8000-000000000001',pg_temp.src())$$,'42501',null,'inactive staff cannot register');
select throws_ok($$select save_crm_lead_from_form(gen_random_uuid(),'9199009003','Denied','{}',pg_temp.src())$$,'42501',null,'inactive staff cannot save leads');
reset role;
select throws_ok($$update crm_private.form_submission_links set result='{}'$$,'42501',null,'recorded links cannot be changed');

select * from finish();
rollback;
