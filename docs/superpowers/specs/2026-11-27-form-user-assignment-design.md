# Forms user selection

Users questions show the Form Builder's configured people first. The filter is a default list, and staff can choose someone outside it or at another store, as requested by the owner. Reuse the task store picker and keep persisted answers as profile IDs.

The directory view is not an assignment directory. A question-authorized RPC must evaluate the saved filter on the server, including department names across stores, without widening directory RLS. Return only IDs and names. Broader selection still requires an active actor, access to the published form, an active recipient in the same tenant and an active store. Record cross-location answers through the existing audited submission and preserve FMS handoff identity.

All Users questions support another store; retire the builder's contradictory opt-in. Preserve definitions, filters, original answers and submission history. No Storage or Android-shell changes. Kiara needs updated instructions but no new read tool.

Approach: extend existing form and assignment contracts. A client-only directory/filter fix cannot solve hidden colleagues or submission rejection. A second assignment system would duplicate the existing store picker and handoff auditing.

Plan: first reproduce the default and expanded list behavior in UI/SQL tests; add the scoped lookup and matching submit eligibility; wire a focused Users control; update help; run database, UI, type/build and responsive checks. Stage and release only these paths after checking staging and production ledgers.
