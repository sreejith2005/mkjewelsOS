begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Branch A is the CRM person's own branch; the walk-in (and so the referral and the
-- Not Bought follow-up) is in branch B, where they are on the roster as CRM department.
insert into branches(id,name) values
('20261008-0300-4000-8000-00000000000a','Followup Roster Home'),
('20261008-0300-4000-8000-00000000000b','Followup Roster Other');
insert into users(id,name,email,role,branch_id,active) values
('20261008-0300-4000-8000-000000000001','Roster Crm','followup-roster-crm@example.invalid','salesperson','20261008-0300-4000-8000-00000000000a',true),
('20261008-0300-4000-8000-000000000002','Branch Seller','followup-branch-seller@example.invalid','salesperson','20261008-0300-4000-8000-00000000000b',true),
('20261008-0300-4000-8000-000000000003','Home Only','followup-home-only@example.invalid','salesperson','20261008-0300-4000-8000-00000000000a',true),
('20261008-0300-4000-8000-000000000004','Former Roster','followup-former@example.invalid','salesperson','20261008-0300-4000-8000-00000000000a',true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id,active)
select id,email,id,id,true from users where id::text like '20261008-0300-4000-8000-00000000000_';
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values
('20261008-0300-4000-8000-00000000000a','ROSTER CRM','20261008-0300-4000-8000-000000000001',true),
('20261008-0300-4000-8000-00000000000b','ROSTER CRM','20261008-0300-4000-8000-000000000001',true),
('20261008-0300-4000-8000-00000000000b','BRANCH SELLER','20261008-0300-4000-8000-000000000002',true),
('20261008-0300-4000-8000-00000000000b','FORMER ROSTER','20261008-0300-4000-8000-000000000004',false);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','20261008-0300-4000-8000-000000000002',true);
select lives_ok($$select * from submit_walkin_visit('{
 "branch_id":"20261008-0300-4000-8000-00000000000b","primary_name":"Synthetic Followup Roster Client","primary_phone":"9100830001",
 "proposed_client_id":"20261008-0300-4000-8000-000000000010","proposed_timeline_id":"20261008-0300-4000-8000-000000000011",
 "event_date":"2026-10-08T10:00:00+05:30","crm_name":"BRANCH SELLER","salesperson":"Branch Seller","visit_status":"NO","did_buy":false,
 "seen_categories":["Ring"],"not_bought_reasons":["PRICE"],"category_details":{"seen_count":"1","seen_tags":["T1"]},
 "engagement":{"referrals":{"asked":true}},
 "additional_fields":{"visit_status":"NO","salesperson":"Branch Seller","referrals_count":"1","engagement_answers":{"referrals":"YES"},
   "referrals":[{"name":"Synthetic Roster Referral","mobile":"9100830009"}]}
}'::jsonb)$$,'walk-in with a referral and not bought saved in branch B');
reset role;

create temp table ids as
select (select rc.id from referral_calling rc join referrals r on r.id=rc.referral_id where r.given_by_client_id='20261008-0300-4000-8000-000000000010') as calling_id,
       (select id from not_bought_followups where client_id='20261008-0300-4000-8000-000000000010') as followup_id;
grant select on ids to authenticated;
select isnt((select calling_id from ids),null,'the walk-in referral has a referral calling row');
select is((select next_followup_date from referral_calling where id=(select calling_id from ids)),'2026-10-09'::date,'the first referral call is due the next business day');
select isnt((select followup_id from ids),null,'the walk-in has a Not Bought follow-up');

set local role authenticated;
-- Roster member of branch B whose own branch is A: allowed.
select set_config('request.jwt.claim.sub','20261008-0300-4000-8000-000000000001',true);
select lives_ok($$select save_referral_followup((select calling_id from ids),'CALL CONNECTED','CONNECTED','2026-10-12','spoke to them','x',gen_random_uuid())$$,
  'a roster member saves a referral follow-up in another roster branch');
select lives_ok($$select save_not_bought_followup((select followup_id from ids),'INTERESTED - NEED FOLLOW UP','CONNECTED','2026-10-12','wants a quote')$$,
  'a roster member saves a Not Bought follow-up in another roster branch');
select lives_ok($$select reconcile_referral_calling_conversions()$$,'a roster member can sync referral conversions');
select lives_ok($$select sync_not_bought_followups()$$,'a roster member can sync Not Bought data');

-- 20261008000500 (owner decision): any active CRM user saves any follow-up, roster or not.
select set_config('request.jwt.claim.sub','20261008-0300-4000-8000-000000000003',true);
select lives_ok($$select save_referral_followup((select calling_id from ids),'CALL CONNECTED','CONNECTED','2026-10-12','x','x',gen_random_uuid())$$,
  'a person off the branch roster saves its referral follow-up');
select lives_ok($$select save_not_bought_followup((select followup_id from ids),'CALL NOT PICKED','NOT PICKED','2026-10-12','x')$$,
  'a person off the branch roster saves its Not Bought follow-up');

select set_config('request.jwt.claim.sub','20261008-0300-4000-8000-000000000004',true);
select lives_ok($$select save_not_bought_followup((select followup_id from ids),'CALL NOT PICKED','NOT PICKED','2026-10-12','x')$$,
  'a person with only an inactive roster row still saves (active CRM access is what counts)');

-- The branch's own staff keep the original rule.
select set_config('request.jwt.claim.sub','20261008-0300-4000-8000-000000000002',true);
select lives_ok($$select save_not_bought_followup((select followup_id from ids),'CALL NOT PICKED','NOT PICKED','2026-10-13','no answer')$$,
  'branch staff still save their own branch follow-ups');
reset role;

-- A deactivated access grant (person removed in JewelOS Users) grants nothing.
update crm_sso_access_grants set active=false where legacy_crm_user_id='20261008-0300-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','20261008-0300-4000-8000-000000000001',true);
select throws_ok($$select save_not_bought_followup((select followup_id from ids),'CALL NOT PICKED','NOT PICKED','2026-10-12','x')$$,
  '42501',null,'a person without active CRM access cannot save');
reset role;

select is((select status from referral_calling where id=(select calling_id from ids)),'CALL CONNECTED','the referral save persisted');
select is((select count(*)::int from referral_calling_history where referral_calling_id=(select calling_id from ids)),2,'two referral history rows');
select is((select count(*)::int from crm_private.audit_logs where action='crm.save_not_bought_followup' and record_id=(select followup_id from ids)),4,'every allowed Not Bought save audited');

-- A follow-up without a branch can be saved by any active CRM user too.
update not_bought_followups set branch_id=null where id=(select followup_id from ids);
set local role authenticated;
select set_config('request.jwt.claim.sub','20261008-0300-4000-8000-000000000003',true);
select lives_ok($$select save_not_bought_followup((select followup_id from ids),'CALL NOT PICKED','NOT PICKED','2026-10-14','again')$$,
  'a follow-up without a branch is saveable');
reset role;
select is((select status from not_bought_followups where id=(select followup_id from ids)),'CALL NOT PICKED','the last allowed Not Bought save persisted');
select ok(not has_function_privilege('authenticated','crm_private.works_crm_branch(uuid)','execute'),'the branch helper is not callable by clients');

select * from finish();
rollback;
