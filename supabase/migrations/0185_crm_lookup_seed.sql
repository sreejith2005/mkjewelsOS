-- Original CRM seed data, ported as-is (see 0181 header for provenance).
-- Statements are copied verbatim from the original migrations, schema-qualified to crm:
--   20260727020000_legacy_form_lookup_options  (lookup options)
--   20260731010000_lead_capture                (lead form fields and options)
--   20260731020000_lead_status_first           (lead form display order)
-- The crm.normalize_lookup_label triggers (0183) upper-case labels on insert, which
-- yields the same final labels as the original 20260727040000 normalization.
-- Not ported: the 20260727020000 crm_allocation roster insert. It joins crm.branches by
-- name and is a no-op on the empty crm schema; roster rows arrive with the Phase 5
-- data migration.

INSERT INTO "crm"."lookup_relations" ("label") SELECT unnest(ARRAY['Friend','Husband','Wife','Father','Mother','Son','Daughter','Brother','Sister','Uncle','Aunt','Cousin','Neighbour','Colleague','Business Partner','Other','NA']) ON CONFLICT ("label") DO UPDATE SET "active" = true;
INSERT INTO "crm"."lookup_sugar_options" ("label") SELECT unnest(ARRAY['No Sugar','Low Sugar','Normal Sugar','Extra Sugar','Other:']) ON CONFLICT ("label") DO UPDATE SET "active" = true;
INSERT INTO "crm"."lookup_source_of_leads" ("label") SELECT unnest(ARRAY['Walk-in','Exhibition','Reference','Newspaper Advertisement','Instagram','WhatsApp','From Calling','Poll Banners','ChatGPT','Pinterest','Google Search','Existing Client','Ahmedabad Store','Bandra Store','Zaveri Bazar Store','Andheri Store']) ON CONFLICT ("label") DO UPDATE SET "active" = true;
INSERT INTO "crm"."lookup_not_bought_reasons" ("label") SELECT unnest(ARRAY['Client Will Come With Family','Pricing Issue','Want to See More Designs','Want Ready Piece','Time to Think','Want to See Other Stores','Making Charges Concern','Budget Constraint','Specific Design Requirement','Purchase Planned at Another Branch','Price Enquiry Only','Product Not Available','Store Visit for Price Calculation','Other:','NA']) ON CONFLICT ("label") DO UPDATE SET "active" = true;
INSERT INTO "crm"."lookup_beverages" ("label") SELECT unnest(ARRAY['Tea','Black Tea','Masala Tea','Green Tea','Lemon Tea','Coffee','Black Coffee','Cold Coffee','Apple Juice','Pineapple Juice','Orange Juice','Mosumbi Juice','Coconut Water','Coco Cola','Sprite','NA','Other:']) ON CONFLICT ("label") DO UPDATE SET "active" = true;
INSERT INTO "crm"."lookup_snacks" ("label") SELECT unnest(ARRAY['Sev Puri','Sandwich','Vegetable','Grilled','Aloo Toast','Bhel Puri','Jain','French Fries','Burger','Pizza','Other:','NA']) ON CONFLICT ("label") DO UPDATE SET "active" = true;
INSERT INTO "crm"."lookup_gifts" ("label") SELECT unnest(ARRAY['Diya','Umbrella','Black Pouch','Trolley Bag','Car Perfume','NA','Other:']) ON CONFLICT ("label") DO UPDATE SET "active" = true;
INSERT INTO "crm"."lookup_communities" ("label") SELECT unnest(ARRAY['Agarwal','Bania','Bengali','Bhohra','Brahmin','Buddhist','Christian','Goan Christian','Gujarati','Hindu','Jain','Jat','Jewish','Kannada','Kayastha','Khoja','Malayali','Mangalorean Christian','Marathi','Marwadi','Memon','Muslim','Oswal','Parsi','Pathan','Punjabi','Rajput','Rajasthani','Sikh','Sindhi','South Indian','Tamil','Telugu','Tribal/Adivasi','Other:']) ON CONFLICT ("label") DO UPDATE SET "active" = true;
INSERT INTO "crm"."lookup_product_categories" ("label") SELECT unnest(ARRAY['Bangle Gold','Bracelet Gold','Chain Gold','Diamond Bangles','Diamond Bracelet','Diamond Chains','Diamond Earring','Diamond Mangalsutra','Diamond Necklace Earring','Diamond Necklace Set','Diamond Nosepin','Diamond Pendant','Diamond Pendant Set','Diamond Pendant Set Earring','Diamond Ring','Diamond Tanmaniya','Earrings Gold','Mangalsutra Gold','Necklace Set Gold','Pendant Gold','Pendant Set Earring Gold','Pendant Set Gold','Rings Gold','Set Earring Gold','Set Gold','Silver Ring','Tanmanya Gold','Watch Gold','Gold Coin']) ON CONFLICT ("label") DO UPDATE SET "active" = true;

