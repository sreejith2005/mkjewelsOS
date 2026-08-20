# CRM migration runbook

## Safety rule

Run preflight before every import or cutover. It reads JSON snapshots only and
does not connect to, write to, or alter either production database.

## Snapshot contract

Prepare three local, access-controlled JSON files. Do not commit them.

`legacy.json` contains CRM stable IDs only:

```json
{"branches":[{"externalId":"legacy-branch-id"}],"staff":[{"externalId":"legacy-staff-id"}]}
```

`jewelos.json` contains canonical JewelOS IDs:

```json
{"branches":[{"externalId":"jewelos-branch-uuid"}],"staff":[{"externalId":"jewelos-profile-uuid"}]}
```

`mappings.json` contains previously approved mappings:

```json
{"branchMappings":[{"externalId":"legacy-branch-id","targetId":"jewelos-branch-uuid"}],"staffMappings":[{"externalId":"legacy-staff-id","targetId":"jewelos-profile-uuid"}]}
```

## Run

```powershell
pnpm.cmd tsx scripts/crm-migration-preflight.ts legacy.json jewelos.json mappings.json
```

Proceed only when the four report arrays are empty. Resolve mappings using the
legacy stable ID and JewelOS UUID, record the approved mapping through the
audited RPC, then rerun preflight. Never use a display name as an access
mapping key.
