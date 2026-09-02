# Forms Builder Workspace Design

## Goal

Make the existing Forms Builder fast to scan and safe to edit at 30-50 questions without replacing its current draft, publish, response, FMS, permission, or audit contracts.

## Research synthesis

- Google Forms keeps insertion and question-type controls close to the selected question and maps choice answers to later sections or submission.
- Typeform combines a selected-question editor with an optional logic map that can navigate back to a question.
- Microsoft Forms restricts branches to forward destinations, matching JewelOS's existing acyclic section contract.
- Jotform separates ordinary question editing from advanced conditional settings.

JewelOS will combine those patterns without copying another product's branding or replacing the current dark obsidian, charcoal, champagne, and `#D9B875` gold system.

## Workspace

Desktop uses a narrow sticky outline and a flexible editor canvas. The outline lists sections and questions, marks the active question, shows counts, and jumps to a selected item. On small screens it becomes a compact section/question jump control above the canvas.

Only one question editor is mounted at a time. Inactive cards show title, type, required state, option preview, and routing/visibility indicators. The active card exposes the question and type first, applicable answer configuration next, and collapsible Routing and Advanced settings after that.

The fixed top Add Fields palette is removed. A labelled Add question control appears after the active card and at each section end. It opens an inline, keyboard-accessible type menu and inserts the new field at that exact location. Multi-select is absent from this menu.

## Field types and conversion

The active editor contains a field-type selector. Conversion preserves the field key, label, section, common flags, helper text, and compatible validation. Choice-to-choice conversion preserves stable option values. Converting between single-choice and Checkbox rewrites answer-routing predicates between `equals` and `contains`.

Converting away from an option-backed type removes options, option sources, per-answer branches, and dependent guided routes. The builder confirms only when that cleanup would discard configured data and reports what was cleared. Converting into an option-backed type initializes one valid, editable option. Divider and Heading expose only structural settings.

Historical `multiselect` remains load/render/edit compatible but is not available for new creation or as a conversion target. Historical optionless Checkbox fields retain boolean behavior. Newly authored Checkbox fields have options and store a unique array of selected stable option values.

## Checkbox routing semantics

Checkbox options use the same stable `{value,label}` identity and reorderable editor as Dropdown and Radio. Visibility/follow-up routes use `contains`, so multiple selected answers can reveal multiple applicable follow-up questions. Section/end branches are evaluated in authored option order; the first selected option with a custom section/end route wins. The UI explains this deterministic rule.

## Rating and respondent controls

Rating is a fixed 1-5 star radiogroup with hover, selected, focus, read-only, and keyboard arrow behavior. It stores an integer from 1 through 5. Checkbox renders a normal checkbox group, never a browser multi-select list. Divider remains a non-answer horizontal separator.

## Routing map

Routing map is optional and opens from the builder header. It shows Start, every section, every question in order, normal progression, conditional answer destinations, convergence back into the sequence, and End. Nodes are buttons that close the map, activate the corresponding question, and scroll it into view. The map uses lightweight React/SVG/CSS and no new graph dependency. Its mobile form is a vertically scrollable flow with the same text evidence as the visual connectors.

## Compatibility and server contract

No existing API name or lifecycle flow changes. Forward migrations extend draft normalization and submission validation so option-backed Checkbox fields accept arrays while legacy optionless Checkbox fields continue accepting booleans. Existing RLS, grants, SECURITY DEFINER checks, audit writes, pinned FMS versions, and file-upload work remain unchanged.

Deleting options, questions, or sections continues to prune dangling references. Type conversion uses the same cleanup path. Stable option values remain unchanged when labels are renamed.

## Verification

Use red-green tests for core validation/formatting, type conversion, renderer behavior, builder insertion/navigation, and the full routing model. Add pgTAP coverage for option-backed Checkbox save and submission plus legacy boolean compatibility. Then run focused core/web tests, typecheck, build, SQL tests when local Supabase is available, and signed-in desktop/mobile browser QA when a session is available.
