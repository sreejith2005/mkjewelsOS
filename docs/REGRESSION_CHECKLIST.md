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
- [ ] Recurring tasks generate on schedule; overdue tasks show as overdue.
- [ ] Staff see own/department tasks; managers see branch; admins see all (task visibility follows dashboard authority).
- [ ] CSV import and Assigning Left still work for ADM/SA.

### FMS and forms

- [ ] Start a flow, claim/complete/review a stage from FMS **and** from Home/Tasks.
- [ ] Build, publish, pause, archive an FMS flow (ADM). A user denied `fms.manage` cannot.
- [ ] Author, publish, archive a form (MGR). A user denied `forms.manage` cannot.

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
