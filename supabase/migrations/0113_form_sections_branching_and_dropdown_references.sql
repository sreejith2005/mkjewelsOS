-- Forms become a universal, section-based builder with Google-Forms style
-- branching and first-class Dropdown Master references.
--
-- What changes
--   * form_templates.sections           ordered sections of the form
--   * form_fields.group_name            now carries the owning section key
--   * form_fields.branch_logic          "when this answer is picked, go to..."
--   * form_fields.option_source         'manual' or 'dropdown_master' (added by 0112)
--   * form_fields.dropdown_master_type  the referenced master list, never a copy
--   * form_fields.options               entries gain a stable {value,label} identity
--
-- Compatibility
--   Forms saved before this migration have no sections (one implicit section,
--   everything reachable) and string options, which every reader below still
--   accepts.  Answers keep storing the option *value*, and for a legacy option
--   the value is the label it always was, so historical submissions, FMS branch
--   rules, and task form links keep matching.
set search_path = public, extensions;

alter table form_templates add column if not exists sections jsonb not null default '[]'::jsonb;
alter table form_fields add column if not exists branch_logic jsonb;

comment on column form_templates.sections is 'Ordered [{key,title,description,next}] sections; [] means one implicit section.';
comment on column form_fields.group_name is 'Section key this field belongs to; null falls back to the first section.';
comment on column form_fields.branch_logic is 'Ordered [{operator,value,targetSectionKey}] branches evaluated at the end of the section.';
comment on column form_fields.option_source is 'manual keeps inline options; dropdown_master references dropdown_master_type instead of copying it.';
comment on column form_fields.dropdown_master_type is 'dropdown_masters.master_type this question reads its options from.';

-- ---------------------------------------------------------------------------
-- Option identity
-- ---------------------------------------------------------------------------

-- Accepts the historical ["A","B"] shape and the current [{value,label}] shape.
create or replace function form_option_values(p_options jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p_options) <> 'array' then '[]'::jsonb else coalesce((
    select jsonb_agg(case when jsonb_typeof(entry) = 'string' then entry else entry->'value' end order by entry_order)
    from jsonb_array_elements(p_options) with ordinality as items(entry, entry_order)
  ), '[]'::jsonb) end;
$$;

create or replace function normalize_form_options(p_options jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_entry jsonb; v_value text; v_label text; v_seen text[] := array[]::text[]; v_result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 1 and 100 then
    raise exception 'Option fields require 1 to 100 options' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(v_entry) = 'string' then
      v_label := btrim(v_entry #>> '{}'); v_value := v_label;
    elsif jsonb_typeof(v_entry) = 'object' and v_entry - array['value','label'] = '{}'::jsonb then
      v_label := btrim(coalesce(v_entry->>'label', '')); v_value := btrim(coalesce(nullif(v_entry->>'value',''), v_label));
    else
      raise exception 'An option must be a string or a {value,label} object' using errcode = '22023';
    end if;
    if length(v_value) not between 1 and 200 or length(v_label) not between 1 and 200 then
      raise exception 'Option labels and values must contain 1 to 200 characters' using errcode = '22023';
    end if;
    if v_value = any(v_seen) then
      raise exception 'Option values must be unique within a question' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_value);
    v_result := v_result || jsonb_build_array(jsonb_build_object('value', v_value, 'label', v_label));
  end loop;
  return v_result;
end;
$$;

-- The values a field actually accepts: a Dropdown Master reference resolves
-- against the live master list so the master stays the single source of truth.
create or replace function form_field_option_values(p_options jsonb, p_master_type text, p_tenant_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select case
    when nullif(btrim(coalesce(p_master_type,'')),'') is null then form_option_values(p_options)
    else coalesce((
      select jsonb_agg(to_jsonb(dm.value) order by dm.sort_order, dm.label)
      from dropdown_masters dm
      where dm.master_type = btrim(p_master_type)
        and dm.is_active
        and (dm.tenant_id is null or dm.tenant_id = p_tenant_id)
    ), '[]'::jsonb)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Sections
-- ---------------------------------------------------------------------------

create or replace function normalize_form_sections(p_sections jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_item jsonb; v_key text; v_title text; v_next text;
  v_keys text[] := array[]::text[]; v_result jsonb := '[]'::jsonb; v_index integer := 0; v_target integer;
begin
  if p_sections is null or p_sections = 'null'::jsonb then return '[]'::jsonb; end if;
  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) > 50 then
    raise exception 'Sections must be an array containing at most 50 entries' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(v_item) <> 'object' or v_item - array['key','title','description','next'] <> '{}'::jsonb then
      raise exception 'A section contains unsupported keys' using errcode = '22023';
    end if;
    v_key := lower(btrim(v_item->>'key'));
    v_title := btrim(coalesce(v_item->>'title',''));
    if v_key !~ '^[a-z][a-z0-9_]{0,63}$' or v_key = any(v_keys) then
      raise exception 'Section keys must be unique and match the stable key format' using errcode = '22023';
    end if;
    if length(v_title) not between 1 and 150 or length(coalesce(v_item->>'description','')) > 500 then
      raise exception 'Section title or description exceeds its limit' using errcode = '22023';
    end if;
    v_keys := array_append(v_keys, v_key);
    v_result := v_result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'key', v_key, 'title', v_title,
      'description', nullif(btrim(v_item->>'description'),''),
      'next', nullif(lower(btrim(v_item->>'next')),'')
    )));
  end loop;
  -- A section may only continue forwards, which keeps every walk terminating.
  while v_index < jsonb_array_length(v_result) loop
    v_next := v_result->v_index->>'next';
    if v_next is not null and v_next <> '__submit__' then
      select position - 1 into v_target from jsonb_array_elements(v_result) with ordinality as entries(section, position)
      where section->>'key' = v_next;
      if v_target is null or v_target <= v_index then
        raise exception 'A section must continue to a later section or to submit' using errcode = '22023';
      end if;
    end if;
    v_index := v_index + 1;
  end loop;
  return v_result;
