-- Versioned FMS visits: existing instances retain their engine; new publications
-- enable loops without rewriting completed assignments or submissions.
set search_path=public,extensions;
alter table fms_flows add column execution_version integer not null default 1 check(execution_version in (1,2));
alter table fms_instances add column execution_version integer not null default 1 check(execution_version in (1,2));
alter table fms_instance_stages add column visit_number integer not null default 1 check(visit_number>0),
  add column execution_scope_id uuid, add column execution_path uuid[] not null default '{}',
  add column parallel_scope_id uuid, add column parallel_branch_id uuid references fms_stages(id);
create table fms_execution_scopes(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
  fms_instance_id uuid not null references fms_instances(id) on delete cascade,
  split_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
  parent_scope_id uuid references fms_execution_scopes(id) on delete cascade, parent_branch_id uuid references fms_stages(id),
  execution_scope_id uuid not null, created_at timestamptz not null default now(),
  unique(split_instance_stage_id)
);
alter table fms_instance_stages add foreign key(parallel_scope_id) references fms_execution_scopes(id) on delete set null;
create table fms_join_arrivals(
  parallel_scope_id uuid not null references fms_execution_scopes(id) on delete cascade,
  join_stage_id uuid not null references fms_stages(id), branch_stage_id uuid not null references fms_stages(id),
  source_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
  execution_path uuid[] not null, created_at timestamptz not null default now(),
  primary key(parallel_scope_id,join_stage_id,branch_stage_id)
);
alter table fms_execution_scopes enable row level security;
alter table fms_join_arrivals enable row level security;
revoke all on fms_execution_scopes,fms_join_arrivals from public,anon,authenticated,service_role;
grant select on fms_execution_scopes,fms_join_arrivals to authenticated;
create policy fms_execution_scopes_select on fms_execution_scopes for select to authenticated
  using(tenant_id=current_tenant_id() and can_read_fms_instance(fms_instance_id));
create policy fms_execution_scopes_module on fms_execution_scopes as restrictive for select to authenticated using(module_accessible('fms_builder'));
create policy fms_join_arrivals_select on fms_join_arrivals for select to authenticated using(exists(
  select 1 from fms_execution_scopes s where s.id=parallel_scope_id and s.tenant_id=current_tenant_id() and can_read_fms_instance(s.fms_instance_id)));
create policy fms_join_arrivals_module on fms_join_arrivals as restrictive for select to authenticated using(module_accessible('fms_builder'));
-- Each converging visit retains every incoming branch token, including late arrivals.
create table fms_visit_inputs(
 target_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
 parallel_scope_id uuid not null references fms_execution_scopes(id) on delete cascade,
 branch_stage_id uuid not null references fms_stages(id),
 source_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
 execution_path uuid[] not null,
 primary key(target_instance_stage_id,parallel_scope_id,branch_stage_id)
);
alter table fms_visit_inputs enable row level security;
revoke all on fms_visit_inputs from public,anon,authenticated,service_role;
grant select on fms_visit_inputs to authenticated;
create policy fms_visit_inputs_select on fms_visit_inputs for select to authenticated using(exists(
 select 1 from fms_execution_scopes s where s.id=parallel_scope_id and s.tenant_id=current_tenant_id() and can_read_fms_instance(s.fms_instance_id)));
create policy fms_visit_inputs_module on fms_visit_inputs as restrictive for select to authenticated using(module_accessible('fms_builder'));
-- The chosen destination is recorded even while a join is waiting. Late tokens
-- follow the same successor visit, including a previously traversed return edge.
create table fms_visit_transitions(
 source_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
 target_stage_id uuid not null references fms_stages(id) on delete cascade,
 target_instance_stage_id uuid references fms_instance_stages(id) on delete cascade,
 primary key(source_instance_stage_id,target_stage_id)
);
alter table fms_visit_transitions enable row level security;
revoke all on fms_visit_transitions from public,anon,authenticated,service_role;
grant select on fms_visit_transitions to authenticated;
create policy fms_visit_transitions_select on fms_visit_transitions for select to authenticated using(exists(select 1 from fms_instance_stages s where s.id=source_instance_stage_id and can_read_fms_instance(s.fms_instance_id)));
create policy fms_visit_transitions_module on fms_visit_transitions as restrictive for select to authenticated using(module_accessible('fms_builder'));
create index fms_execution_scopes_instance on fms_execution_scopes(fms_instance_id);
create index fms_instance_stage_visit_order on fms_instance_stages(fms_instance_id,fms_stage_id,visit_number desc);
create unique index fms_instance_stage_pass_once on fms_instance_stages(fms_instance_id,fms_stage_id,execution_scope_id) where execution_scope_id is not null;

create function fms_pin_execution_version() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='fms_flows' then
    if old.status='draft' and new.status='published' then new.execution_version:=2; end if;
  else
    select execution_version into new.execution_version from fms_flows where id=new.fms_flow_id;
  end if;
  return new;
end $$;
create trigger fms_pin_flow_execution before update of status on fms_flows for each row execute function fms_pin_execution_version();
create trigger fms_pin_instance_execution before insert on fms_instances for each row execute function fms_pin_execution_version();

