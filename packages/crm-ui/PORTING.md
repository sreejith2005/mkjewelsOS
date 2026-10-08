# @jewelos/crm-ui: port of the original CRM web UI

This package is the original MK Jewels CRM web UI (`sreejith-crm/web-app`, Next.js 16 /
React 19 / Tailwind 4), ported into JewelOS (React 18.3 / Vite) and rendered by the web app
at `/crm` and `/crm/*`. Parity with the original is the acceptance criterion (AGENTS.md, "CRM
(2026-09-25 owner decision)"; design `docs/superpowers/specs/2026-09-25-crm-native-integration-design.md`).

## Rules for this package

- `src/app`, `src/components`, `src/lib` and `tests` are copies of the original files at the
  same relative paths. Only the edits listed below are allowed. Each one is marked in the source
  with a `crm-port:` comment. Do not improve, rename, re-order or restyle anything.
- `src/next-shim` and `src/crm-port` are port-only infrastructure: Next.js stand-ins and JewelOS
  hosting.
- `src/app/globals.css` is the original stylesheet, verbatim. `src/styles/crm.generated.css` is
  generated from it by `scripts/build-css.mjs` (`pnpm.cmd --filter @jewelos/crm-ui build:css`).
  `build` and `test` fail if the committed file is stale or not scoped.
- The sources compile with the original compiler options (`tsconfig.json`). The web app
  type-checks only `src/public-api.d.ts`, and `src/crm-port/public-api.check.ts` keeps that
  file in step with the real exports.

To compare a file with the original: `git diff --no-index sreejith-crm/web-app/<path> packages/crm-ui/src/<path>`.

## Edits to original files

| Kind | Where | Edit |
| --- | --- | --- |
| a. Next shims | every `next/navigation`, `next/link`, `next/image` import | Imports `@/next-shim/navigation`, `@/next-shim/link` or `@/next-shim/image` instead. Paths stay the original app paths; the shims add the `/crm` base path the way Next's `basePath` did. |
| b. Server pages | `app/(crm)/**/page.tsx`, `app/page.tsx` | Unchanged async page functions: the same queries in the same order, with the same selects, filters and ordering. `crm-port/app-router.tsx` calls them the way Next calls a server page and renders the result. `lib/supabase/server.ts` returns the signed-in JewelOS client for schema `crm`. |
| b. Root layout | `app/layout.tsx` | `<html><body>` becomes the CRM root element (`crm-port/document.tsx`). `import "./globals.css"` becomes the generated, scoped stylesheet, which is attached only while the CRM is mounted. The Next `Metadata` type becomes a plain object. The title is still "MK Jewels CRM". |
| c. CRM user id | allocation, clients, clients/[clientId], clients/new, leads/new, queue, visits/new pages; `components/post-call-inbox.tsx` | `auth.getUser()`, where `.id` was used as the CRM user id, becomes `getCrmUser(...)` (`crm-port/crm-user.ts`), which reads `rpc("current_crm_user_id")` and keeps the `{ data: { user } }` shape. The followups and referrals pages only check the signed-in user and its email, so they are unchanged. |
| c. Storage bucket | `components/walk-in-form.tsx` (2 calls) | `crm-documents` becomes `crm-legacy-documents` (0187). |
| d. Sign-out | `app/actions.ts`; `components/crm-shell.tsx` form | The server action signs out of JewelOS. The `<form action={signOut}>` (a React 19 function action) becomes an `onSubmit` handler. |
| d. Login | `app/(crm)/layout.tsx` | `redirect("/login")`: no session goes to the JewelOS login; no CRM profile shows "No CRM access" (`crm-port/access.tsx`). The original `/login` and `/auth/jewelos*` routes are not ported. A signed-in visitor to `/crm/login` is sent to `/`, as the original `proxy.ts` did. |
| e. Server routes | `components/lead-form.tsx` | `fetch("/api/leads/<id>/runo")` becomes `pushLeadToRuno()` (`crm-port/phase4.ts`), which invokes the `crm-runo-push` Edge Function with the caller's JewelOS JWT and the lead id in the body. `ok` is still the route's HTTP ok, so the form shows its own original messages ("Lead saved and pushed to Runo." / "Lead saved locally. Runo sync not yet configured."). `/api/ingest/walkin` has no UI caller; it is the `crm-walkin-ingest` Edge Function. |
| f. Deterministic order (D5) | clients, clients/[clientId], dashboard, followups, leads/new, queue, referrals, visits/new pages (11 edits) | A primary-key tie-breaker in the same direction is added after every `.order(...)` that can tie (`.order("id", ...)`), marked `crm-port: deterministic order`. The list is `scripts/crm-parity/deterministic-order.mjs`; the parity harness applies the same list to the original at run time. |
| Addition | `components/crm-shell.tsx` | The one JewelOS addition: a "← JewelOS" entry in the menu (`crm-port/jewelos-home-link.tsx`, `data-crm-port`). |
| Types only | `lib/supabase/database.types.ts`, `lib/supabase/client.ts` | `Database["public"]` is the generated JewelOS `crm` schema type. `manage_crm_roster` keeps the original nullable optional args. `createClient()` returns the JewelOS client for schema `crm`: `from`/`rpc` go to schema `crm`, `storage`/`auth` stay on the JewelOS session. |
| Tests | `tests/*.test.tsx` | `vi.mock("next/navigation" / "next/link")` becomes the shim module. Assertions are unchanged. |

Port infrastructure (no original counterpart):

- `crm-port/provisioning.ts`: the root loader (`app-router.tsx`) calls `rpc("ensure_my_crm_user")`
  (migration 0191, D2) once per mount before the layout and page loaders; the result is ignored.
- `CrmApp`'s optional `auth` prop (`CrmAuth`) replaces `supabase.auth` for the ported code. Only
  the web app's embedded mode (the JewelOS Android app's WebView) passes it: its client is fed by
  the native access token and has no auth client of its own.

