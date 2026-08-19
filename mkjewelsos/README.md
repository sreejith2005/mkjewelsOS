# JewelOS

A jewellery retail and manufacturing operations app for **MK Jewels** — showroom tasks, the customer book, workshop workflows, structured forms and reporting, all gated by role.

Built with React 18, Vite, Tailwind CSS, React Router and Recharts. No backend required to run it.

---

## Run it on your machine

You need **Node.js 18 or newer**. Check with `node -v`; if it's missing, install from [nodejs.org](https://nodejs.org).

```bash
# 1. open the folder in VS Code
code jewelos

# 2. in the VS Code terminal (Ctrl + `)
npm install
npm run dev
```

The browser opens at **http://localhost:5173**. Edits save and reload instantly.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Serves the built `dist/` locally at :4173 |

VS Code will offer to install the recommended extensions on first open. Take the Tailwind one — it gives you class autocomplete.

---

## What to try first

The app opens as **Priya Nair**, a sales associate. Open the sidebar (hamburger, top left) and scroll to **"View the app as"** to switch person. The menu, the bottom tab bar and page access all change with the role.

- Switch to **Imran Qureshi** (workshop) and the menu shrinks to four items — Reports disappears entirely. Try `/dashboard` in the address bar to see the access screen.
- Tap any task to open its checklist. Tick items, complete it, or delegate it — delegating moves the task to that person's list *and* creates a notification you'll see when you switch to them.
- **Customers → Ananya Desai → Log an interaction.** It appears in her timeline and, if you set today's date, on the Home follow-up panel.
- **Workflows → Custom order → delivery.** The branch step routes on order value: Meera Iyer's ₹11.8L run went to Director sign-off, Ananya's ₹4.25L didn't. Switch to **Sanket Mehta** and you can approve Meera's step.
- **Forms → Custom order brief.** Tick "customer is supplying their own gold" and a conditional field appears. Submit it empty to see validation jump to the first error.

---

## Deploy it live

Push to GitHub first:

```bash
git init
git add .
git commit -m "JewelOS"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/jewelos.git
git push -u origin main
```

### Vercel (easiest)

1. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
2. Vercel detects Vite on its own — leave the build settings alone.
3. Deploy. You get a live `.vercel.app` URL in about a minute.

`vercel.json` is already included so deep links like `/customers` don't 404 on refresh.

### Netlify

1. [app.netlify.com/start](https://app.netlify.com/start), pick the repo.
2. Build command `npm run build`, publish directory `dist`.

`netlify.toml` and `public/_redirects` handle the routing rewrite.

### Any static host

```bash
npm run build
```

Upload the contents of `dist/`. Configure the server to rewrite all paths to `/index.html`, or client-side routes will 404 on a hard refresh.

### Custom domain

On either host: Settings → Domains → add `app.mkjewels.in`, then create the CNAME record they show you at your DNS provider. HTTPS is issued automatically.

---

## How the code is laid out

```
src/
├── App.jsx                    routing, session state, every data mutation
├── main.jsx                   entry point
├── index.css                  Tailwind + base styles
├── lib/
│   ├── roleConfig.jsx         menus, bottom nav, page access per role
│   ├── store.jsx              React context, one hook
│   └── utils.js               dates, currency, priority tokens
├── data/                      seed data, one file per domain
│   ├── org.js                 tenant, branches, departments, users, dropdowns
│   ├── crm.js                 customers, interactions
│   ├── tasks.js               recurring schedules, today's instances, alerts
│   ├── fms.js                 workflow definitions + assignee resolution
│   ├── forms.js               form templates, submissions
│   └── analytics.js           chart data
├── components/
│   ├── ui.jsx                 Card, Chip, Sheet, PageShell, Tabs, EmptyState…
│   ├── Shell.jsx              top bar, bottom nav, drawer, branch picker
│   ├── TaskInstanceCard.jsx   checklist, complete, delegate
│   ├── DelegateSheet.jsx
│   ├── FormRenderer.jsx       renders any FormTemplate with validation
│   └── AccessDenied.jsx
└── pages/                     one file per screen
```

### The role engine

`lib/roleConfig.jsx` is the single source of truth. `ROLE_PAGES` maps each role to the pages it may open; `DEPARTMENT_OVERRIDES` narrows that further for staff, so a karigar and a sales associate are both "staff" but see different menus. `canAccessPage()` guards every route in `App.jsx`, and a `super_admin` carries `permissions: ["*"]` which opens everything.

Change a role's access in that one file and the drawer, the bottom bar and the routes all follow.

---

## Connecting a real backend

All state lives in `App.jsx` and every mutation is marked with an `// API:` comment naming the endpoint it stands in for:

```js
// API: PATCH /task-instances/:id  { status, completed_at, completed_by }
const completeTask = (taskId) => { ... }
```

Replace the `setState` body with your `fetch` (or Base44 SDK call) and nothing else in the app needs to change — pages only read through `useStore()`.

Two pieces of logic are already production-shaped and transfer as-is:

- **`resolveAssignee()`** in `data/fms.js` — resolves a step's `assignee_rule` (`reporter`, `specific_user`, `department_head`, `role`, `manager`, `previous_step_doer`) against the live org chart.
- **`advanceStep()`** in `App.jsx` — completes a step, auto-resolves branch steps, moves to the next, and closes the instance when it runs out of steps.

Data currently resets on refresh, which is deliberate: it keeps the demo predictable. Persistence arrives with the backend.

---

## Notes

- Mobile-first. The layout is capped at 480px and centred so it reads as a phone on desktop.
- Keyboard focus is visible on every control and `prefers-reduced-motion` is respected.
- Recharts is the heaviest dependency, so `vite.config.js` splits it into its own chunk to keep first paint fast.
