# Task workspace fixes

**Goal:** Show subsection counts on entry, retain visible assigned FMS work, and let employees supply required completion remarks.

**Scope:** Existing Tasks behavior requested by the owner on 2026-10-17. Preserve ongoing FMS changes in this dirty checkout. Execute inline.

1. Add failing regressions for all-tab count loading, remark-required checklist completion, and FMS definition visibility after archival/cross-branch assignment.
2. Load counts through the existing authorized bounded page RPC without hydrating other tabs. Refresh counts alongside the selected page on web/native; isolate account changes and stale requests.
3. Make the completion button open/focus required input on web and open native details. Keep upload/form requirements and server completion checks intact.
4. Add a forward migration permitting definition reads for authorized persisted FMS work only. Align phantom runtime page entries with hydratable assignments. No data rewrite or mutation grants.
5. Run focused client/database regressions, typechecks/build, related suites, and rendered checks where available. Check Android release preflight; stop at failed gates without disturbing unrelated work.

**Compatibility:** Existing RPC signatures and generated types remain unchanged. Count loads return only the current actor's authorized scope. FMS destinations continue to use the core assignment identifiers. No Storage or audit write contracts change.
