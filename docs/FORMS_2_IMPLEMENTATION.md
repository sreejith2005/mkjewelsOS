# Forms 2.0 implementation and release handoff

Date: 2026-10-24. Branch: `feat/forms-2-20261024`.

Git publication does not imply a hosted migration, function deployment, web deployment, production-data change, or APK release.

## Functionality

- **Import Form with AI**: inert, highlighted, numbered multi-file source editor; HTML/HTM, Apps Script, JavaScript and CSS upload/paste; optional instructions; local and server privacy checks; static source outline; strict AI proposal validation; truthful conversion counts and dependency findings; targeted corrections; explicit review and native draft editing/saving. No imported code or embedded URL executes. Backend/Google Sheets operations are reported, not migrated. Saving ends the import session to prevent duplicate new-family saves.
- **Live Preview**: shared builder state and existing renderer, wide-screen 65/35 split with keyboard/pointer resizing, independent scroll, desktop collapse, phone Build/Preview switching with mounted state, question selection, reset, real conditional/section navigation and test validation. Preview cannot submit, progress FMS or upload files.
- **Provenance**: immutable family-level library/FMS/import/duplicate source. FMS creation verifies the persisted workflow and stage atomically. Library origin/usage filters compose with existing search/lifecycle controls. Source details and workflow references are authorized; exact source version opens by ID. Creating/copying/restoring a form never silently rewires a published workflow. FMS offers explicit confirmation before linking a newly created form to its draft step.
- **History**: transactional immutable checkpoints across creation, draft/published save, revision, duplicate, publish and archive. No-op definitions deduplicate. Timeline summaries and exact field-level comparisons include stable option values, sections/routes, conditions, validation, permissions and naming. Historical previews use the selected snapshot. Restore first displays current-versus-selected changes, then creates a new draft; existing drafts and stale family histories are rejected. Copy starts a separate family. Legacy field defaults survive internal restoration.

Historical baselines record definitions available when the migration runs; they do not invent earlier edit dates or creation origins. Existing submission snapshots, answers, numbered versions, library visibility and pinned workflow IDs are retained.

## Database and authorization

Migration: `supabase/migrations/0346_forms_provenance_history.sql` (next local repository number; verify the target ledger again before any hosted application).

New private tables:

- `form_family_provenance`
- `form_definition_checkpoints`
- `forms_import_requests`

Each is tenant scoped, RLS enabled, with restrictive module policies and no direct browser/service-role grants. Provenance/checkpoints reject UPDATE/DELETE. Only caller-authorized RPCs expose sanitized information. Actor resolution uses `current_profile()` and centralized permissions/module checks.

New public RPCs:

- `save_form_workspace_with_audit`: optimistic timestamp check, verified creation context and change note; delegates to existing audited writers.
- `list_form_history`: author-only complete definition checkpoints.
- `get_form_provenance`: authorized form readers, with restricted FMS details omitted.
- `restore_form_checkpoint_with_audit`: exact checkpoint, expected latest family checkpoint, restore/copy selection; conflict-safe audited draft creation.
- `start_forms_import_request` / `finish_forms_import_request`: atomic caller quota and request outcome metadata.

Existing audited save/revise/duplicate/publish/archive functions retain their names and signatures and now checkpoint their final definitions. Renamed implementations are private. The migration does not change submission/progression RPCs, Storage buckets/policies or task/FMS assignment contracts. Both database type files include the new table/RPC shapes; regenerate against the approved staging schema before release to confirm parity.

## AI configuration

New Edge Function: `forms-import`; JWT verification stays enabled. It authenticates with `getUser`, calls the quota RPC as the caller, and uses no service-role key. Only quota/outcome metadata is persisted. Sources, instructions, model output and matched private values are not logged or stored by this endpoint.

Set `ANTHROPIC_API_KEY` through protected Edge Function secret management. Optional server settings are `FORMS_IMPORT_MODEL` and `FORMS_IMPORT_DISABLED=true`. Never put these in `VITE_*` or Git. The provider adapter follows the existing FMS Anthropic integration, uses a versioned JSON schema, 16,000 output-token cap and 100-second timeout, without automatic retries. Quota is 10 attempted analyses/corrections per person per Kolkata calendar day, including failed attempts.

Source bounds: 8 files, 120 KB/file, 220 KB combined, 5,000 lines/file; request stream bounded to 500 KB. Potential credentials, personal records and prefilled inputs are rejected before provider invocation. Privacy detection is conservative; administrators/authors must still supply empty form source without private data. Ambiguous conditions, dynamic controls, defaults and external integrations require review. AI cannot invent Dropdown Master identities; authors select existing masters in the native builder.

## Modified files

```text
apps/web/src/features/fms/FmsFlowBuilder.tsx
apps/web/src/features/fms/FmsFormAuthoring.tsx
apps/web/src/features/forms/FormBuilder.tsx
apps/web/src/features/forms/FormRenderer.tsx
apps/web/src/features/forms/api.ts
apps/web/src/features/forms/forms.test.tsx
apps/web/src/pages/FMSBuilderPage.tsx
apps/web/src/pages/FMSBuilderPage.test.tsx
apps/web/src/pages/FormsPage.tsx
docs/ASK_KIARA_APP_HELP_REVIEW.md
packages/api-client/src/database.types.ts
packages/core/src/assistant/appHelp.ts
packages/core/src/database.types.ts
packages/core/src/forms/index.ts
packages/core/src/index.ts
supabase/config.toml
```