end;
$$;

create or replace function form_field_section_key(p_group_name text, p_sections jsonb)
returns text language sql immutable set search_path = public as $$
  select case
    when jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) = 0 then null
    when exists (select 1 from jsonb_array_elements(p_sections) section where section->>'key' = p_group_name) then p_group_name
    else p_sections->0->>'key'
  end;
$$;

-- Server-side twin of the client walk: start at the first section and follow the
-- branch configured on the last matching question of each reached section.
-- Returns null when the template has no sections, meaning "everything applies".
create or replace function form_reachable_sections(p_template_id uuid, p_answers jsonb)
returns text[] language plpgsql stable set search_path = public as $$
declare
  v_sections jsonb; v_count integer; v_index integer := 0; v_next_index integer;
  v_reached text[] := array[]::text[]; v_key text; v_target text; v_destination text;
  v_undecided boolean; v_field form_fields; v_branch jsonb; v_value jsonb; v_matched boolean;
begin
  select coalesce(sections,'[]'::jsonb) into v_sections from form_templates where id = p_template_id;
  if v_sections is null or jsonb_typeof(v_sections) <> 'array' or jsonb_array_length(v_sections) = 0 then return null; end if;
  v_count := jsonb_array_length(v_sections);
  while v_index >= 0 and v_index < v_count loop
    v_key := v_sections->v_index->>'key';
    exit when v_key = any(v_reached);
    v_reached := array_append(v_reached, v_key);
    v_target := null; v_undecided := false;
    for v_field in
      select * from form_fields ff
      where ff.form_template_id = p_template_id
        and ff.branch_logic is not null
        and form_field_section_key(ff.group_name, v_sections) = v_key
      order by ff.sort_order
    loop
      continue when not (v_field.is_shown and form_condition_matches(v_field.conditional_logic, p_answers));
      v_matched := false;
      for v_branch in select value from jsonb_array_elements(v_field.branch_logic) loop
        if form_condition_matches(jsonb_strip_nulls(jsonb_build_object(
             'fieldKey', v_field.field_key, 'operator', v_branch->>'operator', 'value', v_branch->'value')), p_answers) then
          v_target := v_branch->>'targetSectionKey'; v_matched := true;
        end if;
      end loop;
      v_value := p_answers->v_field.field_key;
      if not v_matched and (v_value is null or v_value = 'null'::jsonb or v_value = '""'::jsonb or v_value = '[]'::jsonb) then
        v_undecided := true;
      end if;
    end loop;
    -- An unanswered branching question has no destination yet.
    exit when v_undecided and v_target is null;
    v_destination := coalesce(v_target, v_sections->v_index->>'next');
    exit when v_destination = '__submit__';
    if v_destination is null then
      v_next_index := v_index + 1;
    else
      select position - 1 into v_next_index from jsonb_array_elements(v_sections) with ordinality as entries(section, position)
      where section->>'key' = v_destination;
    end if;
    exit when v_next_index is null or v_next_index <= v_index;
    v_index := v_next_index;
  end loop;
  return v_reached;
