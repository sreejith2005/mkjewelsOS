begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

create temp table pw_fixture(name text primary key, id uuid);
grant all on pw_fixture to service_role;
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; person text;
begin
  insert into tenants(name,slug) values('Own password','own-password') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','OPW') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','OPW') returning id into d;
  foreach person in array array['active','disabled','resigned'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-pw@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(t,a,b,d,'Pw '||person,'PW-'||person,person||'-pw@test.local','staff',
        (case when person='resigned' then 'resigned' else 'active' end)::working_status,person <> 'disabled') returning id into u;
    insert into pw_fixture values(person,u),(person||'_auth',a);
  end loop;
  insert into pw_fixture values('nobody_auth',gen_random_uuid());
end $$;
create function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from pw_fixture where name=p $$;
grant execute on function pg_temp.fx(text) to service_role;

select ok(has_function_privilege('service_role','authorize_own_password_change(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','authorize_own_password_change(uuid)','EXECUTE')
  and not has_function_privilege('anon','authorize_own_password_change(uuid)','EXECUTE'),
  'only the server-side function can authorize a password change');
select ok(has_function_privilege('service_role','audit_own_password_change(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','audit_own_password_change(uuid)','EXECUTE')
  and not has_function_privilege('anon','audit_own_password_change(uuid)','EXECUTE'),
  'only the server-side function can record a password change');

-- A direct database call without the service role is refused even for the owner.
select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',pg_temp.fx('active_auth'))::text, true);
select throws_ok(format('select authorize_own_password_change(%L)', pg_temp.fx('active_auth')), '42501', 'Service role required',
  'a signed-in browser session cannot call the authorization directly');
select throws_ok(format('select audit_own_password_change(%L)', pg_temp.fx('active_auth')), '42501', 'Service role required',
  'a signed-in browser session cannot write the audit row directly');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select lives_ok(format('select authorize_own_password_change(%L)', pg_temp.fx('active_auth')),
  'an active employee may change their own password');
select throws_ok(format('select authorize_own_password_change(%L)', pg_temp.fx('disabled_auth')), '42501', 'This account cannot change its password',
  'a disabled login cannot change its password');
select throws_ok(format('select authorize_own_password_change(%L)', pg_temp.fx('resigned_auth')), '42501', 'This account cannot change its password',
  'a resigned employee cannot change their password');
select throws_ok(format('select authorize_own_password_change(%L)', pg_temp.fx('nobody_auth')), '42501', 'This account cannot change its password',
  'an auth user without an employee profile cannot change a password');
select lives_ok(format('select audit_own_password_change(%L)', pg_temp.fx('active_auth')), 'the change is recorded');
reset role;

select is((select count(*)::integer from audit_logs where action='user_password_changed' and record_id=pg_temp.fx('active')
  and actor_user_id=pg_temp.fx('active') and module='user_management'), 1,
  'the audit row names the employee as both actor and record');
select is((select new_value from audit_logs where action='user_password_changed' and record_id=pg_temp.fx('active')),
  '{"password_stored": false, "changed_by_self": true}'::jsonb,
  'the audit row never contains the password');

select * from finish();
rollback;
