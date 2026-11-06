# JewelOS regression checklist

Run the automated gates first, then the manual pass for every area your change
could reasonably affect. Record the validation level you actually reached
(static, local database, browser, hosted) in the handoff; never report a gate
you did not run.

## Automated gates

```powershell
pnpm.cmd --filter @jewelos/core test         # includes permission resolver + SQL catalog parity
pnpm.cmd --filter @jewelos/data test
pnpm.cmd --filter @jewelos/crm-ui test
pnpm.cmd --filter web test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
pnpm.cmd check:web-performance
supabase.cmd db reset                        # local only
supabase.cmd test db                         # pgTAP, incl. 0156_granular_permissions
supabase.cmd db lint --local --level warning
git diff --check
```

## Manual pass

For loading changes, test a cold visit and a repeat visit on desktop and phone,
then change tabs/filters quickly, save, and return through browser Back. In Task
Control cover Overview, People, Tasks, Review (all buckets) and Templates. In
CRM cover Registration, Queue, Clients, a client profile, Follow-ups and Settings
as permitted. Slow or failing optional metadata must not block the primary list.
Check that obsolete requests never replace the current filter or identity.
After building, run `pnpm.cmd check:web-performance`; record network/interaction
timings separately from bundle size. Use authorized synthetic data for automation.

