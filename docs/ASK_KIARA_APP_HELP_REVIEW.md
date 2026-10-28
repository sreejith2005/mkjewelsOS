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

Tasks entry updated against the screens: 2026-10-21 (Anytime duties, task order). Recurring / To-Do retired; its work moved to Tasks (Create Task scheduling) and Task Control (Review tab, Templates Next and Run now): 2026-10-21. Task Control: 2026-10-21 (Assign now is high priority). Home, Task Control (Delete) and Reports: 2026-10-21. Other entries last checked: 2026-10-14. FMS workspace implementation: 2026-10-21; local evidence is in the feature plan, not proof of deployment.

---

## Home (menu: Home)
**What it is:** your own work for today: open and overdue tasks, your FMS stages, forms to
fill, and recent activity.
- [ ] See today's work: open Home from the menu. Overdue items are listed first.
- [ ] Leaders: **Team today** shows Assigned, Done, Pending and Overdue for today; with no tasks of your own the top card shows **Team completion today**. Tap a person under **Needs follow-up** to open their tasks in Task Control.
- [ ] On mobile, **My Tasks** and **FMS Tasks** start collapsed with pending counts. Tap a heading to expand its work, then tap a task or stage to open it. Desktop starts expanded. No new Kiara read tool is needed; the counts use the existing Home summary.
- [ ] Fill a form linked to a task: use the form item on Home. It opens the exact form for that task.

## Dashboard
**What it is:** task, FMS and form numbers for your own scope and a period you choose, with
the formula behind each number.
- [ ] Change the period: pick today, this week, this month, etc. at the top of Dashboard.
- [ ] Understand a number: each card explains its formula.

## Tasks
**What it is:** work given to you, tasks you gave to others, and tasks you are watching.
- [ ] See my tasks: open Tasks. **My Tasks** lists recurring work; **FMS** lists your assigned workflow work by family and published stage; **Delegated** lists one-time assigned work for employees; **In Loop** lists watched work. Subsection counts load when Tasks opens.
- [ ] Work on FMS: Tasks -> **FMS** -> expand a workflow family -> expand a stage -> press the record's action: **Fill form**, **Start form** or **Open work** (**View** / **View details** for finished or waiting work). With only one workflow it opens by itself, and so does its stage when only one stage has work. **Active** counts pending and overdue actions. **Waiting** separates work awaiting other employees/approvals. Use name/reference search, workflow/stage/status/due filters and **Clear all**. Counts cover all assignments, not just a page. Access remains the current employee's existing scope.
- [ ] Do an anytime duty: duties without a fixed time (As Required, Per Customer, After Visit...) are under the **Anytime duties** bar at the top of My Tasks (Pending), closed until tapped; low priority with no deadline; they come back every day. Press **Start** whenever you do one; it opens as a low-priority task due tonight and also appears in the task list marked **Anytime duty**. **Continue** opens one already open. A duty a manager assigns appears as a high-priority task.
- [ ] Task order: earliest due date first; at the same due time, high before medium before low. Overdue: longest overdue first. Completed: most recent first.
- [ ] Complete a task: finish the required form or upload, then press **Complete**. Tasks do not ask for a completion remark. Tasks that need a form show **Fill form** on the card; FMS stages without a form show **Open work**. FMS work opens its protected workflow runner.
- [ ] Complete a checklist: until every required item is ticked the card shows **Checklist**, which opens the checklist at the top of the task. Tap each step to tick it; the tick shows at once and saves in the background. Steps unlock in order; tapping a locked step says which step to tick first. Then press **Complete task** under the checklist. A task cannot be completed while a required step is unticked.
- [ ] Remarks: an In Loop person writes in **Remarks** to leave a note; the doer sees it once one exists and can reply.
- [ ] Create a task: in Tasks press **Create Task**, fill in the title, pick one or more people under **Users**, set the due date, optionally add several people under **In Loop**, then press **Assign Task**. With several users, choose **Separate task for each user** (everyone completes their own copy) or **One shared task** (any one of them completes it for all; same branch and department only).
- [ ] See tasks I gave to others: **Delegated** in Tasks.
- [ ] Make a recurring task (all active task authors): **Create Task** → **Schedule** → **Recurring**, choose **Repeats**: **Daily**, **Weekly**, **Monthly**, **Quarterly**, **Annually** or **Custom**. Set **Starts on**, **Start time**, **Due time**; **End schedule** and **View upcoming dates** are expandable. Press **Create schedule**; each chosen person gets their own schedule. Assignment permissions and recipient scope still apply; template management access is unchanged.
- [ ] Make an anytime duty (all active task authors): **Create Task** → **Schedule** → **As needed**, enter when it applies (for example Per Customer), press **Create duty**.
- [ ] Phone creation: full-screen form follows the visible keyboard viewport. **Users** has search, selected people and **Done**. **Due Date** has **Today**, **Tomorrow**, separate **Due date** and **Due time**, and **Done**. Voice **What to say** shows larger headings with Required/Optional labels and the example, without the per-field explanations. No new Kiara read tool is needed: these are authoring controls over existing task data; Kiara remains read-only.
- [ ] Add many tasks at once: **Bulk Import** in Tasks (only roles that can assign work).
- [ ] See people with no work given: **Assigning Left** in Tasks (only roles that can assign work).

