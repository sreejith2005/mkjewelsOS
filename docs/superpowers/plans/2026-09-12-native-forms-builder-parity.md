# Native Forms Builder Parity Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide a complete, phone-usable Forms Builder on native while keeping web and native authoring on the same validated form-definition and persistence contracts.

**Architecture:** First extract remaining builder mutations from the large web component into pure `@jewelos/core` functions and switch web to them. Then add a native builder route composed of a virtualized outline, one field-editor sheet, preview, and routing overview; persist through the existing audited form APIs in `@jewelos/data`. No form schema, RLS, or RPC change is expected.

**Tech Stack:** TypeScript, `@jewelos/core`, `@jewelos/data`, React 18/Vite, Expo/React Native, React Navigation, Vitest.

**Dependency:** Begin after the assigned-work and canvas plans. Preserve the current shared field-type/guided-condition/routing-map moves already present in the dirty worktree and build on them rather than restoring deleted web copies.

---

### Task 1: Centralize deterministic form-builder mutations

**Files:**
- Create: `packages/core/src/forms/builder.ts`
- Create: `packages/core/src/forms/builder.test.ts`
- Modify: `packages/core/src/forms/index.ts`
- Modify: `apps/web/src/features/forms/FormBuilder.tsx`
- Modify: `apps/web/src/features/forms/forms.test.tsx`

- [ ] **Step 1: Write failing pure-model tests**

Cover field keys, insert/update/remove/move, section add/rename/remove, option normalization, and preservation of routing/visibility references. Representative API:

```ts
const first = createFormField("text", []);
expect(first.key).toBe("field_1");

const moved = moveFormField(definition, "field_3", { before: "field_1" });
expect(moved.fields.map((field) => field.key)).toEqual(["field_3", "field_1", "field_2"]);

const removed = removeFormField(definition, "field_2");
expect(findDanglingFormReferences(removed)).toEqual([]);
```

Also prove immutable returns and preserve the current web behavior for referenced-field deletion by surfacing an explicit issue instead of silently corrupting conditions.

- [ ] **Step 2: Run focused core tests and confirm missing exports**

Run: `pnpm.cmd --filter @jewelos/core test -- src/forms/builder.test.ts`

- [ ] **Step 3: Implement pure functions and export them**

Use existing `FormDefinition`, field-type, sections, visibility, and guided-condition types. Do not add a parallel form model.

- [ ] **Step 4: Replace web-local mutations with core calls**

Keep web markup and behavior stable. Remove `nextFormFieldKey` and equivalent local mutation helpers only after their tests target the core implementation.

- [ ] **Step 5: Run core and full web form tests**

```powershell
pnpm.cmd --filter @jewelos/core test -- src/forms/builder.test.ts src/forms/forms.test.ts src/forms/rules.test.ts src/forms/sections.test.ts
pnpm.cmd --filter web test -- src/features/forms/forms.test.tsx src/features/forms/visibility.test.tsx
```

- [ ] **Step 6: Commit the shared builder model**

```powershell
git add packages/core/src/forms/builder.ts packages/core/src/forms/builder.test.ts packages/core/src/forms/index.ts apps/web/src/features/forms/FormBuilder.tsx apps/web/src/features/forms/forms.test.tsx
git diff --cached --check
git commit -m "refactor: share form builder mutations"
```

### Task 2: Add the typed native builder route and load/save lifecycle

**Files:**
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/screens/FormsLibraryScreen.tsx`
- Create: `apps/mobile/src/screens/FormBuilderScreen.tsx`
- Create: `apps/mobile/src/features/forms/formBuilderController.ts`
- Create: `apps/mobile/src/features/forms/formBuilderController.test.ts`
- Modify: `packages/data/src/forms/api.ts`
- Modify: `packages/data/src/forms/api.test.ts`

- [ ] **Step 1: Write failing controller/API tests**

Define typed route params:

```ts
FormBuilder: { formTemplateId?: string } | undefined;
```

Test a new draft, loading a selected bundle by ID, save-draft, publish-as-new for an existing published form, and retry after an API error. Verify every save delegates to existing audited `saveDraft`, `savePublishedForm`, or `publishAsNewForm` data functions rather than direct table writes.

- [ ] **Step 2: Run focused tests and observe missing controller/route failures**

```powershell
npm --prefix apps/mobile test -- src/features/forms/formBuilderController.test.ts
pnpm.cmd --filter @jewelos/data test -- src/forms/api.test.ts
```

- [ ] **Step 3: Add a narrow bundle loader if the data API lacks one**

Reuse `loadForms()` and return an authorized bundle by template ID; throw a typed not-found error rather than creating a blank replacement. Do not infer a form from its name or from an FMS flow.

- [ ] **Step 4: Wire New/Edit actions and unsaved-change protection**

Use the existing native unsaved guard. Back/close prompts only when the builder differs from its last saved snapshot. Published templates use revision/publish-as-new semantics already enforced by the API.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
npm --prefix apps/mobile test -- src/features/forms/formBuilderController.test.ts
npm --prefix apps/mobile run typecheck
```

