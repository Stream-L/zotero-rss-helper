$profilePath = Join-Path $PSScriptRoot '..\.dev-profile'
New-Item -ItemType Directory -Force $profilePath | Out-Null
$prefsPath = Join-Path $profilePath 'prefs.js'
if (-not (Test-Path $prefsPath)) { New-Item -ItemType File -Force $prefsPath | Out-Null }
$prefs = Get-Content -Raw $prefsPath
if ($prefs -notmatch 'extensions\.autoDisableScopes') {
  Add-Content -Path $prefsPath -Value 'user_pref("extensions.autoDisableScopes", 0);' -Encoding UTF8
}
if ($prefs -notmatch 'extensions\.enabledScopes') {
  Add-Content -Path $prefsPath -Value 'user_pref("extensions.enabledScopes", 15);' -Encoding UTF8
}
$projectPath = Resolve-Path (Join-Path $PSScriptRoot '..')
node (Join-Path $projectPath 'scripts\watch.mjs')
