-- Production CRM engine: normalized contact identity, transactional walk-ins,
-- append-only history, follow-ups, private documents, integrations, and RLS.

set search_path = public, extensions;

-- --------------------------------------------------------------------------
-- Schema and canonical identity
-- --------------------------------------------------------------------------

create function normalize_indian_phone(p_value text)
returns text language plpgsql immutable set search_path=public as $$
declare v_digits text;
begin
  if p_value is null or btrim(p_value)='' or p_value ~ '[A-Za-z]' then return null; end if;
  v_digits:=regexp_replace(btrim(p_value),'[^0-9]','','g');
  if length(v_digits)=14 and left(v_digits,4)='0091' then v_digits:=substring(v_digits from 5);
  elsif length(v_digits)=12 and left(v_digits,2)='91' then v_digits:=substring(v_digits from 3);
  elsif length(v_digits)=11 and left(v_digits,1)='0' then v_digits:=substring(v_digits from 2); end if;
  if v_digits !~ '^[6-9][0-9]{9}$' then return null; end if;
  return '+91'||v_digits;
end $$;

alter table clients drop constraint if exists clients_tenant_id_phone_key;
alter table clients
  add column normalized_phone text,
  add column normalized_billing_phone text,
  add column email text,
  add column date_of_birth date,
  add column anniversary_date date,
  add column tags text[] not null default '{}',
  add column status text not null default 'active',
  add column communication_preference text,
  add column communication_consent boolean,
  add column record_version integer not null default 1,
  add column merged_into_client_id uuid references clients(id),
  add column created_by uuid references user_profiles(id),
  add column updated_by uuid references user_profiles(id),
  add constraint clients_status_check check(status in ('active','inactive','merged')),
  add constraint clients_merge_check check((status='merged')=(merged_into_client_id is not null)),
  add constraint clients_contact_check check(normalized_phone is null or normalized_phone=normalize_indian_phone(phone)),
  add constraint clients_billing_contact_check check(normalized_billing_phone is null or normalized_billing_phone=normalize_indian_phone(billing_phone)),
  add constraint clients_distinct_contact_check check(normalized_billing_phone is null or normalized_phone is distinct from normalized_billing_phone),
  add constraint clients_email_check check(email is null or (length(email)<=254 and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  add constraint clients_pincode_check check(pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  add constraint clients_version_check check(record_version>0),
  add constraint clients_name_length_check check(length(coalesce(first_name,''))<=100 and length(coalesce(last_name,''))<=100),
  add constraint clients_tags_check check(cardinality(tags)<=20);

update clients set normalized_phone=normalize_indian_phone(phone),normalized_billing_phone=normalize_indian_phone(billing_phone),status='active' where status='active';
create unique index idx_clients_tenant_active_primary_phone on clients(tenant_id,normalized_phone) where status='active' and normalized_phone is not null;
create index idx_clients_tenant_directory on clients(tenant_id,status,updated_at desc,id);
create index idx_clients_tenant_branch on clients(tenant_id,branch_id,status,updated_at desc);
create index idx_clients_tenant_assignment on clients(tenant_id,assigned_crm_id,status,updated_at desc);
create index idx_clients_tenant_email_lower on clients(tenant_id,lower(email)) where email is not null and status='active';
create index idx_clients_tenant_name_lower on clients(tenant_id,lower(first_name),lower(last_name),id) where status='active';

create table client_contact_aliases(
  id uuid primary key default uuid_generate_v4(), tenant_id uuid not null references tenants(id) on delete cascade,
  client_id uuid not null references clients(id), normalized_phone text not null,
  alias_type text not null check(alias_type in ('primary','billing','alternate','merged')),
  is_active boolean not null default true, created_by uuid references user_profiles(id), created_at timestamptz not null default now(),
  constraint client_alias_phone_check check(normalized_phone=normalize_indian_phone(normalized_phone))
);
create unique index idx_client_alias_unique_active on client_contact_aliases(tenant_id,normalized_phone) where is_active;
create index idx_client_alias_client on client_contact_aliases(tenant_id,client_id,is_active);
insert into client_contact_aliases(tenant_id,client_id,normalized_phone,alias_type)
select tenant_id,id,normalized_phone,'primary' from clients where normalized_phone is not null and status='active' on conflict do nothing;
insert into client_contact_aliases(tenant_id,client_id,normalized_phone,alias_type)
select tenant_id,id,normalized_billing_phone,'billing' from clients where normalized_billing_phone is not null and status='active' on conflict do nothing;

create table client_assignments(
  id uuid primary key default uuid_generate_v4(), tenant_id uuid not null references tenants(id) on delete cascade,
  client_id uuid not null references clients(id), user_profile_id uuid not null references user_profiles(id),
  branch_id uuid not null references branches(id), is_active boolean not null default true,
  assigned_by uuid not null references user_profiles(id), ended_by uuid references user_profiles(id),
  assigned_at timestamptz not null default now(), ended_at timestamptz,
  check((is_active and ended_at is null) or (not is_active and ended_at is not null))
);
create unique index idx_client_assignment_active on client_assignments(client_id,user_profile_id) where is_active;
create index idx_client_assignment_scope on client_assignments(tenant_id,branch_id,user_profile_id,is_active,client_id);
insert into client_assignments(tenant_id,client_id,user_profile_id,branch_id,assigned_by)
select c.tenant_id,c.id,c.assigned_crm_id,c.branch_id,coalesce(c.created_by,c.assigned_crm_id)
from clients c where c.assigned_crm_id is not null and c.branch_id is not null and c.status='active' on conflict do nothing;

alter table walkin_entries
  add column request_key uuid,
  add column product_category_ids uuid[] not null default '{}',
  add column buy_status_id uuid references dropdown_masters(id),
  add column not_bought_reason_id uuid references dropdown_masters(id),
  add column potential_category_id uuid references dropdown_masters(id),
  add column followup_id uuid,
  add column updated_at timestamptz not null default now(),
  add constraint walkin_companions_check check(companions between 0 and 50),
  add constraint walkin_product_categories_check check(cardinality(product_category_ids)<=30);
create unique index idx_walkins_tenant_request on walkin_entries(tenant_id,request_key) where request_key is not null;
create index idx_walkins_client_visit on walkin_entries(tenant_id,client_id,visit_date desc,id);
create index idx_walkins_branch_visit on walkin_entries(tenant_id,branch_id,visit_date desc,id);

alter table walkin_uploads rename column file_url to storage_path;
alter table walkin_uploads
  add column tenant_id uuid references tenants(id), add column original_filename text,
  add column mime_type text, add column size_bytes bigint, add column uploaded_by uuid references user_profiles(id),
  add column removed_at timestamptz, add column removed_by uuid references user_profiles(id);
update walkin_uploads u set tenant_id=w.tenant_id from walkin_entries w where w.id=u.walkin_entry_id;
alter table walkin_uploads alter column tenant_id set not null;
create unique index idx_walkin_upload_path on walkin_uploads(tenant_id,storage_path) where removed_at is null;

alter table client_timeline
  add column tenant_id uuid references tenants(id), add column branch_id uuid references branches(id),
  add column subject text, add column outcome text, add column occurred_at timestamptz,
  add column correction_of_id uuid references client_timeline(id), add column metadata jsonb not null default '{}';
update client_timeline t set tenant_id=c.tenant_id,branch_id=c.branch_id,occurred_at=t.created_at from clients c where c.id=t.client_id;
alter table client_timeline alter column tenant_id set not null,alter column occurred_at set not null;
alter table client_timeline add constraint client_timeline_event_check check(event_type in ('client_created','client_updated','client_reassigned','walkin','call','message','email','note','interaction_corrected','followup_created','followup_rescheduled','followup_completed','followup_cancelled','task_linked','form_linked','fms_linked','document_uploaded','clients_merged')),
 add constraint client_timeline_metadata_check check(jsonb_typeof(metadata)='object'), add constraint client_timeline_lengths_check check(length(coalesce(subject,''))<=200 and length(coalesce(outcome,''))<=4000 and length(coalesce(summary,''))<=4000);
create index idx_client_timeline_history on client_timeline(tenant_id,client_id,occurred_at desc,id desc);

alter table client_followups
  add column tenant_id uuid references tenants(id), add column branch_id uuid references branches(id),
  add column subject text, add column outcome text, add column cancel_reason text,
  add column completed_at timestamptz, add column completed_by uuid references user_profiles(id),
  add column cancelled_at timestamptz, add column cancelled_by uuid references user_profiles(id),
  add column workflow_key text, add column record_version integer not null default 1,
  add column created_by uuid references user_profiles(id), add column updated_by uuid references user_profiles(id),
  add column updated_at timestamptz not null default now();
update client_followups f set tenant_id=c.tenant_id,branch_id=c.branch_id,status=case when f.status in ('completed','cancelled') then f.status else 'open' end from clients c where c.id=f.client_id;
alter table client_followups alter column tenant_id set not null,alter column status set default 'open';
alter table client_followups add constraint client_followups_status_check check(status in ('open','completed','cancelled')),
 add constraint client_followups_terminal_check check((status='open' and completed_at is null and cancelled_at is null) or (status='completed' and completed_at is not null and cancelled_at is null) or (status='cancelled' and cancelled_at is not null and completed_at is null)),
 add constraint client_followups_lengths_check check(length(coalesce(subject,''))<=200 and length(coalesce(notes,''))<=4000 and length(coalesce(outcome,''))<=4000 and length(coalesce(cancel_reason,''))<=1000);
create unique index idx_followup_open_workflow on client_followups(tenant_id,client_id,workflow_key) where status='open' and workflow_key is not null;
create index idx_followup_assignee_due on client_followups(tenant_id,assigned_to,status,due_date,id);
create index idx_followup_branch_due on client_followups(tenant_id,branch_id,status,due_date,id);

alter table walkin_entries add constraint walkin_followup_fk foreign key(followup_id) references client_followups(id);

create table crm_documents(
  id uuid primary key default uuid_generate_v4(), tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references branches(id), client_id uuid not null references clients(id),
  parent_type text not null check(parent_type in ('client','walkin','timeline')),
  parent_id uuid not null, storage_path text not null, original_filename text not null,
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check(size_bytes between 1 and 10485760), uploaded_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(), removed_at timestamptz, removed_by uuid references user_profiles(id), removal_reason text,
  unique(tenant_id,storage_path)
);
create index idx_crm_documents_client on crm_documents(tenant_id,client_id,created_at desc) where removed_at is null;

create table crm_mutation_keys(
 tenant_id uuid not null references tenants(id) on delete cascade, actor_id uuid not null references user_profiles(id),
 operation text not null, request_key uuid not null, result_id uuid, result jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 primary key(tenant_id,actor_id,operation,request_key)
);

-- --------------------------------------------------------------------------
-- Authorization and invariants
-- --------------------------------------------------------------------------

create function assert_crm_actor()
returns user_profiles language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles;
begin
 select * into v_actor from current_profile();
 if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager','crm') then raise exception 'CRM access denied' using errcode='42501'; end if;
 return v_actor;
end $$;

create function can_read_crm_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from clients c,current_profile() actor where c.id=p_client_id and c.tenant_id=actor.tenant_id and (c.status<>'merged' or actor.user_role in ('super_admin','admin'))
   and current_profile_is_active() and actor.user_role in ('super_admin','admin','manager','crm')
   and (actor.user_role in ('super_admin','admin')
    or actor.user_role='manager' and (c.branch_id=actor.branch_id or exists(select 1 from walkin_entries w where w.client_id=c.id and w.tenant_id=c.tenant_id and w.branch_id=actor.branch_id))
    or actor.user_role='crm' and (c.branch_id=actor.branch_id or c.assigned_crm_id=actor.id or exists(select 1 from client_assignments a where a.client_id=c.id and a.user_profile_id=actor.id and a.is_active) or exists(select 1 from walkin_entries w where w.client_id=c.id and w.tenant_id=c.tenant_id and w.branch_id=actor.branch_id)))
 );
$$;

create function assert_crm_branch_user(p_user_id uuid,p_tenant_id uuid,p_branch_id uuid,p_purpose text)
returns user_profiles language plpgsql stable security definer set search_path=public as $$
declare v_user user_profiles;
begin
 select * into v_user from user_profiles where id=p_user_id and tenant_id=p_tenant_id and branch_id=p_branch_id and working_status not in ('inactive','resigned') and is_login_enabled;
 if v_user.id is null then raise exception '% user is not active and eligible for this branch',p_purpose using errcode='23503'; end if;
 if p_purpose='CRM' and v_user.user_role not in ('super_admin','admin','manager','crm') then raise exception 'Assigned CRM role is not eligible' using errcode='23514'; end if;
 if p_purpose='salesperson' and v_user.user_role not in ('super_admin','admin','manager','crm','staff') then raise exception 'Salesperson role is not eligible' using errcode='23514'; end if;
 return v_user;
end $$;

create function assert_active_crm_dropdown(p_id uuid,p_tenant uuid,p_type text,p_required boolean default false)
returns uuid language plpgsql stable security definer set search_path=public as $$ begin
 if p_id is null and not p_required then return null; end if;
 if not exists(select 1 from dropdown_masters where id=p_id and tenant_id=p_tenant and master_type=p_type and is_active) then raise exception 'Dropdown value is inactive or has the wrong type' using errcode='23503'; end if; return p_id;
end $$;

create function prevent_crm_timeline_mutation() returns trigger language plpgsql set search_path=public as $$ begin if current_user='postgres' and current_setting('app.crm_merge',true)='1' then return case when tg_op='DELETE' then old else new end; end if; raise exception 'CRM timeline is append-only; add a correction event' using errcode='55000'; end $$;
create trigger client_timeline_immutable before update or delete on client_timeline for each row execute function prevent_crm_timeline_mutation();

create function refresh_crm_client_rollups(p_client_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 update clients c set total_visits=(select count(*) from walkin_entries w where w.client_id=c.id),
  last_visit_date=(select max(w.visit_date at time zone coalesce(t.timezone,'Asia/Kolkata'))::date from walkin_entries w where w.client_id=c.id),
  next_visit_date=(select min(f.due_date) from client_followups f where f.client_id=c.id and f.status='open'),updated_at=now()
 from tenants t where c.id=p_client_id and t.id=c.tenant_id;
end $$;

create function sync_crm_contacts(p_client_id uuid,p_actor uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_client clients;
begin
 select * into v_client from clients where id=p_client_id for update;
 update client_contact_aliases set is_active=false where client_id=p_client_id and alias_type in ('primary','billing');
 if v_client.status='active' then
  if v_client.normalized_phone is null then raise exception 'A valid Indian primary phone is required' using errcode='22023'; end if;
  insert into client_contact_aliases(tenant_id,client_id,normalized_phone,alias_type,created_by) values(v_client.tenant_id,v_client.id,v_client.normalized_phone,'primary',p_actor)
   on conflict(tenant_id,normalized_phone) where is_active do update set client_id=excluded.client_id,alias_type='primary',is_active=true;
  if v_client.normalized_billing_phone is not null then insert into client_contact_aliases(tenant_id,client_id,normalized_phone,alias_type,created_by) values(v_client.tenant_id,v_client.id,v_client.normalized_billing_phone,'billing',p_actor); end if;
 end if;
end $$;

-- --------------------------------------------------------------------------
-- Narrow CRM query RPCs
-- --------------------------------------------------------------------------

create function lookup_crm_client_by_phone(p_phone text)
returns table(client_id uuid,match_kind text,record_version integer) language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_phone text;
begin
 v_actor:=assert_crm_actor(); v_phone:=normalize_indian_phone(p_phone); if v_phone is null then raise exception 'Invalid Indian phone number' using errcode='22023'; end if;
 return query select c.id,case when c.normalized_phone=v_phone then 'primary' else a.alias_type end,c.record_version
 from client_contact_aliases a join clients c on c.id=a.client_id where a.tenant_id=v_actor.tenant_id and a.normalized_phone=v_phone and a.is_active and c.status='active' and can_read_crm_client(c.id) limit 1;
end $$;

create function search_crm_clients(p_filter jsonb default '{}'::jsonb)
returns setof jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_q text:=left(btrim(coalesce(p_filter->>'query','')),100); v_phone text; v_limit int:=least(100,greatest(1,coalesce((p_filter->>'limit')::int,25)));
begin
 v_actor:=assert_crm_actor(); v_phone:=normalize_indian_phone(v_q);
 return query select jsonb_build_object('id',c.id,'first_name',c.first_name,'last_name',c.last_name,'phone',c.phone,'email',c.email,'branch_id',c.branch_id,'assigned_crm_id',c.assigned_crm_id,'client_type_id',c.client_type_id,'source_id',c.source_id,'potential_category',c.potential_category,'total_visits',c.total_visits,'last_visit_date',c.last_visit_date,'next_visit_date',c.next_visit_date,'record_version',c.record_version,'updated_at',c.updated_at,'next_cursor',c.updated_at::text||'|'||c.id::text)
 from clients c where c.tenant_id=v_actor.tenant_id and c.status='active' and can_read_crm_client(c.id)
 and (v_q='' or (v_phone is not null and exists(select 1 from client_contact_aliases a where a.client_id=c.id and a.is_active and a.normalized_phone=v_phone)) or lower(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')) like '%'||lower(v_q)||'%' or lower(coalesce(c.email,''))=lower(v_q))
 and (nullif(p_filter->>'branch_id','') is null or c.branch_id=(p_filter->>'branch_id')::uuid)
 and (nullif(p_filter->>'assigned_crm_id','') is null or c.assigned_crm_id=(p_filter->>'assigned_crm_id')::uuid)
 and (nullif(p_filter->>'client_type_id','') is null or c.client_type_id=(p_filter->>'client_type_id')::uuid)
 and (nullif(p_filter->>'source_id','') is null or c.source_id=(p_filter->>'source_id')::uuid)
 and (nullif(p_filter->>'potential_category','') is null or c.potential_category=p_filter->>'potential_category')
 and (nullif(p_filter->>'followup_status','') is null or exists(select 1 from client_followups f where f.client_id=c.id and case p_filter->>'followup_status' when 'open' then f.status='open' when 'completed' then f.status='completed' when 'overdue' then f.status='open' and f.due_date<(now() at time zone (select timezone from tenants where id=c.tenant_id))::date when 'today' then f.status='open' and f.due_date=(now() at time zone (select timezone from tenants where id=c.tenant_id))::date else false end))
 and (nullif(p_filter->>'cursor','') is null or (c.updated_at,c.id)<(split_part(p_filter->>'cursor','|',1)::timestamptz,split_part(p_filter->>'cursor','|',2)::uuid))
 order by c.updated_at desc,c.id desc limit v_limit;
end $$;

create function get_crm_client_detail(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
 perform assert_crm_actor(); if not can_read_crm_client(p_client_id) then raise exception 'Client not found' using errcode='42501'; end if;
 select jsonb_build_object('client',to_jsonb(c)-'normalized_phone'-'normalized_billing_phone',
  'timeline',coalesce((select jsonb_agg(to_jsonb(t) order by t.occurred_at desc,t.id desc) from client_timeline t where t.client_id=c.id),'[]'),
  'walkins',coalesce((select jsonb_agg(to_jsonb(w) order by w.visit_date desc,w.id desc) from walkin_entries w where w.client_id=c.id and (current_role_level() in ('super_admin','admin') or w.branch_id=current_branch_id())),'[]'),
  'followups',coalesce((select jsonb_agg(to_jsonb(f) order by f.due_date desc,f.id desc) from client_followups f where f.client_id=c.id),'[]'),
  'documents',coalesce((select jsonb_agg((to_jsonb(d)-'storage_path') order by d.created_at desc) from crm_documents d where d.client_id=c.id and d.removed_at is null),'[]'),
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',ti.id,'title',ti.title,'status',ti.status,'planned_datetime',ti.planned_datetime)) from task_instances ti where ti.tenant_id=c.tenant_id and ti.source_ref_id=c.id and ti.source='crm'),'[]'),
  'forms',coalesce((select jsonb_agg(jsonb_build_object('id',fs.id,'form_template_id',fs.form_template_id,'status',fs.status,'submitted_at',fs.submitted_at)) from form_submissions fs where fs.linked_module='crm_client' and fs.linked_record_id=c.id),'[]'),
  'fms',coalesce((select jsonb_agg(jsonb_build_object('id',fi.id,'title',fi.title,'status',fi.status,'reference_number',fi.reference_number)) from fms_instances fi where fi.tenant_id=c.tenant_id and fi.context->>'client_id'=c.id::text),'[]')) into v_result from clients c where c.id=p_client_id;
 return v_result;
end $$;

create function list_crm_followups(p_filter jsonb default '{}'::jsonb)
returns setof jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_limit int:=least(100,greatest(1,coalesce((p_filter->>'limit')::int,50))); v_today date;
begin
 v_actor:=assert_crm_actor(); select (now() at time zone coalesce(timezone,'Asia/Kolkata'))::date into v_today from tenants where id=v_actor.tenant_id;
 return query select jsonb_build_object('id',f.id,'client_id',f.client_id,'assigned_to',f.assigned_to,'branch_id',f.branch_id,'due_date',f.due_date,'status',f.status,'subject',f.subject,'outcome',f.outcome,'cancel_reason',f.cancel_reason,'record_version',f.record_version,'updated_at',f.updated_at,'client_display',btrim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),'bucket',case when f.status='completed' then 'completed' when f.status='cancelled' then 'cancelled' when f.due_date<v_today then 'overdue' when f.due_date=v_today then 'today' else 'upcoming' end,'next_cursor',f.due_date::text||'|'||f.id::text)
 from client_followups f join clients c on c.id=f.client_id where f.tenant_id=v_actor.tenant_id and can_read_crm_client(f.client_id)
 and (nullif(p_filter->>'assigned_to','') is null or f.assigned_to=(p_filter->>'assigned_to')::uuid)
 and (nullif(p_filter->>'branch_id','') is null or f.branch_id=(p_filter->>'branch_id')::uuid)
 and (nullif(p_filter->>'bucket','') is null or case p_filter->>'bucket' when 'today' then f.status='open' and f.due_date=v_today when 'overdue' then f.status='open' and f.due_date<v_today when 'upcoming' then f.status='open' and f.due_date>v_today when 'completed' then f.status='completed' else true end)
 and (nullif(p_filter->>'cursor','') is null or (f.due_date,f.id)>(split_part(p_filter->>'cursor','|',1)::date,split_part(p_filter->>'cursor','|',2)::uuid))
 order by f.due_date,f.id limit v_limit;
end $$;

-- --------------------------------------------------------------------------
-- Audited mutation RPCs
-- --------------------------------------------------------------------------

create function create_crm_client(p_input jsonb,p_request_key uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_id uuid; v_phone text; v_billing text; v_branch uuid; v_assigned uuid; v_existing uuid;
begin
 v_actor:=assert_crm_actor(); if p_request_key is null or jsonb_typeof(p_input)<>'object' then raise exception 'A request key and client object are required' using errcode='22023'; end if;
 select result_id into v_existing from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='create_client' and request_key=p_request_key; if v_existing is not null then return v_existing; end if;
 v_phone:=normalize_indian_phone(p_input->>'primary_phone'); v_billing:=normalize_indian_phone(p_input->>'billing_phone'); if v_phone is null or nullif(btrim(p_input->>'first_name'),'') is null then raise exception 'Valid first name and Indian primary phone are required' using errcode='22023'; end if;
 if p_input ? 'billing_phone' and nullif(p_input->>'billing_phone','') is not null and v_billing is null or v_billing=v_phone then raise exception 'Billing phone is invalid or duplicates the primary phone' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_phone,0));
 if exists(select 1 from client_contact_aliases where tenant_id=v_actor.tenant_id and normalized_phone in (v_phone,v_billing) and is_active) then raise exception 'An active client already uses this contact' using errcode='23505'; end if;
 v_branch:=coalesce(nullif(p_input->>'branch_id','')::uuid,v_actor.branch_id); if not exists(select 1 from branches where id=v_branch and tenant_id=v_actor.tenant_id and is_active) or v_actor.user_role in ('manager','crm') and v_branch<>v_actor.branch_id then raise exception 'Branch is outside CRM scope' using errcode='42501'; end if;
 v_assigned:=nullif(p_input->>'assigned_crm_id','')::uuid; if v_assigned is not null then perform assert_crm_branch_user(v_assigned,v_actor.tenant_id,v_branch,'CRM'); end if;
 perform assert_active_crm_dropdown(nullif(p_input->>'source_id','')::uuid,v_actor.tenant_id,'crm_source',false); perform assert_active_crm_dropdown(nullif(p_input->>'client_type_id','')::uuid,v_actor.tenant_id,'client_type',false);
 insert into clients(tenant_id,branch_id,phone,normalized_phone,billing_phone,normalized_billing_phone,first_name,last_name,email,gender,date_of_birth,anniversary_date,address,city,state,pincode,source_id,client_type_id,potential_category,tags,assigned_crm_id,status,communication_preference,communication_consent,created_by,updated_by)
 values(v_actor.tenant_id,v_branch,btrim(p_input->>'primary_phone'),v_phone,nullif(btrim(p_input->>'billing_phone'),''),v_billing,btrim(p_input->>'first_name'),nullif(btrim(p_input->>'last_name'),''),nullif(lower(btrim(p_input->>'email')),''),nullif(btrim(p_input->>'gender'),''),nullif(p_input->>'date_of_birth','')::date,nullif(p_input->>'anniversary_date','')::date,nullif(btrim(p_input->>'address'),''),nullif(btrim(p_input->>'city'),''),nullif(btrim(p_input->>'state'),''),nullif(btrim(p_input->>'pincode'),''),nullif(p_input->>'source_id','')::uuid,nullif(p_input->>'client_type_id','')::uuid,nullif(btrim(p_input->>'potential_category'),''),coalesce(array(select distinct left(lower(btrim(value)),50) from jsonb_array_elements_text(coalesce(p_input->'tags','[]')) limit 20),'{}'),v_assigned,'active',nullif(btrim(p_input->>'communication_preference'),''),case when p_input ? 'communication_consent' then (p_input->>'communication_consent')::boolean end,v_actor.id,v_actor.id) returning id into v_id;
 perform sync_crm_contacts(v_id,v_actor.id); if v_assigned is not null then insert into client_assignments(tenant_id,client_id,user_profile_id,branch_id,assigned_by) values(v_actor.tenant_id,v_id,v_assigned,v_branch,v_actor.id); end if;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,subject,summary,created_by,occurred_at,metadata) values(v_actor.tenant_id,v_branch,v_id,'client_created','Client created','Client profile created',v_actor.id,now(),jsonb_build_object('source','crm'));
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_client_created','clients',v_id,jsonb_build_object('branch_id',v_branch,'assigned_crm_id',v_assigned,'field_count',(select count(*) from jsonb_object_keys(p_input))));
 insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'create_client',p_request_key,v_id,jsonb_build_object('id',v_id));
 perform enqueue_notification_event(v_actor.tenant_id,v_branch,null,'client_created','crm',v_id,v_actor.id,jsonb_build_object('_assigned_user_ids',case when v_assigned is null then '[]'::jsonb else jsonb_build_array(v_assigned) end,'_link_url','/crm?client='||v_id),'client_created:'||v_id,now()); return v_id;
end $$;

create function update_crm_client(p_client_id uuid,p_changes jsonb,p_expected_version integer,p_request_key uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old clients; v_phone text; v_billing text; v_version int; v_fields text[]; v_replay jsonb;
begin
 v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'update_client'||p_request_key::text,0)); select result into v_replay from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='update_client' and request_key=p_request_key; if v_replay is not null then return (v_replay->>'version')::int; end if; select * into v_old from clients where id=p_client_id for update; if v_old.id is null or not can_read_crm_client(v_old.id) or v_old.status<>'active' then raise exception 'Client not found' using errcode='42501'; end if;
 if v_actor.user_role='crm' and v_old.assigned_crm_id<>v_actor.id then raise exception 'Assigned CRM ownership is required to edit this client' using errcode='42501'; end if;
 if v_old.record_version<>p_expected_version then raise exception 'Client changed since it was opened' using errcode='40001'; end if;
 v_phone:=case when p_changes ? 'primary_phone' then normalize_indian_phone(p_changes->>'primary_phone') else v_old.normalized_phone end; v_billing:=case when p_changes ? 'billing_phone' then normalize_indian_phone(p_changes->>'billing_phone') else v_old.normalized_billing_phone end;
 if v_phone is null or v_phone=v_billing then raise exception 'Client contacts are invalid' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_phone,0));
 if exists(select 1 from client_contact_aliases where tenant_id=v_actor.tenant_id and normalized_phone in (v_phone,v_billing) and is_active and client_id<>p_client_id) then raise exception 'Another active client already uses this contact' using errcode='23505'; end if;
 if p_changes ? 'source_id' then perform assert_active_crm_dropdown(nullif(p_changes->>'source_id','')::uuid,v_actor.tenant_id,'crm_source',false); end if; if p_changes ? 'client_type_id' then perform assert_active_crm_dropdown(nullif(p_changes->>'client_type_id','')::uuid,v_actor.tenant_id,'client_type',false); end if;
 if p_changes ? 'status' and ((p_changes->>'status') not in ('active','inactive') or v_actor.user_role='crm' and (p_changes->>'status')<>v_old.status) then raise exception 'Client status change is not permitted' using errcode='42501'; end if;
 update clients set phone=case when p_changes?'primary_phone' then btrim(p_changes->>'primary_phone') else phone end,normalized_phone=v_phone,billing_phone=case when p_changes?'billing_phone' then nullif(btrim(p_changes->>'billing_phone'),'') else billing_phone end,normalized_billing_phone=v_billing,
 first_name=case when p_changes?'first_name' then btrim(p_changes->>'first_name') else first_name end,last_name=case when p_changes?'last_name' then nullif(btrim(p_changes->>'last_name'),'') else last_name end,email=case when p_changes?'email' then nullif(lower(btrim(p_changes->>'email')),'') else email end,
 gender=case when p_changes?'gender' then nullif(btrim(p_changes->>'gender'),'') else gender end,date_of_birth=case when p_changes?'date_of_birth' then nullif(p_changes->>'date_of_birth','')::date else date_of_birth end,anniversary_date=case when p_changes?'anniversary_date' then nullif(p_changes->>'anniversary_date','')::date else anniversary_date end,
 address=case when p_changes?'address' then nullif(btrim(p_changes->>'address'),'') else address end,city=case when p_changes?'city' then nullif(btrim(p_changes->>'city'),'') else city end,state=case when p_changes?'state' then nullif(btrim(p_changes->>'state'),'') else state end,pincode=case when p_changes?'pincode' then nullif(btrim(p_changes->>'pincode'),'') else pincode end,
 source_id=case when p_changes?'source_id' then nullif(p_changes->>'source_id','')::uuid else source_id end,client_type_id=case when p_changes?'client_type_id' then nullif(p_changes->>'client_type_id','')::uuid else client_type_id end,potential_category=case when p_changes?'potential_category' then nullif(btrim(p_changes->>'potential_category'),'') else potential_category end,
 tags=case when p_changes?'tags' then coalesce(array(select distinct left(lower(btrim(value)),50) from jsonb_array_elements_text(p_changes->'tags') limit 20),'{}') else tags end,status=case when p_changes?'status' then (p_changes->>'status') else status end,communication_preference=case when p_changes?'communication_preference' then nullif(btrim(p_changes->>'communication_preference'),'') else communication_preference end,communication_consent=case when p_changes?'communication_consent' then (p_changes->>'communication_consent')::boolean else communication_consent end,
 record_version=record_version+1,updated_by=v_actor.id,updated_at=now() where id=p_client_id returning record_version into v_version;
 perform sync_crm_contacts(p_client_id,v_actor.id); select array_agg(key order by key) into v_fields from jsonb_object_keys(p_changes) key;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,subject,summary,created_by,occurred_at,metadata) values(v_actor.tenant_id,v_old.branch_id,p_client_id,'client_updated','Client updated','Profile fields updated',v_actor.id,now(),jsonb_build_object('changed_fields',to_jsonb(v_fields)));
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'crm_client_updated','clients',p_client_id,jsonb_build_object('record_version',p_expected_version),jsonb_build_object('record_version',v_version,'changed_fields',to_jsonb(v_fields))); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'update_client',p_request_key,p_client_id,jsonb_build_object('version',v_version)); return v_version;
end $$;

