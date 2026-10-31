-- Include timeline-only clients in audited projection recovery; do not invent forms.
do $$ declare body text; old_lock text; old_loop text; begin
 body:=replace(pg_get_functiondef('public.crm_reconcile_saved_walkins(boolean,uuid)'::regprocedure),E'\r','');
 old_lock:='exists(select 1 from public.client_timeline t join public.visit_forms f on f.client_timeline_id=t.id where t.client_id=c.client_id)';
 old_loop:=' for r in select t.id as timeline_id';
 if strpos(body,old_lock)=0 or strpos(body,old_loop)=0 then raise exception 'Unrecognized historical recovery'; end if;
 body:=replace(body,old_lock,'exists(select 1 from public.client_timeline t where t.client_id=c.client_id)');
 body:=replace(body,old_loop,$patch$ select coalesce(array_agg(distinct t.client_id),array[]::uuid[]) into affected from public.client_timeline t where p_client_id is null or t.client_id=p_client_id;
 for r in select t.id as timeline_id$patch$);
 execute body;
end $$;
notify pgrst,'reload schema';
