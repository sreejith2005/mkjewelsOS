begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local test.fms.assigned_to_label='true';
\ir helpers/fms_visit_assignment_fixture.psql
reset role;

-- Names whose A to Z order differs from the id order, including a lower-case name.
update user_profiles set employee_name=case id
  when (select id from visit_assignment_fixture where name='a') then 'Kiran'
  when (select id from visit_assignment_fixture where name='b') then 'Zara'
  when (select id from visit_assignment_fixture where name='c') then 'aarav'
  when (select id from visit_assignment_fixture where name='d') then 'Meera'
  when (select id from visit_assignment_fixture where name='e') then 'Bhavna' end
where id in (select id from visit_assignment_fixture where name in ('a','b','c','d','e'));

select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
create temporary table sorted_fixture(name text primary key,value jsonb);
grant all on sorted_fixture to authenticated;
insert into sorted_fixture values('request',jsonb_build_object('kind','stage_form',
 'instanceStageId',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),
 'formTemplateId',(select id from visit_assignment_fixture where name='form'),
 'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c')),'outcome','','remark','','checklist','{}'::jsonb));
set local role authenticated;

insert into sorted_fixture values('all',list_fms_handoff_recipients((select value from sorted_fixture where name='request'),(select id from visit_assignment_fixture where name='demo')));
select is(
  (select array_agg(p.person->>'employee_name' order by p.position) from jsonb_array_elements((select value->'people' from sorted_fixture where name='all')) with ordinality as p(person,position)),
  array['aarav','Bhavna','Kiran','Meera','Zara'],
  'eligible employees are listed A to Z, ignoring case');

insert into sorted_fixture values('page1',list_fms_handoff_recipients((select value from sorted_fixture where name='request'),(select id from visit_assignment_fixture where name='demo'),'',null,2));
insert into sorted_fixture values('page2',list_fms_handoff_recipients((select value from sorted_fixture where name='request'),(select id from visit_assignment_fixture where name='demo'),'',(select (value->>'nextCursor')::uuid from sorted_fixture where name='page1'),2));
insert into sorted_fixture values('page3',list_fms_handoff_recipients((select value from sorted_fixture where name='request'),(select id from visit_assignment_fixture where name='demo'),'',(select (value->>'nextCursor')::uuid from sorted_fixture where name='page2'),2));
select is(
  (select array_agg(p.person->>'employee_name' order by s.name, p.position) from sorted_fixture s, jsonb_array_elements(s.value->'people') with ordinality as p(person,position) where s.name in ('page1','page2','page3')),
  array['aarav','Bhavna','Kiran','Meera','Zara'],
  'paging continues in name order with no one skipped or repeated');
select is((select value->>'nextCursor' from sorted_fixture where name='page3'),null,'the last page has no further cursor');
select is(jsonb_array_length(list_fms_handoff_recipients((select value from sorted_fixture where name='request'),(select id from visit_assignment_fixture where name='demo'),'mee')->'people'),1,'search still filters names');

-- "Other" on choice questions.
reset role;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
select lives_ok($$select normalize_form_fields('[{"key":"q","label":"Q","type":"select","options":[{"value":"a","label":"A"}],"validation":{"allowOther":true}}]'::jsonb)$$,'a dropdown can allow an Other answer');
select throws_ok($$select normalize_form_fields('[{"key":"q","label":"Q","type":"text","validation":{"allowOther":true}}]'::jsonb)$$,'22023','Field validation contains unsupported values','only choice questions can allow Other');
select throws_ok($$select normalize_form_fields('[{"key":"q","label":"Q","type":"radio","options":[{"value":"a","label":"A"}],"validation":{"allowOther":"yes"}}]'::jsonb)$$,'22023','Field validation contains unsupported values','allowOther must be true or false');
select throws_ok($$select normalize_form_fields('[{"key":"q","label":"Q","type":"number","validation":{"min":"1"}}]'::jsonb)$$,'22023','Field validation contains unsupported values','numeric bounds still must be numbers');
set local role authenticated;

insert into sorted_fixture values('form',to_jsonb(save_form_draft_with_audit(null,'{"name":"Other answers","permissions":{"roles":["super_admin","staff"]}}'::jsonb,
 '[{"key":"source","label":"Lead source","type":"select","options":[{"value":"walk_in","label":"Walk-in"}],"validation":{"allowOther":true}},
   {"key":"metal","label":"Metal","type":"radio","options":[{"value":"gold","label":"Gold"}]},
   {"key":"wants","label":"Interested in","type":"multiselect","options":[{"value":"ring","label":"Ring"}],"validation":{"allowOther":true}},
   {"key":"tags","label":"Tags","type":"checkbox","options":[{"value":"vip","label":"VIP"}]}]'::jsonb)));
select lives_ok($$select publish_form_with_audit((select (value#>>'{}')::uuid from sorted_fixture where name='form'))$$,'a form with Other answers publishes');
select ok((select validation->'allowOther'='true'::jsonb from form_fields where form_template_id=(select (value#>>'{}')::uuid from sorted_fixture where name='form') and field_key='source'),'the Other setting is saved on the question');
select lives_ok($$select submit_form_with_audit((select (value#>>'{}')::uuid from sorted_fixture where name='form'),'{"source":"Instagram ad","metal":"gold","wants":["ring","Nose pin"]}'::jsonb)$$,'typed Other answers are accepted');
select is((select data->>'source' from form_submissions where form_template_id=(select (value#>>'{}')::uuid from sorted_fixture where name='form') order by submitted_at desc limit 1),'Instagram ad','the typed text is stored as the answer');
select lives_ok($$select submit_form_with_audit((select (value#>>'{}')::uuid from sorted_fixture where name='form'),'{"source":"walk_in","wants":["ring"]}'::jsonb)$$,'listed answers still work');
select throws_ok($$select submit_form_with_audit((select (value#>>'{}')::uuid from sorted_fixture where name='form'),'{"metal":"Silver"}'::jsonb)$$,'22023','Field metal contains an invalid option','a question without Other still rejects unlisted answers');
select throws_ok($$select submit_form_with_audit((select (value#>>'{}')::uuid from sorted_fixture where name='form'),'{"tags":["Regular"]}'::jsonb)$$,'22023','Field tags must contain unique configured options','a checkbox list without Other still rejects unlisted answers');
select throws_ok($$select submit_form_with_audit((select (value#>>'{}')::uuid from sorted_fixture where name='form'),'{"wants":["ring",""]}'::jsonb)$$,'22023','Field wants must contain unique configured options','a blank Other entry is rejected');
select throws_ok(format($$select submit_form_with_audit((select (value#>>'{}')::uuid from sorted_fixture where name='form'),%L::jsonb)$$,jsonb_build_object('wants',jsonb_build_array(repeat('x',501)))),'22023','Field wants must contain unique configured options','an Other entry over 500 characters is rejected');
select throws_ok($$select submit_form_with_audit((select (value#>>'{}')::uuid from sorted_fixture where name='form'),'{"wants":["Nose pin","Nose pin"]}'::jsonb)$$,'22023','Field wants must contain unique configured options','duplicate answers are still rejected');

reset role;
select ok(not has_function_privilege('anon','list_fms_handoff_recipients(jsonb,uuid,text,uuid,integer)','EXECUTE'),'anonymous callers still cannot list recipients');
select ok(has_function_privilege('authenticated','list_fms_handoff_recipients(jsonb,uuid,text,uuid,integer)','EXECUTE'),'signed-in employees can still list recipients');
select * from finish();
rollback;
