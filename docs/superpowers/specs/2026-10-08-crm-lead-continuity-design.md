# CRM lead continuity, history, filters, and dropdown authority

Date: 2026-10-08 (Asia/Kolkata)
Status: proposed for owner review; investigation only, no implementation or hosted writes.

## Intended outcome

Every person has one durable MKC identity from first lead contact through store visits and subsequent interactions. All submitted answers remain available, supported profile fields prefill later forms, and every recorded contact appears in history. Client Database supports useful filters and orders leads and clients together. JewelOS Dropdown Master owns configurable CRM options across desktop, mobile web, and Android's existing CRM WebView.

The owner explicitly requested these behavior changes. Preserve other original CRM behavior, existing records, private media, branch write rules, company-wide authorized reads, task outbox behavior, and historical evidence.

## Confirmed source defects

- `crm_private.link_lead_client()` links/creates the MKC identity but does not project `leads.field_values` into client details.
- `PhoneMatchedClient` and walk-in phone autofill omit anniversary, beverage, sugar, snack, and other supported profile fields. Fixing only the lead insert would leave this second gap.
- Client Database loads a separate, capped lead query and prepends all its rows to page one. It uses lead IDs in place of client IDs, has no lead profile action, and can continue showing a converted lead as a separate row.
- The list's database RPC already accepts potential category, but the page always supplies null. Other filters are absent.
- The lead page hardcodes `lookup_sugar_options: []`.
- CRM pages read CRM lookup tables, while JewelOS migration 0154 registers Sugar and other relevant lists in Dropdown Master.
- Profiles read `client_timeline`, saved walk-in forms/documents, and edit logs. They do not load linked lead answers, lead calls/stage history, or the separate follow-up histories into their timeline.

These are current source findings, not a verification of deployed behavior or customer records. The CRM worktree contains extensive prior changes; none may be overwritten or included in this task's publication without review.

## Approach selection

1. UI-only patch: quick, but leaves missing profile projections, incomplete history, and competing dropdown sources. Reject.
2. Extend existing identity, audited server contracts, and read projections: recommended. Preserve source records and expose one consistent profile and list.
3. Replace CRM lead/history systems: unnecessary migration and regression risk. Reject.

## Field continuity

Inventory every configured lead field against its saved JSON, client column or retained extension answer, phone lookup response, walk-in defaults, profile display, and historical recovery path. Map DOB, anniversary, contact/location details, preferences, and all other compatible fields with explicit aliases and validation. Unmapped/custom answers remain visible with their original labels and source reference; never discard them because no client column exists.

Save leads through a narrowly granted audited RPC. Validate active actor, branch rules, configured fields, required values, and master options at the server boundary. Preserve the original JSON and link the stable client ID in the transaction. Empty answers never erase filled fields. Existing store/manual values remain protected from lower-priority lead contributions. Record provenance and conflicts rather than guessing which value wins.

Extend the shared phone-match contract and reuse one autofill mapping across initial load, delayed lookup, blur, and submit-time resolution. Honor existing phone-plus-name ambiguity handling and family identities; never silently merge people who share a phone. Staff can review/edit prefilled values.

Historical recovery fills only missing compatible values from saved leads and retains the original answers. Preview counts and conflicts, then use a separate audited repair. Do not fabricate missing dates, contacts, or history.

## Client Database

Use one server-filtered, paginated dataset based on stable client IDs, including linked lead metadata. Each client appears once, including after conversion. Leads and clients both open their profile and can enter the existing authorized walk-in flow.

Filters: record type (all/leads/clients), lifecycle stage, branch, city/state, lead source/channel, potential category, purchase status, visit-count range, created-date range, and latest-interaction date range. Only expose filters backed by real data. Preserve name/phone/MKC/MKF/MKREF search and persist filters in the URL and pager. Counts and page boundaries apply to the entire filtered dataset; never filter only the currently loaded page or cap leads separately.

Default order: latest recorded interaction descending, falling back to registration time, with stable ID tie-breakers. Offer newest registration, latest store visit, and name sorting. Show registration, latest interaction, and latest visit as separate values; a lead registration is not a store visit.

## History and interaction date

Provide a unified chronological read projection over existing durable sources: lead registration/answers, stage changes, lead calls, queue registration, completed visits/forms, not-bought follow-ups, referral follow-ups, recorded engagement actions including thank-you messages, and profile edits. Retain source table/record references and actor, channel, event time, branch, notes, outcome, and authorized media links.

Keep contact interactions distinct from administrative edits and scheduled future follow-ups. Latest interaction is the maximum actual recorded contact time; scheduling a future follow-up must not set it to that future date. Registration counts as the first contact. History backfills use real historical source timestamps, not migration execution time. Repeated delivery/reconciliation cannot duplicate events. Do not insert calls or thank-you events into the visit table if its existing rollup triggers would count them as visits.

Extend existing engagement controls and add an audited profile action for a small contact (call/message/thank-you/note) where no current recording flow exists. Saving a contact and updating its durable history happen in one server transaction. A click on a call/WhatsApp link is not proof that contact occurred; staff records the result. A message is marked sent only from an explicit recorded result or verified delivery, never from opening a composer. External activity cannot be tracked unless an existing integration supplies it or staff records it; importing new channel/Runo sources is outside this repair.

## Dropdown Master

Inventory CRM dropdowns. Map configurable vocabularies to JewelOS master categories, including community, beverage, sugar, snacks, gifts, relations, lead source, products, reasons, communication preference, and potential category. Keep employee/branch selectors sourced from authorized Users/organization data; keep server workflow enums constrained by their existing contracts.

JewelOS owns master values. Use one caller-authorized option loader for desktop and the embedded native session, and an audited outbox/inbox projection into CRM where CRM server validation requires those values. Preserve tenant scope, active state, order, stable values, and legacy-label mapping. Do not give CRM a second editor or copy service credentials into clients. Historical saved/inactive labels remain readable, while new choices use active masters. Empty or failed master reads show actionable errors instead of hardcoded fallback lists.

## Validation and implementation sequence

1. Inventory current consumers and preserve existing work. Write focused failing regressions for lead-to-profile-to-walk-in mapping, lead conversion, unified paging/filter counts/order, history timestamps/idempotency, and Sugar/master-option behavior.
2. Add forward CRM migrations and pgTAP cases for audited lead save, profile projection, full lookup, unified list/history, and conservative repair preview. Add JewelOS master sync contracts only where necessary. Update generated types. Test anonymous, inactive, cross-scope, ordinary staff, privileged staff, and service-role paths.
3. Update the existing lead/walk-in/profile/list screens and central option loader. Preserve original styling and unrelated workflows.
4. Run CRM pgTAP on an isolated local stack, CRM UI/core/web regressions, affected typechecks, CSS check, web build, and whitespace checks. Exercise synthetic lead -> lookup -> visit -> profile -> follow-up/thank-you workflows at desktop and phone widths and through the embedded auth adapter. Verify stored answers and timestamps after each action.
5. Keep hosted release separate: confirm both project ledgers and exact dry runs, stage reviewed paths only, follow the production playbook, and verify the deployed commit and database contracts. Any Android/native or mobile-consumed shared change follows the standing signed-release gates; hosted CRM-only updates need WebView parity verification. Do not publish an unverified APK.

## Approval boundary

This design extends existing workflows across two project contracts, so review this written design before implementation. Then create the detailed implementation plan for review, with inline execution as the default; no subagents are requested. No database migration has been applied, no existing source changed, and no release made during this investigation.
