-- 0415: enquiry FMS steps are recorded as the sheet wrote them.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select is((select string_agg(s || '=' || r.result || '/' || r.successful || '/' || coalesce(r.ends, '-'), ', ' order by s)
             from unnest(array['NO', 'CUSTOMER DECLINED', 'ORDER CLOSE', 'BUSY', 'YES, THE CLIENT BOUGHT THE PRODUCT', 'NOT INTERESTED CLOSE THIS LEAD']) s,
                  customer.enquiry_status_reading(s) r),
  'BUSY=not_connected/false/-, CUSTOMER DECLINED=negative/true/-, NO=neutral/true/-, NOT INTERESTED CLOSE THIS LEAD=negative/true/lost, ORDER CLOSE=neutral/true/-, YES, THE CLIENT BOUGHT THE PRODUCT=positive/true/won',
  'a status is read only where its own words say it; NO and ORDER CLOSE are kept as written (CUSTOMER DECLINED = said no, 0420)');

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0415 test', 'customer-0415') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
select customer_ingest_store('website_chat_fms', jsonb_build_array(
  jsonb_build_object('row_key', 'W-1-2', 'sheet_row', 3, 'payload', jsonb_build_object('Timestamp', '05/11/2026 10:00:00', 'REFERENCE NUMBER', 'W-1',
    'CUSTOMER NAME', 'Farah', 'CUSTOMER CONTACT NUMBER', '9820015001', 'COMBO', 'W-1-2', 'WORK STAGE', '2. INTRODUCTION CALL',
    'ACTUAL TIME', '05/11/2026 12:00:00', 'STATUS', 'NO')),
  jsonb_build_object('row_key', 'W-1-5', 'sheet_row', 4, 'payload', jsonb_build_object('Timestamp', '05/11/2026 10:00:00', 'REFERENCE NUMBER', 'W-1',
    'CUSTOMER NAME', 'Farah', 'CUSTOMER CONTACT NUMBER', '9820015001', 'COMBO', 'W-1-5', 'WORK STAGE', '5. CLOSER',
    'ACTUAL TIME', '06/11/2026 12:00:00', 'STATUS', 'ORDER CLOSE'))),
  '{"headers": ["Timestamp", "REFERENCE NUMBER", "CUSTOMER NAME", "CUSTOMER CONTACT NUMBER", "COMBO", "WORK STAGE", "ACTUAL TIME", "STATUS"], "next_row": 5}');
select customer_ingest_apply('website_chat_fms', 100);
select is((select channel || '|' || direction || '|' || outcome || '|' || result from customer.interactions where external_ref = 'W-1-2'),
  'not_recorded|not_recorded|NO|neutral', 'a stage contact says how it was done only if the sheet does; the status is kept as written');
select is((select channel || '|' || direction from customer.interactions where external_ref = 'enquiry:W-1'),
  'website|inbound', 'the message that opened the enquiry keeps the tab it came from');
select is((select outcome from customer.enquiries where reference_number = 'W-1'), 'closed', 'ORDER CLOSE closes the enquiry; it is not counted as won');

-- Rows applied before are queued again by the migration's own statement.
update customer.ingest_rows r set status = 'pending' from customer.source_tables t
 where t.source = r.source and t.importer = 'enquiry_fms' and r.status = 'applied';
select customer_ingest_apply('website_chat_fms', 100);
select is((select count(*)::int from customer.interactions where source = 'website_chat_fms'), 2, 're-applying duplicates nothing');

select * from finish();
rollback;
