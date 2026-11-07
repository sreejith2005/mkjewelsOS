-- CRM client archive and restore (MK1 audit 2026-11-07).
--
-- Before: a CRM Super Admin could DELETE a client row directly through the
-- API (policy super_admin_all + table grant). No screen used it, and the
-- delete cascaded away the client's timeline, documents, edit log, phone
-- index, follow-ups and given referrals. There was no recoverable way to
-- remove a client from the Client Database.
--
-- After:
--   * archive_client / restore_client (CRM Super Admin, reason required,
--     audited in crm_private.audit_logs). Nothing is deleted: visits, leads,
--     follow-ups, referrals, documents, FMS links and history stay.
--   * An archived client is hidden from the Client Database list
--     (browse_crm_records, browse_crm_records_page); the filter
--     {"archived":"only"} lists archived clients so they can be restored.
--     Phone lookups, search and walk-in registration still find them, so an
--     archived customer who returns is never registered twice.
--   * Archive columns change only through these functions. Other details
--     and new visits still save for an archived client (a returning
--     customer's walk-in must never fail); the profile shows it as archived
--     until a Super Admin restores it.
--   * Browsers can no longer DELETE client rows. Server functions (merges,
--     sync) are unaffected.

alter table public.clients
  add column archived_at timestamptz,
  add column archived_by uuid references public.users(id),
  add column archive_reason text check (archive_reason is null or length(archive_reason) <= 500);

create index clients_archived_at_idx on public.clients (archived_at) where archived_at is not null;

-- Direct REST writes run as `authenticated`; the functions below (security
-- definer) and server jobs do not.
create function crm_private.guard_client_archive()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' and (new.archived_at is not null or new.archived_by is not null or new.archive_reason is not null) then
      raise exception 'A new client cannot be archived' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if (new.archived_at, new.archived_by, new.archive_reason) is distinct from (old.archived_at, old.archived_by, old.archive_reason) then
        raise exception 'Use Archive client or Restore client' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger clients_aa_archive_guard before insert or update on public.clients
  for each row execute function crm_private.guard_client_archive();

revoke delete on table public.clients from authenticated, anon;

create function public.archive_client(p_client_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_client public.clients; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_super_admin() then
    raise exception 'Only a CRM Super Admin can archive clients' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'Give a reason (at least 3 characters)' using errcode = '22023';
  end if;
  select * into v_client from public.clients where client_id = p_client_id for update;
  if v_client.client_id is null then raise exception 'client not found' using errcode = 'P0002'; end if;
  if v_client.archived_at is not null then raise exception 'This client is already archived' using errcode = '22023'; end if;
  update public.clients
     set archived_at = now(), archived_by = public.current_crm_user_id(), archive_reason = left(v_reason, 500)
   where client_id = p_client_id;
  perform crm_private.write_audit_log('crm.archive_client', p_client_id,
    jsonb_build_object('client_code', v_client.client_code, 'branch_id', v_client.last_branch_id, 'reason', left(v_reason, 500)));
end $$;

create function public.restore_client(p_client_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_client public.clients;
begin
  if not public.is_super_admin() then
    raise exception 'Only a CRM Super Admin can restore clients' using errcode = '42501';
  end if;
  select * into v_client from public.clients where client_id = p_client_id for update;
  if v_client.client_id is null then raise exception 'client not found' using errcode = 'P0002'; end if;
  if v_client.archived_at is null then raise exception 'This client is not archived' using errcode = '22023'; end if;
  update public.clients set archived_at = null, archived_by = null, archive_reason = null where client_id = p_client_id;
  perform crm_private.write_audit_log('crm.restore_client', p_client_id,
    jsonb_build_object('client_code', v_client.client_code, 'archived_at', v_client.archived_at,
                       'archive_reason', v_client.archive_reason, 'reason', left(coalesce(p_reason, ''), 500)));
end $$;

-- The client profile's archive banner and buttons.
create function public.get_client_archive_state(p_client_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.current_user_role() is null then null else (
    select jsonb_build_object(
      'archived', c.archived_at is not null,
      'archived_at', c.archived_at,
      'archive_reason', c.archive_reason,
      'archived_by_name', u.name,
      'can_archive', public.is_super_admin())
    from public.clients c left join public.users u on u.id = c.archived_by
    where c.client_id = p_client_id) end;
$$;

revoke all on function public.archive_client(uuid, text), public.restore_client(uuid, text),
  public.get_client_archive_state(uuid) from public, anon;
grant execute on function public.archive_client(uuid, text), public.restore_client(uuid, text),
  public.get_client_archive_state(uuid) to authenticated;

-- Client Database lists: archived clients only with {"archived":"only"}.
create function pg_temp.crm_archive_patch(p_signature text, p_old text, p_new text)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_signature::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> 1 then raise exception 'archive patch: expected 1 match in %, found %', p_signature, found; end if;
  execute replace(body, p_old, p_new);
end $$;
select pg_temp.crm_archive_patch('public.browse_crm_records_page(jsonb,integer,integer)',
  'where (select public.current_user_role()) is not null',
  'where (select public.current_user_role()) is not null and (case when $1->>''archived''=''only'' then c.archived_at is not null else c.archived_at is null end)');
select pg_temp.crm_archive_patch('public.browse_crm_records(jsonb,integer,integer)',
  'where (select public.current_user_role()) is not null',
  'where (select public.current_user_role()) is not null and (case when $1->>''archived''=''only'' then c.archived_at is not null else c.archived_at is null end)');
drop function pg_temp.crm_archive_patch(text, text, text);

notify pgrst, 'reload schema';
