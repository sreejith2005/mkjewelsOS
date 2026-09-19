# Complete Native Mobile Parity Design

## Objective

Bring the JewelOS React Native Android application to complete behavioral
parity with every feature implemented by the approved web application. The
native app must expose the same permitted reads, writes, filters, authoring
tools, administration operations, validation, and durable outcomes while using
phone-appropriate native layouts.

The immediate reported defect is the missing Create Task action. The source
audit also found incomplete native surfaces in task import, CRM, Forms,
Dropdown Master, Users, realtime refresh, and rendered-device verification.
This design covers all of them. No web-implemented feature is deliberately
left desktop-only.

## Product and Platform Constraints

- Android is the release target. The implementation remains React Native and
  Expo; it must not use a WebView, Capacitor, Cordova, Ionic, or a packaged web
  page.
- The current web application is the behavioral reference. Mobile adaptation
  may change layout and interaction mechanics, but not fields, choices,
  permissions, validation, business rules, or outcomes.
- Existing web behavior remains unchanged except for narrow extraction of
  shared, platform-independent logic needed by both clients.
- All application data remains in Supabase. The native app must not add demo
  fallbacks, local business-record stores, client-controlled authorization, or
  a second backend path.
- Existing audited RPCs, Edge Functions, RLS policies, private Storage
  contracts, and immutable submitted-time snapshots remain authoritative.
- The app must preserve the existing unified compact navigation, native stack
  history, permissions, section availability, deep links, and safe-area work.
- Existing unrelated working-tree changes must remain untouched. Parity work
  is staged and reviewed by named path.

## Source of Truth

For each feature slice, inspect these sources together before implementation:

1. the current web page and all of its component call sites;
2. the corresponding `packages/core` decisions;
3. the corresponding `packages/data` API and typed database contract;
4. relevant migrations, RLS/RPC definitions, Storage policies, and pgTAP
   tests;
5. current native screens, navigation types, and shared native primitives;
6. maintained product specifications, plans, regression checklist, and mobile
   parity playbook where they still match current source.

Current code and executable contracts take precedence over stale tracker text.
Retired Base44 and prototype applications are outside scope and are not a
behavioral or data source.

## Architecture

### Shared business rules

`packages/core` remains the only home for platform-independent decisions such
as task-authoring scope, participant normalization, import validation, status
and filter derivation, Forms display and validation, FMS routing validation,
CRM capabilities, permission resolution, and presentation-safe calculations.

If a required decision still exists only inside a web React component, extract
it into a typed pure function with focused tests, then refactor the web
consumer to use it before the native consumer is added. Do not duplicate the
rule in the native app.

### Shared data access

`packages/data` remains the shared Supabase access layer. Native and web
clients use the same query and mutation functions. Sensitive writes continue
through the current audited RPC or Edge Function. A missing backend contract
must be added only through a forward migration with authorization, grants,
audit behavior, generated types, and pgTAP coverage; an easier client-side
write is not an acceptable substitute.

### Native presentation

`apps/mobile` owns React Native presentation, navigation, platform pickers,
camera and microphone integration, secure session storage, Android file
sharing, safe areas, keyboard behavior, and thin orchestration around shared
logic and data functions.

Complex workflows use dedicated native stack screens or step-based workspaces.
Small edits may use sheets. Long lists use `FlatList`/`ListScreen` with stable
keys, bounded initial rendering, and pagination where the server contract
supports it. Closed sheets unmount their contents.

### Navigation and identifiers

Every reachable web feature receives a native destination. Supporting screens
are registered in both the navigation parameter types and root navigator.
Nested routes carry exact record identity:

- tasks use the task instance ID;
- FMS starter work uses `fms_starter_assignment_id`;
- runtime FMS work uses `fms_instance_id` plus
  `fms_instance_stage_id`;
- Forms use the exact template/version or immutable submission snapshot;
- CRM operations use the exact client, follow-up, interaction, or document ID.

No navigation flow infers assigned work from a shared form template, a display
name, or another non-unique related record.

## Complete Feature Scope

### Tasks

The native Tasks workspace will match the current web Tasks behavior:

- My Tasks and Delegated workspaces with current status counts;
- today and overdue visibility using the shared Kolkata-day contract;
- checklist, upload-to-complete, required-form, FMS, revision, attachment, and
  completion behavior;
