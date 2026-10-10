begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_column('public','fms_flows','execution_version','publications select an execution version');
select has_column('public','fms_instances','execution_version','instances pin their execution semantics');
select has_column('public','fms_instance_stages','visit_number','visits have distinct numbers');
select has_column('public','fms_instance_stages','execution_scope_id','convergence is scoped to one pass');
select has_table('public','fms_execution_scopes','parallel cohorts are persisted');
select has_table('public','fms_join_arrivals','join readiness uses cohort arrivals');
select ok(not has_function_privilege('authenticated','activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer)','EXECUTE'),'activation remains owner-only');

create temporary table loop_fixture(name text primary key,id uuid);
grant select,insert,update on loop_fixture to authenticated;
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; f uuid; flow uuid; s uuid; follow uuid; finish uuid;
begin
  insert into tenants(name,slug) values('Loop test','loop-test') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','LOOP') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','LSAL') returning id into d;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','loops@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
    values(t,a,b,d,'Loop owner','LOOP1','loops@test.local','super_admin','active',true) returning id into u;
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
    values(t,'Loop details',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'note','Note','text',0);
  update form_templates set lifecycle='published' where id=f;
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
    values(t,gen_random_uuid(),1,'Loop workflow','tenant','draft',true,u,u) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'start','Start','form',0,true,'{"deadlineEnabled":false}',f) returning id into s;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(flow,'follow','Follow up 3','task',1,true,'{"deadlineEnabled":false,"decisionMode":"yes_no","decisionOptions":[{"key":"repeat","label":"Repeat"},{"key":"finish","label":"Finish"}]}') returning id into follow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(flow,'finish','Finish','task',2,true,'{"deadlineEnabled":false}') returning id into finish;
  update fms_stages set default_next_stage_id=follow where id=s;
  update fms_stages set default_next_stage_id=finish where id=follow;
  insert into fms_branch_rules(fms_stage_id,source_type,condition_field,condition_operator,condition_value,next_stage_id,sort_order)
    values(follow,'outcome','outcome','equals','repeat',s,0);
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) select id,'specific_user',u,0 from fms_stages where fms_flow_id=flow;
  insert into loop_fixture values('tenant',t),('branch',b),('department',d),('auth',a),('user',u),('form',f),('flow',flow),('start',s),('follow',follow),('finish',finish);
end $$;
select lives_ok($$select assert_fms_flow_publishable((select id from loop_fixture where name='flow'))$$,'a conditional backward route is publishable');
select set_config('request.jwt.claim.sub',(select id::text from loop_fixture where name='auth'),true);
set local role authenticated;
select lives_ok($$select publish_fms_flow_with_audit((select id from loop_fixture where name='flow'))$$,'authorized publication selects loop semantics');
insert into loop_fixture select 'instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='flow'),'Repeat then finish');
insert into loop_fixture select 'first_work',id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='start');
reset role;
-- Simulate a delivered inbox item before completing the durable assignment.
insert into notifications(tenant_id,user_profile_id,event_type,title,message,channel,source_module,source_record_id,link_url) values((select id from loop_fixture where name='tenant'),(select id from loop_fixture where name='user'),'fms_stage_assigned','Loop work','Assigned','in_app','fms',(select id from loop_fixture where name='first_work'),'/tasks/fms?instance='||(select id from loop_fixture where name='instance')||'&stage='||(select id from loop_fixture where name='first_work'));
set local role authenticated;

