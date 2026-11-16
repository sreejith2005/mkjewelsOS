-- 0413: customer master database, part 6 - the full customer page and the
-- interaction page.
--
-- Owner requirement 2026-11-16: opening a customer shows every detail held
-- about them, and every timeline entry opens with every detail of that
-- interaction, down to each column of the sheet row it came from.
--
-- Two read RPCs, addressed by the codes people see (MKC-, MKI-), so any screen
-- in the app can link to a customer or an interaction. Read-only; no table
-- changes. Both require crm.view and the CRM section switch.

-- Everything about one customer: the identity card of customer_get_profile,
-- plus every answer with its history, every follow-up and appointment, the
-- products they looked at, and how many rows each sheet holds about them.
create function public.customer_get_client_page(p_client_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid; v_client customer.clients; v_code text := upper(btrim(coalesce(p_client_code, '')));
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  select * into v_client from customer.clients where tenant_id = v_tenant and client_code = v_code;
  if v_client.id is null then raise exception 'Client not found' using errcode = 'P0002'; end if;
  -- A merged client's page is the page of the client it was merged into.
  if v_client.merged_into_client_id is not null then
    select * into v_client from customer.clients where id = v_client.merged_into_client_id and tenant_id = v_tenant;
  end if;

  return public.customer_get_profile(v_client.id) || jsonb_build_object(
    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'field_key', a.field_key, 'label', a.label, 'value', a.value, 'source', a.source, 'source_label', a.source_label,
          'observed_at', a.observed_at, 'is_current', a.rn = 1, 'needs_review', a.needs_review, 'has_column', a.has_column)
        order by a.has_column desc, a.label, a.rn), '[]'::jsonb)
      from (
        select v.field_key, coalesce(pf.label, initcap(replace(v.field_key, '_', ' '))) as label, v.value, v.source, s.label as source_label,
               v.observed_at, v.needs_review, pf.field_key is not null as has_column,
               row_number() over (partition by v.field_key order by s.source_rank desc, v.observed_at desc, v.created_at desc, v.id) as rn
          from customer.client_field_values v
          join customer.sources s on s.source = v.source
          left join customer.profile_fields pf on pf.field_key = v.field_key
         where v.client_id = v_client.id) a),
    'follow_ups', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'code', f.follow_up_code, 'kind', f.kind, 'due_at', f.due_at, 'status', f.status, 'reason', f.reason,
          'assigned_to', u.employee_name, 'origin_interaction_code', o.interaction_code,
          'closed_at', f.closed_at, 'closed_by_interaction_code', c.interaction_code)
        order by (f.status = 'pending') desc, f.due_at desc), '[]'::jsonb)
      from customer.follow_ups f
      left join public.user_profiles u on u.id = f.assigned_to_user_id
      left join customer.interactions o on o.id = f.origin_interaction_id
      left join customer.interactions c on c.id = f.closed_by_interaction_id
     where f.client_id = v_client.id),
    'appointments', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'code', a.appointment_code, 'type', a.type, 'scheduled_at', a.scheduled_at, 'status', a.status,
          'branch', b.name, 'origin_interaction_code', o.interaction_code, 'visit_interaction_code', vi.interaction_code)
        order by a.scheduled_at desc), '[]'::jsonb)
      from customer.appointments a
      left join public.branches b on b.id = a.branch_id
      left join customer.interactions o on o.id = a.origin_interaction_id
      left join customer.interactions vi on vi.id = a.visit_interaction_id
     where a.client_id = v_client.id),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'code', p.product_code, 'category', p.product_category, 'interest', p.interest,
          'interaction_code', i.interaction_code, 'occurred_at', i.occurred_at)
        order by i.occurred_at desc), '[]'::jsonb)
      from customer.interaction_products p
      join customer.interactions i on i.id = p.interaction_id and i.archived_at is null
     where p.client_id = v_client.id),
    'sheet_rows', (
      select coalesce(jsonb_agg(jsonb_build_object('source', t.source, 'label', coalesce(st.label, s.label), 'rows', t.n) order by t.n desc), '[]'::jsonb)
      from (select r.source, count(*) n from customer.ingest_rows r
             where r.client_id = v_client.id and r.status <> 'removed' group by r.source) t
      join customer.sources s on s.source = t.source
      left join customer.source_tables st on st.source = t.source),
    'archived', v_client.archived_at is not null,
    'archive_reason', v_client.archive_reason);
end $$;