Use one test account per row of the **Accounts** table. Every "denied" check
must be tried three ways: the UI, a typed URL, and a direct API call (browser
devtools: `supabase.rpc(...)` / `supabase.from(...)` with the user's session).

### Accounts

| Account | Role | Dashboard authority | Overrides |
| --- | --- | --- | --- |
| SA | super_admin | inherit | none |
| ADM | admin | inherit | none |
| MGR | manager | inherit | `crm.view` deny |
| STF | staff | inherit | none |
| STF-M | staff | manager | none |
| PC | staff, designation Process Coordinator | admin | `users.delete` deny |
| HR | hr | inherit | none |

### Authentication

- [ ] Login with username and with work email.
- [ ] Logout returns to sign-in; back button does not reopen the app.
- [ ] Reload keeps the session; an expired session asks to sign in again.
- [ ] Resigned / suspended / login-disabled accounts are refused with the right message.
- [ ] Shell shows the effective role; Settings shows assigned role and dashboard authority.

### Dashboards and navigation

- [ ] STF sees exactly the pre-0156 staff menu (Home, Dashboard, Tasks, FMS, Forms, Notifications, Availability, Reports, Settings).
- [ ] MGR, ADM, SA, HR menus are unchanged from before 0156 (MGR additionally loses CRM because of the deny).
- [ ] STF-M receives the Manager menu and Manager dashboard filters.
- [ ] PC receives the Admin menu, Admin dashboard and all-task visibility.
- [ ] Typing a URL for a section outside the user's permissions lands on their first permitted section.

### Users

- [ ] ADM can view, invite and edit users; STF cannot see the Users section.
- [ ] Only SA can change a user's role or week off.
- [ ] A user granted `users.manage` (not Admin) cannot edit a Super Admin.
- [ ] Unused-account deletion works for SA; denied for PC (`users.delete` deny) via UI and `delete-user`.

### Permission management (`/settings/permissions`, SA only)

- [ ] Roles tab lists every role from the database; saving a change writes one `role_permissions_saved` audit row.
- [ ] Designations tab grant/deny takes effect for every user with that designation.
- [ ] Users tab shows Role / Designation / User / Effective per permission and the effective value matches the app.
- [ ] Setting and clearing dashboard authority writes `user_access_saved` audit rows.
- [ ] SA cannot change their own access; the last active Super Admin cannot be downgraded.
- [ ] ADM calling `get_permission_admin_context` / any `save_*_with_audit` permission RPC is refused.
- [ ] A change made in one browser updates the affected user's menu in another browser without re-login (realtime or on tab focus).

### Tasks

- [ ] Create manual task, delegate, edit, complete, attach evidence, required-form completion.
- [ ] Task evidence accepts a photo, a PDF (10 MB) and a phone video (MP4/MOV, 50 MB); a longer clip shows the 50 MB message. In the Android app, Upload always offers Take photo / Record video / Choose from gallery or files, and other upload fields (forms, FMS) still offer the camera.
- [ ] Recurring tasks generate on schedule; overdue tasks show as overdue.
- [ ] Checklist-first task card (migration 0342): a task with an unticked required item shows **Checklist**
      (not Complete/Upload/Fill form); it opens the checklist as the first block of the task. Items are large,
      numbered, tick by tapping the text, and unlock top to bottom. **Complete task** appears under the checklist
      once required items are ticked. The server refuses completion while a required item is open (Complete,
      upload-and-complete, Review tab, required form). No completion remark anywhere; the details panel
      shows only description, Repeats, Deadline moved, Evidence/Verification when required, Core task. Remarks
      appear for an In Loop viewer, and for others only once a remark exists. Check at phone width.
- [ ] Recurring / To-Do consolidation (migration 0340): the menu has no Recurring / To-Do; /recurring-todo opens
      Task Control → Review (SA/ADM), Task Control → Tasks (MGR/HR) or Tasks (others). After migration 0341,
      all active task authors see Schedule (One-time default · Recurring · As needed), with assignment scope,
      denied permissions and protected recipients enforced by both save RPCs. Template editing remains restricted.
      Repeats offers Daily, Weekly, Monthly, Quarterly, Annually and Custom. Custom monthly weekday
      "3rd Saturday" previews the real 3rd Saturdays and saves one template per selected
      person, its first occurrence on the first 3rd Saturday. As needed saves a duty with its wording and creates no
      task that day. Task Control → Review: Verify, Reject (reason required; the doer's alert opens that task in
      Tasks), Follow up, complete on behalf (no remark since 0342), required form, Performance; tiles open the matching
      list. Templates: Next date or Ended, Run now; Edit keeps priority, verification, verifier, follow-ups, remark
      rule, checklist and a paused state. Turning Task Control off in Developer Mode pauses Verify and Follow up.
- [ ] Create Task on phone widths 320/390/430: no horizontal overflow; header/actions remain reachable;
      keyboard opening/closing retains title and search text and keeps the focused field visible above the
      keyboard/action bar. Users shows selected names and Done. Due Date
      has Today/Tomorrow, separate date/time and Done without closing mid-selection. Desktop layout remains usable.
      Voice guidance has readable headings, Required/Optional labels and its example, without per-field descriptions.
- [ ] Bulk Import: a workbook imported before 2026-10-21 replays as "replayed", never "created"; the new
      frequencies (3rd Saturday, Last Friday, Every 2 Weeks, Half Yearly, Month End, weekday lists) import; an
      unknown frequency is still a row error.
- [ ] Staff see own/department tasks; managers see branch; admins see all (task visibility follows dashboard authority).
- [ ] CSV import and Assigning Left still work for ADM/SA.
- [ ] Task Control → Tasks for one employee lists one-time, recurring, CRM walk-in tasks and their
      FMS steps and pending FMS start forms (migration 0285), each with its type badge; open FMS work
      shows even when dated before the range. The Type chips narrow the list and show counts; with
      Type = FMS, "Delete all matching" selects nothing (no tasks, no schedules). Overview tiles are
      unchanged by the new rows. A manager sees only their own branch's FMS work.
- [ ] On a phone (or the Android app), Assign New Task → Priority shows High, Medium and Low and the
      open panel scrolls into view above the Assign Task bar; Task type buttons stack on one column.
- [ ] Voice assignment (`tasks.voice_assign`; SA/ADM/MGR/HR by default) behaves exactly as before
      Ask Kiara Phase 7 moved its recorder and transcription into shared code
      (`apps/web/src/features/voice/useVoiceRecorder.ts`, `supabase/functions/_shared/voice/transcribe.ts`):
      on Tasks → Assign Task and on the floating mic, record a 10-20 s English instruction naming a
      person and a deadline. The form fills in with the transcript shown; a < 1 s tap says "too
      short"; a muted mic says "sent no sound at all"; staff get no voice control and a direct call
      to `interpret-task-voice` returns 403; the 41st note in an hour returns "Too many voice notes"
      (the hourly allowance is shared with Kiara voice questions). Automated proof:
      `interpret-task-voice/worker.test.ts` and `VoiceTaskCapture.test.tsx` pass unchanged.

### FMS and forms

- [ ] Start a flow, claim/complete/review a stage from FMS **and** from Home/Tasks.
- [ ] Build, publish, pause, archive an FMS flow (ADM). A user denied `fms.manage` cannot.
- [ ] Author, publish, archive a form (MGR). A user denied `forms.manage` cannot.
- [ ] **Native Forms Builder.** Create a draft with sections, each field family,
      static and Dropdown Master options, a visibility condition and an answer
      route; preview, save, reopen and publish it. Confirm hardware Back warns
      only when dirty and a failed/offline save retains the edits.
- [ ] **Native FMS canvas.** Pan empty space, drag a node, pinch, connect,
      reconnect, fit and reset at phone width. Confirm one tap selects without
      moving, the stage editor scrolls separately, and rotation/resume does not
      crash or lose the persisted node position.

### FMS AI assistant (one chat inside the builder) - 2026-10-28

Ships dark: off until an administrator ticks FMS -> **AI assistant** (settings)
-> **Turn on the AI assistant**. Design and threat model: `docs/FMS_AI_ASSISTANT.md`.

- [ ] Switched off (default): no **AI assistant** button anywhere; **New
      workflow** opens the name/purpose step.
- [ ] Switched on: **New workflow** still opens the name/purpose step (no
      "Build with AI" choice). After **Open builder**, the toolbar shows **AI
      assistant**; live workflow cards show no **Ask AI** button.
- [ ] One chat, no tabs: "Build this workflow: ..." returns **Review the
      changes**; **Apply to editor** once; one **Undo** removes everything,
      **Redo** restores it. Save draft and Publish behave as for a manual
      workflow (same RPCs and checks).
- [ ] In the same chat, "Check this workflow for problems" answers with
      evidence and suggested fixes; **Preview this fix** -> **Apply to editor**
      works; a step name in the answer opens that step.
- [ ] The answer arrives (no "unavailable right now" error). If it fails, the
      `fms-ai` function log line `fms_ai_turn_failed` shows `kind` and `detail`
      (provider status and error type only).
- [ ] Edit the draft while the assistant is answering: the preview says it is
      out of date and **Apply to editor** is disabled.
- [ ] Denied: a user without `fms.manage` sees no assistant and a direct
      `fms-ai` call returns 403; with FMS disabled in Developer Mode it returns
      403.
- [ ] Daily limit: after the limit the assistant says so; manual editing works.
- [ ] Phone width: the assistant opens as a bottom sheet; the header with
      **Save draft** and **Publish** stays visible; Escape/close works.
- [ ] A failed FMS step submission (e.g. revoked permission) still shows its
      original error.
- [ ] Canvas (2026-10-28): drag a step past the left or top edge of the
      canvas. It keeps following the pointer (no invisible wall), the dot grid
      continues, and after the drop nothing jumps; Save draft and reload keep
      the layout.

### FMS Builder 3.0 - 2026-10-24

Web and shared packages only (no migration). Design:
`docs/superpowers/specs/2026-10-24-fms-builder-3-design.md`. Check on desktop
and at phone width (also inside the Android app).

- [ ] No **Guided Mode** / **Canvas Mode** toggle; phones open on the canvas.
      No Normal/Decision step choice; **Add Step** gives a step with no deadline.
- [ ] Select mode: drag empty space to box-select; drag one selected card and
      the group moves together, connections follow, one Undo reverts the move.
      Hand mode, Space+drag and middle-drag pan. Wheel and pinch zoom.
- [ ] Shift/Ctrl+click toggles; Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+D, Ctrl+X,
      Delete, Ctrl+Z / Ctrl+Shift+Z, Esc, 1 work on the canvas and do NOT fire
      while typing in the inspector, a Form question or any dialog.
- [ ] Duplicate Introduction -> Proposal -> Negotiation: three copies, chained,
      new keys, not connected to the originals; Undo removes all three.
- [ ] Copy two steps in workflow A, open workflow B in the same tab, Ctrl+V:
      copies land at the pointer with their internal link; links to uncopied
      steps are reported, not re-pointed; Forms/people not available here are
      reported. Nothing is published.
- [ ] Delete four selected steps: one confirmation naming steps and
      connections; remaining steps are not reconnected; the Start form stays.
- [ ] Click the middle of three close routes: only it highlights; **Edit
      route** opens that exact condition; **Change destination** + click a step
      moves only that route; **Delete route** removes only it.
- [ ] **Create questionnaire** on a step: editor opens over the canvas with a
      live preview; add two sections and a conditional question; **Save
      draft**, reload the page: the step shows "Unpublished changes" and
      **Continue editing** reopens it. **Use in workflow**: the step pins the
      new published version and its question appears in **Add condition**.
- [ ] Simulate Yes -> Proposal / No -> Follow-up on that question.
- [ ] **Edit a copy** of a Forms Library form on a step: the library form and
      other workflows using it are unchanged.
- [ ] **Import section** (copy) from a three-section Form: only that section
      arrives, a dependency on another section is warned about first.
      **Link one section of a form…** still pins the section (0345).
- [ ] Publish readiness lists an unpublished questionnaire draft; **Discard
      changes** removes the draft and keeps the version in use.
- [ ] Forms Library editor: live preview beside the questions; renaming a
      question, adding an option, Required and conditions show immediately;
      hide/show keeps edits; phone uses **Preview form** / **Edit**.
- [ ] **Import / Export**: export whole/selected JSON; import that file, pasted
      JSON, and steps from another FMS; an n8n file is refused.
- [ ] Legacy: a published workflow with a Decision Step renders (Outcome
      choices under Routing), runs, and its outcome routes and "Run this step
      only if" conditions behave exactly as before. A saved step with a
      deadline still shows **Set deadline** ON.

### FMS form sections and full-screen canvas - 2026-10-23

Migration `0345_fms_stage_form_sections.sql`; design:
`docs/superpowers/specs/2026-10-23-fms-form-sections-canvas-design.md`.

- [ ] Existing workflows: open, run and finish a workflow published before
      0345. Every stage still shows its entire Form; routes, fallbacks,
      assignments, deadlines and notifications behave exactly as before.
- [ ] Section scope: in a draft, link a multi-section Form to a later step ->
      **Form scope** -> **Specific Section** -> choose a section. The section
      list keeps the Form's order and shows question counts. **Add route**
      offers only that section's questions and their answers.
- [ ] Change the section with a route already saved: the route stays, its
      question shows "(not in this section)" and Publish readiness names it.
- [ ] Reuse one Form on four steps with four sections; save, reload, create a
      revision and duplicate: every step keeps its own section.
- [ ] Run it: the employee on each step sees only that step's section (the
      title reads "Form · Section"), required questions apply only inside it,
      and the chosen route activates the right next step and employee.
