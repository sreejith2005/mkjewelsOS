begin;
select plan(3);

select ok(
  position('requires_form' in pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure)) > 0,
  'delegation task RPC accepts the linked-form requirement flag'
);
select ok(
  position('form_template_id' in pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure)) > 0,
  'delegation task RPC accepts a linked form identifier'
);
select ok(
  position('Required form is invalid, inactive, or inconsistent' in pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure)) > 0,
  'delegation task RPC validates linked forms server-side'
);

select * from finish();
rollback;
