import { supabase } from "@jewelos/api-client";
import { groupTaskFeedRows, type Database, type Enums, type Json, type Tables } from "@jewelos/core";
import { loadMasterOptions } from "@/features/dropdowns/api";

export type TaskFeedRow = Database["public"]["Views"]["v_all_tasks"]["Row"];
export type TaskUser = Pick<Tables<"user_profiles">,
  "id" | "tenant_id" | "branch_id" | "department_id" | "employee_code" | "employee_name" |
  "first_name" | "last_name" | "user_role" | "working_status" | "buddy_id" | "secondary_buddy_id" | "reports_to_user_id">;
export type TaskChecklist = Tables<"task_checklists">;
export type TaskTemplate = Tables<"task_templates">;
export type AvailabilityStatus = Enums<"availability_status">;
export type AvailabilityEntry = Pick<Tables<"user_availability">, "user_profile_id" | "date" | "status" | "reason">;

export type TaskBundle = TaskFeedRow & {
  assignees: Array<{ id: string; name: string }>;
  assigneeName: string;
  checklists: TaskChecklist[];
  hasAttachment: boolean;
  hasFormSubmission: boolean;
  isWatchedByViewer: boolean;
};

export type TaskReferenceData = {
  branches: Array<Pick<Tables<"branches">, "id" | "name">>;
  categories: Array<Pick<Tables<"dropdown_masters">, "id" | "label">>;
  priorities: Array<Pick<Tables<"dropdown_masters">, "id" | "label" | "value">>;
  departments: Array<Pick<Tables<"departments">, "id" | "name" | "branch_id">>;
  forms: Array<Pick<Tables<"form_templates">, "id" | "name">>;
  templates: TaskTemplate[];
  users: TaskUser[];
};
export type TaskFeedReferenceData = Pick<TaskReferenceData, "categories">;

function fail(message: string, error: { message: string } | null): asserts error is null {
  if (error) throw new Error(`${message}: ${error.message}`);
}

export async function loadTaskCategoryOptions(): Promise<TaskReferenceData["categories"]> {
  return (await loadMasterOptions(["task_category"])).map(({ id, label }) => ({ id, label }));
}

export async function loadTaskFeedReferenceData(): Promise<TaskFeedReferenceData> {
  return { categories: await loadTaskCategoryOptions() };
}

export async function loadAvailabilityUsers(): Promise<TaskUser[]> {
  const result = await supabase.from("user_profiles")
    .select("id,tenant_id,branch_id,department_id,employee_code,employee_name,first_name,last_name,user_role,working_status,buddy_id,secondary_buddy_id,reports_to_user_id")
    .in("account_status", ["active", "invited"])
    .eq("working_status", "active")
    .order("first_name")
    .order("last_name");
  fail("Load availability users", result.error);
  return result.data.map((user) => ({
    ...user,
    employee_name: [user.first_name, user.last_name].filter((name): name is string => Boolean(name?.trim())).join(" ") || user.employee_name,
  }));
}

export async function loadAvailabilityForDate(date: string): Promise<AvailabilityEntry[]> {
  const result = await supabase.from("user_availability")
    .select("user_profile_id,date,status,reason")
    .eq("date", date);
  fail("Load availability", result.error);
  return result.data;
}

export async function loadTaskAuthoringReferenceData(): Promise<TaskReferenceData> {
  const [users, branchesResult, departmentsResult, categories, priorities, templatesResult, formsResult] = await Promise.all([
    loadAvailabilityUsers(),
    supabase.from("branches").select("id,name").eq("is_active", true).order("name"),
    supabase.from("departments").select("id,name,branch_id").eq("is_active", true).order("name"),
    loadTaskCategoryOptions(),
    loadMasterOptions(["task_priority"]),
    supabase.from("task_templates").select("*").eq("task_type", "checklist").order("created_at", { ascending: false }),
    supabase.from("form_templates").select("id,name").eq("is_active", true).order("name"),
  ]);
  fail("Load branches", branchesResult.error);
  fail("Load departments", departmentsResult.error);
  fail("Load templates", templatesResult.error);
  fail("Load forms", formsResult.error);
  return {
    users,
    branches: branchesResult.data,
    categories,
    priorities: priorities.map(({ id, label, value }) => ({ id, label, value })),
    departments: departmentsResult.data,
    templates: templatesResult.data,
    forms: formsResult.data,
  };
}

/** @deprecated Use the bounded loaders for each task surface. */
export const loadTaskReferenceData = loadTaskAuthoringReferenceData;

