begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temp table fx(name text primary key, id uuid);
grant select on fx to authenticated;
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; person text;
begin
  insert into tenants(name,slug) values('Forms 0399','forms-0399') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','F99') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','F99S') returning id into d;
  foreach person in array array['owner','staff','other'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-f99@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled,week_off)
      values(t,a,b,d,'F99 '||person,'F99-'||person,person||'-f99@test.local',case person when 'owner' then 'super_admin' else 'staff' end::user_role,'active','active',true,'{}') returning id into u;
    insert into fx values(person,u),(person||'_auth',a);
  end loop;
  insert into fx values('tenant',t);
end $$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from fx where name=p||'_auth'),true),
    set_config('request.jwt.claims',json_build_object('role','authenticated','sub',(select id from fx where name=p||'_auth'))::text,true),
    set_config('request.jwt.claim.role','authenticated',true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;
create temp table r(k text primary key, v jsonb);
grant all on r to authenticated;
create function pg_temp.v(p text) returns text language sql stable as $$ select v #>> '{}' from r where k=p $$;
grant execute on function pg_temp.v(text) to authenticated;

-- An ordinary Forms Library form with a repeating group and a CRM photo question.
select pg_temp.as_user('owner'); set local role authenticated;
insert into r select 'form', to_jsonb(save_form_draft_with_audit(null,'{"name":"Visit log","description":"","sections":[],"permissions":{"roles":["super_admin","admin","manager","crm","staff"]}}'::jsonb,
  '[{"key":"who","label":"Who","type":"text","required":true},
    {"key":"people","label":"People","type":"repeat","required":true,"validation":{"repeat":{"countLabel":"How many?","min":1,"max":3,"fields":[
       {"key":"name","label":"Name","type":"text","required":true},
       {"key":"mobile","label":"Mobile","type":"phone"},
       {"key":"relation","label":"Relation","type":"select","options":[{"value":"friend","label":"Friend"},{"value":"family","label":"Family"}]}]}}},
    {"key":"tags","label":"Tags","type":"repeat","validation":{"repeat":{"countLabel":"How many tags?","min":1,"max":5,"allowNa":true,"fields":[{"key":"tag","label":"Tag","type":"text"}]}}},
    {"key":"photos","label":"Photos","type":"crm_photo","validation":{"crm":{"maxFiles":2}}}]'::jsonb));
select publish_form_with_audit(pg_temp.v('form')::uuid);
reset role;

-- 1. Repeating groups ----------------------------------------------------------------------
select pg_temp.as_user('staff'); set local role authenticated;
insert into r select 'sub1', to_jsonb(submit_form_with_audit(pg_temp.v('form')::uuid,
  '{"who":"Asha","people":{"kind":"repeat","count":"2","rows":[{"name":"  Ravi ","mobile":"+91 98765 43210","relation":"friend"},{"name":"Meena"},{"name":"extra row ignored"}]},"tags":{"kind":"repeat","count":"NA","rows":[]}}'::jsonb));
reset role;
select is((select data->'people' from form_submissions where id=pg_temp.v('sub1')::uuid),
  '{"kind":"repeat","count":"2","rows":[{"name":"Ravi","mobile":"+91 98765 43210","relation":"friend"},{"name":"Meena"}]}'::jsonb,
  'a repeating group submits in a JewelOS form, trimmed to the chosen count');
select is((select data->'tags'->>'count' from form_submissions where id=pg_temp.v('sub1')::uuid), 'NA', 'NA is accepted when the question offers it');

select pg_temp.as_user('staff'); set local role authenticated;
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),'{"who":"A","people":{"kind":"repeat","count":"4","rows":[]}}'),
  '22023', null, 'a count outside From / Up to is refused');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),'{"who":"A","people":{"kind":"repeat","count":"NA","rows":[]}}'),
  '22023', null, 'NA is refused when the question does not offer it');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),'{"who":"A","people":{"kind":"repeat","count":"1","rows":[{"mobile":"9876543210"}]}}'),
  '23514', null, 'a required row question must be answered');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),'{"who":"A","people":{"kind":"repeat","count":"1","rows":[{"name":"R","age":"9"}]}}'),
  '22023', null, 'a row answer for an unknown question is refused');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),'{"who":"A","people":{"kind":"repeat","count":"1","rows":[{"name":"R","mobile":"12"}]}}'),
  '22023', null, 'a row phone number is checked');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),'{"who":"A","people":{"kind":"repeat","count":"1","rows":[{"name":"R","relation":"boss"}]}}'),
  '22023', null, 'a row choice must be one of its options');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),'{"who":"A","people":{"kind":"repeat","count":"","rows":[]}}'),
  '23514', null, 'a required repeating group without a count is missing');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),'{"who":"A","people":["Ravi"]}'),
  '22023', null, 'a repeating group answer of the wrong shape is refused');
