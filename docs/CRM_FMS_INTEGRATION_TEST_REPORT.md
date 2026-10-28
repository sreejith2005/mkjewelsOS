# CRM / FMS integration test report

Validation uses synthetic records in isolated local Postgres databases, plus the existing application suites. No production customer rows are copied into test databases. A schema-only baseline replay is distinct from a full migration-chain reset and from hosted acceptance.

## Requested scenario coverage

| # | Scenario | Automated evidence |
| --- | --- | --- |
| 1 | New Instagram enquiry | Persisted two-database runner: original starter submission, next assignee, one customer, phone and Instagram alias |
| 2 | Retry | Original starter request replay, concurrent first delivery, receipt replay and timeout after commit |
| 3 | Introduction call | Persisted source stage submission, budget/requirement and same CRM journey |
| 4 | Sales handoff | Existing FMS transition APIs and assignee assertions, then shared opaque client acknowledgement |
| 5 | Sales follow-up | Third original submission; one confirmed contact, failed contact excluded, earlier evidence retained |
| 6 | No purchase | CRM store/walk-in regression suite, no FMS-generated purchase, separate prospect/repair classifications |
| 7 | Verified purchase | CRM mixed repair/purchase vocabulary, original first-purchase instant and existing walk-in rollup regressions |
| 8 | Existing customer / WhatsApp | Independently approved WhatsApp mapping resolves accepted phone alias; new journey retains WhatsApp channel |
| 9 | No phone | Name-only, website-identity and Instagram-only persisted identities with normal MKC codes |
| 10 | Shared phone | Ambiguous family identity remains review; no merge; reviewed identity cannot split an established journey |
| 11 | Phone formats | Indian local / country-prefix equivalence and maintained international phone-country tests |
| 12 | Revised form | Historical mapping reads original submission snapshot; changed same-version definition rejected; live mapping remains separate; later definition changes pause capture until renewed review |
| 13 | Conditional sections | Original section walk preserved after live edit; legacy hidden/conditional answers excluded; zero/false retained |
| 14 | Repeated stage | Customer loop test: two original contributions and two distinct durable instance-stage IDs for repeated stage |
| 15 | CRM unavailable | FMS completion without delivery; durable leases/retry; actual timeout after receiver commit followed by exact replay |
| 16 | Out-of-order events | Reversed delivery and older source instant cannot replace newer projected answer |
| 17 | Existing lead / walk-in | Maintained CRM lead continuity, walk-in persistence, cumulative profile and returning-client prefill suites |
| 18 | Export | Original source values, stage filter, saved header order, empty header-only layout, safe CSV/phone/JSON/IST and bounded counts |
| 19 | Authorization | Denied raw-table/worker grants, inactive/ordinary/cross-branch actor, independent CRM export gate, unrelated employee denied link and direct work RPC |
| 20 | Workflow regression | Maintained Forms/branching, FMS loop/parallel/handoff, full core/web/CRM suites; existing report-worker lifecycle tests |

The main two-database runner exercises real sender/receiver handlers and SQL persistence without HTTP providers. Other scenarios use focused pgTAP and existing regression suites; this is not an assertion that twenty browser-driven production journeys ran.

## Final review regressions

The fresh reviewer found established-journey identity splitting, reinterpretation of historical definitions, inconsistent browse/profile composition, incomplete master exports and empty-layout header loss. Author regression tests reproduced the defects before their corresponding fixes. Ingestion and review now share a journey lock and recheck binding; profiles/cache/export pages use the same effective native-plus-FMS composition; historical mappings pin original snapshot digests; empty exports retain their reviewed schema.

## Reproduction and results

Final results: 155 focused and 420 maintained SQL assertions passed; 35 Deno tests passed; core 1292, web 691 and CRM 211 tests passed; all 12 final monorepo build/typecheck tasks passed. Fresh final migrations and the persisted two-database sender/receiver/race test passed. Exact commands and boundaries are recorded in the implementation report. `supabase/tests/0350_customer_*.test.sql` and `C:/crm/supabase-crm/supabase/tests/20261027_crm_fms_customer_events.test.sql` run with pgTAP against isolated schema-only copies. `scripts/validate-crm-fms-integration.ts` clones only empty `crm_fms_final_20261028` validation databases in the two named local containers and drops only that invocation's validated temporary database names.

The local baseline needs the maintained permission catalog and checked-in phone-country dictionary. Object ownership is restored for existing worker contracts; six cumulative-profile functions installed by a local patch are normalized to the declared migration role only inside the empty CRM test copy. Original local stacks and hosted project ownership are unchanged.

## Evidence boundaries

- Full monorepo tests/type/build do not prove SQL authorization or hosted behavior; the separate SQL and persisted-runner evidence addresses local contracts.
- The full migration chain, including the pre-existing 0345 guard, has not been cleared by this schema-baseline replay.
- Rendered QA uses the actual components/styles at 390px and 1440px with synthetic RPC fixtures. It is not authenticated whole-app or physical Android evidence.
- Hosted migration, deployment, scheduler/secret/provider execution, private Storage upload/download/expiry/cancellation and production-scale performance remain release gates.
- Real historical mappings and source attribution require business review; production backfill, accepted-attribution correction, two-way Sheets and provider delivery remain disabled.