create function reassign_crm_client(p_client_id uuid,p_assigned_crm_id uuid,p_branch_id uuid,p_expected_version integer,p_request_key uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_client clients; v_version int; v_replay jsonb;
begin
 v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'reassign_client'||p_request_key::text,0)); select result into v_replay from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='reassign_client' and request_key=p_request_key; if v_replay is not null then return (v_replay->>'version')::int; end if; select * into v_client from clients where id=p_client_id for update; if v_client.id is null or v_client.tenant_id<>v_actor.tenant_id or v_client.record_version<>p_expected_version then raise exception 'Client not found or stale' using errcode='40001'; end if;
 if v_actor.user_role='crm' or v_actor.user_role='manager' and (v_client.branch_id<>v_actor.branch_id or p_branch_id<>v_actor.branch_id) then raise exception 'Reassignment is outside role scope' using errcode='42501'; end if;
 if not exists(select 1 from branches where id=p_branch_id and tenant_id=v_actor.tenant_id and is_active) then raise exception 'Branch is invalid' using errcode='23503'; end if; perform assert_crm_branch_user(p_assigned_crm_id,v_actor.tenant_id,p_branch_id,'CRM');
 update client_assignments set is_active=false,ended_at=now(),ended_by=v_actor.id where client_id=p_client_id and is_active;
 insert into client_assignments(tenant_id,client_id,user_profile_id,branch_id,assigned_by) values(v_actor.tenant_id,p_client_id,p_assigned_crm_id,p_branch_id,v_actor.id);
 update clients set branch_id=p_branch_id,assigned_crm_id=p_assigned_crm_id,record_version=record_version+1,updated_by=v_actor.id,updated_at=now() where id=p_client_id returning record_version into v_version;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,subject,summary,created_by,occurred_at,metadata) values(v_actor.tenant_id,p_branch_id,p_client_id,'client_reassigned','Client reassigned','CRM ownership changed',v_actor.id,now(),jsonb_build_object('previous_branch_id',v_client.branch_id,'branch_id',p_branch_id,'previous_assignee_id',v_client.assigned_crm_id,'assigned_crm_id',p_assigned_crm_id));
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'crm_client_reassigned','clients',p_client_id,jsonb_build_object('branch_id',v_client.branch_id,'assigned_crm_id',v_client.assigned_crm_id),jsonb_build_object('branch_id',p_branch_id,'assigned_crm_id',p_assigned_crm_id,'record_version',v_version));
 perform enqueue_notification_event(v_actor.tenant_id,p_branch_id,null,'client_reassigned','crm',p_client_id,v_actor.id,jsonb_build_object('_assigned_user_ids',jsonb_build_array(p_assigned_crm_id),'_link_url','/crm?client='||p_client_id),'client_reassigned:'||p_client_id||':'||v_version,now()); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'reassign_client',p_request_key,p_client_id,jsonb_build_object('version',v_version)); return v_version;