reset role;

-- 2. CRM photo questions upload through form-uploads ---------------------------------------
create function pg_temp.object(p_user text,p_name text) returns text language plpgsql as $$
declare path text:=(select id::text from fx where name='tenant')||'/'||pg_temp.v('form')||'/'||gen_random_uuid()||'_'||p_name;
begin
  insert into storage.objects(bucket_id,name,owner_id) values('form-uploads',path,(select id::text from fx where name=p_user||'_auth'));
  return path;
end $$;
insert into r values('p1',to_jsonb(pg_temp.object('staff','front.heic'))),('p2',to_jsonb(pg_temp.object('staff','side.jpg'))),
  ('p3',to_jsonb(pg_temp.object('staff','clip.mp4'))),('p4',to_jsonb(pg_temp.object('staff','doc.pdf'))),('p5',to_jsonb(pg_temp.object('other','other.jpg'))),
  ('p6',to_jsonb(pg_temp.object('staff','third.png')));
select pg_temp.as_user('staff'); set local role authenticated;
select ok(can_write_form_upload_object(pg_temp.v('p1')), 'staff may upload to a form with a CRM photo question');
insert into r select 'u1', to_jsonb(register_form_upload(pg_temp.v('form')::uuid,'photos',pg_temp.v('p1'),'front.heic','image/heic',2048));
insert into r select 'u2', to_jsonb(register_form_upload(pg_temp.v('form')::uuid,'photos',pg_temp.v('p2'),'side.jpg','image/jpeg',2048));
insert into r select 'u6', to_jsonb(register_form_upload(pg_temp.v('form')::uuid,'photos',pg_temp.v('p6'),'third.png','image/png',2048));
select throws_ok(format('select register_form_upload(%L,%L,%L,%L,%L,%s)',pg_temp.v('form'),'photos',pg_temp.v('p3'),'clip.mp4','video/mp4',2048),
  '22023', null, 'a video is refused unless the question accepts videos');
select throws_ok(format('select register_form_upload(%L,%L,%L,%L,%L,%s)',pg_temp.v('form'),'photos',pg_temp.v('p4'),'doc.pdf','application/pdf',2048),
  '22023', null, 'a PDF is not a photo');
select throws_ok(format('select register_form_upload(%L,%L,%L,%L,%L,%s)',pg_temp.v('form'),'who',pg_temp.v('p2'),'side.jpg','image/jpeg',2048),
  '22023', null, 'uploads go only to file and CRM photo questions');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),
  json_build_object('who','A','people',json_build_object('kind','repeat','count','1','rows',json_build_array(json_build_object('name','R'))),
    'photos',json_build_object('kind','crm_files','files',json_build_array(json_build_object('path',pg_temp.v('u1')),json_build_object('path',pg_temp.v('u2')),json_build_object('path',pg_temp.v('u6')))))),
  '22023', null, 'more files than the question allows are refused');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),
  json_build_object('who','A','people',json_build_object('kind','repeat','count','1','rows',json_build_array(json_build_object('name','R'))),
    'photos',json_build_object('kind','crm_files','files',json_build_array(json_build_object('path',pg_temp.v('u1')),json_build_object('path',pg_temp.v('u1')))))),
  '23503', null, 'one upload cannot be listed twice');
