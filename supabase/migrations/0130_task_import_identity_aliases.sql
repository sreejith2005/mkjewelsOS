-- Resolve stale spreadsheet identities safely, remember ambiguous labels once,
-- and repair already-imported Assigning Left records on a repeat upload.
set search_path = public, extensions;

create table public.task_import_identity_aliases (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  normalized_label text not null check (length(normalized_label) between 1 and 200),
  source_label text not null check (length(btrim(source_label)) between 1 and 200),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  created_by uuid not null references public.user_profiles(id),
  updated_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, normalized_label)
);
create index idx_task_import_identity_aliases_profile
  on public.task_import_identity_aliases(tenant_id,user_profile_id);
alter table public.task_import_identity_aliases enable row level security;
revoke all on table public.task_import_identity_aliases from public,anon,authenticated,service_role;

create function public.task_import_normalized_identity_label(p_value text)
returns text language sql immutable set search_path=public as $$
  select lower(regexp_replace(btrim(coalesce(p_value,'')),'\s+',' ','g'))
$$;

create function public.task_import_compact_identity_label(p_value text)
returns text language sql immutable set search_path=public as $$
  with cleaned as (
    select regexp_split_to_array(
      btrim(regexp_replace(public.task_import_normalized_identity_label(p_value),'[^[:alnum:]]+',' ','g')),
      '\s+'
    ) parts
  )
  select case
    when coalesce(array_length(parts,1),0)=0 then ''
    when array_length(parts,1)=1 then parts[1]
    else parts[1]||' '||parts[array_length(parts,1)]
  end from cleaned
$$;

create function public.task_import_resolve_assignee(p_row jsonb)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare
  v_actor public.user_profiles:=public.task_import_actor();
  v_email text:=lower(btrim(coalesce(p_row->>'assignee_email','')));
  v_name text:=public.task_import_normalized_identity_label(p_row->>'assignee_name');
  v_compact text:=public.task_import_compact_identity_label(p_row->>'assignee_name');
  v_match uuid; v_count integer;
begin
  if v_email<>'' then
    select count(*),min(u.id::text)::uuid into v_count,v_match
    from public.user_profiles u
    where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
      and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id)
      and lower(u.email)=v_email;
    if v_count=1 then return v_match; end if;
  end if;
  if v_name='' then return null; end if;

  select a.user_profile_id into v_match
  from public.task_import_identity_aliases a
  join public.user_profiles u on u.id=a.user_profile_id and u.tenant_id=a.tenant_id
  where a.tenant_id=v_actor.tenant_id and a.normalized_label=v_name
    and u.working_status='active' and u.account_status='active' and u.is_login_enabled
    and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id);
  if v_match is not null then return v_match; end if;

  select count(*),min(u.id::text)::uuid into v_count,v_match
  from public.user_profiles u
  where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
    and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id)
    and public.task_import_normalized_identity_label(u.employee_name)=v_name;
  if v_count=1 then return v_match; end if;

  select count(*),min(u.id::text)::uuid into v_count,v_match
  from public.user_profiles u
  where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
    and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id)
    and public.task_import_compact_identity_label(u.employee_name)=v_compact;
  return case when v_count=1 then v_match else null end;
end;
$$;

create function public.task_import_fingerprint_row(p_row jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_actor public.user_profiles:=public.task_import_actor(); v_branch uuid; v_department uuid;
  v_branch_name text; v_department_name text;
begin
  select b.id,b.name into v_branch,v_branch_name from public.branches b
  where b.tenant_id=v_actor.tenant_id and b.is_active
    and (lower(b.name)=lower(btrim(p_row->>'branch')) or lower(b.code)=lower(btrim(p_row->>'branch')))
    and (v_actor.user_role<>'manager' or b.id=v_actor.branch_id)
  order by b.name,b.id limit 1;
  if v_branch is null then
    select b.id,b.name into v_branch,v_branch_name from public.branches b
    where b.tenant_id=v_actor.tenant_id and b.is_active and (v_actor.user_role<>'manager' or b.id=v_actor.branch_id)
    order by case when b.id=v_actor.branch_id then 0 else 1 end,b.name,b.id limit 1;
  end if;
  select d.id,d.name into v_department,v_department_name from public.departments d
  where d.tenant_id=v_actor.tenant_id and (d.branch_id is null or d.branch_id=v_branch) and d.is_active
    and lower(d.name)=lower(btrim(p_row->>'department'))
  order by d.name,d.id limit 1;
  if v_department is null then
    select d.id,d.name into v_department,v_department_name from public.departments d
    where d.tenant_id=v_actor.tenant_id and (d.branch_id is null or d.branch_id=v_branch) and d.is_active
    order by case when d.id=v_actor.department_id then 0 else 1 end,d.name,d.id limit 1;
  end if;
  return p_row||jsonb_build_object('branch',v_branch_name,'department',v_department_name);
end;
$$;

drop function if exists public.list_task_import_identity_candidates();
create function public.list_task_import_identity_candidates()
returns table(id uuid,employee_name text,email text,branch_id uuid,department_id uuid,manager_id uuid,import_aliases text[])
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.user_profiles:=public.task_import_actor();
begin
  return query
  select u.id,u.employee_name,u.email,u.branch_id,u.department_id,u.reports_to_user_id,
    coalesce(array_agg(a.source_label order by a.source_label) filter(where a.id is not null),'{}'::text[])
  from public.user_profiles u
  left join public.task_import_identity_aliases a on a.tenant_id=u.tenant_id and a.user_profile_id=u.id
  where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
    and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id)
  group by u.id,u.employee_name,u.email,u.branch_id,u.department_id,u.reports_to_user_id
  order by u.employee_name,u.id;
