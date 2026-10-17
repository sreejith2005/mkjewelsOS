set search_path=public,extensions;

-- A table joined to a volatile starter is read using the calling statement's
-- snapshot, which cannot see rows inserted inside that starter. Read its
-- returned identity first, then load the durable instance in a new statement.
do $$
declare definition text; patched text;
begin
  definition:=replace(pg_get_functiondef('transition_fms_work_with_audit(jsonb,uuid,jsonb,text)'::regprocedure),E'\r','');
  patched:=replace(definition,
    'select instance.* into i from start_fms_from_exact_form_submission(submission_id,(p_request->>''flowId'')::uuid,p_handoffs) started join fms_instances instance on instance.id=started.instance_id;',
    'select started.instance_id into target_id from start_fms_from_exact_form_submission(submission_id,(p_request->>''flowId'')::uuid,p_handoffs) started; select instance.* into i from fms_instances instance where instance.id=target_id;');
  if patched=definition then raise exception 'Exact start dispatch changed; review the visibility repair'; end if;
  execute patched;
end $$;
notify pgrst,'reload schema';
