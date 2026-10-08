-- One invoker read replaces the queue's serial browser request waterfall.
-- Existing RLS, identity bridge, branch writes, audits and outboxes remain authoritative.
-- Keep calling the existing permission helpers, but evaluate actor-constant
-- results once per statement instead of performing SSO/user lookups per row.
-- The branch helper authorizes the actor's own branch; the row still has to
-- match it. NULL/inactive actors continue to fail closed. Applies only to CRM
-- public policies, retaining every existing policy command, role and mode.
do $policies$
declare p record; expressions text[]; i integer; expression text; clause text;
begin
 perform pg_catalog.set_config('search_path','pg_catalog, public',true);
 for p in select pol.polname,c.relname,pg_get_expr(pol.polqual,pol.polrelid) as using_expr,
   pg_get_expr(pol.polwithcheck,pol.polrelid) as check_expr
   from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
 loop
   expressions := array[p.using_expr,p.check_expr]; clause := '';
   for i in 1..2 loop
     expression := expressions[i];
     if expression is null then continue; end if;
     expression := regexp_replace(expression,'is_branch_staff\(([a-z_][a-z_0-9.]*)\)',
       '((select public.is_branch_staff(public.current_user_branch_id())) AND \1 = (select public.current_user_branch_id()))','g');
     expression := regexp_replace(expression,'is_branch_manager\(([a-z_][a-z_0-9.]*)\)',
       '((select public.is_branch_manager(public.current_user_branch_id())) AND \1 = (select public.current_user_branch_id()))','g');
     -- Avoid rewriting the already schema-qualified calls introduced above.
     expression := regexp_replace(expression,'(?<![a-z_0-9.])(is_super_admin|current_user_role|current_user_branch_id|current_crm_user_id)\(\)',
       '(select public.\1())','g');
     clause := clause || case when i=1 then ' USING (' else ' WITH CHECK (' end || expression || ')';
   end loop;
   if clause <> '' then execute format('ALTER POLICY %I ON public.%I%s',p.polname,p.relname,clause); end if;
 end loop;
end $policies$;

create function public.get_walkin_queue_snapshot(p_branch_id uuid default null, p_crm_name text default null, p_completed_client_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 actor uuid := public.current_crm_user_id();
 actor_role public.user_role := public.current_user_role();
 own_branch uuid := public.current_user_branch_id();
 selected_branch uuid;
 selected_crm text;
 today date := (now() at time zone 'Asia/Kolkata')::date;
 result jsonb;
begin
 if actor is null or actor_role is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
 if actor_role = 'super_admin' then
   select id into selected_branch from public.branches where id=p_branch_id and active;
 else selected_branch := own_branch;
 end if;
 select crm_name into selected_crm from public.crm_allocation
   where branch_id=selected_branch and active and crm_name=p_crm_name order by created_at,id limit 1;
 select jsonb_build_object(
   'actor_id',actor,'profile',(select to_jsonb(p) from public.get_my_profile() p),
   'own_branch_id',own_branch,'selected_branch_id',selected_branch,'selected_crm',coalesce(selected_crm,''),
   'branches',coalesce((select jsonb_agg(to_jsonb(b) order by b.name,b.id) from (select id,name from public.branches where active) b),'[]'::jsonb),
   'allocation',coalesce((select jsonb_agg(jsonb_build_object('crm_name',a.crm_name) order by a.created_at,a.id) from public.crm_allocation a where a.branch_id=selected_branch and a.active),'[]'::jsonb),
   'availability',coalesce((select jsonb_agg(jsonb_build_object('crm_name',a.crm_name,'is_available',a.is_available)) from public.crm_daily_availability a where a.branch_id=selected_branch and a.date=today),'[]'::jsonb),
   -- Never let historical completed entries displace outstanding work at the REST row cap.
   'items',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc) from (
     select id,token,client_name,mobile,assigned_crm_name,status,created_at,client_id,branch_id,client_is_new from public.entry_queue
       where branch_id=selected_branch and status='pending' and (selected_crm is null or assigned_crm_name=selected_crm)
     union all
     (select id,token,client_name,mobile,assigned_crm_name,status,created_at,client_id,branch_id,client_is_new from public.entry_queue
       where branch_id=selected_branch and status='complete' and (selected_crm is null or assigned_crm_name=selected_crm)
       order by created_at desc,id desc limit 1000)
   ) q),'[]'::jsonb),
   'completed_client_code',(select client_code from public.clients where client_id=p_completed_client_id),
   'fields',coalesce((select jsonb_agg(to_jsonb(f) order by f.display_order,f.id) from (
      select id,field_key,label,field_type,is_mandatory,is_hidden,display_order,is_runo_synced,runo_field_name,option_source from public.lead_form_fields) f),'[]'::jsonb),
   'options',coalesce((select jsonb_agg(to_jsonb(o) order by o.display_order,o.id) from (
      select id,field_id,option_value,display_order,triggers_field_key from public.lead_form_field_options) o),'[]'::jsonb),
   'lookup_options',jsonb_build_object(
      'lookup_communities',coalesce((select jsonb_agg(label order by label) from public.lookup_communities where active),'[]'::jsonb),
      'lookup_beverages',coalesce((select jsonb_agg(label order by label) from public.lookup_beverages where active),'[]'::jsonb),
      'lookup_sugar_options','[]'::jsonb,
      'lookup_snacks',coalesce((select jsonb_agg(label order by label) from public.lookup_snacks where active),'[]'::jsonb),
      'lookup_gifts',coalesce((select jsonb_agg(label order by label) from public.lookup_gifts where active),'[]'::jsonb)
   )
 ) into result;
 return result;