export async function loadTaskFeed(
  viewerId: string,
  startIso: string,
  endIso: string,
  options: { delegated?: boolean; includeBlockedCoverage?: boolean } = {},
): Promise<TaskBundle[]> {
  const watcherPromise = supabase.from("task_watchers")
    .select("task_instance_id")
    .eq("user_profile_id", viewerId);
  const usersPromise = supabase.from("v_task_users").select("id,employee_name");
  let rows: TaskFeedRow[] = [];
  let watcherRows: Array<{ task_instance_id: string }> = [];
  let users: Array<{ employee_name: string | null; id: string | null }> = [];

  if (options.delegated) {
    const [taskResult, watcherResult, usersResult] = await Promise.all([
      supabase.from("v_all_tasks").select("*")
        .gte("planned_datetime", startIso)
        .lte("planned_datetime", endIso)
        .eq("created_by", viewerId)
        .eq("task_type", "delegation")
        .order("planned_datetime", { ascending: true }),
      watcherPromise,
      usersPromise,
    ]);
    fail("Load delegated tasks", taskResult.error);
    fail("Load task watchers", watcherResult.error);
    fail("Load task users", usersResult.error);
    rows = taskResult.data;
    watcherRows = watcherResult.data;
    users = usersResult.data;
  } else {
    const [assignedResult, watcherResult, coverageResult, usersResult] = await Promise.all([
      supabase.from("v_all_tasks").select("*")
        .gte("planned_datetime", startIso)
        .lte("planned_datetime", endIso)
        .eq("assignee_id", viewerId)
        .order("planned_datetime", { ascending: true }),
      watcherPromise,
      options.includeBlockedCoverage
        ? supabase.from("v_all_tasks").select("*")
          .gte("planned_datetime", startIso)
          .lte("planned_datetime", endIso)
          .eq("status", "blocked")
          .is("assignee_id", null)
          .order("planned_datetime", { ascending: true })
        : Promise.resolve({ data: [] as TaskFeedRow[], error: null }),
      usersPromise,
    ]);
    fail("Load assigned tasks", assignedResult.error);
    fail("Load task watchers", watcherResult.error);
    fail("Load coverage tasks", coverageResult.error);
    fail("Load task users", usersResult.error);
    watcherRows = watcherResult.data;
    users = usersResult.data;
    const visibleTaskIds = [...new Set([
      ...assignedResult.data.flatMap((row) => row.id ? [row.id] : []),
      ...watcherRows.map((row) => row.task_instance_id),
    ])];
    const visibleTasksResult = visibleTaskIds.length
      ? await supabase.from("v_all_tasks").select("*")
        .gte("planned_datetime", startIso)
        .lte("planned_datetime", endIso)
        .in("id", visibleTaskIds)
        .order("planned_datetime", { ascending: true })
      : { data: [] as TaskFeedRow[], error: null };
    fail("Load assigned and watched task details", visibleTasksResult.error);
    rows = [...visibleTasksResult.data, ...coverageResult.data];
  }

  const groupedRows = groupTaskFeedRows(rows);
  const watchedTaskIds = new Set(watcherRows.map((row) => row.task_instance_id));
  const taskIds = groupedRows.flatMap(({ row }) => row.id ? [row.id] : []);
  const [checklistsResult, attachmentsResult, submissionsResult] = taskIds.length
    ? await Promise.all([
      supabase.from("task_checklists").select("*").in("task_instance_id", taskIds).order("sort_order"),
      supabase.from("task_attachments").select("task_instance_id").in("task_instance_id", taskIds),
      supabase.from("form_submissions").select("linked_record_id,linked_module,form_template_id").in("linked_record_id", taskIds),
    ])
    : [
      { data: [] as TaskChecklist[], error: null },
      { data: [] as Array<{ task_instance_id: string }>, error: null },
      { data: [] as Array<{ form_template_id: string; linked_module: string | null; linked_record_id: string | null }>, error: null },
    ];
  fail("Load task checklists", checklistsResult.error);
  fail("Load task attachments", attachmentsResult.error);
  fail("Load task form submissions", submissionsResult.error);
  const checklistsByTask = new Map<string, TaskChecklist[]>();
  for (const item of checklistsResult.data) {
    const list = checklistsByTask.get(item.task_instance_id) ?? [];
    list.push(item);
    checklistsByTask.set(item.task_instance_id, list);
  }
  const userNames = new Map(users.map((user) => [user.id, user.employee_name]));
  const attachedTasks = new Set(attachmentsResult.data.map((row) => row.task_instance_id));
  const matchingSubmissions = new Set(submissionsResult.data.flatMap((row) =>
    row.linked_record_id && row.linked_module
      ? [`${row.linked_record_id}|${row.linked_module}|${row.form_template_id}`]
      : []));
  return groupedRows.map(({ assigneeIds, row }) => {
    const assignees = assigneeIds.map((id) => ({ id, name: userNames.get(id) ?? "Assigned user" }));
    return {
      ...row,
      assignees,
      assigneeName: assignees.length ? assignees.map((assignee) => assignee.name).join(", ") : "Unassigned",
      checklists: row.id ? checklistsByTask.get(row.id) ?? [] : [],
      hasAttachment: row.id ? attachedTasks.has(row.id) : false,
      hasFormSubmission: row.id && row.form_template_id && row.task_type
        ? matchingSubmissions.has(`${row.id}|${row.task_type === "delegation" ? "delegation_task" : "checklist_task"}|${row.form_template_id}`)
      : false,
      isWatchedByViewer: Boolean(row.id && watchedTaskIds.has(row.id) && !assigneeIds.includes(viewerId)),
    };
  });
}

