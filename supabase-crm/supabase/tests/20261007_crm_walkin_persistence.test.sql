begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into branches(id,name) values ('20261007-0000-4000-8000-000000000001','Persistence Test');
insert into users(id,name,email,role,branch_id,active) values
('20261007-0000-4000-8000-000000000002','Audit Actor','persistence-actor@example.invalid','super_admin',null,true),
('20261007-0000-4000-8000-000000000003','Selected Seller','persistence-seller@example.invalid','salesperson','20261007-0000-4000-8000-000000000001',true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id,active)
select id,email,id,id,true from users where id in ('20261007-0000-4000-8000-000000000002','20261007-0000-4000-8000-000000000003');
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values ('20261007-0000-4000-8000-000000000001','SELECTED SELLER','20261007-0000-4000-8000-000000000003',true);
create function pg_temp.payload() returns jsonb language sql as $$ select '{
 "branch_id":"20261007-0000-4000-8000-000000000001","primary_name":"Synthetic Persistence Client","primary_phone":"9100700001","billing_phone":"9100700002",
 "proposed_client_id":"20261007-0000-4000-8000-000000000004","proposed_timeline_id":"20261007-0000-4000-8000-000000000005",
 "event_date":"2026-10-07T10:00:00+05:30","crm_name":"Audit Actor","salesperson":"Selected Seller","visit_status":"YES","did_buy":true,
 "seen_categories":["Ring"],"bought_categories":["Chain"],"order_categories":["Pendant"],"other_order":"YES",
 "occupation":"Business","communication_preference":"CALL","companions":[{"name":"Synthetic Companion","mobile":"9100700003","relation":"Sibling"}],
 "category_details":{"seen_count":"1","seen_tags":["TAG-1"]},
 "engagement":{"instagram":{"asked":false,"no_reason":"Already following"}},
 "additional_fields":{"visit_status":"YES","salesperson":"Selected Seller","engagement_answers":{"instagram":"CLIENT_ALREADY_FOLLOWING_US"},"gift":"Flowers"}
 }'::jsonb $$;
