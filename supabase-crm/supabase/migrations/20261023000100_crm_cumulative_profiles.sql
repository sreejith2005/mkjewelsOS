-- Owner decision 2026-10-23: phone intake uses the latest visited profile;
-- stable profile answers accumulate, with the latest nonblank answer winning.
-- This changes read/submission contracts only. No historical row is rewritten.
create function crm_private.profile_answer_keys() returns text[]
language sql immutable set search_path='' as $$
 select array['gender','billing_phone','country','state','city','city_other','pincode',
 'address','community','community_other','dob','anniversary','beverage','sugar','snack',
 'communication_preference','client_potential_category','high_potential_reason','next_visit_date',
 'occupation','occupation_other','bridal_or_non_bridal','wedding_month','wedding_year',
 'beverage_other','sugar_other','snack_other'];
$$;
revoke all on function crm_private.profile_answer_keys() from public,anon,authenticated,service_role;
grant execute on function crm_private.profile_answer_keys() to authenticated,service_role;

create function crm_private.cumulative_profile_answers(p_client uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result public.clients; answer record; applied jsonb := '{}'; accumulated jsonb := '{}'; v_phone text;
begin
 if public.current_user_role() is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
 select * into result from public.clients where client_id=p_client;
 if result.client_id is null then return null; end if;
 v_phone := crm_private.stored_phone(result.primary_phone);
 for answer in
  with member_ids as (
   select p_client as client_id union
   select pi.client_id from public.client_phone_index pi where v_phone is not null and pi.phone=v_phone
  ), members as materialized (
   select c.* from member_ids m join public.clients c on c.client_id=m.client_id
  ), sources as (
   select to_jsonb(c) as values,coalesce(c.last_visit_date,c.profile_updated_at) as answered_at,
     c.profile_updated_at as recorded_at,2 as priority,c.client_id::text as id from members c
   union all
   select jsonb_strip_nulls(jsonb_build_object('communication_preference',f.communication_preference,
      'occupation',f.occupation,'occupation_other',f.occupation_other,'bridal_or_non_bridal',f.bridal_or_non_bridal,
      'wedding_month',f.wedding_month,'wedding_year',f.wedding_year,
      'beverage_other',f.additional_fields->'beverage_other','sugar_other',f.additional_fields->'sugar_other',
      'snack_other',f.additional_fields->'snack_other'))
     || coalesce(f.additional_fields->'submitted_fields','{}'::jsonb)
     || jsonb_strip_nulls(jsonb_build_object(
       'address',coalesce(f.additional_fields->'legacy_submitted_fields'->'ADDRESS',f.additional_fields->'ADDRESS'),
       'pincode',coalesce(f.additional_fields->'legacy_submitted_fields'->'PINCODE',f.additional_fields->'PINCODE'),
       'gender',coalesce(f.additional_fields->'legacy_submitted_fields'->'GENDER',f.additional_fields->'GENDER'),
       'dob',coalesce(f.additional_fields->'legacy_submitted_fields'->'DOB',f.additional_fields->'DOB'),
       'anniversary',coalesce(f.additional_fields->'legacy_submitted_fields'->'ANNIVERSARY',f.additional_fields->'ANNIVERSARY'),
       'country',coalesce(f.additional_fields->'legacy_submitted_fields'->'COUNTRY',f.additional_fields->'COUNTRY'),
       'state',coalesce(f.additional_fields->'legacy_submitted_fields'->'STATE',f.additional_fields->'STATE'),
       'city',coalesce(f.additional_fields->'legacy_submitted_fields'->'CITY',f.additional_fields->'CITY'),
       'community',coalesce(f.additional_fields->'legacy_submitted_fields'->'COMMUNITY / CASTE',f.additional_fields->'COMMUNITY / CASTE'),
       'occupation',coalesce(f.additional_fields->'legacy_submitted_fields'->'OCCUPATION',f.additional_fields->'OCCUPATION'),
       'bridal_or_non_bridal',coalesce(f.additional_fields->'legacy_submitted_fields'->'BRIDAL / NON BRIDAL',f.additional_fields->'BRIDAL / NON BRIDAL'))),
     t.event_date,t.created_at,1,t.id::text
   from members c join public.client_timeline t on t.client_id=c.client_id
   join public.visit_forms f on f.client_timeline_id=t.id
   union all
   select jsonb_build_object(l.field_name,l.new_value),l.created_at,l.created_at,3,lpad(l.id::text,20,'0')
   from members c join public.client_edit_log l on l.client_id=c.client_id
   where l.field_name=any(crm_private.profile_answer_keys())
   union all
   -- A blanking edit is not a new answer. Date its old value from the last
   -- actual matching answer (or its visit), never from when it was cleared.
   select jsonb_build_object(l.field_name,l.old_value),coalesce((
     select max(previous.created_at) from public.client_edit_log previous
     where previous.client_id=l.client_id and previous.field_name=l.field_name
       and previous.id<l.id and previous.new_value=l.old_value
   ),c.last_visit_date,'-infinity'::timestamptz),l.created_at,0,lpad(l.id::text,20,'0')
   from members c join public.client_edit_log l on l.client_id=c.client_id
   where l.field_name=any(crm_private.profile_answer_keys()) and nullif(btrim(l.new_value#>>'{}'),'') is null
  ) select v.key,v.value from sources s cross join lateral jsonb_each(s.values) v
    where v.key=any(crm_private.profile_answer_keys())
      and jsonb_typeof(v.value) in ('string','number')
      and nullif(btrim(v.value#>>'{}'),'') is not null
      and upper(btrim(v.value#>>'{}')) not in ('NA','N/A','NULL','UNDEFINED','-')
    order by s.answered_at desc nulls last,s.recorded_at desc,s.priority desc,s.id desc,v.key
 loop
  if applied ? answer.key then continue; end if;
  begin
   -- Invalid legacy dates/oversized answers remain evidence, never break reads.
   if answer.key in ('dob','anniversary','next_visit_date') and (answer.value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
   if answer.key='client_potential_category' and (answer.value#>>'{}') not in ('A','B','C','D','E') then continue; end if;
   result := jsonb_populate_record(result,jsonb_build_object(answer.key,answer.value));
   if answer.key='wedding_month' and (answer.value#>>'{}') !~ '^(0?[1-9]|1[0-2])$' then continue; end if;
   if answer.key='wedding_year' and ((answer.value#>>'{}') !~ '^\d{4}$' or (answer.value#>>'{}')::integer not between 2000 and 2200) then continue; end if;
   if answer.key in ('wedding_month','wedding_year') then perform jsonb_populate_record(null::public.visit_forms,jsonb_build_object(answer.key,answer.value)); end if;
   accumulated := accumulated || jsonb_build_object(answer.key,answer.value);
   applied := applied || jsonb_build_object(answer.key,true);
  exception when data_exception then continue;
  end;
 end loop;
 return to_jsonb(result) || accumulated;
end $$;
revoke all on function crm_private.cumulative_profile_answers(uuid) from public,anon,authenticated,service_role;
grant execute on function crm_private.cumulative_profile_answers(uuid) to authenticated,service_role;

create function crm_private.cumulative_client_profile(p_client uuid) returns public.clients
language sql stable security invoker set search_path='' as $$
 select jsonb_populate_record(null::public.clients,crm_private.cumulative_profile_answers(p_client));
$$;
revoke all on function crm_private.cumulative_client_profile(uuid) from public,anon,authenticated,service_role;
grant execute on function crm_private.cumulative_client_profile(uuid) to authenticated,service_role;

create function public.get_walkin_profile_defaults(p_client_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(a.key,a.value),'{}'::jsonb)
 from jsonb_each(crm_private.cumulative_profile_answers(p_client_id)) a
 where a.key=any(array['occupation','occupation_other','bridal_or_non_bridal',
 'wedding_month','wedding_year','beverage_other','sugar_other','snack_other']);
$$;
revoke all on function public.get_walkin_profile_defaults(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_walkin_profile_defaults(uuid) to authenticated;

create function public.get_client_profile(p_client_id uuid) returns setof public.clients
language plpgsql stable security invoker set search_path='' as $$
declare profile public.clients;
begin
 if public.current_user_role() is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
 profile := crm_private.cumulative_client_profile(p_client_id);
 if profile.client_id is not null then return next profile; end if;
end $$;
revoke all on function public.get_client_profile(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_client_profile(uuid) to authenticated;

create or replace function public.lookup_client_profile_by_phone(p_phone text) returns setof public.clients
language sql stable security invoker set search_path='' as $$
 select p.* from public.lookup_client_by_phone(p_phone) m
 cross join lateral public.get_client_profile(m.client_id) p;
$$;

create function crm_private.preserve_walkin_profile_answers(p_payload jsonb,p_client uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare profile jsonb; k text;
begin
 if p_client is null then return p_payload; end if;
 profile := crm_private.cumulative_profile_answers(p_client);
 foreach k in array crm_private.profile_answer_keys() loop
  if nullif(btrim(p_payload->>k),'') is null and nullif(btrim(profile->>k),'') is not null then
   p_payload := p_payload || jsonb_build_object(k,profile->k);
  end if;
 end loop;
 -- Existing (and cached older) clients may send a stored billing value back
 -- unchanged. A stored ten-digit international phone is not national input.
 if nullif(profile->>'billing_phone','') is not null and p_payload->>'billing_phone'=profile->>'billing_phone' then
  p_payload := p_payload || jsonb_build_object('billing_phone',crm_private.as_phone_input(profile->>'billing_phone'));
 end if;
 return p_payload;
end $$;
revoke all on function crm_private.preserve_walkin_profile_answers(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function crm_private.preserve_walkin_profile_answers(jsonb,uuid) to authenticated,service_role;

-- Extend the existing audited transactions in place; preserve their signatures,
-- authorization, exact-ID actions, snapshots, proof checks and audit attribution.
do $$
declare body text; needle text;
begin
 body:=replace(pg_get_functiondef('public.create_entry_queue(text,text,uuid,text,uuid)'::regprocedure),E'\r','');
 needle:='found_client := crm_private.match_client(crm_private.as_phone_input(phone_digits), canonical_name);';
 if strpos(body,needle)=0 then raise exception 'Unrecognized queue matching contract'; end if;
 body:=replace(body,needle,'SELECT m.client_id INTO found_client FROM public.lookup_client_by_phone(crm_private.as_phone_input(phone_digits)) m;');
 execute body;
 body:=replace(pg_get_functiondef('public.submit_walkin_visit(jsonb)'::regprocedure),E'\r','');
 needle:='IF target_client IS NULL THEN target_client := crm_private.match_client(crm_private.as_phone_input(phone_digits), p_payload->>''primary_name''); END IF;';
 if strpos(body,needle)=0 then raise exception 'Unrecognized direct walk-in matching contract'; end if;
 body:=replace(body,needle,'IF target_client IS NULL THEN SELECT m.client_id INTO target_client FROM public.lookup_client_by_phone(crm_private.as_phone_input(phone_digits)) m; END IF;');
 needle:='  new_client := target_client IS NULL;';
 if strpos(body,needle)=0 or strpos(body,'crm_private.prepare_walkin_payload')=0 then raise exception 'Unrecognized walk-in snapshot contract'; end if;
 body:=replace(body,needle,E'  p_payload := crm_private.preserve_walkin_profile_answers(p_payload,target_client);\n'||needle);
 execute body;
end $$;
notify pgrst,'reload schema';
