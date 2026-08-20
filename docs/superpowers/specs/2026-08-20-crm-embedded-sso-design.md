# JewelOS embedded CRM with single sign-on

## Status

Approved design. This document defines the integration boundary only; it does not authorize a database, hosting, authentication, or application change by itself.

## Goal

Replace JewelOS's current in-app CRM implementation with the completed CRM application while presenting CRM under the JewelOS `/crm` URL space. The browser must not redirect to a separate CRM site and must require only the user's existing JewelOS sign-in.

CRM remains independently developed and deployed. Its Supabase project, PostgreSQL schema, RLS policies, Storage data, Prisma migrations, server routes, and server-only integrations remain separate from JewelOS.

## Current architecture

| Concern | JewelOS | CRM |
| --- | --- | --- |
| Web runtime | React 18 / Vite SPA | React 19 / Next.js App Router |
| Application route model | Client-side history routing | Server-rendered routes, server actions, API routes |
| Database project | JewelOS Supabase | CRM Supabase |
| Authentication today | JewelOS Supabase Auth | CRM Supabase Auth |
| Repository | `jewelos` pnpm monorepo | `sreejith-crm` standalone Git repository, app in `web-app` |

The applications cannot safely be combined by importing CRM components into the Vite application: CRM needs the Next.js server runtime, its own SSR cookie handling, and React 19. An iframe is not an option because CRM rejects framing through security headers.

## Approved architecture

```text
JewelOS browser session and authoritative work-email roster
                         |
                         | OIDC SSO
                         v
CRM Next.js app served under /crm/* on the JewelOS public origin
                         |
                         v
CRM Supabase Auth session, CRM RLS, CRM database and Storage
```

### Hosting and routing

1. JewelOS retains ownership of the public domain and its normal Vite routes.
2. A hosting rewrite proxies `/crm` and `/crm/*` to the independently deployed CRM Next.js application. It must precede JewelOS's SPA fallback rewrite.
3. CRM is configured for the `/crm` base path so generated links, redirects, login paths, API paths, and Next static assets remain inside that prefix.
4. The browser URL remains on the JewelOS public origin. The CRM deployment remains independently releasable and directly testable.
5. CRM owns the complete content shell inside `/crm/*`. JewelOS owns the top-level navigation entry. This avoids an iframe and avoids attempting to nest a Next application inside a Vite component tree.

### Identity and session model

1. JewelOS's work-email roster is the authoritative access roster.
2. JewelOS Supabase Auth acts as the OpenID Connect identity provider for CRM.
3. CRM Supabase Auth is the relying party. On a CRM visit, the OIDC flow recognizes the existing JewelOS login and returns to CRM without asking for credentials again.
4. CRM keeps its own HttpOnly session cookie and uses that session for its existing SSR, API route, Storage, and RLS interactions. No JewelOS access token, service-role key, database password, or JWT signing secret is copied into CRM browser code.
5. CRM must allow only a pre-provisioned active access grant to complete CRM sign-in. A valid JewelOS account alone does not create CRM access.

### Identity linking and historical data

CRM historical rows reference existing CRM `users.id` values. Replacing those IDs would require risky broad foreign-key updates. The integration instead adds a CRM-side identity-link/access-grant layer.

Each active CRM user link contains, at minimum:

- the stable JewelOS user subject and normalized work email;
- the existing CRM staff-record ID used by historical CRM data;
- an active/inactive access state;
- the effective CRM role and branch scope;
- synchronization/audit metadata.

CRM authorization functions resolve the current CRM Auth identity through this layer to the existing CRM staff record. Existing authorship, client assignments, visit records, follow-ups, referrals, and audit history therefore stay intact.

Before cutover, a read-only preflight must compare active CRM staff accounts with the JewelOS work-email roster and report every missing account, duplicate email, inactive account, role mismatch, and branch mismatch. No account retirement or identity migration may occur until that report is reviewed and approved.

### Role and permission policy

| JewelOS role | CRM scope | CRM authority |
| --- | --- | --- |
| `super_admin`, `admin` | Global | Full CRM management, including delete, merge, global reassignment, roster/allocation administration, and access administration |
| `manager` | Own branch | Read/edit authorized branch clients, manage branch follow-ups and allocation; no global or destructive actions |
| `crm`, `staff` | Assigned/authorized branch | Read authorized records and create clients, queue entries, walk-ins, and permitted follow-up activity; no delete, merge, global reassignment, or access administration |
| `hr`, `doer`, `housekeeping` | None by default | No CRM route or CRM data access |

