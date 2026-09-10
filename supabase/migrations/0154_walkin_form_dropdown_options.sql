-- Walk-in form option lists from the CRM walk-in data sheet, added to Dropdown Master.
set search_path = public, extensions;

insert into dropdown_master_categories(tenant_id,category_key,display_name,sort_order,is_system,is_key_locked)
select t.id,v.key,v.name,v.sort_order,true,true from tenants t cross join (values
 ('client_relation','Client Relations',140),
 ('beverage','Beverages',150),
 ('sugar_option','Sugar Options',160),
 ('snack_option','Snack Options',170),
 ('gift_option','Gift Options',180),
 ('high_potential_reason','High Potential Buyer Reasons',190),
 ('caste','Caste / Community',200)
) v(key,name,sort_order) on conflict (tenant_id,category_key) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'client_relation',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('Friend','friend',10),
  ('Husband','husband',20),
  ('Wife','wife',30),
  ('Father','father',40),
  ('Mother','mother',50),
  ('Son','son',60),
  ('Daughter','daughter',70),
  ('Brother','brother',80),
  ('Sister','sister',90),
  ('Uncle','uncle',100),
  ('Aunt','aunt',110),
  ('Cousin','cousin',120),
  ('Neighbour','neighbour',130),
  ('Colleague','colleague',140),
  ('Business Partner','business_partner',150),
  ('Other','other',160),
  ('NA','na',170)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'beverage',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('Tea','tea',10),
  ('Black Tea','black_tea',20),
  ('Masala Tea','masala_tea',30),
  ('Green Tea','green_tea',40),
  ('Lemon Tea','lemon_tea',50),
  ('Coffee','coffee',60),
  ('Black Coffee','black_coffee',70),
  ('Cold Coffee','cold_coffee',80),
  ('Apple Juice','apple_juice',90),
  ('Pineapple Juice','pineapple_juice',100),
  ('Orange Juice','orange_juice',110),
  ('Mosumbi Juice','mosumbi_juice',120),
  ('Coconut Water','coconut_water',130),
  ('Coca Cola','coco_cola',140),
  ('Sprite','sprite',150),
  ('NA','na',160),
  ('Other','other',170)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'sugar_option',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('No Sugar','no_sugar',10),
  ('Low Sugar','low_sugar',20),
  ('Normal Sugar','normal_sugar',30),
  ('Extra Sugar','extra_sugar',40),
  ('Other','other',50),
  ('NA','na',60)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'snack_option',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('Sev Puri','sev_puri',10),
  ('Sandwich','sandwich',20),
  ('Vegetable','vegetable',30),
  ('Grilled','grilled',40),
  ('Aloo Toast','aloo_toast',50),
  ('Bhel Puri','bhel_puri',60),
  ('Jain','jain',70),
  ('French Fries','french_fries',80),
  ('Burger','burger',90),
  ('Pizza','pizza',100),
  ('Other','other',110),
  ('NA','na',120)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'gift_option',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('Diya','diya',10),
  ('Umbrella','umbrella',20),
  ('Black Pouch','black_pouch',30),
  ('Trolley Bag','trolley_bag',40),
  ('Car Perfume','car_perfume',50),
  ('NA','na',60),
  ('Other','other',70)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'high_potential_reason',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('Upcoming Wedding / Engagement','upcoming_wedding_engagement',10),
  ('Shortlisted Products','shortlisted_products',20),
  ('Occasion Date Committed','occasion_date_committed',30),
  ('Budget Confirmed Verbally','budget_confirmed_verbally',40),
  ('Custom / Order Discussion In Progress','custom_order_discussion_in_progress',50),
  ('Coming With Family For Finalisation','coming_with_family_for_finalisation',60),
  ('Other','other',70)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'caste',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('Agarwal','agarwal',10),
  ('Bania','bania',20),
  ('Bengali','bengali',30),
  ('Bhohra','bhohra',40),
  ('Brahmin','brahmin',50),
  ('Buddhist','buddhist',60),
  ('Christian','christian',70),
  ('Goan Christian','goan_christian',80),
  ('Gujarati','gujarati',90),
  ('Hindu','hindu',100),
  ('Jain','jain',110),
  ('Jat','jat',120),
  ('Jewish','jewish',130),
  ('Kannada','kannada',140),
  ('Kayastha','kayastha',150),
  ('Khoja','khoja',160),
  ('Malayali','malayali',170),
  ('Mangalorean Christian','mangalorean_christian',180),
  ('Marathi','marathi',190),
  ('Marwadi','marwadi',200),
  ('Memon','memon',210),
  ('Muslim','muslim',220),
  ('Oswal','oswal',230),
  ('Parsi','parsi',240),
  ('Pathan','pathan',250),
  ('Punjabi','punjabi',260),
  ('Rajput','rajput',270),
  ('Rajasthani','rajasthani',280),
  ('Sikh','sikh',290),
  ('Sindhi','sindhi',300),
  ('South Indian','south_indian',310),
  ('Tamil','tamil',320),
  ('Telugu','telugu',330),
  ('Tribal / Adivasi','tribal_adivasi',340),
  ('Other','other',350)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'product_category',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('Bangle Gold','bangle_gold',10),
  ('Bracelet Gold','bracelet_gold',20),
  ('Chain Gold','chain_gold',30),
  ('Diamond Bangles','diamond_bangles',40),
  ('Diamond Bracelet','diamond_bracelet',50),
  ('Diamond Chains','diamond_chains',60),
  ('Diamond Earring','diamond_earring',70),
  ('Diamond Mangalsutra','diamond_mangalsutra',80),
  ('Diamond Necklace Earring','diamond_necklace_earring',90),
  ('Diamond Necklace Set','diamond_necklace_set',100),
  ('Diamond Nosepin','diamond_nosepin',110),
  ('Diamond Pendant','diamond_pendant',120),
  ('Diamond Pendant Set','diamond_pendant_set',130),
  ('Diamond Pendant Set Earring','diamond_pendant_set_earring',140),
  ('Diamond Ring','diamond_ring',150),
  ('Diamond Tanmaniya','diamond_tanmaniya',160),
  ('Earrings Gold','earrings_gold',170),
  ('Mangalsutra Gold','mangalsutra_gold',180),
  ('Necklace Set Gold','necklace_set_gold',190),
  ('Pendant Gold','pendant_gold',200),
  ('Pendant Set Earring Gold','pendant_set_earring_gold',210),
  ('Pendant Set Gold','pendant_set_gold',220),
  ('Rings Gold','rings_gold',230),
  ('Set Earring Gold','set_earring_gold',240),
  ('Set Gold','set_gold',250),
  ('Silver Ring','silver_ring',260),
  ('Tanmanya Gold','tanmanya_gold',270),
  ('Watch Gold','watch_gold',280),
  ('Gold Coin','gold_coin',290)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'not_bought_reason',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('Client Will Come With Family','client_will_come_with_family',10),
  ('Pricing Issue','pricing_issue',20),
  ('Want To See More Designs','want_to_see_more_designs',30),
  ('Want Ready Piece','want_ready_piece',40),
  ('Time To Think','time_to_think',50),
  ('Want To See Other Stores','want_to_see_other_stores',60),
  ('Making Charges Concern','making_charges_concern',70),
  ('Budget Constraint','budget_constraint',80),
  ('Specific Design Requirement','specific_design_requirement',90),
  ('Purchase Planned At Another Branch','purchase_planned_at_another_branch',100),
  ('Price Enquiry Only','price_enquiry_only',110),
  ('Product Not Available','product_not_available',120),
  ('Store Visit For Price Calculation','store_visit_for_price_calculation',130),
  ('Other','other',140),
  ('NA','na',150)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'crm_source',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('Walk-in','walk_in',10),
  ('Exhibition','exhibition',20),
  ('Reference','reference',30),
  ('Newspaper Advertisment','newspaper_advertisment',40),
  ('Instagram','instagram',50),
  ('WhatsApp','whatsapp',60),
  ('From Calling','from_calling',70),
  ('Poll Banners','poll_banners',80),
  ('ChatGPT','chat_gpt',90),
  ('Pinterest','pinterest',100),
  ('Google Search','google_search',110),
  ('Existing Client','existing_client',120),
  ('Ahmedabad Store','ahmedabad_store',130),
  ('Bandra Store','bandra_store',140),
  ('Zaveri Bazar Store','zaveri_bazar_store',150),
  ('Andheri Store','andheri_store',160)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'potential_category',v.label,v.value,v.sort_order,true from tenants t cross join (values
  ('⭐⭐⭐⭐ Hot Lead','hot_lead',10),
  ('⭐⭐⭐ Warm Lead','warm_lead',20),
  ('⭐⭐ Cool Lead','cool_lead',30),
  ('⭐ Not A Potential Buyer','not_a_potential_buyer',40),
  ('NA','na',50)
) v(label,value,sort_order) on conflict (tenant_id,master_type,value) do nothing;

notify pgrst,'reload schema';