end;
$$;

-- ---------------------------------------------------------------------------
-- Draft field contract
-- ---------------------------------------------------------------------------

drop function if exists normalize_form_fields(jsonb);

create function normalize_form_fields(p_fields jsonb, p_sections jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_item jsonb;
  v_condition jsonb;
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
      'options','validation','condition','sectionKey','branches','optionSource'
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
    v_result := v_result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'key', v_key, 'label', v_label, 'type', v_type, 'sortOrder', v_index,
      'sectionKey', v_section,
      'required', coalesce((v_item->>'required')::boolean,false),
      'shown', coalesce((v_item->>'shown')::boolean,true),
      'editable', coalesce((v_item->>'editable')::boolean,true),
      'placeholder', nullif(btrim(v_item->>'placeholder'),''),
      'helperText', nullif(btrim(v_item->>'helperText'),''),
      'options', v_options, 'optionSource', v_option_source, 'branches', v_branches,
      'validation', v_validation, 'condition', v_condition
    )));
    v_seen := array_append(v_seen, v_key);
    v_index := v_index + 1;
  end loop;
  return v_result;
end;
$$;

create or replace function replace_form_draft_fields(p_template_id uuid, p_fields jsonb)
returns void
language plpgsql
set search_path = public
as $$
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
      v_field->'condition', v_field->'branches',
      coalesce(v_field->'validation','{}'::jsonb), v_field->>'placeholder',
      v_field->>'helperText', (v_field->>'sortOrder')::integer
    );
  end loop;
end;
$$;

create or replace function assert_form_publishable(p_template_id uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
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
      'validation',ff.validation,'condition',ff.conditional_logic
    )) order by ff.sort_order)
    from form_fields ff where ff.form_template_id=p_template_id
  ),'[]'::jsonb), v_sections);
end;
$$;

-- ---------------------------------------------------------------------------
-- Authoring RPCs: payloads now carry sections
-- ---------------------------------------------------------------------------

create or replace function save_form_draft_with_audit(p_template_id uuid, p_payload jsonb, p_fields jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_old form_templates; v_new form_templates; v_id uuid; v_family uuid; v_permissions jsonb; v_fields jsonb; v_old_fields jsonb; v_sections jsonb;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active manager, admin, or super_admin profiles can author forms' using errcode='42501'; end if;
  -- Legacy callers may still send scope keys. They are deliberately ignored.
  if jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','description','permissions','sections','branch_id','department_id'] <> '{}'::jsonb then raise exception 'Form draft payload contains unsupported keys' using errcode='22023'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null or length(btrim(p_payload->>'name')) > 150 or length(coalesce(p_payload->>'description','')) > 2000 then raise exception 'Form name or description exceeds its limit' using errcode='22023'; end if;
  v_permissions := normalize_form_permissions(p_payload->'permissions');
  v_sections := normalize_form_sections(p_payload->'sections');
  v_fields := normalize_form_fields(p_fields, v_sections);
  if p_template_id is null then
    v_family := extensions.uuid_generate_v4();
    insert into form_templates(tenant_id,family_id,version,lifecycle,is_active,name,description,branch_id,department_id,permissions,sections,created_by,updated_by,published_at)
    values(v_actor.tenant_id,v_family,1,'draft',false,btrim(p_payload->>'name'),nullif(btrim(p_payload->>'description'),''),null,null,v_permissions,v_sections,v_actor.id,v_actor.id,null) returning * into v_new;
    v_id := v_new.id;
  else
    select * into v_old from form_templates where id=p_template_id for update;
    if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or v_old.lifecycle<>'draft' then raise exception 'Editable form draft not found' using errcode='42501'; end if;
    select coalesce(jsonb_agg(to_jsonb(ff) order by ff.sort_order),'[]'::jsonb) into v_old_fields from form_fields ff where ff.form_template_id=v_old.id;
    update form_templates set name=btrim(p_payload->>'name'),description=nullif(btrim(p_payload->>'description'),''),branch_id=null,department_id=null,permissions=v_permissions,sections=v_sections,updated_by=v_actor.id,updated_at=now() where id=p_template_id returning * into v_new;
    v_id := v_new.id;
  end if;
  perform replace_form_draft_fields(v_id,v_fields);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,case when p_template_id is null then 'form_draft_created' else 'form_draft_updated' end,'forms',v_id,case when p_template_id is null then null else jsonb_build_object('template',to_jsonb(v_old),'fields',v_old_fields) end,jsonb_build_object('template',to_jsonb(v_new),'fields',v_fields));
  return v_id;
