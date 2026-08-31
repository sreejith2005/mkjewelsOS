-- Per-question conditional visibility becomes a first-class builder feature.
--
-- What changes
--   * form_fields.conditional_logic may now hold a rule *tree* -
--     {"kind":"all"|"any","rules":[...]} over {"kind":"predicate",...} leaves -
--     instead of only the single {fieldKey,operator,value} condition.
--   * form_condition_matches evaluates either shape, so every existing caller
--     (form_reachable_sections, submit_form_locked_with_audit, the 0053 FMS
--     stage contract) gains rule support without changing its own SQL.
--   * Predicates gain the operators a real form builder needs:
--     not_contains, in, not_in, greater_than(_or_equal), less_than(_or_equal),
--     is_empty - alongside the original equals/not_equals/contains/not_empty.
--   * duplicate_form_with_audit now copies a question's visibility rule instead
--     of resetting it; a duplicate that silently loses its branching logic is a
--     broken copy now that conditions decide which questions get asked.
--
-- Compatibility
--   The legacy single-condition shape is still accepted on write, still stored
--   unchanged, and still evaluated identically, so forms and submissions saved
--   before this migration keep behaving exactly as they did.
set search_path = public, extensions;

comment on column form_fields.conditional_logic is
  'Visibility for this question: either a rule tree {kind:all|any|predicate,...} or the legacy {fieldKey,operator,value} condition. Null means always shown.';

-- ---------------------------------------------------------------------------
-- Predicate evaluation
-- ---------------------------------------------------------------------------

