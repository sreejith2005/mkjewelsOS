-- BEFORE DELETE triggers must return OLD. The original immutable-version
-- trigger returned NEW for drafts, which silently cancelled every draft
-- deletion even when an authorized RPC requested it.
create or replace function enforce_form_template_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.lifecycle in ('published', 'archived') then
      raise exception 'Published and archived form definitions are immutable; create a revision' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.lifecycle in ('published', 'archived') then
    if old.lifecycle = 'published' and new.lifecycle = 'archived'
       and (to_jsonb(new) - array['lifecycle','is_active','archived_by','archived_at','updated_by','updated_at'])
         = (to_jsonb(old) - array['lifecycle','is_active','archived_by','archived_at','updated_by','updated_at']) then
      return new;
    end if;
    raise exception 'Published and archived form definitions are immutable; create a revision' using errcode = '55000';
  end if;
  return new;
end;
$$;