select is((select execution_version from fms_instances where id=(select id from loop_fixture where name='instance')),2,'new instance pins the new engine');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"first"}','fms_stage',(select id from loop_fixture where name='first_work'),gen_random_uuid())$$,'initial form progresses atomically');
select lives_ok($$select complete_fms_stage_with_audit((select id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='follow') and status='in_progress'),'repeat')$$,'return creates fresh initial-form work');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='start')),2,'two distinct visits exist');
select is((select status::text from fms_instance_stages where id=(select id from loop_fixture where name='first_work')),'completed','earlier completion stays intact');
select is((select data->>'note' from form_submissions where id=(select form_submission_id from fms_instance_stages where id=(select id from loop_fixture where name='first_work'))),'first','earlier submitted answers stay intact');
select is((select visit_number from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='start') and status='in_progress'),2,'fresh work is visit two');
select is((select form_submission_id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='start') and status='in_progress'),null::uuid,'old submission cannot satisfy fresh work');
select throws_ok($$select complete_fms_stage_with_audit((select id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='start') and status='in_progress'))$$,'23514','The initial details form submission is required','direct completion cannot reuse old form evidence');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"second"}','fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='start') and status='in_progress'),gen_random_uuid())$$,'second visit gets its own form and successor');
select lives_ok($$select complete_fms_stage_with_audit((select id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='follow') and status='in_progress'),'repeat')$$,'a second return creates visit three');
select is((select max(visit_number) from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='start')),3,'multiple repetitions retain all visits');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"third"}','fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='start') and status='in_progress'),gen_random_uuid())$$,'third visit has fresh form work');
select lives_ok($$select complete_fms_stage_with_audit((select id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='follow') and status='in_progress'),'finish')$$,'second follow-up can exit the loop');
select lives_ok($$select complete_fms_stage_with_audit((select id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='instance') and fms_stage_id=(select id from loop_fixture where name='finish') and status='in_progress'))$$,'leaf completion finishes the instance');
select is((select status::text from fms_instances where id=(select id from loop_fixture where name='instance')),'completed','workflow finishes after exiting');
reset role;
select ok((select count(*)>0 from audit_logs where action='fms_stage_revisited' and tenant_id=(select id from loop_fixture where name='tenant')),'fresh visit is audited');
select ok(not has_table_privilege('authenticated','fms_execution_scopes','INSERT'),'clients cannot forge scopes');
select ok(not has_table_privilege('authenticated','fms_join_arrivals','INSERT'),'clients cannot forge join arrivals');

-- Parallel replay: the same split/join runs twice, with unrelated branches kept open.
do $$
declare f uuid; s uuid; split uuid; a uuid; b uuid; j uuid; decide uuid; finish uuid; u uuid; t uuid;
begin
 select id into u from loop_fixture where name='user'; select id into t from loop_fixture where name='tenant';
 insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by) values(t,gen_random_uuid(),1,'Parallel repeat','tenant','draft',true,u,u) returning id into f;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(f,'start','Start','form',0,true,'{"deadlineEnabled":false}',(select id from loop_fixture where name='form')) returning id into s;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'split','Split','parallel_start',1,true,'{}') returning id into split;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'a','Branch A','task',2,true,'{"deadlineEnabled":false,"decisionMode":"yes_no","decisionOptions":[{"key":"repeat","label":"Repeat"},{"key":"join","label":"Join"}]}') returning id into a;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'b','Branch B','task',3,true,'{"deadlineEnabled":false}') returning id into b;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,join_rule) values(f,'join','Join','parallel_join',4,true,'{}','all') returning id into j;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'decide','Decide','task',5,true,'{"deadlineEnabled":false,"decisionMode":"yes_no","decisionOptions":[{"key":"repeat","label":"Repeat"},{"key":"finish","label":"Finish"}]}') returning id into decide;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'finish','Finish','task',6,true,'{"deadlineEnabled":false}') returning id into finish;
 update fms_stages set default_next_stage_id=split where id=s;
 update fms_stages set parallel_target_stage_ids=array[a,b] where id=split;
 update fms_stages set default_next_stage_id=j where id in(a,b);
 update fms_stages set default_next_stage_id=decide where id=j;
 update fms_stages set default_next_stage_id=finish where id=decide;
 insert into fms_branch_rules(fms_stage_id,source_type,condition_field,condition_operator,condition_value,next_stage_id,sort_order) values(a,'outcome','outcome','equals','repeat',a,0),(decide,'outcome','outcome','equals','repeat',split,0);
 insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) select id,'specific_user',u,0 from fms_stages where fms_flow_id=f and step_type in('form','task');
 insert into loop_fixture values('parallel_flow',f),('parallel_start',s),('parallel_a',a),('parallel_b',b),('parallel_join',j),('parallel_split',split),('parallel_decide',decide),('parallel_finish',finish);
