# FMS Workflow Forms hierarchy

Release integration uses current main's authorized `list_fms_built_forms` response. Migration 0358 adds author-only `links` containing exact workflow and stage IDs/names from the existing tenant-filtered relationship. Existing family IDs, classification, aggregate names, reader authorization and grants remain unchanged. Legacy or non-author responses use generic unavailable-source groups without inferring pairs. Do not duplicate persisted forms, alter submission entry points, or change write authorization.

1. Cover hierarchy grouping, deduplication, status/search filters, and unavailable sources with focused core tests.
2. Extend the existing FormsPage FMS workflow forms view with workflow and stage selectors and nested workflow/stage headings, reusing its existing version/action cards and current library/FMS separation.
3. Run core grouping tests, FormsPage regression tests, and TypeScript checks. Report browser/hosted evidence separately.

The existing read RPC gains an optional JSON metadata field; no tables, write contracts, RLS, Storage or audit behavior change. Stage IDs keep identically named stages separate in grouping/filtering. These categories never replace exact assignment identity or address persisted work.
