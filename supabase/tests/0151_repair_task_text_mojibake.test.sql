begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(4);

select has_function('public', 'repair_known_task_mojibake', array['text'], 'the task-text repair function exists');
select is(
  public.repair_known_task_mojibake(convert_from(decode('5461672050726f66697420c3a2c280c29320542d31', 'hex'), 'UTF8')),
  'Tag Profit ' || U&'\2013' || ' T-1',
  'repairs the exact mojibake en dash shown in the task card'
);
select is(
  public.repair_known_task_mojibake(convert_from(decode('536972c3a2c280c2997320686f757365', 'hex'), 'UTF8')),
  'Sir' || U&'\2019' || 's house',
  'repairs the known mojibake right apostrophe'
);
select is(
  public.repair_known_task_mojibake('M&K ' || U&'\2013' || ' unchanged'),
  'M&K ' || U&'\2013' || ' unchanged',
  'does not alter valid UTF-8 text or ampersands'
);

select * from finish();
rollback;