end $$;
set local role authenticated;
select lives_ok($$select publish_fms_flow_with_audit((select id from loop_fixture where name='parallel_flow'))$$,'parallel loop definition publishes');
insert into loop_fixture select 'parallel_instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='parallel_flow'),'Parallel replay');
create function pg_temp.parallel_work(p_key text) returns uuid language sql as $$select id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='parallel_instance') and fms_stage_id=(select id from loop_fixture where name=p_key) and status in('in_progress','in_review') order by visit_number desc limit 1$$;
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"parallel"}','fms_stage',pg_temp.parallel_work('parallel_start'),gen_random_uuid())$$,'entry activates both branches');
insert into loop_fixture values('parallel_b_original',pg_temp.parallel_work('parallel_b'));
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.parallel_work('parallel_a'),'repeat')$$,'a local branch can repeat itself');
select is(pg_temp.parallel_work('parallel_b'),(select id from loop_fixture where name='parallel_b_original'),'local loop preserves sibling work');
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.parallel_work('parallel_a'),'join')$$,'repeated branch reaches its cohort join');
select is(pg_temp.parallel_work('parallel_decide'),null::uuid,'all join waits for the sibling');
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.parallel_work('parallel_b'))$$,'sibling completes the first join');
select isnt(pg_temp.parallel_work('parallel_decide'),null::uuid,'join activates one successor');
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.parallel_work('parallel_decide'),'repeat')$$,'return replays the split in a fresh cohort');
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.parallel_work('parallel_a'),'join')$$,'new branch arrives at the second join');
select is(pg_temp.parallel_work('parallel_decide'),null::uuid,'old sibling completion cannot satisfy the second join');
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.parallel_work('parallel_b'))$$,'new sibling satisfies only its current cohort');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='parallel_instance') and fms_stage_id=(select id from loop_fixture where name='parallel_join')),2,'each join activation has its own history');
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.parallel_work('parallel_decide'),'finish')$$,'second pass exits normally');
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.parallel_work('parallel_finish'))$$,'parallel replay finishes');
reset role;
-- Automatic fan-out must allocate every branch before deciding it is finished.
do $$
declare f uuid; s uuid; split uuid; a uuid; b uuid; u uuid; t uuid;
begin
 select id into u from loop_fixture where name='user'; select id into t from loop_fixture where name='tenant';
 insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by) values(t,gen_random_uuid(),1,'Automatic split','tenant','draft',true,u,u) returning id into f;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(f,'start','Start','form',0,true,'{"deadlineEnabled":false}',(select id from loop_fixture where name='form')) returning id into s;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'split','Split','parallel_start',1,true,'{}') returning id into split;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'notice','Notice','notification',2,true,'{}') returning id into a;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'work','Work','task',3,true,'{"deadlineEnabled":false}') returning id into b;
 update fms_stages set default_next_stage_id=split where id=s; update fms_stages set parallel_target_stage_ids=array[a,b] where id=split;
 insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) values(s,'specific_user',u,0),(b,'specific_user',u,0);
 insert into loop_fixture values('auto_flow',f),('auto_start',s),('auto_work',b);
end $$;
set local role authenticated;
select publish_fms_flow_with_audit((select id from loop_fixture where name='auto_flow'));
insert into loop_fixture select 'auto_instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='auto_flow'),'Automatic fanout');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"auto"}','fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='auto_instance') and fms_stage_id=(select id from loop_fixture where name='auto_start')),gen_random_uuid())$$,'automatic leaf does not finish before the second branch is allocated');
select is((select status::text from fms_instances where id=(select id from loop_fixture where name='auto_instance')),'active','human branch keeps the instance active');
reset role;
-- Shared convergence must retain both branches, even when the second arrives late.
do $$
declare f uuid; entry uuid; split uuid; a uuid; b uuid; c uuid; j uuid; leaf uuid; u uuid; t uuid;
begin
 select id into u from loop_fixture where name='user'; select id into t from loop_fixture where name='tenant';
 insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by) values(t,gen_random_uuid(),1,'Convergence','tenant','draft',true,u,u) returning id into f;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(f,'entry','Entry','form',0,true,'{"deadlineEnabled":false}',(select id from loop_fixture where name='form')) returning id into entry;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'split','Split','parallel_start',1,true,'{}') returning id into split;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'a','A','task',2,true,'{"deadlineEnabled":false}') returning id into a;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'b','B','task',3,true,'{"deadlineEnabled":false}') returning id into b;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'c','Shared','task',4,true,'{"deadlineEnabled":false}') returning id into c;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,join_rule) values(f,'j','Join','parallel_join',5,true,'{}','all') returning id into j;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'leaf','Finish','task',6,true,'{"deadlineEnabled":false}') returning id into leaf;
 update fms_stages set default_next_stage_id=split where id=entry;
 update fms_stages set parallel_target_stage_ids=array[a,b] where id=split;
 update fms_stages set default_next_stage_id=c where id in(a,b);
 update fms_stages set default_next_stage_id=j where id=c;
 update fms_stages set default_next_stage_id=leaf where id=j;
 insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) select id,'specific_user',u,0 from fms_stages where fms_flow_id=f and step_type in('form','task');
 insert into loop_fixture values('merge_flow',f);
