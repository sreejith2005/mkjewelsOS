-- Attendance is active synced branch staff, independently of queue CRM allocations.
create function public.get_walkin_salespeople()
returns table(branch_id uuid,salesperson_id uuid,salesperson_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_user_role() is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
 return query select b.id,u.id,u.name::text from public.users u join public.branches b
 on b.active and (u.branch_id=b.id or u.role='super_admin')
 where u.active and exists(select 1 from public.crm_sso_access_grants g where g.legacy_crm_user_id=u.id and g.active)
 order by b.id,u.name,u.id;
end $$;
revoke all on function public.get_walkin_salespeople() from public,anon;
grant execute on function public.get_walkin_salespeople() to authenticated,service_role;

do $$ declare body text; old_query text; begin
 body:=replace(pg_get_functiondef('crm_private.prepare_walkin_payload(jsonb,uuid)'::regprocedure),E'\r','');
 old_query:=$query$select array_agg(distinct u.id) into selected_ids from public.users u
    join public.crm_allocation a on a.crm_user_id = u.id and a.branch_id = p_branch and a.active
    where u.active and public.normalize_crm_roster_value(u.name) = public.normalize_crm_roster_value(selected_name)
      and (u.branch_id = p_branch or u.role = 'super_admin');$query$;
 old_query:=replace(old_query,E'\r','');
 if strpos(body,old_query)=0 then raise exception 'Unrecognized walk-in staff resolver'; end if;
 body:=replace(body,old_query,$query$select array_agg(distinct s.salesperson_id) into selected_ids from public.get_walkin_salespeople() s
 where s.branch_id=p_branch
 and (nullif(p_payload->>'salesperson_id','') is null or s.salesperson_id=nullif(p_payload->>'salesperson_id','')::uuid)
 and (selected_name is null or public.normalize_crm_roster_value(s.salesperson_name)=public.normalize_crm_roster_value(selected_name));$query$);
 body:=replace(body,'if selected_name is not null then','if selected_name is not null or nullif(p_payload->>''salesperson_id'','''') is not null then');
 execute body;
end $$;

create function crm_private.saved_walkin_status(p_status public.buy_status,p_fields jsonb)
returns public.buy_status language plpgsql stable set search_path='' as $$
declare source jsonb:=case when jsonb_typeof(p_fields->'legacy_submitted_fields')='object' then p_fields->'legacy_submitted_fields' else p_fields end; token text;
begin
 if p_fields ? 'submitted_fields' then return p_status; end if;
 token:=nullif(coalesce(nullif(source->>'FINAL STATUS',''),nullif(source->>'CLIENT BOUGHT ANY PRODUCT?',''),nullif(p_fields->>'visit_status','')),'');
 token:=trim(both '_' from regexp_replace(upper(token),'[^A-Z0-9]+','_','g'));
 if token='YES' and coalesce(source->>'OTHER ORDER',p_fields->>'other_order')='YES' then token:='YES_AND_ORDER_PLACED';
 elsif token in ('REPAIR_PLACED','REPAIR_PICKUP','ORDER_PLACED','ORDER_PICKUP') and source->>'NEW THINGS CHOICE' in ('BUYING_NEW_PRODUCT','MAKING_NEW_ORDER') then token:=token||'_AND_'||(source->>'NEW THINGS CHOICE'); end if;
 if token=any(enum_range(null::public.buy_status)::text[]) then return token::public.buy_status; end if;
 return p_status;
end $$;
revoke all on function crm_private.saved_walkin_status(public.buy_status,jsonb) from public,anon;
grant execute on function crm_private.saved_walkin_status(public.buy_status,jsonb) to authenticated,service_role;

-- Keep original repair/order outcome; count explicitly recorded bought products
-- separately. Explicit non-purchase answers and native hidden fields never imply a sale.
create function crm_private.walkin_purchase_evidence(p_status public.buy_status,p_bought text[],p_did_buy boolean,p_fields jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare status text:=crm_private.saved_walkin_status(p_status,p_fields)::text;
begin
 if status in ('YES','YES_AND_ORDER_PLACED') or status like '%_AND_BUYING_NEW_PRODUCT' then return true; end if;
 if status in ('NO','PRODUCT_RETURN','PRODUCT_EXCHANGE','STORE_VISIT','PRICE_CALCULATION') then return false; end if;
 if p_did_buy is not null then return p_did_buy; end if;
 return not coalesce(p_fields ? 'submitted_fields',false) and exists(select 1 from unnest(p_bought) value where upper(btrim(value)) not in ('','NA','N/A','NONE','NULL','NIL','NOT APPLICABLE','-'));
end $$;
revoke all on function crm_private.walkin_purchase_evidence(public.buy_status,text[],boolean,jsonb) from public,anon;
grant execute on function crm_private.walkin_purchase_evidence(public.buy_status,text[],boolean,jsonb) to authenticated,service_role;

do $$ declare body text; start_pos integer; end_pos integer; old_filter text; begin
 body:=replace(pg_get_functiondef('public.recalculate_client_rollups()'::regprocedure),E'\r','');
 start_pos:=strpos(body,'count(*) FILTER ('); end_pos:=strpos(body,')::integer AS total_purchase_visits');
 if start_pos=0 or end_pos<start_pos then raise exception 'Unrecognized purchase rollup'; end if;
 old_filter:=substring(body from start_pos for end_pos-start_pos+length(')::integer AS total_purchase_visits'));
 body:=replace(body,old_filter,$filter$count(*) FILTER (WHERE crm_private.walkin_purchase_evidence(t.buy_status,t.bought_categories,
 (select f.did_buy from public.visit_forms f where f.client_timeline_id=t.id),
 (select f.additional_fields from public.visit_forms f where f.client_timeline_id=t.id)))::integer AS total_purchase_visits$filter$);
 execute body;
end $$;

create function crm_private.refresh_walkin_rollups_from_form() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.client_timeline set buy_status=buy_status where id=NEW.client_timeline_id;
 return NEW;
end $$;
revoke all on function crm_private.refresh_walkin_rollups_from_form() from public,anon,authenticated,service_role;
create trigger visit_forms_refresh_rollups after insert or update of did_buy,additional_fields on public.visit_forms
for each row execute function crm_private.refresh_walkin_rollups_from_form();

-- A saved NA/NO answer is retained, but is not a gift received.
do $$ declare body text; previous text; replacement text; begin
 body:=replace(pg_get_functiondef('crm_private.project_walkin_actions()'::regprocedure),E'\r','');
 previous:=$old$nullif(coalesce(NEW.additional_fields->>'gift',NEW.additional_fields->>'gift_given'),'') is null$old$;
 replacement:=$new$upper(btrim(coalesce(NEW.additional_fields->>'gift',NEW.additional_fields->>'gift_given',''))) in ('','NA','N/A','NONE','NO','NULL','NIL','NOT APPLICABLE','-')$new$;
 if strpos(body,previous)=0 then raise exception 'Unrecognized gift projection'; end if;
 execute replace(body,previous,replacement);
end $$;

-- Historical imports duplicated category labels with differing case. Reconcile
-- only identical category sets; different grouped labels remain untouched.
create function crm_private.saved_walkin_categories(p_current text[],p_raw text)
returns text[] language plpgsql immutable set search_path='' as $$
declare proposed text[]; old_tokens text[]; raw_tokens text[];
begin
 if p_raw is null or upper(btrim(p_raw)) in ('','NA','N/A','NONE','NULL','NIL','NOT APPLICABLE','-') then return p_current; end if;
 proposed:=public.dedupe_category_array(regexp_split_to_array(btrim(p_raw),'\s*,\s*'));
 if coalesce(cardinality(p_current),0)=0 then return proposed; end if;
 select array_agg(distinct value order by value) into old_tokens from unnest(p_current) item cross join lateral (select upper(btrim(item)) as value) normalized where value<>'';
 select array_agg(distinct value order by value) into raw_tokens from unnest(proposed) item cross join lateral (select upper(btrim(item)) as value) normalized where value<>'';
 if old_tokens=raw_tokens then return proposed; end if;
 return p_current;
end $$;
revoke all on function crm_private.saved_walkin_categories(text[],text) from public,anon,authenticated;
grant execute on function crm_private.saved_walkin_categories(text[],text) to service_role;

-- No original rows are rewritten by the migration. Recovery is explicit,
-- service-only and audited, with a read-only count preview.
create function public.crm_reconcile_saved_walkins(p_apply boolean default false,p_client_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; source jsonb; next_status public.buy_status; extra jsonb; answers jsonb; details jsonb;
 seen text[]; bought text[]; ordered text[]; key text; header text; text_value text;
 changed integer:=0; visited integer:=0; field_count integer:=0; purchase_count integer:=0;
 next_month smallint; before_row jsonb; after_row jsonb; before_timeline jsonb; client_before jsonb; client_snapshots jsonb; affected uuid[]:=array[]::uuid[];
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 if p_apply then perform c.client_id from public.clients c where (p_client_id is null or c.client_id=p_client_id) and exists(select 1 from public.client_timeline t join public.visit_forms f on f.client_timeline_id=t.id where t.client_id=c.client_id) order by c.client_id for update;
 select jsonb_object_agg(c.client_id,to_jsonb(c)) into client_snapshots from public.clients c where p_client_id is null or c.client_id=p_client_id; end if;
 for r in select t.id as timeline_id,t.client_id,t.buy_status,t.seen_categories,t.bought_categories,t.order_categories,
 f.id as form_id,f.additional_fields,f.category_details,f.did_buy,f.wedding_month from public.client_timeline t
 join public.visit_forms f on f.client_timeline_id=t.id where p_client_id is null or t.client_id=p_client_id order by t.id
 loop
 visited:=visited+1; source:=case when jsonb_typeof(r.additional_fields->'legacy_submitted_fields')='object' then r.additional_fields->'legacy_submitted_fields' else r.additional_fields end;
 field_count:=field_count+(select count(*) from jsonb_object_keys(source));
 extra:=r.additional_fields; answers:=coalesce(extra->'engagement_answers','{}'::jsonb); details:=r.category_details;
 next_status:=crm_private.saved_walkin_status(r.buy_status,extra);
 next_month:=r.wedding_month;
 if next_month is null then
 text_value:=upper(btrim(source->>'MONTH OF WEDDING'));
 if text_value ~ '^([1-9]|1[0-2])$' then next_month:=text_value::smallint;
 else next_month:=array_position(array['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'],text_value)::smallint; end if;
 end if;
 for key,header in select * from (values ('instagram','INSTAGRAM FOLLOW ASKED'),('google_review','GOOGLE REVIEW ASKED'),
 ('testimonial','TESTIMONIAL ASKED'),('feedback_form','FEEDBACK FORM ASKED'),('thank_you_note','THANK-YOU NOTE GIVEN'),('referrals','REFERRALS ASKED')) as map(k,h)
 loop
 text_value:=nullif(btrim(source->>header),'');
 if nullif(answers->>key,'') is null and text_value is not null then answers:=answers||jsonb_build_object(key,text_value); end if;
 end loop;
 if answers<>'{}'::jsonb then extra:=extra||jsonb_build_object('engagement_answers',answers); end if;
 if nullif(extra->>'gift','') is null and nullif(extra->>'gift_given','') is null and upper(btrim(coalesce(source->>'GIFT GIVEN',''))) not in ('','NA','N/A','NONE','NO','NULL','NIL','NOT APPLICABLE','-') then
 extra:=extra||jsonb_build_object('gift_given',btrim(source->>'GIFT GIVEN'),'gift_other',source->>'GIFT (OTHER)');
 end if;
 for key,header in select * from (values ('seen_count','SEEN PRODUCTS COUNT'),('bought_count','BOUGHT PRODUCTS COUNT'),
 ('order_count','ORDER/NEW THINGS COUNT'),('seen_tags','SEEN TAGS (COMBINED)'),('bought_tags','BOUGHT TAGS (COMBINED)'),('order_tags','ORDER/NEW THINGS TAGS (COMBINED)')) as map(k,h)
 loop
 text_value:=nullif(btrim(source->>header),'');
 if (not (details ? key) or details->key in ('null'::jsonb,'""'::jsonb,'[]'::jsonb)) and text_value is not null then
 details:=details||jsonb_build_object(key,case when key like '%_tags' then to_jsonb(regexp_split_to_array(text_value,'\s*,\s*')) else to_jsonb(text_value) end);
 end if;
 end loop;
 seen:=r.seen_categories; bought:=r.bought_categories; ordered:=r.order_categories;
 if not (extra ? 'submitted_fields') then
 seen:=crm_private.saved_walkin_categories(seen,source->>'SEEN CATEGORIES');
 bought:=crm_private.saved_walkin_categories(bought,source->>'BOUGHT CATEGORIES');
 ordered:=crm_private.saved_walkin_categories(ordered,source->>'ORDER/NEW THINGS CATEGORIES');
 end if;
 if crm_private.walkin_purchase_evidence(next_status,bought,r.did_buy,extra) then purchase_count:=purchase_count+1; end if;
 if (r.buy_status,r.seen_categories,r.bought_categories,r.order_categories,r.additional_fields,r.category_details,r.wedding_month)
 is distinct from (next_status,seen,bought,ordered,extra,details,next_month) then
 changed:=changed+1;
 if p_apply then
 select to_jsonb(t) into before_timeline from public.client_timeline t where t.id=r.timeline_id for update;
 select to_jsonb(f) into before_row from public.visit_forms f where f.id=r.form_id for update;
 if (before_row->'additional_fields',before_row->'category_details',before_row->'did_buy',before_row->'wedding_month',before_timeline->'buy_status',before_timeline->'seen_categories',before_timeline->'bought_categories',before_timeline->'order_categories')
 is distinct from (r.additional_fields,r.category_details,coalesce(to_jsonb(r.did_buy),'null'::jsonb),coalesce(to_jsonb(r.wedding_month),'null'::jsonb),coalesce(to_jsonb(r.buy_status),'null'::jsonb),coalesce(to_jsonb(r.seen_categories),'null'::jsonb),coalesce(to_jsonb(r.bought_categories),'null'::jsonb),coalesce(to_jsonb(r.order_categories),'null'::jsonb)) then raise exception 'Saved walk-in changed during recovery; retry preview' using errcode='40001'; end if;
 update public.client_timeline set buy_status=next_status,seen_categories=seen,bought_categories=bought,order_categories=ordered where id=r.timeline_id;
 update public.visit_forms set additional_fields=extra,category_details=details,wedding_month=next_month where id=r.form_id;
 select to_jsonb(f) into after_row from public.visit_forms f where f.id=r.form_id;
 perform crm_private.write_audit_log('crm.reconcile_saved_walkin',r.timeline_id,jsonb_build_object('before_form',before_row,'after_form',after_row,'before_timeline',before_timeline,'after_timeline',(select to_jsonb(t) from public.client_timeline t where t.id=r.timeline_id)));
 end if;
 end if;
 affected:=array_append(affected,r.client_id);
 end loop;
 if p_apply then
 for r in select distinct unnest(affected) as client_id loop
 client_before:=client_snapshots->r.client_id::text;
 update public.visit_forms f set additional_fields=f.additional_fields from public.client_timeline t where f.client_timeline_id=t.id and t.client_id=r.client_id and (f.additional_fields ? 'gift' or f.additional_fields ? 'gift_given');
 update public.client_timeline set buy_status=buy_status where id=(select t.id from public.client_timeline t where t.client_id=r.client_id order by t.event_date desc,t.created_at desc,t.id desc limit 1);
 perform crm_private.refresh_walkin_actions(r.client_id);
 perform crm_private.write_audit_log('crm.reconcile_client_projection',r.client_id,jsonb_build_object('before',client_before,'after',(select to_jsonb(c) from public.clients c where c.client_id=r.client_id)));
 end loop;
 end if;
 return jsonb_build_object('applied',p_apply,'visits_checked',visited,'source_fields_checked',field_count,'visits_with_mapping_changes',changed,'purchase_visits_from_saved_evidence',purchase_count,'client_count',cardinality(array(select distinct unnest(affected))));
end $$;
revoke all on function public.crm_reconcile_saved_walkins(boolean,uuid) from public,anon,authenticated;
grant execute on function public.crm_reconcile_saved_walkins(boolean,uuid) to service_role;
notify pgrst,'reload schema';