end $$;

create function log_crm_interaction(p_client_id uuid,p_input jsonb,p_request_key uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_client clients; v_id uuid; v_type text:=p_input->>'type'; v_follow uuid;
begin
 v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'log_interaction'||p_request_key::text,0)); select result_id into v_id from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='log_interaction' and request_key=p_request_key; if v_id is not null then return v_id; end if; select * into v_client from clients where id=p_client_id; if v_client.id is null or not can_read_crm_client(p_client_id) then raise exception 'Client not found' using errcode='42501'; end if;
 if v_type not in ('call','message','email','note') or nullif(btrim(p_input->>'subject'),'') is null then raise exception 'Interaction type and subject are required' using errcode='22023'; end if;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,subject,outcome,summary,created_by,occurred_at,metadata) values(v_actor.tenant_id,coalesce(nullif(p_input->>'branch_id','')::uuid,v_actor.branch_id),p_client_id,v_type,btrim(p_input->>'subject'),nullif(btrim(p_input->>'outcome'),''),'Interaction logged',v_actor.id,coalesce(nullif(p_input->>'occurred_at','')::timestamptz,now()),jsonb_build_object('source_module',coalesce(nullif(p_input->>'source_module',''),'crm'),'source_record_id',nullif(p_input->>'source_record_id',''))) returning id into v_id;
 if nullif(p_input->>'followup_due_date','') is not null then v_follow:=create_crm_followup(p_client_id,jsonb_build_object('assigned_to',coalesce(nullif(p_input->>'followup_assigned_to',''),v_actor.id::text),'due_date',p_input->>'followup_due_date','subject',coalesce(nullif(p_input->>'followup_subject',''),'Interaction follow-up'),'workflow_key','interaction:'||v_id),extensions.uuid_generate_v4()); end if;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_interaction_logged','client_timeline',v_id,jsonb_build_object('client_id',p_client_id,'event_type',v_type,'followup_id',v_follow)); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'log_interaction',p_request_key,v_id,jsonb_build_object('id',v_id)); return v_id;
