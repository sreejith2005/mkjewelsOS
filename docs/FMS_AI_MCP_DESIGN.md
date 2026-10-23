# JewelOS FMS MCP server: design only

Status (2026-10-23): design proposal. **Not implemented and not authorized.**
The in-app FMS assistant (`docs/FMS_AI_ASSISTANT.md`) does not depend on it.

## Why a JewelOS-specific server

Generic automation MCP endpoints (n8n, Make) operate their own products; they
cannot read or change the JewelOS Postgres FMS. External Claude Desktop, Claude
Code or Codex sessions would need a JewelOS server that exposes the same
contracts the web app uses, with the same authorization.

## Scope

Read-only by default; edit scope separately granted; never publish, delete,
complete work, run SQL or execute code.

| Tool | Scope | Backed by |
| --- | --- | --- |
| `fms_list_flows` | read | RLS read of `fms_flows` (bounded, paginated) |
| `fms_get_definition` | read | builder rows → `flowToDefinition` |
| `fms_get_catalog` | read | the `fms-ai` catalog loader (published Forms, active people, no contact data) |
| `fms_validate_draft` | read | `validateFmsDefinition` + `diagnoseFmsDefinition` |
| `fms_simulate_draft` | read | `simulateFmsDefinition` (creates no work) |
| `fms_diagnose_instance` | read, run-diagnosis switch | `get_fms_run_diagnostic_snapshot` + `analyseFmsRun` |
| `fms_create_draft` | edit | `save_fms_flow_draft_with_audit` with a compiled definition |
| `fms_apply_draft_patch` | edit | `applyFmsAiOperations` on the stored draft + base fingerprint check + `save_fms_flow_draft_with_audit` |

Excluded on purpose: publish, revise-and-publish, delete, archive, start/complete
runs, reassign, notifications, Forms publish, any SQL or service-role access.

## Security design

- **Identity:** OAuth 2.1 with PKCE against Supabase Auth (or scoped, rotating
  personal access tokens stored hashed with expiry and revocation). The server
  calls PostgREST/RPCs with the user's JWT; never the service role.
- **Scopes:** `fms:read`, `fms:draft:write`; plus the tenant's assistant
  switches and the user's `fms.manage`. Every call re-resolves permissions.
- **Mutations:** only through the audited draft RPC, with a required base
  fingerprint (optimistic concurrency), an idempotency key, and the same
  compiler and validators as the web app. Human confirmation in the MCP client
  for every edit tool.
- **Transport and abuse:** HTTPS only (streamable HTTP), allow-listed client ids,
  per-token and per-tenant rate limits, request size limits, replay protection
  (nonce + timestamp), audit log rows for every call, kill switch.
- **Data:** same redaction as the in-app assistant; no exports.
- **Rollout:** a new switch `mcp_enabled` (off by default), owner review, a
  security review, pgTAP + integration tests for every denied path, then a
  pilot with one administrator.

## Effort and prerequisites

Requires: token issuance/revocation tables and UI, an MCP server deployment
(Edge Function or separate service), and threat-model review. Estimate: a
separate phase after the in-app assistant has run in production.
