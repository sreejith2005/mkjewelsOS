# Leave handover and half-day coverage

## Scope

Use existing Availability, Dropdown Master, and task coverage contracts. Keep historical leave requests and assignment history.

## Steps

1. Add a forward migration to retire the seeded Earned Leave choice and seed Compensatory Off. Keep existing leave request values unchanged.
2. Add a narrow authenticated handover-recipient view returning active same-tenant employee IDs and display names. Use it in web and native leave forms; refresh leave types when the form gains focus.
3. Model approved leave's absent half using the existing leave dates and a 13:00 Asia/Kolkata boundary. Reconcile task, CRM follow-up, and FMS assignments on approval and at the boundary; preserve the original assignee and audit each transfer or restoration. Rejected leave does not enter this flow.
4. Add database tests for dropdown values, recipient authorization, approval/rejection, first-half/second-half routing, and return of unfinished work. Run local database, type, and build gates before any hosted release.

## Compatibility

Full-day leave retains `user_availability.status='absent'` and the existing Availability coverage workflow. Half days retain `status='half_day'` for the roster. The FMS stage stores its temporary buddy and whether that buddy was already a doer, so a shared stage can return the original without removing a preexisting assignee. A scheduled boundary reconciliation updates only approved half-day leave, only unfinished work, and only the affected day. It is safe to run repeatedly.
