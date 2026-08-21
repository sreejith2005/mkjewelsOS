-- Forward-only hosted repair for the already-recorded 0054/0055 migrations.
-- It also supplies the canonical explicit runtime for clean local bootstraps.
create or replace function is_valid_fms_timing_rule(p_rule jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_method text:=coalesce(nullif(p_rule->>'timingMethod',''),'completion_date'); v_number numeric; v_condition jsonb:=p_rule->'conditional';
begin
 if coalesce(p_rule->>'decisionMode','normal') not in ('normal','yes_no') then return false; end if;
 if v_condition is not null and (jsonb_typeof(v_condition)<>'object' or ((coalesce(v_condition->>'field','')='status' and coalesce(v_condition->>'operator','') in ('equals','not_equals','greater_than','less_than','greater_than_or_equal','less_than_or_equal','contains','not_contains') and nullif(btrim(v_condition->>'value'),'') is not null) is not true and (coalesce(v_condition->>'decisionStageKey','') !~ '^[a-z][a-z0-9_]{0,63}$' or coalesce(v_condition->>'outcome','') not in ('yes','no')))) then return false; end if;
 if v_method='completion_date' then return is_valid_fms_due_date(p_rule->>'dueDate'); end if;
 if v_method='tat_hours' then v_number:=(p_rule->>'tatHours')::numeric; return v_number>0 and v_number<=8760; end if;
 if v_method='days_before_date' then v_number:=(p_rule->>'daysBefore')::numeric; return is_valid_fms_due_date(p_rule->>'futureDate') and v_number=trunc(v_number) and v_number between 0 and 3650; end if;
 if v_method='specific_time' then return is_valid_fms_due_date(p_rule->>'dueDate') and coalesce(p_rule->>'clockTime','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'; end if;
 return false;
exception when others then return false;
end $$;

create or replace function fms_status_condition_matches(p_operator text,p_expected text,p_actual text)
returns boolean language sql immutable set search_path=public as $$
 select case p_operator
  when 'equals' then coalesce(lower(p_actual),'')=lower(p_expected)
  when 'not_equals' then coalesce(lower(p_actual),'')<>lower(p_expected)
  when 'greater_than' then coalesce(lower(p_actual),'')>lower(p_expected)
  when 'less_than' then coalesce(lower(p_actual),'')<lower(p_expected)
  when 'greater_than_or_equal' then coalesce(lower(p_actual),'')>=lower(p_expected)
  when 'less_than_or_equal' then coalesce(lower(p_actual),'')<=lower(p_expected)
  when 'contains' then position(lower(p_expected) in coalesce(lower(p_actual),''))>0
  when 'not_contains' then position(lower(p_expected) in coalesce(lower(p_actual),''))=0
  else false end
$$;

create or replace function activate_fms_stage_internal(p_instance_id uuid,p_stage_id uuid,p_previous_instance_stage_id uuid,p_selected_user uuid default null,p_guard integer default 0)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_instance fms_instances; v_stage fms_stages; v_instance_stage fms_instance_stages; v_ids uuid[]; v_item jsonb; v_rule fms_branch_rules; v_actual jsonb; v_target uuid; v_actor uuid; v_ready boolean; v_required integer; v_completed integer; v_revision_of uuid; v_activated_next boolean:=false; v_condition_key text; v_condition_expected text; v_condition_actual text; v_condition_operator text; v_condition_met boolean;
begin
 if p_guard>100 then raise exception 'Automatic FMS transition limit exceeded' using errcode='54001'; end if;
 select * into v_instance from fms_instances where id=p_instance_id for update; select * into v_stage from fms_stages where id=p_stage_id;
 if v_instance.status not in ('active','overdue') or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception 'Instance or stage is not activatable' using errcode='23514'; end if;
 if v_stage.step_type='parallel_join' then if v_stage.join_rule='specific' then select cardinality(v_stage.join_required_stage_ids),count(*) into v_required,v_completed from fms_instance_stages where fms_instance_id=p_instance_id and fms_stage_id=any(v_stage.join_required_stage_ids) and status='completed'; else select count(*),count(*) filter(where s.status='completed') into v_required,v_completed from fms_stages d join fms_instance_stages s on s.fms_stage_id=d.id and s.fms_instance_id=p_instance_id where v_stage.id=any(d.parallel_target_stage_ids) or d.default_next_stage_id=v_stage.id; end if; v_ready=case v_stage.join_rule when 'any' then v_completed>0 else v_required>0 and v_completed=v_required end; if not v_ready then return null; end if; end if;
 select * into v_instance_stage from fms_instance_stages where fms_instance_id=p_instance_id and fms_stage_id=p_stage_id order by created_at desc,id desc limit 1;
 if v_instance_stage.id is not null and v_instance_stage.status<>'blocked' then return v_instance_stage.id; end if;
 if v_instance_stage.status='blocked' then v_revision_of=v_instance_stage.id; end if;
 v_condition_met:=true;
 if v_stage.planned_time_rule#>>'{conditional,field}'='status' then
   v_condition_operator:=v_stage.planned_time_rule#>>'{conditional,operator}';
   v_condition_expected:=lower(v_stage.planned_time_rule#>>'{conditional,value}');
   v_condition_actual:=lower(v_instance.context->>'status');
   v_condition_met:=fms_status_condition_matches(v_condition_operator,v_condition_expected,v_condition_actual);
 elsif nullif(v_stage.planned_time_rule#>>'{conditional,decisionStageKey}','') is not null then
   v_condition_key:=v_stage.planned_time_rule#>>'{conditional,decisionStageKey}';
   v_condition_expected:=lower(v_stage.planned_time_rule#>>'{conditional,outcome}');
   select lower(instance_stage.outcome) into v_condition_actual from fms_instance_stages instance_stage join fms_stages definition on definition.id=instance_stage.fms_stage_id where instance_stage.fms_instance_id=p_instance_id and definition.stage_key=v_condition_key and instance_stage.status='completed' order by instance_stage.actual_datetime desc nulls last limit 1;
   if v_condition_actual is null then raise exception 'The earlier Yes or No decision has not been completed' using errcode='23514'; end if;
   v_condition_met:=v_condition_actual=v_condition_expected;
 end if;
 if not v_condition_met then
   insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,actual_datetime,completed_by,previous_instance_stage_id,revision_of_id,outcome) values(p_instance_id,p_stage_id,'completed','{}',fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id),now(),now(),v_instance.started_by,p_previous_instance_stage_id,v_revision_of,'condition_skipped') returning * into v_instance_stage;
   insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,'condition_skipped',case when v_stage.planned_time_rule#>>'{conditional,field}'='status' then jsonb_build_object('field','status','operator',v_condition_operator,'expected',v_condition_expected,'actual',v_condition_actual) else jsonb_build_object('decisionStageKey',v_condition_key,'expected',v_condition_expected,'actual',v_condition_actual) end);
   insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_instance.tenant_id,v_instance.started_by,'fms_stage_condition_skipped','fms_instance_stages',v_instance_stage.id,jsonb_build_object('stage_id',p_stage_id,'previous_instance_stage_id',p_previous_instance_stage_id,'condition_type',case when v_stage.planned_time_rule#>>'{conditional,field}'='status' then 'status' else 'decision' end));
   if v_stage.default_next_stage_id is not null then perform activate_fms_stage_internal(p_instance_id,v_stage.default_next_stage_id,v_instance_stage.id,null,p_guard+1); elsif not exists(select 1 from fms_instance_stages where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id; end if;
   return v_instance_stage.id;
 end if;
 v_ids=resolve_fms_stage_assignees(p_stage_id,p_instance_id,p_selected_user);
 insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,previous_instance_stage_id,revision_of_id) values(p_instance_id,p_stage_id,(case when v_stage.step_type in ('notification','branch','parallel_start','parallel_join','end') then 'in_progress' else case when v_stage.step_type='approval' then 'in_review' else 'in_progress' end end)::task_status,v_ids,fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id),now(),p_previous_instance_stage_id,v_revision_of) returning * into v_instance_stage;
 foreach v_actor in array v_ids loop insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by) values(v_instance.tenant_id,v_instance_stage.id,v_actor,v_instance.started_by); end loop;
 for v_item in select value from jsonb_array_elements(v_stage.checklist_definition) loop insert into fms_instance_checklist_items(tenant_id,fms_instance_stage_id,item_key,label,is_required,sort_order) values(v_instance.tenant_id,v_instance_stage.id,v_item->>'key',v_item->>'label',coalesce((v_item->>'required')::boolean,true),coalesce((v_item->>'sortOrder')::integer,0)); end loop;
 insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,'activated',jsonb_build_object('guard',p_guard));
 if v_stage.step_type='notification' then foreach v_actor in array case when cardinality(v_ids)>0 then v_ids else array[v_instance.started_by] end loop insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url,channel,delivered_status) values(v_instance.tenant_id,v_actor,'fms_stage_notification',coalesce(nullif(v_stage.notification_config->>'title',''),v_stage.name),coalesce(nullif(v_stage.notification_config->>'message',''),coalesce(v_stage.method,'FMS stage notification')),'/tasks?view=fms&instance='||p_instance_id,'in_app','delivered'); end loop;
 elsif v_stage.step_type='branch' then for v_rule in select * from fms_branch_rules where fms_stage_id=v_stage.id order by sort_order loop if v_rule.source_type='outcome' then select to_jsonb(outcome) into v_actual from fms_instance_stages where id=p_previous_instance_stage_id; elsif v_rule.source_type='context' then v_actual=v_instance.context->v_rule.source_key; else select fs.data->v_rule.source_key into v_actual from form_submissions fs join fms_instance_stages prior on prior.form_submission_id=fs.id where prior.id=p_previous_instance_stage_id; end if; if fms_rule_matches(v_rule.condition_operator,v_rule.condition_value,v_actual) then v_target=v_rule.next_stage_id; update fms_instance_stages set branch_rule_id=v_rule.id where id=v_instance_stage.id; exit; end if; end loop; if v_target is null then raise exception 'No deterministic decision route matched' using errcode='23514'; end if;
 elsif v_stage.step_type='parallel_start' then foreach v_target in array v_stage.parallel_target_stage_ids loop perform activate_fms_stage_internal(p_instance_id,v_target,v_instance_stage.id,null,p_guard+1); v_activated_next=true; end loop;
 elsif v_stage.step_type='end' then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id; end if;
 if v_stage.step_type in ('notification','branch','parallel_start','parallel_join','end') then update fms_instance_stages set status='completed',actual_datetime=now(),completed_by=v_instance.started_by where id=v_instance_stage.id; insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,case when v_stage.step_type='branch' then 'branch_taken' else 'automatic_completed' end,'{}'); if v_stage.step_type='branch' and v_target is not null then perform activate_fms_stage_internal(p_instance_id,v_target,v_instance_stage.id,null,p_guard+1); v_activated_next=true; elsif v_stage.step_type in ('notification','parallel_join') and v_stage.default_next_stage_id is not null then perform activate_fms_stage_internal(p_instance_id,v_stage.default_next_stage_id,v_instance_stage.id,null,p_guard+1); v_activated_next=true; end if; if not v_activated_next and v_stage.step_type<>'end' and not exists(select 1 from fms_instance_stages where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id; end if; end if;
 return v_instance_stage.id;
end $$;

alter function is_valid_fms_timing_rule(jsonb) owner to postgres;
alter function fms_status_condition_matches(text,text,text) owner to postgres;
alter function activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer) owner to postgres;
revoke all on function fms_status_condition_matches(text,text,text), activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
