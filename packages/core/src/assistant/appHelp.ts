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
      "See my tasks: open Tasks. My Tasks lists recurring and FMS work; Delegated lists one-time assigned work for employees; In Loop lists watched work. Subsection counts load when Tasks opens.",
      "Do an as-needed duty: work without a fixed time (As Required, Per Customer, After Visit and similar) is listed under \"As needed\" at the top of My Tasks. When it happens, press \"Start\" on that duty; it becomes a task due today in My Tasks, and you complete it like any other task. You can start the same duty several times a day. As-needed duties are never overdue until started.",
      "Find any of my tasks: use Search all tasks above the subsections. Search includes earlier and completed work, task descriptions and FMS references. Results show their subsection. Clear search and filters to return to the board.",
      "Narrow tasks: press Filter, combine work kind (FMS, CRM, recurring or other tasks), status, priority, due dates, subsection and requirements, then Apply filters. Due today and This week use the business timezone; sort by due date, newest or priority.",
      "Complete a task: finish the required form or upload, then press Complete. If a completion remark is required, Complete opens and focuses the remark field; enter the remark and press Complete again. FMS work opens its protected workflow runner.",
      "Create a task: in Tasks press \"Create Task\", fill in the title, pick one or more people under \"Users\", set the due date, optionally add several people under \"In Loop\", then press \"Assign Task\". With several users, choose \"Separate task for each user\" (everyone completes their own copy) or \"One shared task\" (any one of them completes it for all; only for people in the same branch and department).",
      "See tasks I gave to others: use \"Delegated\" in Tasks.",
      "Import many tasks at once: use \"Bulk Import\" in Tasks (only for roles that can assign work).",
      "See people with no work assigned: \"Assigning Left\" in Tasks (only for roles that can assign work).",
    ],
  },
  recurring_todo: {
    section: "recurring_todo",
    title: "Recurring / To-Do",
    path: "/recurring-todo",
    summary: "Recurring / To-Do manages repeating schedules, personal to-dos, verification of completed work, follow-ups, and coverage.",
    recipes: [
      "Filter the list: use the branch, department, frequency, priority, and status filters at the top.",
      "Verify completed work: open the Verification view and review each completed item.",
      "Send a follow-up: use Follow-ups for an item that is delayed.",
      "Give an employee an as-needed duty now: on an As Required schedule press \"Assign now\". The employee gets it as a task due today and is alerted; you can assign it again later the same day.",
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
      "Delete work: in the Tasks tab press \"Delete\" on a task (including CRM tasks), then \"Confirm deletion\". For FMS work press \"Delete FMS task\" (cancels that whole FMS run; completed steps and history are kept) or \"Delete start form\" (removes one person's pending start form); a reason is required.",
      "As-needed duties: in Templates, rows with status ON DEMAND (frequency such as PER CUSTOMER) have no date. Press \"Assign now\" to give the employee one occurrence due today; employees can also start them from \"As needed\" in My Tasks.",
    ],
  },
  fms_builder: {
    section: "fms_builder",
    title: "FMS",
    path: "/fms",
    summary: "FMS runs company workflows (Flow Management System): live workflow instances, assigned stages, and, for builders, versioned workflow designs.",
    recipes: [
      "Do my assigned stage: open the stage from Home or Tasks, complete its form or evidence, and submit.",
      "Start a workflow: open FMS, choose the workflow, and press \"Start instance\" (when your role may start it).",
      "Design a workflow: \"New workflow\" in FMS (workflow builders only).",
    ],
  },
  fms_tasks: {
    section: "fms_tasks",
    title: "FMS work",
    path: "/tasks/fms",
    summary: "Assigned FMS work lists the workflow stages and starter forms waiting for the user.",
    recipes: [
      "Open an assigned stage: tap it from Home or Tasks; it opens that exact stage.",
    ],
  },
  forms_library: {
    section: "forms_library",
    title: "Forms Library",
    path: "/forms",
    summary: "Forms Library lists the published forms the user can fill and the forms they submitted.",
    recipes: [
      "Fill a form: open Forms Library, find the form under \"Forms to fill\", and press \"Fill\".",
      "See what I submitted: \"My submissions\" in Forms Library shows each submission and its review status.",
      "Create a form: \"New form\" in Forms Library (form authors only), then \"Publish\" when ready.",
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
