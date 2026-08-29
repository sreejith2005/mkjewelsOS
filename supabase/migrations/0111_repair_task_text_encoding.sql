-- Repair task text that was stored as double-encoded UTF-8.
--
-- Imported task text reached the database as UTF-8 bytes that had already been
-- decoded as latin-1 and re-encoded as UTF-8, so "⚠️ Important Reminders" is
-- stored as "â<9a><a0>ï<b8><8f> Important Reminders" and an em dash as "â<80><94>".
-- The Task Templates directory renders it faithfully, which is how it surfaced.
--
-- The corruption is exactly reversible: encoding the stored text back to latin-1
-- recovers the original byte sequence, and decoding those bytes as UTF-8 recovers
-- the original characters. Both steps are strict, which is what makes this safe
-- to run over real data:
--
--   * convert_to(txt,'LATIN1') fails unless every character is U+0000-U+00FF,
--     so anything outside that range (already-correct text) is skipped;
--   * convert_from(bytes,'UTF8') fails unless the recovered bytes are valid
--     UTF-8, so legitimate latin-1 text such as "café" is skipped - its 0xE9
--     byte is not a complete UTF-8 sequence.
--
-- A row is only rewritten when both steps succeed *and* the result differs, so
-- the repair is idempotent and leaves anything ambiguous untouched. The helper
-- lives in pg_temp: it is a one-off and must not become part of the public
-- function surface.
--
-- Root cause is upstream of this database. The current importer decodes
-- workbooks correctly (XLSX.read over an ArrayBuffer), so the most likely origin
-- is a source file that was already mojibake before upload - a UTF-8 CSV opened
-- and re-saved as ANSI. Re-importing such a file would reintroduce the damage;
-- this migration only repairs what is already stored.

set search_path = public, extensions;

create function pg_temp.mojibake_repair(p_text text)
returns text language plpgsql immutable as $$
begin
  if p_text is null then return null; end if;
  return convert_from(convert_to(p_text, 'LATIN1'), 'UTF8');
exception when others then
  -- Not double-encoded, or not reversible: leave the value exactly as stored.
  return p_text;
end;
$$;

do $repair$
declare
  v_template_titles integer := 0;
  v_template_descriptions integer := 0;
  v_template_labels integer := 0;
  v_template_checklists integer := 0;
  v_instance_titles integer := 0;
  v_instance_descriptions integer := 0;
  v_checklist_items integer := 0;
begin
  update public.task_templates
    set title = pg_temp.mojibake_repair(title)
    where title is not null and title <> pg_temp.mojibake_repair(title);
  get diagnostics v_template_titles = row_count;

  update public.task_templates
    set description = pg_temp.mojibake_repair(description)
    where description is not null and description <> pg_temp.mojibake_repair(description);
  get diagnostics v_template_descriptions = row_count;

  update public.task_templates
    set core_task_label = pg_temp.mojibake_repair(core_task_label)
    where core_task_label is not null and core_task_label <> pg_temp.mojibake_repair(core_task_label);
  get diagnostics v_template_labels = row_count;

  -- Checklist items live as a jsonb array on the template; repair item_text in
  -- place and preserve both element order and every other key.
  update public.task_templates t
    set checklist_items = (
      select jsonb_agg(
        case
          when jsonb_typeof(element.item) = 'object' and element.item ? 'item_text'
            then jsonb_set(element.item, '{item_text}',
                   to_jsonb(pg_temp.mojibake_repair(element.item->>'item_text')))
          else element.item
        end
        order by element.position
      )
      from jsonb_array_elements(t.checklist_items) with ordinality as element(item, position)
    )
    where jsonb_typeof(t.checklist_items) = 'array'
      and exists (
        select 1 from jsonb_array_elements(t.checklist_items) as candidate(item)
        where jsonb_typeof(candidate.item) = 'object'
          and candidate.item ? 'item_text'
          and candidate.item->>'item_text'
              <> pg_temp.mojibake_repair(candidate.item->>'item_text')
      );
  get diagnostics v_template_checklists = row_count;

  update public.task_instances
    set title = pg_temp.mojibake_repair(title)
    where title is not null and title <> pg_temp.mojibake_repair(title);
  get diagnostics v_instance_titles = row_count;

  update public.task_instances
    set description = pg_temp.mojibake_repair(description)
    where description is not null and description <> pg_temp.mojibake_repair(description);
  get diagnostics v_instance_descriptions = row_count;

  update public.task_checklists
    set item_text = pg_temp.mojibake_repair(item_text)
    where item_text is not null and item_text <> pg_temp.mojibake_repair(item_text);
  get diagnostics v_checklist_items = row_count;

  insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (null, null, 'task_text_encoding_repaired', 'maintenance', null,
    jsonb_build_object(
      'template_titles', v_template_titles,
      'template_descriptions', v_template_descriptions,
      'template_core_task_labels', v_template_labels,
      'template_checklist_rows', v_template_checklists,
      'instance_titles', v_instance_titles,
      'instance_descriptions', v_instance_descriptions,
      'checklist_items', v_checklist_items,
      'method', 'latin1 round trip, strict, idempotent'
    ));

  raise notice 'Mojibake repair: % template titles, % descriptions, % labels, % checklist rows, % instance titles, % instance descriptions, % checklist items',
    v_template_titles, v_template_descriptions, v_template_labels, v_template_checklists,
    v_instance_titles, v_instance_descriptions, v_checklist_items;
end
$repair$;

notify pgrst, 'reload schema';