- [ ] **Step 6: Commit route, lifecycle, and API changes**

```powershell
git add apps/mobile/src/navigation/types.ts apps/mobile/src/navigation/RootNavigator.tsx apps/mobile/src/screens/FormsLibraryScreen.tsx apps/mobile/src/screens/FormBuilderScreen.tsx apps/mobile/src/features/forms/formBuilderController.ts apps/mobile/src/features/forms/formBuilderController.test.ts packages/data/src/forms/api.ts packages/data/src/forms/api.test.ts
git diff --cached --check
git commit -m "feat: add native form builder lifecycle"
```

### Task 3: Build a virtualized outline and focused editor sheet

**Files:**
- Create: `apps/mobile/src/features/forms/FormBuilderOutline.tsx`
- Create: `apps/mobile/src/features/forms/FormBuilderOutline.test.tsx`
- Create: `apps/mobile/src/features/forms/FormFieldEditorSheet.tsx`
- Create: `apps/mobile/src/features/forms/FormFieldEditorSheet.test.tsx`
- Create: `apps/mobile/src/features/forms/FormBuilderHeader.tsx`
- Modify: `apps/mobile/src/screens/FormBuilderScreen.tsx`

- [ ] **Step 1: Write failing interaction tests**

Assert `FlatList` renders section headers and field rows, Add Field inserts after the selected field, move up/down respects section boundaries, duplicate creates a new stable key, delete confirms when referenced, and tapping a field opens one editor sheet. Assert all targets meet the existing touch-size token and have accessibility labels.

- [ ] **Step 2: Run the focused tests**

Run: `npm --prefix apps/mobile test -- src/features/forms/FormBuilderOutline.test.tsx src/features/forms/FormFieldEditorSheet.test.tsx`

- [ ] **Step 3: Implement the outline with stable item keys**

Use `FlatList`, memoized rows, and `field.key`/`section.key` identities. Keep only the selected key and editor visibility in screen state; do not mount an editor for every row.

- [ ] **Step 4: Implement essential field editing**

Support label, helper text, required flag, section, field type, placeholder, width, and type-specific scalar settings. Drive mutations through `@jewelos/core` functions.

- [ ] **Step 5: Implement compact header actions**

Provide Close, Preview, Save Draft, and Publish without a horizontally overflowing toolbar. Busy/error state must prevent duplicate submissions and retain unsaved edits on failure.

- [ ] **Step 6: Run tests and typecheck**

```powershell
npm --prefix apps/mobile test -- src/features/forms/FormBuilderOutline.test.tsx src/features/forms/FormFieldEditorSheet.test.tsx
npm --prefix apps/mobile run typecheck
```

- [ ] **Step 7: Commit the outline/editor slice**

```powershell
git add apps/mobile/src/features/forms/FormBuilderOutline.tsx apps/mobile/src/features/forms/FormBuilderOutline.test.tsx apps/mobile/src/features/forms/FormFieldEditorSheet.tsx apps/mobile/src/features/forms/FormFieldEditorSheet.test.tsx apps/mobile/src/features/forms/FormBuilderHeader.tsx apps/mobile/src/screens/FormBuilderScreen.tsx
git diff --cached --check
git commit -m "feat: build mobile form outline and editor"
```

### Task 4: Add options, dynamic sources, visibility, and routing parity

**Files:**
- Create: `apps/mobile/src/features/forms/FormOptionEditor.tsx`
- Create: `apps/mobile/src/features/forms/FormOptionEditor.test.tsx`
- Create: `apps/mobile/src/features/forms/FormConditionEditor.tsx`
- Create: `apps/mobile/src/features/forms/FormConditionEditor.test.tsx`
- Create: `apps/mobile/src/features/forms/FormRoutingOverview.tsx`
- Create: `apps/mobile/src/features/forms/FormRoutingOverview.test.tsx`
- Modify: `apps/mobile/src/features/forms/FormFieldEditorSheet.tsx`
- Modify: `apps/mobile/src/screens/FormBuilderScreen.tsx`

- [ ] **Step 1: Write failing parity tests**

Cover add/rename/reorder/delete choice options, static versus dynamic dropdown source, master/branch/department/user sources, visibility rule operators, nested guided conditions, route target/outcome editing, validation of missing targets, and preservation after save/reload.

- [ ] **Step 2: Run focused tests and confirm missing components**

Run: `npm --prefix apps/mobile test -- src/features/forms/FormOptionEditor.test.tsx src/features/forms/FormConditionEditor.test.tsx src/features/forms/FormRoutingOverview.test.tsx`

- [ ] **Step 3: Build option and condition editors from shared catalogs**

Consume `@jewelos/core/forms/fieldTypes`, `guidedConditions`, and existing dynamic option types. Keep selectors searchable and sheet-based; never render an unbounded option list inside the main outline.

- [ ] **Step 4: Add a routing overview rather than a second canvas**