- task details and exact assigned-work deep links;
- manual Create Task for every authenticated user, using the shared authoring
  scope: tenant for Super Admin/Admin/Process Coordinator, branch for Manager,
  and department for other authors;
- Task versus Checklist selection, title, description, due date/time,
  priority, one doer, read-only watchers, required form, checklist items, and
  an optional initial attachment;
- permission-gated voice task capture with the same interpretation, gap review,
  editable prefill, validation, and audited create path as web;
- Bulk Import for authorized users, including the web-supported workbook/CSV
  inputs, structural validation, identity mapping, review, correction,
  resumable bounded execution, history, and Assigning Left reconciliation;
- tenant realtime refresh without replacing visible cards with a blocking
  loading state.

Task creation calls `create_manual_task_with_mode_with_audit`. The server
continues to validate tenant, organization scope, author, doer, watchers,
forms, task type, and active-user eligibility. An initial attachment is
uploaded only after the task returns an ID. If that upload fails, the app must
truthfully report that the task exists while the attachment failed, and offer
a retry against that task rather than creating a duplicate.

The import flow must not persist source workbooks or raw rows in local storage,
analytics, logs, or chat-visible output. It uses bounded chunks and stable
idempotency behavior. Mobile may present the reconciliation panels as ordered
steps, but it may not omit a supported source format or validation stage.

### CRM

The native CRM workspace will provide the complete current web behavior:

- walk-in registration;
- directory search, pagination, and every current filter;
- client create and edit with duplicate-phone protection and stale-version
  handling;
- client history, walk-ins, follow-ups, documents, and linked records;
- interaction logging;
- follow-up creation, queue filters, completion, cancellation, rescheduling,
  and reassignment;
- CRM ownership reassignment;
- private document upload, signed viewing, and authorized removal;
- guarded client merge with the same survivor/duplicate rules and history
  preservation.

Native controls derive usability from shared CRM capabilities, but RPC/RLS
authorization remains decisive.

### Forms

The native Forms Library will include:

- template search and every lifecycle filter;
- form fill and FMS starter submission;
- native form authoring with all field families, sections, option sources,
  conditional visibility, answer routing, permissions, preview, draft saving,
  editing, revision, publishing, and publishing as a new form;
- version families and submission counts;
- My Submissions, grouped history, exact submitted-time form snapshots, answer
  rendering, linked-module metadata, and review history;
- authorized approval and rejection with notes;
- archive and guarded deletion, including a pre-delete impact summary and a
  post-delete result that confirms historical submissions remain readable.

Editing a form already linked to Tasks or FMS preserves the same form ID when
the existing server contract permits in-place editing. Published revisions and
publish-as-new behavior must preserve pinned running-work versions.

### FMS

Retain and re-audit the current native FMS console, live instances, assigned
work, starter forms, stage forms, evidence, checklists, claims, completion,
review, reassignment, revision, escalation, decision routing, builder, and
canvas behavior against the current web implementation.

The native builder may use touch-specific gestures and serialized editing
panels, but it must read and write the same complete `FmsFlowDefinition` and
pass the same validation. Direct deep links and form submission must preserve
the exact starter or stage identity, and submission plus progression remains
one server transaction.

### Recurring / To-Do and Task Control

Re-audit every current web view, filter, schedule/template mutation,
verification, follow-up, performance display, coverage state, import entry,
evidence action, and template action. The native screens must consume shared
score and authoring contracts and preserve save-time materialization. Large
workspace responses must not freeze the Android main thread; contract changes
needed for bounded payloads require an additive forward migration and web
compatibility.

### Users and permissions

The native Users workspace will retain the current directory, invite, edit,
password, account status, contacts, roles, designations, branch/department,
reporting manager, buddies, week-off, and guarded deletion behavior. It will
also add the web organization/hierarchy view and its filters.

Permission Management, dashboard authority, user/designation overrides,
Developer Mode section availability, and protected-section behavior remain
conceptually separate. Native controls use `hasPermission`; direct navigation
and all writes remain blocked server-side when unauthorized.

### Dropdown Master

Add the web All/Active/Inactive filter and authorized delete/deactivate
behavior while retaining category search, counts, create/edit, stable values,
and user-safe constraint errors.

### Remaining sections and supporting behavior

