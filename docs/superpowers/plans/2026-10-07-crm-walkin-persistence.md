# CRM walk-in persistence repair

**Goal:** Preserve every submitted walk-in field and media association in the CRM Supabase project and expose saved details in the client profile.
**Spec:** `docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md`; owner incident report 2026-10-07.

## Constraints and evidence

- Work only in C:/crm; preserve its pre-existing dirty changes. Do not change the JewelOS CRM schema or original reference.
- MKC-104273 live read-only check: two NO timeline rows, two saved forms, one REPAIR_PICKUP answer, no document records. Do not invent a purchase or missing upload.
- Current RPC ignores selected salesperson, collapses visit outcomes to YES/NO, omits new-client billing phone, does not project engagement answers, and does not link proof question to document.
- Profile reads no visit_forms or documents. Local DB has later applied identity/reference migrations absent from this branch; preserve those function changes when patching the RPC.
- Hosted changes require the production playbook and owner gates. Never overwrite historical records without evidence and a reviewed recovery operation.

## Tasks

- [x] Add failing pgTAP coverage for purchase/repair/order outcomes, selected salesperson, all field snapshots, CRM statuses, billing phone, media linkage and rejection/atomicity.
- [x] Add forward migration preserving RPC authorization, audit, identity/reference rules; derive full status/categories, validate selected staff and uploaded objects, retain complete payload and media purpose, project CRM actions.
- [x] Add failing profile/media tests; load saved forms/documents and display all submitted details with private signed media access. Prevent submission while any optional upload is incomplete or failed.
- [x] Preserve all incoming legacy fields and exact engagement answers in canonical ingest; regression test.
- [x] Run CRM tests/typecheck/build and full local CRM pgTAP; document field map, historical recovery limits and live evidence. Check mobile CRM uses the same web component.
- [x] Review scoped diff and report separate local, live read-only and hosted deployment evidence.

## Final evidence and release scope

See `docs/CRM_WALKIN_FIELD_MAP.md` for the complete persistence map and exact evidence. Local UI: 114 passed; ingest: 23 passed; full database: 427 passed, with final backward-compatible video assertion increasing the new suite to 50. Typecheck/build/whitespace passed. Independent review completed. No native code is changed.

Hosted target approved by owner: walk-in_crm / fsydcsyqnddacjfoutfe. Corrective migration: 20261007001000_crm_walkin_persistence.sql. The migration preserves existing records and authorization; private helper/trigger changes only, no new public columns/RPC signature. Current source schema was backed up outside Git before apply. Existing applied schema source restored rather than rewriting the ledger.

Release must be based on current origin/main and named CRM changes only; the older CRM branch and its unrelated pending work must not replace newer released functionality. Retain authenticated desktop/phone/media verification and historical recovery as explicit outstanding items.