end;
$$;

create or replace function save_published_form_with_audit(p_template_id uuid, p_payload jsonb, p_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles; v_old form_templates; v_new form_templates;
  v_permissions jsonb; v_fields jsonb; v_old_fields jsonb; v_sections jsonb;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or not can_manage_form_template(p_template_id) then
    raise exception 'Only authorized active form authors can edit this form' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','description','permissions','sections'] <> '{}'::jsonb then
    raise exception 'Form payload contains unsupported keys' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'name'),'') is null or length(btrim(p_payload->>'name')) > 150 or length(coalesce(p_payload->>'description','')) > 2000 then
    raise exception 'Form name or description exceeds its limit' using errcode = '22023';
  end if;
  v_permissions := normalize_form_permissions(p_payload->'permissions');
  v_sections := normalize_form_sections(p_payload->'sections');
  v_fields := normalize_form_fields(p_fields, v_sections);
  select * into v_old from form_templates where id = p_template_id for update;
  if v_old.id is null or v_old.tenant_id <> v_actor.tenant_id or v_old.lifecycle <> 'published' then
    raise exception 'Editable published form not found' using errcode = '42501';
  end if;
  if exists (select 1 from form_submissions where form_template_id = v_old.id) then
    raise exception 'Forms with submissions must be revised to preserve submitted history' using errcode = '23503';
  end if;
  if exists (
    select 1 from fms_stages d join fms_instance_stages s on s.fms_stage_id = d.id
    join fms_instances i on i.id = s.fms_instance_id
    where d.form_template_id = v_old.id and i.status in ('active','overdue','on_hold')
      and s.status in ('pending','in_progress','in_review','overdue')
  ) then
    raise exception 'Forms used by active FMS stages must be revised to preserve in-progress work' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(to_jsonb(ff) order by ff.sort_order),'[]'::jsonb) into v_old_fields from form_fields ff where ff.form_template_id = v_old.id;
  perform set_config('jewelos.allow_published_form_edit', 'on', true);
  update form_templates set name = btrim(p_payload->>'name'), description = nullif(btrim(p_payload->>'description'),''), permissions = v_permissions, sections = v_sections, updated_by = v_actor.id, updated_at = now()
  where id = v_old.id returning * into v_new;
  perform replace_form_draft_fields(v_old.id, v_fields);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_published_updated','forms',v_old.id,jsonb_build_object('template',to_jsonb(v_old),'fields',v_old_fields),jsonb_build_object('template',to_jsonb(v_new),'fields',v_fields));
  return v_old.id;
end;
$$;