-- Ordered comparison over numbers, numeric strings, and lexicographically
-- sortable strings (which is what the ISO date/datetime answers are). Null
-- means the two sides cannot be ordered against each other.
create or replace function form_compare_values(p_left jsonb, p_right jsonb)
returns integer
language plpgsql
immutable
set search_path = public
as $fn$
declare v_left numeric; v_right numeric; v_left_text text; v_right_text text;
begin
  if p_left is null or p_right is null then return null; end if;
  if jsonb_typeof(p_left) = 'number' then
    v_left := (p_left #>> '{}')::numeric;
  elsif jsonb_typeof(p_left) = 'string' and btrim(p_left #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    v_left := (btrim(p_left #>> '{}'))::numeric;
  end if;
  if jsonb_typeof(p_right) = 'number' then
    v_right := (p_right #>> '{}')::numeric;
  elsif jsonb_typeof(p_right) = 'string' and btrim(p_right #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    v_right := (btrim(p_right #>> '{}'))::numeric;
  end if;
  if v_left is not null and v_right is not null then
    return case when v_left < v_right then -1 when v_left > v_right then 1 else 0 end;
  end if;
  if jsonb_typeof(p_left) = 'string' and jsonb_typeof(p_right) = 'string' then
    v_left_text := p_left #>> '{}';
    v_right_text := p_right #>> '{}';
    return case when v_left_text < v_right_text then -1 when v_left_text > v_right_text then 1 else 0 end;
  end if;
  return null;
end;
$fn$;

create or replace function form_answer_is_empty(p_value jsonb)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select p_value is null or p_value = 'null'::jsonb or p_value = '""'::jsonb or p_value = '[]'::jsonb;
$fn$;

create or replace function form_value_contains(p_source jsonb, p_expected jsonb)
returns boolean
language sql
stable
set search_path = public
as $fn$
  select case
    when jsonb_typeof(p_source) = 'array' then p_source @> jsonb_build_array(p_expected)
    when jsonb_typeof(p_source) = 'string' and jsonb_typeof(p_expected) = 'string'
      then position(p_expected #>> '{}' in p_source #>> '{}') > 0
    else false
  end;
$fn$;

-- `in` / `not_in` compare against a list; a multiselect answer matches when any
-- of its own entries appears in that list.
create or replace function form_value_in(p_source jsonb, p_expected jsonb)
returns boolean
language sql
stable
set search_path = public
as $fn$
  select case
    when p_expected is null then false
    when jsonb_typeof(p_expected) <> 'array' then p_source is not null and p_expected = p_source
    when jsonb_typeof(p_source) = 'array' then exists (
      select 1 from jsonb_array_elements(p_source) as answer(entry)
      where p_expected @> jsonb_build_array(answer.entry))
    when p_source is null then false
    else p_expected @> jsonb_build_array(p_source)
  end;
$fn$;

-- Evaluates either a rule tree or the legacy single condition. Null (no
-- condition configured) always matches, exactly as before.
create or replace function form_condition_matches(p_condition jsonb, p_answers jsonb)
returns boolean
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_kind text;
  v_child jsonb;
  v_source jsonb;
  v_operator text;
  v_expected jsonb;
  v_comparison integer;
begin
  if p_condition is null or p_condition = 'null'::jsonb or jsonb_typeof(p_condition) <> 'object' then
    return true;
  end if;
  v_kind := p_condition->>'kind';
  if v_kind = 'all' then
    for v_child in select value from jsonb_array_elements(coalesce(p_condition->'rules', '[]'::jsonb)) loop
      if not form_condition_matches(v_child, p_answers) then return false; end if;
    end loop;
    return true;
  end if;
  if v_kind = 'any' then
    for v_child in select value from jsonb_array_elements(coalesce(p_condition->'rules', '[]'::jsonb)) loop
      if form_condition_matches(v_child, p_answers) then return true; end if;
    end loop;
    return false;
  end if;

  v_source := p_answers->(p_condition->>'fieldKey');
  v_operator := p_condition->>'operator';
  v_expected := p_condition->'value';
  if v_operator = 'equals' then return v_source = v_expected; end if;
  if v_operator = 'not_equals' then return v_source is distinct from v_expected; end if;
  if v_operator = 'not_empty' then return not form_answer_is_empty(v_source); end if;
  if v_operator = 'is_empty' then return form_answer_is_empty(v_source); end if;
  if v_operator = 'contains' then return form_value_contains(v_source, v_expected); end if;
  if v_operator = 'not_contains' then return not form_value_contains(v_source, v_expected); end if;
  if v_operator = 'in' then return form_value_in(v_source, v_expected); end if;
  if v_operator = 'not_in' then return not form_value_in(v_source, v_expected); end if;
  if v_operator in ('greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal') then
    v_comparison := form_compare_values(v_source, v_expected);
    if v_comparison is null then return false; end if;
    return case v_operator
      when 'greater_than' then v_comparison > 0
      when 'greater_than_or_equal' then v_comparison >= 0
      when 'less_than' then v_comparison < 0
      else v_comparison <= 0
    end;
  end if;
  return false;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Rule normalization on write
-- ---------------------------------------------------------------------------

-- Rebuilds a submitted rule into canonical form and rejects anything a
-- respondent could not have answered before reaching the question that reads it.
create or replace function normalize_form_rule(p_rule jsonb, p_field_key text, p_earlier text[], p_depth integer default 1)
returns jsonb
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_kind text;
  v_child jsonb;
  v_normalized jsonb;
  v_children jsonb := '[]'::jsonb;
  v_field text;
  v_operator text;
  v_value jsonb;
  v_entry jsonb;
  v_values jsonb := '[]'::jsonb;
begin
  if p_rule is null or p_rule = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_rule) <> 'object' then
    raise exception 'A visibility rule must be an object' using errcode = '22023';
  end if;
  if p_depth > 3 then
    raise exception 'Visibility rules can nest at most 3 levels deep' using errcode = '22023';
  end if;
  v_kind := p_rule->>'kind';

  if v_kind in ('all', 'any') then
    if p_rule - array['kind', 'rules'] <> '{}'::jsonb or jsonb_typeof(p_rule->'rules') <> 'array' then
      raise exception 'A visibility group must contain only kind and rules' using errcode = '22023';
    end if;
    if jsonb_array_length(p_rule->'rules') > 20 then
      raise exception 'A visibility rule can compare at most 20 answers' using errcode = '22023';
    end if;
    for v_child in select value from jsonb_array_elements(p_rule->'rules') loop
      v_normalized := normalize_form_rule(v_child, p_field_key, p_earlier, p_depth + 1);
      if v_normalized is not null then v_children := v_children || jsonb_build_array(v_normalized); end if;
    end loop;
    if jsonb_array_length(v_children) = 0 then return null; end if;
    if jsonb_array_length(v_children) = 1 then return v_children->0; end if;
    return jsonb_build_object('kind', v_kind, 'rules', v_children);
  end if;

  if v_kind <> 'predicate' or p_rule - array['kind', 'fieldKey', 'operator', 'value'] <> '{}'::jsonb then
    raise exception 'A visibility rule node must be a group or a predicate' using errcode = '22023';
  end if;
  v_field := lower(btrim(coalesce(p_rule->>'fieldKey', '')));
  v_operator := p_rule->>'operator';
  v_value := p_rule->'value';
  if v_field = '' or v_field = p_field_key or not (v_field = any(p_earlier)) then
    raise exception 'Field % is shown based on a question that does not come before it', p_field_key using errcode = '22023';
  end if;
  if v_operator not in ('equals', 'not_equals', 'contains', 'not_contains', 'in', 'not_in',
                        'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal',
                        'not_empty', 'is_empty') then
    raise exception 'Visibility rules must use an approved operator' using errcode = '22023';
  end if;
  if v_operator in ('not_empty', 'is_empty') then
    return jsonb_build_object('kind', 'predicate', 'fieldKey', v_field, 'operator', v_operator);
  end if;
  if v_operator in ('in', 'not_in') then
    if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) not between 1 and 100 then
      raise exception 'The % operator needs a list of 1 to 100 answers', v_operator using errcode = '22023';
    end if;
    for v_entry in select value from jsonb_array_elements(v_value) loop
      if jsonb_typeof(v_entry) not in ('string', 'number', 'boolean') then
        raise exception 'Visibility comparison values must be text, numbers, or true/false' using errcode = '22023';
      end if;
      if not (v_values @> jsonb_build_array(v_entry)) then v_values := v_values || jsonb_build_array(v_entry); end if;
    end loop;
    return jsonb_build_object('kind', 'predicate', 'fieldKey', v_field, 'operator', v_operator, 'value', v_values);
  end if;
  if v_value is null or jsonb_typeof(v_value) not in ('string', 'number', 'boolean') then
    raise exception 'Visibility rules need the answer they compare against' using errcode = '22023';
  end if;
  return jsonb_build_object('kind', 'predicate', 'fieldKey', v_field, 'operator', v_operator, 'value', v_value);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Authoring contract: fields may now carry a `rule`
-- ---------------------------------------------------------------------------
--
-- Reproduced from 0113 with three additions: `rule` joins the allowed field
-- keys, it is normalized against the questions that come before this one, and
-- it is emitted alongside the legacy `condition`.

create or replace function normalize_form_fields(p_fields jsonb, p_sections jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_item jsonb;
  v_condition jsonb;
  v_rule jsonb;
  v_validation jsonb;
  v_options jsonb;
  v_option_source jsonb;
  v_branches jsonb;
  v_branch jsonb;
  v_key text;
  v_type text;
  v_label text;
  v_section text;
  v_target text;
  v_seen text[] := array[]::text[];
  v_result jsonb := '[]'::jsonb;
  v_index integer := 0;
  v_sections jsonb;
  v_section_index integer;
  v_target_index integer;
  v_previous_section integer := -1;
begin
  v_sections := normalize_form_sections(p_sections);
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) > 100 then
    raise exception 'Fields must be an array containing at most 100 entries' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(v_item) <> 'object' or v_item - array[
      'key','label','type','required','shown','editable','placeholder','helperText',
      'options','validation','condition','rule','sectionKey','branches','optionSource'
    ] <> '{}'::jsonb then
      raise exception 'A field contains unsupported keys' using errcode = '22023';
    end if;
    v_key := lower(btrim(v_item->>'key'));
    v_label := btrim(v_item->>'label');
    v_type := v_item->>'type';
    v_options := v_item->'options';
    v_option_source := v_item->'optionSource';
    v_branches := v_item->'branches';
    v_validation := coalesce(v_item->'validation', '{}'::jsonb);
    v_condition := v_item->'condition';
    v_rule := v_item->'rule';
    if v_key !~ '^[a-z][a-z0-9_]{0,63}$' or v_key = any(v_seen) then
      raise exception 'Field keys must be unique and match the stable key format' using errcode = '22023';
    end if;
    if v_label is null or length(v_label) not between 1 and 200
       or length(coalesce(v_item->>'placeholder','')) > 300
       or length(coalesce(v_item->>'helperText','')) > 500 then
      raise exception 'Field label or helper text exceeds its limit' using errcode = '22023';
    end if;
    if v_type not in ('text','textarea','number','currency','email','phone','date','datetime','select','multiselect','radio','checkbox','rating','section_header','divider','user_dropdown','branch_dropdown','department_dropdown','file') then
      raise exception 'Field type is unsupported' using errcode = '22023';
    end if;
    if (v_item ? 'required' and jsonb_typeof(v_item->'required') <> 'boolean')
       or (v_item ? 'shown' and jsonb_typeof(v_item->'shown') <> 'boolean')
       or (v_item ? 'editable' and jsonb_typeof(v_item->'editable') <> 'boolean') then
      raise exception 'Field flags must be boolean' using errcode = '22023';
    end if;
    if v_type in ('section_header','divider') and coalesce((v_item->>'required')::boolean,false) then
      raise exception 'Layout fields cannot be required' using errcode = '22023';
    end if;

    -- Section membership, stored grouped and in section order.
    if jsonb_array_length(v_sections) = 0 then
      if nullif(btrim(coalesce(v_item->>'sectionKey','')),'') is not null then
        raise exception 'A field cannot reference a section on a form without sections' using errcode = '22023';
      end if;
      v_section := null; v_section_index := 0;
    else
      v_section := lower(btrim(coalesce(v_item->>'sectionKey','')));
      select position - 1 into v_section_index from jsonb_array_elements(v_sections) with ordinality as entries(section, position)
      where section->>'key' = v_section;
      if v_section_index is null then
        raise exception 'Field % references a section that does not exist', v_key using errcode = '22023';
      end if;
      if v_section_index < v_previous_section then
        raise exception 'Fields must be stored grouped in section order' using errcode = '22023';
      end if;
      v_previous_section := v_section_index;
    end if;

    -- Options: inline with stable identity, or a Dropdown Master reference.
    if v_type in ('select','multiselect','radio') then
      if v_option_source is not null and v_option_source <> 'null'::jsonb then
        if jsonb_typeof(v_option_source) <> 'object'
           or v_option_source - array['kind','masterType'] <> '{}'::jsonb
           or coalesce(v_option_source->>'kind','') <> 'master'
           or length(coalesce(btrim(v_option_source->>'masterType'),'')) not between 1 and 100 then
          raise exception 'A dropdown source must reference a Dropdown Master list' using errcode = '22023';
        end if;
        if v_options is not null and v_options <> 'null'::jsonb and jsonb_array_length(v_options) > 0 then
          raise exception 'A Dropdown Master question must not copy the master options' using errcode = '22023';
        end if;
        v_option_source := jsonb_build_object('kind','master','masterType', btrim(v_option_source->>'masterType'));
        v_options := null;
      else
        v_option_source := null;
        v_options := normalize_form_options(v_options);
      end if;
    elsif (v_options is not null and v_options <> 'null'::jsonb) or (v_option_source is not null and v_option_source <> 'null'::jsonb) then
      raise exception 'Options are allowed only for select, multiselect, and radio fields' using errcode = '22023';
    else
      v_options := null; v_option_source := null;
    end if;

    -- Branching: only forward, only to a section that exists.
    if v_branches is not null and v_branches <> 'null'::jsonb and jsonb_array_length(v_branches) > 0 then
      if v_type not in ('select','radio') then
        raise exception 'Only dropdown and radio questions can branch' using errcode = '22023';
      end if;
      if jsonb_typeof(v_branches) <> 'array' or jsonb_array_length(v_branches) > 50 or jsonb_array_length(v_sections) = 0 then
        raise exception 'Branching requires sections and at most 50 branches per question' using errcode = '22023';
      end if;
      for v_branch in select value from jsonb_array_elements(v_branches) loop
        if jsonb_typeof(v_branch) <> 'object' or v_branch - array['operator','value','targetSectionKey'] <> '{}'::jsonb
           or v_branch->>'operator' not in ('equals','not_equals','contains','not_empty')
           or (v_branch->>'operator' <> 'not_empty' and not (v_branch ? 'value'))
           or (v_branch ? 'value' and jsonb_typeof(v_branch->'value') not in ('string','number','boolean')) then
          raise exception 'Branches must use an approved operator and comparison value' using errcode = '22023';
        end if;
        if v_option_source is null and v_branch->>'operator' in ('equals','not_equals')
           and jsonb_typeof(v_branch->'value') = 'string'
           and not (form_option_values(v_options) @> jsonb_build_array(v_branch->'value')) then
          raise exception 'Field % branches on an option that does not exist', v_key using errcode = '22023';
        end if;
        v_target := lower(btrim(v_branch->>'targetSectionKey'));
        if v_target <> '__submit__' then
          select position - 1 into v_target_index from jsonb_array_elements(v_sections) with ordinality as entries(section, position)
          where section->>'key' = v_target;
          if v_target_index is null or v_target_index <= v_section_index then
            raise exception 'Field % must branch to a later section', v_key using errcode = '22023';
          end if;
        end if;
      end loop;
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'operator', branch->>'operator',
        'value', branch->'value',
        'targetSectionKey', lower(btrim(branch->>'targetSectionKey'))
      )) order by branch_order)
      into v_branches
      from jsonb_array_elements(v_branches) with ordinality as branch_entry(branch, branch_order);
    else
      v_branches := null;
    end if;

    if jsonb_typeof(v_validation) <> 'object' or v_validation - array['minLength','maxLength','min','max'] <> '{}'::jsonb
       or exists (select 1 from jsonb_each(v_validation) setting where jsonb_typeof(setting.value) <> 'number') then
      raise exception 'Field validation contains unsupported values' using errcode = '22023';
    end if;
    if (v_validation ? 'minLength' and ((v_validation->>'minLength')::numeric < 0 or (v_validation->>'minLength')::numeric > 5000 or (v_validation->>'minLength')::numeric <> trunc((v_validation->>'minLength')::numeric)))
       or (v_validation ? 'maxLength' and ((v_validation->>'maxLength')::numeric < 0 or (v_validation->>'maxLength')::numeric > 5000 or (v_validation->>'maxLength')::numeric <> trunc((v_validation->>'maxLength')::numeric)))
       or (v_validation ? 'minLength' and v_validation ? 'maxLength' and (v_validation->>'minLength')::numeric > (v_validation->>'maxLength')::numeric)
       or (v_validation ? 'min' and v_validation ? 'max' and (v_validation->>'min')::numeric > (v_validation->>'max')::numeric) then
      raise exception 'Field validation bounds are invalid' using errcode = '22023';
    end if;
    if v_condition is not null and v_condition <> 'null'::jsonb then
      if jsonb_typeof(v_condition) <> 'object' or v_condition - array['fieldKey','operator','value'] <> '{}'::jsonb
         or lower(btrim(v_condition->>'fieldKey')) = v_key
         or not (lower(btrim(v_condition->>'fieldKey')) = any(v_seen))
         or v_condition->>'operator' not in ('equals','not_equals','contains','not_empty')
         or (v_condition->>'operator' <> 'not_empty' and not (v_condition ? 'value'))
         or (v_condition ? 'value' and jsonb_typeof(v_condition->'value') not in ('string','number','boolean')) then
        raise exception 'Conditions must use an approved operator and reference an earlier field' using errcode = '22023';
      end if;
      v_condition := jsonb_strip_nulls(jsonb_build_object(
        'fieldKey', lower(btrim(v_condition->>'fieldKey')),
        'operator', v_condition->>'operator',
        'value', v_condition->'value'
      ));
    else
      v_condition := null;
    end if;

    -- A rule tree supersedes the single legacy condition; a field defines one or
    -- the other, never both.
    if v_rule is not null and v_rule <> 'null'::jsonb then
      if v_condition is not null then
        raise exception 'Field % cannot define both a condition and a visibility rule', v_key using errcode = '22023';
      end if;
      v_rule := normalize_form_rule(v_rule, v_key, v_seen, 1);
    else
      v_rule := null;
    end if;
    v_result := v_result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'key', v_key, 'label', v_label, 'type', v_type, 'sortOrder', v_index,
      'sectionKey', v_section,
      'required', coalesce((v_item->>'required')::boolean,false),
      'shown', coalesce((v_item->>'shown')::boolean,true),
      'editable', coalesce((v_item->>'editable')::boolean,true),
      'placeholder', nullif(btrim(v_item->>'placeholder'),''),
      'helperText', nullif(btrim(v_item->>'helperText'),''),
      'options', v_options, 'optionSource', v_option_source, 'branches', v_branches,
      'validation', v_validation, 'condition', v_condition, 'rule', v_rule
    )));
    v_seen := array_append(v_seen, v_key);
    v_index := v_index + 1;
  end loop;
  return v_result;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- Storage and publish checks
