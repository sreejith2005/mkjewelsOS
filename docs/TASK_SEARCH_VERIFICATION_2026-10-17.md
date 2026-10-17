# Task search and filters verification - 2026-10-17

Approved scope: one compact search row with collapsed filters for each authorized employee. Search spans all permitted subsections and history; results retain subsection labels. Work kind, status, priority, inclusive Kolkata due dates, subsection, evidence requirements and sorting combine before 50-row server paging. Clear returns to the existing board.

Implementation: TaskSearchControls/TasksPage, shared core validation and date shortcuts, data-layer bounded hydration, typed RPC. Migration 0290 adds the authenticated read-only task_workspace_page RPC and routes task_feed_page through its common membership logic. No tables, record rewrites, Storage or mutation/audit contracts change. Existing database authorization remains enforced; callers cannot choose another actor. Ask Kiara help updated.

Local evidence:
- Core suite: 994 tests passed; data suite: 184 passed (before rebasing latest FMS context release).
- Web full attempt: 530 passed, 14 unrelated 5-second form/FMS timeouts and two mixed-version failures during main update. Retry all four affected files plus search integration/controls: 84 passed with maxWorkers=1 and testTimeout=20000.
- taskSearch and appHelp focused checks repeated after help update.
- SQL: new search contract 26 assertions; existing scale/management 77 and task visibility 17 assertions passed against explicit synthetic Docker database. No shared database reset performed.
- All six package typechecks passed. Build tracked separately in release handoff.
- Persisted local browser checks at 390x844 and 1440x1000: global/watched search, old completed CRM, private task exclusion, FMS reference, second page (5 of 55) and clear passed; screenshots inspected, no horizontal overflow. Local recurring Edge Function is absent; its expected preparation errors were isolated from page errors.
- Independent code review found no actionable issues.

Release preflight: production project yimafxhuwgfhvzczqqdd checked; existing 0289 preserved; dry-run lists only 0290; hosted SQL lint empty; seven completed physical backups confirmed. Hosted rollout, Git/Vercel/CI outcomes are reported in the final handoff. Authenticated production/physical Android interaction is not established by local browser or public assets. Current Android shell consumes the web deployment; no native source or APK changes.
