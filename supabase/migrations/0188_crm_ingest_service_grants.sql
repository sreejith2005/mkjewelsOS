-- CRM Phase 4: the narrow service_role contract behind the crm-walkin-ingest Edge Function.
--
-- The original POST /api/ingest/walkin used Prisma raw SQL with the database owner
-- connection. The Edge Function instead calls only the RPCs below with the service key;
-- service_role receives no table privilege in schema crm.
--
--   crm.consume_legacy_walkin_ingest_rate_limit(text)   existing (0183), now granted
--   crm.legacy_walkin_ingest_log_attempt(...)            ledger row for outcomes decided
--                                                        before the database write
--   crm.legacy_walkin_ingest_submit(...)                 branch lookup + visit + ledger row
--                                                        + audit in ONE transaction
--
-- crm.submit_legacy_walkin_visit and crm.submit_walkin_visit stay owner-only; the submit
-- RPC reaches them as its owner. Both new RPCs are SECURITY DEFINER, EXECUTE service_role
-- only. Audit rows never contain payload values (names, phones, addresses): only the
-- request id, outcome and result code.

grant usage on schema crm to service_role;

-- The ledger insert shared by both RPCs. Not callable by any API role.
create function crm_private.record_legacy_walkin_attempt(
  p_request_id uuid,
  p_source_ip text,
  p_payload jsonb,
  p_payload_hash text,
  p_outcome text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_request_id is null
     or p_outcome is null
     or p_outcome not in ('unauthorized', 'payload_too_large', 'rate_limited', 'invalid_json',
                          'invalid_payload', 'rejected_files', 'invalid_branch', 'success', 'failed') then
    raise exception 'Invalid legacy walk-in ingest attempt' using errcode = '22023';
  end if;

  insert into crm.legacy_walkin_ingest_attempts (request_id, source_ip, payload, payload_hash, outcome, result)
  values (
    p_request_id, left(p_source_ip, 64), coalesce(p_payload, '{}'::jsonb),
    left(p_payload_hash, 64), p_outcome, coalesce(p_result, '{}'::jsonb)
  );

  -- An unauthenticated caller can create ledger rows (as in the original) but must not be
  -- able to fill the tenant audit trail, so 'unauthorized' stays ledger-only.
  if p_outcome <> 'unauthorized' then
    perform crm_private.write_audit_log(
      'crm.legacy_walkin_ingest_attempt', null,
      jsonb_build_object('request_id', p_request_id, 'outcome', p_outcome, 'code', p_result ->> 'code')
    );
  end if;
end
$$;

create function crm.legacy_walkin_ingest_log_attempt(
  p_request_id uuid,
  p_source_ip text,
  p_payload jsonb,
  p_payload_hash text,
  p_outcome text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform crm_private.record_legacy_walkin_attempt(p_request_id, p_source_ip, p_payload, p_payload_hash, p_outcome, p_result);
end
$$;

-- Returns the ledger result: {code: INGESTED, clientId, timelineId, referenceNumber},
-- {code: INVALID_BRANCH} or {code: INGEST_FAILED, sqlstate}. The visit, its ledger row
-- and the audit rows commit or roll back together, except that a failed visit rolls back
-- alone (subtransaction) and is still recorded as 'failed', as the original recorded it.
create function crm.legacy_walkin_ingest_submit(
  p_request_id uuid,
  p_source_ip text,
  p_branch_name text,
  p_payload jsonb,
  p_audit_payload jsonb,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
  v_saved record;
  v_result jsonb;
  v_state text;
begin
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid legacy walk-in ingest request' using errcode = '22023';
  end if;

  -- Same lookup as the original: an ACTIVE branch whose name matches case-insensitively.
  if length(trim(coalesce(p_branch_name, ''))) > 0 then
    select b.id into v_branch
    from crm.branches as b
    where b.active and lower(b.name) = lower(p_branch_name)
    order by b.id
    limit 1;
  end if;
  if v_branch is null then
    v_result := jsonb_build_object('code', 'INVALID_BRANCH');
    perform crm_private.record_legacy_walkin_attempt(p_request_id, p_source_ip, p_audit_payload, p_payload_hash, 'invalid_branch', v_result);
    return v_result;
  end if;

  begin
    select * into v_saved
    from crm.submit_legacy_walkin_visit(jsonb_set(p_payload, '{branch_id}', to_jsonb(v_branch::text)));
    if v_saved.client_id is null then
      raise exception 'The database did not return an ingestion result.';
    end if;
    v_result := jsonb_build_object(
      'code', 'INGESTED', 'clientId', v_saved.client_id,
      'timelineId', v_saved.timeline_id, 'referenceNumber', v_saved.reference_number
    );
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_result := jsonb_build_object('code', 'INGEST_FAILED');
    perform crm_private.record_legacy_walkin_attempt(p_request_id, p_source_ip, p_audit_payload, p_payload_hash, 'failed', v_result);
    return v_result || jsonb_build_object('sqlstate', v_state);
  end;

  -- A ledger outage must not replace a saved visit's result (original behaviour).
  begin
    perform crm_private.record_legacy_walkin_attempt(p_request_id, p_source_ip, p_audit_payload, p_payload_hash, 'success', v_result);
  exception when others then
    raise warning 'Could not log legacy walk-in ingestion attempt %', p_request_id;
  end;
  return v_result;
end
$$;

revoke all on function crm_private.record_legacy_walkin_attempt(uuid, text, jsonb, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function crm.legacy_walkin_ingest_log_attempt(uuid, text, jsonb, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function crm.legacy_walkin_ingest_submit(uuid, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;

grant execute on function
  crm.consume_legacy_walkin_ingest_rate_limit(text),
  crm.legacy_walkin_ingest_log_attempt(uuid, text, jsonb, text, text, jsonb),
  crm.legacy_walkin_ingest_submit(uuid, text, text, jsonb, jsonb, text)
to service_role;