end $$;
set local role authenticated;
select publish_fms_flow_with_audit((select id from loop_fixture where name='merge_flow'));
create function pg_temp.merge_work(p_instance uuid,p_key text) returns uuid language sql as $$select runtime.id from fms_instance_stages runtime join fms_stages d on d.id=runtime.fms_stage_id where runtime.fms_instance_id=p_instance and d.stage_key=p_key and runtime.status='in_progress' order by runtime.visit_number desc limit 1$$;
insert into loop_fixture select 'merge_instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='merge_flow'),'Shared work');
select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"merge"}','fms_stage',pg_temp.merge_work((select id from loop_fixture where name='merge_instance'),'entry'),gen_random_uuid());
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_instance'),'a'));
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_instance'),'b'));
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_instance'),'c'));
select isnt(pg_temp.merge_work((select id from loop_fixture where name='merge_instance'),'leaf'),null::uuid,'shared completion carries both branches into all join');
select is((select count(*)::integer from fms_instance_stages r join fms_stages d on d.id=r.fms_stage_id where r.fms_instance_id=(select id from loop_fixture where name='merge_instance') and d.stage_key='c'),1,'convergence creates one shared assignment');
insert into loop_fixture select 'merge_late_instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='merge_flow'),'Late branch');
select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"merge late"}','fms_stage',pg_temp.merge_work((select id from loop_fixture where name='merge_late_instance'),'entry'),gen_random_uuid());
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_late_instance'),'a'));
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_late_instance'),'c'));
select is(pg_temp.merge_work((select id from loop_fixture where name='merge_late_instance'),'leaf'),null::uuid,'completed shared task still waits for the other branch');
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_late_instance'),'b'))$$,'late branch propagates through the persisted successor');
select isnt(pg_temp.merge_work((select id from loop_fixture where name='merge_late_instance'),'leaf'),null::uuid,'late convergence satisfies the all join');
select is((select count(*)::integer from fms_instance_stages r join fms_stages d on d.id=r.fms_stage_id where r.fms_instance_id=(select id from loop_fixture where name='merge_late_instance') and d.stage_key='c'),1,'late arrival preserves the completed shared assignment');
reset role;
-- Late convergence follows an already chosen return visit exactly once.
reset role;
do $$
declare f uuid; c uuid; a uuid;
begin
 f:=create_fms_revision_with_audit((select id from loop_fixture where name='merge_flow'));
 select id into c from fms_stages where fms_flow_id=f and stage_key='c'; select id into a from fms_stages where fms_flow_id=f and stage_key='a';
 update fms_stages set planned_time_rule='{"deadlineEnabled":false,"decisionMode":"yes_no","decisionOptions":[{"key":"repeat","label":"Repeat"},{"key":"finish","label":"Finish"}]}' where id=c;
 insert into fms_branch_rules(fms_stage_id,source_type,condition_field,condition_operator,condition_value,next_stage_id,sort_order) values(c,'outcome','outcome','equals','repeat',a,0);
 insert into loop_fixture values('merge_return_flow',f);
