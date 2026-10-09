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
    summary: "Home shows the user's own work for today: open and overdue tasks, assigned FMS stages, forms to fill, and recent activity.",
    recipes: [
      "See today's work: open Home from the menu. Overdue items are listed first.",
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
      "See my tasks: open Tasks; \"Assigned to me\" lists work given to you.",
      "Complete a task: open the task, finish any required checklist items, form, or photo, then mark it complete.",
      "Create a task: in Tasks press \"Create Task\", fill in the title, assignee, and due date, then save.",
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
    ],
  },
  task_templates: {
    section: "task_templates",
    title: "Task Control",
    path: "/task-templates",
    summary: "Task Control is for managers: team progress, overdue work, evidence review, and task templates.",
    recipes: [
      "Check team progress: open Task Control and choose the date range and department.",
      "Review evidence: open the evidence panel inside Task Control.",
      "Change a schedule: edit the template and press \"Save schedule\".",
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
      "See my leave requests and their status: open the leave section in Availability.",
      "Mark availability for a day: choose Present, Absent, Half day, or Remote for that date.",
    ],
  },
  reports: {
    section: "reports",
    title: "Reports",
    path: "/reports",
    summary: "Reports previews fixed reports for the user's level and lets them request private CSV exports.",
    recipes: [
      "Preview a report: open Reports, pick the report and the date range.",
      "Export a report: request a CSV export from the report; it is prepared privately for you to download.",
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
      "Manage permissions: Settings > Permissions (Super Admin only).",
    ],
  },
  ask_kiara: {
    section: "ask_kiara",
    title: "Ask Kiara",
    path: "/ask-kiara",
    summary: "Ask Kiara answers questions about the user's own work, how to use JewelOS, and company SOPs, within the user's access.",
    recipes: [
      "Ask a question: type it in the box at the bottom and press Send. English, Hindi, and Hinglish all work.",
      "See how many questions are left today: the counter next to the box shows it and when it resets.",
      "Start fresh: press \"New chat\". Earlier chats stay in the list on the left (or under \"Chats\" on a phone).",
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