grant execute on function pg_temp.payload() to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20261007-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.path','/rpc/submit_walkin_visit',true);
select lives_ok($$select * from submit_walkin_visit(pg_temp.payload())$$,'complete visit persists');
reset role;
select is((select billing_phone from clients where client_id='20261007-0000-4000-8000-000000000004'),'919100700002','new client billing phone persists (stored with its country code, 20261007001100)');
select is((select last_salesperson_id from clients where client_id='20261007-0000-4000-8000-000000000004'),'20261007-0000-4000-8000-000000000003'::uuid,'selected salesperson differs from audit actor');
select is((select last_buy_status::text from clients where client_id='20261007-0000-4000-8000-000000000004'),'YES_AND_ORDER_PLACED','purchase plus order preserved');
select is((select total_purchase_visits from clients where client_id='20261007-0000-4000-8000-000000000004'),1,'purchase counted');
select is((select total_order_visits from clients where client_id='20261007-0000-4000-8000-000000000004'),1,'additional order counted');
select is((select instagram_status from clients where client_id='20261007-0000-4000-8000-000000000004'),'CLIENT_ALREADY_FOLLOWING_US','exact engagement answer projected');
select is((select additional_fields->'submitted_fields'->>'billing_phone' from visit_forms where client_timeline_id='20261007-0000-4000-8000-000000000005'),'9100700002','complete submitted snapshot retained');
select is((select category_details->'seen_tags' from visit_forms where client_timeline_id='20261007-0000-4000-8000-000000000005'),'["TAG-1"]'::jsonb,'product tag retained');
select is((select last_seen_categories from clients where client_id='20261007-0000-4000-8000-000000000004'),array['Ring'],'seen categories projected');
select is((select count(*)::int from crm_private.audit_logs where action='crm.submit_walkin_visit' and record_id='20261007-0000-4000-8000-000000000005'),1,'audited visit');
set local role authenticated;
select throws_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"proposed_timeline_id":"20261007-0000-4000-8000-000000000006","salesperson":"Unknown Seller"}'::jsonb)$$,'23514',null,'unknown salesperson rejected');
select throws_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"proposed_timeline_id":"20261007-0000-4000-8000-000000000006","documents":[{"storage_path":"20261007-0000-4000-8000-000000000004/20261007-0000-4000-8000-000000000006/20261007-0000-4000-8000-000000000007_missing.jpg","file_name":"missing.jpg","mime_type":"image/jpeg","purpose":"instagram"}]}'::jsonb)$$,'23514',null,'missing Storage object rejected atomically');
select set_config('request.jwt.claim.sub','20261007-0000-4000-8000-000000000003',true);
select throws_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"branch_id":"20261007-0000-4000-8000-000000000099"}'::jsonb)$$,'42501',null,'cross branch rejected');
reset role;
select is((select count(*)::int from client_timeline where client_id='20261007-0000-4000-8000-000000000004'),1,'invalid submissions leave no partial visit');
-- Every base outcome, then each purchase/order upsale, through the real RPC.
create temp table outcome_cases(status text,choice text,expected text);
insert into outcome_cases values
('NO','','NO'),('STORE_VISIT','','STORE_VISIT'),('PRICE_CALCULATION','','PRICE_CALCULATION'),
('REPAIR_PLACED','','REPAIR_PLACED'),('REPAIR_PICKUP','','REPAIR_PICKUP'),('ORDER_PLACED','','ORDER_PLACED'),('ORDER_PICKUP','','ORDER_PICKUP'),
('PRODUCT_RETURN','','PRODUCT_RETURN'),('PRODUCT_EXCHANGE','','PRODUCT_EXCHANGE'),
('REPAIR_PLACED','BUYING_NEW_PRODUCT','REPAIR_PLACED_AND_BUYING_NEW_PRODUCT'),
('REPAIR_PICKUP','BUYING_NEW_PRODUCT','REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT'),
('ORDER_PLACED','BUYING_NEW_PRODUCT','ORDER_PLACED_AND_BUYING_NEW_PRODUCT'),
('ORDER_PICKUP','BUYING_NEW_PRODUCT','ORDER_PICKUP_AND_BUYING_NEW_PRODUCT'),
('REPAIR_PLACED','MAKING_NEW_ORDER','REPAIR_PLACED_AND_MAKING_NEW_ORDER'),
('REPAIR_PICKUP','MAKING_NEW_ORDER','REPAIR_PICKUP_AND_MAKING_NEW_ORDER'),
('ORDER_PLACED','MAKING_NEW_ORDER','ORDER_PLACED_AND_MAKING_NEW_ORDER'),
('ORDER_PICKUP','MAKING_NEW_ORDER','ORDER_PICKUP_AND_MAKING_NEW_ORDER');
grant select on outcome_cases to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20261007-0000-4000-8000-000000000002',true);
select lives_ok(format($q$select * from submit_walkin_visit(pg_temp.payload() || jsonb_build_object('proposed_timeline_id',gen_random_uuid(),'visit_status',%L,'other_order','NO','category_details',jsonb_build_object('new_things_choice',%L),'additional_fields',jsonb_build_object('new_things_categories',jsonb_build_array('New Ring'))))$q$,status,choice),'outcome ' || expected) from outcome_cases;
reset role;
select is((select total_purchase_visits from clients where client_id='20261007-0000-4000-8000-000000000004'),5,'four purchase upsales plus first purchase counted');
select is((select count(*)::int from client_timeline where client_id='20261007-0000-4000-8000-000000000004' and buy_status::text like '%_AND_BUYING_NEW_PRODUCT' and 'New Ring'=any(bought_categories)),4,'upsale purchased categories stored');
-- Test actual Storage metadata linkage, including testimonial video.
insert into storage.objects(bucket_id,name,owner_id,metadata) values
('crm-documents','20261007-0000-4000-8000-000000000004/20261007-0000-4000-8000-000000000020/20261007-0000-4000-8000-000000000021_testimonial.mov','20261007-0000-4000-8000-000000000002','{"mimetype":"video/quicktime","size":1024}');
set local role authenticated;
select lives_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"proposed_timeline_id":"20261007-0000-4000-8000-000000000020","documents":[{"storage_path":"20261007-0000-4000-8000-000000000004/20261007-0000-4000-8000-000000000020/20261007-0000-4000-8000-000000000021_testimonial.mov","file_name":"testimonial.mov","mime_type":"video/quicktime","purpose":"testimonial"}]}'::jsonb)$$,'uploaded testimonial metadata accepted');
reset role;
select is((select testimonial_proof_url from visit_forms where client_timeline_id='20261007-0000-4000-8000-000000000020'),'20261007-0000-4000-8000-000000000004/20261007-0000-4000-8000-000000000020/20261007-0000-4000-8000-000000000021_testimonial.mov','video proof is linked to its question');
select is((select count(*)::int from documents where client_timeline_id='20261007-0000-4000-8000-000000000020'),1,'media document persists');
set local role authenticated;
select lives_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"proposed_timeline_id":"20261007-0000-4000-8000-000000000029","event_date":"2026-10-08T10:00:00+05:30","additional_fields":{"engagement_answers":{"instagram":"YES","google_review":"ALREADY_DONE","testimonial":"YES","referrals":"YES"}}}'::jsonb)$$,'known engagement answers persist before minimal visit');
select lives_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"proposed_timeline_id":"20261007-0000-4000-8000-000000000030","event_date":"2026-10-09T10:00:00+05:30","visit_status":"STORE_VISIT","engagement":{},"additional_fields":{"engagement_answers":{"instagram":"","google_review":"","testimonial":"","referrals":""}}}'::jsonb)$$,'minimal visit without engagement persists');
reset role;
select is((select instagram_status from clients where client_id='20261007-0000-4000-8000-000000000004'),'YES','unanswered minimal visit preserves Instagram status');
select is((select google_review_status from clients where client_id='20261007-0000-4000-8000-000000000004'),'ALREADY_DONE','unanswered minimal visit preserves review status');
set local role authenticated;
select lives_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"proposed_timeline_id":"20261007-0000-4000-8000-000000000031","event_date":"2026-10-01T10:00:00+05:30","additional_fields":{"gift":"Backdated Gift"}}'::jsonb)$$,'backdated gift visit persists');
reset role;
select ok((select gift_history @> '[{"timeline_id":"20261007-0000-4000-8000-000000000031","gift":"Backdated Gift"}]'::jsonb from clients where client_id='20261007-0000-4000-8000-000000000004'),'backdated gift appears in cumulative history');
update visit_forms set additional_fields = jsonb_set(additional_fields,'{gift}','""'::jsonb) where client_timeline_id='20261007-0000-4000-8000-000000000031';
select ok((select not (gift_history @> '[{"timeline_id":"20261007-0000-4000-8000-000000000031"}]'::jsonb) from clients where client_id='20261007-0000-4000-8000-000000000004'),'cleared gift removed only from its own visit history');
set local role authenticated;
select lives_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"proposed_timeline_id":"20261007-0000-4000-8000-000000000032","event_date":"2026-10-10T10:00:00+05:30","additional_fields":{"engagement_answers":{"instagram":"CLIENT_ALREADY_FOLLOWING_US"}}}'::jsonb)$$,'older answered visit');
select lives_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"proposed_timeline_id":"20261007-0000-4000-8000-000000000033","event_date":"2026-10-11T10:00:00+05:30","additional_fields":{"engagement_answers":{"instagram":"YES"}}}'::jsonb)$$,'newer answered visit');
reset role;
update client_timeline set event_date='2026-09-01T10:00:00+05:30' where id='20261007-0000-4000-8000-000000000033';
select is((select instagram_status from clients where client_id='20261007-0000-4000-8000-000000000004'),'CLIENT_ALREADY_FOLLOWING_US','moving visit date recomputes latest answered CRM status');
insert into storage.objects(bucket_id,name,owner_id,metadata) values
('crm-documents','20261007-0000-4000-8000-000000000004/20261007-0000-4000-8000-000000000050/20261007-0000-4000-8000-000000000051_legacy.mov','20261007-0000-4000-8000-000000000002','{"mimetype":"video/quicktime","size":1024}');
set local role authenticated;
select lives_ok($$select * from submit_walkin_visit(pg_temp.payload() || '{"proposed_timeline_id":"20261007-0000-4000-8000-000000000050","documents":[{"storage_path":"20261007-0000-4000-8000-000000000004/20261007-0000-4000-8000-000000000050/20261007-0000-4000-8000-000000000051_legacy.mov","file_name":"legacy.mov","mime_type":"video/quicktime"}]}'::jsonb)$$,'previous client video payload without purpose remains supported');
reset role;
set local role anon;
select throws_ok($$select * from submit_walkin_visit(pg_temp.payload())$$,'42501',null,'anon cannot submit');
reset role;
update users set active=false where id='20261007-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select * from submit_walkin_visit(pg_temp.payload())$$,'42501',null,'inactive actor cannot submit');
reset role;
select * from finish();
rollback;