create function fms_prepare_visit() returns trigger language plpgsql security definer set search_path=public as $$
declare i fms_instances; prior fms_instance_stages; previous_visit fms_instance_stages;
begin
  select * into i from fms_instances where id=new.fms_instance_id for update;
  if i.execution_version=1 then return new; end if;
  select * into prior from fms_instance_stages where id=new.previous_instance_stage_id and fms_instance_id=i.id;
  if new.execution_scope_id is null then
    new.execution_scope_id:=case when new.revision_of_id is not null then gen_random_uuid() else coalesce(prior.execution_scope_id,gen_random_uuid()) end;
    new.parallel_scope_id:=prior.parallel_scope_id; new.parallel_branch_id:=prior.parallel_branch_id;
    new.execution_path:=coalesce(prior.execution_path,'{}');
  end if;
  select * into previous_visit from fms_instance_stages where fms_instance_id=i.id and fms_stage_id=new.fms_stage_id order by visit_number desc,created_at desc,id desc limit 1;
  new.visit_number:=coalesce(previous_visit.visit_number,0)+1;
  if new.revision_of_id is null and previous_visit.id is not null then new.revision_of_id:=previous_visit.id; end if;
  new.execution_path:=coalesce(new.execution_path,'{}')||new.id;
  return new;
end $$;
create trigger fms_prepare_visit before insert on fms_instance_stages for each row execute function fms_prepare_visit();

alter function activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer) rename to activate_fms_stage_v1_internal;