end $$;
revoke all on function public.get_walkin_queue_snapshot(uuid,text,uuid) from public,anon,service_role;
grant execute on function public.get_walkin_queue_snapshot(uuid,text,uuid) to authenticated;

-- Return the committed row, rather than making the browser reload all queue context.
-- Calling the existing RPC preserves validation, audit and round-robin behavior atomically.
create function public.register_walkin_entry(p_client_name text,p_mobile text,p_branch_id uuid default null)
returns table(id uuid,token text,client_id uuid,client_code text,client_type text,client_name text,mobile text,branch_id uuid,assigned_crm_name text,status text,created_at timestamptz,client_is_new boolean)
language plpgsql security invoker set search_path='' as $$
declare saved record;
begin
 select * into saved from public.create_entry_queue(p_client_name,p_mobile,p_branch_id);
 return query select q.id,q.token::text,q.client_id,saved.client_code::text,saved.client_type::text,
   q.client_name::text,q.mobile::text,q.branch_id,q.assigned_crm_name::text,q.status::text,q.created_at,q.client_is_new
   from public.entry_queue q where q.id=saved.id;
end $$;
revoke all on function public.register_walkin_entry(text,text,uuid) from public,anon,service_role;
grant execute on function public.register_walkin_entry(text,text,uuid) to authenticated;

create index entry_queue_branch_created_id_idx on public.entry_queue(branch_id,created_at desc,id desc);
create index entry_queue_pending_branch_crm_created_idx on public.entry_queue(branch_id,assigned_crm_name,created_at desc,id desc) where status='pending';

-- Convert each row to JSON once; retain exactly the same field-level edit log.
create or replace function public.audit_client_changes() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 changed_field text;
 actor_id uuid := coalesce(auth.uid(),NEW.profile_updated_by);
 audit_source text := coalesce(nullif(current_setting('app.audit_source',true),''),'database_trigger');
 old_fields jsonb := to_jsonb(OLD);
 new_fields jsonb := to_jsonb(NEW);
begin
 for changed_field in select n.key from jsonb_each(new_fields) n
   where n.key not in ('profile_updated_at','profile_updated_by') and (old_fields->n.key) is distinct from n.value
 loop
   insert into public.client_edit_log(client_id,edited_by,source,field_name,old_value,new_value)
   values(NEW.client_id,actor_id,audit_source,changed_field,old_fields->changed_field,new_fields->changed_field);
 end loop;
 return NEW;
end $$;
notify pgrst,'reload schema';
