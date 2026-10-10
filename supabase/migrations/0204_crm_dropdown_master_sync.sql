-- Configurable CRM values belong to JewelOS Dropdown Master. Reuse the audited
-- staff outbox/lease/retry transport, with separate event kinds and tenant snapshots.
alter table crm_sync.outbox drop constraint outbox_event_type_check;
alter table crm_sync.outbox add constraint outbox_event_type_check
 check(event_type in ('staff.access_changed','master.options_changed'));
create function crm_sync.enqueue_master(p_tenant uuid) returns void
language sql security definer set search_path='' as $$
 insert into crm_sync.outbox(event_type,aggregate_id) values('master.options_changed',p_tenant)
 on conflict(event_type,aggregate_id) where delivered_at is null and dead_at is null
 do update set changed_at=clock_timestamp(),next_attempt_at=least(crm_sync.outbox.next_attempt_at,now());
$$;
create function crm_sync.master_snapshot(p_tenant uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('tenant_id',p_tenant,'snapshot_at',clock_timestamp(),
  'members',coalesce((select jsonb_agg(p.id order by p.id) from public.user_profiles p where p.tenant_id=p_tenant),'[]'::jsonb),
  'options',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'master_type',m.master_type,'label',m.label,'value',m.value,
    'sort_order',m.sort_order,'active',m.is_active and coalesce(c.is_active,true)) order by m.master_type,m.sort_order,m.id)
   from public.dropdown_masters m left join public.dropdown_master_categories c on c.tenant_id=m.tenant_id and c.category_key=m.master_type
   where m.tenant_id=p_tenant and (m.master_type in ('beverage','sugar_option','snack_option','gift_option','caste','client_relation',
    'crm_source','product_category','not_bought_reason','potential_category','communication_preference','gender','occupation','bridal_or_non_bridal','wedding_month')
    or m.master_type like 'lead\_%' escape '\')),'[]'::jsonb));
$$;
create function crm_sync.master_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op in ('UPDATE','DELETE') then perform crm_sync.enqueue_master(old.tenant_id); end if;
 if tg_op in ('INSERT','UPDATE') then perform crm_sync.enqueue_master(new.tenant_id); end if;
 return null;
end $$;
create trigger crm_master_options_changed after insert or update or delete on public.dropdown_masters for each row execute function crm_sync.master_changed();
create trigger crm_master_categories_changed after insert or update or delete on public.dropdown_master_categories for each row execute function crm_sync.master_changed();
create trigger crm_master_members_changed after insert or update of tenant_id or delete on public.user_profiles for each row execute function crm_sync.master_changed();
revoke all on function crm_sync.enqueue_master(uuid),crm_sync.master_snapshot(uuid),crm_sync.master_changed() from public,anon,authenticated,service_role;

do $$
declare body text;
begin
 body:=pg_get_functiondef('public.crm_sync_claim_staff_events(integer)'::regprocedure);
 if position('crm_sync.staff_snapshot(claimed.aggregate_id)' in body)=0 then raise exception 'Unexpected staff claim definition'; end if;
 body:=replace(body,'crm_sync.staff_snapshot(claimed.aggregate_id)',
  'case when claimed.event_type=''master.options_changed'' then crm_sync.master_snapshot(claimed.aggregate_id) else crm_sync.staff_snapshot(claimed.aggregate_id) end');
 execute body;
 body:=pg_get_functiondef('public.crm_sync_finish_staff_event(bigint,boolean,text)'::regprocedure);
 if position('select tenant_id from user_profiles where id = v_event.aggregate_id' in body)=0 then raise exception 'Unexpected staff finish definition'; end if;
 body:=replace(body,'select tenant_id from user_profiles where id = v_event.aggregate_id',
  'select case when v_event.event_type=''master.options_changed'' then v_event.aggregate_id else (select tenant_id from user_profiles where id=v_event.aggregate_id) end');
 execute body;
end $$;

-- Former fixed presentation choices become editable master lists. Existing
-- values win; this only initializes categories absent from Dropdown Master.
insert into public.dropdown_master_categories(tenant_id,category_key,display_name,sort_order,is_system,is_key_locked)
select t.id,v.key,v.label,v.position,true,true from public.tenants t cross join (values
 ('gender','Gender',210),('occupation','Occupation',220),('bridal_or_non_bridal','Bridal / Non Bridal',230),('wedding_month','Wedding Month',240),('communication_preference','Communication Preference',245),
 ('lead_status','Lead Registration Status',250),('lead_source_of_lead','Remote Lead Sources',260),('lead_type_of_calling','Lead Calling Types',270),
 ('lead_google_reviews','Lead Google Review Answers',280),('lead_testimonial','Lead Testimonial Answers',290),('lead_instagram_followers','Lead Instagram Answers',300)
) v(key,label,position) on conflict(tenant_id,category_key) do nothing;
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,v.kind,v.label,v.value,v.position,true from public.tenants t cross join (values
 ('gender','FEMALE','female',10),('gender','MALE','male',20),('gender','OTHER','other',30),
 ('communication_preference','CALL','call',10),('communication_preference','WHATSAPP CALLS','whatsapp_calls',20),
 ('communication_preference','WHATSAPP MESSAGE','whatsapp_message',30),('communication_preference','DON''T CONTACT','dont_contact',40),
 ('bridal_or_non_bridal','BRIDAL','bridal',10),('bridal_or_non_bridal','NON BRIDAL','non_bridal',20),
 ('occupation','BUSINESS OWNER','business_owner',10),('occupation','SELF EMPLOYED','self_employed',20),
 ('occupation','SERVICE / SALARIED','service_salaried',30),('occupation','HOUSEWIFE / HOMEMAKER','homemaker',40),
 ('occupation','STUDENT','student',50),('occupation','DOCTOR','doctor',60),('occupation','LAWYER','lawyer',70),
 ('occupation','CHARTERED ACCOUNTANT / CA','chartered_accountant',80),('occupation','ENGINEER','engineer',90),
 ('occupation','TEACHER / PROFESSOR','teacher',100),('occupation','BANKER / FINANCE','banker',110),
 ('occupation','GOVERNMENT EMPLOYEE','government_employee',120),('occupation','REAL ESTATE','real_estate',130),
 ('occupation','FASHION / DESIGNER','fashion_designer',140),('occupation','RETIRED','retired',150),('occupation','OTHER','other',160),
 ('lead_status','LEAD','lead',10),('lead_status','CALLING','calling',20),('lead_status','EXHIBITION','exhibition',30),
 ('lead_source_of_lead','INSTAGRAM','instagram',10),('lead_source_of_lead','WHATSAPP','whatsapp',20),
 ('lead_source_of_lead','INCOMING CALL','incoming_call',30),('lead_source_of_lead','PERSONAL WHATSAPP','personal_whatsapp',40),('lead_source_of_lead','EXHIBITION','exhibition',50),
 ('lead_type_of_calling','EXHIBITION CALLING','exhibition_calling',10),('lead_type_of_calling','INVITATION CALLING','invitation_calling',20),('lead_type_of_calling','PERSONAL CALLING INVITATION','personal_calling_invitation',30),
 ('lead_google_reviews','Yes','yes',10),('lead_google_reviews','No','no',20),('lead_testimonial','Yes','yes',10),
 ('lead_instagram_followers','Yes','yes',10),('lead_instagram_followers','No','no',20)
) v(kind,label,value,position) where not exists(select 1 from public.dropdown_masters m where m.tenant_id=t.id and m.master_type=v.kind);
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'wedding_month',to_char(make_date(2026,n,1),'FMMonth'),n::text,n*10,true from public.tenants t cross join generate_series(1,12) n
where not exists(select 1 from public.dropdown_masters m where m.tenant_id=t.id and m.master_type='wedding_month');
insert into crm_sync.outbox(event_type,aggregate_id)
select 'master.options_changed',id from public.tenants on conflict do nothing;