Home, Dashboard, Notifications, Availability, Reports, Settings, daily
checklists, profile, update delivery, authentication, uploads, and every other
web-implemented route receive a source-to-source parity re-audit. This includes
all filters, tabs, empty/error/loading states, administrative actions, report
preview/export/history, notification provider administration, daily-checklist
authoring/gating, section maintenance, theme behavior, and internal links.

Meeting AI remains excluded only while it is not an implemented web route. If
it becomes implemented during this project, the parity inventory must include
it before completion.

## Voice Task Capture

Voice task creation is not a separate task-writing contract. Native capture
records audio with explicit microphone permission and visible recording state,
sends it through the same authenticated interpretation service as web, then
fills the ordinary native task composer.

Interpretation is always reviewable. Missing title, assignee, due date, or
checklist information produces the same blocking gap guidance as web. The user
may correct every interpreted value before submission. Audio, transcripts, and
personal data must not be logged or retained beyond the existing service
contract.

Permission denial, interrupted recording, unsupported audio, network failure,
and interpretation failure leave the manual composer usable and do not claim a
task was created.

## Import Interaction Design

The native import workspace is a dedicated full-screen flow:

1. choose or share a supported CSV/XLSX file into the app;
2. validate file size, workbook structure, expected sheets/headers, row limits,
   and required fields;
3. show normalized rows and structural problems without exposing unrelated
   employee data;
4. resolve identity mappings explicitly—never infer people or spreadsheet
   fill-down mappings;
5. review one-time versus recurring routing and checklist rows;
6. execute bounded resumable chunks through the same audited import contract;
7. show aggregate progress, safe failure details, correction output, and
   idempotent replay status;
8. link unresolved rows into Assigning Left.

Closing or backgrounding the app preserves only non-sensitive progress
coordinates required by the existing resumable contract, never workbook bytes
or raw row data. A resumed run revalidates the selected source and server
state.

## Realtime and Refresh Behavior

Native operational screens subscribe to the same tenant topic signals as their
web counterparts. Realtime is only a wake-up signal; screens refetch through
their existing RLS/RPC loaders. Subscriptions are multiplexed and torn down on
session or tenant change.

Background refresh preserves current content, selection, scroll position, and
unsaved editor state. Initial load, background refresh, and action-in-progress
states are visually distinct. A failed optional refresh shows a retryable
message without clearing still-valid content.

## Responsive and Accessibility Requirements

- All screens respect Android safe areas, status/navigation bars, display
  cutouts, and keyboard insets.
- Portrait phone width is the baseline. Landscape and compact-height layouts
  remain usable without hidden actions or clipped sheets.
- Editors use one scroll owner and keep the active input visible above the
  keyboard.
- Controls meet the existing touch-target token. Primary actions are reachable
  without precision tapping and destructive actions require confirmation.
- Text supports device font scaling without overlapping controls or truncating
  critical values.
- All actionable controls expose labels, roles, state, and disabled reasons to
  accessibility services.
- Lists remain virtualized; expensive derivation is memoized only where it is
  measurable and stable.
- Light and dark themes cover navigation chrome, sheets, forms, pickers,
  loading/error states, and platform dialogs where controllable.

## Loading, Errors, Connectivity, and Draft Safety

Every data-backed screen defines initial loading, empty, refresh, recoverable
error, permission-denied, section-disabled, offline, and expired-session
states.

- A failed write never displays success.
- Field validation identifies the affected input or import row.
- Permission errors are not rendered as empty datasets.
- Sensitive mutations are disabled while in flight to prevent duplicate taps.
- Idempotency keys are stable for a retry of the same logical operation and
  new for a genuinely new operation.
- Unsaved forms and editors warn before destructive back navigation.
- Temporary connectivity loss preserves in-memory draft values. Any local
  draft persistence contains the minimum necessary non-secret data, is scoped
  by authenticated user and record identity, expires, and is cleared on
  logout. It never becomes an offline business-record database.
- Session expiration unmounts protected navigation and clears user-scoped
  draft state before returning to login.

## Security and Privacy

- Client navigation and hidden buttons are convenience controls only.
- Every protected write uses its existing audited server contract or a newly
  reviewed equivalent with server-side actor, tenant, organization, active
  account, permission, and input validation.
- New database contracts require unauthenticated, inactive, cross-tenant,
  cross-branch/department, ordinary-user, privileged-user, and service-role
  tests where applicable.
