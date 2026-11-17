-- 0420: ORDER FMS and REPAIR FMS; CUSTOMER DECLINED; deadlocks stay pending.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; b uuid;
begin
  insert into tenants(name, slug) values ('0420 test', 'customer-0420') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into branches(tenant_id, name, code) values (t, 'MK Bandra', 'B0420') returning id into b;
  insert into fx values ('tenant', t), ('bandra', b);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.order_row(p_row integer, p_design text, p_stage text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'W100001|' || p_design || '|' || p_stage, 'sheet_row', p_row, 'payload', jsonb_build_object(
    'DATE OF ORDER', '01/11/2026', 'WORK ORDER NO', 'W100001', 'DESIGN NO', p_design, 'CATEGORY', 'RINGS GOLD', 'KARIGAR', 'RAMU',
    'BILLING PHONE NUMBER', '9820020001', 'SALE PERSON', 'DEEPA', 'STATUS', 'To Karigar', 'TYPE OF ORDER', 'GOLD',
    'WORK STAGE', p_stage, 'DOER', 'BADRINATH', 'PLANNED', '02/11/2026 10:00:00') || p_extra) $$;

-- 1. Orders ----------------------------------------------------------------------------------------
select customer_ingest_store('order_fms', jsonb_build_array(
  pg_temp.order_row(3, 'D11111', '3. ORDER ISSUE TO KARIGAR', '{"ACTUAL": "02/11/2026 11:00:00"}'),
  pg_temp.order_row(4, 'D11111', '10. UPDATE TO CLIENT (PRODUCT READY AT STORE)', '{"ACTUAL": "15/11/2026 16:00:00", "REMARK": "client informed on whatsapp"}'),
  pg_temp.order_row(5, 'D22222', '3. ORDER ISSUE TO KARIGAR', '{"CATEGORY": "BANGLE GOLD"}'),
  jsonb_build_object('row_key', 'W100002||#VALUE!', 'sheet_row', 6, 'payload', '{"DATE OF ORDER": "01/11/2026", "WORK ORDER NO": "W100002", "WORK STAGE": "#VALUE!", "DOER": "18/11/2026 15:16:41"}'::jsonb)),
  '{"headers": ["DATE OF ORDER", "WORK ORDER NO", "DESIGN NO", "BILLING PHONE NUMBER", "WORK STAGE", "ACTUAL"], "next_row": 7}');
select is(customer_ingest_apply('order_fms', 100) - 'pending', '{"applied": 4, "rejected": 0}'::jsonb, 'order rows applied, the broken one too');
select is((select step_count || '|' || outcome || '|' || channel || '|' || final_stage_no from customer.enquiries where source = 'order_fms' and reference_number = 'W100001'),
  '3|closed|order|10', 'one case per work order; it is closed once stage 10 is done');
select is((select (details -> 'D22222' ->> 'category') || '|' || (details -> 'D11111' ->> 'karigar') from customer.enquiries where reference_number = 'W100001'),
  'BANGLE GOLD|RAMU', 'what describes each design is kept on the case');
select is((select string_agg(purpose || ':' || outcome || ':' || coalesce(notes, '-'), ',' order by occurred_at) from customer.interactions where source = 'order_fms' and client_id = pg_temp.client('9820020001')),
  'order:Order placed:order W100001,order:10. UPDATE TO CLIENT (PRODUCT READY AT STORE):client informed on whatsapp',
  'the timeline shows the order placed and the update to the client; karigar stages are not contacts');
select is((select count(*)::int from customer.enquiry_steps s join customer.enquiries e on e.id = s.enquiry_id where e.reference_number = 'W100002'), 1,
  'a broken row is kept as a step of its own case');
select is((select count(*)::int from customer.client_phones p join customer.enquiries e on e.client_id = p.client_id where e.reference_number = 'W100002'), 0,
  'with no phone, the order has a customer of its own');

-- 2. Repairs -----------------------------------------------------------------------------------------
create function pg_temp.repair_row(p_row integer, p_stage text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'MK-R-1001|R5001|' || p_stage, 'sheet_row', p_row, 'payload', jsonb_build_object(
    'TIMESTAMP', '03/11/2026', 'UNIQUE ID', 'MK-R-1001', 'BRANCH', 'BANDRA', 'NAME OF THE PERSON FILLING THE FORM', 'CHHOTU GUPTA',
    'NAME OF THE SALEPERSON ATTENDING CLIENT', 'UMA SEHGAL', 'CLIENT NAME', 'Asha Mehta', 'CONTACT NUMBER', '9820020002',
    'GROSS WEIGHT OF THE PRODUCT', '4.25', 'PRODUCT CATEGORY', 'CHAIN GOLD', 'REPAIR NUMBER', 'R5001', 'EXPECTED PICKUP DATE', '10/11/2026',
    'STATUS', 'Sold', 'WORK STAGE', p_stage, 'DOER', 'BADRINATH SAHU', 'PLANNED', '04/11/2026 10:00:00') || p_extra) $$;
select customer_ingest_store('repair_fms', jsonb_build_array(
  pg_temp.repair_row(3, '3. PRODUCT ISSUED TO KARIGAR', '{"ACTUAL TIME": "04/11/2026 11:00:00", "STATUS (2)": "YES"}'),
  pg_temp.repair_row(4, '9. CLIENT CONTACTED FOR PRODUCT PICKUP', '{"ACTUAL TIME": "09/11/2026 12:00:00", "STATUS (2)": "CLIENT WILL VISIT STORE FOR PICKUP", "REMARK": "coming saturday"}')),
  '{"headers": ["TIMESTAMP", "UNIQUE ID", "CLIENT NAME", "CONTACT NUMBER", "REPAIR NUMBER", "WORK STAGE", "ACTUAL TIME", "STATUS (2)"], "next_row": 5}');
select is(customer_ingest_apply('repair_fms', 100) - 'pending', '{"applied": 2, "rejected": 0}'::jsonb, 'repair rows applied');
select is((select string_agg(i.outcome || ':' || coalesce(i.staff_name, '-') || ':' || coalesce(i.recorded_by_name, '-') || ':' || (i.branch_id = (select id from fx where label = 'bandra')), ',' order by i.occurred_at)
             from customer.interactions i where i.source = 'repair_fms'),
  'Repair handed in:UMA SEHGAL:CHHOTU GUPTA:true,CLIENT WILL VISIT STORE FOR PICKUP:BADRINATH SAHU:-:true',
  'the repair handed in, and the pickup call with what the sheet wrote');
select is((select outcome || '|' || (details -> 'R5001' ->> 'gross_weight') from customer.enquiries where source = 'repair_fms'), 'closed|4.25',
  'the repair closes at stage 9 and keeps its item details');
select is((select primary_name from customer.clients where id = pg_temp.client('9820020002')), 'Asha Mehta', 'the repair''s customer by contact number');

-- 3. Corrections --------------------------------------------------------------------------------------
select is((select result || '|' || successful from customer.enquiry_status_reading('CUSTOMER DECLINED')), 'negative|true', 'CUSTOMER DECLINED: the customer said no');
select is((select result || '|' || successful from customer.follow_up_status_reading('CUSTOMBER DECLINED')), 'negative|true', 'also as misspelt in References calling');
select is((select result from customer.follow_up_status_reading('BUSY / DECLINED')), 'neutral', 'BUSY / DECLINED stays as written');
select is((select final_stage_no from customer.enquiries where source = 'order_fms' limit 1) is not null
          and not exists (select 1 from customer.enquiries where source = 'not_bought_fms' and final_stage_no is not null), true,
  'only cases with a closing stage close by stage');

select * from finish();
rollback;
