# Readable CRM profile histories

Approved by the owner in chat on 2026-10-23.

Keep the existing profile page and replace the long contact, saved walk-in and profile edit presentations with expandable summaries. Show five entries initially and offer Show more for the rest of the loaded page; retain existing server pagination for older pages.

- Contact summaries show date, type, staff and a short note preview. Full notes and labelled saved answers remain accessible on expansion. Keep the existing audited Record contact form and retry semantics.
- Walk-in summaries show date/reference, outcome and media count where available. Group saved answers into Personal & contact, Preferences & planning, Products & visit, Follow-up, and Other saved details. Keep every original answer, including unknown fields and nested snapshots, accessible without printing raw JSON. Media stays separate and uses the existing private signed-URL flow.
- Edit summaries group fields sharing the exact timestamp and editor (the best available evidence of the same save, without inventing a transaction identity). Show readable field names, Before and After values, editor and full date/time. Keep distinct saves separate. Preserve blanks, booleans, zero, arrays and nested values faithfully.

Use existing JewelOS theme tokens and responsive layouts. No new dependency, migration, write contract, data reconciliation or permission change. No new Kiara read tool is needed; update app help for the presentation controls. Validate older-record access, unknown/nested answers, multiple saves, long text and failed media opening at desktop and phone widths.

Alternative considered: separate tabs reduce page length but make scanning the profile require more navigation; owner approved expandable sections instead.