- Storage remains private. Uploads validate MIME type, extension, size,
  ownership path, authorization, signed access, cleanup, and audit linkage.
- Production data, customer details, voice content, workbook rows, tokens,
  signed URLs, credentials, and service-role material never appear in logs,
  analytics, source, Git, screenshots, or test fixtures.

## Testing Strategy

Each parity slice follows test-driven implementation:

1. add a failing pure/core, data, navigation, or source-contract test for the
   missing behavior;
2. implement the smallest shared contract or native presentation change;
3. run the focused test to green;
4. run affected core, data, web, and mobile tests;
5. run strict typechecks and `git diff --check`;
6. compare the native result against the web app at phone width;
7. exercise allowed and denied behavior on an authenticated Android device.

The mobile test setup must be extended when necessary so native component and
interaction tests are actually collected. Pure `.ts` tests alone do not prove
rendered native behavior.

Required regression classes include:

- ordinary author, Manager, Process Coordinator, Admin, and Super Admin task
  scope;
- allowed and denied direct navigation/API operations;
- duplicate taps, timeouts, retries, and stale record versions;
- malformed, oversized, duplicate, partially mapped, interrupted, and resumed
  imports;
- upload success, rejected MIME/size, database failure after upload, cleanup
  failure, and signed-view expiration;
- exact FMS starter/stage deep links from Home, Notifications, Tasks, and FMS;
- historical Forms submissions after revision, archive, and deletion;
- offline/background/resume and session-change behavior;
- compact width, landscape, keyboard-open, font-scaled, light, and dark layouts.

## Delivery Sequence

### Slice 1: Tasks parity

Deliver native manual Create Task first, followed by voice capture, Tasks
realtime/background refresh, and the complete import workspace. This restores
the user-reported missing primary action and establishes reusable authoring and
file-workflow patterns.

### Slice 2: CRM parity

Deliver the complete native directory, client editor, merge, interactions,
follow-ups, reassignment, and documents.

### Slice 3: Forms parity

Deliver submissions/history/review, lifecycle parity, deletion impact, and
publish-as-new around the existing fill and builder work.

### Slice 4: Administration parity

Deliver Dropdown Master status/delete behavior and the Users organization
hierarchy, then close any source-audited Notifications, Reports, Settings,
permissions, or daily-checklist administration gaps.

### Slice 5: Cross-surface reconciliation

Re-audit every web route and supporting action against native using a checked
parity matrix. Reconcile deep links, realtime refresh, uploads, error states,
and responsive/accessibility findings. No row closes from screen presence
alone; the relevant action and server outcome must be verified.

### Slice 6: Release verification

Run the complete automated and device gates, create the signed APK only through
the maintained mobile release process, verify its embedded bundle and
signature, install it as a standalone build, and perform the authenticated
role-based walkthrough.

## Completion Evidence

Completion requires distinct evidence for:

1. focused unit and contract tests;
2. complete core, data, web, and mobile test suites;
3. all workspace and mobile strict typechecks;
4. production web build;
5. local database reset, pgTAP, and lint for any database change;
6. Android JavaScript export and clean release assembly;
7. APK application ID, version, embedded bundle, signature, and install;
8. authenticated physical-device walkthrough for representative roles;
9. rendered responsive/accessibility comparison against web at phone width;
10. hosted Supabase or deployment proof only when an explicitly approved
    release step performs it.

A green TypeScript build, an APK file, a Git push, or a successful web
deployment is not by itself native feature parity.

## Completion Criteria

This project is complete only when:

- every current web-implemented route and supporting workflow has a real
  native destination;
- Create Task, voice authoring, and bulk import are functional in native;
- CRM, Forms, Users, Dropdown Master, and all administrative gaps are closed;
- all clients use the same shared decisions and Supabase operations;
- no placeholder, web-only notice, or deliberate mobile omission remains for a
  web-implemented feature;
- unauthorized direct access is rejected by the backend and covered by tests;
- exact task, form, FMS, CRM, notification, and submission identity survives
  every entry surface;
- existing web workflows retain their behavior;
- the app remains responsive and accessible on the target Android device;
- a signed standalone APK passes the complete authenticated device walkthrough;
- the final handoff lists changed files, database/security impact, compatibility
  concerns, exact validation results, device evidence, and any external
  operational blocker without overstating readiness.
