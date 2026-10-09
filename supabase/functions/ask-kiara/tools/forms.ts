import {
  type ExecutorContext,
  type SelectFilter,
  type ToolArgs,
  type ToolOutcome,
  argInt,
  argText,
  containsPattern,
  isOutcome,
  localTime,
  nameMap,
  selectByIds,
  selectRows,
  text,
  untrusted,
} from "./shared.ts";

export const MY_SUBMISSIONS_CAP = 10;

/**
 * `search_forms` mirrors the Forms Library: published, active `form_templates`
 * the caller can open (RLS `can_access_form_template`), and the caller's own
 * `form_submissions` (filtered to `submitted_by`). Submission answers (`data`),
 * review notes, and snapshots are never selected; only the form name, status,
 * and dates.
 */
export async function searchForms(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { actor, profileId, timeZone } = context;
  const limit = argInt(args, "limit", 10);
  const needle = argText(args, "text");
  const filters: SelectFilter[] = [
    { op: "eq", column: "lifecycle", value: "published" },
    { op: "eq", column: "is_active", value: true },
  ];
  if (needle) filters.push({ op: "ilike", column: "name", value: containsPattern(needle) });
  const [templates, submissions] = await Promise.all([
    selectRows(actor, "form_templates", { columns: "id,name,description", filters, order: [{ column: "name", ascending: true }], limit: limit + 1 }),
    selectRows(actor, "form_submissions", {
      columns: "form_template_id,status,submitted_at,reviewed_at",
      filters: [{ op: "eq", column: "submitted_by", value: profileId }],
      order: [{ column: "submitted_at", ascending: false }],
      limit: MY_SUBMISSIONS_CAP,
    }),
  ]);
  if (isOutcome(templates)) return templates;
  if (isOutcome(submissions)) return submissions;
  const submittedNames = await selectByIds(actor, "form_templates", "id,name", submissions.map((row) => row.form_template_id as string));
  if (isOutcome(submittedNames)) return submittedNames;
  const formName = nameMap(submittedNames, "name");
  const lowered = needle?.toLocaleLowerCase() ?? null;

  return {
    result: {
      forms_you_can_fill: templates.slice(0, limit).map((row) => ({ form: untrusted(row.name), about: untrusted(row.description, 160) })),
      ...(templates.length > limit ? { truncated: true } : {}),
      your_recent_submissions: submissions
        .map((row) => ({ name: formName.get(row.form_template_id as string) ?? null, row }))
        .filter(({ name }) => !lowered || (name?.toLocaleLowerCase().includes(lowered) ?? false))
        .map(({ name, row }) => ({ form: untrusted(name), review_status: text(row.status), submitted: localTime(row.submitted_at, timeZone), reviewed: localTime(row.reviewed_at, timeZone) })),
      note: "Form answers are never shown here; open the form in Forms Library.",
    },
    isError: false,
  };
}