- [ ] A route back (Follow-up -> Introduction) opens a fresh Introduction
      visit with an empty form.
- [ ] Upgrade a step to a newer Form version that renamed the section:
      Publish readiness reports the missing section until it is chosen again.
- [ ] Standalone Forms Library submission of the same Form still requires
      every section the respondent reaches.
- [ ] Canvas (desktop and tablet): the builder opens full screen on Canvas
      Mode with no inspector and the **Open workflow tools** rail closed.
      Wheel up zooms in and down zooms out around the pointer, without page
      scroll; dragging empty space pans; dragging a card moves only the card;
      dragging an output dot still connects. Opening/closing the drawer, the
      inspector, the assistant and the app sidebar never moves the camera.
- [ ] **Add Step** selects the new step and opens its inspector; **Close
      inspector** returns the bare canvas. The inspector scrolls inside itself.
- [ ] With the AI assistant open, clicking a step shows the inspector; closing
      it (or pressing **AI assistant**) brings the same conversation back.
- [ ] Phone width (also the Android app): Steps/Map views, pinch and pan on
      the Map, and the section controls in the step sheet all fit without
      horizontal scroll.

### Assigned FMS work (one work item, many entry surfaces)

Run signed in as the assignee, and repeat the whole block on web and on an
Android phone-sized device.

- [ ] **Starter assignment.** A pending starter assignment appears on Home and in
      Tasks with an `FMS` tag. Opening it from either surface lands directly on
      the assigned form — no Dashboard, no Forms Library, no flow picker.
- [ ] **Form-only runtime stage.** Opening it lands on that exact stage's form.
      Submitting completes the stage and advances the flow in one step; the row
      leaves the open feed without a manual second completion.
