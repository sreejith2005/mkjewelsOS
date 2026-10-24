# FMS Builder 3.0: canvas editing, inline questionnaires, import/export (2026-10-24)

Builds on `2026-10-23-fms-form-sections-canvas-design.md` (0345, live). Web and
shared-package change only: **no migration, no Edge Function, no new RPC.**
Every write goes through the existing audited contracts.

## Canvas (`apps/web/src/features/fms/FmsGraphCanvas.tsx`)

- Modes: **Select** (desktop default; empty-space drag = rectangle select,
  touching or inside) and **Hand** (phone default; empty-space drag = pan).
  Space+drag and middle-drag pan in either mode. Wheel/pinch zoom unchanged.
- Selection is owned by the builder (`selectedKeys`) so clipboard and bulk
  actions share it. Click opens the inspector; Shift/Ctrl/Cmd+click toggles;
  touch long-press (450 ms) adds; Esc / empty click clears.
- Dragging a selected step moves the group; moves are applied once per
  animation frame and committed once on release (one undo step). Cards are
  memoised; handlers are read through a ref.
- Routes: invisible hit line of a constant 10 screen px; selecting highlights
  only that path (others dimmed) and shows a compact bar: Edit route (opens the
  source step's inspector at that `data-route-id`), Change destination (click
  the new step), Route details, Delete route. The old bottom card and hover ×
  are gone. Deletion removes exactly the route with that id, or the plain next
  step — never a sibling route to the same step.
- Bulk bar (2+ selected; 1 on a phone in Select mode) and right-click menu:
  Copy, Duplicate, Cut, Delete, Clear / Paste here, Select all, Fit.
- Shortcuts are document-level but act only when focus is on the canvas or the
  page body (`shortcuts.ts`): never in inputs, selects, contenteditable, the
  inspector or any `aria-modal` dialog. Paste reads the browser `paste` event
  (no permission prompt) with a same-tab fallback.
- One-time gesture tip (`localStorage`, wrapped in try/catch).

## Copy, paste, import, export (`packages/core/src/fms/transfer.ts`)

- Formats `mkjewels.fms.fragment` and `mkjewels.fms.workflow`, version 1.
  Stage definitions only; workflow export drops id/family/version/lifecycle and
  tenant scope. A questionnaire draft id never travels.
- `parseFmsTransfer` is a strict field-by-field parser: unknown fields, unknown
  stage types (incl. legacy `end`), duplicate keys/route ids, >200 steps or
  >1 MB are refused with a readable message; n8n files are named and refused.
- `pasteFmsFragment`: fresh `stage_N` keys and route UUIDs; remaps next step,
  routes, parallel/join lists, timing trigger, legacy decision condition,
  assignment sources (incl. `routeRuleId`) and task-display sources. Links to
  steps outside the copy are cut (a route keeps its condition with no
  destination so validation asks for one) — never pointed at an unrelated step.
  Forms not in the destination's published list, inactive people and unknown
  flows are removed and reported (`describeFmsPasteReport`). Pasting into an
  empty workflow without a Form first adds a Start form.
- `removeFmsStages` (multi-delete) never rewires; single-step delete keeps its
  historical join-the-neighbours behaviour. The Start form cannot be deleted or
  duplicated; it can be copied to another workflow.
- Clipboard: system clipboard where allowed, plus same-tab memory/sessionStorage
  (`clipboard.ts`), so copy in workflow A and paste in B works in one tab.
- Server boundary unchanged: `save_fms_flow_draft_with_audit` authorizes the
  save; `assert_fms_flow_publishable` refuses Forms that are not active
  published versions of the tenant, and assignment checks refuse foreign users.

## Unified step

New manual steps carry `decisionMode: "normal"` and `deadlineEnabled: false`;
there is no Normal/Decision choice and ordinary cards show no type badge. Legacy
decision steps keep `decisionOptions` (editable under Routing → Outcome
choices), outcome routes and "Run this step only if". No conversion is done.
The shared `fmsStageTemplate` is unchanged so the deployed `fms-ai` function and
the browser keep compiling identical proposals.

## Inline questionnaires

- A step questionnaire is a real Form, edited by the Forms Library
  `FormBuilder` hosted in `FmsQuestionnaireStudio` (full-height overlay over
  the canvas; nothing navigates away).
- Persistence (`questionnaire.ts`) uses only existing audited RPCs:
  `save_form_draft_with_audit`, `create_form_revision_with_audit`,
  `duplicate_form_with_audit`, `publish_form_with_audit`,
  `set_form_library_visibility_with_audit` (new stage forms are hidden from the
  staff library), `delete_form_with_audit` (discard draft).
- Builder-only metadata `sla.questionnaire = { origin: "stage" | "copied",
  draftFormId? }` lives in the existing stage document
  (`planned_time_rule`), normalised by core and excluded from the AI
  fingerprint. The runtime never reads it.
- Target of an edit: none linked → new Form; `origin: "stage"` → next version
  of that family; a Forms Library form or a copied/pasted step → a private copy
  (only its linked section), so other stages/workflows never change.
- Save draft attaches `draftFormId` and saves the workflow draft immediately
  (survives reload, no orphan). Use in workflow publishes the draft, pins its id
  as `formTemplateId`, clears the section key and reloads question data so
  routes can use it. A pending draft is the publish-readiness issue
  `questionnaire_draft_pending`. Published versions are never rewritten;
  running instances keep their pinned version.
- Import section (`packages/core/src/forms/sectionImport.ts`): copies one
  section with collision-free keys, keeps in-section visibility rules, drops
  and warns about rules reading other sections and about cross-section jumps.
  Link section keeps the 0345 pinned-section behaviour.

## Live preview

`FormBuilder` shows `FormRenderer` (preview mode) beside the editor at ≥1024 px
(55/45), with Desktop/Mobile frame, Reset, Hide/Show; phones switch Edit ↔
Preview over the same state. `reconcileFormPreviewAnswers` drops sample answers
the edited form can no longer hold. Applies to Forms Library and the studio.

## Removed

Guided Mode and the phone Steps list (`FmsStepList.tsx`), the leave-the-builder
Forms workspace (`FmsFormAuthoring.tsx`). Runtime screens are untouched.

## Known limits

- Quick inline question editing happens in the studio overlay, not inside the
  narrow inspector (one editor surface).
- Inline questionnaire creation needs `forms.manage`; an `fms.manage`-only
  author sees hidden stage questionnaires as unavailable.
- "Import from existing FMS" merges into the open draft; it does not create a
  separate new workflow record.
- No n8n converter. Browser/device checks beyond jsdom were not run here.
