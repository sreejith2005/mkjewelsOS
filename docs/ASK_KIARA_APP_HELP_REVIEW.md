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

Tasks entry updated against the screens: 2026-10-21 (Anytime duties, task order). Recurring / To-Do retired; its work moved to Tasks (Create Task scheduling) and Task Control (Review tab, Templates Next and Run now): 2026-10-21. Task Control: 2026-10-21 (Assign now is high priority). Home and Task Control (Delete): 2026-10-21. Reports: 2026-11-02 (Business Reports 2.0). Users (Section access for everyone, automatic franchise scope) and Task Control (Anytime duties chip): 2026-11-07. Tasks, Task Control and FMS builder deadline wording: 2026-11-03 (half-day deadlines, 0371). Other entries last checked: 2026-10-14. FMS workspace implementation: 2026-10-21; local evidence is in the feature plan, not proof of deployment.

---

## Store Intelligence (menu: Store Intelligence; path /sales-recording; pilot needs server configuration and permission)
Updated 2026-11-06 for the Store Intelligence workspace (migration 0383), its CRM, Tasks/FMS and outcome integration (migration 0384, CRM 20261106000200) and Insights analytics (migration 0389; still no Kiara read tool).
- [ ] Tabs: **Today**, **Conversations** for everyone; **Coaching**, **Insights**, **Devices** for managers with **Review branch recordings**; **Settings** for managers and admins. Opening a manager tab by URL as a salesperson shows "That view is for managers" and Today.
- [ ] **Today**: **Start conversation**, **Recorded today**, **Processing**, **Ready**, **Needs attention** (tap to open the filtered list), **My coaching** (**Doing well**, **Work on**, **Try this**), **Next actions** with **Create follow-up task**. Managers see the review count with **Review now**.
- [ ] Recording: salesperson fixed from sign-in, **Customer (optional)** CRM walk-in, consent tick box, **Start recording**; then timer, **Microphone level**, connection line, **Pause** / **Resume** / **Finish**, **Retry upload**, **Live transcript** (**Show**). **Saving�** until every upload is acknowledged; **Saved** with **Open conversation** only after the server confirms. Blocked microphone, offline and unsupported-browser notices appear before Start.
- [ ] **Conversations**: day groups, search box, **Filters** drawer (Date, Salesperson, Status, What the customer said happened, Score, Length, Product mentioned, Only CRM-linked walk-ins, Only flagged) ? **Show results**; removable chips, **Clear all**, **Load more**. Filters are kept in the link.
- [ ] Conversation: score with Strong / Good / Needs work, outcome "from the conversation", **Customer details** drawer (**Link walk-in**), tabs **Summary**, **Transcript**, **Coaching**, **Actions**. Managers get the player (**Play**/**Pause**, **Back 10 seconds**, **Forward 10 seconds**, position slider, 1ז2� speed); every listen is audited; salespeople cannot play audio.
- [ ] **Transcript**: **Search transcript** with match count, Readable / Original language / English, versions, speaker names only when confident. Managers: **Correct transcript** ? **Save correction**, **Transcribe audio again**.
- [ ] **Coaching** tab: **Scores by area** (**Expand all** / **Collapse all**), **Done well**, **To improve**, **Try saying**, **SOP checks**; managers' **Manager review**: **Approve**, **Flag** / **Remove flag**, **Comment**, **Edit scores** ? **Save manager scores**, **Request rescore**. Staff see reviews only after approval or edit.
- [ ] Outcome labels: **Converted (AI-suggested)** / **Not converted (AI-suggested)** / **Follow up (AI-suggested)** / **Unknown (AI-suggested)** beside the CRM result **Pending CRM confirmation** / **Purchase confirmed in CRM** / **No purchase in CRM yet** / **No purchase recorded in CRM**; status lines **Client match**, **CRM activity**, **Task / FMS**, **Notification**.
- [ ] **Customer details** › **Link customer**: search **Client code, visit reference or full phone number** (no name search) › choose when several people share a number › **Link this customer**; **Waiting for CRM to confirm** until the CRM accepts (**Confirmed by CRM**, **Shown in the CRM history**); failures say **Could not reach CRM yet, retrying** / **Sending to CRM failed** / **Waiting for a CRM administrator to allow JewelOS** with **Send again**; **Open CRM profile** only once confirmed; **Change customer** and **Remove link** need a reason; **Earlier links**.
- [ ] **Actions** tab: **Review follow-up** › **Task title**, **Recommended follow-up** (Phone call / WhatsApp message / Invite for a store visit / Other follow-up; nothing is sent), **Owner**, **Due day** + **First half (3 PM)** / **Second half (9 PM)**, **Coaching reminder (optional)**, **Start an FMS workflow instead (optional)**, **Note** › **Create task** / **Start workflow**; then **Follow-up created**; **Follow-ups** list with **Open task** / **Open FMS work**. One piece of work per suggestion, even after a rescore. Managers can **Approve review** here. **Today** › Next actions › **Review follow-up**.
- [ ] **Coaching** (managers): **Waiting for your review**, **Team priorities**, **People**, **Flagged conversations**, **Strongest examples**, **Follow-up effectiveness**, **Coaching notes**; 7 / 30 / 90 days.
- [ ] **Insights** (migration 0389): period **Today** / **This week** / **This month** / **Custom** (**Apply dates**); **Filters** (**Branches** only with **See Store Intelligence analytics for every branch**, **Salespeople**, **Phone**, **Product type**, **Metal or design**, **Product words**, **Status**, **What the AI heard**, **CRM outcome**; **Apply** / **Clear all**; removable chips). Views **Overview**, **Conversations**, **Device time**, **Sales & Demand**, **Coaching**, **Customer Insights**, **Leadership**, **Rankings**. Each figure: i button (meaning, calculation, period, India time), tap the number for the conversations behind it (**Load more**, **Open** own branch only). Freshness line; **Too few** under 5; **No data** with no denominator; removed-after-retention counted apart; unlinked customers are unknown, not lost. Sales & Demand: **Conversation stages**, **Visits by day and hour**, **Top product requests**, **Conversion by product type**, **Branches compared**, **Revenue** (Verified revenue not available; Estimated revenue and **Opportunity at risk (hypothetical benchmark)** only with an average ticket). Coaching: **Areas needing coaching**, **Area trend by week**, **Performance tiers**, **Score vs confirmed conversion**, **What good looks like**. Leadership: **Branch priorities**, **Branches**, **Data quality**. Rankings: **Salespeople** / **Branches** by **Confirmed conversion** / **Average score** / **Conversations**, with **Not ranked**.
- [ ] **Devices**: statuses **Interrupted**, **Recording now**, **Paused**, **Saving**, **Not recording**, **Not seen recently**; last contact; today's recordings; **Previous** / **Next**; no battery or location.
- [ ] **Settings**: **Who can record** (**Change**, Super Admin only), **Consent**, **Privacy**, **Sales score settings** (analysis on/off, rubric and SOP versions), **CRM outcomes** (**Change**, Admin / Super Admin: attribution days, average ticket), **Integrations** (managers), **System health**.
- [ ] CRM client history: read-only **Store conversation** entry (under Store visits) with **Open conversation**; no audio or transcript in the CRM.
- [ ] No Kiara read tool (re-decided 2026-11-06 for migration 0384): recording, transcript, score, customer-link and outcome data stay outside Kiara (sensitive customer conversations; a link names a customer). Kiara explains controls only and cannot read or change recordings. Store-conversation follow-up tasks are ordinary Tasks, so Kiara's existing task tools already see them for their owners, under the existing Tasks authorization.
## Home (menu: Home)
**What it is:** your own work for today: open and overdue tasks, your FMS stages, forms to
fill. Overdue and high-priority tasks appear under **Needs attention now** (2026-11-04: the Recent Activity panel was removed from Home).
- [ ] See today's work: open Home from the menu. Overdue items are listed first.
- [ ] Leaders: **Team today** shows Assigned, Done, Pending and Overdue for today; with no tasks of your own the top card shows **Team completion today**. Tap a person under **Needs follow-up** to open their tasks in Task Control.
- [ ] Under **Your work**, Home shows three cards: **Daily Checklist**, **My Tasks** and **FMS Tasks**, each with a count and overdue total. On a phone, swipe between them or tap Checklist / My Tasks / FMS at the top (a red dot marks overdue work); tap a task to open it, or **Open all tasks** / **Open FMS tasks** for the full list. On a computer the cards sit side by side. No new Kiara read tool is needed; the cards use the existing Home summary (2026-10-31).
- [ ] Fill a form linked to a task: on Home the task shows a **Form: form name** tag; tap the task to open it and fill the form.

## Dashboard
**What it is:** opens on **Employee performance** (2026-11-05): your assigned tasks and FMS steps due in a
period, completed / pending / in progress / overdue, on time / late, and the Task Control scores.
Leaders granted **View every employee's task performance** switch to **All employees**. The earlier
views are under **Management insights**.
- [ ] Change the period: **Today**, **This week**, **This month**, **Week**, **Month**, **Year**, **Custom** at the top. Week/Month/Year cover the whole chosen week (Mon–Sun), month or year; India time.
- [ ] Scores: **Work not done %** = completed ÷ assigned × 100 − 100 (75 of 100 → −25.0%); **Work not done on time %** = on time ÷ completed × 100 − 100 (40 of 50 → −20.0%). Nothing assigned → **No data**. Same numbers as Task Control and Reports › Employee Task Performance.
- [ ] Every number opens its records (same assignments it counted), with deadline, completion time, overdue/late duration and a link to the task or FMS step.
- [ ] **Task work lifecycle** shows completed + remaining = assigned; **Outside the score** lists rejected/skipped/stopped/cancelled work, overdue from before the period and waiting FMS start forms.
- [ ] Leaders: **Employee task performance** table (search, sort, **View all**, click a name for detail, **Export this report**), **FMS performance** with **Stages**, comparison charts. **Employee accountability** (CRM access) shows the CRM sales and calling reports; calls and sales are not tasks.
- [ ] Kiara: no new read tool in this change; Kiara's dashboard tool still reads `get_dashboard_metrics`, which this change does not alter, so Kiara can explain the new screen but not yet quote its employee table. Candidate follow-up: a read-only tool over `get_task_performance_dashboard_v1` called as the asker, offered with `dashboard.view` (team scope only with `dashboard.view_team_performance`), with allowed and denied eval cases.

## Tasks
**What it is:** work given to you, tasks you gave to others, and tasks you are watching.
- [ ] See my tasks: open Tasks. **My Tasks** lists recurring work; **FMS** lists your assigned workflow work by family and published stage; **Delegated** lists one-time assigned work for employees; **In Loop** lists watched work. Subsection counts load when Tasks opens. FMS defaults to **Overall**, including undated and future assigned work; other subsections default to **Today**. An explicitly selected date scope stays selected across categories, with counts and drilldowns on that same scope. Home's **Open FMS tasks** opens this FMS list. No new Kiara read tool is needed; existing Tasks reads are unchanged (2026-11-02).
- [ ] Work on FMS (2026-10-30 board): Tasks -> **FMS** lists each workflow with active, overdue and due-today counts. Tap one to open its board: one column per step with pending/overdue/today counts, task cards below (customer, REF, due date and time, priority, Visit 2+). Overdue first, then due today, upcoming, no date. Toolbar: **Search customer or reference**, **All / Overdue / Due today / Upcoming**, **Priority**, **Sort** (Due soonest / Highest priority), **Show** (To do / Waiting for others / Done), **Refresh**; managers also **Whose work** (My work / My team) and **Employee**. **Show 20 more** pages a column. On a phone one step at a time via the step buttons. **All FMS workflows** goes back; finishing a task returns to the same board. FMS card **Tasks** opens the same board; **Runs** opens runs and outcomes.
- [ ] Do an anytime duty: duties without a fixed time (As Required, Per Customer, After Visit...) are under the **Anytime duties** bar at the top of My Tasks (Pending), closed until tapped; low priority with no deadline; they come back every day. Press **Start** whenever you do one; it opens as a low-priority task due tonight and also appears in the task list marked **Anytime duty**. **Continue** opens one already open. A duty a manager assigns appears as a high-priority task.
- [ ] Half-day deadlines (2026-11-03, 0371): two fixed deadlines, **First half** 3:00 PM and **Second half** 9:00 PM India time. Work with no due date of its own (new FMS step with no form date, start form, CRM walk-in task, manager-assigned duty without a time) is due 9:00 PM the same day if it arrives before 3:00 PM, otherwise 3:00 PM the next day; weekends are not skipped. Due times on 3:00 PM / 9:00 PM show "· First half" / "· Second half". No new Kiara read tool is needed; existing task and FMS reads return the stored deadline.
- [ ] Task order: earliest due date first; at the same due time, high before medium before low. Overdue: longest overdue first. Completed: most recent first.
- [ ] Complete a task: finish the required form or upload, then press **Complete**. Tasks do not ask for a completion remark. Tasks that need a form show **Fill form** on the card; FMS stages without a form show **Open work**. FMS work opens its protected workflow runner.
- [ ] Complete a checklist: until every required item is ticked the card shows **Checklist**, which opens the checklist at the top of the task. Tap each step to tick it; the tick shows at once and saves in the background. Steps unlock in order; tapping a locked step says which step to tick first. Then press **Complete task** under the checklist. A task cannot be completed while a required step is unticked.
- [ ] Remarks: an In Loop person writes in **Remarks** to leave a note; the doer sees it once one exists and can reply.
- [ ] Create a task: in Tasks press **Create Task**, fill in the title, pick one or more people under **Users**, set the due date, optionally add several people under **In Loop**, then press **Assign Task**. With several users, choose **Separate task for each user** (everyone completes their own copy) or **One shared task** (any one of them completes it for all; same branch and department only).
- [ ] See tasks I gave to others: **Delegated** in Tasks.
- [ ] Make a recurring task (all active task authors): **Create Task** → **Schedule** → **Recurring**, choose **Repeats**: **Daily**, **Weekly**, **Monthly**, **Quarterly**, **Annually** or **Custom**. Set **Starts on**, **Start time**, **Due time**; **End schedule** and **View upcoming dates** are expandable. Press **Create schedule**; each chosen person gets their own schedule. Assignment permissions and recipient scope still apply; template management access is unchanged.
- [ ] Make an anytime duty (all active task authors): **Create Task** → **Schedule** → **As needed**, enter when it applies (for example Per Customer), press **Create duty**.
- [ ] Phone creation: full-screen form follows the visible keyboard viewport. **Users** has search, selected people and **Done**. **Due Date** has **Today**, **Tomorrow**, separate **Due date** and **Due time**, and **Done**. Voice **What to say** shows larger headings with Required/Optional labels and the example, without the per-field explanations. No new Kiara read tool is needed: these are authoring controls over existing task data; Kiara remains read-only.
- [ ] Add many tasks at once: **Bulk Import** in Tasks (only roles that can assign work). TASK FREQUENCY can name a half ("Daily - First Half", "Second Half", "First & Second Half"): First Half rows are due 3:00 PM, Second Half rows 9:00 PM, replacing any other DUE TIME (a warning says so).
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
- [ ] Reassign work (2026-11-02, 0369; administrators): Task Control > Tasks: **Reassign selected** / **Reassign all open work**; **Move work from**, groups **Open tasks due today or later**, **Overdue tasks**, **Open FMS steps**, **Recurring schedules**, **Move work to**, **Reason (required)**, then **Reassign N items**. Every date is included; completed work stays; skipped items are listed; one summary notification.
- [ ] Check recurring work (admins): **Review** tab. **Verification** (Verify / Reject with a reason), **Rejected**, **Overdue**, **Coverage Required**, **Manager Review**, **Follow-ups** (Follow up) and **Performance**; the tiles at the top open the matching list.
- [ ] Manage schedules (admins): **Templates** rows show how often each repeats and its **Next** date (or Ended). **Edit** (future occurrences only), **Run now**, **Deactivate**/**Activate**, **Delete**.
- [ ] Anytime duties in Task Control (2026-11-07): **Tasks** > **Anytime duties** chip lists the standing as-needed duties for the current filters (even unstarted ones), with **Assign now**, **Edit** and **Delete**. Kiara: no new read tool (same template directory as Templates).
- [ ] Anytime duties: Templates rows with status **ON DEMAND** (frequency such as PER CUSTOMER) have no date; employees always see them as low priority under **Anytime duties**. **Assign now** enforces one as a high-priority occurrence due today.

## FMS (workflows)
**What it is:** company workflows: live workflows, the stages given to you, and, for people
who build workflows, the designs.
- [ ] Routing editor (2026-10-29): **Add condition** opens the new condition at the top; other editors collapse into condition/destination summaries. Click a row to edit. **Then go to** appears before answer choices. Display is reversed; **If 1** is still evaluated first, and only the arrows explicitly change priority. Canvas **Edit route** and readiness issues reveal the exact condition. No new Kiara read tool is needed for these presentation controls.
- [ ] Do my stage: open it from Home or Tasks. The steps at the top are **Read previous details**, **Complete your work**, **Review next assignment** and **Confirm**. Read **Your step** (what to do, when it is due) and **Previous form answers**, press **Continue to stage form** (or **Continue to stage**). **Before you complete this step** lists anything missing. Press **Fill the form**: it opens on the same page below the earlier answers. While filling, **Earlier answers** (clock button beside Submit on a phone) shows them again; **Back to my form** keeps typed answers. Submitting also completes the step. Then check who receives the next step and confirm.
- [ ] Start a workflow: submit its starting form from the Forms Library (or the start form you were asked to fill).
- [ ] Design a workflow: **New workflow** in FMS (workflow builders only).
- [ ] Per-workflow access (2026-11-07, 0390): card **⋯** › **Access** (workflow builders) › search a person › **View only** / **Edit** / **Edit and publish** › **Give access**; **People with access** lists each person with a level selector and **Remove**. View-only people see **View workflow** and a builder marked **View only** (no Save draft, Publish, Add Step, Undo/Redo, Import / Export). Edit has no Publish. Running work unaffected.
- [ ] Kiara tool decision (2026-11-07): no new Kiara read tool. Access grants are an administration screen; Kiara stays read-only and never changes access.
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

- [ ] End Nodes (2026-10-30, 0358; updated same day): no separate Add End button. Open a last step and tick **End the workflow here (End Node)**; settings **Node name**, **End type** (Won, Lost, Do not contact, Other closure), **Closure reason code**; untick to make it a normal step. Canvas markers: **End Node · closes automatically** and **Last step · needs Mark as done**. Route destinations show **End: <name>**.
- [ ] Workflow workspace (2026-10-30, 0359): FMS card counts **Running**, **Won**, **Lost**, **Other endings**; **Tasks** opens one page with **Reporting period**, counts (Started, Running, Won, Lost, Do not contact, Other endings, Completed, Cancelled, Conversion), **Endings and step reach**, **Search customer or reference**, Status / Step / Employee / Show filters, and each run's **Work to do**, **Journey** and **Step details and saved answers**. My Stages / Started by Me / Branch View are gone.
- [ ] Kiara tool decision (2026-10-30): no new Kiara read tool now. Outcome counts come from `get_fms_flow_report` (section RPC, caller-scoped); a future Kiara tool could call it as the asker with the FMS permission. Kiara stays read-only.

- [ ] Delete a workflow (2026-11-02, 0365/0366): the red bin on an FMS card deletes the whole workflow, every version. Never run: permanent after a confirm. With runs: super admin only, the warning shows version, run and open-run counts and asks for DELETE; alerts are removed too; other builders archive it. Form answers stay in Forms. The bin beside a version under **Version history** removes only that version. Kiara tool decision: none; builder action, Kiara never writes.

- [ ] Start modes (2026-11-03, 0374): a new workflow asks **How does it start?**: **Start with Form** (unchanged), **Automatic Trigger** (no starting form) or **Manual Start Without Form** (a **Start** button on the FMS card asks for a title, an optional note and CRM client code). **Start trigger** in the builder toolbar (lightning button on a phone) changes it; published versions keep theirs.
- [ ] Automatic Trigger (2026-11-03): Source **CRM Walk-In Visit**, **CRM Client Queue Registration**, **CRM Lead Registration**, **CRM form (Form Builder)** or **Forms Library form**; **If** with **Add condition** / **Add group** (All of these (AND) / Any of these (OR)), **On** switch, arrows, bin; **Then start this workflow**: run title, **First step goes to**, **First deadline from**, **Repeat submissions**, **When the CRM closes the follow-up case**, **Copy into the workflow** (no phone numbers). **Test conditions** / **Load a recent submission** never create work. Canvas card **Automatic start** (WHEN / IF / START). Only submissions saved after publishing start runs.
- [ ] Trigger history (2026-11-03): managers press **Trigger history** in FMS: outcomes **FMS started**, **Not matched**, **Duplicate (run already open)**, **Other branch**, **Requires review**, **Failed**; 7-day counts; **Inspect**, **Retry**. Runs show **Started automatically** on the work page; CRM users get **Open CRM client profile**.
- [ ] Kiara tool decision (2026-11-03): no new Kiara read tool. Trigger configuration and history are builder/manager screens read through `get_fms_trigger_history` (fms.manage); trigger events can hold CRM answers, so a Kiara tool would need the CRM permission too. Revisit after the owner pilot.

## FMS work (my assigned stages)
**What it is:** the workflow stages and starting forms waiting for you.
- [ ] Open a stage: tap it from Home or Tasks. It opens that exact stage. **My work** at the top goes back to Tasks.

## Forms Library
**What it is:** published forms you can fill, and forms you sent.
- [ ] Edit with a live preview (2026-10-24): the form editor shows the real form beside the questions on wide screens (**Live preview**, **Desktop preview** / **Mobile preview**, **Start preview again**, **Hide preview** / **Show preview**); on phones press **Preview form** and **Edit** to switch. Every change shows immediately; sample answers are never submitted.
- [ ] Fill a form: open Forms Library, find the form under **Forms to fill** (or **Search forms**), press **Fill form** (full screen on a phone). Questions marked * must be answered (the bar at the top counts them). Long forms go one step at a time with **Next** / **Back**; tap an earlier step to change it, and open **Check your answers before submitting** on the last step before **Submit form**. A missing answer is marked in red under its question. Choice questions may end with **Other**: pick it and type an answer.
- [ ] Question layout (2026-11-04): one question after another, like Google Forms, on every screen (the earlier width setting is gone; saved widths are ignored). Each question in the editor shows how it will look (**Short answer**, **Phone number**, its choices). No Kiara tool needed.
- [ ] Client details fill in by themselves (2026-11-04): for people with CRM access, a phone number of a registered client or lead in any form fills the recognised questions; a pincode fills city, state and country; "Auto-filled from client history — editable". No setup per question. Kiara: no new read tool (the lookup runs as the person filling the form, through CRM's own rules).
- [ ] Client history from every form (2026-11-04): a submitted form whose phone number belongs to a registered client or lead appears in that client's **Customer journey** / **Workflow history** with all its answers; unknown numbers add nothing and create no client; profile details are not changed. No setup. Kiara: no new read tool (CRM history reads are unchanged).
- [ ] CRM questions (2026-11-04): **Repeating group (CRM)** ("How many?" question, **From** / **Up to**, **Also offer "NA"**, **Add a question per row**) and **CRM photo / video** (**Also accept videos**, **Files allowed**). The walk-in form's Salesperson / CRM questions list the branch's people automatically. Outside CRM a CRM photo question says "This question works in CRM forms only." No Kiara tool needed.
- [ ] CRM forms (2026-11-03): authors with CRM access get a **CRM forms** button under **Forms to fill** listing the forms CRM uses; edit/publish as usual; **Fill form** opens CRM registration. No Kiara tool needed.
- [ ] See what I sent: **My submissions** shows each one and whether it was reviewed.
- [ ] Make a form: **New form** (form makers only), then **Publish** when ready.
- [ ] Employees from other locations (2026-11-06, 0386): on a **Users** question, **Allow selecting employees from other locations** (off by default). Filling the form shows **Location**, **Store**, **Search employees**, the list, **Show more**, **Change**. Assigns work only where the FMS step assigns from that question; every cross-franchise choice is audited. Kiara: no new read tool (the picker reads only names and stores for the person filling the form; Kiara never assigns work).
- [ ] Share dropdown options (2026-10-28): on a Dropdown, Radio Group or Checkbox question, **Use existing Dropdown Master** picks a shared list; **Create new dropdown** + **Also add this dropdown to Dropdown Master** adds the new list when the form is saved (or at once with **Add now**). **Open in Dropdown Master** opens the list. No new Kiara tool: this is help text only.
- [ ] Set its naming default: in Form Builder use **Use this question as the record name**, or leave **Automatic**. A used published form needs a new revision to change its default; each workflow can override it in **Task Naming**.

## Notifications
**What it is:** your inbox of alerts about your work, such as new tasks.
- [ ] Open the work behind an alert: tap the notification.
- [ ] See unread alerts: the bell shows how many are unread.

## UI v2 (2026-11-04)
- [ ] Ask Kiara: chat list on the left (drawer on phones) with **Kiara tools** at its bottom for **Chat**, **Questions for you**, **Knowledge base**, **Insights**, **Limits** (permission-filtered). Kiara: no new read tool.
- [ ] FMS: one row per workflow; **⋯** holds Pause / Resume, Restore, Version history, Delete.
- [ ] Reports: categories and report chips (a **Report** list on phones) above a **Filters** bar; **Your exports** button in the header.

## Users
**What it is:** the employee list for the people you may see, and account tools for allowed roles.
- [ ] Find an employee (2026-11-04): one table of everyone (a list on a phone) with Branch, Department, Designation, Role, Phone, Status; **Search employees**, branch and department filters, **Show former employees**.
- [ ] Section access for everyone (2026-11-07, 0390; permission managers): Users > **Section access**. One row per employee, one column per section; each cell shows **On** / **Off** (with "inherited" when no individual choice) and the choices **Inherit** / **On** / **Off**; **All shown** at the top of a column sets it for the filtered employees; **Save changes** / **Discard**. Super Admin rows and your own row are locked. Kiara: no new read tool (permission configuration; Kiara stays read-only).
- [ ] Edit an employee: **Edit** on the row opens the editor with tabs **Employee details** and **Section access** (only with permission to manage permissions). Section-access-only managers see **Section access** on the row. Kiara: no new read tool (layout only).
- [ ] **Branches & departments** button at the top of Users opens the organization manager (administrators).
- [ ] Franchises (2026-11-06, 0385 + 0386; Super Admin): Users > **Franchises**. **Organisation** (each franchise with stores, employees per store, store manager), **Add franchise**, **Edit**, **Set franchise** on a store (Franchise, Location type, Reason), **Scope** (automatic since 0390: Admin and HR cover their own store's franchise, listed under **Automatic**; **Add extra scope** for exceptions: Employee, Authority: Director / Regional Admin / HR / Store Manager / Store access, Whole company, Franchise or Store, Reason), **Remove**, **Readiness** (with **Ready** / **Not yet** per section) and **History**. Isolation shows **Off** and cannot be switched on while a section is **Not yet**. Kiara: no new read tool (Super Admin configuration; Kiara stays read-only).
- [ ] Franchise filter (2026-11-06, 0386): Users gains a **Franchise** filter and column once franchises exist. Kiara: no new read tool (directory layout only).
- [ ] Add user in a franchise (2026-11-06, 0386): **Add user** asks **Franchise / location**, then **Store / branch**, then **Department**; one-franchise / one-store managers get theirs chosen. The employee editor shows **Franchise** read-only (moving franchise = Super Admin transfer). Kiara: no new read tool.
- [ ] Someone at another store (2026-11-07, 0387): Tasks > Create Task > **Users** > **Someone at another store** picks Franchise, then Store, then Employee for a one-time task (holders of `tasks.assign_cross_location` and `tasks.assign_others`; repeating schedules stay local). Kiara: no new read tool (the task appears in the assignee's and author's existing task tools).
- [ ] Franchise isolation (0387): Kiara's tools read through the asker's scoped section RPCs; eval cases `fr-*` with `eval.franchise.fixture.sql`. CRM customer data stays shared by every store (owner decision 2026-11-06). Kiara: no new read tool.
- [ ] Add an employee: **Add user** (allowed roles only).
- [ ] Set someone's login password: open the employee, **Set login password** (allowed roles only).
- [ ] Hand over work (2026-11-02, 0369; administrators): open the employee, **Reassign tasks** opens Task Control with **Reassign all open work** for them.
- [ ] Delete an employee (2026-11-02, 0368; Super Admin): open the employee, **Delete user**, confirm. Login locked for good, personal details wiped, gone from Users; past work shows **Removed employee**. Cannot be undone.

## Availability (attendance and leave)
**What it is:** who is present, absent, on half day or remote, and leave applications.
- [ ] Leave management (2026-11-04): the leave screens open from the **Leave management** button at the top of Availability, so the board comes first. Kiara: no new read tool (layout only).
- [ ] Apply for leave: open Availability, press **Leave management**, choose **Apply leave**, enter the dates and reason, press **Submit leave**.
- [ ] See my leave requests and their status: open Availability and choose **Leave summary**. *(changed in Phase 9; it used to say "the leave section")*
- [ ] Mark a day: the board is a table (a list on a phone); choose Present, Absent, Half day or Remote in the row, or **Mark absent**. The **Department** list beside the search focuses one department (2026-11-04 v2).
- [ ] Approve or reject leave (people who review leave): open Availability and choose **Review requests**. *(added in Phase 9)*

## Reports
**What it is:** the business reporting and export centre (Business Reports 2.0, 2026-11-02), limited to what you may see.
- [ ] Pick a category: **Customer & CRM**, **Forms, FMS & Tasks** or **Employee Performance**, then tap a report card. Customer & CRM, **CRM Performance** and **Salesperson Performance** show only with CRM access.
- [ ] Customer reports: **Customer Master Database**, **Customer 360° Journey** (search name, MKC ID, phone or Instagram ID, then tap the customer), **Leads and Enquiries**, **CRM Follow-ups**, **Lead Source and Conversion**.
- [ ] Form answers: **All Form Submissions**; choose a form in **Form** for one column per question; tap an answer (or **View all answers** on a phone) for every answer.
- [ ] FMS and tasks: **FMS Workflow Journey** (**Workflow summary** / **Stage-wise detail**), **FMS Stage Performance**, **Pending and Completed Tasks** (**Task type**).
- [ ] Filters: **All dates** (where offered), Today, Last 7 days, Last 30 days, This month, From/To, and only the filters that report uses. **How these numbers are counted** explains each count.
- [ ] Download a report: press **Export CSV** (every matching record). It appears under **Your exports** (Waiting, then Preparing); press **Download** when Completed. Customer exports also need CRM administrator access.
- [ ] Administrators: **Settings → Report diagnostics** has Notification delivery health and the CRM synchronization exceptions export.
- Kiara: no new read tool. The new reports are not offered to Kiara's `run_report` (pinned to the earlier work reports) until they have allowed and denied eval cases.

## CRM
- [ ] Archive / restore a client (2026-11-07, CRM 20261107000200; CRM Super Admin): profile **Archive client** › reason › **Archive client**; banner **This client is archived** with **Restore client**; Client Database filter **Archived** › **Active clients** / **Archived clients only**. Phone search still finds archived clients. Direct client deletion through the API is closed.
- [ ] Kiara tool decision (2026-11-07): no new Kiara tool; Kiara never archives or restores.

- [ ] Returning-client prefill (2026-10-23): **REGISTER CLIENT** (formerly REGISTER CLIENT ENTRY) uses the most recently visited profile for the full phone number. Profile details accumulate from saved answers; newer nonblank answers win conflicts, while blanks preserve known details. Client profiles use the same details. Original client records and visit histories are retained. This repairs existing CRM reads; Kiara needs no new read tool.
**What it is:** client records, walk-ins, interactions and follow-ups, for CRM users.
- [ ] Read profile histories: **Customer journey** (filters **All**, **Store visits**, **Enquiries & leads**, **Calls & follow-ups**, **FMS work**, **Engagement asks**, **Profile edits**), **SAVED WALK-IN DETAILS & MEDIA** and **PROFILE EDIT LOG** show five expandable entries initially. **Show more** reveals more loaded entries; existing history page links reach older pages. Walk-ins have grouped saved answers and **Media**. Edit entries compare **Before** and **After**. **Add a contact** opens the existing contact form. No new Kiara data tool is needed: this changes the presentation of existing CRM reads only.
- [ ] CRM inside JewelOS (2026-11-03): CRM opens in the normal JewelOS layout; the JewelOS menu stays available. CRM sections: **REGISTRATION**, **CLIENT QUEUE**, **CLIENT DATABASE**, **DASHBOARD**, **NOT BOUGHT FOLLOW UP**, **REFERRALS** — a slim second sidebar on a computer, a row of tabs on a phone (swipe sideways). Opening CRM lands on **CLIENT QUEUE** (2026-11-04). The old CRM menu, its "← JewelOS" link, its theme switch and LOGOUT are gone from the web; JewelOS provides them. Kiara: no new read tool (navigation only).
- [ ] CRM three tabs (2026-11-04): **DASHBOARD**, **CLIENT QUEUE**, **CLIENT DATABASE**, in that order, in one bar with the client search; opening CRM lands on **CLIENT QUEUE**. **NOT BOUGHT FOLLOW UP** and **REFERRALS** are now Client Database views (**Not Bought**, **Referrals received**, **Referrals given**); their old links redirect there. Kiara: no new read tool (navigation and existing CRM data; Kiara's CRM client answers are unchanged).
- [ ] Queue controls (2026-11-04): **CRM NAME**, **BRANCH**, **LOAD QUEUE** always visible; CRM NAME follows BRANCH and marks **(NOT AVAILABLE TODAY)**; BRANCH follows Dropdown Master **CRM Branches**. Kiara: no new read tool.
- [ ] Not Bought view (2026-11-04): tabs **Due today**, **Overdue**, **Pending**, **In progress**, **Done**; case labels **EARLIER BUYER, NOT BOUGHT THIS VISIT**, **NO PURCHASE ON RECORD**, **PURCHASED AFTER THIS VISIT**, **RECOVERED: PURCHASED LATER**, **CLOSED**; **FOLLOW UP FORM**, **VIEW HISTORY**, **SYNC NOT BOUGHT DATA**. Kiara: no new read tool (follow-up data is not a Kiara tool today; adding one is a separate decision with allowed/denied eval cases).
- [ ] Referrals views (2026-11-04): **Referrals received** / **Referrals given** with MKC, MKF, MKREF codes, **RELATION**, "Not yet a client (pending referral)" and "Not recorded". Kiara: no new read tool.
- [ ] CRM Dashboard (2026-11-04): operations cards (**Waiting in queue**, **Registered in queue**, **Walk-in forms completed**, **Store visits**, **Purchase visits**, **Walk-in purchase rate**, **New leads**, **Open Not Bought cases**, **Due now**, **Overdue**, **Contacts logged**, **Recovered**, **Active referrals**, **Not yet contacted**, **Referred people converted**) with **Today / This week / This month** and **Branch**; purchase visits are not invoiced sales. Kiara: no new read tool.
- [ ] Client profile **FMS workflows** (2026-11-04): runs started by the client's CRM events, current step, assignee, due time, **Open this work**. Kiara: no new read tool (FMS work reads are already Kiara tools for the asker's own work).
- [ ] Dropdown Master **CRM Branches** (2026-11-04): value = JewelOS branch code; label and order are what CRM shows. Kiara: no new read tool.
- [ ] CRM screens tidy-up (2026-11-05): queue headings **Register client** and **Queue**, **In today: …**, **No CRM staff for this branch**, duplicate message "… is already waiting in the queue today (token …)" with **Open that entry**; branch-list setup notes are no longer shown on the queue. Kiara: no new read tool.
- [ ] CRM menu and queue rows (2026-11-05): the three tabs became one menu button named after the open page (**Dashboard**, **Client queue**, **Client database** with **Not Bought**, **Referrals received**, **Referrals given**); queue rows show name with **New**/**Returning**, phone, time and CRM with one **Walk-in form** button (**View client** when submitted); **Register client** / **Register lead** buttons; Sync and Refresh in the **⋯** menu; phone filters behind **Filters**. Kiara: no new read tool.
- [ ] Referral and Not Bought rows (2026-11-05): referral rows lead with **Referred by …** (received) or **Referred …** (given); codes and dates under **Details** on phones; Not Bought rows no longer show **VISIT REF**. Kiara: no new read tool.
- [ ] Register someone (2026-11-04): CRM opens on **CLIENT QUEUE** with **REGISTER CLIENT** (customer in the store) and **REGISTER LEAD** (remote enquiry) side by side; REGISTER LEAD opens the full lead form and **Back to queue** returns. The **Who are you registering?** chooser is gone.
- [ ] Client walk-in: **REGISTER CLIENT** (**BRANCH**, **CLIENT NAME**, **MOBILE NUMBER**, **REGISTER CLIENT**), then **MAKE WALK-IN ENTRY** on the client's row in the **Queue** opens the walk-in visit form. A same-day pending entry for the same mobile number shows **Open that entry** instead of a second entry.
- [ ] Find a client: the search box at the top of the CRM page (name, client id or phone), or **CLIENT DATABASE**.
- [ ] CRM forms from the Form Builder (2026-11-03): Super Admin (**Manage CRM forms**) presses **CRM FORM SETTINGS** on CLIENT QUEUE; tabs **Client queue**, **Lead**, **Walk-in visit** (marked Next); **Choose a published form** or **Copy today's CRM form** (exact copy of the current CRM form, created in Forms Library under CRM forms and used by CRM at once); **Link the questions to CRM answers** (linked automatically by matching names when a form is chosen; the **Suggest links** button was removed 2026-11-06); **Preview form**, **Edit in Form Builder**, **Validate mapping**, **Save and use this form**, **Use the standard CRM form**. Staff then press **REGISTER CLIENT** / **REGISTER LEAD** → **OPEN LEAD FORM** and submit with **Register client** / **Register lead**. Kiara: no new read tool (configuration and registration screens only; CRM data reads are unchanged).
- [ ] Walk-in visit with a linked form (2026-11-04): CRM FORM SETTINGS → **Walk-in visit** → **Copy today's CRM form**; queue entry → **OPEN WALK-IN FORM** → sections with **Next** / **Back** → **Submit complete visit**. No Kiara tool needed (CRM reads unchanged).
- [ ] Walk-in drafts and offline sending (2026-11-06): **Walk-in form** opens the form over the Client queue (no Visit intake page); it saves as you type (**Progress saved. You can close and continue later.**); the row shows **Form started, not finished** with time and name, and **Continue form** / **Start over**; without network **Saved on this device. It syncs when the network is back.**, a submitted visit shows **Waiting to send** and is sent automatically; a refused one shows **Could not send the visit** and **Check and send**. On computers Register client is on the left and the Queue on the right. Kiara: no new read tool (drafts are unfinished working copies, not CRM records Kiara reports on).
- [ ] Record a walk-in or follow-up: use the walk-in and follow-up screens in CRM.

## Dropdown Master
**What it is:** the one shared set of option lists used across JewelOS (Forms, FMS, Tasks, Users, Leave, CRM). *(overview added 2026-10-28)*
- [ ] See every list: the page opens on all lists with totals (**Lists**, **Options**, **Made here**, **Made in forms**, **Built-in**, **Used by forms**); filter with **Search lists and options** or **All lists** / **Made here** / **Made in forms** / **Built-in**.
- [ ] Open a list: tap its card; it shows **Used in forms** and its options. **All lists** goes back.
- [ ] Add an option: open the list, press **Add item**. Create a list: **New list**.
- [ ] Hide an option without deleting it: the eye button (**Turn off** / **Turn on**).
- [ ] Lists made in the form editor are marked **Made in a form**; **Open in Dropdown Master** in the form editor opens the list.
- Kiara tool decision: none needed; help text only.

## Settings
**What it is:** your own preferences and, for allowed roles, company defaults and permissions.
- [ ] Change the theme or table density: open Settings and change your preferences.
- [ ] Change your own password (2026-11-02, 0367; every employee): Settings > **Change password**: **Current password**, **New password** (6 to 72 characters), **Confirm new password**, **Show passwords**, then **Change password**. Forgot it: ask a Super Admin to use **Set login password**, sign in, then change it in Settings.
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

2026-10-27 customer integration: exact labels added for Customer Data Integration, Customer Integration Health, Customer Integration Administration, FMS Journeys & Collected Answers, and Customer & Stage Exports. No new Kiara data tool is added: these are authoring/recovery instructions; raw submissions, pending identities and customer exports are not available to the assistant. Existing read-tool authorization remains unchanged.
2026-10-28 validation follow-up: Settings explains Review form changes. A changed form definition pauses customer capture until its mapping is reviewed and saved again; original submissions remain available for explicit historical recovery. Kiara remains read-only.
2026-10-28 simpler screens: FMS steps no longer show **Claim stage**, an **Outcome** box or an optional **Remark** box (a **Remark *** box appears only on steps that require one, just above the buttons). Buttons read **Continue to form** / **Continue**, **Fill the form** and **Mark as done**. After submitting, staff see **Submitted** and **Sent to <name>.** with no reference number; the Forms Library button is **Fill again**. The CRM client panel is now **Workflow history** with **Open this work** and **Show older**. Kiara needs no new read tool; it stays read-only.

2026-10-29 customer integration activation: Settings **Customer Integration** (was Customer Integration Health) with **Forms → CRM**, **Other connections** and **Undelivered customer events**; Form Builder shows **CRM status** and the **This form was revised** notice; FMS steps show the customer sync line and **Open CRM customer profile**; the CRM profile shows **Customer journey** filters and **LEAD**/**CLIENT** with **Purchase evidence**; CRM admin adds **Roster contributors**. No Kiara tool change in this release. Kiara's CRM tools read client search, profile fields, follow-ups and CRM numbers, not the Customer journey, so it cannot yet answer "what happened after this customer's Instagram enquiry". Adding that needs a read-only tool over `crm_client_activity` called as the asker, plus allowed/denied eval cases; it is listed as a follow-up in `docs/architecture/JEWELOS_COMPLETE_INTEGRATION_AUDIT.md`. Integration status stays administrator metadata. Kiara stays read-only.

### Advanced Forms and task scope (2026-10-30 local implementation)

- [ ] Conditions & Routing: independent Visibility Conditions, nested Add AND group / Add OR group, Ordered IF routes and Set OTHERWISE.
- [ ] Manage sections: Section Visibility and After this section. Explicit question routes override the end action; eligibility still applies.
- [ ] Routing simulation, Test validation and Reset simulation use the production evaluator without writing or uploading.
- [ ] (2026-11-02) **FMS workflow forms** shows each workflow once as a collapsible card (status **Live** / **Draft** / **Turned off**), not once per saved version. Tapping it shows **Step 1**, **Step 2**, ... with that step's forms; **Expand all** / **Collapse all** and search (opens matching workflows). Cards carry a workflow · step tag and **Also used in ...** for shared forms; forms only in a draft or older version sit under **Not in the live version**. The Workflow filter and Stage filter were removed.
- [ ] Tasks Today uses the Asia/Kolkata calendar date; Overall includes future work; Overdue separately lists earlier unfinished work. Counts and pages share server scope.
- [ ] Automatic follow-up scheduling extends existing FMS timing and assignment with next-day 11:00 defaults and requested date/time overrides.

Kiara tool decision: no new read tool. Configuration/navigation extends existing section contracts without wider reads or writes. Local implementation is not proof of hosted availability.

## 2026-10-30 FMS due dates from form answers and task board (0360)

- [ ] Builder: step settings -> **When / Deadline** -> **Due date source**: **From form answer**, **Fixed date and time**, **TAT / relative**, **Half-day deadline** (2026-11-03; was "No due date"). From form answer lists each earlier step that leads here ("Arriving from ...") with **Date question** and optional **Time question**, **Date-only answers are due at**, and **If the date is missing** (fallback timing / half-day deadline / require the date).
- [ ] Kiara tool decision: no new read tool. Due dates and counts are visible in the existing Tasks -> FMS reads; Kiara's existing task tools are unchanged.

## 2026-10-31 FMS automatic due dates from the previous form (0361)

- [ ] Builder: **When / Deadline** with **Set deadline** off now shows **Take the due date from the previous form** (ticked by default) and lists the question it reads ("From Introduction: NEXT FOLLOW UP DATE or APPOINTMENT IS SET FOR (whichever was answered)"), or warns when the previous form has no follow-up or due date question. The collapsed summary reads **From the previous form**. **Half-day deadline** unticks it; with no form date the step is due at the half-day deadline (0371).
- [ ] Kiara tool decision: no new read tool. Due dates already show in the existing Tasks and Tasks -> FMS reads.

2026-11-02 Home and account menu: **Daily Checklist**, **My Tasks** and **FMS Tasks** have equal fixed heights and show up to five items, with scrolling inside each preview. **Open all tasks** / **Open FMS tasks** reach the full lists. The universal top-right **Account menu** shows identity, **Settings** when permitted, and **Sign out**; Escape or tapping outside closes it. No new Kiara read tool is needed; existing data and session actions are reused.

2026-11-02 own password change: every employee sees **Change password** in Settings (Edge Function `change-own-password`, migration 0367 audit). The sign-in page now says to ask a Super Admin when the password is forgotten, or open Settings to change it. No Kiara read tool is needed: there is no data to read, and Kiara can never change a password.

2026-11-02 delete users (0368): Super Admins can press **Delete user** on any employee, including one with work history; the old "linked operational records" refusal is gone. The login is locked for good, personal details are wiped, the person disappears from Users, and past tasks, FMS steps, forms and CRM records show **Removed employee**. Users permission label is now **Delete users**. No Kiara read tool is needed; Kiara cannot delete anyone.

2026-11-02 bulk reassign (0369): Task Control Tasks tab **Reassign selected** and **Reassign all open work**; Users **Reassign tasks**. Server `task_reassignment_candidates` + `reassign_task_work_with_audit` (View all tasks permission). No new Kiara read tool: task assignment is already visible through the existing task reads, and Kiara cannot reassign anything.

2026-11-05 forms and task counts: successful form submission closes the form and shows a brief confirmation notice, returning to the originating library view, task subsection or workflow board. Unloaded status counts show a loading indicator. Subsection badges load with each destination's default date and team scope; FMS board filters do not replace the whole FMS subsection count. No new Kiara read tool is needed: existing section reads and submission contracts are reused.

### Dashboard and library layout (2026-11-06)
- [ ] Dashboard uses available width. Task work lifecycle is a table with both score columns on the right. Concentrated distributions show labeled bars; comparisons show exact counts and percentages.
- [ ] Forms and FMS use responsive tiles in a full-height workspace. Authors open the builder by clicking a form tile; Fill form remains separate. Versions & actions opens visibility, history and management actions.
- [ ] Questionnaire recovery: Remove unavailable draft link removes only the draft reference, retaining the pinned form and answers. An already published draft offers Use in workflow to finish attachment. Valid drafts still require publication. Discard detaches the draft and keeps its form; the next edit uses a private copy. No new Kiara read tool is needed.
