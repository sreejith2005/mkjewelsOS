# Ask Kiara: app help for you to check

For the owner. When someone asks Kiara **"how do I … in JewelOS?"**, Kiara answers only from
the text below. It does not make up other steps. Please read each section and tick it, or
write what is wrong next to it and send the list back. Kiara rewrites these answers in
simple words and in the language of the question (English, Hindi or Hinglish).

How it works:
- Kiara explains a section **only if that person can open it**. A staff member who asks
  "how do I add a new employee?" is told they don't have access to Users. No steps are given.
- Every answer also carries this note: *"If a button described here is missing, your role may
  not have that action; ask your manager or Super Admin."*
- Company rules and procedures ("how many leaves do I get?") are **not** here. They come
  only from the SOPs in the Knowledge base.

The source is `packages/core/src/assistant/appHelp.ts`. Keep this file and that one in step
(AGENTS.md, "Keeping Ask Kiara current").

Tasks entry updated against the screens: 2026-10-21 (Anytime duties, task order). Recurring / To-Do and Task Control: 2026-10-21 (Assign now is high priority). Home, Task Control (Delete) and Reports: 2026-10-21. Other entries last checked: 2026-10-14. FMS workspace implementation: 2026-10-21; local evidence is in the feature plan, not proof of deployment.

---

## Home (menu: Home)
**What it is:** your own work for today: open and overdue tasks, your FMS stages, forms to
fill, and recent activity.
- [ ] See today's work: open Home from the menu. Overdue items are listed first.
- [ ] Leaders: **Team today** shows Assigned, Done, Pending and Overdue for today; with no tasks of your own the top card shows **Team completion today**. Tap a person under **Needs follow-up** to open their tasks in Task Control.
- [ ] Open a task or stage: tap it on Home to go straight to that work.
- [ ] Fill a form linked to a task: use the form item on Home. It opens the exact form for that task.

## Dashboard
**What it is:** task, FMS and form numbers for your own scope and a period you choose, with
the formula behind each number.
- [ ] Change the period: pick today, this week, this month, etc. at the top of Dashboard.
- [ ] Understand a number: each card explains its formula.

## Tasks
**What it is:** work given to you, tasks you gave to others, and tasks you are watching.
- [ ] See my tasks: open Tasks. **My Tasks** lists recurring work; **FMS** lists your assigned workflow work by family and published stage; **Delegated** lists one-time assigned work for employees; **In Loop** lists watched work. Subsection counts load when Tasks opens.
- [ ] Work on FMS: Tasks -> **FMS** -> expand a workflow family -> expand a stage -> **Open Work** on the record. **Active** counts pending and overdue actions. **Waiting** separates work awaiting other employees/approvals. Use name/reference search, workflow/stage/status/due filters and **Clear all**. Counts cover all assignments, not just a page. Access remains the current employee's existing scope.
- [ ] Do an anytime duty: duties without a fixed time (As Required, Per Customer, After Visit...) are under the **Anytime duties** bar at the top of My Tasks (Pending), closed until tapped; low priority with no deadline; they come back every day. Press **Start** whenever you do one; it opens as a low-priority task due tonight and also appears in the task list marked **Anytime duty**. **Continue** opens one already open. A duty a manager assigns appears as a high-priority task.
- [ ] Task order: earliest due date first; at the same due time, high before medium before low. Overdue: longest overdue first. Completed: most recent first.
- [ ] Complete a task: finish the required form or upload, then press **Complete**. If a remark is required, the button opens and focuses the remark field; enter it and press **Complete** again. FMS work opens its protected workflow runner.
- [ ] Create a task: in Tasks press **Create Task**, fill in the title, pick one or more people under **Users**, set the due date, optionally add several people under **In Loop**, then press **Assign Task**. With several users, choose **Separate task for each user** (everyone completes their own copy) or **One shared task** (any one of them completes it for all; same branch and department only).
- [ ] See tasks I gave to others: **Delegated** in Tasks.
- [ ] Add many tasks at once: **Bulk Import** in Tasks (only roles that can assign work).
- [ ] See people with no work given: **Assigning Left** in Tasks (only roles that can assign work).

## Recurring / To-Do
**What it is:** repeating schedules, personal to-dos, checking finished work, follow-ups and coverage.
- [ ] Filter the list: branch, department, frequency, priority and status filters at the top.
- [ ] Check finished work: open the **Verification** view and review each item.
- [ ] Chase a late item: use **Follow-ups**.
- [ ] Give an anytime duty now: on an As Required schedule press **Assign now**. The employee gets a high-priority task due today and an alert.

## Task Control (for managers)
**What it is:** team progress, overdue work, evidence review and task templates.
- [ ] Check team progress: open Task Control and choose the dates and department.
- [ ] Review evidence: open the evidence panel in Task Control.
- [ ] Edit one task: **Edit task** changes Task/Checklist type, requirements, participants, dates, categorization and checklist items. Press **Save changes**. History is retained; future schedules have their own editor.
- [ ] Change a schedule: edit the template and press **Save schedule**.
- [ ] Delete work: in Tasks press **Delete** (also for CRM tasks), then **Confirm deletion**. FMS work: **Delete FMS task** cancels that whole FMS run (completed steps and history kept); **Delete start form** removes one person's pending start form. A reason is required. Several at once: tick rows (open FMS work included) or **Select this page**, then **Delete selected** or **Delete all matching**, then **Confirm deletion**.
- [ ] Anytime duties: Templates rows with status **ON DEMAND** (frequency such as PER CUSTOMER) have no date; employees always see them as low priority under **Anytime duties**. **Assign now** enforces one as a high-priority occurrence due today.

