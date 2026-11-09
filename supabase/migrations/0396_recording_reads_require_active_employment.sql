-- 0396: direct reads of recording rows follow the same active-employment rule as
-- the recording RPCs.
--
-- recorder_actor() (the gate of every recording RPC since 0377) requires
-- working_status = 'active'. The RLS read policies on recorder_sessions and
-- recorder_devices, and through them recorder_segments and recorder_alerts, use
-- recorder_can_read(), which applied only the platform-wide
-- current_profile_is_active() (login on, account active, not resigned). A reviewer
-- of the branch who was 'inactive', 'on_leave' or 'half_day' could therefore read
-- those rows with a direct table select while every recording RPC refused them.
--
-- recorder_can_read() was created in 0377 and rewritten in place by 0387 (own
-- store, or company scope). This migration patches the live definition the same
-- way and adds only the working-status condition, so the 0387 company-scope rule
-- is kept. It refuses to run if the definition is not the expected shape.
--
-- Every RPC that calls recorder_can_read() has already passed recorder_actor(), so
-- this changes direct reads only. Same signature, owner, grants and search_path.
-- No data is changed and no table, policy or type is added.
do $$
declare v_body text; v_count integer;
begin
  v_body := replace(pg_get_functiondef('public.recorder_can_read(uuid,uuid,uuid)'::regprocedure), E'\r', '');
  v_count := (select count(*) from regexp_matches(v_body, 'current_profile_is_active\(\) and ', 'g'));
  if v_count <> 1 or position('working_status' in v_body) > 0 or position('org_has_company_scope' in v_body) = 0 then
    raise exception '0396: unexpected recorder_can_read definition (% matches)', v_count;
  end if;
  execute replace(v_body, 'current_profile_is_active() and ', 'current_profile_is_active() and a.working_status=''active'' and ');
  v_body := pg_get_functiondef('public.recorder_can_read(uuid,uuid,uuid)'::regprocedure);
  if position('a.working_status=''active''' in v_body) = 0 or position('org_has_company_scope' in v_body) = 0 then
    raise exception '0396: recorder_can_read patch did not apply';
  end if;
end $$;
