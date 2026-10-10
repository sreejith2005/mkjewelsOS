# Task scale, administration, and imported proof

Approved by the owner in chat on 10 October 2026.

Load the selected task workspace in pages of 50 with server-side status filters,
counts, and deterministic ordering. Preserve My Tasks, Delegated and In Loop
semantics and add All Tasks for Admin/Super Admin through `tasks.view_all`.
Keep current-day/overdue recurring work and all open FMS assignments visible;
All Tasks also supports historical and future tasks for administration.
Load required form definitions only when opening a form, and load native task
details by persisted identity rather than loading the entire workspace.

Admin/Super Admin can edit ordinary task title, description, priority and
deadline, and delete an occurrence or its entire recurring series through
audited, module-checked RPCs. Series deletion stops generation and hides open
occurrences; completed occurrences and private evidence remain historical
records. Deleted records are tombstones, not lost evidence. A deleted series
cannot be run, edited, generated, or used to resurrect an occurrence.
FMS lifecycle continues through the existing FMS contracts.

Retire only the deleted work's import retry identities and affected batch
hashes, retaining their original values and history. This allows corrected or
identical re-import while replay protection remains active for unrelated rows.

Every imported delegation Task requires a real private uploaded file, regardless
of a blank/No evidence cell. Checklists retain click completion. Apply this to
new/replayed imports, imported templates and their unfinished instances, with
an audited forward-only repair. Do not rewrite historical completions. Preserve
raw row hashes/fingerprints so changing evidence policy does not duplicate work.
Use a database trigger to reject any imported Task completion without valid
registered Storage evidence, including direct API writes and linked-form paths.

Validate allowed and denied actors, tenant boundaries, watcher restrictions,
deleted work, recurring generation/re-import, all supported import formats,
large-volume pagination/counts, direct deep links, web and Android workflows.
Release only after the repository's local/hosted/browser/device gates pass.
