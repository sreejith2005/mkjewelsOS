# CRM cumulative profile answers

Owner decision, 2026-10-23: phone-based walk-ins use the most recently visited profile. Saved personal, contact, planning and preference answers accumulate. A newer nonblank answer replaces an older answer; a blank answer preserves known information. No profile picker or automatic historical merge is wanted.

## Contracts

- Phone-based queue registration reuses the most recently visited matching client, even if the entered name differs. Explicit profile actions retain their selected ID.
- Existing new/empty queue records resolve the latest phone profile when opened. Queue completion and the newly submitted visit use that resolved ID in the existing audited transaction.
- `get_client_profile` keeps the requested record's identity, statistics and history while assembling stable answers from that phone's profiles, saved forms and field-change evidence. `get_walkin_profile_defaults` supplies the same accumulated planning/preference defaults as validated JSON.
- Newest saved answers win deterministically. A clearing edit does not give an older answer a new timestamp. Invalid historical dates/types are skipped without changing their evidence. Stored international numbers retain their country codes when reused as input.
- Only allowlisted profile/default fields accumulate. Per-visit dates, staff, purchase outcomes, products and proof files remain attached to their individual visits.
- Blank/omitted walk-in answers retain known values server-side. The original submission snapshot remains unchanged; source rows are never rewritten by reads or migration application.
- Existing active-user RLS, company-wide CRM reads, branch-scoped writes, proof validation and transactional audit remain authoritative. No new table or widened browser write grant.

The form labels only genuinely populated defaults as auto-filled, distinguishes new/established queue records, resets on a different queue assignment and preserves unsaved edits on the same assignment's refresh. Proof uploads resolve the current client's identity after a phone correction.

Kiara app help describes this rule. No new assistant read tool is needed: these are existing CRM profile/intake reads; Kiara remains read-only.
