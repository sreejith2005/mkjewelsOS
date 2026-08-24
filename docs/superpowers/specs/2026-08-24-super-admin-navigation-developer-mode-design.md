# Super Admin Navigation Developer Mode Design

## Goal

Allow only active Super Admins to turn Developer Mode on from the web app top
navigation and to take an individual section offline. Other users, including
Admins, see the existing maintenance notice for an offline section.

## Design

The existing tenant-scoped `tenant_section_controls` record remains the source
of truth. The existing optimistic, idempotent, audited save RPC remains the
only mutation path, but a forward migration restricts it to `super_admin`.
The shell reads the existing availability RPC and renders a compact Developer
Mode switch in the top navigation only for Super Admins. With the mode enabled,
each visible navigation item gets a labelled maintenance switch. Changes save
through the existing RPC and refresh the shared shell state.

The route guard continues to cover direct URLs. Its bypass is reduced from
Super Admin plus Admin to Super Admin only. The existing maintenance notice is
used unchanged. Failed optional availability reads continue to fail open so a
deployment mismatch cannot lock employees out.

## Security and compatibility

No new table, client secret, or service-role access is introduced. The
forward-only migration replaces the RPC with identical validation,
optimistic-version, idempotency, and audit behaviour except for its Super
Admin-only authorization condition. Existing control data remains valid.

## Verification

Core tests prove the Super Admin-only bypass rule. pgTAP proves an Admin is
denied and a Super Admin can make the audited save. Focused web tests,
typecheck, build, migration checks, and release preflight establish the
respective local and hosted evidence.
