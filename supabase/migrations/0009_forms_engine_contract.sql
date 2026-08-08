-- Phase 4A: versioned, audited, database-authoritative Forms contract.
-- UI authoring/rendering is intentionally deferred to a later phase.

set search_path = public, extensions;

create type form_template_lifecycle as enum ('draft', 'published', 'archived');
create type form_submission_status as enum ('submitted', 'approved', 'rejected');

alter table form_templates
  add column family_id uuid,
  add column lifecycle form_template_lifecycle not null default 'published',
  add column branch_id uuid references branches(id),
  add column department_id uuid references departments(id),
  add column published_by uuid references user_profiles(id),
  add column published_at timestamptz default now(),
  add column archived_by uuid references user_profiles(id),
  add column archived_at timestamptz;

update form_templates
set family_id = id,
    version = greatest(coalesce(version, 1), 1),
    lifecycle = case when is_active is true then 'published'::form_template_lifecycle else 'archived'::form_template_lifecycle end,
    published_by = case when is_active is true then created_by else null end,
    published_at = case when is_active is true then coalesce(updated_at, created_at, now()) else null end,
    archived_by = case when is_active is true then null else coalesce(updated_by, created_by) end,
    archived_at = case when is_active is true then null else coalesce(updated_at, created_at, now()) end,
    permissions = case
      when jsonb_typeof(permissions) = 'object'
        and jsonb_typeof(permissions->'roles') = 'array'
        and jsonb_array_length(permissions->'roles') between 1 and 5
        and not exists (
          select 1 from jsonb_array_elements(permissions->'roles') role_value
          where jsonb_typeof(role_value) <> 'string'
             or role_value #>> '{}' not in ('super_admin','admin','manager','crm','staff')
        )
        and (select count(*) from jsonb_array_elements_text(permissions->'roles'))
          = (select count(distinct role_value) from jsonb_array_elements_text(permissions->'roles') role_value)
        then jsonb_build_object('roles', permissions->'roles')
      else '{"roles":["super_admin","admin","manager","crm","staff"]}'::jsonb
    end;

alter table form_templates
  alter column family_id set not null,
  alter column family_id set default uuid_generate_v4(),
  alter column permissions set not null,
  alter column permissions set default '{"roles":["super_admin","admin","manager","crm","staff"]}'::jsonb,
  alter column version set default 1,
  add constraint form_templates_version_positive check (version > 0),
  add constraint form_templates_name_length check (length(btrim(name)) between 1 and 150),
  add constraint form_templates_description_length check (description is null or length(description) <= 2000),
  add constraint form_templates_scope_pair check (department_id is null or branch_id is not null),
  add constraint form_templates_permissions_object check (jsonb_typeof(permissions) = 'object');

create unique index idx_form_templates_family_version
  on form_templates(tenant_id, family_id, version);
create unique index idx_form_templates_one_draft
  on form_templates(tenant_id, family_id) where lifecycle = 'draft';
create unique index idx_form_templates_one_published
  on form_templates(tenant_id, family_id) where lifecycle = 'published';
create index idx_form_templates_library_scope
  on form_templates(tenant_id, lifecycle, branch_id, department_id, name);
create index idx_form_templates_family_history
  on form_templates(tenant_id, family_id, version desc);
create index idx_form_templates_branch on form_templates(branch_id) where branch_id is not null;
create index idx_form_templates_department on form_templates(department_id) where department_id is not null;
create index idx_form_templates_published_by on form_templates(published_by) where published_by is not null;
create index idx_form_templates_archived_by on form_templates(archived_by) where archived_by is not null;

alter table form_fields
  add column field_key text,
  add column validation jsonb not null default '{}'::jsonb,
  add column placeholder text,
  add column helper_text text,
  add column updated_at timestamptz not null default now();

with ranked as (
  select id,
    'field_' || lpad(row_number() over (partition by form_template_id order by sort_order nulls last, created_at, id)::text, 3, '0') as generated_key,
    row_number() over (partition by form_template_id order by sort_order nulls last, created_at, id) - 1 as generated_order
  from form_fields
)
update form_fields ff
set field_key = ranked.generated_key,
    sort_order = ranked.generated_order
from ranked where ranked.id = ff.id;

