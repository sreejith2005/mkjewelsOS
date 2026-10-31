# CRM scale performance release evidence

Owner scope: improve CRM entry, walk-in registration/save, Not Bought tabs,
Referrals, Client Database and related history across desktop web, phone web
and the Android app's hosted CRM surface. Deployment and main publication are
authorized in the owner conversation. This record separates local proof from
hosted verification; it is not a guarantee of subsecond performance at every
data volume or on a physical device.

## Change and compatibility

- Follow-up/referral loaders request at most 50 rows, with server filters,
  sorting and complete tab counts. Search is debounced; filter changes reset
  pagination. History is fetched only when opened, in 100-row pages.
- Client Database requests at most 200 listing records. Profile activity,
  visits and edits use 100-row pages; older saved evidence remains reachable.
- Walk-in queue reads at most 50 active/recent entries. A server-acknowledged
  registration appears immediately while the queue refreshes.
- Dashboard uses aggregate results and 25 recent visits. Independent identity
  and lookup reads run together.
- CRM migration `20261009000100_crm_scale_reads.sql` adds invoker read RPCs,
  supporting indexes and private trigger-maintained browse metadata. Metadata
  backfill reads existing sources without editing source records. Queue-derived
  metadata retains branch visibility separately from company-wide activity.
  Existing RPCs remain available for older clients. Generated CRM types are
  updated. Write validation, audit/outbox contracts and private Storage remain
  in place; no secrets, Edge Functions or native binaries change.
- Projection refreshes serialize per client and run inside source writes.
  Mutable contacts and inserts/deletes are covered; immutable histories remain
  immutable. Future-dated contacts become eligible as time passes.

## Local validation

An isolated CRM database was rebuilt from the current migration chain, including
the new migration. The relevant existing pgTAP suites passed (607 assertions),
and the new scale/authorization suite passed all 44 assertions. Coverage includes
anonymous/inactive/service denials, branch visibility, denied projection writes,
full counts beyond the REST cap, source refresh and history compatibility.
The legacy fixture test was rerun after supplying its migration include path;
the final scale test uses mutable contacts rather than attempting to update
immutable history. A rerun on the seeded 100,000-record database initially
failed five fixture-only assumptions (unfiltered company-wide totals and
non-unique search names). The fixture now scopes counts to its own synthetic
branch and uses a unique client name; all 44 assertions passed again with
the large fixture present. Company-wide reads and cross-branch checks remain
covered. This required no application or authorization change.

Commands used in the isolated release/local worktrees:

```powershell
supabase.cmd db reset --local --no-seed --workdir <isolated-local-stack>
# Relevant CRM pgTAP files executed with psql against the isolated Docker DB.
pnpm.cmd --filter @jewelos/crm-ui test
pnpm.cmd --filter web test
pnpm.cmd --filter @jewelos/crm-ui typecheck
pnpm.cmd --filter web typecheck
pnpm.cmd --filter web build
node packages/crm-ui/scripts/build-css.mjs --check
python scripts/benchmark-crm-scale.py --seed-only
python scripts/benchmark-crm-scale.py --read-only
git diff --check
```

CRM: the final suite passed 182 tests in 41 files, exit 0. Web: 409 tests in 85 files passed. Both typechecks,
the production web build and scoped CSS check passed. Existing bundle-size and
plugin-timing warnings remain. The final repeated suite and benchmark are
recorded below when their results are available.

## Scale and rendered workflow evidence

Synthetic fixtures contain 100,000 clients, visits/forms, Not Bought records
and history, referrals/calling/history, and queue entries per large source.
The reproducible script uses a fixed local Docker container and no hosted
credentials; fixture trigger suppression is only for local bulk seeding and
does not establish normal-write performance.

An authenticated SQL run under source RLS, before the final narrow client-ID
hydration improvement, measured:

| Read | Time | Returned rows / payload |
| --- | ---: | --- |
| Not Bought first page | 1,800 ms | 50 / about 42 KB |
| Not Bought deep page | 1,614 ms | 50 |
| Not Bought selective search | 1,440 ms | bounded |
| Referral first page | 2,846 ms | 50 / about 41 KB |
| Client first / deep page | 1,285 / 1,102 ms | 200 / about 92 KB |
| Client name / phone search | 1,087 / 876 ms | bounded |
| Dashboard | 476 ms | 25 / about 11 KB |
| Queue first / deep page | 109 / 108 ms | 50 / about 20 KB |

