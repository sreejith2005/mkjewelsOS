# Customer master database: purpose and design

Owner decisions 2026-11-12 to 2026-11-17. Code: migrations 0405 onwards
(`customer` schema), Edge Function `customer-sheets-sync`.

## Purpose

One customer database that every JewelOS section uses: CRM, Forms, FMS,
Users, Tasks, Dashboard and Reports. A customer's whole history - every
enquiry, call, visit, purchase, order, repair, follow-up and FMS stage - reads
as one timeline, and the staff who work with them, the forms they fill and the
tasks they get all point at the same customer. The app is only useful as an
all-in-one tool once this is true. Every change to the customer schema serves
this goal.

## Layers

1. **Sheet tables** (`customer.sheet_*`): each Google Sheet tab in its own
   table, every column exactly as the sheet has it. Nothing is cleaned here.
   `customer.ingest_rows` keeps every row's raw copy and its import status.
2. **Master**: `clients` (MKC-), `households` (MKF-), referral codes (MKREF-),
   `client_phones`, `client_names`, `client_identifiers`, and
   `client_field_values` (every answer with its source and date; the profile
   column holds the winner).
3. **Timeline**: `interactions` (MKI-), one per contact with the customer, with
   the outcome as written, a common reading (positive / negative / not reached
   / neutral), who did it, branch, FMS stage and links.
4. **Cases**: `enquiries` (MKE-) with `enquiry_steps`: an FMS process for one
   customer (Instagram, DoubleTick, website, not bought, order, repair), every
   stage row with plan, done time, status, remark and doer.
5. **What comes next**: `follow_ups`, `appointments`, a case's next step.

## Rules (owner)

- One phone number is one customer. The newest name is the main name; every
  name and number seen is kept. The same name with another phone is another
  customer.
- No row is left out. A row without a valid phone matches on billing phone,
  then Instagram ID, else becomes a customer of its own (0416).
- Values are kept as the sheet wrote them. A meaning is read only where the
  words say it (for example "YES, THE CLIENT BOUGHT THE PRODUCT"); how a call
  was made is "not recorded" when the sheet does not say.
- Old sheet ids are references only; every customer gets our own codes.
- When two sources disagree, the higher-ranked source wins, then the latest
  (`customer.sources`): billing software > walk-in > exhibition > calls and FMS
  > enquiry tabs > Zoho > old master sheet.

## Same meaning, different column names

Each sheet keeps its own headers in its sheet table. In the master, columns
with the same purpose land in one field:

| Master field | Sheet columns |
|---|---|
| `lead_source` (how the customer found us) | Runo "Source", "Source Of Lead"; walk-in "SOURCE OF LEAD" + "SOURCE (OTHER)"; enquiry FMS "SOURCE OF THE LEAD"; Zoho "Lead Source" |
| contact outcome (`interactions.outcome` + `result`) | Runo "Status"; FMS "STATUS"; walk-in "CLIENT BOUGHT ANY PRODUCT?"; Zoho "Buying ?"; repair "STATUS (2)" |
| FMS stage (`interactions.fms_stage`, `enquiry_steps.stage`) | "WORK STAGE" in every FMS tab |
| who did it (`staff_user_id`, matched to Users) | Runo "Assigned To"; FMS "DOER" / "CRM"; walk-in "SALESPERSON"; Zoho "Sales Person" |
| branch (`branch_id`) | Runo "Store"; walk-in, not bought, repair "BRANCH"; Zoho "Store" |

"Source" has two meanings and both are kept: the sheet or form a fact came
from (`source` on every answer, contact and customer; decides priority) and
how the customer found us (`lead_source`).

## One person, two numbers (owner, 2026-11-19; migration 0436)

When one sheet row shows two of a person's own numbers (phone and billing
phone, PHONE 1 and PHONE 2, and so on; `customer.identity_phone_columns`)
and they belong to two customers, after each import batch:

- **Joined into one customer** only when their numbers appear together on at
  least 2 different sheet rows of the same franchise *and* they share a name.
  The older record is kept. A name alone never joins anyone.
- **Otherwise one family**: the customer who has no family of their own joins
  the other's. Two existing families are never joined by one number.
- **Same name, only one row**: one family, plus an open
  `possible_same_person` review shown as the "Possibly same person" tag and
  on the customer page.
- Never across franchises. A do-not-contact person can be joined and the
  joined customer stays do not contact.
- Every join (`customer_same_person_joined`) and family link
  (`customer_family_linked`) is audited with the rows that proved it.

## Still to build

- Standard vocabularies, mapped from the values as written (kept beside them):
  lead source (INSTAGRAM / Instagram / DIRECT MESSAGE -> Instagram ...),
  contact outcome, FMS stage (Introduction, Demonstration, Negotiation,
  Closure ...), city, community.
- Links to the app's own sections, once each form moves into the app: a form
  submission writes the same interaction / case step through the same
  contracts; an FMS run is linked by `fms_instance_id`; a case's next step and
  a follow-up become a Task for its person; Dashboard and Reports read the
  master.
- Customer page: cases and their stages, follow-ups, mobile layout.
- Segments beyond "buyer" (non-buyer, lead) once the owner defines them.
