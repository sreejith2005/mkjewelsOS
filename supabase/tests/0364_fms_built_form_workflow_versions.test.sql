begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;

-- One workflow saved three times (v1 archived, v2 published, v3 draft) and a
-- second workflow never published (an archived v1 and a draft v2). Every version's step built one form.
create temporary table version_fixture(name text primary key,id uuid);
grant all on version_fixture to authenticated;
do $$
declare t uuid:=(select id from visit_assignment_fixture where name='tenant'); u uuid:=(select id from visit_assignment_fixture where name='a');
  f uuid; g uuid; fam uuid:=gen_random_uuid(); draft_fam uuid:=gen_random_uuid(); flow uuid; v int; s text;
begin
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by,library_visible)
    values(t,'Negotiation questions',1,'published',true,u,u,false) returning id into f;
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by,library_visible)
    values(t,'Draft-only questions',1,'published',true,u,u,false) returning id into g;
  insert into version_fixture values('form_family',(select family_id from form_templates where id=f)),
    ('draft_form_family',(select family_id from form_templates where id=g)),('flow_family',fam),('draft_flow_family',draft_fam);
  foreach s in array array['archived','published','draft'] loop
    v:=coalesce(v,0)+1;
    insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
      values(t,fam,v,'Instagram FMS','tenant','draft',true,u,u,2) returning id into flow;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
      values(flow,'negotiation','Negotiation','task',3,true,'{"questionnaire":{"origin":"stage"}}',f);
    -- Steps are written while the version is a draft, then it takes its final status.
    update fms_flows set status=s::fms_flow_status,is_active=s<>'archived' where id=flow;
    insert into version_fixture values('v'||v,flow);
  end loop;
  for v in 1..2 loop
    insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
      values(t,draft_fam,v,'Doublelick FMS','tenant','draft',true,u,u,2) returning id into flow;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
      values(flow,'call','Call','task',0,true,'{"questionnaire":{"origin":"copied"}}',g);
    if v=1 then update fms_flows set status='archived',is_active=false where id=flow; end if;
    insert into version_fixture values('d'||v,flow);
  end loop;
end $$;

-- Evaluated per query, as whoever is signed in.
create temporary view version_links as
  select item->>'familyId' as form_family,link
  from jsonb_array_elements(list_fms_built_forms()) item,jsonb_array_elements(item->'links') link;
grant select on version_links to authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
set local role authenticated;

select is((select count(*)::int from version_links where form_family=(select id::text from version_fixture where name='form_family')),3,
  'every saved version of the workflow keeps its own link');
select ok((select bool_and(link->>'workflowFamilyId'=(select id::text from version_fixture where name='flow_family')) from version_links
  where form_family=(select id::text from version_fixture where name='form_family')),'all three versions name the same workflow family');
select is((select array_agg(link->>'workflowId') from version_links where (link->>'isCurrent')::boolean
  and form_family=(select id::text from version_fixture where name='form_family')),array[(select id::text from version_fixture where name='v2')],
  'the published version is current, not the newer draft or the archived one');
select is((select link->>'workflowStatus' from version_links where link->>'workflowId'=(select id::text from version_fixture where name='v1')),'archived','status is reported');
select is((select (link->>'workflowVersion')::int from version_links where link->>'workflowId'=(select id::text from version_fixture where name='v3')),3,'version is reported');
select is((select (link->>'stageOrder')::int from version_links where link->>'workflowId'=(select id::text from version_fixture where name='v2')),3,'step order is reported');
select is((select array_agg(link->>'workflowId') from version_links where (link->>'isCurrent')::boolean
  and form_family=(select id::text from version_fixture where name='draft_form_family')),array[(select id::text from version_fixture where name='d2')],
  'with no published version the newest version is current');
select ok((select bool_and(link ? 'workflowName' and link ? 'stageId' and link ? 'stageName') from version_links),'existing link keys are kept');

-- Staff still receive the classification only.
reset role;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
set local role authenticated;
select ok(not has_permission('forms.manage'),'the staff member is not a form author');
select is(jsonb_array_length(list_fms_built_forms()),2,'staff see both FMS-built families');
select ok(not exists(select 1 from jsonb_array_elements(list_fms_built_forms()) item where item ? 'links' or item ? 'workflows'),'staff receive no workflow links');

reset role;
select ok(not has_function_privilege('anon','list_fms_built_forms()','EXECUTE'),'anonymous callers cannot call it');
select ok(not has_function_privilege('service_role','list_fms_built_forms()','EXECUTE'),'the service role has no grant');
select * from finish();
rollback;
