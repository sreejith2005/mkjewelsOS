# Native FMS Canvas Stability Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make FMS graph building stable and usable on phone-sized native and compact web screens without changing the persisted FMS definition contract.

**Architecture:** Extract deterministic viewport and node-position math into `@jewelos/core`, then replace React-state-per-pointer-move native gestures with Gesture Handler and Reanimated shared values. Keep SVG contents valid, separate the canvas gesture surface from parent scrolling, and commit positions to React state only when a gesture ends. Apply only targeted compact-web containment changes to the existing web builder.

**Tech Stack:** TypeScript, React Native 0.86, React Native Gesture Handler, Reanimated 4, react-native-svg, React/Vite, Vitest.

**Dependency:** Begin after the FMS assigned-work contract plan. Preserve the existing dirty/untracked native builder work; inspect each listed file before patching and stage named paths only.

---

### Task 1: Extract and test canvas geometry

**Files:**
- Create: `packages/core/src/fms/canvas.ts`
- Create: `packages/core/src/fms/canvas.test.ts`
- Modify: `packages/core/src/fms/index.ts`

- [ ] **Step 1: Write failing tests for bounded zoom, focal anchoring, and committed node movement**

```ts
expect(clampFmsZoom(0.2)).toBe(0.5);
expect(clampFmsZoom(2.8)).toBe(2);
expect(zoomFmsViewport({ x: 40, y: 60, zoom: 1 }, { x: 100, y: 120 }, 1.5))
  .toEqual({ x: 10, y: 30, zoom: 1.5 });
expect(moveFmsNode({ x: 80, y: 120 }, { x: 32, y: -16 }, 1.6))
  .toEqual({ x: 100, y: 110 });
```

Also test fit-to-content padding, zero-node behavior, and deletion/reconnection helpers retaining their existing graph semantics.

- [ ] **Step 2: Run the test and confirm the module is missing**

Run: `pnpm.cmd --filter @jewelos/core test -- src/fms/canvas.test.ts`

- [ ] **Step 3: Implement pure finite-number geometry functions**

Reject NaN/infinite inputs, clamp zoom to `[0.5, 2]`, and return new objects without mutating definitions.

- [ ] **Step 4: Run focused and existing FMS core tests**

Run: `pnpm.cmd --filter @jewelos/core test -- src/fms/canvas.test.ts src/fms/fms.test.ts`

- [ ] **Step 5: Commit the core geometry files**

```powershell
git add packages/core/src/fms/canvas.ts packages/core/src/fms/canvas.test.ts packages/core/src/fms/index.ts
git diff --cached --check
git commit -m "refactor: centralize FMS canvas geometry"
```

### Task 2: Replace the native PanResponder canvas with UI-thread gestures

**Files:**
- Modify: `apps/mobile/src/features/fms/FmsGraphCanvas.tsx`
- Create: `apps/mobile/src/features/fms/FmsGraphCanvas.test.tsx`
- Modify: `apps/mobile/src/screens/FmsBuilderScreen.tsx`
- Modify: `apps/mobile/src/ui/Screen.tsx`

- [ ] **Step 1: Write failing component-contract tests**

Render a two-stage definition and assert both nodes, the edge layer, fit/reset controls, selection, duplicate/delete affordances, and the accessibility labels for pan/zoom instructions. Assert `onMove` fires once with committed positions after a simulated gesture-end callback, not on every update.

- [ ] **Step 2: Run the focused native test and capture the current render/interaction failure**

Run: `npm --prefix apps/mobile test -- src/features/fms/FmsGraphCanvas.test.tsx`

- [ ] **Step 3: Rebuild gesture ownership narrowly**

Use `GestureDetector` with composed pan and pinch gestures. Store transient `translateX`, `translateY`, `scale`, and active-node offsets in Reanimated shared values. Use `runOnJS` only on gesture end for node-position persistence and selection callbacks. Disable viewport pan while a node drag is active.

- [ ] **Step 4: Correct SVG structure**

Replace every React Native `<View>` nested under `<Svg>` with `react-native-svg` `<G>` or another SVG primitive. Keep HTML/native controls outside the SVG tree. Ensure edges have `pointerEvents="none"` and nodes remain the hit targets.

