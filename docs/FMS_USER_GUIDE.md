# Stage-specific FMS work

This guide describes the version 2 assignment implementation. Check the
verification report before assuming these changes are deployed.

## Super Admin: configure a workflow

1. Open FMS and create a draft, or revise a published workflow. Existing
   versions and running instances retain their assignment behavior. Upgrade
   a legacy draft explicitly when stage-specific assignment is wanted.
2. Link the initial Form. Its assigned employee submits that exact Form to
   start the workflow; a manual Start Instance action is no longer the normal
   employee entry path.
3. For each human step, choose its assignment strategy:
   - **Previous Form User Answer:** choose an exact linked form and User
     question. The nearest matching visit on the route actually taken wins.
   - **Fixed Employee:** choose the locked employee. Form answers and
     employee handoffs cannot replace this owner.
   - **Role / Hierarchy Rule:** select the role, branch manager, or department
     head. Server eligibility rules still apply.
   - **Previous Stage Employee:** use the employee completing the nearest
     causal human step.
   - **Manual Handoff:** require a permitted employee choice at confirmation.
   - **Configured Fallback:** use the explicitly configured fallback rule.
4. For hidden, conditional, or optional assignment questions, configure an
   explicit fallback. Required source forms cannot be bypassed with Complete.
5. Configure work information: title placeholders such as `{workflow}`,
   `{stage}`, `{reference}`, and `{initial.client_name}`; up to 12 received
   questions; a reference question selected from those questions;
   instructions, expected result, and the due-date label. Only authorized
   causal answers are shown. Unresolved title placeholders use a readable
   workflow/step title.
6. Group steps with an optional pipeline name. Guided step editing and the
   advanced canvas edit the same saved workflow. Groups do not create
   separate workflow instances or change routing.
7. Configure routes, decisions, parallel splits/joins, and return routes.
   A return to the first Form needs an incoming assignment strategy too.
   A loop may use the previous visit of its own Form as a source.
8. Optionally set a maximum number of follow-up visits. Reaching it holds
   the workflow for review; escalation also records the configured escalation.
   The source work remains available. After an authorized resume, choose the
   configured exit route rather than repeating the capped route.
9. Use Simulation with sample answers, decisions, and handoffs. Simulation
   writes no forms or tasks. Actual submission revalidates form visibility,
   eligibility, availability, and routing on the server.
10. Save and publish. Correct publication errors before assigning starter
    forms. Published definitions and historical submissions are preserved.

## Employee: complete assigned work

Open the work from Tasks, Home, Notifications, or its direct link. All entry
surfaces identify the same saved assignment. The form template alone is not
an assignment identifier.

Read the work instructions and Information Received before completing the
step. File buttons open short-lived links to specifically authorized private
attachments. Journey pages show bounded history for this work.

Fill the required Form and submit. Review each next step and employee in
**Complete Stage and Assign Next Work**. If permitted, choose a replacement
from the eligible employee picker. If availability coverage applies, review
both the chosen employee and the employee who will receive the work. A
coverage change requires another confirmation.

**Cancel and Return to Form** keeps the entered answers and makes no
submission. **Confirm Next Work** saves the Form and advances the stage in
one transaction. A locked employee cannot be replaced. Missing or stale
choices must be corrected before the server accepts completion.

The final message reflects the saved result: new work activated, other doers
still required, approval required, workflow held, or workflow completed. With
multiple doers, the first saved Form is shared and cannot be overwritten;
remaining doers complete with their own completion records. Approval still
requires an authorized reviewer.

After a lost response, reopen the same starting assignment to recover the
saved confirmation. Retrying a confirmation does not create duplicate work.
Use **Open my next work** only when the saved result contains work assigned
to you. Another employee's next step is never opened automatically.

## Compatibility

Legacy workflows remain version 1 until explicitly upgraded in a draft.
Revising a workflow preserves its assignment version. Existing tasks, Forms,
submission snapshots, notifications, and historical visits remain persisted.
New visits receive their own owner and provenance; a later loop does not
rewrite the owner or Form of an earlier visit.

## Opening Forms from a workflow step

The step inspector offers **Create New Form**, **Open Form Builder**,
**Preview Form**, and **View Published Version**. Creating and editing
require Forms authoring permission in addition to workflow access. The
workflow draft saves before opening the existing Forms workspace. Returning
keeps the selected workflow step and its linked Form version. Editing a Form
or viewing its published version does not silently replace that link; select
the intended version in the workflow when you want to change it.

## Simulating a workflow

Open **Simulate workflow** from the builder. It loads the linked Form
versions, applies their conditional fields and validation, and displays a
bounded route and assignment trace. Enter sample answers and decisions for
the steps you want to explore. Route-specific assignment sources use the
matched route; skipped Forms cannot supply an employee. Fixed steps show all
configured doers. Simulation creates no real work, submissions, or
notifications. The server checks authorization and availability when real
work is submitted; the trace is an authoring aid, not an authorization result.

On the web, sample checkboxes, multiple selections and numbers use their
correct answer types. File fields do not upload during simulation; a required
file pauses the sample route. The trace includes the linked Form and any
configured work instructions and expected result. Invalid draft routes show
an error inside the preview so you can return to editing.
