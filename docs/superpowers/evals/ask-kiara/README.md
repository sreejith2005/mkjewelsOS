# Ask Kiara eval set

## Phase 9: one fixture, one runner (start here)

Since Phase 9 every case runs on ONE synthetic tenant ("Kiara integration") and is graded
automatically by `supabase/functions/ask-kiara/eval.local.ts`. Older sections below describe
how earlier phases ran their cases by hand; their user names are now mapped onto this tenant.

1. Start an ISOLATED local stack (own `project_id` and ports; never the shared `jewelos` stack),
   for example from a `git archive HEAD` copy. On a busy machine use
   `supabase start --ignore-health-check` (storage can be slow to report healthy).
2. Apply, in order, with `docker exec -i supabase_db_<project> psql -U postgres`:
   `supabase/functions/ask-kiara/integration.fixture.sql`, then `eval.fixture.sql`.
3. For CRM cases: an isolated CRM stack from `supabase-crm/`, then
   `crm.integration.fixture.sql` with `-v jos_admin=20750000-0000-4000-8000-000000000013
   -v jos_manager=20750000-0000-4000-8000-000000000009 -v jos_crm=20750000-0000-4000-8000-000000000010
   -v jos_sales=20750000-0000-4000-8000-000000000011 -v jos_bandra=20710000-0000-4000-8000-00000000000c`,
   and `functions serve crm-session-exchange --no-verify-jwt` with `JEWELOS_SUPABASE_URL`
   (`http://host.docker.internal:<jewelos api port>`), `JEWELOS_SUPABASE_ANON_KEY`,
   `CRM_BRIDGE_ALLOWED_ORIGINS`. Skip CRM cases with `KIARA_EVAL_SKIP_CRM=1`.
4. `functions serve ask-kiara --env-file <git-ignored file>` with `ANTHROPIC_API_KEY` and, for CRM,
   `CRM_SUPABASE_URL` / `CRM_SUPABASE_ANON_KEY` (host.docker.internal URL).
5. Run (from `supabase/functions/ask-kiara`):
   `KIARA_EVAL=1 SUPABASE_URL=... SUPABASE_ANON_KEY=... KIARA_DB_CONTAINER=supabase_db_<project>
   KIARA_EVAL_ENV_FILE=<git-ignored file> KIARA_EVAL_OUT=<folder outside the repo>
   deno run --allow-env --allow-net --allow-read --allow-write --allow-run eval.local.ts`
   (`KIARA_EVAL_ONLY=p9-,p5-` to run some cases; `KIARA_EVAL_CONCURRENCY`, default 3).

The runner creates the three synthetic SOP articles through the Knowledge base RPC, asks each
question through the real function as that user, and checks: expected and forbidden tools,
`min_kb_searches` and `expect_offer` (from the stored turn), then the reply against `must_refuse`
and `expect` with a Claude judge that sees that turn's tool results as ground truth. It prints a
pass/fail table per role and writes a JSONL file to `KIARA_EVAL_OUT`. A full run of ~100 cases
costs about $1 (answers) plus the judge. Infrastructure failures (HTTP 401/500/504 on an
overloaded machine) are not Kiara failures: re-run those cases.

Fixture users (password `kiara-local-test-only`, local only): 01 KIT Super Admin, 02 KIT Admin
(crm.view, no CRM account), 03 KIT Manager Andheri, 04 KIT HR Bina, 05 KIT Staff Asha,
06 KIT Staff Override (manager dashboard authority; CRM salesperson in the CRM fixture),
07 KIT Staff Borivali, 08 KIT Manager Borivali, 09 Meera Manager (Bandra), 10 Synth Priya CRM
(role CRM), 11 Sunil Sales (staff, CRM grant but no crm.view), 12 Dev Driver (Kiara Drivers),
13 KIT Owner (super admin).

`cases.json` is the seed eval set for Ask Kiara (plan: "Eval set grows from Phase 1"). Each phase
adds its own allowed, denied, language, and injection cases. Phase 9 runs the full set per role.

## Case fields