end $$;

create function correct_crm_interaction(p_interaction_id uuid,p_correction jsonb,p_request_key uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_original client_timeline; v_id uuid;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'correct_interaction'||p_request_key::text,0)); select result_id into v_id from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='correct_interaction' and request_key=p_request_key; if v_id is not null then return v_id; end if; select * into v_original from client_timeline where id=p_interaction_id; if v_original.id is null or not can_read_crm_client(v_original.client_id) or v_original.event_type not in ('call','message','email','note') then raise exception 'Interaction not found' using errcode='42501'; end if; if nullif(btrim(p_correction->>'reason'),'') is null then raise exception 'Correction reason is required' using errcode='22023'; end if;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,subject,outcome,summary,created_by,occurred_at,correction_of_id,metadata) values(v_original.tenant_id,v_original.branch_id,v_original.client_id,'interaction_corrected',coalesce(nullif(btrim(p_correction->>'subject'),''),'Interaction correction'),nullif(btrim(p_correction->>'outcome'),''),'Correction appended',v_actor.id,now(),v_original.id,jsonb_build_object('reason',left(btrim(p_correction->>'reason'),1000))) returning id into v_id;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_interaction_corrected','client_timeline',v_id,jsonb_build_object('original_event_id',v_original.id,'client_id',v_original.client_id)); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'correct_interaction',p_request_key,v_id,jsonb_build_object('id',v_id)); return v_id; end $$;

