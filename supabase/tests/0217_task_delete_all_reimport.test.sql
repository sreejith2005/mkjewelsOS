begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(13);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('20800000-0000-4000-8000-000000000001','authenticated','authenticated','admin-208@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('20810000-0000-4000-8000-000000000001','Import 208','import-208');
insert into public.branches(id,tenant_id,name,code) values('20820000-0000-4000-8000-000000000001','20810000-0000-4000-8000-000000000001','Import Branch 208','I208');
insert into public.departments(id,tenant_id,branch_id,name,code) values('20830000-0000-4000-8000-000000000001','20810000-0000-4000-8000-000000000001','20820000-0000-4000-8000-000000000001','Import Department 208','D208');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values('20840000-0000-4000-8000-000000000001','20800000-0000-4000-8000-000000000001','20810000-0000-4000-8000-000000000001','20820000-0000-4000-8000-000000000001','20830000-0000-4000-8000-000000000001','Import Admin 208','0000002081','admin-208@example.invalid','I208-1','admin','active','active',true);
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('20810000-0000-4000-8000-000000000001','task_category','Import Category 208','import_category_208',1,'20840000-0000-4000-8000-000000000001');

create function pg_temp.import_row(p_source_row integer,p_task_key text,p_task_type text,p_destination text,p_schedule_kind text,p_title text) returns jsonb language sql as $$
select jsonb_build_object(
  'source_row',p_source_row,'task_key',p_task_key,'destination',p_destination,'schedule_kind',p_schedule_kind,
  'task_type',p_task_type,'core_task_label','Opening group','title',p_title,'description','Unlock before opening',
  'priority','medium','branch','I208','department','Import Department 208','category','Import Category 208',
  'assignee_email','admin-208@example.invalid','assignee_profile_id','','assignee_name','Import Admin 208',
  'verifier_label','','verifier_profile_id','','starts_on',(now() at time zone 'Asia/Kolkata')::date::text,
  'start_time','09:00','due_time','10:00','planned_at',(now() at time zone 'Asia/Kolkata')::date::text||' 09:00',
  'due_at',(now() at time zone 'Asia/Kolkata')::date::text||' 10:00',
  'recurrence_rule',case when p_schedule_kind='daily' then 'FREQ=DAILY' else null end,
  'requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,
  'assignment_status','assigned','checklist',jsonb_build_array(jsonb_build_object('item_text',p_title,'required',true))
)
$$;
grant execute on function pg_temp.import_row(integer,text,text,text,text,text) to authenticated;

create temp table reimport_batches(id uuid);
grant all on reimport_batches to authenticated;
create function pg_temp.reimport_rows() returns jsonb language sql as $$
  select jsonb_agg(pg_temp.import_row(n+1,'clear-'||n,'delegation','recurring_todo',case when n<=15 then 'daily' else 'as_required' end,'Clear schedule '||n)
    || jsonb_build_object('is_active',n<=15,'recurrence_rule','FREQ=DAILY') order by n) from generate_series(1,31) n
$$;
grant execute on function pg_temp.reimport_rows() to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20800000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into reimport_batches select (begin_task_bulk_import(repeat('e',64),'clear-schedules.csv',31)->>'batch_id')::uuid;
select is((commit_task_bulk_import_chunk((select id from reimport_batches limit 1),pg_temp.reimport_rows())->>'created')::integer,31,'all 31 initial source records import');
select is((select count(*)::integer from task_templates),31,'31 schedules exist');
select is((select count(*)::integer from task_templates where not is_active),16,'16 schedules are inactive');
select is((select count(*)::integer from task_instances),15,'only the 15 active schedules have occurrences');
select lives_ok($test$do $loop$ declare v_id uuid; begin for v_id in select id from task_instances loop perform admin_delete_task_with_audit(v_id,true,'Wrong schedule'); end loop; end $loop$;$test$,'occurrence-based full deletion succeeds');
select is((select count(*)::integer from task_templates),16,'occurrence-only enumeration leaves 16 hidden schedules');
select is((select count(*)::integer from task_instances),0,'the visible task list is empty');
select lives_ok($test$do $loop$ declare v_id uuid; begin for v_id in select id from task_templates loop perform delete_task_template_with_audit(v_id); end loop; end $loop$;$test$,'full deletion also removes schedule-only targets');
select is((select count(*)::integer from task_templates),0,'no live schedules remain');
truncate reimport_batches;
insert into reimport_batches select (begin_task_bulk_import(repeat('e',64),'clear-schedules.csv',31)->>'batch_id')::uuid;
select is((commit_task_bulk_import_chunk((select id from reimport_batches limit 1),pg_temp.reimport_rows())->>'created')::integer,31,'identical reimport creates all 31 records');
select is((select replayed_count from task_import_batches where id=(select id from reimport_batches limit 1)),0,'deleted schedules do not produce false duplicate skips');
select is((select count(*)::integer from task_templates),31,'all 31 replacement schedules are live');
reset role;
select is((select count(*)::integer from task_import_row_registry where tenant_id='20810000-0000-4000-8000-000000000001' and retired_business_fingerprint is not null),31,'all original fingerprints are retired with history preserved');
select * from finish();
rollback;