The CRM database remains the enforcement point. Navigation visibility and disabled controls are usability affordances only. Every sensitive operation, especially delete, merge, reassignment, roster/allocation changes, and access changes, must enforce the mapped role and scope in CRM RLS/RPC/server authorization and leave an audit trail.

### Roster and role synchronization

JewelOS is the source of truth for staff activation and hierarchy. CRM receives only the minimum derived access-grant data necessary to authorize its own database.

The implementation must use an authenticated, replay-protected server-to-server provisioning path for creation, role/branch changes, and deactivation. It must:

- authenticate the JewelOS sender with a server-only credential;
- validate event shape, timestamp, nonce, and stable user subject;
- be idempotent;
- write CRM audit records;
- fail closed for access-grant changes and never grant a role on an unverified request;
- never expose the provisioning credential to a browser bundle.

CRM cannot independently elevate a JewelOS user. A user deactivated in JewelOS must lose CRM access promptly, with an operational reconciliation job/report to identify any delivery failure.

## Required implementation phases

1. **Preflight and rollback design**: inventory current routes/auth policy, produce the roster collision report, verify OAuth/OIDC capabilities in both live projects, and define a non-destructive rollback.
2. **CRM identity foundation**: add additive CRM access-grant/link tables, protected resolver functions, audit trail, and RLS/RPC policy changes. Preserve existing CRM staff IDs and historical references.
3. **JewelOS provisioning**: add the least-privilege server-side grant-sync endpoint/event path and audit events. No client-side secret use.
4. **OIDC configuration and callback**: configure JewelOS as identity provider and CRM as relying party, create the CRM callback/login behavior, and block unprovisioned identities.
5. **Embedded routing**: make CRM base-path aware and add hosting rewrites for `/crm/*` before the Vite fallback. Replace the JewelOS CRM page only after the proxied CRM works.
6. **Old JewelOS CRM retirement**: remove the old CRM frontend surface after acceptance tests pass. Do not delete old JewelOS CRM database tables, migrations, or data in this scope; they may still be used by reports/history and require a separately approved retirement plan.
7. **Production cutover**: apply reviewed migrations, provision approved staff, deploy CRM and JewelOS in a reversible order, smoke-test roles, and record rollback evidence.

## Error handling and rollback

- OIDC callback failure: show a generic access error, retain no partial grant, log server-side correlation information without tokens.
- Valid identity without grant: deny CRM access with a support message; do not auto-provision.
- Provisioning failure: preserve the prior access grant, record an auditable failure, and surface it to administrators/reconciliation.
- CRM deployment or proxy failure: disable the CRM navigation target/section through the existing controlled maintenance mechanism and retain the ability to route back to the current CRM page until cutover is accepted.
- Rollback: restore the previous hosting rewrite and JewelOS CRM route without deleting CRM data or access grants. Database migrations are forward-only and must be designed to tolerate rollback of application traffic.

## Verification requirements

1. Unit tests for role mapping, identity-link resolution, active/inactive grant behavior, and destructive-action denial.
2. CRM database/RLS tests under each mapped role and branch, including direct API attempts that bypass the UI.
3. OIDC integration tests proving a JewelOS-authenticated approved user reaches CRM without a second credential prompt, while unprovisioned/deactivated users are denied.
4. Browser tests at `/crm`, deep CRM links, CRM API routes, static assets, upload/download flows, and back/forward navigation under the proxied origin.
5. Preflight and post-cutover roster reconciliation with reviewed counts.
6. Independent smoke tests for direct CRM deployment and normal JewelOS routes so a CRM release cannot break unrelated JewelOS functionality.

## Out of scope

- Combining the two Supabase databases.
- Sharing database credentials, service-role keys, or JWT signing secrets.
- Rebuilding CRM in Vite or copying CRM into the JewelOS workspace.
- Automatically retiring or modifying active CRM accounts on a roster collision.
- Deleting the legacy JewelOS CRM database objects.
