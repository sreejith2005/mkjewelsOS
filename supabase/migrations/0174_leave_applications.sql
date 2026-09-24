-- Employee leave requests live beside Availability. Images stay private.
set search_path=public,extensions;

-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('availability.review_leave', 'action', null, '{super_admin,admin,hr}', 191);
-- permission-catalog:end

create table leave_requests (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id),
  applicant_id uuid not null references user_profiles(id),
  branch_id uuid not null references branches(id),
  leave_type text not null,
  duration text not null check(duration in ('FULL DAY','1ST HALF','2ND HALF')),
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  leave_start date not null,
  leave_end date not null,
  work_start_date date not null,
  work_start_in text not null check(work_start_in in ('1ST HALF','2ND HALF')),
  submitted_at timestamptz not null default now(),
  inform_status text not null check(inform_status in ('Inform Adv','Not inform In Adv')),
  total_leave_count numeric(6,1) not null check(total_leave_count >= 0),
  tl_approval_path text not null unique,
  handover_to uuid references user_profiles(id),
  handover_approval_path text unique,
  handed_over_at timestamptz,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  hr_remark text,
  reviewed_by uuid references user_profiles(id),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  check(leave_end >= leave_start and work_start_date >= leave_end and work_start_date-leave_start <= 366),
  check((handover_to is null and handover_approval_path is null and handed_over_at is null)
    or (handover_to is not null and handover_approval_path is not null and handed_over_at is not null))
);
create index leave_requests_applicant_idx on leave_requests(applicant_id,submitted_at desc);
create index leave_requests_review_idx on leave_requests(tenant_id,status,submitted_at desc);
alter table leave_requests enable row level security;
create policy leave_requests_read on leave_requests for select to authenticated using (
  current_profile_is_active() and module_accessible('availability')
  and tenant_id=current_tenant_id()
  and (applicant_id=(current_profile()).id or has_permission('availability.review_leave'))
);
revoke all on leave_requests from public,anon,authenticated,service_role;
grant select on leave_requests to authenticated;

create function leave_inform_status(p_submitted date,p_start date,p_end date)
returns text language sql immutable set search_path=public as $$
 select case when (p_end-p_start >= 7 and p_start-p_submitted >= 20)
   or (p_end-p_start between 3 and 6 and p_end-p_submitted >= 7)
   or (p_end-p_start <= 2 and p_start-p_submitted >= 3)
   then 'Inform Adv' else 'Not inform In Adv' end
$$;