export async function createDelegationTask(
  payload: Json,
  doerIds: string[],
  watcherIds: string[],
  checklist: Json,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_delegation_task_with_audit", {
    p_payload: payload,
    p_doer_ids: doerIds,
    p_watcher_ids: watcherIds,
    p_checklist: checklist,
  });
  fail("Create delegation task", error);
  if (!data) throw new Error("Task creation did not return an identifier");
  return data;
}

export async function saveTaskTemplate(templateId: string | null, payload: Json): Promise<void> {
  const { error } = await supabase.rpc("save_task_template_with_audit", {
    p_template_id: templateId as string,
    p_payload: payload,
  });
  fail("Save task template", error);
}

export async function createFromTemplate(templateId: string, plannedDatetime: string): Promise<void> {
  const { error } = await supabase.rpc("use_task_template_with_audit", {
    p_template_id: templateId,
    p_planned_datetime: plannedDatetime,
  });
  fail("Create task from template", error);
}

export async function updateTask(
  taskId: string,
  action: "start" | "checklist" | "complete",
  options: { checklistId?: string; completed?: boolean; remark?: string } = {},
): Promise<void> {
  const { error } = await supabase.rpc("update_task_with_audit", {
    p_task_id: taskId,
    p_action: action,
    ...(options.checklistId ? { p_checklist_id: options.checklistId } : {}),
    ...(options.completed !== undefined ? { p_completed: options.completed } : {}),
    ...(options.remark ? { p_remark: options.remark } : {}),
  });
  fail("Update task", error);
}

export async function delegateTask(taskId: string, fromUserId: string, toUserId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("delegate_task_with_audit", {
    p_task_id: taskId,
    p_from_user_id: fromUserId,
    p_to_user_id: toUserId,
    p_reason: reason,
  });
  fail("Delegate task", error);
}

export async function reviseTask(taskId: string, revisedDatetime: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("revise_task_datetime_with_audit", {
    p_task_id: taskId,
    p_revised_datetime: revisedDatetime,
    p_reason: reason,
  });
  fail("Revise task date", error);
}

export async function uploadTaskAttachment(
  tenantId: string,
  taskId: string,
  file: File,
): Promise<void> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${tenantId}/${taskId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from("task-attachments").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  fail("Upload task attachment", uploadError);
  const { error } = await supabase.rpc("add_task_attachment_with_audit", {
    p_task_id: taskId,
    p_file_url: path,
  });
  if (error) {
    try {
      await supabase.storage.from("task-attachments").remove([path]);
    } catch {
      // The original transactional database error is the UI contract even if
      // best-effort orphan cleanup cannot reach Storage.
    }
    throw new Error(error.message);
  }
}

export async function recordAvailability(
  userProfileId: string,
  date: string,
  status: AvailabilityStatus,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("record_availability_with_audit", {
    p_user_profile_id: userProfileId,
    p_date: date,
    p_status: status,
    p_reason: reason,
  });
  fail("Record availability", error);
}

export async function recordAvailabilityRange(
  userProfileId: string,
  startDate: string,
  endDate: string,
  status: AvailabilityStatus,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("record_availability_range_with_audit", {
    p_user_profile_id: userProfileId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_status: status,
    p_reason: reason,
  });
  fail("Record availability range", error);
}