end;
$$;

create function public.save_task_import_identity_alias_with_audit(p_source_label text,p_user_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.user_profiles; v_target public.user_profiles; v_existing public.task_import_identity_aliases;
  v_label text:=btrim(coalesce(p_source_label,'')); v_normalized text:=public.task_import_normalized_identity_label(p_source_label);
begin
  select * into v_actor from public.current_profile();
  if v_actor.id is null or not public.current_profile_is_active() or v_actor.user_role not in ('super_admin','admin') then
    raise exception 'Task import identity mapping denied' using errcode='42501';
  end if;
  if length(v_label) not between 1 and 200 then raise exception 'Source name is invalid' using errcode='22023'; end if;
  select * into v_target from public.user_profiles
  where id=p_user_profile_id and tenant_id=v_actor.tenant_id and working_status='active' and account_status='active' and is_login_enabled;
  if v_target.id is null then raise exception 'Selected employee is unavailable' using errcode='23503'; end if;
  select * into v_existing from public.task_import_identity_aliases
  where tenant_id=v_actor.tenant_id and normalized_label=v_normalized for update;
  insert into public.task_import_identity_aliases(tenant_id,normalized_label,source_label,user_profile_id,created_by,updated_by)
  values(v_actor.tenant_id,v_normalized,v_label,v_target.id,v_actor.id,v_actor.id)
  on conflict(tenant_id,normalized_label) do update set
    source_label=excluded.source_label,user_profile_id=excluded.user_profile_id,updated_by=excluded.updated_by,updated_at=now();
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_import_identity_alias_saved','tasks',v_target.id,
    case when v_existing.id is null then null else jsonb_build_object('source_label',v_existing.source_label,'user_profile_id',v_existing.user_profile_id) end,
    jsonb_build_object('source_label',v_label,'user_profile_id',v_target.id));
  return jsonb_build_object('saved',true,'source_label',v_label,'user_profile_id',v_target.id);
end;
$$;

alter function public.commit_task_bulk_import_chunk(uuid,jsonb) rename to commit_task_bulk_import_chunk_v0105;
revoke all on function public.commit_task_bulk_import_chunk_v0105(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.commit_task_bulk_import_chunk(p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_reconciled jsonb; v_assigning_left integer;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Import chunks must contain 1 to 100 rows' using errcode='22023';
  end if;
  -- Preserve the raw business fingerprint used by prior releases. The legacy
  -- commit creates/replays the records, then reconciliation safely upgrades
  -- only records whose identity now resolves.
  v_result:=public.commit_task_bulk_import_chunk_v0105(p_batch_id,p_rows);
  v_reconciled:=public.reconcile_task_import_assignments(p_rows);
  select count(*) into v_assigning_left
  from public.task_import_items item
  left join public.task_templates template on template.id=item.task_template_id
  left join public.task_instances instance on instance.id=item.task_instance_id
  where item.batch_id=p_batch_id and item.outcome='created'
    and coalesce(template.assignment_status,instance.assignment_status)='assigning_left';
  return v_result||jsonb_build_object(
    'assigning_left_count',v_assigning_left,
    'reconciled_count',coalesce((v_reconciled->>'updated_count')::integer,0)
  );
end;
$$;

create function public.reconcile_task_import_assignments(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.user_profiles:=public.task_import_actor(); v_row jsonb; v_assignee uuid; v_fingerprint text;
  v_registry public.task_import_row_registry; v_updated integer:=0;
begin
  if v_actor.user_role not in ('super_admin','admin') then raise exception 'Task import reconciliation denied' using errcode='42501'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Reconciliation chunks must contain 1 to 100 rows' using errcode='22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_assignee:=public.task_import_resolve_assignee(v_row);
    if v_assignee is null then continue; end if;
    v_fingerprint:=public.task_import_business_fingerprint(public.task_import_fingerprint_row(v_row));
    select * into v_registry from public.task_import_row_registry
    where tenant_id=v_actor.tenant_id and business_fingerprint=v_fingerprint;
    if v_registry.task_instance_id is not null and exists(
      select 1 from public.task_instances where id=v_registry.task_instance_id and tenant_id=v_actor.tenant_id and assignment_status='assigning_left'
    ) then
      perform public.assign_imported_task_with_audit('task',v_registry.task_instance_id,v_assignee); v_updated:=v_updated+1;
    elsif v_registry.task_template_id is not null and exists(
      select 1 from public.task_templates where id=v_registry.task_template_id and tenant_id=v_actor.tenant_id and assignment_status='assigning_left'
    ) then
      perform public.assign_imported_task_with_audit('template',v_registry.task_template_id,v_assignee); v_updated:=v_updated+1;
    end if;
    v_registry:=null;
  end loop;
  return jsonb_build_object('updated_count',v_updated);
end;
$$;

revoke all on function public.task_import_normalized_identity_label(text),public.task_import_compact_identity_label(text),public.task_import_resolve_assignee(jsonb),public.task_import_fingerprint_row(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.list_task_import_identity_candidates(),public.save_task_import_identity_alias_with_audit(text,uuid),public.commit_task_bulk_import_chunk(uuid,jsonb),public.reconcile_task_import_assignments(jsonb) from public,anon,service_role;
grant execute on function public.list_task_import_identity_candidates(),public.save_task_import_identity_alias_with_audit(text,uuid),public.commit_task_bulk_import_chunk(uuid,jsonb),public.reconcile_task_import_assignments(jsonb) to authenticated;

notify pgrst,'reload schema';
