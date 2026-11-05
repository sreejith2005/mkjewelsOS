-- CRM three-tab workspace, JewelOS side (owner request 2026-11-04).
-- CRM side: supabase-crm/supabase/migrations/20261104000300_crm_three_tab_workspace.sql.
--
-- 1. Dropdown Master list "CRM Branches" (crm_branch): which branches CRM offers for queue intake,
--    in what order and under which label. Each value is a JewelOS branch CODE (unique per tenant
--    and typeable by an administrator). The master snapshot resolves each code to the stable
--    branch id before it travels to CRM, where branches.jewelos_branch_id maps it to the CRM
--    branch. An unknown code travels as "unmapped:<code>" so CRM can report it; it is never a
--    choice. Branch identity and authorization stay on branches; nothing is created from the list.
--    The list is initialized once per tenant from its active branches; existing values win.
-- 2. Branch changes (name, code, active) refresh the snapshot through the existing audited
--    master outbox.
-- 3. get_crm_client_fms_runs: the FMS runs started for a CRM client by automatic start triggers,
--    for the CRM client profile. Read as the asker: crm.view, the CRM module, and per-run
--    can_read_fms_instance; nothing is written.
set search_path=public,extensions;

-- 1. The list ------------------------------------------------------------------------------------
insert into dropdown_master_categories(tenant_id,category_key,display_name,description,sort_order,is_system,is_key_locked)
select t.id,'crm_branch','CRM Branches',
  'Branches offered in CRM queue registration. Value = the JewelOS branch code; label = the name CRM shows.',205,true,true
from tenants t on conflict(tenant_id,category_key) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select b.tenant_id,'crm_branch',btrim(b.name),btrim(b.code),(row_number() over (partition by b.tenant_id order by b.name,b.id))::int*10,true
from branches b
where coalesce(b.is_active,true) and btrim(coalesce(b.code,''))<>''
  and not exists(select 1 from dropdown_masters m where m.tenant_id=b.tenant_id and m.master_type='crm_branch')
on conflict(tenant_id,master_type,value) do nothing;

-- The snapshot: unchanged for every other list; crm_branch values become branch ids.
create or replace function crm_sync.master_snapshot(p_tenant uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('tenant_id',p_tenant,'snapshot_at',clock_timestamp(),
  'members',coalesce((select jsonb_agg(p.id order by p.id) from public.user_profiles p where p.tenant_id=p_tenant),'[]'::jsonb),
  'options',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'master_type',m.master_type,'label',m.label,
    'value',case when m.master_type<>'crm_branch' then m.value
      else coalesce((select b.id::text from public.branches b where b.tenant_id=m.tenant_id and coalesce(b.is_active,true)
        and upper(btrim(b.code))=upper(btrim(m.value)) order by b.id limit 1),'unmapped:'||left(btrim(m.value),150)) end,
    'sort_order',m.sort_order,'active',m.is_active and coalesce(c.is_active,true)) order by m.master_type,m.sort_order,m.id)
   from public.dropdown_masters m left join public.dropdown_master_categories c on c.tenant_id=m.tenant_id and c.category_key=m.master_type
   where m.tenant_id=p_tenant and (m.master_type in ('beverage','sugar_option','snack_option','gift_option','caste','client_relation',
    'crm_source','product_category','not_bought_reason','potential_category','communication_preference','gender','occupation','bridal_or_non_bridal','wedding_month','crm_branch')
    or m.master_type like 'lead\_%' escape '\')),'[]'::jsonb));
$$;
revoke all on function crm_sync.master_snapshot(uuid) from public,anon,authenticated,service_role;

-- 2. Branch edits refresh the snapshot -----------------------------------------------------------
create function crm_sync.branch_master_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.name,new.code,new.is_active,new.tenant_id) is not distinct from (old.name,old.code,old.is_active,old.tenant_id) then return null; end if;
 -- enqueue_master coalesces repeats into one pending event per tenant.
 if tg_op in ('UPDATE','DELETE') then perform crm_sync.enqueue_master(old.tenant_id); end if;
 if tg_op in ('INSERT','UPDATE') then perform crm_sync.enqueue_master(new.tenant_id); end if;
 return null;
end $$;
create trigger crm_master_branches_changed after insert or update or delete on public.branches
  for each row execute function crm_sync.branch_master_changed();
revoke all on function crm_sync.branch_master_changed() from public,anon,authenticated,service_role;

insert into crm_sync.outbox(event_type,aggregate_id)
select 'master.options_changed',id from public.tenants
on conflict(event_type,aggregate_id) where delivered_at is null and dead_at is null
do update set changed_at=clock_timestamp(),next_attempt_at=least(crm_sync.outbox.next_attempt_at,now());

-- 3. FMS runs of a CRM client --------------------------------------------------------------------
create function get_crm_client_fms_runs(p_crm_client_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=current_profile(); result jsonb;
begin
  if v_actor.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode='42501'; end if;
  perform assert_module_enabled('crm');
  if not has_permission('crm.view') then raise exception 'CRM access required' using errcode='42501'; end if;
  if p_crm_client_id is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(r order by r->>'startedAt' desc,r->>'instanceId'),'[]'::jsonb) into result from (
    select jsonb_build_object(
      'instanceId',i.id,'referenceNumber',i.reference_number,'title',i.title,'status',i.status,
      'workflowName',f.name,'sourceType',s.source_type,'crmCaseId',s.crm_case_id,'caseOpen',s.released_at is null,
      'startedAt',i.started_at,'completedAt',i.completed_at,
      'openSteps',coalesce((select jsonb_agg(jsonb_build_object('instanceStageId',st.id,'stageName',fs.name,'status',st.status,
          'visitNumber',st.visit_number,'dueAt',st.planned_datetime,
          'assignees',coalesce((select jsonb_agg(p.employee_name order by p.employee_name) from user_profiles p where p.id=any(coalesce(st.assigned_to,'{}'))),'[]'::jsonb))
        order by st.planned_datetime nulls last,st.created_at)
        from fms_instance_stages st join fms_stages fs on fs.id=st.fms_stage_id
        where st.fms_instance_id=i.id and i.status in ('active','overdue','on_hold') and st.status not in ('completed','rejected')),'[]'::jsonb)) r
    from fms_instance_trigger_sources s
    join fms_instances i on i.id=s.fms_instance_id
    join fms_flows f on f.id=s.fms_flow_id
    where s.tenant_id=v_actor.tenant_id and s.crm_client_id=p_crm_client_id and can_read_fms_instance(i.id)
    order by i.started_at desc,i.id limit 20) x;
  return result;
end $$;
revoke all on function get_crm_client_fms_runs(uuid) from public,anon;
grant execute on function get_crm_client_fms_runs(uuid) to authenticated;
create index if not exists fms_instance_trigger_sources_crm_client on fms_instance_trigger_sources(tenant_id,crm_client_id) where crm_client_id is not null;
