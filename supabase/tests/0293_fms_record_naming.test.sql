begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select set_config('test.fms.with_title','true',true);
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
insert into visit_assignment_fixture values('named_form',save_form_draft_with_audit(null,
 '{"name":"Record naming test","record_name_field_key":"order_number","permissions":{"roles":["staff"]}}',
 '[{"key":"customer_name","label":"Customer Name","type":"text"},{"key":"order_number","label":"Order Number","type":"text"}]'));
select is((select record_name_field_key from form_templates where id=(select id from visit_assignment_fixture where name='named_form')),'order_number','form default persists through audited save');
select ok(exists(select 1 from audit_logs where record_id=(select id from visit_assignment_fixture where name='named_form') and action='form_record_name_updated'),'record naming has an audit event');
insert into visit_assignment_fixture values('named_copy',duplicate_form_with_audit((select id from visit_assignment_fixture where name='named_form'),'Naming copy'));
select is((select record_name_field_key from form_templates where id=(select id from visit_assignment_fixture where name='named_copy')),'order_number','duplicate keeps naming default');
select lives_ok($$select publish_form_with_audit((select id from visit_assignment_fixture where name='named_form'))$$,'named form publishes');
select lives_ok($$select submit_form_with_audit((select id from visit_assignment_fixture where name='named_form'),'{"customer_name":"Rahul Shah","order_number":"ORD-1"}')$$,'named form submits through existing audited contract');
select is((select template_snapshot#>>'{template,record_name_field_key}' from form_submissions where form_template_id=(select id from visit_assignment_fixture where name='named_form') limit 1),'order_number','snapshot pins naming metadata');
insert into visit_assignment_fixture values('named_revision',create_form_revision_with_audit((select id from visit_assignment_fixture where name='named_form')));
select is((select record_name_field_key from form_templates where id=(select id from visit_assignment_fixture where name='named_revision')),'order_number','revision inherits default without editing prior version');
select throws_ok($$select save_published_form_with_audit((select id from visit_assignment_fixture where name='named_form'),
 '{"name":"Record naming test","record_name_field_key":"customer_name","permissions":{"roles":["staff"]}}',
 '[{"key":"customer_name","label":"Customer Name","type":"text"},{"key":"order_number","label":"Order Number","type":"text"}]')$$,'23514',null,'used published naming requires a revision');
select is((select record_name_field_key from form_templates where id=(select id from visit_assignment_fixture where name='named_form')),'order_number','failed edit preserves original naming');
select set_config('jewelos.allow_record_name_write','off',true);
select throws_ok($$update form_templates set record_name_field_key='customer_name' where id=(select id from visit_assignment_fixture where name='named_copy')$$,'42501',null,'direct metadata mutation cannot bypass audited writer');
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Invalid","record_name_field_key":"private_notes"}',
 '[{"key":"private_notes","label":"Private Notes","type":"text"}]')$$,'23514',null,'sensitive fields cannot be naming defaults');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((get_fms_assigned_work_context((select id from visit_assignment_fixture where name='instance'),
 (select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')))->>'recordName'),'Synthetic client - Call','legacy template uses safe historical values');
reset role;
select * from finish();
rollback;
