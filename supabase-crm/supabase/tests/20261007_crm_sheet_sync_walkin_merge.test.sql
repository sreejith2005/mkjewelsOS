-- Walk-in merge (20261007000100): with one spreadsheet (WALKIN DATASET + FAMILY DATA) a visit
-- updates its client the Sheet's way: a filled answer replaces the old value, a blank answer
-- keeps it, the longer name stays. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into branches(id, name) values ('20261011-0000-4000-8000-00000000000a', 'Merge Branch');

create function pg_temp.svc(p_action text, p_payload jsonb) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return public.crm_sheet_sync(p_action, p_payload);
end $$;
grant execute on function pg_temp.svc(text, jsonb) to service_role;
create function pg_temp.client(p_code text) returns clients language sql security definer as $$
  select * from clients where client_code = p_code;
$$;
grant execute on function pg_temp.client(text) to service_role;

set local role service_role;
select is(pg_temp.svc('push', jsonb_build_object('tab', 'WALKIN DATASET', 'rows', jsonb_build_array(jsonb_build_object(
  'key', 'MK-WK-MRG-MER-QA-1', 'hash', 'm1', 'values', '{"BRANCH":"MERGE BRANCH","CRM CLIENT ID":"MKC-103901"}'::jsonb,
  'payload', '{"primary_name":"SYNTHETIC MERGE CLIENT","primary_phone":"9187500001","city":"MUMBAI","dob":"1991-01-02","pincode":"400001","event_date":"2026-10-01T00:00:00.000Z","did_buy":false}'::jsonb)))) -> 'counts',
  '{"inserted": 1}'::jsonb, 'the first visit creates the client with the Sheet''s MKC');
select is((pg_temp.client('MKC-103901')).city::text, 'MUMBAI', 'with the visit''s details');

select is(pg_temp.svc('push', jsonb_build_object('tab', 'WALKIN DATASET', 'rows', jsonb_build_array(jsonb_build_object(
  'key', 'MK-WK-MRG-MER-QA-2', 'hash', 'm2', 'values', '{"BRANCH":"MERGE BRANCH","CRM CLIENT ID":"MKC-103901"}'::jsonb,
  'payload', '{"primary_name":"SYNTHETIC MERGE","primary_phone":"9187500001","pincode":"400050","event_date":"2026-10-05T00:00:00.000Z","did_buy":true}'::jsonb)))) -> 'counts',
  '{"inserted": 1}'::jsonb, 'a later visit of the same client is added');
select is((select count(*)::int from clients where client_code = 'MKC-103901'), 1, 'to the same client');
select is((pg_temp.client('MKC-103901')).pincode::text, '400050', 'a filled answer replaces the old value');
select is((pg_temp.client('MKC-103901')).city::text, 'MUMBAI', 'a blank answer keeps the old value');
select is((pg_temp.client('MKC-103901')).dob, '1991-01-02'::date, 'a blank date keeps the old date');
select is((pg_temp.client('MKC-103901')).primary_name::text, 'SYNTHETIC MERGE CLIENT', 'the longer name is kept');
select is((pg_temp.client('MKC-103901')).total_visits, 2, 'visit statistics count both visits');
reset role;

select * from finish();
rollback;