-- Everything about one interaction: who, when, how it ended, what it led to,
-- and every column of the sheet row it came from, in sheet order.
create function public.customer_get_interaction_page(p_interaction_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid; i customer.interactions; v_code text := upper(btrim(coalesce(p_interaction_code, '')));
  v_row customer.ingest_rows; v_sheet jsonb;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  select * into i from customer.interactions where tenant_id = v_tenant and interaction_code = v_code;
  if i.id is null then raise exception 'Interaction not found' using errcode = 'P0002'; end if;

  select * into v_row from customer.ingest_rows where id = i.source_row and tenant_id = v_tenant;
  if v_row.id is not null then
    v_sheet := jsonb_build_object(
      'source', v_row.source,
      'label', (select coalesce(st.label, s.label) from customer.sources s left join customer.source_tables st on st.source = s.source where s.source = v_row.source),
      'sheet_row', v_row.sheet_row, 'status', v_row.status, 'first_seen_at', v_row.received_at, 'changed_at', v_row.updated_at,
      'columns', coalesce(
        -- Every column the sheet has, in sheet order; a column with no value in this row is null.
        (select jsonb_agg(jsonb_build_object('header', sc.header, 'value', v_row.payload ->> sc.header, 'in_sheet', sc.in_sheet) order by sc.position, sc.header)
           from customer.source_columns sc where sc.source = v_row.source),
        -- A source without a column list: the row's own keys.
        (select jsonb_agg(jsonb_build_object('header', e.key, 'value', e.value, 'in_sheet', true) order by e.key)
           from jsonb_each_text(v_row.payload) e),
        '[]'::jsonb));
  end if;

  return jsonb_build_object(
    'interaction', jsonb_build_object(
      'interaction_id', i.id, 'interaction_code', i.interaction_code, 'occurred_at', i.occurred_at,
      'channel', i.channel, 'direction', i.direction, 'purpose', i.purpose,
      'outcome', i.outcome, 'result', i.result, 'successful', i.successful, 'non_contact_reason', i.non_contact_reason,
      'notes', i.notes, 'source', i.source, 'source_label', (select s.label from customer.sources s where s.source = i.source),
      'staff', coalesce((select u.employee_name from public.user_profiles u where u.id = i.staff_user_id), i.staff_name),
      'staff_as_written', i.staff_name,
      'assigned_by', coalesce((select u.employee_name from public.user_profiles u where u.id = i.assigned_by_user_id), i.assigned_by_name),
      'attended_by', coalesce((select u.employee_name from public.user_profiles u where u.id = i.attended_by_user_id), i.attended_by_name),
      'branch', coalesce((select b.name from public.branches b where b.id = i.branch_id), i.store_name),
      'store_as_written', i.store_name, 'contact_role', i.contact_role, 'customer_type_stated', i.customer_type_stated,
      'process_name', i.process_name, 'fms_stage', i.fms_stage, 'external_ref', i.external_ref,
      'created_at', i.created_at, 'updated_at', i.updated_at, 'archived', i.archived_at is not null, 'archive_reason', i.archive_reason),
    'client', (select jsonb_build_object('client_id', c.id, 'client_code', c.client_code, 'name', c.primary_name,
                 'phone', (select p.phone from customer.client_phones p where p.client_id = c.id and p.kind = 'primary'), 'city', c.city)
                 from customer.clients c where c.id = i.client_id),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('code', p.product_code, 'category', p.product_category, 'interest', p.interest)), '[]'::jsonb)
                   from customer.interaction_products p where p.interaction_id = i.id),
    'follow_ups_created', (select coalesce(jsonb_agg(jsonb_build_object('code', f.follow_up_code, 'kind', f.kind, 'due_at', f.due_at, 'status', f.status,
                              'reason', f.reason, 'assigned_to', u.employee_name, 'closed_by_interaction_code', c.interaction_code) order by f.due_at), '[]'::jsonb)
                             from customer.follow_ups f
                             left join public.user_profiles u on u.id = f.assigned_to_user_id
                             left join customer.interactions c on c.id = f.closed_by_interaction_id
                            where f.origin_interaction_id = i.id),
    'follow_ups_closed', (select coalesce(jsonb_agg(jsonb_build_object('code', f.follow_up_code, 'kind', f.kind, 'due_at', f.due_at,
                             'origin_interaction_code', o.interaction_code) order by f.due_at), '[]'::jsonb)
                            from customer.follow_ups f left join customer.interactions o on o.id = f.origin_interaction_id
                           where f.closed_by_interaction_id = i.id),
    'appointments_created', (select coalesce(jsonb_agg(jsonb_build_object('code', a.appointment_code, 'type', a.type, 'scheduled_at', a.scheduled_at,
                                'status', a.status, 'branch', b.name) order by a.scheduled_at), '[]'::jsonb)
                               from customer.appointments a left join public.branches b on b.id = a.branch_id
                              where a.origin_interaction_id = i.id),
    'appointments_completed', (select coalesce(jsonb_agg(jsonb_build_object('code', a.appointment_code, 'type', a.type, 'scheduled_at', a.scheduled_at) order by a.scheduled_at), '[]'::jsonb)
                                 from customer.appointments a where a.visit_interaction_id = i.id),
    'answers', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(pf.label, initcap(replace(v.field_key, '_', ' '))), 'value', v.value) order by 1), '[]'::jsonb)
                  from customer.client_field_values v left join customer.profile_fields pf on pf.field_key = v.field_key
                 where v.interaction_id = i.id),
    'sheet_row', v_sheet);
end $$;

revoke all on function public.customer_get_client_page(text) from public, anon;
revoke all on function public.customer_get_interaction_page(text) from public, anon;
grant execute on function public.customer_get_client_page(text) to authenticated, service_role;
grant execute on function public.customer_get_interaction_page(text) to authenticated, service_role;
