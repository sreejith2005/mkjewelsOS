# Tenant Realtime Refresh Design

## Goal

Make an already-open JewelOS web session reflect authorized operational changes
without a browser refresh. This includes task assignments and progress, FMS
work, CRM follow-ups and client activity, forms, availability, user and
reference-data changes, settings, and Super Admin Developer Mode section
availability.

## Scope and success criteria

This change applies to the maintained `apps/web` product surface. When an
authorized actor changes data that affects a signed-in user's currently open
page, the affected view refreshes automatically after a short debounce. When
Super Admin changes section availability, every non-bypass user in that tenant
immediately re-evaluates the route guard and sees the maintenance notice if
their current section was disabled. A direct URL remains guarded.

The change is not a second authorization system, a client-side data cache, or
a background polling loop. The event is only a wake-up signal. Every reload
continues to use the existing RLS-protected view, table, or RPC contracts.

## Architecture

Create a forward-only `tenant_realtime_events` table containing only the
tenant id, a bounded topic, monotonic event id, and timestamp. It contains no
customer content, task title, assignee identity, form answer, or other
business payload. Authenticated active profiles may receive events only for
their own tenant. Supabase Realtime requires that tenant-scoped `SELECT`
authorization to deliver database changes; the application does not issue
direct REST reads against this safe signal table.

Database triggers publish an event for changes in these functional domains:

- `tasks`: task instances, assignees, watchers, checklists, attachments, and
  task-linked form submissions;
- `fms`: instances, instance stages, checklists, evidence, stage logs, and
  FMS-linked form submissions;
- `crm`: clients, walk-ins/interactions, and follow-ups;
- `forms`: form templates and standalone submissions;
- `organization`: availability, user profiles, branches, departments, and
  dropdown/reference data;
- `settings`: tenant, branch, preferences, and Developer Mode controls.

The migration adds the event table to the Supabase Realtime publication and
installs minimal, `SECURITY DEFINER` trigger functions that only insert the
safe topic signal. Trigger execution never bypasses the authorization of the
subsequent browser reload. Existing audited RPCs and audit records remain
unchanged.

In the web app, a shared `subscribeToTenantRealtime` facility will follow the
existing Strict-Mode-safe Notifications subscription lifecycle: one channel per
tenant/topic set, listener fan-out, delayed teardown, and explicit channel
removal. A `useTenantRealtimeRefresh` hook will coalesce bursts into one
refresh, skip stale callbacks after unmount, and expose no server payload to
components.

Each page subscribes only to topics that can affect its rendered state:

| Surface | Topics |
| --- | --- |
| App shell / Developer Mode | settings |
| Home and Dashboard | tasks, fms, crm, organization, settings |
| Tasks and recurring to-dos | tasks, forms, organization |
| FMS builder and live FMS tasks | fms, forms, organization |
| CRM directory, details, walk-ins, follow-ups | crm, organization |
| Forms | forms, tasks, fms, organization |
| Availability, Users, Settings, Dropdown Master | organization, settings |
| Notifications | existing per-profile notification subscription, plus relevant page reloads through the above topics |
| Reports | settings and organization; in-progress exports continue to use their existing status contract unless a report job mutation is added to the event map |

The initial implementation excludes the incomplete mobile client and external
provider delivery. It also deliberately does not subscribe every hidden route
or embed a full-table change stream in the shell.

## Reliability and error handling

The client first loads normally, then subscribes. If Realtime is temporarily
unavailable, existing data remains visible and a reconnecting channel resumes
future updates; no page is blocked or downgraded in authorization. A refresh
failure surfaces through the page's existing error state while keeping the last
successful data where the page already does so. Realtime events are hints:
duplicate, out-of-order, or missed events are safe because the next event or a
normal revisit reloads the authoritative query.

The event table needs bounded retention. A cleanup function/job will remove
only old safe signals after a documented interval; it will not delete audit or
business records. The exact retention mechanism must use the repository's
existing scheduler conventions and be tested locally.

## Security

RLS stays the enforcement boundary. The event table grants no access to
business data, has no client mutation policy or grant, validates the topic
domain at the database layer, and has tenant-scoped receive policy. The
database trigger function uses a fixed search path, is not executable by
browser roles, and never includes changed-row JSON in the signal. The client
does not rely on the event payload for rendering and always refetches through
the established RLS/RPC API.

## Compatibility

No applied migration is changed. Existing mutating RPC signatures, optimistic
versions, idempotency keys, and audit records remain compatible. This is a
live-update enhancement only: a disconnected or older deployment keeps its
manual-refresh behavior without corrupting data.

## Verification

pgTAP will prove the event table's RLS, deny anonymous/cross-tenant access and
browser writes, prove permitted same-tenant reception, validate safe topics,
and prove representative task, FMS, CRM, and section-control mutations emit
the expected topic without sensitive payloads. Focused Vitest tests will prove
channel sharing, Strict Mode-safe cleanup, debounce behavior, topic filtering,
and AppShell/representative page refresh wiring. Typecheck, build, diff checks,
and a local two-account browser smoke test will distinguish source, database,
and rendered realtime evidence. Hosted Supabase publication and Vercel browser
testing require separate release approval and evidence.
