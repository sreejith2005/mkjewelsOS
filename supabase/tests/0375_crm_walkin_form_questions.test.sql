begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temp table cw(name text primary key, id uuid);
grant select on cw to authenticated;
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; person text;
begin
  insert into tenants(name,slug) values('CRM walk-in','crm-walkin-375') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','CW5') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','CW5S') returning id into d;
  foreach person in array array['owner','staff'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-cw@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled,week_off)
      values(t,a,b,d,'Cw '||person,'CW-'||person,person||'-cw@test.local',case person when 'owner' then 'super_admin' else 'staff' end::user_role,'active','active',true,'{}') returning id into u;
    insert into cw values(person,u),(person||'_auth',a);
  end loop;
  insert into cw values('tenant',t);
end $$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from cw where name=p||'_auth'),true),
    set_config('request.jwt.claims',json_build_object('role','authenticated','sub',(select id from cw where name=p||'_auth'))::text,true),
    set_config('request.jwt.claim.role','authenticated',true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;
create temp table r(k text primary key, v jsonb);
grant all on r to authenticated;

select pg_temp.as_user('owner'); set local role authenticated;
-- A repeating group, a CRM photo and CRM behaviours save as ordinary questions.
insert into r select 'walkin_form', to_jsonb(save_form_draft_with_audit(null,'{"name":"Walk-in","description":"","sections":[],"permissions":{"roles":["super_admin","admin","manager","crm","staff"]}}'::jsonb,
  '[{"key":"primary_name","label":"Client name","type":"text","required":true},
    {"key":"primary_phone","label":"Mobile","type":"phone","required":true,"validation":{"crm":{"lookup":"client_phone"},"width":"half"}},
    {"key":"salesperson","label":"Salesperson","type":"text","validation":{"crm":{"choices":"salespeople"}}},
    {"key":"visit_status","label":"Client bought any product?","type":"select","required":true,"options":[{"value":"yes","label":"YES"},{"value":"no","label":"NO"}]},
    {"key":"companions","label":"Family / friends","type":"repeat","validation":{"repeat":{"countLabel":"How many?","min":0,"max":10,"fields":[{"key":"name","label":"Name","type":"text"}]}}},
    {"key":"proof","label":"Google review proof","type":"crm_photo","validation":{"crm":{"maxFiles":1,"video":false}}},
    {"key":"next_visit_date","label":"Next visit date","type":"date"},
    {"key":"next_visit_date_other","label":"Next visit date","type":"date"}]'::jsonb));
select publish_form_with_audit((select v #>> '{}' from r where k='walkin_form')::uuid);
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Bad","description":"","sections":[],"permissions":{"roles":["staff"]}}'::jsonb,'[{"key":"g","label":"G","type":"repeat"}]'::jsonb)$$,
  null, null, 'a repeating group without its row questions is refused');
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Bad","description":"","sections":[],"permissions":{"roles":["staff"]}}'::jsonb,'[{"key":"g","label":"G","type":"text","validation":{"repeat":{"countLabel":"x","min":0,"max":1,"fields":[{"key":"a","label":"A","type":"text"}]}}}]'::jsonb)$$,
  null, null, 'only a repeating group may list row questions');
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Bad","description":"","sections":[],"permissions":{"roles":["staff"]}}'::jsonb,'[{"key":"g","label":"G","type":"text","validation":{"crm":{"anything":true}}}]'::jsonb)$$,
  null, null, 'unknown CRM settings are refused');
reset role;
select is((select field_type from form_fields where form_template_id=(select v #>> '{}' from r where k='walkin_form')::uuid and field_key='companions'), 'repeat', 'a repeating group is saved');
select is((select validation->'repeat'->>'countLabel' from form_fields where form_template_id=(select v #>> '{}' from r where k='walkin_form')::uuid and field_key='companions'), 'How many?', 'with its "How many?" question');
select is((select validation->'crm'->>'lookup' from form_fields where form_template_id=(select v #>> '{}' from r where k='walkin_form')::uuid and field_key='primary_phone'), 'client_phone', 'a CRM lookup is saved on the mobile question');
insert into r select 'family', to_jsonb(family_id) from form_templates where id=(select v #>> '{}' from r where k='walkin_form')::uuid;
create function pg_temp.family() returns uuid language sql stable as $$ select (v #>> '{}')::uuid from r where k='family' $$;
grant execute on function pg_temp.family() to authenticated;

-- Since 0399 a repeating group answer submits in JewelOS forms too (owner request 2026-11-09).
select pg_temp.as_user('staff'); set local role authenticated;
select lives_ok(format('select submit_form_with_audit(%L,%L::jsonb)',(select v #>> '{}' from r where k='walkin_form'),
  '{"primary_name":"Asha","primary_phone":"9876543210","visit_status":"yes","companions":{"kind":"repeat","count":"1","rows":[{"name":"Ravi"}]}}'),
  'a repeating group answer submits outside CRM (0399)');
reset role;

-- Walk-in links.
select pg_temp.as_user('owner'); set local role authenticated;
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','walkin',pg_temp.family(),'{"primary_name":"primary_name","primary_phone":"primary_phone"}'),
  '22023', 'Link every required CRM answer to a question', 'the walk-in needs the client, mobile and visit status');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','walkin',pg_temp.family(),'{"primary_name":"primary_name","primary_phone":"primary_phone","visit_status":"visit_status","next_visit_date":["next_visit_date","next_visit_date_other","primary_name","proof"]}'),
  '22023', 'One CRM answer can come from up to three walk-in questions', 'at most three questions per answer');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','walkin',pg_temp.family(),'{"primary_name":"primary_name","primary_phone":"primary_phone","visit_status":"visit_status","next_visit_date":["next_visit_date","primary_name"]}'),
  '22023', 'One question can fill only one CRM answer', 'a question used twice is refused');
select lives_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','walkin',pg_temp.family(),
  '{"primary_name":"primary_name","primary_phone":"primary_phone","visit_status":"visit_status","salesperson":"salesperson","companions":"companions","engagement_google_review_proof":"proof","next_visit_date":["next_visit_date","next_visit_date_other"]}'),
  'the owner links the walk-in form, with one answer from two questions');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','lead',pg_temp.family(),'{"mobile_no":["primary_phone","salesperson"]}'),
  '22023', 'One CRM answer can come from up to three walk-in questions', 'alternative questions belong to the walk-in form');
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','lead',pg_temp.family(),'{"mobile_no":"primary_phone","companions":"companions"}'),
  '22023', 'Repeating groups and CRM photos belong to the walk-in form', 'a lead form cannot use CRM-only questions');
reset role;
select is((select field_map->'next_visit_date' from crm_form_binding_versions v join crm_form_bindings b on b.active_version_id=v.id where b.purpose='walkin' and b.tenant_id=(select id from cw where name='tenant')),
  '["next_visit_date","next_visit_date_other"]'::jsonb, 'the walk-in link keeps both questions for Next visit date');
select pg_temp.as_user('staff'); set local role authenticated;
select throws_ok(format('select save_crm_form_binding(%L,%L,%L::jsonb)','walkin',pg_temp.family(),'{}'), '42501', null, 'staff cannot link forms');
reset role;

select * from finish();
rollback;
