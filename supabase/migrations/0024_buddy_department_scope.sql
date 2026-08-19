-- A buddy is selected from the requested department roster. Invited people
-- remain selectable during onboarding; left/inactive/suspended people do not.
set search_path = public, extensions;

create or replace function enforce_user_profile_buddy_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_buddy user_profiles;
begin
  if new.buddy_id is null then return new; end if;
  if new.buddy_id = new.id then raise exception 'A user cannot be their own buddy' using errcode='23514'; end if;
  select * into v_buddy from user_profiles where id = new.buddy_id;
  if v_buddy.id is null or v_buddy.tenant_id <> new.tenant_id or v_buddy.account_status not in ('active','invited') then
    raise exception 'Buddy must be an active or invited user in the same tenant' using errcode='23503';
  end if;
  if v_buddy.department_id <> new.department_id then
    raise exception 'Buddy must be in the same department' using errcode='23503';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