insert into r select 'sub2', to_jsonb(submit_form_with_audit(pg_temp.v('form')::uuid,
  json_build_object('who','A','people',json_build_object('kind','repeat','count','1','rows',json_build_array(json_build_object('name','R'))),
    'photos',json_build_object('kind','crm_files','files',json_build_array(json_build_object('path',pg_temp.v('u1'),'clientId','','fileName','spoofed.exe','mimeType','x/y'),json_build_object('path',pg_temp.v('u2')))))::jsonb));
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),
  json_build_object('who','A','people',json_build_object('kind','repeat','count','1','rows',json_build_array(json_build_object('name','R'))),
    'photos',json_build_object('kind','crm_files','files',json_build_array(json_build_object('path',pg_temp.v('u1')))))),
  '23503', null, 'an upload already used by a submission cannot be reused');
reset role;
select is((select data->'photos' from form_submissions where id=pg_temp.v('sub2')::uuid),
  jsonb_build_object('kind','crm_files','files',jsonb_build_array(
    jsonb_build_object('path',pg_temp.v('u1'),'clientId','','fileName','front.heic','mimeType','image/heic'),
    jsonb_build_object('path',pg_temp.v('u2'),'clientId','','fileName','side.jpg','mimeType','image/jpeg'))),
  'the photos are saved with the names and types the server registered');
select is((select count(*)::integer from form_submission_files where form_submission_id=pg_temp.v('sub2')::uuid), 2, 'both uploads are linked to the submission');

-- Someone else's upload cannot be claimed.
select pg_temp.as_user('other'); set local role authenticated;
insert into r select 'u5', to_jsonb(register_form_upload(pg_temp.v('form')::uuid,'photos',pg_temp.v('p5'),'other.jpg','image/jpeg',2048));
reset role;
select pg_temp.as_user('staff'); set local role authenticated;
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',pg_temp.v('form'),
  json_build_object('who','A','people',json_build_object('kind','repeat','count','1','rows',json_build_array(json_build_object('name','R'))),
    'photos',json_build_object('kind','crm_files','files',json_build_array(json_build_object('path',pg_temp.v('u5')))))),
  '23503', null, 'another person''s upload is refused');
reset role;

-- Customer Integration keeps both types operational (never copied into a CRM client detail).
select ok(position($$'file','repeat','crm_photo'))$$ in pg_get_functiondef('crm_sync.save_customer_mapping(uuid,jsonb,uuid)'::regprocedure))>0,
  'a repeating group or photo question cannot fill a CRM client detail');

-- 3. FMS workflow forms placement ----------------------------------------------------------
insert into r select 'family', to_jsonb(family_id) from form_templates where id=pg_temp.v('form')::uuid;
do $$
declare t uuid:=(select id from fx where name='tenant'); u uuid:=(select id from fx where name='owner'); f uuid; flow uuid;
begin
  -- A questionnaire built in a step.
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by,library_visible)
    values(t,'Call questions',1,'published',true,u,u,false) returning id into f;
  insert into r values('stage_form',to_jsonb(f)),('stage_family',to_jsonb((select family_id from form_templates where id=f)));
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
    values(t,gen_random_uuid(),1,'Leads','tenant','draft',true,u,u,2) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'call','Call','task',0,true,'{"questionnaire":{"origin":"stage"}}',f);
  insert into r values('flow',to_jsonb(flow));
end $$;
create function pg_temp.listed(p_family text) returns jsonb language sql stable as $$
  select item from jsonb_array_elements(list_fms_built_forms()) item where item->>'familyId'=p_family $$;
grant execute on function pg_temp.listed(text) to authenticated;