create function create_crm_followup(p_client_id uuid,p_input jsonb,p_request_key uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_client clients; v_id uuid; v_assigned uuid; v_existing uuid; v_key text;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'create_followup'||p_request_key::text,0)); select result_id into v_existing from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='create_followup' and request_key=p_request_key; if v_existing is not null then return v_existing; end if; select * into v_client from clients where id=p_client_id; if v_client.id is null or not can_read_crm_client(p_client_id) then raise exception 'Client not found' using errcode='42501'; end if; v_assigned:=coalesce(nullif(p_input->>'assigned_to','')::uuid,v_actor.id); perform assert_crm_branch_user(v_assigned,v_actor.tenant_id,coalesce(v_client.branch_id,v_actor.branch_id),'CRM'); v_key:=nullif(left(btrim(p_input->>'workflow_key'),200),'');
 if v_key is not null then select id into v_existing from client_followups where tenant_id=v_actor.tenant_id and client_id=p_client_id and workflow_key=v_key and status='open' for update; if v_existing is not null then update client_followups set due_date=(p_input->>'due_date')::date,assigned_to=v_assigned,subject=coalesce(nullif(btrim(p_input->>'subject'),''),subject),updated_by=v_actor.id,updated_at=now(),record_version=record_version+1 where id=v_existing; insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'create_followup',p_request_key,v_existing,jsonb_build_object('id',v_existing,'workflow_updated',true)); return v_existing; end if; end if;
 insert into client_followups(tenant_id,branch_id,client_id,assigned_to,due_date,status,subject,notes,workflow_key,created_by,updated_by) values(v_actor.tenant_id,coalesce(v_client.branch_id,v_actor.branch_id),p_client_id,v_assigned,(p_input->>'due_date')::date,'open',nullif(btrim(p_input->>'subject'),''),nullif(btrim(p_input->>'notes'),''),v_key,v_actor.id,v_actor.id) returning id into v_id;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,ref_id,subject,summary,created_by,occurred_at,metadata) values(v_actor.tenant_id,coalesce(v_client.branch_id,v_actor.branch_id),p_client_id,'followup_created',v_id,'Follow-up created','Follow-up scheduled',v_actor.id,now(),jsonb_build_object('due_date',p_input->>'due_date','assigned_to',v_assigned)); perform refresh_crm_client_rollups(p_client_id);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_followup_created','client_followups',v_id,jsonb_build_object('client_id',p_client_id,'due_date',p_input->>'due_date','assigned_to',v_assigned)); perform enqueue_notification_event(v_actor.tenant_id,coalesce(v_client.branch_id,v_actor.branch_id),null,'followup_created','crm',v_id,v_actor.id,jsonb_build_object('_assigned_user_ids',jsonb_build_array(v_assigned),'due_date',p_input->>'due_date','_link_url','/crm?client='||p_client_id),'followup_created:'||v_id,now()); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'create_followup',p_request_key,v_id,jsonb_build_object('id',v_id)); return v_id; end $$;

create function reschedule_crm_followup(p_followup_id uuid,p_due_date date,p_assigned_to uuid,p_reason text,p_expected_version integer,p_request_key uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_f client_followups; v_version int; v_replay jsonb;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'reschedule_followup'||p_request_key::text,0)); select result into v_replay from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='reschedule_followup' and request_key=p_request_key; if v_replay is not null then return (v_replay->>'version')::int; end if; select * into v_f from client_followups where id=p_followup_id for update; if v_f.id is null or v_f.status<>'open' or v_f.record_version<>p_expected_version or not can_read_crm_client(v_f.client_id) then raise exception 'Open follow-up not found or stale' using errcode='40001'; end if; if nullif(btrim(p_reason),'') is null then raise exception 'Reschedule reason is required' using errcode='22023'; end if; perform assert_crm_branch_user(coalesce(p_assigned_to,v_f.assigned_to),v_actor.tenant_id,v_f.branch_id,'CRM');
 update client_followups set due_date=p_due_date,assigned_to=coalesce(p_assigned_to,assigned_to),record_version=record_version+1,updated_by=v_actor.id,updated_at=now() where id=p_followup_id returning record_version into v_version;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,ref_id,subject,summary,created_by,occurred_at,metadata) values(v_f.tenant_id,v_f.branch_id,v_f.client_id,'followup_rescheduled',v_f.id,'Follow-up rescheduled','Follow-up date changed',v_actor.id,now(),jsonb_build_object('previous_due_date',v_f.due_date,'due_date',p_due_date,'reason',left(btrim(p_reason),1000),'assigned_to',coalesce(p_assigned_to,v_f.assigned_to))); perform refresh_crm_client_rollups(v_f.client_id);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'crm_followup_rescheduled','client_followups',v_f.id,jsonb_build_object('due_date',v_f.due_date,'assigned_to',v_f.assigned_to,'record_version',p_expected_version),jsonb_build_object('due_date',p_due_date,'assigned_to',coalesce(p_assigned_to,v_f.assigned_to),'record_version',v_version)); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'reschedule_followup',p_request_key,v_f.id,jsonb_build_object('version',v_version)); return v_version; end $$;

create function complete_crm_followup(p_followup_id uuid,p_outcome text,p_expected_version integer,p_request_key uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_f client_followups; v_version int; v_replay jsonb;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'complete_followup'||p_request_key::text,0)); select result into v_replay from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='complete_followup' and request_key=p_request_key; if v_replay is not null then return (v_replay->>'version')::int; end if; select * into v_f from client_followups where id=p_followup_id for update; if v_f.id is null or v_f.status<>'open' or v_f.record_version<>p_expected_version or not can_read_crm_client(v_f.client_id) then raise exception 'Open follow-up not found or stale' using errcode='40001'; end if; if nullif(btrim(p_outcome),'') is null then raise exception 'Completion outcome is required' using errcode='22023'; end if;
 update client_followups set status='completed',outcome=btrim(p_outcome),completed_at=now(),completed_by=v_actor.id,record_version=record_version+1,updated_by=v_actor.id,updated_at=now() where id=p_followup_id returning record_version into v_version;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,ref_id,subject,summary,created_by,occurred_at,metadata) values(v_f.tenant_id,v_f.branch_id,v_f.client_id,'followup_completed',v_f.id,'Follow-up completed','Follow-up outcome recorded',v_actor.id,now(),jsonb_build_object('assigned_to',v_f.assigned_to)); perform refresh_crm_client_rollups(v_f.client_id); insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_followup_completed','client_followups',v_f.id,jsonb_build_object('client_id',v_f.client_id,'record_version',v_version)); perform enqueue_notification_event(v_f.tenant_id,v_f.branch_id,null,'followup_completed','crm',v_f.id,v_actor.id,jsonb_build_object('_assigned_user_ids',jsonb_build_array(v_f.assigned_to),'_link_url','/crm?client='||v_f.client_id),'followup_completed:'||v_f.id,now()); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'complete_followup',p_request_key,v_f.id,jsonb_build_object('version',v_version)); return v_version; end $$;

create function cancel_crm_followup(p_followup_id uuid,p_reason text,p_expected_version integer,p_request_key uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_f client_followups; v_version int; v_replay jsonb;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'cancel_followup'||p_request_key::text,0)); select result into v_replay from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='cancel_followup' and request_key=p_request_key; if v_replay is not null then return (v_replay->>'version')::int; end if; select * into v_f from client_followups where id=p_followup_id for update; if v_f.id is null or v_f.status<>'open' or v_f.record_version<>p_expected_version or not can_read_crm_client(v_f.client_id) then raise exception 'Open follow-up not found or stale' using errcode='40001'; end if; if nullif(btrim(p_reason),'') is null then raise exception 'Cancellation reason is required' using errcode='22023'; end if;
 update client_followups set status='cancelled',cancel_reason=btrim(p_reason),cancelled_at=now(),cancelled_by=v_actor.id,record_version=record_version+1,updated_by=v_actor.id,updated_at=now() where id=p_followup_id returning record_version into v_version; insert into client_timeline(tenant_id,branch_id,client_id,event_type,ref_id,subject,summary,created_by,occurred_at,metadata) values(v_f.tenant_id,v_f.branch_id,v_f.client_id,'followup_cancelled',v_f.id,'Follow-up cancelled','Follow-up cancellation recorded',v_actor.id,now(),jsonb_build_object('assigned_to',v_f.assigned_to)); perform refresh_crm_client_rollups(v_f.client_id); insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_followup_cancelled','client_followups',v_f.id,jsonb_build_object('client_id',v_f.client_id,'record_version',v_version)); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'cancel_followup',p_request_key,v_f.id,jsonb_build_object('version',v_version)); return v_version; end $$;