-- ---------------------------------------------------------------------------

create or replace function replace_form_draft_fields(p_template_id uuid, p_fields jsonb)
returns void
language plpgsql
set search_path = public
as $fn$
declare v_field jsonb;
begin
  delete from form_fields where form_template_id = p_template_id;
  for v_field in select value from jsonb_array_elements(p_fields) loop
    insert into form_fields(
      form_template_id, field_key, field_name, field_type, group_name, is_shown, is_editable,
      is_required, options, option_source, dropdown_master_type, conditional_logic, branch_logic, validation, placeholder,
      helper_text, sort_order
    ) values (
      p_template_id, v_field->>'key', v_field->>'label', v_field->>'type',
      v_field->>'sectionKey',
      (v_field->>'shown')::boolean, (v_field->>'editable')::boolean,
      (v_field->>'required')::boolean, v_field->'options',
      case when v_field->'optionSource' is not null then 'dropdown_master'
           when v_field->>'type' in ('select','multiselect','radio') then 'manual' end,
      v_field->'optionSource'->>'masterType',
      -- One column carries either shape; normalize_form_fields guarantees that
      -- only one of the two is ever present.
      coalesce(v_field->'rule', v_field->'condition'), v_field->'branches',
      coalesce(v_field->'validation','{}'::jsonb), v_field->>'placeholder',
      v_field->>'helperText', (v_field->>'sortOrder')::integer
    );
  end loop;
