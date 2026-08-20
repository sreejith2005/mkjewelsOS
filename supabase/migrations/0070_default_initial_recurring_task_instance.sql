-- The first task must not depend on the browser shipping the optional initial
-- datetime. This also protects managers using a cached web bundle: a new
-- recurring schedule always sends its first assigned task immediately.
do $reconcile$
declare v_definition text;
begin
  select pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure)
    into v_definition;

  if position('if v_initial_planned_datetime is null and p_template_id is null then' in v_definition) = 0 then
    v_definition := replace(v_definition,
      $old$  if v_initial_planned_datetime is not null and not isfinite(v_initial_planned_datetime) then
    raise exception 'Initial planned datetime must be finite' using errcode = '22023';
  end if;$old$,
      $new$  if v_initial_planned_datetime is not null and not isfinite(v_initial_planned_datetime) then
    raise exception 'Initial planned datetime must be finite' using errcode = '22023';
  end if;
  if v_initial_planned_datetime is null and p_template_id is null then
    v_initial_planned_datetime := (
      ((now() at time zone 'Asia/Kolkata')::date + v_planned_time)
      at time zone 'Asia/Kolkata'
    );
  end if;$new$);
    execute v_definition;
  end if;
end $reconcile$;

revoke all on function save_task_template_with_audit(uuid,jsonb) from public;
grant execute on function save_task_template_with_audit(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