alter table form_fields
  alter column field_key set not null,
  alter column field_key set default ('field_' || substr(replace(uuid_generate_v4()::text,'-',''),1,16)),
  alter column sort_order set not null,
  alter column sort_order set default 0,
  alter column is_shown set not null,
  alter column is_shown set default true,
  alter column is_editable set not null,
  alter column is_editable set default true,
  alter column is_required set not null,
  alter column is_required set default false,
  add constraint form_fields_key_format check (field_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  add constraint form_fields_label_length check (length(btrim(field_name)) between 1 and 200),
  add constraint form_fields_type_check check (field_type in (
    'text','textarea','number','currency','email','phone','date','datetime',
    'select','multiselect','radio','checkbox','rating','section_header','divider',
    'user_dropdown','branch_dropdown','department_dropdown','file'
  )),
  add constraint form_fields_order_nonnegative check (sort_order >= 0),
  add constraint form_fields_options_shape check (options is null or jsonb_typeof(options) = 'array'),
  add constraint form_fields_validation_shape check (jsonb_typeof(validation) = 'object'),
  add constraint form_fields_condition_shape check (conditional_logic is null or jsonb_typeof(conditional_logic) = 'object'),
  add constraint form_fields_placeholder_length check (placeholder is null or length(placeholder) <= 300),
  add constraint form_fields_helper_length check (helper_text is null or length(helper_text) <= 500),
  add constraint form_fields_layout_not_required check (field_type not in ('section_header','divider') or is_required is false),
  add constraint form_fields_template_key_unique unique(form_template_id, field_key),
  add constraint form_fields_template_order_unique unique(form_template_id, sort_order);

drop index if exists idx_form_fields_template_sort;
create index idx_form_fields_template_sort on form_fields(form_template_id, sort_order, id);

alter table form_submissions
  add column status form_submission_status not null default 'submitted',
  add column reviewed_by uuid references user_profiles(id),
  add column reviewed_at timestamptz,
  add column review_notes text,
  add column updated_at timestamptz not null default now(),
  add constraint form_submissions_review_notes_length check (review_notes is null or length(review_notes) <= 2000),
  add constraint form_submissions_link_pair check ((linked_module is null) = (linked_record_id is null)),
  add constraint form_submissions_data_object check (jsonb_typeof(data) = 'object'),
  add constraint form_submissions_review_metadata check (
    (status = 'submitted' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null)
  );

create index idx_form_submissions_owner_created
  on form_submissions(tenant_id, submitted_by, submitted_at desc);
create index idx_form_submissions_template_created
  on form_submissions(tenant_id, form_template_id, submitted_at desc);
create index idx_form_submissions_review_queue
  on form_submissions(tenant_id, branch_id, status, submitted_at desc);
create index idx_form_submissions_reviewed_by on form_submissions(reviewed_by) where reviewed_by is not null;

-- A published or archived version is definition-immutable. The single allowed
-- transition is published -> archived with lifecycle metadata only.
create function enforce_form_template_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.lifecycle in ('published','archived') then
    if old.lifecycle = 'published' and new.lifecycle = 'archived'
       and (to_jsonb(new) - array['lifecycle','is_active','archived_by','archived_at','updated_by','updated_at'])
         = (to_jsonb(old) - array['lifecycle','is_active','archived_by','archived_at','updated_by','updated_at']) then
      return new;
    end if;
    raise exception 'Published and archived form definitions are immutable; create a revision' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger form_templates_immutable_versions
before update or delete on form_templates
for each row execute function enforce_form_template_immutability();

create function enforce_form_field_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_template_id uuid := coalesce(new.form_template_id, old.form_template_id);
begin
  if tg_op = 'INSERT' and exists (
    select 1 from form_templates
    where id = v_template_id and lifecycle = 'published'
      and created_by is null and published_by is null
  ) then
    -- Compatibility for owner-seeded legacy fixtures. Browser roles have no
    -- direct INSERT privilege; every production write remains RPC-only.
    return new;
  end if;
  if exists (select 1 from form_templates where id = v_template_id and lifecycle in ('published','archived')) then
    raise exception 'Fields on published and archived forms are immutable; create a revision' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger form_fields_immutable_versions
before insert or update or delete on form_fields
for each row execute function enforce_form_field_immutability();

create function normalize_form_permissions(p_permissions jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
begin
  if p_permissions is null then
    return '{"roles":["super_admin","admin","manager","crm","staff"]}'::jsonb;
  end if;
  if jsonb_typeof(p_permissions) <> 'object'
     or p_permissions - array['roles'] <> '{}'::jsonb
     or jsonb_typeof(p_permissions->'roles') <> 'array'
     or jsonb_array_length(p_permissions->'roles') = 0
     or jsonb_array_length(p_permissions->'roles') > 5
     or exists (
       select 1 from jsonb_array_elements(p_permissions->'roles') role_value
       where jsonb_typeof(role_value) <> 'string'
          or role_value #>> '{}' not in ('super_admin','admin','manager','crm','staff')
     )
     or (select count(*) from jsonb_array_elements_text(p_permissions->'roles'))
       <> (select count(distinct role_value) from jsonb_array_elements_text(p_permissions->'roles') role_value) then
    raise exception 'Form permissions must contain unique approved Forms Library roles only' using errcode = '22023';
  end if;
  return jsonb_build_object('roles', p_permissions->'roles');
end;
$$;

create function normalize_form_fields(p_fields jsonb)
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
  v_key text;
  v_type text;
  v_label text;
  v_seen text[] := array[]::text[];
  v_result jsonb := '[]'::jsonb;
  v_index integer := 0;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) > 100 then
    raise exception 'Fields must be an array containing at most 100 entries' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(v_item) <> 'object' or v_item - array[
      'key','label','type','required','shown','editable','placeholder','helperText',
      'options','validation','condition'
    ] <> '{}'::jsonb then
      raise exception 'A field contains unsupported keys' using errcode = '22023';
    end if;
    v_key := lower(btrim(v_item->>'key'));
    v_label := btrim(v_item->>'label');
    v_type := v_item->>'type';
    v_options := v_item->'options';
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
    if v_type in ('select','multiselect','radio') then
      if jsonb_typeof(v_options) <> 'array' or jsonb_array_length(v_options) not between 1 and 100
         or exists (select 1 from jsonb_array_elements(v_options) option_value where jsonb_typeof(option_value) <> 'string' or length(btrim(option_value #>> '{}')) not between 1 and 200)
         or (select count(*) from jsonb_array_elements_text(v_options)) <> (select count(distinct option_value) from jsonb_array_elements_text(v_options) option_value) then
        raise exception 'Option fields require 1 to 100 unique bounded string options' using errcode = '22023';
      end if;
    elsif v_options is not null then
      raise exception 'Options are allowed only for select, multiselect, and radio fields' using errcode = '22023';
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
    if v_condition is not null then
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
    end if;
    v_result := v_result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'key', v_key, 'label', v_label, 'type', v_type, 'sortOrder', v_index,
      'required', coalesce((v_item->>'required')::boolean,false),
      'shown', coalesce((v_item->>'shown')::boolean,true),
      'editable', coalesce((v_item->>'editable')::boolean,true),
      'placeholder', nullif(btrim(v_item->>'placeholder'),''),
      'helperText', nullif(btrim(v_item->>'helperText'),''),
      'options', v_options, 'validation', v_validation, 'condition', v_condition
    )));
    v_seen := array_append(v_seen, v_key);
    v_index := v_index + 1;
  end loop;
  return v_result;
end;
$$;

create function assert_form_publishable(p_template_id uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
declare v_count integer;
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
  perform normalize_form_fields(coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'key',ff.field_key,'label',ff.field_name,'type',ff.field_type,
      'required',ff.is_required,'shown',ff.is_shown,'editable',ff.is_editable,
      'placeholder',ff.placeholder,'helperText',ff.helper_text,'options',ff.options,
      'validation',ff.validation,'condition',ff.conditional_logic
    )) order by ff.sort_order)
    from form_fields ff where ff.form_template_id=p_template_id
  ),'[]'::jsonb));
