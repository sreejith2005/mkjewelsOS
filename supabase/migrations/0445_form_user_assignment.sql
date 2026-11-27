-- Users filters are initial suggestions. Every Users question also offers the
-- task-style department and store choices. Directory visibility stays unchanged.
set search_path = public, extensions;

create function pg_temp.patch_form_users(sig text, old_text text, new_text text)
returns void language plpgsql as $$
declare body text;
begin
  body := replace(pg_get_functiondef(sig::regprocedure), E'\r', '');
  if (length(body)-length(replace(body,old_text,'')))/length(old_text) <> 1 then
    raise exception 'Unexpected Forms contract in %', sig;
  end if;
  execute replace(body,old_text,new_text);
end $$;

-- Separate from task permissions: answering a Users question does not require
-- task author permissions, and selecting a person grants no directory access.
create function form_user_recipient_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from user_profiles u
    join branches b on b.id=u.branch_id and b.tenant_id=u.tenant_id and b.is_active
    where u.id=p_user_id and u.tenant_id=current_tenant_id() and u.removed_at is null
      and u.working_status='active' and u.account_status='active' and u.is_login_enabled);
$$;
revoke all on function form_user_recipient_eligible(uuid) from public,anon,authenticated,service_role;

select pg_temp.patch_form_users('public.assert_cross_location_lookup(jsonb)',
  $o$and ft.lifecycle = 'published'$o$, $n$and ft.lifecycle in ('published','archived')$n$);
select pg_temp.patch_form_users('public.assert_cross_location_lookup(jsonb)',
  $o$and f.assignment_scope = 'cross_location'$o$, '');
select pg_temp.patch_form_users('public.assert_cross_location_lookup(jsonb)',
  $o$  elsif v_kind = 'form' then$o$,
  $n$  elsif v_kind = 'form' then
    perform assert_module_enabled('forms_library');$n$);

create function list_form_user_options(p_template_id uuid, p_field_key text, p_expanded boolean default false, p_selected_user_id uuid default null)
returns table(id uuid, label text) language plpgsql stable security definer set search_path=public as $$
declare a user_profiles; v_filter jsonb;
begin
  a := assert_cross_location_lookup(jsonb_build_object('kind','form','form_template_id',p_template_id,'field_key',p_field_key));
  select f.validation->'userFilter' into v_filter from form_fields f
    where f.form_template_id=p_template_id and f.field_key=p_field_key;
  return query select u.id,u.employee_name from user_profiles u
    where u.tenant_id=a.tenant_id and form_user_recipient_eligible(u.id)
      and (u.id=p_selected_user_id or case when coalesce(p_expanded,false) then u.branch_id=a.branch_id
        else org_recipient_in_local_scope(a.id,u.id) and form_user_matches_filter(v_filter,u.id) end)
    order by u.employee_name,u.id;
end $$;
revoke all on function list_form_user_options(uuid,text,boolean,uuid) from public,anon,service_role;
grant execute on function list_form_user_options(uuid,text,boolean,uuid) to authenticated;

-- Keep Tasks' recipient behavior exactly as released in 0439.
select pg_temp.patch_form_users('public.search_assignment_recipients(jsonb,uuid,text,integer,integer)',
  $o$else org_cross_location_recipient_eligible(u.id) end$o$,
  $n$else form_user_recipient_eligible(u.id) end$n$);

-- Every submit path already calls this private validator inside its audited
-- transaction. Keep the signature for saved definitions and old clients.
create or replace function assert_form_user_answer(p_tenant_id uuid, p_field_key text, p_scope text, p_value text)
returns void language plpgsql security definer set search_path=public as $$
declare a user_profiles := current_profile(); v_id uuid := p_value::uuid;
begin
  if a.id is null or not current_profile_is_active() or a.tenant_id<>p_tenant_id then
    raise exception 'Active form actor required' using errcode='42501';
  end if;
  if not form_user_recipient_eligible(v_id) then
    raise exception 'Field % references an invalid user',p_field_key using errcode='23503';
  end if;
  if not org_recipient_in_local_scope(a.id,v_id) then
    perform org_note_cross_location_recipient(v_id);
  end if;
