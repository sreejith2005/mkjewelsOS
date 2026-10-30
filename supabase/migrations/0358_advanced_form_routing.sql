-- Extend the existing persisted form contracts; no new public RPC or data rewrite.
set search_path=public,extensions;

-- Keep the installed scalar/type/option validation (including 0352 allowOther),
-- delegating only routing additions. Existing sorted-recipient and CRM activation
-- functions remain installed; customer capture gains only active-path filtering.
do $$declare d text; signature text; name text;begin
 foreach name in array array['normalize_form_rule','normalize_form_fields','normalize_form_sections','form_condition_matches'] loop
  signature:=case name when 'normalize_form_rule' then '(jsonb,text,text[],integer)' when 'normalize_form_fields' then '(jsonb,jsonb)' when 'normalize_form_sections' then '(jsonb)' else '(jsonb,jsonb)' end;
  d:=pg_get_functiondef(('public.'||name||signature)::regprocedure);
  d:=replace(d,'FUNCTION public.'||name||'(','FUNCTION public.'||name||'_legacy_0358(');
  execute d;
 end loop;
end$$;

-- Snapshot engine is shared with customer-event projection; only active answers
-- enter its evaluation context, so skipped stale values cannot choose a route.
create or replace function form_snapshot_active_path(p_snapshot jsonb,p_answers jsonb,p_section_key text default null) returns jsonb
language plpgsql stable set search_path=public as $$
declare sections jsonb:=coalesce(p_snapshot#>'{template,sections}','[]'); fields jsonb; section jsonb; f jsonb; b jsonb;
 answers jsonb:='{}'; active text[]:='{}'; reached text[]:='{}';
 si integer:=0; fi integer:=0; n integer; target text; pending text; key text; explicit boolean:=false; eligible boolean; matched boolean; start_index integer:=0;
 field_advanced boolean; undecided boolean; waiting boolean:=false; answer jsonb; continued boolean;
begin
 select coalesce(jsonb_agg(value order by (value->>'sort_order')::integer),'[]') into fields from jsonb_array_elements(coalesce(p_snapshot->'fields','[]'));
 if p_section_key is not null then
  select ord::integer-1 into si from jsonb_array_elements(sections) with ordinality e(s,ord) where s->>'key'=p_section_key;
  if si is null then raise exception 'Unknown scoped form section' using errcode='22023'; end if;
  explicit:=true;
 end if;
 while si<greatest(jsonb_array_length(sections),1) loop
  section:=sections->si; key:=section->>'key';
  exit when p_section_key is not null and key is distinct from p_section_key;
  eligible:=p_section_key is not null or case coalesce(section->>'visibility',case when section ? 'rule' then 'when' else 'always' end) when 'routed' then explicit when 'when' then form_condition_matches(section->'rule',answers) when 'unless' then form_condition_matches(coalesce(section->'rule','{}')||jsonb_build_object('negate',not coalesce((section#>>'{rule,negate}')::boolean,false)),answers) else true end;
  if not eligible then si:=si+1; explicit:=false; start_index:=0; continue; end if;
  if key is not null then reached:=array_append(reached,key); end if;
  target:=null; pending:=null; undecided:=false; continued:=false;
  fi:=start_index;
  while fi<jsonb_array_length(fields) loop
   f:=fields->fi;
   if jsonb_array_length(sections)>0 and form_field_section_key(f->>'group_name',sections) is distinct from key then
    select ord::integer-1 into n from jsonb_array_elements(sections) with ordinality e(s,ord) where s->>'key'=form_field_section_key(f->>'group_name',sections);
    exit when n>si;
    fi:=fi+1; continue;
   end if;
   if not coalesce((f->>'is_shown')::boolean,true) or not form_condition_matches(f->'conditional_logic',answers) then fi:=fi+1; continue; end if;
   active:=array_append(active,f->>'field_key');
   answer:=p_answers->(f->>'field_key');
   if jsonb_typeof(answer)='string' then answer:=to_jsonb(btrim(answer#>>'{}')); end if;
   if not form_answer_is_empty(answer) then answers:=answers||jsonb_build_object(f->>'field_key',answer); end if;
   field_advanced:=exists(select 1 from jsonb_array_elements(coalesce(nullif(f->'branch_logic','null'),'[]')) r where r ? 'rule' or r->>'operator'='default' or r->>'targetSectionKey' like '__question__:%' or r->>'targetSectionKey' in ('__continue__','__stage_end__'));
   matched:=false;
   for b in select value from jsonb_array_elements(coalesce(nullif(f->'branch_logic','null'),'[]')) loop
    exit when p_section_key is not null and not field_advanced;
    if b->>'operator'='default' or form_condition_matches(coalesce(nullif(b->'rule','null'),jsonb_strip_nulls(jsonb_build_object('fieldKey',f->>'field_key','operator',b->>'operator','value',b->'value'))),answers) then
     matched:=true;
     if field_advanced then target:=b->>'targetSectionKey'; else pending:=b->>'targetSectionKey'; end if;
     exit;
    end if;
   end loop;
   if not matched and (p_section_key is null or field_advanced) and jsonb_array_length(coalesce(nullif(f->'branch_logic','null'),'[]'))>0 and form_answer_is_empty(answer) then
    if field_advanced then waiting:=true; exit; else undecided:=true; end if;
   end if;
   if p_section_key is not null and target is not null and target not in ('__continue__','__submit__','__stage_end__')
    and (target not like '__question__:%' or not exists(select 1 from jsonb_array_elements(fields) q where q->>'field_key'=substr(target,14) and form_field_section_key(q->>'group_name',sections)=p_section_key)) then target:=null; end if;
   if target='__continue__' then continued:=true; target:=null; fi:=fi+1; continue; end if;
   if target like '__question__:%' then
    select ord::integer-1 into n from jsonb_array_elements(fields) with ordinality e(q,ord) where q->>'field_key'=substr(target,14);
    if n is null or n<=fi then raise exception 'Invalid question routing destination' using errcode='22023'; end if;
    if jsonb_array_length(sections)=0 or form_field_section_key(fields->n->>'group_name',sections)=key then fi:=n; target:=null; continue; end if;
   end if;
   exit when target is not null;
   fi:=fi+1;
  end loop;
  if waiting or (undecided and pending is null) then waiting:=true; exit; end if;
  target:=coalesce(target,pending,case when continued then '__continue__' else section->>'next' end,'__continue__');
  exit when target in ('__submit__','__stage_end__');
  start_index:=0; explicit:=target<>'__continue__';
  if target='__continue__' then si:=si+1;
  elsif target like '__question__:%' then
   select ord::integer-1 into n from jsonb_array_elements(fields) with ordinality e(q,ord) where q->>'field_key'=substr(target,14);
   if n is null or n<fi then raise exception 'Invalid question routing destination' using errcode='22023'; end if;
   start_index:=n; target:=form_field_section_key(fields->n->>'group_name',sections);
   select ord::integer-1 into n from jsonb_array_elements(sections) with ordinality e(s,ord) where s->>'key'=target;
   if n is null or n<=si then raise exception 'Invalid section routing destination' using errcode='22023'; end if; si:=n;
  else
   select ord::integer-1 into n from jsonb_array_elements(sections) with ordinality e(s,ord) where s->>'key'=target;
   if n is null or n<=si then raise exception 'Invalid section routing destination' using errcode='22023'; end if; si:=n;
  end if;
 end loop;
 return jsonb_build_object('fields',active,'sections',reached,'answers',answers,'pending',waiting);
end$$;

create or replace function crm_sync.snapshot_reachable_sections(p_snapshot jsonb,p_answers jsonb) returns text[]
language sql stable set search_path=public as $$
 select case when jsonb_array_length(coalesce(p_snapshot#>'{template,sections}','[]'))=0 then null else array(select jsonb_array_elements_text(form_snapshot_active_path(p_snapshot,p_answers)->'sections')) end;
$$;

create or replace function form_active_field_keys(p_template_id uuid,p_answers jsonb,p_section_key text default null) returns text[]
language plpgsql stable set search_path=public as $$
declare path jsonb;
begin
 select form_snapshot_active_path(jsonb_build_object('template',to_jsonb(t),'fields',coalesce((select jsonb_agg(to_jsonb(f) order by f.sort_order,f.id) from form_fields f where f.form_template_id=t.id),'[]')),p_answers,p_section_key) into path from form_templates t where t.id=p_template_id;
 if (path->>'pending')::boolean then raise exception 'Answer the routing question before submitting' using errcode='23514'; end if;
 return array(select jsonb_array_elements_text(path->'fields'));
end;
$$;

-- Preserve authorization, locking, field-type validation, Storage checks, audit,
-- exact assignment identity and FMS atomic progression in their current bodies.
do $$declare sig text; d text; amended text; scope text;begin
 foreach sig in array array['fms_validate_candidate_form(uuid,jsonb,text,uuid)'] loop
  d:=replace(pg_get_functiondef(sig::regprocedure),E'\r','');
  scope:=case when sig like 'fms_validate%' then 'v_section_key' else 'null' end;
  amended:=replace(d,'  v_reachable text[];','  v_reachable text[]; v_active_fields text[];');
  if amended=d then raise exception 'Review advanced form validator declarations'; end if; d:=amended;
  amended:=replace(d,'  for v_field in select * from form_fields where form_template_id=v_template.id order by sort_order loop',
   '  v_active_fields := form_active_field_keys(v_template.id,p_answers,'||scope||');'||E'\n'||'  for v_field in select * from form_fields where form_template_id=v_template.id order by sort_order loop');
  if amended=d then raise exception 'Review advanced form validator field loop'; end if; d:=amended;
  amended:=replace(d,'v_visible := v_field.is_shown and form_condition_matches(v_field.conditional_logic,v_normalized)',
   'v_visible := v_field.field_key = any(v_active_fields) and v_field.is_shown and form_condition_matches(v_field.conditional_logic,v_normalized)');
  if amended=d then raise exception 'Review advanced form submission visibility marker: %',sig; end if;
  execute amended;
 end loop;
end$$;

-- Helpers remain internal, with no browser or service-role bypass.
do $$declare d text; amended text; marker text;begin
 d:=pg_get_functiondef('fms_form_chain_choice(uuid,jsonb,uuid[])'::regprocedure);
 marker:='  -- Only questions the source step''s doer answers can choose the next employee.';
 amended:=replace(d,marker,
  '  p_answers := coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(p_answers,''{}'')) where key=any(form_active_field_keys(source.form_template_id,p_answers,section_key))),''{}'');'||E'\n'||marker);
 if amended=d then raise exception 'Review FMS handoff active answers marker'; end if;
 execute amended;
 d:=pg_get_functiondef('crm_sync.capture_customer_submission(uuid)'::regprocedure);
 marker:='if field is null or field->>''is_shown''=''false''';
 amended:=replace(d,marker,'if field is null or not exists(select 1 from jsonb_array_elements_text(form_snapshot_active_path(s.template_snapshot,s.data,section_key)->''fields'') active(key) where active.key=field->>''field_key'') or field->>''is_shown''=''false''');
 if amended=d then raise exception 'Review customer projection active answers marker'; end if;
 execute amended;
end$$;

create or replace function form_condition_matches(p_condition jsonb,p_answers jsonb) returns boolean
language plpgsql stable set search_path=public as $$
declare result boolean; dependency jsonb;
begin
 if p_condition is null or p_condition='null' then return true; end if;
 -- Missing answers must not satisfy negative predicates or an inverted group.
 if coalesce(p_condition->>'operator','') not in ('is_empty','not_empty') and p_condition ? 'fieldKey'
    and form_answer_is_empty(p_answers->(p_condition->>'fieldKey')) then return false; end if;
 if coalesce((p_condition->>'negate')::boolean,false) then
  for dependency in select value from jsonb_path_query(p_condition,'strict $.** ? (@.fieldKey != null)') as q(value) loop
   if coalesce(dependency->>'operator','') not in ('is_empty','not_empty') and form_answer_is_empty(p_answers->(dependency->>'fieldKey')) then return false; end if;
  end loop;
 end if;
 result:=coalesce(form_condition_matches_legacy_0358(p_condition-'negate',p_answers),false);
 return case when coalesce((p_condition->>'negate')::boolean,false) then not result else result end;
end$$;

create or replace function normalize_form_rule(p_rule jsonb,p_field_key text,p_earlier text[],p_depth integer default 1) returns jsonb
language plpgsql stable set search_path=public as $$
declare result jsonb; children jsonb;
begin
 if p_rule ? 'negate' and jsonb_typeof(p_rule->'negate') is distinct from 'boolean' then raise exception 'Rule negate must be boolean' using errcode='22023'; end if;
 if p_depth=1 and (select count(*) from jsonb_path_query(p_rule,'strict $.**.kind') k where k='"predicate"')>20 then raise exception 'A rule can compare at most 20 answers' using errcode='22023'; end if;
 if p_rule->>'kind'='predicate' and p_rule->>'operator' not in ('is_empty','not_empty')
  and (p_rule->'value'='""' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_rule->'value')='array' then p_rule->'value' else '[]' end) v where v='""')) then raise exception 'Rule comparison answer is required' using errcode='22023'; end if;
 result:=normalize_form_rule_legacy_0358(p_rule-'negate',p_field_key,p_earlier,p_depth);
 -- The legacy normalizer collapses singleton groups. Preserve a negated
 -- group's level so its negate never overwrites the child's own negate.
 if result is not null and p_rule->>'kind' in ('all','any') and coalesce((p_rule->>'negate')::boolean,false) then
  select jsonb_agg(child) into children from (
   select normalize_form_rule(value,p_field_key,p_earlier,p_depth+1) child
   from jsonb_array_elements(p_rule->'rules')
  ) normalized where child is not null;
  return jsonb_build_object('kind',p_rule->>'kind','rules',children,'negate',true);
 end if;
 if result is not null and p_rule->>'kind'='predicate' and p_rule ? 'negate' then result:=result||jsonb_build_object('negate',p_rule->'negate'); end if;
 return result;
end$$;

create or replace function assert_form_rule_options(p_rule jsonb,p_fields jsonb) returns void
language plpgsql stable set search_path=public as $$
declare predicate jsonb; source jsonb; expected jsonb;
begin
 for predicate in select value from jsonb_path_query(p_rule,'strict $.** ? (@.kind == "predicate")') as q(value) loop
  select f into source from jsonb_array_elements(p_fields) f where f->>'key'=predicate->>'fieldKey';
  if source->'optionSource' is not null or jsonb_typeof(source->'options') is distinct from 'array' or jsonb_array_length(source->'options')=0 or predicate->>'operator' in ('is_empty','not_empty') then continue; end if;
  for expected in select value from jsonb_array_elements(case when jsonb_typeof(predicate->'value')='array' then predicate->'value' else jsonb_build_array(predicate->'value') end) loop
   if not (form_option_values(source->'options') @> jsonb_build_array(expected)) then raise exception 'A condition refers to an answer option that no longer exists' using errcode='22023'; end if;
  end loop;
 end loop;
end$$;

create or replace function normalize_form_sections(p_sections jsonb) returns jsonb
language plpgsql stable set search_path=public as $$
declare clean jsonb; result jsonb; item jsonb; base jsonb; i integer:=0; target text; dependencies text[]; normalized_rule jsonb;
begin
 if p_sections is null or p_sections='null' then return '[]'; end if;
 if jsonb_typeof(p_sections)<>'array' then raise exception 'Sections must be an array' using errcode='22023'; end if;
 select coalesce(jsonb_agg(value-array['visibility','rule','next']),'[]') into clean from jsonb_array_elements(p_sections);
 result:=normalize_form_sections_legacy_0358(clean);
 for item in select value from jsonb_array_elements(p_sections) loop
  if item ? 'visibility' and coalesce(item->>'visibility','') not in ('always','when','unless','routed') then raise exception 'Unsupported section visibility' using errcode='22023'; end if;
  if item->>'visibility' in ('when','unless') and (item->'rule' is null or item->'rule'='null') then raise exception 'Conditional sections require a rule' using errcode='22023'; end if;
  target:=nullif(lower(btrim(item->>'next')),'');
  if target is not null and target not in ('__submit__','__stage_end__','__continue__') and target not like '__question__:%' and not exists(select 1 from jsonb_array_elements(result) with ordinality e(s,n) where s->>'key'=target and n>i+1) then raise exception 'Section destination must point forward' using errcode='22023'; end if;
  base:=result->i;
  if item ? 'visibility' then base:=base||jsonb_build_object('visibility',item->'visibility'); end if;
  if item ? 'rule' then
   select coalesce(array_agg(distinct lower(btrim(value#>>'{}'))),'{}') into dependencies from jsonb_path_query(item->'rule','strict $.**.fieldKey') as q(value);
   normalized_rule:=normalize_form_rule(item->'rule','',dependencies);
   base:=base||jsonb_build_object('rule',normalized_rule);
  end if;
  if target is not null then base:=base||jsonb_build_object('next',target); end if;
  result:=jsonb_set(result,array[i::text],base); i:=i+1;
 end loop;
 return result;
end$$;

create or replace function assert_form_route_target(p_target text,p_fields jsonb,p_sections jsonb,p_index integer,p_section_index integer) returns void
language plpgsql stable set search_path=public as $$
declare n integer;
begin
 if p_target in ('__submit__','__stage_end__','__continue__') then return; end if;
 if p_target like '__question__:%' then
  select ord::integer-1 into n from jsonb_array_elements(p_fields) with ordinality e(f,ord) where f->>'key'=substr(p_target,14);
  if n is null or n<=p_index then raise exception 'Question destination must point to a later question' using errcode='22023'; end if;
 else
  select ord::integer-1 into n from jsonb_array_elements(p_sections) with ordinality e(s,ord) where s->>'key'=p_target;
  if n is null or n<=p_section_index then raise exception 'Section destination must point to a later section' using errcode='22023'; end if;
 end if;
end$$;

create or replace function normalize_form_fields(p_fields jsonb,p_sections jsonb default '[]') returns jsonb
language plpgsql stable set search_path=public as $$
declare clean jsonb; result jsonb; item jsonb; branch jsonb; branches jsonb; rule jsonb; sections jsonb; s jsonb; seen text[]:='{}'; earlier text[]; i integer:=0; si integer; j integer:=0; target text;
begin
 sections:=normalize_form_sections(p_sections);
 if jsonb_typeof(p_fields) is distinct from 'array' then raise exception 'Fields must be an array' using errcode='22023'; end if;
 select coalesce(jsonb_agg(value-'branches'),'[]') into clean from jsonb_array_elements(p_fields);
 result:=normalize_form_fields_legacy_0358(clean,sections);
 for item in select value from jsonb_array_elements(p_fields) loop
  select ord::integer-1 into si from jsonb_array_elements(sections) with ordinality e(s,ord) where e.s->>'key'=item->>'sectionKey';
  branches:='[]';
  if item ? 'branches' and item->'branches'<>'null' then
   if jsonb_typeof(item->'branches')<>'array' or jsonb_array_length(item->'branches')>50 then raise exception 'At most 50 routes per question are allowed' using errcode='22023'; end if;
   for branch in select value from jsonb_array_elements(item->'branches') loop
    if jsonb_typeof(branch)<>'object' or branch-array['operator','value','targetSectionKey','name','rule']<>'{}' then raise exception 'Unsupported route properties' using errcode='22023'; end if;
    if coalesce(branch->>'operator','') not in ('default','equals','not_equals','contains','not_contains','in','not_in','greater_than','greater_than_or_equal','less_than','less_than_or_equal','not_empty','is_empty') then raise exception 'Unsupported route operator' using errcode='22023'; end if;
    if not (branch ? 'rule') and item->>'type' in ('select','radio') and not (item ? 'optionSource') and branch->>'operator' in ('equals','not_equals')
     and not (form_option_values(result->i->'options') @> jsonb_build_array(branch->'value')) then raise exception 'Field % branches on an option that does not exist',item->>'key' using errcode='22023'; end if;
    target:=lower(btrim(coalesce(branch->>'targetSectionKey','')));
    perform assert_form_route_target(target,result,sections,i,coalesce(si,-1));
    if length(coalesce(branch->>'name',''))>150 then raise exception 'Route name exceeds limit' using errcode='22023'; end if;
    if branch->>'operator'='default' then
     if branch ? 'rule' then raise exception 'Otherwise route must not define conditions' using errcode='22023'; end if;
     if branches @> '[{"operator":"default"}]' then raise exception 'Only one Otherwise route is allowed' using errcode='22023'; end if;
    else
     rule:=coalesce(nullif(branch->'rule','null'),jsonb_strip_nulls(jsonb_build_object('kind','predicate','fieldKey',item->>'key','operator',branch->>'operator','value',branch->'value')));
     rule:=normalize_form_rule(rule,'',array_append(seen,item->>'key'));
     if rule is null then raise exception 'Route condition required' using errcode='22023'; end if;
     perform assert_form_rule_options(rule,result);
     if branch ? 'rule' then branch:=branch||jsonb_build_object('rule',rule); end if;
    end if;
    branches:=branches||jsonb_build_array(branch||jsonb_build_object('targetSectionKey',target));
   end loop;
  end if;
  if jsonb_array_length(branches)>0 then result:=jsonb_set(result,array[i::text,'branches'],branches); end if;
  seen:=array_append(seen,item->>'key'); i:=i+1;
 end loop;
 -- Section rules may only read earlier sections; section next question must also be forward.
 for s in select value from jsonb_array_elements(sections) loop
  select coalesce(array_agg(f->>'key'),'{}'),coalesce(max(ord::integer-1),-1) into earlier,i from jsonb_array_elements(result) with ordinality e(f,ord) where f->>'sectionKey' in (select x->>'key' from jsonb_array_elements(sections) with ordinality e2(x,n) where n<j+1);
  if s ? 'rule' then
   rule:=normalize_form_rule(s->'rule','',earlier);
   if rule is null then raise exception 'Section condition required' using errcode='22023'; end if;
   perform assert_form_rule_options(rule,result);
  end if;
  if s ? 'next' then
   select coalesce(max(ord::integer-1),i) into i from jsonb_array_elements(result) with ordinality e(f,ord) where f->>'sectionKey'=s->>'key';
   perform assert_form_route_target(s->>'next',result,sections,i,j);
  end if;
  j:=j+1;
 end loop;
 return result;
end$$;

do $$declare p record;begin
 for p in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and
 (proname like '%_legacy_0358' or proname in ('form_snapshot_active_path','form_active_field_keys','assert_form_route_target','assert_form_rule_options')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',p.signature);
 end loop;
end$$;
notify pgrst,'reload schema';
-- Preserve 0353's family classification and its author-only labels, while
-- exposing actual workflow/step pairs instead of reconstructing a cross product.
do $$declare original text; amended text;begin
 original:=pg_get_functiondef('list_fms_built_forms()'::regprocedure);
 amended:=replace(original,
  $old$jsonb_build_object('workflows',built.workflows,'steps',built.steps)$old$,
  $new$jsonb_build_object('workflows',built.workflows,'steps',built.steps,'links',built.links)$new$);
 amended:=replace(amended,
  $old$to_jsonb(array_agg(distinct stage.name order by stage.name)) as steps$old$,
  $new$to_jsonb(array_agg(distinct stage.name order by stage.name)) as steps,
      jsonb_agg(distinct jsonb_build_object('workflowId',flow.id,'workflowName',flow.name,'stageId',stage.id,'stageName',stage.name)) as links$new$);
 if amended=original or position('''links'',built.links' in amended)=0 or position('as links' in amended)=0 then
  raise exception 'Review FMS-built form pair projection markers';
 end if;
 execute amended;
end$$;
notify pgrst,'reload schema';