- [ ] **Runtime stage with extra evidence/approval.** Submitting the form does
      **not** silently close the stage; it stays open for its remaining
      requirement and still appears in the feed.
- [ ] **Form-less runtime stage.** The card offers "Open FMS workflow" and lands
      on the stage workspace rather than dead-ending.
- [ ] **Unrelated user.** Another user's starter assignment and runtime stage are
      absent from their feed and their direct links are refused.
- [ ] **Notification completion.** The assignment notification leaves the unread
      list once the work is completed from *any* surface, and the notification
      remains in history (read, not deleted).
- [ ] **Direct deep links.** Pasting `/tasks/fms?starter=…&form=…` and
      `/tasks/fms?instance=…&stage=…&form=…` opens the exact surface on refresh;
      browser Back returns without a blank screen. An incomplete link shows an
      explicit invalid-link state, never a Dashboard fallback.
- [ ] **Completed/withdrawn work.** Its link shows an explicit finished or
      unavailable state instead of an empty form.
- [ ] **Date independence.** A future-dated and an undated open FMS item both
      remain visible in the feed.
- [ ] **Narrow web viewport.** Repeat at 320/375/390 CSS px with no document-level
      horizontal scroll.

### CRM inside JewelOS - 2026-11-03

- [ ] Open CRM from the JewelOS sidebar (desktop) and the phone menu: the JewelOS header, sidebar/phone navigation, theme switch and sign-out stay; no second CRM header, drawer or login appears.
- [ ] The CRM tabs read DASHBOARD, CLIENT QUEUE, CLIENT DATABASE (see the 2026-11-04 section); the active tab follows the page (a walk-in visit form marks CLIENT QUEUE, a client profile marks CLIENT DATABASE). On a phone the tabs swipe sideways without moving the page.
- [ ] `/crm` opens straight on CLIENT QUEUE (no registration chooser since 2026-11-04). REGISTER LEAD adds `?register=lead`; browser Back returns to the queue; reloading keeps the view.
- [ ] REGISTER CLIENT on CLIENT QUEUE saves one queue entry (existing-client lookup by phone, token, branch, CRM queue) and stays on the client queue; LOAD QUEUE, the Active/Recently submitted tabs and paging keep the client queue.
- [ ] Complete a walk-in from the queue: the visit form opens with the queue client, saves, returns to `/crm/queue?...&completed=...` with the "Walk-in saved" message, and the matching JewelOS walk-in task closes.
- [ ] Old deep links still work: `/crm/queue`, `/crm/visits/new?queue=<id>`, `/crm/clients/<id>`, `/crm/followups`, `/crm/referrals`, `/crm/leads/new`, `/crm/dashboard`.
- [ ] Switch between CRM, Tasks, FMS, Forms Library and Dashboard from the JewelOS menu and back with browser Back/Forward; the CRM page reappears without a full reload.
- [ ] Client search results open over the CRM page but under the JewelOS header. Client Database has one vertical scroll bar, the page's (2026-11-04); other single-list CRM pages keep their fitted list.
- [ ] Light and dark themes: CRM colours follow the JewelOS switch in the JewelOS header.
- [ ] Without `crm.view`, or with CRM switched off in Developer Mode, `/crm/...` shows the usual JewelOS fallback / maintenance notice inside the shell.
- [ ] Android app: CRM opens inside the app layout; camera/gallery photo on the walk-in form, `tel:` links and Android Back still work.

### CRM three tabs - 2026-11-04

Run on desktop (1440 px and 1920 px), a tablet and the Android app. JewelOS migration 0378 and CRM
migration 20261104000300 must be applied first (see the handoff deployment order).

