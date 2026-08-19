$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repositoryRoot

$status = supabase.cmd status -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  throw "Local Supabase is not running. Run supabase.cmd start first."
}

if ($status.API_URL -notmatch '^http://127\.0\.0\.1:' -or $status.DB_URL -notmatch '@127\.0\.0\.1:') {
  throw "Refusing to seed because the resolved Supabase target is not local."
}

$databaseContainer = docker ps --format '{{.Names}}' |
  Where-Object { $_ -eq 'supabase_db_jewelos' } |
  Select-Object -First 1

if (-not $databaseContainer) {
  throw "The local JewelOS database container is not running."
}

$grantSql = @'
grant select, insert, update on table
  public.tenants,
  public.branches,
  public.departments,
  public.user_profiles,
  public.audit_logs,
  public.dropdown_masters,
  public.fms_flows,
  public.fms_stages,
  public.form_templates
to service_role;

grant execute on function public.normalize_form_permissions(jsonb) to service_role;
'@

$restoreSql = @'
revoke all privileges on table
  public.tenants,
  public.branches,
  public.departments,
  public.audit_logs,
  public.dropdown_masters,
  public.fms_flows,
  public.fms_stages,
  public.form_templates
from service_role;

revoke all privileges on function public.normalize_form_permissions(jsonb) from service_role;

revoke insert, update, delete, truncate, references, trigger
on table public.user_profiles from service_role;
grant select on table public.user_profiles to service_role;
'@

$seedSucceeded = $false

try {
  $grantSql | docker exec -i $databaseContainer psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) {
    throw "Could not enable the temporary local seed privileges."
  }

  $env:SUPABASE_URL = $status.API_URL
  $env:SEED_SUPABASE_SERVICE_ROLE_KEY = $status.SERVICE_ROLE_KEY

  pnpm.cmd seed
  if ($LASTEXITCODE -ne 0) {
    throw "The local JewelOS seed failed."
  }

  $seedSucceeded = $true
} finally {
  $restoreSql | docker exec -i $databaseContainer psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) {
    throw "The seed finished, but hardened service-role privileges could not be restored."
  }

  Remove-Item Env:SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:SEED_SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
}

if ($seedSucceeded) {
  Write-Output "Local JewelOS seed and credential reset completed successfully."
}