end $$;
set local role authenticated;
select publish_fms_flow_with_audit((select id from loop_fixture where name='merge_return_flow'));
insert into loop_fixture select 'merge_return_instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='merge_return_flow'),'Late return');
select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"return"}','fms_stage',pg_temp.merge_work((select id from loop_fixture where name='merge_return_instance'),'entry'),gen_random_uuid());
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_return_instance'),'a'));
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_return_instance'),'c'),'repeat');
insert into loop_fixture values('chosen_return_visit',pg_temp.merge_work((select id from loop_fixture where name='merge_return_instance'),'a'));
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_return_instance'),'b'))$$,'late token follows the chosen conditional return');
select is(pg_temp.merge_work((select id from loop_fixture where name='merge_return_instance'),'a'),(select id from loop_fixture where name='chosen_return_visit'),'late arrival reuses the chosen fresh return assignment');
select is((select count(*)::integer from fms_instance_stages r join fms_stages d on d.id=r.fms_stage_id where r.fms_instance_id=(select id from loop_fixture where name='merge_return_instance') and d.stage_key='a'),2,'late arrival does not duplicate the return visit');
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_return_instance'),'a'));
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='merge_return_instance'),'c'),'finish');
select isnt(pg_temp.merge_work((select id from loop_fixture where name='merge_return_instance'),'leaf'),null::uuid,'return convergence still carries both branches into its join');
reset role;
-- Nested split convergence restores the enclosing branch identities.
do $$
declare f uuid; c uuid; j uuid; d uuid; e uuid; innerjoin uuid; u uuid;
begin
 f:=create_fms_revision_with_audit((select id from loop_fixture where name='merge_flow')); update loop_fixture set id=f where name='merge_flow'; select id into u from loop_fixture where name='user';
 select id into c from fms_stages where fms_flow_id=f and stage_key='c'; select id into j from fms_stages where fms_flow_id=f and stage_key='j';
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'d','Inner D','task',7,true,'{"deadlineEnabled":false,"decisionMode":"yes_no","decisionOptions":[{"key":"repeat","label":"Repeat"},{"key":"done","label":"Done"}]}') returning id into d;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(f,'e','Inner E','task',8,true,'{"deadlineEnabled":false}') returning id into e;
 insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,join_rule,default_next_stage_id) values(f,'innerjoin','Inner join','parallel_join',9,true,'{}','all',j) returning id into innerjoin;
 update fms_stages set step_type='parallel_start',default_next_stage_id=null,parallel_target_stage_ids=array[d,e] where id=c;
 update fms_stages set default_next_stage_id=innerjoin where id in(d,e);
 insert into fms_branch_rules(fms_stage_id,source_type,condition_field,condition_operator,condition_value,next_stage_id,sort_order) values(d,'outcome','outcome','equals','repeat',d,0);
 insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) values(d,'specific_user',u,0),(e,'specific_user',u,0);
