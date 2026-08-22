# Recurring Task Completion Design

## Goal

Let an authorized schedule creator choose one completion mode first: an image-evidence Task that completes when its assignee uploads an allowed image, or a Checklist that completes when its assignee taps its completion checkbox.

## Scope and user flow

The New schedule dialog will present fields in the supplied reference order:

1. Assign to User
2. Department
3. Branch
4. Core Task
5. Description
6. Frequency
7. Task Start Date
8. Scheduled Start Time
9. Due Time
10. Task Type
11. Buddy Assignment Allowed

Task Type is required. `Task — upload image to complete` creates a delegation-style recurring task with `requires_upload=true`; the UI only accepts JPEG, PNG, or WebP images. A successful protected upload will record the evidence and transition the assigned task to completed in the same server-side operation. `Checklist — tap to complete` creates a checklist-style recurring task with no required evidence; its card presents one accessible completion checkbox, and activating it performs the audited completion transition. Existing templates and instances remain readable and retain their historic behavior.

## Architecture and data contract

A new forward migration will extend the recurring-template RPC to accept and persist the selected task type and buddy-assignment choice, and will ensure generated and initial recurring instances inherit them. It will expand the recurring workspace query beyond its current checklist-only filter while preserving branch/tenant/role authorization. The migration will provide a protected, audited image-evidence completion RPC; it validates actor eligibility, active assignment, task state, private attachment metadata, allowed image MIME/extension, and tenant/task ownership before marking the task completed. Direct client upload remains insufficient to complete a Task.

The web API layer will call the new RPC after placing the image in the existing private task attachment storage path. It will use the stored attachment identifier/path rather than trust browser-provided file details. The recurring page will render the distinct completion controls from the instance type and will refresh after each successful action.

## Authorization, audit, and storage

All template writes remain limited to the existing management roles and scope checks. Completion is limited to an active assignee; manager verification remains a separate existing workflow. The new evidence-completion RPC writes a task audit record in the same transaction as the state change. It rejects unauthenticated, inactive, cross-tenant, cross-branch, unassigned, completed, and non-image cases. Storage stays private; no signed URL or object metadata is exposed in public state.

## Validation and acceptance criteria

- The rendered schedule form follows the supplied field order and presents Task Type before Buddy Assignment Allowed.
- Saving Task produces an occurrence marked `delegation` with image evidence required; image upload completes it exactly once and produces an audit row.
- Saving Checklist produces an occurrence marked `checklist`; its one checkbox completes the assigned occurrence and produces an audit row.
- Existing recurring templates and instances preserve their task types and remain available in the workspace.
- Database tests cover allowed and rejected completion cases, assignment/scope denial, and generated-instance inheritance.
- Web tests cover the control labels/order and separate Task vs Checklist interactions.
- Focused tests, relevant database tests, TypeScript checks, production build, diff/secret review, a scoped commit, and Git push are completed. Hosted Supabase/Vercel deployment is outside this request.