create or replace function create_form_revision_with_audit(p_source_template_id uuid, p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_source form_templates; v_new form_templates; v_permissions jsonb; v_version integer;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active form authors can create revisions' using errcode='42501'; end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','description','permissions','branch_id','department_id'] <> '{}'::jsonb then raise exception 'Form revision payload contains unsupported keys' using errcode='22023'; end if;
  select * into v_source from form_templates where id=p_source_template_id for update;
  if v_source.id is null or v_source.tenant_id<>v_actor.tenant_id or v_source.lifecycle not in ('published','archived') then raise exception 'Published or archived source form not found' using errcode='42501'; end if;
  if exists(select 1 from form_templates where tenant_id=v_source.tenant_id and family_id=v_source.family_id and lifecycle='draft') then raise exception 'This form family already has a draft revision' using errcode='23505'; end if;
  v_permissions := case when p_payload ? 'permissions' then normalize_form_permissions(p_payload->'permissions') else v_source.permissions end;
  select max(version)+1 into v_version from form_templates where tenant_id=v_source.tenant_id and family_id=v_source.family_id;
  insert into form_templates(tenant_id,family_id,version,lifecycle,is_active,name,description,branch_id,department_id,permissions,sections,created_by,updated_by,published_at)
  values(v_actor.tenant_id,v_source.family_id,v_version,'draft',false,btrim(coalesce(p_payload->>'name',v_source.name)),nullif(btrim(case when p_payload ? 'description' then p_payload->>'description' else v_source.description end),''),null,null,v_permissions,coalesce(v_source.sections,'[]'::jsonb),v_actor.id,v_actor.id,null) returning * into v_new;
  insert into form_fields(form_template_id,field_key,field_name,field_type,group_name,is_shown,is_editable,is_required,initial_value,options,option_source,dropdown_master_type,conditional_logic,branch_logic,sort_order,validation,placeholder,helper_text)
  select v_new.id,field_key,field_name,field_type,group_name,is_shown,is_editable,is_required,initial_value,options,option_source,dropdown_master_type,conditional_logic,branch_logic,sort_order,validation,placeholder,helper_text from form_fields where form_template_id=v_source.id order by sort_order;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'form_revision_created','forms',v_new.id,to_jsonb(v_source),to_jsonb(v_new)); return v_new.id;
end;
$$;

create or replace function duplicate_form_with_audit(
  p_source_template_id uuid,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  -- The copy keeps its sections, branches, and dropdown references; only the
  -- per-field show/hide condition is reset, exactly as before.
  insert into form_fields(
    form_template_id, field_key, field_name, field_type, group_name,
    is_shown, is_editable, is_required, initial_value, options, option_source, dropdown_master_type,
    conditional_logic, branch_logic, sort_order, validation, placeholder, helper_text
  )
  select v_new.id, field_key, field_name, field_type, group_name,
    is_shown, is_editable, is_required, initial_value, options, option_source, dropdown_master_type,
    null, branch_logic, sort_order, validation, placeholder, helper_text
  from form_fields
  where form_template_id = v_source.id
  order by sort_order;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'form_duplicated', 'forms', v_new.id,
    jsonb_build_object('source_template_id', v_source.id), to_jsonb(v_new));
  return v_new.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Submission: unreachable sections are never required and never stored
-- ---------------------------------------------------------------------------
--
-- 0088 split submission into a task-locking wrapper (submit_form_with_audit)
-- and this locked implementation. Only the implementation changes here, so the
-- wrapper keeps taking the task row lock before validation.