end $$;
set local role authenticated;
select publish_fms_flow_with_audit((select id from loop_fixture where name='merge_flow'));
insert into loop_fixture select 'nested_instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='merge_flow'),'Nested convergence');
select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"nested"}','fms_stage',pg_temp.merge_work((select id from loop_fixture where name='nested_instance'),'entry'),gen_random_uuid());
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='nested_instance'),'a'));
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='nested_instance'),'d'),'repeat')$$,'inner branch can revisit without replacing sibling');
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='nested_instance'),'d'),'done');
select is(pg_temp.merge_work((select id from loop_fixture where name='nested_instance'),'leaf'),null::uuid,'inner join waits for its second branch');
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='nested_instance'),'e'));
select is(pg_temp.merge_work((select id from loop_fixture where name='nested_instance'),'leaf'),null::uuid,'outer join waits after inner join completes');
select lives_ok($$select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='nested_instance'),'b'))$$,'late enclosing branch propagates through completed nested join');
select isnt(pg_temp.merge_work((select id from loop_fixture where name='nested_instance'),'leaf'),null::uuid,'nested convergence satisfies enclosing all join');
reset role;
-- Any join progresses with one branch; specific join ignores unrelated completions.
update loop_fixture set id=create_fms_revision_with_audit(id) where name='parallel_flow';
update loop_fixture set id=(select id from fms_stages where fms_flow_id=(select id from loop_fixture where name='parallel_flow') and stage_key='join') where name='parallel_join';
update fms_stages set join_rule='specific',join_required_stage_ids=array[(select id from fms_stages where fms_flow_id=(select id from loop_fixture where name='parallel_flow') and stage_key='a'),(select id from fms_stages where fms_flow_id=(select id from loop_fixture where name='parallel_flow') and stage_key='b')] where id=(select id from loop_fixture where name='parallel_join');
set local role authenticated;
select publish_fms_flow_with_audit((select id from loop_fixture where name='parallel_flow'));
insert into loop_fixture select 'specific_instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='parallel_flow'),'Specific join');
select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"specific"}','fms_stage',pg_temp.merge_work((select id from loop_fixture where name='specific_instance'),'start'),gen_random_uuid());
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='specific_instance'),'a'),'join');
select is(pg_temp.merge_work((select id from loop_fixture where name='specific_instance'),'decide'),null::uuid,'specific join waits for current required branches');
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='specific_instance'),'b'));
select isnt(pg_temp.merge_work((select id from loop_fixture where name='specific_instance'),'decide'),null::uuid,'specific join counts current cohort completions');
reset role;
update loop_fixture set id=create_fms_revision_with_audit(id) where name='parallel_flow';
update loop_fixture set id=(select id from fms_stages where fms_flow_id=(select id from loop_fixture where name='parallel_flow') and stage_key='join') where name='parallel_join';
update fms_stages set join_rule='any' where id=(select id from loop_fixture where name='parallel_join');
set local role authenticated;
select publish_fms_flow_with_audit((select id from loop_fixture where name='parallel_flow'));
insert into loop_fixture select 'any_instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='parallel_flow'),'Any join');
select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"any"}','fms_stage',pg_temp.merge_work((select id from loop_fixture where name='any_instance'),'start'),gen_random_uuid());
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='any_instance'),'a'),'join');
select isnt(pg_temp.merge_work((select id from loop_fixture where name='any_instance'),'decide'),null::uuid,'any join progresses with one branch');
select isnt(pg_temp.merge_work((select id from loop_fixture where name='any_instance'),'b'),null::uuid,'any join retains unrelated open work');
reset role;
-- Guard holds are durable and audited; privileged test setup bypasses publication.
select activate_fms_stage_internal((select id from loop_fixture where name='auto_instance'),(select id from loop_fixture where name='auto_work'),pg_temp.merge_work((select id from loop_fixture where name='auto_instance'),'work'),null,101);
select is((select status::text from fms_instances where id=(select id from loop_fixture where name='auto_instance')),'on_hold','automatic transition budget holds the instance');
select ok(exists(select 1 from audit_logs where record_id=(select id from loop_fixture where name='auto_instance') and action='fms_automatic_transition_limit'),'automatic hold is audited');
update fms_instances set status='active' where id=(select id from loop_fixture where name='auto_instance');
-- Already published version-one workflows and their instances retain the old engine.
update fms_flows set execution_version=1 where id=(select id from loop_fixture where name='flow');
set local role authenticated;
insert into loop_fixture select 'legacy_instance',instance_id from start_fms_instance_with_audit((select id from loop_fixture where name='flow'),'Legacy running');
select is((select execution_version from fms_instances where id=(select id from loop_fixture where name='legacy_instance')),1,'legacy instance retains version one');
select ok((select bool_and(execution_scope_id is null and visit_number=1) from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='legacy_instance')),'legacy stage layout remains untouched');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from loop_fixture where name='form'),'{"note":"legacy"}','fms_stage',pg_temp.merge_work((select id from loop_fixture where name='legacy_instance'),'start'),gen_random_uuid())$$,'legacy form submission still activates its successor');
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='legacy_instance'),'follow'),'finish');
select complete_fms_stage_with_audit(pg_temp.merge_work((select id from loop_fixture where name='legacy_instance'),'finish'));
select is((select status::text from fms_instances where id=(select id from loop_fixture where name='legacy_instance')),'completed','legacy acyclic execution still completes');
reset role;
select ok(not has_table_privilege('authenticated','fms_visit_transitions','INSERT'),'clients cannot forge selected successors');
select ok(not has_table_privilege('authenticated','fms_visit_inputs','INSERT'),'clients cannot forge convergence provenance');
-- An administrator in another tenant cannot complete a guessed work ID.
do $$
declare t uuid; b uuid; d uuid; a uuid;
begin
 insert into tenants(name,slug) values('Other loop tenant','other-loop-tenant') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Other','OTHER') returning id into b;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Other','ODEP') returning id into d;
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-loop@test.local','x',now(),now()) returning id into a;
 insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled) values(t,a,b,d,'Other admin','OADM','other-loop@test.local','admin','active',true);
 insert into loop_fixture values('other_auth',a);
 insert into loop_fixture select 'secure_work',id from fms_instance_stages where fms_instance_id=(select id from loop_fixture where name='auto_instance') and fms_stage_id=(select id from loop_fixture where name='auto_work') and status='in_progress';
