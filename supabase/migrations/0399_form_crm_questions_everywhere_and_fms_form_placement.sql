-- Owner requests 2026-11-09.
--
-- 1. Repeating group and CRM photo questions submit in every form.
--    Before: a form with a "Repeating group (CRM)" or "CRM photo / video" question could be
--    built and published, but submitting it outside CRM failed with "Deferred field type
--    repeat cannot be submitted" (0375 kept refusing them in fms_validate_candidate_form, the
--    one answer validator behind library, task, FMS start and FMS step submissions).
--    After:
--      * repeat: {"kind":"repeat","count":"3"|"NA","rows":[{sub_key:"text"}]} is validated
--        against validation.repeat (count range, NA only when allowed, row questions known,
--        required row answers present, phone and option checks) and saved trimmed.
--      * crm_photo: outside CRM the photos upload through the private form-uploads bucket
--        like a file question (register_form_upload now also takes crm_photo questions, with
--        HEIC/HEIF images and, when the question allows videos, MP4/MOV/WebM). The answer
--        {"kind":"crm_files","files":[{"path":"<upload id>",...}]} must reference the caller's
--        unused uploads for this exact form and question, at most validation.crm.maxFiles;
--        file names and types are rewritten from the registered uploads and the uploads are
--        linked to the submission like file answers. CRM's own walk-in form still saves its
--        photos to CRM documents through CRM (unchanged).
--      * An empty repeat ({"count":""}) or photo list counts as unanswered, so a required one
--        reports "Required visible field ... is missing".
--      * Customer Integration keeps both types operational (never copied into a CRM client
--        detail), like file questions.
--
-- 2. Forms Library -> FMS workflow forms keeps forms made in FMS (owner report: FMS forms
--    were listed under Forms Library).
--    Before: a family counted as FMS-built only while a step still pointed at it with
--    questionnaire.origin stage/copied. A questionnaire made in a step whose draft was later
--    discarded or replaced, a step that was deleted or switched to "Link existing form", a
--    draft whose step save failed, and Form drafts made by the FMS AI assistant all fell back
--    into Forms Library.
--    After: form_family_placements records where a family is listed. The FMS builder and the
--    FMS AI assistant mark the forms they create, and form authors can press "Move to FMS
--    workflow forms" / "Move to Forms Library" on any form (set_form_family_placement,
--    audited). list_fms_built_forms lists stage-built families (as before) plus families
--    marked FMS, minus families marked Library; a family marked FMS also shows every step
--    that links it. Existing families that are hidden from the staff library in every version
--    and are used by an FMS step (the forms the FMS builder made) are marked FMS once here.
--    Classification only: no form, answer, assignment or permission changes.
set search_path=public,extensions;

-- 1a. Repeating group answers ---------------------------------------------------------------
create or replace function public.form_repeat_answer(p_config jsonb,p_value jsonb,p_field_key text)
returns jsonb language plpgsql stable set search_path=public as $$
declare
  v_count_text text; v_count integer; v_min integer; v_max integer;
  v_rows jsonb:='[]'::jsonb; v_row jsonb; v_clean jsonb; v_sub jsonb; v_key text; v_cell text;