INSERT INTO "crm"."lead_form_fields" ("field_key","label","field_type","is_mandatory","display_order","is_runo_synced","runo_field_name","option_source") VALUES
('mobile_no','Mobile no','text',true,10,true,'mobile_no',NULL), ('name','Name','text',false,20,true,'name',NULL),
('address','Address','text',false,30,true,'address',NULL), ('country','Country','text',false,40,true,'country',NULL), ('pincode','Pincode','number',false,50,true,'pincode',NULL), ('state','State','text',false,60,true,'state',NULL), ('city','City','text',false,70,true,'city',NULL), ('alternate_name','Alternate name','text',false,80,true,'alternate_name',NULL),
('status','Status','dropdown',true,90,true,'status',NULL), ('source_of_lead','Source of lead','dropdown',true,100,true,'source_of_lead',NULL), ('type_of_calling','Type of calling','dropdown',true,110,true,'type_of_calling',NULL), ('name_of_exhibition','Name of exhibition','text',true,120,true,'name_of_exhibition',NULL), ('exhibition_name','Exhibition name','text',true,130,true,'exhibition_name',NULL), ('invitation_offer_name','Invitation offer name','text',true,140,true,'invitation_offer_name',NULL),
('gender','Gender','dropdown',true,150,true,'gender',NULL), ('date_of_birth','Date of birth','date',false,160,true,'date_of_birth',NULL), ('anniversary_date','Anniversary date','date',true,170,true,'anniversary_date',NULL), ('community_caste','Community / caste','dropdown',false,180,true,'community_caste','lookup_communities'), ('full_address','Full address','text',false,190,false,NULL,NULL), ('google_reviews','Google reviews','dropdown',false,200,false,NULL,NULL), ('testimonial','Testimonial','dropdown',false,210,false,NULL,NULL), ('instagram_followers','Instagram followers','dropdown',false,220,false,NULL,NULL), ('beverages','Beverages','dropdown',false,230,true,'beverages','lookup_beverages'), ('sugar_option','Sugar option','dropdown',false,240,true,'sugar_option','lookup_sugar_options'), ('snack_option','Snack option','dropdown',false,250,true,'snack_option','lookup_snacks'), ('gift_option','Gift option','dropdown',false,260,true,'gift_option','lookup_gifts')
ON CONFLICT ("field_key") DO NOTHING;

INSERT INTO "crm"."lead_form_field_options" ("field_id","option_value","display_order","triggers_field_key")
SELECT f.id, v.value, v.sort, v.trigger FROM "crm"."lead_form_fields" f JOIN (VALUES
('status','LEAD',1,'source_of_lead'),('status','CALLING',2,'type_of_calling'),('status','EXHIBITION',3,'name_of_exhibition'),
('source_of_lead','INSTAGRAM',1,NULL),('source_of_lead','WHATSAPP',2,NULL),('source_of_lead','INCOMING CALL',3,NULL),('source_of_lead','PERSONAL WHATSAPP',4,NULL),('source_of_lead','EXHIBITION',5,'name_of_exhibition'),
('type_of_calling','EXHIBITION CALLING',1,'exhibition_name'),('type_of_calling','INVITATION CALLING',2,'invitation_offer_name'),('type_of_calling','PERSONAL CALLING INVITATION',3,NULL),
('gender','Male',1,NULL),('gender','Female',2,NULL),('google_reviews','Yes',1,NULL),('google_reviews','No',2,NULL),('testimonial','Yes',1,NULL),('instagram_followers','Yes',1,NULL),('instagram_followers','No',2,NULL)
) AS v(key,value,sort,trigger) ON f.field_key=v.key
ON CONFLICT ("field_id","option_value") DO NOTHING;

UPDATE "crm"."lead_form_fields"
SET "display_order" = CASE "field_key"
  WHEN 'status' THEN 25
  WHEN 'source_of_lead' THEN 26
  WHEN 'type_of_calling' THEN 27
  WHEN 'name_of_exhibition' THEN 28
  WHEN 'exhibition_name' THEN 29
  WHEN 'invitation_offer_name' THEN 30
  ELSE "display_order"
END
WHERE "field_key" IN ('status','source_of_lead','type_of_calling','name_of_exhibition','exhibition_name','invitation_offer_name');
