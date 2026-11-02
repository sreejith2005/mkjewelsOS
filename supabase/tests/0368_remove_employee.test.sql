begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

create temp table rm_fixture(name text primary key, id uuid);
grant select on rm_fixture to authenticated;
do $$
declare t uuid; t2 uuid; b uuid; d uuid; b2 uuid; d2 uuid; a uuid; u uuid; person text;
begin
  insert into tenants(name,slug) values('Remove employee','remove-employee') returning id into t;
  insert into tenants(name,slug) values('Remove other','remove-other') returning id into t2;
  insert into branches(tenant_id,name,code) values(t,'Main','RME') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','RME') returning id into d;
  insert into branches(tenant_id,name,code) values(t2,'Other','RMX') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t2,b2,'Other','RMX') returning id into d2;
  foreach person in array array['super','admin','leaver','colleague','outsider'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-rm@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,username,personal_mobile)
      values(case when person='outsider' then t2 else t end,a,case when person='outsider' then b2 else b end,case when person='outsider' then d2 else d end,
        'Rm '||person,'RM-'||person,person||'-rm@test.local',
        case person when 'super' then 'super_admin' when 'admin' then 'admin' else 'staff' end::user_role,'active',true,'rm'||person,'+91 98765 43210') returning id into u;
    insert into rm_fixture values(person,u),(person||'_auth',a);
  end loop;
  -- The leaver heads the department, manages the branch, is a buddy, and has work history.
  update branches set manager_id = (select id from rm_fixture where name='leaver') where id=b;
  update departments set head_id = (select id from rm_fixture where name='leaver') where id=d;
  update user_profiles set buddy_id = (select id from rm_fixture where name='leaver'), reports_to_user_id = (select id from rm_fixture where name='leaver')
    where id = (select id from rm_fixture where name='colleague');
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id) values(t,(select id from rm_fixture where name='leaver'),'fixture_history','tasks',null);
  insert into rm_fixture values('branch',b),('department',d);
end $$;
create function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from rm_fixture where name=p $$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from rm_fixture where name=p||'_auth'),true),
    set_config('request.jwt.claims',json_build_object('role','authenticated','sub',(select id from rm_fixture where name=p||'_auth'))::text,true),
    set_config('request.jwt.claim.role','authenticated',true) $$;
grant execute on function pg_temp.fx(text), pg_temp.as_user(text) to authenticated;

select has_column('public','user_profiles','removed_at','profiles record when an employee was removed');
select ok(has_function_privilege('authenticated','remove_employee_with_audit(uuid)','EXECUTE')
  and not has_function_privilege('anon','remove_employee_with_audit(uuid)','EXECUTE'),
  'only signed-in users can call removal; the function checks the permission');

select pg_temp.as_user('admin'); set local role authenticated;
select throws_ok(format('select remove_employee_with_audit(%L)', pg_temp.fx('leaver')), '42501', 'Only a Super Admin can delete users',
  'an admin without the delete permission cannot remove anyone');
reset role;

select pg_temp.as_user('colleague'); set local role authenticated;
select throws_ok(format('select remove_employee_with_audit(%L)', pg_temp.fx('leaver')), '42501', 'Only a Super Admin can delete users',
  'an ordinary employee cannot remove anyone');
reset role;

select pg_temp.as_user('super'); set local role authenticated;
select throws_ok(format('select remove_employee_with_audit(%L)', pg_temp.fx('super')), '22023', 'You cannot delete your own account',
  'a Super Admin cannot remove themselves');
select throws_ok(format('select remove_employee_with_audit(%L)', pg_temp.fx('outsider')), '42501', 'User not found',
  'a Super Admin cannot remove someone in another company');
select is(remove_employee_with_audit(pg_temp.fx('leaver')), pg_temp.fx('leaver_auth'),
  'an active employee with work history, links and leadership roles is removed without a refusal');
select is(remove_employee_with_audit(pg_temp.fx('leaver')), pg_temp.fx('leaver_auth'),
  'deleting again is harmless');
reset role;

select is((select row(employee_name, email, username, personal_mobile, account_status::text, working_status::text, is_login_enabled)::text
  from user_profiles where id=pg_temp.fx('leaver')),
  row('Removed employee', 'removed-'||pg_temp.fx('leaver')||'@removed.invalid', null::text, null::text, 'left', 'resigned', false)::text,
  'personal details are wiped and the account is closed');
select ok((select removed_at is not null and removed_by=pg_temp.fx('super') from user_profiles where id=pg_temp.fx('leaver')),
  'the removal time and remover are recorded');
select ok(exists(select 1 from audit_logs where action='fixture_history' and actor_user_id=pg_temp.fx('leaver')),
  'past work still points at the removed profile');
select is((select row(buddy_id, reports_to_user_id)::text from user_profiles where id=pg_temp.fx('colleague')), row(null::uuid, null::uuid)::text,
  'colleagues no longer have the removed person as buddy or manager');
select ok((select manager_id is null from branches where id=pg_temp.fx('branch')) and (select head_id is null from departments where id=pg_temp.fx('department')),
  'branch manager and department head roles are cleared');
select is((select count(*)::integer from audit_logs where action='user_removed' and record_id=pg_temp.fx('leaver') and actor_user_id=pg_temp.fx('super')), 1,
  'one audit row records who removed whom');
select is((select count(*)::integer from audit_logs where action='removed_user_links_cleared' and record_id=pg_temp.fx('colleague')), 1,
  'the colleague link change is audited');
select ok(not exists(select 1 from user_profiles where id=pg_temp.fx('outsider') and removed_at is not null),
  'other companies are untouched');

select * from finish();
rollback;
