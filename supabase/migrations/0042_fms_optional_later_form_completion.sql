-- A linked Form is a completion gate only for the initial workflow step.
-- Later linked Forms remain available to collect extra data, but are optional.
create or replace function complete_fms_stage_with_audit(p_instance_stage_id uuid,p_outcome text default null,p_remark text default null,p_checklist jsonb default '{}',p_next_assignee_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_instance_stage fms_instance_stages; v_instance fms_instances; v_stage fms_stages; v_item record; v_satisfied boolean; v_next uuid; v_child uuid;
begin
 select * into v_actor from current_profile(); select * into v_instance_stage from fms_instance_stages where id=p_instance_stage_id for update; select * into v_instance from fms_instances where id=v_instance_stage.fms_instance_id for update; select * into v_stage from fms_stages where id=v_instance_stage.fms_stage_id;
 if v_actor.id is null or not current_profile_is_active() or v_instance.status not in ('active','overdue') or v_instance_stage.status not in ('pending','in_progress','in_review','overdue') then raise exception 'Stage is not actionable' using errcode='23514'; end if;
 if not (v_actor.id=any(v_instance_stage.assigned_to) or (v_actor.user_role in ('super_admin','admin')) or (v_actor.user_role='manager' and v_instance.branch_id=v_actor.branch_id)) then raise exception 'Stage completion denied' using errcode='42501'; end if;
 if v_stage.step_type='approval' and v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Approval requires manager or administrator authority' using errcode='42501'; end if;
 if jsonb_typeof(p_checklist)<>'object' then raise exception 'Checklist payload must be an object' using errcode='22023'; end if;
 for v_item in select * from fms_instance_checklist_items where fms_instance_stage_id=p_instance_stage_id for update loop
   if coalesce((p_checklist->>v_item.item_key)::boolean,false) then update fms_instance_checklist_items set is_completed=true,completed_by=v_actor.id,completed_at=now() where id=v_item.id; end if;
 end loop;
 if v_stage.requires_remark and nullif(btrim(p_remark),'') is null then raise exception 'A completion remark is required' using errcode='23514'; end if;
 if v_stage.requires_upload and not exists(select 1 from fms_evidence where fms_instance_stage_id=p_instance_stage_id and removed_at is null) then raise exception 'Required evidence upload is missing' using errcode='23514'; end if;
 if exists(select 1 from fms_instance_checklist_items where fms_instance_stage_id=p_instance_stage_id and is_required and not is_completed) then raise exception 'Required checklist items are incomplete' using errcode='23514'; end if;
 if v_stage.id=(select first_stage.id from fms_stages first_stage where first_stage.fms_flow_id=v_stage.fms_flow_id order by first_stage.sort_order,first_stage.id limit 1)
    and v_stage.form_template_id is not null
    and not exists(select 1 from form_submissions where form_template_id=v_stage.form_template_id and linked_module='fms_stage' and linked_record_id=p_instance_stage_id)
 then raise exception 'The initial details form submission is required' using errcode='23514'; end if;
 if v_stage.requires_next_doer_handoff and p_next_assignee_id is null then raise exception 'Next-stage assignee selection is required' using errcode='23514'; end if;
 if not v_actor.id=any(v_instance_stage.assigned_to) then
   insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by,status,claimed_at,completed_at,outcome,remark)
   values(v_instance.tenant_id,p_instance_stage_id,v_actor.id,v_actor.id,'completed',now(),now(),left(p_outcome,500),left(p_remark,4000));
   update fms_instance_stages set assigned_to=array_append(assigned_to,v_actor.id) where id=p_instance_stage_id;
 else
   update fms_instance_stage_assignees set status='completed',completed_at=now(),outcome=left(p_outcome,500),remark=left(p_remark,4000) where fms_instance_stage_id=p_instance_stage_id and user_profile_id=v_actor.id and is_active;
 end if;
 select case v_stage.completion_rule when 'all_doers' then count(*)>0 and bool_and(status='completed') when 'any_doer' then bool_or(status='completed') else v_actor.user_role in ('super_admin','admin','manager') end into v_satisfied from fms_instance_stage_assignees where fms_instance_stage_id=p_instance_stage_id and is_active;
 insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,'actor_completed',jsonb_build_object('outcome',left(coalesce(p_outcome,''),500),'remark',left(coalesce(p_remark,''),4000)));
 if not v_satisfied then return; end if;
 update fms_instance_stages set status='completed',actual_datetime=now(),completed_by=v_actor.id,remark=nullif(btrim(p_remark),''),outcome=nullif(btrim(p_outcome),'') where id=p_instance_stage_id;
 if v_stage.split_to_flow_id is not null and not exists(select 1 from fms_instances where parent_instance_id=v_instance.id and fms_flow_id=v_stage.split_to_flow_id) then
   select started.instance_id into v_child from start_fms_instance_with_audit(v_stage.split_to_flow_id,v_instance.title,v_instance.priority,v_instance.context,v_instance.branch_id,v_instance.department_id,p_next_assignee_id) started;
   update fms_instances set parent_instance_id=v_instance.id where id=v_child;
 end if;
 v_next=v_stage.default_next_stage_id; if v_next is not null then perform activate_fms_stage_internal(v_instance.id,v_next,p_instance_stage_id,p_next_assignee_id,0); end if;
 if v_next is null and v_stage.step_type<>'end' and not exists(select 1 from fms_instance_stages where fms_instance_id=v_instance.id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=v_instance.id; end if;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_instance.tenant_id,v_actor.id,'fms_stage_completed','fms_instance_stages',p_instance_stage_id,jsonb_build_object('outcome',left(coalesce(p_outcome,''),500)));
end $$;

alter function complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid) owner to postgres;
revoke all on function complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid) from public,anon,service_role;
grant execute on function complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid) to authenticated;

notify pgrst,'reload schema';