end;
$$;

create function form_condition_matches(p_condition jsonb, p_answers jsonb)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_source jsonb;
  v_operator text;
  v_expected jsonb;
begin
  if p_condition is null then return true; end if;
  v_source := p_answers->(p_condition->>'fieldKey');
  v_operator := p_condition->>'operator';
  v_expected := p_condition->'value';
  if v_operator = 'equals' then return v_source = v_expected; end if;
  if v_operator = 'not_equals' then return v_source is distinct from v_expected; end if;
  if v_operator = 'not_empty' then
    return v_source is not null and v_source <> 'null'::jsonb and v_source <> '""'::jsonb and v_source <> '[]'::jsonb;
  end if;
  if v_operator = 'contains' then
    if jsonb_typeof(v_source) = 'array' then return v_source @> jsonb_build_array(v_expected); end if;
    if jsonb_typeof(v_source) = 'string' and jsonb_typeof(v_expected) = 'string' then
      return position(v_expected #>> '{}' in v_source #>> '{}') > 0;
    end if;
    return false;
  end if;
  return false;
end;
$$;

alter table form_templates
  add constraint form_templates_permissions_contract
  check (permissions = normalize_form_permissions(permissions));

create function is_valid_form_date(p_value text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  return p_value ~ '^\d{4}-\d{2}-\d{2}$' and to_char(p_value::date, 'YYYY-MM-DD') = p_value;
exception when others then return false;
end;
$$;

create function is_valid_form_datetime(p_value text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if p_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$' then return false; end if;
  perform p_value::timestamptz;
  return true;
exception when others then return false;
end;
$$;

create function can_manage_form_template(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select current_profile_is_active()) and exists (
    select 1 from form_templates ft
    where ft.id = p_template_id
      and ft.tenant_id = (select current_tenant_id())
      and (
        (select current_role_level()) in ('super_admin','admin')
        or ((select current_role_level()) = 'manager'
          and ft.branch_id is not null
          and ft.branch_id = (select current_branch_id()))
      )
  );
$$;

create function can_read_form_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select current_profile_is_active()) and exists (
    select 1
    from form_submissions fs
    where fs.id = p_submission_id
      and fs.tenant_id = (select current_tenant_id())
      and (
        fs.submitted_by = (select (current_profile()).id)
        or (select current_role_level()) in ('super_admin','admin')
        or ((select current_role_level()) = 'manager' and fs.branch_id = (select current_branch_id()))
        or (
          fs.linked_module in ('checklist_task','delegation_task')
          and exists (
            select 1 from task_instances ti
            where ti.id = fs.linked_record_id
              and ti.tenant_id = fs.tenant_id
              and ((ti.task_type = 'checklist' and fs.linked_module = 'checklist_task')
                or (ti.task_type = 'delegation' and fs.linked_module = 'delegation_task'))
              and exists (
                select 1 from task_assignees ta
                where ta.task_instance_id = ti.id
                  and ta.user_profile_id = (select (current_profile()).id)
                  and ta.is_active and ta.role_at_task = 'doer'
              )
          )
        )
      )
  );
$$;

create function can_access_form_template(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select current_profile_is_active()) and exists (
    select 1
    from form_templates ft
    where ft.id = p_template_id
      and ft.tenant_id = (select current_tenant_id())
      and (
        (
          ft.lifecycle = 'published' and ft.is_active is true
          and (select current_role_level()) in ('super_admin','admin','manager','crm','staff')
          and (
            (select current_role_level()) in ('super_admin','admin')
            or (ft.permissions->'roles') ? ((select current_role_level())::text)
          )
          and (
            (select current_role_level()) in ('super_admin','admin')
            or (ft.branch_id is null or ft.branch_id = (select current_branch_id()))
          )
          and (
            (select current_role_level()) in ('super_admin','admin','manager')
            or ft.department_id is null
            or ft.department_id = (select (current_profile()).department_id)
          )
        )
        or (
          ft.lifecycle = 'draft'
          and (
            (select current_role_level()) in ('super_admin','admin')
            or ((select current_role_level()) = 'manager' and ft.branch_id = (select current_branch_id()))
          )
        )
        or exists (
          select 1 from form_submissions fs
          where fs.form_template_id = ft.id and can_read_form_submission(fs.id)
        )
        or (
          ft.published_at is not null and ft.lifecycle in ('published','archived')
          and exists (
            select 1 from task_instances ti
            join task_assignees ta on ta.task_instance_id = ti.id
            where ti.tenant_id = ft.tenant_id
              and ti.form_template_id = ft.id and ti.requires_form
              and ta.user_profile_id = (select (current_profile()).id)
              and ta.is_active and ta.role_at_task = 'doer'
          )
        )
      )
  );
$$;

-- Replace the Phase 2/3A Forms policies with version-aware policies. Policy
-- helpers are SECURITY DEFINER to keep joins fail-closed and avoid recursion.
drop policy if exists form_templates_select on form_templates;
create policy form_templates_select on form_templates
for select to authenticated using (can_access_form_template(id));

drop policy if exists form_fields_select on form_fields;
create policy form_fields_select on form_fields
for select to authenticated using (can_access_form_template(form_template_id));

drop policy if exists form_links_select on form_links;
create policy form_links_select on form_links
for select to authenticated using (can_access_form_template(form_template_id));

drop policy if exists form_submissions_task_select on form_submissions;
create policy form_submissions_select on form_submissions
for select to authenticated using (can_read_form_submission(id));

revoke all privileges on table form_templates, form_fields, form_links, form_submissions
from public, anon, authenticated, service_role;
grant select on table form_templates, form_fields, form_links, form_submissions to authenticated;

create function replace_form_draft_fields(p_template_id uuid, p_fields jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare v_field jsonb;
begin
  delete from form_fields where form_template_id = p_template_id;
  for v_field in select value from jsonb_array_elements(p_fields) loop
    insert into form_fields(
      form_template_id, field_key, field_name, field_type, is_shown, is_editable,
      is_required, options, conditional_logic, validation, placeholder,
      helper_text, sort_order
    ) values (
      p_template_id, v_field->>'key', v_field->>'label', v_field->>'type',
      (v_field->>'shown')::boolean, (v_field->>'editable')::boolean,
      (v_field->>'required')::boolean, v_field->'options', v_field->'condition',
      coalesce(v_field->'validation','{}'::jsonb), v_field->>'placeholder',
      v_field->>'helperText', (v_field->>'sortOrder')::integer
    );
  end loop;
end;
$$;

create function save_form_draft_with_audit(
  p_template_id uuid,
  p_payload jsonb,
  p_fields jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_old form_templates;
  v_new form_templates;
  v_id uuid;
  v_family uuid;
  v_branch uuid;
  v_department uuid;
  v_permissions jsonb;
  v_fields jsonb;
  v_old_fields jsonb;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then
    raise exception 'Only active manager, admin, or super_admin profiles can author forms' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','description','branch_id','department_id','permissions'] <> '{}'::jsonb then
    raise exception 'Form draft payload contains unsupported keys' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'name'),'') is null or length(btrim(p_payload->>'name')) > 150
     or length(coalesce(p_payload->>'description','')) > 2000 then
    raise exception 'Form name or description exceeds its limit' using errcode = '22023';
  end if;
  v_branch := nullif(p_payload->>'branch_id','')::uuid;
  v_department := nullif(p_payload->>'department_id','')::uuid;
  if v_actor.user_role = 'manager' then
    if v_branch is not null and v_branch <> v_actor.branch_id then
      raise exception 'Managers can author forms only for their own branch' using errcode = '42501';
    end if;
    v_branch := v_actor.branch_id;
  end if;
  if v_branch is not null and not exists (select 1 from branches where id = v_branch and tenant_id = v_actor.tenant_id and is_active) then
    raise exception 'Form branch is invalid or inactive' using errcode = '23503';
  end if;
  if v_department is not null and (v_branch is null or not exists (
    select 1 from departments where id = v_department and tenant_id = v_actor.tenant_id and branch_id = v_branch and is_active
  )) then raise exception 'Form department must belong to the selected active branch' using errcode = '23503'; end if;
  v_permissions := normalize_form_permissions(p_payload->'permissions');
  v_fields := normalize_form_fields(p_fields);

  if p_template_id is null then
    v_family := extensions.uuid_generate_v4();
    insert into form_templates(
      tenant_id,family_id,version,lifecycle,is_active,name,description,branch_id,
      department_id,permissions,created_by,updated_by,published_at
    ) values (
      v_actor.tenant_id,v_family,1,'draft',false,btrim(p_payload->>'name'),
      nullif(btrim(p_payload->>'description'),''),v_branch,v_department,v_permissions,
      v_actor.id,v_actor.id,null
    ) returning * into v_new;
    v_id := v_new.id;
  else
    select * into v_old from form_templates where id = p_template_id for update;
    if v_old.id is null or v_old.tenant_id <> v_actor.tenant_id or v_old.lifecycle <> 'draft' then
      raise exception 'Editable form draft not found' using errcode = '42501';
    end if;
    if v_actor.user_role = 'manager' and v_old.branch_id <> v_actor.branch_id then
      raise exception 'Managers cannot edit another branch form draft' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(to_jsonb(ff) order by ff.sort_order),'[]'::jsonb) into v_old_fields
    from form_fields ff where ff.form_template_id = v_old.id;
    update form_templates set
      name=btrim(p_payload->>'name'), description=nullif(btrim(p_payload->>'description'),''),
      branch_id=v_branch, department_id=v_department, permissions=v_permissions,
      updated_by=v_actor.id, updated_at=now()
    where id=p_template_id returning * into v_new;
    v_id := v_new.id;
  end if;
  perform replace_form_draft_fields(v_id, v_fields);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,
    case when p_template_id is null then 'form_draft_created' else 'form_draft_updated' end,
    'forms',v_id,
    case when p_template_id is null then null else jsonb_build_object('template',to_jsonb(v_old),'fields',v_old_fields) end,
    jsonb_build_object('template',to_jsonb(v_new),'fields',v_fields));
  return v_id;
