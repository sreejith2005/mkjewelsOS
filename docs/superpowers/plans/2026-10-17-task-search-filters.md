# Task search and compact filters

Approved in chat: one search field and Filter button; global authorized search, older/completed work, source/status/priority/dates/subsection/requirements, sort, clear and result count. Implement inline on current main; preserve original checkout.

1. Add failing core/API/UI and database tests for global scope, pagination, filters, literal search, stale responses, allowed and denied access.
2. Extend the existing server page implementation with an additive filtered RPC and a compatible wrapper for existing board calls. Share membership/kind rules; no client authorization or loading whole feeds. Add generated types.
3. Add a small search row and collapsed filter dialog. Search results carry subsection labels. Retain old board behavior when cleared, existing completion, private uploads, identifiers and notifications.
4. Verify focused regressions, relevant full suites, SQL denial paths, type/build and rendered phone/desktop flows. Update Ask Kiara help. Review, preflight hosted ledger and publish only authorized scoped changes under existing release instruction.