select pg_temp.as_user('owner'); set local role authenticated;
select ok(pg_temp.listed(pg_temp.v('stage_family')) is not null, 'a form built in a step is an FMS workflow form');
select ok(pg_temp.listed(pg_temp.v('family')) is null, 'a Forms Library form is not');
select is(set_form_family_placement(pg_temp.v('form')::uuid,'fms')->>'placement', 'fms', 'an author moves a form to FMS workflow forms');
select is(pg_temp.listed(pg_temp.v('family'))->>'placement', 'fms', 'it is now listed under FMS workflow forms');
select is(pg_temp.listed(pg_temp.v('family'))->>'unlinked', 'true', 'and shown as not used by a step yet');
reset role;
-- A step that merely links a family marked FMS lists it under that step.
insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
  values(pg_temp.v('flow')::uuid,'visit','Visit','task',1,true,'{}',pg_temp.v('form')::uuid);
select pg_temp.as_user('owner'); set local role authenticated;
select is(pg_temp.listed(pg_temp.v('family'))->'links'->0->>'stageName', 'Visit', 'a marked form shows the step that links it');
select ok(not (pg_temp.listed(pg_temp.v('family')) ? 'unlinked'), 'and is no longer unlinked');
select is(set_form_family_placement(pg_temp.v('stage_form')::uuid,'library')->>'placement', 'library', 'an author moves a step-built form to Forms Library');
select ok(pg_temp.listed(pg_temp.v('stage_family')) is null, 'it leaves FMS workflow forms');
select is(set_form_family_placement(pg_temp.v('stage_form')::uuid,'library')->>'changed', 'false', 'repeating the same move changes nothing');
select throws_ok(format('select set_form_family_placement(%L,%L)',pg_temp.v('form'),'crm'), '22023', null, 'only FMS or Library placements exist');
reset role;
select is((select count(*)::integer from audit_logs where action='form_family_placement_changed' and tenant_id=(select id from fx where name='tenant')), 2, 'each move is audited once');

-- Staff (not form authors) see the classification but cannot move forms.
select pg_temp.as_user('staff'); set local role authenticated;
select ok(not has_permission('forms.manage'), 'staff are not form authors');
select ok(pg_temp.listed(pg_temp.v('family')) is not null, 'staff see the marked form under FMS workflow forms');
select ok(not (pg_temp.listed(pg_temp.v('family')) ? 'placement'), 'without author-only details');
select throws_ok(format('select set_form_family_placement(%L,%L)',pg_temp.v('form'),'library'), '42501', null, 'staff cannot move forms');
select throws_ok($$select * from form_family_placements$$, '42501', null, 'the placement table is not readable directly');
reset role;
select ok(not has_function_privilege('anon','set_form_family_placement(uuid,text)','EXECUTE'), 'anonymous callers cannot move forms');

-- Another company's author cannot move this company's form.
do $$
declare t uuid; b uuid; d uuid; a uuid:=gen_random_uuid();
begin
  insert into tenants(name,slug) values('Other 0399','other-0399') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Other','O99') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Other','O99') returning id into d;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','x-f99@test.local','x',now(),now());
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
    values(t,a,b,d,'Other owner','O99-1','x-f99@test.local','super_admin','active','active',true);
  insert into fx values('x_auth',a);
end $$;
select pg_temp.as_user('x'); set local role authenticated;
select throws_ok(format('select set_form_family_placement(%L,%L)',pg_temp.v('form'),'library'), '42501', null, 'another tenant cannot move this tenant''s form');
select ok(pg_temp.listed(pg_temp.v('family')) is null, 'another tenant sees nothing of it');
reset role;

-- Inactive accounts are refused.
update user_profiles set account_status='inactive' where id=(select id from fx where name='owner');
select pg_temp.as_user('owner'); set local role authenticated;
select throws_ok(format('select set_form_family_placement(%L,%L)',pg_temp.v('form'),'library'), '42501', null, 'an inactive author is refused');
reset role;

select * from finish();
rollback;
