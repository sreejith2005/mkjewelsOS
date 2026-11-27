-- Form assignment lookup and broader selection; synthetic fixtures only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temp table fx(kind text primary key, id uuid, auth_id uuid);
create temp table fx_rec(label text primary key, id uuid);
do $$
declare t uuid; b uuid; b2 uuid; sales uuid; crm uuid; r record; aid uuid; pid uuid; f uuid; desig uuid;
begin
  insert into tenants(name, slug) values ('0391 test', 'user-filter-0391') returning id into t;
  insert into branches(tenant_id, name, code) values (t, '0391 Bandra', 'B0391') returning id into b;
  insert into branches(tenant_id, name, code) values (t, '0391 Andheri', 'A0391') returning id into b2;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Sales', 'SALES0391') returning id into sales;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'CRM', 'CRM0391') returning id into crm;
  insert into dropdown_masters(tenant_id, master_type, label, value, is_active) values (t, 'designation', 'Senior Sales', 'senior_sales_0391', true) returning id into desig;
  insert into fx_rec values ('tenant', t), ('sales', sales), ('crm', crm), ('bandra', b), ('andheri', b2), ('senior', desig);
  for r in select * from (values ('filler','staff', 'sales', 'b'), ('sales_bandra','staff','sales','b'), ('sales_andheri','staff','sales','a'),
      ('crm_bandra','crm','crm','b'), ('manager','manager','sales','b')) v(kind, role, dept, br) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'uf-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled, designation_id)
    values (t, aid, case when r.br = 'b' then b else b2 end, case when r.dept = 'sales' then sales else crm end,
      'UF ' || r.kind, 'UF-' || upper(r.kind), 'uf-' || r.kind || '@example.in', r.role::user_role, 'active', 'active', true,
      case when r.kind = 'sales_andheri' then desig end)
    returning id into pid;
    insert into fx values (r.kind, pid, aid);
  end loop;
  -- A published form: one question limited to Sales, one to Sales at Bandra or a Senior Sales designation, one unfiltered.
  f := gen_random_uuid();
  insert into form_templates(id, family_id, tenant_id, name, is_active, lifecycle, library_visible, permissions)
  values (f, f, t, 'UF handoff', true, 'draft', true, '{"roles":["super_admin","admin","manager","crm","staff"]}');
  insert into form_fields(form_template_id, field_key, field_name, field_type, sort_order, is_shown, is_editable, is_required, validation) values
    (f, 'salesperson', 'Salesperson', 'user_dropdown', 0, true, true, false,
      jsonb_build_object('userFilter', jsonb_build_object('match', 'all', 'rules', jsonb_build_array(
        jsonb_build_object('attribute', 'department', 'operator', 'equals', 'values', jsonb_build_array(sales::text)),
        jsonb_build_object('attribute', 'role', 'operator', 'not_in', 'values', '["manager","admin"]'::jsonb))))),
    (f, 'either', 'Bandra sales or senior', 'user_dropdown', 1, true, true, false,
      jsonb_build_object('userFilter', jsonb_build_object('match', 'any', 'rules', jsonb_build_array(
        jsonb_build_object('attribute', 'store', 'operator', 'equals', 'values', jsonb_build_array(b::text)),
        jsonb_build_object('attribute', 'designation', 'operator', 'in', 'values', jsonb_build_array(desig::text)))))),
    (f, 'anyone', 'Anyone', 'user_dropdown', 2, true, true, false, '{}');
  update form_templates set lifecycle = 'published', published_at = now() where id = f;
  insert into fx_rec values ('form', f);
end $$;
do $$
declare t uuid; b uuid; d uuid; a uuid:=gen_random_uuid(); p uuid; f uuid:=gen_random_uuid();
begin
 insert into tenants(name,slug) values('0444 foreign','form-users-foreign-0444') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Foreign store','FOREIGN0444') returning id into b;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Foreign department','FOREIGND0444') returning id into d;
 insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values(a,'authenticated','authenticated','foreign0444@example.in','x',now(),now());
 insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
 values(t,a,b,d,'Foreign employee','FOREIGN0444','foreign0444@example.in','staff','active','active',true) returning id into p;
 insert into fx values('foreign',p,a);
 insert into form_templates(id,family_id,tenant_id,name,is_active,lifecycle,permissions) values(f,f,t,'Foreign form',true,'draft','{"roles":["staff"]}');
 insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'person','Person','user_dropdown',0);
 update form_templates set lifecycle='published',published_at=now() where id=f;
 insert into fx_rec values('foreign_form',f),('foreign_branch',b);
 select id into t from fx_rec where label='tenant';
 f:=gen_random_uuid();
 insert into form_templates(id,family_id,tenant_id,name,is_active,lifecycle,permissions) values(f,f,t,'Restricted form',true,'draft','{"roles":["manager"]}');
 insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'person','Person','user_dropdown',0);
 update form_templates set lifecycle='published',published_at=now() where id=f;
 insert into fx_rec values('restricted_form',f);
 f:=gen_random_uuid();
 insert into form_templates(id,family_id,tenant_id,name,is_active,lifecycle,permissions) values(f,f,t,'Unpublished form',true,'draft','{"roles":["staff"]}');
 insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'person','Person','user_dropdown',0);
 insert into fx_rec values('draft_form',f);

