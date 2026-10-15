-- Account creation already accepts users.manage in the Edge Function. Apply
-- the same resolver inside its service-only, audited database contracts.
do $$ declare body text; old_text text; begin
 select pg_get_functiondef('public.invite_profile_with_audit_v3(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],public.user_role,uuid)'::regprocedure) into body;
 old_text := 'v_creator.id is null or v_creator.user_role not in (''super_admin'',''admin'') or v_creator.is_login_enabled is not true';
 if position(old_text in body)=0 then raise exception 'Invite authorization contract changed'; end if;
 body:=replace(body,old_text,'v_creator.id is null or not public.permission_effective_for(v_creator.id,''users.manage'') or v_creator.is_login_enabled is not true or v_creator.account_status<>''active'' or v_creator.working_status=''resigned''');
 old_text := 'v_creator.user_role=''admin'' and p_user_role=''super_admin''';
 if position(old_text in body)=0 then raise exception 'Invite protected account contract changed'; end if;
 body:=replace(body,old_text,'not public.permission_effective_for(v_creator.id,''permissions.manage'') and p_user_role=''super_admin''');
 body:=replace(body,'Admin cannot create super_admin users','Only Super Admin authority can create super_admin users');
 execute body;

 select pg_get_functiondef('public.configure_invited_profile_coverage_with_audit(uuid,uuid,uuid,uuid)'::regprocedure) into body;
 old_text := 'v_creator.id is null or v_creator.user_role not in (''super_admin'',''admin'') or v_creator.account_status<>''active''';
 if position(old_text in body)=0 then raise exception 'Invited coverage authorization contract changed'; end if;
 body:=replace(body,old_text,'v_creator.id is null or not public.permission_effective_for(v_creator.id,''users.manage'') or v_creator.account_status<>''active'' or v_creator.is_login_enabled is not true or v_creator.working_status=''resigned''');
 old_text := 'v_old.id is null or v_old.tenant_id<>v_creator.tenant_id';
 if position(old_text in body)=0 then raise exception 'Invited coverage tenant contract changed'; end if;
 body:=replace(body,old_text,'v_old.id is null or v_old.tenant_id<>v_creator.tenant_id or ((v_old.user_role=''super_admin'' or public.permission_effective_for(v_old.id,''permissions.manage'')) and not public.permission_effective_for(v_creator.id,''permissions.manage''))');
 execute body;

 -- Protected account targets include both assigned and effective Super Admins.
 select pg_get_functiondef('public.update_user_profile_with_audit(uuid,jsonb)'::regprocedure) into body;
 old_text := 'v_actor.user_role<>''super_admin'' and v_old.user_role=''super_admin''';
 if position(old_text in body)=0 then raise exception 'User editor protected target contract changed'; end if;
 execute replace(body,old_text,'v_actor.user_role<>''super_admin'' and (v_old.user_role=''super_admin'' or public.permission_effective_for(v_old.id,''permissions.manage''))');

 select pg_get_functiondef('public.prepare_unused_user_deletion(uuid)'::regprocedure) into body;
 old_text := 'v_target.user_role = ''super_admin'' and v_actor.user_role <> ''super_admin''';
 if position(old_text in body)=0 then raise exception 'User deletion protected target contract changed'; end if;
 execute replace(body,old_text,'(v_target.user_role = ''super_admin'' or public.permission_effective_for(v_target.id,''permissions.manage'')) and v_actor.user_role <> ''super_admin''');
end $$;

-- Managing accounts requires the full tenant directory for eligible buddies
-- and reporting relationships. Other viewers keep their original data scope.
alter policy up_select on public.user_profiles using (
 (select public.current_profile_is_active()) and (
  auth_user_id=auth.uid()
  or (tenant_id=(select public.current_tenant_id()) and (
    (select public.current_role_level()) in ('super_admin','admin','hr')
    or (select public.has_permission('users.manage')) or (select public.has_permission('users.delete'))))
  or ((select public.current_role_level())='manager' and tenant_id=(select public.current_tenant_id())
    and (select public.is_reporting_descendant((select (public.current_profile()).id),id)))
 )
);
notify pgrst,'reload schema';
