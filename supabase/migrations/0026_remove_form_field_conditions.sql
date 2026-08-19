-- Forms no longer use conditional visibility. Existing questions remain shown
-- according to their own shown flag, without depending on another answer.
update form_fields
set conditional_logic = null
where conditional_logic is not null;
