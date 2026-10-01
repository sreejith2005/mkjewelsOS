# FMS form selected user assignment implementation

1. Make publish issues select the exact step, center its canvas card, and show
   the relevant messages beside that step. Cover desktop and phone behavior.
2. Add a shared bulk assignment helper and a web/native toggle that copies
   the first human step's selected Users profile to all human steps. Preserve
   later individual overrides.
3. Extend the existing FMS definition with a linked form User question key.
   Validate that the question is available, required, and precedes any stage
   that relies on it. Persist it in a forward migration and expose it in both
   FMS stage editors. Do not infer the question from its label.
4. In the same migration, update publication validation, starter compatibility,
   assignment resolution, and atomic stage form submission/progression. Carry the
   chosen profile ID in the instance's durable context. Validate it against
   Users and coverage at the server boundary. Keep explicit stage assignees
   and manual handoff precedence.
5. Add a single audited RPC for a standalone Forms Library submission and its
   linked FMS start, so a rejected start rolls back the form submission. Update
   generated database types for the new RPC. Test core, web, native, and pgTAP
   allowed and denied cases. Check phone width and native navigation. Run the relevant
   local gates, then the linked migration dry run. Publish only after the
   required gates and production playbook checks pass.
