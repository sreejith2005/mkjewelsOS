# FMS task workspace release - 2026-10-22

Owner authorization: "deploy necessary migrations and push to main".
Approved implementation: `ccd7f0a`, including `9a73a3a` and the reviewed feature.
Target: `jewelos-prod` (`yimafxhuwgfhvzczqqdd`) and `origin/main`.

## Scope and preflight

The linked project was confirmed through `supabase.cmd projects list` and its
project reference. Its migration ledger matches source through 0297. The linked
dry run lists exactly 0300-0317, with no seeds or roles. These eighteen migrations
implement the approved workspace, naming, visibility and projection refinements.
No CRM-project migration, Edge Function, secret, native Android or APK change is
included. See [implementation evidence](FMS_TASK_WORKSPACE_IMPLEMENTATION.md) for
the exact changed file manifest, compatibility and authorization contracts.

Latest completed physical backup confirmed by read-only CLI metadata:
2026-10-21T20:25:01.144Z (2026-10-22 01:55 IST); seven completed daily backups
listed, PITR disabled. No restore was attempted. Historical submissions and live
definitions are preserved. Recovery uses a compatible web client and reviewed
forward SQL correction; the old four-tab client is not a full behavior rollback.

The full local database suite has documented baseline failures. All 49 distinct
failure descriptions reproduced on the unchanged baseline; the merged Dashboard
budget case passed serially. The final focused gate passed 48 files / 590
assertions, including search, authorization and related workflows. Core, data,
web, typecheck/build and authenticated synthetic browser evidence are recorded
in the implementation report. The owner authorized release after receiving these
limitations. No synthetic fixture or production customer-flow test is part of
this deployment. No separate hosted staging proof is asserted.

Hosted pre-apply `supabase.cmd db lint --linked --level error` returned no errors.
The cumulative 87-file publication scan returned zero credential/path findings;
the unrelated system-prompt snapshot is excluded. Production checks are limited
to migration/schema/grant and unauthenticated denial verification, with no
customer record output. The release operator monitors migration and publication
results during this session; authenticated staff workflow monitoring remains
with the owner after release.

## Outcome

`supabase.cmd db push --linked --yes` applied all eighteen migrations 0300-0317
successfully. The post-apply ledger contains all eighteen versions; the second
linked dry run reports up to date, with no pending migrations, seeds or roles.
The new form naming column exists. Hosted post-apply lint at error level again
returns no errors.

Read-only grant verification confirms the three workspace RPCs are executable
by authenticated users only, with anon and service-role execution denied. The
private batch naming helper, private authorized naming resolver and old context
wrapper deny execution to all three client roles. Anonymous HTTP probes of
the three workspace RPCs and private batch naming helper each return HTTP 401 /
SQLSTATE 42501. No customer records were requested or printed.

The first HTTP-probe attempt stopped at its target check because local browser
configuration was not the production target. The successful retry loaded only
the production anonymous key into process memory through authenticated CLI output
capture; no key was logged, written or committed.

This release record is committed with the matching client before pushing main.
The operator verifies remote SHA equality after publication. Git publication and
web-host deployment remain separate evidence boundaries; authenticated production
employee flows, physical Android behavior and a hosted restore drill are not
claimed by these schema/denial checks. The unrelated local-container restoration
limits remain as documented in the implementation report.
