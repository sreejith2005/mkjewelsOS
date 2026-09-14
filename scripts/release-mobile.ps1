<#
.SYNOPSIS
  Builds, signs, and publishes a JewelOS Android release. Every installed app
  picks it up through the in-app update prompt.

.DESCRIPTION
  Full procedure and troubleshooting: docs/MOBILE_RELEASE_GUIDE.md

  1. Preflight: main branch, committed mobile/shared source, GitHub login,
     upload keystore, production Supabase URL in apps/mobile/.env.
  2. Next version: one above the higher of app.json and the published release.
  3. Mobile typecheck and tests (skip with -SkipChecks).
  4. Signed release APK built from the working tree, which step 1 proved
     matches HEAD.
  5. Verifies signer (never the debug key), package name and versionCode.
  6. Commits the app.json bump, tags mobile-v<version>, pushes the tag only.
  7. GitHub release with JewelOS.apk + latest.json, marked latest.
  8. Confirms the public update manifest now reports the new version.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-mobile.ps1 -Notes "Faster task list; fixed FMS form submit"

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-mobile.ps1 -Notes "Required for the new task rules" -Mandatory
#>
[CmdletBinding()]
param(
  # What changed, in words an employee understands. Shown in the update prompt.
  [Parameter(Mandatory = $true)][string]$Notes,
  [ValidateSet('patch', 'minor', 'major')][string]$Bump = 'patch',
  # Older installs cannot postpone this update.
  [switch]$Mandatory,
  # Also build 32-bit ARM, for older or Android Go phones that reject the APK.
  [switch]$AllAbis,
  [switch]$SkipChecks,
  # Build and verify only: no commit, tag, or publish. app.json is restored.
  [switch]$NoPublish
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'sreejith2005/mkjewelsOS'
$ExpectedSupabaseHost = 'yimafxhuwgfhvzczqqdd.supabase.co'
$AssetName = 'JewelOS.apk'
$PackageName = 'com.jewelos.mobile'
$BuildTools = 'C:\Android\build-tools\36.0.0'
$ManifestUrl = "https://github.com/$Repo/releases/latest/download/latest.json"
$ReleaseArchive = Join-Path $HOME 'JewelOS-releases'
# Paths whose uncommitted changes would end up inside the APK.
$SourcePaths = @('apps/mobile', 'packages', 'package.json', 'pnpm-lock.yaml', 'tsconfig.base.json')
# Build-tool noise that is not source.
$IgnoredDirt = '^apps/mobile/android/\.kotlin/'

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Stop-Release([string]$Message) { throw "RELEASE STOPPED: $Message" }

function Invoke-Checked([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { Stop-Release "$What failed (exit code $LASTEXITCODE)." }
}

# Runs a native tool and returns its combined output. PowerShell 5.1 turns
# redirected stderr into errors, so the preference is relaxed just for the call.
function Invoke-Captured([string]$File, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & $File @Arguments 2>&1 | ForEach-Object { "$_" } }
  finally { $ErrorActionPreference = $previous }
  [pscustomobject]@{ ExitCode = $LASTEXITCODE; Text = ($output -join "`n") }
}

function Get-SourceDirt {
  $lines = git status --porcelain --untracked-files=all -- @SourcePaths
  @($lines | Where-Object { $_ -and ($_.Substring(3) -notmatch $IgnoredDirt) })
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

# --- 1. Preflight -------------------------------------------------------------
Write-Step 'Preflight'
$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Stop-Release "releases are cut from main; this checkout is on '$branch'." }

$dirt = Get-SourceDirt
if ($dirt.Count -gt 0) {
  Stop-Release ("uncommitted changes would be built into the APK. Commit or stash them first:`n" + ($dirt -join "`n"))
}

$gh = Invoke-Captured 'gh' @('auth', 'status')
if ($gh.ExitCode -ne 0) { Stop-Release 'GitHub CLI is not logged in. Run: gh auth login' }

$gradleProperties = Join-Path $HOME '.gradle\gradle.properties'
$descriptorLine = if (Test-Path $gradleProperties) {
  Get-Content $gradleProperties | Where-Object { $_ -match '^\s*JEWELOS_KEYSTORE_PROPERTIES\s*=' } | Select-Object -First 1
}
if (-not $descriptorLine) { Stop-Release "JEWELOS_KEYSTORE_PROPERTIES is not set in $gradleProperties." }
$descriptor = ($descriptorLine -split '=', 2)[1].Trim() -replace '\\\\', '\'
if (-not (Test-Path $descriptor)) { Stop-Release "the keystore descriptor $descriptor does not exist." }
$descriptorBytes = [IO.File]::ReadAllBytes($descriptor)
if ($descriptorBytes.Length -ge 3 -and $descriptorBytes[0] -eq 0xEF -and $descriptorBytes[1] -eq 0xBB -and $descriptorBytes[2] -eq 0xBF) {
  Stop-Release "$descriptor starts with a BOM, which makes Gradle fall back to the debug key. Re-save it as UTF-8 without BOM."
}

$envFile = 'apps/mobile/.env'
if (-not (Test-Path $envFile)) { Stop-Release "$envFile is missing; the APK would have no server address." }
$envText = Get-Content $envFile -Raw
if ($envText -notmatch "EXPO_PUBLIC_SUPABASE_URL=https://$([regex]::Escape($ExpectedSupabaseHost))") {
  Stop-Release "$envFile does not point at $ExpectedSupabaseHost. Employees would get a build talking to the wrong database."
}
if ($envText -notmatch 'EXPO_PUBLIC_SUPABASE_ANON_KEY=\S+') { Stop-Release "$envFile has no EXPO_PUBLIC_SUPABASE_ANON_KEY." }

foreach ($tool in @("$BuildTools\apksigner.bat", "$BuildTools\aapt2.exe")) {
  if (-not (Test-Path $tool)) { Stop-Release "$tool is missing. Install Android build-tools 36.0.0." }
}

$freeGb = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
if ($freeGb -lt 3) { Stop-Release "only $freeGb GB free on C:. A native build needs about 3 GB." }

# --- 2. Version ---------------------------------------------------------------
Write-Step 'Choosing the version'
$appJsonPath = Join-Path $root 'apps/mobile/app.json'
$appJson = [IO.File]::ReadAllText($appJsonPath)
$versionPattern = '"version":\s*"(\d+)\.(\d+)\.(\d+)"'
$codePattern = '"versionCode":\s*(\d+)'
$versionMatch = [regex]::Match($appJson, $versionPattern)
$codeMatch = [regex]::Match($appJson, $codePattern)
if (-not $versionMatch.Success -or -not $codeMatch.Success) { Stop-Release 'could not read version / versionCode from app.json.' }

$current = [pscustomobject]@{
  Major = [int]$versionMatch.Groups[1].Value
  Minor = [int]$versionMatch.Groups[2].Value
  Patch = [int]$versionMatch.Groups[3].Value
  Code  = [int]$codeMatch.Groups[1].Value
}

$published = $null
try { $published = Invoke-RestMethod -Uri $ManifestUrl -Headers @{ 'Cache-Control' = 'no-cache' } -TimeoutSec 30 }
catch { Write-Host 'No published release found yet; starting from app.json.' }

if ($published -and [int]$published.versionCode -ge $current.Code) {
  $parts = ([string]$published.versionName).Split('.')
  $current = [pscustomobject]@{ Major = [int]$parts[0]; Minor = [int]$parts[1]; Patch = [int]$parts[2]; Code = [int]$published.versionCode }
}

switch ($Bump) {
  'major' { $newName = "$($current.Major + 1).0.0" }
  'minor' { $newName = "$($current.Major).$($current.Minor + 1).0" }
  default { $newName = "$($current.Major).$($current.Minor).$($current.Patch + 1)" }
}
$newCode = $current.Code + 1
$tag = "mobile-v$newName"
$requiredCode = if ($Mandatory) { $newCode } elseif ($published -and $published.PSObject.Properties['requiredVersionCode']) { [int]$published.requiredVersionCode } else { 0 }

if (git tag --list $tag) { Stop-Release "tag $tag already exists locally." }
$existing = Invoke-Captured 'gh' @('release', 'view', $tag, '--repo', $Repo)
if ($existing.ExitCode -eq 0) { Stop-Release "GitHub release $tag already exists." }

Write-Host "Releasing JewelOS $newName (versionCode $newCode)$(if ($Mandatory) { ' - MANDATORY' })"
if ($published) { Write-Host "Currently published: $($published.versionName) (versionCode $($published.versionCode))" }

# --- 3. Checks ----------------------------------------------------------------
if (-not $SkipChecks) {
  Write-Step 'Mobile typecheck and tests'
  Invoke-Checked 'Mobile typecheck' { npm.cmd --prefix apps/mobile run typecheck }
  Invoke-Checked 'Mobile tests' { npm.cmd --prefix apps/mobile run test }
}

# --- 4. Build -----------------------------------------------------------------
Write-Step 'Building the signed release APK (20-40 minutes on this machine)'
$bumped = [regex]::Replace($appJson, $versionPattern, "`"version`": `"$newName`"", 1)
$bumped = [regex]::Replace($bumped, $codePattern, "`"versionCode`": $newCode", 1)
Write-Utf8NoBom $appJsonPath $bumped

$apk = Join-Path $root 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk'
try {
  if (Test-Path $apk) { Remove-Item $apk -Force }
  $gradleArgs = @('assembleRelease', '--no-daemon', '--max-workers=2')
  if ($AllAbis) { $gradleArgs += '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a' }
  Push-Location (Join-Path $root 'apps/mobile/android')
  try { Invoke-Checked 'Gradle release build' { & .\gradlew.bat @gradleArgs } }
  finally { Pop-Location }
  if (-not (Test-Path $apk)) { Stop-Release "the build finished but $apk was not produced." }

  # --- 5. Verify --------------------------------------------------------------
  Write-Step 'Verifying the APK'
  $signer = Invoke-Captured "$BuildTools\apksigner.bat" @('verify', '--print-certs', $apk)
  if ($signer.ExitCode -ne 0) { Stop-Release "apksigner rejected the APK:`n$($signer.Text)" }
  if ($signer.Text -match 'CN=Android Debug') { Stop-Release 'the APK is signed with the DEBUG key, so it could not update installed apps. Check the keystore descriptor.' }
  ($signer.Text -split "`n" | Where-Object { $_ -match 'certificate DN' } | Select-Object -First 1) | Write-Host

  $badging = Invoke-Captured "$BuildTools\aapt2.exe" @('dump', 'badging', $apk)
  $expected = "package: name='$PackageName' versionCode='$newCode' versionName='$newName'"
  if (-not $badging.Text.Contains($expected)) {
    Stop-Release "the APK identity is wrong. Expected: $expected`nGot: $(($badging.Text -split "`n")[0])"
  }
  Write-Host $expected

  $dirtAfterBuild = @(Get-SourceDirt | Where-Object { $_.Substring(3) -ne 'apps/mobile/app.json' })
  if ($dirtAfterBuild.Count -gt 0) {
    Stop-Release ("source changed while the APK was building, so it no longer matches a commit:`n" + ($dirtAfterBuild -join "`n"))
  }
}
catch {
  Write-Utf8NoBom $appJsonPath $appJson
  Write-Host 'app.json restored to its previous version.' -ForegroundColor Yellow
  throw
}

$outDir = Join-Path $ReleaseArchive $tag
New-Item -ItemType Directory -Force $outDir | Out-Null
$releasedApk = Join-Path $outDir $AssetName
Copy-Item $apk $releasedApk -Force
$apkItem = Get-Item $releasedApk
$manifest = [ordered]@{
  schema              = 1
  versionName         = $newName
  versionCode         = $newCode
  requiredVersionCode = $requiredCode
  publishedAt         = (Get-Date).ToUniversalTime().ToString('o')
  notes               = $Notes
  apkUrl              = "https://github.com/$Repo/releases/download/$tag/$AssetName"
  sizeBytes           = $apkItem.Length
  sha256              = (Get-FileHash $releasedApk -Algorithm SHA256).Hash.ToLowerInvariant()
}
$manifestPath = Join-Path $outDir 'latest.json'
Write-Utf8NoBom $manifestPath ($manifest | ConvertTo-Json)
Write-Host "Archived: $outDir ($([math]::Round($apkItem.Length / 1MB, 1)) MB)"

if ($NoPublish) {
  Write-Utf8NoBom $appJsonPath $appJson
  Write-Step "Built and verified only (-NoPublish). app.json restored. APK: $releasedApk"
  exit 0
}

# --- 6. Commit and tag --------------------------------------------------------
Write-Step "Committing and tagging $tag"
Invoke-Checked 'git add' { git add -- apps/mobile/app.json }
Invoke-Checked 'git commit' { git commit -m "release(mobile): JewelOS $newName (versionCode $newCode)" -m $Notes -- apps/mobile/app.json }
Invoke-Checked 'git tag' { git tag -a $tag -m "JewelOS $newName (versionCode $newCode)" }
Invoke-Checked 'git push tag' { git push origin "refs/tags/$tag" }

# --- 7. Publish ---------------------------------------------------------------
Write-Step 'Publishing the GitHub release'
$releaseNotes = "$Notes`n`nversionCode $newCode$(if ($Mandatory) { ' - mandatory update' })`n`nInstall: https://github.com/$Repo/releases/latest/download/$AssetName"
Invoke-Checked 'gh release create' {
  gh release create $tag $releasedApk $manifestPath --repo $Repo --title "JewelOS $newName" --notes $releaseNotes --latest --verify-tag
}

# --- 8. Confirm ---------------------------------------------------------------
Write-Step 'Confirming phones can see the update'
$seen = $null
for ($attempt = 1; $attempt -le 6; $attempt++) {
  try {
    $seen = Invoke-RestMethod -Uri "$($ManifestUrl)?t=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -Headers @{ 'Cache-Control' = 'no-cache' } -TimeoutSec 30
    if ([int]$seen.versionCode -eq $newCode) { break }
  }
  catch { }
  Start-Sleep -Seconds 10
}
if (-not $seen -or [int]$seen.versionCode -ne $newCode) {
  Write-Warning "The release is published, but $ManifestUrl does not report versionCode $newCode yet. Check it again in a few minutes."
}
else {
  Write-Host "Update manifest reports $($seen.versionName) (versionCode $($seen.versionCode))." -ForegroundColor Green
}

Write-Host ''
Write-Host "JewelOS $newName is live." -ForegroundColor Green
Write-Host "  Download link (always the newest): https://github.com/$Repo/releases/latest/download/$AssetName"
Write-Host "  Release page:                      https://github.com/$Repo/releases/tag/$tag"
Write-Host "  Installed apps will prompt on their next launch or return to the foreground."
Write-Host "  Remember to push main when you are ready: git push origin main"
