# Leave applications

The Availability section contains Apply leave, My leave summary, and an HR review view. Both web and Android use the same Supabase request, audit, and private image contracts.

## Setup

Add the company's actual leave types in Dropdown Master with master type `leave_type`. The Apps Script references a `FORM DATA` sheet but the supplied source files do not include its values, so no leave types are invented or seeded. The form explains when none are configured.

`availability.review_leave` defaults to Super Admin, Admin, and HR. Approving a request also requires `availability.manage_others`, because it records absence through the existing audited Availability contract. A reviewer cannot decide their own request. Other employees see only their own applications. An active employee can submit a request with a TL approval screenshot, edit dates while pending, and submit handover with an active colleague and second screenshot. Rejected leave cannot receive handover.

## Calculation and attendance

The app and database mirror `tempcode.gs`: advance notice thresholds use the submitted date and the leave start/end calendar gap; multi-day leave excludes Sundays, while the source's same-day branch uses its half-day rules even on Sunday. The count retains the source's special long second-half adjustment. The return date must be on or after the leave end date. HR approval marks full leave days absent and partial dates as `half_day`, including the return date when work resumes in its second half. Pending and rejected applications do not affect Availability. The existing task coverage logic runs when full days are marked absent; the current Availability contract treats `half_day` as available for tasks.

## Data and release

Migrations `0174` and `0175` add the tenant-scoped requests, protected RPCs, retained data classification, and private `leave-approvals` Storage bucket. Images are limited to JPEG, PNG, or WebP up to 5 MB. The browser and native clients use short-lived signed URLs. A failed request registration attempts to remove its unlinked upload; an upload abandoned when the app closes can remain and needs operational cleanup. Existing Google Sheet rows are not imported; the source files do not include the spreadsheet data. Any historical import requires a separate mapping and authorization review.

Apply and verify the migrations on staging before publishing either client; the current production link must not be used as a feature-test database. Run `supabase.cmd db reset --local`, `supabase.cmd test db`, core/web/native tests, typechecks, and builds first. Validate the signed-in Availability route on desktop and phone width and test the upload/review workflow against staging with synthetic accounts.
