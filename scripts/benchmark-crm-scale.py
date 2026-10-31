"""Local-only rollback benchmark. Never connects to a hosted database.

Run: python scripts/benchmark-crm-scale.py
Uses the task's isolated Docker database; inserts 100,000 synthetic records per
large CRM table with replication triggers disabled for fixture construction.
Projection backfill uses the migration's real SQL. Normal write/trigger behavior
is covered by pgTAP, not inferred from this bulk-fixture benchmark.
"""
from pathlib import Path
import subprocess
import sys

CONTAINER = 'supabase_db_crm-workflow-perf'
ROOT = Path(__file__).resolve().parents[1]
migration = (ROOT / 'supabase-crm/supabase/migrations/20261009000100_crm_scale_reads.sql').read_text(encoding='utf-8')
backfill = migration[migration.index('insert into public.crm_client_browse_state(client_id,first_recorded_at,latest_interaction_at,next_future_contact_at,lead_source)\nwith activity'):migration.index('do $$ declare source_table')]
sql = r"""
begin;
set local statement_timeout='300s';
set local session_replication_role='replica';
insert into public.branches(id,name) values('20261009-9999-4000-8000-00000000000a','Synthetic Scale');
insert into public.users(id,name,email,role,branch_id,active) values('20261009-9999-4000-8000-000000000001','Synthetic Scale Staff','scale-benchmark@example.invalid','salesperson','20261009-9999-4000-8000-00000000000a',true);
insert into public.crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id,active) values('20261009-9999-4000-8000-000000000001','scale-benchmark@example.invalid','20261009-9999-4000-8000-000000000001','20261009-9999-4000-8000-000000000001',true);
insert into public.crm_allocation(branch_id,crm_name,crm_user_id,active) values('20261009-9999-4000-8000-00000000000a','SCALE STAFF','20261009-9999-4000-8000-000000000001',true);
create temp table fixture as select n,('20261009-9999-4000-9000-'||lpad(n::text,12,'0'))::uuid as id from generate_series(1,100000)n;
create unique index on fixture(id);analyze fixture;
insert into public.clients(client_id,client_code,referral_code,primary_name,primary_phone,total_visits,last_branch_id,last_visit_date,profile_updated_at)
select id,'MKC-'||(900000+n),'MKREF-'||(900000+n),'Synthetic scale client '||n,'919'||lpad(n::text,9,'0'),1,'20261009-9999-4000-8000-00000000000a',now()-n*interval '1 second',now()-n*interval '1 second' from fixture;
insert into public.client_phone_index(phone,client_id) select '919'||lpad(n::text,9,'0'),id from fixture;
insert into public.client_timeline(id,client_id,event_date,created_at,branch_id,crm_name,buy_status,reference_number)
select id,id,now()-n*interval '1 second',now()-n*interval '1 second','20261009-9999-4000-8000-00000000000a','SCALE STAFF',case when n%3=0 then 'YES'::public.buy_status else 'NO'::public.buy_status end,'SCALE-'||n from fixture;
insert into public.visit_forms(id,client_timeline_id,source_of_lead,not_bought_reasons) select id,id,'INSTAGRAM',array['PRICE'] from fixture;
insert into public.not_bought_followups(id,client_id,reference_number,status,next_followup_date,entered_by,branch_id,created_at,source_timeline_id,source_visit_form_id,followup_count)
select id,id,'SCALE-'||n,case when n%3=0 then 'FOLLOW UP DONE' when n%3=1 then 'PENDING' else 'HISTORICAL' end,current_date-1,'20261009-9999-4000-8000-000000000001','20261009-9999-4000-8000-00000000000a',now()-n*interval '1 second',id,id,1 from fixture;
insert into public.not_bought_history(followup_id,status,remark,created_at,updated_by) select id,'PENDING','Synthetic call',now()-n*interval '1 second','20261009-9999-4000-8000-000000000001' from fixture;
insert into public.referrals(id,given_by_client_id,salesperson_id,referral_name,referral_number,crm_name,branch_id,created_at)
select id,id,'20261009-9999-4000-8000-000000000001','Synthetic referral '||n,'918'||lpad(n::text,9,'0'),'SCALE STAFF','20261009-9999-4000-8000-00000000000a',now()-n*interval '1 second' from fixture;
insert into public.referral_calling(id,referral_id,status,next_followup_date,created_at) select id,id,'PENDING',current_date-1,now()-n*interval '1 second' from fixture;
insert into public.referral_calling_history(referral_calling_id,status,remark,created_at,entered_by) select id,'PENDING','Synthetic referral call',now()-n*interval '1 second','Scale staff' from fixture;
insert into public.entry_queue(id,token,client_name,mobile,branch_id,status,client_id,created_at) select id,'SCALE-'||n,'Synthetic scale client '||n,'919'||lpad(n::text,9,'0'),'20261009-9999-4000-8000-00000000000a',case when n%3=0 then 'complete' else 'pending' end,id,now()-n*interval '1 second' from fixture;
set local session_replication_role='origin';
""" + backfill.replace('insert into public.crm_client_browse_state', 'delete from public.crm_client_browse_state;\ninsert into public.crm_client_browse_state', 1).replace('insert into public.crm_client_queue_browse_state', 'delete from public.crm_client_queue_browse_state;\ninsert into public.crm_client_queue_browse_state', 1) + (ROOT / 'supabase-crm/supabase/tests/fixtures/crm_master_options.sql').read_text(encoding='utf-8') + r"""
analyze public.clients;analyze public.client_timeline;analyze public.visit_forms;analyze public.not_bought_followups;analyze public.not_bought_history;analyze public.referrals;analyze public.referral_calling;analyze public.referral_calling_history;analyze public.entry_queue;analyze public.crm_client_browse_state;analyze public.crm_client_queue_browse_state;analyze public.client_phone_index;
set local role authenticated;
select set_config('request.jwt.claim.sub','20261009-9999-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
\timing on
set local statement_timeout='30s';
select 'NOT BOUGHT FIRST',r->>'total',jsonb_array_length(r->'rows'),octet_length(r::text) from(select public.browse_crm_followups('not_bought','{"tab":"pending"}',0,50)r offset 0)s;
select 'NOT BOUGHT DEEP',r->>'total',jsonb_array_length(r->'rows'),octet_length(r::text) from(select public.browse_crm_followups('not_bought','{"tab":"pending"}',50000,50)r offset 0)s;
select 'NOT BOUGHT SEARCH',r->>'total',jsonb_array_length(r->'rows') from(select public.browse_crm_followups('not_bought','{"tab":"pending","search":"SCALE-100000"}',0,50)r offset 0)s;
select 'REFERRAL FIRST',r->>'total',jsonb_array_length(r->'rows'),octet_length(r::text) from(select public.browse_crm_followups('referral','{"tab":"pending"}',0,50)r offset 0)s;
select 'CLIENT FIRST',r->>'total',jsonb_array_length(r->'rows'),octet_length(r::text) from(select public.browse_crm_records_page('{}',0,200)r offset 0)s;
select 'CLIENT DEEP',r->>'total',jsonb_array_length(r->'rows') from(select public.browse_crm_records_page('{}',90000,200)r offset 0)s;
select 'CLIENT NAME SEARCH',r->>'total',jsonb_array_length(r->'rows') from(select public.browse_crm_records_page('{"search":"Synthetic scale client 100000"}',0,200)r offset 0)s;
select 'CLIENT PHONE SEARCH',r->>'total',jsonb_array_length(r->'rows') from(select public.browse_crm_records_page('{"search":"919000100000"}',0,200)r offset 0)s;
select 'CLIENT SOURCE FILTER',r->>'total',jsonb_array_length(r->'rows') from(select public.browse_crm_records_page('{"source":"INSTAGRAM"}',0,200)r offset 0)s;
select 'DASHBOARD ALL',jsonb_array_length(r->'recentVisits'),octet_length(r::text) from(select public.crm_dashboard_summary()r offset 0)s;
select 'WALKIN QUEUE FIRST',r->>'total_count',jsonb_array_length(r->'items'),octet_length(r::text) from(select public.get_walkin_queue_page()r offset 0)s;
select 'WALKIN QUEUE DEEP',r->>'total_count',jsonb_array_length(r->'items') from(select public.get_walkin_queue_page(p_offset=>50000)r offset 0)s;
rollback;
"""
if '--seed-only' in sys.argv:
    sql=sql[:sql.index('set local role authenticated;')]+ '\ncommit;'
elif '--read-only' in sys.argv:
    sql='begin;'+sql[sql.index('set local role authenticated;'):]
sql='\n'.join(('savepoint scale_read;\n'+line+'\nrollback to scale_read;') if line.startswith(tuple("select '"+prefix for prefix in ["NOT BOUGHT","REFERRAL","CLIENT","DASHBOARD","WALKIN"])) else line for line in sql.splitlines())
result = subprocess.run(['docker','exec','-i',CONTAINER,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=0'],input=sql.encode('utf-8'),capture_output=True)
out = result.stdout.decode('utf-8'); err = result.stderr.decode('utf-8')
print(out)
if err.strip():print(err,file=sys.stderr)
if result.returncode or 'ERROR:' in err:
    raise SystemExit(1)
