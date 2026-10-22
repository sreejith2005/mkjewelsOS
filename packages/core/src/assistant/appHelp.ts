import type { PageId } from "../roleMenu.ts";

/**
 * How-to content for each JewelOS section (spec section 11).
 *
 * It lives in code, not in the knowledge base, because it must change in the
 * same commit as the screens it describes, it is keyed by page id so Kiara only
 * explains sections the asker can open, and it is needed before the knowledge
 * base exists. Organization-specific procedures belong in the knowledge base.
 *
 * Keep each entry short and true to the current web and Android screens. When a
 * section's screens change, update its entry (docs/REGRESSION_CHECKLIST.md).
 */
export type AppHelpEntry = Readonly<{
  section: PageId;
  title: string;
  path: string;
  summary: string;
  recipes: readonly string[];
}>;

const COMMON_NOTE = "If a button described here is missing, the user's role may not have that action; they can ask their manager or Super Admin.";

export const APP_HELP: Readonly<Partial<Record<PageId, AppHelpEntry>>> = {
  home: {
    section: "home",
    title: "Home",
    path: "/",
    summary: "Home shows the user's own work for today: open and overdue tasks, assigned FMS stages, forms to fill, and recent activity. Managers, HR, Admins and Super Admins also see \"Team today\": today's team tasks, who needs follow-up, and progress by department.",
    recipes: [
      "See today's work: open Home from the menu. Overdue items are listed first.",
      "See the team's day (leaders): the \"Team today\" section shows Assigned, Done, Pending and Overdue for today. With no tasks of your own, the top card shows \"Team completion today\". Tap a person under \"Needs follow-up\" to open their tasks in Task Control.",
      "Open a task or stage: tap it on Home to go straight to that work item.",
      "Fill a form linked to a task: use the form item on Home; it opens the exact form for that task.",
    ],
  },
  dashboard: {
    section: "dashboard",
    title: "Dashboard",
    path: "/dashboard",
    summary: "Dashboard shows task, FMS, and form numbers for the user's own scope and a chosen period, with the formula behind each number.",
    recipes: [
      "Change the period: pick a preset such as today, this week, or this month at the top of Dashboard.",
      "Understand a number: each card explains the formula it uses.",
    ],
  },
  checklist_tasks: {
    section: "checklist_tasks",
    title: "Tasks",
    path: "/tasks",
    summary: "Tasks lists the work assigned to the user, the tasks they delegated, and tasks they are watching.",
    recipes: [
      "See my tasks: open Tasks. My Tasks lists recurring work; Delegated lists one-time assigned work for employees; In Loop lists watched work. Open the FMS subsection for your assigned workflow work, grouped by workflow family and published stage. Subsection counts load when Tasks opens.",
      "Do an anytime duty: work without a fixed time (As Required, Per Customer, After Visit and similar) is under the \"Anytime duties\" bar at the top of My Tasks (Pending); the bar is closed until you tap it. They are low priority with no deadline and come back every day. Press \"Start\" whenever you do one; it opens as a low-priority task due tonight, and it also appears in your task list (marked \"Anytime duty\") so you can finish it later. Complete it like any other task (upload, checklist, form). Press \"Continue\" to finish one already open. You can do the same duty several times a day. If a manager assigns one, it appears in your list as a high-priority task.",
      "Task order: My Tasks shows the earliest due date first; tasks due at the same time show high priority before medium and low. Overdue shows the longest overdue first; Completed shows the most recent first.",
      "Find any of my tasks: use Search all tasks above the subsections. Search includes earlier and completed work, task descriptions and FMS references. Results show their subsection. Clear search and filters to return to the board.",
      "Narrow tasks: press Filter, combine work kind (FMS, CRM, recurring or other tasks), status, priority, due dates, subsection and requirements, then Apply filters. Due today and This week use the business timezone; sort by due date, newest or priority.",
      "Work on FMS: open Tasks, then FMS. Expand a workflow family, expand a stage, and press the record's action button: Fill form, Start form or Open work (View or View details for finished or waiting work). With only one workflow, it opens by itself, and so does its stage when only one stage has work. Each record shows its stage, status and when it is due. Active counts your pending and overdue actions; Waiting shows work awaiting other doers or approvals. Search record names or references; open Workflow and date filters to choose workflow, stage or due dates. Only your authorized work is shown.",
      "Complete a task: finish the required form or upload, then press Complete. If a completion remark is required, Complete opens and focuses the remark field; enter the remark and press Complete again. Tasks that need a form show Fill form on the card; FMS stages without a form show Open work. Both open the protected workflow runner for FMS work.",
      "Create a task: in Tasks press \"Create Task\", fill in the title, pick one or more people under \"Users\", set the due date, optionally add several people under \"In Loop\", then press \"Assign Task\". With several users, choose \"Separate task for each user\" (everyone completes their own copy) or \"One shared task\" (any one of them completes it for all; only for people in the same branch and department).",
      "See tasks I gave to others: use \"Delegated\" in Tasks.",
      "Create a recurring task (admins): press \"Create Task\" and under \"Schedule\" choose \"Recurring\". Pick a ready pattern (Every day, Monday to Saturday, 3rd Saturday of every month, Last day of every month and more) or build your own under \"Repeats\": every N days, weeks on chosen weekdays, months on chosen dates or on the 1st to 4th or last weekday, or years in chosen months. Set the start date, Start time and Due time, and optionally an end date or a number of times. The preview lists the next 10 dates exactly as they will be created (Asia/Kolkata). Each selected user gets their own schedule. Then press \"Create schedule\".",
      "Create an anytime duty (admins): press \"Create Task\", choose \"As needed\" under \"Schedule\" and enter when it applies, for example Per Customer. Employees see it under \"Anytime duties\" and start it whenever the event happens; nothing is created on a calendar.",
      "Import many tasks at once: use \"Bulk Import\" in Tasks (only for roles that can assign work).",
      "See people with no work assigned: \"Assigning Left\" in Tasks (only for roles that can assign work).",
    ],
  },
  task_templates: {
    section: "task_templates",
    title: "Task Control",
    path: "/task-templates",
    summary: "Task Control is for managers: team progress, overdue work, evidence review, task templates, and editing task details and requirements.",
    recipes: [
      "Check team progress: open Task Control and choose the date range and department.",
      "Review evidence: open the evidence panel inside Task Control.",
      "Edit one task: choose \"Edit task\" to change Task or Checklist type, upload/remark/form requirements, verification, buddy assignment, Assignees, In Loop, dates, categorization and checklist items; then press \"Save changes\". Existing history stays intact; future schedules are edited separately.",
      "Change a schedule: edit the template and press \"Save schedule\".",
      "Delete work: in the Tasks tab press \"Delete\" on a task (including CRM tasks), then \"Confirm deletion\". For FMS work press \"Delete FMS task\" (cancels that whole FMS run; completed steps and history are kept) or \"Delete start form\" (removes one person's pending start form); a reason is required. To delete several at once, tick the rows (open FMS work included) or press \"Select this page\", then \"Delete selected\" (or \"Delete all matching\") and \"Confirm deletion\".",
      "Review recurring work (admins): open the \"Review\" tab. Verification lists completed work waiting for your Verify or Reject (a rejection needs a reason and returns the work to the employee); Rejected, Coverage Required and Manager Review list work needing attention; Follow-ups lets you send a reminder; Performance shows each employee’s recurring results. The tiles at the top filter the list.",
      "Manage schedules (admins): in \"Templates\" each row shows how often it repeats and its next date (or Ended). Press \"Edit\" to change the repeat pattern, times, end condition, verification or follow-ups (saving changes future occurrences only; completed work never changes), \"Run now\" to create today’s occurrence immediately, \"Deactivate\"/\"Activate\" to pause or resume, or \"Delete\".",
      "Anytime duties: in Templates, rows with status ON DEMAND (frequency such as PER CUSTOMER) have no date. Employees always see them under \"Anytime duties\" in My Tasks as low priority. Press \"Assign now\" to enforce one: the employee gets a high-priority occurrence due today.",
    ],
  },
  fms_builder: {
    section: "fms_builder",
    title: "FMS",
    path: "/fms",
    summary: "FMS runs company workflows (Flow Management System): live workflow instances, assigned stages, and, for builders, versioned workflow designs.",
    recipes: [
      "Do my assigned stage: open the stage from Home or Tasks. The steps at the top are Read previous details, Complete your work, Review next assignment and Confirm. First read \"Your step\" (what you need to do and when it is due) and \"Previous form answers\" from earlier stages, then press \"Continue to stage form\" (or \"Continue to stage\"). \"Before you complete this step\" lists anything still missing (form, checklist, evidence, decision, remark). Press \"Fill the form\" to fill and submit it; submitting also completes the step. Then check who will receive the next step and confirm.",
        "Choose the next employee: in the FMS confirmation, press Assign to a Different Employee. Search any active, login-enabled company user across departments and branches, including management. Fixed employee steps stay locked; availability coverage still applies.",
      "Start a workflow: open FMS, choose the workflow, and press \"Start instance\" (when your role may start it).",
      "Design a workflow: \"New workflow\" in FMS (workflow builders only).",
      "Name workflow work: in the initial form's Task Naming settings, use Task name from to select an eligible question from its linked form or the form's selected record-name question. Later stages inherit that original name unless a stage override selects another question. Use the normal workflow revision and publication lifecycle for changes.",
    ],
  },
  fms_tasks: {
    section: "fms_tasks",
    title: "FMS work",
    path: "/tasks/fms",
    summary: "Tasks -> FMS groups the user's assigned starter forms and stage visits by workflow family and published stage; each record's action (Fill form, Start form, Open work) uses the existing protected runner.",
    recipes: [
      "Open an assigned stage: tap it from Home or Tasks; it opens that exact stage. Use \"My work\" at the top to go back to Tasks.",
    ],
  },
  forms_library: {
    section: "forms_library",
    title: "Forms Library",
    path: "/forms",
    summary: "Forms Library lists the published forms the user can fill and the forms they submitted.",
    recipes: [
      "Fill a form: open Forms Library, find the form under \"Forms to fill\", and press \"Fill\". Questions marked * must be answered, and the bar at the top counts them. Long forms are filled one step at a time with \"Next\" and \"Back\"; tap an earlier step to change it, and open \"Check your answers before submitting\" on the last step before pressing \"Submit form\". A missing answer is marked in red under the question.",
      "See what I submitted: \"My submissions\" in Forms Library shows each submission and its review status.",
      "Create a form: \"New form\" in Forms Library (form authors only), then \"Publish\" when ready.",
      "Set a record name: in Form Builder, use Use this question as the record name to choose an identifying question, or leave Automatic. A used published form requires a new revision to change its default. Each FMS workflow can select its own naming question in Task Naming.",
    ],
  },
  notifications: {
    section: "notifications",
    title: "Notifications",
    path: "/notifications",
    summary: "Notifications is the user's inbox of alerts about their work, such as new assignments.",
    recipes: [
      "Open the work behind an alert: tap the notification.",
      "See unread alerts: the bell shows how many are unread.",
    ],
  },
  users: {
    section: "users",
    title: "Users",
    path: "/users",
    summary: "Users is the employee directory for the people the user is allowed to see, with account management for authorized roles.",
    recipes: [
      "Find an employee: open Users and filter by branch or department.",
      "Add an employee: \"Add user\" in Users (authorized roles only).",
      "Set someone's login password: open the employee and use \"Set login password\" (authorized roles only).",
    ],
  },
  availability: {
    section: "availability",
    title: "Availability",
    path: "/availability",
    summary: "Availability records whether people are present, absent, on half day, or remote, and holds leave applications.",
    recipes: [
      "Apply for leave: open Availability, choose \"Apply leave\", enter the dates and reason, then press \"Submit leave\".",
      "See my leave requests and their status: open Availability and choose \"Leave summary\".",
      "Mark availability for a day: choose Present, Absent, Half day, or Remote for that date.",
      "Approve or reject leave (people who review leave): open Availability and choose \"Review requests\".",
    ],
  },
  reports: {
    section: "reports",
    title: "Reports",
    path: "/reports",
    summary: "Reports previews fixed reports for the user's level and lets them export private CSV files.",
    recipes: [
      "Preview a report: open Reports, tap the report, then pick dates (Today, Last 7 days, Last 30 days, This month, or From/To) and any Branch, Department or Status filter.",
      "Export a report: press \"Export CSV\". The file appears under \"Your exports\" (Waiting, then Preparing), usually within a minute; press \"Download\" when it is Completed. Files expire automatically.",
    ],
  },
  crm: {
    section: "crm",
    title: "CRM",
    path: "/crm",
    summary: "CRM holds client records, walk-ins, interactions, and follow-ups for CRM users.",
    recipes: [
      "Find a client: open CRM and search by name or client id.",
      "Record a walk-in or follow-up: use the walk-in and follow-up screens in CRM.",
    ],
  },
  dropdown_master: {
    section: "dropdown_master",
    title: "Dropdown Master",
    path: "/dropdown-master",
    summary: "Dropdown Master maintains the shared option lists used across JewelOS.",
    recipes: [
      "Add an option: open the list and press \"Add item\".",
      "Hide an option without deleting it: mark it Inactive.",
    ],
  },
  settings: {
    section: "settings",
    title: "Settings",
    path: "/settings",
    summary: "Settings holds the user's own preferences and, for authorized roles, organization defaults and permissions.",
    recipes: [
      "Change the theme or table density: open Settings and change your preferences.",
      "Manage permissions: Settings > \"Open permission management\" (Super Admin only).",
    ],
  },
  ask_kiara: {
    section: "ask_kiara",
    title: "Ask Kiara",
    path: "/ask-kiara",
    summary: "Ask Kiara answers questions about the user's own work (tasks, FMS, forms, notifications, leave, availability), their Dashboard, Task Control and Reports numbers, colleagues' names and roles, CRM clients for CRM users, company SOPs (with sources), and how to use JewelOS, never showing more than the user's own screens show them. Kiara only answers; it never does anything in JewelOS.",
    recipes: [
      "Ask a question: type it in the box at the bottom and press Send. English, Hindi, and Hinglish all work.",
      "Ask by voice (if the mic is shown): tap the mic next to Send, speak, tap stop, check the words, then press Send.",
      "See how many questions are left today: the counter at the top of Ask Kiara shows it and when it resets (midnight India time).",
      "Check where an SOP answer comes from: tap the source chip under \"Sources\" to open that SOP section.",
      "When Kiara cannot answer a company question: press \"Ask a person\" under the answer to send it to your manager; the answer comes back in the same chat with a notification.",
      "Answer a question someone sent you (managers): open the \"Questions for you\" tab, type the answer, and press \"Answer\".",
      "Start fresh: press \"New chat\". Earlier chats stay in the list on the left (or under \"Chats\" on a phone).",
      "Ask about a team or branch: Kiara answers from the same Dashboard, Task Control, Reports, and leave screens the user can open; if a screen is not open to the user, Kiara says so.",
    ],
  },
};

export type AppHelpResult = Readonly<{
  section: PageId;
  title: string;
  path: string;
  summary: string;
  recipes: readonly string[];
  note: string;
}>;

export function getAppHelp(section: PageId): AppHelpResult | null {
  const entry = APP_HELP[section];
  return entry ? { ...entry, note: COMMON_NOTE } : null;
}
