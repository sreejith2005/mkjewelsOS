# Form Dependencies and FMS Draft Safety Design

## Goal and approved behavior

An author can edit a published form under its existing ID after reviewing the
specific work that uses it, or create a version in the same form family and
explicitly select that version for future work. Deleting a form and repairing an
affected FMS draft must not delete stage definitions referenced by existing runs.
An existing assignment must continue to identify its exact form and FMS stage,
except that an explicitly deleted form needs an authorized replacement on its
retained stage.

## Current contracts and failure

- Migration 0117 allows audited form deletion. It snapshots submissions,
  detaches task and FMS references, withdraws starters, and moves an affected
  published flow to draft or archived. It leaves existing FMS instances intact.
- `save_fms_flow_draft_with_audit` in migration 0124 deletes every stage of an
  existing draft and inserts new stages. `fms_instance_stages.fms_stage_id`
  still references those old IDs, causing the reported foreign-key error.
- Migration 0157 and both clients already permit published-form edits under the
  same ID, with historical submission snapshots. The author sees no usage
  warning before saving.
- Both FMS stage editors already offer the latest published form of the same
  family. The current `publishAsNewForm` action duplicates into a *different*
  family. Publishing a true revision archives the previous version, while
  active FMS work can prevent that archive. Task connections have no comparable
  version-switch path.

## Form usage and edit decision

Add one tenant-scoped, authorized read RPC for the selected form's usage. It
returns named FMS flows and stages with their status and active-run count,
named task templates, open tasks, pending starter assignments, and a count of
historical submissions. It must use the current profile, section access, and
existing permission resolver; it reveals no other tenant's records. It does
not expose submission answers or other employees' private details.

Web and native Forms builders show this usage before a published-form save.
The warning explains that saving under the same ID changes the form shown to
future submissions and still-open work that references that ID, including
active FMS steps. Existing submission snapshots remain unchanged. Renaming or
removing question keys, choice values, or conditional routes can invalidate
FMS answer branches and leave in-progress answers incompatible. It names the
affected connections, recommends creating a new version, and offers an
explicit **Edit this published form** confirmation. A stale or failed impact
read blocks the confirmation rather than presenting an incomplete list.
The audited `save_published_form_with_audit` remains the write boundary and
continues to enforce authorization and field validation.

## Version lifecycle and switching

Expose **Create new version** using the existing audited
`create_form_revision_with_audit` contract, then open that draft in the
builder. Keep **Duplicate as separate form** as a distinct action. The
new version has the same `family_id` and a higher `version`; its published
status and identity are visible in the Forms Library, FMS selectors, and task
form selectors. Do not relabel the existing separate-family duplicate as a
version.

Publishing a revision must leave older assignments and active FMS runs able to
submit their exact pinned version. The previous version can be archived for
new selection, but exact assigned-work submission and rendering must accept
that pinned archived version after verifying the assignment, actor, tenant,
and workflow state. General standalone filling remains limited to current
published forms. New work uses the latest published version only when its
author explicitly chooses that version in its task template or FMS definition;
there is no silent bulk retargeting. Existing open task instances and FMS
instances retain their assigned form ID unless an audited, separately
authorized edit explicitly changes them. Submitted answers retain snapshots.

The FMS editor continues its existing **Use vN** action, including for an old
archived pin. Task template authoring exposes the same-family latest-version
choice and a clear current-version indicator. Where direct task edits already
permit changing a required form, offer the new version there too, with the
same server authorization and completion safeguards. Every selection is
validated against the correct tenant and publishable status at the write
boundary. Question-based FMS routes must be revalidated when a selected
version lacks an old field key or choice value; the UI must not promise that
routes always match between versions.

## FMS draft-save and deletion repair

Replace the delete-all/reinsert-all stage write in the audited draft-save RPC
with identity-preserving reconciliation by `(fms_flow_id, stage_key)`. Existing
stage rows keep their IDs while editable values, assignees, and branch rules
are updated. For a stage referenced by an active run, only replacing a form
that deletion already detached is allowed in place; changing its routing,
assignees, completion rules, or other runtime meaning requires an FMS revision.
New keys create new rows. A removed key may be deleted only if no
runtime row or other durable reference needs it. Otherwise the RPC rejects
that removal with a clear domain error directing the author to retain the
stage or create a flow revision. The transaction validates stage keys,
references, form availability, and tenant scope before committing any change;
its audit entry records the saved definition. Existing runs continue to point
to valid stage IDs. Replacing a deleted form on the surviving stage must save
successfully and allow the draft to be republished once all required forms and
routes validate.

Deletion remains an explicit, audited operation with the current pre-deletion
impact dialog. The dialog must state that an affected FMS flow requires a
replacement and that active runs continue to use its retained stage IDs. It
must never automatically substitute a different form based on name or family.
No deleted form row or prior submission is restored automatically. If an
existing run has reached a detached form step, the repair must make the
replacement form available through that exact stage without changing the run
or assignment identity.

## Authorization, compatibility, and scope

Use a forward migration; do not alter applied migrations or rewrite historical
form submissions, tasks, or FMS instances. Keep existing RLS and minimal
grants. The usage RPC and revised write RPCs reject anonymous, inactive,
ordinary unauthorized, cross-tenant, and out-of-scope actors. Client warnings
are explanatory; server contracts remain authoritative. Preserve audit events
for form edit/version/publish, FMS save, and any task retargeting. No Storage,
secrets, or new external service is required. Regenerate database types if an
RPC signature or schema type changes.

## Verification and release

Use synthetic pgTAP fixtures to reproduce delete-form then save-FMS with an
existing instance stage; assert its ID and work remain valid. Cover stage
addition, safe removal, forbidden referenced-stage removal, form replacement,
published revision with an old pinned assignment, and denied authorization
paths. Add focused shared/client tests for usage presentation and version
selection on web and native. Check Home, Tasks, notifications, direct links,
Forms, and FMS against the exact assignment IDs. Render desktop and phone-width
builders and verify native navigation. Run the relevant local database,
typecheck, build, and regression gates before any hosted action. If native
code or mobile-consumed shared code changes, follow the repository's signed
Android release procedure after gates pass; report hosted and device evidence
separately.
