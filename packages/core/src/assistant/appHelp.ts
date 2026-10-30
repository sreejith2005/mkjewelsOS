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
      "On mobile, My Tasks and FMS Tasks start collapsed with a pending count. Tap either heading to expand its work, then tap a task or stage to open it. Desktop starts expanded.",
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
      "Work on FMS: open Tasks, then FMS. Expand a workflow family, expand a stage, and press the record's action button: Fill form, Start form or Open work (View or View details for finished or waiting work). Only stages that hold your work are listed; the start form is not a stage (a pending start form you were asked to fill shows as Form to start). With only one workflow, it opens by itself, and so does its stage when only one stage has work. Each record shows its stage, status and when it is due. Active counts your pending and overdue actions; Waiting shows work awaiting other doers or approvals. Search record names or references; open Workflow and date filters to choose workflow, stage or due dates. Only your authorized work is shown.",
      "Use the FMS task board (managers, admins and super admins): open Tasks, then FMS. The list shows each workflow with active, overdue and due-today counts; tap a workflow to open its board. Each step that holds tasks is a column with its pending, overdue and today counts; press \"Show empty steps\" to see every step. The row of step buttons above the board jumps straight to that step. Cards show customer name, REF, due date and time, priority and Visit 2, 3 for repeat visits; overdue cards are red and come first, then due today, then later, then no date. Use \"Search customer or reference\", All / Overdue / Due today / Upcoming, Priority, Sort (\"Due soonest\" or \"Highest priority\"), Show (To do, Waiting for others, Done), \"Whose work\" (My work or My team), Employee and Refresh. \"Show 20 more\" loads more cards in a column. On a phone, pick a step from the step buttons. \"All FMS workflows\" goes back to the list; finishing a task returns to the same board. Only work you are allowed to see is shown.",
      "Complete a task: finish the required form or upload, then press Complete. Tasks do not ask for a completion remark. Tasks that need a form show Fill form on the card; FMS stages without a form show Open work. Both open the protected workflow runner for FMS work.",
      "Complete a checklist: a task with a checklist shows a \"Checklist\" button until every required item is ticked. Press it (or tap the card) to open the checklist, which is the first thing in the task. Tap each step after you do it; the tick shows straight away and saves in the background (\"Saving…\" shows next to the count). Steps unlock in order, top to bottom, and the next step has a gold outline; tapping a locked step says which step to tick first. When all required steps are ticked, press \"Complete task\" under the checklist (or Complete, Upload or Fill form on the card). A task cannot be completed while a required step is unticked.",
      "Remarks: if you are In Loop on a task, open it and write in Remarks to leave a note for the person doing it. The doer sees remarks once one is written and can reply there.",
      "Create a task: in Tasks press \"Create Task\", fill in the title, pick one or more people under \"Users\", set the due date, optionally add several people under \"In Loop\", then press \"Assign Task\". With several users, choose \"Separate task for each user\" (everyone completes their own copy) or \"One shared task\" (any one of them completes it for all; only for people in the same branch and department).",
      "See tasks I gave to others: use \"Delegated\" in Tasks.",
      "Create a recurring task (all active task authors): press \"Create Task\" and under \"Schedule\" choose \"Recurring\". The \"Repeats\" dropdown offers Daily, Weekly, Monthly, Quarterly, Annually and Custom. Simple schedules follow the start date; Custom lets you repeat every N days, weeks on chosen weekdays, months on chosen dates or on the 1st to 4th or last weekday, or years in chosen months. Set Starts on, Start time and Due time. Optionally expand \"End schedule\" to stop on a date or after a number of times, and \"View upcoming dates\" to see the next 10 dates (Asia/Kolkata). Each selected user gets their own schedule. Press \"Create schedule\". Your usual assignment permissions and eligible-user scope apply; creating a schedule does not grant Task Control editing access.",
      "Create an anytime duty (all active task authors): press \"Create Task\", choose \"As needed\" under \"Schedule\" and enter when it applies, for example Per Customer. Employees see it under \"Anytime duties\" and start it whenever the event happens; nothing is created on a calendar.",
      "Create Task on a phone uses a full-screen form. Open Users, search and select people, then press Done; selected names stay visible. For Due Date, choose Today, Tomorrow or a date, choose Due time, then press Done. The form fits the visible area when the keyboard opens. Voice guidance shows the Task, Details, Assign to, Deadline, Priority and Checklist items headings with Required/Optional labels and one example instruction.",
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
      "Edit one task: choose \"Edit task\" to change Task or Checklist type, upload/form requirements, verification, buddy assignment, Assignees, In Loop, dates, categorization and checklist items; then press \"Save changes\". Existing history stays intact; future schedules are edited separately.",
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
      "Do my assigned stage: open the stage from Home or Tasks. The page is headed by the record name. Read the due time and \"What you need to do\" (when set) and \"Previous form answers\" from earlier stages, then press \"Continue to form\" (or \"Continue\"). \"Before you complete this step\" lists anything else still missing (checklist, photo or PDF, decision, or a remark when the step requires one). Press \"Fill the form\": the form opens on the same page, below the earlier answers. While filling it, press \"Earlier answers\" (the clock button next to Submit on a phone) to read the previous answers again; press \"Back to my form\" and your typed answers are still there. Submitting the form also completes the step; a step without a form has \"Mark as done\". There is no claim button and no outcome box; a Remark box appears only on steps that require one. Then check who will receive the next step and confirm. You return to Tasks -> FMS with a short notice saying who has the next step; open any next work from that list.",
        "Choose the next employee: when no employee is set for the next step, the FMS confirmation keeps it with you (shown as your name with (you)). To give it to someone else, press Assign to a Different Employee under the step, pick a name from the list that opens there, or press Keep it with me to undo. Search any active, login-enabled company user across departments and branches, including management. Fixed employee steps stay locked; availability coverage still applies.",
      "Start a workflow: submit the workflow's starting form from the Forms Library (or the start form you were asked to fill).",
      "Design a workflow: \"New workflow\" in FMS (workflow builders only).",
      "Build on the workflow canvas: the builder always opens on the canvas, on computers and phones (there is no separate list view). Scroll the mouse wheel to zoom around the pointer, or pinch on a phone. The two buttons at the top right switch between \"Select mode\" (drag empty space to draw a box that selects every step it touches) and \"Hand mode\" (drag empty space to move around; phones start in Hand mode). Space+drag or the middle mouse button also moves around. \"Fit workflow to view\" (or the 1 key) and \"Auto-arrange workflow\" are next to the zoom buttons; \"Canvas tips\" shows the gestures again. Press \"Add Step\" to add a step; every step can have questions, conditions and an assignee, and there is no Normal/Decision choice. Click a step to open its settings on the right (a bottom sheet on phones) and \"Close inspector\" to hide them.",
      "Select, copy and paste steps: Shift+click or Ctrl+click adds or removes a step from the selection; on a phone switch to Select mode and press and hold a step. With several steps selected, a small bar above them offers Copy, Duplicate, Cut, Delete and Clear selection; right-click offers the same, and \"Paste here\" on empty space. Keyboard: Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+D (duplicate), Delete, Ctrl+A (select all), Ctrl+Z / Ctrl+Shift+Z (undo/redo), Esc (clear). Dragging any selected step moves the whole group. Copies get new identifiers and keep the connections between the copied steps; connections to steps that were not copied are removed and listed in a message. Copied steps can be pasted into another workflow in the same browser tab. Deleting several steps asks once (\"Delete 4 steps and 3 related connections?\") and never reconnects the remaining steps; Undo brings them back. The Start form cannot be deleted or duplicated.",
      "Edit a connection: click the line between two steps. Only that connection highlights and a small bar offers \"Edit route\" (opens the step's settings at that condition), \"Change destination\" (then click the new step), \"Route details\" and \"Delete route\". The round handle at the arrow end can also be dragged onto another step.",
      "Add questions to a step: open the step and use \"Questions & Form\": \"Create questionnaire\" opens the question editor over the canvas with a live preview beside it (Edit/Preview switch on phones); \"Import section\" copies a section of another Form into this step's questions (the original Form is not changed); \"Link existing form\" uses a published Form as it is, optionally only one section (\"The doer answers\"); \"No questionnaire\" removes the questions. In the editor, \"Save draft\" keeps unfinished work on the step and \"Use in workflow\" publishes it so its questions can be used in \"Add condition\" right away. A linked step shows the form name, question count, \"Edit\" (or \"Edit a copy\" for a Forms Library form), \"Preview\", \"Change source\" and \"Remove\". Unpublished questionnaire changes are listed under Publish readiness until used or discarded. Creating or importing questions needs Forms authoring permission.",
      "Use one section of a Form in a step: in \"Questions & Form\" press \"Link existing form\", choose the form, then under \"The doer answers\" pick \"Only <section>\" (or \"Link one section of a form…\"). The employee fills in only that section and conditions offer only its questions. The starting Form always uses the entire Form. Section problems are listed under Publish readiness.",
      "Import or export a workflow: press \"Import / Export\" in the builder toolbar. Export downloads the whole workflow or the selected steps as an MK Jewels FMS JSON file (design only: no running work, answers or history). Import accepts such a file, pasted JSON, or steps from another workflow you can see (\"From another FMS\"), shows a preview, then \"Add to this workflow\" (or \"Use as this workflow\"). Imported workflows stay drafts until published; n8n files are not supported.",
      "Step settings: under the name, \"Questions & Form\", \"Routing\" (\"Next step\", or \"Add condition\" and \"Otherwise go to\") and \"Assigned to\" are shown first. \"Task naming\", \"When / Deadline\", \"Instructions\", \"Checklist\", \"Completion controls\" and \"Advanced settings\" are collapsed; open one with its arrow. A new step has no deadline until \"Set deadline\" is switched on; then choose the \"Due date source\": \"From form answer\" (the date the step leading here recorded, for example Next Follow-up Date, with an optional time question; choose the question for each earlier step that can lead here; date-only answers are due at the end of that day unless \"Date-only answers are due at\" is set; \"If the date is missing\" can use a fallback timing, leave no due date, or require the date before the previous step can be submitted), \"Fixed date and time\" (\"Completion date\", \"Days before date\" or \"Specific clock time\"), \"TAT / relative\" (time after an earlier step) or \"No due date\". When a form has exactly one clearly named date question it is chosen for you; with several, choose one. \"Otherwise go to\" is optional: if no condition matches and it is left as \"Complete workflow here\", the workflow completes at that step. Under \"Assigned to\", the next step goes to the employee chosen in the previous step's Assigned To question, or its only employee question; with no employee question the same employee is suggested, and the employee finishing the step can keep them or choose another eligible employee; collapsing a section never changes its settings. Steps made as Decision Steps in older versions keep their \"Outcome choices\" under Routing.",
      "Routing conditions: Add condition opens the new condition at the top and collapses the previous editor. Each compact row shows its condition and destination; click it to edit. Then go to is above the answer choices. Conditions display in reverse order, but the If numbers show evaluation priority (1 first); the first matching condition wins. The arrows explicitly change priority. Collapsing a condition does not change its saved settings.",
      "Name workflow work: in the initial form's Task Naming settings, use Task name from to select an eligible question from its linked form or the form's selected record-name question. Later stages inherit that original name unless a stage override selects another question. Use the normal workflow revision and publication lifecycle for changes.",
      "Use the AI assistant (workflow builders, when an administrator has switched it on): open a workflow in the builder (a new workflow is named first, then \"Open builder\") and press \"AI assistant\" in the toolbar. One chat does everything: ask it to build the workflow, change it, check it for problems, fix them, or explain why something happens (for example why the next person is not receiving the task). Changes appear as \"Review the changes\" or \"Preview this fix\"; press \"Apply to editor\" to use them. Nothing is saved until you press \"Save draft\" and \"Publish\"; \"Undo\" reverts the applied changes. Proposed Forms must be created (\"Create Form draft\") and published in Forms first.",
      "Turn the AI assistant on or off: administrators press \"AI assistant\" (settings) at the top of FMS, tick \"Turn on the AI assistant\" and set the daily request limit per author. Manual workflow editing never depends on it.",
      "Add an ending (End Node): add a normal step with \"Add Step\" and connect the last route to it, then open it and tick \"End the workflow here (End Node)\" (only a last step, with no next step, can be ticked). Set \"Node name\" (for example Sales Closed), \"End type\" (Won, Lost, Do not contact or Other closure) and an optional \"Closure reason code\". Many steps can route to one End Node. An End Node has no assignee, form or deadline: reaching it closes the whole workflow automatically and records the outcome. On the canvas it says \"End Node · closes automatically\"; a last step that is not an End Node says \"Last step · needs Mark as done\". Untick the box to make it a normal step again.",
      "See how a workflow is doing: on its card the FMS list shows Running, Won, Lost and Other endings. Press \"Tasks\" on the card to open the workflow workspace (managers, admins and super admins get the task board there and use \"Runs\" or \"Runs and outcomes\" for this workspace): the counts (Started, Running, Won, Lost, Do not contact, Other endings, Completed, Cancelled, Conversion = won runs ÷ started runs × 100) for the chosen \"Reporting period\" (All time, Today, This week, This month or Custom dates; it counts runs started in that period). Tap a count to list those runs. \"Endings and step reach\" shows how many unique runs reached each End Node and each step, with total visits for repeated steps.",
      "Find a workflow run: in the workflow workspace use \"Search customer or reference\" and the Status, Step, Employee and Show (\"Everything I can see\" or \"Only my work\") filters. Each row shows the current step, who has it, its status and due time. Press \"Fill form\" or \"Open work\" for your own step, or \"View details\" / \"View journey\" to open the run: its \"Work to do\", its \"Journey\" (every step that actually ran, repeat visits numbered, the saved routing answer, and the final outcome) and \"Step details and saved answers\". Finished runs are read-only.",
    ],
  },
  fms_tasks: {
    section: "fms_tasks",
    title: "FMS work",
    path: "/tasks/fms",
    summary: "Tasks -> FMS groups the user's assigned starter forms and stage visits by workflow family and published stage (managers, admins and super admins get a stage-column board with counts instead); each record's action (Fill form, Start form, Open work) uses the existing protected runner.",
    recipes: [
      "Open an assigned stage: tap it from Home or Tasks; it opens that exact stage. Use \"My work\" at the top to go back to Tasks.",
    ],
  },
  forms_library: {
    section: "forms_library",
    title: "Forms Library",
    path: "/forms",
    summary: "Forms Library lists visible published forms the user can fill and the forms they submitted. Hidden forms remain accessible through assigned Tasks and FMS work.",
    recipes: [
      "Fill a form: open Forms Library, find the form under \"Forms to fill\" (or use \"Search forms\"), and press \"Fill form\". On a phone the form opens full screen. Questions marked * must be answered, and the bar at the top counts them. Long forms are filled one step at a time with \"Next\" and \"Back\"; tap an earlier step to change it, and open \"Check your answers before submitting\" on the last step before pressing \"Submit form\". A missing answer is marked in red under the question. Some choice questions end with \"Other\": pick it and type your own answer in the box that appears.",
      "Find a form made in an FMS workflow: under \"Forms to fill\" there are two buttons. \"Forms Library\" (shown first) lists forms made in Forms Library; \"FMS workflow forms\" lists the questions built inside FMS workflow steps, with the workflow and step they belong to (names shown to form authors). FMS workflow forms are filled from Tasks -> FMS when the step is assigned to you; authors change them from the workflow step's \"Questions & Form\".",
      "See what I submitted: \"My submissions\" in Forms Library lists each submission by date with its status (Submitted, Approved or Rejected); tap one to read the answers.",
      "Create a form: \"New form\" in Forms Library (form authors only), then \"Publish\" when ready. Each form shows its versions with a Live, Draft or Archived label.",
      "Reuse or share dropdown options: in the form editor, open a Dropdown, Radio Group or Checkbox question. \"Use existing Dropdown Master\" picks a shared list, and the question then always shows that list's current options. To share new options, choose \"Create new dropdown\", add the options, tick \"Also add this dropdown to Dropdown Master\" and give the list a name. The list is added when you save the form, or straight away with \"Add now\". \"Open in Dropdown Master\" opens the list for editing.",
      "Let people type their own answer: in the form editor, open a Dropdown, Radio Group or Checkbox question and tick \"Add an Other choice\". People filling the form then see \"Other\" and can type any answer; the typed text is saved as their answer.",
      "See the form while editing it: on a wide screen the form editor shows the real form under \"Live preview\" beside the questions, updating with every change; answer it to test conditional questions (nothing is submitted). Use \"Desktop preview\" / \"Mobile preview\", \"Start preview again\", and \"Hide preview\" / \"Show preview\". On a phone press \"Preview form\" and \"Edit\" to switch.",
      "Control library visibility: form authors use Visible in Forms Library on each form version. Turning it off hides the form from staff browsing and standalone filling; assigned Tasks/FMS work and submission history remain available. Form authors can still see and manage it.",
      "Contribute customer answers: authors open Customer Data Integration in Form Builder, set a channel/account scope and review each question destination. Tick Enable CRM data integration and press Save customer mapping; this creates an immutable version. CRM status shows Saved, awaiting CRM approval until a CRM super admin approves the exact mapping, then Approved and active; after that submissions link on their own. If the form is revised, the panel says This form was revised and fills in the earlier mapping: review it and save again for re-approval. FMS work completes while synchronization waits; unmapped operational answers remain in JewelOS.",
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
      "Customer exports: open Customer & Stage Exports, choose the export and optional workflow, stage, employee and dates, then Queue private CSV export. Download from Your exports. Full answers require source-work access; customer exports also require CRM administrator authority. Authors can save a reusable Sheet layout with stable question keys. Sheets remain one-way.",
    ],
  },
  crm: {
    section: "crm",
    title: "CRM",
    path: "/crm",
    summary: "CRM holds client records, walk-ins, interactions, and follow-ups for CRM users. Client profile details accumulate from saved answers; newer nonblank answers replace older answers.",
    recipes: [
      "Find a client: open CRM and search by name or client id.",
      "Record a walk-in or follow-up: use the walk-in and follow-up screens in CRM.",
      "Read a client’s history: open Customer journey, SAVED WALK-IN DETAILS & MEDIA or PROFILE EDIT LOG on their profile. Expand an entry for full notes, grouped answers, Media or Before and After values. Show more reveals older entries on the current page; the history page links open earlier pages. Use Add a contact to record a contact. Customer journey shows enquiries, calls, store visits, follow-ups and FMS steps in date order; filter with All, Store visits, Enquiries & leads, Calls & follow-ups, FMS work, Engagement asks or Profile edits. Under the client's name the profile shows LEAD or CLIENT, the steps Lead → Store visit completed → Client, and Purchase evidence separately.",
      "Returning client: enter the phone number in REGISTER CLIENT ENTRY. CRM uses the most recently visited profile for that full phone number and prefills saved details. Older nonblank answers remain available when newer visits leave a field blank. Changed answers use the latest saved value. Client profiles use the same accumulated details; original visit records remain in their history.",
      "Customer history: open a client profile and expand Workflow history to see the answers collected in workflows, who filled them, when, and the customer type. Open this work checks its own permissions. Administrators use Customer Integration Administration on the CRM Dashboard to approve mappings (they appear before the first submission), turn Roster contributors on or off with a reason, and resolve pending identities; waiting submissions then link without a retry.",
    ],
  },
  dropdown_master: {
    section: "dropdown_master",
    title: "Dropdown Master",
    path: "/dropdown-master",
    summary: "Dropdown Master is the one shared set of option lists used across JewelOS: Forms, FMS, Tasks, Users, Leave and CRM all read the same lists.",
    recipes: [
      "See every list: Dropdown Master opens on all lists with totals (Lists, Options, Made here, Made in forms, Built-in, Used by forms). Each card shows its active options, how many forms use it and when it was created. Use \"Search lists and options\" or the buttons \"All lists\", \"Made here\", \"Made in forms\" and \"Built-in\" to narrow them.",
      "Open a list: tap its card. The list shows \"Used in forms\" and its options; \"All lists\" goes back.",
      "Add an option: open the list and press \"Add item\".",
      "Create a list: press \"New list\", type the list name and its first item.",
      "Hide an option without losing saved answers: open the list and press the eye button (\"Turn off\"). Press it again to turn it back on.",
      "Lists made in the form editor (\"Also add this dropdown to Dropdown Master\") are marked \"Made in a form\"; in the form editor, \"Open in Dropdown Master\" opens that list directly.",
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
      "Integration status: open Customer Integration in Settings. Forms → CRM lists each customer form with its state (Not configured, Draft mapping, Saved, awaiting CRM approval, Approved and active, Form changed, re-approval required, Blocked or Disabled), how many submissions are linked, anything waiting, and the Next step. Other connections shows the delivery worker, Users → CRM roster and CRM walk-ins → Tasks. Approval and identity decisions resume on their own; use Retry selected customer events under Undelivered customer events only for failed events after fixing the cause. Only integration administrators can open it. In an FMS step, a line such as Linked to CRM customer or Waiting for CRM authorization shows the customer sync, with Open CRM customer profile for CRM users.",
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
