# Customer data standards: audit and proposed architecture

Status: owner decisions taken 2026-11-28 (section 8); first slice built in migration 0455.
Brief: the owner's "Universal Customer Data Standardization, Reference Data
Management & Data Governance" document (chat, 2026-11-28).

## 1. What already exists and is reused

| Piece | Where | What it already gives us |
|---|---|---|
| Raw rows | `customer.ingest_rows` (+ the `sheet_*` projections) | Every sheet row as read, with source, row key and history. Stays the evidence. |
| Observations | `customer.client_field_values` | One row per answer per source per time (`field_key`, `value`, `source`, `observed_at`, `source_row`, `origin`). This is the "historical observation" layer the brief asks for. |
| Source ranking | `customer.sources.source_rank` | Which sheet wins for a field. Unchanged by this work. |
| Winner and projection | `customer.recompute_profile_field` → typed columns on `customer.clients` (18 `profile_fields`: city, state, country, pincode, community, gender, …) and `customer.client_answers` (every other key, migration 0454) | "Currently selected profile value". The list, profile, filters and the table read these. |
| Stale rule | `recompute_profile_field` | A lower-ranked but much newer, different answer is flagged `needs_review`, never silently applied. |
| Field catalogue | `customer.field_catalog` + `discover_answer_fields()` (0454) | Field key, label, card, type, how it is read. Drives the table, filters and value picker. |
| Value cleaning, one-off | `customer.clean_name`, `parse_profile_date`, `normalize_phone`, `name_key`, `branch_aliases`, `staff_aliases`, `pincodes` (199 rows) | Scattered per-field helpers. The new work replaces new ones of these with one mechanism; it keeps the existing ones. |
| Record origin vs how they came | `first_source` (technical sheet), `first_origin` (what the sheet wrote as the source, `customer.origins`, 0434), `lead_source` answer (how they came) | Already three meanings; the UI shows them in one "First source" filter. |
| Data problems | `clients.data_problems`, `data_review` (0451, 0452) | Separate from standardization and stays separate. |
| Review queues | `identity_review` (0438, 0453) | Customer identity only. Not reused for value mapping (different object, different permission). |
| Dropdown Master | `dropdown_masters` + `dropdown_master_categories` | Option lists for forms (`crm_source`, `client_type`, `communication_preference`, `gender`, …). |
| Permissions | `has_permission`, `permission_catalog`, franchise view | All new RPCs use these. |

## 2. Gaps

1. **No interpretation layer.** An observation has only its raw text; the winner
   is shown as written ("MUMBAI", "Mumbai", "mumbai" are three filter options).
2. **No reference values with stable identity.** Filters compare text, so a
   rename would break saved selections.
3. **No rulebook.** Nothing remembers that "Bangalore" means Bengaluru, so every
   import brings the old spelling back.
4. **Winner selection ignores quality.** A top-ranked "None" or "P" beats a
   lower-ranked real city.
5. **One field cannot feed another.** "Haryana" in CITY is lost as state data.
6. **No field policy.** The catalogue does not know which fields are
   categorical, free text, multi-valued, hierarchical or sensitive.
7. **Sensitive fields are open.** Community is a normal column for everyone with `crm.view`.
8. **No profiling.** Nobody can see distinct values, coverage and affected customers per field.

## 3. Recommended architecture (hybrid, extends what exists)

```
ingest_rows ─▶ client_field_values (raw observation, unchanged)
                     │  standardize(field, value, context)   ← one function, all importers
                     ▼
              value_interpretations (per observation: output field, reference value or status, rule + version)
                     │  winner per field (existing source ranking, skips missing/invalid)
                     ▼
     clients typed columns + client_answers   ← canonical label shown; reference id kept
                     │
     list · table · profile · filters · exports · reports (one read model)
```

### 3.1 Field policy: extend `customer.field_catalog`

New columns (no new catalogue): `meaning` (one line), `policy`
(`none` | `normalize` | `reference` | `multi_reference` | `derived`), `ref_domain`,
`normalizer` (`text_fingerprint` | `keep` | `title_case`), `sensitive` (bool),
`unresolved_display` (`raw` | `hidden`), `governed_by` (permission key).
`discover_answer_fields()` keeps adding new keys with `policy = 'none'`:
nothing becomes a dropdown on its own.

### 3.2 Reference values: one generic table, special tables only where needed

`customer.ref_values` (`id`, `domain`, `code` (stable), `label`, `parent_id`,
`kind`, `active`, `superseded_by`, `external_code`, `notes`, `tenant_id`,
optional `franchise_group_id`) with `customer.ref_aliases` (`value_id`,
`alias_key`, `kind`: spelling, historical name, abbreviation).

Geography is one domain, `place`, with `kind` country / state / district /
city / locality and parent links. This avoids a fixed "every country has
states" hierarchy. Pincodes stay their own table, extended to point at one or
more places (`customer.pincode_places`, many-to-many), because one pincode can
cover several localities. The source is the India Post pincode directory and
LGD state/district codes as `external_code`, loaded by a script after a
licence and coverage check.

