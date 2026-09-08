begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(2);

select is(
  public.repair_known_task_mojibake(convert_from(decode('51756f7465c3a2c280c29d', 'hex'), 'UTF8')),
  'Quote' || U&'\201D',
  'repairs the known mojibake closing quotation mark'
);

select is(
  public.repair_known_task_mojibake('M&K ' || U&'\201D' || ' unchanged'),
  'M&K ' || U&'\201D' || ' unchanged',
  'does not alter valid UTF-8 text or ampersands'
);

select * from finish();
rollback;