Display source field/answer to destination mappings as a virtualized list, edit one route in a sheet, and surface dangling targets with the shared validation result. Do not introduce another graph implementation.

- [ ] **Step 5: Run focused tests, full mobile tests, and typecheck**

```powershell
npm --prefix apps/mobile test -- src/features/forms/FormOptionEditor.test.tsx src/features/forms/FormConditionEditor.test.tsx src/features/forms/FormRoutingOverview.test.tsx
npm --prefix apps/mobile test
npm --prefix apps/mobile run typecheck
```

- [ ] **Step 6: Commit advanced editors**

```powershell
git add apps/mobile/src/features/forms/FormOptionEditor.tsx apps/mobile/src/features/forms/FormOptionEditor.test.tsx apps/mobile/src/features/forms/FormConditionEditor.tsx apps/mobile/src/features/forms/FormConditionEditor.test.tsx apps/mobile/src/features/forms/FormRoutingOverview.tsx apps/mobile/src/features/forms/FormRoutingOverview.test.tsx apps/mobile/src/features/forms/FormFieldEditorSheet.tsx apps/mobile/src/screens/FormBuilderScreen.tsx
git diff --cached --check
git commit -m "feat: complete mobile form authoring controls"
```

### Task 5: Add preview and targeted compact-web fixes

**Files:**
- Create: `apps/mobile/src/features/forms/FormBuilderPreview.tsx`
- Create: `apps/mobile/src/features/forms/FormBuilderPreview.test.tsx`
- Modify: `apps/mobile/src/screens/FormBuilderScreen.tsx`
- Modify: `apps/web/src/features/forms/FormBuilder.tsx`
- Modify: `apps/web/src/features/forms/forms.test.tsx`
- Modify: `apps/web/src/index.css`

- [ ] **Step 1: Write failing preview and responsive tests**

Assert native preview uses the existing `FormRenderer` with the unsaved definition and dynamic options, does not submit to the backend, and can return to the same selected field. For web, assert the palette, field editor, routing controls, and footer actions remain within 320px without document-level horizontal overflow.

- [ ] **Step 2: Run the focused tests**

```powershell
npm --prefix apps/mobile test -- src/features/forms/FormBuilderPreview.test.tsx
pnpm.cmd --filter web test -- src/features/forms/forms.test.tsx
```

- [ ] **Step 3: Implement native preview and scoped web containment**

Reuse native `FormRenderer`; pass a no-write preview callback and show validation output before publish. For web, use existing semantic tokens and responsive utilities; preserve desktop layout and every current builder capability.

- [ ] **Step 4: Run focused suites and both typechecks**

```powershell
npm --prefix apps/mobile test -- src/features/forms/FormBuilderPreview.test.tsx
pnpm.cmd --filter web test -- src/features/forms/forms.test.tsx src/features/forms/visibility.test.tsx
npm --prefix apps/mobile run typecheck
pnpm.cmd --filter web typecheck
```

- [ ] **Step 5: Commit preview and responsiveness**

```powershell
git add apps/mobile/src/features/forms/FormBuilderPreview.tsx apps/mobile/src/features/forms/FormBuilderPreview.test.tsx apps/mobile/src/screens/FormBuilderScreen.tsx apps/web/src/features/forms/FormBuilder.tsx apps/web/src/features/forms/forms.test.tsx apps/web/src/index.css
git diff --cached --check
git commit -m "feat: add form builder preview and compact layout"
```

### Task 6: Verify authoring parity and record evidence

**Files:**
- Modify: `docs/MOBILE_HANDOFF.md`
- Modify: `docs/MOBILE_PARITY_PLAYBOOK.md`
- Modify: `docs/REGRESSION_CHECKLIST.md`

- [ ] **Step 1: Run complete automated gates**

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter @jewelos/data test
pnpm.cmd --filter web test
npm --prefix apps/mobile test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

- [ ] **Step 2: Perform authenticated Android authoring QA**

On a phone-sized device create a draft with every field family, sections, static/dynamic options, visibility, nested guided conditions, and routing; preview it; save; reopen; publish; duplicate/revise it; attach it to an FMS stage; and submit it through the assigned-work route. Verify keyboard avoidance, rotation, long-list scrolling, process death/reload, offline error recovery, and no ANR/crash.

- [ ] **Step 3: Perform compact and desktop web regression QA**

At 320, 375, 390, 768, and desktop widths, create/edit/preview/publish the same definition and compare the persisted definition JSON semantically. Verify no mobile fix removed a desktop control or altered an existing form submission.

- [ ] **Step 4: Record exact evidence and remaining limitations**

Keep automated, browser, device/APK, hosted Supabase, and deployment evidence separate. Do not label the mobile app production-ready unless release APK install, Metro-free launch, sign-in, and these authoring flows were observed.

- [ ] **Step 5: Commit documentation only**

```powershell
git add docs/MOBILE_HANDOFF.md docs/MOBILE_PARITY_PLAYBOOK.md docs/REGRESSION_CHECKLIST.md
git diff --cached --check
git commit -m "docs: record mobile forms builder parity"
```