end;
$fn$;

-- Re-validates a stored draft before publishing. The stored visibility jsonb is
-- handed back under the key matching its shape so that it round-trips.
create or replace function assert_form_publishable(p_template_id uuid)
returns void
language plpgsql
stable
set search_path = public
as $fn$
declare v_count integer; v_sections jsonb;
begin
  select count(*) into v_count from form_fields where form_template_id = p_template_id;
  if v_count = 0 then raise exception 'A published form must contain at least one field' using errcode = '23514'; end if;
  if v_count > 100 then raise exception 'A form can contain at most 100 fields' using errcode = '23514'; end if;
  if exists (select 1 from form_fields where form_template_id = p_template_id and field_type = 'file') then
    raise exception 'File fields cannot be published until a private Storage lifecycle is implemented' using errcode = '0A000';
  end if;
  if exists (
    select 1 from form_fields ff
    where ff.form_template_id = p_template_id
      and ff.sort_order <> (select count(*) from form_fields earlier where earlier.form_template_id = p_template_id and earlier.sort_order < ff.sort_order)
  ) then raise exception 'Field ordering must be zero-based and contiguous' using errcode = '23514'; end if;
  select coalesce(sections,'[]'::jsonb) into v_sections from form_templates where id = p_template_id;
  perform normalize_form_fields(coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'key',ff.field_key,'label',ff.field_name,'type',ff.field_type,
      'sectionKey',ff.group_name,
      'required',ff.is_required,'shown',ff.is_shown,'editable',ff.is_editable,
      'placeholder',ff.placeholder,'helperText',ff.helper_text,'options',ff.options,
      'optionSource', case when ff.option_source = 'dropdown_master'
        then jsonb_build_object('kind','master','masterType',ff.dropdown_master_type) end,
      'branches',ff.branch_logic,
      'validation',ff.validation,
      'condition', case when ff.conditional_logic ? 'kind' then null else ff.conditional_logic end,
      'rule', case when ff.conditional_logic ? 'kind' then ff.conditional_logic else null end
    )) order by ff.sort_order)
    from form_fields ff where ff.form_template_id=p_template_id
  ),'[]'::jsonb), v_sections);
