# FMS context before execution

Owner request: replace generic FMS task metadata with preceding submitted forms,
showing original questions and answers for every stage. Home, Notifications,
Tasks and direct links must open details before the current form. Web only.

1. Add a paginated, stage-authorized read RPC for complete causal form snapshots,
   including the original initial form. Preserve ordinary submission RLS; never
   infer assigned work from a template or expose unrelated instance/branch data.
2. Share field formatting and historical labels. Resolve person/branch/department
   names, hide non-rendered conditional questions, and keep file paths private.
   Authorize and audit contextual file opens using the same causal projection.
3. Reuse one context component in expanded FMS task cards and the assigned-work
   page. Fetch full forms only when details open; keep feed batch payload bounded.
4. Keep canonical work links. Assigned pages show details first; a deliberate
   Continue action mounts the current stage runner. Starter forms have no previous
   submission and retain their start flow. Do not close notifications on viewing.
5. Test snapshots, pagination, repeated visits, parallel ancestry, denied actors,
   private files, card details, and Home/Notifications/direct-link entry behavior.
6. Verify web desktop/phone rendering, focused regressions, types/build and review;
   preflight the live migration ledger before any authorized production release.
