begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temp table cf(name text primary key, id uuid);
grant select on cf to authenticated;
do $$
declare t uuid; t2 uuid; b uuid; b2 uuid; d uuid; d2 uuid; a uuid; u uuid; person text;
begin
  insert into tenants(name,slug) values('CRM forms','crm-forms-372') returning id into t;
  insert into tenants(name,slug) values('Other company','crm-forms-372-other') returning id into t2;
  insert into branches(tenant_id,name,code) values(t,'Main','CF2') returning id into b;
  insert into branches(tenant_id,name,code) values(t2,'Other','CF3') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','CF2S') returning id into d;
  insert into departments(tenant_id,branch_id,name,code) values(t2,b2,'Sales','CF3S') returning id into d2;
  foreach person in array array['owner','crm','staff','outsider'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-cf@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled,week_off)
      values(case when person='outsider' then t2 else t end,a,case when person='outsider' then b2 else b end,case when person='outsider' then d2 else d end,'Cf '||person,'CF-'||person,person||'-cf@test.local',
        case person when 'owner' then 'super_admin' when 'outsider' then 'super_admin' when 'crm' then 'crm' else 'staff' end::user_role,'active','active',true,'{}') returning id into u;
    insert into cf values(person,u),(person||'_auth',a);
  end loop;
  insert into cf values('tenant',t);
end $$;
create function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from cf where name=p $$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from cf where name=p||'_auth'),true),
    set_config('request.jwt.claims',json_build_object('role','authenticated','sub',(select id from cf where name=p||'_auth'))::text,true),
    set_config('request.jwt.claim.role','authenticated',true) $$;
grant execute on function pg_temp.fx(text), pg_temp.as_user(text) to authenticated;
create temp table r(k text primary key, v jsonb);
grant all on r to authenticated;

select ok(exists(select 1 from permission_catalog where key='crm.manage_forms' and default_roles='{super_admin}'), 'Manage CRM forms is a Super Admin permission by default');
select ok(not has_function_privilege('anon','get_crm_form_bindings()','EXECUTE')
  and not has_function_privilege('anon','save_crm_form_binding(text,uuid,jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','crm_form_binding_actor()','EXECUTE')
  and not has_function_privilege('authenticated','crm_form_published_definition(uuid,uuid)','EXECUTE'), 'anonymous callers and internal helpers are closed');
select ok(not has_table_privilege('authenticated','crm_form_bindings','INSERT') and not has_table_privilege('authenticated','crm_form_binding_versions','SELECT'), 'links change only through the audited functions');

-- The owner builds a queue form in the Form Builder, with two questions side by side.
select pg_temp.as_user('owner'); set local role authenticated;
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Bad width","description":"","sections":[],"permissions":{"roles":["super_admin","admin","manager","crm","staff"]}}'::jsonb,
  '[{"key":"a","label":"A","type":"text","validation":{"width":"wide"}}]'::jsonb)$$, null, null, 'a question width other than full, half or third is refused');
