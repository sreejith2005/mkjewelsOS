begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- 1 admin, 2 manager, 3 doer, 4 staff (named verifier), 5 staff (not a verifier),
-- 6 other-tenant admin, 7 inactive admin.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('34000000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','rc-'||n||'@example.invalid',
  crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,7) n;
insert into public.tenants(id,name,slug) values
 ('34010000-0000-4000-8000-000000000001','Recurring consolidation 340','recurring-consolidation-340'),
 ('34010000-0000-4000-8000-000000000002','Other tenant 340','other-tenant-340');
insert into public.branches(id,tenant_id,name,code) values
 ('34020000-0000-4000-8000-000000000001','34010000-0000-4000-8000-000000000001','RC Branch 340','RC340'),
 ('34020000-0000-4000-8000-000000000002','34010000-0000-4000-8000-000000000002','Other Branch 340','OT340');
insert into public.departments(id,tenant_id,branch_id,name,code) values
 ('34030000-0000-4000-8000-000000000001','34010000-0000-4000-8000-000000000001','34020000-0000-4000-8000-000000000001','RC Department 340','RCD340'),
 ('34030000-0000-4000-8000-000000000002','34010000-0000-4000-8000-000000000002','34020000-0000-4000-8000-000000000002','Other Department 340','OTD340');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
select ('34040000-0000-4000-8000-00000000000'||n)::uuid,('34000000-0000-4000-8000-00000000000'||n)::uuid,
  case when n=6 then '34010000-0000-4000-8000-000000000002' else '34010000-0000-4000-8000-000000000001' end::uuid,
  case when n=6 then '34020000-0000-4000-8000-000000000002' else '34020000-0000-4000-8000-000000000001' end::uuid,
  case when n=6 then '34030000-0000-4000-8000-000000000002' else '34030000-0000-4000-8000-000000000001' end::uuid,
  'RC User '||n,'000000340'||n,'rc-'||n||'@example.invalid','RC340-'||n,
  (array['admin','manager','doer','staff','staff','admin','admin'])[n]::user_role,'active',
  (case when n=7 then 'inactive' else 'active' end)::user_account_status,n<>7,'{}'
from generate_series(1,7) n;