- [ ] The JewelOS sidebar's CRM opens `/crm/queue` with CLIENT QUEUE highlighted. Exactly three tabs, in order DASHBOARD, CLIENT QUEUE, CLIENT DATABASE, share one bar with the client search; the page below uses the full content width (no CRM side rail).
- [ ] CLIENT QUEUE shows at once: REGISTER CLIENT and REGISTER LEAD side by side, the REGISTER CLIENT form (BRANCH, CLIENT NAME, MOBILE NUMBER with country code), and the CRM QUEUE with CRM NAME, BRANCH and LOAD QUEUE always visible (no Filters disclosure).
- [ ] Changing BRANCH in the queue toolbar changes the CRM NAME list immediately to that branch's CRM-department staff; someone on leave today shows "(NOT AVAILABLE TODAY)". LOAD QUEUE opens that queue; reopening CRM later restores it.
- [ ] Add a person to the CRM department in JewelOS Users (login on, CRM access on): after the staff sync they appear in CRM NAME on every CRM branch. Rename, move out of CRM, deactivate or delete: they disappear after the sync. A non-CRM department person never appears.
- [ ] As a Super Admin with a CRM-department person whose CRM login is off: CLIENT QUEUE explains the missing person ("not synced: CRM login or CRM permission is off in JewelOS Users"); the list is never silently blank.
- [ ] Dropdown Master → CRM Branches: the list holds one entry per active branch (value = branch code). Rename an entry's label: the BRANCH choice shows the new label after sync. Deactivate an entry: the branch is no longer offered. Add an entry with an unknown code: it is not offered (no note is shown on the queue).
- [ ] REGISTER CLIENT with the same mobile number twice on the same day in the same branch: the second attempt shows "is already waiting in the queue today (token …)" with "Open that entry"; only one queue row exists. After that entry's walk-in form is saved, registering again creates a new entry.
- [ ] MAKE WALK-IN ENTRY on a queue row opens the full walk-in form; save it (with a photo on the phone) and the row moves to Recently submitted.
- [ ] REGISTER LEAD opens the lead form (or the linked Form Builder lead form via OPEN LEAD FORM); "Back to queue" returns with the branch kept. Runo push still reports as before.
- [ ] CLIENT DATABASE at 1440 px and 1920 px: one vertical scroll bar (the page), the table uses the width, 8 columns (Client, Phone, Location, Visits, Last status, Commercial classification, Activity, Action). On a phone the rows are cards; a wide table scrolls sideways only inside its box.
- [ ] Views All clients / Not Bought / Referrals received / Referrals given; each view and its tab, filters, search and page survive reload, Back/Forward and a copied link.
- [ ] Not Bought: Due today, Overdue, Pending, In progress, Done counts match their lists. A client who bought earlier and then did not buy shows "EARLIER BUYER, NOT BOUGHT THIS VISIT"; a client who never bought shows "NO PURCHASE ON RECORD". Save two follow-ups on one case: VIEW HISTORY lists both, newest first, with who and when.
- [ ] Referrals received / given show the referrer's MKC, MKF and MKREF codes, the relation ("Not recorded" when blank) and the referred person's client ID once converted; a pending referral says "Not yet a client (pending referral)". FOLLOW UP FORM saves; the Converted tab lists converted people once.
- [ ] Old links: `/crm/followups?tab=done&crm=NAME` opens CLIENT DATABASE → Not Bought → Done filtered by NAME; `/crm/referrals` opens Referrals received.
- [ ] DASHBOARD opens on the operations cards (Today). Each card's number matches what its drill-down opens (for example Overdue = Not Bought → Overdue count; Purchase visits = the records drawer). This week / This month and Branch change the numbers. No sales value is shown. Sync health is visible to Super Admins only, below.
- [ ] FMS: with a published FMS workflow using Automatic Trigger "CRM Walk-In Visit" and condition Visit status Equals NO, save a not-bought walk-in: one run starts; saving the client's next not-bought visit while the run is open starts none (Trigger history shows Duplicate). With no such workflow, saving the walk-in works and starts nothing. The client profile's "FMS workflows" shows the run, its current step, assignee and due time, and "Open this work" opens it in Tasks.
- [ ] A salesperson of branch A sees only branch A in BRANCH and no roster diagnostics; a user without `crm.view` cannot open `/crm/...` or read client runs.

### CRM tidy-up and speed - 2026-11-05

- [ ] Client Queue shows no Dropdown Master / "Not offered" notes; text is short ("Register client", "Queue", "In today: …").
- [ ] Selected chips, period buttons and REGISTER CLIENT / REGISTER LEAD use the same gold as the selected item in the JewelOS menu; no orange/yellow notice boxes.
- [ ] Client Database, Not Bought and Referrals have no boxed panel around the list; the list sits on the page.
- [ ] Desktop: with the mouse over any CRM table (Client Database, Not Bought, Referrals, Queue), the wheel scrolls the page. Every CRM page has one vertical scroll bar.
- [ ] Phone (360-412 px): records are plain rows separated by a line (no boxed cards), showing name, ID, phone, status and actions; Details shows the rest. Filters sit two per line; nothing pans sideways.
- [ ] Speed: tapping DASHBOARD / CLIENT QUEUE / CLIENT DATABASE, a Client Database view (Not Bought, Referrals received/given) or a Not Bought tab highlights it at once and shows a thin gold bar until it opens; hovering first (desktop) opens it almost instantly. After saving a follow-up the list shows the saved value (never an older preload).

### CRM menu, queue rows and phone layout - 2026-11-05 (2)

