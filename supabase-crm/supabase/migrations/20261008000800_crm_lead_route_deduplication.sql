-- A master label equal to its original routing label must be returned once.
-- Keep distinct historical aliases so existing conditional answers still resolve.
create or replace function public.get_crm_lead_option_routes()
returns table(id uuid,field_id uuid,option_value text,display_order integer,triggers_field_key text)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid;
begin
 perform public.get_crm_master_options();
 select m.tenant_id into tenant from crm_private.master_members m join public.crm_sso_access_grants g on g.jewelos_user_id=m.jewelos_user_id
 where g.legacy_crm_user_id=public.current_crm_user_id() and g.active and m.active;
 return query
 with candidates as (
  select o.id,o.field_id,upper(btrim(m.label)) as option_value,o.display_order,o.triggers_field_key,0 as priority
  from public.lead_form_field_options o join public.lead_form_fields f on f.id=o.field_id
  join crm_private.master_options m on m.tenant_id=tenant and m.active
   and m.master_type='lead_'||f.field_key
   and (upper(btrim(o.option_value))=upper(btrim(m.label)) or regexp_replace(lower(o.option_value),'[^a-z0-9]','','g')=regexp_replace(lower(m.value),'[^a-z0-9]','','g'))
  union all
  select o.id,o.field_id,o.option_value,o.display_order,o.triggers_field_key,1 from public.lead_form_field_options o
 ), unique_routes as (
  select distinct on(c.field_id,upper(btrim(c.option_value))) c.*
  from candidates c
  order by c.field_id,upper(btrim(c.option_value)),c.priority,c.display_order,c.id,c.triggers_field_key nulls last
 )
 select r.id,r.field_id,r.option_value,r.display_order,r.triggers_field_key
 from unique_routes r order by r.display_order,r.field_id,r.option_value,r.id;
end $$;
-- CREATE OR REPLACE preserves the existing authenticated-only execute grant.
