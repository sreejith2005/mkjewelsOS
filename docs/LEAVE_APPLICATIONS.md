# Leave applications

The Availability section contains the Leave management workspace: Apply leave, Handover, My leave summary, and an HR review view. Both web and Android use the same Supabase request, audit, and private image contracts.

## Setup

The `leave_type` Dropdown Master category contains Casual Leave, Sick Leave, and Earned Leave for existing tenants. The source Apps Script reads the `FORM DATA` sheet, whose values were not supplied; these three types are the current app defaults and can be managed in Dropdown Master.

`availability.review_leave` defaults to Super Admin, Admin, and HR. Approving a request also requires `availability.manage_others`, because it records absence through the existing audited Availability contract. A reviewer cannot decide their own request. Other employees see only their own applications. An active employee can submit a request with a TL approval screenshot, edit dates while pending, and submit handover with an active colleague and second screenshot. Rejected leave cannot receive handover.

Leave applications appear before the employee roster on web and Android. Super Admins and employees designated Director, Managing Director, or Owner see their summary and any review access, without an application form. The database applies the same restriction to direct submissions. HR remains eligible to apply.

## Flow and Unique ID

Submitting a leave opens Handover with that leave selected. The Handover tab lists the employee's leaves without a handover (rejected leave excluded); Fill handover selects one, and the form requires Handover done = YES, a recipient, and a screenshot. A successful handover opens My leave summary, which shows day totals by status, status pills, HR remark, and Edit only while pending. Every request carries an immutable `reference_code` in the source pattern `NAME-DD-MON-YYYY-HHMMSS` (Asia/Kolkata), with `-2`, `-3` for same-second repeats; migration `0178` assigns it by trigger and backfilled existing requests. The UUID remains the key used by the RPCs.

## Calculation and attendance

The app and database mirror `tempcode.gs`: advance notice thresholds use the submitted date and the leave start/end calendar gap; multi-day leave excludes Sundays, while the source's same-day branch uses its half-day rules even on Sunday. The count retains the source's special long second-half adjustment. The return date must be on or after the leave end date. HR approval marks full leave days absent and partial dates as `half_day`, including the return date when work resumes in its second half. Pending and rejected applications do not affect Availability. The existing task coverage logic runs when full days are marked absent; the current Availability contract treats `half_day` as available for tasks.

## Data and release

Migrations `0174` through `0178` add the tenant-scoped requests, protected RPCs, retained data classification, private `leave-approvals` Storage bucket, default leave types, and applicant eligibility. Images are limited to JPEG, PNG, or WebP up to 5 MB. The browser and native clients use short-lived signed URLs. A failed request registration attempts to remove its unlinked upload; an upload abandoned when the app closes can remain and needs operational cleanup. Existing Google Sheet rows are not imported; the source files do not include the spreadsheet data. Any historical import requires a separate mapping and authorization review.

Run `supabase.cmd db reset --local`, `supabase.cmd test db`, core/web/native tests, typechecks, and builds before applying the forward migration to the existing linked JewelOS project. Validate the signed-in Availability route on desktop and phone width and the upload/review workflow with controlled accounts.
