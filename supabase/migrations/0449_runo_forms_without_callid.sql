-- 0449: an interaction form without a callId is one call in both Runo sheets.
--
-- The old Runo sheet is now a formula copy of LIVE RUNO 26-11-2026. A form
-- with no callId (21 of 488 in the probe of the new sheet) used the sheet row
-- ("row:<n>") as its reference. The same form sits on a different row in each
-- sheet, so it would be imported twice, and row 5 of one sheet could even
-- overwrite a different form that is row 5 of the other. Such a form is now
-- referenced by its phone (or name) and its interaction time, which are the
-- same in both sheets. Forms with a callId are unchanged.

do $$
declare body text; v_old text; v_new text;
begin
  body := replace(pg_get_functiondef('customer.apply_runo_row(uuid)'::regprocedure), E'\r', '');
  v_old := $q$    'external_ref', v_row.row_key, 'source_row', v_row.id,$q$;
  v_new := $q$    'external_ref', case when v_row.row_key like 'row:%'
      then 'form:' || md5(coalesce(customer.normalize_phone(p ->> 'Mobile Number'), lower(p ->> 'Name'), '') || '|' || extract(epoch from v_at)::bigint)
      else v_row.row_key end, 'source_row', v_row.id,$q$;
  if (length(body) - length(replace(body, v_old, ''))) / length(v_old) <> 1 then raise exception '0449: Runo importer not as expected'; end if;
  execute replace(body, v_old, v_new);
end $$;

-- Forms already imported from the old sheet by row number take the new
-- reference, so the live sheet's copy of the same form finds them. Where two
-- old rows would share a reference (the same form entered twice) both are
-- left as they are.
with candidates as (
  select i.id, i.tenant_id,
         'form:' || md5(coalesce(customer.normalize_phone(r.payload ->> 'Mobile Number'), lower(btrim(r.payload ->> 'Name')), '')
                        || '|' || extract(epoch from i.occurred_at)::bigint) as new_ref
    from customer.interactions i
    join customer.ingest_rows r on r.id = i.source_row and r.source = 'runo' and r.row_key = i.external_ref
   where i.source = 'runo' and i.external_ref like 'row:%'
), unique_refs as (
  select c.* from candidates c
   where (select count(*) from candidates o where o.tenant_id = c.tenant_id and o.new_ref = c.new_ref) = 1
     and not exists (select 1 from customer.interactions x where x.tenant_id = c.tenant_id and x.source = 'runo' and x.external_ref = c.new_ref)
)
update customer.interactions i set external_ref = u.new_ref, updated_at = now()
  from unique_refs u where i.id = u.id;
