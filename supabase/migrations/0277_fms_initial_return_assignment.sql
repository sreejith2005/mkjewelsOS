set search_path=public,extensions;
do $$
declare f text; n text; marker text;
begin
 f:=replace(pg_get_functiondef('assert_fms_assignment_publishable_before_display(uuid)'::regprocedure),E'\r','');
 marker:='or s.id=(select id from fms_stages where fms_flow_id=f.id order by sort_order,id limit 1)';
 n:=replace(f,marker,$patch$or (s.id=(select id from fms_stages where fms_flow_id=f.id order by sort_order,id limit 1)
      and not exists(select 1 from fms_stages incoming where incoming.fms_flow_id=f.id and (
        incoming.default_next_stage_id=s.id or s.id=any(incoming.parallel_target_stage_ids)
        or exists(select 1 from fms_branch_rules route where route.fms_stage_id=incoming.id and route.next_stage_id=s.id))))$patch$);
 if n=f then raise exception 'Initial assignment publication marker changed'; end if;
 execute n;
end $$;
notify pgrst,'reload schema';
