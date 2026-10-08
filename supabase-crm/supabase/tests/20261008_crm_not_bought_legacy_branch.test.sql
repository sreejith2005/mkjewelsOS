begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Synthetic legacy rows like the April 2026 import: status NO, no branch, no source visit.
insert into branches(id,name) values
('20261008-0400-4000-8000-0000000000b1','Legacy Branch Visit'),
('20261008-0400-4000-8000-0000000000b2','Legacy Branch Client'),
('20261008-0400-4000-8000-0000000000b3','Legacy Branch Code');
insert into users(id,name,email,role,branch_id,active) values ('20261008-0400-4000-8000-0000000000a1','Legacy Importer','legacy-importer@example.invalid','super_admin',null,true);
insert into clients(client_id,primary_name,primary_phone,last_branch_id) values
('20261008-0400-4000-8000-0000000000c1','Synthetic Legacy Visit','919100840001',null),
('20261008-0400-4000-8000-0000000000c2','Synthetic Legacy Client','919100840002','20261008-0400-4000-8000-0000000000b2'),
('20261008-0400-4000-8000-0000000000c3','Synthetic Legacy Code','919100840003',null);
insert into client_timeline(id,client_id,branch_id,event_type,event_date,reference_number) values
('20261008-0400-4000-8000-0000000000d1','20261008-0400-4000-8000-0000000000c1','20261008-0400-4000-8000-0000000000b1','NON_PURCHASE_VISIT','2026-04-02','MK-WK-SYN-LV1-AA-1'),
('20261008-0400-4000-8000-0000000000d3','20261008-0400-4000-8000-0000000000c1','20261008-0400-4000-8000-0000000000b3','NON_PURCHASE_VISIT','2026-04-03','MK-WK-SYN-LV3-AA-3');
insert into not_bought_followups(id,client_id,reference_number,status,branch_id,created_at,entered_by) values
('20261008-0400-4000-8000-0000000000f1','20261008-0400-4000-8000-0000000000c1','MK-WK-SYN-LV1-AA-1','NO',null,'2026-04-02','20261008-0400-4000-8000-0000000000a1'),
('20261008-0400-4000-8000-0000000000f2','20261008-0400-4000-8000-0000000000c2','MK-WK-SYN-LV2-AA-2','NO',null,'2026-04-02','20261008-0400-4000-8000-0000000000a1'),
('20261008-0400-4000-8000-0000000000f3','20261008-0400-4000-8000-0000000000c3','MK-WK-SYN-LV3-AA-9','NO',null,'2026-04-02','20261008-0400-4000-8000-0000000000a1');

\ir ../migrations/20261008000400_crm_not_bought_legacy_branch.sql

select is((select branch_id from not_bought_followups where id='20261008-0400-4000-8000-0000000000f1'),'20261008-0400-4000-8000-0000000000b1'::uuid,'branch from the visit with the same reference and client');
select is((select branch_id from not_bought_followups where id='20261008-0400-4000-8000-0000000000f2'),'20261008-0400-4000-8000-0000000000b2'::uuid,'branch from the client''s last visit branch');
select is((select branch_id from not_bought_followups where id='20261008-0400-4000-8000-0000000000f3'),'20261008-0400-4000-8000-0000000000b3'::uuid,'branch from the reference number''s branch code');
select is((select status from not_bought_followups where id='20261008-0400-4000-8000-0000000000f1'),'NO','status is left unchanged');
select is((select count(*)::int from not_bought_history where followup_id::text like '20261008-0400-4000-8000-0000000000f_'),0,'no follow-up history is written');
select ok(exists(select 1 from crm_private.audit_logs where action='crm.backfill_not_bought_branch'),'the backfill is audited');

select * from finish();
rollback;
