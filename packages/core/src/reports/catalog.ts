import type { ReportCategory, ReportColumn, ReportColumnFormat, ReportDefinition } from "./types.ts";
import type { UserRole } from "../roleMenu.ts";

const ALL: readonly UserRole[] = ["super_admin","admin","manager","hr","crm","staff","doer","housekeeping"];
const OPS: readonly UserRole[] = ["super_admin","admin","manager","staff","doer","housekeeping","crm"];
const PEOPLE: readonly UserRole[] = ["super_admin","admin","manager","hr"];
const ADMIN: readonly UserRole[] = ["super_admin","admin"];
const FORMS: readonly UserRole[] = ["super_admin","admin","manager","crm","staff"];
const c = (key: string, label: string, sensitive = false): ReportColumn => ({ key, label, ...(sensitive ? { sensitive: true } : {}) });
/** A business column with a display/export format. */
const col = (key: string, label: string, format?: ReportColumnFormat, sensitive = false): ReportColumn =>
  ({ key, label, ...(format ? { format } : {}), ...(sensitive ? { sensitive: true } : {}) });
const report = (definition: ReportDefinition) => definition;
const legacy = (definition: ReportDefinition): ReportDefinition => ({ ...definition, category: "legacy", source: "jewelos" });

const PAGE = ["page","page_size"] as const;

/*
 * Business Reports 2.0 (2026-11-02). Visible reports are grouped by category. Older keys
 * stay in the catalogue as "legacy": their past exports keep their names in the export
 * list and Ask Kiara keeps using them, but they are not offered on the Reports page.
 */