create function record_crm_walkin(p_input jsonb,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_phone text; v_client clients; v_walkin uuid; v_follow uuid; v_branch uuid; v_crm uuid; v_sales uuid; v_visit timestamptz; v_status text; v_not_reason uuid; v_timezone text; v_existing uuid; v_category uuid;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Walk-in request key is required' using errcode='22023'; end if; select id into v_existing from walkin_entries where tenant_id=v_actor.tenant_id and request_key=p_request_key; if v_existing is not null then return jsonb_build_object('walkin_id',v_existing,'replayed',true); end if;
 v_phone:=normalize_indian_phone(p_input->>'phone'); if v_phone is null then raise exception 'A valid Indian phone is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_phone,0));
 v_branch:=coalesce(nullif(p_input->>'branch_id','')::uuid,v_actor.branch_id); if not exists(select 1 from branches where id=v_branch and tenant_id=v_actor.tenant_id and is_active) or v_actor.user_role in ('manager','crm') and v_branch<>v_actor.branch_id then raise exception 'Walk-in branch is outside role scope' using errcode='42501'; end if; select timezone into v_timezone from tenants where id=v_actor.tenant_id;
 v_crm:=coalesce(nullif(p_input->>'assigned_crm_id','')::uuid,v_actor.id); v_sales:=nullif(p_input->>'salesperson_id','')::uuid; perform assert_crm_branch_user(v_crm,v_actor.tenant_id,v_branch,'CRM'); if v_sales is not null then perform assert_crm_branch_user(v_sales,v_actor.tenant_id,v_branch,'salesperson'); end if;
 select c.* into v_client from client_contact_aliases a join clients c on c.id=a.client_id where a.tenant_id=v_actor.tenant_id and a.normalized_phone=v_phone and a.is_active and c.status='active' for update of c limit 1;
 if v_client.id is null then
  if nullif(btrim(p_input->>'first_name'),'') is null then raise exception 'First name is required for a new client' using errcode='22023'; end if;
  insert into clients(tenant_id,branch_id,phone,normalized_phone,first_name,last_name,email,source_id,client_type_id,potential_category,assigned_crm_id,created_by,updated_by) values(v_actor.tenant_id,v_branch,btrim(p_input->>'phone'),v_phone,btrim(p_input->>'first_name'),nullif(btrim(p_input->>'last_name'),''),nullif(lower(btrim(p_input->>'email')),''),nullif(p_input->>'source_id','')::uuid,nullif(p_input->>'client_type_id','')::uuid,nullif(btrim(p_input->>'potential_category'),''),v_crm,v_actor.id,v_actor.id) returning * into v_client; perform sync_crm_contacts(v_client.id,v_actor.id); insert into client_assignments(tenant_id,client_id,user_profile_id,branch_id,assigned_by) values(v_actor.tenant_id,v_client.id,v_crm,v_branch,v_actor.id);
  insert into client_timeline(tenant_id,branch_id,client_id,event_type,subject,summary,created_by,occurred_at,metadata) values(v_actor.tenant_id,v_branch,v_client.id,'client_created','Client created','Client created during walk-in',v_actor.id,now(),jsonb_build_object('source','walkin'));
 else
  if p_input ? 'first_name' and nullif(btrim(p_input->>'first_name'),'') is not null or p_input ? 'last_name' or p_input ? 'email' then update clients set first_name=case when nullif(btrim(p_input->>'first_name'),'') is not null then btrim(p_input->>'first_name') else first_name end,last_name=case when p_input?'last_name' then nullif(btrim(p_input->>'last_name'),'') else last_name end,email=case when p_input?'email' then nullif(lower(btrim(p_input->>'email')),'') else email end,record_version=record_version+1,updated_by=v_actor.id,updated_at=now() where id=v_client.id; end if;
 end if;
 perform assert_active_crm_dropdown(nullif(p_input->>'source_id','')::uuid,v_actor.tenant_id,'crm_source',false); perform assert_active_crm_dropdown(nullif(p_input->>'client_type_id','')::uuid,v_actor.tenant_id,'client_type',false); perform assert_active_crm_dropdown(nullif(p_input->>'buy_status_id','')::uuid,v_actor.tenant_id,'buy_status',false); v_not_reason:=nullif(p_input->>'not_bought_reason_id','')::uuid; if v_not_reason is not null then perform assert_active_crm_dropdown(v_not_reason,v_actor.tenant_id,'not_bought_reason',true); end if; perform assert_active_crm_dropdown(nullif(p_input->>'potential_category_id','')::uuid,v_actor.tenant_id,'potential_category',false); for v_category in select value::uuid from jsonb_array_elements_text(coalesce(p_input->'product_category_ids','[]')) loop perform assert_active_crm_dropdown(v_category,v_actor.tenant_id,'product_category',true); end loop;
 v_status:=lower(coalesce(p_input->>'buy_status','')); if coalesce((p_input->>'product_bought')::boolean,false)=false and v_status in ('not_bought','lost','no') and v_not_reason is null then raise exception 'Not-bought reason is required for this outcome' using errcode='23514'; end if; if v_status in ('follow_up','considering','not_bought') and nullif(p_input->>'followup_due_date','') is null then raise exception 'Follow-up date is required for this outcome' using errcode='23514'; end if;
 v_visit:=case when nullif(p_input->>'visit_at','') is not null then (p_input->>'visit_at')::timestamptz when nullif(p_input->>'visit_local','') is not null then (p_input->>'visit_local')::timestamp at time zone coalesce(v_timezone,'Asia/Kolkata') else now() end;
 insert into walkin_entries(tenant_id,branch_id,client_id,crm_id,salesperson_id,visit_date,client_type_id,product_categories,product_category_ids,product_bought,buy_status,buy_status_id,not_bought_reason,not_bought_reason_id,product_requirement,next_visit_date,potential_category,potential_category_id,remark,instagram_asked,google_review_asked,referral_asked,companions,created_by,request_key)
 values(v_actor.tenant_id,v_branch,v_client.id,v_crm,v_sales,v_visit,nullif(p_input->>'client_type_id','')::uuid,coalesce(array(select value from jsonb_array_elements_text(coalesce(p_input->'product_categories','[]'))),'{}'),coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(p_input->'product_category_ids','[]'))),'{}'),coalesce((p_input->>'product_bought')::boolean,false),nullif(p_input->>'buy_status',''),nullif(p_input->>'buy_status_id','')::uuid,nullif(p_input->>'not_bought_reason',''),v_not_reason,nullif(btrim(p_input->>'product_requirement'),''),nullif(p_input->>'followup_due_date','')::date,nullif(p_input->>'potential_category',''),nullif(p_input->>'potential_category_id','')::uuid,nullif(btrim(p_input->>'remark'),''),coalesce((p_input->>'instagram_asked')::boolean,false),coalesce((p_input->>'google_review_asked')::boolean,false),coalesce((p_input->>'referral_asked')::boolean,false),coalesce((p_input->>'companions')::int,0),v_actor.id,p_request_key) returning id into v_walkin;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,ref_id,subject,outcome,summary,created_by,occurred_at,metadata) values(v_actor.tenant_id,v_branch,v_client.id,'walkin',v_walkin,'Walk-in recorded',nullif(btrim(p_input->>'remark'),''),'Store visit recorded',v_actor.id,v_visit,jsonb_build_object('product_bought',coalesce((p_input->>'product_bought')::boolean,false),'buy_status_id',nullif(p_input->>'buy_status_id',''),'crm_id',v_crm,'salesperson_id',v_sales));
 if nullif(p_input->>'followup_due_date','') is not null then v_follow:=create_crm_followup(v_client.id,jsonb_build_object('assigned_to',v_crm,'due_date',p_input->>'followup_due_date','subject','Walk-in follow-up','workflow_key','walkin:'||v_walkin),extensions.uuid_generate_v4()); update walkin_entries set followup_id=v_follow where id=v_walkin; end if; perform refresh_crm_client_rollups(v_client.id);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_walkin_recorded','walkin_entries',v_walkin,jsonb_build_object('client_id',v_client.id,'branch_id',v_branch,'followup_id',v_follow,'linked_existing',v_client.created_at<v_visit)); perform enqueue_notification_event(v_actor.tenant_id,v_branch,null,'walkin_created','crm',v_walkin,v_actor.id,jsonb_build_object('_assigned_user_ids',jsonb_build_array(v_crm),'client_id',v_client.id,'_link_url','/crm?client='||v_client.id),'walkin_created:'||v_walkin,now()); return jsonb_build_object('walkin_id',v_walkin,'client_id',v_client.id,'followup_id',v_follow,'replayed',false); end $$;

