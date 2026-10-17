[CmdletBinding()]
param(
  [switch]$Initialize,
  [switch]$Reset,
  [string[]]$TestFile,
  [switch]$AllFms,
  [switch]$Lint,
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$repo = (git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or (Resolve-Path '.').Path -ne (Resolve-Path $repo).Path) {
  throw 'Run the FMS contract helper from the JewelOS Git root.'
}
$work = Join-Path $repo '.local/fms-contract'
$expected = [IO.Path]::GetFullPath((Join-Path $repo '.local/fms-contract'))
if ([IO.Path]::GetFullPath($work) -ne $expected) { throw 'Unexpected FMS local workdir.' }
$config = Join-Path $work 'supabase/config.toml'
if ($Initialize) {
  New-Item -ItemType Directory -Force -Path (Join-Path $work 'supabase') | Out-Null
  [IO.File]::WriteAllText((Join-Path $repo '.local/.gitignore'), "*`n")
  if (-not (Test-Path $config)) {
    $source = [IO.File]::ReadAllText((Join-Path $repo 'supabase/config.toml'))
    $source = $source.Replace('project_id = "jewelos"', 'project_id = "jewelos-fms-contract"')
    $source = $source.Replace('[api]', "[api]`nport = 61321")
    $source += "`n[db]`nport = 61322`nshadow_port = 61320`n[studio]`nenabled = false`n[analytics]`nenabled = false`n[auth]`nsite_url = `"http://localhost:61317`"`n[db.seed]`nenabled = false`n"
    [IO.File]::WriteAllText($config, $source)
  }
  foreach ($directory in @('migrations', 'tests')) {
    $link = Join-Path $work "supabase/$directory"
    if (-not (Test-Path $link)) {
      New-Item -ItemType Junction -Path $link -Target (Join-Path $repo "supabase/$directory") | Out-Null
    }
  }
}
if (-not (Test-Path $config)) { throw 'Initialize the isolated FMS stack first.' }
if ((Test-Path (Join-Path $work 'supabase/.temp/project-ref')) -or
    ([IO.File]::ReadAllText($config) -notmatch 'project_id = "jewelos-fms-contract"')) {
  throw 'Refusing a linked or unexpected project.'
}
function Invoke-FmsSupabase([string[]]$Arguments) {
  # CLI start/status may print locally generated credentials. Keep their output
  # in ignored scratch state; callers get only the command's success/failure.
  if ($Arguments[0] -eq 'start') {
    $priorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & supabase.cmd --workdir $work @Arguments 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $priorPreference
    [IO.File]::WriteAllText((Join-Path $work 'start.log'), ($output -join "`n"))
    if ($code -ne 0) { throw 'Local FMS start failed; inspect the ignored local start log without exposing credentials.' }
    Write-Output 'Isolated local FMS stack started.'
  } else {
    & supabase.cmd --workdir $work @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Local FMS command failed: $($Arguments -join ' ')" }
  }
}
if ($Initialize) {
  Invoke-FmsSupabase @('start', '--ignore-health-check', '--exclude', 'studio,postgres-meta,logflare,vector,supavisor,imgproxy,edge-runtime,realtime,mailpit')
}
if ($Reset) {
  # Some CLI versions resolve --local independently of --workdir. A reset must
  # never guess between the concurrently running local projects.
  throw 'Reset is disabled until an explicit isolated database replay is configured. No database was reset.'
}
if ($AllFms) {
  $TestFile = @(Get-ChildItem (Join-Path $repo 'supabase/tests') -Filter '*.test.sql' |
    Where-Object { $_.Name -match '^(0239|024[0-9]|025[0-9]|026[0-9])_' } |
    Sort-Object Name | ForEach-Object { 'supabase/tests/' + $_.Name })
}
if ($TestFile) {
  # Run inside the dedicated container: Windows/CLI test-container loopback can
  # otherwise connect to a different local stack or intermittently time out.
  & docker exec supabase_db_jewelos-fms-contract mkdir -p /tmp/fms-contract-tests
  & docker exec supabase_db_jewelos-fms-contract mkdir -p /tmp/fms-contract-tests/helpers
  & docker cp ((Join-Path $repo 'supabase/tests/helpers') + '/.') 'supabase_db_jewelos-fms-contract:/tmp/fms-contract-tests/helpers'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot copy local FMS contract helpers.' }
  & docker exec supabase_db_jewelos-fms-contract psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c 'set client_min_messages=warning; create extension if not exists pgtap with schema extensions'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot enable pgTAP in the isolated database.' }
  foreach ($test in $TestFile) {
    $resolved = [IO.Path]::GetFullPath((Join-Path $repo $test))
    $testsRoot = [IO.Path]::GetFullPath((Join-Path $repo 'supabase/tests')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($testsRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test path must be inside supabase/tests.' }
    $relative = $resolved.Substring($testsRoot.Length).Replace('\','/')
    $parent = [IO.Path]::GetDirectoryName($relative).Replace('\','/')
    if ($parent) { & docker exec supabase_db_jewelos-fms-contract mkdir -p "/tmp/fms-contract-tests/$parent" }
    & docker cp $resolved "supabase_db_jewelos-fms-contract:/tmp/fms-contract-tests/$relative"
    if ($LASTEXITCODE -ne 0) { throw "Cannot copy FMS contract test: $test" }
    $priorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & docker exec -e 'PGOPTIONS=-c search_path=public,extensions' supabase_db_jewelos-fms-contract psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -f "/tmp/fms-contract-tests/$relative" 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $priorPreference
    $lines = @($output | ForEach-Object { $_.ToString() })
    $plan = @($lines | Where-Object { $_ -match '^1\.\.[0-9]+$' })
    $passed = @($lines | Where-Object { $_ -match '^ok [0-9]+' }).Count
    if ($code -ne 0 -or ($lines | Where-Object { $_ -match '^not ok ' }) -or $plan.Count -ne 1 -or $passed -ne [int]($plan[0].Substring(3))) {
      $lines | Select-Object -Last 30 | Write-Output
      throw "FMS contract test failed: $test"
    }
    Write-Output "$test : $passed assertions passed"
  }
}
if ($Lint) {
  $sql = @'
select p.oid::regprocedure, c.level, c.message
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_language l on l.oid=p.prolang
cross join lateral extensions.plpgsql_check_function_tb(p.oid) c
where n.nspname='public' and l.lanname='plpgsql'
  and p.prorettype<>'trigger'::regtype
  and (p.proname like '%fms%' or p.proname='assert_task_assignment_role')
  and c.level='error';
'@
  $output = @(& docker exec supabase_db_jewelos-fms-contract psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c $sql)
  if ($LASTEXITCODE -ne 0) { throw 'Cannot lint the explicitly targeted FMS database.' }
  if ($output.Count) { $output | Write-Output; throw 'FMS database lint reported errors.' }
  Write-Output 'Isolated FMS PL/pgSQL lint: no errors.'
}
if ($Stop) { Invoke-FmsSupabase @('stop') }