create function pg_temp.act(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub','34000000-0000-4000-8000-00000000000'||p_n,true),
         set_config('request.jwt.claim.role','authenticated',true);
  select null::void;
$$;
grant execute on function pg_temp.act(integer) to authenticated;
create temp table saved(name text primary key, id uuid) on commit drop;
grant all on saved to authenticated, service_role;

-- The rules the shared schedule builder writes are all accepted by the
-- database's own grammar (packages/core/src/recurrenceBuilder.ts mirrors it).
select ok(public.is_supported_task_rrule(r), 'database accepts builder rule '||r) from unnest(array[
  'FREQ=DAILY','FREQ=DAILY;INTERVAL=15','FREQ=WEEKLY;BYDAY=MO,TH','FREQ=WEEKLY;INTERVAL=2;BYDAY=SA',
  'FREQ=MONTHLY;BYMONTHDAY=1,2,3,4,5','FREQ=MONTHLY;BYMONTHDAY=-1','FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=22',
  'FREQ=MONTHLY;BYDAY=3SA','FREQ=MONTHLY;BYDAY=-1FR','FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=22',
  'FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=5','FREQ=DAILY;COUNT=5','FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T235959Z'
]) r;
select ok(not public.is_supported_task_rrule(r), 'database still rejects '||r) from unnest(array[
  'FREQ=HOURLY','FREQ=DAILY;EXDATE=20261021','FREQ=MONTHLY;BYMONTHDAY=0','FREQ=YEARLY;BYMONTH=13','FREQ=DAILY;BYSETPOS=1'
]) r;

set local role authenticated;

-- An admin creates "3rd Saturday" from Create Task. The client anchors the
-- start on the first real date, and the first occurrence is created there.
select pg_temp.act(1);
insert into saved values('third_saturday',public.save_recurring_todo_template_with_audit(null,jsonb_build_object(
  'title','RC monthly stock audit','description','','recurrence_rule','FREQ=MONTHLY;BYDAY=3SA','schedule_kind','monthly',
  'starts_on','2030-11-16','planned_time','11:00','due_time','18:00','priority','medium',
  'branch_id','34020000-0000-4000-8000-000000000001','department_id','34030000-0000-4000-8000-000000000001',
  'default_assignee_type','specific_user','default_assignee_user_id','34040000-0000-4000-8000-000000000003','default_assignee_role','',
  'task_type','checklist','buddy_assignment_allowed',true,
  'checklist_items',jsonb_build_array(jsonb_build_object('item_text','Count trays','is_required',true,'sort_order',0)),
  'requires_upload',false,'requires_remark',false,'requires_form',false,'form_template_id','','is_active',true,
  'verification_required',true,'verifier_user_profile_id','34040000-0000-4000-8000-000000000004','followup_enabled',true,
  'personal_performance_enabled',true)));

-- An as-needed duty keeps the wording the author typed.
insert into saved values('per_customer',public.save_recurring_todo_template_with_audit(null,jsonb_build_object(
  'title','RC customer follow-up','description','','recurrence_rule','FREQ=DAILY;COUNT=1','schedule_kind','as_required',
  'planned_time','11:00','due_time','','priority','medium',
  'branch_id','34020000-0000-4000-8000-000000000001','department_id','34030000-0000-4000-8000-000000000001',
  'default_assignee_type','specific_user','default_assignee_user_id','34040000-0000-4000-8000-000000000003','default_assignee_role','',
  'task_type','delegation','buddy_assignment_allowed',true,'checklist_items','[]'::jsonb,'requires_upload',true,'requires_remark',false,
  'requires_form',false,'form_template_id','','is_active',false,'verification_required',false,'verifier_user_profile_id','',
  'followup_enabled',false,'personal_performance_enabled',true,'trigger_label','  Per Customer ')));

-- Creation requires an active author and valid organizational scope.
select pg_temp.act(3);
select throws_ok($$select public.save_recurring_todo_template_with_audit(null,jsonb_build_object('title','Doer schedule',
  'recurrence_rule','FREQ=DAILY','planned_time','11:00','default_assignee_type','specific_user',
  'default_assignee_user_id','34040000-0000-4000-8000-000000000003'))$$,'42501',null,'a doer cannot create a schedule without their organizational scope');
select pg_temp.act(7);
select throws_ok($$select public.save_recurring_todo_template_with_audit(null,jsonb_build_object('title','Inactive schedule',
  'recurrence_rule','FREQ=DAILY','planned_time','11:00','default_assignee_type','specific_user',
  'default_assignee_user_id','34040000-0000-4000-8000-000000000003'))$$,'42501',null,'an inactive admin cannot create a schedule');

reset role;
select is((select recurrence_rule||'|'||schedule_kind||'|'||starts_on::text||'|'||coalesce(trigger_label,'-') from public.task_templates
  where id=(select id from saved where name='third_saturday')),'FREQ=MONTHLY;BYDAY=3SA|monthly|2030-11-16|-',
  'the builder rule is stored exactly, with its anchored start');
select is((select string_agg(scheduled_date::text||' '||to_char(planned_datetime at time zone 'Asia/Kolkata','HH24:MI')||'-'||
  to_char(due_datetime at time zone 'Asia/Kolkata','HH24:MI'),',') from public.task_instances
  where task_template_id=(select id from saved where name='third_saturday')),'2030-11-16 11:00-18:00',
  'the first occurrence is created on the third Saturday with its start and due times');
select is((select trigger_label||'|'||schedule_kind||'|'||is_active::text from public.task_templates where id=(select id from saved where name='per_customer')),
  'Per Customer|as_required|false','a hand-made duty keeps its trimmed trigger wording and is not calendar-active');
select is((select count(*) from public.task_instances where task_template_id=(select id from saved where name='per_customer')),0::bigint,
  'an as-needed duty creates nothing on a calendar');

insert into saved select 'occurrence',id from public.task_instances where task_template_id=(select id from saved where name='third_saturday');

-- Generation is idempotent: a second run for the same day creates nothing.
-- The scheduler calls as the service role.
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.create_recurring_todo_instance((select id from saved where name='third_saturday'),'2030-11-16',
  array['34040000-0000-4000-8000-000000000003'::uuid]),null,'a repeated run for the same day returns no new occurrence');
reset role;
select is((select count(*) from public.task_instances where task_template_id=(select id from saved where name='third_saturday')),1::bigint,
  'still exactly one occurrence for that day');

-- An older client edits the duty without sending the wording: it is kept.
set local role authenticated;
select pg_temp.act(1);
select lives_ok($$select public.save_recurring_todo_template_with_audit((select id from saved where name='per_customer'),jsonb_build_object(
  'title','RC customer follow-up','recurrence_rule','FREQ=DAILY;COUNT=1','schedule_kind','as_required','planned_time','11:00',
  'priority','low','branch_id','34020000-0000-4000-8000-000000000001','department_id','34030000-0000-4000-8000-000000000001',
  'default_assignee_type','specific_user','default_assignee_user_id','34040000-0000-4000-8000-000000000003','task_type','delegation',
  'checklist_items','[]'::jsonb,'requires_upload',true,'requires_form',false,'form_template_id','','is_active',false))$$,
  'an edit without trigger wording is accepted');
reset role;
select is((select trigger_label from public.task_templates where id=(select id from saved where name='per_customer')),'Per Customer',
  'an edit that does not send the wording keeps it');

-- A completed, verified-pending occurrence is the history an edit must not touch.
update public.task_instances set status='completed',actual_datetime='2030-11-16 12:00+05:30',completed_by='34040000-0000-4000-8000-000000000003',
  completion_mode='own',on_time_status='on_time'
where task_template_id=(select id from saved where name='third_saturday');
create temp table before_edit on commit drop as
  select to_jsonb(t)-'updated_at'-'updated_by'-'verifier_user_profile_id'-'verification_status' as row from public.task_instances t
  where task_template_id=(select id from saved where name='third_saturday');