create function merge_crm_clients(p_survivor_id uuid,p_duplicate_id uuid,p_request_key uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_survivor clients; v_duplicate clients; v_counts jsonb; v_replay uuid;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'merge_clients'||p_request_key::text,0)); select result_id into v_replay from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='merge_clients' and request_key=p_request_key; if v_replay is not null then return v_replay; end if; if v_actor.user_role not in ('super_admin','admin') or p_survivor_id=p_duplicate_id then raise exception 'Only administrators may merge distinct clients' using errcode='42501'; end if; select * into v_survivor from clients where id=p_survivor_id for update; select * into v_duplicate from clients where id=p_duplicate_id for update; if v_survivor.id is null or v_duplicate.id is null or v_survivor.tenant_id<>v_actor.tenant_id or v_duplicate.tenant_id<>v_actor.tenant_id or v_survivor.status<>'active' or v_duplicate.status<>'active' then raise exception 'Merge clients must be active in one tenant' using errcode='23514'; end if; perform set_config('app.crm_merge','1',true);
 select jsonb_build_object('walkins',(select count(*) from walkin_entries where client_id=p_duplicate_id),'timeline',(select count(*) from client_timeline where client_id=p_duplicate_id),'followups',(select count(*) from client_followups where client_id=p_duplicate_id),'documents',(select count(*) from crm_documents where client_id=p_duplicate_id),'assignments',(select count(*) from client_assignments where client_id=p_duplicate_id)) into v_counts;
 update client_contact_aliases set is_active=false where client_id in (p_survivor_id,p_duplicate_id); update client_contact_aliases set client_id=p_survivor_id,alias_type='merged' where client_id=p_duplicate_id; update client_contact_aliases set is_active=true where id in (select distinct on(normalized_phone) id from client_contact_aliases where client_id=p_survivor_id order by normalized_phone,created_at desc,id desc);
 update walkin_entries set client_id=p_survivor_id where client_id=p_duplicate_id; update client_timeline set client_id=p_survivor_id where client_id=p_duplicate_id; update client_followups set client_id=p_survivor_id where client_id=p_duplicate_id; update crm_documents set client_id=p_survivor_id where client_id=p_duplicate_id; update client_assignments set is_active=false,ended_at=coalesce(ended_at,now()),ended_by=v_actor.id where client_id=p_duplicate_id and is_active; update client_assignments set client_id=p_survivor_id where client_id=p_duplicate_id;
 update task_instances set source_ref_id=p_survivor_id where tenant_id=v_actor.tenant_id and source='crm' and source_ref_id=p_duplicate_id; update form_submissions set linked_record_id=p_survivor_id where linked_module='crm_client' and linked_record_id=p_duplicate_id; update fms_instances set context=jsonb_set(context,'{client_id}',to_jsonb(p_survivor_id::text)) where tenant_id=v_actor.tenant_id and context->>'client_id'=p_duplicate_id::text;
 update clients set status='merged',merged_into_client_id=p_survivor_id,assigned_crm_id=null,record_version=record_version+1,updated_by=v_actor.id,updated_at=now() where id=p_duplicate_id; update clients set record_version=record_version+1,updated_by=v_actor.id,updated_at=now() where id=p_survivor_id; perform sync_crm_contacts(p_survivor_id,v_actor.id); perform refresh_crm_client_rollups(p_survivor_id);
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,ref_id,subject,summary,created_by,occurred_at,metadata) values(v_actor.tenant_id,v_survivor.branch_id,p_survivor_id,'clients_merged',p_duplicate_id,'Clients merged','Duplicate history preserved under survivor',v_actor.id,now(),jsonb_build_object('merged_client_id',p_duplicate_id,'moved_counts',v_counts)); insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'crm_clients_merged','clients',p_survivor_id,jsonb_build_object('survivor_id',p_survivor_id,'duplicate_id',p_duplicate_id),jsonb_build_object('tombstone_id',p_duplicate_id,'moved_counts',v_counts)); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'merge_clients',p_request_key,p_survivor_id,jsonb_build_object('id',p_survivor_id)); return p_survivor_id; end $$;

-- --------------------------------------------------------------------------
-- Private CRM documents and Storage
-- --------------------------------------------------------------------------

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('crm-documents','crm-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create function can_write_crm_document_object(p_name text)
returns boolean language sql stable security definer set search_path=public,storage as $$
 select current_profile_is_active() and current_role_level() in ('super_admin','admin','manager','crm') and split_part(p_name,'/',1)=current_tenant_id()::text
 and split_part(p_name,'/',2) in ('client','walkin','timeline') and split_part(p_name,'/',3) ~ '^[0-9a-f-]{36}$'
 and case split_part(p_name,'/',2) when 'client' then can_read_crm_client(split_part(p_name,'/',3)::uuid) when 'walkin' then exists(select 1 from walkin_entries w where w.id=split_part(p_name,'/',3)::uuid and can_read_crm_client(w.client_id)) else exists(select 1 from client_timeline t where t.id=split_part(p_name,'/',3)::uuid and can_read_crm_client(t.client_id)) end;
$$;
create function can_read_crm_document_object(p_name text) returns boolean language sql stable security definer set search_path=public,storage as $$ select exists(select 1 from crm_documents d where d.storage_path=p_name and d.removed_at is null and can_read_crm_client(d.client_id)); $$;
create function can_delete_crm_document_object(p_name text) returns boolean language sql stable security definer set search_path=public,storage as $$ select current_profile_is_active() and (not exists(select 1 from crm_documents d where d.storage_path=p_name and d.removed_at is null) or exists(select 1 from crm_documents d where d.storage_path=p_name and d.removed_at is not null and (d.uploaded_by=(current_profile()).id or current_role_level() in ('super_admin','admin')))); $$;

create policy crm_document_objects_insert on storage.objects for insert to authenticated with check(bucket_id='crm-documents' and owner_id=auth.uid()::text and can_write_crm_document_object(name));
create policy crm_document_objects_select on storage.objects for select to authenticated using(bucket_id='crm-documents' and can_read_crm_document_object(name));
create policy crm_document_objects_delete on storage.objects for delete to authenticated using(bucket_id='crm-documents' and owner_id=auth.uid()::text and can_delete_crm_document_object(name));

create function register_crm_document(p_client_id uuid,p_parent_type text,p_parent_id uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_size_bytes bigint,p_request_key uuid)
returns uuid language plpgsql security definer set search_path=public,storage as $$
declare v_actor user_profiles; v_client clients; v_id uuid; v_expected text;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'register_document'||p_request_key::text,0)); select result_id into v_id from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='register_document' and request_key=p_request_key; if v_id is not null then return v_id; end if; select * into v_client from clients where id=p_client_id; if v_client.id is null or not can_read_crm_client(p_client_id) then raise exception 'Client not found' using errcode='42501'; end if; if p_parent_type not in ('client','walkin','timeline') then raise exception 'Document parent type is invalid' using errcode='22023'; end if; if p_parent_type='client' and p_parent_id<>p_client_id or p_parent_type='walkin' and not exists(select 1 from walkin_entries where id=p_parent_id and client_id=p_client_id) or p_parent_type='timeline' and not exists(select 1 from client_timeline where id=p_parent_id and client_id=p_client_id) then raise exception 'Document parent does not belong to the client' using errcode='23503'; end if;
 v_expected:=v_actor.tenant_id::text||'/'||p_parent_type||'/'||p_parent_id::text||'/'; if p_storage_path not like v_expected||'%' or p_storage_path like '%..%' or p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_size_bytes not between 1 and 10485760 or lower(p_original_filename)!~'\.(jpg|jpeg|png|webp|pdf)$' then raise exception 'Document metadata is invalid' using errcode='22023'; end if; if not exists(select 1 from storage.objects where bucket_id='crm-documents' and name=p_storage_path and owner_id=auth.uid()::text) then raise exception 'Uploaded object is not owned by the caller' using errcode='42501'; end if;
 insert into crm_documents(tenant_id,branch_id,client_id,parent_type,parent_id,storage_path,original_filename,mime_type,size_bytes,uploaded_by) values(v_actor.tenant_id,v_client.branch_id,p_client_id,p_parent_type,p_parent_id,p_storage_path,btrim(p_original_filename),p_mime_type,p_size_bytes,v_actor.id) returning id into v_id; insert into client_timeline(tenant_id,branch_id,client_id,event_type,ref_id,subject,summary,created_by,occurred_at,metadata) values(v_actor.tenant_id,v_client.branch_id,p_client_id,'document_uploaded',v_id,'Document uploaded','Private document registered',v_actor.id,now(),jsonb_build_object('mime_type',p_mime_type,'size_bytes',p_size_bytes,'parent_type',p_parent_type,'parent_id',p_parent_id)); insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_document_registered','crm_documents',v_id,jsonb_build_object('client_id',p_client_id,'parent_type',p_parent_type,'parent_id',p_parent_id,'mime_type',p_mime_type,'size_bytes',p_size_bytes)); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'register_document',p_request_key,v_id,jsonb_build_object('id',v_id)); return v_id; end $$;

create function remove_crm_document(p_document_id uuid,p_reason text,p_request_key uuid)
returns text language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_doc crm_documents; v_replay jsonb;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'remove_document'||p_request_key::text,0)); select result into v_replay from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='remove_document' and request_key=p_request_key; if v_replay is not null then return v_replay->>'storage_path'; end if; select * into v_doc from crm_documents where id=p_document_id for update; if v_doc.id is null or v_doc.removed_at is not null or not can_read_crm_client(v_doc.client_id) or not (v_doc.uploaded_by=v_actor.id or v_actor.user_role in ('super_admin','admin','manager')) then raise exception 'Document removal denied' using errcode='42501'; end if; if nullif(btrim(p_reason),'') is null then raise exception 'Removal reason is required' using errcode='22023'; end if; update crm_documents set removed_at=now(),removed_by=v_actor.id,removal_reason=left(btrim(p_reason),1000) where id=p_document_id; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_document_removed','crm_documents',p_document_id,jsonb_build_object('client_id',v_doc.client_id,'parent_type',v_doc.parent_type,'parent_id',v_doc.parent_id)); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'remove_document',p_request_key,p_document_id,jsonb_build_object('storage_path',v_doc.storage_path)); return v_doc.storage_path; end $$;

