# Username Authentication and Work Identity Design

## Goal

Move JewelOS sign-in from staff-entered email addresses to a unique username and password, while making every Auth login email a deterministic MK Jewels address and retaining personal email only as profile contact data.

## Confirmed rules

- Username is lowercase `firstnamelastname`, formed from ASCII letters and digits only; no spaces or punctuation.
- Current roster audit found no duplicate full names. A preflight must still fail before any write if a generated username is empty or duplicated.
- Login email defaults to `firstnamemkjewels@gmail.com`. If that first-name address collides, use `firstname.lastnamemkjewels@gmail.com`.
- Existing active identity passwords are retained. Passwords are never read, logged, exported, or changed by this migration.
- Personal email, if present, remains private profile contact data and is never an authentication identifier.
- An account is permanently deleted only after a preflight proves it is an unambiguous redundant personal identity with a retained work identity. The audited production snapshot has no such pair, so this release changes identities rather than deleting users.

## Architecture

`user_profiles.username` becomes the tenant-scoped, case-insensitive unique identifier. A public `username-password-login` Edge Function accepts only username and password, applies an IP-and-username rate limit stored as a non-reversible digest, resolves only active login-enabled profiles through its service client, and proxies the password grant to Supabase Auth. It returns the ordinary Supabase session tokens or one generic invalid-credentials response; the browser never receives the resolved email.

The function has platform JWT verification disabled because it is the login entry point, but it independently validates request shape, rate limits before lookup, never reports whether a username exists, and requires a configured server-side rate-limit secret. The browser sets the returned session with the normal Supabase client and all existing RLS/session checks remain unchanged.

## Data migration and operations

The forward-only SQL migration adds and validates `username`, creates a unique lower-case index, and adds the rate-limit table/RPC with no anonymous or browser grants. It never touches `auth.users`, because Auth administrative writes cannot share Postgres transactions.

The controlled operator script performs a dry-run by default. It derives usernames and canonical login emails from the existing one-to-one profile/Auth roster, fails on any ambiguity or collision, stages only changing Auth emails at private `.invalid` addresses, finalizes them, then invokes a service-only audited RPC to update profile login fields and usernames. It emits counts and opaque IDs only. Apply mode requires an explicit `--apply` argument. No personal account is deleted unless a separately supplied and reviewed redundancy list passes all dependency checks.

New-user creation derives the username and canonical login email server-side from first and last name. The Users screen removes personal email as a required login field and displays the generated username after account creation. Super Admin password reset remains the supported recovery route; the public email-reset control is removed from the login page.

## Compatibility, rollout, and recovery

The web client and function deploy before staff are directed to use username login. Existing sessions remain valid. The operator script is then run against the confirmed production target, and its postflight verifies every active profile has exactly one matching Auth identity, canonical username, and canonical work login email. A data mistake is corrected through a new forward migration or controlled Auth/profile reconciliation; it is not fixed by editing migration history. Existing passwords are preserved, so the username change does not require distributing credentials.

## Security and validation

- No service key, password, raw email, or raw profile row appears in source, Git, terminal output, or chat.
- Rate-limit rows retain only a salted SHA-256 key and expiry window; their RPC is service-role-only.
- Every profile identity change is written by a `SECURITY DEFINER` service-only RPC with an `audit_logs` entry in the same transaction.
- pgTAP covers username constraints, collision rejection, service-only identity updates, audit records, and no direct table grants.
- Focused TypeScript tests cover canonical username/email derivation and preflight collision behaviour. Function tests cover bad input, generic invalid credentials, and rate limiting.
