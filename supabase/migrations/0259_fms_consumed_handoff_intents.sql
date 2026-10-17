set search_path=public,extensions;
create index fms_assignment_decisions_manual_source on fms_stage_assignment_decisions(source_instance_stage_id,target_stage_id) where assignment_method='manual_handoff';
-- A durable decision is the receipt for a consumed choice. Preserve the
-- intent for audit, but never apply it to another visit of the same step.
do $$
declare f text; n text;
begin
 f:=replace(pg_get_functiondef('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[])'::regprocedure),E'\r','');
 n:=replace(f,'where pending.target_stage_id=target.id and pending.fms_instance_id=i.id',
 $patch$where pending.target_stage_id=target.id and pending.fms_instance_id=i.id
        and not exists(select 1 from fms_stage_assignment_decisions receipt where receipt.source_instance_stage_id=pending.source_instance_stage_id and receipt.target_stage_id=pending.target_stage_id and receipt.assignment_method='manual_handoff')$patch$);
 if n=f then raise exception 'Handoff intent receipt marker changed'; end if;
 execute n;
end $$;
notify pgrst,'reload schema';