create function get_crm_document_path(p_document_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$ declare v_doc crm_documents; begin perform assert_crm_actor(); select * into v_doc from crm_documents where id=p_document_id and removed_at is null; if v_doc.id is null or not can_read_crm_client(v_doc.client_id) then raise exception 'Document not found' using errcode='42501'; end if; return v_doc.storage_path; end $$;

-- --------------------------------------------------------------------------
-- CRM links into existing task, Forms, and FMS contracts
-- --------------------------------------------------------------------------

create function link_crm_record(p_client_id uuid,p_module text,p_record_id uuid,p_request_key uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_type text; v_replay uuid;
begin v_actor:=assert_crm_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if; perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'link_record'||p_request_key::text,0)); select result_id into v_replay from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='link_record' and request_key=p_request_key; if v_replay is not null then return v_replay; end if; if not can_read_crm_client(p_client_id) then raise exception 'Client not found' using errcode='42501'; end if;
 if p_module='task' and exists(select 1 from task_instances where id=p_record_id and tenant_id=v_actor.tenant_id and can_read_task(id)) then update task_instances set source='crm',source_ref_id=p_client_id where id=p_record_id; v_type:='task_linked';
 elsif p_module='form' and exists(select 1 from form_submissions where id=p_record_id and tenant_id=v_actor.tenant_id) then update form_submissions set linked_module='crm_client',linked_record_id=p_client_id where id=p_record_id; v_type:='form_linked';
 elsif p_module='fms' and exists(select 1 from fms_instances where id=p_record_id and tenant_id=v_actor.tenant_id and can_read_fms_instance(id)) then update fms_instances set context=jsonb_set(context,'{client_id}',to_jsonb(p_client_id::text),true) where id=p_record_id; v_type:='fms_linked'; else raise exception 'Linked record is outside CRM scope' using errcode='42501'; end if;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,ref_id,subject,summary,created_by,occurred_at,metadata) select c.tenant_id,c.branch_id,c.id,v_type,p_record_id,initcap(p_module)||' linked','Existing module record linked',v_actor.id,now(),jsonb_build_object('module',p_module,'record_id',p_record_id) from clients c where c.id=p_client_id; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'crm_record_linked',p_module,p_record_id,jsonb_build_object('client_id',p_client_id)); insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'link_record',p_request_key,p_record_id,jsonb_build_object('id',p_record_id)); return p_record_id; end $$;

-- --------------------------------------------------------------------------
-- Follow-up due/overdue notification detection
-- --------------------------------------------------------------------------

create function detect_crm_followup_events(p_limit integer default 100,p_now timestamptz default now())
returns table(due_events integer,overdue_events integer) language plpgsql security definer set search_path=public as $$
declare v_f record; v_due int:=0; v_over int:=0; v_today date;
begin if current_user not in ('postgres','service_role') or p_limit not between 1 and 500 then raise exception 'CRM follow-up detection is not authorized' using errcode='42501'; end if; for v_f in select f.*,t.timezone from client_followups f join tenants t on t.id=f.tenant_id where f.status='open' order by f.due_date,f.id limit p_limit loop v_today:=(p_now at time zone coalesce(v_f.timezone,'Asia/Kolkata'))::date; if v_f.due_date=v_today then perform enqueue_notification_event(v_f.tenant_id,v_f.branch_id,null,'followup_due','crm',v_f.id,null,jsonb_build_object('_assigned_user_ids',jsonb_build_array(v_f.assigned_to),'due_date',v_f.due_date,'_link_url','/crm?client='||v_f.client_id),'followup_due:'||v_f.id||':'||v_today,p_now); v_due:=v_due+1; elsif v_f.due_date<v_today then perform enqueue_notification_event(v_f.tenant_id,v_f.branch_id,null,'followup_overdue','crm',v_f.id,null,jsonb_build_object('_assigned_user_ids',jsonb_build_array(v_f.assigned_to),'due_date',v_f.due_date,'_link_url','/crm?client='||v_f.client_id),'followup_overdue:'||v_f.id||':'||v_today,p_now); v_over:=v_over+1; end if; end loop; return query select v_due,v_over; end $$;

-- Extend canonical Notifications without customer content in event payloads.
alter table notification_events drop constraint if exists notification_events_event_type_check;
alter table notification_events add constraint notification_events_event_type_check check(event_type in ('task_assigned','task_delegated','task_completed','task_overdue','task_coverage_required','form_submitted','form_approved','form_rejected','fms_stage_assigned','fms_stage_completed','fms_stage_rejected','fms_revision_requested','fms_stage_escalated','fms_sla_breached','fms_completed','system_alert','client_created','client_reassigned','walkin_created','followup_created','followup_due','followup_overdue','followup_completed'));
alter table notification_events drop constraint if exists notification_events_source_module_check;
alter table notification_events add constraint notification_events_source_module_check check(source_module in ('tasks','forms','fms','crm','system'));

create or replace function notification_event_variables(p_event_type text)
returns text[] language sql immutable set search_path=public as $$ select case p_event_type
 when 'task_assigned' then array['actor_name','assignee_name','task_title','planned_datetime','priority'] when 'task_delegated' then array['actor_name','assignee_name','task_title','planned_datetime','priority','reason'] when 'task_completed' then array['actor_name','task_title','completed_at','priority'] when 'task_overdue' then array['assignee_name','task_title','planned_datetime','priority'] when 'task_coverage_required' then array['task_title','planned_datetime','priority','reason']
 when 'form_submitted' then array['actor_name','form_name','submitted_at'] when 'form_approved' then array['actor_name','form_name','reviewed_at','review_notes'] when 'form_rejected' then array['actor_name','form_name','reviewed_at','review_notes']
 when 'fms_stage_assigned' then array['actor_name','assignee_name','flow_name','stage_name','reference','planned_datetime','priority'] when 'fms_stage_completed' then array['actor_name','flow_name','stage_name','reference','completed_at','priority'] when 'fms_stage_rejected' then array['actor_name','flow_name','stage_name','reference','reason','priority'] when 'fms_revision_requested' then array['actor_name','flow_name','stage_name','reference','reason','priority'] when 'fms_stage_escalated' then array['actor_name','flow_name','stage_name','reference','reason','priority'] when 'fms_sla_breached' then array['flow_name','stage_name','reference','planned_datetime','priority'] when 'fms_completed' then array['actor_name','flow_name','reference','completed_at','priority']
 when 'client_created' then array['priority'] when 'client_reassigned' then array['priority'] when 'walkin_created' then array['priority'] when 'followup_created' then array['due_date','priority'] when 'followup_due' then array['due_date','priority'] when 'followup_overdue' then array['due_date','priority'] when 'followup_completed' then array['priority'] when 'system_alert' then array['alert_title','alert_message','priority'] else array[]::text[] end $$;

-- --------------------------------------------------------------------------
-- RLS, direct-write denial, and exact execution grants
-- --------------------------------------------------------------------------

alter table client_contact_aliases enable row level security; alter table client_assignments enable row level security; alter table crm_documents enable row level security; alter table crm_mutation_keys enable row level security;
drop policy if exists clients_select on clients; drop policy if exists walkin_entries_select on walkin_entries; drop policy if exists walkin_uploads_select on walkin_uploads; drop policy if exists client_timeline_select on client_timeline; drop policy if exists client_followups_select on client_followups;
create policy clients_select on clients for select to authenticated using(can_read_crm_client(id));
create policy client_alias_select on client_contact_aliases for select to authenticated using(can_read_crm_client(client_id));
create policy client_assignments_select on client_assignments for select to authenticated using(can_read_crm_client(client_id));
create policy walkin_entries_select on walkin_entries for select to authenticated using(can_read_crm_client(client_id) and (current_role_level() in ('super_admin','admin') or branch_id=current_branch_id()));
create policy walkin_uploads_select on walkin_uploads for select to authenticated using(exists(select 1 from walkin_entries w where w.id=walkin_entry_id and can_read_crm_client(w.client_id) and (current_role_level() in ('super_admin','admin') or w.branch_id=current_branch_id())));
create policy client_timeline_select on client_timeline for select to authenticated using(can_read_crm_client(client_id));
create policy client_followups_select on client_followups for select to authenticated using(can_read_crm_client(client_id));
create policy crm_documents_select on crm_documents for select to authenticated using(can_read_crm_client(client_id));

revoke all on clients,client_contact_aliases,client_assignments,walkin_entries,walkin_uploads,client_timeline,client_followups,crm_documents,crm_mutation_keys from anon,authenticated,service_role;
grant select on clients,client_contact_aliases,client_assignments,walkin_entries,walkin_uploads,client_timeline,client_followups,crm_documents to authenticated;

do $$ declare f record; begin for f in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%crm%' or p.proname in ('normalize_indian_phone','lookup_crm_client_by_phone','merge_crm_clients','refresh_crm_client_rollups','sync_crm_contacts','assert_active_crm_dropdown')) loop execute format('alter function %s owner to postgres',f.identity); execute format('revoke all on function %s from public,anon,authenticated,service_role',f.identity); end loop; end $$;
grant execute on function normalize_indian_phone(text),assert_crm_actor(),can_read_crm_client(uuid),lookup_crm_client_by_phone(text),search_crm_clients(jsonb),get_crm_client_detail(uuid),list_crm_followups(jsonb),create_crm_client(jsonb,uuid),update_crm_client(uuid,jsonb,integer,uuid),reassign_crm_client(uuid,uuid,uuid,integer,uuid),record_crm_walkin(jsonb,uuid),merge_crm_clients(uuid,uuid,uuid),log_crm_interaction(uuid,jsonb,uuid),correct_crm_interaction(uuid,jsonb,uuid),create_crm_followup(uuid,jsonb,uuid),reschedule_crm_followup(uuid,date,uuid,text,integer,uuid),complete_crm_followup(uuid,text,integer,uuid),cancel_crm_followup(uuid,text,integer,uuid),register_crm_document(uuid,text,uuid,text,text,text,bigint,uuid),remove_crm_document(uuid,text,uuid),get_crm_document_path(uuid),link_crm_record(uuid,text,uuid,uuid),can_write_crm_document_object(text),can_read_crm_document_object(text),can_delete_crm_document_object(text) to authenticated;
grant execute on function detect_crm_followup_events(integer,timestamptz) to service_role;

comment on table crm_documents is 'Private CRM document metadata. Object paths are never public URLs.';
comment on table client_timeline is 'Append-only CRM history; corrections are additional rows.';
