set search_path = public, extensions;
create or replace function reconcile_production_login_emails(p_changes jsonb, p_retire_ids uuid[] default '{}')
returns integer language plpgsql security definer set search_path=public as $$
declare a user_profiles; r jsonb; old user_profiles; n integer:=0; rid uuid;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into a from user_profiles where lower(email)='mis@mkjewels.in' and user_role='super_admin' and account_status='active' for update;
 if a.id is null or jsonb_typeof(p_changes)<>'array' then raise exception 'Invalid reconciliation request' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_changes) x group by lower(btrim(x->>'email')) having count(*)>1) then raise exception 'Duplicate email in request' using errcode='22023'; end if;
 foreach rid in array coalesce(p_retire_ids,'{}') loop
  select * into old from user_profiles where id=rid and tenant_id=a.tenant_id for update;
  if old.id is null or old.id=a.id then raise exception 'Invalid duplicate profile' using errcode='23503'; end if;
  update user_profiles set account_status='inactive',is_login_enabled=false,updated_by=a.id,updated_at=now() where id=old.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(a.tenant_id,a.id,'production_duplicate_account_retired','user_management',old.id,jsonb_build_object('email',old.email,'account_status',old.account_status),jsonb_build_object('account_status','inactive'));
 end loop;
 for r in select value from jsonb_array_elements(p_changes) loop
  select * into old from user_profiles where id=(r->>'profile_id')::uuid and tenant_id=a.tenant_id for update;
  if old.id is null or old.id=any(coalesce(p_retire_ids,'{}')) or lower(r->>'email') !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Invalid login mapping' using errcode='22023'; end if;
  update user_profiles set email=lower(btrim(r->>'email')),official_email=lower(btrim(r->>'email')),account_status='active',is_login_enabled=true,updated_by=a.id,updated_at=now() where id=old.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(a.tenant_id,a.id,'production_login_email_reconciled','user_management',old.id,jsonb_build_object('email',old.email),jsonb_build_object('email',lower(r->>'email'))); n:=n+1;
 end loop; return n;
end; $$;
revoke all on function reconcile_production_login_emails(jsonb,uuid[]) from public,anon,authenticated;
grant execute on function reconcile_production_login_emails(jsonb,uuid[]) to service_role;
notify pgrst,'reload schema';