-- Preserve the current completion body and its section/permission gates. An
-- elevated actor must still belong to the work's tenant when calling by ID.
do $$
declare definition text; marker text:=' if v_actor.id is null or not public.current_profile_is_active()';
begin
  definition:=pg_get_functiondef('complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure);
  if position(marker in definition)=0 then raise exception 'FMS completion contract changed; review tenant gate placement'; end if;
  definition:=replace(definition,marker,
    ' if v_actor.id is not null and v_instance.id is not null and v_instance.tenant_id<>v_actor.tenant_id then raise exception ''Stage completion denied'' using errcode=''42501''; end if;'||E'\n'||marker);
  execute definition;
end $$;

create function activate_fms_stage_v2_internal(p_instance_id uuid,p_stage_id uuid,p_previous_instance_stage_id uuid,p_selected_user uuid,p_guard integer,p_token_scope uuid default null,p_token_branch uuid default null,p_token_path uuid[] default null,p_token_pass uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_instance fms_instances; v_stage fms_stages; v_instance_stage fms_instance_stages; v_ids uuid[]; v_item jsonb; v_rule fms_branch_rules; v_actual jsonb; v_target uuid; v_actor uuid; v_ready boolean; v_required integer; v_completed integer; v_revision_of uuid; v_condition_key text; v_condition_expected text; v_condition_actual text; v_condition_operator text; v_condition_met boolean; v_prior fms_instance_stages; v_ancestor fms_instance_stages; v_pass uuid; v_path uuid[]; v_parallel uuid; v_branch uuid; v_cohort fms_execution_scopes; v_index integer; v_input record; v_new_input boolean; v_forward uuid; v_successor fms_instance_stages;
begin

 select * into v_instance from fms_instances where id=p_instance_id for update; select * into v_stage from fms_stages where id=p_stage_id;
 if v_instance.execution_version=1 then return activate_fms_stage_v1_internal(p_instance_id,p_stage_id,p_previous_instance_stage_id,p_selected_user,p_guard); end if;
 if p_guard>100 then
   update fms_instances set status='on_hold',updated_at=now() where id=p_instance_id;
   insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_previous_instance_stage_id,v_instance.started_by,'automatic_transition_limit',jsonb_build_object('stage_id',p_stage_id));
   insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_instance.tenant_id,v_instance.started_by,'fms_automatic_transition_limit','fms_instances',p_instance_id,jsonb_build_object('stage_id',p_stage_id));
   return null;
 end if;
 if v_instance.status='on_hold' and p_guard>0 then return null; end if;
 if v_instance.status not in ('active','overdue') or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception 'Instance or stage is not activatable' using errcode='23514'; end if;
 select * into v_prior from fms_instance_stages where id=p_previous_instance_stage_id and fms_instance_id=p_instance_id;
 if v_prior.id is not null then insert into fms_visit_transitions(source_instance_stage_id,target_stage_id) values(v_prior.id,p_stage_id) on conflict do nothing; end if;
 if p_token_path is not null then select target.* into v_successor from fms_visit_transitions transition join fms_instance_stages target on target.id=transition.target_instance_stage_id where transition.source_instance_stage_id=v_prior.id and transition.target_stage_id=p_stage_id; end if;
 v_pass:=coalesce(v_prior.execution_scope_id,gen_random_uuid()); v_path:=coalesce(v_prior.execution_path,'{}');
 v_parallel:=coalesce(p_token_scope,v_prior.parallel_scope_id); v_branch:=coalesce(p_token_branch,v_prior.parallel_branch_id);
 if p_token_path is not null then v_path:=p_token_path; v_pass:=p_token_pass; end if;
 -- Causal return, not stage order: a converging edge is not a loop.
 select s.* into v_ancestor from unnest(v_path) with ordinality path(id,position)
   join fms_instance_stages s on s.id=path.id where s.fms_stage_id=p_stage_id order by path.position desc limit 1;
 if v_ancestor.id is not null then
   v_pass:=coalesce(v_successor.execution_scope_id,gen_random_uuid()); v_parallel:=v_ancestor.parallel_scope_id; v_branch:=v_ancestor.parallel_branch_id;
   v_index:=array_position(v_path,v_ancestor.id); v_path:=v_path[1:v_index-1];
 end if;
 if v_successor.id is not null then v_pass:=v_successor.execution_scope_id; end if;
 if v_prior.fms_stage_id is not null and (select step_type from fms_stages where id=v_prior.fms_stage_id)='parallel_start' then
   select * into v_cohort from fms_execution_scopes where split_instance_stage_id=v_prior.id;
   if v_cohort.id is null then
     insert into fms_execution_scopes(tenant_id,fms_instance_id,split_instance_stage_id,parent_scope_id,parent_branch_id,execution_scope_id)
     values(v_instance.tenant_id,p_instance_id,v_prior.id,v_prior.parallel_scope_id,v_prior.parallel_branch_id,v_prior.execution_scope_id) returning * into v_cohort;
   end if;
   v_parallel:=v_cohort.id; v_branch:=p_stage_id;
 end if;
 if v_stage.step_type='parallel_join' then
   if v_parallel is null then
     -- Preserve joins authored without an explicit split, scoped to this pass.
     if v_stage.join_rule='specific' then
       select cardinality(v_stage.join_required_stage_ids),count(distinct fms_stage_id) into v_required,v_completed from fms_instance_stages where fms_instance_id=p_instance_id and execution_scope_id=v_pass and fms_stage_id=any(v_stage.join_required_stage_ids) and status='completed';
     else
       select count(*),count(*) filter(where r.status='completed') into v_required,v_completed from fms_stages d left join fms_instance_stages r on r.fms_stage_id=d.id and r.fms_instance_id=p_instance_id and r.execution_scope_id=v_pass where d.fms_flow_id=v_instance.fms_flow_id and d.default_next_stage_id=p_stage_id;
     end if;
     v_ready:=case v_stage.join_rule when 'any' then v_completed>0 else v_required>0 and v_completed=v_required end;
     if not v_ready then return null; end if;
   else
   select * into v_cohort from fms_execution_scopes where id=v_parallel and fms_instance_id=p_instance_id;
   insert into fms_join_arrivals(parallel_scope_id,join_stage_id,branch_stage_id,source_instance_stage_id,execution_path)
     values(v_parallel,p_stage_id,v_branch,v_prior.id,v_path)
     on conflict(parallel_scope_id,join_stage_id,branch_stage_id) do nothing;
   if p_token_path is null then
     insert into fms_join_arrivals(parallel_scope_id,join_stage_id,branch_stage_id,source_instance_stage_id,execution_path)
     select parallel_scope_id,p_stage_id,branch_stage_id,v_prior.id,execution_path||v_prior.id
       from fms_visit_inputs where target_instance_stage_id=v_prior.id and parallel_scope_id=v_parallel
     on conflict(parallel_scope_id,join_stage_id,branch_stage_id) do nothing;
   end if;
   if v_stage.join_rule='specific' then
     select cardinality(v_stage.join_required_stage_ids),count(distinct s.fms_stage_id) into v_required,v_completed
     from fms_join_arrivals a cross join lateral unnest(a.execution_path) path(id)
     join fms_instance_stages s on s.id=path.id
     where a.parallel_scope_id=v_parallel and a.join_stage_id=p_stage_id and s.fms_stage_id=any(v_stage.join_required_stage_ids) and s.status='completed' and array_position(a.execution_path,s.id)>array_position(a.execution_path,v_cohort.split_instance_stage_id);
   else
     select cardinality(s.parallel_target_stage_ids) into v_required from fms_instance_stages runtime join fms_stages s on s.id=runtime.fms_stage_id where runtime.id=v_cohort.split_instance_stage_id;
     select count(*) into v_completed from fms_join_arrivals where parallel_scope_id=v_parallel and join_stage_id=p_stage_id;
   end if;
   v_ready:=case v_stage.join_rule when 'any' then v_completed>0 else v_required>0 and v_completed=v_required end;
   if not v_ready then return null; end if;
   -- Collapse the cohort back to its parent's pass and retain the full provenance.
   select array_agg(ordered.id order by ordered.depth,ordered.id) into v_path from (select path.id,min(path.depth) depth from fms_join_arrivals a cross join lateral unnest(a.execution_path) with ordinality path(id,depth) where a.parallel_scope_id=v_parallel and a.join_stage_id=p_stage_id group by path.id) ordered;
   v_pass:=v_cohort.execution_scope_id; v_parallel:=v_cohort.parent_scope_id; v_branch:=v_cohort.parent_branch_id;
   end if;
 end if;
 select * into v_instance_stage from fms_instance_stages where fms_instance_id=p_instance_id and fms_stage_id=p_stage_id and execution_scope_id=v_pass order by visit_number desc limit 1;
 if v_instance_stage.id is not null and v_instance_stage.status<>'blocked' then
   update fms_visit_transitions set target_instance_stage_id=v_instance_stage.id where source_instance_stage_id=v_prior.id and target_stage_id=p_stage_id and target_instance_stage_id is null;
   if v_parallel is not null then
     insert into fms_visit_inputs values(v_instance_stage.id,v_parallel,v_branch,v_prior.id,v_path) on conflict do nothing;
     v_new_input:=found;
     if p_token_path is null and v_stage.step_type<>'parallel_join' and (select step_type from fms_stages where id=v_prior.fms_stage_id)<>'parallel_start' then
       insert into fms_visit_inputs select v_instance_stage.id,parallel_scope_id,branch_stage_id,v_prior.id,execution_path||v_prior.id
         from fms_visit_inputs where target_instance_stage_id=v_prior.id and parallel_scope_id=v_parallel on conflict do nothing;
       v_new_input:=v_new_input or found;
     end if;
     if v_new_input and v_instance_stage.status='completed' and v_stage.step_type='parallel_start' then
       -- Late enclosing branches travel through the already completed inner join.
       for v_input in select distinct j.* from fms_execution_scopes cohort join fms_join_arrivals arrival on arrival.parallel_scope_id=cohort.id join fms_instance_stages j on j.fms_stage_id=arrival.join_stage_id and j.fms_instance_id=p_instance_id and j.execution_scope_id=cohort.execution_scope_id where cohort.split_instance_stage_id=v_instance_stage.id and j.status='completed' loop
         insert into fms_visit_inputs values(v_input.id,v_parallel,v_branch,v_prior.id,v_path||v_instance_stage.id||v_input.id) on conflict do nothing;
         if found then
           select default_next_stage_id into v_forward from fms_stages where id=v_input.fms_stage_id;
           if v_forward is not null then perform activate_fms_stage_v2_internal(p_instance_id,v_forward,v_input.id,null,p_guard+1,v_parallel,v_branch,v_path||v_instance_stage.id||v_input.id,v_pass); end if;
         end if;
       end loop;
     elsif v_new_input and v_instance_stage.status='completed' then
       -- Replay the persisted route, never the late source's answer or outcome.
       select target_stage_id into v_forward from fms_visit_transitions where source_instance_stage_id=v_instance_stage.id limit 1;
       if v_forward is null then select next_stage_id into v_forward from fms_branch_rules where id=v_instance_stage.branch_rule_id; v_forward:=coalesce(v_forward,v_stage.default_next_stage_id); end if;
       if v_forward is not null then
         for v_input in select * from fms_visit_inputs where target_instance_stage_id=v_instance_stage.id loop
           perform activate_fms_stage_v2_internal(p_instance_id,v_forward,v_instance_stage.id,null,p_guard+1,v_input.parallel_scope_id,v_input.branch_stage_id,v_input.execution_path||v_instance_stage.id,v_pass);
         end loop;
       end if;
     end if;
   end if;
   return v_instance_stage.id;
 end if;
 if v_instance_stage.status='blocked' then v_pass:=gen_random_uuid(); end if;
 select id into v_revision_of from fms_instance_stages where fms_instance_id=p_instance_id and fms_stage_id=p_stage_id order by visit_number desc,created_at desc,id desc limit 1;
 v_condition_met:=true;
 if v_stage.planned_time_rule#>>'{conditional,field}'='status' then
   v_condition_operator:=v_stage.planned_time_rule#>>'{conditional,operator}';
   v_condition_expected:=lower(v_stage.planned_time_rule#>>'{conditional,value}');
   v_condition_actual:=lower(v_instance.context->>'status');
   v_condition_met:=fms_status_condition_matches(v_condition_operator,v_condition_expected,v_condition_actual);
 elsif nullif(v_stage.planned_time_rule#>>'{conditional,decisionStageKey}','') is not null then
   v_condition_key:=v_stage.planned_time_rule#>>'{conditional,decisionStageKey}';
   v_condition_expected:=lower(v_stage.planned_time_rule#>>'{conditional,outcome}');
   select lower(instance_stage.outcome) into v_condition_actual from fms_instance_stages instance_stage join fms_stages definition on definition.id=instance_stage.fms_stage_id where instance_stage.fms_instance_id=p_instance_id and definition.stage_key=v_condition_key and instance_stage.status='completed' and instance_stage.id=any(v_path) order by instance_stage.actual_datetime desc nulls last limit 1;
   if v_condition_actual is null then raise exception 'The earlier Yes or No decision has not been completed' using errcode='23514'; end if;
   v_condition_met:=v_condition_actual=v_condition_expected;
 end if;
 if not v_condition_met then
   insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,actual_datetime,completed_by,previous_instance_stage_id,revision_of_id,execution_scope_id,execution_path,parallel_scope_id,parallel_branch_id,outcome) values(p_instance_id,p_stage_id,'completed','{}',fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id),now(),now(),v_instance.started_by,p_previous_instance_stage_id,v_revision_of,v_pass,v_path,v_parallel,v_branch,'condition_skipped') returning * into v_instance_stage;

 update fms_visit_transitions set target_instance_stage_id=v_instance_stage.id where source_instance_stage_id=v_prior.id and target_stage_id=p_stage_id and target_instance_stage_id is null;
 if v_parallel is not null then
   insert into fms_visit_inputs values(v_instance_stage.id,v_parallel,v_branch,v_prior.id,v_path) on conflict do nothing;
   if p_token_path is null and v_stage.step_type<>'parallel_join' and (select step_type from fms_stages where id=v_prior.fms_stage_id)<>'parallel_start' then
     insert into fms_visit_inputs select v_instance_stage.id,parallel_scope_id,branch_stage_id,v_prior.id,execution_path||v_prior.id from fms_visit_inputs where target_instance_stage_id=v_prior.id and parallel_scope_id=v_parallel on conflict do nothing;
   elsif v_stage.step_type='parallel_join' then
     -- An inner join restores all enclosing branch tokens carried by its split.
     insert into fms_visit_inputs select v_instance_stage.id,parallel_scope_id,branch_stage_id,v_prior.id,execution_path||v_instance_stage.id from fms_visit_inputs where target_instance_stage_id=v_cohort.split_instance_stage_id and parallel_scope_id=v_parallel on conflict do nothing;
   end if;
 end if;
   insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,'condition_skipped',case when v_stage.planned_time_rule#>>'{conditional,field}'='status' then jsonb_build_object('field','status','operator',v_condition_operator,'expected',v_condition_expected,'actual',v_condition_actual) else jsonb_build_object('decisionStageKey',v_condition_key,'expected',v_condition_expected,'actual',v_condition_actual) end);
   insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_instance.tenant_id,v_instance.started_by,'fms_stage_condition_skipped','fms_instance_stages',v_instance_stage.id,jsonb_build_object('stage_id',p_stage_id,'previous_instance_stage_id',p_previous_instance_stage_id,'condition_type',case when v_stage.planned_time_rule#>>'{conditional,field}'='status' then 'status' else 'decision' end));
   if v_stage.default_next_stage_id is not null then perform activate_fms_stage_internal(p_instance_id,v_stage.default_next_stage_id,v_instance_stage.id,null,p_guard+1); elsif p_guard=0 and not exists(select 1 from fms_instance_stages where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id and status in ('active','overdue'); end if;
   if p_guard=0 and not exists(select 1 from fms_instance_stages where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id and status in ('active','overdue'); end if;
   return v_instance_stage.id;
 end if;
 v_ids=resolve_fms_stage_assignees(p_stage_id,p_instance_id,p_selected_user);
 insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,previous_instance_stage_id,revision_of_id,execution_scope_id,execution_path,parallel_scope_id,parallel_branch_id) values(p_instance_id,p_stage_id,(case when v_stage.step_type in ('notification','branch','parallel_start','parallel_join','end') then 'in_progress' else case when v_stage.step_type='approval' then 'in_review' else 'in_progress' end end)::task_status,v_ids,fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id),now(),p_previous_instance_stage_id,v_revision_of,v_pass,v_path,v_parallel,v_branch) returning * into v_instance_stage;

 update fms_visit_transitions set target_instance_stage_id=v_instance_stage.id where source_instance_stage_id=v_prior.id and target_stage_id=p_stage_id and target_instance_stage_id is null;
 if v_parallel is not null then
   insert into fms_visit_inputs values(v_instance_stage.id,v_parallel,v_branch,v_prior.id,v_path) on conflict do nothing;
   if p_token_path is null and v_stage.step_type<>'parallel_join' and (select step_type from fms_stages where id=v_prior.fms_stage_id)<>'parallel_start' then
     insert into fms_visit_inputs select v_instance_stage.id,parallel_scope_id,branch_stage_id,v_prior.id,execution_path||v_prior.id from fms_visit_inputs where target_instance_stage_id=v_prior.id and parallel_scope_id=v_parallel on conflict do nothing;
   elsif v_stage.step_type='parallel_join' then
     -- An inner join restores all enclosing branch tokens carried by its split.
     insert into fms_visit_inputs select v_instance_stage.id,parallel_scope_id,branch_stage_id,v_prior.id,execution_path||v_instance_stage.id from fms_visit_inputs where target_instance_stage_id=v_cohort.split_instance_stage_id and parallel_scope_id=v_parallel on conflict do nothing;
   end if;
 end if;
 if v_revision_of is not null then
   insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_instance.tenant_id,v_instance.started_by,'fms_stage_revisited','fms_instance_stages',v_instance_stage.id,jsonb_build_object('previous_visit_id',v_revision_of,'visit_number',v_instance_stage.visit_number,'execution_scope_id',v_pass));
 end if;
 foreach v_actor in array v_ids loop insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by) values(v_instance.tenant_id,v_instance_stage.id,v_actor,v_instance.started_by); end loop;
 for v_item in select value from jsonb_array_elements(v_stage.checklist_definition) loop insert into fms_instance_checklist_items(tenant_id,fms_instance_stage_id,item_key,label,is_required,sort_order) values(v_instance.tenant_id,v_instance_stage.id,v_item->>'key',v_item->>'label',coalesce((v_item->>'required')::boolean,true),coalesce((v_item->>'sortOrder')::integer,0)); end loop;
 insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,'activated',jsonb_build_object('guard',p_guard));
 if v_stage.step_type='notification' then foreach v_actor in array case when cardinality(v_ids)>0 then v_ids else array[v_instance.started_by] end loop insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url,channel,delivered_status) values(v_instance.tenant_id,v_actor,'fms_stage_notification',coalesce(nullif(v_stage.notification_config->>'title',''),v_stage.name),coalesce(nullif(v_stage.notification_config->>'message',''),coalesce(v_stage.method,'FMS stage notification')),'/tasks?view=fms&instance='||p_instance_id,'in_app','delivered'); end loop;
 elsif v_stage.step_type='branch' then for v_rule in select * from fms_branch_rules where fms_stage_id=v_stage.id order by sort_order loop if v_rule.source_type='outcome' then select to_jsonb(outcome) into v_actual from fms_instance_stages where id=p_previous_instance_stage_id; elsif v_rule.source_type='context' then v_actual=v_instance.context->v_rule.source_key; else select fs.data->v_rule.source_key into v_actual from form_submissions fs join fms_instance_stages prior on prior.form_submission_id=fs.id where prior.id=p_previous_instance_stage_id; end if; if fms_rule_matches(v_rule.condition_operator,v_rule.condition_value,v_actual) then v_target=v_rule.next_stage_id; update fms_instance_stages set branch_rule_id=v_rule.id where id=v_instance_stage.id; exit; end if; end loop; if v_target is null then raise exception 'No deterministic decision route matched' using errcode='23514'; end if;
 elsif v_stage.step_type='parallel_start' then update fms_instance_stages set status='completed',actual_datetime=now(),completed_by=v_instance.started_by where id=v_instance_stage.id; foreach v_target in array v_stage.parallel_target_stage_ids loop perform activate_fms_stage_internal(p_instance_id,v_target,v_instance_stage.id,null,p_guard+1); end loop;
 elsif v_stage.step_type='end' then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id and status in ('active','overdue'); end if;
 if v_stage.step_type in ('notification','branch','parallel_start','parallel_join','end') then update fms_instance_stages set status='completed',actual_datetime=now(),completed_by=v_instance.started_by where id=v_instance_stage.id; insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,case when v_stage.step_type='branch' then 'branch_taken' else 'automatic_completed' end,'{}'); if v_stage.step_type='branch' and v_target is not null then perform activate_fms_stage_internal(p_instance_id,v_target,v_instance_stage.id,null,p_guard+1); elsif v_stage.step_type in ('notification','parallel_join') and v_stage.default_next_stage_id is not null then perform activate_fms_stage_internal(p_instance_id,v_stage.default_next_stage_id,v_instance_stage.id,null,p_guard+1); end if; if p_guard=0 and v_stage.step_type<>'end' and not exists(select 1 from fms_instance_stages where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id and status in ('active','overdue'); end if; end if;
 return v_instance_stage.id;
end $$;

create or replace function activate_fms_stage_internal(p_instance_id uuid,p_stage_id uuid,p_previous_instance_stage_id uuid,p_selected_user uuid default null,p_guard integer default 0)
returns uuid language sql security definer set search_path=public as $$
 select activate_fms_stage_v2_internal(p_instance_id,p_stage_id,p_previous_instance_stage_id,p_selected_user,p_guard)
$$;
revoke all on function activate_fms_stage_v2_internal(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid[],uuid) from public,anon,authenticated,service_role;

create or replace function assert_fms_flow_publishable(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_flow fms_flows;
  v_count bigint;
  v_reached bigint;
begin
  select * into v_flow from fms_flows where id=p_flow_id;
  if v_flow.id is null or v_flow.status<>'draft' then raise exception 'Draft workflow not found' using errcode='23514'; end if;
  select count(*) into v_count from fms_stages where fms_flow_id=p_flow_id;
  if v_count=0 then raise exception 'Workflow cannot be empty' using errcode='23514'; end if;
  if (select step_type from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1)<>'form' then raise exception 'The first workflow step must be a Form' using errcode='23514'; end if;
  if (select form_template_id from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1) is null then raise exception 'The initial Form step needs a published Form for the workflow details' using errcode='23514'; end if;
  if exists(select 1 from fms_stages where fms_flow_id=p_flow_id and step_type='end') then raise exception 'End nodes are no longer used; remove the End node and leave the final step unconnected' using errcode='23514'; end if;
  if not exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type not in ('branch','parallel_start','end') and s.default_next_stage_id is null and cardinality(s.parallel_target_stage_ids)=0 and not exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id)) then raise exception 'Workflow needs at least one completion step with no outgoing connection' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type not in ('notification','branch','parallel_start','parallel_join','end') and not is_valid_fms_timing_rule(s.planned_time_rule)) then raise exception 'Every workflow step needs a valid timing rule' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.planned_time_rule->>'decisionMode'='yes_no' and (s.step_type in ('notification','branch','parallel_start','parallel_join','end') or s.id=(select first_stage.id from fms_stages first_stage where first_stage.fms_flow_id=p_flow_id order by first_stage.sort_order,first_stage.id limit 1))) then raise exception 'Yes or No decisions are only available on human steps after the initial Form' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.planned_time_rule ? 'conditional' and not exists(select 1 from fms_stages decision where decision.fms_flow_id=s.fms_flow_id and decision.stage_key=s.planned_time_rule#>>'{conditional,decisionStageKey}' and decision.sort_order<s.sort_order and decision.planned_time_rule->>'decisionMode'='yes_no')) then raise exception 'Conditional steps must reference an earlier Yes or No decision' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and ((s.step_type='parallel_start' and cardinality(s.parallel_target_stage_ids)=0) or (s.step_type='parallel_join' and (s.join_rule is null or s.join_rule='specific' and cardinality(s.join_required_stage_ids)=0)) or (s.step_type='approval' and s.completion_rule<>'manager_approval') or (s.completion_rule='all_doers' and not s.allow_multiple_doers))) then raise exception 'A workflow step is incomplete or incompatible' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join form_templates f on f.id=s.form_template_id where s.fms_flow_id=p_flow_id and (f.tenant_id<>v_flow.tenant_id or f.lifecycle<>'published' or not f.is_active)) then raise exception 'Linked Forms must be exact active published versions from this tenant' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.form_template_id is not null and not exists(select 1 from form_templates f where f.id=s.form_template_id)) then raise exception 'A step links a Form that no longer exists' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_flows target on target.id=s.split_to_flow_id where s.fms_flow_id=p_flow_id and (target.tenant_id<>v_flow.tenant_id or target.status<>'published' or not target.is_active)) then raise exception 'Linked workflows must be active published versions from this tenant' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.default_next_stage_id is not null and not exists(select 1 from fms_stages n where n.id=s.default_next_stage_id and n.fms_flow_id=p_flow_id)) then raise exception 'A next-step connection points outside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s cross join lateral unnest(s.parallel_target_stage_ids||coalesce(s.join_required_stage_ids,'{}')) target(id) where s.fms_flow_id=p_flow_id and not exists(select 1 from fms_stages n where n.id=target.id and n.fms_flow_id=p_flow_id)) then raise exception 'A parallel connection points outside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='branch' and ((select count(*) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')<>1 or exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and (r.next_stage_id is null or r.next_flow_id is not null)) or (select max(sort_order) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')<>(select max(sort_order) from fms_branch_rules r where r.fms_stage_id=s.id))) then raise exception 'Decision steps require ordered routes to workflow steps and one final fallback route' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and (r.next_stage_id is null or r.next_flow_id is not null or not exists(select 1 from fms_stages n where n.id=r.next_stage_id and n.fms_flow_id=p_flow_id))) then raise exception 'Every conditional route needs a destination step inside this workflow' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and (select count(*) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')>1) then raise exception 'A step can define only one fallback route' using errcode='23514'; end if;
  -- Every routed step needs an Otherwise destination, so an unmatched answer can never strand an instance.
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and s.default_next_stage_id is null and exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id) and not exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default' and r.next_stage_id is not null)) then raise exception 'A step with conditional routes needs an Otherwise destination for answers that match no route' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='form_answer' and s.form_template_id is null) then raise exception 'A step that routes on a form answer needs a linked Form' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='form_answer' and not exists(select 1 from form_fields f where f.form_template_id=s.form_template_id and f.field_key=r.source_key)) then raise exception 'A conditional route uses a question that is no longer in the linked Form' using errcode='23514'; end if;
  -- A route may only match an option the linked question still offers.
  if exists(
    select 1 from fms_stages s
    join fms_branch_rules r on r.fms_stage_id=s.id
    join form_fields f on f.form_template_id=s.form_template_id and f.field_key=r.source_key
    cross join lateral (select form_field_option_values(f.options,f.dropdown_master_type,v_flow.tenant_id) as offered) options
    where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='form_answer'
      and r.condition_operator in ('equals','not_equals','in')
      and jsonb_array_length(options.offered)>0
      and not (options.offered @> fms_route_expected_values(r.condition_operator,r.condition_value))
  ) then raise exception 'A conditional route matches an answer that the linked question no longer offers' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.condition_operator not in ('default','not_empty') and nullif(btrim(coalesce(r.condition_value,'')),'') is null) then raise exception 'A conditional route needs the answer it should match' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and s.step_type<>'branch' and r.source_type='outcome' and r.condition_operator<>'default' and coalesce(s.planned_time_rule->>'decisionMode','normal') not in ('yes_no','decision')) then raise exception 'A route on a step outcome requires that step to be a Decision step' using errcode='23514'; end if;
  if exists(select 1 from fms_stage_assignees a join fms_stages s on s.id=a.fms_stage_id left join user_profiles primary_user on primary_user.id=a.user_profile_id left join user_profiles fallback_user on fallback_user.id=a.fallback_user_profile_id where s.fms_flow_id=p_flow_id and a.assignee_type='specific_user' and (primary_user.id is null or primary_user.tenant_id<>v_flow.tenant_id or primary_user.working_status='resigned' or (fallback_user.id is not null and (fallback_user.tenant_id<>v_flow.tenant_id or fallback_user.working_status='resigned' or fallback_user.department_id is distinct from primary_user.department_id)))) then raise exception 'Named assignees must be visible Users profiles in this tenant and fallback users must be in the primary user department' using errcode='23514'; end if;
  if exists(
    select 1 from fms_stages s
    left join form_fields field on field.form_template_id=s.form_template_id
      and field.field_key=s.planned_time_rule->>'assignmentFieldKey'
    where s.fms_flow_id=p_flow_id and nullif(s.planned_time_rule->>'assignmentFieldKey','') is not null
      and (s.step_type not in ('form','task','approval') or field.id is null or field.field_type<>'user_dropdown'
        or not field.is_required or not field.is_shown or field.conditional_logic is not null
        or field.rule_definition is not null)
  ) then raise exception 'A linked Form assignment source must be a required, always visible User question' using errcode='23514'; end if;
  with recursive edges as (
    select s.id source,s.default_next_stage_id target from fms_stages s where s.fms_flow_id=p_flow_id and s.default_next_stage_id is not null and not exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')
    union select s.id,unnest(s.parallel_target_stage_ids) from fms_stages s where s.fms_flow_id=p_flow_id
    union select s.id,r.next_stage_id from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and r.next_stage_id is not null
  ), reached(id) as (
    select id from fms_stages where fms_flow_id=p_flow_id and sort_order=(select min(sort_order) from fms_stages where fms_flow_id=p_flow_id)
    union select e.target from reached r join edges e on e.source=r.id
  ), finishes(id) as (
    select s.id from fms_stages s where s.fms_flow_id=p_flow_id and not exists(select 1 from edges e where e.source=s.id)
    union select e.source from finishes f join edges e on e.target=f.id
  ) select count(*),count(*) filter(where not exists(select 1 from finishes f where f.id=r.id)) into v_reached,v_count from reached r;
  if v_reached<>(select count(*) from fms_stages where fms_flow_id=p_flow_id) then raise exception 'Workflow contains unreachable steps' using errcode='23514'; end if;
  if v_count>0 then raise exception 'Every reachable step needs a path to completion; add an exit from the loop' using errcode='23514'; end if;
  with recursive automatic as (
    select id from fms_stages where fms_flow_id=p_flow_id and step_type in ('branch','notification','parallel_start','parallel_join','end')
  ), edges as (
    select s.id source,s.default_next_stage_id target from fms_stages s where s.fms_flow_id=p_flow_id and s.default_next_stage_id is not null and not exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')
    union select s.id,unnest(s.parallel_target_stage_ids) from fms_stages s where s.fms_flow_id=p_flow_id
    union select s.id,r.next_stage_id from fms_stages s join fms_branch_rules r on r.fms_stage_id=s.id where s.fms_flow_id=p_flow_id and r.next_stage_id is not null
  ), walk(root,id) as (
    select e.source,e.target from edges e join automatic a on a.id=e.source join automatic b on b.id=e.target
    union select w.root,e.target from walk w join edges e on e.source=w.id join automatic a on a.id=e.target
  ) select count(*) into v_count from walk where root=id;
  if v_count>0 then raise exception 'Automatic-only loops must pass through a human step before repeating' using errcode='23514'; end if;