end $$;
select set_config('request.jwt.claim.sub',(select id::text from loop_fixture where name='other_auth'),true);
set local role authenticated;
select throws_ok($$select complete_fms_stage_with_audit((select id from loop_fixture where name='secure_work'))$$,'42501','Stage completion denied','cross-tenant admin direct RPC completion is denied');
select is((select count(*)::integer from fms_execution_scopes),0,'cross-tenant scope history is hidden by RLS');
reset role;
select set_config('request.jwt.claim.sub',(select id::text from loop_fixture where name='auth'),true);
-- Visit notifications keep their durable assignment identity and closed history.
select ok(exists(select 1 from notification_events o join fms_instance_stages r on r.id=o.source_record_id where r.fms_instance_id=(select id from loop_fixture where name='instance') and r.visit_number=2 and o.event_type='fms_stage_assigned'),'fresh visits enqueue fresh assignment events');
select ok(exists(select 1 from notifications n where n.source_record_id=(select id from loop_fixture where name='first_work') and n.event_type='fms_stage_assigned' and n.is_read and n.read_at is not null),'completion preserves and closes earlier visit notification');
-- Ordinary assigned actors succeed; unassigned, inactive and other-branch actors fail.
do $$
declare actor uuid; profile uuid; owner user_profiles; b uuid; d uuid; role_name text; counter integer:=0;
begin
 select * into owner from user_profiles where id=(select id from loop_fixture where name='user');
 insert into branches(tenant_id,name,code) values(owner.tenant_id,'Other branch','LOOPOTHER') returning id into b;
 insert into departments(tenant_id,branch_id,name,code) values(owner.tenant_id,b,'Other department','LOOPOD') returning id into d;
 foreach role_name in array array['staff','manager'] loop
  counter:=counter+1;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','loopactor'||counter||'@test.local','x',now(),now()) returning id into actor;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled) values(owner.tenant_id,actor,case when role_name='manager' then b else owner.branch_id end,case when role_name='manager' then d else owner.department_id end,'Loop actor '||counter,'LPA'||counter,'loopactor'||counter||'@test.local',role_name::user_role,'active',true) returning id into profile;
  insert into loop_fixture values(role_name||'_auth',actor),(role_name||'_profile',profile);
 end loop;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from loop_fixture where name='staff_auth'),true);
set local role authenticated;
select throws_ok($$select complete_fms_stage_with_audit((select id from loop_fixture where name='secure_work'))$$,'42501','Stage completion denied','unassigned ordinary actor cannot complete guessed work');
reset role;
select set_config('request.jwt.claim.sub',(select id::text from loop_fixture where name='manager_auth'),true);
set local role authenticated;
select throws_ok($$select complete_fms_stage_with_audit((select id from loop_fixture where name='secure_work'))$$,'42501','Stage completion denied','manager in another branch cannot complete guessed work');
reset role;
update fms_instance_stages set assigned_to=array[(select id from loop_fixture where name='staff_profile')] where id=(select id from loop_fixture where name='secure_work');
insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by) values((select id from loop_fixture where name='tenant'),(select id from loop_fixture where name='secure_work'),(select id from loop_fixture where name='staff_profile'),(select id from loop_fixture where name='user'));
update user_profiles set is_login_enabled=false where id=(select id from loop_fixture where name='staff_profile');
select set_config('request.jwt.claim.sub',(select id::text from loop_fixture where name='staff_auth'),true);
set local role authenticated;
select throws_ok($$select complete_fms_stage_with_audit((select id from loop_fixture where name='secure_work'))$$,'23514','Stage is not actionable','inactive assigned actor cannot complete work');
reset role;
update user_profiles set is_login_enabled=true where id=(select id from loop_fixture where name='staff_profile');
set local role authenticated;
select lives_ok($$select complete_fms_stage_with_audit((select id from loop_fixture where name='secure_work'))$$,'ordinary active assigned actor completes work');
reset role;
select set_config('request.jwt.claim.sub',(select id::text from loop_fixture where name='auth'),true);
-- A direct API/helper call cannot forge a pass.
set local role anon;
select throws_ok($$select activate_fms_stage_internal(null,null,null,null,0)$$,'42501',null,'anonymous callers cannot activate work');
reset role;
set local role authenticated;
select throws_ok($$select activate_fms_stage_internal(null,null,null,null,0)$$,'42501',null,'authenticated callers cannot activate work directly');
reset role;
set local role service_role;
select throws_ok($$select activate_fms_stage_internal(null,null,null,null,0)$$,'42501',null,'service role cannot bypass the owner-only engine');
reset role;
select * from finish();
rollback;