export const REPORT_CATALOG: readonly ReportDefinition[] = [
  // ---------------------------------------------------------------- Customers & CRM
  // ---------------------------------------------------------------- Forms, FMS and tasks
  report({key:"form_answers",category:"operations",source:"jewelos",name:"All Form Submissions",
    description:"Every submitted form (standalone, task and FMS) with its answers. Choose one form to get one column per question.",
    roles:FORMS,filters:["from","to","form_family_id","branch_id","department_id","status","user_profile_id","search",...PAGE],dateLabel:"Submitted",
    columns:[col("form_name","Form"),col("form_version","Version","number"),col("submitted_at","Submitted","instant"),col("submitted_by_name","Submitted by",undefined,true),
      col("branch_name","Branch"),col("linked_to","Linked FMS / task"),col("workflow_name","Workflow"),col("stage_name","Stage"),col("status","Status","status"),
      col("answers","Answers",undefined,true)],
    defaultSort:"submitted desc",maxDateRangeDays:366,exportEligible:true,
    notes:["Answers use the exact form version that was filled in. Questions that did not exist or were hidden by a condition are blank.","Attachments show their file names only."]}),
  report({key:"fms_workflow_summary",category:"operations",source:"jewelos",family:"fms_journey",variantLabel:"Workflow summary",name:"FMS Workflow Journey",
    description:"One row per FMS run from its starting form to its final outcome.",
    roles:OPS,filters:["from","to","flow_family_id","branch_id","department_id","status","user_profile_id","search",...PAGE],dateLabel:"Started",
    columns:[col("reference_number","FMS reference"),col("workflow_name","Workflow"),col("started_at","Started","instant"),col("record_name","Customer / record",undefined,true),
      col("started_by_name","Started by"),col("first_assignee","First assigned to"),col("current_stage","Current stage"),col("current_assignee","Current assignee"),
      col("status","Status","status"),col("next_due","Next due","instant"),col("final_outcome","Final outcome","status"),col("end_stage","End step"),
      col("completed_at","Closed","instant"),col("stage_visits","Stage visits","number")],
    summary:[{key:"workflows",label:"Workflows"},{key:"running",label:"Running"},{key:"overdue",label:"Overdue"},{key:"completed",label:"Completed"},{key:"won",label:"Won"},{key:"lost",label:"Lost"}],
    defaultSort:"started desc",maxDateRangeDays:366,exportEligible:true,
    notes:["Built from the steps that actually ran, so branches and loops show as they happened."]}),
  report({key:"fms_stage_visits",category:"operations",source:"jewelos",family:"fms_journey",variantLabel:"Stage-wise detail",name:"FMS Workflow Journey",
    description:"One row per executed stage visit, with the form answers given at that step.",
    roles:OPS,filters:["from","to","flow_family_id","stage_key","branch_id","department_id","status","user_profile_id","search",...PAGE],dateLabel:"Stage started",
    columns:[col("reference_number","FMS reference"),col("workflow_name","Workflow"),col("record_name","Customer / record",undefined,true),col("stage_name","Stage"),
      col("visit_number","Visit","number"),col("assigned_to","Assigned to"),col("planned_datetime","Planned","instant"),col("actual_datetime","Completed","instant"),
      col("status","Stage status","status"),col("completed_by_name","Completed by"),col("form_name","Form"),col("form_filled","Form filled","boolean"),
      col("answers","Submitted answers",undefined,true),col("next_steps","Next step (assigned)"),col("timing","Timing","status"),col("delay_minutes","Delay","minutes"),
      col("final_outcome","Final outcome","status")],
    summary:[{key:"visits",label:"Stage visits"},{key:"completed",label:"Completed"},{key:"overdue",label:"Overdue"},{key:"on_time",label:"On time"},{key:"delayed",label:"Delayed"}],
    defaultSort:"reference, then time",maxDateRangeDays:366,exportEligible:true,
    notes:["A repeated stage is a new row with its visit number. Skipped and stopped steps are shown as such, never as completed.","Managers see submitted answers; others see answers they submitted."]}),
  report({key:"fms_stage_performance",category:"operations",source:"jewelos",name:"FMS Stage Performance",
    description:"Per stage: how many visits ran, finished on time, are late, and how long they took.",
    roles:OPS,filters:["from","to","flow_family_id","stage_key","branch_id","department_id","user_profile_id",...PAGE],dateLabel:"Stage started",
    columns:[col("workflow_name","Workflow"),col("stage_name","Stage"),col("visits","Visits","number"),col("completed","Completed","number"),col("open_not_late","Open, not late","number"),
      col("overdue","Overdue","number"),col("on_time","On time","number"),col("delayed","Delayed","number"),col("on_time_rate","On-time %","percent"),
      col("average_delay_minutes","Average delay","minutes"),col("average_hours_to_complete","Average hours to complete","hours")],
    defaultSort:"workflow, stage",maxDateRangeDays:366,exportEligible:true,
    notes:["On-time % = on-time completions ÷ completions that had a deadline. Skipped and stopped steps are left out."]}),
  report({key:"work_register",category:"operations",source:"jewelos",name:"Pending and Completed Tasks",
    description:"Regular tasks and FMS steps due in the period, with their status, timing and delay.",
    roles:OPS,filters:["from","to","work_kind","flow_family_id","branch_id","department_id","status","user_profile_id","search",...PAGE],dateLabel:"Due",
    columns:[col("title","Task"),col("work_type","Type"),col("workflow_name","FMS"),col("stage_name","Stage"),col("assignee_name","Assigned to",undefined,true),
      col("branch_name","Branch"),col("planned_datetime","Due","instant"),col("actual_datetime","Completed","instant"),col("status","Status","status"),
      col("priority","Priority","status"),col("timing","Timing","status"),col("delay_minutes","Delay","minutes"),col("verification","Verification","status")],
    summary:[{key:"work",label:"Tasks"},{key:"completed",label:"Completed"},{key:"open",label:"Open"},{key:"overdue",label:"Overdue"},{key:"on_time",label:"On time"},{key:"delayed",label:"Delayed"}],
    defaultSort:"due asc",maxDateRangeDays:180,exportEligible:true,
    notes:["Due is the revised deadline when one was set. Delay = completed time minus due time."]}),

  // ---------------------------------------------------------------- Employee performance
  report({key:"employee_task_performance",category:"people",source:"jewelos",name:"Employee Task Performance",
    description:"Per employee: work due in the period, completed, pending, overdue and on-time, for tasks and FMS steps.",
    roles:PEOPLE,filters:["from","to","work_kind","branch_id","department_id","user_profile_id",...PAGE],dateLabel:"Due",
    columns:[col("employee_name","Employee",undefined,true),col("branch_name","Branch"),col("department_name","Department"),col("assigned","Assigned","number"),
      col("completed","Completed","number"),col("pending","Pending","number"),col("overdue","Overdue","number"),col("on_time_completed","On-time completed","number"),
      col("delayed_completed","Delayed completed","number"),col("completion_rate","Completion %","percent"),col("on_time_rate","On-time %","percent"),
      col("average_delay_minutes","Average delay","minutes")],
    summary:[{key:"assigned",label:"Assigned"},{key:"completed",label:"Completed"},{key:"pending",label:"Pending"},{key:"overdue",label:"Overdue"},{key:"on_time_completed",label:"On time"},{key:"delayed_completed",label:"Delayed"}],
    defaultSort:"employee",maxDateRangeDays:366,exportEligible:true,
    notes:["Assigned = tasks and FMS steps due in the period where the person is a current assignee. Shared work counts once for each assignee.",
      "Reassigned work counts for the person it is assigned to now. Each recurring occurrence is one task. Reopened work counts by its current state.",
      "Completion % = completed ÷ assigned. On-time % = completed by the due time ÷ completed. Average delay is over delayed completions only.",
      "Rejected tasks, skipped or stopped FMS steps, and FMS steps without a deadline are not counted. Original records and their history are unchanged."]}),
  report({key:"people_availability",category:"people",source:"jewelos",name:"Employee Availability",
    description:"Each employee's working status and recorded availability by date. Leave reasons are not shown.",
    roles:PEOPLE,filters:["from","to","branch_id","department_id","status","user_profile_id",...PAGE],dateLabel:"Date",
    columns:[col("employee_name","Employee",undefined,true),col("branch_name","Branch"),col("department_name","Department"),col("date","Date","date"),
      col("availability_status","Availability","status"),col("working_status","Working status","status")],
    defaultSort:"date desc",maxDateRangeDays:90,exportEligible:true}),

  // ---------------------------------------------------------------- Administration (Settings)
  report({key:"notification_delivery_health",category:"admin",source:"jewelos",name:"Notification delivery health",description:"Aggregate delivery state and retry health without message bodies or provider payloads.",roles:ADMIN,filters:["from","to","status","page","page_size"],columns:[c("channel","Channel"),c("status","Status"),c("delivery_count","Deliveries"),c("retry_count","Retries"),c("latest_attempt_at","Latest attempt")],defaultSort:"channel asc, status asc",maxDateRangeDays:90,exportEligible:true}),
  report({key:"export_history",category:"admin",source:"jewelos",name:"Export history",description:"Authorized export request lifecycle and retention metadata.",roles:ALL,filters:["from","to","status","user_profile_id","page","page_size"],columns:[c("export_id","Export ID"),c("report_key","Report"),c("status","Status"),c("progress_percent","Progress"),c("row_count","Rows"),c("requested_at","Requested"),c("expires_at","Expires"),c("requester_name","Requested by",true)],defaultSort:"requested_at desc, export_id asc",maxDateRangeDays:366,exportEligible:false}),

  // ---------------------------------------------------------------- Earlier reports (server keys kept)
  // The old JewelOS CRM reports (crm_clients_ownership, crm_walkins, crm_interactions, crm_followups)
  // read the archived public CRM tables and are hidden since the CRM cutover.
  legacy({key:"task_operations",name:"Task operations",description:"Assigned task status, priority, due time, and checklist progress.",roles:OPS,filters:["from","to","branch_id","department_id","status","user_profile_id","page","page_size"],columns:[c("task_id","Task ID"),c("title","Task"),c("task_type","Type"),c("priority","Priority"),c("status","Status"),c("planned_datetime","Due"),c("assignee_name","Assignee",true),c("checklist_completion","Checklist")],defaultSort:"planned_datetime asc, task_id asc",maxDateRangeDays:90,exportEligible:true}),
  legacy({key:"task_completion_delay",name:"Task completion and delay",description:"Transparent completion timing with on-time and delay measures.",roles:OPS,filters:["from","to","branch_id","department_id","user_profile_id","page","page_size"],columns:[c("task_id","Task ID"),c("title","Task"),c("assignee_name","Assignee",true),c("planned_datetime","Due"),c("actual_datetime","Completed"),c("on_time","On time"),c("delay_minutes","Delay (minutes)")],defaultSort:"actual_datetime desc, task_id asc",maxDateRangeDays:366,exportEligible:true}),
  legacy({key:"fms_instances_stages",name:"FMS instances and stages",description:"Flow instance and stage state in authorized scope.",roles:OPS,filters:["from","to","branch_id","department_id","status","user_profile_id","page","page_size"],columns:[c("instance_id","Instance ID"),c("reference_number","Reference"),c("flow_name","Flow"),c("instance_status","Instance status"),c("stage_name","Stage"),c("stage_status","Stage status"),c("planned_datetime","Planned"),c("assignee_name","Assignee",true)],defaultSort:"planned_datetime asc, instance_id asc",maxDateRangeDays:180,exportEligible:true}),
  legacy({key:"fms_sla",name:"FMS SLA",description:"Planned versus actual stage timing and breach state.",roles:OPS,filters:["from","to","branch_id","department_id","status","user_profile_id","page","page_size"],columns:[c("instance_id","Instance ID"),c("reference_number","Reference"),c("stage_name","Stage"),c("planned_datetime","Planned"),c("actual_datetime","Completed"),c("sla_state","SLA state"),c("delay_minutes","Delay (minutes)")],defaultSort:"planned_datetime asc, instance_id asc",maxDateRangeDays:366,exportEligible:true}),
  legacy({key:"form_submissions_reviews",name:"Form submissions and reviews",description:"Submission and review metadata without form answers.",roles:FORMS,filters:["from","to","branch_id","department_id","status","user_profile_id","page","page_size"],columns:[c("submission_id","Submission ID"),c("form_name","Form"),c("status","Review status"),c("submitted_at","Submitted"),c("submitted_by_name","Submitted by",true),c("reviewed_at","Reviewed"),c("reviewed_by_name","Reviewed by",true)],defaultSort:"submitted_at desc, submission_id asc",maxDateRangeDays:366,exportEligible:true}),
  legacy({key:"people_task_performance",name:"People task performance",description:"Separate per-person task counts and timing; no ranking or composite score.",roles:PEOPLE,filters:["from","to","branch_id","department_id","user_profile_id","page","page_size"],columns:[c("profile_id","Profile ID"),c("employee_name","Employee",true),c("tasks_assigned","Assigned"),c("tasks_completed","Completed"),c("completion_rate","Completion rate"),c("on_time_completed","On-time completed"),c("overdue_open","Overdue open"),c("average_delay_minutes","Average delay")],defaultSort:"employee_name asc, profile_id asc",maxDateRangeDays:366,exportEligible:true}),
];

