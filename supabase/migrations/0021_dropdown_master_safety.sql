-- Preserve stable codes and historical references while allowing audited label/order/active changes.
set search_path = public, extensions;

create or replace function protect_dropdown_master_identity()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_referenced boolean := false;
begin
  if tg_op = 'UPDATE' and old.master_type = new.master_type and old.value = new.value then return new; end if;
  if old.master_type = 'task_priority' then
    raise exception 'Task priority codes are fixed by the database contract' using errcode='23514';
  end if;
  select exists(select 1 from user_profiles where designation_id=old.id)
      or exists(select 1 from resignations where resignation_reason_id=old.id)
      or exists(select 1 from clients where source_id=old.id or client_type_id=old.id)
      or exists(select 1 from walkin_entries where client_type_id=old.id or buy_status_id=old.id or not_bought_reason_id=old.id or potential_category_id=old.id or old.id=any(product_category_ids))
      or exists(select 1 from task_instances where category_id=old.id)
      or exists(select 1 from task_templates where category_id=old.id)
      or exists(select 1 from user_profiles where old.master_type='week_off' and old.value=any(week_off)) into v_referenced;
  if v_referenced then raise exception 'A referenced dropdown code cannot be changed or deleted; deactivate it instead' using errcode='23503'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists dropdown_master_identity_guard on dropdown_masters;
create trigger dropdown_master_identity_guard before update or delete on dropdown_masters for each row execute function protect_dropdown_master_identity();

-- Task priority is user-facing master data, but its three codes remain enum-backed.
insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'task_priority',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('High','high',10),('Medium','medium',20),('Low','low',30)
) as v(label,value,sort_order)
on conflict (tenant_id,master_type,value) do nothing;