begin
  if p_config is null or jsonb_typeof(p_config)<>'object' or jsonb_typeof(p_config->'fields')<>'array'
     or jsonb_array_length(p_config->'fields')=0 then
    raise exception 'Field % has no questions per row',p_field_key using errcode='22023';
  end if;
  if jsonb_typeof(p_value)<>'object' or p_value->>'kind' is distinct from 'repeat'
     or jsonb_typeof(p_value->'count') is distinct from 'string'
     or (p_value ? 'rows' and jsonb_typeof(p_value->'rows')<>'array')
     or (p_value - array['kind','count','rows'])<>'{}'::jsonb then
    raise exception 'Field % must list its rows',p_field_key using errcode='22023';
  end if;
  v_count_text:=btrim(p_value->>'count');
  if v_count_text='NA' then
    if coalesce(p_config->'allowNa','false'::jsonb)<>'true'::jsonb then
      raise exception 'Field %: choose how many',p_field_key using errcode='22023';
    end if;
    return jsonb_build_object('kind','repeat','count','NA','rows','[]'::jsonb);
  end if;
  v_min:=case when jsonb_typeof(p_config->'min')='number' then floor((p_config->>'min')::numeric)::integer else 0 end;
  v_max:=case when jsonb_typeof(p_config->'max')='number' then floor((p_config->>'max')::numeric)::integer else 10 end;
  if v_count_text !~ '^[0-9]{1,3}$' then
    raise exception 'Field %: choose how many',p_field_key using errcode='22023';
  end if;
  v_count:=v_count_text::integer;
  if v_count<v_min or v_count>v_max then
    raise exception 'Field %: choose % to %',p_field_key,v_min,v_max using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(p_value->'rows','[]'::jsonb))>100 then
    raise exception 'Field % has too many rows',p_field_key using errcode='22023';
  end if;
  for v_index in 0..v_count-1 loop
    v_row:=coalesce(p_value->'rows'->v_index,'{}'::jsonb);
    if jsonb_typeof(v_row)<>'object' then
      raise exception 'Field % row % must be answers by question',p_field_key,v_index+1 using errcode='22023';
    end if;
    if exists(select 1 from jsonb_each(v_row) cell
              where jsonb_typeof(cell.value)<>'string'
                 or not exists(select 1 from jsonb_array_elements(p_config->'fields') sub where sub->>'key'=cell.key)) then
      raise exception 'Field % row % has an unknown or non-text answer',p_field_key,v_index+1 using errcode='22023';
    end if;
    v_clean:='{}'::jsonb;
    for v_sub in select value from jsonb_array_elements(p_config->'fields') loop
      v_key:=v_sub->>'key';
      v_cell:=btrim(coalesce(v_row->>v_key,''));
      if v_cell='' then
        if coalesce(v_sub->'required','false'::jsonb)='true'::jsonb then
          raise exception 'Field % row %: % is required',p_field_key,v_index+1,coalesce(v_sub->>'label',v_key) using errcode='23514';
        end if;
        continue;
      end if;
      if length(v_cell)>500 then
        raise exception 'Field % row %: % is too long',p_field_key,v_index+1,coalesce(v_sub->>'label',v_key) using errcode='22023';
      end if;
      if v_sub->>'type'='phone' and (v_cell !~ '^[0-9+() .-]+$' or length(regexp_replace(v_cell,'\D','','g')) not between 7 and 15) then
        raise exception 'Field % row %: % is not a valid phone number',p_field_key,v_index+1,coalesce(v_sub->>'label',v_key) using errcode='22023';
      end if;
      if v_sub->>'type'='select' and jsonb_typeof(v_sub->'options')='array' and jsonb_array_length(v_sub->'options')>0
         and not exists(select 1 from jsonb_array_elements(v_sub->'options') option
                        where case when jsonb_typeof(option)='object' then option->>'value' else option#>>'{}' end=v_cell) then
        raise exception 'Field % row %: % contains an invalid option',p_field_key,v_index+1,coalesce(v_sub->>'label',v_key) using errcode='22023';
      end if;
      v_clean:=v_clean||jsonb_build_object(v_key,v_cell);
    end loop;
    v_rows:=v_rows||jsonb_build_array(v_clean);
  end loop;
  return jsonb_build_object('kind','repeat','count',v_count::text,'rows',v_rows);
end $$;
revoke all on function public.form_repeat_answer(jsonb,jsonb,text) from public,anon,authenticated,service_role;

-- 1b. The answer validator accepts both question types --------------------------------------
create or replace function pg_temp.patch_once(p_signature text,p_old text,p_new text)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body:=replace(pg_get_functiondef(p_signature::regprocedure),E'\r','');
  found:=(length(body)-length(replace(body,p_old,'')))/length(p_old);
  if found<>1 then raise exception '% patch marker found % times: %',p_signature,found,left(p_old,80); end if;
  execute replace(body,p_old,p_new);
end $$;

select pg_temp.patch_once('public.fms_validate_candidate_form(uuid,jsonb,text,uuid)',
  $old$  v_section_key text;
$old$,
  $new$  v_section_key text;
  v_photo jsonb; v_photos jsonb; v_photo_limit integer;
$new$);

select pg_temp.patch_once('public.fms_validate_candidate_form(uuid,jsonb,text,uuid)',
  $old$v_empty := v_value is null or v_value='null'::jsonb or v_value='""'::jsonb or v_value='[]'::jsonb;$old$,
  $new$v_empty := v_value is null or v_value='null'::jsonb or v_value='""'::jsonb or v_value='[]'::jsonb
      or (v_field.field_type='repeat' and jsonb_typeof(v_value)='object' and coalesce(btrim(v_value->>'count'),'')='')
      or (v_field.field_type='crm_photo' and jsonb_typeof(v_value)='object' and jsonb_typeof(v_value->'files')='array' and jsonb_array_length(v_value->'files')=0);$new$);

select pg_temp.patch_once('public.fms_validate_candidate_form(uuid,jsonb,text,uuid)',
  $old$    else
      raise exception 'Deferred field type % cannot be submitted'$old$,
  $new$    elsif v_field.field_type='repeat' then
      v_value := public.form_repeat_answer(v_field.validation->'repeat',v_value,v_field.field_key);
    elsif v_field.field_type='crm_photo' then
      v_photo_limit := case when jsonb_typeof(v_field.validation#>'{crm,maxFiles}')='number'
        then least(greatest(floor((v_field.validation#>>'{crm,maxFiles}')::numeric)::integer,1),10) else 1 end;
      if jsonb_typeof(v_value)<>'object' or v_value->>'kind' is distinct from 'crm_files'
         or jsonb_typeof(v_value->'files') is distinct from 'array' or jsonb_array_length(v_value->'files')>v_photo_limit then
        raise exception 'Field % must list at most % uploaded files',v_field.field_key,v_photo_limit using errcode='22023';
      end if;
      v_photos := '[]'::jsonb;
      for v_photo in select value from jsonb_array_elements(v_value->'files') loop
        v_text := case when jsonb_typeof(v_photo)='object' then v_photo->>'path' end;
        if v_text is null or v_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'Field % references an invalid or already used upload',v_field.field_key using errcode='23503';
        end if;
        select * into v_upload from form_submission_files where id=v_text::uuid;
        if v_upload.id is null or v_upload.tenant_id<>v_actor.tenant_id or v_upload.form_template_id<>v_template.id
           or v_upload.field_key<>v_field.field_key or v_upload.uploaded_by<>v_actor.id
           or v_upload.form_submission_id is not null or v_upload.removed_at is not null
           or v_upload.id=any(v_file_ids) then
          raise exception 'Field % references an invalid or already used upload',v_field.field_key using errcode='23503';
        end if;
        v_file_ids := array_append(v_file_ids,v_upload.id);
        v_photos := v_photos || jsonb_build_array(jsonb_build_object('path',v_upload.id::text,'clientId','','fileName',v_upload.original_filename,'mimeType',v_upload.mime_type));
      end loop;
      v_value := jsonb_build_object('kind','crm_files','files',v_photos);
    else
      raise exception 'Deferred field type % cannot be submitted'$new$);

-- 1c. CRM photo questions upload through the private form-uploads bucket --------------------
alter table form_submission_files drop constraint form_submission_files_mime;
alter table form_submission_files add constraint form_submission_files_mime check(mime_type in (
  'image/jpeg','image/png','image/webp','application/pdf','image/heic','image/heif','video/mp4','video/webm','video/quicktime'));
alter table form_submission_files drop constraint form_submission_files_extension;
alter table form_submission_files add constraint form_submission_files_extension check(
  lower(original_filename) ~ '\.(jpg|jpeg|png|webp|pdf|heic|heif|mp4|webm|mov)$');
update storage.buckets
   set allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf','image/heic','image/heif','video/mp4','video/webm','video/quicktime']
 where id='form-uploads';

create or replace function public.can_write_form_upload_object(p_name text)
returns boolean language sql stable security definer set search_path=public,storage as $$
  select current_profile_is_active() and split_part(p_name,'/',1)=current_tenant_id()::text
    and split_part(p_name,'/',2) ~ '^[0-9a-f-]{36}$'
    and can_access_form_template(split_part(p_name,'/',2)::uuid)
    and exists(select 1 from form_fields where form_template_id=split_part(p_name,'/',2)::uuid and field_type in ('file','crm_photo'));
$$;

create or replace function public.register_form_upload(p_form_template_id uuid,p_field_key text,p_storage_path text,p_original_filename text,p_mime_type text,p_size_bytes bigint)
returns uuid language plpgsql security definer set search_path=public,storage as $$
declare v_actor user_profiles; v_field form_fields; v_id uuid; v_expected_prefix text; v_name text:=lower(coalesce(p_original_filename,''));
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'An active profile is required to upload a file' using errcode='42501'; end if;
  if not can_access_form_template(p_form_template_id) then raise exception 'The form is outside the caller Forms Library scope' using errcode='42501'; end if;
  select * into v_field from form_fields where form_template_id=p_form_template_id and field_key=p_field_key;
  if v_field.id is null or v_field.field_type not in ('file','crm_photo') then raise exception 'Unknown file field' using errcode='22023'; end if;
  v_expected_prefix := v_actor.tenant_id::text||'/'||p_form_template_id::text||'/';
  if p_storage_path not like v_expected_prefix||'%' or p_storage_path like '%..%'
     or p_size_bytes not between 1 and 10485760
     or (v_field.field_type='file' and (p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf')
         or v_name !~ '\.(jpg|jpeg|png|webp|pdf)$'))
     or (v_field.field_type='crm_photo' and not (
         (p_mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif') and v_name ~ '\.(jpg|jpeg|png|webp|heic|heif)$')
         or (coalesce(v_field.validation#>'{crm,video}','false'::jsonb)='true'::jsonb
             and p_mime_type in ('video/mp4','video/webm','video/quicktime') and v_name ~ '\.(mp4|webm|mov)$'))) then
    raise exception 'Upload metadata is invalid' using errcode='22023';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='form-uploads' and name=p_storage_path and owner_id=auth.uid()::text) then
    raise exception 'Uploaded object is not owned by the caller' using errcode='42501';
  end if;
  insert into form_submission_files(tenant_id,form_template_id,field_key,storage_path,original_filename,mime_type,size_bytes,uploaded_by)
  values(v_actor.tenant_id,p_form_template_id,p_field_key,p_storage_path,btrim(p_original_filename),p_mime_type,p_size_bytes,v_actor.id)
  returning id into v_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_file_uploaded','forms',v_id,jsonb_build_object('form_template_id',p_form_template_id,'field_key',p_field_key,'mime_type',p_mime_type,'size_bytes',p_size_bytes));
  return v_id;
end $$;

-- 1d. Customer Integration (Forms -> CRM client) cannot copy a repeating group or photo list
-- into a client detail: like file uploads they stay operational (the answer is an object).
select pg_temp.patch_once('crm_sync.save_customer_mapping(uuid,jsonb,uuid)',
  $old$f.field_type in ('user_dropdown','branch_dropdown','department_dropdown','section_header','divider','file'))$old$,
  $new$f.field_type in ('user_dropdown','branch_dropdown','department_dropdown','section_header','divider','file','repeat','crm_photo'))$new$);

-- 2a. Where a form family is listed ---------------------------------------------------------
create table form_family_placements (
  tenant_id uuid not null references tenants(id) on delete cascade,
  family_id uuid not null,
  placement text not null check (placement in ('fms','library')),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,family_id)
);
alter table form_family_placements enable row level security;
-- Read and written only through list_fms_built_forms / set_form_family_placement.
create policy form_family_placements_section on form_family_placements as restrictive for select to authenticated
  using (module_accessible('forms_library'));
revoke all privileges on table form_family_placements from public,anon,authenticated,service_role;

create or replace function public.set_form_family_placement(p_template_id uuid,p_placement text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); t form_templates; previous text;
begin
  perform assert_module_enabled('forms_library');
  if a.id is null or not current_profile_is_active() then
    raise exception 'An active profile is required' using errcode='42501';
  end if;
  if not has_permission('forms.manage') then
    raise exception 'Only form authors can move forms' using errcode='42501';
  end if;
  if p_placement is null or p_placement not in ('fms','library') then
    raise exception 'Choose FMS workflow forms or Forms Library' using errcode='22023';
  end if;
  select * into t from form_templates where id=p_template_id and tenant_id=a.tenant_id;
  if t.id is null or not can_access_form_template(t.id) then
    raise exception 'Form not found' using errcode='42501';
  end if;
  select placement into previous from form_family_placements where tenant_id=a.tenant_id and family_id=t.family_id for update;
  if previous is not distinct from p_placement then
    return jsonb_build_object('familyId',t.family_id,'placement',p_placement,'changed',false);
  end if;
  insert into form_family_placements(tenant_id,family_id,placement,updated_by,updated_at)
  values (a.tenant_id,t.family_id,p_placement,a.id,clock_timestamp())
  on conflict (tenant_id,family_id) do update set placement=excluded.placement,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values (a.tenant_id,a.id,'form_family_placement_changed','forms',t.id,
    jsonb_build_object('family_id',t.family_id,'placement',previous),
    jsonb_build_object('family_id',t.family_id,'placement',p_placement));
  return jsonb_build_object('familyId',t.family_id,'placement',p_placement,'changed',true);
end $$;
revoke all on function public.set_form_family_placement(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_form_family_placement(uuid,text) to authenticated;

-- 2b. FMS workflow forms: stage-built families plus families marked FMS, minus families
-- marked Library. Output keys are unchanged from 0364; authors also get "placement" for a
-- marked family and "unlinked" when no step uses it now.
create or replace function list_fms_built_forms()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); authors boolean; result jsonb;
begin
  perform assert_module_enabled('forms_library');
  if a.id is null or not current_profile_is_active() then
    raise exception 'An active profile is required' using errcode='42501';
  end if;
  authors:=has_permission('forms.manage');
  with placed as (
    select p.family_id,p.placement from form_family_placements p where p.tenant_id=a.tenant_id
  ), linked as (
    select ft.family_id,flow.id as flow_id,flow.name as flow_name,flow.family_id as flow_family_id,flow.version as flow_version,
      flow.status as flow_status,stage.id as stage_id,stage.name as stage_name,stage.sort_order,flow.id=current_flow.id as is_current,
      coalesce(stage.planned_time_rule#>>'{questionnaire,origin}' in ('stage','copied'),false) as built_here
    from fms_stages stage
    join fms_flows flow on flow.id=stage.fms_flow_id and flow.tenant_id=a.tenant_id
    cross join lateral (
      select latest.id from fms_flows latest
      where latest.tenant_id=flow.tenant_id and latest.family_id=flow.family_id
      order by (latest.status='published') desc, latest.version desc
      limit 1
    ) current_flow
    join form_templates ft on ft.tenant_id=a.tenant_id
      and (ft.id=stage.form_template_id
        or ft.id::text=nullif(stage.planned_time_rule#>>'{questionnaire,draftFormId}',''))
  ), families as (
    select l.family_id from linked l where l.built_here
    union
    select p.family_id from placed p where p.placement='fms'
    except
    select p.family_id from placed p where p.placement='library'
  ), built as (
    select f.family_id,(p.placement='fms') is true as marked,
      coalesce(array_agg(distinct l.flow_name order by l.flow_name) filter (where l.flow_id is not null and (l.built_here or p.placement='fms')),'{}') as workflows,
      coalesce(array_agg(distinct l.stage_name order by l.stage_name) filter (where l.flow_id is not null and (l.built_here or p.placement='fms')),'{}') as steps,
      coalesce(jsonb_agg(distinct jsonb_build_object('workflowId',l.flow_id,'workflowName',l.flow_name,'stageId',l.stage_id,'stageName',l.stage_name,
        'workflowFamilyId',l.flow_family_id,'workflowVersion',l.flow_version,'workflowStatus',l.flow_status,
        'stageOrder',l.sort_order,'isCurrent',l.is_current)) filter (where l.flow_id is not null and (l.built_here or p.placement='fms')),'[]'::jsonb) as links
    from families f
    left join placed p on p.family_id=f.family_id
    left join linked l on l.family_id=f.family_id
    group by f.family_id,p.placement
  )
  select coalesce(jsonb_agg(jsonb_build_object('familyId',b.family_id)
    ||case when authors then jsonb_build_object('workflows',to_jsonb(b.workflows),'steps',to_jsonb(b.steps),'links',b.links)
        ||case when b.marked then jsonb_build_object('placement','fms') else '{}'::jsonb end
        ||case when jsonb_array_length(b.links)=0 then jsonb_build_object('unlinked',true) else '{}'::jsonb end
      else '{}'::jsonb end order by b.family_id),'[]'::jsonb)
  into result
  from built b;
  return result;
end $$;
revoke all on function list_fms_built_forms() from public,anon,authenticated,service_role;
grant execute on function list_fms_built_forms() to authenticated;

-- 2c. One-time: forms the FMS builder made (hidden from the staff library in every version and
-- used by an FMS step) are marked FMS, so they leave Forms Library now. CRM forms are skipped.
with candidates as (
  select distinct ft.tenant_id,ft.family_id
  from form_templates ft
  where not exists(select 1 from form_templates v where v.tenant_id=ft.tenant_id and v.family_id=ft.family_id and v.library_visible)
    and exists(select 1 from fms_stages s join fms_flows f on f.id=s.fms_flow_id and f.tenant_id=ft.tenant_id
               join form_templates used on used.tenant_id=ft.tenant_id and used.family_id=ft.family_id
               where s.form_template_id=used.id or s.planned_time_rule#>>'{questionnaire,draftFormId}'=used.id::text)
    and not exists(select 1 from crm_form_binding_versions b where b.tenant_id=ft.tenant_id and b.form_family_id=ft.family_id)
), inserted as (
  insert into form_family_placements(tenant_id,family_id,placement)
  select c.tenant_id,c.family_id,'fms' from candidates c
  on conflict (tenant_id,family_id) do nothing
  returning tenant_id,family_id
)
insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
select i.tenant_id,null,'form_family_placement_backfilled','forms',null,
  jsonb_build_object('placement','fms','family_ids',jsonb_agg(i.family_id order by i.family_id),'migration','0399')
from inserted i group by i.tenant_id;

notify pgrst,'reload schema';
