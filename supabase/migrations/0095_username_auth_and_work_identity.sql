-- Username authentication is backed by the existing Supabase Auth password
-- authority. Auth email changes are intentionally performed by the controlled
-- service-role script because auth.users is outside this transaction.
set search_path = public, extensions;

alter table user_profiles add column if not exists username text;
alter table user_profiles drop constraint if exists user_profiles_username_format;
alter table user_profiles add constraint user_profiles_username_format
  check (username is null or username ~ '^[a-z0-9]{2,80}$') not valid;
create unique index if not exists user_profiles_username_lower_unique
  on user_profiles (lower(username)) where username is not null;

create table if not exists username_login_rate_limits (
  rate_limit_key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table username_login_rate_limits enable row level security;
revoke all on table username_login_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on username_login_rate_limits to service_role;

create or replace function consume_username_login_rate_limit(p_rate_limit_key text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_row username_login_rate_limits;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_rate_limit_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid rate limit key' using errcode = '22023'; end if;
  insert into username_login_rate_limits(rate_limit_key, attempts) values (p_rate_limit_key, 1)
  on conflict (rate_limit_key) do nothing;
  select * into v_row from username_login_rate_limits where rate_limit_key = p_rate_limit_key for update;
  if v_row.blocked_until is not null and v_row.blocked_until > now() then return false; end if;
  if v_row.window_started_at <= now() - interval '15 minutes' then
    update username_login_rate_limits set attempts = 1, window_started_at = now(), blocked_until = null, updated_at = now() where rate_limit_key = p_rate_limit_key;
    return true;
  end if;
  if v_row.attempts >= 10 then
    update username_login_rate_limits set blocked_until = now() + interval '15 minutes', updated_at = now() where rate_limit_key = p_rate_limit_key;
    return false;
  end if;
  update username_login_rate_limits set attempts = attempts + 1, updated_at = now() where rate_limit_key = p_rate_limit_key;
  return true;
end $$;

create or replace function apply_work_identity_with_audit(p_identities jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_item jsonb; v_old user_profiles; v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if jsonb_typeof(p_identities) <> 'array' or jsonb_array_length(p_identities) = 0 then raise exception 'Identity list is required' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_identities) x group by lower(btrim(x->>'profile_id')) having count(*) > 1)
    or exists (select 1 from jsonb_array_elements(p_identities) x group by lower(btrim(x->>'username')) having count(*) > 1)
    or exists (select 1 from jsonb_array_elements(p_identities) x group by lower(btrim(x->>'work_email')) having count(*) > 1) then
    raise exception 'Identity plan contains duplicates' using errcode = '22023';
  end if;
  select * into v_actor from user_profiles where user_role = 'super_admin' and account_status = 'active' and is_login_enabled order by created_at limit 1;
  if v_actor.id is null then raise exception 'Active Super Admin is required' using errcode = '42501'; end if;
  for v_item in select value from jsonb_array_elements(p_identities) loop
    if nullif(btrim(v_item->>'profile_id'),'') is null or lower(btrim(v_item->>'username')) !~ '^[a-z0-9]{2,80}$'
      or lower(btrim(v_item->>'work_email')) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception 'Identity item is invalid' using errcode = '22023';
    end if;
    select * into v_old from user_profiles where id = (v_item->>'profile_id')::uuid and auth_user_id = (v_item->>'auth_user_id')::uuid for update;
    if v_old.id is null then raise exception 'Identity profile is invalid' using errcode = '23503'; end if;
    update user_profiles set username = lower(btrim(v_item->>'username')), email = lower(btrim(v_item->>'work_email')), official_email = lower(btrim(v_item->>'work_email')), updated_by = v_actor.id, updated_at = now() where id = v_old.id;
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (v_old.tenant_id, v_actor.id, 'work_identity_reconciled', 'user_management', v_old.id, to_jsonb(v_old), (select to_jsonb(p) from user_profiles p where p.id = v_old.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function consume_username_login_rate_limit(text) from public, anon, authenticated;
revoke all on function apply_work_identity_with_audit(jsonb) from public, anon, authenticated;
grant execute on function consume_username_login_rate_limit(text) to service_role;
grant execute on function apply_work_identity_with_audit(jsonb) to service_role;

create or replace function set_new_user_work_identity_with_audit(p_profile_id uuid, p_username text, p_personal_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_profile user_profiles; v_old user_profiles;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if lower(btrim(p_username)) !~ '^[a-z0-9]{2,80}$' then raise exception 'Username is invalid' using errcode = '22023'; end if;
  select * into v_old from user_profiles where id = p_profile_id for update;
  if v_old.id is null then raise exception 'Profile is invalid' using errcode = '23503'; end if;
  update user_profiles set username = lower(btrim(p_username)), personal_email = nullif(lower(btrim(coalesce(p_personal_email,''))),''), updated_at = now() where id = p_profile_id returning * into v_profile;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values(v_profile.tenant_id, v_profile.created_by, 'work_identity_created', 'user_management', v_profile.id, to_jsonb(v_old), to_jsonb(v_profile));
end $$;
revoke all on function set_new_user_work_identity_with_audit(uuid,text,text) from public, anon, authenticated;
grant execute on function set_new_user_work_identity_with_audit(uuid,text,text) to service_role;
notify pgrst, 'reload schema';
