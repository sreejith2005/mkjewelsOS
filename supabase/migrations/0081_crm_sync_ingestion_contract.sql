-- Staging-safe, worker-only ingestion foundation. Browser roles have no mutation path.
create table crm_sync_worker_assertions (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_system_id uuid not null references crm_source_systems(id) on delete cascade,
  assertion_hash text not null check (assertion_hash ~ '^[0-9a-f]{64}$'),
  scope_pattern text not null default '*' check (char_length(scope_pattern) between 1 and 500),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table crm_sync_runs (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_system_id uuid not null references crm_source_systems(id) on delete restrict,
  scope_key text not null check (char_length(btrim(scope_key)) between 1 and 500),
  request_key uuid not null,
  status text not null check (status in ('running','completed','failed','blocked')),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary)='object'),
  checkpoint jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(tenant_id,source_system_id,scope_key,request_key)
);

create table crm_sync_operation_requests (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  worker_assertion_id uuid not null references crm_sync_worker_assertions(id) on delete restrict,
  run_id uuid not null references crm_sync_runs(id) on delete restrict,
  operation text not null check (operation in ('begin','ingest','finalize','fail')),
  request_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  unique(tenant_id, worker_assertion_id, run_id, operation, request_key)
);

create table crm_source_records (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_system_id uuid not null references crm_source_systems(id) on delete restrict,
  scope_key text not null,
  source_locator text not null check (btrim(source_locator)<>''),
  source_row_key text not null check (btrim(source_row_key)<>''),
  source_checksum text not null check (source_checksum ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  run_id uuid not null references crm_sync_runs(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(tenant_id,source_system_id,source_row_key,source_checksum)
);

create table crm_sync_checkpoints (
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_system_id uuid not null references crm_source_systems(id) on delete restrict,
  scope_key text not null,
  checkpoint jsonb not null check (jsonb_typeof(checkpoint)='object'),
  run_id uuid not null references crm_sync_runs(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key(tenant_id,source_system_id,scope_key)
);

create table crm_identity_review (
  id uuid primary key default extensions.uuid_generate_v4(),
  source_record_id uuid not null references crm_source_records(id) on delete cascade,
  reason_code text not null check (reason_code in ('invalid_phone','missing_branch','duplicate_contact','invalid_date','missing_reference','unsupported_value')),
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  resolution_reason text,
  resolved_by uuid references user_profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(source_record_id,reason_code)
);

create index crm_sync_runs_scope_idx on crm_sync_runs(tenant_id,source_system_id,scope_key,started_at desc);
create index crm_sync_operation_requests_run_idx on crm_sync_operation_requests(run_id,operation,created_at desc);
create index crm_source_records_run_idx on crm_source_records(run_id);
create index crm_identity_review_open_idx on crm_identity_review(status,created_at) where status='open';

alter table crm_sync_worker_assertions enable row level security;
alter table crm_sync_runs enable row level security;
alter table crm_sync_operation_requests enable row level security;
alter table crm_source_records enable row level security;
alter table crm_sync_checkpoints enable row level security;
alter table crm_identity_review enable row level security;
create policy crm_sync_runs_admin_select on crm_sync_runs for select to authenticated using (tenant_id=current_tenant_id() and current_role_level() in ('super_admin','admin'));
create policy crm_source_records_admin_select on crm_source_records for select to authenticated using (tenant_id=current_tenant_id() and current_role_level() in ('super_admin','admin'));
create policy crm_sync_checkpoints_admin_select on crm_sync_checkpoints for select to authenticated using (tenant_id=current_tenant_id() and current_role_level() in ('super_admin','admin'));
create policy crm_identity_review_admin_select on crm_identity_review for select to authenticated using (exists(select 1 from crm_source_records r where r.id=source_record_id and r.tenant_id=current_tenant_id()) and current_role_level() in ('super_admin','admin'));

create or replace function assert_crm_sync_worker(p_source_key text,p_scope_key text,p_assertion jsonb)
returns table(tenant_id uuid,source_system_id uuid,worker_assertion_id uuid)
language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_secret text;
begin
  if auth.role() <> 'service_role' then raise exception 'CRM sync worker is denied' using errcode='42501'; end if;
  if p_assertion is null or jsonb_typeof(p_assertion)<>'object' then raise exception 'CRM sync worker assertion is invalid' using errcode='42501'; end if;
  v_id := nullif(p_assertion->>'id','')::uuid; v_secret := nullif(p_assertion->>'secret','');
  if v_id is null or v_secret is null then raise exception 'CRM sync worker assertion is invalid' using errcode='42501'; end if;
  return query select a.tenant_id,a.source_system_id,a.id from crm_sync_worker_assertions a join crm_source_systems s on s.id=a.source_system_id where a.id=v_id and s.source_key=lower(btrim(p_source_key)) and s.is_active and a.revoked_at is null and a.expires_at>now() and a.scope_pattern in ('*',p_scope_key) and a.assertion_hash=encode(extensions.digest(v_secret,'sha256'),'hex');
  if not found then raise exception 'CRM sync worker is denied' using errcode='42501'; end if;
end $$;

create or replace function begin_crm_sync_run(p_source_key text,p_scope_key text,p_request_key uuid,p_worker_assertion jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant uuid; v_source uuid; v_run uuid;
begin
  select tenant_id,source_system_id into v_tenant,v_source from assert_crm_sync_worker(p_source_key,p_scope_key,p_worker_assertion);
  if p_request_key is null or btrim(p_scope_key)='' then raise exception 'CRM sync run is invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||v_source::text||p_scope_key,0));
  select id into v_run from crm_sync_runs where tenant_id=v_tenant and source_system_id=v_source and scope_key=p_scope_key and request_key=p_request_key;
  if v_run is null then
    if exists(select 1 from crm_sync_runs where tenant_id=v_tenant and source_system_id=v_source and scope_key=p_scope_key and status='running') then raise exception 'CRM sync scope is already running' using errcode='40001'; end if;
    insert into crm_sync_runs(tenant_id,source_system_id,scope_key,request_key,status) values(v_tenant,v_source,p_scope_key,p_request_key,'running') returning id into v_run;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_tenant,null,'crm_sync_started','crm_sync',v_run,jsonb_build_object('scope_key',p_scope_key));
  end if;
  return jsonb_build_object('run_id',v_run);
end $$;

create or replace function ingest_crm_source_batch(p_run_id uuid,p_source_key text,p_scope_key text,p_rows jsonb,p_request_key uuid,p_worker_assertion jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant uuid; v_source uuid; v_row jsonb; v_added int:=0; v_replayed int:=0;
begin
  select tenant_id,source_system_id into v_tenant,v_source from assert_crm_sync_worker(p_source_key,p_scope_key,p_worker_assertion);
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'CRM sync batch is invalid' using errcode='22023'; end if;
  if not exists(select 1 from crm_sync_runs where id=p_run_id and tenant_id=v_tenant and source_system_id=v_source and scope_key=p_scope_key and status='running') then raise exception 'CRM sync run is unavailable' using errcode='42501'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row)<>'object' or coalesce(v_row->>'source_row_key','')='' or coalesce(v_row->>'source_locator','')='' or coalesce(v_row->>'source_checksum','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(v_row->'payload')<>'object' then raise exception 'CRM sync row is invalid' using errcode='22023'; end if;
    insert into crm_source_records(tenant_id,source_system_id,scope_key,source_locator,source_row_key,source_checksum,observed_at,payload,run_id) values(v_tenant,v_source,p_scope_key,v_row->>'source_locator',v_row->>'source_row_key',v_row->>'source_checksum',nullif(v_row->>'observed_at','')::timestamptz,v_row->'payload',p_run_id) on conflict do nothing;
    if found then v_added:=v_added+1; else v_replayed:=v_replayed+1; end if;
  end loop;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_tenant,null,'crm_sync_batch_ingested','crm_sync',p_run_id,jsonb_build_object('accepted',v_added,'replayed',v_replayed));
  return jsonb_build_object('accepted',v_added,'replayed',v_replayed,'quarantined',0,'review_codes','[]'::jsonb);
end $$;

create or replace function finalize_crm_sync_run(p_run_id uuid,p_checkpoint jsonb,p_request_key uuid,p_worker_assertion jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run crm_sync_runs;
begin
  select r.* into v_run from crm_sync_runs r join assert_crm_sync_worker((select source_key from crm_source_systems where id=r.source_system_id),r.scope_key,p_worker_assertion) a on a.tenant_id=r.tenant_id and a.source_system_id=r.source_system_id where r.id=p_run_id and r.status='running' for update;
  if v_run.id is null or jsonb_typeof(p_checkpoint)<>'object' then raise exception 'CRM sync finalization is invalid' using errcode='42501'; end if;
  insert into crm_sync_checkpoints(tenant_id,source_system_id,scope_key,checkpoint,run_id) values(v_run.tenant_id,v_run.source_system_id,v_run.scope_key,p_checkpoint,v_run.id) on conflict(tenant_id,source_system_id,scope_key) do update set checkpoint=excluded.checkpoint,run_id=excluded.run_id,updated_at=now();
  update crm_sync_runs set status='completed',checkpoint=p_checkpoint,completed_at=now() where id=v_run.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_run.tenant_id,null,'crm_sync_completed','crm_sync',v_run.id,jsonb_build_object('scope_key',v_run.scope_key));
  return jsonb_build_object('run_id',v_run.id,'status','completed');
end $$;

create or replace function fail_crm_sync_run(p_run_id uuid,p_safe_error_code text,p_request_key uuid,p_worker_assertion jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$ declare v_run crm_sync_runs;
begin
  select r.* into v_run from crm_sync_runs r join assert_crm_sync_worker((select source_key from crm_source_systems where id=r.source_system_id),r.scope_key,p_worker_assertion) a on a.tenant_id=r.tenant_id and a.source_system_id=r.source_system_id where r.id=p_run_id and r.status='running' for update;
  if v_run.id is null or p_safe_error_code !~ '^[a-z0-9_]{1,80}$' then raise exception 'CRM sync failure is invalid' using errcode='22023'; end if;
  update crm_sync_runs set status='failed',summary=jsonb_build_object('safe_error_code',p_safe_error_code),completed_at=now() where id=v_run.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_run.tenant_id,null,'crm_sync_failed','crm_sync',v_run.id,jsonb_build_object('safe_error_code',p_safe_error_code));
  return jsonb_build_object('run_id',v_run.id,'status','failed');
end $$;

create or replace function crm_sync_request_fingerprint(p_operation text, p_payload jsonb)
returns text language sql immutable security definer set search_path=public,extensions as $$
  select encode(extensions.digest(p_operation || ':' || p_payload::text, 'sha256'), 'hex')
$$;

create or replace function crm_sync_replay_operation(p_tenant_id uuid, p_assertion_id uuid, p_run_id uuid, p_operation text, p_request_key uuid, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fingerprint text; v_response jsonb;
begin
  select request_fingerprint,response into v_fingerprint,v_response from crm_sync_operation_requests
  where tenant_id=p_tenant_id and worker_assertion_id=p_assertion_id and run_id=p_run_id and operation=p_operation and request_key=p_request_key;
  if found then
    if v_fingerprint <> p_fingerprint then raise exception 'CRM sync request key was reused with different input' using errcode='22023'; end if;
    return v_response;
  end if;
  return null;
end $$;

create or replace function crm_sync_record_operation(p_tenant_id uuid, p_assertion_id uuid, p_run_id uuid, p_operation text, p_request_key uuid, p_fingerprint text, p_response jsonb)
returns void language sql security definer set search_path=public as $$
  insert into crm_sync_operation_requests(tenant_id,worker_assertion_id,run_id,operation,request_key,request_fingerprint,response)
  values(p_tenant_id,p_assertion_id,p_run_id,p_operation,p_request_key,p_fingerprint,p_response)
$$;

create or replace function begin_crm_sync_run(p_source_key text,p_scope_key text,p_request_key uuid,p_worker_assertion jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant uuid; v_source uuid; v_assertion uuid; v_run uuid; v_response jsonb; v_fingerprint text; v_new boolean:=false;
begin
  if p_request_key is null or btrim(coalesce(p_scope_key,''))='' then raise exception 'CRM sync run is invalid' using errcode='22023'; end if;
  select tenant_id,source_system_id,worker_assertion_id into v_tenant,v_source,v_assertion from assert_crm_sync_worker(p_source_key,p_scope_key,p_worker_assertion);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||v_source::text||p_scope_key,0));
  select id into v_run from crm_sync_runs where tenant_id=v_tenant and source_system_id=v_source and scope_key=p_scope_key and request_key=p_request_key;
  if v_run is null then
    if exists(select 1 from crm_sync_runs where tenant_id=v_tenant and source_system_id=v_source and scope_key=p_scope_key and status='running') then raise exception 'CRM sync scope is already running' using errcode='40001'; end if;
    insert into crm_sync_runs(tenant_id,source_system_id,scope_key,request_key,status) values(v_tenant,v_source,p_scope_key,p_request_key,'running') returning id into v_run;
    v_new:=true;
  end if;
  v_fingerprint:=crm_sync_request_fingerprint('begin',jsonb_build_object('source_key',lower(btrim(p_source_key)),'scope_key',p_scope_key));
  v_response:=crm_sync_replay_operation(v_tenant,v_assertion,v_run,'begin',p_request_key,v_fingerprint);
  if v_response is not null then return v_response; end if;
  v_response:=jsonb_build_object('run_id',v_run);
  perform crm_sync_record_operation(v_tenant,v_assertion,v_run,'begin',p_request_key,v_fingerprint,v_response);
  if v_new then insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_tenant,null,'crm_sync_started','crm_sync',v_run,jsonb_build_object('scope_key',p_scope_key)); end if;
  return v_response;
end $$;

create or replace function ingest_crm_source_batch(p_run_id uuid,p_source_key text,p_scope_key text,p_rows jsonb,p_request_key uuid,p_worker_assertion jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tenant uuid; v_source uuid; v_assertion uuid; v_run crm_sync_runs; v_row jsonb; v_added int:=0; v_replayed int:=0; v_response jsonb; v_fingerprint text;
begin
  if p_request_key is null then raise exception 'CRM sync batch is invalid' using errcode='22023'; end if;
  select tenant_id,source_system_id,worker_assertion_id into v_tenant,v_source,v_assertion from assert_crm_sync_worker(p_source_key,p_scope_key,p_worker_assertion);
  select * into v_run from crm_sync_runs where id=p_run_id and tenant_id=v_tenant and source_system_id=v_source and scope_key=p_scope_key for update;
  if v_run.id is null then raise exception 'CRM sync run is unavailable' using errcode='42501'; end if;
  v_fingerprint:=crm_sync_request_fingerprint('ingest',jsonb_build_object('rows',p_rows));
  v_response:=crm_sync_replay_operation(v_tenant,v_assertion,v_run.id,'ingest',p_request_key,v_fingerprint);
  if v_response is not null then return v_response; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'CRM sync batch is invalid' using errcode='22023'; end if;
  if v_run.status<>'running' then raise exception 'CRM sync run is unavailable' using errcode='42501'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row)<>'object' or coalesce(v_row->>'source_row_key','')='' or coalesce(v_row->>'source_locator','')='' or coalesce(v_row->>'source_checksum','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(v_row->'payload')<>'object' then raise exception 'CRM sync row is invalid' using errcode='22023'; end if;
    insert into crm_source_records(tenant_id,source_system_id,scope_key,source_locator,source_row_key,source_checksum,observed_at,payload,run_id) values(v_tenant,v_source,p_scope_key,v_row->>'source_locator',v_row->>'source_row_key',v_row->>'source_checksum',nullif(v_row->>'observed_at','')::timestamptz,v_row->'payload',p_run_id) on conflict do nothing;
    if found then v_added:=v_added+1; else v_replayed:=v_replayed+1; end if;
  end loop;
  v_response:=jsonb_build_object('accepted',v_added,'replayed',v_replayed,'quarantined',0,'review_codes','[]'::jsonb);
  perform crm_sync_record_operation(v_tenant,v_assertion,v_run.id,'ingest',p_request_key,v_fingerprint,v_response);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_tenant,null,'crm_sync_batch_ingested','crm_sync',v_run.id,jsonb_build_object('accepted',v_added,'replayed',v_replayed));
  return v_response;
end $$;
create or replace function finalize_crm_sync_run(p_run_id uuid,p_checkpoint jsonb,p_request_key uuid,p_worker_assertion jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run crm_sync_runs; v_source_key text; v_tenant uuid; v_source uuid; v_assertion uuid; v_response jsonb; v_fingerprint text;
begin
  if p_request_key is null or p_checkpoint is null or jsonb_typeof(p_checkpoint)<>'object' then raise exception 'CRM sync finalization is invalid' using errcode='22023'; end if;
  select * into v_run from crm_sync_runs where id=p_run_id for update;
  if v_run.id is null then raise exception 'CRM sync finalization is invalid' using errcode='42501'; end if;
  select source_key into v_source_key from crm_source_systems where id=v_run.source_system_id;
  select tenant_id,source_system_id,worker_assertion_id into v_tenant,v_source,v_assertion from assert_crm_sync_worker(v_source_key,v_run.scope_key,p_worker_assertion);
  if v_run.tenant_id<>v_tenant or v_run.source_system_id<>v_source then raise exception 'CRM sync finalization is invalid' using errcode='42501'; end if;
  v_fingerprint:=crm_sync_request_fingerprint('finalize',jsonb_build_object('checkpoint',p_checkpoint));
  v_response:=crm_sync_replay_operation(v_tenant,v_assertion,v_run.id,'finalize',p_request_key,v_fingerprint);
  if v_response is not null then return v_response; end if;
  if v_run.status<>'running' then raise exception 'CRM sync finalization is invalid' using errcode='42501'; end if;
  insert into crm_sync_checkpoints(tenant_id,source_system_id,scope_key,checkpoint,run_id) values(v_run.tenant_id,v_run.source_system_id,v_run.scope_key,p_checkpoint,v_run.id) on conflict(tenant_id,source_system_id,scope_key) do update set checkpoint=excluded.checkpoint,run_id=excluded.run_id,updated_at=now();
  update crm_sync_runs set status='completed',checkpoint=p_checkpoint,completed_at=now() where id=v_run.id;
  v_response:=jsonb_build_object('run_id',v_run.id,'status','completed');
  perform crm_sync_record_operation(v_tenant,v_assertion,v_run.id,'finalize',p_request_key,v_fingerprint,v_response);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_run.tenant_id,null,'crm_sync_completed','crm_sync',v_run.id,jsonb_build_object('scope_key',v_run.scope_key));
  return v_response;
end $$;

create or replace function fail_crm_sync_run(p_run_id uuid,p_safe_error_code text,p_request_key uuid,p_worker_assertion jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run crm_sync_runs; v_source_key text; v_tenant uuid; v_source uuid; v_assertion uuid; v_response jsonb; v_fingerprint text;
begin
  if p_request_key is null or p_safe_error_code !~ '^[a-z0-9_]{1,80}$' then raise exception 'CRM sync failure is invalid' using errcode='22023'; end if;
  select * into v_run from crm_sync_runs where id=p_run_id for update;
  if v_run.id is null then raise exception 'CRM sync failure is invalid' using errcode='42501'; end if;
  select source_key into v_source_key from crm_source_systems where id=v_run.source_system_id;
  select tenant_id,source_system_id,worker_assertion_id into v_tenant,v_source,v_assertion from assert_crm_sync_worker(v_source_key,v_run.scope_key,p_worker_assertion);
  if v_run.tenant_id<>v_tenant or v_run.source_system_id<>v_source then raise exception 'CRM sync failure is invalid' using errcode='42501'; end if;
  v_fingerprint:=crm_sync_request_fingerprint('fail',jsonb_build_object('safe_error_code',p_safe_error_code));
  v_response:=crm_sync_replay_operation(v_tenant,v_assertion,v_run.id,'fail',p_request_key,v_fingerprint);
  if v_response is not null then return v_response; end if;
  if v_run.status<>'running' then raise exception 'CRM sync failure is invalid' using errcode='42501'; end if;
  update crm_sync_runs set status='failed',summary=jsonb_build_object('safe_error_code',p_safe_error_code),completed_at=now() where id=v_run.id;
  v_response:=jsonb_build_object('run_id',v_run.id,'status','failed');
  perform crm_sync_record_operation(v_tenant,v_assertion,v_run.id,'fail',p_request_key,v_fingerprint,v_response);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_run.tenant_id,null,'crm_sync_failed','crm_sync',v_run.id,jsonb_build_object('safe_error_code',p_safe_error_code));
  return v_response;
end $$;
revoke all on crm_sync_worker_assertions,crm_sync_runs,crm_sync_operation_requests,crm_source_records,crm_sync_checkpoints,crm_identity_review from anon,authenticated;
revoke all on function begin_crm_sync_run(text,text,uuid,jsonb),ingest_crm_source_batch(uuid,text,text,jsonb,uuid,jsonb),finalize_crm_sync_run(uuid,jsonb,uuid,jsonb),fail_crm_sync_run(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function begin_crm_sync_run(text,text,uuid,jsonb),ingest_crm_source_batch(uuid,text,text,jsonb,uuid,jsonb),finalize_crm_sync_run(uuid,jsonb,uuid,jsonb),fail_crm_sync_run(uuid,text,uuid,jsonb) to service_role;