## New files

```text
apps/web/src/features/forms/FormBuilder.live.test.tsx
apps/web/src/features/forms/FormHistory.tsx
apps/web/src/features/forms/FormHistory.test.tsx
apps/web/src/features/forms/FormImporter.tsx
apps/web/src/features/forms/FormImporter.test.tsx
apps/web/src/features/forms/FormOriginLabel.tsx
apps/web/src/features/forms/FormOriginLabel.test.tsx
apps/web/src/features/forms/FormRenderer.preview.test.tsx
apps/web/src/features/forms/FormWorkspace.tsx
apps/web/src/features/forms/FormWorkspace.test.tsx
apps/web/src/features/forms/formWorkspace.css
apps/web/src/features/forms/historyApi.ts
docs/FORMS_2_IMPLEMENTATION.md
docs/superpowers/plans/2026-10-24-forms-2.md
packages/core/src/forms/history.ts
packages/core/src/forms/history.test.ts
packages/core/src/forms/importContract.ts
packages/core/src/forms/importContract.test.ts
packages/core/src/forms/importSource.ts
supabase/functions/forms-import/deno.json
supabase/functions/forms-import/deno.lock
supabase/functions/forms-import/handler.ts
supabase/functions/forms-import/handler.test.ts
supabase/functions/forms-import/index.ts
supabase/functions/forms-import/model.ts
supabase/migrations/0346_forms_provenance_history.sql
supabase/tests/0346_forms_history.test.sql
```

Pre-existing `.superpowers/` content was left alone. Kiara help was updated; no new Kiara read tool is required for these authoring features, and Kiara remains read-only.

## Validation and evidence boundaries

The final command results are recorded below. Earlier iterations exposed and corrected restore serialization, lifecycle type comparison, inactive-fixture setup, importer repeat-save behavior and option-value display issues.

- Local pgTAP: **62/62 passed** through `python C:\Users\MIS\AppData\Local\Temp\forms2-db-check.py`. That temporary driver feeds migrations 0340–0344 and 0346 plus `supabase/tests/0346_forms_history.test.sql` into `docker exec -i supabase_db_jewelos-fms-workspace psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At`, within one rolled-back transaction. Final ledger remained **0319**. This proves the focused new contract against that local schema, not a complete clean migration replay.
- Full pending local replay stopped at the existing **0345** guard: `Review FMS stage form guard marker`. Migration 0345 was left unchanged and excluded only from the focused transaction above. Resolve/rehearse this predecessor against the approved target schema before release. Initial CLI database attempts also hit connection timeouts; Docker access subsequently recovered.
- Rendered component QA: real builder/renderer with synthetic definitions at **1536×1000** and **390×844**; live labels, retained compatible answers, conditional field, keyboard divider, phone overflow and section navigation passed; no page errors. Browser plugin was unavailable, so Playwright 1.63.0 was used. Temporary harness: `C:\Users\MIS\AppData\Local\Temp\forms2-qa.mjs`; screenshots: `forms2-desktop.png`, `forms2-phone-build.png`, `forms2-phone-preview.png` in the same directory. This does not prove authenticated hosted pages, persistence through a browser, physical Android behavior, or a live provider conversion.
- Independent read-only data and UI/core/Edge reviews found no remaining Important/Critical defect after scoped fixes.

Final TypeScript/Vitest/Deno/build results are appended after the running gates finish.

## Release instructions — approval required

1. Resolve the 0345 replay mismatch on a disposable current-schema staging environment. Run clean local migration rebuild, all relevant pgTAP suites, database lint and authenticated Forms/FMS regression checks. Do not change an already-applied migration.
2. Confirm the approved repository SHA, named paths and intended JewelOS staging project. Follow `PRODUCTION_SWITCH_PLAYBOOK.md`; review `supabase.cmd migration list --linked` and `supabase.cmd db push --linked --dry-run`. These are hosted commands and were not run here.
3. After approval, apply only the reviewed migration sequence, configure the protected provider secret, and deploy the named function with `supabase.cmd functions deploy forms-import --use-api`. Keep JWT verification enabled.
4. Deploy the approved web build after its database/function dependencies. Test an empty synthetic HTML/Apps Script source with the actual provider, nested conditions, permission denial, quota limits, draft save/edit/publish, exact FMS source access, historical preview/restore conflicts and unchanged active references.
5. Obtain production approval separately; repeat target/ledger/dry-run gates and record the deployed SHA. Web changes reach the Android WebView through the web deployment; this work changes no native files and needs no APK.

Administrators need `forms.manage` for authoring/import/history and the relevant FMS permission for source details. Ordinary form viewers retain existing discovery/fill permissions. Set the provider secret/model before enabling production imports; no browser-side credentials or new manual database records are needed.