/** Earlier customer exports (migration 0355) that only appear in the export list now. */
export const LEGACY_EXPORT_NAMES: Readonly<Record<string, string>> = {
  customer_master: "Master Customer Database (earlier format)",
  customer_enquiries: "Leads / Enquiries (earlier format)",
  customer_stages: "FMS Stage History (earlier format)",
  customer_answers: "Form Answers by Stage (earlier format)",
  customer_activity: "Customer Activity Timeline (earlier format)",
  customer_followups: "Follow-ups (earlier format)",
  customer_commercial: "Purchase / Repair History (earlier format)",
  customer_exceptions: "Synchronization Exceptions",
};

export const REPORT_CATEGORIES: readonly Readonly<{ id: Exclude<ReportCategory, "admin" | "legacy">; name: string; description: string }>[] = [
  // "Customer & CRM" reports read the retired CRM project and were removed on 2026-11-20 (owner);
  // customer reports on the customer master database come with the next UI work.
  { id: "operations", name: "Forms, FMS & Tasks", description: "Submitted forms with answers, FMS journeys and task status." },
  { id: "people", name: "Employee Performance", description: "Task performance and availability." },
];

export function reportFor(key: string): ReportDefinition | undefined { return REPORT_CATALOG.find((item) => item.key === key); }
export function reportsForRole(role: UserRole): readonly ReportDefinition[] { return REPORT_CATALOG.filter((item) => item.roles.includes(role)); }
export function canExportReport(role: UserRole, key: string): boolean { const item = reportFor(key); return Boolean(item?.exportEligible && item.roles.includes(role)); }
/** Reports offered on the Reports page: one per family, business categories only. */
export function businessReports(role: UserRole, can: (permission: string) => boolean): readonly ReportDefinition[] {
  return REPORT_CATALOG.filter((item) => item.roles.includes(role) && item.category !== undefined && !["admin", "legacy"].includes(item.category) && (!item.permission || can(item.permission)));
}
/** The sibling modes of a report family (FMS summary / stage detail), in catalogue order. */
export function reportVariants(definition: ReportDefinition): readonly ReportDefinition[] {
  return definition.family ? REPORT_CATALOG.filter((item) => item.family === definition.family) : [definition];
}
/** A readable name for any report key in the export list, including earlier exports. */
export function reportDisplayName(key: string): string {
  const item = reportFor(key);
  if (item) return item.variantLabel ? `${item.name} · ${item.variantLabel}` : item.name;
  return LEGACY_EXPORT_NAMES[key] ?? key.replaceAll("_", " ");
}
