begin;
select plan(8);
set search_path = public, extensions;

-- Same helper the migration uses: a strict latin-1 round trip that returns the
-- input untouched whenever either direction fails.
create function pg_temp.repair(p_text text)
returns text language plpgsql immutable as $$
begin
  if p_text is null then return null; end if;
  return convert_from(convert_to(p_text, 'LATIN1'), 'UTF8');
exception when others then
  return p_text;
end;
$$;

-- Reproduces the damage: correct UTF-8 whose bytes were decoded as latin-1.
create function pg_temp.damage(p_text text)
returns text language sql immutable as $$
  select convert_from(convert_to(p_text, 'UTF8'), 'LATIN1')
$$;

select is(pg_temp.repair(pg_temp.damage('⚠️ Important Reminders')), '⚠️ Important Reminders',
  'a mangled warning emoji is recovered exactly');
select is(pg_temp.repair(pg_temp.damage('Accountability Sheet Audit — Verify the sheet')),
  'Accountability Sheet Audit — Verify the sheet',
  'a mangled em dash is recovered exactly');
select is(pg_temp.repair(pg_temp.damage('Check the store’s “opening” list')),
  'Check the store’s “opening” list',
  'mangled curly quotes are recovered exactly');

-- Safe to re-run: repairing an already repaired value must change nothing.
select is(pg_temp.repair(pg_temp.repair(pg_temp.damage('⚠️ Important Reminders'))),
  '⚠️ Important Reminders',
  'repairing an already repaired value changes nothing');

-- Correct text must never be rewritten.
select is(pg_temp.repair('Visit the café for the handover'), 'Visit the café for the handover',
  'legitimate latin-1 text is not mistaken for double-encoded text');
select is(pg_temp.repair('सोना जांचें'), 'सोना जांचें',
  'text outside latin-1 is left untouched');
select is(pg_temp.repair('Account dept required documents help.'), 'Account dept required documents help.',
  'plain ASCII survives unchanged');

-- The migration records what it did.
select is(
  (select count(*)::integer from public.audit_logs
    where action = 'task_text_encoding_repaired' and module = 'maintenance'),
  1,
  'the encoding repair writes exactly one audit record'
);

select * from finish();
rollback;
