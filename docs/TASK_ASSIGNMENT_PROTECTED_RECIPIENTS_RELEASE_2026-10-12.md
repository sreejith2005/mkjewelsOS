# Protected task recipients: release evidence

Source `6ce08f14c5102ee89273464fcc59dea20fb7ff7e` is published to main; remote hash matched. Only eight named assignment files were committed; prior local release notes and unrelated original-checkout task-control work remain untouched.

Migrations 0228–0229 applied to existing JewelOS project `yimafxhuwgfhvzczqqdd`. A temporary deployment manifest excluded independent pending Ask Kiara migration 0227. No production customer/employee records were created for tests. Hosted metadata confirmed both migration entries, roster recipient filtering, direct write and template/import guards, manual recurring checks, protected role-rule rejection and private helper privileges. The scoped post-apply dry run had no pending migrations.

Local validation: `supabase.cmd test db` passed 130 files and 3,566 assertions. Workspace `turbo run typecheck --force --concurrency=1` passed six packages. Eighteen new assertions prove ordinary employee assignment access without elevation, colleague success, Super Admin/Admin/Manager denial through direct creation and transfer, Owner/Director designation protection, target dashboard authority, self assignment, retained Super Admin authority, protected schedules and helper privacy. Failing assertions were observed before the fix. Independent review found no remaining important issue within the stated manual-assignment boundary.

One private helper was added; generated function types and exact privilege inventory were updated. Existing task RPC signatures, audit writes, directory RLS, notifications and persisted assignments remain unchanged. The existing browser/native API clients automatically consume the updated server roster; there is no frontend behavior change to deploy. Authenticated production browser behavior was not independently exercised; local SQL RPC flows and hosted metadata were verified. Vercel build status is separate from this live database correction.

Historical automatic schedules retain their prior behavior. Future authority changes to a scheduled ordinary recipient are outside this correction. New/retargeted management-role schedules cannot exploit future role membership. Prior native source parity remains prepared, and Android release remains deferred by owner.

This is a local evidence note outside the published implementation commit. Rollback is a reviewed forward migration; never rewrite applied history.
