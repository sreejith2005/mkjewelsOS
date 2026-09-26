# CRM parity harness (Phase 3)

Compares the ORIGINAL CRM (`sreejith-crm/web-app`, run with `next dev`) with the JewelOS port
(`/crm` in `apps/web`), using the same synthetic fixture, route by route and state by state.
It follows the method in `docs/superpowers/specs/2026-09-25-crm-native-integration-design.md`
("Parity verification method"). Everything runs locally; nothing touches a hosted project.

```powershell
supabase.cmd start                   # the local JewelOS stack
pnpm.cmd crm:parity                  # full run: fresh original stack + fixture, all states
pnpm.cmd crm:parity -- --reuse       # reuse the running original stack and loaded fixture
pnpm.cmd crm:parity -- --reuse --roles=salesperson --viewports=desktop --states=dashboard,clients
pnpm.cmd crm:parity -- --reuse --workflow   # also run the end-to-end workflow check
pnpm.cmd crm:parity -- --ingest             # server routes only (see "Server-route parity")
```

What a run does:

1. `original-stack.mjs` starts a throwaway Supabase stack (project `jewelos-crm-parity-original`,
   ports 5632x) and applies the original Prisma migrations unmodified (the same
   `20260723000000`..`20260803010000` range the Phase 2 port replayed).
2. `fixture.sql` creates synthetic users, branches and roster there, then creates visits,
   queue entries, follow-ups, referrals, leads and a profile edit through the original RPCs,
   acting as those users. Names are "Parity …" and phones are 91000xxxxx. No customer data.
3. `load-jewelos.mjs` copies every original table row for row, with the same ids and triggers
   off, into the local JewelOS `crm` schema. It then creates the JewelOS side of the identity
   bridge for the synthetic users. This replaces the local `crm` rows; `supabase.cmd db reset`
   restores the seeded state.
4. The original app runs with `next dev` on :3300, pointed at the throwaway stack through
   process environment variables (no env file is read or written). JewelOS runs with `vite` on
   :5180 against the local JewelOS stack.
5. `states.mjs` lists every route and key state. Each is opened in both apps with the same app
   path and the same actions, for each CRM role (super admin, branch manager, salesperson), at
   1440×900 and 390×844.
6. `compare.mjs` compares:
   - the visible text (`innerText`, in order) and every form control (value, options, state).
     These must be identical.
   - a full-page screenshot, compared with pixelmatch (threshold 0.1). The difference must be
     at most 0.5% of the page.

   Masked in both images: the JewelOS "← JewelOS" menu link (the one approved addition) and the
   visit form's live "now" field. Next's dev-only indicator is hidden in the original.
7. With `--workflow`, both apps run the same flow as a salesperson: queue, walk-in (with a
   proof upload), follow-up, profile edit. The harness compares the resulting rows in both
   databases (ids and timestamps normalised) and checks the JewelOS audit rows.

Output goes to `CRM_PARITY_WORKDIR` (default `%TEMP%\jewelos-crm-parity`), outside Git:
`run-<timestamp>/{original,port,diff}/*.png|txt`, `report.json`, `report.md`. To stop the
throwaway stack: `supabase.cmd stop --workdir <workdir>\original --no-backup`.

## Server-route parity (`--ingest`, Phase 4)

`ingest.mjs` compares the original `POST /api/ingest/walkin` and `POST /api/leads/[leadId]/runo`
(`next dev` on :3300 against the throwaway original stack) with the Edge Functions
`crm-walkin-ingest` and `crm-runo-push` (`supabase functions serve`, local JewelOS stack). The same
synthetic requests go to both: valid new client, repeat client, identical replay, invalid and missing
key, oversized, invalid JSON, invalid fields, proof upload (422), invalid/blank/case-insensitive branch,
a failing write, a wrong method and the 30-per-minute limit; for Runo the creator, another
salesperson, a super admin, an unknown lead and Runo answering 200, 500, no id or dropping the
connection. After every case the harness compares the HTTP status, the response JSON (request ids and
generated ids masked) and every table's rows in both databases; for Runo also the outbound request
each app sends to a local stub (method, path, `Auth-Key`, body). The stub is reached by the original
through `runo-redirect.cjs` (a `--require` preload that only changes the host) and by the function
through the untracked `crm-functions.env` written to the workdir (`CRM_RUNO_API_URL`, synthetic keys).
The original app is started with explicit local `DATABASE_URL`/`DIRECT_URL`, overriding its git-ignored
`.env`. Because the original's `proxy.ts` redirects any request without a session to `/crm/login`, the
harness sends a signed-in cookie to the original so its route handler is what is compared; the redirect
is recorded in the report. Report: `<workdir>/ingest-<timestamp>/report.{json,md}`.