Why hybrid and not separate tables per field: ordinary categorical fields (the
"Preferred jewellery style" test) need no schema change. Why not pure EAV for
everything: typed client columns and `client_answers` stay the fast read path.

### 3.3 Rules: `customer.std_rules`

One row per approved interpretation: `field_key` (scope), optional context
(`source`, sheet header), `input_key` (the normalized raw value), `outputs`
(one or more `{field_key, value_id | status}`), `status` draft / approved /
inactive, `version`, `priority`, `approved_by`, `approved_at`, `reason`.
Lookup is an indexed equality on (`field_key`, `input_key`, context). There is
no substring or fuzzy matching at import time, and an output may not point at a
rule (no cycles).

Matching order: (1) a person's verified correction for that customer;
(2) an approved rule with context; (3) an approved rule without context;
(4) an exact match on a reference label or alias; (5) unresolved. Fuzzy
(`pg_trgm`) and optional AI produce suggestions for the review queue only.

Statuses on an interpretation: `standardized`, `verified`, `missing` (None, NA,
"Not mentioned"), `invalid` ("P"), `other`, `wrong_field` (moved to another
field), `ambiguous`, `unmapped`. People see "Not recorded" or the raw value with
a "not standardized" mark; admins see the exact status.

### 3.4 Interpretations: `customer.value_interpretations`

One row per (observation, output field): `field_value_id`, `output_field`,
`value_id` or null, `status`, `rule_id`, `rule_version`, `interpreted_at`. A
cross-field output ("Haryana" in CITY → `state` HARYANA) is an interpretation
of the same observation for another field. It competes in that field's winner
like any observation of its source, and never beats a stronger direct answer.
A conflict is kept and shown in review.

### 3.5 Winner and read model

`recompute_profile_field` and `refresh_client_answers` read interpretations.
The winner is the highest-ranked observation whose status is not missing,
invalid or wrong_field (existing rank and date rules, unchanged). The typed
column holds the canonical label; a new `clients.std_ref jsonb`
(`{field: code}`) and `client_answers` hold codes so filters use stable codes.
The stale rule compares standardized values, so "MUMBAI" vs "Mumbai" is no
longer a "different answer".

### 3.6 Table and filters

`field_catalog.expr` for a reference field reads the canonical label, plus a
`code_expr` for filters. The value picker returns reference values (one Mumbai,
with the count of distinct customers in the same scope as today) plus "Not
standardized (N)". `is_any_of` stores codes (`place:mumbai`), so renaming a
label keeps saved filters working. `is_none_of` and `is_empty` treat missing and
unresolved as empty (written down per operator in tests). Search also matches
aliases. Multi-value fields count each customer once (`exists`, never a join
that repeats rows).

### 3.7 Sources: separate meanings, separate filters

Keep `first_source` = "Imported from (sheet)", `first_origin` = "Record origin
(as the sheet wrote it)". Add a standardized `acquisition_channel` (how they
found us: Instagram, Walk-in, Exhibition, Referral, Advertisement, … or
Unknown), `campaign` and `referrer_name`, all fed by rules from `lead_source`,
`FIRST INTERACTION SOURCE` and similar columns. They are never derived from
the sheet name. Zoho or Billing software stays an origin only.

### 3.8 Sensitive fields

`community` gets `sensitive = true` and a new permission
`customers.view_sensitive` (Super Admin by default). Without it the column,
filter, value counts and exports leave it out on the server. Rules may tidy
spelling of what was recorded; nothing infers community from names or places,
and a city written in COMMUNITY becomes `wrong_field` with a suggestion only.

### 3.9 Governance workspace (Customers → "Data standards", new permission `customers.manage_standards`)

* **Overview:** per field coverage, missing, unresolved, distinct raw values, customers affected.
* **Review queue:** distinct (field, normalized value) with observation and
  customer counts, sources, suggestion and reason. Actions: map to existing,
  create value, missing, invalid, ambiguous, other field, leave. Sorted by
  customers affected, so one decision fixes thousands of rows.
* **Reference values:** add, rename, aliases, deactivate, merge (supersede).
  Value merging is not customer merging.
* **Preview before approve:** customers and observations affected, before and after counts, conflicts.
* **History:** every rule and value change, with who, when, why and the batch that applied it.

### 3.10 Processing

* **New data:** `set_field_value` calls `standardize()` (an indexed lookup) and
  writes the interpretation in the same transaction. Every importer gets it,
  with no per-importer logic. A re-read of the same raw text finds the same rule.
* **Rule change:** a job row lists (field, input_key). A cron worker re-interprets
  only those observations and refreshes only their customers, in batches of
  about 2,000, resumable and idempotent. There are no full rescans.
* **First run:** profile all fields, propose rules, owner approves the
  high-impact ones, and the batches apply them. Reads switch over per field once
  counts reconcile (same customer totals, filter totals explained).

