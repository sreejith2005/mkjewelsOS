begin;
select plan(12);

select has_table('public','task_import_identity_aliases','remembered import identities are tenant scoped');
select has_function('public','save_task_import_identity_alias_with_audit',array['text','uuid'],'admins can remember one source name');
select has_function('public','reconcile_task_import_assignments',array['jsonb'],'repeat uploads can repair existing unassigned records');
select table_privs_are('public','task_import_identity_aliases','authenticated',array[]::text[],'browser clients cannot read alias rows directly');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('13000000-0000-4000-8000-000000000001','authenticated','authenticated','admin-130@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('13000000-0000-4000-8000-000000000002','authenticated','authenticated','first-130@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('13000000-0000-4000-8000-000000000003','authenticated','authenticated','second-130@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('13000000-0000-4000-8000-000000000004','authenticated','authenticated','middle-130@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('13010000-0000-4000-8000-000000000001','Import 130','import-130');
insert into public.branches(id,tenant_id,name,code) values('13020000-0000-4000-8000-000000000001','13010000-0000-4000-8000-000000000001','Import Branch 130','I130');
insert into public.departments(id,tenant_id,branch_id,name,code) values('13030000-0000-4000-8000-000000000001','13010000-0000-4000-8000-000000000001','13020000-0000-4000-8000-000000000001','Import Department 130','D130');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values
 ('13040000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','13010000-0000-4000-8000-000000000001','13020000-0000-4000-8000-000000000001','13030000-0000-4000-8000-000000000001','Import Admin 130','0000001301','admin-130@example.invalid','I130-1','admin','active','active',true),
 ('13040000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000002','13010000-0000-4000-8000-000000000001','13020000-0000-4000-8000-000000000001','13030000-0000-4000-8000-000000000001','Duplicate Person','0000001302','first-130@example.invalid','I130-2','staff','active','active',true),
 ('13040000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000003','13010000-0000-4000-8000-000000000001','13020000-0000-4000-8000-000000000001','13030000-0000-4000-8000-000000000001','Duplicate Person','0000001303','second-130@example.invalid','I130-3','staff','active','active',true),
 ('13040000-0000-4000-8000-000000000004','13000000-0000-4000-8000-000000000004','13010000-0000-4000-8000-000000000001','13020000-0000-4000-8000-000000000001','13030000-0000-4000-8000-000000000001','Short Middle Person','0000001304','middle-130@example.invalid','I130-4','staff','active','active',true);
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('13010000-0000-4000-8000-000000000001','task_category','Import Category 130','import_category_130',1,'13040000-0000-4000-8000-000000000001');

create function pg_temp.import_row(p_source integer,p_title text,p_email text,p_name text) returns jsonb language sql as $$
select jsonb_build_object('source_row',p_source,'task_key','row-'||p_source,'destination','tasks','schedule_kind','one_time','task_type','delegation','core_task_label','','title',p_title,'description','','priority','medium','branch','I130','department','Import Department 130','category','Import Category 130','assignee_email',p_email,'assignee_profile_id','','assignee_name',p_name,'verifier_label','','verifier_profile_id','','starts_on','2026-09-02','start_time','09:00','due_time','10:00','planned_at','2026-09-02 09:00','due_at','2026-09-02 10:00','recurrence_rule','','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigning_left','checklist','[]'::jsonb)
$$;
grant execute on function pg_temp.import_row(integer,text,text,text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((public.begin_task_bulk_import(repeat('d',64),'identity-130.csv',3)->>'outcome'),'in_progress','admin starts identity test batch');
select is((public.commit_task_bulk_import_chunk(
  (select id from public.task_import_batches where import_hash=repeat('d',64)),
  jsonb_build_array(
    pg_temp.import_row(2,'Stale email fallback','obsolete@example.invalid','Short Middle Person'),
    pg_temp.import_row(3,'Short name fallback','','Short Person'),
    pg_temp.import_row(4,'Remembered duplicate','','Duplicate Person')
  )
)->>'assigning_left_count')::integer,1,'stale emails and unique shortened names resolve while duplicate names wait');
select is((select count(*)::integer from public.task_assignees a join public.task_instances t on t.id=a.task_instance_id where t.title in ('Stale email fallback','Short name fallback') and a.user_profile_id='13040000-0000-4000-8000-000000000004' and a.is_active),2,'both safe fallback rows use the unique active profile');
select is(public.save_task_import_identity_alias_with_audit('Duplicate Person','13040000-0000-4000-8000-000000000003')->>'saved','true','admin remembers one duplicate label once');
select is((select import_aliases[1] from public.list_task_import_identity_candidates() where id='13040000-0000-4000-8000-000000000003'),'Duplicate Person','candidate response includes the remembered label');
select is((public.reconcile_task_import_assignments(jsonb_build_array(pg_temp.import_row(4,'Remembered duplicate','','Duplicate Person')))->>'updated_count')::integer,1,'repeat upload repairs the existing unassigned record');
select ok(exists(select 1 from public.task_assignees a join public.task_instances t on t.id=a.task_instance_id where t.title='Remembered duplicate' and a.user_profile_id='13040000-0000-4000-8000-000000000003' and a.is_active),'reconciliation assigns the selected duplicate profile');
select ok(exists(select 1 from public.audit_logs where action in ('task_import_identity_alias_saved','assigning_left_resolved') and actor_user_id='13040000-0000-4000-8000-000000000001'),'alias and repaired assignment are audited');

select * from finish();
rollback;
