-- Walk-in visit drafts (owner request 2026-11-06). A walk-in form opened from the Client Queue is
-- saved as people type, so closing it (a customer interrupts, the phone locks) keeps the answers,
-- and the queue shows that the form was started but not finished. One draft per queue entry.
--
-- * The draft lives with its queue entry and follows the entry's access rule: branch staff of the
--   entry's branch, or a super admin (the entry_queue policies). The table has no direct grants;
--   reads and writes go through the functions below, which check that rule.
-- * Starting and discarding a draft are audited; the frequent autosaves overwrite the same row and
--   are not, so audit_logs is not flooded by keystrokes.
-- * A draft disappears when its queue entry is completed (any path: linked form, standard form),
--   and with the entry itself.
set search_path=public,extensions;

create table public.walkin_visit_drafts (
  entry_queue_id uuid primary key references public.entry_queue(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  form_family_id uuid not null,
  form_version integer not null check (form_version > 0),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 131072),
  -- Browser-generated ids the visit will use (proposed client/timeline ids, submission key), so a
  -- resumed form keeps photo paths and replay protection.
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4096),
  started_by uuid not null references public.users(id),
  started_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now()
);
create index walkin_visit_drafts_branch_idx on public.walkin_visit_drafts(branch_id, updated_at desc);

alter table public.walkin_visit_drafts enable row level security;
-- Same rule as the queue entry; only the functions below (security definer) touch the table.
create policy walkin_visit_drafts_branch_staff on public.walkin_visit_drafts to authenticated
  using (public.is_branch_staff(branch_id) or public.is_super_admin())
  with check (public.is_branch_staff(branch_id) or public.is_super_admin());
revoke all on public.walkin_visit_drafts from public, anon, authenticated;

-- The pending queue entry the caller may work on, or an error.
create function crm_private.walkin_draft_entry(p_entry_queue_id uuid)
returns public.entry_queue language plpgsql stable security definer set search_path='' as $$
declare entry public.entry_queue;
begin
  if public.current_crm_user_id() is null or public.current_user_role() is null then
    raise exception 'Active CRM access required' using errcode='42501';
  end if;
  select * into entry from public.entry_queue where id=p_entry_queue_id;
  if entry.id is null or not (public.is_branch_staff(entry.branch_id) or public.is_super_admin()) then
    raise exception 'Queue entry not found' using errcode='42501';
  end if;
  return entry;
end $$;
revoke all on function crm_private.walkin_draft_entry(uuid) from public, anon, authenticated, service_role;

-- Saves (creates or overwrites) the draft for a pending queue entry.
create function public.save_walkin_visit_draft(p_entry_queue_id uuid, p_form_family_id uuid, p_form_version integer, p_answers jsonb, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; entry public.entry_queue; saved_started timestamptz; saved_updated timestamptz; created boolean;
begin
  entry:=crm_private.walkin_draft_entry(p_entry_queue_id);
  actor:=public.current_crm_user_id();
  if entry.status='complete' then raise exception 'This walk-in visit was already submitted' using errcode='55000'; end if;
  if p_form_family_id is null or coalesce(p_form_version,0)<1 then raise exception 'Form version required' using errcode='22023'; end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text)>131072 then raise exception 'Invalid draft answers' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_meta,'{}'::jsonb)) is distinct from 'object' or octet_length(coalesce(p_meta,'{}'::jsonb)::text)>4096 then raise exception 'Invalid draft details' using errcode='22023'; end if;
  insert into public.walkin_visit_drafts as d(entry_queue_id,branch_id,form_family_id,form_version,answers,meta,started_by,updated_by)
  values (entry.id,entry.branch_id,p_form_family_id,p_form_version,p_answers,coalesce(p_meta,'{}'::jsonb),actor,actor)
  on conflict (entry_queue_id) do update set form_family_id=excluded.form_family_id, form_version=excluded.form_version,
    answers=excluded.answers, meta=excluded.meta, updated_by=excluded.updated_by, updated_at=now()
  returning d.started_at, d.updated_at, (d.xmax=0) into saved_started, saved_updated, created;
  if created then
    perform crm_private.write_audit_log('crm.walkin_draft_started', entry.id, jsonb_build_object('branch_id',entry.branch_id,'form_family_id',p_form_family_id,'form_version',p_form_version));
  end if;
  return jsonb_build_object('entry_queue_id',entry.id,'updated_at',saved_updated,'started_at',saved_started);