- [ ] CRM shows one menu button (three lines + the open page's name) beside the client search; no tab strip. The menu lists Dashboard, Client queue, Client database and its views Not Bought, Referrals received, Referrals given; choosing one opens it and closes the menu; Escape and tapping outside close it.
- [ ] Client queue: small "Register client" / "Register lead" buttons on one line. Each waiting person is one row: name with New/Returning, phone, time and CRM, and one "Walk-in form" button. On PC the mouse wheel scrolls the page anywhere over the queue.
- [ ] Client database on a phone: no view chips and no Register Client button; one "Filters" button shows the filters; records are short rows (name, ID, phone, status, Call / Walk-in / Details); no "View Client Profile" (tap the name).
- [ ] Not Bought and Referrals: no duplicate heading; Sync and Refresh are under ⋯; counts read "N of M".
- [ ] Phone text is comfortably small (not zoomed); nothing pans sideways at 360 px.

### CRM queue spacing and phone rows - 2026-11-05 (3)

- [ ] Desktop Client queue: the "Walk-in form" button sits next to each person (no wide gap). "Register lead" shows the form centred on the page.
- [ ] Phone Client database: each record fills the screen width; its buttons share the row evenly.
- [ ] Phone Not Bought: no "VISIT REF" line; name, status and case label, number with Call, next follow-up, then the buttons.
- [ ] Phone Referrals received: the person's name and "Referred by <client> (<relation>)"; codes, date added and pending notes only under Details.
- [ ] Phone Referrals given: the client's name and "Referred <person> (<relation>)"; codes and the referral column only under Details.

### CRM forms from the Form Builder - 2026-11-03

- [ ] Only a Super Admin (or anyone given **Manage CRM forms**) sees **CRM FORM SETTINGS** on CRM REGISTRATION; a CRM salesperson does not, and calling `save_crm_form_binding` directly as them is refused.
- [ ] **Copy today's CRM form** (Client queue): "Client queue registration" is created in Forms Library under **CRM forms** with CLIENT NAME and MOBILE NUMBER side by side, and CRM uses it at once ("Now in use").
- [ ] **Copy today's CRM form** (Lead): "Lead registration" has the same questions, labels, order, required marks and dropdown choices as the old CRM lead form; a field CRM showed only after an answer (for example after SOURCE OF LEAD) appears only after that answer.
- [ ] Forms Library → **CRM forms** lists both; editing and publishing works as for any form; **Fill form** opens CRM registration (client queue or lead), not a plain library submission. Staff without form authoring do not see these forms in Forms Library.
- [ ] **Edit in Form Builder** opens that form; change question order/width, add a section or a conditional question, publish; reopen CRM REGISTRATION and the next **REGISTER CLIENT** shows the new version.
- [ ] REGISTER CLIENT with the linked form: one queue entry, correct branch, token, client ID message, existing-client detection by phone, queue list refresh, and the JewelOS walk-in task appears as before.
- [ ] Press **Register client** twice quickly / after turning the network off and on: still one queue entry.
- [ ] Remove a linked question in the Form Builder and publish: CRM falls back to the standard queue form; a Super Admin sees the "needs attention" line with **Open CRM Form Settings**.
- [ ] Lead: link a lead form (starter or own); **OPEN LEAD FORM** → **Register lead** saves one lead with the mapped answers, shows "Lead saved and pushed to Runo." (or the Runo-not-configured line), and the lead appears in CLIENT DATABASE; a duplicate phone shows "A lead with this mobile number already exists."
- [ ] A Dropdown Master choice question linked to a CRM lead dropdown saves the label CRM expects (for example Source of lead).
- [ ] **Use the standard CRM form** returns each registration to the original CRM form; earlier clients, leads and links are unchanged.
- [ ] Walk-in visit form, client profiles, follow-ups and referrals are unchanged.
- [ ] Phone: the linked form opens full screen; half-width questions stack one per row; desktop shows them side by side.

### CRM walk-in visit from the Form Builder - 2026-11-04

- [ ] CRM FORM SETTINGS → **Walk-in visit** → **Copy today's CRM form**: "Client walk-in visit" appears in Forms Library → CRM forms with the six sections, the same questions, labels, dropdown lists and "shown only when" rules as the old walk-in form; CRM uses it at once.
- [ ] Queue entry → walk-in page shows **OPEN WALK-IN FORM**; the form opens with client name, mobile, CRM, Walk-in source, country India and the client's saved profile prefilled; it goes one section at a time with **Next** / **Back**.
- [ ] Typing another known client's mobile fills their saved details ("Auto-filled from client history — editable"); the queue client's own number keeps that client. A 6-digit pincode fills city, state and country.
- [ ] Salesperson and CRM dropdowns list only the queue branch's people.
- [ ] Companions: "How many family members / friends are with them?" shows one row per person (name, mobile, relation).
- [ ] Visit status YES / NO / repair / order / exchange / store visit / price calculation each show the same follow-up questions as before; NO requires reasons and Next visit date; STORE VISIT and PRICE CALCULATION skip CRM APPROACH.
- [ ] Engagement asks: YES requires a proof photo (testimonial also accepts a video), NO asks for a reason; Referrals YES asks "How many referrals?" with name and number per referral. Photos upload to the client's CRM documents and appear on the client profile.
- [ ] **Submit complete visit**: one visit saved, queue entry completed, "Walk-in saved" message, walk-in task closed in JewelOS Tasks; pressing Submit again after a dropped connection does not save a second visit.
- [ ] Without a walk-in link (or after **Use the standard CRM form**) the standard walk-in form opens exactly as before.
- [ ] Form Builder: **Repeating group (CRM)** and **CRM photo / video** are in the question types; there is no "In CRM forms" or width setting; a Forms Library form with a CRM photo question says "This question works in CRM forms only." and cannot be submitted outside CRM.
- [ ] Lead form linked earlier: a date question (for example Date of birth) now saves (it is sent as YYYY-MM-DD).

### Automatic client details and one question per row - 2026-11-04

- [ ] Any form (Forms Library, FMS step, task form), signed in with CRM access: type a registered client's or lead's phone number; client name, gender, date of birth, city and the other recognised questions fill with "Auto-filled from client history — editable". An answer typed before the lookup is not replaced.
- [ ] A 6-digit pincode fills city, state and country.
- [ ] Signed in without CRM access: nothing is filled.
- [ ] Every form shows one question after another on desktop and phone, including forms saved with half / third widths.
- [ ] Form editor: each question card shows how it will look (Short answer, Phone number, its choices); no width or "In CRM forms" settings.
- [ ] CRM client queue form: typing a known number fills CLIENT NAME (as the old CRM form did).
### UI redesign - 2026-11-04

Check each at 1280, 1440, 1920 and 2560 px wide (sidebar open and closed) and at
320, 360, 390 and 430 px on a phone (browser and the Android app). No page may
scroll sideways as a whole; wide tables scroll inside their own box.

- Forms Library: one compact row per form (name, status, counts, Fill form /
  Edit draft). From 1280 px the selected form's versions and actions show in a
  side panel; on a phone tapping the name expands them under the row. Publish,
  Publish as separate form, Edit, Create new version, Archive, Delete (with its
  impact warning), Visible in Forms Library, FMS and CRM sources all still work.
- Form Builder: the tool rail (bottom bar on a phone) adds a question, section,
  heading or divider where you are working, duplicates or deletes the selected
  question, and opens the outline. New sections appear after the current one;
  section title, After this section and section conditions live on the section.
  Unsaved changes shows in the header; Back still asks before discarding.
  Live preview, desktop/mobile switch, routes map, Save draft / Save changes and
  the FMS questionnaire studio (Close / its own buttons) are unchanged.
- CRM: opening CRM lands on CLIENT QUEUE. From 1024 px the six sections are a
  slim second sidebar; on a phone a tab row with the open one scrolled into view.
  REGISTRATION, client search, profiles and every /crm/* deep link still open.
- Users: one table of everyone (list on a phone) with search, branch, department
  and Show former employees. Edit opens Employee details / Section access tabs
  for permission managers; a section-only manager gets Section access directly.
  Branches & departments opens the organization manager.
- Availability: the board shows first; Leave management opens from the header
  (apply, handover, summary, review, delete with confirmation; Escape closes
  only the top dialog). Status select and Mark absent save per row.
- FMS: workflow cards line up their action rows whatever the description length;
  Show full description expands; Start, Tasks, Runs, Edit draft / New version,
  Pause / Resume, Restore, Delete and Version history still work.
- Home: no Recent Activity; Needs attention now opens the task; work cards and
  Team today unchanged. Dashboard: KPI row, charts, Needs attention rail and
  drill-downs. Ask Kiara: chat sidebar and search, composer grows and stays
  above the phone keyboard. Reports: catalogue rail from 1280 px. Dropdown
  Master: lists beside the open list from 1280 px. Settings: section bar jumps.

### Client history from every form - 2026-11-04

- [ ] Submit any Forms Library form with a phone question, using a registered client's number: within a few minutes the client's profile → **Customer journey** shows the form with every answer, who filled it and when.
- [ ] The same from an FMS step form and a task form.
- [ ] A number that belongs to no client or lead: nothing appears and no new client is created; nothing is added to CRM's identity review list.
- [ ] The client's profile details (city, gender...) do not change because of these answers.
- [ ] A form that has its own Customer Integration mapping still works as before (and still needs CRM approval).
- [ ] Settings → Customer Integration does not list these forms as configured.

### UI v2 - 2026-11-04

Phones first (320, 360, 390, 430 px; Android app), then 768, 1024, 1366, 1440,
1920, 2560 px. No whole-page sideways scroll; workspaces fill the window
without a second page scroll bar.

- Ask Kiara: edge-to-edge; chats on the left (Chats drawer on a phone);
  Kiara tools at the sidebar bottom opens Chat / Questions for you / Knowledge
  base / Insights / Limits per permission; ?tab= and escalation links still
  open their area; composer stays above the phone keyboard.
- Reports: category and report chips (Report select on a phone), Filters bar
  (folded on a phone), full-width table with pinned headers, phone rows open
  the whole record, Your exports dialog (download, cancel, retry).
- FMS: one row per workflow; ⋯ menu for Pause / Resume, Restore, Version
  history, Delete (with its confirmations); Start, Tasks, Runs, Edit draft /
  New version on the row.
- Forms Library: list and details panes reach the window bottom and scroll on
  their own (1280 px+); phones and tablets open a form full screen with Back to
  forms.
- Tasks: title, Today / Overall / Overdue and search on one row; subsection
  tabs, Assigning Left and Bulk Import below; Create Task still floats.
- Task Control: header, tabs, filters and content share the page edges.
- Availability: Leave management is the header's main button; Department
  select beside search.
- Dropdown Master: lists and options panes scroll independently (1280 px+);
  New list in the header, Add item on the open list; phones: All lists.

### Sales recording analysis (0379) - 2026-11-05

Backend (0379) plus Conversation review screen and 0380 settings call.

- Sales score settings appear only for Admins/Super Admin/managers with review;
  **Turn analysis on/off** only for Developer Mode authority. Staff see nothing.
- On a Ready recording: score or "No score" with reasons, weights shown as
  configured → effective, evidence buttons highlight the quoted Final transcript
  line, Readable / Original language / English switch.
- Manager: Flag/Comment/score edits/correction/rescore refuse an empty note;
  Approve makes the review visible to the recorded employee.
- Phone width: review, score edit and correction forms fit without sideways scroll.

- With analysis off, a finished recording still reaches Ready and creates a
  machine transcript revision (worker flag on) but no analysis job.
- A short recording (under 25 words) gives **insufficient evidence**, never a score.
- A manager in the same branch reads the analysis; the recorded employee does
  not until it is approved; a peer and an other-branch manager are refused.
- A transcript correction creates revision 2 with the same segment IDs and
  times; revision 1 is unchanged. Rescore keeps the earlier analysis.
- Live recording, pause/resume, Stop and provisional text behave as before.
- Evidence playback (0381): a manager's evidence button plays that moment and
  **Play** beside a line plays it; **Close** stops it. Each listen adds a
  `recording_audio_played` audit row. The recorded employee sees no **Play**;
  an other-branch manager is refused; an expired recording plays nothing.
  Android app: playback works inside the WebView.

### Notifications

- [ ] Task assignment creates an in-app notification; read / mark-all-read work.
- [ ] Templates and rules visible to ADM only; a user denied `notifications.manage` loses them in UI and API.

### Developer Mode

- [ ] SA disables Reports in the header strip: STF/ADM lose Reports in the menu, `/reports` shows the maintenance notice.
- [ ] SA hides the Developer Mode strip: Reports **stays** disabled (button shows the disabled-section count).
- [ ] STF calling `supabase.rpc('get_report_data', …)` returns "This section is currently unavailable".
- [ ] STF selecting from `export_logs` / CRM tables of a disabled section returns no rows.
- [ ] SA can still open and use the disabled section; re-enabling restores access for everyone.
- [ ] Disabling FMS also blocks `/tasks/fms`; disabling Task Control also blocks `/task-evidence`.

### Settings

- [ ] Personal preferences save for every role.
- [ ] Organization settings: ADM yes, MGR no; branch defaults: MGR own branch only.
- [ ] Daily checklist management: SA and HR only unless granted.

### Ask Kiara

Automated proof: `supabase/functions/ask-kiara/eval.local.ts` (per-role eval on a local stack,
`docs/superpowers/evals/ask-kiara/README.md`), the `ask-kiara` Deno tests, and pgTAP 0213-0220,
0227, 0230. Manual pass on the web:

- [ ] STF: "aaj mera kya pending hai?" matches Home and is answered in Latin-letter Hinglish.
- [ ] STF: a branch or team question is refused (no numbers, no names); no "Ask a person" offer.
- [ ] MGR: a team question lists only the manager's own scope, matching Task Control.
- [ ] STF without `crm.view`: a walk-in or client question is refused; a CRM user gets the
      same numbers as the CRM Dashboard with phones as last 4 digits and `/crm/clients/...` links.
- [ ] An SOP question shows a Sources chip that opens the right section; a department-only SOP
      never answers for a person outside that department.
- [ ] An unanswered SOP question offers "Ask a person"; the manager sees the badge and answers;
      the answer appears in the asker's chat with a notification.
- [ ] "Complete my task" / "approve my leave" are refused; nothing changes in Tasks or Leave.
- [ ] A user at the daily limit gets the reset time; Super Admin shows no counter.
- [ ] Developer Mode → Ask Kiara off: the menu entry goes and questions are refused for
      everyone except Super Admin; on again restores it.
- [ ] A new section, route, or renamed button has its `appHelp.ts` entry and
      `docs/ASK_KIARA_APP_HELP_REVIEW.md` line updated (AGENTS.md rule).

### Native parity release gate

- [ ] Create a manual task and checklist on Android, including one doer, watchers, deadline, priority, required form, and attachment; retry an attachment failure without creating a duplicate task.
- [ ] Record and review a voice task, deny then grant microphone permission, hit the 60-second limit, and verify temporary audio is removed.
- [ ] On web and native, say "next Monday", "tomorrow at 3 pm", "second week of next month", and a note with no deadline: the first two prefill the same due date on both surfaces (7:00 PM when no time is said) with a "Deadline from your voice note" line; the last two leave the due date empty and block Assign until one is chosen.
- [ ] Import current CSV and canonical XLSX through the Android file picker; map an ambiguous identity, share a correction report, resume a partial batch, and finish Assigning Left.
- [ ] CRM tab (web CRM in a WebView, since the CRM cutover): signed-in open, client list and profile, a walk-in with a camera photo, Android Back, a `tel:` link, the JewelOS menu (CRM opens inside the JewelOS layout since 2026-11-03), and sign-out/sign-in as another user clears the previous session (`docs/CRM_CUTOVER_CHECKLIST.md` step 9). A user without `crm.view` or with the section disabled sees the section notice.
- [ ] Exercise Forms create/edit/publish/revise/archive/duplicate/publish-as-new/delete-impact, fill, immutable deleted-form submission, signed file answer, and approve/reject for reviewer and read-only roles.
- [ ] Filter Dropdown Master by all/active/inactive and deactivate/reactivate an item without changing its stable value.
- [ ] Switch Users between list and organization views; apply search/status/branch/department filters and confirm missing-manager/cycle warnings do not freeze the UI.
- [ ] Repeat portrait, landscape, compact height, keyboard-open, large-font, light/dark, safe-area, Android Back, offline/retry, and pull-to-refresh checks on Home, Tasks, FMS, Forms, CRM, and Settings inside the Android shell.
# Tasks -> FMS workspace (2026-10-20)

- Verify ordinary recurring, delegated and watched tasks retain their sections;
  assigned FMS appears only under FMS, plus explicitly authorized All Tasks.
- Check initial FMS badges, collapsed families/stages, full totals beyond 50 rows,
  server name/reference search, filters, retry and realtime page clamping.
- Check exact starter/runtime links from Tasks, Home, notifications and direct
  URLs; keep previous answers, pinned forms, evidence, approvals and handoffs.
- Check family identity across versions, archived live work, skipped branches,
  parallel assignments, repeated visits and completed multi-doer contributions.
- Check form default/workflow override/stage override, snapshot names, missing
  values, hidden answers and denied cross-account/direct API access.
- Check desktop/phone widths, keyboard disclosure and current Android shell;
  report physical-device evidence separately.
- (2026-10-23) A workflow lists only stages that hold your work; the start form is
  never a stage, and a pending start form you were asked to fill shows as
  **Form to start**. The Stage filter offers only stages with work.
- (2026-10-23) Finish a stage whose next step has no employee question: the
  confirmation shows you as the next owner ("(you)") with no red warning, Confirm
  unlocks after the server check, and the next step lands on you. **Assign to a
  Different Employee** opens the list inside that step card, a pick closes it, and
  **Keep it with me** restores you. A fixed-employee step still shows locked.
- (2026-10-23) On a phone the stage form and the confirmation open full screen;
  no form text shows above the title or below the bottom buttons while scrolling.
- (2026-10-23) The assigned FMS page shows only the record name, due/instructions
  when set and Previous form answers (stacked, larger answers; unanswered folded).
  Finishing a stage or an assigned start form returns to Tasks -> FMS with a
  notice naming the next owner. "My FMS work" goes back to the FMS tab, and
  switching tabs afterwards drops `?view=fms`. A save that still needs approval
  or other doers stays on the page.