end;
$$;

create function create_form_revision_with_audit(p_source_template_id uuid, p_payload jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_source form_templates;
  v_new form_templates;
  v_branch uuid;
  v_department uuid;
  v_permissions jsonb;
  v_version integer;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then
    raise exception 'Only active form authors can create revisions' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','description','branch_id','department_id','permissions'] <> '{}'::jsonb then
    raise exception 'Form revision payload contains unsupported keys' using errcode = '22023';
  end if;
  select * into v_source from form_templates where id = p_source_template_id for update;
  if v_source.id is null or v_source.tenant_id <> v_actor.tenant_id or v_source.lifecycle not in ('published','archived') then
    raise exception 'Published or archived source form not found' using errcode = '42501';
  end if;
  if v_actor.user_role = 'manager' and (v_source.branch_id is null or v_source.branch_id <> v_actor.branch_id) then
    raise exception 'Managers can revise only forms constrained to their branch' using errcode = '42501';
  end if;
  if exists(select 1 from form_templates where tenant_id=v_source.tenant_id and family_id=v_source.family_id and lifecycle='draft') then
    raise exception 'This form family already has a draft revision' using errcode = '23505';
  end if;
  v_branch := case when p_payload ? 'branch_id' then nullif(p_payload->>'branch_id','')::uuid else v_source.branch_id end;
  if v_actor.user_role='manager' then v_branch := v_actor.branch_id; end if;
  v_department := case when p_payload ? 'department_id' then nullif(p_payload->>'department_id','')::uuid else v_source.department_id end;
  v_permissions := case when p_payload ? 'permissions' then normalize_form_permissions(p_payload->'permissions') else v_source.permissions end;
  if nullif(btrim(coalesce(p_payload->>'name',v_source.name)),'') is null or length(btrim(coalesce(p_payload->>'name',v_source.name)))>150
     or length(coalesce(p_payload->>'description',v_source.description,''))>2000 then
    raise exception 'Form name or description exceeds its limit' using errcode='22023';
  end if;
  if v_branch is not null and not exists(select 1 from branches where id=v_branch and tenant_id=v_actor.tenant_id and is_active) then raise exception 'Form branch is invalid' using errcode='23503'; end if;
  if v_department is not null and (v_branch is null or not exists(select 1 from departments where id=v_department and tenant_id=v_actor.tenant_id and branch_id=v_branch and is_active)) then raise exception 'Form department is invalid' using errcode='23503'; end if;
  select max(version)+1 into v_version from form_templates where tenant_id=v_source.tenant_id and family_id=v_source.family_id;
  insert into form_templates(tenant_id,family_id,version,lifecycle,is_active,name,description,branch_id,department_id,permissions,created_by,updated_by,published_at)
  values(v_actor.tenant_id,v_source.family_id,v_version,'draft',false,
    btrim(coalesce(p_payload->>'name',v_source.name)),
    nullif(btrim(case when p_payload ? 'description' then p_payload->>'description' else v_source.description end),''),
    v_branch,v_department,v_permissions,v_actor.id,v_actor.id,null)
  returning * into v_new;
  insert into form_fields(form_template_id,field_key,field_name,field_type,group_name,is_shown,is_editable,is_required,initial_value,options,conditional_logic,sort_order,validation,placeholder,helper_text)
  select v_new.id,field_key,field_name,field_type,group_name,is_shown,is_editable,is_required,initial_value,options,conditional_logic,sort_order,validation,placeholder,helper_text
  from form_fields where form_template_id=v_source.id order by sort_order;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_revision_created','forms',v_new.id,to_jsonb(v_source),to_jsonb(v_new));
  return v_new.id;
end;
$$;

create function publish_form_with_audit(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_actor user_profiles; v_old form_templates; v_new form_templates; v_previous form_templates;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active form authors can publish forms' using errcode='42501'; end if;
  select * into v_old from form_templates where id=p_template_id for update;
  if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or v_old.lifecycle<>'draft' then raise exception 'Publishable draft not found' using errcode='42501'; end if;
  if v_actor.user_role='manager' and (v_old.branch_id is null or v_old.branch_id<>v_actor.branch_id) then raise exception 'Managers can publish only their branch forms' using errcode='42501'; end if;
  perform assert_form_publishable(v_old.id);
  select * into v_previous from form_templates where tenant_id=v_old.tenant_id and family_id=v_old.family_id and lifecycle='published' for update;
  if v_previous.id is not null then
    update form_templates set lifecycle='archived',is_active=false,archived_by=v_actor.id,archived_at=now(),updated_by=v_actor.id,updated_at=now() where id=v_previous.id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_actor.tenant_id,v_actor.id,'form_version_superseded','forms',v_previous.id,to_jsonb(v_previous),jsonb_build_object('lifecycle','archived','superseded_by',v_old.id));
  end if;
  update form_templates set lifecycle='published',is_active=true,published_by=v_actor.id,published_at=now(),archived_by=null,archived_at=null,updated_by=v_actor.id,updated_at=now()
  where id=v_old.id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_published','forms',v_new.id,to_jsonb(v_old),to_jsonb(v_new));
  return v_new.id;
end;
$$;

create function archive_form_with_audit(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_actor user_profiles; v_old form_templates; v_new form_templates;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active form authors can archive forms' using errcode='42501'; end if;
  select * into v_old from form_templates where id=p_template_id for update;
  if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or v_old.lifecycle='archived' then raise exception 'Archivable form not found' using errcode='42501'; end if;
  if v_actor.user_role='manager' and (v_old.branch_id is null or v_old.branch_id<>v_actor.branch_id) then raise exception 'Managers can archive only their branch forms' using errcode='42501'; end if;
  update form_templates set lifecycle='archived',is_active=false,archived_by=v_actor.id,archived_at=now(),updated_by=v_actor.id,updated_at=now()
  where id=v_old.id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_archived','forms',v_new.id,to_jsonb(v_old),to_jsonb(v_new));
  return v_new.id;
end;
$$;

create function submit_form_with_audit(
  p_form_template_id uuid,
  p_answers jsonb,
  p_linked_module text default null,
  p_linked_record_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_template form_templates;
  v_task task_instances;
  v_field form_fields;
  v_value jsonb;
  v_text text;
  v_visible boolean;
  v_empty boolean;
  v_normalized jsonb := '{}'::jsonb;
  v_submission form_submissions;
  v_number numeric;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'An active profile is required to submit a form' using errcode='42501'; end if;
  if jsonb_typeof(p_answers)<>'object' or pg_column_size(p_answers)>65536
     or (select count(*) from jsonb_object_keys(p_answers))>100 then
    raise exception 'Answers must be an object within the form payload limits' using errcode='22023';
  end if;
  if (p_linked_module is null)<>(p_linked_record_id is null) then raise exception 'Linked module and record must be supplied together' using errcode='22023'; end if;
  select * into v_template from form_templates where id=p_form_template_id for share;
  if v_template.id is null or v_template.tenant_id<>v_actor.tenant_id then
    raise exception 'Published form version not found' using errcode='42501';
  end if;
  if exists(select 1 from jsonb_object_keys(p_answers) answer_key where not exists(select 1 from form_fields ff where ff.form_template_id=v_template.id and ff.field_key=answer_key)) then
    raise exception 'Answers contain an unknown field key' using errcode='22023';
  end if;

  if p_linked_module is null then
    if v_template.lifecycle<>'published' or not v_template.is_active then raise exception 'Current published form version not found' using errcode='42501'; end if;
    if not can_access_form_template(v_template.id) then raise exception 'The form is outside the caller Forms Library scope' using errcode='42501'; end if;
  else
    if v_template.published_at is null or v_template.lifecycle not in ('published','archived') then raise exception 'Task form version has never been published' using errcode='42501'; end if;
    if p_linked_module not in ('checklist_task','delegation_task') then raise exception 'Linked module is not an approved task module' using errcode='22023'; end if;
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
    ) then raise exception 'Caller is not an active task participant or correctly scoped reviewer' using errcode='42501'; end if;
  end if;

  for v_field in select * from form_fields where form_template_id=v_template.id order by sort_order loop
    v_visible := v_field.is_shown and form_condition_matches(v_field.conditional_logic,v_normalized);
    v_value := p_answers->v_field.field_key;
    if not v_visible or v_field.field_type in ('section_header','divider') then continue; end if;
    v_empty := v_value is null or v_value='null'::jsonb or v_value='""'::jsonb or v_value='[]'::jsonb;
    if v_field.is_required and (v_empty or (v_field.field_type='checkbox' and v_value<>'true'::jsonb)) then
      raise exception 'Required visible field % is missing',v_field.field_key using errcode='23514';
    end if;
    if v_empty then continue; end if;

    if v_field.field_type in ('text','textarea','email','phone','date','datetime','select','radio','user_dropdown','branch_dropdown','department_dropdown') then
      if jsonb_typeof(v_value)<>'string' then raise exception 'Field % must be a string',v_field.field_key using errcode='22023'; end if;
      v_text := btrim(v_value #>> '{}');
      if length(v_text)>5000 then raise exception 'Field % exceeds the value limit',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='email' and v_text !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Field % is not a valid email',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='phone' and (v_text !~ '^[0-9+() .-]+$' or length(regexp_replace(v_text,'\D','','g')) not between 7 and 15) then raise exception 'Field % is not a valid phone number',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='date' and not is_valid_form_date(v_text) then raise exception 'Field % is not a valid date',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='datetime' and not is_valid_form_datetime(v_text) then raise exception 'Field % is not a valid datetime',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type in ('select','radio') and not (v_field.options @> jsonb_build_array(to_jsonb(v_text))) then raise exception 'Field % contains an invalid option',v_field.field_key using errcode='22023'; end if;
      if v_field.validation ? 'minLength' and length(v_text)<(v_field.validation->>'minLength')::integer then raise exception 'Field % is shorter than allowed',v_field.field_key using errcode='22023'; end if;
      if v_field.validation ? 'maxLength' and length(v_text)>(v_field.validation->>'maxLength')::integer then raise exception 'Field % is longer than allowed',v_field.field_key using errcode='22023'; end if;
      if v_field.field_type='user_dropdown' and not exists(select 1 from user_profiles up where up.id=v_text::uuid and up.tenant_id=v_actor.tenant_id and up.working_status='active') then raise exception 'Field % references an invalid user',v_field.field_key using errcode='23503'; end if;
      if v_field.field_type='branch_dropdown' and not exists(select 1 from branches b where b.id=v_text::uuid and b.tenant_id=v_actor.tenant_id and b.is_active) then raise exception 'Field % references an invalid branch',v_field.field_key using errcode='23503'; end if;
      if v_field.field_type='department_dropdown' and not exists(select 1 from departments d where d.id=v_text::uuid and d.tenant_id=v_actor.tenant_id and d.is_active) then raise exception 'Field % references an invalid department',v_field.field_key using errcode='23503'; end if;
      v_value := to_jsonb(v_text);
    elsif v_field.field_type in ('number','currency','rating') then
      if jsonb_typeof(v_value)<>'number' then raise exception 'Field % must be a JSON number',v_field.field_key using errcode='22023'; end if;
      v_number := (v_value #>> '{}')::numeric;
      if v_field.field_type='rating' and (v_number<>trunc(v_number) or v_number not between 1 and 5) then raise exception 'Field % must be an integer rating from 1 to 5',v_field.field_key using errcode='22023'; end if;
      if v_field.validation ? 'min' and v_number<(v_field.validation->>'min')::numeric then raise exception 'Field % is below its minimum',v_field.field_key using errcode='22023'; end if;
      if v_field.validation ? 'max' and v_number>(v_field.validation->>'max')::numeric then raise exception 'Field % exceeds its maximum',v_field.field_key using errcode='22023'; end if;
    elsif v_field.field_type='checkbox' then
      if jsonb_typeof(v_value)<>'boolean' then raise exception 'Field % must be boolean',v_field.field_key using errcode='22023'; end if;
    elsif v_field.field_type='multiselect' then
      if jsonb_typeof(v_value)<>'array' or jsonb_array_length(v_value)>100
         or exists(select 1 from jsonb_array_elements(v_value) choice where jsonb_typeof(choice)<>'string' or not (v_field.options @> jsonb_build_array(choice)))
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
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_submitted','forms',v_submission.id,jsonb_build_object('form_template_id',v_template.id,'linked_module',p_linked_module,'linked_record_id',p_linked_record_id,'answer_keys',(select jsonb_agg(key order by key) from jsonb_object_keys(v_normalized) key)));
  return v_submission.id;
end;
$$;

create function review_form_submission_with_audit(p_submission_id uuid, p_decision text, p_review_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_actor user_profiles; v_old form_submissions; v_new form_submissions;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active elevated profiles can review form submissions' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') or length(coalesce(p_review_notes,''))>2000 then raise exception 'Review decision or notes are invalid' using errcode='22023'; end if;
  select * into v_old from form_submissions where id=p_submission_id for update;
  if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or v_old.status<>'submitted' then raise exception 'Reviewable submission not found' using errcode='42501'; end if;
  if v_actor.user_role='manager' and v_old.branch_id<>v_actor.branch_id then raise exception 'Managers can review submissions only in their branch' using errcode='42501'; end if;
  update form_submissions set status=p_decision::form_submission_status,reviewed_by=v_actor.id,reviewed_at=now(),review_notes=nullif(btrim(p_review_notes),''),updated_at=now()
  where id=v_old.id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_submission_'||p_decision,'forms',v_new.id,to_jsonb(v_old),to_jsonb(v_new));
  return v_new.id;
end;
$$;

-- Explicitly preserve migration 0006's default-deny function posture.
revoke all privileges on function enforce_form_template_immutability() from public, anon, authenticated, service_role;
revoke all privileges on function enforce_form_field_immutability() from public, anon, authenticated, service_role;
revoke all privileges on function normalize_form_permissions(jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function normalize_form_fields(jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function assert_form_publishable(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function form_condition_matches(jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function is_valid_form_date(text) from public, anon, authenticated, service_role;
revoke all privileges on function is_valid_form_datetime(text) from public, anon, authenticated, service_role;
revoke all privileges on function replace_form_draft_fields(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function can_manage_form_template(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function can_read_form_submission(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function can_access_form_template(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function save_form_draft_with_audit(uuid,jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function create_form_revision_with_audit(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function publish_form_with_audit(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function archive_form_with_audit(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function submit_form_with_audit(uuid,jsonb,text,uuid) from public, anon, authenticated, service_role;
revoke all privileges on function review_form_submission_with_audit(uuid,text,text) from public, anon, authenticated, service_role;

grant execute on function can_manage_form_template(uuid) to authenticated;
grant execute on function can_read_form_submission(uuid) to authenticated;
grant execute on function can_access_form_template(uuid) to authenticated;
grant execute on function save_form_draft_with_audit(uuid,jsonb,jsonb) to authenticated;
grant execute on function create_form_revision_with_audit(uuid,jsonb) to authenticated;
grant execute on function publish_form_with_audit(uuid) to authenticated;
grant execute on function archive_form_with_audit(uuid) to authenticated;
grant execute on function submit_form_with_audit(uuid,jsonb,text,uuid) to authenticated;
grant execute on function review_form_submission_with_audit(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