| Field | Meaning |
| --- | --- |
| `role`, `user` | The synthetic local seed account that asks. |
| `language` | `en`, `hi` (Devanagari), `hinglish`, or `hi_latn` (Hindi in English letters). |
| `expected_tools` | Tools that should be called, in any order. Empty means none is required. |
| `forbidden_tools` | Tools that must not be called. |
| `must_refuse` | The answer must say the user has no access (or that Kiara cannot answer), with no hidden data and nothing invented. |
| `setup` | Synthetic data to create first (never real data). |
| `expect` | What a reviewer checks in the final text. |

Tool calls for a question are recorded in the `assistant_question_answered` audit row
(`new_value -> 'tools_used'`), so a run can be graded without reading transcripts.

## Phase 2 fixture

Phase 2 cases (`p2-*`) sign in as the users of `supabase/functions/ask-kiara/integration.fixture.sql`
(tenant "Kiara integration": Andheri and Borivali branches; super admin, admin, Andheri manager, HR,
two Andheri staff of whom one has manager dashboard authority, Borivali staff and manager). The
integration test applies it; to apply it by hand on a local stack:
`docker exec -i supabase_db_<project> psql -U postgres < supabase/functions/ask-kiara/integration.fixture.sql`.

## Running against a local stack

Never point this at a hosted project. Use an isolated local stack (see the plan's global
constraints), not the shared `jewelos` stack.

1. Apply migrations and seed: `supabase.cmd db reset`, then the local seed (`pnpm.cmd seed:local`,
   or its steps against your own stack's database container). Add a synthetic manager
   (`kiara-manager@mkjewels.local`) in the seed tenant and branch.
2. Switch the section on for the seed tenant (Developer Mode, or it is already on for tenants created
   after migration 0213).
3. Put `ANTHROPIC_API_KEY` in the git-ignored `supabase/functions/.env.local` (never print it), then:
   `supabase.cmd functions serve ask-kiara --env-file supabase/functions/.env.local`.
4. For each case, sign in as `user` (`POST /auth/v1/token?grant_type=password`), then call
   `POST /functions/v1/ask-kiara/chat` with `Accept: application/json` and
   `{ "conversation_id": null, "request_id": "<new uuid>", "message": "<question>", "client": "web" }`.
5. Grade: tools from the audit row against `expected_tools` / `forbidden_tools`; `display_text`
   against `must_refuse` and `expect`; cost from `kiara_messages.usage` (token counts only).

Each question costs real money (Sonnet 5.5, about 2 cents). The daily limit (10, Super Admin
unlimited) applies to eval accounts too; use a per-user exception or Super Admin for long runs.

## Phase 3 knowledge base

Phase 3 cases (`p3-*`) use only synthetic articles, typed in the Knowledge base screen (Ask Kiara >
Knowledge base, Super Admin) as their `setup` describes. A citation is valid only when its marker
names a chunk returned by `search_knowledge_base` in the same turn; the server drops any other
marker, so grade citations from `kiara_messages.citations`, not from the model's raw text.

The owner's real SOPs are never added to this file. Questions written from them, and their results,
live in the git-ignored `docs/superpowers/evals/ask-kiara/private/` folder on the machine that ran
them.

## Phase 3 follow-ups and Phase 4 (2026-10-10)

Department targeting and step-in cases run in the local seed tenant ("MK JEWELS") with a local-only
owner-test fixture (Sales, Drivers, Accounts, Karigar Design staff; a manager above Sales and
Drivers staff; a manager in the same branch outside that chain). Grade escalation offers from
`kiara_messages.escalation_offer` (null when none) and from `tools_used` in the audit row: an offer
must follow two knowledge searches for `no_kb_match`, and must never appear for an access denial,
a request to do something, or an answered question. The worker refuses such offers whatever the
model asks (`decideEscalationOffer`), so a refused attempt shows as `kiara_offer_refused` in the
function log, not as a stored offer.

## Phase 5 CRM fixture
Phase 5 cases (`p5-*`) need a local CRM-project stack built from `supabase-crm/` with
`crm-session-exchange` pointed at the local JewelOS stack, and the synthetic
`supabase/functions/ask-kiara/crm.integration.fixture.sql` applied (psql variables `jos_admin`,
`jos_manager`, `jos_crm`, `jos_sales`, `jos_bandra` = the local seed profile and branch ids). The
function needs `CRM_SUPABASE_URL` and `CRM_SUPABASE_ANON_KEY` (local values). All CRM names and
numbers are invented. `p4f-*` checks that a person's escalation answer is used in a later turn.
