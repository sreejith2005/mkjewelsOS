# Running JewelOS locally

This guide starts the JewelOS web application against the local Supabase stack on Windows. It deliberately uses temporary PowerShell environment variables so existing `.env` files that may point to a hosted project are not overwritten.


Set-Location 'C:\Users\MIS\Downloads\MKJewelOS\jewelos'
supabase.cmd start

$localSupabase = supabase.cmd status -o json | ConvertFrom-Json
$env:VITE_SUPABASE_URL = $localSupabase.API_URL
$env:VITE_SUPABASE_ANON_KEY = $localSupabase.ANON_KEY

pnpm.cmd --filter web dev



## Prerequisites

Install and start:

- Node.js 20.19 or newer
- pnpm 11
- Docker Desktop using Linux containers
- Supabase CLI

Check the tools from PowerShell:

```powershell
node --version
pnpm.cmd --version
docker --version
supabase.cmd --version
```

Use the `.cmd` commands shown here. PowerShell execution policy can block the corresponding `.ps1` shims.

## First-time setup

Open PowerShell and move into the writable application repository:

```powershell
Set-Location 'C:\Users\MIS\Downloads\MKJewelOS\jewelos'
pnpm.cmd install --frozen-lockfile
```

Make sure Docker Desktop is fully running, then start local Supabase:

```powershell
supabase.cmd start
```

Apply all local migrations and rebuild the local database:

```powershell
supabase.cmd db reset
```

`db reset` deletes and recreates only the local Supabase database. Do not add `--linked`, and do not run `supabase db push` for local development.

## Configure this PowerShell window for local Supabase

Run the following in the same PowerShell window. Values are captured without printing or copying keys into source files:

```powershell
$localSupabase = supabase.cmd status -o json | ConvertFrom-Json

$env:SUPABASE_URL = $localSupabase.API_URL
$env:SEED_SUPABASE_SERVICE_ROLE_KEY = $localSupabase.SERVICE_ROLE_KEY
$env:VITE_SUPABASE_URL = $localSupabase.API_URL
$env:VITE_SUPABASE_ANON_KEY = $localSupabase.ANON_KEY
```

These variables exist only in the current PowerShell process. Closing the terminal removes them. This is intentional: the existing ignored `.env` files do not need to be changed.

## Seed local development users

After a fresh `db reset`, run the local-safe wrapper:

```powershell
pnpm.cmd seed:local
```

The wrapper refuses non-local Supabase URLs, temporarily enables only the table privileges required by the development seed, and restores the hardened service-role privileges afterward. It also resets the synthetic passwords to the values below. The seed is idempotent, so rerunning it is safe. A successful run ends with:

```text
DEV seed completed successfully.
Local JewelOS seed and credential reset completed successfully.
```

The synthetic development logins are:

| Role | Email | Password |
|---|---|---|
| Super admin | `admin@mkjewels.local` | `admin123` |
| CRM | `crm@mkjewels.local` | `crm123` |
| Staff | `sales@mkjewels.local` | `sales123` |

These accounts and passwords are for the local development database only.

## Start the web server

Keep the same PowerShell window open and run:

```powershell
pnpm.cmd --filter web dev
```

Open the URL printed by Vite, normally:

```text
http://localhost:5173
```

Sign in with one of the development accounts above. Keep this terminal running while using the app. Stop the web server with `Ctrl+C`.

## Normal startup after the first setup

For later sessions, the usual startup sequence is:

```powershell
Set-Location 'C:\Users\MIS\Downloads\MKJewelOS\jewelos'
supabase.cmd start

$localSupabase = supabase.cmd status -o json | ConvertFrom-Json
$env:SUPABASE_URL = $localSupabase.API_URL
$env:SEED_SUPABASE_SERVICE_ROLE_KEY = $localSupabase.SERVICE_ROLE_KEY
$env:VITE_SUPABASE_URL = $localSupabase.API_URL
$env:VITE_SUPABASE_ANON_KEY = $localSupabase.ANON_KEY

pnpm.cmd --filter web dev
```

Do not run `db reset` every day unless you want to erase and rebuild local data. Run it after pulling new migrations or when a clean local database is required; run `pnpm.cmd seed:local` afterward.

## Optional: serve Edge Functions locally

The main application can be browsed without starting a separate function server. Start one when testing actions such as employee invitations or the background notification/export workers.

In a second PowerShell window:

```powershell
Set-Location 'C:\Users\MIS\Downloads\MKJewelOS\jewelos'

@'
RECURRING_TASKS_CRON_SECRET=local-recurring-only
NOTIFICATION_OUTBOX_CRON_SECRET=local-notifications-only
REPORT_EXPORT_CRON_SECRET=local-exports-only
'@ | Set-Content -LiteralPath '.\supabase\functions\.env.local'

supabase.cmd functions serve --env-file '.\supabase\functions\.env.local'
```

Supabase supplies its local API and role keys to the function runtime. The three values above are synthetic local-only secrets, and `.env.local` is ignored by Git. Never replace them in documentation with production secrets.

Queued notification and report-export jobs require their respective worker to be invoked; merely opening the browser does not process a background queue.

## Useful local URLs and commands

With the standard Supabase ports:

- Web application: `http://localhost:5173`
- Supabase API: `http://127.0.0.1:54321`
- Supabase Studio: `http://127.0.0.1:54323`
- Local email inbox: `http://127.0.0.1:54324`

Status and shutdown commands:

```powershell
supabase.cmd status
supabase.cmd stop
```

Optional validation:

```powershell
supabase.cmd test db
supabase.cmd db lint --local --level warning
pnpm.cmd typecheck --concurrency=1
pnpm.cmd build --concurrency=1
```

## Troubleshooting

### Docker or Supabase cannot start

Start or restart Docker Desktop and wait until its Linux engine reports that it is running. Then retry:

```powershell
supabase.cmd start
```

### The app reports missing Vite Supabase variables

The variables were probably set in a different terminal. In the same window used to start Vite, rerun:

```powershell
$localSupabase = supabase.cmd status -o json | ConvertFrom-Json
$env:VITE_SUPABASE_URL = $localSupabase.API_URL
$env:VITE_SUPABASE_ANON_KEY = $localSupabase.ANON_KEY
pnpm.cmd --filter web dev
```

Restart Vite after changing environment variables. A browser refresh alone is insufficient.

### Login fails after a database reset

`db reset` removes local Auth users. Reconfigure the local variables in that terminal and rerun:

```powershell
pnpm.cmd seed:local
```

### The app is unexpectedly using hosted data

Stop the Vite server immediately. Confirm the terminal variables point to the local API without displaying any keys:

```powershell
$env:VITE_SUPABASE_URL
```

The expected value is `http://127.0.0.1:54321`. Reapply the local-variable block and restart Vite.

### Port 5173 is already occupied

Vite may automatically select another port; open the exact URL it prints. To require a specific free port:

```powershell
pnpm.cmd --filter web dev -- --port 5174
```

### PowerShell says a script cannot be loaded

Use `pnpm.cmd` and `supabase.cmd`, as shown throughout this guide, rather than the `.ps1` shims.