Earlier client browse plans exceeded 30 seconds; an earlier Not Bought read
took about 18.8 seconds. Narrow materialized relations, custom plans and
disabling per-read JIT compilation removed those costs. The subsecond target
is **not consistently met**: browser RPC readings ranged roughly 0.7–4.7 seconds
under shared-machine load. Large data transfers and whole-list rendering are
removed, but global counts/filters still perform database work proportional
to the matching dataset; future scale needs ongoing measured query tuning.

Playwright tested the actual CRM source with real isolated REST/database reads
at 1440 px, 390 px and 390 px embedded presentation: tab/filter/page counts,
50-row follow-ups/referrals, 200-row client pages, on-demand history, profile
and dashboard. All three had zero page errors and zero document overflow.
The JewelOS host/login exchange was synthetic; physical Android and hosted
authenticated action timing were not proven by this harness.

Real local registration/full-form saves passed in all three presentations:

| Presentation | Registration | Full save and queue update |
| --- | ---: | ---: |
| Desktop | 417 ms | 1,857 ms |
| Phone web | 399 ms | 910 ms |
| Embedded phone | 276 ms | 939 ms |

These initial write measurements used the small synthetic workflow fixture.
The full workflow was then repeated with the 100,000-record fixture present:

| Presentation | Registration | Full save and queue update | Save RPC |
| --- | ---: | ---: | ---: |
| Desktop | 4,703 ms | 4,369 ms | 2,705 ms |
| Phone web | 997 ms | 1,733 ms | 1,080 ms |
| Embedded phone | 1,758 ms | 3,984 ms | 2,275 ms |

All three completed persisted writes, showed the saved queue entry and had
zero page errors/overflow. Latency remains variable under the shared-machine
load. Server validation was preserved: the fixture needed an existing
lead-source option selected explicitly.

The final 100,000-record retry encountered severe local resource pressure
(16 GB Windows host, free memory below 300 MB, temporary database connection
rejection). Those timings must not be presented as clean production latency.
Two resource-constrained retries timed out. The final isolated read run
completed all 12 queries, exit 0, with correct totals and bounded payloads:
Not Bought first/deep/search 14.4/10.3/4.6 seconds; referrals 5.6 seconds;
clients first/deep/name/phone/source 2.3/1.7/9.0/1.0/2.1 seconds; dashboard
2.1 seconds; queue first/deep 0.45/0.44 seconds. This confirms correctness
and bounded transfer under pressure, not achievement of the latency target.

## Hosted release

Target CRM project: `fsydcsyqnddacjfoutfe`. JewelOS remains the separate project
`yimafxhuwgfhvzczqqdd`. The CRM preflight ledger matched through
`20261008000800`; only `20261009000100` was pending. JewelOS was synchronized
through `0205` and needed no migration from this change.

Application release commit: `e2caa0a9173190bef8155bf3fddd500fc740ca86`
(implementation `82abf6b`, fixture evidence `a441be1`). Reviewed named paths
passed staged whitespace and credential-pattern scans. The release branch
was pushed to `origin/main`; remote synchronization was verified as `0 0`.

Hosted CRM apply completed with exit 0, and the ledger lists
`20261009000100` both locally and remotely. A subsequent dry run reports
up to date. The CLI emitted an optional pg-delta catalog-cache timeout warning
after applying the migration; the apply and subsequent ledger/preflight passed.
No JewelOS migration, secret, Edge Function or host configuration changed.

Vercel production deployment `dpl_6cpyDCs73AMf9uQD2VdivyFpn9kC` is Ready and
aliased to `https://mkjewels-os.vercel.app`. Its build log identifies commit
`e2caa0a`, transformed 2,109 modules, and completed the production build.
Anonymous probes on all five new read RPCs returned HTTP 401 / SQLSTATE
42501. Public desktop (1440 px) and phone (390 px) CRM entry checks returned
HTTP 200, required login and had zero page errors, overflow or framework
error overlays. The smoke harness was corrected to select the actual form
submit control after its older accessible-name locator timed out; application
source was unchanged. Authenticated hosted workflows and physical-device
latency remain unproven; the complete workflow checks above are local.

No APK is required: no native/shared compiled mobile code changed; the existing
app loads the hosted CRM. Device performance must be measured separately.
Unrelated worktrees and native work were preserved. Documentation-only commits
after the application release record this evidence without changing behavior.

Recovery: previous web remains compatible with the additive read contracts.
Roll back a web deployment if needed; correct database behavior with a reviewed
forward migration. Never edit migration history or restore/delete source data
to undo derived metadata. Observe deployment errors and latency after release;
authenticated production/device performance remains an explicit follow-up.
