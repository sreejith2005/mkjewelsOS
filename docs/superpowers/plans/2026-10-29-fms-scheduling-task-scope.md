# FMS follow-up scheduling and task calendar scope

1. Extend existing workspace JSON filters with optional today/overall/overdue scope. Filter the authorized relation before counts/pagination; Today is a strict Asia/Kolkata calendar day. Preserve historical behavior for callers omitting scope.
2. Share scope across Tasks categories, searches and FMS hierarchy; keep exact server totals and existing status/date/search filters.
3. Extend FmsFollowUp with optional schedule metadata on the successor stage. Existing branch conditions choose the successor and existing audited/idempotent activation creates it. Use causal predecessor form answers for requested date/time, otherwise next business-local day at 11:00; configurable delay and weekend handling.
4. Validate metadata in core/import and database publication, keep existing assignment/coverage and visit caps. No new task scheduler or external messages.
5. Run focused tests, typechecks and local transactional database tests if available. No hosted changes or publication.