insert into r select 'queue_form', to_jsonb(save_form_draft_with_audit(null,'{"name":"CRM queue","description":"","sections":[],"permissions":{"roles":["super_admin","admin","manager","crm","staff"]}}'::jsonb,
  '[{"key":"customer","label":"Client name","type":"text","required":true,"validation":{"width":"half"}},
    {"key":"phone","label":"Mobile number","type":"phone","required":true,"validation":{"width":"half"}},
    {"key":"note","label":"Note","type":"textarea"}]'::jsonb));
select publish_form_with_audit((select v #>> '{}' from r where k='queue_form')::uuid);
reset role;
select is((select validation->>'width' from form_fields where form_template_id=(select v #>> '{}' from r where k='queue_form')::uuid and field_key='phone'), 'half', 'the question width is saved with the question');
insert into r select 'family', to_jsonb(family_id) from form_templates where id=(select v #>> '{}' from r where k='queue_form')::uuid;
create function pg_temp.family() returns uuid language sql stable as $$ select (v #>> '{}')::uuid from r where k='family' $$;
grant execute on function pg_temp.family() to authenticated;

-- Readers: CRM users see the links; people without CRM cannot.
select pg_temp.as_user('staff'); set local role authenticated;
select throws_ok('select get_crm_form_bindings()', '42501', 'CRM access required', 'a user without CRM access cannot read CRM form links');
reset role;
select pg_temp.as_user('crm'); set local role authenticated;
select is(get_crm_form_bindings(), '{"canManage":false,"bindings":[]}'::jsonb, 'a CRM user sees no links yet and cannot manage them');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','queue',pg_temp.family(),'{"client_name":"customer","mobile":"phone"}'),
  '42501', 'Only people allowed to manage CRM forms can change them', 'a CRM user cannot link forms');
reset role;

-- Validation of the link, by question key.
select pg_temp.as_user('owner'); set local role authenticated;
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','queue',pg_temp.family(),'{"client_name":"customer"}'), '22023', 'Link every required CRM answer to a question', 'the mobile number must be linked');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','queue',pg_temp.family(),'{"client_name":"customer","mobile":"gone"}'), '22023', 'A linked question is not in the published form', 'a missing question is refused');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','queue',pg_temp.family(),'{"client_name":"phone","mobile":"customer"}'), '22023', 'The name must come from a text question', 'a question of the wrong kind is refused');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','queue',pg_temp.family(),'{"client_name":"customer","mobile":"customer"}'), '22023', null, 'one question cannot fill two answers');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','queue',pg_temp.family(),'{"client_name":"customer","mobile":"phone","city":"note"}'), '22023', 'The client queue form only takes the client name and mobile number', 'the queue form takes only its two answers');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','walkin',pg_temp.family(),'{"client_name":"customer"}'), '22023', 'This CRM form cannot be linked yet', 'the walk-in visit cannot be linked yet');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','queue',gen_random_uuid(),'{"client_name":"customer","mobile":"phone"}'), '22023', 'Choose a published form', 'an unknown form is refused');

insert into r select 'v1', save_crm_form_binding('queue',pg_temp.family(),'{"client_name":"customer","mobile":"phone"}'::jsonb);
reset role;
select is((select count(*)::int from audit_logs where action='crm_form_linked' and module='crm' and tenant_id=pg_temp.fx('tenant')), 1, 'linking writes an audit row');

select pg_temp.as_user('crm'); set local role authenticated;
insert into r select 'crm_view', get_crm_form_bindings();
reset role;
select is((select v->'bindings'->0->>'purpose' from r where k='crm_view'), 'queue', 'CRM users read the active queue link');
select is((select v->'bindings'->0->'fieldMap' from r where k='crm_view'), '{"client_name":"customer","mobile":"phone"}'::jsonb, 'with its question links');
select is((select jsonb_array_length(v->'bindings'->0->'form'->'fields') from r where k='crm_view'), 3, 'and the published questions to render');
select ok(not ((select v->'bindings'->0->'form'->'template' from r where k='crm_view') ? 'permissions'), 'without the form''s internal permission settings');

-- Concurrent editors: a stale starting point is refused.
select pg_temp.as_user('owner'); set local role authenticated;
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','queue',pg_temp.family(),'{"client_name":"customer","mobile":"phone"}'), '40001', 'Someone else changed this CRM form. Reload and try again.', 'saving from a stale link is refused');
insert into r select 'v2', save_crm_form_binding('queue',pg_temp.family(),'{"client_name":"customer","mobile":"phone"}'::jsonb,(select (v->>'versionId')::uuid from r where k='v1'));
reset role;
select is((select count(*)::int from crm_form_binding_versions where tenant_id=pg_temp.fx('tenant')), 2, 'each save is a new version');
select throws_ok(format('update crm_form_binding_versions set field_map=%L where id=%L','{}',(select v->>'versionId' from r where k='v1')), '42501', null, 'saved versions cannot be changed');

-- A new published version of the same form is used from its next opening.
select pg_temp.as_user('owner'); set local role authenticated;
insert into r select 'revision', to_jsonb(create_form_revision_with_audit((select v #>> '{}' from r where k='queue_form')::uuid,'{}'::jsonb));
select publish_form_with_audit((select v #>> '{}' from r where k='revision')::uuid);
insert into r select 'after_publish', get_crm_form_bindings();
reset role;
select is((select (v->'bindings'->0->'form'->'template'->>'version')::int from r where k='after_publish'), 2, 'CRM opens the newest published version of the linked form');

-- Another company cannot see or use this company's links or forms.
select pg_temp.as_user('outsider'); set local role authenticated;
select is(get_crm_form_bindings()->'bindings', '[]'::jsonb, 'another company sees no links');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','queue',pg_temp.family(),'{"client_name":"customer","mobile":"phone"}'), '22023', 'Choose a published form', 'another company cannot link this company''s form');
reset role;

-- Back to the standard CRM form.
select pg_temp.as_user('owner'); set local role authenticated;
select throws_ok(format('select clear_crm_form_binding(%L,%L)','queue',(select v->>'versionId' from r where k='v1')), '40001', null, 'clearing from a stale link is refused');
select lives_ok(format('select clear_crm_form_binding(%L,%L)','queue',(select v->>'versionId' from r where k='v2')), 'the owner returns to the standard CRM form');
select is(get_crm_form_bindings()->'bindings', '[]'::jsonb, 'no link is active afterwards');
reset role;
select is((select count(*)::int from audit_logs where action='crm_form_unlinked' and tenant_id=pg_temp.fx('tenant')), 1, 'returning to the standard form is audited');
select is((select count(*)::int from crm_form_binding_versions where tenant_id=pg_temp.fx('tenant')), 2, 'earlier link versions are kept');

select * from finish();
rollback;
