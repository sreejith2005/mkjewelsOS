begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(9);

-- The column is editor-only metadata: nullable, so every existing stage stays valid.
select has_column('public','fms_stages','canvas_position','stages carry canvas coordinates');
select col_is_null('public','fms_stages','canvas_position','a stage without saved coordinates remains valid');
select col_type_is('public','fms_stages','canvas_position','jsonb','coordinates are stored as jsonb');

-- The runtime must never consider layout when choosing the next stage.
select ok((select pg_get_functiondef('activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer)'::regprocedure) not like '%canvas_position%'),'stage activation ignores canvas coordinates');
select ok((select pg_get_functiondef('complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure) not like '%canvas_position%'),'stage completion ignores canvas coordinates');

-- Authoring persists and carries the layout forward.
select ok((select pg_get_functiondef('save_fms_flow_draft_with_audit(uuid,jsonb,jsonb)'::regprocedure) like '%canvas_position%'),'saving a draft persists the canvas layout');
select ok((select pg_get_functiondef('create_fms_revision_with_audit(uuid)'::regprocedure) like '%v_stage.canvas_position%'),'a new revision inherits the canvas layout');

-- The shape check rejects malformed coordinates without blocking a null.
create temporary table canvas_probe(value jsonb) on commit drop;
insert into canvas_probe values ('{"x":120,"y":48}'::jsonb), (null);
select is((select count(*)::integer from canvas_probe), 2, 'a well-formed point and a null are both acceptable shapes');
select ok(
  not (jsonb_typeof('{"x":"120","y":48}'::jsonb->'x') = 'number'),
  'a string coordinate is not a number and is rejected by the column check'
);

select * from finish();
rollback;