create function leave_day_count(p_duration text,p_start date,p_end date,p_work date,p_work_half text)
returns numeric language plpgsql stable set search_path=public as $$
declare v_day date; v_total numeric:=0;
begin
  if p_end<p_start or p_work<p_end then
    raise exception 'Leave dates are invalid' using errcode='22023';
  end if;
  if p_start=p_work then
    if p_work_half='1ST HALF' then return 0; end if;
    if p_duration='2ND HALF' then return 0; end if;
    return 0.5;
  end if;
  for v_day in select generate_series(p_start,p_work-1,'1 day'::interval)::date loop
    if extract(dow from v_day)<>0 then
      v_total:=v_total+case when v_day=p_start and p_duration='2ND HALF' then 0.5 else 1 end;
    end if;
  end loop;
  if p_work_half='2ND HALF' and extract(dow from p_work)<>0 then v_total:=v_total+0.5; end if;
  if p_duration='2ND HALF' and p_work_half='2ND HALF' and p_work-p_start>=5 then v_total:=v_total+0.5; end if;
  return v_total;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('leave-approvals','leave-approvals',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create function leave_file_writable(p_path text)
returns boolean language sql stable security definer set search_path=public,storage as $$
 select current_profile_is_active() and module_accessible('availability')
   and split_part(p_path,'/',1)=current_tenant_id()::text
   and split_part(p_path,'/',2)=(current_profile()).id::text
   and p_path ~ ('^[0-9a-f-]{36}/[0-9a-f-]{36}/(tl|handover)/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
$$;
create function leave_file_readable(p_path text)
returns boolean language sql stable security definer set search_path=public as $$
 select leave_file_writable(p_path) or exists(select 1 from leave_requests r where (r.tl_approval_path=p_path or r.handover_approval_path=p_path)
   and r.tenant_id=current_tenant_id() and current_profile_is_active() and module_accessible('availability')
   and (r.applicant_id=(current_profile()).id or has_permission('availability.review_leave')))
$$;
create policy leave_approval_insert on storage.objects for insert to authenticated
with check(bucket_id='leave-approvals' and owner_id=auth.uid()::text and leave_file_writable(name));
create policy leave_approval_read on storage.objects for select to authenticated
using(bucket_id='leave-approvals' and leave_file_readable(name));
create policy leave_approval_cleanup on storage.objects for delete to authenticated
using(bucket_id='leave-approvals' and owner_id=auth.uid()::text and leave_file_writable(name)
  and not exists(select 1 from public.leave_requests r where r.tl_approval_path=name or r.handover_approval_path=name));

create function assert_leave_image(p_path text,p_kind text,p_actor user_profiles)
returns void language plpgsql security definer set search_path=public,storage as $$
declare v_object storage.objects;
begin
  if p_path is null or split_part(p_path,'/',1)<>p_actor.tenant_id::text
    or split_part(p_path,'/',2)<>p_actor.id::text or split_part(p_path,'/',3)<>p_kind then
    raise exception 'Approval image path is invalid' using errcode='22023';
  end if;
  select * into v_object from storage.objects where bucket_id='leave-approvals' and name=p_path
    and owner_id=auth.uid()::text;
  if v_object.id is null or (v_object.metadata->>'mimetype') not in ('image/jpeg','image/png','image/webp')
    or coalesce((v_object.metadata->>'size')::bigint,0) not between 1 and 5242880 then
    raise exception 'A valid approval image is required' using errcode='22023';
  end if;
end $$;

create function submit_leave_request(p_leave_type text,p_duration text,p_reason text,p_leave_start date,
  p_leave_end date,p_work_start_date date,p_work_start_in text,p_tl_approval_path text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_new leave_requests;
begin
  perform assert_module_access('availability');
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'Active employee required' using errcode='42501'; end if;
  if p_leave_type is null or length(btrim(p_leave_type)) not between 1 and 120
    or not exists(select 1 from dropdown_masters where (tenant_id=v_actor.tenant_id or tenant_id is null) and master_type='leave_type'
      and is_active and value=p_leave_type)
    or p_duration not in ('FULL DAY','1ST HALF','2ND HALF')
    or p_work_start_in not in ('1ST HALF','2ND HALF')
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
    or p_leave_start is null or p_leave_end is null or p_work_start_date is null
    or p_leave_end<p_leave_start or p_work_start_date<p_leave_end
    or p_work_start_date-p_leave_start>366 then
    raise exception 'Leave application fields are invalid' using errcode='22023';
  end if;
  perform assert_leave_image(p_tl_approval_path,'tl',v_actor);
  insert into leave_requests(tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,
    work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path)
  values(v_actor.tenant_id,v_actor.id,v_actor.branch_id,p_leave_type,p_duration,btrim(p_reason),p_leave_start,p_leave_end,
    p_work_start_date,p_work_start_in,leave_inform_status((now() at time zone 'Asia/Kolkata')::date,p_leave_start,p_leave_end),
    leave_day_count(p_duration,p_leave_start,p_leave_end,p_work_start_date,p_work_start_in),p_tl_approval_path)
  returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'leave_submitted','availability',v_new.id,to_jsonb(v_new));
  return v_new.id;
end $$;

create function edit_pending_leave(p_id uuid,p_leave_start date,p_leave_end date,p_work_start_date date,p_work_start_in text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old leave_requests; v_new leave_requests;
begin
  perform assert_module_access('availability');
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'Active employee required' using errcode='42501'; end if;
  select * into v_old from leave_requests where id=p_id and tenant_id=v_actor.tenant_id for update;
  if v_old.id is null or v_old.applicant_id<>v_actor.id or v_old.status<>'pending' then
    raise exception 'Only your pending leave may be edited' using errcode='42501'; end if;
  if p_leave_start is null or p_leave_end is null or p_work_start_date is null
    or p_leave_end<p_leave_start or p_work_start_date<p_leave_end or p_work_start_date-p_leave_start>366
    or p_work_start_in not in ('1ST HALF','2ND HALF') then
    raise exception 'Leave dates are invalid' using errcode='22023'; end if;
  update leave_requests set leave_start=p_leave_start,leave_end=p_leave_end,work_start_date=p_work_start_date,
    work_start_in=p_work_start_in,
    inform_status=leave_inform_status((submitted_at at time zone 'Asia/Kolkata')::date,p_leave_start,p_leave_end),
    total_leave_count=leave_day_count(duration,p_leave_start,p_leave_end,p_work_start_date,p_work_start_in),updated_at=now()
  where id=p_id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'leave_edited','availability',p_id,to_jsonb(v_old),to_jsonb(v_new));
end $$;

create function submit_leave_handover(p_id uuid,p_handover_to uuid,p_approval_path text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old leave_requests; v_new leave_requests;
begin
  perform assert_module_access('availability');
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'Active employee required' using errcode='42501'; end if;
  select * into v_old from leave_requests where id=p_id and tenant_id=v_actor.tenant_id for update;
  if v_old.id is null or v_old.applicant_id<>v_actor.id or v_old.handed_over_at is not null or v_old.status='rejected' then
    raise exception 'Handover is not available' using errcode='42501'; end if;
  if p_handover_to=v_actor.id or not exists(select 1 from user_profiles where id=p_handover_to and tenant_id=v_actor.tenant_id
    and working_status='active' and is_login_enabled) then
    raise exception 'Select an active handover recipient' using errcode='22023'; end if;
  perform assert_leave_image(p_approval_path,'handover',v_actor);
  update leave_requests set handover_to=p_handover_to,handover_approval_path=p_approval_path,
    handed_over_at=now(),updated_at=now() where id=p_id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'leave_handover_submitted','availability',p_id,to_jsonb(v_old),to_jsonb(v_new));
end $$;

create function review_leave_request(p_id uuid,p_approve boolean,p_remark text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old leave_requests; v_new leave_requests; v_day date; v_status availability_status;
begin
  perform assert_module_access('availability');
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or not has_permission('availability.review_leave')
    or not has_permission('availability.manage_others') then
    raise exception 'Leave review denied' using errcode='42501'; end if;
  select * into v_old from leave_requests where id=p_id and tenant_id=v_actor.tenant_id for update;
  if v_old.id is null or v_old.status<>'pending' or v_old.applicant_id=v_actor.id then
    raise exception 'Leave review denied' using errcode='42501'; end if;
  if p_approve is null or length(coalesce(p_remark,''))>1000 or (not p_approve and btrim(coalesce(p_remark,''))='') then
    raise exception 'Review details are invalid' using errcode='22023'; end if;
  if p_approve then
    -- The Apps Script counts through the day before work resumes, plus the
    -- first half of the return day when work resumes in its second half.
    for v_day in select generate_series(v_old.leave_start,v_old.work_start_date,'1 day'::interval)::date loop
      if extract(dow from v_day)=0 and v_old.leave_start<>v_old.work_start_date then continue; end if;
      if v_day=v_old.work_start_date then
        if v_old.work_start_in<>'2ND HALF' or (v_day=v_old.leave_start and v_old.duration='2ND HALF') then
          continue;
        end if;
        v_status:='half_day';
      elsif v_day=v_old.leave_start and v_old.duration='2ND HALF' then
        v_status:='half_day';
      else
        v_status:='absent';
      end if;
      perform record_availability_with_audit(v_old.applicant_id,v_day,v_status,'Approved leave '||v_old.id::text);
    end loop;
  end if;
  update leave_requests set status=case when p_approve then 'approved' else 'rejected' end,
    hr_remark=nullif(btrim(p_remark),''),reviewed_by=v_actor.id,reviewed_at=now(),updated_at=now()
  where id=p_id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'leave_reviewed','availability',p_id,to_jsonb(v_old),to_jsonb(v_new));
end $$;

revoke all on function leave_inform_status(date,date,date),leave_day_count(text,date,date,date,text),
  leave_file_writable(text),leave_file_readable(text),assert_leave_image(text,text,user_profiles),
  submit_leave_request(text,text,text,date,date,date,text,text),edit_pending_leave(uuid,date,date,date,text),
  submit_leave_handover(uuid,uuid,text),review_leave_request(uuid,boolean,text)
from public,anon,authenticated,service_role;
grant execute on function leave_file_writable(text),leave_file_readable(text),
  submit_leave_request(text,text,text,date,date,date,text,text),edit_pending_leave(uuid,date,date,date,text),
  submit_leave_handover(uuid,uuid,text),review_leave_request(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
