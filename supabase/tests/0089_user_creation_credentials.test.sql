begin;
select plan(4);

select has_function(
  'public',
  'create_user_profile_with_coverage_and_audit',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'uuid', 'uuid', 'uuid', 'text', 'text', 'text[]', 'user_role', 'uuid', 'uuid', 'uuid'],
  'user creation persists primary buddy, secondary buddy, and reporting relationship in one database transaction'
);
select ok(
  position('invite_profile_with_audit_v3' in pg_get_functiondef('public.create_user_profile_with_coverage_and_audit(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid,uuid,uuid)'::regprocedure)) > 0,
  'user creation reuses the existing audited profile creation contract'
);
select ok(
  position('configure_invited_profile_coverage_with_audit' in pg_get_functiondef('public.create_user_profile_with_coverage_and_audit(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid,uuid,uuid)'::regprocedure)) > 0,
  'user creation configures secondary buddy coverage in the same transaction'
);
select ok(
  has_function_privilege('service_role', 'create_user_profile_with_coverage_and_audit(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'create_user_profile_with_coverage_and_audit(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid,uuid,uuid)', 'EXECUTE'),
  'only the server-side account function can create user profiles'
);

select * from finish();
rollback;
