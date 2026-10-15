# Full task editing

Owner approved the in-chat design on 2026-10-13. Extend the existing editor and
`admin_edit_task_with_audit(uuid,jsonb)`; keep task identity, completed work,
uploads, submissions, assignment history and audit history intact.

1. Add failing shared payload/initialization and web editor tests covering type,
   requirements, participants, categorization, verifier and checklist identity.
2. Load current task details and eligible reference options when editing opens.
   Use shared validation and serialization for the web editor.
3. Add forward migration 0238 extending the existing audited RPC. Validate
   tenant, active actor, permissions, reference scope, checklist ownership,
   participants, form compatibility and dates. Archive removed checklist items;
   retain completion metadata. Deactivate removed assignments. Keep completion
   state protected. Respect explicitly edited upload requirements on imports.
4. Add pgTAP allowed/denied and transactional regression cases; run against the
   local JewelOS database only. Update the generated checklist table types.
5. Run focused tests, related suites, monorepo type/build checks and review diff.
   Check rendered web at desktop and phone widths. Android work and releases
   are explicitly deferred by the owner. Report local and hosted evidence separately.

Edits affect the selected occurrence. Existing Recurring / To-Do authoring owns
future schedules. No CRM changes. Preserve unrelated leave/visual-refresh work.

Requirement edits must remain enforced in normal, upload and required-form
completion paths. Form submission and completion remain transactional. Imported
upload exceptions use a protected durable flag, preserving direct-write proof guards.
