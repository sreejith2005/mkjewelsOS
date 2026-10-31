# FMS Workflow Forms hierarchy

Use the existing authorized `get_form_provenance` response to classify FMS-created forms by current workflow attachments, falling back to authorized immutable creation context for unattached drafts. Keep unavailable sources visible without recovering restricted metadata. Do not duplicate persisted forms, alter submission entry points, or change write authorization.

1. Cover hierarchy grouping, deduplication, status/search filters, and unavailable sources with focused core tests.
2. Extend the existing FormsPage FMS origin view with workflow and stage selectors and nested workflow/stage headings, reusing its existing version/action cards.
3. Run core grouping tests, FormsPage regression tests, and TypeScript checks. Report browser/hosted evidence separately.

No schema, RPC, RLS, Storage, audit, or generated-type changes are required. Current provenance exposes stage names rather than stage IDs; names categorize display only and never address persisted assigned work.