## FMS (workflows)
**What it is:** company workflows: live workflows, the stages given to you, and, for people
who build workflows, the designs.
- [ ] Do my stage: open it from Home or Tasks, complete its form or evidence, and submit.
- [ ] Start a workflow: open FMS, choose the workflow, press **Start instance** (if your role may start it).
- [ ] Design a workflow: **New workflow** in FMS (workflow builders only).
- [ ] Name workflow work: in the initial form's **Task Naming**, use **Task name from** to choose an eligible question from the linked form or its selected record-name question. Later stages inherit the original name unless overridden; changes use the usual revision/publication lifecycle.

## FMS work (my assigned stages)
**What it is:** the workflow stages and starting forms waiting for you.
- [ ] Open a stage: tap it from Home or Tasks. It opens that exact stage.

## Forms Library
**What it is:** published forms you can fill, and forms you sent.
- [ ] Fill a form: open Forms Library, find the form under **Forms to fill**, press **Fill**.
- [ ] See what I sent: **My submissions** shows each one and whether it was reviewed.
- [ ] Make a form: **New form** (form makers only), then **Publish** when ready.
- [ ] Set its naming default: in Form Builder use **Use this question as the record name**, or leave **Automatic**. A used published form needs a new revision to change its default; each workflow can override it in **Task Naming**.

## Notifications
**What it is:** your inbox of alerts about your work, such as new tasks.
- [ ] Open the work behind an alert: tap the notification.
- [ ] See unread alerts: the bell shows how many are unread.

## Users
**What it is:** the employee list for the people you may see, and account tools for allowed roles.
- [ ] Find an employee: open Users and filter by branch or department.
- [ ] Add an employee: **Add user** (allowed roles only).
- [ ] Set someone's login password: open the employee, **Set login password** (allowed roles only).

## Availability (attendance and leave)
**What it is:** who is present, absent, on half day or remote, and leave applications.
- [ ] Apply for leave: open Availability, choose **Apply leave**, enter the dates and reason, press **Submit leave**.
- [ ] See my leave requests and their status: open Availability and choose **Leave summary**. *(changed in Phase 9; it used to say "the leave section")*
- [ ] Mark a day: choose Present, Absent, Half day or Remote for that date.
- [ ] Approve or reject leave (people who review leave): open Availability and choose **Review requests**. *(added in Phase 9)*

## Reports
**What it is:** fixed reports for your level, and private CSV downloads.
- [ ] See a report: open Reports, tap the report, pick dates (Today, Last 7 days, Last 30 days, This month, or From/To) and any Branch, Department or Status filter.
- [ ] Download a report: press **Export CSV**. It appears under **Your exports** (Waiting, then Preparing), usually within a minute; press **Download** when Completed.

## CRM
**What it is:** client records, walk-ins, interactions and follow-ups, for CRM users.
- [ ] Find a client: open CRM and search by name or client id.
- [ ] Record a walk-in or follow-up: use the walk-in and follow-up screens in CRM.

## Dropdown Master
**What it is:** the shared option lists used across JewelOS.
- [ ] Add an option: open the list, press **Add item**.
- [ ] Hide an option without deleting it: mark it **Inactive**.

## Settings
**What it is:** your own preferences and, for allowed roles, company defaults and permissions.
- [ ] Change the theme or table density: open Settings and change your preferences.
- [ ] Manage permissions: Settings, then **Open permission management** (Super Admin only). *(changed in Phase 9; it used to say "Settings > Permissions")*

## Ask Kiara itself *(rewritten in Phase 9)*
**What it is:** answers about your own work, your Dashboard, Task Control and Reports numbers,
colleagues' names and roles, CRM clients (for CRM users), company SOPs with their source, and
how to use JewelOS. It never shows more than your own screens show you. Kiara only answers;
it never does anything in JewelOS.
- [ ] Ask: type in the box at the bottom and press Send. English, Hindi and Hinglish all work.
- [ ] Ask by voice (if the mic is shown): tap the mic next to Send, speak, tap stop, check the words, press Send.
- [ ] Questions left today: the counter at the top of Ask Kiara shows it and when it resets (midnight India time).
- [ ] Where an SOP answer comes from: tap the source chip under **Sources** to open that SOP section.
- [ ] When Kiara can't answer a company question: press **Ask a person** under the answer to send it to your manager. The answer comes back in the same chat, with a notification.
- [ ] Answer a question someone sent you (managers): open **Questions for you**, type the answer, press **Answer**.
- [ ] Start fresh: press **New chat**. Old chats stay in the list on the left (under **Chats** on a phone).
- [ ] Ask about a team or branch: Kiara answers from the same Dashboard, Task Control, Reports and leave screens you can open. If you can't open a screen, Kiara says so.

---

## Not covered (Kiara says it can't help)
- **Meeting AI** is only a menu name; there is no screen yet, so Kiara has no help for it.
- Anything that is a company rule rather than a button: that comes from the SOPs.


## FMS handoffs - 2026-10-22

FMS handoff update (2026-10-22): **Assign to a Different Employee** searches all
active, login-enabled users in the company, including management, across branches
and departments. Published fixed employees remain locked and availability
coverage still applies. This changes FMS recipients only. Ordinary Tasks scope
and management restrictions remain unchanged. No Kiara data tool is needed:
this explains the existing protected confirmation flow; Kiara remains read-only.

## Task editing - 2026-10-15

Task Control help now describes Edit task, Task/Checklist conversion, all authoring
requirements and participants, Save changes, retained history, and the separate
future schedule editor. No new read tool is needed: this is authoring guidance
for existing work; Kiara remains read-only through existing section tools.
