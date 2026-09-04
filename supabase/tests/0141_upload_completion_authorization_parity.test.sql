begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(6);

-- Both upload-completion contracts must authorize the same actors as
-- update_task_with_audit, or an Upload button the UI renders is refused on
-- every single retry.
select ok(
  position('super_admin' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) > 0,
  'the atomic upload completion accepts elevated actors'
);
select ok(
  position('super_admin' in pg_get_functiondef('public.complete_recurring_task_with_image_with_audit(uuid,text)'::regprocedure)) > 0,
  'the recurring image completion accepts elevated actors'
);

-- A completed occurrence must carry its on-time verdict and re-enter its
-- verifier's queue, or uploaded work still looks stalled to everyone watching.
select ok(
  position('on_time_status' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) > 0
  and position('verification_status' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) > 0
  and position('completion_mode' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) > 0,
  'the atomic upload completion records the full completion bookkeeping'
);
select ok(
  position('on_time_status' in pg_get_functiondef('public.complete_recurring_task_with_image_with_audit(uuid,text)'::regprocedure)) > 0
  and position('verification_status' in pg_get_functiondef('public.complete_recurring_task_with_image_with_audit(uuid,text)'::regprocedure)) > 0
  and position('completion_mode' in pg_get_functiondef('public.complete_recurring_task_with_image_with_audit(uuid,text)'::regprocedure)) > 0,
  'the recurring image completion records the full completion bookkeeping'
);

select function_privs_are(
  'public','complete_uploaded_task_with_audit',array['uuid','text'],'authenticated',array['EXECUTE'],
  'the atomic upload completion stays an authenticated-only protected RPC'
);
select function_privs_are(
  'public','complete_recurring_task_with_image_with_audit',array['uuid','text'],'authenticated',array['EXECUTE'],
  'the recurring image completion stays an authenticated-only protected RPC'
);

select * from finish();
rollback;