end;
$fn$;

create or replace function duplicate_form_with_audit(
  p_source_template_id uuid,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor user_profiles;
  v_source form_templates;
  v_new form_templates;
  v_name text;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin', 'manager') then
    raise exception 'Only active form authors can duplicate forms' using errcode = '42501';
  end if;

  select * into v_source from form_templates where id = p_source_template_id for share;
  if v_source.id is null or v_source.tenant_id <> v_actor.tenant_id then
    raise exception 'Form to duplicate was not found' using errcode = '42501';
  end if;

  v_name := btrim(coalesce(nullif(p_name, ''), 'Copy of ' || v_source.name));
  if length(v_name) not between 1 and 150 then
    raise exception 'Duplicated form name must be between 1 and 150 characters' using errcode = '22023';
  end if;

  insert into form_templates(
    tenant_id, family_id, version, lifecycle, is_active, name, description,
    branch_id, department_id, permissions, sections, created_by, updated_by, published_at
  ) values (
    v_actor.tenant_id, extensions.uuid_generate_v4(), 1, 'draft', false,
    v_name, v_source.description, null, null, v_source.permissions,
    coalesce(v_source.sections, '[]'::jsonb), v_actor.id, v_actor.id, null
  ) returning * into v_new;

  -- The copy is a faithful one: sections, branches, dropdown references, and
  -- the per-question visibility rule all carry over. Field keys are copied
  -- verbatim, so every rule still points at the question it was authored
  -- against.
  insert into form_fields(
    form_template_id, field_key, field_name, field_type, group_name,
    is_shown, is_editable, is_required, initial_value, options, option_source, dropdown_master_type,
    conditional_logic, branch_logic, sort_order, validation, placeholder, helper_text
  )
  select v_new.id, field_key, field_name, field_type, group_name,
    is_shown, is_editable, is_required, initial_value, options, option_source, dropdown_master_type,
    conditional_logic, branch_logic, sort_order, validation, placeholder, helper_text
  from form_fields
  where form_template_id = v_source.id
  order by sort_order;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'form_duplicated', 'forms', v_new.id,
    jsonb_build_object('source_template_id', v_source.id), to_jsonb(v_new));
  return v_new.id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants: these are internal helpers, reachable only through the audited RPCs.
-- ---------------------------------------------------------------------------

revoke all privileges on function form_compare_values(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function form_answer_is_empty(jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function form_value_contains(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function form_value_in(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function form_condition_matches(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function normalize_form_rule(jsonb, text, text[], integer) from public, anon, authenticated, service_role;
revoke all privileges on function normalize_form_fields(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function replace_form_draft_fields(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function assert_form_publishable(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function duplicate_form_with_audit(uuid, text) from public, anon, service_role;
grant execute on function duplicate_form_with_audit(uuid, text) to authenticated;
