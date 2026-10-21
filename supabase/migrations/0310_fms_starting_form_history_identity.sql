-- The initial runtime visit records the same action as its completed starter.
-- Use the existing completed-runtime identity shared by legacy history and details.
-- Pending starters and completed starters without that exact runtime stay intact.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure);
 amended:=replace(definition,'and s.status in (''pending'',''completed'')',
 $patch$and (s.status='pending' or s.status='completed' and not exists(
   select 1 from fms_instances started join fms_instance_stages visit on visit.fms_instance_id=started.id
   where started.tenant_id=s.tenant_id and started.fms_flow_id=s.fms_flow_id
    and started.context->>'starter_assignment_id'=s.id::text
    and visit.fms_stage_id=s.fms_stage_id and visit.status='completed' and visit.visit_number=1
    and a.id=any(visit.assigned_to) and visit.form_submission_id is not null
    and visit.form_submission_id::text=started.context->>'form_submission_id'
    and can_read_fms_work_context(visit.id)))$patch$);
 if amended=definition then raise exception 'Review completed FMS starter identity'; end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