end $$;

-- The draft of one queue entry (null when none).
create function public.get_walkin_visit_draft(p_entry_queue_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare entry public.entry_queue;
begin
  entry:=crm_private.walkin_draft_entry(p_entry_queue_id);
  return (select jsonb_build_object('entry_queue_id',d.entry_queue_id,'form_family_id',d.form_family_id,'form_version',d.form_version,
      'answers',d.answers,'meta',d.meta,'started_at',d.started_at,'updated_at',d.updated_at,
      'started_by_name',starter.name,'updated_by_name',editor.name)
    from public.walkin_visit_drafts d
    left join public.users starter on starter.id=d.started_by
    left join public.users editor on editor.id=d.updated_by
    where d.entry_queue_id=entry.id);
end $$;

-- Who started which queue entry's form and when, for the queue rows the caller can see.
create function public.get_walkin_visit_draft_markers(p_entry_queue_ids uuid[])
returns table(entry_queue_id uuid, started_by_name text, updated_by_name text, started_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_crm_user_id() is null or public.current_user_role() is null then
    raise exception 'Active CRM access required' using errcode='42501';
  end if;
  if coalesce(cardinality(p_entry_queue_ids),0)>200 then raise exception 'Too many queue entries' using errcode='22023'; end if;
  return query
    select d.entry_queue_id, starter.name::text, editor.name::text, d.started_at, d.updated_at
      from public.walkin_visit_drafts d
      join public.entry_queue q on q.id=d.entry_queue_id and q.status<>'complete'
      left join public.users starter on starter.id=d.started_by
      left join public.users editor on editor.id=d.updated_by
     where d.entry_queue_id=any(coalesce(p_entry_queue_ids,'{}'))
       and (public.is_branch_staff(d.branch_id) or public.is_super_admin())
     order by d.entry_queue_id;
end $$;

-- "Start over": removes the draft (the queue entry stays waiting).
create function public.discard_walkin_visit_draft(p_entry_queue_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare entry public.entry_queue; removed integer;
begin
  entry:=crm_private.walkin_draft_entry(p_entry_queue_id);
  delete from public.walkin_visit_drafts where entry_queue_id=entry.id;
  get diagnostics removed = row_count;
  if removed>0 then perform crm_private.write_audit_log('crm.walkin_draft_discarded', entry.id, jsonb_build_object('branch_id',entry.branch_id)); end if;
  return removed>0;
end $$;

-- A completed queue entry has no draft any more, whichever form completed it.
create function crm_private.clear_walkin_draft_on_complete()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.walkin_visit_drafts where entry_queue_id=new.id;
  return new;
end $$;
revoke all on function crm_private.clear_walkin_draft_on_complete() from public, anon, authenticated, service_role;
create trigger entry_queue_clear_walkin_draft after update of status on public.entry_queue
  for each row when (new.status='complete' and old.status is distinct from 'complete')
  execute function crm_private.clear_walkin_draft_on_complete();

revoke all on function public.save_walkin_visit_draft(uuid,uuid,integer,jsonb,jsonb) from public, anon, service_role;
revoke all on function public.get_walkin_visit_draft(uuid) from public, anon, service_role;
revoke all on function public.get_walkin_visit_draft_markers(uuid[]) from public, anon, service_role;
revoke all on function public.discard_walkin_visit_draft(uuid) from public, anon, service_role;
grant execute on function public.save_walkin_visit_draft(uuid,uuid,integer,jsonb,jsonb) to authenticated;
grant execute on function public.get_walkin_visit_draft(uuid) to authenticated;
grant execute on function public.get_walkin_visit_draft_markers(uuid[]) to authenticated;
grant execute on function public.discard_walkin_visit_draft(uuid) to authenticated;

notify pgrst,'reload schema';
