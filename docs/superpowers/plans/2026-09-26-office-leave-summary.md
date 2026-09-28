# Office leave summary

1. Add a distinct read permission for office leave summaries and a narrowly scoped application exception permission. Apply both at the database boundary; keep review authority separate. Use Sanket Kadam's verified linked profile ID, with name and role checks, for the grant.
2. Extend the shared leave data and summary logic so authorized leadership sees all tenant leave requests and their pending, approved, and rejected details. Preserve the personal history and handover flows for applicants.
3. Update web and Android Availability screens with the office summary. Cover the permission boundaries with pgTAP and the shared/display behavior with focused tests.
4. Run local database, client, type, and build checks. Inspect the dirty worktree before any release, then follow the Android release guide and verify hosted assets only after every required gate passes.
