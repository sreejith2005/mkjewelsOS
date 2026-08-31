begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

-- Rule trees ---------------------------------------------------------------

select ok(form_condition_matches(
  jsonb_build_object('kind','predicate','fieldKey','metal','operator','equals','value','gold'),
  jsonb_build_object('metal','gold')), 'a predicate matches the answer it names');

select ok(not form_condition_matches(
  jsonb_build_object('kind','predicate','fieldKey','metal','operator','equals','value','gold'),
  jsonb_build_object('metal','silver')), 'a predicate rejects a different answer');

select ok(form_condition_matches(
  jsonb_build_object('kind','all','rules',jsonb_build_array(
    jsonb_build_object('kind','predicate','fieldKey','metal','operator','equals','value','gold'),
    jsonb_build_object('kind','predicate','fieldKey','budget','operator','greater_than','value',50000))),
  jsonb_build_object('metal','gold','budget',60000)), 'an all group needs every comparison to hold');

select ok(not form_condition_matches(
  jsonb_build_object('kind','all','rules',jsonb_build_array(
    jsonb_build_object('kind','predicate','fieldKey','metal','operator','equals','value','gold'),
    jsonb_build_object('kind','predicate','fieldKey','budget','operator','greater_than','value',50000))),
  jsonb_build_object('metal','gold','budget',10000)), 'an all group fails when one comparison fails');

select ok(form_condition_matches(
  jsonb_build_object('kind','any','rules',jsonb_build_array(
    jsonb_build_object('kind','predicate','fieldKey','metal','operator','equals','value','gold'),
    jsonb_build_object('kind','predicate','fieldKey','vip','operator','equals','value',true))),
  jsonb_build_object('metal','silver','vip',true)), 'an any group needs only one comparison to hold');

-- Operators ----------------------------------------------------------------

select ok(form_condition_matches(jsonb_build_object('kind','predicate','fieldKey','tags','operator','contains','value','urgent'),
  jsonb_build_object('tags',jsonb_build_array('ready','urgent'))), 'contains reads inside a multiselect answer');
select ok(form_condition_matches(jsonb_build_object('kind','predicate','fieldKey','note','operator','not_contains','value','silver'),
  jsonb_build_object('note','yellow gold')), 'not_contains rejects a substring that is absent');
select ok(form_condition_matches(jsonb_build_object('kind','predicate','fieldKey','tags','operator','in','value',jsonb_build_array('urgent','later')),
  jsonb_build_object('tags',jsonb_build_array('ready','urgent'))), 'in matches when any chosen option is listed');
select ok(form_condition_matches(jsonb_build_object('kind','predicate','fieldKey','metal','operator','not_in','value',jsonb_build_array('silver')),
  jsonb_build_object('metal','gold')), 'not_in matches an answer outside the list');
select ok(form_condition_matches(jsonb_build_object('kind','predicate','fieldKey','due','operator','greater_than','value','2026-01-01'),
  jsonb_build_object('due','2026-08-31')), 'ordered comparison works on ISO dates');
select ok(form_condition_matches(jsonb_build_object('kind','predicate','fieldKey','count','operator','less_than_or_equal','value',5),
  jsonb_build_object('count',5)), 'less_than_or_equal accepts the boundary');
select ok(not form_condition_matches(jsonb_build_object('kind','predicate','fieldKey','name','operator','greater_than','value',3),
  jsonb_build_object('name','abc')), 'values that cannot be ordered never match');
select ok(form_condition_matches(jsonb_build_object('kind','predicate','fieldKey','note','operator','is_empty'), '{}'::jsonb),
  'is_empty matches an unanswered question');
select ok(form_condition_matches(null, '{}'::jsonb), 'a question with no rule is always shown');

-- The legacy single condition keeps behaving exactly as before ---------------

select ok(form_condition_matches(jsonb_build_object('fieldKey','metal','operator','equals','value','gold'),
  jsonb_build_object('metal','gold')), 'the pre-0114 condition shape still evaluates');

-- Normalization on write -----------------------------------------------------

select is(
  normalize_form_rule(jsonb_build_object('kind','all','rules',jsonb_build_array(
    jsonb_build_object('kind','predicate','fieldKey','Metal','operator','equals','value','gold'))),
    'karat', array['metal']),
  jsonb_build_object('kind','predicate','fieldKey','metal','operator','equals','value','gold'),
  'a single-comparison group collapses and the field key is folded to lower case');

select is(
  normalize_form_rule(jsonb_build_object('kind','predicate','fieldKey','metal','operator','in',
    'value',jsonb_build_array('gold','gold','silver')), 'karat', array['metal']),
  jsonb_build_object('kind','predicate','fieldKey','metal','operator','in','value',jsonb_build_array('gold','silver')),
  'a list comparison is deduplicated');

select is(
  normalize_form_rule(jsonb_build_object('kind','predicate','fieldKey','metal','operator','not_empty','value','ignored'),
    'karat', array['metal']),
  jsonb_build_object('kind','predicate','fieldKey','metal','operator','not_empty'),
  'an emptiness check drops the comparison value it cannot use');

select throws_ok(
  $$select normalize_form_rule(jsonb_build_object('kind','predicate','fieldKey','karat','operator','not_empty'), 'karat', array['metal'])$$,
  '22023', null, 'a question cannot be shown based on its own answer');

select throws_ok(
  $$select normalize_form_rule(jsonb_build_object('kind','predicate','fieldKey','finish','operator','not_empty'), 'karat', array['metal'])$$,
  '22023', null, 'a question cannot be shown based on a later answer');

select throws_ok(
  $$select normalize_form_rule(jsonb_build_object('kind','predicate','fieldKey','metal','operator','matches','value','gold'), 'karat', array['metal'])$$,
  '22023', null, 'an unapproved operator is rejected');

select throws_ok(
  $$select normalize_form_fields(jsonb_build_array(
      jsonb_build_object('key','metal','label','Metal','type','select','options',jsonb_build_array(jsonb_build_object('value','gold','label','Gold'))),
      jsonb_build_object('key','karat','label','Karat','type','text',
        'condition',jsonb_build_object('fieldKey','metal','operator','equals','value','gold'),
        'rule',jsonb_build_object('kind','predicate','fieldKey','metal','operator','equals','value','gold'))))$$,
  '22023', null, 'a field cannot carry both a legacy condition and a rule');

select is(
  (normalize_form_fields(jsonb_build_array(
    jsonb_build_object('key','metal','label','Metal','type','select','options',jsonb_build_array(jsonb_build_object('value','gold','label','Gold'))),
    jsonb_build_object('key','karat','label','Karat','type','text',
      'rule',jsonb_build_object('kind','predicate','fieldKey','metal','operator','equals','value','gold'))))->1->'rule'),
  jsonb_build_object('kind','predicate','fieldKey','metal','operator','equals','value','gold'),
  'a rule survives the authoring contract');

-- A duplicated form keeps the logic that decides which questions get asked ----

select ok(
  (select pg_get_functiondef('duplicate_form_with_audit(uuid,text)'::regprocedure) not like '%    null, branch_logic,%'),
  'duplicating a form no longer discards the per-question visibility rule');

select * from finish();
rollback;