end $$;

grant select on fx, fx_rec to authenticated;
create function pg_temp.p(k text) returns uuid language sql stable as $$ select id from fx where kind = k $$;
create function pg_temp.r(k text) returns uuid language sql stable as $$ select id from fx_rec where label = k $$;
create function pg_temp.login(k text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = k), true);
$$;
create function pg_temp.submit(answers jsonb) returns text language sql as $$
  select format($q$select submit_form_with_audit(%L, %L::jsonb, null, null)$q$, (select id from fx_rec where label = 'form'), answers);
$$;
grant execute on function pg_temp.p(text), pg_temp.r(text), pg_temp.login(text), pg_temp.submit(jsonb) to authenticated;


set local role authenticated;
select pg_temp.login('filler');
select ok(exists(select 1 from list_form_user_options(pg_temp.r('form'),'salesperson',false) where id=pg_temp.p('sales_bandra')), 'configured Sales colleague is listed without directory reads');
select ok(not exists(select 1 from list_form_user_options(pg_temp.r('form'),'salesperson',false) where id=pg_temp.p('crm_bandra')), 'CRM is outside configured Sales list');
select ok(exists(select 1 from list_form_user_options(pg_temp.r('form'),'salesperson',true) where id=pg_temp.p('crm_bandra')), 'expanded own-store list includes CRM');
select ok(not exists(select 1 from list_form_user_options(pg_temp.r('form'),'salesperson',true) where id=pg_temp.p('sales_andheri')), 'other stores are loaded through the store picker');
select lives_ok(pg_temp.submit(jsonb_build_object('salesperson',pg_temp.p('crm_bandra'))),'selection outside configured department saves');
select ok(exists(select 1 from list_form_user_options(pg_temp.r('form'),'salesperson',false,pg_temp.p('crm_bandra')) where id=pg_temp.p('crm_bandra')), 'reopened selected person resolves outside configured filter');
select ok(not exists(select 1 from list_form_user_options(pg_temp.r('form'),'salesperson',false,pg_temp.p('foreign')) where id=pg_temp.p('foreign')), 'selected ID cannot leak another tenant name');
reset role;
select lives_ok(format($q$select fms_validate_candidate_form(%L,jsonb_build_object('salesperson',%L),null,null)$q$,pg_temp.r('form'),pg_temp.p('crm_bandra')),'FMS preview accepts same outside-filter answer as submission');
set local role authenticated;

select lives_ok(pg_temp.submit(jsonb_build_object('salesperson',pg_temp.p('manager'))),'higher hierarchy recipient saves as in Tasks');
select throws_ok(pg_temp.submit(jsonb_build_object('salesperson',pg_temp.p('foreign'))),'23503',null,'cross-tenant recipient denied');
select throws_ok(format($q$select list_form_user_options(%L,'person',false)$q$,pg_temp.r('foreign_form')),'42501',null,'cross-tenant form lookup denied');
select throws_ok(format($q$select search_assignment_recipients(jsonb_build_object('kind','form','form_template_id',%L,'field_key','salesperson'),%L,'',0,20)$q$,pg_temp.r('form'),pg_temp.r('foreign_branch')),'22023',null,'foreign store lookup denied');

select lives_ok(format($q$select list_assignment_locations(jsonb_build_object('kind','form','form_template_id',%L,'field_key','salesperson'))$q$,pg_temp.r('form')), 'all saved Users questions allow store lookup');
select throws_ok(format($q$select list_form_user_options(%L,'missing',false)$q$,pg_temp.r('form')),'42501',null,'unknown question denied');
reset role;
update user_profiles set is_login_enabled=false where id=pg_temp.p('crm_bandra');
set local role authenticated;
select ok(not exists(select 1 from list_form_user_options(pg_temp.r('form'),'salesperson',true) where id=pg_temp.p('crm_bandra')), 'disabled recipients excluded');
select throws_ok(pg_temp.submit(jsonb_build_object('salesperson',pg_temp.p('crm_bandra'))),'23503',null,'disabled recipient submit denied');
reset role;

set local role authenticated;
select throws_ok(format($q$select list_form_user_options(%L,'person',false)$q$,pg_temp.r('draft_form')),'42501',null,'unpublished form lookup denied');
select throws_ok(format($q$select list_form_user_options(%L,'person',false)$q$,pg_temp.r('restricted_form')),'42501',null,'form access required even within same tenant');
reset role;
update user_profiles set working_status='resigned' where id=pg_temp.p('filler');
set local role authenticated;
select throws_ok(format($q$select list_form_user_options(%L,'salesperson',false)$q$,pg_temp.r('form')),'42501',null,'inactive actor denied');
reset role;
select ok(not has_function_privilege('anon','list_form_user_options(uuid,text,boolean,uuid)','EXECUTE'),'anonymous lookup denied');
select ok(not has_function_privilege('service_role','list_form_user_options(uuid,text,boolean,uuid)','EXECUTE'),'lookup requires signed-in actor');
select * from finish();
rollback;
