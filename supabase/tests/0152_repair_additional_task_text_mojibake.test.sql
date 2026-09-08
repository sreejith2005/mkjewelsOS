begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(3);

select is(
  public.repair_known_task_mojibake(convert_from(decode('4e6f746520c3a2c280c294206e657874', 'hex'), 'UTF8')),
  'Note ' || U&'\2014' || ' next',
  'repairs the known mojibake em dash'
);

select is(
  public.repair_known_task_mojibake(convert_from(decode('c3a2c280c29c51756f7465', 'hex'), 'UTF8')),
  U&'\201C' || 'Quote',
  'repairs the known mojibake opening quotation mark'
);

select is(
  public.repair_known_task_mojibake('M&K ' || U&'\2014' || ' unchanged'),
  'M&K ' || U&'\2014' || ' unchanged',
  'does not alter valid UTF-8 text or ampersands'
);

select * from finish();
rollback;