### 3.11 Dropdown Master

A reference domain can be published to a Dropdown Master category (for
example `communication_preference`). The reference domain is the source of
truth and the dropdown options are kept in step by the same migration
functions. Dropdown categories that are not customer data (task priority,
week off) are untouched.

### 3.12 Forms

The forms that write customer data use the published dropdown or a searchable
reference picker, with "Other, please specify". Other text is stored raw and
enters the review queue. It never becomes an option by itself.

## 4. Alternatives considered

| Option | For | Against |
|---|---|---|
| Clean the typed columns in place | Simple | Loses raw text, breaks re-imports (the sheet brings the old text back), not reversible. Rejected. |
| Frontend grouping of filter values | Fast to ship | Not real data; counts and profiles disagree. Rejected by the brief. |
| One table per domain (cities, communities, …) | Strong typing | A new field needs a migration and code. Used only for pincodes. |
| Generic reference + rules + interpretations (chosen) | One mechanism for all fields; new field = metadata + values | Needs careful indexing; the read model stays the fast path. |
| AI-first mapping | Little setup | Not deterministic, privacy risk. Kept as an optional suggestion source only. |

## 5. Vertical slice (first implementation)

Four fields, each with a different kind of handling:

1. **city** (hierarchical place, cross-field to state and country, localities like Borivali);
2. **lead_source → acquisition_channel** (source semantics, one input to several outputs);
3. **community** (sensitive; permission gate and spelling only);
4. **beverage** (an ordinary categorical field, the "new field" test with no field-specific code).

The slice includes catalogue policy, reference values, rules, interpretations,
the winner change, table and filter codes, the review queue, preview, history,
targeted reprocessing and the permission checks.

## 6. Tests and performance

* pgTAP for each acceptance scenario 1–20 in the brief, plus: re-import of an
  approved alias keeps the canonical value; rename keeps a saved `is_any_of`
  working; staff without the sensitive permission see no community through
  table, values, search or counts; a reprocess batch run twice changes nothing;
  customer, interaction and purchase totals are identical before and after a backfill.
* `explain analyze` before and after for the list, table (default and a
  three-condition nested filter), value picker and search on a local copy sized
  like production (about 1,10,000 customers, 1.5 million observations). The
  target is no more than 20% slower and under 500 ms server time.

## 7. Decisions for the owner

1. Canonical names: "Bengaluru" or "Bangalore" (and similar renamed cities) as the label?
2. Localities: should the City column show the city (Mumbai) with the locality
   (Borivali) as its own column, or show the locality?
3. Community: who may see it, and should it stay a filter at all?
4. Sources: replace the single "First source" filter with "Imported from" and
   "How they found us" (acquisition channel)?
5. Who may approve mappings: Super Admin only, or a data team role?
6. Winner change: skip "None", "P" and similar so a lower-ranked real value
   wins (recommended). This changes which value shows for some customers.

## 8. Owner decisions (2026-11-28) and what 0455 built

* **Labels:** the most used spelling wins (`customer.ref_relabel_by_usage`); every other name stays an alias and every raw value stays on the customer page.
* **Place:** country, state, district, city and locality are separate fields. A known locality gives City (for example Borivali gives City Mumbai and Locality Borivali). A name found in several places is read from the customer's pincode or state when that settles it; otherwise it is "Unclear" and goes to review. Unknown localities stay as written until someone creates them under a city.
* **Community:** kept as a field and filter, behind `customers.view_sensitive`. For now every role has it; hiding comes later. The server enforces it in the table, values, list filters, profile, customer page and form lookup. Only spelling is tidied; a place written in COMMUNITY is flagged and never moved.
* **Sources:** "First source" keeps its meaning. New fields: "Imported from" (`first_source` sheet), "Record origin (as written)" (`first_origin`) and "How they found us" (`acquisition_source`, standardized from "How they came" and "First contact through"). An import origin is never used as the acquisition source.
* **Permissions:** nine keys (view sensitive, view data quality, suggest, approve, manage reference values, approve high impact, manage field policies, reprocess, roll back), all Super Admin except view sensitive. A suggestion from someone who cannot approve is saved as a draft.
* **Validity before rank:** missing, invalid, ambiguous and wrong-field readings never win. A verified correction or a requested removal (`customer.value_corrections`) beats every sheet.
* **New lead:** a tag for a lead (not a client) contacted exactly once. The first Stage is now labelled "Not spoken to yet".
* **The new-field test:** Sugar was turned on through `customer_std_set_policy`, with no field-specific code (pgTAP 0455).
* **Measured locally (Postgres 16, synthetic data):** writing a standardized answer costs about 1.7 ms instead of 1.0 ms. A table count with a code filter over 1,00,000 customers takes about 40 ms (GIN containment), the same as the old text filter.
* **First run:** jobs re-read every answer of the slice in the background (cron `customer-standards-jobs`, 3,000 answers a minute). Until a customer is reached, they show as before.