- [ ] **Step 5: Remove the nested-scroll conflict**

Extend `Screen` with an explicit `scroll={false}` use path if needed, and make `FmsBuilderScreen` own a fixed-height canvas region plus separately scrolling stage editor/list. Do not disable scrolling globally or change unrelated screens.

- [ ] **Step 6: Run focused tests, full mobile tests, and typecheck**

```powershell
npm --prefix apps/mobile test -- src/features/fms/FmsGraphCanvas.test.tsx
npm --prefix apps/mobile test
npm --prefix apps/mobile run typecheck
```

- [ ] **Step 7: Commit named native files**

```powershell
git add apps/mobile/src/features/fms/FmsGraphCanvas.tsx apps/mobile/src/features/fms/FmsGraphCanvas.test.tsx apps/mobile/src/screens/FmsBuilderScreen.tsx apps/mobile/src/ui/Screen.tsx
git diff --cached --check
git commit -m "fix: stabilize native FMS canvas gestures"
```

### Task 3: Contain the compact web FMS builder

**Files:**
- Modify: `apps/web/src/features/fms/FmsFlowBuilder.tsx`
- Modify: `apps/web/src/features/fms/FmsGraphCanvas.tsx`
- Modify: `apps/web/src/features/fms/FmsFlowBuilder.test.tsx`
- Modify: `apps/web/src/index.css`

- [ ] **Step 1: Add failing compact-layout assertions**

Assert the block palette becomes horizontally scrollable below `xl`, the canvas has a bounded minimum height without forcing page-width overflow, inspector controls wrap, and all icon controls have accessible names.

- [ ] **Step 2: Run the focused test**

Run: `pnpm.cmd --filter web test -- src/features/fms/FmsFlowBuilder.test.tsx`

- [ ] **Step 3: Apply token-based containment styles only**

Keep the desktop graph behavior and builder data model unchanged. Use existing semantic classes/tokens, `min-w-0`, bounded `overflow`, touch-sized controls, and compact breakpoints already used elsewhere in the app.

- [ ] **Step 4: Run the focused test and web typecheck**

```powershell
pnpm.cmd --filter web test -- src/features/fms/FmsFlowBuilder.test.tsx
pnpm.cmd --filter web typecheck
```

- [ ] **Step 5: Commit the compact web change**

```powershell
git add apps/web/src/features/fms/FmsFlowBuilder.tsx apps/web/src/features/fms/FmsGraphCanvas.tsx apps/web/src/features/fms/FmsFlowBuilder.test.tsx apps/web/src/index.css
git diff --cached --check
git commit -m "fix: contain FMS builder on compact screens"
```

### Task 4: Verify real touch behavior and regression safety

**Files:**
- Modify: `docs/MOBILE_HANDOFF.md`
- Modify: `docs/MOBILE_PARITY_PLAYBOOK.md`

- [ ] **Step 1: Run automated gates**

```powershell
pnpm.cmd --filter @jewelos/core test
pnpm.cmd --filter web test
npm --prefix apps/mobile test
pnpm.cmd exec turbo run typecheck --force --concurrency=1
pnpm.cmd exec turbo run build --force --concurrency=1
git diff --check
```

- [ ] **Step 2: Perform Android gesture QA**

On a phone-sized emulator/device verify: one-finger viewport pan, node drag, pinch zoom around the fingers, select without accidental drag, connect/reconnect, delete, duplicate, fit, reset, stage-editor scrolling, rotation, background/resume, and no ANR/crash in logs.

- [ ] **Step 3: Perform compact browser QA**

At 320, 375, 390, and 768 CSS pixels verify no document-level horizontal scroll, palette and canvas remain usable, keyboard focus is visible, and desktop behavior is unchanged.

- [ ] **Step 4: Record only observed evidence and commit documentation**

```powershell
git add docs/MOBILE_HANDOFF.md docs/MOBILE_PARITY_PLAYBOOK.md
git diff --cached --check
git commit -m "docs: record FMS canvas validation"
```