create or replace function submit_form_locked_with_audit(
  p_form_template_id uuid,
  p_answers jsonb,
  p_linked_module text default null,
  p_linked_record_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_template form_templates;
  v_task task_instances;
  v_instance_stage fms_instance_stages;
  v_instance fms_instances;
  v_stage fms_stages;
  v_field form_fields;
  v_value jsonb;
  v_text text;
  v_visible boolean;
  v_empty boolean;
  v_normalized jsonb := '{}'::jsonb;
  v_submission form_submissions;
  v_number numeric;
  v_reachable text[];
  v_option_values jsonb;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then
    raise exception 'An active profile is required to submit a form' using errcode='42501';
  end if;
  if jsonb_typeof(p_answers)<>'object' or pg_column_size(p_answers)>65536
     or (select count(*) from jsonb_object_keys(p_answers))>100 then
    raise exception 'Answers must be an object within the form payload limits' using errcode='22023';
  end if;
  if (p_linked_module is null)<>(p_linked_record_id is null) then
    raise exception 'Linked module and record must be supplied together' using errcode='22023';
  end if;

  select * into v_template from form_templates where id=p_form_template_id for share;
  if v_template.id is null or v_template.tenant_id<>v_actor.tenant_id then
    raise exception 'Published form version not found' using errcode='42501';
  end if;
  if exists(
    select 1 from jsonb_object_keys(p_answers) answer_key
    where not exists(select 1 from form_fields ff where ff.form_template_id=v_template.id and ff.field_key=answer_key)
  ) then
    raise exception 'Answers contain an unknown field key' using errcode='22023';
  end if;

  if p_linked_module is null then
    if v_template.lifecycle<>'published' or not v_template.is_active then
      raise exception 'Current published form version not found' using errcode='42501';
    end if;
    if not can_access_form_template(v_template.id) then
      raise exception 'The form is outside the caller Forms Library scope' using errcode='42501';
    end if;
  elsif p_linked_module in ('checklist_task','delegation_task') then
    if v_template.published_at is null or v_template.lifecycle not in ('published','archived') then
      raise exception 'Task form version has never been published' using errcode='42501';
    end if;
    select * into v_task from task_instances where id=p_linked_record_id for share;
    if v_task.id is null or v_task.tenant_id<>v_actor.tenant_id
       or not v_task.requires_form or v_task.form_template_id<>v_template.id
       or (p_linked_module='checklist_task' and v_task.task_type<>'checklist')
       or (p_linked_module='delegation_task' and v_task.task_type<>'delegation') then
      raise exception 'Task link does not require this exact published form version' using errcode='42501';
    end if;
    if not (
      v_actor.user_role in ('super_admin','admin')
      or (v_actor.user_role='manager' and v_task.branch_id=v_actor.branch_id)
      or exists(select 1 from task_assignees ta where ta.task_instance_id=v_task.id and ta.user_profile_id=v_actor.id and ta.is_active and ta.role_at_task='doer')
    ) then
      raise exception 'Caller is not an active task participant or correctly scoped reviewer' using errcode='42501';
    end if;
    if v_task.status='completed' then
      raise exception 'Completed tasks cannot accept new form submissions' using errcode='23514';
    end if;
  elsif p_linked_module='fms_stage' then
    select * into v_instance_stage from fms_instance_stages where id=p_linked_record_id for update;
    select * into v_instance from fms_instances where id=v_instance_stage.fms_instance_id for share;
    select * into v_stage from fms_stages where id=v_instance_stage.fms_stage_id for share;
    if v_instance_stage.id is null or v_instance.id is null or v_stage.id is null
       or v_instance.tenant_id<>v_actor.tenant_id or v_stage.form_template_id<>v_template.id
       or v_instance.status not in ('active','overdue')
       or v_instance_stage.status not in ('pending','in_progress','in_review','overdue') then
      raise exception 'FMS stage does not require this exact active form' using errcode='42501';
    end if;
    if not (
      v_actor.id=any(v_instance_stage.assigned_to)
      or v_actor.user_role in ('super_admin','admin')
      or (v_actor.user_role='manager' and v_actor.branch_id=v_instance.branch_id)
    ) then
      raise exception 'Caller is not allowed to submit this FMS stage form' using errcode='42501';
    end if;
    if v_instance_stage.form_submission_id is not null then
      raise exception 'This FMS stage already has a submitted form output' using errcode='23514';
    end if;
  else
    raise exception 'Linked module is not an approved task or FMS module' using errcode='22023';
  end if;

  v_reachable := form_reachable_sections(v_template.id, p_answers);

  for v_field in select * from form_fields where form_template_id=v_template.id order by sort_order loop
    v_visible := v_field.is_shown and form_condition_matches(v_field.conditional_logic,v_normalized)
      and (v_reachable is null or form_field_section_key(v_field.group_name, coalesce(v_template.sections,'[]'::jsonb)) = any(v_reachable));
    v_value := p_answers->v_field.field_key;
    if not v_visible or v_field.field_type in ('section_header','divider') then continue; end if;
    if v_field.field_type in ('text','textarea','email','phone','date','datetime','select','radio','user_dropdown','branch_dropdown','department_dropdown')
       and jsonb_typeof(v_value)='string' then
      v_value := to_jsonb(btrim(v_value #>> '{}'));
    end if;
    v_empty := v_value is null or v_value='null'::jsonb or v_value='""'::jsonb or v_value='[]'::jsonb;
    if v_field.is_required and (v_empty or (v_field.field_type='checkbox' and v_value<>'true'::jsonb)) then
      raise exception 'Required visible field % is missing',v_field.field_key using errcode='23514';
    end if;
    if v_empty then continue; end if;
    v_option_values := form_field_option_values(v_field.options, v_field.dropdown_master_type, v_actor.tenant_id);
    if v_field.field_type in ('text','textarea','email','phone','date','datetime','select','radio','user_dropdown','branch_dropdown','department_dropdown') then
      if jsonb_typeof(v_value)<>'string' then raise exception 'Field % must be a string',v_field.field_key using errcode='22023'; end if;
      v_text := v_value #>> '{}';
      if length(v_text)>5000 then raise exception 'Field % exceeds the value limit',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='email' and v_text !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Field % is not a valid email',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='phone' and (v_text !~ '^[0-9+() .-]+$' or length(regexp_replace(v_text,'\D','','g')) not between 7 and 15) then raise exception 'Field % is not a valid phone number',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='date' and not is_valid_form_date(v_text) then raise exception 'Field % is not a valid date',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='datetime' and not is_valid_form_datetime(v_text) then raise exception 'Field % is not a valid datetime',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type in ('select','radio') and not (v_option_values @> jsonb_build_array(to_jsonb(v_text))) then raise exception 'Field % contains an invalid option',v_field.field_key using errcode='22023'; end if;
      if v_field.validation ? 'minLength' and length(v_text)<(v_field.validation->>'minLength')::integer then raise exception 'Field % is shorter than allowed',v_field.field_key using errcode='23514'; end if;
      if v_field.validation ? 'maxLength' and length(v_text)>(v_field.validation->>'maxLength')::integer then raise exception 'Field % exceeds its maximum',v_field.field_key using errcode='23514'; end if;
      if v_field.field_type='user_dropdown' and not exists(select 1 from user_profiles up where up.id=v_text::uuid and up.tenant_id=v_actor.tenant_id and up.working_status='active') then raise exception 'Field % references an invalid user',v_field.field_key using errcode='23503'; end if;
      if v_field.field_type='branch_dropdown' and not exists(select 1 from branches b where b.id=v_text::uuid and b.tenant_id=v_actor.tenant_id and b.is_active) then raise exception 'Field % references an invalid branch',v_field.field_key using errcode='23503'; end if;
      if v_field.field_type='department_dropdown' and not exists(select 1 from departments d where d.id=v_text::uuid and d.tenant_id=v_actor.tenant_id and d.is_active) then raise exception 'Field % references an invalid department',v_field.field_key using errcode='23503'; end if;
      v_value := to_jsonb(v_text);
    elsif v_field.field_type in ('number','currency','rating') then
      if jsonb_typeof(v_value)<>'number' then raise exception 'Field % must be a JSON number',v_field.field_key using errcode='22023'; end if;
      v_number := (v_value #>> '{}')::numeric;
      if v_field.field_type='rating' and (v_number<>trunc(v_number) or v_number not between 1 and 5) then raise exception 'Field % must be an integer rating from 1 to 5',v_field.field_key using errcode='22023'; end if;
      if v_field.validation ? 'min' and v_number<(v_field.validation->>'min')::numeric then raise exception 'Field % is below its minimum',v_field.field_key using errcode='23514'; end if;
      if v_field.validation ? 'max' and v_number>(v_field.validation->>'max')::numeric then raise exception 'Field % exceeds its maximum',v_field.field_key using errcode='23514'; end if;
    elsif v_field.field_type='checkbox' then
      if jsonb_typeof(v_value)<>'boolean' then raise exception 'Field % must be boolean',v_field.field_key using errcode='22023'; end if;
    elsif v_field.field_type='multiselect' then
      if jsonb_typeof(v_value)<>'array' or jsonb_array_length(v_value)>100
         or exists(select 1 from jsonb_array_elements(v_value) choice where jsonb_typeof(choice)<>'string' or not (v_option_values @> jsonb_build_array(choice)))
         or (select count(*) from jsonb_array_elements_text(v_value))<>(select count(distinct choice) from jsonb_array_elements_text(v_value) choice) then
        raise exception 'Field % must contain unique configured options',v_field.field_key using errcode='22023';
      end if;
    else
      raise exception 'Deferred field type % cannot be submitted',v_field.field_type using errcode='0A000';
    end if;
    v_normalized := v_normalized || jsonb_build_object(v_field.field_key,v_value);
  end loop;

  insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,linked_module,linked_record_id,data,submitted_by,status)
  values(v_actor.tenant_id,v_actor.branch_id,v_actor.department_id,v_template.id,p_linked_module,p_linked_record_id,v_normalized,v_actor.id,'submitted')
  returning * into v_submission;
  if p_linked_module='fms_stage' then
    update fms_instance_stages set form_submission_id=v_submission.id where id=v_instance_stage.id;
    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(v_instance_stage.id,v_actor.id,'form_submitted',jsonb_build_object('form_submission_id',v_submission.id,'form_template_id',v_template.id));
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_submitted','forms',v_submission.id,jsonb_build_object('form_template_id',v_template.id,'linked_module',p_linked_module,'linked_record_id',p_linked_record_id,'answer_keys',(select jsonb_agg(key order by key) from jsonb_object_keys(v_normalized) key)));
  return v_submission.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publishing a brand-new list into the Dropdown Master from the Form Builder
-- ---------------------------------------------------------------------------
--
-- Editing existing master items stays super_admin-only.  Creating a *new*
-- category is purely additive, so a form author may do it while building a
-- form; the form then references the master rather than copying it.
create or replace function create_dropdown_list_with_audit(p_master_type text, p_options jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles; v_type text; v_options jsonb; v_option jsonb; v_index integer := 0;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then
    raise exception 'Only active form authors can create a Dropdown Master list' using errcode = '42501';
  end if;
  v_type := lower(btrim(coalesce(p_master_type,'')));
  if v_type !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'A Dropdown Master list name must match the stable key format' using errcode = '22023';
  end if;
  if exists (select 1 from dropdown_masters where master_type = v_type and (tenant_id is null or tenant_id = v_actor.tenant_id)) then
    raise exception 'A Dropdown Master list with this name already exists' using errcode = '23505';
  end if;
  v_options := normalize_form_options(p_options);
  for v_option in select value from jsonb_array_elements(v_options) loop
    insert into dropdown_masters(tenant_id, master_type, label, value, sort_order, is_active, created_by, updated_by)
    values (v_actor.tenant_id, v_type, v_option->>'label', v_option->>'value', v_index, true, v_actor.id, v_actor.id);
    v_index := v_index + 1;
  end loop;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'dropdown_list_created', 'dropdown_master', null,
    jsonb_build_object('master_type', v_type, 'options', v_options));
  return v_type;
end;
$$;

revoke all privileges on function normalize_form_fields(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function normalize_form_sections(jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function normalize_form_options(jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function form_option_values(jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function form_field_option_values(jsonb, text, uuid) from public, anon, authenticated, service_role;
revoke all privileges on function form_field_section_key(text, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function form_reachable_sections(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function replace_form_draft_fields(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function assert_form_publishable(uuid) from public, anon, authenticated, service_role;

alter function submit_form_locked_with_audit(uuid,jsonb,text,uuid) owner to postgres;
revoke all on function submit_form_locked_with_audit(uuid,jsonb,text,uuid) from public, anon, authenticated, service_role;
revoke all privileges on function save_form_draft_with_audit(uuid,jsonb,jsonb) from public, anon, service_role;
grant execute on function save_form_draft_with_audit(uuid,jsonb,jsonb) to authenticated;
revoke all privileges on function save_published_form_with_audit(uuid,jsonb,jsonb) from public, anon, service_role;
grant execute on function save_published_form_with_audit(uuid,jsonb,jsonb) to authenticated;
revoke all privileges on function create_form_revision_with_audit(uuid,jsonb) from public, anon, service_role;
grant execute on function create_form_revision_with_audit(uuid,jsonb) to authenticated;
revoke all privileges on function duplicate_form_with_audit(uuid,text) from public, anon, service_role;
grant execute on function duplicate_form_with_audit(uuid,text) to authenticated;
revoke all privileges on function create_dropdown_list_with_audit(text,jsonb) from public, anon, service_role;
grant execute on function create_dropdown_list_with_audit(text,jsonb) to authenticated;

notify pgrst, 'reload schema';
