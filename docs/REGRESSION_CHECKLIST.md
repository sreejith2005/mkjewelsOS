# JewelOS regression checklist

Run the automated gates first, then the manual pass for every area your change
could reasonably affect. Record the validation level you actually reached
(static, local database, browser, hosted) in the handoff; never report a gate
you did not run.

## Automated gates

```powershell
pnpm.cmd --filter @jewelos/core test         # includes permission resolver + SQL catalog parity
pnpm.cmd --filter web test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
supabase.cmd db reset                        # local only
supabase.cmd test db                         # pgTAP, incl. 0156_granular_permissions
supabase.cmd db lint --local --level warning
git diff --check
```

## Manual pass

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

### FMS assistant (AI debugger and builder) - 2026-10-23

Ships dark: every switch is off until an administrator turns it on under FMS ->
**Assistant**. Design and threat model: `docs/FMS_AI_ASSISTANT.md`.

- [ ] With all switches off (default), FMS looks and works exactly as before:
      no **AI assistant** button, **New workflow** opens the name/purpose step.
- [ ] ADM switches **Debug workflows** on. In a draft, **AI assistant** ->
      **Check** lists the same errors as Publish readiness; **Go to step**
      focuses the same control; **What happens if…** follows the routes.
- [ ] **Ask** on an unsaved draft answers from the current, unsaved edits and
      marks evidence as From the workflow / Simulated / Observed / Not enough
      evidence. It never saves, publishes or assigns anything.
- [ ] **Build with AI** (switch on): **New workflow** -> **Build with AI**,
      describe a process, review, **Apply to editor** once. One **Undo**
      removes all applied changes; **Redo** restores them. Save draft and
      Publish behave exactly as for a manual workflow (same RPCs and checks).
- [ ] Edit the draft while the assistant is answering: the preview says it is
      out of date and **Apply to editor** is disabled.
- [ ] Live workflow card -> **Ask AI**: read-only. A suggested fix offers
      **Create a new version to apply this** (normal revision RPC).
- [ ] **Diagnose runs** (switch on): **Run** tab, pick a run, observations
      load without AI; nothing is sent to AI until **Include this run's
      records** is ticked.
- [ ] Denied: a user without `fms.manage` sees no assistant and a direct
      `fms-ai` call returns 403; with FMS disabled in Developer Mode it returns
      403; another tenant's run id returns "not one you can inspect".
- [ ] Daily limit: after the limit the assistant says so; manual editing works.
- [ ] Phone width: the assistant opens as a bottom sheet; the header with
      **Save draft** and **Publish** stays visible; Escape/close works.
- [ ] A failed FMS step submission (e.g. revoked permission) still shows its
      original error; the run's **Run** tab then lists the failed attempt.

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
- [ ] CRM tab (web CRM in a WebView, since the CRM cutover): signed-in open, client list and profile, a walk-in with a camera photo, Android Back, a `tel:` link, "← JewelOS", and sign-out/sign-in as another user clears the previous session (`docs/CRM_CUTOVER_CHECKLIST.md` step 9). A user without `crm.view` or with the section disabled sees the section notice.
- [ ] Exercise Forms create/edit/publish/revise/archive/duplicate/publish-as-new/delete-impact, fill, immutable deleted-form submission, signed file answer, and approve/reject for reviewer and read-only roles.
- [ ] Filter Dropdown Master by all/active/inactive and deactivate/reactivate an item without changing its stable value.
- [ ] Switch Users between list and organization views; apply search/status/branch/department filters and confirm missing-manager/cycle warnings do not freeze the UI.
- [ ] Repeat portrait, landscape, compact height, keyboard-open, large-font, light/dark, safe-area, Android Back, offline/retry, and pull-to-refresh checks for every row in `MOBILE_PARITY_MATRIX.md`.
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
