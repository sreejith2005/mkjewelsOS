# CRM cumulative profile release - 2026-10-23

Owner authorization: deploy the necessary migrations and push the reviewed CRM fix to main. The owner explicitly requested production release after being told hosted staging was not configured. Hosted staging was not performed; local validation and production verification remain distinct.

Target: CRM project `walk-in_crm` (`fsydcsyqnddacjfoutfe`). No JewelOS-project migration, Edge Function, secret, Storage policy or APK release is part of this change.

Migration: `20261023000100_crm_cumulative_profiles.sql`. Adds invoker profile/default reads and extends the existing audited queue/walk-in contracts. Phone-based intake uses the most recently visited profile; saved nonblank profile answers accumulate. Reads and migration application do not rewrite historical client, visit, form or document rows.

Validation: 219 CRM UI tests, 702 existing PostgreSQL assertions, 32 new contract assertions and a rolled-back full-migration rehearsal passed. CRM typecheck, web build, five Kiara help tests, independent review and synthetic 1440px/390px browser checks passed. Historical clean migration replay has an existing guard failure in 20261009000100; local database testing used a current hosted-schema clone with synthetic fixtures.

Preflight: confirmed CRM project reference and linked migration ledger; dry run listed only the migration above, with no seeds or role changes. Private schema and data snapshots/digests are stored outside Git. Refresh the preservation snapshot immediately before applying.

Release sequence: review named staged paths and credential-safe scan; commit and integrate current origin/main; apply only the CRM migration; verify ledger, preserved data and authorization; push main; verify remote SHA and web-host deployment independently.

Rollback: retain the additive database migration and roll the web host back to its previous compatible deployment if required. Correct database contracts with a forward-only migration. Do not delete/reparent client history or rewrite the migration ledger.

Production database outcome: migration applied successfully to the confirmed CRM project. The subsequent dry run reports no pending migrations. The CLI emitted a catalog-cache timeout warning after apply; live read verification succeeded. Counts and content digests of clients, timeline, forms, documents, queue, leads, referrals, households and phone index were identical before/after. Read-only authenticated-role checks confirmed persisted address, DOB, geography, billing phone and occupation are available for the reported case, with original profile identity preserved. This is SQL/RLS read evidence, not an interactive staff-login test.

Integrated source validation after rebasing onto current origin/main: 219 CRM tests passed again; CRM typecheck and web production build passed. The source release is the commit containing this record. Git remote equality and web-host status are verified separately after push; no APK or Edge Function deployment is needed.
