# FMS Conditional Form Branching Design

Research note and architecture decision for making a Form submission decide which
FMS step runs next. Written before implementation, against the current source in
`packages/core/src/{fms,forms}`, `apps/web/src/features/fms`, and
`supabase/migrations/0009…0124`.

## 1. What already exists

The lifecycle `Form Builder → definition → submission → response → FMS step →
execution → next node → task` is already wired, and it is already keyed on
stable identifiers. Tracing it end to end:

| Stage | Where | State |
| --- | --- | --- |
| Form definition | `form_templates` + `form_fields`, `packages/core/src/forms/definition.ts` | Fields carry a stable `field_key`; options carry a stable `value` and a renameable `label` (`forms/options.ts`). Dropdown Master fields carry `option_source='dropdown_master'` + `dropdown_master_type` and resolve live. |
| Form conditional logic | `forms/rules.ts`, `forms/visibility.ts`, `forms/sections.ts` | Decides which questions the respondent sees. Independent of FMS. |
| Submission | `submit_form_with_audit` (0119) | Writes `form_submissions.data` as a flat object keyed by `field_key`, values normalised to the option `value`. Sets `fms_instance_stages.form_submission_id`. Validates that a select/radio answer is a configured option. |
| FMS template | `fms_flows`, `fms_stages`, `fms_branch_rules`; `core/src/fms/types.ts` | `FmsBranchRule { source: 'outcome' \| 'context' \| 'form_answer', sourceKey, operator, value, nextStageKey, order }`, ordered, per stage. |
| Build-time validation | `validateFmsDefinition` + `FmsValidationContext.formFields` | Already detects a missing destination, a deleted question, a deleted option, two fallbacks, and routing on an outcome the step does not offer. |
| Builder UI | `FmsStageEditor.tsx` (`StageRouting`, `RouteRow`) | Question and Answer selectors are already populated from the selected form's real fields/options. Destination selector is populated from the real stages. |
| Canvas | `graph.ts`, `FmsGraphCanvas.tsx` | Renders one labelled edge per route plus an "Otherwise" edge. |
| Execution | `fms_stage_route_target` + `complete_fms_stage_with_audit` (0123) | On completion, evaluates the stage's rules in `sort_order`, first match wins, falls back to `default_next_stage_id`. |
| Activation | `activate_fms_stage_internal` (0082) | Lazy: an instance stage row (and therefore a task) is created only when the step is actually reached, and an already-activated step is returned rather than duplicated. |

So branching is not a greenfield feature here. **The architecture is sound and
the remaining work is closing correctness, safety and UX gaps in it**, not
rebuilding it.

### Where it stops being dynamic — the confirmed gaps

1. **Unmatched answers can silently end the workflow.** A routed step is allowed
   to publish with no fallback. At run time an answer that matches no route
   falls through to `default_next_stage_id`; when that is null the instance is
   marked `completed` and nobody is told. This is the single most damaging gap.
2. **The database does not detect a stale option.** Publish validation checks
   that the route's `source_key` still exists as a `form_fields.field_key`, but
   never checks that the matched option still exists. Only the browser's
   `validateFmsDefinition` does, and the database is the authority.
3. **The taken route is not recorded on the instance stage.** `branch_rule_id`
   is written only for legacy `branch` nodes; a routed ordinary step writes a
   `route_taken` log line but leaves the column null, so execution state cannot
   answer "which branch did this instance take" without parsing logs.
4. **The builder shows option `value`s, not labels.** `FmsFormFieldRef` carries
   `optionValues: string[]` only, so the Answer selector and canvas edges read
   `bought_jewelry` instead of "Bought Jewelry".
5. **A form revision blinds the builder.** `publish_form_with_audit` archives
   the previous version, and both `data.forms` and `formFieldIndex` load only
   `lifecycle='published'` templates. A published flow pinned to v1 therefore
   loses its field list the moment v2 is published: the Question selector goes
   empty, option checks are skipped, and the flow cannot be republished. Running
   instances are unaffected (they use the pinned version), but the acceptance
   test "add an option to the form, the FMS Builder must expose it" fails today.
6. **The `in` operator does not survive a reload.** `condition_value` is `text`;
   an array value is stored as the JSON text `["a","b"]` and read back by
   `flowToDefinition` as a string, so a multi-value route reloads broken.