set local role authenticated;
select pg_temp.act(1);
select lives_ok($$select public.save_recurring_todo_template_with_audit((select id from saved where name='third_saturday'),jsonb_build_object(
  'title','RC monthly stock audit','description','','recurrence_rule','FREQ=MONTHLY;BYDAY=-1FR','schedule_kind','monthly',
  'starts_on','2030-11-16','planned_time','10:00','due_time','17:00','priority','high',
  'branch_id','34020000-0000-4000-8000-000000000001','department_id','34030000-0000-4000-8000-000000000001',
  'default_assignee_type','specific_user','default_assignee_user_id','34040000-0000-4000-8000-000000000003','default_assignee_role','',
  'task_type','checklist','buddy_assignment_allowed',true,
  'checklist_items',jsonb_build_array(jsonb_build_object('item_text','Count trays','is_required',true,'sort_order',0)),
  'requires_upload',false,'requires_remark',false,'requires_form',false,'form_template_id','','is_active',true,
  'verification_required',true,'verifier_user_profile_id','34040000-0000-4000-8000-000000000004','followup_enabled',true,
  'personal_performance_enabled',true))$$,'an admin can change the repeat pattern');
reset role;
select is((select to_jsonb(t)-'updated_at'-'updated_by'-'verifier_user_profile_id'-'verification_status' from public.task_instances t
  where task_template_id=(select id from saved where name='third_saturday')),(select row from before_edit),
  'a schedule edit leaves completed work exactly as it was');
select is((select recurrence_rule from public.task_templates where id=(select id from saved where name='third_saturday')),'FREQ=MONTHLY;BYDAY=-1FR',
  'the new rule applies to future occurrences');

-- Verification and follow-ups follow Task Control now, not the retired section.
insert into public.tenant_section_controls(tenant_id,section_availability)
values('34010000-0000-4000-8000-000000000001','{"recurring_todo":false}')
on conflict (tenant_id) do update set section_availability=excluded.section_availability;
update public.task_instances set verification_status='pending'
where task_template_id=(select id from saved where name='third_saturday');

set local role authenticated;
select pg_temp.act(5);
select throws_ok($$select public.verify_recurring_task_with_audit((select id from saved where name='occurrence'),'verified','')$$,'42501',null,
  'staff who are not the named verifier cannot verify');
select pg_temp.act(6);
select throws_ok($$select public.verify_recurring_task_with_audit((select id from saved where name='occurrence'),'verified','override')$$,'42501',null,
  'an admin of another tenant cannot verify');
select pg_temp.act(4);
select lives_ok($$select public.verify_recurring_task_with_audit((select id from saved where name='occurrence'),'rejected','Tray count missing')$$,
  'the named verifier can reject while the retired section is switched off');
reset role;
select is((select status||'|'||verification_status||'|'||verification_note from public.task_instances
  where task_template_id=(select id from saved where name='third_saturday')),'rejected|rejected|Tray count missing',
  'a rejection returns the work to the doer with its reason');
select is((select link_url from public.notifications where event_type='recurring_task_rejected'
  and user_profile_id='34040000-0000-4000-8000-000000000003'),
  '/tasks?task_id='||(select id::text from public.task_instances where task_template_id=(select id from saved where name='third_saturday')),
  'the rejection alert opens that exact task in Tasks');
select is((select count(*) from public.audit_logs where action='recurring_task_rejected'
  and record_id=(select id from public.task_instances where task_template_id=(select id from saved where name='third_saturday'))),1::bigint,
  'the rejection is audited');

set local role authenticated;
select pg_temp.act(1);
select lives_ok($$select public.send_recurring_followup_with_audit((select id from saved where name='occurrence'),'Please redo the count')$$,
  'an admin can follow up while the retired section is switched off');
select pg_temp.act(3);
select throws_ok($$select public.send_recurring_followup_with_audit((select id from saved where name='occurrence'),'Self follow-up')$$,'42501',null,
  'a doer cannot send follow-ups');
reset role;
select is((select link_url from public.notifications where event_type='recurring_task_followup'
  and user_profile_id='34040000-0000-4000-8000-000000000003'),
  '/tasks?task_id='||(select id::text from public.task_instances where task_template_id=(select id from saved where name='third_saturday')),
  'the follow-up alert opens that exact task in Tasks');

-- Switching Task Control off pauses both, as a section switch should.
update public.tenant_section_controls set section_availability='{"task_templates":false}'
where tenant_id='34010000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act(1);
select throws_ok($$select public.send_recurring_followup_with_audit((select id from saved where name='occurrence'),'Blocked')$$,'42501','This section is currently unavailable',
  'follow-ups pause with Task Control');
reset role;
update public.task_instances set status='completed',verification_status='pending',actual_datetime=now()
where task_template_id=(select id from saved where name='third_saturday');
set local role authenticated;
select pg_temp.act(4);
select throws_ok($$select public.verify_recurring_task_with_audit((select id from saved where name='occurrence'),'verified','')$$,'42501','This section is currently unavailable',
  'verification pauses with Task Control');
reset role;

select * from finish();
rollback;
