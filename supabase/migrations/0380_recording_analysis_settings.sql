-- Read-only analysis settings for the Sales Recording screen (follows 0379).
set search_path=public,extensions;

create function recording_analysis_settings() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); c recorder_config; begin
 if not (has_permission('developer_mode.manage') or has_permission('recording.manage_rubric')
  or (a.user_role in ('super_admin','admin','manager') and has_permission('recording.review'))) then
  raise exception 'recording_rubric_denied' using errcode='42501'; end if;
 select * into c from recorder_config where tenant_id=a.tenant_id;
 return jsonb_build_object('analysis_enabled',coalesce(c.analysis_enabled,false),'analysis_job_version',coalesce(c.analysis_job_version,'mk-sales-v1'),
  'can_configure',has_permission('developer_mode.manage'),'can_manage_versions',has_permission('recording.manage_rubric'));
end $$;
revoke all on function recording_analysis_settings() from public,anon,authenticated,service_role;
grant execute on function recording_analysis_settings() to authenticated;
notify pgrst,'reload schema';
