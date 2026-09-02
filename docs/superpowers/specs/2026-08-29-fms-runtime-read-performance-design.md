# FMS Runtime Read Performance Design

## Purpose

Make the FMS runtime responsive as tenant data grows without changing FMS
business behaviour, assignment eligibility, RLS enforcement, audit logging,
or the existing write RPC contracts.

## Scope

This is the first execution wave of the performance audit. It replaces the
current runtime screen's broad, independent table reads with a purpose-built,
server-scoped read contract. The screen will receive only instances visible to
the caller and the runtime records belonging to those returned instances.

The FMS builder, task authoring references, forms library, CRM, and availability
screens are explicitly out of scope for this wave. They remain separate,
independently testable performance work items.

## Current Problem

`loadFmsRuntime` in `apps/web/src/features/fms/api.ts` issues eight parallel
browser queries with fixed global limits: instances (200), instance stages
(1,500), stage definitions (1,000), flows (300), checklist items (2,000),
evidence (1,000), stage logs (3,000), and users (500). The browser combines
and filters those rows after RLS has allowed them through.

The limits silently truncate long-lived tenants and cause the request and
render cost to grow with unrelated historical data. Adding client caching or
only raising the limits would retain both problems.

## Design

### Read Contract

Add a forward-only migration that defines one authenticated,
`SECURITY DEFINER` RPC, `load_fms_runtime_page`, returning a JSON document with
the same logical sections consumed by `FMSTasksPage`:

- `instances`: a descending, cursor-paginated page of active/recent FMS
  instances that the current caller can already read under the existing FMS
  access model;
- `stages`, `checklist`, `evidence`, and `logs`: only rows whose instance or
  instance-stage identifier belongs to that page;
- `definitions` and `flows`: only the published/revision definitions referenced
  by those instances;
- `users`: only active, login-enabled tenant profiles referenced by returned
  instances, stages, logs, or evidence.

The RPC will accept an explicit page size (default 50, maximum 100) and an
opaque cursor derived from `(started_at, id)`. It will return `next_cursor`
only when additional eligible rows exist. Ordering is deterministic:
`started_at DESC, id DESC`.

The function will obtain the actor via `current_profile()`, reject inactive
sessions, and apply the same tenant and role/branch rules as the existing FMS
read policies. It does not accept tenant, branch, department, or user IDs from
the browser. It performs no writes and therefore creates no audit row.

### Client Compatibility

`loadFmsRuntime` will call the RPC and map its document to its current return
shape. `FMSTasksPage` retains existing display, actions, signed evidence URLs,
and write calls. It will initially load one page and expose an explicit
"Load more" action only if `next_cursor` is present; it will not silently
merge data from broad fallback reads.

The FMS runtime types will gain `nextCursor` and the page loader will accept an
optional cursor. Existing callers without a cursor retain the first-page
behaviour. The browser does not duplicate access-control or assignment-scope
logic.

### Index and Query Evidence

The migration will add only indexes supported by an `EXPLAIN (ANALYZE, BUFFERS)`
comparison against the exact page predicate. The expected primary access path
is a tenant-aware, descending index on FMS instance start time and id. Existing
child-table indexes will be reused where they match the returned page IDs;
new child indexes require measured evidence rather than speculation.

No existing migration, policy, grant, function signature, or index will be
removed or changed in place.

## Security and Data Integrity

- RLS remains enabled on every underlying business table; the RPC enforces the
  same active-profile, tenant, role, and branch constraints before reading.
- `search_path` is pinned to `public`, all function privileges are revoked
  from `public`/`anon`, and execute is granted only to `authenticated`.
- The response contains no profile/contact fields beyond those already needed
  by FMS runtime display. It does not broaden direct-assignee search or
  assignment eligibility.
- Existing audited mutation RPCs remain the exclusive write path. This read
  contract cannot create, reassign, complete, review, or cancel work.

## Validation

1. Add pgTAP coverage for first-page ordering, cursor continuation, tenant
   isolation, manager branch scope, inactive-session denial, and rejection of
   an oversized page request.
2. Add a focused Vitest test proving the client maps the RPC response and that
   `FMSTasksPage` preserves its existing initial loading/error/action states.
3. Run type checking for affected packages, focused FMS tests, the relevant
   pgTAP suite after a local reset, and `git diff --check`.
4. Capture local `EXPLAIN (ANALYZE, BUFFERS)` evidence before and after the
   index decision using realistic multi-instance fixtures. Local query evidence
   is not production performance proof.
5. Do not claim hosted database, deployment, or authenticated browser evidence
   unless those checks are run against the named environment separately.

## Rollout and Rollback

The client will ship only after the new RPC and its generated types are present.
Rollback is a source rollback to the broad reader while retaining the
forward-only migration, or a new corrective migration if the contract requires
change. No FMS records, audit records, files, or historic migrations are
deleted in either path.
