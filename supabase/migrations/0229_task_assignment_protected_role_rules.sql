-- A protected role rule cannot become permissible merely because it currently
-- matches only the author or no employees; later membership must not bypass it.
set search_path=public,extensions;
do $protected_role$
declare f text; n text;
begin
  f:=pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure);
  n:=replace(f,'if v_assignee_type=''role'' then',
    $guard$if v_assignee_type='role' then
      if v_actor.user_role not in ('super_admin','admin') and v_assignee_role in ('super_admin','admin','manager') then
        raise exception 'Assigning tasks to management accounts is denied' using errcode='42501';
      end if;$guard$);
  if n=f then raise exception 'Protected role schedule boundary changed'; end if;
  execute n;
end $protected_role$;