Not ported: `app/login`, `app/auth/jewelos`, `app/api/ingest/walkin` and
`app/api/leads/[leadId]/runo` (both are Edge Functions: `crm-walkin-ingest`, `crm-runo-push`), `lib/prisma.ts`, `lib/sso/*`,
`lib/legacy-walkin-ingest.ts` (copied into `supabase/functions/crm-walkin-ingest`), `lib/supabase/{env,proxy}.ts` and `proxy.ts`.
Declared in the original `package.json` but not used by its source, so not added:
`react-hook-form`, `@hookform/resolvers`.

## Styling and isolation (`scripts/build-css.mjs`)

The original `globals.css` is compiled with Tailwind 4.3.3, the original version. Then:

1. The Tailwind cascade layers are flattened in order, and layer precedence is kept with id
   tiers: base 1, components 2, utilities 3, the original unlayered rules 4. Each tier adds one
   more `#crm-root` to the selector. Without this, the unlayered JewelOS Tailwind 3 stylesheet
   would override every layered CRM rule.
2. Every selector is scoped to `.crm-root#crm-root…`. `html`, `body`, `:root` and `:host`
   become the root element itself, so preflight and the CSS variables apply only inside the CRM.
3. `@property` registrations, which are global, are replaced by the same initial values set
   inside the root.
4. Inside the root, JewelOS element rules are reverted to browser defaults before any CRM rule
   applies (`all: revert`; SVG is left alone). The root itself starts from `all: initial`
   instead of inheriting the JewelOS body.

The fonts are the original `@import` of Google Fonts (Jost, Playfair Display). JewelOS has no
CSP that blocks it. Both families are overridden by the original's later Calibri rules, so
neither app renders them.

## Phone layout (owner request 2026-10-07)

The owner asked for the CRM to be fully usable on phones (readable, no sideways dragging, easy
forms). This is an approved exception to visual parity **at phone width only** (below 768px);
tablets and desktops render exactly as the original. No original file is edited:

- `crm-port/mobile.css` holds every phone rule, all inside `max-width` media queries (a test
  enforces this). `CrmDocument` appends it to the same `<style data-crm-ui>` element, with its
  `#crm-mobile` placeholder replaced by a scope one id stronger than tier 4, so it adjusts the
  original rules without editing `globals.css`.
- `crm-port/mobile-tables.ts` copies each column heading of a list with four or more columns into
  `data-label` on its cells (and marks it `data-crm-cards`), re-run when rows change. On a phone
  each row is then a labelled card instead of a 900–2200px wide table; the last column (actions
  and the inline follow-up forms) spans the card.
- Also at phone width: 16px text in every field (stops the iPhone zoom on focus), larger
  checkboxes and touch targets, a two-line top bar, a full-height menu drawer that is fully off
  screen when closed, a swipeable section strip and a pinned submit button on the walk-in visit
  form, a two-column dashboard summary, and larger profile text.

Because of this, the parity harness's 390×844 text and screenshot comparison now differs from
the original by design (see also the tablet and desktop layout below).

## Tablet and desktop layout (owner request 2026-10-08)

The owner reported that the lists used only a 1400px column in the middle of a wide screen, and
that the end of a row (the OPEN PROFILE / FOLLOW UP FORM / VIEW HISTORY buttons) could only be
reached by scrolling to the bottom of a long list for its sideways scroll bar. This is an
approved exception to visual parity **at 768px and wider**; phones keep the card layout above.

- `crm-port/wide.css` holds every rule, all inside `min-width` media queries of at least 768px (a
  test enforces this). `CrmDocument` appends it after the phone rules with the same scope (its
  `#crm-wide` placeholder).
- Pages (and the walk-in form and client profile) use the full window width.
- A list with four or more columns scrolls inside a box no taller than the window, so its
  sideways scroll bar is always on screen, and its headings stay in view while scrolling down.
- Columns size to the available width with a 6rem minimum (10rem for remark columns) instead of
  the original fixed 640-2200px widths; on a 1920px screen the follow-up list fits without
  sideways scrolling.
- When the last heading is "Action", `mobile-tables.ts` marks the list `data-crm-actions` and
  that column stays pinned to the right edge, with compact buttons.

The parity harness's 1440×900 comparison therefore also differs from the original by design.

Tailwind scans `src/` for class names, so the bare lower-case element name of a data table,
written anywhere in `src/` (code or comments), generates an unused utility and makes
`build-css.mjs --check` fail. `mobile-tables.ts` explains how it avoids that.

## Runtime notes

- React 18.3: the original uses no React 19-only API except the server-action form (edit d).
  `Object.groupBy`/`toSorted` (lead form) are ES2023/2024 browser APIs, not React APIs.
- The call button and post-call inbox load `@capacitor/core` as the original does. In a browser
  `Capacitor.isNativePlatform()` is false, so the call button uses its `tel:` fallback and the
  inbox stays hidden.
- The original uses no Supabase Realtime.
