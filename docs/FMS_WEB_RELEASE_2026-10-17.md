# FMS web release preparation ? 2026-10-17

Status: prepared locally, not deployed or pushed to main.
Target authorized by owner: jewelos-prod (`yimafxhuwgfhvzczqqdd`).
The owner explicitly requested this project only, without separate staging.
Android is deferred. No Android build or release is included.

The release branch is `release/fms-web-20261017`, based on `origin/main`
`e1a675f`. The original dirty working branch remains intact.
Only FMS web, required shared contracts, tests, and documentation are carried.
Task video evidence and main's current styling are preserved. Sidebar and
other concurrent task-control changes are excluded.

## Migration reconciliation

Production already contains `0259_task_video_evidence`. Never apply the old
working-tree FMS files using their development numbers or `--include-all`.
The release has new forward-only copies after production's latest version;
original isolated development-stack files are unchanged.

| Development-stack file | Release file |
| --- | --- |
| `0236_fms_initial_form_routing.sql` | `0260_fms_initial_form_routing.sql` |
| `0239_fms_assignment_contract.sql` | `0261_fms_assignment_contract.sql` |
| `0240_fms_visit_assignment_decisions.sql` | `0262_fms_visit_assignment_decisions.sql` |
| `0241_fms_confirmed_work_transition.sql` | `0263_fms_confirmed_work_transition.sql` |
| `0242_fms_assigned_work_context.sql` | `0264_fms_assigned_work_context.sql` |
| `0243_fms_exact_form_starters.sql` | `0265_fms_exact_form_starters.sql` |
| `0244_fms_assigned_stage.sql` | `0266_fms_assigned_stage.sql` |
| `0245_fms_handoff_edge_cases.sql` | `0267_fms_handoff_edge_cases.sql` |
| `0246_fms_authoring_guards.sql` | `0268_fms_authoring_guards.sql` |
| `0247_fms_task_context_batch.sql` | `0269_fms_task_context_batch.sql` |
| `0248_fms_causal_transition_preview.sql` | `0270_fms_causal_transition_preview.sql` |
| `0249_fms_hierarchy_authority.sql` | `0271_fms_hierarchy_authority.sql` |
| `0250_fms_context_files_and_hold_result.sql` | `0272_fms_context_files_and_hold_result.sql` |
| `0251_fms_follow_up_review_holds.sql` | `0273_fms_follow_up_review_holds.sql` |
| `0252_fms_initial_handoff_plan.sql` | `0274_fms_initial_handoff_plan.sql` |
| `0253_fms_confirmed_coverage_preview.sql` | `0275_fms_confirmed_coverage_preview.sql` |
| `0254_fms_previous_employee_preview.sql` | `0276_fms_previous_employee_preview.sql` |
| `0255_fms_initial_return_assignment.sql` | `0277_fms_initial_return_assignment.sql` |
| `0256_fms_nested_parallel_preview.sql` | `0278_fms_nested_parallel_preview.sql` |
| `0257_fms_context_reference.sql` | `0279_fms_context_reference.sql` |
| `0258_fms_assignment_route_remap_variable.sql` | `0280_fms_assignment_route_remap_variable.sql` |
| `0259_fms_consumed_handoff_intents.sql` | `0281_fms_consumed_handoff_intents.sql` |
| `0260_fms_previous_doer_fallback_preview.sql` | `0282_fms_previous_doer_fallback_preview.sql` |
| `0261_fms_historical_work_context.sql` | `0283_fms_historical_work_context.sql` |
| `0262_fms_candidate_route_sources.sql` | `0284_fms_candidate_route_sources.sql` |

Only initial-form routing is a prerequisite; the unrelated sidebar migration
is excluded. Recheck the production ledger and main SHA immediately before
applying or publishing, because other releases may allocate new numbers.

## Gates and operations

- Previous working-tree web: full490/490 plus latest simulation2/2; build and
  TypeScript passed. These do not prove the newly integrated release branch.
- Release branch: offline frozen install completed; web TypeScript passed; data181/181 passed; core946 assertions passed with one worker-startup error, followed by37/37 passing voice-deadline/catalog assertions. The package production build passes (2201 modules); full web is in progress. Structurally identical generated-type duplicates were removed without changing contracts.
- Dedicated local Docker database: API HTTP500; direct61321/61322 unreachable.
  Compatibility API probes also timed out. Clean replay and final SQL lint
  remain blocked until Docker is restored. Other stacks were not restarted.
- Earlier independent review ended on provider quota; partial important
  findings were fixed, but no clean final independent report was produced.
- Production preflight: initial root dry-run refused old out-of-order numbers. The release worktree is linked to the authorized project using its IPv4 pooler metadata. Its dry-run passes for exactly0260-0284, with no seeds, roles or unrelated migrations.
- Backup metadata: latest completed daily physical backup2026-10-16T20:24:16.702Z (2026-10-17 01:54 IST). Seven completed daily backups were listed; PITR is disabled. No restore was attempted.
- No production migration, Git push or web deployment has occurred.

Migration recovery is by forward correction. Do not reset production or edit
its ledger. A completed recent physical backup was confirmed by read-only CLI metadata before application. Keep old version1 workflows and immutable submissions
compatible; no customer-data migration is intended.

Main publication will deploy schema-dependent UI if automatic web hosting is
connected. Do not publish that UI ahead of its required verified contracts.

All25 release SQL bodies match the previously individually tested development migrations after line-ending normalization. Their release numbering is new; no previously applied production file is changed. The final clean local replay remains unavailable because Docker is down. The owner authorized this production-only release; this limitation and the incomplete final independent report remain disclosed rather than being represented as completed checks.

Release authorization: owner request to deploy necessary migrations and push main, followed by explicit production-only target confirmation. Named-path135-file staging excludes Android, CRM, sidebar and unrelated task-control work. Whitespace and strong credential-literal scans pass; standalone operational scripts pass node --check. Rollback of the web to e1a675f requires compatibility review for any newly created version2 workflows; database repair stays forward-only. Authenticated staff smoke remains a separate post-deployment check.

Pre-apply code verification: main-based web full scan528 assertions passed; its only uncollected suite was a cwd-dependent theme file, which then passed5/5 from the proper web directory. A redundant proper-directory full run remains in progress. Web TypeScript and package production build pass. Hosted baseline SQL lint reports zero errors. All public-key values were withheld while validating project identity against Auth settings. No production feature fixtures or seeds were run.
