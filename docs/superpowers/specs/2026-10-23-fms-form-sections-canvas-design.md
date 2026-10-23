# FMS form sections and full-screen canvas (2026-10-23)

Two improvements to the existing FMS builder and runtime. Neither replaces the
FMS engine; both extend existing contracts.

## 1. A stage may link one Section of its Form

### Contract

- `FmsSlaRule.formSectionKey?: string` (`packages/core/src/fms/types.ts`). It is
  the stable `key` of one entry in the linked Form version's `sections`. Absent
  means **Entire Form**: every workflow published before this change.
- `FmsFormFieldRef` gains `sectionKey` (resolved like the database's
  `form_field_section_key`: an unknown section falls back to the first) and
  `dependsOn` (question keys its visibility rule reads).
- `FmsFormSectionRef = { key, title, questionCount }`, indexed per Form
  version in `FmsData.formSections` and `FmsValidationContext.formSections`.
- Shared helpers in `packages/core/src/fms/formSections.ts`:
  `fmsStageFormSectionKey`, `fmsStageFormFields` (the questions a stage really
  asks), `fmsStageFormDefinition` (the Form the doer fills),
  `fmsPlannedRuleFormSectionKey` (same, from a stored stage row),
  `fmsFormQuestionIndex` (DB rows -> questions + sections, used by both builder
  loaders) and `validateFmsFormSections` (publish readiness).
  `formDefinitionForSection` (`packages/core/src/forms/sections.ts`) reduces a
  Form to one section, drops its section navigation, and renumbers the
  questions so the result validates as a Form.

### Persistence decision

The key is stored in the stage's existing configuration document,
`fms_stages.planned_time_rule->>'formSectionKey'` (the builder's `sla`), not in a
new column. Draft save, revision copy and duplicate already carry that document
unchanged, and the existing "stage used by existing FMS work cannot be
redefined" guard compares it, so a published version and its running instances
cannot change behaviour. A new column would have required string-patching the
save, revision and publication functions. The server already reads other stage
settings (`assignment`, `assignmentFieldKey`) from the same document.

### Server enforcement (migration 0345)

- `fms_validate_candidate_form` is the single validator behind both the handoff
  preview and the final `submit_form_with_audit` (since 0263). For an
  `fms_stage` submission whose stage has a section it now:
  - checks that the section exists in the exact pinned Form version;
  - rejects any answer to a question outside the section (`22023`), so a forged
    request or a direct `submit_form_with_audit` call cannot write other
    sections;
  - validates required, type and option rules only for that section, with the
    section's own visibility conditions.
  Starter, standalone and task submissions are untouched and still validate the
  complete Form.
- `assert_fms_form_sections_publishable` (private, called by
  `assert_fms_flow_publishable`) refuses: a section on the starting Form; a
  section without a Form, missing from the pinned version, or without
  questions; a question in the section whose condition reads another section; a
  route on a question outside the section; a later step (owner, record name,
  work details, legacy assignment question) reading a question the section
  never asks.

### Cross-section conditions

The engine has no way to feed another stage's answers into a Form's visibility
rules, so a section whose questions depend on another section is not
publishable. The builder names the question and its dependency. Nothing is
invented or auto-filled.

### Scope limits

The starting Form always uses the entire Form: it is submitted through the
starter/entry RPCs, which keep validating the complete Form.

## 2. Full-screen canvas

- Desktop and tablet: the builder fills the workspace below the application
  header (`useFillViewportHeight` measures the real top edge). Compact toolbar:
  Back to FMS, name and save state, Canvas/Guided Mode, Undo, Redo, AI
  assistant, Check workflow, Simulate, Save draft, Publish.
- A 48px rail holds **Open workflow tools** and **Add Step**. The drawer
  (Building blocks, Process form, Default assignees) overlays the canvas,
  starts closed and closes with its Close button, Escape or an outside click.
- The step inspector and the FMS assistant overlay the right edge
  (`FmsAiPanel embedded`). One shows at a time: choosing a step shows the
  inspector, and the assistant stays mounted so its conversation returns when
  the inspector closes. Overlays never resize the canvas, so the camera never
  moves.
- Nothing is selected on entry. A new or duplicated step is selected and its
  inspector opens.
- Canvas Mode is the desktop default; Guided Mode remains. Phones keep the
  Steps/Map layout.

### Navigation

- `fmsWheelZoomFactor` (`packages/core/src/fms/canvas.ts`): wheel up zooms in,
  down zooms out, no modifier. Deltas are normalised (pixels/lines/pages,
  capped), and a trackpad pinch (Ctrl + wheel) gets more gain.
- The canvas keeps one camera state `{x, y, zoom}` and zooms with the existing
  `zoomFmsViewport`, so the world point under the pointer stays put. A native
  non-passive listener stops page scroll; events in one animation frame fold
  into one update. Inputs, selects, textareas and `[data-canvas-scroll]` keep
  their own scrolling.
- Dragging empty space pans (unchanged). Card drag, output-dot connect,
  reconnect, Shift marquee, keyboard zoom, zoom buttons, Fit and Auto-arrange
  are unchanged. The first fit waits until the canvas has a real size and
  never repeats, so drawers and the app sidebar never reset the camera.
  Transient pan/zoom is never saved.