end $$;

alter function activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer) owner to postgres;
revoke all on function activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer),activate_fms_stage_v1_internal(uuid,uuid,uuid,uuid,integer),fms_prepare_visit(),fms_pin_execution_version() from public,anon,authenticated,service_role;
alter function assert_fms_flow_publishable(uuid) owner to postgres;
revoke all on function assert_fms_flow_publishable(uuid) from public,anon,service_role;
grant execute on function assert_fms_flow_publishable(uuid) to authenticated;
-- Classify visit provenance under the existing guarded parent retirement.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('production_demo_data_retirement_manifest(uuid)'::regprocedure);
 if position($marker$'export_logs','fms_flows'$marker$ in definition)=0 then raise exception 'Retirement inventory contract changed'; end if;
 definition:=replace(definition,$marker$'export_logs','fms_flows'$marker$,$replacement$'export_logs','fms_execution_scopes','fms_flows'$replacement$);
 definition:=replace(definition,$marker$'fms_evidence', (select count(*)$marker$,$replacement$'fms_execution_scopes', (select count(*) from public.fms_execution_scopes where tenant_id=p_tenant_id),
      'fms_join_arrivals', (select count(*) from public.fms_join_arrivals a join public.fms_execution_scopes c on c.id=a.parallel_scope_id where c.tenant_id=p_tenant_id),
      'fms_visit_inputs', (select count(*) from public.fms_visit_inputs a join public.fms_execution_scopes c on c.id=a.parallel_scope_id where c.tenant_id=p_tenant_id),
      'fms_evidence', (select count(*)$replacement$);
 execute definition;
end $$;
notify pgrst,'reload schema';
