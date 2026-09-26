# In Loop Task Workspace Implementation Plan

**Goal:** Give looped-in viewers a separate task tab and make watcher-only participation read and remark only.

**Architecture:** Partition the existing task feed using its durable `task_watchers` membership, then show the same status filters in web and native clients. A forward-only database trigger rejects task mutations by a watcher who is not an active doer, including direct RPC calls and form-driven completion. The existing audited comment RPC remains the only watcher write path.

**Tech Stack:** React, React Native, TypeScript core, Supabase Postgres, pgTAP.

## Tasks

1. Add failing shared-core tests for watcher-only capability and feed partition; implement the smallest shared rules.
2. Add failing pgTAP cases for elevated watcher completion, checklist, evidence, form, and remark access; add migration `0179` with a database mutation guard.
3. Apply the shared partition to web and mobile task tabs, counts, and mobile detail lookup; verify card actions remain absent for watchers.
4. Route new watcher notifications to `/tasks/in-loop` through migration `0180`, authorize that route in shared navigation, and select In Loop when web or native opens it.
5. Run focused tests, database tests where available, typechecks/build, then follow the required Android release gate if all mandatory checks pass.
