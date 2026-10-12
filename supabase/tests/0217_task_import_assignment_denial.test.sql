begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('21700000-0000-4000-8000-000000000001','authenticated','authenticated','admin-217@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('21700000-0000-4000-8000-000000000002','authenticated','authenticated','manager-217@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('21700000-0000-4000-8000-000000000003','authenticated','authenticated','doer-217@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('21710000-0000-4000-8000-000000000001','Import 217','import-217');
insert into public.branches(id,tenant_id,name,code) values('21720000-0000-4000-8000-000000000001','21710000-0000-4000-8000-000000000001','Import Branch 217','I217');
insert into public.departments(id,tenant_id,branch_id,name,code) values('21730000-0000-4000-8000-000000000001','21710000-0000-4000-8000-000000000001','21720000-0000-4000-8000-000000000001','Import Department 217','D217');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,reports_to_user_id)
values
 ('21740000-0000-4000-8000-000000000001','21700000-0000-4000-8000-000000000001','21710000-0000-4000-8000-000000000001','21720000-0000-4000-8000-000000000001','21730000-0000-4000-8000-000000000001','Import Admin 217','0000002171','admin-217@example.invalid','I217-1','admin','active','active',true,null),
 ('21740000-0000-4000-8000-000000000002','21700000-0000-4000-8000-000000000002','21710000-0000-4000-8000-000000000001','21720000-0000-4000-8000-000000000001','21730000-0000-4000-8000-000000000001','Import Manager 217','0000002172','manager-217@example.invalid','I217-2','manager','active','active',true,null),
 ('21740000-0000-4000-8000-000000000003','21700000-0000-4000-8000-000000000003','21710000-0000-4000-8000-000000000001','21720000-0000-4000-8000-000000000001','21730000-0000-4000-8000-000000000001','Import Doer 217','0000002173','doer-217@example.invalid','I217-3','doer','active','active',true,'21740000-0000-4000-8000-000000000002');
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('21710000-0000-4000-8000-000000000001','task_category','Import Category 217','import_category_217',1,'21740000-0000-4000-8000-000000000001');


create function pg_temp.import_assignment_fixture(p_name text,p_destination text,p_number integer) returns jsonb
language plpgsql as $$
declare batch uuid;
begin
  batch:=(public.begin_task_bulk_import(encode(extensions.digest(p_name||p_destination||p_number::text,'sha256'),'hex'),'synthetic-assignment.csv',1)->>'batch_id')::uuid;
  return public.commit_task_bulk_import_chunk(batch,jsonb_build_array(jsonb_build_object(
    'source_row',2,'task_key','assignment-test-'||p_number,'destination',p_destination,
    'schedule_kind',case when p_destination='tasks' then 'one_time' else 'daily' end,
    'task_type','delegation','core_task_label','','title','Synthetic import assignment '||p_number,'description','',
    'priority','medium','branch','I217','department','Import Department 217','category','Import Category 217',
    'assignee_email','','assignee_profile_id','','assignee_name',p_name,'verifier_label','','verifier_profile_id','',
    'starts_on','2030-10-15','start_time','12:00','due_time','13:00','planned_at','2030-10-15 12:00','due_at','2030-10-15 13:00',
    'recurrence_rule',case when p_destination='tasks' then '' else 'RRULE:FREQ=DAILY;INTERVAL=1' end,
    'requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,
    'is_active',true,'assignment_status','assigning_left','checklist','[]'::jsonb)));
end $$;
grant execute on function pg_temp.import_assignment_fixture(text,text,integer) to authenticated;

insert into public.user_permission_overrides(tenant_id,user_profile_id,permission_key,effect)
values('21710000-0000-4000-8000-000000000001','21740000-0000-4000-8000-000000000001','tasks.assign_others','deny');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','21700000-0000-4000-8000-000000000001',true);

select is((pg_temp.import_assignment_fixture('Import Doer 217','tasks',1)->>'rejected')::integer,1,'denied Admin cannot import another doer through compatibility chunk');
select is((pg_temp.import_assignment_fixture('Import Doer 217','recurring_todo',2)->>'rejected')::integer,1,'denied Admin cannot import another doer schedule');
select is((pg_temp.import_assignment_fixture('Import Admin 217','tasks',3)->>'created')::integer,1,'denial preserves self task imports');
select is((pg_temp.import_assignment_fixture('Import Admin 217','recurring_todo',4)->>'created')::integer,1,'denial preserves self schedule imports');
select is((pg_temp.import_assignment_fixture('','tasks',5)->>'created')::integer,1,'denial preserves unresolved task import');
select is((pg_temp.import_assignment_fixture('','recurring_todo',6)->>'created')::integer,1,'denial preserves unresolved inactive schedule');
reset role;
select is((select count(*) from public.task_instances where tenant_id='21710000-0000-4000-8000-000000000001' and title='Synthetic import assignment 1'),0::bigint,'rejected row leaves no durable task');
select is((select count(*) from public.task_templates where tenant_id='21710000-0000-4000-8000-000000000001' and title='Synthetic import assignment 2'),0::bigint,'rejected row leaves no durable schedule');
select is((select count(*) from public.task_import_items where tenant_id='21710000-0000-4000-8000-000000000001' and outcome='rejected' and error_code='42501'),2::bigint,'row rejection records actionable authorization error');
select ok(not exists(select 1 from public.task_assignees a join public.task_instances t on t.id=a.task_instance_id where t.tenant_id='21710000-0000-4000-8000-000000000001' and a.user_profile_id='21740000-0000-4000-8000-000000000003'),'denied chunks create no peer assignments');
select * from finish();
rollback;