end $$;

select pg_temp.patch_form_users('public.submit_form_base_with_audit(uuid,jsonb,text,uuid)',
  $o$ perform public.assert_form_user_filter(v_field.validation->'userFilter',v_text,v_field.field_key);$o$, '');
select pg_temp.patch_form_users('public.fms_validate_candidate_form(uuid,jsonb,text,uuid)',
  $o$ perform public.assert_form_user_filter(v_field.validation->'userFilter',v_text,v_field.field_key);$o$, '');
select pg_temp.patch_form_users('public.audit_cross_location_answers(uuid)',
  $o$and f.assignment_scope = 'cross_location'$o$, '');
-- New answers have already passed the same-tenant/active-recipient validator.
-- Preserve the durable stage/submission identity and assignment transaction.
select pg_temp.patch_form_users('public.fms_assignment_user_from_submission(uuid,uuid)',
  $o$  if org_scope_enforced(v_submission.tenant_id) and v_field.assignment_scope<>'cross_location'
     and franchise_of_branch((select u.branch_id from user_profiles u where u.id=v_user_id)) is distinct from franchise_of_branch(v_submission.branch_id) then
    raise exception 'FMS step % assigns an employee in another franchise',v_stage.name using errcode='42501';
  end if;
$o$, '');

-- department-alternatives-repair:begin
-- The reported blank question saved Department=Sales AND Department=CRM.
-- Repair only that impossible two-rule configuration to the requested union.
-- Preserve every other rule configuration, validation setting, ID and answer.
do $repair$
declare r record; v_rules jsonb; v_filter jsonb; v_validation jsonb;
  previous_edit_flag text := coalesce(current_setting('jewelos.allow_published_form_edit',true),'');
begin
  for r in
    select f.id,f.form_template_id,f.field_key,f.validation,t.tenant_id
    from form_fields f join form_templates t on t.id=f.form_template_id
    where f.field_type='user_dropdown' and t.lifecycle='published'
      and coalesce(f.validation->'userFilter'->>'match','all')='all'
      and jsonb_array_length(coalesce(f.validation->'userFilter'->'rules','[]'::jsonb))=2
      and (select count(*) from jsonb_array_elements(f.validation->'userFilter'->'rules') rule
           join departments d on d.id::text=lower(rule->'values'->>0) and d.tenant_id=t.tenant_id
           where rule->>'attribute'='department' and rule->>'operator'='equals'
             and jsonb_array_length(rule->'values')=1 and lower(btrim(d.name)) in ('sales','crm'))=2
      and (select count(distinct lower(btrim(d.name)))
           from jsonb_array_elements(f.validation->'userFilter'->'rules') rule
           join departments d on d.id::text=lower(rule->'values'->>0) and d.tenant_id=t.tenant_id)=2
    for update of f
  loop
    select jsonb_build_array(jsonb_build_object('attribute','department','operator','in',
      'values',jsonb_agg(rule->'values'->0 order by ord))) into v_rules
      from jsonb_array_elements(r.validation->'userFilter'->'rules') with ordinality x(rule,ord);
    v_filter:=jsonb_set(r.validation->'userFilter','{rules}',v_rules);
    v_validation:=jsonb_set(r.validation,'{userFilter}',v_filter);
    perform set_config('jewelos.allow_published_form_edit','on',true);
    update form_fields set validation=v_validation where id=r.id;
    perform set_config('jewelos.allow_published_form_edit',previous_edit_flag,true);
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(r.tenant_id,null,'form_department_choices_corrected','forms',r.id,
      jsonb_build_object('validation',r.validation),
      jsonb_build_object('form_template_id',r.form_template_id,'field_key',r.field_key,
        'validation',v_validation,'reason','Owner requested Sales or CRM as alternative departments'));
  end loop;
end $repair$;
-- department-alternatives-repair:end

notify pgrst,'reload schema';
