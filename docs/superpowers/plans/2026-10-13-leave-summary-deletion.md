# Approved leave summary deletion

1. Add a protected Super Admin permission and an audited, tenant-scoped batch RPC (1–500 selected IDs, duplicates deduplicated, atomic failure on inaccessible IDs). Individual deletion uses the same RPC.
2. Remove selected requests from persisted leave history and totals. Retain original request snapshots and private approval images as audit evidence. Reconcile only availability explicitly attributed to deleted approved requests; preserve manual changes and remaining approved leave. Restore unfinished covered work when the employee is available; preserve completed work and other FMS assignees.
3. Add selection, Select all, individual Delete, and a count/reference confirmation to web Summary screen on desktop and mobile browsers. Clear stale selections after refresh and retain entries on errors.
4. Verify pgTAP authorization/atomicity/coverage, client interactions, shared permission parity, TypeScript, builds, and related regression suites. Validate rendered web at phone width at desktop and phone widths.
5. Follow production web release gates and preserve unrelated work and existing branch commits. Owner scope update: web app on PC and mobile browsers only; no Android update now. Native UI edits from this task were removed.