7. **Database and core disagree on multi-select answers.** `fms_rule_matches`
   flattens the answer with `#>>'{}'`, which turns a jsonb array into its JSON
   text; `equals`/`in` therefore cannot match one selected checkbox option,
   while `evaluateFmsBranchRule` in core handles arrays properly.

## 2. How the professional tools solve it

**Make Router.** A Router creates several routes from one point. Routes are
ordered and processed serially, each route carries its own filter, and **all
routes whose filter passes run** — it is a fan-out, not a decision. Any one
route can be marked the fallback, which receives bundles no other route
accepted. Router branches are not designed to reconnect.
([Router](https://help.make.com/router))

**Make filters.** A filter sits on the connection between two modules and is
built from operands + an operator (text, numeric, date, array, plus
`exists`/`not exists`). A bundle that meets the condition passes on; a bundle
that fails is terminated on that path.
([Filtering](https://help.make.com/filtering))

**Make If/Else + Merge.** The newer model is explicitly different: If/Else
"runs the first condition that passes as true", requires at least one
conditional route **and one else route**, and its routes *can* be reconnected —
that is exactly what the Merge module does, passing whichever single route
became active back into one continuing flow. Make's own guidance is to order
conditions most-specific first, and it contrasts this with the Router, "where
all routes run and can't be reconnected".
([If-else and Merge](https://help.make.com/if-else-and-merge))

**n8n If / Switch / Merge.** `If` is binary true/false with typed operators and
AND/OR combinators; for more than two paths the docs point at `Switch`. `Switch`
matches ordered rules with renameable outputs, and its fallback output is an
explicit three-way choice: discard, a dedicated extra output, or output 0. It
also exposes "send data to all matching outputs", which flips it from decision
to fan-out — the two semantics are a deliberate, separate switch. `Merge`
recombines branches downstream.
([Switch](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.switch/),
[If](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/),
[Merge](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge/))

**Upstream data as mappable input.** n8n exposes every previous node's output
for mapping and references it by *node name* in expressions. That choice is
fragile enough that n8n had to build rename-propagation so automatic renaming
"won't break references"
([release notes](https://docs.n8n.io/release-notes/)) — direct evidence for
preferring immutable IDs over display names, which this codebase already does.

### What to take, and what to refuse

Take: ordered rules, first-match-wins, an explicit and *mandatory* fallback,
renameable route labels that are not the identity, and downstream
reconnection.

Refuse: Make's Router fan-out semantics (a single-select answer must not start
three branches); n8n's name-based references; a separate Merge node type (our
graph already supports several incoming edges to one stage); a generic
expression language; and a visual-only branch that the server does not
independently evaluate.

## 3. Architecture decisions

**Q1 — representation.** `Node → multiple conditional edges → Nodes`, which is
what `fms_branch_rules` already is. No `Route` entity and no dedicated Branch
node for the common case. A separate router node would double the node count on
the canvas, need its own assignee/SLA handling that it does not want, and force
every existing flow to be migrated. The legacy `branch` step type stays readable
for old flows but is not what new branching uses.

**Q2 — where the condition lives.** On the **edge** (`fms_branch_rules` rows
belong to the source stage and name a destination). Conditions on the
destination node are what `sla.conditional` did, and it scales badly: five
destinations means five nodes each re-deriving the same decision, and nothing
guarantees the five conditions are exhaustive or exclusive. On the edge, the
whole decision is one ordered list, in one place, evaluated once.

**Q3 — form response as workflow data.** The FMS reads
`form_submissions.data` — the flat, server-normalised `{ field_key: value }`
object the Forms engine already produces — resolved from the completing
instance stage's `form_submission_id`. The FMS never re-runs the form's
visibility rules; a question the respondent never saw is simply absent from the
response, and an absent answer matches no route and takes the fallback.

**Q4 — references.** `formId` = `fms_stages.form_template_id`; `fieldId` =
`form_fields.field_key`; `optionId` = `FormOption.value`; `nodeId` =
`fms_stages.stage_key` (with `fms_stages.id` as the database identity);
`routeId` = `fms_branch_rules.id`. Labels — question text, option text, stage
name, route label — are display only and never matched. This is already true and
must stay true.

**Q5 — multiple branches.** One `fms_branch_rules` row per option, ordered,
`source='form_answer'`, `sourceKey=<field_key>`, `operator='equals'`,
`value=<option value>`, `nextStageKey=<destination>`. Any number of them.

**Q6 — no match.** Two-layer answer, following Make's If/Else "one else route"
requirement rather than n8n's "discard by default":

- *Build time:* a step that carries conditional routes must have a fallback —
  either an `operator='default'` route or a `defaultNextStageKey`. Publishing
  without one is rejected in `validateFmsDefinition` **and** in
  `assert_fms_flow_publishable`.
- *Run time:* if a routed step still matches nothing and has no fallback (an
  older flow published before this rule), the instance is **not** completed. It
  is put `on_hold` with a `route_unmatched` stage log, an audit row, and a
  notification to the person who started it. The workflow stops visibly and can
  be resumed after the template is fixed. Never silent.

**Q7 — renames.** Nothing breaks: renaming a question changes `field_name`,
renaming an option changes `label`, renaming a step changes `name` — routes
match on `field_key`, option `value`, and `stage_key`. The route's own `label`
is cosmetic and defaults to the option's label at render time.

**Q8 — deletions.** Detected, never silently mis-routed. The builder already
raises `route_field_missing` / `route_value_missing`; this design adds the same
option check to the database publish gate so it cannot be bypassed, and shows
the offending route inline in the editor rather than only in the readiness bar.

**Q11 — form versioning.** Keep **version pinning for execution** and add
**family awareness for authoring**. A stage pins an exact `form_template_id`, so
a running instance's questions, options and answers can never change underneath
it; that is the correct guarantee for a submitted record. But the builder must
stop treating "not currently published" as "unknowable": it will load fields for
every template a stage references, published or archived, and — because
`create_form_revision_with_audit` copies `field_key` verbatim — offer a
one-click re-pin to the family's newest published version that keeps the routes
intact. Options sourced from Dropdown Master stay live and need no revision at
all, which is the path the acceptance test "add a new option" should use.

**Q12 — fallback route.** As Q6. Safest deterministic behaviour is *stop
visibly*, not *route to an arbitrary node* and not *end the instance*.

**Q13 — reconnection.** Already supported and kept: several routes may name the
same `nextStageKey`; `fmsGraphEdges` draws several incoming edges; and
`activate_fms_stage_internal` returns the existing instance stage instead of
inserting a second one, so a converged Final Follow-up produces exactly one
task. No Merge node, no duplicated downstream nodes.

**Execution semantics.** Mutually exclusive, first-match-wins, exactly one
successor — n8n's `Switch` with "send to all matching outputs" off, and Make's
If/Else. Fan-out remains the explicit, separate `parallel_start` node.

**Template vs execution.** Unchanged and preserved: `fms_flows`/`fms_stages`/
`fms_branch_rules` are the template; `fms_instances`/`fms_instance_stages` are
the execution. The next step is resolved and persisted by
`complete_fms_stage_with_audit` inside the same transaction as the completion —
never computed in the browser. Execution state after this change records the
instance, the completed stage, the form submission, **the branch rule that won**
(`branch_rule_id`), the activated next stage, and its task.

## 4. Implementation plan

1. **Core** (`packages/core/src/fms`): require a fallback on a routed step
   (`route_without_fallback`); carry option labels on `FmsFormFieldRef`; make
   `fmsRouteLabel` render question and option labels.
2. **Migration** (`supabase/migrations/0142_…`): fallback requirement and stale
   option check in `assert_fms_flow_publishable`; record `branch_rule_id` and
   hold the instance on an unmatched route in `complete_fms_stage_with_audit`
   and `fms_stage_route_target`; array-aware answer matching in
   `fms_rule_matches` for multi-select.
3. **Web** (`apps/web/src/features/fms`): load fields and names for referenced
   archived form versions; show option labels in the Answer selector and on the
   canvas; surface a "newer version of this Form is published" re-pin action;
   parse `in` values back into arrays on load; state "No branchable fields
   available in this form." when the linked form offers none.
4. **Tests**: core unit tests for the fallback rule, option labels and the `in`
   round trip; pgTAP for the publish gate and the unmatched-route hold.

## 5. Deliberate behaviour changes on live data

- A step that routes on its own linked Form's answers now requires that form to
  be submitted before it can be completed. Routing has nothing to read without
  it, and the old path silently took the fallback. Steps with an optional but
  unrouted form are unaffected.
- Publishing a workflow whose routed step has no Otherwise destination is now
  refused. Already-published flows keep running; if one of them hits an
  unmatched answer the instance goes `on_hold` rather than `completed`, and the
  starter is notified to add the missing route and resume.
- Nothing is rewritten: no migration touches existing rows, and a step with no
  routes behaves exactly as it always has.
