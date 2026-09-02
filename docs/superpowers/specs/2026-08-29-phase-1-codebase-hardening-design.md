# Phase 1 Codebase Hardening Design

## Purpose

Make the current JewelOS repository safer to change without altering product
behaviour, database contracts, migration history, or hosted resources.

## Scope

This phase is limited to four independent, low-risk improvements:

1. make the production-demo-data retirement UI test deterministic while
   preserving its server-side manifest and exact-confirmation safeguards;
2. add a GitHub Actions verification workflow for install, type checking,
   unit tests, build, and whitespace validation;
3. remove source files proven unreferenced by the active import graph;
4. correct operational documents to describe migrations through `0109` and
   the current source checkpoint without asserting hosted deployment state.

## Non-goals

- No Supabase migration, RLS, RPC, Edge Function, Storage, data, Auth, or
  hosted-environment change.
- No deletion, rewrite, squash, or renumbering of existing migrations.
- No query-shape or performance refactor; those require measured query plans
  and a separate approved phase.
- No review, merge, pruning, or deletion of existing worktrees or branches.

## Design

The retirement test will use synchronous DOM events for the already-tested
controlled inputs and await only the asynchronous preview rendering. This
removes user-event scheduling from the full-suite timeout path while retaining
the behavioural assertions: preview remains gated by backup and maintenance
acknowledgement, execution remains gated by the exact confirmation text, and
the exact manifest data is passed to the executor.

The CI workflow will run on pushes and pull requests. It will use the locked
pnpm version, perform a frozen install, run core and web unit tests separately,
run Turbo type checking and builds serially, and reject whitespace errors. It
will not connect to a hosted Supabase project or inject secrets.

`packages/core` remains the sole generated database-type owner. The duplicate
unreferenced `packages/api-client/src/database.types.ts` and the unreferenced
legacy `DelegateTaskModal.tsx` will be removed only after focused import and
type checks.

## Validation

- Run the retirement-card test once before and after its deterministic test
  rewrite, then run the full web suite.
- Run core tests, Turbo typecheck, Turbo build, and `git diff --check`.
- Confirm the removed files have no current import or exported API consumer.
- Do not claim local database, RLS, Edge Function, hosted, or browser proof
  from this phase.

## Rollback

Every change is source-only and independently revertible. Restoring either
removed source file is a normal Git revert; existing migrations and data remain
untouched.
