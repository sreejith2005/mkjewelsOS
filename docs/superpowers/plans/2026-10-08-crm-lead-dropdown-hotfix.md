# Lead dropdown and save hotfix

The hosted master choices are unique, while `get_crm_lead_option_routes` currently
returns both the mapped master label and the identical legacy label. The older
lead form renders these routes as choices and writes directly to `leads`; that
write is now intentionally denied. The current public lead chunk uses
`save_crm_lead`, and a local synthetic save using the hosted form configuration
passes. An older open form explains both reported symptoms; this remains an
inference without the affected browser session.

1. Add regression coverage for unchanged and case-equivalent route labels,
   stable renamed conditional routes, unique rendered options, and useful
   save-error messages without displaying database internals.
2. Add a forward CRM migration to return one route per field/normalized label,
   preferring the master route while retaining distinct historical aliases.
   Preserve all grants, required-field validation, audit and identity contracts.
3. Deduplicate rendered lead choices and map permission, invalid choice/date,
   and unavailable-master errors to actionable messages. Keep form answers.
4. Run focused UI/SQL tests, CRM regression suites, typecheck and web build.
   Apply the reviewed migration after linked-ledger/dry-run verification,
   publish named paths to main, and verify the public deployment and routes.

No customer records, existing lead answers, Storage or native binaries change.
An already-open older form needs a reload to use the audited save contract.

## Verification and hosted migration

- Regressions failed before the fix: duplicate rendered labels and repeated
  routes in both the routing RPC and opening registration snapshot.
- `pnpm.cmd --filter @jewelos/crm-ui test`: 37 files, 174 tests passed.
- `pnpm.cmd --filter @jewelos/crm-ui typecheck`: passed.
- `pnpm.cmd --filter web build`: passed.
- All 17 current CRM pgTAP files in the isolated schema candidate: 607 checks
  passed, no failures. Existing anonymous/inactive/direct-write denials remain.
- Synthetic full-form saves using only exported hosted configuration (no
  customer records) passed for LEAD, CALLING and EXHIBITION in the local DB.
- CRM project `fsydcsyqnddacjfoutfe` linked ledger and dry-run selected only
  migration `20261008000800`; it was applied successfully. Read-only hosted
  verification found 16 duplicate route groups before and zero afterward.
  Status is LEAD/CALLING/EXHIBITION once each, Google reviews YES/NO once each.
  Existing lead count and answer hash were unchanged. Anonymous save execute
  and authenticated direct lead INSERT remain denied.
- Public RPC signatures, generated types, audit events, RLS and Storage remain
  unchanged. The native CRM consumes the same hosted web surface.

Authenticated browser/device reproduction of the affected session remains
unavailable; the stale-form explanation is an inference. Deployment of this
commit and verification of its public assets are separate release checks.
