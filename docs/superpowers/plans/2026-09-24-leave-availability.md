# Leave applications in Availability

## Source and behavior

`tempcode.gs` and `tempindex.html` define Apply, Handover, and My Leave Summary. A request captures employee identity, branch, leave type and duration, reason, leave dates, return date and half, and a required TL approval image. It starts Pending. A separate handover records the receiving employee and a required approval image. Pending requests permit edits to dates and return half. The sheet calculates advance notice and counted leave days, excluding Sundays, including its unusual additional half day when a second half start and second half return are at least five calendar days apart. HR status and remark were entered outside the script.

## Design

- Authenticate employees through JewelOS. Derive name, email, branch, and employee code from their active profile. Identify requests by UUID, never by sheet row or name.
- Store requests in a tenant scoped table. A private Storage bucket holds two image attachments. Only the applicant and authorized HR reviewers can read their requests and images. Protected RPCs own create, pending edit, handover, and HR decisions; each writes an audit entry.
- Use the Apps Script calculation as shared TypeScript for client previews, with the same calculation in the database for authoritative writes. Validate date order, return date, and upload metadata on the server.
- HR approval records absence for the approved leave interval through the existing audited Availability RPC so task coverage reacts. Rejection does not change attendance. Keep existing manual Availability actions intact.
- Add a leave area to both Availability screens. Employee sees Apply, pending Handover, and Summary; HR sees requests to review. Use Dropdown Master for leave type values and fixed duration/return half values from the source.
- Do not import Google Sheet rows automatically; the provided source has no sheet data or consent to migrate it. Existing Google requests need a separate reviewed import.

## Work and verification

1. Add focused shared rule tests, then calculations and validation.
2. Add forward migration with table, RLS, RPCs, private Storage policies, and pgTAP authorization cases.
3. Add a shared data API, web controls, and native controls; check mobile parity.
4. Run focused tests, local database contract tests, typechecks and builds. If all gates pass, follow the standing Android release procedure and report hosted deployment separately.

## Decisions

- HR approval automatically records absence, per user confirmation.
- The sheet's dynamic leave type list is unavailable in the two source files; use the app's managed Dropdown Master values without inventing types.
