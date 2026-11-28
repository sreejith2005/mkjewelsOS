-- 0450: BUYER / NON BUYER SOFT - the tab that says who is a buyer.
--
-- Owner, 2026-11-28: "this is the main tab that tells whether a customer is a
-- buyer or not. and it also has dates and it also has non buyers."
--
-- Tab of MK CENTRALIZED CLIENT DATABASE_15-09-26, headers on row 1. Read-only
-- probe 2026-11-28: 31,254 rows, CONTACT NUMBER filled and unique on every row.
--   BUYER / NON BUYER   BUYER 8,529 / NON BUYER 22,725
--   CLIENT NAME, SALES PERSON (58 names)
--   TYPE OF CLIENT      LEAD / SILVER / GOLD / DIAMOND / ROCKET
--   FIRST PURCHASE DATE, RECENT PURCHASE DATE, LAST INTERACTION DATE ("05-Jan-2024")
--
-- * Each row is one customer (found or created by number, like the other tabs).
-- * The tab decides buyer or not: a customer it lists as NON BUYER is a lead
--   even when another tab marked them a buyer, unless JewelOS itself holds a
--   purchase (a walk-in or call that says bought). Customers not in the tab
--   keep the rule they had.
-- * The purchase dates fill the customer's first and latest purchase; the
--   earliest and latest of the tab and JewelOS's own purchases are kept.
-- * TYPE OF CLIENT other than LEAD is the ticket size (client_category).
-- * Not scheduled yet: switched on after deploy.

create function customer._patch_0450(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0450: expected % match(es) of "%" in %, found %', p_expected, left(p_old, 80), p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- "05-Jan-2024" -> date (null when it is not that shape or not a real date).
create function customer.parse_day_month_name_year(p text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if btrim(coalesce(p, '')) !~* '^\d{1,2}-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-\d{4}$' then return null; end if;
  return to_date(btrim(p), 'DD-Mon-YYYY');
exception when others then return null;
end $$;

insert into customer.sources (source, source_rank, label) values
  ('master_buyer_soft', 4, 'Buyer / non-buyer list')
on conflict (source) do nothing;

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'runo_call_log', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition', 'exhibition_old', 'customer_data', 'master_sheet',
                      'wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app', 'account_list', 'referral_list', 'contact_list',
                      'buyer_soft'));
insert into customer.source_tables (source, table_name, label, importer, one_time, scheduled) values
  ('master_buyer_soft', 'sheet_centralized_buyer_soft', 'Centralized database: BUYER / NON BUYER SOFT', 'buyer_soft', false, false);

-- ---------------------------------------------------------------------------
-- Importer: the shared centralized-list importer learns the tab.
-- ---------------------------------------------------------------------------
select customer._patch_0450('customer.apply_centralized_list_row(uuid)'::regprocedure,
  $o$v_importer not in ('wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app')$o$,
  $n$v_importer not in ('wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app', 'buyer_soft')$n$, 1);
select customer._patch_0450('customer.apply_centralized_list_row(uuid)'::regprocedure,
  $o$                   customer.parse_date_ordered(coalesce(p ->> 'LAST INTERACTION DATE', p ->> 'Entry Date Time'), 'dmy'),$o$,
  $n$                   customer.parse_date_ordered(coalesce(p ->> 'LAST INTERACTION DATE', p ->> 'Entry Date Time'), 'dmy'),
                   customer.parse_day_month_name_year(p ->> 'LAST INTERACTION DATE')::timestamptz,$n$, 1);
select customer._patch_0450('customer.apply_centralized_list_row(uuid)'::regprocedure,
  $o$      ('chirayu_app', 'Entry Date Time', 'app_signed_up_on')) as m(importer, header, field_key)$o$,
  $n$      ('chirayu_app', 'Entry Date Time', 'app_signed_up_on'),
      ('buyer_soft', 'BUYER / NON BUYER', 'buyer_status'), ('buyer_soft', 'TYPE OF CLIENT', 'client_category'),
      ('buyer_soft', 'SALES PERSON', 'salesperson'), ('buyer_soft', 'FIRST PURCHASE DATE', 'first_purchase_date'),
      ('buyer_soft', 'RECENT PURCHASE DATE', 'recent_purchase_date'), ('buyer_soft', 'LAST INTERACTION DATE', 'last_interaction_date')) as m(importer, header, field_key)$n$, 1);
select customer._patch_0450('customer.apply_centralized_list_row(uuid)'::regprocedure,
  $o$    continue when v_value is null;$o$,
  $n$    -- LEAD is not a ticket size; the tab's dates are kept as dates.
    if v_importer = 'buyer_soft' and f.field_key = 'client_category' and upper(coalesce(v_value, '')) = 'LEAD' then v_value := null; end if;
    if v_importer = 'buyer_soft' and f.field_key in ('first_purchase_date', 'recent_purchase_date', 'last_interaction_date') then
      v_value := to_char(customer.parse_day_month_name_year(v_value), 'YYYY-MM-DD');
    end if;
    continue when v_value is null;$n$, 1);

select customer._patch_0450('public.customer_ingest_apply(text,integer)'::regprocedure,
  $o$        when 'wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app' then$o$,
  $n$        when 'wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app', 'buyer_soft' then$n$, 1);

-- ---------------------------------------------------------------------------
-- Buyer or not, and the purchase dates
-- ---------------------------------------------------------------------------
select customer._patch_0450('customer.refresh_client_stats(uuid)'::regprocedure,
  $o$declare s record; f record; v_marked boolean;$o$,
  $n$declare s record; f record; v_marked boolean; v_soft text; v_soft_first date; v_soft_last date;$n$, 1);
select customer._patch_0450('customer.refresh_client_stats(uuid)'::regprocedure,
  $o$                       where client_id = p_client_id and ((field_key = 'buyer_status' and upper(btrim(value)) in ('BOUGHT', 'BUYER')) or field_key in ('client_category', 'software_group')));$o$,
  $n$                       where client_id = p_client_id and ((field_key = 'buyer_status' and upper(btrim(value)) in ('BOUGHT', 'BUYER')) or field_key in ('client_category', 'software_group')));
  -- BUYER / NON BUYER SOFT is the main word on buyer or not (migration 0450).
  select upper(btrim(value)) into v_soft from customer.client_field_values
   where client_id = p_client_id and source = 'master_buyer_soft' and field_key = 'buyer_status'
   order by observed_at desc, created_at desc limit 1;
  if v_soft in ('BUYER', 'NON BUYER') then v_marked := v_soft = 'BUYER'; end if;
  select min(value::date) filter (where field_key = 'first_purchase_date'), max(value::date) filter (where field_key = 'recent_purchase_date')
    into v_soft_first, v_soft_last
    from customer.client_field_values
   where client_id = p_client_id and source = 'master_buyer_soft' and field_key in ('first_purchase_date', 'recent_purchase_date')
     and value ~ '^\d{4}-\d{2}-\d{2}$';$n$, 1);
select customer._patch_0450('customer.refresh_client_stats(uuid)'::regprocedure,
  $o$         first_purchase_at = s.first_purchase,
         last_purchase_at = s.last_purchase,$o$,
  $n$         first_purchase_at = case when v_marked or s.first_purchase is not null
                                  then least(s.first_purchase, v_soft_first::timestamptz) end,
         last_purchase_at = case when v_marked or s.last_purchase is not null
                                 then greatest(s.last_purchase, v_soft_last::timestamptz) end,$n$, 1);

drop function customer._patch_0450(regprocedure, text, text, integer);
revoke all on function customer.parse_day_month_name_year(text) from public, anon, authenticated;