## Recurring / To-Do (retired 2026-10-21)
The page is gone. Recurring work is created from **Create Task** and managed in **Task Control**. Old /recurring-todo links open Task Control → Review for admins, Task Control → Tasks for managers and HR, and Tasks for everyone else. Kiara no longer offers this section.

## Task Control (for managers)
**What it is:** team progress, overdue work, evidence review and task templates.
- [ ] Check team progress: open Task Control and choose the dates and department.
- [ ] Review evidence: open the evidence panel in Task Control.
- [ ] Edit one task: **Edit task** changes Task/Checklist type, requirements, participants, dates, categorization and checklist items. Press **Save changes**. History is retained; future schedules have their own editor.
- [ ] Change a schedule: edit the template and press **Save schedule**.
- [ ] Delete work: in Tasks press **Delete** (also for CRM tasks), then **Confirm deletion**. FMS work: **Delete FMS task** cancels that whole FMS run (completed steps and history kept); **Delete start form** removes one person's pending start form. A reason is required. Several at once: tick rows (open FMS work included) or **Select this page**, then **Delete selected** or **Delete all matching**, then **Confirm deletion**.
- [ ] Check recurring work (admins): **Review** tab. **Verification** (Verify / Reject with a reason), **Rejected**, **Overdue**, **Coverage Required**, **Manager Review**, **Follow-ups** (Follow up) and **Performance**; the tiles at the top open the matching list.
- [ ] Manage schedules (admins): **Templates** rows show how often each repeats and its **Next** date (or Ended). **Edit** (future occurrences only), **Run now**, **Deactivate**/**Activate**, **Delete**.
- [ ] Anytime duties: Templates rows with status **ON DEMAND** (frequency such as PER CUSTOMER) have no date; employees always see them as low priority under **Anytime duties**. **Assign now** enforces one as a high-priority occurrence due today.

## FMS (workflows)
**What it is:** company workflows: live workflows, the stages given to you, and, for people
who build workflows, the designs.
- [ ] Do my stage: open it from Home or Tasks. The steps at the top are **Read previous details**, **Complete your work**, **Review next assignment** and **Confirm**. Read **Your step** (what to do, when it is due) and **Previous form answers**, press **Continue to stage form** (or **Continue to stage**). **Before you complete this step** lists anything missing. Press **Fill the form**: it opens on the same page below the earlier answers. While filling, **Earlier answers** (clock button beside Submit on a phone) shows them again; **Back to my form** keeps typed answers. Submitting also completes the step. Then check who receives the next step and confirm.
- [ ] Start a workflow: open FMS, choose the workflow, press **Start instance** (if your role may start it).
- [ ] Design a workflow: **New workflow** in FMS (workflow builders only).
- [ ] Build on the canvas (updated 2026-10-24, FMS Builder 3.0): the canvas is the only builder view on computers and phones (**Guided Mode** and the Normal/Decision step choice are gone). **Select mode** (drag empty space to box-select) and **Hand mode** (drag to move around; phones start here) sit at the top right with zoom, **Fit workflow to view** (key 1), **Auto-arrange workflow** and **Canvas tips**. Space+drag or middle-drag pans; the wheel or a pinch zooms. **Add Step** adds one unified step. Clicking a step opens its settings (bottom sheet on phones).
- [ ] Select, copy, paste (2026-10-24): Shift/Ctrl+click or long-press (Select mode, phone) builds a selection; the bar above it offers **Copy selected steps**, **Duplicate selected steps**, **Cut selected steps**, **Delete selected steps**, **Clear selection**; right-click offers the same plus **Paste here**. Shortcuts Ctrl+C/X/V/D/A, Delete, Ctrl+Z/Ctrl+Shift+Z, Esc work only when the canvas has focus (never in text fields). Copies get new keys and route ids and keep internal connections; outside connections are removed and reported. Paste works across workflows in the same tab. Multi-delete asks once and does not reconnect other steps; the Start form stays.
- [ ] Connections (2026-10-24): clicking a line highlights only that connection and shows **Edit route**, **Change destination**, **Route details**, **Delete route**.
- [ ] Questions & Form (2026-10-24): **Create questionnaire**, **Import section**, **Link existing form**, **No questionnaire**. The questionnaire editor opens over the canvas with a side-by-side live preview; **Save draft** keeps work on the step, **Use in workflow** publishes and pins it. Linked steps show **Edit** / **Edit a copy**, **Preview**, **Change source**, **Remove**, and **Discard changes** for an unpublished draft (also listed under **Publish readiness**). Stage questionnaires are real Forms, hidden from the staff Forms Library.
- [ ] One Form section in a step: **Link existing form** -> choose the form -> **The doer answers** -> **Only <section>**. Starting Form always whole. Section problems appear under **Publish readiness**.
- [ ] Import / Export (2026-10-24): toolbar **Import / Export**. Export: entire workflow or selected steps as MK Jewels FMS JSON (design only). Import: JSON file, **Paste JSON**, or **From another FMS**; preview, then **Add to this workflow** / **Use as this workflow**. Always a draft; n8n files refused.
- [ ] Step settings layout (2026-10-24): **Questions & Form**, **Routing** (**Next step**, **Add condition**, **Otherwise go to**) and **Assigned to** first; **Task naming**, **When / Deadline** (switch **Set deadline**, off for new steps; then pick **Completion date**, **TAT (hours)**, **Days before date** or **Specific clock time**), **Instructions**, **Checklist**, **Completion controls**, **Run this step only if** (legacy decisions only), **Advanced settings** collapsed. Older Decision Steps keep **Outcome choices** under Routing.
- [ ] (2026-10-26) **Otherwise go to** is optional: an answer that matches no condition, with Otherwise left as **Complete workflow here**, completes the workflow. **Assigned to from the previous form** follows that form's Assigned To question, or its only employee question (any name); otherwise the same employee is suggested, and the employee finishing the step can keep them or choose another eligible employee (0348).
- [ ] Kiara tool decision (2026-10-24): no new Kiara read tool. These are builder screens; FMS definitions are not a Kiara data source and Kiara stays read-only.
- [ ] Name workflow work: in the initial form's **Task Naming**, use **Task name from** to choose an eligible question from the linked form or its selected record-name question. Later stages inherit the original name unless overridden; changes use the usual revision/publication lifecycle.
- [ ] AI assistant (one chat, 2026-10-28; off until an administrator switches it on): inside the builder press **AI assistant**; ask it to build, change, check, fix or explain the workflow. Changes show as **Review the changes** / **Preview this fix** and need **Apply to editor**; nothing is saved until **Save draft** / **Publish**; **Undo** reverts. **New workflow** always starts with naming (no **Build with AI** choice); live workflow cards have no **Ask AI** button.
- [ ] Switch the assistant: administrators press **AI assistant** (settings) in FMS: one switch, **Turn on the AI assistant**, plus the daily limit. Kiara only describes it; Kiara has no tool for the FMS assistant and stays read-only.

## FMS work (my assigned stages)
**What it is:** the workflow stages and starting forms waiting for you.
- [ ] Open a stage: tap it from Home or Tasks. It opens that exact stage. **My work** at the top goes back to Tasks.

## Forms Library
**What it is:** published forms you can fill, and forms you sent.
- [ ] Edit with a live preview (2026-10-24): the form editor shows the real form beside the questions on wide screens (**Live preview**, **Desktop preview** / **Mobile preview**, **Start preview again**, **Hide preview** / **Show preview**); on phones press **Preview form** and **Edit** to switch. Every change shows immediately; sample answers are never submitted.
- [ ] Fill a form: open Forms Library, find the form under **Forms to fill** (or **Search forms**), press **Fill form** (full screen on a phone). Questions marked * must be answered (the bar at the top counts them). Long forms go one step at a time with **Next** / **Back**; tap an earlier step to change it, and open **Check your answers before submitting** on the last step before **Submit form**. A missing answer is marked in red under its question. Choice questions may end with **Other**: pick it and type an answer.
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

- [ ] Returning-client prefill (2026-10-23): **REGISTER CLIENT ENTRY** uses the most recently visited profile for the full phone number. Profile details accumulate from saved answers; newer nonblank answers win conflicts, while blanks preserve known details. Client profiles use the same details. Original client records and visit histories are retained. This repairs existing CRM reads; Kiara needs no new read tool.
**What it is:** client records, walk-ins, interactions and follow-ups, for CRM users.
- [ ] Read profile histories: **Complete contact history**, **SAVED WALK-IN DETAILS & MEDIA** and **PROFILE EDIT LOG** show five expandable entries initially. **Show more** reveals more loaded entries; existing history page links reach older pages. Walk-ins have grouped saved answers and **Media**. Edit entries compare **Before** and **After**. **Add a contact** opens the existing contact form. No new Kiara data tool is needed: this changes the presentation of existing CRM reads only.
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

## FMS tab and handoff default - 2026-10-23

Tasks -> FMS lists only stages that hold the user's work; the start form is not a
stage (a pending starter assignment shows as **Form to start**). When no employee
is set for the next step, the confirmation keeps it with the person completing the
work (shown with "(you)"); **Assign to a Different Employee** opens the list inside
that step and **Keep it with me** undoes a change. The server still validates the
recipient. No new Kiara read tool: the data shown is unchanged.
### Forms Library visibility (2026-10-23)

- [ ] Authors can use **Visible in Forms Library** on each form version. Hidden forms stay available in assigned Tasks/FMS and existing submission history, while staff cannot browse or fill them independently. Authors retain management access. Existing forms start visible; revisions and duplicates inherit visibility.
- No additional Kiara read tool: existing app help explains this setting without a new data source. Local implementation is not evidence of production deployment.

## FMS work page - 2026-10-23 (lean page)

The assigned-work page shows the record name, due time / instructions when set,
and **Previous form answers**; the workflow, stage, reference, assignee and the
four-step bar are no longer repeated. After confirming, the employee returns to
Tasks -> FMS with a short notice instead of a result page. Kiara's "Do my
assigned stage" recipe is updated. No new read tool.

### Forms usability (2026-10-27)

- [ ] **Forms Library**: forms show as cards with **Fill form**; authors see each version with a **Live** / **Draft** / **Archived** label and the existing actions. **My submissions** lists submissions by date and status.
- [ ] **Other answers**: form authors tick **Add an "Other" choice** on a Dropdown, Radio Group or Checkbox question; people filling the form pick **Other** and type their answer, which is saved as the answer itself.
- [ ] **Assign to a Different Employee** lists eligible employees A to Z.
- [ ] Assigned FMS stage forms open on the work page below **Previous form answers**, with **Earlier answers** while filling.
- [ ] (2026-10-28) **Forms to fill** has two buttons: **Forms Library** (default, forms made in the library) and **FMS workflow forms** (questions built inside FMS steps, labelled with workflow and step for authors). Each shows a count; search works inside the chosen group.
