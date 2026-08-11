-- Persist category metadata without changing existing option IDs or codes.
set search_path = public, extensions;

create table dropdown_master_categories (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  category_key text not null check (category_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  display_name text not null check (length(btrim(display_name)) between 2 and 120),
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_system boolean not null default false,
  is_key_locked boolean not null default false,
  created_by uuid references user_profiles(id), updated_by uuid references user_profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, category_key)
);
create index idx_dropdown_master_categories_read on dropdown_master_categories(tenant_id,is_active,sort_order);

insert into dropdown_master_categories(tenant_id,category_key,display_name,sort_order,is_system,is_key_locked)
select distinct dm.tenant_id,dm.master_type,initcap(replace(dm.master_type,'_',' ')),0,true,true
from dropdown_masters dm where dm.tenant_id is not null
on conflict (tenant_id,category_key) do nothing;
insert into dropdown_master_categories(tenant_id,category_key,display_name,sort_order,is_system,is_key_locked)
select t.id,v.key,v.name,v.sort_order,true,true from tenants t cross join (values
 ('designation','Designations',10),('week_off','Week Off Patterns',20),('resignation_reason','Resignation Reasons',30),
 ('task_category','Task Categories',40),('task_priority','Task Priorities',50),('crm_source','CRM Sources',60),
 ('client_type','Client Types',70),('potential_category','Potential Categories',80),('product_category','Product Categories',90),
 ('buy_status','Buy Statuses',100),('not_bought_reason','Not Bought Reasons',110),('communication_preference','Communication Preferences',120),('gender','Gender',130)
) v(key,name,sort_order) on conflict (tenant_id,category_key) do nothing;
insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'gender',v.label,v.value,v.sort_order,true from tenants t cross join (values
 ('Female','female',10),('Male','male',20),('Other','other',30),('Prefer not to say','prefer_not_to_say',40)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

alter table dropdown_master_categories enable row level security;
create policy dropdown_master_categories_read on dropdown_master_categories for select using (current_profile_is_active() and tenant_id=current_tenant_id());

create or replace function change_dropdown_category_with_audit(p_operation text,p_category_id uuid default null,p_key text default null,p_display_name text default null,p_description text default null,p_sort_order integer default 0,p_is_active boolean default true)
returns dropdown_master_categories language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old dropdown_master_categories; v_new dropdown_master_categories;
begin
 select * into v_actor from current_profile();
 if v_actor.id is null or v_actor.user_role<>'super_admin' or not current_profile_is_active() then raise exception 'Only super_admin can manage dropdown categories' using errcode='42501'; end if;
 if p_operation='create' then
   insert into dropdown_master_categories(tenant_id,category_key,display_name,description,sort_order,is_active,created_by,updated_by) values(v_actor.tenant_id,btrim(p_key),btrim(p_display_name),nullif(btrim(p_description),''),p_sort_order,p_is_active,v_actor.id,v_actor.id) returning * into v_new;
 elsif p_operation='update' then
   select * into v_old from dropdown_master_categories where id=p_category_id and tenant_id=v_actor.tenant_id for update; if v_old.id is null then raise exception 'Category not found' using errcode='42501'; end if;
   if v_old.is_key_locked and btrim(p_key)<>v_old.category_key then raise exception 'This category key is locked' using errcode='23514'; end if;
   update dropdown_master_categories set category_key=btrim(p_key),display_name=btrim(p_display_name),description=nullif(btrim(p_description),''),sort_order=p_sort_order,is_active=p_is_active,updated_by=v_actor.id,updated_at=now() where id=v_old.id returning * into v_new;
 else raise exception 'Unsupported category operation' using errcode='22023'; end if;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'dropdown_category_'||p_operation,'dropdown_master',v_new.id,to_jsonb(v_old),to_jsonb(v_new)); return v_new;
end $$;
revoke all on dropdown_master_categories from public,anon,authenticated;
grant select on dropdown_master_categories to authenticated;
revoke all on function change_dropdown_category_with_audit(text,uuid,text,text,text,integer,boolean) from public;
grant execute on function change_dropdown_category_with_audit(text,uuid,text,text,text,integer,boolean) to authenticated;
notify pgrst,'reload schema';
